/**
 * Cron dos relatórios programados por e-mail.
 *
 * Roda de hora em hora e dispara os agendamentos cuja hora LOCAL do
 * escritório bate com a configurada — cron fixo em UTC mandaria o relatório
 * às 4h da manhã pra quem está em Manaus.
 *
 * Idempotência vem do UNIQUE (agendamento, dia local) em
 * `relatorios_programados_envios`: reinício de processo, tick duplicado ou
 * redeploy no horário não redisparam. E cada tentativa grava o resultado
 * REAL — sem isso o painel mostraria "ativo" enquanto o Resend está fora e
 * ninguém recebe nada.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  escritorios,
  relatoriosProgramados,
  relatoriosProgramadosEnvios,
  users,
  type RelatorioProgramado,
} from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { createCallerFactory } from "../_core/trpc";
import { relatoriosRouter, relatoriosPdfRouter } from "./router-relatorios";
import { mergeRouters } from "../_core/trpc";
import {
  enviarRelatorio,
  gerarRelatorioPdf,
  type FiltrosEnvio,
  type RelatorioEnviavel,
} from "./relatorios-envio";

const log = createLogger("cron-relatorios-programados");

/** Guarda de concorrência em-processo — mesmo padrão do resumo diário. */
let rodando = false;

/** Hora local (0-23) do escritório agora. */
export function horaLocalEm(fusoHorario: string, agora: Date): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", {
      timeZone: fusoHorario,
      hour: "numeric",
      hour12: false,
    }).format(agora);
    return Number(h) % 24;
  } catch {
    return agora.getUTCHours();
  }
}

/** Dia local do escritório (YYYY-MM-DD) — parte da chave de idempotência. */
export function diaLocalEm(fusoHorario: string, agora: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: fusoHorario,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(agora);
  } catch {
    return agora.toISOString().slice(0, 10);
  }
}

/**
 * Um agendamento vence agora? Compara hora e, conforme a frequência, o dia
 * da semana ou do mês — tudo no fuso do escritório.
 */
export function venceAgora(
  prog: Pick<RelatorioProgramado, "frequencia" | "diaSemana" | "diaMes" | "hora" | "ativo">,
  fusoHorario: string,
  agora: Date,
): boolean {
  if (!prog.ativo) return false;
  if (horaLocalEm(fusoHorario, agora) !== prog.hora) return false;
  const dia = diaLocalEm(fusoHorario, agora);
  if (prog.frequencia === "diaria") return true;
  if (prog.frequencia === "mensal") return Number(dia.slice(8, 10)) === prog.diaMes;
  // Meio-dia UTC evita que a conversão de fuso empurre a data pro dia vizinho.
  const diaSemana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return diaSemana === prog.diaSemana;
}

/** Janela do relatório: `janelaDias` contados pra trás a partir do dia local. */
export function janelaDoEnvio(diaRef: string, janelaDias: number): {
  dataInicio: string;
  dataFim: string;
} {
  const DIA = 24 * 60 * 60 * 1000;
  const fim = Date.parse(`${diaRef}T12:00:00Z`);
  // O dia do disparo não fecha ainda; a janela termina no dia anterior.
  const fimReal = fim - DIA;
  const inicio = fimReal - (janelaDias - 1) * DIA;
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { dataInicio: ymd(inicio), dataFim: ymd(fimReal) };
}

const relatoriosCompleto = mergeRouters(relatoriosRouter, relatoriosPdfRouter);
const chamarRelatorios = createCallerFactory(relatoriosCompleto);

export async function rodarRelatoriosProgramados(): Promise<{ disparados: number }> {
  if (rodando) {
    log.info("tick sobreposto ignorado");
    return { disparados: 0 };
  }
  rodando = true;

  try {
    const db = await getDb();
    if (!db) return { disparados: 0 };

    const ativos = await db
      .select()
      .from(relatoriosProgramados)
      .where(eq(relatoriosProgramados.ativo, true));
    if (ativos.length === 0) return { disparados: 0 };

    const escIds = [...new Set(ativos.map((p) => p.escritorioId))];
    const escs = await db
      .select({
        id: escritorios.id,
        nome: escritorios.nome,
        ownerId: escritorios.ownerId,
        fusoHorario: escritorios.fusoHorario,
      })
      .from(escritorios)
      .where(inArray(escritorios.id, escIds));
    const porEscritorio = new Map(escs.map((e) => [e.id, e]));

    const agora = new Date();
    const vencendo = ativos.filter((p) => {
      const esc = porEscritorio.get(p.escritorioId);
      return !!esc && venceAgora(p, esc.fusoHorario, agora);
    });
    if (vencendo.length === 0) return { disparados: 0 };

    // Donos em lote — o relatório é gerado COMO o dono, que é quem enxerga o
    // escritório inteiro. `salvarProgramado` já exige verTodos pra criar.
    const donos = await db
      .select()
      .from(users)
      .where(inArray(users.id, [...new Set(vencendo.map((p) => porEscritorio.get(p.escritorioId)!.ownerId))]));
    const porUserId = new Map(donos.map((d) => [d.id, d]));

    let disparados = 0;
    for (const prog of vencendo) {
      const esc = porEscritorio.get(prog.escritorioId)!;
      const diaRef = diaLocalEm(esc.fusoHorario, agora);

      // Reserva o slot ANTES de gerar: o INSERT falha por UNIQUE se outro
      // tick já pegou este agendamento hoje, e aí ninguém recebe duplicado.
      try {
        await db.insert(relatoriosProgramadosEnvios).values({
          programadoId: prog.id,
          escritorioId: prog.escritorioId,
          dataRef: diaRef,
          status: "falha",
          destinatarios: prog.destinatarios,
          erro: "em andamento",
        });
      } catch {
        continue; // já disparado hoje
      }

      const gravar = async (
        status: "enviado" | "falha" | "parcial" | "sem_dados",
        erro?: string,
      ) => {
        await db
          .update(relatoriosProgramadosEnvios)
          .set({ status, erro: erro?.slice(0, 500) ?? null })
          .where(
            and(
              eq(relatoriosProgramadosEnvios.programadoId, prog.id),
              eq(relatoriosProgramadosEnvios.dataRef, diaRef),
            ),
          );
        await db
          .update(relatoriosProgramados)
          .set({
            ultimoEnvioEm: new Date(),
            ultimoStatus: status === "enviado" ? "enviado" : status === "parcial" ? "parcial" : "falha",
            ultimoErro: erro?.slice(0, 500) ?? null,
          })
          .where(eq(relatoriosProgramados.id, prog.id));
      };

      try {
        const dono = porUserId.get(esc.ownerId);
        if (!dono) {
          await gravar("falha", "Dono do escritório não encontrado.");
          continue;
        }
        const janela = janelaDoEnvio(diaRef, prog.janelaDias);
        const filtros: FiltrosEnvio = {
          ...(prog.filtros ? JSON.parse(prog.filtros) : {}),
          ...janela,
        };
        const caller = chamarRelatorios({ req: {} as any, res: {} as any, user: dono });
        const gerado = await gerarRelatorioPdf({
          relatorio: prog.relatorio as RelatorioEnviavel,
          filtros,
          nomeEscritorio: esc.nome,
          escritorioId: esc.id,
          chamar: (proc, arg) => (caller as any)[proc](arg),
        });
        if (!gerado) {
          await gravar("sem_dados", "Sem dados para o período.");
          continue;
        }

        const destinatarios = prog.destinatarios.split(",").filter(Boolean);
        const falhas: string[] = [];
        for (const destinatario of destinatarios) {
          const r = await enviarRelatorio({
            relatorio: prog.relatorio as RelatorioEnviavel,
            gerado,
            destinatario,
            nomeEscritorio: esc.nome,
            escritorioId: esc.id,
            userId: dono.id,
            programado: true,
          });
          if (!r.success) falhas.push(`${destinatario}: ${r.error ?? "erro"}`);
        }

        if (falhas.length === 0) await gravar("enviado");
        else if (falhas.length < destinatarios.length) await gravar("parcial", falhas.join(" | "));
        else await gravar("falha", falhas.join(" | "));
        disparados++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ programadoId: prog.id, err: msg }, "falha ao disparar relatório programado");
        await gravar("falha", msg);
      }
    }

    if (disparados > 0) log.info({ disparados }, "relatórios programados disparados");
    return { disparados };
  } finally {
    rodando = false;
  }
}
