/**
 * Router tRPC — Motor de Revisão de Financiamento Imobiliário
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { calcularRevisaoImobiliario } from "./engine-imobiliario";
import { gerarParecerImobiliario } from "./parecer-imobiliario";
import { obterTaxaMedia } from "./db-taxas-medias";
import { buscarTaxaMediaComFallback } from "./bcb-taxas-medias";
import { buscarIndexadorComFallback, buscarSerieHistoricaComFallback } from "./bcb-indexadores";
import { registarCalculo, consumirCredito } from "../db";
import type { ParametrosImobiliario, ResultadoImobiliario } from "../../shared/imobiliario-types";
import { INDEXADOR_LABELS } from "../../shared/imobiliario-types";

const parametrosSchema = z.object({
  valorImovel: z.number().positive(),
  valorFinanciado: z.number().positive(),
  taxaJurosAnual: z.number().min(0),
  prazoMeses: z.number().int().min(1).max(600),
  dataContrato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataPrimeiroVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sistemaAmortizacao: z.enum(["PRICE", "SAC"]),
  enquadramento: z.enum(["SFH", "SFI"]).optional(),
  tipoCredor: z.enum(["INSTITUICAO_SFN", "ENTIDADE_SFI", "INCORPORADORA"]).optional(),
  indexador: z.enum(["TR", "IPCA", "IGPM", "IPC", "POUPANCA", "NENHUM"]),
  taxaIndexadorAnual: z.number().min(0),
  idadeComprador: z.number().int().min(18).max(80),
  taxaMIP: z.number().optional(),
  taxaDFI: z.number().optional(),
  seguroLivreEscolha: z.boolean().optional(),
  taxaAdministracao: z.number().optional(),
  parcelasJaPagas: z.number().int().min(0).optional(),
  capitalizacaoExpressaPactuada: z.boolean().optional(),
  taxaRecalculo: z.enum(["media_bacen", "manual"]).optional(),
  taxaManualAnual: z.number().optional(),
  indexadorRecalculo: z.enum(["TR", "IPCA", "IGPM", "IPC", "POUPANCA", "NENHUM"]).optional(),
  taxaIndexadorRecalculoAnual: z.number().min(0).optional(),
});

function toParametros(input: z.infer<typeof parametrosSchema>): ParametrosImobiliario {
  return {
    valorImovel: input.valorImovel,
    valorFinanciado: input.valorFinanciado,
    taxaJurosAnual: input.taxaJurosAnual,
    prazoMeses: input.prazoMeses,
    dataContrato: input.dataContrato,
    dataPrimeiroVencimento: input.dataPrimeiroVencimento,
    sistemaAmortizacao: input.sistemaAmortizacao,
    enquadramento: input.enquadramento,
    tipoCredor: input.tipoCredor,
    indexador: input.indexador,
    taxaIndexadorAnual: input.taxaIndexadorAnual,
    idadeComprador: input.idadeComprador,
    taxaMIP: input.taxaMIP,
    taxaDFI: input.taxaDFI,
    seguroLivreEscolha: input.seguroLivreEscolha,
    taxaAdministracao: input.taxaAdministracao,
    parcelasJaPagas: input.parcelasJaPagas,
    capitalizacaoExpressaPactuada: input.capitalizacaoExpressaPactuada,
    taxaRecalculo: input.taxaRecalculo,
    taxaManualAnual: input.taxaManualAnual,
    indexadorRecalculo: input.indexadorRecalculo,
    taxaIndexadorRecalculoAnual: input.taxaIndexadorRecalculoAnual,
  };
}

export const imobiliarioRouter = router({
  /** Busca a taxa atual do indexador via API BACEN (sem consumir crédito) */
  buscarIndexador: protectedProcedure
    .input(z.object({
      indexador: z.enum(["TR", "IPCA", "IGPM", "IPC", "POUPANCA", "NENHUM"]),
    }))
    .query(async ({ input }) => {
      const resultado = await buscarIndexadorComFallback(input.indexador);
      return resultado; // null = API indisponível, informar manualmente
    }),

  calcular: protectedProcedure
    .input(parametrosSchema)
    .mutation(async ({ input, ctx }) => {
      // Verificar e consumir crédito
      const temCredito = await consumirCredito(ctx.user.id);
      if (!temCredito) {
        throw new Error("Seus créditos acabaram. Adquira mais créditos ou faça upgrade do seu plano.");
      }

      const params = toParametros(input);

      // Buscar taxa média BACEN para financiamento imobiliário
      let taxaMedia: { taxaMensal: number; taxaAnual: number; dataReferencia: string; fonte: string };
      try {
        taxaMedia = await obterTaxaMedia("financiamento_imobiliario", params.dataContrato);
      } catch {
        taxaMedia = await buscarTaxaMediaComFallback("financiamento_imobiliario", params.dataContrato);
      }

      // Buscar série histórica do indexador (taxas reais mês a mês)
      let serieOriginal: Record<string, number> | undefined;
      let serieRecalculo: Record<string, number> | undefined;
      let fonteSerieHistorica: string | undefined;
      try {
        if (params.indexador !== "NENHUM") {
          const serie = await buscarSerieHistoricaComFallback(params.indexador, params.dataPrimeiroVencimento, params.prazoMeses);
          if (serie && Object.keys(serie.mapa).length > 0) {
            serieOriginal = serie.mapa;
            fonteSerieHistorica = serie.fonte;
          }
        }
        // Se o recálculo usa indexador diferente, buscar série dele também
        const indexRecalc = params.indexadorRecalculo ?? params.indexador;
        if (indexRecalc !== "NENHUM" && indexRecalc !== params.indexador) {
          const serieR = await buscarSerieHistoricaComFallback(indexRecalc, params.dataPrimeiroVencimento, params.prazoMeses);
          if (serieR && Object.keys(serieR.mapa).length > 0) {
            serieRecalculo = serieR.mapa;
          }
        }
      } catch {
        // Silenciar — fallback para taxa fixa
      }

      const resultado = calcularRevisaoImobiliario(params, taxaMedia.taxaAnual, serieOriginal, serieRecalculo);

      // Gerar parecer técnico
      const parecer = gerarParecerImobiliario(
        params,
        resultado.analiseAbusividade,
        resultado.resumo,
        resultado.taxaRecalculoAplicada,
        resultado.criterioRecalculo,
        resultado.protocoloCalculo,
        resultado.dadosParcelasPagas,
      );

      const resultadoCompleto: ResultadoImobiliario = { ...resultado, parecerTecnico: parecer };

      // Registar no histórico
      const titulo = `${params.sistemaAmortizacao} — ${INDEXADOR_LABELS[params.indexador]} — R$ ${params.valorFinanciado.toLocaleString("pt-BR")}`;
      await registarCalculo({
        userId: ctx.user.id,
        tipo: "imobiliario",
        titulo,
        protocolo: resultado.protocoloCalculo,
        diferencaTotal: resultado.resumo.diferencaTotal.toString(),
        temParecer: true,
        resumo: JSON.stringify({
          sistemaAmortizacao: params.sistemaAmortizacao,
          indexador: params.indexador,
          valorImovel: params.valorImovel,
          valorFinanciado: params.valorFinanciado,
          taxaJurosAnual: params.taxaJurosAnual,
          prazoMeses: params.prazoMeses,
          taxaAbusiva: resultado.analiseAbusividade.taxaAbusiva,
          diferencaTotal: resultado.resumo.diferencaTotal,
          correcaoHistorica: !!serieOriginal,
        }),
      });

      return {
        resultado: resultadoCompleto,
        taxaMediaBACEN: {
          taxaMensal: taxaMedia.taxaMensal,
          taxaAnual: taxaMedia.taxaAnual,
          dataReferencia: taxaMedia.dataReferencia,
          fonte: taxaMedia.fonte,
        },
        serieHistorica: fonteSerieHistorica ? {
          usada: true,
          fonte: fonteSerieHistorica,
          mesesComDadosReais: serieOriginal ? Object.keys(serieOriginal).length : 0,
        } : {
          usada: false,
          fonte: "Taxa fixa (API BACEN indisponível ou indexador NENHUM)",
          mesesComDadosReais: 0,
        },
      };
    }),
});
