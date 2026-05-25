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
import { detectarSubiuParaSegundoGrau } from "./detectar-grau-recurso";
import { CUSTOS } from "../routers/processos";
import { createLogger } from "../_core/logger";
import { emitirNotificacao } from "../_core/sse-notifications";
import { detectarSugestaoPrazo } from "./detector-prazos";
import {
  identificarPoloDoCliente,
  type PoloIdentificado,
} from "./polo-matcher";
import { extrairAnoCnj } from "./cnj-parser";
import { hashEvento as hashEventoNorm } from "../../scripts/spike-motor-proprio/lib/parser-utils";

/**
 * Idade máxima (em anos) que um CNJ pode ter pra ser considerado "novo"
 * quando o monitoramento não tem `dataReferenciaCadastro` populado.
 *
 * Sem essa salvaguarda, monitoramentos legados (ou de clientes sem data
 * de cadastro) puxam o histórico completo do CPF/CNPJ no PJe — incluindo
 * processos de >10 anos — e cada um vira card "Nova ação detectada".
 *
 * 3 anos cobre o cenário comum (cliente novo no escritório com histórico
 * de litígio recente) sem alertar processos arqueológicos. Quando o
 * cliente TEM data de cadastro, esse fallback nem é usado — usa a data
 * real (regra mais precisa).
 */
const ANOS_MAXIMOS_SEM_DATA_REF = 3;

const log = createLogger("motor-cron");

/**
 * Guardas de concorrência em-processo. O cron dispara via setInterval(60min)
 * sem lock; se um ciclo demora mais que o intervalo (cenário plausível com
 * Playwright + muitos monitoramentos), o próximo tick iniciava EM PARALELO,
 * causando: scrape duplicado do mesmo processo (carga dobrada no tribunal,
 * risco de ban) e corrida no `hashUltimasMovs`/`ultimaConsultaEm`. Estas
 * flags fazem o tick sobreposto ser ignorado até o anterior terminar.
 *
 * Escopo: processo único (a app roda 1 instância). Se um dia escalar
 * horizontalmente, trocar por lock distribuído (Redis NX / advisory lock).
 */
let pollMovsRodando = false;
let pollNovasAcoesRodando = false;

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

/**
 * Hash de dedup de evento. Agora NORMALIZA acento/caixa/espaço (via
 * parser-utils) antes do SHA-256 — antes a versão do cron não normalizava,
 * então a MESMA movimentação re-renderizada pelo PJe com uma diferença
 * cosmética nos 200 primeiros chars (espaço duplo, acento, maiúscula) gerava
 * hash diferente e entrava como "nova" → movimentação + notificação
 * duplicadas. Para componentes sem texto livre (ex: nova_acao =
 * ["nova_acao", monId, cnj]) o resultado é IDÊNTICO ao hash antigo, então só
 * a dedup de `movimentacao` muda de fato.
 */
export function hashEvento(componentes: string[]): string {
  return hashEventoNorm(componentes);
}

/**
 * Como `hashEvento` mudou, os `hashDedup` de movimentações já gravados (sob o
 * hash LEGADO, sem normalização) não batem mais com o hash novo. Sem cuidado,
 * o próximo poll veria todas como "novas" → enxurrada de eventos/notificações.
 *
 * Solução sem migração de dados arriscada: migração PREGUIÇOSA. Ao reprocessar
 * uma movimentação, se já existe um evento sob o hash legado, atualizamos o
 * `hashDedup` dele pro novo e tratamos como já conhecida (não reinsere nem
 * notifica). Depois do 1º reprocessamento de cada processo, tudo fica sob o
 * hash normalizado e o falso-positivo de re-render some — self-healing.
 *
 * @returns `true` se havia registro legado (logo, NÃO é nova).
 */
async function migrarMovLegadaSeExistir(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
  searchKey: string,
  data: string,
  texto: string,
  hashNovo: string,
): Promise<boolean> {
  const hashLegado = crypto
    .createHash("sha256")
    .update(["movimentacao", searchKey, data, texto.slice(0, 200)].join("|"))
    .digest("hex");
  // Texto sem acento/caixa/espaço a normalizar → hash legado == novo, nada a migrar.
  if (hashLegado === hashNovo) return false;
  const [legado] = await db
    .select({ id: eventosProcesso.id })
    .from(eventosProcesso)
    .where(
      and(
        eq(eventosProcesso.escritorioId, escritorioId),
        eq(eventosProcesso.hashDedup, hashLegado),
      ),
    )
    .limit(1);
  if (!legado) return false;
  try {
    await db
      .update(eventosProcesso)
      .set({ hashDedup: hashNovo })
      .where(eq(eventosProcesso.id, legado.id));
  } catch {
    // hashNovo já existe (mesma mov duplicada no legado) → ignora; segue
    // tratando como já conhecida.
  }
  return true;
}

/**
 * Resolve o hash de dedup de uma movimentação e migra preguiçosamente o
 * registro legado, se houver. Centraliza a lógica usada pelo baseline, pelo
 * poll e pelo "Histórico" (buscarProcessoCompleto) pra não divergirem.
 */
export async function resolverDedupMovimentacao(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
  searchKey: string,
  data: string,
  texto: string,
): Promise<{ dedup: string; jaConhecida: boolean }> {
  const dedup = hashEvento(["movimentacao", searchKey, data, texto.slice(0, 200)]);
  const jaConhecida = await migrarMovLegadaSeExistir(
    db,
    escritorioId,
    searchKey,
    data,
    texto,
    dedup,
  );
  return { dedup, jaConhecida };
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

    // Detecção de grau (issue #529): marca se o processo parece ter subido pro
    // 2º grau a partir das movimentações do 1º grau. Update ISOLADO pra não
    // mexer na lógica de dedup/baseline abaixo — só persiste o sinal, pra
    // validar a heurística com dados reais antes de ligar a consulta do 2º grau.
    const deteccaoGrau = detectarSubiuParaSegundoGrau(resultado.movimentacoes);
    await db
      .update(motorMonitoramentos)
      .set({
        subiu2grau: deteccaoGrau.subiu,
        indicios2grau: deteccaoGrau.indicios.length
          ? deteccaoGrau.indicios.join(" | ").slice(0, 1000)
          : null,
      })
      .where(eq(motorMonitoramentos.id, mon.id));

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
        const { dedup, jaConhecida } = await resolverDedupMovimentacao(
          db,
          mon.escritorioId,
          mon.searchKey,
          mov.data,
          mov.texto,
        );
        if (jaConhecida) continue; // já gravada sob hash legado (migrada) — não reinsere
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
        const { dedup, jaConhecida } = await resolverDedupMovimentacao(
          db,
          mon.escritorioId,
          mon.searchKey,
          mov.data,
          mov.texto,
        );
        if (jaConhecida) continue; // já gravada sob hash legado (migrada) — não é nova
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
  if (pollMovsRodando) {
    log.warn("[motor-cron] poll movimentações já em execução — tick ignorado (anti-sobreposição)");
    return;
  }
  pollMovsRodando = true;
  try {
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
  } finally {
    pollMovsRodando = false;
  }
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
      // Pra cada CNJ NOVO, faz detail scrape pra coletar:
      //   1. `partes` (com polo) → silencia se cliente é só polo ativo
      //      (cliente é o AUTOR, não foi processado).
      //   2. `dataDistribuicao` → silencia se ajuizado ANTES do cliente
      //      entrar no escritório (`dataReferenciaCadastro`).
      //
      // Detail scrape custa ~15-30s. Aceita pq CNJs novos são raros
      // (1-5/mês típico). Se o scrape falhar, assume relevante por
      // segurança (FP é menos pior que perder ação real).
      const dataRef = mon.dataReferenciaCadastro;
      const cnjsRelevantes: string[] = [];
      const cnjsSilenciados: Array<{ cnj: string; motivo: "polo_ativo" | "anterior_cadastro" | "cnj_antigo" }> = [];

      for (const cnj of cnjsNovos) {
        let isRelevante = true;
        let motivoSilencio: "polo_ativo" | "anterior_cadastro" | "cnj_antigo" | null = null;
        let dataDistribuicao: Date | null = null;
        let poloDoCliente: PoloIdentificado = "desconhecido";

        try {
          const detalhe = await consultarTjce(cnj, sessao);
          if (detalhe.ok && detalhe.capa) {
            if (detalhe.capa.dataDistribuicao) {
              const candidato = new Date(detalhe.capa.dataDistribuicao);
              if (!Number.isNaN(candidato.getTime())) {
                dataDistribuicao = candidato;
              }
            }
            const partes = Array.isArray(detalhe.capa.partes) ? detalhe.capa.partes : [];
            poloDoCliente = identificarPoloDoCliente(mon.apelido, mon.searchKey, partes);
          }
        } catch (err) {
          log.warn(
            {
              monId: mon.id,
              cnj,
              err: err instanceof Error ? err.message : String(err),
            },
            "[motor-cron] detail scrape pra polo/data falhou — tratando como relevante",
          );
        }

        // Regra 1: polo ativo confirmado → silencia (cliente é o autor)
        if (poloDoCliente === "ativo") {
          isRelevante = false;
          motivoSilencio = "polo_ativo";
        }

        // Regra 2: ajuizado antes do cadastro → silencia (baseline antigo)
        if (isRelevante && dataRef && dataDistribuicao) {
          if (dataDistribuicao.getTime() < new Date(dataRef).getTime()) {
            isRelevante = false;
            motivoSilencio = "anterior_cadastro";
          }
        }

        // Regra 3 (salvaguarda): sem dataRef do cadastro, o sistema não
        // sabe o que é "novo" pro cliente — mas um CNJ com ano >3 anos
        // atrás é arqueologia: o cliente ou o escritório já sabem dele,
        // não faz sentido virar alerta. Usa o ano do próprio CNJ (sempre
        // presente no padrão NNNNNNN-DD.AAAA...) como fonte confiável —
        // independente de `dataDistribuicao` do detail scrape.
        if (isRelevante && !dataRef) {
          const anoCnj = extrairAnoCnj(cnj);
          const anoAtual = new Date().getUTCFullYear();
          if (anoCnj !== null && anoAtual - anoCnj > ANOS_MAXIMOS_SEM_DATA_REF) {
            isRelevante = false;
            motivoSilencio = "cnj_antigo";
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
              : motivoSilencio === "polo_ativo"
                ? `Cliente é autor (polo ativo): ${cnj}`
                : motivoSilencio === "cnj_antigo"
                  ? `Processo antigo (>${ANOS_MAXIMOS_SEM_DATA_REF}a, sem data de cadastro): ${cnj}`
                  : `Baseline antigo (anterior ao cadastro): ${cnj}`,
            conteudoJson: JSON.stringify({
              cnj,
              dataDistribuicao: dataDistribuicao?.toISOString() ?? null,
              poloDoCliente,
              motivoSilencio,
              filtradoPorData: motivoSilencio === "anterior_cadastro",
              filtradoPorPolo: motivoSilencio === "polo_ativo",
              filtradoPorAnoCnj: motivoSilencio === "cnj_antigo",
              searchKey: mon.searchKey,
              searchType: mon.searchType,
              tribunal: mon.tribunal,
            }),
            cnjAfetado: cnj,
            hashDedup: dedup,
            lido: !isRelevante, // silenciado já entra lido (sem alerta)
          });
        } catch {
          /* duplicate hashDedup → ignora */
        }

        if (isRelevante) cnjsRelevantes.push(cnj);
        else if (motivoSilencio) cnjsSilenciados.push({ cnj, motivo: motivoSilencio });
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

      if (cnjsSilenciados.length > 0) {
        const porPolo = cnjsSilenciados.filter((c) => c.motivo === "polo_ativo").length;
        const porData = cnjsSilenciados.filter((c) => c.motivo === "anterior_cadastro").length;
        const porAnoCnj = cnjsSilenciados.filter((c) => c.motivo === "cnj_antigo").length;
        log.info(
          { monId: mon.id, silenciadosPorPolo: porPolo, silenciadosPorData: porData, silenciadosPorAnoCnj: porAnoCnj, dataRef: dataRef?.toISOString() },
          "[motor-cron] CNJs silenciados (polo ativo, anterior ao cadastro ou CNJ muito antigo sem dataRef)",
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
  if (pollNovasAcoesRodando) {
    log.warn("[motor-cron] poll novas ações já em execução — tick ignorado (anti-sobreposição)");
    return;
  }
  pollNovasAcoesRodando = true;
  try {
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
  } finally {
    pollNovasAcoesRodando = false;
  }
}
