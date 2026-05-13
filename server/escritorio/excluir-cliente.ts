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
    // Cobranças manuais não passam pelo Asaas — ignora aqui (são
    // deletadas do banco quando o contato é excluído via cascata).
    const cancelaveis = cobrancasDoContato.filter(
      (c): c is typeof c & { asaasPaymentId: string } =>
        c.asaasPaymentId !== null &&
        (c.status === "PENDING" ||
          c.status === "OVERDUE" ||
          c.status === "AWAITING_RISK_ANALYSIS"),
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

  // ─── 2-11. Cascade local (transação atômica) ─────────────────────────────
  //
  // Antes do fix, cada passo abaixo tinha try/catch independente: uma
  // falha no passo 5 deixava asaas_cobrancas + asaas_clientes deletados,
  // mas conversas, leads, etc. órfãos. Sem rastreabilidade boa pra
  // saneamento.
  //
  // Agora envolvemos tudo numa transação. Se qualquer passo falhar:
  //   - rollback automático de todos os deletes locais
  //   - função lança erro (caller mostra "falha — tente de novo")
  //   - Asaas já cancelado (passo 1) fica como está; cobrança no Asaas
  //     em estado CANCELLED + DB local intacto é recuperável
  //     (reativar manualmente ou re-tentar exclusão pula passo 1 porque
  //     status mudou).
  //
  // Step 1 (Asaas API) NÃO entra na transação — chamadas externas longas
  // segurariam transação aberta + impossível rollback de ação remota.
  try {
    await db.transaction(async (tx) => {
      // ─── 2. Cobranças locais ─────────────────────────────────────────
      const delCob = await tx
        .delete(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.escritorioId, escritorioId),
            eq(asaasCobrancas.contatoId, contatoId),
          ),
        );
      const nCob = (delCob as unknown as { affectedRows?: number })?.affectedRows ?? 0;
      log.info({ n: nCob }, "Cobranças locais excluídas");

      // ─── 3. Vínculo Asaas ────────────────────────────────────────────
      await tx
        .delete(asaasClientes)
        .where(
          and(
            eq(asaasClientes.escritorioId, escritorioId),
            eq(asaasClientes.contatoId, contatoId),
          ),
        );

      // ─── 4. Mensagens (via conversas) ────────────────────────────────
      const conversasDoContato = await tx
        .select({ id: conversas.id })
        .from(conversas)
        .where(and(eq(conversas.escritorioId, escritorioId), eq(conversas.contatoId, contatoId)));

      if (conversasDoContato.length > 0) {
        const conversaIds = conversasDoContato.map((c) => c.id);
        const delMsgs = await tx
          .delete(mensagens)
          .where(inArray(mensagens.conversaId, conversaIds));
        resultado.mensagensExcluidas =
          (delMsgs as unknown as { affectedRows?: number })?.affectedRows ?? 0;

        // ─── 5. Conversas ────────────────────────────────────────────
        const delConv = await tx
          .delete(conversas)
          .where(and(eq(conversas.escritorioId, escritorioId), eq(conversas.contatoId, contatoId)));
        resultado.conversasExcluidas =
          (delConv as unknown as { affectedRows?: number })?.affectedRows ?? 0;
      }

      // ─── 6. Leads ────────────────────────────────────────────────────
      const delLeads = await tx
        .delete(leads)
        .where(and(eq(leads.escritorioId, escritorioId), eq(leads.contatoId, contatoId)));
      resultado.leadsExcluidos =
        (delLeads as unknown as { affectedRows?: number })?.affectedRows ?? 0;

      // ─── 7. Tarefas ──────────────────────────────────────────────────
      const delTarefas = await tx
        .delete(tarefas)
        .where(and(eq(tarefas.escritorioId, escritorioId), eq(tarefas.contatoId, contatoId)));
      resultado.tarefasExcluidas =
        (delTarefas as unknown as { affectedRows?: number })?.affectedRows ?? 0;

      // ─── 8. Anotações ────────────────────────────────────────────────
      const delNotas = await tx
        .delete(clienteAnotacoes)
        .where(and(eq(clienteAnotacoes.escritorioId, escritorioId), eq(clienteAnotacoes.contatoId, contatoId)));
      resultado.anotacoesExcluidas =
        (delNotas as unknown as { affectedRows?: number })?.affectedRows ?? 0;

      // ─── 9. Arquivos + pastas (cascade por contatoId, independente da profundidade) ──
      const delArqs = await tx
        .delete(clienteArquivos)
        .where(and(eq(clienteArquivos.escritorioId, escritorioId), eq(clienteArquivos.contatoId, contatoId)));
      resultado.arquivosExcluidos =
        (delArqs as unknown as { affectedRows?: number })?.affectedRows ?? 0;

      await tx
        .delete(clientePastas)
        .where(and(eq(clientePastas.escritorioId, escritorioId), eq(clientePastas.contatoId, contatoId)));

      // ─── 10. Assinaturas digitais ───────────────────────────────────
      const delAssin = await tx
        .delete(assinaturasDigitais)
        .where(and(eq(assinaturasDigitais.escritorioId, escritorioId), eq(assinaturasDigitais.contatoId, contatoId)));
      resultado.assinaturasExcluidas =
        (delAssin as unknown as { affectedRows?: number })?.affectedRows ?? 0;

      // ─── 11. O próprio contato ──────────────────────────────────────
      await tx
        .delete(contatos)
        .where(and(eq(contatos.id, contatoId), eq(contatos.escritorioId, escritorioId)));
    });
    resultado.success = true;
    log.info({ contatoId, resultado }, "Exclusão em cascata concluída");
  } catch (err: any) {
    log.error({ err: err.message, contatoId, escritorioId }, "Cascade local rolled back");
    throw new Error(
      `Não foi possível excluir o cliente (${err.message || "falha na cascata"}). Nenhum dado local foi alterado — tente novamente.`,
    );
  }

  return resultado;
}
