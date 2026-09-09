/**
 * Cancelar / reativar um contrato fechado (lead em fechado_ganho).
 *
 * A etapa não muda: o fechamento aconteceu e segue contando no mês em que
 * fechou. O cancelamento é outro evento — data própria (aceita retroativa,
 * nunca antes do fechamento nem no futuro), motivo, detalhe e quem cancelou.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { contatos, leads } from "../../drizzle/schema";
import { dataHojeBR } from "../../shared/escritorio-types";
import { motivoServicoAoCancelar, type MotivoCancelamento } from "../../shared/cancelamento-contrato";

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function formatarDiaBR(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/** Devolve a mensagem de erro, ou null quando a data serve. Datas são dias
 *  civis (YYYY-MM-DD) já no fuso do escritório. */
export function validarDataCancelamento(args: {
  data: string;
  hoje: string;
  diaFechamento: string | null;
}): string | null {
  if (!REGEX_DATA.test(args.data)) return "Data do cancelamento inválida.";
  if (args.data > args.hoje) return "A data do cancelamento não pode ser no futuro.";
  if (args.diaFechamento && args.data < args.diaFechamento) {
    return `A data do cancelamento não pode ser anterior ao fechamento (${formatarDiaBR(args.diaFechamento)}).`;
  }
  return null;
}

/** Meio-dia, como a Situação do serviço grava: a data de calendário não
 *  "volta 1 dia" por fuso ao ser lida. */
export function instanteDoDia(data: string): Date {
  return new Date(data + "T12:00:00");
}

export async function cancelarContrato(db: any, args: {
  escritorioId: number;
  leadId: number;
  data: string;
  motivo: MotivoCancelamento;
  detalhe?: string | null;
  canceladoPor: number | null;
  encerrarServico?: boolean;
  tz: string;
}): Promise<{ contatoId: number }> {
  const [lead] = await db
    .select({
      id: leads.id,
      contatoId: leads.contatoId,
      etapaFunil: leads.etapaFunil,
      fechadoEm: leads.fechadoEm,
      createdAt: leads.createdAt,
      canceladoEm: leads.canceladoEm,
    })
    .from(leads)
    .where(and(eq(leads.id, args.leadId), eq(leads.escritorioId, args.escritorioId)))
    .limit(1);
  if (!lead) throw new Error("Negociação não encontrada.");
  if (lead.etapaFunil !== "fechado_ganho") {
    throw new Error("Só um contrato fechado (Ganho) pode ser cancelado. Lead que não chegou a fechar é marcado como Perdido.");
  }
  if (lead.canceladoEm) throw new Error("Este contrato já está cancelado.");

  const quandoFechou = (lead.fechadoEm ?? lead.createdAt) as Date | null;
  const erro = validarDataCancelamento({
    data: args.data,
    hoje: dataHojeBR(args.tz),
    diaFechamento: quandoFechou ? dataHojeBR(args.tz, quandoFechou) : null,
  });
  if (erro) throw new Error(erro);

  const detalhe = (args.detalhe || "").trim().slice(0, 500) || null;
  await db
    .update(leads)
    .set({
      canceladoEm: instanteDoDia(args.data),
      motivoCancelamento: args.motivo,
      detalheCancelamento: detalhe,
      canceladoPor: args.canceladoPor,
    })
    .where(and(eq(leads.id, args.leadId), eq(leads.escritorioId, args.escritorioId)));

  if (args.encerrarServico) {
    await db
      .update(contatos)
      .set({
        situacaoServico: "cancelado",
        servicoEncerradoEm: instanteDoDia(args.data),
        servicoEncerradoMotivo: motivoServicoAoCancelar(args.motivo, detalhe),
        servicoEncerradoPor: args.canceladoPor,
      })
      .where(and(eq(contatos.id, lead.contatoId), eq(contatos.escritorioId, args.escritorioId)));
  }
  return { contatoId: Number(lead.contatoId) };
}

/** Volta pra Ganho: limpa data, motivo, detalhe e autor. A Situação do
 *  serviço do cliente não é mexida — reativar o serviço é outro botão. */
export async function reativarContrato(db: any, args: { escritorioId: number; leadId: number }): Promise<void> {
  const [lead] = await db
    .select({ id: leads.id, canceladoEm: leads.canceladoEm })
    .from(leads)
    .where(and(eq(leads.id, args.leadId), eq(leads.escritorioId, args.escritorioId)))
    .limit(1);
  if (!lead) throw new Error("Negociação não encontrada.");
  if (!lead.canceladoEm) throw new Error("Este contrato não está cancelado.");
  await db
    .update(leads)
    .set({ canceladoEm: null, motivoCancelamento: null, detalheCancelamento: null, canceladoPor: null })
    .where(and(eq(leads.id, args.leadId), eq(leads.escritorioId, args.escritorioId)));
}

/** Cancela todos os contratos fechados (e ainda não cancelados) de um
 *  cliente — usado quando o serviço é encerrado pela ficha com a opção
 *  "cancelar também os contratos". Devolve quantos foram cancelados. */
export async function cancelarContratosDoContato(db: any, args: {
  escritorioId: number;
  contatoId: number;
  data: string;
  motivo: MotivoCancelamento;
  detalhe?: string | null;
  canceladoPor: number | null;
}): Promise<number> {
  if (!REGEX_DATA.test(args.data)) throw new Error("Data do cancelamento inválida.");
  const abertos = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(
      eq(leads.escritorioId, args.escritorioId),
      eq(leads.contatoId, args.contatoId),
      eq(leads.etapaFunil, "fechado_ganho"),
      isNull(leads.canceladoEm),
    ));
  const ids = abertos.map((l: { id: number }) => Number(l.id));
  if (ids.length === 0) return 0;
  await db
    .update(leads)
    .set({
      canceladoEm: instanteDoDia(args.data),
      motivoCancelamento: args.motivo,
      detalheCancelamento: (args.detalhe || "").trim().slice(0, 500) || null,
      canceladoPor: args.canceladoPor,
    })
    .where(and(eq(leads.escritorioId, args.escritorioId), inArray(leads.id, ids)));
  return ids.length;
}
