/**
 * Router tRPC v3 — Motor de Revisão de Financiamento Bancário
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { calcularRevisaoFinanciamento } from "./engine-financiamento";
import { gerarParecerTecnico } from "./parecer-financiamento";
import { obterTaxaMedia } from "./db-taxas-medias";
import { buscarTaxaMediaComFallback } from "./bcb-taxas-medias";
import type { ResultadoFinanciamento, ModalidadeCredito, ParametrosFinanciamento } from "../../shared/financiamento-types";
import { registarCalculo, consumirCredito } from "../db";

const tarifaAdicionalSchema = z.object({
  descricao: z.string(),
  valor: z.number(),
  financiada: z.boolean().default(false),
});

const tarifasSchema = z.object({
  tac: z.number().optional(),
  tacFinanciada: z.boolean().optional(),
  tec: z.number().optional(),
  tecFinanciada: z.boolean().optional(),
  iof: z.number().optional(),
  iofFinanciado: z.boolean().optional(),
  seguro: z.number().optional(),
  seguroFinanciado: z.boolean().optional(),
  seguroLivreEscolha: z.boolean().optional(),
  avaliacaoBem: z.number().optional(),
  avaliacaoBemFinanciada: z.boolean().optional(),
  registroContrato: z.number().optional(),
  registroContratoFinanciado: z.boolean().optional(),
  outras: z.array(tarifaAdicionalSchema).optional(),
}).optional();

const parametrosSchema = z.object({
  valorFinanciado: z.number().positive(),
  taxaJurosMensal: z.number().min(0),
  taxaJurosAnual: z.number().min(0),
  quantidadeParcelas: z.number().int().positive(),
  valorParcela: z.number().optional(),
  dataContrato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataPrimeiroVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  parcelasJaPagas: z.number().int().min(0).optional(),
  sistemaAmortizacao: z.enum(["PRICE", "SAC", "SACRE"]),
  modalidadeCredito: z.enum([
    "credito_pessoal", "consignado", "financiamento_veiculo",
    "financiamento_imobiliario", "cartao_credito", "cheque_especial", "capital_giro",
  ]),
  tipoPessoa: z.enum(["fisica", "juridica"]).optional(),
  tipoVinculoConsignado: z.enum(["clt", "servidor_publico", "militar", "inss"]).optional(),
  tarifas: tarifasSchema,
  comissaoPermanencia: z.number().optional(),
  multaMora: z.number().optional(),
  jurosMora: z.number().optional(),
  taxaRecalculo: z.enum(["media_bacen", "teto_stj", "manual"]).optional(),
  taxaManual: z.number().optional(),
  anatocismoExpressoPactuado: z.boolean().optional(),
});

function toParametros(input: z.infer<typeof parametrosSchema>): ParametrosFinanciamento {
  return {
    valorFinanciado: input.valorFinanciado,
    taxaJurosMensal: input.taxaJurosMensal,
    taxaJurosAnual: input.taxaJurosAnual,
    quantidadeParcelas: input.quantidadeParcelas,
    valorParcela: input.valorParcela,
    dataContrato: input.dataContrato,
    dataPrimeiroVencimento: input.dataPrimeiroVencimento,
    parcelasJaPagas: input.parcelasJaPagas,
    sistemaAmortizacao: input.sistemaAmortizacao,
    modalidadeCredito: input.modalidadeCredito,
    tipoPessoa: input.tipoPessoa,
    tipoVinculoConsignado: input.tipoVinculoConsignado,
    tarifas: input.tarifas,
    comissaoPermanencia: input.comissaoPermanencia,
    multaMora: input.multaMora,
    jurosMora: input.jurosMora,
    taxaRecalculo: input.taxaRecalculo,
    taxaManual: input.taxaManual,
    anatocismoExpressoPactuado: input.anatocismoExpressoPactuado,
  };
}

export const financiamentoRouter = router({
  calcular: protectedProcedure
    .input(parametrosSchema)
    .mutation(async ({ input, ctx }) => {
      const temCredito = await consumirCredito(ctx.user.id);
      if (!temCredito) {
        throw new Error("Seus créditos acabaram. Adquira mais créditos ou faça upgrade do seu plano.");
      }

      const params = toParametros(input);

      let taxaMedia: { taxaMensal: number; taxaAnual: number; dataReferencia: string; fonte: string };
      try {
        taxaMedia = await obterTaxaMedia(params.modalidadeCredito, params.dataContrato, params.tipoPessoa, params.tipoVinculoConsignado);
      } catch {
        taxaMedia = await buscarTaxaMediaComFallback(params.modalidadeCredito, params.dataContrato, params.tipoPessoa, params.tipoVinculoConsignado);
      }

      // Pre-fetch do teto legal por DATA DO CONTRATO (tabela tetos_legais).
      // Se tabela não existe ou sem registro pra essa data → null → engine
      // usa regra geral 1,5× BACEN com nota no parecer.
      let tetoLegalPreFetched: { tetoMensal: number; fundamento: string } | null = null;
      try {
        const { obterTetoLegalPorData } = await import("./tetos-legais");
        tetoLegalPreFetched = await obterTetoLegalPorData(
          params.modalidadeCredito,
          params.dataContrato,
          params.tipoVinculoConsignado,
        );
      } catch {
        // Tabela pode não existir (migration pendente) — engine usa fallback hardcoded
      }

      const resultado = calcularRevisaoFinanciamento(
        params, taxaMedia.taxaMensal, taxaMedia.taxaAnual, tetoLegalPreFetched,
      );

      const parecer = gerarParecerTecnico(
        params, resultado.analiseAbusividade, resultado.resumo,
        resultado.taxaRecalculoAplicada, resultado.criterioRecalculo,
        resultado.protocoloCalculo, resultado.dadosParcelasPagas
      );

      const resultadoCompleto: ResultadoFinanciamento = { ...resultado, parecerTecnico: parecer };

      // Registar no histórico
      const modalidadeLabel: Record<string, string> = {
        credito_pessoal: "Crédito Pessoal",
        consignado: "Consignado",
        financiamento_veiculo: "Financiamento Veículo",
        financiamento_imobiliario: "Financiamento Imobiliário",
        cartao_credito: "Cartão de Crédito",
        cheque_especial: "Cheque Especial",
        capital_giro: "Capital de Giro",
      };
      const titulo = `${params.sistemaAmortizacao} — ${modalidadeLabel[params.modalidadeCredito] ?? params.modalidadeCredito} — R$ ${params.valorFinanciado.toLocaleString("pt-BR")}`;
      await registarCalculo({
        userId: ctx.user.id,
        tipo: "bancario",
        titulo,
        protocolo: resultado.protocoloCalculo,
        diferencaTotal: resultado.resumo.diferencaTotal.toString(),
        temParecer: true,
        resumo: JSON.stringify({
          sistemaAmortizacao: params.sistemaAmortizacao,
          modalidade: params.modalidadeCredito,
          valorFinanciado: params.valorFinanciado,
          taxaJurosMensal: params.taxaJurosMensal,
          quantidadeParcelas: params.quantidadeParcelas,
          taxaAbusiva: resultado.analiseAbusividade.taxaAbusiva,
          diferencaTotal: resultado.resumo.diferencaTotal,
        }),
      });

      return {
        resultado: resultadoCompleto,
        taxaMediaBACEN: {
          taxaMensal: taxaMedia.taxaMensal, taxaAnual: taxaMedia.taxaAnual,
          dataReferencia: taxaMedia.dataReferencia, fonte: taxaMedia.fonte,
        },
      };
    }),

  buscarTaxaMedia: protectedProcedure
    .input(z.object({
      modalidade: z.enum([
        "credito_pessoal", "consignado", "financiamento_veiculo",
        "financiamento_imobiliario", "cartao_credito", "cheque_especial", "capital_giro",
      ]),
      dataContrato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(async ({ input }) => {
      try {
        return await obterTaxaMedia(input.modalidade as ModalidadeCredito, input.dataContrato);
      } catch {
        return await buscarTaxaMediaComFallback(input.modalidade as ModalidadeCredito, input.dataContrato);
      }
    }),
});
