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
  prazosSugeridos,
} from "../../drizzle/schema";
import { recuperarSessao } from "../escritorio/cofre-helpers";
import { consultarTjce, consultarTjcePorCpf } from "./adapters/pje-tjce";
import { CUSTOS } from "../routers/processos";
import { createLogger } from "../_core/logger";
import { emitirNotificacao } from "../_core/sse-notifications";
import { detectarSugestaoPrazo } from "./detector-prazos";

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

export function hashEvento(componentes: string[]): string {
  return crypto
    .createHash("sha256")
    .update(componentes.join("|"))
    .digest("hex");
}

/**
 * Pollar UM monitoramento de movimentações.
 *
 * Extraído de `pollMonitoramentosMovs` pra permitir reuso pelo
 * `atualizarTodosMonitoramentos` (botão "Atualizar todos" sob demanda).
 * O cron continua iterando por todos os pendentes e chamando essa função
 * por monitor — comportamento idêntico ao anterior.
 *
 * @returns Sumário do que aconteceu: ok=true se concluiu (mesmo se sem
 *   mudanças); ok=false quando deu erro de credencial/scraper. `detectadas`
 *   conta movs novas (zero em baseline e quando sem mudança).
 */
export async function pollarUmMonitoramentoMovs(
  mon: typeof motorMonitoramentos.$inferSelect,
): Promise<{ ok: boolean; detectadas: number; erro?: string; baseline?: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false, detectadas: 0, erro: "DB indisponível" };

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
      return { ok: false, detectadas: 0, erro: "Credencial não vinculada" };
    }

    const sessao = await recuperarSessao(mon.credencialId, { tentarRelogin: true });
    if (!sessao) {
      await db
        .update(motorMonitoramentos)
        .set({
          status: "erro",
          ultimoErro: "Sessão expirada — revalide a credencial",
          ultimaConsultaEm: new Date(),
        })
        .where(eq(motorMonitoramentos.id, mon.id));
      return { ok: false, detectadas: 0, erro: "Sessão expirada" };
    }

    let resultado;
    if (mon.tribunal === "tjce") {
      resultado = await consultarTjce(mon.searchKey, sessao);
    } else {
      log.warn(
        { tribunal: mon.tribunal, monId: mon.id },
        "[motor-cron] tribunal sem adapter",
      );
      return { ok: false, detectadas: 0, erro: `Tribunal ${mon.tribunal} sem adapter` };
    }

    if (!resultado.ok) {
      await db
        .update(motorMonitoramentos)
        .set({
          ultimaConsultaEm: new Date(),
          ultimoErro: resultado.mensagemErro ?? "Erro na consulta",
        })
        .where(eq(motorMonitoramentos.id, mon.id));
      return { ok: false, detectadas: 0, erro: resultado.mensagemErro ?? "Erro na consulta" };
    }

    const novoHash = hashMovimentacoes(resultado.movimentacoes);
    const isPrimeiraExecucao = !mon.hashUltimasMovs;
    // Capa + partes vêm de graça em todo consultarTjce. Persistir
    // aqui evita o user pagar 1 cred no botão "Histórico" só pra ver
    // dados que já chegaram. Auto-cura `status="ativo"` cobre o caso
    // de monitoramento que foi marcado como "erro" e voltou a funcionar.
    const capaJson = resultado.capa ? JSON.stringify(resultado.capa) : null;
    const partesJson = resultado.capa?.partes
      ? JSON.stringify(resultado.capa.partes)
      : null;

    if (isPrimeiraExecucao) {
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
        } catch (err) {
          const errAny = err as any;
          const isDedup =
            errAny?.cause?.code === "ER_DUP_ENTRY" ||
            errAny?.cause?.errno === 1062;
          if (!isDedup) {
            log.warn(
              { err: err instanceof Error ? err.message : String(err), monId: mon.id, cnj: mon.searchKey },
              "[motor-cron] baseline INSERT eventoProcesso falhou (não-dedup)",
            );
          }
        }
      }
      const ultimaMov = resultado.movimentacoes[0];
      await db
        .update(motorMonitoramentos)
        .set({
          hashUltimasMovs: novoHash,
          ultimaMovimentacaoEm: ultimaMov ? new Date(ultimaMov.data) : null,
          ultimaMovimentacaoTexto: ultimaMov?.texto.slice(0, 500) ?? null,
          capaJson,
          partesJson,
          status: "ativo",
          ultimaConsultaEm: new Date(),
          ultimoErro: null,
        })
        .where(eq(motorMonitoramentos.id, mon.id));
      log.info({ monId: mon.id, baseline: resultado.movimentacoes.length }, "[motor-cron] baseline silencioso registrado");
      return { ok: true, detectadas: 0, baseline: true };
    }

    const houveMudanca = novoHash !== mon.hashUltimasMovs;
    let detectadasMon = 0;

    if (houveMudanca) {
      const movsNovas: Array<{
        mov: typeof resultado.movimentacoes[number];
        eventoId: number;
      }> = [];
      for (const mov of resultado.movimentacoes) {
        const dedup = hashEvento([
          "movimentacao",
          mon.searchKey,
          mov.data,
          mov.texto.slice(0, 200),
        ]);
        try {
          const [result] = await db.insert(eventosProcesso).values({
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
          const eventoId = (result as { insertId: number }).insertId;
          movsNovas.push({ mov, eventoId });

          // Detecta sugestão de prazo na mov (audiência/prazo
          // processual). UNIQUE em evento_id garante idempotência —
          // se cron re-rodar, INSERT falha silenciosamente.
          const sugestao = detectarSugestaoPrazo(mov.texto, {
            dataEvento: new Date(mov.data),
          });
          if (sugestao) {
            try {
              await db.insert(prazosSugeridos).values({
                escritorioId: mon.escritorioId,
                eventoId,
                monitoramentoId: mon.id,
                tipo: sugestao.tipo,
                titulo: sugestao.titulo,
                dataSugerida: sugestao.dataSugerida,
                prazoDias: sugestao.prazoDias,
                prazoUteis: sugestao.prazoUteis ?? false,
                motivo: sugestao.motivo,
                trechoOrigem: sugestao.trechoOrigem,
                cnjAfetado: mon.searchKey,
                status: "pendente",
              });
              log.info(
                { monId: mon.id, eventoId, tipo: sugestao.tipo, titulo: sugestao.titulo },
                "[motor-cron] sugestão de prazo detectada",
              );
            } catch (errSug) {
              const errAny = errSug as any;
              const isDup = errAny?.cause?.code === "ER_DUP_ENTRY" || errAny?.cause?.errno === 1062;
              if (!isDup) {
                log.warn(
                  { eventoId, err: errSug instanceof Error ? errSug.message : String(errSug) },
                  "[motor-cron] INSERT prazo sugerido falhou (não-dedup)",
                );
              }
            }
          }
        } catch (err) {
          const errAny = err as any;
          const isDedup =
            errAny?.cause?.code === "ER_DUP_ENTRY" ||
            errAny?.cause?.errno === 1062;
          if (!isDedup) {
            log.warn(
              { err: err instanceof Error ? err.message : String(err), monId: mon.id, cnj: mon.searchKey },
              "[motor-cron] poll INSERT eventoProcesso falhou (não-dedup)",
            );
          }
        }
      }

      if (movsNovas.length > 0) {
        const ultimaMov = resultado.movimentacoes[0];
        await db
          .update(motorMonitoramentos)
          .set({
            hashUltimasMovs: novoHash,
            ultimaMovimentacaoEm: new Date(ultimaMov.data),
            ultimaMovimentacaoTexto: ultimaMov.texto.slice(0, 500),
            totalAtualizacoes: mon.totalAtualizacoes + movsNovas.length,
            capaJson,
            partesJson,
            status: "ativo",
            ultimaConsultaEm: new Date(),
            ultimoErro: null,
          })
          .where(eq(motorMonitoramentos.id, mon.id));

        for (const { mov, eventoId } of movsNovas.slice(0, 3)) {
          await db.insert(notificacoes).values({
            userId: mon.criadoPor,
            titulo: `Nova movimentação: ${mon.apelido ?? mon.searchKey}`,
            mensagem: mov.texto.slice(0, 200),
            tipo: "movimentacao",
            eventoId,
          });
        }

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

        detectadasMon = movsNovas.length;
      } else {
        await db
          .update(motorMonitoramentos)
          .set({
            hashUltimasMovs: novoHash,
            capaJson,
            partesJson,
            status: "ativo",
            ultimaConsultaEm: new Date(),
            ultimoErro: null,
          })
          .where(eq(motorMonitoramentos.id, mon.id));
      }
    } else {
      await db
        .update(motorMonitoramentos)
        .set({
          capaJson,
          partesJson,
          status: "ativo",
          ultimaConsultaEm: new Date(),
          ultimoErro: null,
        })
        .where(eq(motorMonitoramentos.id, mon.id));
    }

    return { ok: true, detectadas: detectadasMon };
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
    return { ok: false, detectadas: 0, erro: msg };
  }
}

export async function pollMonitoramentosMovs(): Promise<void> {
  const db = await getDb();
  if (!db) return;

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

  log.info({ total: pendentes.length }, "[motor-cron] poll movimentações iniciado");

  let detectadas = 0;
  let erros = 0;
  for (const mon of pendentes) {
    const r = await pollarUmMonitoramentoMovs(mon);
    detectadas += r.detectadas;
    if (!r.ok) erros++;
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
/**
 * Pollar UM monitoramento de novas ações (CPF/CNPJ).
 *
 * Mesma estratégia de `pollarUmMonitoramentoMovs`: extraído pra reuso
 * do botão "Atualizar todos". Cron itera e chama por monitor.
 */
export async function pollarUmMonitoramentoNovasAcoes(
  mon: typeof motorMonitoramentos.$inferSelect,
): Promise<{ ok: boolean; detectadas: number; erro?: string; baseline?: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false, detectadas: 0, erro: "DB indisponível" };

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
      return { ok: false, detectadas: 0, erro: "Credencial não vinculada" };
    }

    const sessao = await recuperarSessao(mon.credencialId, { tentarRelogin: true });
    if (!sessao) {
      await db
        .update(motorMonitoramentos)
        .set({
          status: "erro",
          ultimoErro: "Sessão expirada — revalide a credencial",
          ultimaConsultaEm: new Date(),
        })
        .where(eq(motorMonitoramentos.id, mon.id));
      return { ok: false, detectadas: 0, erro: "Sessão expirada" };
    }

    let resultado;
    if (mon.tribunal === "tjce") {
      resultado = await consultarTjcePorCpf(mon.searchKey, sessao);
    } else {
      return { ok: false, detectadas: 0, erro: `Tribunal ${mon.tribunal} sem adapter de CPF` };
    }

    if (!resultado.ok) {
      await db
        .update(motorMonitoramentos)
        .set({
          ultimaConsultaEm: new Date(),
          ultimoErro: resultado.mensagemErro ?? "Erro na consulta CPF",
        })
        .where(eq(motorMonitoramentos.id, mon.id));
      return { ok: false, detectadas: 0, erro: resultado.mensagemErro ?? "Erro na consulta CPF" };
    }

    const cnjsConhecidos: string[] = mon.cnjsConhecidos
      ? (JSON.parse(mon.cnjsConhecidos) as string[])
      : [];
    const isPrimeiraExecucao = cnjsConhecidos.length === 0;
    const cnjsNovos = resultado.cnjs.filter((c) => !cnjsConhecidos.includes(c));

    if (isPrimeiraExecucao) {
      for (const cnj of resultado.cnjs) {
        const dedup = hashEvento(["nova_acao", String(mon.id), cnj]);
        try {
          await db.insert(eventosProcesso).values({
            monitoramentoId: mon.id,
            escritorioId: mon.escritorioId,
            tipo: "nova_acao",
            dataEvento: new Date(),
            fonte: "pje",
            conteudo: `Baseline: ${cnj} contra ${mon.apelido ?? mon.searchKey}`,
            conteudoJson: JSON.stringify({
              cnj,
              baseline: true,
              searchKey: mon.searchKey,
              searchType: mon.searchType,
              tribunal: mon.tribunal,
            }),
            cnjAfetado: cnj,
            hashDedup: dedup,
            lido: true,
          });
        } catch (err) {
          const errAny = err as any;
          const isDedup =
            errAny?.cause?.code === "ER_DUP_ENTRY" ||
            errAny?.cause?.errno === 1062;
          if (!isDedup) {
            log.warn(
              { err: err instanceof Error ? err.message : String(err), monId: mon.id, cnj },
              "[motor-cron] baseline novas_acoes INSERT falhou (não-dedup)",
            );
          }
        }
      }
      await db
        .update(motorMonitoramentos)
        .set({
          cnjsConhecidos: JSON.stringify(resultado.cnjs),
          ultimaConsultaEm: new Date(),
          ultimoErro: null,
        })
        .where(eq(motorMonitoramentos.id, mon.id));
      log.info({ monId: mon.id, baseline: resultado.cnjs.length }, "[motor-cron] baseline silencioso de novas ações registrado");
      return { ok: true, detectadas: 0, baseline: true };
    }

    if (cnjsNovos.length > 0) {
      // Filtro por data de cadastro do cliente: pra cada CNJ NOVO, busca
      // `dataDistribuicao` via detail scrape e compara com
      // `dataReferenciaCadastro`. CNJs ajuizados ANTES do cliente entrar
      // no escritório viram baseline silencioso (lido=true, sem alerta).
      // Sem detail scrape (NULL = sem filtro), todos viram alerta.
      const dataRef = mon.dataReferenciaCadastro;
      const cnjsRelevantes: string[] = [];
      const cnjsAntigos: string[] = [];

      for (const cnj of cnjsNovos) {
        let isRelevante = true;
        let dataDistribuicao: Date | null = null;

        if (dataRef) {
          // Detail scrape custa ~15-30s. Aceita pq são poucos CNJs novos
          // por poll (1-5/mês típico). Se falhar, assume relevante
          // (better safe than sorry — false positive é menos pior que
          // perder uma ação real).
          try {
            const detalhe = await consultarTjce(cnj, sessao);
            if (detalhe.ok && detalhe.capa?.dataDistribuicao) {
              dataDistribuicao = new Date(detalhe.capa.dataDistribuicao);
              if (!Number.isNaN(dataDistribuicao.getTime())) {
                isRelevante = dataDistribuicao.getTime() >= new Date(dataRef).getTime();
              }
            }
          } catch (err) {
            log.warn(
              {
                monId: mon.id,
                cnj,
                err: err instanceof Error ? err.message : String(err),
              },
              "[motor-cron] detail scrape pra filtro de data falhou — tratando como relevante",
            );
          }
        }

        const dedup = hashEvento(["nova_acao", String(mon.id), cnj]);
        try {
          await db.insert(eventosProcesso).values({
            monitoramentoId: mon.id,
            escritorioId: mon.escritorioId,
            tipo: "nova_acao",
            dataEvento: dataDistribuicao ?? new Date(),
            fonte: "pje",
            conteudo: isRelevante
              ? `Nova ação detectada: ${cnj} contra ${mon.apelido ?? mon.searchKey}`
              : `Baseline antigo (anterior ao cadastro): ${cnj}`,
            conteudoJson: JSON.stringify({
              cnj,
              dataDistribuicao: dataDistribuicao?.toISOString() ?? null,
              filtradoPorData: dataRef && !isRelevante,
              searchKey: mon.searchKey,
              searchType: mon.searchType,
              tribunal: mon.tribunal,
            }),
            cnjAfetado: cnj,
            hashDedup: dedup,
            lido: !isRelevante, // antigo já entra lido (sem alerta)
          });
        } catch {
          /* duplicate hashDedup → ignora */
        }

        if (isRelevante) cnjsRelevantes.push(cnj);
        else cnjsAntigos.push(cnj);
      }

      const todosCnjs = [...cnjsConhecidos, ...cnjsNovos];
      await db
        .update(motorMonitoramentos)
        .set({
          cnjsConhecidos: JSON.stringify(todosCnjs),
          totalNovasAcoes: mon.totalNovasAcoes + cnjsRelevantes.length,
          ultimaConsultaEm: new Date(),
          ultimoErro: null,
        })
        .where(eq(motorMonitoramentos.id, mon.id));

      if (cnjsAntigos.length > 0) {
        log.info(
          { monId: mon.id, cnjsAntigos: cnjsAntigos.length, dataRef: dataRef?.toISOString() },
          "[motor-cron] CNJs filtrados por data de cadastro (baseline silencioso)",
        );
      }

      // Notif + SSE só para CNJs realmente relevantes (depois da data
      // de cadastro). Antigos ficam acessíveis no histórico mas não
      // alertam.
      if (cnjsRelevantes.length > 0) {
        try {
          await db.insert(notificacoes).values({
            userId: mon.criadoPor,
            titulo: `${cnjsRelevantes.length} nova(s) ação(ões) detectada(s)`,
            mensagem: `${mon.apelido ?? mon.searchKey}: ${cnjsRelevantes.slice(0, 3).join(", ")}${cnjsRelevantes.length > 3 ? "..." : ""}`,
            tipo: "nova_acao",
          });
        } catch {
          /* best-effort */
        }

        emitirNotificacao(mon.criadoPor, {
          tipo: "nova_acao",
          titulo: "Nova ação detectada",
          mensagem: `${cnjsRelevantes.length} processo(s) novo(s) contra ${mon.apelido ?? mon.searchKey}`,
          dados: {
            monitoramentoId: mon.id,
            cnjsNovos: cnjsRelevantes,
          },
        });
      }

      return { ok: true, detectadas: cnjsRelevantes.length };
    }

    await db
      .update(motorMonitoramentos)
      .set({ ultimaConsultaEm: new Date(), ultimoErro: null })
      .where(eq(motorMonitoramentos.id, mon.id));
    return { ok: true, detectadas: 0 };
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
    return { ok: false, detectadas: 0, erro: msg };
  }
}

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

  log.info({ total: pendentes.length }, "[motor-cron] poll novas ações iniciado");

  let detectadas = 0;
  let erros = 0;
  for (const mon of pendentes) {
    const r = await pollarUmMonitoramentoNovasAcoes(mon);
    detectadas += r.detectadas;
    if (!r.ok) erros++;
  }

  log.info(
    { total: pendentes.length, detectadas, erros },
    "[motor-cron] poll novas ações concluído",
  );
}
