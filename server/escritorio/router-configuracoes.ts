/**
 * Router tRPC — Configurações: Escritório, Equipe, Convites e Canais
 * Fase 1 + Fase 2
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getEscritorioPorUsuario,
  criarEscritorio,
  atualizarEscritorio,
  listarColaboradores,
  atualizarColaborador,
  removerColaborador,
  criarConvite,
  listarConvites,
  aceitarConvite,
  cancelarConvite,
  contarColaboradoresAtivos,
} from "./db-escritorio";
import {
  listarCanais,
  criarCanal,
  atualizarConfigCanal,
  obterConfigMascarada,
  atualizarStatusCanal,
  excluirCanal,
  contarCanaisPorTipo,
  registrarAudit,
  listarAuditLog,
} from "./db-canais";
import type { CargoColaborador } from "../../shared/escritorio-types";
import { PLANO_LIMITES, CUSTO_COLABORADOR_EXTRA } from "../../shared/escritorio-types";

export const configuracoesRouter = router({
  /** Busca o escritório do usuário logado (ou null se não tem) */
  meuEscritorio: protectedProcedure.query(async ({ ctx }) => {
    const result = await getEscritorioPorUsuario(ctx.user.id);
    if (!result) return null;

    const { escritorio, colaborador } = result;
    const diasFuncionamento = escritorio.diasFuncionamento
      ? JSON.parse(escritorio.diasFuncionamento as string)
      : ["seg", "ter", "qua", "qui", "sex"];

    return {
      escritorio: {
        ...escritorio,
        diasFuncionamento,
      },
      colaborador: {
        id: colaborador.id,
        cargo: colaborador.cargo as CargoColaborador,
        departamento: colaborador.departamento,
        ativo: colaborador.ativo,
      },
    };
  }),

  /** Heartbeat — registra atividade do colaborador (chamar a cada 5min no frontend) */
  heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await getEscritorioPorUsuario(ctx.user.id);
    if (!result) return { ok: false };
    const { registrarAtividadeColaborador } = await import("./db-crm");
    await registrarAtividadeColaborador(result.colaborador.id);
    return { ok: true };
  }),

  /** Cria escritório (primeiro acesso) */
  criarEscritorio: protectedProcedure
    .input(z.object({
      nome: z.string().min(2).max(255),
      email: z.string().email().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await criarEscritorio(ctx.user.id, input.nome, input.email);
      return { escritorioId: id };
    }),

  /** Atualiza dados do escritório (dono/gestor) */
  atualizarEscritorio: protectedProcedure
    .input(z.object({
      nome: z.string().min(2).max(255).optional(),
      cnpj: z.string().max(18).optional(),
      telefone: z.string().max(20).optional(),
      email: z.string().email().optional().or(z.literal("")),
      endereco: z.string().max(500).optional(),
      fusoHorario: z.string().max(64).optional(),
      horarioAbertura: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      horarioFechamento: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      diasFuncionamento: z.array(z.string()).optional(),
      mensagemAusencia: z.string().max(1000).optional(),
      mensagemBoasVindas: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await getEscritorioPorUsuario(ctx.user.id);
      if (!result) throw new Error("Escritório não encontrado.");
      if (result.colaborador.cargo !== "dono" && result.colaborador.cargo !== "gestor") {
        throw new Error("Apenas donos e gestores podem editar o escritório.");
      }
      await atualizarEscritorio(result.escritorio.id, input);
      return { success: true };
    }),

  // ─── Equipe ───────────────────────────────────────────────────────────────

  /** Lista colaboradores do escritório */
  listarColaboradores: protectedProcedure.query(async ({ ctx }) => {
    const result = await getEscritorioPorUsuario(ctx.user.id);
    if (!result) return { colaboradores: [], total: 0, limite: 1, extras: 0, custoExtras: 0 };

    const lista = await listarColaboradores(result.escritorio.id);
    const ativos = lista.filter(c => c.ativo).length;
    const limite = result.escritorio.maxColaboradores;
    const extras = Math.max(0, ativos - limite);

    return {
      colaboradores: lista,
      total: ativos,
      limite,
      extras,
      custoExtras: extras * CUSTO_COLABORADOR_EXTRA,
    };
  }),

  /** Atualiza dados de um colaborador (dono/gestor) */
  atualizarColaborador: protectedProcedure
    .input(z.object({
      colaboradorId: z.number(),
      cargo: z.enum(["gestor", "atendente", "estagiario"]).optional(),
      departamento: z.string().max(64).optional(),
      ativo: z.boolean().optional(),
      maxAtendimentosSimultaneos: z.number().int().min(1).max(50).optional(),
      recebeLeadsAutomaticos: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await getEscritorioPorUsuario(ctx.user.id);
      if (!result) throw new Error("Escritório não encontrado.");
      if (result.colaborador.cargo !== "dono" && result.colaborador.cargo !== "gestor") {
        throw new Error("Sem permissão.");
      }

      const { colaboradorId, ...dados } = input;
      await atualizarColaborador(colaboradorId, result.escritorio.id, dados);
      return { success: true };
    }),

  /** Remove (desativa) colaborador */
  removerColaborador: protectedProcedure
    .input(z.object({ colaboradorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const result = await getEscritorioPorUsuario(ctx.user.id);
      if (!result) throw new Error("Escritório não encontrado.");
      if (result.colaborador.cargo !== "dono") {
        throw new Error("Apenas o dono pode remover colaboradores.");
      }
      await removerColaborador(input.colaboradorId, result.escritorio.id);
      return { success: true };
    }),

  // ─── Convites ──────────────────────────────────────────────────────────────

  /** Envia convite para novo colaborador */
  enviarConvite: protectedProcedure
    .input(z.object({
      email: z.string().email(),
      cargo: z.enum(["gestor", "atendente", "estagiario"]),
      departamento: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await getEscritorioPorUsuario(ctx.user.id);
      if (!result) throw new Error("Escritório não encontrado.");
      if (result.colaborador.cargo !== "dono" && result.colaborador.cargo !== "gestor") {
        throw new Error("Sem permissão para convidar.");
      }

      const { token, expiresAt } = await criarConvite(
        result.escritorio.id,
        result.colaborador.id,
        input.email,
        input.cargo,
        input.departamento,
      );

      // TODO: Fase 2 — enviar email real com link de convite
      // Por agora retorna o token para copiar manualmente
      return { token, expiresAt };
    }),

  /** Lista convites do escritório */
  listarConvites: protectedProcedure.query(async ({ ctx }) => {
    const result = await getEscritorioPorUsuario(ctx.user.id);
    if (!result) return [];
    if (result.colaborador.cargo !== "dono" && result.colaborador.cargo !== "gestor") return [];
    return listarConvites(result.escritorio.id);
  }),

  /** Aceita convite (usuário logado clica no link) */
  aceitarConvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return aceitarConvite(input.token, ctx.user.id);
    }),

  /** Cancela convite */
  cancelarConvite: protectedProcedure
    .input(z.object({ conviteId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const result = await getEscritorioPorUsuario(ctx.user.id);
      if (!result) throw new Error("Escritório não encontrado.");
      if (result.colaborador.cargo !== "dono" && result.colaborador.cargo !== "gestor") {
        throw new Error("Sem permissão.");
      }
      await cancelarConvite(input.conviteId, result.escritorio.id);
      return { success: true };
    }),

  // ─── Canais / Integrações (Fase 2) ────────────────────────────────────────

  /** Lista canais do escritório */
  listarCanais: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { canais: [], limiteWhatsapp: 0, usadosWhatsapp: 0 };
    const canais = await listarCanais(esc.escritorio.id);
    const contagem = await contarCanaisPorTipo(esc.escritorio.id);
    return {
      canais,
      limiteWhatsapp: esc.escritorio.maxConexoesWhatsapp,
      usadosWhatsapp: contagem["whatsapp"] || 0,
    };
  }),

  /** Cria novo canal */
  criarCanal: protectedProcedure
    .input(z.object({
      tipo: z.enum(["whatsapp_qr", "whatsapp_api", "instagram", "facebook", "telefone_voip"]),
      nome: z.string().max(128),
      telefone: z.string().max(20).optional(),
      config: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") {
        throw new Error("Apenas donos e gestores podem gerenciar canais.");
      }

      // Verificar limite de WhatsApp (DESATIVADO PARA TESTES)
      // if (input.tipo === "whatsapp_qr" || input.tipo === "whatsapp_api") {
      //   const contagem = await contarCanaisPorTipo(esc.escritorio.id);
      //   const whatsappAtual = contagem["whatsapp"] || 0;
      //   if (whatsappAtual >= esc.escritorio.maxConexoesWhatsapp) {
      //     throw new Error(`Limite de ${esc.escritorio.maxConexoesWhatsapp} conexão(ões) WhatsApp atingido. Faça upgrade do plano.`);
      //   }
      // }

      const id = await criarCanal({
        escritorioId: esc.escritorio.id,
        tipo: input.tipo,
        nome: input.nome,
        telefone: input.telefone,
        config: input.config,
      });

      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: id,
        acao: "conectou",
        detalhes: `Canal ${input.tipo} "${input.nome}" criado`,
      });

      return { id };
    }),

  /** Atualiza configuração de um canal */
  atualizarConfigCanal: protectedProcedure
    .input(z.object({
      canalId: z.number(),
      config: z.record(z.string(), z.string()),
      telefone: z.string().max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") {
        throw new Error("Sem permissão.");
      }

      await atualizarConfigCanal(input.canalId, esc.escritorio.id, input.config, input.telefone);

      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: input.canalId,
        acao: "editou_config",
        detalhes: "Configuração atualizada",
      });

      return { success: true };
    }),

  /** Obtém config mascarada (para exibição) */
  verConfigCanal: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") return null;
      return obterConfigMascarada(input.canalId, esc.escritorio.id);
    }),

  /** Desconecta canal */
  desconectarCanal: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") throw new Error("Sem permissão.");

      await atualizarStatusCanal(input.canalId, esc.escritorio.id, "desconectado");
      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: input.canalId,
        acao: "desconectou",
      });
      return { success: true };
    }),

  /** Exclui canal */
  excluirCanal: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono") throw new Error("Apenas o dono pode excluir canais.");

      await excluirCanal(input.canalId, esc.escritorio.id);
      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: input.canalId,
        acao: "desconectou",
        detalhes: "Canal excluído",
      });
      return { success: true };
    }),

  /** Log de auditoria */
  auditLog: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") return [];
    return listarAuditLog(esc.escritorio.id);
  }),

  /** Resumo de uso do plano (limites e consumo atual) */
  uso: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;
    const { obterResumoUso } = await import("../billing/plan-limits");
    return obterResumoUso(esc.escritorio.id, ctx.user.id);
  }),
});
