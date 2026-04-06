/**
 * Router tRPC para o módulo Cálculos Diversos.
 * Ferramentas gratuitas (não consomem créditos).
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  converterTaxa,
  calcularTaxaReal,
  calcularJuros,
  calcularAtualizacaoMonetaria,
  calcularPrazoPrescricional,
  PRAZOS_PRESCRICIONAIS,
} from "./engine-calculos-diversos";
import { CODIGOS_SGS_MENSAL, NOMES_INDICES } from "../../shared/calculos-diversos-types";
import type { IndiceVariacao, IndiceCorrecao } from "../../shared/calculos-diversos-types";

// ─── Helpers para buscar índices do BCB ──────────────────────────────────────

/**
 * Busca série temporal do BCB SGS.
 * Endpoint: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados?formato=json&dataInicial={dd/MM/yyyy}&dataFinal={dd/MM/yyyy}
 */
async function buscarIndiceBCB(
  codigo: number,
  dataInicial: string,
  dataFinal: string,
): Promise<{ data: string; valor: string }[]> {
  // Converter datas de MM/YYYY para dd/MM/yyyy
  const diInicial = formatarDataBCB(dataInicial);
  const diFinal = formatarDataBCB(dataFinal);

  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${diInicial}&dataFinal=${diFinal}`;

  const response = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Erro ao buscar dados do BCB (série ${codigo}): ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Resposta inesperada do BCB para série ${codigo}`);
  }

  return data;
}

/**
 * Converte MM/YYYY ou YYYY-MM-DD para dd/MM/yyyy (formato BCB).
 */
function formatarDataBCB(data: string): string {
  if (data.includes("-")) {
    // YYYY-MM-DD → dd/MM/yyyy
    const [y, m, d] = data.split("-");
    return `${d || "01"}/${m}/${y}`;
  }
  if (data.includes("/") && data.length <= 7) {
    // MM/YYYY → 01/MM/yyyy
    const [m, y] = data.split("/");
    return `01/${m}/${y}`;
  }
  return data;
}

/**
 * Converte dados do BCB para IndiceVariacao[].
 * Agrupa por mês (para séries diárias como SELIC e CDI, acumula no mês).
 */
function processarIndicesBCB(
  dados: { data: string; valor: string }[],
  indice: IndiceCorrecao,
): IndiceVariacao[] {
  // Séries diárias (SELIC, CDI) precisam ser acumuladas por mês
  const isDiaria = indice === "SELIC" || indice === "CDI";

  if (isDiaria) {
    // Agrupar por mês e acumular
    const porMes = new Map<string, number[]>();
    for (const d of dados) {
      const [dia, mes, ano] = d.data.split("/");
      const chave = `${mes}/${ano}`;
      if (!porMes.has(chave)) porMes.set(chave, []);
      porMes.get(chave)!.push(parseFloat(d.valor.replace(",", ".")));
    }

    const indices: IndiceVariacao[] = [];
    for (const [mesAno, valores] of Array.from(porMes.entries())) {
      // Para SELIC/CDI (% a.m. acumulado), o valor já vem acumulado no mês
      // Usamos a série 4390/4391 que já é mensal acumulada
      const variacao = valores[valores.length - 1]; // último valor do mês
      indices.push({
        data: mesAno,
        variacao: isNaN(variacao) ? 0 : variacao,
        fatorAcumulado: 1,
      });
    }
    return indices;
  }

  // Séries mensais (IPCA, IGPM, INPC, TR, Poupança)
  return dados.map(d => {
    const [dia, mes, ano] = d.data.split("/");
    const variacao = parseFloat(d.valor.replace(",", "."));
    return {
      data: `${mes}/${ano}`,
      variacao: isNaN(variacao) ? 0 : variacao,
      fatorAcumulado: 1,
    };
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const calculosDiversosRouter = router({
  /**
   * Conversão de taxas de juros.
   * Gratuito — não consome créditos.
   */
  converterTaxa: publicProcedure
    .input(z.object({
      taxaOriginal: z.number().min(0).max(10000),
      periodoOrigem: z.enum(["diaria", "mensal", "bimestral", "trimestral", "semestral", "anual"]),
      periodoDestino: z.enum(["diaria", "mensal", "bimestral", "trimestral", "semestral", "anual"]),
      tipoOrigem: z.enum(["efetiva", "nominal"]),
      tipoDestino: z.enum(["efetiva", "nominal"]),
      baseDias: z.enum(["corridos", "uteis"]).default("corridos"),
      capitalizacaoNominal: z.enum(["diaria", "mensal", "bimestral", "trimestral", "semestral", "anual"]).optional(),
    }))
    .mutation(({ input }) => {
      return converterTaxa(input);
    }),

  /**
   * Cálculo de taxa real (Fisher).
   * Gratuito — não consome créditos.
   */
  taxaReal: publicProcedure
    .input(z.object({
      taxaNominal: z.number().min(-100).max(10000),
      inflacao: z.number().min(-100).max(10000),
    }))
    .mutation(({ input }) => {
      return calcularTaxaReal(input);
    }),

  /**
   * Cálculo de juros simples ou compostos.
   * Gratuito — não consome créditos.
   */
  calcularJuros: publicProcedure
    .input(z.object({
      capital: z.number().min(0.01).max(100000000000),
      taxa: z.number().min(0).max(10000),
      periodoTaxa: z.enum(["diaria", "mensal", "bimestral", "trimestral", "semestral", "anual"]),
      prazo: z.number().min(1).max(6000),
      periodoPrazo: z.enum(["diaria", "mensal", "bimestral", "trimestral", "semestral", "anual"]),
      tipo: z.enum(["simples", "composto"]),
    }))
    .mutation(({ input }) => {
      return calcularJuros(input);
    }),

  /**
   * Atualização monetária por índice oficial.
   * Gratuito — não consome créditos.
   * Busca os índices do BCB SGS em tempo real.
   */
  atualizarMonetariamente: protectedProcedure
    .input(z.object({
      valorOriginal: z.number().min(0.01).max(100000000000),
      dataInicial: z.string().min(7).max(10),
      dataFinal: z.string().min(7).max(10),
      indice: z.enum(["IPCA", "IGPM", "INPC", "IPCAE", "SELIC", "TR", "CDI", "POUPANCA"]),
      aplicarJurosMora: z.boolean().default(false),
      taxaJurosMoraAnual: z.number().min(0).max(100).default(12),
      aplicarMulta: z.boolean().default(false),
      percentualMulta: z.number().min(0).max(100).default(2),
    }))
    .mutation(async ({ input }) => {
      const codigo = CODIGOS_SGS_MENSAL[input.indice];

      // Buscar dados do BCB
      const dados = await buscarIndiceBCB(codigo, input.dataInicial, input.dataFinal);

      if (dados.length === 0) {
        throw new Error(
          `Não foram encontrados dados para o índice ${NOMES_INDICES[input.indice]} ` +
          `no período de ${input.dataInicial} a ${input.dataFinal}. ` +
          `Verifique se as datas estão corretas e se o índice possui dados publicados para este período.`
        );
      }

      // Processar índices
      const indices = processarIndicesBCB(dados, input.indice);

      // Calcular atualização
      return calcularAtualizacaoMonetaria(
        input.valorOriginal,
        input.indice,
        input.dataInicial,
        input.dataFinal,
        indices,
        input.aplicarJurosMora,
        input.taxaJurosMoraAnual,
        input.aplicarMulta,
        input.percentualMulta,
      );
    }),

  /**
   * Lista de prazos prescricionais disponíveis.
   */
  listarPrazos: publicProcedure
    .input(z.object({
      area: z.enum(["civil", "trabalhista", "tributario", "consumidor", "penal"]).optional(),
    }).optional())
    .query(({ input }) => {
      if (input?.area) {
        return PRAZOS_PRESCRICIONAIS.filter(p => p.area === input.area);
      }
      return PRAZOS_PRESCRICIONAIS;
    }),

  /**
   * Cálculo de prazo prescricional.
   * Gratuito — não consome créditos.
   */
  calcularPrescricao: publicProcedure
    .input(z.object({
      area: z.enum(["civil", "trabalhista", "tributario", "consumidor", "penal"]),
      tipoAcao: z.string().min(1),
      dataFatoGerador: z.string().min(10).max(10),
      suspensoes: z.array(z.object({
        inicio: z.string().min(10).max(10),
        fim: z.string().min(10).max(10),
      })).optional(),
    }))
    .mutation(({ input }) => {
      return calcularPrazoPrescricional(input);
    }),

  /**
   * Lista índices disponíveis para atualização monetária.
   */
  listarIndices: publicProcedure
    .query(() => {
      return Object.entries(NOMES_INDICES).map(([key, nome]) => ({
        id: key as IndiceCorrecao,
        nome,
        codigo: CODIGOS_SGS_MENSAL[key as IndiceCorrecao],
      }));
    }),
});
