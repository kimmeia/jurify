/**
 * SmartFlow Dispatcher — intercepta eventos e dispara cenários.
 *
 * Quando uma mensagem WhatsApp chega, verifica se há cenário ativo
 * com gatilho "whatsapp_mensagem" e executa o engine.
 */

import { getDb } from "../db";
import { smartflowCenarios, smartflowPassos, smartflowExecucoes } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { executarCenario, Passo, PassoConfig, SmartflowContexto } from "./engine";
import { criarExecutoresReais } from "./executores";
import { createLogger } from "../_core/logger";

const log = createLogger("smartflow-dispatcher");

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
    valor: number; // centavos
    descricao: string;
    tipo: string; // BOLETO, PIX, CREDIT_CARD
    assinaturaId?: string;
    clienteNome?: string;
    clienteEmail?: string;
    clienteAsaasId?: string;
  },
): Promise<{ executou: boolean }> {
  const db = await getDb();
  if (!db) return { executou: false };

  try {
    // Busca cenários com gatilho pagamento_recebido
    const cenarios = await db.select().from(smartflowCenarios)
      .where(and(
        eq(smartflowCenarios.escritorioId, escritorioId),
        eq(smartflowCenarios.gatilho, "pagamento_recebido"),
        eq(smartflowCenarios.ativo, true),
      ))
      .limit(1);

    if (cenarios.length === 0) return { executou: false };
    const cenario = cenarios[0];

    const passos = await db.select().from(smartflowPassos)
      .where(eq(smartflowPassos.cenarioId, cenario.id))
      .orderBy(smartflowPassos.ordem);

    if (passos.length === 0) return { executou: false };

    const passosEngine = passos.map((p) => ({
      id: p.id, ordem: p.ordem, tipo: p.tipo,
      config: p.config ? JSON.parse(p.config) : {},
    }));

    // Verificar se já existe card Kanban com esse pagamentoId (evita duplicata)
    const { kanbanCards } = await import("../../drizzle/schema");
    const [cardExistente] = await db.select({ id: kanbanCards.id }).from(kanbanCards)
      .where(eq(kanbanCards.asaasPaymentId, params.pagamentoId)).limit(1);

    const contexto = {
      mensagem: `Pagamento recebido: ${params.descricao}`,
      pagamentoId: params.pagamentoId,
      pagamentoValor: params.valor,
      pagamentoDescricao: params.descricao,
      pagamentoTipo: params.tipo,
      assinaturaId: params.assinaturaId || "",
      primeiraCobranca: !cardExistente, // true se não tem card ainda
      nomeCliente: params.clienteNome,
    };

    // Registra execução
    const [execResult] = await db.insert(smartflowExecucoes).values({
      cenarioId: cenario.id, escritorioId, status: "rodando",
      contexto: JSON.stringify(contexto),
    });
    const execId = (execResult as { insertId: number }).insertId;

    const executores = criarExecutoresReais(escritorioId);
    const resultado = await executarCenario(passosEngine, contexto, executores);

    await db.update(smartflowExecucoes).set({
      status: resultado.sucesso ? "concluido" : "erro",
      passoAtual: resultado.passosExecutados,
      contexto: JSON.stringify(resultado.contexto),
      erro: resultado.erro || null,
    }).where(eq(smartflowExecucoes.id, execId));

    log.info({ cenarioId: cenario.id, execId, sucesso: resultado.sucesso }, `SmartFlow: pagamento processado`);
    return { executou: true };
  } catch (err: any) {
    log.error({ err: err.message }, "SmartFlow: erro ao processar pagamento");
    return { executou: false };
  }
}

/**
 * Tenta processar uma mensagem WhatsApp via SmartFlow.
 * Retorna true se um cenário foi executado, false se não há cenário ativo.
 *
 * Se retorna true, o chatbot padrão NÃO deve responder (SmartFlow assumiu).
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
  const db = await getDb();
  if (!db) return { executou: false, respostas: [] };

  try {
    // Se a conversa está "em_atendimento" (humano assumiu), NÃO executa SmartFlow
    if (conversaId) {
      const { conversas } = await import("../../drizzle/schema");
      const [conv] = await db.select({ status: conversas.status }).from(conversas)
        .where(eq(conversas.id, conversaId)).limit(1);
      if (conv?.status === "em_atendimento") {
        log.debug({ conversaId }, "SmartFlow: conversa em_atendimento (humano) — ignorando");
        return { executou: false, respostas: [] };
      }
    }

    // Busca cenários ativos com gatilho whatsapp_mensagem
    const cenarios = await db
      .select()
      .from(smartflowCenarios)
      .where(
        and(
          eq(smartflowCenarios.escritorioId, escritorioId),
          eq(smartflowCenarios.gatilho, "whatsapp_mensagem"),
          eq(smartflowCenarios.ativo, true),
        ),
      )
      .limit(1);

    if (cenarios.length === 0) return { executou: false, respostas: [] };

    const cenario = cenarios[0];

    // Busca passos do cenário
    const passos = await db
      .select()
      .from(smartflowPassos)
      .where(eq(smartflowPassos.cenarioId, cenario.id))
      .orderBy(smartflowPassos.ordem);

    if (passos.length === 0) return { executou: false, respostas: [] };

    // Converte passos do banco pro formato do engine
    const passosEngine: Passo[] = passos.map((p) => ({
      id: p.id,
      ordem: p.ordem,
      tipo: p.tipo,
      config: p.config ? JSON.parse(p.config) : {},
    }));

    // Contexto inicial
    const contexto: SmartflowContexto = {
      mensagem,
      nomeCliente,
      telefoneCliente: telefone,
      contatoId,
      conversaId,
      canalId,
    };

    // Registra execução
    const [execResult] = await db.insert(smartflowExecucoes).values({
      cenarioId: cenario.id,
      escritorioId,
      contatoId,
      conversaId,
      status: "rodando",
      contexto: JSON.stringify(contexto),
    });
    const execId = (execResult as { insertId: number }).insertId;

    // Executa cenário com executores reais
    const executores = criarExecutoresReais(escritorioId);
    const resultado = await executarCenario(passosEngine, contexto, executores);

    // Atualiza execução
    await db
      .update(smartflowExecucoes)
      .set({
        status: resultado.sucesso ? "concluido" : "erro",
        passoAtual: resultado.passosExecutados,
        contexto: JSON.stringify(resultado.contexto),
        erro: resultado.erro || null,
      })
      .where(eq(smartflowExecucoes.id, execId));

    log.info(
      { cenarioId: cenario.id, execId, passos: resultado.passosExecutados, sucesso: resultado.sucesso },
      `SmartFlow: cenário "${cenario.nome}" executado`,
    );

    return { executou: true, respostas: resultado.respostas };
  } catch (err: any) {
    log.error({ err: err.message, escritorioId }, "SmartFlow: erro no dispatcher");
    return { executou: false, respostas: [] };
  }
}
