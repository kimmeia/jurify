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
