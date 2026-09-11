/**
 * Limites de uso por mês — a régua que substitui os créditos.
 *
 * Antes havia duas medidas para a mesma coisa: o plano limitava quantos
 * processos e CPFs podiam ficar vigiados (vaga) E financiava em créditos o
 * mesmo vigiar, com preços diferentes por operação. Quem usava o sistema
 * precisava saber de cabeça que consulta custa 1 e busca custa 3 para
 * responder "posso consultar mais um processo?".
 *
 * Agora cada operação tem um número no plano e um contador que zera todo mês.
 * Vaga (processos e CPFs vigiados) continua como vaga — não é por mês.
 */

import type { PlanoLimites } from "./planos-types";
import { LIMITE_ILIMITADO } from "./planos-types";

export const OPERACOES_LIMITADAS = [
  "consulta_processo",
  "busca_documento",
  "resumo_ia",
  "calculo",
] as const;
export type OperacaoLimitada = (typeof OPERACOES_LIMITADAS)[number];

export const ROTULO_OPERACAO: Record<OperacaoLimitada, string> = {
  consulta_processo: "Consultas de processo",
  busca_documento: "Buscas por CPF/CNPJ",
  resumo_ia: "Resumos de IA",
  calculo: "Cálculos",
};

/** O que a pessoa estava tentando fazer — entra na mensagem de bloqueio. */
export const ACAO_OPERACAO: Record<OperacaoLimitada, string> = {
  consulta_processo: "consultar processos",
  busca_documento: "buscar por CPF/CNPJ",
  resumo_ia: "gerar resumos com IA",
  calculo: "fazer cálculos",
};

/** Qual campo do plano manda em cada operação. */
export const CAMPO_DO_PLANO: Record<OperacaoLimitada, keyof PlanoLimites> = {
  consulta_processo: "maxConsultasProcessoMes",
  busca_documento: "maxBuscasDocumentoMes",
  resumo_ia: "maxResumosIaMes",
  calculo: "creditosCalculosMes",
};

/**
 * Limite que vale de verdade. `null`, `0` e o marcador de ilimitado passam a
 * significar "sem limite" — é o que preserva os planos antigos, que têm 0 em
 * campos que ninguém conferia. Plano que quer barrar escreve um número.
 */
export function limiteVale(valor: number | null | undefined): boolean {
  return typeof valor === "number" && valor > 0 && valor < LIMITE_ILIMITADO;
}

export function excedeuLimite(usado: number, limite: number | null | undefined): boolean {
  if (!limiteVale(limite)) return false;
  return usado >= (limite as number);
}

/** Competência YYYY-MM no fuso de Brasília — é por ela que o contador zera. */
export function competenciaDaData(quando: Date, fuso = "America/Sao_Paulo"): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(quando);
  const ano = partes.find((p) => p.type === "year")?.value ?? "0000";
  const mes = partes.find((p) => p.type === "month")?.value ?? "01";
  return `${ano}-${mes}`;
}

/**
 * O texto que o usuário lê quando bate no teto. Não oferece compra avulsa de
 * propósito (decisão do dono): quem libera mais é o escritório falando com a
 * gente, e o painel aumenta o limite do mês.
 */
export function mensagemLimiteAtingido(operacao: OperacaoLimitada, limite: number): string {
  return `Você usou ${limite} ${ROTULO_OPERACAO[operacao].toLowerCase()} deste mês. Fale com a gente para liberar mais.`;
}

export type UsoDoMes = {
  operacao: OperacaoLimitada;
  usado: number;
  /** Limite do plano + o extra concedido no painel. null = sem limite. */
  limite: number | null;
  extra: number;
};

/** Fração usada, para a barra. Sem limite devolve 0 (barra vazia, sem susto). */
export function fracaoUsada(u: UsoDoMes): number {
  if (!limiteVale(u.limite)) return 0;
  return Math.min(1, u.usado / (u.limite as number));
}
