/**
 * Router tRPC — Configurações: Escritório, Equipe, Convites e Canais
 * Fase 1 + Fase 2
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
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
  obterAutoReplyCanal,
  atualizarAutoReplyCanal,
} from "./db-canais";
import { checkPermission } from "./check-permission";
import type { CargoColaborador } from "../../shared/escritorio-types";
import { PLANO_LIMITES, CUSTO_COLABORADOR_EXTRA, FUSOS_HORARIOS_VALIDOS } from "../../shared/escritorio-types";

/**
 * Checa permissão no módulo `configuracoes` ou `equipe` respeitando o
 * sistema de cargos customizáveis. O dono do escritório sempre passa
 * (applyAction com cargo=dono retorna tudo true). Sobe `Error` claro
 * caso contrário — os chamadores traduziam antes para mensagens
 * específicas do contexto; preservamos a granularidade via argumento.
 */
async function exigirPermissao(
  userId: number,
  modulo: "configuracoes" | "equipe",
  acao: "ver" | "criar" | "editar" | "excluir",
  mensagemNegado: string,
): Promise<void> {
  const perm = await checkPermission(userId, modulo, acao);
  const autorizado =
    acao === "ver"
      ? perm.verTodos || perm.verProprios
      : acao === "criar"
        ? perm.criar
        : acao === "editar"
          ? perm.editar
          : perm.excluir;
  if (!autorizado) throw new Error(mensagemNegado);
}

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
      // Cria automaticamente os 4 cargos padrão (Dono, Gestor, Atendente,
      // Estagiário) com permissões default. Sem isso, aceitarConvite não
      // consegue resolver o cargoPersonalizadoId do convidado e o sistema
      // de permissões granulares fica inerte até o dono clicar manualmente
      // em "Criar Cargos Padrão" na aba Permissões.
      try {
        const { criarCargosDefault } = await import("./router-permissoes");
        await criarCargosDefault(id);
      } catch (err: any) {
        // Best-effort: se falhar, o escritório foi criado com sucesso e o
        // dono pode inicializar manualmente depois.
      }
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
      fusoHorario: z
        .string()
        .max(64)
        .refine((tz) => FUSOS_HORARIOS_VALIDOS.has(tz), {
          message: "Fuso horário inválido. Use um dos valores listados em FUSOS_HORARIOS.",
        })
        .optional(),
      horarioAbertura: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      horarioFechamento: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      diasFuncionamento: z.array(z.string()).optional(),
      mensagemAusencia: z.string().max(1000).optional(),
      mensagemBoasVindas: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await getEscritorioPorUsuario(ctx.user.id);
      if (!result) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "configuracoes", "editar",
        "Sem permissão para editar os dados do escritório.",
      );
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
      await exigirPermissao(
        ctx.user.id, "equipe", "editar",
        "Sem permissão para editar colaboradores.",
      );

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
      await exigirPermissao(
        ctx.user.id, "equipe", "excluir",
        "Sem permissão para remover colaboradores.",
      );
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
      await exigirPermissao(
        ctx.user.id, "equipe", "criar",
        "Sem permissão para convidar colaboradores.",
      );

      const { token, expiresAt } = await criarConvite(
        result.escritorio.id,
        result.colaborador.id,
        input.email,
        input.cargo,
        input.departamento,
      );

      // Enviar email de convite via Resend
      const CARGO_LABELS: Record<string, string> = { gestor: "Gestor", atendente: "Atendente", estagiario: "Estagiário" };
      let emailEnviado = false;
      let emailErro: string | undefined;
      try {
        const { enviarEmailConvite } = await import("../_core/email");
        const resultado = await enviarEmailConvite({
          email: input.email,
          nomeEscritorio: result.escritorio.nome,
          cargo: CARGO_LABELS[input.cargo] || input.cargo,
          token,
          convidadoPor: ctx.user.name || ctx.user.email || "Admin",
        });
        emailEnviado = resultado.success;
        if (!resultado.success) emailErro = resultado.error;
      } catch (err: any) {
        // Falha no email não bloqueia o convite — mas retorna o motivo
        emailErro = err?.message || "Erro inesperado ao enviar email.";
      }

      return { token, expiresAt, emailEnviado, emailErro };
    }),

  /** Lista convites do escritório */
  listarConvites: protectedProcedure.query(async ({ ctx }) => {
    const result = await getEscritorioPorUsuario(ctx.user.id);
    if (!result) return [];
    const perm = await checkPermission(ctx.user.id, "equipe", "ver");
    if (!perm.verTodos && !perm.verProprios) return [];
    return listarConvites(result.escritorio.id);
  }),

  /** Consulta dados públicos de um convite (sem login).
   *  Retorna email, cargo e nome do escritório pra pré-preencher o form
   *  de cadastro na página /convite/:token.
   *  Não expõe dados sensíveis além do que o próprio convidado precisa ver.
   */
  consultarConvite: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { convitesColaborador, escritorios } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [convite] = await db
        .select()
        .from(convitesColaborador)
        .where(eq(convitesColaborador.token, input.token))
        .limit(1);

      if (!convite) return { encontrado: false as const };

      const expirado = new Date(convite.expiresAt) < new Date();
      const status = expirado && convite.status === "pendente" ? "expirado" : convite.status;

      // Busca nome do escritório (informativo, sem expor outros dados)
      const [esc] = await db
        .select({ nome: escritorios.nome })
        .from(escritorios)
        .where(eq(escritorios.id, convite.escritorioId))
        .limit(1);

      return {
        encontrado: true as const,
        email: convite.email,
        cargo: convite.cargo,
        departamento: convite.departamento,
        status,
        nomeEscritorio: esc?.nome || "Escritório",
        expiresAt: convite.expiresAt,
      };
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
      await exigirPermissao(
        ctx.user.id, "equipe", "excluir",
        "Sem permissão para cancelar convites.",
      );
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
      tipo: z.enum([
        "whatsapp_qr",
        "whatsapp_api",
        "instagram",
        "facebook",
        "telefone_voip",
        "calcom",
        "chatgpt",
        "claude",
      ]),
      nome: z.string().max(128),
      telefone: z.string().max(20).optional(),
      config: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "configuracoes", "criar",
        "Sem permissão para criar canais de integração.",
      );

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
      await exigirPermissao(
        ctx.user.id, "configuracoes", "editar",
        "Sem permissão para editar a configuração do canal.",
      );

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
      const perm = await checkPermission(ctx.user.id, "configuracoes", "ver");
      if (!perm.verTodos && !perm.verProprios) return null;
      return obterConfigMascarada(input.canalId, esc.escritorio.id);
    }),

  /** Desconecta canal */
  desconectarCanal: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "configuracoes", "editar",
        "Sem permissão para desconectar canais.",
      );

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
      await exigirPermissao(
        ctx.user.id, "configuracoes", "excluir",
        "Sem permissão para excluir canais.",
      );

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

  /** Lê o auto-reply fixo configurado para o canal (usado no fallback do WhatsApp
   *  quando o SmartFlow não tem cenário pra responder). */
  obterAutoReply: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { texto: null };
      const perm = await checkPermission(ctx.user.id, "configuracoes", "ver");
      if (!perm.verTodos && !perm.verProprios) return { texto: null };
      const texto = await obterAutoReplyCanal(input.canalId);
      return { texto };
    }),

  /** Atualiza o auto-reply fixo do canal. Texto vazio desliga o envio automático. */
  atualizarAutoReply: protectedProcedure
    .input(z.object({
      canalId: z.number(),
      texto: z.string().max(500).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "configuracoes", "editar",
        "Sem permissão para editar auto-reply de canais.",
      );

      await atualizarAutoReplyCanal(input.canalId, esc.escritorio.id, input.texto);

      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: input.canalId,
        acao: "editou_config",
        detalhes: "Auto-reply de fallback atualizado",
      });

      return { success: true };
    }),

  /** Log de auditoria */
  auditLog: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const perm = await checkPermission(ctx.user.id, "configuracoes", "ver");
    if (!perm.verTodos && !perm.verProprios) return [];
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
