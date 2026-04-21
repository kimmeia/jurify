/**
 * Exclusão em cascata de cliente (contato).
 *
 * Quando um cliente é removido do sistema, todos os dados relacionados
 * também devem ser removidos, INCLUINDO cobranças pendentes no Asaas
 * (que rodam num serviço externo e precisam ser explicitamente
 * canceladas — senão continuariam gerando cobranças fantasmas).
 *
 * Ordem de execução:
 *   1. Cancelar cobranças pendentes/em aberto no Asaas (API externa)
 *   2. Deletar espelho local das cobranças (asaas_cobrancas)
 *   3. Deletar vínculo Asaas (asaas_clientes)
 *   4. Deletar mensagens (via conversas)
 *   5. Deletar conversas
 *   6. Deletar leads
 *   7. Deletar tarefas
 *   8. Deletar anotações
 *   9. Deletar arquivos
 *  10. Deletar assinaturas digitais
 *  11. Deletar o próprio contato
 *
 * Se algum passo do Asaas falhar (ex: token inválido), a exclusão local
 * prossegue mesmo assim — não queremos bloquear o usuário por causa de
 * uma integração quebrada. Mas logamos tudo pra auditoria.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  contatos,
  conversas,
  mensagens,
  leads,
  tarefas,
  clienteAnotacoes,
  clienteArquivos,
  clientePastas,
  assinaturasDigitais,
  asaasClientes,
  asaasCobrancas,
} from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("excluir-cliente");

export interface ResultadoExclusao {
  success: boolean;
  cobrancasCanceladas: number;
  cobrancasFalhas: number;
  conversasExcluidas: number;
  mensagensExcluidas: number;
  leadsExcluidos: number;
  tarefasExcluidas: number;
  anotacoesExcluidas: number;
  arquivosExcluidos: number;
  assinaturasExcluidas: number;
}

export async function excluirClienteEmCascata(
  contatoId: number,
  escritorioId: number,
): Promise<ResultadoExclusao> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const resultado: ResultadoExclusao = {
    success: false,
    cobrancasCanceladas: 0,
    cobrancasFalhas: 0,
    conversasExcluidas: 0,
    mensagensExcluidas: 0,
    leadsExcluidos: 0,
    tarefasExcluidas: 0,
    anotacoesExcluidas: 0,
    arquivosExcluidos: 0,
    assinaturasExcluidas: 0,
  };

  // Verifica se o contato existe e pertence ao escritório (segurança)
  const [contato] = await db
    .select({ id: contatos.id, nome: contatos.nome })
    .from(contatos)
    .where(and(eq(contatos.id, contatoId), eq(contatos.escritorioId, escritorioId)))
    .limit(1);
  if (!contato) {
    throw new Error("Cliente não encontrado ou pertence a outro escritório.");
  }

  log.info({ contatoId, nome: contato.nome, escritorioId }, "Iniciando exclusão em cascata");

  // ─── 1. Cancelar cobranças pendentes no Asaas ───────────────────────────
  try {
    const cobrancasDoContato = await db
      .select()
      .from(asaasCobrancas)
      .where(
        and(
          eq(asaasCobrancas.escritorioId, escritorioId),
          eq(asaasCobrancas.contatoId, contatoId),
        ),
      );

    // Só cancelamos cobranças que ainda não foram recebidas.
    // Cobranças já pagas/recebidas ficam no Asaas (histórico fiscal).
    const cancelaveis = cobrancasDoContato.filter(
      (c) =>
        c.status === "PENDING" ||
        c.status === "OVERDUE" ||
        c.status === "AWAITING_RISK_ANALYSIS",
    );

    if (cancelaveis.length > 0) {
      try {
        const { getAsaasClient } = await import("../integracoes/router-asaas");
        const client = await getAsaasClient(escritorioId);

        if (!client) {
          log.warn("Asaas não conectado para este escritório — pulando cancelamento remoto");
          resultado.cobrancasFalhas = cancelaveis.length;
        } else {
          for (const cob of cancelaveis) {
            try {
              await client.excluirCobranca(cob.asaasPaymentId);
              resultado.cobrancasCanceladas++;
              log.info({ paymentId: cob.asaasPaymentId }, "Cobrança cancelada no Asaas");
            } catch (err: any) {
              resultado.cobrancasFalhas++;
              log.warn(
                { paymentId: cob.asaasPaymentId, err: err.message },
                "Falha ao cancelar cobrança no Asaas (prosseguindo)",
              );
            }
          }
        }
      } catch (err: any) {
        log.warn(
          { err: err.message },
          "Asaas indisponível — pulando cancelamento remoto",
        );
        resultado.cobrancasFalhas = cancelaveis.length;
      }
    }
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao listar cobranças (pode ser tabela inexistente)");
  }

  // ─── 2. Deletar espelho local das cobranças ─────────────────────────────
  try {
    const delCob = await db
      .delete(asaasCobrancas)
      .where(
        and(
          eq(asaasCobrancas.escritorioId, escritorioId),
          eq(asaasCobrancas.contatoId, contatoId),
        ),
      );
    const n = (delCob as unknown as { affectedRows?: number })?.affectedRows ?? 0;
    log.info({ n }, "Cobranças locais excluídas");
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao excluir cobranças locais");
  }

  // ─── 3. Deletar vínculo Asaas ───────────────────────────────────────────
  try {
    await db
      .delete(asaasClientes)
      .where(
        and(
          eq(asaasClientes.escritorioId, escritorioId),
          eq(asaasClientes.contatoId, contatoId),
        ),
      );
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao excluir vínculo Asaas");
  }

  // ─── 4. Deletar mensagens (via conversas) ───────────────────────────────
  const conversasDoContato = await db
    .select({ id: conversas.id })
    .from(conversas)
    .where(
      and(eq(conversas.escritorioId, escritorioId), eq(conversas.contatoId, contatoId)),
    );

  if (conversasDoContato.length > 0) {
    const conversaIds = conversasDoContato.map((c) => c.id);
    try {
      const delMsgs = await db
        .delete(mensagens)
        .where(inArray(mensagens.conversaId, conversaIds));
      resultado.mensagensExcluidas =
        (delMsgs as unknown as { affectedRows?: number })?.affectedRows ?? 0;
    } catch (err: any) {
      log.warn({ err: err.message }, "Falha ao excluir mensagens");
    }

    // ─── 5. Deletar conversas ────────────────────────────────────────────
    try {
      const delConv = await db
        .delete(conversas)
        .where(
          and(
            eq(conversas.escritorioId, escritorioId),
            eq(conversas.contatoId, contatoId),
          ),
        );
      resultado.conversasExcluidas =
        (delConv as unknown as { affectedRows?: number })?.affectedRows ?? 0;
    } catch (err: any) {
      log.warn({ err: err.message }, "Falha ao excluir conversas");
    }
  }

  // ─── 6. Leads ────────────────────────────────────────────────────────────
  try {
    const delLeads = await db
      .delete(leads)
      .where(
        and(eq(leads.escritorioId, escritorioId), eq(leads.contatoId, contatoId)),
      );
    resultado.leadsExcluidos =
      (delLeads as unknown as { affectedRows?: number })?.affectedRows ?? 0;
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao excluir leads");
  }

  // ─── 7. Tarefas ──────────────────────────────────────────────────────────
  try {
    const delTarefas = await db
      .delete(tarefas)
      .where(
        and(
          eq(tarefas.escritorioId, escritorioId),
          eq(tarefas.contatoId, contatoId),
        ),
      );
    resultado.tarefasExcluidas =
      (delTarefas as unknown as { affectedRows?: number })?.affectedRows ?? 0;
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao excluir tarefas");
  }

  // ─── 8. Anotações ────────────────────────────────────────────────────────
  try {
    const delNotas = await db
      .delete(clienteAnotacoes)
      .where(
        and(
          eq(clienteAnotacoes.escritorioId, escritorioId),
          eq(clienteAnotacoes.contatoId, contatoId),
        ),
      );
    resultado.anotacoesExcluidas =
      (delNotas as unknown as { affectedRows?: number })?.affectedRows ?? 0;
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao excluir anotações");
  }

  // ─── 9. Arquivos + pastas ────────────────────────────────────────────────
  // Arquivos são deletados por contatoId — cobre tanto os soltos quanto os
  // dentro de qualquer pasta (independente de profundidade). Depois as
  // pastas em si são removidas pelo mesmo filtro de contatoId.
  try {
    const delArqs = await db
      .delete(clienteArquivos)
      .where(
        and(
          eq(clienteArquivos.escritorioId, escritorioId),
          eq(clienteArquivos.contatoId, contatoId),
        ),
      );
    resultado.arquivosExcluidos =
      (delArqs as unknown as { affectedRows?: number })?.affectedRows ?? 0;
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao excluir arquivos");
  }

  try {
    await db
      .delete(clientePastas)
      .where(
        and(
          eq(clientePastas.escritorioId, escritorioId),
          eq(clientePastas.contatoId, contatoId),
        ),
      );
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao excluir pastas");
  }

  // ─── 10. Assinaturas digitais ───────────────────────────────────────────
  try {
    const delAssin = await db
      .delete(assinaturasDigitais)
      .where(
        and(
          eq(assinaturasDigitais.escritorioId, escritorioId),
          eq(assinaturasDigitais.contatoId, contatoId),
        ),
      );
    resultado.assinaturasExcluidas =
      (delAssin as unknown as { affectedRows?: number })?.affectedRows ?? 0;
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao excluir assinaturas");
  }

  // ─── 11. O próprio contato ──────────────────────────────────────────────
  try {
    await db
      .delete(contatos)
      .where(and(eq(contatos.id, contatoId), eq(contatos.escritorioId, escritorioId)));
    resultado.success = true;
    log.info({ contatoId, resultado }, "Exclusão em cascata concluída");
  } catch (err: any) {
    log.error({ err: err.message }, "Falha ao excluir o contato final");
    throw new Error(
      "Não foi possível excluir o cliente. Verifique se não há registros vinculados.",
    );
  }

  return resultado;
}
