/**
 * Funil de remarketing de /admin/clients (mockup aprovado 25/08).
 *
 * O problema que isto resolve: advogado se cadastrava, não assinava, e o
 * dono da plataforma só descobria semanas depois — a lista tratava cadastro
 * novo e conta morta do mesmo jeito. Aqui cada dono de escritório ganha uma
 * SITUAÇÃO comercial derivada das assinaturas, e três cartões contam quem
 * está esperando contato. "Marcar contato" tira a pessoa da conta.
 */

const DIA_MS = 24 * 60 * 60 * 1000;
/** Janela do "teste venceu": mais velho que isso não é "pra falar hoje" —
 *  continua acessível na lista geral, só sai da contagem. */
const JANELA_CARTAO_MS = 30 * DIA_MS;
/** "Nunca ativou" tem janela maior: o dono descobriu cadastros de 60-70
 *  dias parados que ele nunca tinha visto — cortá-los do cartão agora
 *  seria repetir o problema que o funil veio resolver. */
const JANELA_NUNCA_ATIVOU_MS = 90 * DIA_MS;
const VENCENDO_MS = 7 * DIA_MS;

export type TipoSituacao =
  | "ativa"
  | "cortesia"
  | "em_teste"
  | "teste_vencendo"
  | "teste_vencido"
  | "nunca_ativou";

export interface SubResumo {
  status: string;
  cortesia: boolean;
  cortesiaExpiraEm: number | null;
  trialIniciadoEm: number | null;
  trialExpiraEm: number | null;
}

/**
 * Classifica um dono de escritório pela assinatura mais relevante.
 * past_due/unpaid contam como "ativa" — inadimplência tem fluxo próprio
 * (card de Inadimplente), não é remarketing de teste.
 */
export function situacaoComercial(sub: SubResumo | null, agoraMs: number): TipoSituacao {
  if (!sub) return "nunca_ativou";
  if (sub.cortesia) {
    const vigente = sub.cortesiaExpiraEm == null || sub.cortesiaExpiraEm > agoraMs;
    if (vigente) return "cortesia";
  }
  if (sub.status === "active" || sub.status === "past_due" || sub.status === "unpaid") {
    return "ativa";
  }
  if (sub.status === "trialing") {
    const expira = sub.trialExpiraEm ?? 0;
    if (expira <= agoraMs) return "teste_vencido";
    if (expira - agoraMs <= VENCENDO_MS) return "teste_vencendo";
    return "em_teste";
  }
  // canceled/incomplete/expired/paused: teve contato com o produto e saiu.
  if (sub.trialExpiraEm != null) return "teste_vencido";
  return "nunca_ativou";
}

/**
 * Entre várias assinaturas do mesmo user, a que define a situação:
 * ativa/cortesia vigente > trial rodando > a de trial mais recente.
 */
export function subMaisRelevante(subs: SubResumo[], agoraMs: number): SubResumo | null {
  if (subs.length === 0) return null;
  const peso = (s: SubResumo): number => {
    const sit = situacaoComercial(s, agoraMs);
    if (sit === "ativa") return 5;
    if (sit === "cortesia") return 4;
    if (sit === "em_teste" || sit === "teste_vencendo") return 3;
    if (sit === "teste_vencido") return 2;
    return 1;
  };
  return [...subs].sort(
    (a, b) => peso(b) - peso(a) || (b.trialExpiraEm ?? 0) - (a.trialExpiraEm ?? 0),
  )[0];
}

/**
 * Em qual cartão do funil este dono entra (ou nenhum). O contato marcado
 * DEPOIS do momento em que a pessoa entrou no estágio tira ela da conta —
 * é o que faz "o 2 virar 1" quando o dono fala com alguém.
 */
export function cartaoDoFunil(args: {
  situacao: TipoSituacao;
  criadoEmMs: number;
  trialExpiraEm: number | null;
  ultimoContatoEm: number | null;
  agoraMs: number;
}): "nunca_ativou" | "teste_vencendo" | "teste_vencido" | null {
  const { situacao, criadoEmMs, trialExpiraEm, ultimoContatoEm, agoraMs } = args;
  if (situacao === "nunca_ativou") {
    if (agoraMs - criadoEmMs > JANELA_NUNCA_ATIVOU_MS) return null;
    if (ultimoContatoEm != null && ultimoContatoEm >= criadoEmMs) return null;
    return "nunca_ativou";
  }
  if (situacao === "teste_vencendo") {
    if (ultimoContatoEm != null && agoraMs - ultimoContatoEm <= VENCENDO_MS) return null;
    return "teste_vencendo";
  }
  if (situacao === "teste_vencido") {
    const venceuEm = trialExpiraEm ?? 0;
    if (agoraMs - venceuEm > JANELA_CARTAO_MS) return null;
    if (ultimoContatoEm != null && ultimoContatoEm >= venceuEm) return null;
    return "teste_vencido";
  }
  return null;
}

export interface CartaoFunil {
  total: number;
  userIds: number[];
  nomes: string[];
}

export interface FunilRemarketing {
  nuncaAtivou: CartaoFunil;
  testeVencendo: CartaoFunil;
  testeVencido: CartaoFunil;
}

export const cartaoVazio = (): CartaoFunil => ({ total: 0, userIds: [], nomes: [] });
