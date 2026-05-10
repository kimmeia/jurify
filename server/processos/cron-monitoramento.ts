/**
 * Crons do motor próprio (Sprint 2 — 08/05/2026):
 *
 *   1. pollMonitoramentosMovs (cada 1h)
 *      Pra cada monitoramento ativo cuja última consulta foi há mais de
 *      `recurrence_horas`, executa adapter (consultarTjce), compara hash
 *      de movs com anterior, INSERT eventos_processo pra movs novas e
 *      dispara notif (sino + SSE).
 *
 *   2. cobrarMonitoramentosMensais (cada 6h)
 *      Pra cada monitoramento ativo cuja última cobrança foi há mais de
 *      30 dias, debita 2 cred (movs) ou 15 cred (novas_acoes). Sem saldo
 *      → pausa monitoramento + notifica.
 *
 *   3. pollMonitoramentosNovasAcoes (Sub-sprint 2.2 — placeholder)
 *      Implementação após adapter consultarPorCpf estar pronto.
 */

import crypto from "node:crypto";
import { eq, and, or, lt, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  motorMonitoramentos,
  eventosProcesso,
  motorCreditos,
  motorTransacoes,
  notificacoes,
} from "../../drizzle/schema";
import { recuperarSessao } from "../escritorio/cofre-helpers";
import { consultarTjce, consultarTjcePorCpf } from "./adapters/pje-tjce";
import { CUSTOS } from "../routers/processos";
import { createLogger } from "../_core/logger";
import { emitirNotificacao } from "../_core/sse-notifications";

const log = createLogger("motor-cron");

/**
 * Hash determinístico das movimentações pra detectar mudanças rápido.
 * Usa só (data + texto) de cada mov pra ignorar variações de
 * formatação/encoding.
 */
function hashMovimentacoes(
  movs: Array<{ data: string; texto: string }>,
): string {
  const concat = movs
    .map((m) => `${m.data}|${m.texto.trim().slice(0, 200)}`)
    .join("\n");
  return crypto.createHash("sha256").update(concat).digest("hex");
}

function hashEvento(componentes: string[]): string {
  return crypto
    .createHash("sha256")
    .update(componentes.join("|"))
    .digest("hex");
}

export async function pollMonitoramentosMovs(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Busca monitoramentos elegíveis pra polling: tipo=movimentacoes,
  // status=ativo, e última consulta há mais que recurrence_horas
  // (ou nunca consultados).
  const pendentes = await db
    .select()
    .from(motorMonitoramentos)
    .where(
      and(
        eq(motorMonitoramentos.tipoMonitoramento, "movimentacoes"),
        eq(motorMonitoramentos.status, "ativo"),
        or(
          isNull(motorMonitoramentos.ultimaConsultaEm),
          lt(
            motorMonitoramentos.ultimaConsultaEm,
            sql`DATE_SUB(NOW(), INTERVAL recurrence_horas HOUR)`,
          ),
        ),
      ),
    );

  if (pendentes.length === 0) return;

  log.info(
    { total: pendentes.length },
    "[motor-cron] poll movimentações iniciado",
  );

  let detectadas = 0;
  let erros = 0;

  for (const mon of pendentes) {
    try {
      if (!mon.credencialId) {
        await db
          .update(motorMonitoramentos)
          .set({
            status: "erro",
            ultimoErro: "Credencial não vinculada",
            ultimaConsultaEm: new Date(),
          })
          .where(eq(motorMonitoramentos.id, mon.id));
        erros++;
        continue;
      }

      const sessao = await recuperarSessao(mon.credencialId);
      if (!sessao) {
        await db
          .update(motorMonitoramentos)
          .set({
            status: "erro",
            ultimoErro: "Sessão expirada — revalide a credencial",
            ultimaConsultaEm: new Date(),
          })
          .where(eq(motorMonitoramentos.id, mon.id));
        erros++;
        continue;
      }

      // Adapter por tribunal (hoje só TJCE)
      let resultado;
      if (mon.tribunal === "tjce") {
        resultado = await consultarTjce(mon.searchKey, sessao);
      } else {
        log.warn(
          { tribunal: mon.tribunal, monId: mon.id },
          "[motor-cron] tribunal sem adapter",
        );
        continue;
      }

      if (!resultado.ok) {
        await db
          .update(motorMonitoramentos)
          .set({
            ultimaConsultaEm: new Date(),
            ultimoErro: resultado.mensagemErro ?? "Erro na consulta",
          })
          .where(eq(motorMonitoramentos.id, mon.id));
        erros++;
        continue;
      }

      const novoHash = hashMovimentacoes(resultado.movimentacoes);
      const isPrimeiraExecucao = !mon.hashUltimasMovs;

      if (isPrimeiraExecucao) {
        // Baseline silencioso: na primeira execução depois do
        // monitoramento ser criado, todas as movs já existentes do
        // processo viriam como "novas" sem este guard — e o usuário
        // veria 6 meses de histórico explodindo no sino.
        //
        // Estratégia: insere os eventos com lido=true (pra ficar
        // disponível no histórico se quiserem consultar) e NÃO cria
        // notif. Próximas execuções comparam contra hashUltimasMovs
        // setado abaixo e só notificam o que aparecer depois.
        for (const mov of resultado.movimentacoes) {
          const dedup = hashEvento([
            "movimentacao",
            mon.searchKey,
            mov.data,
            mov.texto.slice(0, 200),
          ]);
          try {
            await db.insert(eventosProcesso).values({
              monitoramentoId: mon.id,
              escritorioId: mon.escritorioId,
              tipo: "movimentacao",
              dataEvento: new Date(mov.data),
              fonte: "pje",
              conteudo: mov.texto,
              conteudoJson: JSON.stringify(mov),
              cnjAfetado: mon.searchKey,
              hashDedup: dedup,
              lido: true,
            });
          } catch {
            // Duplicate hashDedup: evento já capturado em tentativa
            // anterior do baseline (ex: se o cron crashar no meio).
          }
        }
        const ultimaMov = resultado.movimentacoes[0]; // mais recente
        await db
          .update(motorMonitoramentos)
          .set({
            hashUltimasMovs: novoHash,
            ultimaMovimentacaoEm: ultimaMov ? new Date(ultimaMov.data) : null,
            ultimaMovimentacaoTexto: ultimaMov?.texto.slice(0, 500) ?? null,
            ultimaConsultaEm: new Date(),
            ultimoErro: null,
          })
          .where(eq(motorMonitoramentos.id, mon.id));
        log.info(
          { monId: mon.id, baseline: resultado.movimentacoes.length },
          "[motor-cron] baseline silencioso registrado",
        );
        continue;
      }

      const houveMudanca = novoHash !== mon.hashUltimasMovs;

      if (houveMudanca) {
        // Detecta movs novas: tudo o que não está em eventos_processo
        // ainda. Dedup via hashDedup com ON DUPLICATE.
        const movsNovas: typeof resultado.movimentacoes = [];
        for (const mov of resultado.movimentacoes) {
          const dedup = hashEvento([
            "movimentacao",
            mon.searchKey,
            mov.data,
            mov.texto.slice(0, 200),
          ]);
          // Tenta inserir; se já existe (UNIQUE hashDedup), ignora
          try {
            await db.insert(eventosProcesso).values({
              monitoramentoId: mon.id,
              escritorioId: mon.escritorioId,
              tipo: "movimentacao",
              dataEvento: new Date(mov.data),
              fonte: "pje",
              conteudo: mov.texto,
              conteudoJson: JSON.stringify(mov),
              cnjAfetado: mon.searchKey,
              hashDedup: dedup,
              lido: false,
            });
            movsNovas.push(mov);
          } catch {
            // Duplicate key → mov já capturada antes, ignora
          }
        }

        if (movsNovas.length > 0) {
          // Atualiza monitoramento com nova última mov
          const ultimaMov = resultado.movimentacoes[0]; // mais recente (cronológica decrescente)
          await db
            .update(motorMonitoramentos)
            .set({
              hashUltimasMovs: novoHash,
              ultimaMovimentacaoEm: new Date(ultimaMov.data),
              ultimaMovimentacaoTexto: ultimaMov.texto.slice(0, 500),
              totalAtualizacoes: mon.totalAtualizacoes + movsNovas.length,
              ultimaConsultaEm: new Date(),
              ultimoErro: null,
            })
            .where(eq(motorMonitoramentos.id, mon.id));

          // Notificação in-app
          for (const mov of movsNovas.slice(0, 3)) {
            await db.insert(notificacoes).values({
              userId: mon.criadoPor,
              titulo: `Nova movimentação: ${mon.apelido ?? mon.searchKey}`,
              mensagem: mov.texto.slice(0, 200),
              tipo: "movimentacao",
            });
          }

          // SSE em tempo real
          emitirNotificacao(mon.criadoPor, {
            tipo: "movimentacao_processo",
            titulo: "Nova movimentação",
            mensagem: `${mon.apelido ?? mon.searchKey}: ${ultimaMov.texto.slice(0, 100)}`,
            dados: {
              monitoramentoId: mon.id,
              cnj: mon.searchKey,
              totalNovas: movsNovas.length,
            },
          });

          detectadas += movsNovas.length;
        } else {
          // Hash mudou mas dedup não encontrou movs novas (re-render do PJe?)
          await db
            .update(motorMonitoramentos)
            .set({
              hashUltimasMovs: novoHash,
              ultimaConsultaEm: new Date(),
            })
            .where(eq(motorMonitoramentos.id, mon.id));
        }
      } else {
        // Sem mudança — só atualiza ultimaConsultaEm
        await db
          .update(motorMonitoramentos)
          .set({ ultimaConsultaEm: new Date(), ultimoErro: null })
          .where(eq(motorMonitoramentos.id, mon.id));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ monId: mon.id, err: msg }, "[motor-cron] erro no poll");
      await db
        .update(motorMonitoramentos)
        .set({
          ultimaConsultaEm: new Date(),
          ultimoErro: msg.slice(0, 1000),
        })
        .where(eq(motorMonitoramentos.id, mon.id));
      erros++;
    }
  }

  log.info(
    { total: pendentes.length, detectadas, erros },
    "[motor-cron] poll movimentações concluído",
  );
}

export async function cobrarMonitoramentosMensais(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const pendentes = await db
    .select()
    .from(motorMonitoramentos)
    .where(
      and(
        eq(motorMonitoramentos.status, "ativo"),
        or(
          isNull(motorMonitoramentos.ultimaCobrancaEm),
          lt(motorMonitoramentos.ultimaCobrancaEm, trintaDiasAtras),
        ),
      ),
    );

  if (pendentes.length === 0) return;

  let cobrados = 0;
  let pausados = 0;

  for (const mon of pendentes) {
    const custo =
      mon.tipoMonitoramento === "novas_acoes"
        ? CUSTOS.monitorar_pessoa_mes
        : CUSTOS.monitorar_processo_mes;

    const [cr] = await db
      .select()
      .from(motorCreditos)
      .where(eq(motorCreditos.escritorioId, mon.escritorioId))
      .limit(1);

    const saldo = cr?.saldo ?? 0;
    if (saldo < custo) {
      // Sem saldo → pausa + notifica
      await db
        .update(motorMonitoramentos)
        .set({ status: "pausado" })
        .where(eq(motorMonitoramentos.id, mon.id));

      try {
        await db.insert(notificacoes).values({
          userId: mon.criadoPor,
          titulo: "Monitoramento pausado por falta de créditos",
          mensagem: `"${mon.apelido ?? mon.searchKey}" foi pausado. Saldo: ${saldo}, custo mensal: ${custo}. Recarregue pra reativar.`,
          tipo: "sistema",
        });
      } catch {
        /* best-effort */
      }
      pausados++;
      continue;
    }

    // Cobra
    if (cr) {
      const novoSaldo = saldo - custo;
      await db
        .update(motorCreditos)
        .set({
          saldo: novoSaldo,
          totalConsumido: cr.totalConsumido + custo,
        })
        .where(eq(motorCreditos.id, cr.id));

      await db.insert(motorTransacoes).values({
        escritorioId: mon.escritorioId,
        tipo: "consumo",
        quantidade: custo,
        saldoAnterior: saldo,
        saldoDepois: novoSaldo,
        operacao:
          mon.tipoMonitoramento === "novas_acoes"
            ? "monitorar_pessoa_mes"
            : "monitorar_processo_mes",
        detalhes: `Mensalidade ${mon.apelido ?? mon.searchKey}`,
        userId: mon.criadoPor,
      });

      await db
        .update(motorMonitoramentos)
        .set({ ultimaCobrancaEm: new Date() })
        .where(eq(motorMonitoramentos.id, mon.id));

      cobrados++;
    }
  }

  if (cobrados > 0 || pausados > 0) {
    log.info(
      { cobrados, pausados, total: pendentes.length },
      "[motor-cron] cobrança mensal concluída",
    );
  }
}

/**
 * Cron de poll pra monitoramentos tipo "novas_acoes".
 *
 * Pra cada CPF/CNPJ monitorado: chama consultarTjcePorCpf, compara
 * lista de CNJs com cnjsConhecidos. CNJs que não estão na lista são
 * "novas ações" → INSERT eventos_processo tipo='nova_acao' + notif.
 *
 * Não puxa dados completos do CNJ novo (capa/movs) — só registra que
 * apareceu. User pode clicar e disparar consulta detalhada se quiser.
 */
export async function pollMonitoramentosNovasAcoes(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const pendentes = await db
    .select()
    .from(motorMonitoramentos)
    .where(
      and(
        eq(motorMonitoramentos.tipoMonitoramento, "novas_acoes"),
        eq(motorMonitoramentos.status, "ativo"),
        or(
          isNull(motorMonitoramentos.ultimaConsultaEm),
          lt(
            motorMonitoramentos.ultimaConsultaEm,
            sql`DATE_SUB(NOW(), INTERVAL recurrence_horas HOUR)`,
          ),
        ),
      ),
    );

  if (pendentes.length === 0) return;

  log.info(
    { total: pendentes.length },
    "[motor-cron] poll novas ações iniciado",
  );

  let detectadas = 0;
  let erros = 0;

  for (const mon of pendentes) {
    try {
      if (!mon.credencialId) {
        await db
          .update(motorMonitoramentos)
          .set({
            status: "erro",
            ultimoErro: "Credencial não vinculada",
            ultimaConsultaEm: new Date(),
          })
          .where(eq(motorMonitoramentos.id, mon.id));
        erros++;
        continue;
      }

      const sessao = await recuperarSessao(mon.credencialId);
      if (!sessao) {
        await db
          .update(motorMonitoramentos)
          .set({
            status: "erro",
            ultimoErro: "Sessão expirada — revalide a credencial",
            ultimaConsultaEm: new Date(),
          })
          .where(eq(motorMonitoramentos.id, mon.id));
        erros++;
        continue;
      }

      let resultado;
      if (mon.tribunal === "tjce") {
        resultado = await consultarTjcePorCpf(mon.searchKey, sessao);
      } else {
        log.warn(
          { tribunal: mon.tribunal, monId: mon.id },
          "[motor-cron] tribunal sem adapter de CPF",
        );
        continue;
      }

      if (!resultado.ok) {
        await db
          .update(motorMonitoramentos)
          .set({
            ultimaConsultaEm: new Date(),
            ultimoErro: resultado.mensagemErro ?? "Erro na consulta CPF",
          })
          .where(eq(motorMonitoramentos.id, mon.id));
        erros++;
        continue;
      }

      const cnjsConhecidos: string[] = mon.cnjsConhecidos
        ? (JSON.parse(mon.cnjsConhecidos) as string[])
        : [];
      const cnjsNovos = resultado.cnjs.filter((c) => !cnjsConhecidos.includes(c));

      if (cnjsNovos.length > 0) {
        for (const cnj of cnjsNovos) {
          const dedup = hashEvento(["nova_acao", String(mon.id), cnj]);
          try {
            await db.insert(eventosProcesso).values({
              monitoramentoId: mon.id,
              escritorioId: mon.escritorioId,
              tipo: "nova_acao",
              dataEvento: new Date(),
              fonte: "pje",
              conteudo: `Nova ação detectada: ${cnj} contra ${mon.apelido ?? mon.searchKey}`,
              conteudoJson: JSON.stringify({
                cnj,
                searchKey: mon.searchKey,
                searchType: mon.searchType,
                tribunal: mon.tribunal,
              }),
              cnjAfetado: cnj,
              hashDedup: dedup,
              lido: false,
            });
          } catch {
            /* duplicate hashDedup → ignora */
          }
        }

        const todosCnjs = [...cnjsConhecidos, ...cnjsNovos];
        await db
          .update(motorMonitoramentos)
          .set({
            cnjsConhecidos: JSON.stringify(todosCnjs),
            totalNovasAcoes: mon.totalNovasAcoes + cnjsNovos.length,
            ultimaConsultaEm: new Date(),
            ultimoErro: null,
          })
          .where(eq(motorMonitoramentos.id, mon.id));

        // Notificação in-app + SSE.
        // tipo='nova_acao' (não 'movimentacao'): o contador de
        // "movimentações novas" no dashboard conta só tipo='movimentacao'
        // — misturar inflava o contador com novas ações detectadas (que
        // têm tela própria em /processos?tab=novas-acoes).
        try {
          await db.insert(notificacoes).values({
            userId: mon.criadoPor,
            titulo: `${cnjsNovos.length} nova(s) ação(ões) detectada(s)`,
            mensagem: `${mon.apelido ?? mon.searchKey}: ${cnjsNovos.slice(0, 3).join(", ")}${cnjsNovos.length > 3 ? "..." : ""}`,
            tipo: "nova_acao",
          });
        } catch {
          /* best-effort */
        }

        emitirNotificacao(mon.criadoPor, {
          tipo: "nova_acao",
          titulo: "Nova ação detectada",
          mensagem: `${cnjsNovos.length} processo(s) novo(s) contra ${mon.apelido ?? mon.searchKey}`,
          dados: {
            monitoramentoId: mon.id,
            cnjsNovos,
          },
        });

        detectadas += cnjsNovos.length;
      } else {
        // Primeira execução: armazena baseline de CNJs sem disparar notif
        if (cnjsConhecidos.length === 0 && resultado.cnjs.length > 0) {
          await db
            .update(motorMonitoramentos)
            .set({
              cnjsConhecidos: JSON.stringify(resultado.cnjs),
              ultimaConsultaEm: new Date(),
              ultimoErro: null,
            })
            .where(eq(motorMonitoramentos.id, mon.id));
        } else {
          await db
            .update(motorMonitoramentos)
            .set({ ultimaConsultaEm: new Date(), ultimoErro: null })
            .where(eq(motorMonitoramentos.id, mon.id));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ monId: mon.id, err: msg }, "[motor-cron] erro no poll de CPF");
      await db
        .update(motorMonitoramentos)
        .set({
          ultimaConsultaEm: new Date(),
          ultimoErro: msg.slice(0, 1000),
        })
        .where(eq(motorMonitoramentos.id, mon.id));
      erros++;
    }
  }

  log.info(
    { total: pendentes.length, detectadas, erros },
    "[motor-cron] poll novas ações concluído",
  );
}
