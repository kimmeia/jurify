/**
 * SmartFlow Dispatcher — intercepta eventos e dispara cenários.
 *
 * Pontos de entrada (um por gatilho):
 *   - tentarSmartFlow           ← WhatsApp Handler
 *   - dispararPagamentoRecebido ← Asaas Webhook
 *   - dispararNovoLead          ← WhatsApp Handler (quando cria contato novo)
 *   - dispararAgendamentoCriado ← Cal.com Webhook
 *   - executarManual            ← Router (botão "Executar agora")
 *
 * Todos convergem em `executarCenarioPorGatilho`, que busca o cenário
 * ativo, roda o engine e grava o log em `smartflow_execucoes`.
 *
 * Passo `esperar`: em vez de só parar, gravamos `retomarEm = now + delay`
 * e o scheduler (cron-jobs) retoma a execução do próximo passo quando
 * o tempo chega.
 */

import { getDb } from "../db";
import { smartflowCenarios, smartflowPassos, smartflowExecucoes } from "../../drizzle/schema";
import { eq, and, inArray, gte } from "drizzle-orm";
import { executarCenario, Passo, SmartflowContexto, ExecutarCenarioResultado } from "./engine";
import { criarExecutoresReais } from "./executores";
import { createLogger } from "../_core/logger";
import {
  aceitaCanal,
  chaveDiaLocal,
  contextoContemPagamento,
  contextoContemSlot,
  deveDispararProximo,
  deveDispararVencido,
  diasEntre,
  parseVencimento,
  slotTimestampChave,
  temHorarioConfigurado,
} from "./dispatcher-helpers";
import type {
  GatilhoSmartflow,
  TipoCanalMensagem,
  ConfigGatilhoMensagemCanal,
  ConfigGatilhoPagamentoVencido,
  ConfigGatilhoPagamentoProximoVencimento,
  ConfigGatilhoAgendamentoLembrete,
} from "../../shared/smartflow-types";

const log = createLogger("smartflow-dispatcher");

// ─── Helpers ────────────────────────────────────────────────────────────────

interface CenarioCarregado {
  cenarioId: number;
  nome: string;
  passos: Passo[];
  gatilho: GatilhoSmartflow;
  configGatilho: Record<string, unknown>;
}

function safeParseJson(raw: string | null | undefined): Record<string, string> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") out[k] = v;
      }
      return Object.keys(out).length > 0 ? out : null;
    }
  } catch { /* ignore */ }
  return null;
}

function parseConfigGatilho(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function carregarCenarioAtivo(
  escritorioId: number,
  gatilho: GatilhoSmartflow,
): Promise<CenarioCarregado | null> {
  const todos = await carregarCenariosAtivos(escritorioId, [gatilho]);
  return todos[0] ?? null;
}

/**
 * Carrega todos os cenários ativos do escritório que casam com os gatilhos
 * informados. Usado pelos dispatchers que podem ter múltiplos cenários
 * concorrentes (ex: mensagem_canal com filtros de canal diferentes).
 */
async function carregarCenariosAtivos(
  escritorioId: number,
  gatilhos: GatilhoSmartflow[],
): Promise<CenarioCarregado[]> {
  const db = await getDb();
  if (!db || gatilhos.length === 0) return [];

  const cenarios = await db
    .select()
    .from(smartflowCenarios)
    .where(
      and(
        eq(smartflowCenarios.escritorioId, escritorioId),
        inArray(smartflowCenarios.gatilho, gatilhos),
        eq(smartflowCenarios.ativo, true),
      ),
    );

  if (cenarios.length === 0) return [];

  const resultado: CenarioCarregado[] = [];
  for (const cenario of cenarios) {
    const passos = await db
      .select()
      .from(smartflowPassos)
      .where(eq(smartflowPassos.cenarioId, cenario.id))
      .orderBy(smartflowPassos.ordem);
    if (passos.length === 0) continue;

    const passosEngine: Passo[] = passos.map((p) => ({
      id: p.id,
      ordem: p.ordem,
      tipo: p.tipo,
      config: p.config ? JSON.parse(p.config) : {},
      clienteId: p.clienteId ?? null,
      proximoSe: p.proximoSe ? safeParseJson(p.proximoSe) : null,
    }));

    resultado.push({
      cenarioId: cenario.id,
      nome: cenario.nome,
      passos: passosEngine,
      gatilho: cenario.gatilho as GatilhoSmartflow,
      configGatilho: parseConfigGatilho(cenario.configGatilho),
    });
  }
  return resultado;
}

async function carregarCenarioPorId(
  escritorioId: number,
  cenarioId: number,
): Promise<{ cenarioId: number; nome: string; passos: Passo[]; ativo: boolean } | null> {
  const db = await getDb();
  if (!db) return null;

  const [cenario] = await db
    .select()
    .from(smartflowCenarios)
    .where(and(eq(smartflowCenarios.id, cenarioId), eq(smartflowCenarios.escritorioId, escritorioId)))
    .limit(1);
  if (!cenario) return null;

  const passos = await db
    .select()
    .from(smartflowPassos)
    .where(eq(smartflowPassos.cenarioId, cenarioId))
    .orderBy(smartflowPassos.ordem);

  const passosEngine: Passo[] = passos.map((p) => ({
    id: p.id,
    ordem: p.ordem,
    tipo: p.tipo,
    config: p.config ? JSON.parse(p.config) : {},
  }));

  return { cenarioId: cenario.id, nome: cenario.nome, passos: passosEngine, ativo: cenario.ativo };
}

async function criarExecucao(
  escritorioId: number,
  cenarioId: number,
  contexto: SmartflowContexto,
  refs?: { contatoId?: number; conversaId?: number },
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [res] = await db.insert(smartflowExecucoes).values({
    cenarioId,
    escritorioId,
    contatoId: refs?.contatoId ?? null,
    conversaId: refs?.conversaId ?? null,
    status: "rodando",
    contexto: JSON.stringify(contexto),
  });
  return (res as { insertId: number }).insertId;
}

async function finalizarExecucao(
  execId: number,
  resultado: ExecutarCenarioResultado,
) {
  const db = await getDb();
  if (!db) return;

  // Se o engine sinalizou "esperando" (passo esperar), gravamos retomarEm
  // e mantemos status=rodando pra que o scheduler retome depois.
  const esperando = !!resultado.contexto.esperando && resultado.sucesso;
  const delayMinutos = Number(resultado.contexto.delayMinutos ?? 0);

  const retomarEm = esperando && delayMinutos > 0
    ? new Date(Date.now() + delayMinutos * 60 * 1000)
    : null;

  await db
    .update(smartflowExecucoes)
    .set({
      status: esperando ? "rodando" : resultado.sucesso ? "concluido" : "erro",
      passoAtual: resultado.passosExecutados,
      contexto: JSON.stringify(resultado.contexto),
      erro: resultado.erro || null,
      retomarEm,
    })
    .where(eq(smartflowExecucoes.id, execId));
}

async function executarCenarioPorGatilho(
  escritorioId: number,
  gatilho: GatilhoSmartflow,
  contexto: SmartflowContexto,
  refs?: { contatoId?: number; conversaId?: number },
): Promise<{ executou: boolean; respostas: string[]; execId?: number }> {
  const cenario = await carregarCenarioAtivo(escritorioId, gatilho);
  if (!cenario) return { executou: false, respostas: [] };
  return executarCenarioCarregado(escritorioId, cenario, contexto, refs);
}

async function executarCenarioCarregado(
  escritorioId: number,
  cenario: CenarioCarregado,
  contexto: SmartflowContexto,
  refs?: { contatoId?: number; conversaId?: number },
): Promise<{ executou: boolean; respostas: string[]; execId?: number }> {
  const execId = await criarExecucao(escritorioId, cenario.cenarioId, contexto, refs);
  if (!execId) return { executou: false, respostas: [] };

  const executores = criarExecutoresReais(escritorioId);
  const resultado = await executarCenario(cenario.passos, contexto, executores);

  await finalizarExecucao(execId, resultado);

  log.info(
    { cenarioId: cenario.cenarioId, execId, gatilho: cenario.gatilho, passos: resultado.passosExecutados, sucesso: resultado.sucesso },
    `SmartFlow: cenário "${cenario.nome}" executado (${cenario.gatilho})`,
  );

  return { executou: true, respostas: resultado.respostas, execId };
}

// ─── Dispatchers públicos ───────────────────────────────────────────────────

/**
 * Dispara cenários com gatilho "pagamento_recebido".
 * Chamado pelo webhook do Asaas quando pagamento é confirmado.
 *
 * Condições automáticas no contexto:
 * - primeiraCobranca: true se não existe card no Kanban pra esse cliente
 * - assinaturaId: preenchido se é pagamento de assinatura (pra filtrar)
 */
/**
 * Resolve identificadores e contato do cliente (`contatoId`, nome, telefone)
 * a partir do `clienteAsaasId` ou `contatoId` conhecido. Usado pra enriquecer
 * o contexto de gatilhos Asaas com o `telefoneCliente` — crucial pro passo
 * `whatsapp_enviar` conseguir enviar (gatilhos não-mensagem não têm canalId,
 * então o engine envia direto via executor, que precisa do telefone).
 *
 * Ordem de resolução:
 *   1. `contatoId` informado → busca `contatos`.
 *   2. `clienteAsaasId` informado → busca `asaasClientes` → `contatos`.
 * Retorna `{}` se nada encontrado (chamador continua sem telefone).
 */
/** Lê os campos personalizados do contato (JSON serializado).
 *  Retorna `{}` se não houver, JSON inválido ou erro. Nunca lança. */
async function lerCamposPersonalizados(
  escritorioId: number,
  contatoId: number | undefined,
): Promise<Record<string, unknown>> {
  if (!contatoId) return {};
  const db = await getDb();
  if (!db) return {};
  try {
    const { contatos } = await import("../../drizzle/schema");
    const [c] = await db
      .select({ camposPersonalizados: contatos.camposPersonalizados })
      .from(contatos)
      .where(and(eq(contatos.id, contatoId), eq(contatos.escritorioId, escritorioId)))
      .limit(1);
    if (!c?.camposPersonalizados) return {};
    const parsed = JSON.parse(c.camposPersonalizados);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function resolverContatoAsaas(
  escritorioId: number,
  opts: { contatoId?: number; clienteAsaasId?: string },
): Promise<{ contatoId?: number; nome?: string; telefone?: string; email?: string; atendenteResponsavelId?: number; camposPersonalizados?: Record<string, unknown> }> {
  const db = await getDb();
  if (!db) return {};
  try {
    const { asaasClientes, contatos } = await import("../../drizzle/schema");

    let contatoIdFinal = opts.contatoId;
    if (!contatoIdFinal && opts.clienteAsaasId) {
      const [vinc] = await db
        .select({ contatoId: asaasClientes.contatoId })
        .from(asaasClientes)
        .where(
          and(
            eq(asaasClientes.escritorioId, escritorioId),
            eq(asaasClientes.asaasCustomerId, opts.clienteAsaasId),
          ),
        )
        .limit(1);
      contatoIdFinal = vinc?.contatoId ?? undefined;
    }

    if (!contatoIdFinal) return {};

    const [c] = await db
      .select({
        id: contatos.id,
        nome: contatos.nome,
        telefone: contatos.telefone,
        email: contatos.email,
        atendenteResponsavelId: contatos.atendenteResponsavelId,
        camposPersonalizados: contatos.camposPersonalizados,
      })
      .from(contatos)
      .where(and(eq(contatos.id, contatoIdFinal), eq(contatos.escritorioId, escritorioId)))
      .limit(1);
    if (!c) return {};

    let campos: Record<string, unknown> | undefined;
    if (c.camposPersonalizados) {
      try {
        const parsed = JSON.parse(c.camposPersonalizados);
        if (parsed && typeof parsed === "object") campos = parsed;
      } catch {
        /* JSON inválido — ignora */
      }
    }

    return {
      contatoId: c.id,
      nome: c.nome || undefined,
      telefone: c.telefone || undefined,
      email: c.email || undefined,
      atendenteResponsavelId: c.atendenteResponsavelId ?? undefined,
      camposPersonalizados: campos,
    };
  } catch (err: any) {
    log.warn({ err: err.message }, "SmartFlow: falha ao resolver contato Asaas");
    return {};
  }
}

/**
 * Calcula resumo financeiro do contato pra enriquecer o contexto dos gatilhos
 * de pagamento — usado nas condições do passo `condicional` (`valorTotalCliente`,
 * `percentualPago`).
 *
 * - `valorTotalCliente`: soma de `asaas_cobrancas.valor` com status=RECEIVED
 *   (ou CONFIRMED / RECEIVED_IN_CASH) do contato, em centavos. Usa o mesmo
 *   formato de `pagamentoValor` pra permitir comparações numéricas diretas
 *   (ex: `valorTotalCliente > 100000` = mais de R$ 1.000).
 * - `percentualPago`: `recebido / total` × 100, arredondado. Total = qualquer
 *   cobrança com status diferente de REFUNDED/DELETED.
 *
 * Retorna `{ valorTotalCliente: 0, percentualPago: 0 }` se não achar contato
 * ou se não há cobranças. Nunca lança — usado em fire-and-forget.
 */
async function calcularResumoFinanceiroContato(
  escritorioId: number,
  opts: { contatoId?: number; clienteAsaasId?: string },
): Promise<{ valorTotalCliente: number; percentualPago: number }> {
  const db = await getDb();
  if (!db) return { valorTotalCliente: 0, percentualPago: 0 };

  try {
    const { asaasCobrancas, asaasClientes } = await import("../../drizzle/schema");

    // Resolve o asaasCustomerId a partir de contatoId, se necessário.
    let customerId = opts.clienteAsaasId;
    if (!customerId && opts.contatoId) {
      const [vinc] = await db
        .select({ asaasCustomerId: asaasClientes.asaasCustomerId })
        .from(asaasClientes)
        .where(
          and(
            eq(asaasClientes.escritorioId, escritorioId),
            eq(asaasClientes.contatoId, opts.contatoId),
          ),
        )
        .limit(1);
      customerId = vinc?.asaasCustomerId;
    }
    if (!customerId) return { valorTotalCliente: 0, percentualPago: 0 };

    const cobrancas = await db
      .select({ valor: asaasCobrancas.valor, status: asaasCobrancas.status })
      .from(asaasCobrancas)
      .where(
        and(
          eq(asaasCobrancas.escritorioId, escritorioId),
          eq(asaasCobrancas.asaasCustomerId, customerId),
        ),
      );

    if (cobrancas.length === 0) return { valorTotalCliente: 0, percentualPago: 0 };

    const statusPago = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
    const statusIgnorar = new Set(["REFUNDED", "DELETED"]);

    let totalEmitido = 0;
    let totalRecebido = 0;
    for (const c of cobrancas) {
      if (statusIgnorar.has(c.status)) continue;
      const valor = Math.round(Number(c.valor || 0) * 100);
      if (Number.isNaN(valor)) continue;
      totalEmitido += valor;
      if (statusPago.has(c.status)) totalRecebido += valor;
    }

    const percentual = totalEmitido > 0 ? Math.round((totalRecebido / totalEmitido) * 100) : 0;
    return { valorTotalCliente: totalRecebido, percentualPago: percentual };
  } catch (err: any) {
    log.warn({ err: err.message }, "SmartFlow: falha no resumo financeiro");
    return { valorTotalCliente: 0, percentualPago: 0 };
  }
}

export async function dispararPagamentoRecebido(
  escritorioId: number,
  params: {
    pagamentoId: string;
    valor: number;
    descricao: string;
    tipo: string;
    assinaturaId?: string;
    clienteNome?: string;
    clienteEmail?: string;
    clienteAsaasId?: string;
  },
): Promise<{ executou: boolean; vezes: number }> {
  const db = await getDb();
  if (!db) return { executou: false, vezes: 0 };

  try {
    // Pre-flight: só chama se há cenário ativo (evita overhead de queries)
    const cenario = await carregarCenarioAtivo(escritorioId, "pagamento_recebido");
    if (!cenario) return { executou: false, vezes: 0 };

    const { asaasCobrancas, cobrancaAcoes, clienteProcessos } = await import(
      "../../drizzle/schema"
    );
    const { verificarPrimeiraCobranca } = await import("./primeira-cobranca");

    // 1. Resolve dados do contato + resumo financeiro (1× — não muda por ação).
    const resumo = await calcularResumoFinanceiroContato(escritorioId, {
      clienteAsaasId: params.clienteAsaasId,
    });
    const contato = await resolverContatoAsaas(escritorioId, {
      clienteAsaasId: params.clienteAsaasId,
    });

    // 2. Busca a cobrança local pra descobrir se está vinculada a ações.
    const [cobrancaLocal] = await db
      .select({ id: asaasCobrancas.id })
      .from(asaasCobrancas)
      .where(
        and(
          eq(asaasCobrancas.escritorioId, escritorioId),
          eq(asaasCobrancas.asaasPaymentId, params.pagamentoId),
        ),
      )
      .limit(1);

    type AcaoVinculada = {
      id: number;
      apelido: string | null;
      tipo: string | null;
      classe: string | null;
      // null em processos extrajudiciais (contratos, consultoria, administrativos).
      numeroCnj: string | null;
      // schema usa decimal — drizzle entrega como number | null
      valorCausa: number | null;
      polo: string | null;
    };
    let acoes: AcaoVinculada[] = [];
    if (cobrancaLocal) {
      acoes = await db
        .select({
          id: clienteProcessos.id,
          apelido: clienteProcessos.apelido,
          tipo: clienteProcessos.tipo,
          classe: clienteProcessos.classe,
          numeroCnj: clienteProcessos.numeroCnj,
          valorCausa: clienteProcessos.valorCausa,
          polo: clienteProcessos.polo,
        })
        .from(cobrancaAcoes)
        .innerJoin(clienteProcessos, eq(clienteProcessos.id, cobrancaAcoes.processoId))
        .where(eq(cobrancaAcoes.cobrancaId, cobrancaLocal.id));
    }

    // 3. Helper que monta contexto-base (compartilhado entre eventos).
    // Quando o contato não foi resolvido (cliente Asaas órfão), pulamos
    // a verificação detalhada e default = primeira (mais permissivo).
    const primeiraCliente = contato.contatoId
      ? await verificarPrimeiraCobranca({
          escritorioId,
          contatoId: contato.contatoId,
          asaasPaymentIdAtual: params.pagamentoId,
        })
      : { doCliente: true, daAcao: null };

    const contextoBase: SmartflowContexto = {
      mensagem: `Pagamento recebido: ${params.descricao}`,
      pagamentoId: params.pagamentoId,
      pagamentoValor: params.valor,
      pagamentoDescricao: params.descricao,
      pagamentoTipo: params.tipo,
      assinaturaId: params.assinaturaId || "",
      // Variável correta (renomeada). Compat: também populamos
      // `primeiraCobranca` (deprecated alias) abaixo, com mesmo valor —
      // SmartFlows antigos seguem funcionando.
      primeiraCobrancaDoCliente: primeiraCliente.doCliente,
      primeiraCobranca: primeiraCliente.doCliente,
      nomeCliente: params.clienteNome || contato.nome,
      telefoneCliente: contato.telefone,
      emailCliente: contato.email,
      contatoId: contato.contatoId,
      atendenteResponsavelId: contato.atendenteResponsavelId,
      cliente: { campos: contato.camposPersonalizados || {} },
      valorTotalCliente: resumo.valorTotalCliente,
      percentualPago: resumo.percentualPago,
    };

    // 4a. Sem ações vinculadas → 1 evento (legado, comportamento preservado).
    if (acoes.length === 0) {
      const r = await executarCenarioPorGatilho(
        escritorioId,
        "pagamento_recebido",
        contextoBase,
        { contatoId: contato.contatoId },
      );
      return { executou: r.executou, vezes: r.executou ? 1 : 0 };
    }

    // 4b. Com N ações vinculadas → N eventos, cada um com sua ação.
    let vezesExecutado = 0;
    for (const acao of acoes) {
      const primeiraDaAcao = contato.contatoId
        ? await verificarPrimeiraCobranca({
            escritorioId,
            contatoId: contato.contatoId,
            acaoId: acao.id,
            asaasPaymentIdAtual: params.pagamentoId,
          })
        : { doCliente: true, daAcao: true as boolean | null };

      const contextoComAcao: SmartflowContexto = {
        ...contextoBase,
        // Dados da ação no contexto — disponíveis nos templates do
        // SmartFlow como {{acaoApelido}}, {{acaoTipo}}, etc.
        acaoId: acao.id,
        acaoApelido: acao.apelido || acao.numeroCnj || undefined,
        acaoTipo: acao.tipo || "",
        acaoClasse: acao.classe || "",
        acaoNumeroCnj: acao.numeroCnj || undefined,
        acaoValorCausa: acao.valorCausa != null ? String(acao.valorCausa) : "",
        acaoPolo: acao.polo || "",
        // Específico desta ação (vs. do cliente)
        primeiraCobrancaDaAcao: primeiraDaAcao.daAcao ?? false,
      };

      const r = await executarCenarioPorGatilho(
        escritorioId,
        "pagamento_recebido",
        contextoComAcao,
        { contatoId: contato.contatoId },
      );
      if (r.executou) vezesExecutado++;
    }

    return { executou: vezesExecutado > 0, vezes: vezesExecutado };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro ao processar pagamento");
    return { executou: false, vezes: 0 };
  }
}

/**
 * Dedupe do disparo de pagamento. Duas estratégias, escolhidas pelo caller:
 *
 *   - `slotChave` presente: verifica se **o mesmo slot exato** já disparou
 *     nos últimos N dias (default 2). Permite várias execuções por dia
 *     (ex: 09:00, 11:00, 13:00) sem duplicar.
 *   - `slotChave` ausente: fallback pra janela fixa de 24h via
 *     `contextoContemPagamento` — comportamento legado, cenários sem
 *     horário configurado.
 */
async function jaDisparouPagamento(
  cenarioId: number,
  pagamentoId: string,
  slotChave: string | null,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Janela: 2 dias quando temos slot (cobre atraso do cron entre dias),
  // 24h quando fallback legado.
  const janelaHoras = slotChave ? 48 : 24;
  const desde = new Date(Date.now() - janelaHoras * 60 * 60 * 1000);

  const execs = await db
    .select({ contexto: smartflowExecucoes.contexto })
    .from(smartflowExecucoes)
    .where(
      and(
        eq(smartflowExecucoes.cenarioId, cenarioId),
        gte(smartflowExecucoes.createdAt, desde),
      ),
    );

  if (slotChave) {
    // Dedupe exato: mesmo cenário + mesmo pagamento + mesmo slot.
    return execs.some(
      (r) =>
        contextoContemPagamento(r.contexto, pagamentoId) &&
        contextoContemSlot(r.contexto, slotChave),
    );
  }

  // Fallback legado — 24h por (cenário, pagamento).
  return execs.some((r) => contextoContemPagamento(r.contexto, pagamentoId));
}

/**
 * Conta quantos dias distintos o par (cenário, pagamento) já gerou execução.
 * Usado pra controlar `repetirPorDias` — depois de N dias, paramos de
 * lembrar, mesmo que a cobrança continue em aberto.
 */
async function diasDistintosDisparados(
  cenarioId: number,
  pagamentoId: string,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  // Janela ampla (30 dias) — ninguém configura mais que isso.
  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const execs = await db
    .select({ contexto: smartflowExecucoes.contexto, createdAt: smartflowExecucoes.createdAt })
    .from(smartflowExecucoes)
    .where(
      and(
        eq(smartflowExecucoes.cenarioId, cenarioId),
        gte(smartflowExecucoes.createdAt, desde),
      ),
    );
  const dias = new Set<string>();
  for (const r of execs) {
    if (!contextoContemPagamento(r.contexto, pagamentoId)) continue;
    const d = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as any);
    dias.add(chaveDiaLocal(d));
  }
  return dias.size;
}

/**
 * Dispara cenários com gatilho `pagamento_vencido`.
 * Chamado pelo webhook do Asaas (PAYMENT_OVERDUE) e pelo cobrancas-scheduler.
 *
 * Cada cenário pode configurar `configGatilho.diasAtraso` (mínimo de atraso
 * em dias). Só dispara se o atraso atual for maior ou igual.
 * Dedupe por (cenarioId, pagamentoId) na janela de 24h.
 */
export async function dispararPagamentoVencido(
  escritorioId: number,
  params: {
    pagamentoId: string;
    valor: number;
    descricao: string;
    vencimento: string;
    clienteNome?: string;
    clienteAsaasId?: string;
    contatoId?: number;
    /**
     * Slot que motivou o disparo (vindo do scheduler em modo horário). Se
     * presente, o dedupe acontece por `(cenário, pagamento, slot)` — o
     * mesmo pagamento pode disparar em múltiplos slots do mesmo dia.
     */
    slotTimestamp?: Date;
  },
): Promise<{ executou: boolean; cenariosDisparados: number }> {
  try {
    const cenarios = await carregarCenariosAtivos(escritorioId, ["pagamento_vencido"]);
    if (cenarios.length === 0) return { executou: false, cenariosDisparados: 0 };

    const vencimento = parseVencimento(params.vencimento);
    const diasAtrasoAtual = vencimento ? diasEntre(new Date(), vencimento) : 0;
    const slotChave = params.slotTimestamp ? slotTimestampChave(params.slotTimestamp) : null;

    let disparados = 0;
    for (const c of cenarios) {
      const cfg = c.configGatilho as ConfigGatilhoPagamentoVencido;
      if (!deveDispararVencido(cfg, diasAtrasoAtual)) continue;

      // Webhook imediato (sem slot) é suprimido quando o cenário tem
      // horário configurado — nesse caso só o scheduler dispara.
      if (!slotChave && temHorarioConfigurado(cfg)) {
        log.debug({ cenarioId: c.cenarioId }, "SmartFlow: webhook suprimido — cenário usa horário");
        continue;
      }

      if (await jaDisparouPagamento(c.cenarioId, params.pagamentoId, slotChave)) {
        log.debug({ cenarioId: c.cenarioId, pagamentoId: params.pagamentoId, slotChave }, "SmartFlow: pagamento_vencido já disparado — skip");
        continue;
      }

      // Controle `repetirPorDias`: para de lembrar depois de N dias.
      const limite = Math.max(1, Math.floor(Number(cfg?.repetirPorDias ?? 1)));
      if (temHorarioConfigurado(cfg)) {
        const disparadosDias = await diasDistintosDisparados(c.cenarioId, params.pagamentoId);
        if (disparadosDias >= limite) {
          log.debug({ cenarioId: c.cenarioId, pagamentoId: params.pagamentoId, limite }, "SmartFlow: pagamento_vencido atingiu repetirPorDias");
          continue;
        }
      }

      const resumo = await calcularResumoFinanceiroContato(escritorioId, {
        contatoId: params.contatoId,
        clienteAsaasId: params.clienteAsaasId,
      });
      const contato = await resolverContatoAsaas(escritorioId, {
        contatoId: params.contatoId,
        clienteAsaasId: params.clienteAsaasId,
      });

      const contexto: SmartflowContexto = {
        mensagem: `Cobrança vencida: ${params.descricao}`,
        pagamentoId: params.pagamentoId,
        pagamentoValor: params.valor,
        pagamentoDescricao: params.descricao,
        vencimento: params.vencimento,
        diasAtraso: diasAtrasoAtual,
        nomeCliente: params.clienteNome || contato.nome,
        telefoneCliente: contato.telefone,
        emailCliente: contato.email,
        contatoId: contato.contatoId ?? params.contatoId,
        atendenteResponsavelId: contato.atendenteResponsavelId,
        cliente: { campos: contato.camposPersonalizados || {} },
        valorTotalCliente: resumo.valorTotalCliente,
        percentualPago: resumo.percentualPago,
        ...(slotChave ? { slotTimestamp: slotChave } : {}),
      };

      await executarCenarioCarregado(escritorioId, c, contexto, {
        contatoId: contato.contatoId ?? params.contatoId,
      });
      disparados++;
    }
    return { executou: disparados > 0, cenariosDisparados: disparados };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro em dispararPagamentoVencido");
    return { executou: false, cenariosDisparados: 0 };
  }
}

/**
 * Dispara cenários com gatilho `pagamento_proximo_vencimento`.
 * Chamado pelo cobrancas-scheduler (cron diário).
 *
 * Cada cenário pode configurar `configGatilho.diasAntes` (antecedência em
 * dias). Só dispara se `diasAteVencimento <= diasAntes`. Default: 3 dias.
 * Dedupe por (cenarioId, pagamentoId) na janela de 24h.
 */
export async function dispararProximoVencimento(
  escritorioId: number,
  params: {
    pagamentoId: string;
    valor: number;
    descricao: string;
    vencimento: string;
    clienteNome?: string;
    contatoId?: number;
    slotTimestamp?: Date;
  },
): Promise<{ executou: boolean; cenariosDisparados: number }> {
  try {
    const cenarios = await carregarCenariosAtivos(escritorioId, ["pagamento_proximo_vencimento"]);
    if (cenarios.length === 0) return { executou: false, cenariosDisparados: 0 };

    const vencimento = parseVencimento(params.vencimento);
    if (!vencimento) return { executou: false, cenariosDisparados: 0 };
    const diasAteVencer = diasEntre(vencimento, new Date());
    if (diasAteVencer < 0) return { executou: false, cenariosDisparados: 0 }; // já venceu

    const slotChave = params.slotTimestamp ? slotTimestampChave(params.slotTimestamp) : null;

    let disparados = 0;
    for (const c of cenarios) {
      const cfg = c.configGatilho as ConfigGatilhoPagamentoProximoVencimento;
      if (!deveDispararProximo(cfg, diasAteVencer)) continue;

      if (await jaDisparouPagamento(c.cenarioId, params.pagamentoId, slotChave)) continue;

      const limite = Math.max(1, Math.floor(Number(cfg?.repetirPorDias ?? 1)));
      if (temHorarioConfigurado(cfg)) {
        const disparadosDias = await diasDistintosDisparados(c.cenarioId, params.pagamentoId);
        if (disparadosDias >= limite) continue;
      }

      const resumo = await calcularResumoFinanceiroContato(escritorioId, {
        contatoId: params.contatoId,
      });
      const contato = await resolverContatoAsaas(escritorioId, {
        contatoId: params.contatoId,
      });

      const contexto: SmartflowContexto = {
        mensagem: `Cobrança vence em ${diasAteVencer} dia(s): ${params.descricao}`,
        pagamentoId: params.pagamentoId,
        pagamentoValor: params.valor,
        pagamentoDescricao: params.descricao,
        vencimento: params.vencimento,
        diasAteVencer,
        nomeCliente: params.clienteNome || contato.nome,
        telefoneCliente: contato.telefone,
        emailCliente: contato.email,
        contatoId: contato.contatoId ?? params.contatoId,
        atendenteResponsavelId: contato.atendenteResponsavelId,
        cliente: { campos: contato.camposPersonalizados || {} },
        valorTotalCliente: resumo.valorTotalCliente,
        percentualPago: resumo.percentualPago,
        ...(slotChave ? { slotTimestamp: slotChave } : {}),
      };

      await executarCenarioCarregado(escritorioId, c, contexto, {
        contatoId: contato.contatoId ?? params.contatoId,
      });
      disparados++;
    }
    return { executou: disparados > 0, cenariosDisparados: disparados };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro em dispararProximoVencimento");
    return { executou: false, cenariosDisparados: 0 };
  }
}

/**
 * Dispara cenários com gatilho `agendamento_lembrete`. Chamado pelo
 * calcom-lembretes-scheduler quando a janela de lembrete de um booking
 * cai no ciclo atual. Dedupe por (cenário, booking) na janela de 48h —
 * cada booking só recebe 1 lembrete.
 */
export async function dispararAgendamentoLembrete(
  escritorioId: number,
  params: {
    bookingId: string | number;
    titulo?: string;
    startTime?: string;
    endTime?: string;
    participanteNome?: string;
    participanteEmail?: string;
    organizadorEmail?: string;
  },
): Promise<{ executou: boolean }> {
  try {
    const cenarios = await carregarCenariosAtivos(escritorioId, ["agendamento_lembrete"]);
    if (cenarios.length === 0) return { executou: false };

    const bookingKey = String(params.bookingId);
    // Dedupe: reusa `jaDisparouPagamento` tratando o bookingId como pagamentoId —
    // o match por substring `"pagamentoId":"<ID>"` funciona pra qualquer ID no
    // contexto. Vamos passar bookingKey no pagamentoId do contexto.
    // Mais simples: checar contexto manualmente aqui.

    const db = await getDb();
    if (!db) return { executou: false };
    const desde = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const execs = await db
      .select({ contexto: smartflowExecucoes.contexto, cenarioId: smartflowExecucoes.cenarioId })
      .from(smartflowExecucoes)
      .where(gte(smartflowExecucoes.createdAt, desde));

    let executou = false;
    for (const c of cenarios) {
      const duplicado = execs.some(
        (r) =>
          r.cenarioId === c.cenarioId &&
          (r.contexto || "").includes(`"agendamentoId":"${bookingKey}"`),
      );
      if (duplicado) continue;

      const contexto: SmartflowContexto = {
        mensagem: `Lembrete de agendamento: ${params.titulo || ""}`.trim(),
        agendamentoId: bookingKey,
        horarioEscolhido: params.startTime,
        agendamentoFim: params.endTime,
        nomeCliente: params.participanteNome,
        emailCliente: params.participanteEmail,
        organizadorEmail: params.organizadorEmail,
      };
      await executarCenarioCarregado(escritorioId, c, contexto);
      executou = true;
    }
    return { executou };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro em agendamento_lembrete");
    return { executou: false };
  }
}

/**
 * Dispara cenários quando chega uma mensagem em qualquer canal (WhatsApp QR,
 * WhatsApp Cloud, Instagram, Facebook).
 *
 * Seleção de cenário:
 *   1. Cenários com gatilho `mensagem_canal` cujo `configGatilho.canais`
 *      inclua o canalTipo (ou esteja vazio = aceita qualquer canal).
 *   2. Se nenhum `mensagem_canal` bater e `canalTipo === 'whatsapp_qr'`,
 *      faz fallback para cenários `whatsapp_mensagem` (backward-compat).
 *
 * Retorna `executou=true` se algum cenário rodou — nesse caso o chatbot
 * padrão NÃO deve responder.
 */
export async function dispararMensagemCanal(
  escritorioId: number,
  params: {
    canalTipo: TipoCanalMensagem;
    canalId: number;
    conversaId: number;
    contatoId: number;
    mensagem: string;
    telefone: string;
    nomeCliente: string;
  },
): Promise<{ executou: boolean; respostas: string[]; execId?: number }> {
  const db = await getDb();
  if (!db) return { executou: false, respostas: [] };

  try {
    // Humano assumiu a conversa? Ignora SmartFlow.
    if (params.conversaId) {
      const { conversas } = await import("../../drizzle/schema");
      const [conv] = await db
        .select({ status: conversas.status })
        .from(conversas)
        .where(eq(conversas.id, params.conversaId))
        .limit(1);
      if (conv?.status === "em_atendimento") {
        log.debug({ conversaId: params.conversaId }, "SmartFlow: conversa em_atendimento — ignorando");
        return { executou: false, respostas: [] };
      }
    }

    // Lê campos personalizados do cliente (definidos em Configurações)
    // pra disponibilizar como `cliente.campos.<chave>` no contexto.
    const camposCliente = await lerCamposPersonalizados(escritorioId, params.contatoId);

    const contexto: SmartflowContexto = {
      mensagem: params.mensagem,
      nomeCliente: params.nomeCliente,
      telefoneCliente: params.telefone,
      contatoId: params.contatoId,
      conversaId: params.conversaId,
      canalId: params.canalId,
      canalTipo: params.canalTipo,
      cliente: { campos: camposCliente },
    };

    // 1. Tenta cenários `mensagem_canal` com filtro de canal
    const cenariosMC = await carregarCenariosAtivos(escritorioId, ["mensagem_canal"]);
    const aceitos = cenariosMC.filter((c) =>
      aceitaCanal(c.configGatilho as ConfigGatilhoMensagemCanal, params.canalTipo),
    );

    if (aceitos.length > 0) {
      const escolhido = aceitos[0];
      const r = await executarCenarioCarregado(escritorioId, escolhido, contexto, {
        contatoId: params.contatoId,
        conversaId: params.conversaId,
      });
      return { executou: true, respostas: r.respostas, execId: r.execId };
    }

    // 2. Fallback: cenário antigo `whatsapp_mensagem` só pra WhatsApp QR
    if (params.canalTipo === "whatsapp_qr") {
      const r = await executarCenarioPorGatilho(
        escritorioId,
        "whatsapp_mensagem",
        contexto,
        { contatoId: params.contatoId, conversaId: params.conversaId },
      );
      return { executou: r.executou, respostas: r.respostas, execId: r.execId };
    }

    return { executou: false, respostas: [] };
  } catch (err: any) {
    log.error({ err: err.message, escritorioId, canalTipo: params.canalTipo }, "SmartFlow: erro em dispararMensagemCanal");
    return { executou: false, respostas: [] };
  }
}

/**
 * @deprecated Use `dispararMensagemCanal` com `canalTipo` explícito.
 * Mantido por compatibilidade: assume canalTipo='whatsapp_qr'.
 */
export async function tentarSmartFlow(
  escritorioId: number,
  canalId: number,
  conversaId: number,
  contatoId: number,
  mensagem: string,
  telefone: string,
  nomeCliente: string,
): Promise<{ executou: boolean; respostas: string[] }> {
  return dispararMensagemCanal(escritorioId, {
    canalTipo: "whatsapp_qr",
    canalId,
    conversaId,
    contatoId,
    mensagem,
    telefone,
    nomeCliente,
  });
}

/**
 * Dispara cenários com gatilho "novo_lead".
 * Chamado pelo whatsapp-handler quando um contato novo é criado via WhatsApp
 * (ou por qualquer outro ponto que registre lead).
 */
export async function dispararNovoLead(
  escritorioId: number,
  params: {
    contatoId: number;
    nome?: string;
    telefone?: string;
    email?: string;
    origem?: string;
    conversaId?: number;
  },
): Promise<{ executou: boolean }> {
  try {
    const contexto: SmartflowContexto = {
      mensagem: `Novo lead: ${params.nome || params.telefone || ""}`.trim(),
      contatoId: params.contatoId,
      conversaId: params.conversaId,
      nomeCliente: params.nome,
      telefoneCliente: params.telefone,
      emailCliente: params.email,
      origemLead: params.origem,
    };
    const r = await executarCenarioPorGatilho(escritorioId, "novo_lead", contexto, {
      contatoId: params.contatoId,
      conversaId: params.conversaId,
    });
    return { executou: r.executou };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro em novo_lead");
    return { executou: false };
  }
}

/**
 * Dispara cenários com gatilho "agendamento_criado".
 * Chamado pelo webhook do Cal.com em BOOKING_CREATED.
 */
export async function dispararAgendamentoCriado(
  escritorioId: number,
  params: {
    bookingId: string | number;
    titulo?: string;
    startTime?: string;
    endTime?: string;
    participanteNome?: string;
    participanteEmail?: string;
    organizadorEmail?: string;
  },
): Promise<{ executou: boolean }> {
  try {
    const contexto: SmartflowContexto = {
      mensagem: `Agendamento criado: ${params.titulo || ""}`.trim(),
      agendamentoId: String(params.bookingId),
      horarioEscolhido: params.startTime,
      agendamentoFim: params.endTime,
      nomeCliente: params.participanteNome,
      emailCliente: params.participanteEmail,
      organizadorEmail: params.organizadorEmail,
    };
    const r = await executarCenarioPorGatilho(escritorioId, "agendamento_criado", contexto);
    return { executou: r.executou };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro em agendamento_criado");
    return { executou: false };
  }
}

/**
 * Dispara cenários com gatilho `agendamento_cancelado`.
 * Chamado pelo webhook do Cal.com em BOOKING_CANCELLED.
 */
export async function dispararAgendamentoCancelado(
  escritorioId: number,
  params: {
    bookingId: string | number;
    titulo?: string;
    startTime?: string;
    endTime?: string;
    participanteNome?: string;
    participanteEmail?: string;
    organizadorEmail?: string;
    motivo?: string;
  },
): Promise<{ executou: boolean }> {
  try {
    const contexto: SmartflowContexto = {
      mensagem: `Agendamento cancelado: ${params.titulo || ""}`.trim(),
      agendamentoId: String(params.bookingId),
      horarioEscolhido: params.startTime,
      agendamentoFim: params.endTime,
      nomeCliente: params.participanteNome,
      emailCliente: params.participanteEmail,
      organizadorEmail: params.organizadorEmail,
      motivoCancelamento: params.motivo,
    };
    const r = await executarCenarioPorGatilho(escritorioId, "agendamento_cancelado", contexto);
    return { executou: r.executou };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro em agendamento_cancelado");
    return { executou: false };
  }
}

/**
 * Dispara cenários com gatilho `agendamento_remarcado`.
 * Chamado pelo webhook do Cal.com em BOOKING_RESCHEDULED.
 */
export async function dispararAgendamentoRemarcado(
  escritorioId: number,
  params: {
    bookingId: string | number;
    titulo?: string;
    startTimeNovo?: string;
    startTimeAntigo?: string;
    endTimeNovo?: string;
    participanteNome?: string;
    participanteEmail?: string;
    organizadorEmail?: string;
  },
): Promise<{ executou: boolean }> {
  try {
    const contexto: SmartflowContexto = {
      mensagem: `Agendamento remarcado: ${params.titulo || ""}`.trim(),
      agendamentoId: String(params.bookingId),
      horarioEscolhido: params.startTimeNovo,
      horarioAnterior: params.startTimeAntigo,
      agendamentoFim: params.endTimeNovo,
      nomeCliente: params.participanteNome,
      emailCliente: params.participanteEmail,
      organizadorEmail: params.organizadorEmail,
    };
    const r = await executarCenarioPorGatilho(escritorioId, "agendamento_remarcado", contexto);
    return { executou: r.executou };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro em agendamento_remarcado");
    return { executou: false };
  }
}

/**
 * Execução manual — chamada pelo botão "Executar agora" no frontend.
 * Diferente dos outros: precisa de cenarioId (não descobre por gatilho)
 * e aceita contexto arbitrário do usuário.
 */
export async function executarManual(
  escritorioId: number,
  cenarioId: number,
  contextoInicial: SmartflowContexto = {},
): Promise<{ executou: boolean; execId?: number; erro?: string; respostas: string[] }> {
  try {
    const cenario = await carregarCenarioPorId(escritorioId, cenarioId);
    if (!cenario) return { executou: false, erro: "Cenário não encontrado", respostas: [] };
    if (!cenario.ativo) return { executou: false, erro: "Cenário está inativo", respostas: [] };
    if (cenario.passos.length === 0) return { executou: false, erro: "Cenário sem passos", respostas: [] };

    const execId = await criarExecucao(escritorioId, cenario.cenarioId, contextoInicial);
    if (!execId) return { executou: false, erro: "Falha ao registrar execução", respostas: [] };

    const executores = criarExecutoresReais(escritorioId);
    const resultado = await executarCenario(cenario.passos, contextoInicial, executores);
    await finalizarExecucao(execId, resultado);

    log.info(
      { cenarioId, execId, sucesso: resultado.sucesso },
      `SmartFlow: execução manual "${cenario.nome}"`,
    );

    return {
      executou: resultado.sucesso,
      execId,
      erro: resultado.erro,
      respostas: resultado.respostas,
    };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro em executarManual");
    return { executou: false, erro: err.message, respostas: [] };
  }
}

/**
 * Retoma uma execução que estava aguardando em passo "esperar".
 * Chamado pelo scheduler quando `retomarEm <= now`.
 *
 * Pula os passos já executados (até `passoAtual`) e continua do próximo.
 */
export async function retomarExecucao(execId: number): Promise<{ retomada: boolean; erro?: string }> {
  const db = await getDb();
  if (!db) return { retomada: false, erro: "DB indisponível" };

  try {
    const [exec] = await db.select().from(smartflowExecucoes).where(eq(smartflowExecucoes.id, execId)).limit(1);
    if (!exec) return { retomada: false, erro: "Execução não encontrada" };
    if (exec.status !== "rodando") return { retomada: false, erro: `Execução em status ${exec.status}` };

    const cenario = await carregarCenarioPorId(exec.escritorioId, exec.cenarioId);
    if (!cenario) return { retomada: false, erro: "Cenário não encontrado" };

    // Pula os passos já executados. `passoAtual` guarda quantos rodaram,
    // incluindo o próprio "esperar" que disparou a pausa, então o próximo
    // índice a executar é passoAtual (0-indexed).
    const passosRestantes = cenario.passos
      .slice()
      .sort((a, b) => a.ordem - b.ordem)
      .slice(exec.passoAtual);

    if (passosRestantes.length === 0) {
      // Nada a retomar — marca como concluído.
      await db
        .update(smartflowExecucoes)
        .set({ status: "concluido", retomarEm: null })
        .where(eq(smartflowExecucoes.id, execId));
      return { retomada: true };
    }

    const contextoBase: SmartflowContexto = exec.contexto ? JSON.parse(exec.contexto) : {};
    // Limpa flags de espera antes de continuar, senão o finalizar interpreta
    // como se tivesse pedido outra pausa.
    delete (contextoBase as any).esperando;
    delete (contextoBase as any).delayMinutos;

    const executores = criarExecutoresReais(exec.escritorioId);
    const resultado = await executarCenario(passosRestantes, contextoBase, executores);

    // Ajusta passosExecutados pra refletir o total acumulado.
    const totalResultado: ExecutarCenarioResultado = {
      ...resultado,
      passosExecutados: exec.passoAtual + resultado.passosExecutados,
    };

    await finalizarExecucao(execId, totalResultado);
    log.info({ execId, sucesso: resultado.sucesso }, "SmartFlow: execução retomada");
    return { retomada: true };
  } catch (err: any) {
    log.error({ err: err.message, execId }, "SmartFlow: erro ao retomar execução");
    // Marca a execução como erro pra não ficar presa em loop.
    try {
      await db
        .update(smartflowExecucoes)
        .set({ status: "erro", erro: err.message, retomarEm: null })
        .where(eq(smartflowExecucoes.id, execId));
    } catch {
      /* ignore */
    }
    return { retomada: false, erro: err.message };
  }
}
