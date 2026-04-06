/**
 * Router tRPC — Agendamento: Compromissos, Prazos e Tarefas
 * Fase 4
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import {
  criarAgendamento,
  listarAgendamentos,
  obterAgendamento,
  atualizarAgendamento,
  excluirAgendamento,
  listarProximosCompromissos,
  contarAgendamentosPorStatus,
} from "./db-agendamento";

export const agendamentoRouter = router({
  /** Lista agendamentos com filtros */
  listar: protectedProcedure
    .input(z.object({
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
      responsavelId: z.number().optional(),
      tipo: z.enum(["prazo_processual", "audiencia", "reuniao_comercial", "tarefa", "follow_up", "outro"]).optional(),
      status: z.enum(["pendente", "em_andamento", "concluido", "cancelado", "atrasado"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      return listarAgendamentos(esc.escritorio.id, input ?? undefined);
    }),

  /** Obtém detalhes de um agendamento */
  detalhe: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;
      return obterAgendamento(input.id, esc.escritorio.id);
    }),

  /** Cria novo agendamento */
  criar: protectedProcedure
    .input(z.object({
      tipo: z.enum(["prazo_processual", "audiencia", "reuniao_comercial", "tarefa", "follow_up", "outro"]),
      titulo: z.string().min(1).max(255),
      descricao: z.string().max(2000).optional(),
      dataInicio: z.string(),
      dataFim: z.string().optional(),
      diaInteiro: z.boolean().optional(),
      local: z.string().max(512).optional(),
      prioridade: z.enum(["baixa", "normal", "alta", "critica"]).optional(),
      responsavelId: z.number().optional(),
      processoId: z.number().optional(),
      corHex: z.string().max(7).optional(),
      lembretes: z.array(z.object({
        tipo: z.enum(["notificacao_app", "email", "whatsapp"]),
        minutosAntes: z.number(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado. Configure seu escritório primeiro.");

      const id = await criarAgendamento({
        escritorioId: esc.escritorio.id,
        criadoPorId: esc.colaborador.id,
        responsavelId: input.responsavelId ?? esc.colaborador.id,
        tipo: input.tipo,
        titulo: input.titulo,
        descricao: input.descricao,
        dataInicio: input.dataInicio,
        dataFim: input.dataFim,
        diaInteiro: input.diaInteiro,
        local: input.local,
        prioridade: input.prioridade,
        processoId: input.processoId,
        corHex: input.corHex,
        lembretes: input.lembretes,
      });

      return { id };
    }),

  /** Atualiza agendamento */
  atualizar: protectedProcedure
    .input(z.object({
      id: z.number(),
      titulo: z.string().min(1).max(255).optional(),
      descricao: z.string().max(2000).optional(),
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
      diaInteiro: z.boolean().optional(),
      local: z.string().max(512).optional(),
      prioridade: z.enum(["baixa", "normal", "alta", "critica"]).optional(),
      status: z.enum(["pendente", "em_andamento", "concluido", "cancelado", "atrasado"]).optional(),
      responsavelId: z.number().optional(),
      tipo: z.enum(["prazo_processual", "audiencia", "reuniao_comercial", "tarefa", "follow_up", "outro"]).optional(),
      corHex: z.string().max(7).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const { id, ...dados } = input;
      await atualizarAgendamento(id, esc.escritorio.id, dados);
      return { success: true };
    }),

  /** Exclui agendamento */
  excluir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      await excluirAgendamento(input.id, esc.escritorio.id);
      return { success: true };
    }),

  /** Próximos compromissos (widget do dashboard) */
  proximos: protectedProcedure
    .input(z.object({ limite: z.number().min(1).max(20).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      return listarProximosCompromissos(esc.escritorio.id, input?.limite ?? 5);
    }),

  /** Contadores por status */
  contadores: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { pendente: 0, em_andamento: 0, concluido: 0, atrasado: 0 };
    return contarAgendamentosPorStatus(esc.escritorio.id);
  }),
});
