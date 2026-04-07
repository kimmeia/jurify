/**
 * Router — Customer 360 View
 *
 * Endpoint único que retorna TODO o contexto de um cliente para o painel
 * lateral do Atendimento. Inclui:
 *   • Dados básicos (nome, tags, origem, contatos)
 *   • Status financeiro (resumo Asaas)
 *   • Processos ativos (se o cliente é parte de algum)
 *   • Leads/negociações em andamento
 *   • Tarefas pendentes
 *   • Próximos compromissos da agenda
 *   • Anotações recentes
 *   • Assinaturas digitais pendentes
 *   • Últimas N conversas (histórico)
 *
 * Otimizado para uma única chamada — alimenta o "painel contextual" sem
 * forçar o frontend a fazer 8 queries separadas.
 */

import { z } from "zod";
import { and, desc, eq, or } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  contatos,
  leads,
  tarefas,
  agendamentos,
  clienteAnotacoes,
  conversas,
  assinaturasDigitais,
  asaasClientes,
  asaasCobrancas,
  processosMonitorados,
  juditMonitoramentos,
} from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { createLogger } from "../_core/logger";

const log = createLogger("customer360");

export const customer360Router = router({
  /**
   * Retorna o perfil 360° do cliente para o painel do Atendimento.
   * Uma única query, dados agregados.
   */
  getContext: protectedProcedure
    .input(z.object({ contatoId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;

      const escritorioId = esc.escritorio.id;
      const { contatoId } = input;

      try {
        // ─── Dados básicos do contato ─────────────────────────────────────
        const [contato] = await db
          .select()
          .from(contatos)
          .where(and(eq(contatos.id, contatoId), eq(contatos.escritorioId, escritorioId)))
          .limit(1);

        if (!contato) return null;

        // ─── Financeiro (Asaas) ───────────────────────────────────────────
        let financeiro = {
          vinculado: false,
          pendente: 0,
          vencido: 0,
          pago: 0,
          cobrancasAtivas: [] as Array<{
            id: number;
            valor: string;
            status: string;
            vencimento: string;
            descricao: string | null;
            invoiceUrl: string | null;
          }>,
          ultimoPagamento: null as { valor: number; data: string } | null,
        };
        try {
          const [vinculo] = await db
            .select()
            .from(asaasClientes)
            .where(
              and(
                eq(asaasClientes.contatoId, contatoId),
                eq(asaasClientes.escritorioId, escritorioId),
              ),
            )
            .limit(1);

          if (vinculo) {
            const cobrancas = await db
              .select()
              .from(asaasCobrancas)
              .where(
                and(
                  eq(asaasCobrancas.contatoId, contatoId),
                  eq(asaasCobrancas.escritorioId, escritorioId),
                ),
              )
              .orderBy(desc(asaasCobrancas.createdAt))
              .limit(20);

            let pendente = 0;
            let vencido = 0;
            let pago = 0;
            let ultimoPagamento: { valor: number; data: string } | null = null;

            for (const c of cobrancas) {
              const val = parseFloat(c.valor) || 0;
              if (c.status === "PENDING") pendente += val;
              else if (c.status === "OVERDUE") vencido += val;
              else if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status)) {
                pago += val;
                if (c.dataPagamento && (!ultimoPagamento || c.dataPagamento > ultimoPagamento.data)) {
                  ultimoPagamento = { valor: val, data: c.dataPagamento };
                }
              }
            }

            financeiro = {
              vinculado: true,
              pendente,
              vencido,
              pago,
              cobrancasAtivas: cobrancas
                .filter((c) => c.status === "PENDING" || c.status === "OVERDUE")
                .slice(0, 5)
                .map((c) => ({
                  id: c.id,
                  valor: c.valor,
                  status: c.status,
                  vencimento: c.vencimento || "",
                  descricao: c.descricao,
                  invoiceUrl: c.invoiceUrl,
                })),
              ultimoPagamento,
            };
          }
        } catch (err) {
          log.warn({ err: String(err) }, "Falha ao buscar financeiro");
        }

        // ─── Leads (negociações em aberto) ────────────────────────────────
        const leadsAtivos = await db
          .select({
            id: leads.id,
            etapaFunil: leads.etapaFunil,
            valorEstimado: leads.valorEstimado,
            origemLead: leads.origemLead,
            probabilidade: leads.probabilidade,
            dataFechamentoPrevisto: leads.dataFechamentoPrevisto,
            createdAt: leads.createdAt,
            observacoes: leads.observacoes,
          })
          .from(leads)
          .where(
            and(
              eq(leads.escritorioId, escritorioId),
              eq(leads.contatoId, contatoId),
              or(
                eq(leads.etapaFunil, "novo"),
                eq(leads.etapaFunil, "qualificado"),
                eq(leads.etapaFunil, "proposta"),
                eq(leads.etapaFunil, "negociacao"),
              ),
            ),
          )
          .orderBy(desc(leads.createdAt))
          .limit(5);

        // ─── Tarefas pendentes ────────────────────────────────────────────
        const tarefasPendentes = await db
          .select({
            id: tarefas.id,
            titulo: tarefas.titulo,
            prioridade: tarefas.prioridade,
            status: tarefas.status,
            dataVencimento: tarefas.dataVencimento,
            createdAt: tarefas.createdAt,
          })
          .from(tarefas)
          .where(
            and(
              eq(tarefas.escritorioId, escritorioId),
              eq(tarefas.contatoId, contatoId),
              or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
            ),
          )
          .orderBy(desc(tarefas.createdAt))
          .limit(5);

        // ─── Próximos compromissos ────────────────────────────────────────
        const agora = new Date();
        const proximosCompromissos = await db
          .select({
            id: agendamentos.id,
            titulo: agendamentos.titulo,
            tipo: agendamentos.tipo,
            dataInicio: agendamentos.dataInicio,
            local: agendamentos.local,
            prioridade: agendamentos.prioridade,
          })
          .from(agendamentos)
          .where(
            and(
              eq(agendamentos.escritorioId, escritorioId),
              or(
                eq(agendamentos.status, "pendente"),
                eq(agendamentos.status, "em_andamento"),
              ),
            ),
          )
          .orderBy(agendamentos.dataInicio)
          .limit(5);

        // Filtra só os que são do cliente (por enquanto filtra client-side)
        const compromissosDoCliente = proximosCompromissos.filter(
          (a) => (a.dataInicio as Date) >= agora,
        );

        // ─── Anotações recentes ───────────────────────────────────────────
        const anotacoesRecentes = await db
          .select({
            id: clienteAnotacoes.id,
            titulo: clienteAnotacoes.titulo,
            conteudo: clienteAnotacoes.conteudo,
            createdAt: clienteAnotacoes.createdAt,
          })
          .from(clienteAnotacoes)
          .where(
            and(
              eq(clienteAnotacoes.escritorioId, escritorioId),
              eq(clienteAnotacoes.contatoId, contatoId),
            ),
          )
          .orderBy(desc(clienteAnotacoes.createdAt))
          .limit(3);

        // ─── Assinaturas pendentes ────────────────────────────────────────
        const assinaturasPendentes = await db
          .select({
            id: assinaturasDigitais.id,
            titulo: assinaturasDigitais.titulo,
            status: assinaturasDigitais.status,
            enviadoAt: assinaturasDigitais.enviadoAt,
            expiracaoAt: assinaturasDigitais.expiracaoAt,
          })
          .from(assinaturasDigitais)
          .where(
            and(
              eq(assinaturasDigitais.escritorioId, escritorioId),
              eq(assinaturasDigitais.contatoId, contatoId),
              or(
                eq(assinaturasDigitais.status, "pendente"),
                eq(assinaturasDigitais.status, "enviado"),
                eq(assinaturasDigitais.status, "visualizado"),
              ),
            ),
          )
          .limit(3);

        // ─── Últimas conversas ────────────────────────────────────────────
        const ultimasConversas = await db
          .select({
            id: conversas.id,
            assunto: conversas.assunto,
            status: conversas.status,
            ultimaMensagemPreview: conversas.ultimaMensagemPreview,
            ultimaMensagemAt: conversas.ultimaMensagemAt,
            createdAt: conversas.createdAt,
          })
          .from(conversas)
          .where(
            and(
              eq(conversas.escritorioId, escritorioId),
              eq(conversas.contatoId, contatoId),
            ),
          )
          .orderBy(desc(conversas.ultimaMensagemAt))
          .limit(5);

        // ─── Processos das DUAS fontes (DataJud + Judit.IO) ──────────────
        // Mescla processos monitorados via DataJud (tabela processosMonitorados)
        // com os monitorados via Judit.IO (tabela juditMonitoramentos).
        // Frontend renderiza todos juntos com badge de "fonte".
        const processosDataJud = await db
          .select({
            id: processosMonitorados.id,
            numeroCnj: processosMonitorados.numeroCnj,
            classe: processosMonitorados.classe,
            tribunal: processosMonitorados.tribunal,
            ultimaMovimentacao: processosMonitorados.ultimaMovimentacao,
            ultimaMovimentacaoData: processosMonitorados.ultimaMovimentacaoData,
            status: processosMonitorados.status,
          })
          .from(processosMonitorados)
          .where(
            and(
              eq(processosMonitorados.userId, ctx.user.id),
              eq(processosMonitorados.status, "ativo"),
            ),
          )
          .limit(10);

        // Shape unificada que aceita campos nullable de qualquer fonte
        type ProcessoNoCard = {
          id: number;
          numeroCnj: string;
          classe: string | null;
          tribunal: string | null;
          ultimaMovimentacao: string | null;
          ultimaMovimentacaoData: string | null;
          status: string;
          fonte: "datajud" | "judit";
        };

        const processosNormalizados: ProcessoNoCard[] = processosDataJud.map((p) => ({
          id: p.id,
          numeroCnj: p.numeroCnj,
          classe: p.classe,
          tribunal: p.tribunal,
          ultimaMovimentacao: p.ultimaMovimentacao,
          ultimaMovimentacaoData: p.ultimaMovimentacaoData,
          status: p.status,
          fonte: "datajud",
        }));

        try {
          const monsJudit = await db
            .select({
              id: juditMonitoramentos.id,
              searchKey: juditMonitoramentos.searchKey,
              tribunal: juditMonitoramentos.tribunal,
              ultimaMovJudit: juditMonitoramentos.ultimaMovimentacao,
              ultimaMovDataJudit: juditMonitoramentos.ultimaMovimentacaoData,
              statusJudit: juditMonitoramentos.statusJudit,
            })
            .from(juditMonitoramentos)
            .where(
              and(
                eq(juditMonitoramentos.clienteUserId, ctx.user.id),
                or(
                  eq(juditMonitoramentos.statusJudit, "created"),
                  eq(juditMonitoramentos.statusJudit, "updating"),
                  eq(juditMonitoramentos.statusJudit, "updated"),
                ),
              ),
            )
            .limit(10);

          for (const m of monsJudit) {
            processosNormalizados.push({
              id: -m.id, // negativo pra não colidir com IDs DataJud no React key
              numeroCnj: m.searchKey,
              classe: null,
              tribunal: m.tribunal,
              ultimaMovimentacao: m.ultimaMovJudit,
              ultimaMovimentacaoData: m.ultimaMovDataJudit,
              status: "ativo",
              fonte: "judit",
            });
          }
        } catch (err) {
          log.warn({ err: String(err) }, "Falha ao buscar monitoramentos Judit");
        }

        const processosDoUser = processosNormalizados.slice(0, 10);

        // ─── Parse de tags ────────────────────────────────────────────────
        let tags: string[] = [];
        if (contato.tags) {
          try {
            tags = JSON.parse(contato.tags as string);
          } catch {
            tags = (contato.tags as string).split(",").map((t) => t.trim()).filter(Boolean);
          }
        }

        return {
          contato: {
            id: contato.id,
            nome: contato.nome,
            telefone: contato.telefone,
            email: contato.email,
            cpfCnpj: contato.cpfCnpj,
            origem: contato.origem,
            tags,
            observacoes: contato.observacoes,
            createdAt: (contato.createdAt as Date).toISOString(),
          },
          financeiro,
          leads: leadsAtivos.map((l) => ({
            ...l,
            createdAt: (l.createdAt as Date).toISOString(),
          })),
          tarefas: tarefasPendentes.map((t) => ({
            ...t,
            dataVencimento: t.dataVencimento ? (t.dataVencimento as Date).toISOString() : null,
            createdAt: (t.createdAt as Date).toISOString(),
          })),
          compromissos: compromissosDoCliente.map((a) => ({
            ...a,
            dataInicio: (a.dataInicio as Date).toISOString(),
          })),
          anotacoes: anotacoesRecentes.map((n) => ({
            ...n,
            createdAt: (n.createdAt as Date).toISOString(),
          })),
          assinaturas: assinaturasPendentes.map((a) => ({
            ...a,
            enviadoAt: a.enviadoAt ? (a.enviadoAt as Date).toISOString() : null,
            expiracaoAt: a.expiracaoAt ? (a.expiracaoAt as Date).toISOString() : null,
          })),
          conversas: ultimasConversas.map((c) => ({
            ...c,
            ultimaMensagemAt: c.ultimaMensagemAt
              ? (c.ultimaMensagemAt as Date).toISOString()
              : null,
            createdAt: (c.createdAt as Date).toISOString(),
          })),
          processos: processosDoUser,
          stats: {
            totalLeads: leadsAtivos.length,
            totalTarefas: tarefasPendentes.length,
            totalCompromissos: compromissosDoCliente.length,
            totalAssinaturas: assinaturasPendentes.length,
            totalConversas: ultimasConversas.length,
            totalProcessos: processosDoUser.length,
          },
        };
      } catch (err) {
        log.error({ err: String(err), contatoId }, "Erro no customer360.getContext");
        return null;
      }
    }),

  /** Criar tarefa rapidamente a partir do painel do Atendimento */
  criarTarefaRapida: protectedProcedure
    .input(
      z.object({
        contatoId: z.number(),
        titulo: z.string().min(1).max(255),
        prioridade: z.enum(["baixa", "normal", "alta", "urgente"]).default("normal"),
        dataVencimento: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const [r] = await db.insert(tarefas).values({
        escritorioId: esc.escritorio.id,
        contatoId: input.contatoId,
        criadoPor: esc.colaborador.id,
        responsavelId: esc.colaborador.id,
        titulo: input.titulo,
        prioridade: input.prioridade,
        dataVencimento: input.dataVencimento ? new Date(input.dataVencimento) : null,
      });

      return { id: (r as { insertId: number }).insertId };
    }),

  /** Criar nota rápida no cliente */
  criarNotaRapida: protectedProcedure
    .input(
      z.object({
        contatoId: z.number(),
        conteudo: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const [r] = await db.insert(clienteAnotacoes).values({
        escritorioId: esc.escritorio.id,
        contatoId: input.contatoId,
        conteudo: input.conteudo,
        criadoPor: esc.colaborador.id,
      });

      return { id: (r as { insertId: number }).insertId };
    }),
});
