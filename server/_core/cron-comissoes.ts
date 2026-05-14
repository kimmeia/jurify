/**
 * Cron worker de lançamento automático de comissões.
 *
 * Roda a cada 15 minutos. Pra cada `comissoes_agenda` ativa:
 *  1. Calcula "agora" no fuso do escritório
 *  2. Verifica se o gatilho (dia + hora local) já passou hoje
 *  3. Se sim, calcula período (mês_anterior calendário) e lista
 *     atendentes do escritório que tenham cobranças pagas nesse período
 *  4. Pra cada atendente, reserva execução no log (UNIQUE constraint
 *     impede duplicação) e dispara `fecharComissao`
 *  5. Notifica gestor (insere em `notificacoes`) sempre que rodar
 *     (sucesso ou falha)
 *
 * Idempotência: a UNIQUE em `comissoes_lancamentos_log` impede que
 * mesmo período seja fechado 2x. Se o servidor restart no meio, o
 * próximo tick reaproveita execuções `falhou` mas não reaproveita
 * `concluido` ou `em_andamento`.
 */

import { getDb } from "../db";
import {
  comissoesAgenda,
  comissoesLancamentosLog,
  escritorios,
  asaasCobrancas,
  notificacoes,
  colaboradores,
  users,
} from "../../drizzle/schema";
import { and, eq, inArray, between, isNotNull } from "drizzle-orm";
import {
  carregarRegraComissao,
  fecharComissao,
  FechamentoJaExisteError,
  marcarExecucaoConcluida,
  marcarExecucaoFalhou,
  periodoMesAnterior,
  reservarExecucao,
} from "../escritorio/db-comissoes";
import { createLogger } from "./logger";

const log = createLogger("cron-comissoes");

const STATUS_PAGOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

/** Retorna a hora atual no fuso `tz` como `{ ano, mes, dia, hora, minuto }`.
 *  Usa `Intl.DateTimeFormat` (sem libs externas). */
function agoraNoFuso(tz: string): {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  ultimoDiaDoMes: number;
} {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const partes = fmt.formatToParts(now);
  const get = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const ano = get("year");
  const mes = get("month");
  const dia = get("day");
  let hora = get("hour");
  // Intl às vezes retorna 24 (meia-noite "do dia seguinte" antes do reset)
  if (hora === 24) hora = 0;
  const minuto = get("minute");
  // Último dia do mês corrente (pra ajustar diaDoMes=31 em fev/etc)
  const ultimoDiaDoMes = new Date(ano, mes, 0).getDate();
  return { ano, mes, dia, hora, minuto, ultimoDiaDoMes };
}

/** Decide se a agenda deve disparar AGORA. Regra: o gatilho é "dia X
 *  do mês às HH:MM" no fuso local. Se a hora local atual já passou
 *  desse ponto E ainda não rodou hoje (verificado depois pelo log),
 *  dispara. Pra `diaDoMes > ultimoDiaDoMes` (ex: 31 em fev), usa o
 *  último dia. */
function devesDispararAgora(
  agenda: { diaDoMes: number; horaLocal: string },
  agora: ReturnType<typeof agoraNoFuso>,
): boolean {
  const diaEfetivo = Math.min(agenda.diaDoMes, agora.ultimoDiaDoMes);
  if (agora.dia < diaEfetivo) return false;
  if (agora.dia > diaEfetivo) {
    // Já passou do dia — só dispara se ainda não rodou neste mês.
    // O log com chave única por período garante isso (período é o mesmo
    // o mês inteiro).
    return true;
  }
  // Mesmo dia: compara hora
  const [hh, mm] = agenda.horaLocal.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return false;
  if (agora.hora > hh) return true;
  if (agora.hora < hh) return false;
  return agora.minuto >= mm;
}

interface AtendenteComCobrancas {
  id: number;
  userId: number | null;
  userName: string | null;
}

/** Lista atendentes do escritório que TÊM cobranças pagas no período. */
async function listarAtendentesComCobrancas(
  escritorioId: number,
  periodoInicio: string,
  periodoFim: string,
): Promise<AtendenteComCobrancas[]> {
  const db = await getDb();
  if (!db) return [];

  const cobrancas = await db
    .selectDistinct({ atendenteId: asaasCobrancas.atendenteId })
    .from(asaasCobrancas)
    .where(
      and(
        eq(asaasCobrancas.escritorioId, escritorioId),
        isNotNull(asaasCobrancas.atendenteId),
        inArray(asaasCobrancas.status, STATUS_PAGOS),
        between(asaasCobrancas.dataPagamento, periodoInicio, periodoFim),
      ),
    );

  const ids = cobrancas
    .map((c) => c.atendenteId)
    .filter((x): x is number => x != null);

  if (ids.length === 0) return [];

  return db
    .select({
      id: colaboradores.id,
      userId: colaboradores.userId,
      userName: users.name,
    })
    .from(colaboradores)
    .leftJoin(users, eq(users.id, colaboradores.userId))
    .where(
      and(eq(colaboradores.escritorioId, escritorioId), inArray(colaboradores.id, ids)),
    );
}

/** Quem deve receber a notificação? Dono + gestores do escritório. */
export async function listarDestinatariosNotificacao(escritorioId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ userId: colaboradores.userId })
    .from(colaboradores)
    .where(
      and(
        eq(colaboradores.escritorioId, escritorioId),
        eq(colaboradores.ativo, true),
        inArray(colaboradores.cargo, ["dono", "gestor"]),
      ),
    );
  return rows.map((r) => r.userId).filter((id): id is number => id != null);
}

async function notificar(
  escritorioId: number,
  titulo: string,
  mensagem: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const dests = await listarDestinatariosNotificacao(escritorioId);
  if (dests.length === 0) return;
  await db.insert(notificacoes).values(
    dests.map((userId) => ({
      userId,
      titulo,
      mensagem,
      tipo: "sistema" as const,
    })),
  );
}

/** Processa todas as agendas ativas. Tolerante a falhas — exception em
 *  uma agenda não impede as outras. */
export async function processarAgendasComissao(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  let agendas: Array<{
    id: number;
    escritorioId: number;
    diaDoMes: number;
    horaLocal: string;
    fusoHorario: string;
  }> = [];
  try {
    agendas = await db
      .select({
        id: comissoesAgenda.id,
        escritorioId: comissoesAgenda.escritorioId,
        diaDoMes: comissoesAgenda.diaDoMes,
        horaLocal: comissoesAgenda.horaLocal,
        fusoHorario: escritorios.fusoHorario,
      })
      .from(comissoesAgenda)
      .innerJoin(escritorios, eq(escritorios.id, comissoesAgenda.escritorioId))
      .where(eq(comissoesAgenda.ativo, true));
  } catch (err: any) {
    // Tabela ainda não existe (migration não rodou) — sai silencioso
    log.warn({ err: err.message }, "Tabela comissoes_agenda indisponível, skip");
    return;
  }

  for (const agenda of agendas) {
    try {
      const agora = agoraNoFuso(agenda.fusoHorario || "America/Sao_Paulo");
      if (!devesDispararAgora(agenda, agora)) continue;

      // Calcula período (mês anterior calendário)
      const refDate = new Date(agora.ano, agora.mes - 1, agora.dia);
      const { inicio, fim } = periodoMesAnterior(refDate);

      const atendentes = await listarAtendentesComCobrancas(
        agenda.escritorioId,
        inicio,
        fim,
      );

      let fechadosOk = 0;
      let fechadosFalha = 0;
      let puladosManual = 0;

      // Pega o dono do escritório como "fechadoPorUserId" (auditoria)
      const [donoRow] = await db
        .select({ userId: colaboradores.userId })
        .from(colaboradores)
        .where(
          and(
            eq(colaboradores.escritorioId, agenda.escritorioId),
            eq(colaboradores.cargo, "dono"),
          ),
        )
        .limit(1);
      const fechadoPorUserId = donoRow?.userId;
      if (!fechadoPorUserId) {
        log.warn(
          { escritorioId: agenda.escritorioId },
          "Escritório sem dono encontrado, skip agenda",
        );
        continue;
      }

      // Carrega a regra UMA vez por escritório e repassa pra cada
      // fechamento — sem isso, `simularComissao` rele a regra+faixas a
      // cada atendente (queries idempotentes mas desnecessárias em
      // escritórios grandes com 50+ atendentes/mês).
      const regraCarregada = await carregarRegraComissao(agenda.escritorioId);

      for (const at of atendentes) {
        const logId = await reservarExecucao({
          escritorioId: agenda.escritorioId,
          agendaId: agenda.id,
          atendenteId: at.id,
          periodoInicio: inicio,
          periodoFim: fim,
        });
        if (!logId) continue; // já rodou (concluído ou em andamento)

        // Dedup cross-origem é responsabilidade de `fecharComissao`
        // (lança `FechamentoJaExisteError` quando já existe). Aqui
        // captamos pra apontar o log pro existente e contar como
        // pulado (não é falha).
        try {
          const r = await fecharComissao({
            escritorioId: agenda.escritorioId,
            atendenteId: at.id,
            periodoInicio: inicio,
            periodoFim: fim,
            fechadoPorUserId,
            origem: "automatico",
            agendaId: agenda.id,
            regraCarregada,
          });
          await marcarExecucaoConcluida(logId, r.id);
          fechadosOk += 1;
          log.info(
            {
              escritorioId: agenda.escritorioId,
              atendenteId: at.id,
              periodo: `${inicio}..${fim}`,
              comissaoFechadaId: r.id,
              valor: r.totais.valorComissao,
            },
            "Comissão fechada automaticamente",
          );
        } catch (err: any) {
          if (err instanceof FechamentoJaExisteError) {
            await marcarExecucaoConcluida(logId, err.comissaoFechadaId);
            puladosManual += 1;
            log.info(
              {
                escritorioId: agenda.escritorioId,
                atendenteId: at.id,
                periodo: `${inicio}..${fim}`,
                comissaoFechadaId: err.comissaoFechadaId,
                origemExistente: err.origem,
              },
              "Já existe fechamento pro período, skip",
            );
            continue;
          }
          await marcarExecucaoFalhou(logId, err.message || "Erro desconhecido");
          fechadosFalha += 1;
          log.error(
            { err: err.message, escritorioId: agenda.escritorioId, atendenteId: at.id },
            "Falha ao fechar comissão automática",
          );
        }
      }

      // Notifica só se houve algo (sucesso, falha, ou rodou e não tinha
      // ninguém pra fechar). Quando atendentes=[] ainda assim notifica
      // pra dar feedback de que o cron rodou.
      if (atendentes.length === 0 && fechadosOk + fechadosFalha + puladosManual === 0) {
        // Mesmo assim, marca como "rodou" via log fictício? Não — sem
        // atendente o período fica intocado. Próxima passada vai
        // re-checar (atendente pode ser cadastrado depois).
        continue;
      }

      const titulo =
        fechadosFalha > 0
          ? `⚠ Lançamento de comissões com falhas`
          : `✓ Comissões lançadas automaticamente`;
      const partes: string[] = [];
      if (fechadosOk > 0)
        partes.push(`${fechadosOk} atendente(s) com comissão fechada`);
      if (puladosManual > 0)
        partes.push(`${puladosManual} já tinha(m) fechamento`);
      if (fechadosFalha > 0) partes.push(`${fechadosFalha} falha(s)`);
      const mensagem = `Período ${inicio} a ${fim}: ${partes.join(", ")}.`;
      await notificar(agenda.escritorioId, titulo, mensagem);
    } catch (err: any) {
      log.error(
        { err: err.message, agendaId: agenda.id },
        "Erro ao processar agenda de comissão",
      );
    }
  }
}
