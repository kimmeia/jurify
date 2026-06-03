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
import {
  listarBloqueios,
  criarBloqueio,
  excluirBloqueio,
  importarFeriadosNacionais,
} from "./db-agenda-bloqueios";

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
      contatoId: z.number().optional(),
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
        contatoId: input.contatoId,
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

  // ─── Bloqueios da agenda (feriados + indisponibilidades) ──────────────
  // O gerador de slots livres da IA (smartflow) consulta esses bloqueios
  // pra não oferecer dias/horários indisponíveis ao cliente.

  bloqueiosListar: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    return listarBloqueios(esc.escritorio.id);
  }),

  bloqueioCriar: protectedProcedure
    .input(z.object({
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser YYYY-MM-DD"),
      horaInicio: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      horaFim: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      motivo: z.string().max(200).optional().nullable(),
      recorrenteAnual: z.boolean().optional(),
    }).refine(
      (d) => (!d.horaInicio && !d.horaFim) || (!!d.horaInicio && !!d.horaFim),
      { message: "Informe horaInicio E horaFim juntos, ou nenhum (= dia inteiro)" },
    ).refine(
      (d) => !d.horaInicio || !d.horaFim || d.horaInicio < d.horaFim,
      { message: "horaFim deve ser maior que horaInicio" },
    ))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado");
      const id = await criarBloqueio({
        escritorioId: esc.escritorio.id,
        data: input.data,
        horaInicio: input.horaInicio ?? null,
        horaFim: input.horaFim ?? null,
        motivo: input.motivo ?? null,
        recorrenteAnual: input.recorrenteAnual ?? false,
        criadoPorId: esc.colaborador.id,
      });
      return { id };
    }),

  bloqueioExcluir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado");
      await excluirBloqueio(esc.escritorio.id, input.id);
      return { ok: true };
    }),

  bloqueioImportarFeriadosNacionais: protectedProcedure
    .input(z.object({ ano: z.number().int().min(2020).max(2100) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado");
      return importarFeriadosNacionais({
        escritorioId: esc.escritorio.id,
        ano: input.ano,
        criadoPorId: esc.colaborador.id,
      });
    }),
});
