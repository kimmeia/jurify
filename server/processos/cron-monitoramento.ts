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
  escritorios,
} from "../../drizzle/schema";
import { recuperarSessao } from "../escritorio/cofre-helpers";
import { consultarTjce, consultarTjcePorCpf } from "./adapters/pje-tjce";
import { getConfigTribunal, tribunalRequerCredencial } from "./tribunais-pdpj";
import { lerTribunaisDoMonitor, lerTribunaisBaseline } from "./monitor-tribunais";
import { siglaDoTribunal } from "../../shared/tribunais-pje";
import { detectarSubiuParaSegundoGrau, mesclarMovimentacoes } from "./detectar-grau-recurso";
import { CUSTOS } from "../routers/processos";
import { createLogger } from "../_core/logger";
import { emitirNotificacao } from "../_core/sse-notifications";
import { detectarSugestaoPrazo } from "./detector-prazos";
import {
  identificarPoloDoCliente,
  type PoloIdentificado,
} from "./polo-matcher";
import { montarCapaNovaAcao, type CapaNovaAcao } from "../../shared/nova-acao-capa";
import { lerDocumentoNoRotulo } from "../../shared/documento-no-rotulo";
import { extrairAnoCnj } from "./cnj-parser";
import { hashEvento as hashEventoNorm } from "../../scripts/spike-motor-proprio/lib/parser-utils";
import {
  analisarMovimentacao,
  modeloParaEscritorio,
  type LadoCliente,
} from "./resumir-movimentacao";
import { persistirAnalise } from "./aplicar-analise";

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

/**
 * Quantos documentos abrir por consulta.
 *
 * Cada teor é uma requisição extra no tribunal, e volume foi o que derrubou o
 * motor antes. 3 cobre o caso real (é raro um processo receber mais de uma
 * decisão entre dois polls de 1h) sem virar rajada quando um processo antigo
 * despeja muita coisa de uma vez. O que passar do teto fica com
 * teorStatus='pendente' e pode ser baixado sob demanda no painel.
 *
 * O baseline (1ª execução do monitoramento) passa 0 de propósito: ele importa
 * o histórico inteiro, e abrir dezenas de documentos de uma vez é exatamente
 * o padrão de tráfego que chama atenção.
 */
const TEOR_MAXIMO_POR_CONSULTA = 3;

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
 * Campos de teor prontos pro INSERT do evento.
 *
 * `sem_documento` e `pendente` dizem coisas diferentes e a UI depende da
 * distinção: sem_documento é um fato do movimento (rotina não tem documento e
 * nunca vai ter), pendente é "ainda não tentamos" — só o segundo justifica um
 * botão de "buscar o documento".
 *
 * A ausência de URL não prova ausência de documento. Os links da timeline do
 * PJe são `javascript:void(0)` (JSF), então `documentoUrl` vem null mesmo
 * quando a peça existe — e o rótulo diz o número dela. Quando o rótulo
 * entrega o id, o movimento é `pendente`, não `sem_documento`.
 */
function camposTeor(mov: {
  texto: string;
  documentoUrl?: string | null;
  documento?: string | null;
  teor?: string | null;
  teorStatus?: string;
  teorErro?: string | null;
}) {
  const noRotulo = lerDocumentoNoRotulo(mov.texto);
  const status = (mov.teorStatus ??
    (mov.documentoUrl || noRotulo ? "pendente" : "sem_documento")) as
    | "pendente"
    | "ok"
    | "sem_documento"
    | "indisponivel"
    | "erro";
  return {
    teorUrl: mov.documentoUrl ?? null,
    teorNome: mov.documento?.slice(0, 255) ?? null,
    teor: mov.teor ?? null,
    teorStatus: status,
    teorTentativas: mov.teorStatus ? 1 : 0,
    teorErro: mov.teorErro?.slice(0, 255) ?? null,
    teorObtidoEm: mov.teor ? new Date() : null,
    documentoIdTribunal: noRotulo?.id ?? null,
    documentoTipo: noRotulo?.tipo ?? null,
  };
}

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
    // Bifurcação por estilo de tribunal:
    //  - PDPJ-cloud (TJCE, TJRJ, …): exige credencial → cofre → sessão Keycloak
    //  - Consulta pública (TRF-5):    sem credencial, adapter HTTP/Playwright direto
    // Decisão antes de qualquer check de credencial pra TRF-5 não cair em
    // "Credencial não vinculada".
    const requerCred = tribunalRequerCredencial(mon.tribunal);
    // Baseline não abre documento: a 1ª execução importa o histórico inteiro
    // e viraria uma rajada de downloads no tribunal.
    const teorMaximo = mon.hashUltimasMovs ? TEOR_MAXIMO_POR_CONSULTA : 0;

    let resultado: Awaited<ReturnType<typeof consultarTjce>>;
    const cfgTribunal = getConfigTribunal(mon.tribunal);

    if (!requerCred) {
      // ── Caminho consulta pública (sem cofre) ──
      if (mon.tribunal === "trf5") {
        const { consultarTrf5 } = await import("./adapters/pje-trf5");
        resultado = await consultarTrf5(mon.searchKey);
      } else {
        log.warn(
          { tribunal: mon.tribunal, monId: mon.id },
          "[motor-cron] consulta pública sem adapter",
        );
        return {
          ok: false,
          detectadas: 0,
          erro: `Adapter de consulta pública não encontrado para ${mon.tribunal}`,
        };
      }
    } else {
      // ── Caminho PDPJ-cloud (TJs com credencial OAB) ──
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

      const sessao = await recuperarSessao(mon.credencialId, mon.tribunal, { tentarRelogin: true });
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

      if (!cfgTribunal) {
        log.warn(
          { tribunal: mon.tribunal, monId: mon.id },
          "[motor-cron] tribunal sem adapter",
        );
        return { ok: false, detectadas: 0, erro: `Tribunal ${mon.tribunal} sem adapter` };
      }

      resultado = await consultarTjce(mon.searchKey, sessao, cfgTribunal, { teorMaximo });

      // Sessão morta no ponto de uso (o PDPJ derrubou antes da nossa estimativa
      // de 90min): força relogin e tenta de novo UMA vez. Sem isto o auto-login
      // não dispara nesse caso e o monitoramento falha com "Sessão expirada" sem
      // refazer login. Relogin é dedupado por credencial (cofre-helpers).
      if (!resultado.ok && resultado.categoriaErro === "sessao_expirada") {
        const sessaoNova = await recuperarSessao(mon.credencialId, mon.tribunal, {
          tentarRelogin: true,
          forcarRelogin: true,
        });
        if (sessaoNova) {
          resultado = await consultarTjce(mon.searchKey, sessaoNova, cfgTribunal, { teorMaximo });
        }
      }
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

    // Auto-detect grau (opção C): quando há indício de que o processo subiu pro
    // 2º grau, consulta TAMBÉM o portal de 2º grau e junta as movimentações. Só
    // dispara quando detectado (não consulta sempre). Degrada com elegância: se
    // o 2º grau falhar (URL/sessão/estrutura), segue só com o 1º grau — sem
    // regressão no monitoramento que já funciona.
    //
    // Só pra PDPJ-cloud — consulta pública (TRF-5) ainda não tem fluxo de 2º
    // grau implementado.
    const cfg2grau = requerCred ? getConfigTribunal(mon.tribunal, 2) : null;
    if (deteccaoGrau.subiu && cfg2grau && mon.credencialId) {
      try {
        const sessao2 = await recuperarSessao(mon.credencialId, mon.tribunal, { tentarRelogin: true });
        if (sessao2) {
          const r2 = await consultarTjce(mon.searchKey, sessao2, cfg2grau, { teorMaximo });
          if (r2.ok && r2.movimentacoes.length > 0) {
            resultado.movimentacoes = mesclarMovimentacoes(
              resultado.movimentacoes,
              r2.movimentacoes,
            );
          }
        }
      } catch (err) {
        log.warn(
          { monId: mon.id, err: err instanceof Error ? err.message : String(err) },
          "[motor-cron] consulta 2º grau falhou — seguindo só com 1º grau",
        );
      }
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
            ...camposTeor(mov),
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
        resumoIa?: string | null;
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
            ...camposTeor(mov),
          });
          const eventoId = (result as { insertId: number }).insertId;
          movsNovas.push({ mov, eventoId });

          // Detecta sugestão de prazo na mov (audiência/prazo
          // processual). UNIQUE em evento_id garante idempotência —
          // se cron re-rodar, INSERT falha silenciosamente.
          // Com teor na mão a IA faz muito melhor que a regex — e o UNIQUE em
          // evento_id só deixa UMA sugestão por evento, então rodar as duas
          // faria a pior chegar primeiro e bloquear a melhor.
          const sugestao = mov.teor
            ? null
            : detectarSugestaoPrazo(mov.texto, { dataEvento: new Date(mov.data) });
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

        // Análise IA: roda SÓ pras movs que vão pra notificação (top 3) pra
        // custo previsível. As outras ficam sem análise — a UI hidrata sob
        // demanda. Em paralelo pra não somar latência; qualquer falha volta
        // null e caímos no texto bruto, como antes.
        //
        // De que lado o cliente está muda a leitura do documento inteiro
        // ("cite-se o réu para contestar" é prazo NOSSO ou da outra parte?),
        // então vale resolver o polo antes de chamar a IA.
        const movsParaNotif = movsNovas.slice(0, 3);
        const modelo = await modeloParaEscritorio(mon.escritorioId);
        const polo = resultado.capa?.partes?.length
          ? identificarPoloDoCliente(mon.apelido, mon.searchKey, resultado.capa.partes)
          : "desconhecido";
        const ladoCliente: LadoCliente =
          polo === "ativo" ? "autor" : polo === "passivo" ? "reu" : "desconhecido";

        await Promise.all(
          movsParaNotif.map(async (m) => {
            const analise = await analisarMovimentacao(
              {
                rotulo: m.mov.texto,
                teor: m.mov.teor ?? null,
                dataEvento: new Date(m.mov.data),
              },
              modelo,
              { escritorioId: mon.escritorioId, ladoCliente, nomeCliente: mon.apelido ?? undefined },
            );
            m.resumoIa = analise?.titulo ?? null;
            if (!analise) return;
            await persistirAnalise({
              eventoId: m.eventoId,
              escritorioId: mon.escritorioId,
              monitoramentoId: mon.id,
              cnj: mon.searchKey,
              dataEvento: new Date(m.mov.data),
              teor: m.mov.teor ?? null,
              analise,
            });
          }),
        );

        for (const { mov, eventoId, resumoIa } of movsParaNotif) {
          await db.insert(notificacoes).values({
            userId: mon.criadoPor,
            titulo: `Nova movimentação: ${mon.apelido ?? mon.searchKey}`,
            mensagem: resumoIa ?? mov.texto.slice(0, 200),
            tipo: "movimentacao",
            eventoId,
          });
        }

        const resumoUltima = movsParaNotif[0]?.resumoIa;
        emitirNotificacao(mon.criadoPor, {
          tipo: "movimentacao_processo",
          titulo: "Nova movimentação",
          mensagem: `${mon.apelido ?? mon.searchKey}: ${resumoUltima ?? ultimaMov.texto.slice(0, 100)}`,
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
      // Saldo e extrato juntos: cobrar sem registrar (ou registrar sem
      // cobrar) deixa o escritório com um saldo que o extrato não explica.
      await db.transaction(async (tx) => {
        await tx
          .update(motorCreditos)
          .set({
            saldo: novoSaldo,
            totalConsumido: cr.totalConsumido + custo,
          })
          .where(eq(motorCreditos.id, cr.id));

        await tx.insert(motorTransacoes).values({
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

    // Um monitoramento vigia N tribunais (aprovado no mockup de 20/08). A
    // falha de UM estado não pode derrubar a varredura dos outros — ela vira
    // linha em `varreduraJson`, que é o que a faixa de cobertura mostra.
    const tribunais = lerTribunaisDoMonitor(mon);
    const baselineFeito = new Set<string>(lerTribunaisBaseline(mon));

    type ConsultaTribunal = {
      tribunal: string;
      sessao: string;
      cfg: NonNullable<ReturnType<typeof getConfigTribunal>>;
      cnjs: string[];
    };
    const consultas: ConsultaTribunal[] = [];
    const falhas: Array<{ tribunal: string; erro: string }> = [];

    for (const tribunal of tribunais) {
      const cfgTribunal = getConfigTribunal(tribunal);
      if (!cfgTribunal) {
        falhas.push({ tribunal, erro: "sem adapter de CPF" });
        continue;
      }
      const sessao = await recuperarSessao(mon.credencialId, tribunal, { tentarRelogin: true });
      if (!sessao) {
        falhas.push({ tribunal, erro: "Sessão expirada — revalide a credencial" });
        continue;
      }
      let resultado = await consultarTjcePorCpf(mon.searchKey, sessao, cfgTribunal);
      // Sessão morta no ponto de uso: força relogin e tenta de novo uma vez
      // (mesmo motivo do poll de movimentações). Relogin dedupado por credencial.
      if (!resultado.ok && resultado.categoriaErro === "sessao_expirada") {
        const sessaoNova = await recuperarSessao(mon.credencialId, tribunal, {
          tentarRelogin: true,
          forcarRelogin: true,
        });
        if (sessaoNova) {
          resultado = await consultarTjcePorCpf(mon.searchKey, sessaoNova, cfgTribunal);
        }
      }
      if (!resultado.ok) {
        falhas.push({ tribunal, erro: (resultado.mensagemErro ?? "Erro na consulta CPF").slice(0, 200) });
        continue;
      }
      consultas.push({ tribunal, sessao, cfg: cfgTribunal, cnjs: resultado.cnjs });
    }

    const varreduraJson = JSON.stringify({
      em: new Date().toISOString(),
      resultados: [
        ...consultas.map((c) => ({ tribunal: c.tribunal, ok: true, total: c.cnjs.length })),
        ...falhas.map((f) => ({ tribunal: f.tribunal, ok: false, erro: f.erro })),
      ],
    });
    const resumoFalhas = falhas.length
      ? `Falha em ${falhas.map((f) => siglaDoTribunal(f.tribunal)).join(", ")}: ${falhas[0].erro}`
      : null;

    if (consultas.length === 0) {
      await db
        .update(motorMonitoramentos)
        .set({
          ultimaConsultaEm: new Date(),
          ultimoErro: resumoFalhas ?? "Erro na consulta CPF",
          varreduraJson,
        })
        .where(eq(motorMonitoramentos.id, mon.id));
      return { ok: false, detectadas: 0, erro: resumoFalhas ?? "Erro na consulta CPF" };
    }

    const cnjsConhecidos: string[] = mon.cnjsConhecidos
      ? (JSON.parse(mon.cnjsConhecidos) as string[])
      : [];

    // Baseline é POR TRIBUNAL: estado adicionado depois faz a 1ª varredura em
    // silêncio (registra sem alarmar), senão todo o estoque antigo dele viraria
    // "ação nova" no dia seguinte à ampliação.
    const cnjsBaseline: Array<{ cnj: string; tribunal: string }> = [];
    const cnjsNovos: Array<{ cnj: string; tribunal: string; sessao: string; cfg: ConsultaTribunal["cfg"] }> = [];
    // Baseline "novo" inclui a varredura que achou zero — ela também precisa
    // ficar registrada (cnjsConhecidos regravado + tribunal no baseline),
    // senão o primeiro processo futuro entraria mudo de novo.
    let houveBaselineNovo = false;
    for (const c of consultas) {
      const primeiraDoTribunal = !baselineFeito.has(c.tribunal);
      if (primeiraDoTribunal) houveBaselineNovo = true;
      for (const cnj of c.cnjs) {
        if (cnjsConhecidos.includes(cnj)) continue;
        if (primeiraDoTribunal) cnjsBaseline.push({ cnj, tribunal: c.tribunal });
        else cnjsNovos.push({ cnj, tribunal: c.tribunal, sessao: c.sessao, cfg: c.cfg });
      }
      baselineFeito.add(c.tribunal);
    }
    const isPrimeiraExecucao = cnjsBaseline.length > 0;

    if (isPrimeiraExecucao) {
      for (const { cnj, tribunal } of cnjsBaseline) {
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
              tribunal,
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
      log.info(
        { monId: mon.id, baseline: cnjsBaseline.length, tribunais: [...baselineFeito] },
        "[motor-cron] baseline silencioso de novas ações registrado",
      );
    }

    // Sem incremento pra apurar: fecha a varredura aqui (baseline puro ou
    // rodada sem novidade).
    if (cnjsNovos.length === 0) {
      await db
        .update(motorMonitoramentos)
        .set({
          // Sem baseline novo, a lista não mudou — não regrava (rodada
          // quieta atualiza só o carimbo, como sempre foi).
          ...(houveBaselineNovo
            ? { cnjsConhecidos: JSON.stringify([...cnjsConhecidos, ...cnjsBaseline.map((b) => b.cnj)]) }
            : {}),
          tribunaisBaseline: JSON.stringify([...baselineFeito]),
          varreduraJson,
          ultimaConsultaEm: new Date(),
          ultimoErro: resumoFalhas,
        })
        .where(eq(motorMonitoramentos.id, mon.id));
      return {
        ok: falhas.length === 0,
        detectadas: 0,
        baseline: isPrimeiraExecucao,
        erro: resumoFalhas ?? undefined,
      };
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
      // A OAB do escritório entre as partes diz "foi o escritório que
      // ajuizou" — só informação pra tela; não decide polo.
      const [escDoMon] = await db
        .select({ oab: escritorios.oab })
        .from(escritorios)
        .where(eq(escritorios.id, mon.escritorioId))
        .limit(1);
      const oabEscritorio = escDoMon?.oab ?? null;
      const cnjsRelevantes: string[] = [];
      const cnjsSilenciados: Array<{ cnj: string; motivo: "polo_ativo" | "anterior_cadastro" | "cnj_antigo" }> = [];

      for (const { cnj, tribunal, sessao, cfg } of cnjsNovos) {
        let isRelevante = true;
        let motivoSilencio: "polo_ativo" | "anterior_cadastro" | "cnj_antigo" | null = null;
        let dataDistribuicao: Date | null = null;
        let poloDoCliente: PoloIdentificado = "desconhecido";
        let capaColetada: CapaNovaAcao | null = null;

        try {
          // O detail scrape roda no tribunal DO CNJ — sessão e config vieram
          // da consulta que o achou, não do tribunal-sede do monitoramento.
          const detalhe = await consultarTjce(cnj, sessao, cfg);
          if (detalhe.ok && detalhe.capa) {
            if (detalhe.capa.dataDistribuicao) {
              const candidato = new Date(detalhe.capa.dataDistribuicao);
              if (!Number.isNaN(candidato.getTime())) {
                dataDistribuicao = candidato;
              }
            }
            const partes = Array.isArray(detalhe.capa.partes) ? detalhe.capa.partes : [];
            poloDoCliente = identificarPoloDoCliente(mon.apelido, mon.searchKey, partes);
            // Este scrape é o único que acontece por CNJ novo. O que não for
            // guardado aqui só volta pagando outra consulta.
            capaColetada = montarCapaNovaAcao(
              detalhe.capa,
              poloDoCliente,
              new Date().toISOString(),
              { oabEscritorio },
            );
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
              capa: capaColetada,
              capaFalhou: capaColetada === null,
              motivoSilencio,
              filtradoPorData: motivoSilencio === "anterior_cadastro",
              filtradoPorPolo: motivoSilencio === "polo_ativo",
              filtradoPorAnoCnj: motivoSilencio === "cnj_antigo",
              searchKey: mon.searchKey,
              searchType: mon.searchType,
              tribunal,
            }),
            cnjAfetado: cnj,
            hashDedup: dedup,
            poloCliente: poloDoCliente,
            // Silenciado já entra lido (sem alerta) — exceto o autor
            // confirmado, que tem gaveta própria na aba e precisa aparecer
            // lá como pendente. O alerta dele é barrado pelo polo, não pelo
            // lido.
            lido: !isRelevante && motivoSilencio !== "polo_ativo",
          });
        } catch {
          /* duplicate hashDedup → ignora */
        }

        if (isRelevante) cnjsRelevantes.push(cnj);
        else if (motivoSilencio) cnjsSilenciados.push({ cnj, motivo: motivoSilencio });
      }

      const todosCnjs = [
        ...cnjsConhecidos,
        ...cnjsBaseline.map((b) => b.cnj),
        ...cnjsNovos.map((n) => n.cnj),
      ];
      await db
        .update(motorMonitoramentos)
        .set({
          cnjsConhecidos: JSON.stringify(todosCnjs),
          tribunaisBaseline: JSON.stringify([...baselineFeito]),
          varreduraJson,
          totalNovasAcoes: mon.totalNovasAcoes + cnjsRelevantes.length,
          ultimaConsultaEm: new Date(),
          ultimoErro: resumoFalhas,
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

      return {
        ok: falhas.length === 0,
        detectadas: cnjsRelevantes.length,
        erro: resumoFalhas ?? undefined,
      };
    }

    await db
      .update(motorMonitoramentos)
      .set({
        ultimaConsultaEm: new Date(),
        ultimoErro: resumoFalhas,
        tribunaisBaseline: JSON.stringify([...baselineFeito]),
        varreduraJson,
      })
      .where(eq(motorMonitoramentos.id, mon.id));
    return { ok: falhas.length === 0, detectadas: 0, erro: resumoFalhas ?? undefined };
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
