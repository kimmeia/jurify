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
  contextoContemPagamento,
  deveDispararProximo,
  deveDispararVencido,
  diasEntre,
  parseVencimento,
} from "./dispatcher-helpers";
import type {
  GatilhoSmartflow,
  TipoCanalMensagem,
  ConfigGatilhoMensagemCanal,
  ConfigGatilhoPagamentoVencido,
  ConfigGatilhoPagamentoProximoVencimento,
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
): Promise<{ executou: boolean }> {
  const db = await getDb();
  if (!db) return { executou: false };

  try {
    // Pre-flight: só chama se há cenário ativo (evita overhead do kanban lookup)
    const cenario = await carregarCenarioAtivo(escritorioId, "pagamento_recebido");
    if (!cenario) return { executou: false };

    // Verificar se já existe card Kanban com esse pagamentoId (evita duplicata)
    const { kanbanCards } = await import("../../drizzle/schema");
    const [cardExistente] = await db
      .select({ id: kanbanCards.id })
      .from(kanbanCards)
      .where(eq(kanbanCards.asaasPaymentId, params.pagamentoId))
      .limit(1);

    const contexto: SmartflowContexto = {
      mensagem: `Pagamento recebido: ${params.descricao}`,
      pagamentoId: params.pagamentoId,
      pagamentoValor: params.valor,
      pagamentoDescricao: params.descricao,
      pagamentoTipo: params.tipo,
      assinaturaId: params.assinaturaId || "",
      primeiraCobranca: !cardExistente,
      nomeCliente: params.clienteNome,
    };

    const r = await executarCenarioPorGatilho(escritorioId, "pagamento_recebido", contexto);
    return { executou: r.executou };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro ao processar pagamento");
    return { executou: false };
  }
}

/**
 * Checa se já existe execução do cenário `cenarioId` cujo contexto referencia
 * o `pagamentoId` informado nas últimas 24h. Evita disparos duplicados quando
 * o webhook do Asaas chega simultaneamente ao ciclo do cobrancas-scheduler.
 */
async function jaDisparadoPagamento(
  cenarioId: number,
  pagamentoId: string,
  janelaHoras = 24,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
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
  // O contexto é JSON serializado — uma checagem por substring basta
  // pra dedupe, não precisa parsear.
  return execs.some((r) => contextoContemPagamento(r.contexto, pagamentoId));
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
  },
): Promise<{ executou: boolean; cenariosDisparados: number }> {
  try {
    const cenarios = await carregarCenariosAtivos(escritorioId, ["pagamento_vencido"]);
    if (cenarios.length === 0) return { executou: false, cenariosDisparados: 0 };

    const vencimento = parseVencimento(params.vencimento);
    const diasAtrasoAtual = vencimento ? diasEntre(new Date(), vencimento) : 0;

    let disparados = 0;
    for (const c of cenarios) {
      const cfg = c.configGatilho as ConfigGatilhoPagamentoVencido;
      if (!deveDispararVencido(cfg, diasAtrasoAtual)) continue;

      if (await jaDisparadoPagamento(c.cenarioId, params.pagamentoId)) {
        log.debug({ cenarioId: c.cenarioId, pagamentoId: params.pagamentoId }, "SmartFlow: pagamento_vencido já disparado — skip");
        continue;
      }

      const contexto: SmartflowContexto = {
        mensagem: `Cobrança vencida: ${params.descricao}`,
        pagamentoId: params.pagamentoId,
        pagamentoValor: params.valor,
        pagamentoDescricao: params.descricao,
        vencimento: params.vencimento,
        diasAtraso: diasAtrasoAtual,
        nomeCliente: params.clienteNome,
        contatoId: params.contatoId,
      };

      await executarCenarioCarregado(escritorioId, c, contexto, { contatoId: params.contatoId });
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
  },
): Promise<{ executou: boolean; cenariosDisparados: number }> {
  try {
    const cenarios = await carregarCenariosAtivos(escritorioId, ["pagamento_proximo_vencimento"]);
    if (cenarios.length === 0) return { executou: false, cenariosDisparados: 0 };

    const vencimento = parseVencimento(params.vencimento);
    if (!vencimento) return { executou: false, cenariosDisparados: 0 };
    const diasAteVencer = diasEntre(vencimento, new Date());
    if (diasAteVencer < 0) return { executou: false, cenariosDisparados: 0 }; // já venceu

    let disparados = 0;
    for (const c of cenarios) {
      const cfg = c.configGatilho as ConfigGatilhoPagamentoProximoVencimento;
      if (!deveDispararProximo(cfg, diasAteVencer)) continue;

      if (await jaDisparadoPagamento(c.cenarioId, params.pagamentoId)) continue;

      const contexto: SmartflowContexto = {
        mensagem: `Cobrança vence em ${diasAteVencer} dia(s): ${params.descricao}`,
        pagamentoId: params.pagamentoId,
        pagamentoValor: params.valor,
        pagamentoDescricao: params.descricao,
        vencimento: params.vencimento,
        diasAteVencer,
        nomeCliente: params.clienteNome,
        contatoId: params.contatoId,
      };

      await executarCenarioCarregado(escritorioId, c, contexto, { contatoId: params.contatoId });
      disparados++;
    }
    return { executou: disparados > 0, cenariosDisparados: disparados };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro em dispararProximoVencimento");
    return { executou: false, cenariosDisparados: 0 };
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

    const contexto: SmartflowContexto = {
      mensagem: params.mensagem,
      nomeCliente: params.nomeCliente,
      telefoneCliente: params.telefone,
      contatoId: params.contatoId,
      conversaId: params.conversaId,
      canalId: params.canalId,
      canalTipo: params.canalTipo,
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
