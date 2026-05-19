/**
 * Cron: dispara lembretes pré-evento que chegaram na hora.
 *
 * Roda a cada 1 min. Lê `agendamento_lembretes` onde:
 *   - enviado=FALSE
 *   - dispararEm <= now
 *
 * Pra cada lembrete, despacha por cada canal pra cada destinatário:
 *   - notificacao_app: insere em `notificacoes` (usa criarNotificacao do router)
 *   - email: TODO (integração via Resend já existe — adicionar nesta versão)
 *   - whatsapp: TODO (integração via canais existentes)
 *
 * Idempotente: marca enviado=TRUE + enviadoAt antes de despachar.
 * Falha de canal individual NÃO desmarca enviado (o usuário não precisa
 * receber lembrete de algo que aconteceu há 1h).
 */

import { eq, and, lte, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { agendamentoLembretes, agendamentos, colaboradores, users } from "../../drizzle/schema";
import { criarNotificacao } from "../processos/router-notificacoes";
import { createLogger } from "../_core/logger";

const log = createLogger("cron-lembretes");

export async function dispararLembretesAgenda(): Promise<{
  total: number;
  enviados: number;
  erros: number;
}> {
  const db = await getDb();
  if (!db) return { total: 0, enviados: 0, erros: 0 };

  const agora = new Date();

  // Pega lembretes pendentes cujo momento já passou.
  // `dispararEm` foi preenchido na criação (dataInicio - minutosAntes).
  // Limita 100 por ciclo pra não saturar canal de envio.
  const pendentes = await db
    .select({
      lembreteId: agendamentoLembretes.id,
      agendamentoId: agendamentoLembretes.agendamentoId,
      destinatarioIds: agendamentoLembretes.destinatarioIds,
      canais: agendamentoLembretes.canais,
      tipo: agendamentoLembretes.tipo,
      minutosAntes: agendamentoLembretes.minutosAntes,
      // Dados do agendamento pra montar a mensagem
      titulo: agendamentos.titulo,
      dataInicio: agendamentos.dataInicio,
      local: agendamentos.local,
      responsavelId: agendamentos.responsavelId,
      escritorioId: agendamentos.escritorioId,
    })
    .from(agendamentoLembretes)
    .innerJoin(agendamentos, eq(agendamentos.id, agendamentoLembretes.agendamentoId))
    .where(
      and(
        eq(agendamentoLembretes.enviado, false),
        isNotNull(agendamentoLembretes.dispararEm),
        lte(agendamentoLembretes.dispararEm, agora),
      ),
    )
    .limit(100);

  if (pendentes.length === 0) return { total: 0, enviados: 0, erros: 0 };

  log.info({ total: pendentes.length }, "[cron-lembretes] disparando");

  let enviados = 0;
  let erros = 0;

  for (const p of pendentes) {
    // Marca como enviado ANTES — evita duplicação se canal falhar
    try {
      await db
        .update(agendamentoLembretes)
        .set({ enviado: true, enviadoAt: agora })
        .where(eq(agendamentoLembretes.id, p.lembreteId));
    } catch (err) {
      log.error({ lembreteId: p.lembreteId, err: err instanceof Error ? err.message : err }, "marcar enviado falhou");
      erros++;
      continue;
    }

    // Destinatários: usa o JSON novo; cai pro responsável se null (legado)
    const destinatariosColaboradorIds: number[] = Array.isArray(p.destinatarioIds) && p.destinatarioIds.length > 0
      ? (p.destinatarioIds as number[])
      : p.responsavelId
        ? [p.responsavelId]
        : [];

    if (destinatariosColaboradorIds.length === 0) continue;

    // Resolve userId de cada colaborador (notificacoes usa userId, não colaboradorId)
    let destinatariosResolvidos: Array<{ userId: number; nome: string | null; email: string | null }> = [];
    try {
      destinatariosResolvidos = await db
        .select({
          userId: colaboradores.userId,
          nome: users.name,
          email: users.email,
        })
        .from(colaboradores)
        .leftJoin(users, eq(users.id, colaboradores.userId))
        .where(
          and(
            eq(colaboradores.escritorioId, p.escritorioId),
            // Limita aos colaboradores específicos
            ...(destinatariosColaboradorIds.length === 1
              ? [eq(colaboradores.id, destinatariosColaboradorIds[0])]
              : []),
          ),
        );
      if (destinatariosColaboradorIds.length > 1) {
        destinatariosResolvidos = destinatariosResolvidos.filter((d) =>
          destinatariosColaboradorIds.includes(d.userId),
        );
      }
    } catch (err) {
      log.error({ lembreteId: p.lembreteId, err: err instanceof Error ? err.message : err }, "resolver destinatários falhou");
      erros++;
      continue;
    }

    // Canais: usa JSON novo, ou cai pro tipo legado
    const canais: string[] = Array.isArray(p.canais) && p.canais.length > 0
      ? (p.canais as string[])
      : [p.tipo];

    // Despacha por canal × destinatário
    const dataFmt = new Date(p.dataInicio).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const minutosLabel = p.minutosAntes < 60
      ? `${p.minutosAntes}min`
      : p.minutosAntes < 60 * 24
        ? `${Math.round(p.minutosAntes / 60)}h`
        : `${Math.round(p.minutosAntes / (60 * 24))}d`;
    const titulo = `Lembrete em ${minutosLabel}: ${p.titulo}`;
    const mensagem = p.local
      ? `${dataFmt} · ${p.local}`
      : `${dataFmt}`;

    for (const dest of destinatariosResolvidos) {
      if (!dest.userId) continue;

      for (const canal of canais) {
        try {
          if (canal === "notificacao_app") {
            await criarNotificacao({
              userId: dest.userId,
              tipo: "sistema",
              titulo,
              mensagem,
            });
            enviados++;
          } else if (canal === "email") {
            // Email via Resend — fora do escopo desta primeira ondaa.
            // Loga pra acompanhar quando integrar.
            log.info(
              { lembreteId: p.lembreteId, userId: dest.userId, email: dest.email, canal: "email" },
              "[cron-lembretes] canal email não implementado — só notificação app por enquanto",
            );
          } else if (canal === "whatsapp") {
            // WhatsApp via integrações existentes — fora do escopo agora.
            log.info(
              { lembreteId: p.lembreteId, userId: dest.userId, canal: "whatsapp" },
              "[cron-lembretes] canal whatsapp não implementado — só notificação app por enquanto",
            );
          }
        } catch (err) {
          log.error(
            { lembreteId: p.lembreteId, userId: dest.userId, canal, err: err instanceof Error ? err.message : err },
            "despacho falhou",
          );
          erros++;
        }
      }
    }
  }

  log.info({ total: pendentes.length, enviados, erros }, "[cron-lembretes] finalizou");
  return { total: pendentes.length, enviados, erros };
}
