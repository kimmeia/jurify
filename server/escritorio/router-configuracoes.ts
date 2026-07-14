/**
 * Router tRPC — Configurações: Escritório, Equipe, Convites e Canais
 * Fase 1 + Fase 2
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  getEscritorioPorUsuario,
  criarEscritorio,
  atualizarEscritorio,
  listarColaboradores,
  atualizarColaborador,
  removerColaborador,
  restaurarColaborador,
  listarColaboradoresRemovidos,
  criarConvite,
  listarConvites,
  aceitarConvite,
  cancelarConvite,
  contarColaboradoresAtivos,
  atualizarStatusEmailConvite,
} from "./db-escritorio";
import {
  listarCanais,
  criarCanal,
  atualizarConfigCanal,
  obterConfigMascarada,
  obterConfigCanal,
  atualizarStatusCanal,
  excluirCanal,
  contarCanaisPorTipo,
  registrarAudit,
  listarAuditLog,
  obterAutoReplyCanal,
  atualizarAutoReplyCanal,
  definirCanalPadraoEnvio,
} from "./db-canais";
import { checkPermission } from "./check-permission";
import type { CargoColaborador } from "../../shared/escritorio-types";
import { CUSTO_COLABORADOR_EXTRA, FUSOS_HORARIOS_VALIDOS } from "../../shared/escritorio-types";

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

/**
 * Valida que o objeto `config` recebido no criarCanal tem os campos
 * obrigatórios do tipo selecionado. Sem isso, um canal entraria no banco
 * com status=conectado mas sem credenciais funcionais — aparece ativo na
 * UI e falha silenciosamente ao enviar mensagens.
 *
 * Para tipos cuja conexão é feita por outro fluxo (QR code presencial,
 * Meta Embedded Signup, Cal.com direto), a config pode vir vazia aqui.
 */
export function validarConfigCanalPorTipo(
  tipo: string,
  config: Record<string, string> | undefined,
): void {
  // Tipos sem requisitos diretos no criarCanal — a conexão real
  // acontece via outro fluxo (QR code, Embedded Signup, OAuth Cal.com).
  const tiposOpcionais = new Set(["whatsapp_api", "instagram", "facebook", "calcom"]);
  if (tiposOpcionais.has(tipo)) return;

  const obrigatorios: Record<string, string[]> = {
    telefone_voip: ["twilioSid", "twilioAuthToken", "twilioPhoneNumber"],
    chatgpt: ["openaiApiKey"],
    claude: ["anthropicApiKey"],
  };

  const campos = obrigatorios[tipo];
  if (!campos) return;

  const missing = campos.filter((k) => {
    const v = config?.[k];
    return typeof v !== "string" || v.trim().length === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `Configuração incompleta para canal ${tipo}. Campos obrigatórios ausentes: ${missing.join(", ")}.`,
    );
  }
}

export const configuracoesRouter = router({
  /** Busca o escritório do usuário logado (ou null se não tem).
   *
   *  Retorna também o setor do colaborador (nome + tipo) e meta mensal.
   *  Frontend usa isso pra decidir qual painel de Dashboard mostrar
   *  (comercial vê fechamentos, operacional vê produção, etc).
   */
  meuEscritorio: protectedProcedure.query(async ({ ctx }) => {
    const result = await getEscritorioPorUsuario(ctx.user.id);
    if (!result) return null;

    const { escritorio, colaborador } = result;
    const diasFuncionamento = escritorio.diasFuncionamento
      ? JSON.parse(escritorio.diasFuncionamento as string)
      : ["seg", "ter", "qua", "qui", "sex"];

    // Cargo personalizado: nome + cor pra renderizar badge correto (sem
    // isso o badge cai no enum legado e mostra "Atendente" pra cargos
    // customizados que viraram esse fallback de permissão mínima).
    let cargoPersonalizadoNome: string | null = null;
    let cargoPersonalizadoCor: string | null = null;
    let setorId: number | null = null;
    let setorNome: string | null = null;
    let setorTipo: "comercial" | "operacional" | "suporte" | "financeiro" | "outro" | null = null;
    let metaMensal: string | null = null;

    const { getDb } = await import("../db");
    const db = await getDb();
    if (db) {
      if (colaborador.cargoPersonalizadoId) {
        const { cargosPersonalizados } = await import("../../drizzle/schema");
        const [cp] = await db
          .select({ nome: cargosPersonalizados.nome, cor: cargosPersonalizados.cor })
          .from(cargosPersonalizados)
          .where(eq(cargosPersonalizados.id, colaborador.cargoPersonalizadoId))
          .limit(1);
        cargoPersonalizadoNome = cp?.nome ?? null;
        cargoPersonalizadoCor = cp?.cor ?? null;
      }

      // Setor do colaborador — fonte da verdade pro painel do Dashboard.
      // setorId é opcional; quando vazio cai no fallback "Geral" no frontend.
      const colId = (colaborador as any).setorId as number | null | undefined;
      if (colId) {
        const { setores } = await import("../../drizzle/schema");
        const [s] = await db
          .select({ id: setores.id, nome: setores.nome, tipo: setores.tipo })
          .from(setores)
          .where(eq(setores.id, colId))
          .limit(1);
        if (s) {
          setorId = s.id;
          setorNome = s.nome;
          setorTipo = s.tipo as "comercial" | "operacional" | "suporte" | "financeiro" | "outro";
        }
      }
      metaMensal = (colaborador as any).metaMensal ?? null;
    }

    return {
      escritorio: {
        ...escritorio,
        diasFuncionamento,
      },
      colaborador: {
        id: colaborador.id,
        cargo: colaborador.cargo as CargoColaborador,
        cargoPersonalizadoId: colaborador.cargoPersonalizadoId,
        cargoPersonalizadoNome,
        cargoPersonalizadoCor,
        departamento: colaborador.departamento,
        setorId,
        setorNome,
        setorTipo,
        metaMensal,
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
      oab: z.string().max(32).optional(),
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
      agendaResponsavelPadraoId: z.number().int().positive().nullable().optional(),
      msgDividirRespostas: z.boolean().optional(),
      msgDividirMax: z.number().int().min(2).max(6).optional(),
      msgDividirRitmo: z.enum(["rapido", "natural", "calmo"]).optional(),
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

  /** Lista colaboradores do escritório (gestão de equipe) */
  listarColaboradores: protectedProcedure.query(async ({ ctx }) => {
    const result = await getEscritorioPorUsuario(ctx.user.id);
    if (!result) return { colaboradores: [], total: 0, limite: 1, extras: 0, custoExtras: 0 };

    const lista = await listarColaboradores(result.escritorio.id);
    const ativos = lista.filter(c => c.ativo).length;

    // Limite vem do plano do dono (Fase 4 — antes era cópia stale em
    // escritorios.maxColaboradores, removida na migration 0111).
    const { getActiveSubscriptionComHeranca } = await import("../db");
    const { getPlanoBySlug } = await import("../billing/planos-repo");
    const sub = await getActiveSubscriptionComHeranca(ctx.user.id);
    const plano = sub?.planId ? await getPlanoBySlug(sub.planId) : null;
    const limite = sub?.cortesia ? 999999 : (plano?.limites.maxUsuarios ?? 1);
    const extras = Math.max(0, ativos - limite);

    return {
      colaboradores: lista,
      total: ativos,
      limite,
      extras,
      custoExtras: extras * CUSTO_COLABORADOR_EXTRA,
    };
  }),

  /**
   * Lista colaboradores para popular dropdowns de filtro em relatórios.
   *
   * Respeita permissão de visibilidade:
   *   - Sem verTodos (atendente/estagiário/SDR): retorna SÓ ele mesmo
   *   - Com verTodos (gestor/dono): retorna todos os colaboradores ativos
   *
   * Diferente de `listarColaboradores` que sempre retorna tudo (usado
   * pela tela de gestão de equipe). Aqui filtramos pra evitar que
   * atendente possa filtrar relatórios por outros colaboradores.
   */
  listarColaboradoresParaFiltro: protectedProcedure
    .input(z.object({ modulo: z.string().default("relatorios") }))
    .query(async ({ ctx, input }) => {
      const result = await getEscritorioPorUsuario(ctx.user.id);
      if (!result) return { colaboradores: [] };

      const { checkPermission } = await import("./check-permission");
      const perm = await checkPermission(ctx.user.id, input.modulo, "ver");

      const lista = await listarColaboradores(result.escritorio.id);
      const ativos = lista.filter(c => c.ativo);

      // Sem verTodos: filtra pra mostrar só ele mesmo no dropdown
      if (!perm.verTodos) {
        const proprioColabId = result.colaborador.id;
        return {
          colaboradores: ativos.filter((c) => c.id === proprioColabId),
        };
      }

      return { colaboradores: ativos };
    }),

  /** Atualiza dados de um colaborador (dono/gestor) */
  atualizarColaborador: protectedProcedure
    .input(z.object({
      colaboradorId: z.number(),
      cargo: z.enum(["gestor", "atendente", "estagiario", "sdr"]).optional(),
      /** Quando informado, é a fonte da verdade do cargo. O enum `cargo`
       *  é derivado pelo backend (default ou "atendente" pra customs). */
      cargoPersonalizadoId: z.number().nullable().optional(),
      departamento: z.string().max(64).optional(),
      /** Quando informado, é a fonte da verdade do setor. Null = limpa. */
      setorId: z.number().nullable().optional(),
      /** Meta mensal de faturamento (R$). Aplicável a atendentes do
       *  setor comercial — dashboard Comercial usa pra barra de progresso.
       *  Null = sem meta. */
      metaMensal: z.number().nonnegative().nullable().optional(),
      ativo: z.boolean().optional(),
      // null = sem limite de atendimentos simultâneos.
      maxAtendimentosSimultaneos: z.number().int().min(1).max(50).nullable().optional(),
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
      await removerColaborador(
        input.colaboradorId,
        result.escritorio.id,
        result.colaborador.id,
      );
      return { success: true };
    }),

  /** Lista colaboradores que foram removidos (soft delete). Mostra na UI
   *  uma seção "Removidos" com botão Restaurar pra reverter exclusões
   *  feitas por engano. */
  listarRemovidos: protectedProcedure.query(async ({ ctx }) => {
    const result = await getEscritorioPorUsuario(ctx.user.id);
    if (!result) return [];
    await exigirPermissao(
      ctx.user.id, "equipe", "ver",
      "Sem permissão para ver a equipe.",
    );
    return listarColaboradoresRemovidos(result.escritorio.id);
  }),

  /** Restaura um colaborador removido. Reverte ativo=true, limpa
   *  removidoEm/removidoPor. Histórico (cards, comentários, etc) já
   *  estava intacto graças ao soft delete. */
  restaurarColaborador: protectedProcedure
    .input(z.object({ colaboradorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const result = await getEscritorioPorUsuario(ctx.user.id);
      if (!result) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "equipe", "excluir",
        "Sem permissão para restaurar colaboradores.",
      );
      await restaurarColaborador(input.colaboradorId, result.escritorio.id);
      return { success: true };
    }),

  // ─── Convites ──────────────────────────────────────────────────────────────

  /** Envia convite para novo colaborador */
  enviarConvite: protectedProcedure
    .input(z.object({
      email: z.string().email(),
      /**
       * Cargo do convite. Aceita um dos defaults ou nome de um cargo
       * personalizado do escritório. Validação em runtime — usa varchar
       * no banco em vez de enum (migration 0033).
       */
      cargo: z.string().min(1).max(64),
      departamento: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await getEscritorioPorUsuario(ctx.user.id);
      if (!result) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "equipe", "criar",
        "Sem permissão para convidar colaboradores.",
      );

      // Enforce de limite de usuários do plano (Fase 4). Conta ativos +
      // convites pendentes pra dar feedback antes da pessoa aceitar.
      const { verificarLimite } = await import("../billing/plan-limits");
      const limiteUsuarios = await verificarLimite(
        result.escritorio.id, ctx.user.id, "colaboradores",
      );
      if (!limiteUsuarios.permitido) {
        throw new Error(limiteUsuarios.mensagem);
      }

      // Validação do cargo: ou é default OU é cargo personalizado existente
      // daquele escritório. Evita aceitar strings arbitrárias.
      const CARGOS_DEFAULT = new Set(["gestor", "atendente", "estagiario", "sdr"]);
      let nomeCargoFinal = input.cargo;
      if (!CARGOS_DEFAULT.has(input.cargo)) {
        const { getDb } = await import("../db");
        const { cargosPersonalizados } = await import("../../drizzle/schema");
        const { and: drizzleAnd, eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("Database indisponível");
        const [cargoExistente] = await db
          .select({ nome: cargosPersonalizados.nome })
          .from(cargosPersonalizados)
          .where(drizzleAnd(
            eq(cargosPersonalizados.escritorioId, result.escritorio.id),
            eq(cargosPersonalizados.nome, input.cargo),
          ))
          .limit(1);
        if (!cargoExistente) {
          throw new Error(
            `Cargo "${input.cargo}" não existe. Crie em Permissões > Cargos antes de convidar.`,
          );
        }
        nomeCargoFinal = cargoExistente.nome;
      }

      const { id, token, expiresAt } = await criarConvite(
        result.escritorio.id,
        result.colaborador.id,
        input.email,
        nomeCargoFinal,
        input.departamento,
      );

      // Enviar email de convite via Resend.
      // Pra defaults usa label amigável; pra cargo custom usa o próprio nome.
      const CARGO_LABELS: Record<string, string> = { gestor: "Gestor", atendente: "Atendente", estagiario: "Estagiário", sdr: "SDR" };
      let emailEnviado = false;
      let emailErro: string | undefined;
      try {
        const { enviarEmailConvite } = await import("../_core/email");
        const resultado = await enviarEmailConvite({
          email: input.email,
          nomeEscritorio: result.escritorio.nome,
          cargo: CARGO_LABELS[nomeCargoFinal] || nomeCargoFinal,
          token,
          convidadoPor: ctx.user.name || ctx.user.email || "Admin",
        });
        emailEnviado = resultado.success;
        if (!resultado.success) emailErro = resultado.error;
      } catch (err: any) {
        // Falha no email não bloqueia o convite — mas retorna o motivo
        emailErro = err?.message || "Erro inesperado ao enviar email.";
      }

      // Persiste status do envio pra admin saber + permitir reenviar depois
      await atualizarStatusEmailConvite(id, emailEnviado, emailErro ?? null);

      return { id, token, expiresAt, emailEnviado, emailErro };
    }),

  /** Reenvia email de convite pendente. Útil quando primeiro envio falhou
   *  (Resend rejeitado, domínio não verificado, etc). Mantém token original. */
  reenviarConvite: protectedProcedure
    .input(z.object({ conviteId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const result = await getEscritorioPorUsuario(ctx.user.id);
      if (!result) throw new TRPCError({ code: "FORBIDDEN", message: "Escritório não encontrado." });

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const { convitesColaborador } = await import("../../drizzle/schema");
      const [convite] = await db
        .select()
        .from(convitesColaborador)
        .where(
          and(
            eq(convitesColaborador.id, input.conviteId),
            eq(convitesColaborador.escritorioId, result.escritorio.id),
          ),
        )
        .limit(1);
      if (!convite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Convite não encontrado." });
      }
      if (convite.status !== "pendente") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Convite já está ${convite.status}, não pode ser reenviado.`,
        });
      }

      const CARGO_LABELS_R: Record<string, string> = { gestor: "Gestor", atendente: "Atendente", estagiario: "Estagiário", sdr: "SDR" };
      let emailEnviado = false;
      let emailErro: string | undefined;
      try {
        const { enviarEmailConvite } = await import("../_core/email");
        const resultado = await enviarEmailConvite({
          email: convite.email,
          nomeEscritorio: result.escritorio.nome,
          cargo: CARGO_LABELS_R[convite.cargo] || convite.cargo,
          token: convite.token,
          convidadoPor: ctx.user.name || ctx.user.email || "Admin",
        });
        emailEnviado = resultado.success;
        if (!resultado.success) emailErro = resultado.error;
      } catch (err: any) {
        emailErro = err?.message || "Erro inesperado ao enviar email.";
      }

      await atualizarStatusEmailConvite(input.conviteId, emailEnviado, emailErro ?? null);

      return { emailEnviado, emailErro };
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

    // Limite WhatsApp vem do plano (Fase 4 — antes era cópia stale em
    // escritorios.maxConexoesWhatsapp, removida na migration 0111).
    const { getActiveSubscriptionComHeranca } = await import("../db");
    const { getPlanoBySlug } = await import("../billing/planos-repo");
    const sub = await getActiveSubscriptionComHeranca(ctx.user.id);
    const plano = sub?.planId ? await getPlanoBySlug(sub.planId) : null;
    const limiteWhatsapp = sub?.cortesia ? 999999 : (plano?.limites.maxConexoesWhatsapp ?? 0);

    return {
      canais,
      limiteWhatsapp,
      usadosWhatsapp: contagem["whatsapp"] || 0,
    };
  }),

  /** Cria novo canal */
  criarCanal: protectedProcedure
    .input(z.object({
      tipo: z.enum([
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

      // Valida que a config contém os campos obrigatórios do tipo de canal.
      // Evita que um canal seja gravado como "conectado" no banco (o insert
      // no db-canais marca status=conectado quando há config) sem ter as
      // credenciais reais — depois aparece como conectado na UI mas não
      // funciona ao disparar mensagens.
      validarConfigCanalPorTipo(input.tipo, input.config);

      // Enforce de limite de conexões WhatsApp do plano (Fase 4 — antes
      // estava comentado). Lê `maxConexoesWhatsapp` do plano via cortesia/
      // resolver de subscription (não do campo stale em escritorios).
      if (input.tipo === "whatsapp_api") {
        const { getActiveSubscriptionComHeranca } = await import("../db");
        const { getPlanoBySlug } = await import("../billing/planos-repo");

        const sub = await getActiveSubscriptionComHeranca(ctx.user.id);
        // Cortesia ignora limite (admin override)
        const cortesiaAtiva = !!sub?.cortesia;
        if (!cortesiaAtiva) {
          const plano = sub?.planId ? await getPlanoBySlug(sub.planId) : null;
          const limite = plano?.limites.maxConexoesWhatsapp ?? 0;
          if (limite < 999999) {
            const contagem = await contarCanaisPorTipo(esc.escritorio.id);
            const whatsappAtual = contagem["whatsapp"] || 0;
            if (whatsappAtual >= limite) {
              throw new Error(
                `Limite de ${limite} conexão(ões) WhatsApp atingido no plano "${plano?.nome ?? "atual"}". Faça upgrade pra adicionar mais.`,
              );
            }
          }
        }
      }

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

  /**
   * Cadastro manual de canal WhatsApp Cloud API — alternativa ao Embedded
   * Signup pra casos onde o cliente já tem WABA + número configurados na BM
   * dele e o OAuth tá bloqueado (BM dona do JuridFlow = mesma BM dos números,
   * App Review pendente, Tech Provider não aprovado, etc).
   *
   * Recebe os 3 valores que o Embedded Signup normalmente preencheria,
   * **testa a conexão antes de salvar** (chama Graph API com `phoneNumberId`)
   * e usa o `verified_name` + `display_phone_number` retornados como nome e
   * telefone do canal — evita typos de copy-paste e garante que o canal só
   * grava se as credenciais realmente funcionam.
   *
   * Migração pra OAuth depois: quando o Embedded Signup estiver liberado,
   * o cliente refaz Conectar pelo fluxo normal — o `findCanalByPhoneNumberId`
   * do webhook continua casando pelo mesmo `phoneNumberId`, então pode
   * sobrescrever a config manual ou criar canal novo + desativar a manual.
   */
  conectarWhatsappCloudManual: protectedProcedure
    .input(z.object({
      accessToken: z.string().min(20),
      phoneNumberId: z.string().min(5).max(64),
      wabaId: z.string().min(5).max(64),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "configuracoes", "criar",
        "Sem permissão para criar canais de integração.",
      );

      // Enforce do limite de conexões WhatsApp do plano (mesma regra do
      // criarCanal — não duplica caminho).
      const { getActiveSubscriptionComHeranca } = await import("../db");
      const { getPlanoBySlug } = await import("../billing/planos-repo");
      const sub = await getActiveSubscriptionComHeranca(ctx.user.id);
      const cortesiaAtiva = !!sub?.cortesia;
      if (!cortesiaAtiva) {
        const plano = sub?.planId ? await getPlanoBySlug(sub.planId) : null;
        const limite = plano?.limites.maxConexoesWhatsapp ?? 0;
        if (limite < 999999) {
          const contagem = await contarCanaisPorTipo(esc.escritorio.id);
          const whatsappAtual = contagem["whatsapp"] || 0;
          if (whatsappAtual >= limite) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Limite de ${limite} conexão(ões) WhatsApp atingido no plano "${plano?.nome ?? "atual"}". Faça upgrade pra adicionar mais.`,
            });
          }
        }
      }

      // Testa o trio na Graph API antes de gravar. Bloqueia credencial errada
      // ou token expirado em cadastro silencioso (canal "conectado" mas
      // morto — bug recorrente quando cola valores incorretos).
      const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        phoneNumberId: input.phoneNumberId,
        accessToken: input.accessToken,
        wabaId: input.wabaId,
      });
      const teste = await client.testarConexao();
      if (!teste.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Falha ao validar credenciais na Meta: ${teste.erro || "erro desconhecido"}. Confira accessToken, phoneNumberId e wabaId.`,
        });
      }

      // Token de OUTRO app envia mensagens normalmente, mas o recebimento
      // nunca funciona: o webhook + assinatura HMAC do sistema pertencem ao
      // app configurado no Admin. Bloqueia aqui (com certeza da divergência)
      // em vez de deixar nascer um canal que "conecta mas não recebe".
      const { verificarAppDoToken } = await import("../routers/meta-channels");
      const appCheck = await verificarAppDoToken(input.accessToken);
      if (appCheck?.divergente) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `Este token pertence ao app "${appCheck.appToken?.name || appCheck.appToken?.id}" (ID ${appCheck.appToken?.id}), ` +
            `mas o JuridFlow usa o app ID ${appCheck.appSistema}. Com esse token o número envia mas NUNCA recebe mensagens. ` +
            `Gere o token pelo app ${appCheck.appSistema} ou conecte pelo botão "Conectar com Facebook".`,
        });
      }

      const nomeCanal = teste.nome || teste.telefone || "WhatsApp Cloud";
      const telefoneCanal = teste.telefone || undefined;

      // NÃO marcamos registradoCloudApi aqui de propósito: um número recém
      // adicionado à WABA quase sempre está "Pendente" na Meta (precisa do
      // POST /{phone-number-id}/register com PIN pra ativar). Deixar o default
      // (false) mantém a etapa de registro por PIN disponível na UI — e é o
      // próprio registro que ativa o número e inscreve os webhooks. Forçar
      // `true` aqui esconderia essa etapa e travaria o número em "Pendente".
      const id = await criarCanal({
        escritorioId: esc.escritorio.id,
        tipo: "whatsapp_api",
        nome: nomeCanal,
        telefone: telefoneCanal,
        config: {
          accessToken: input.accessToken,
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
        },
      });

      // Inscreve o app na WABA pra RECEBER mensagens. O fluxo de registro por
      // PIN também inscreve, mas fazemos aqui (best-effort) pra cobrir o caso
      // de um número que JÁ chega registrado e não passa pela tela de PIN —
      // sem isso ele enviaria mas nunca receberia. Se falhar, o canal segue
      // e o usuário re-inscreve pelo botão da UI.
      let webhooksInscritos = false;
      try {
        const { subscribeAppToWaba } = await import("../routers/meta-channels");
        const sub = await subscribeAppToWaba(input.accessToken, input.wabaId);
        webhooksInscritos = sub.ok;
      } catch {
        /* best-effort — não bloqueia o cadastro */
      }

      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: id,
        acao: "conectou",
        detalhes: `Canal whatsapp_api "${nomeCanal}" cadastrado manualmente (phoneNumberId=${input.phoneNumberId}, webhooks=${webhooksInscritos ? "ok" : "pendente"})`,
      });

      return { id, nome: nomeCanal, telefone: telefoneCanal, webhooksInscritos };
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

  /** Flags de mídia da IA (Whisper / Vision) lidas do card do ChatGPT. */
  flagsIA: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { configurado: false, whisperAtivo: false, visionAtivo: false };
    const { obterConfigIAMedia } = await import("../integracoes/config-ia-media");
    const c = await obterConfigIAMedia(esc.escritorio.id);
    return {
      configurado: !!(c && c.openaiApiKey),
      whisperAtivo: !!c?.whisperAtivo,
      visionAtivo: !!c?.visionAtivo,
    };
  }),

  /** Liga/desliga Whisper (áudio→texto) e Vision (imagem) no card do ChatGPT.
   *  Merge no config do canal pra não apagar a chave OpenAI. */
  atualizarFlagsIA: protectedProcedure
    .input(z.object({ whisperAtivo: z.boolean().optional(), visionAtivo: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "configuracoes", "editar",
        "Sem permissão para editar a configuração do canal.",
      );
      const { obterConfigIAMedia } = await import("../integracoes/config-ia-media");
      const c = await obterConfigIAMedia(esc.escritorio.id);
      if (!c) throw new Error("Configure a chave da OpenAI no card do ChatGPT primeiro.");
      const cfg = (await obterConfigCanal(c.canalId, esc.escritorio.id)) ?? {};
      const novo: Record<string, any> = { ...cfg };
      if (input.whisperAtivo !== undefined) novo.whisperAtivo = input.whisperAtivo;
      if (input.visionAtivo !== undefined) novo.visionAtivo = input.visionAtivo;
      await atualizarConfigCanal(c.canalId, esc.escritorio.id, novo);
      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: c.canalId,
        acao: "editou_config",
        detalhes: `IA mídia: whisper=${novo.whisperAtivo ?? false} vision=${novo.visionAtivo ?? false}`,
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

  /** Define qual número WhatsApp oficial (Cloud API) envia as mensagens.
   *  Exclusivo por escritório — o envio (getCanalCloudApi) prioriza o marcado. */
  definirCanalPadraoEnvio: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "configuracoes", "editar",
        "Sem permissão para configurar canais.",
      );

      await definirCanalPadraoEnvio(input.canalId, esc.escritorio.id);
      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: input.canalId,
        acao: "editou_config",
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

  // ─── SETORES (departamentos do escritório) ─────────────────────────────

  /**
   * Lista setores do escritório com contagem de colaboradores ativos
   * em cada um. Usado pelo dropdown do dialog de Editar Colaborador
   * e pela seção "Setores" da tab Equipe.
   */
  listarSetores: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return [];
    const { setores, colaboradores } = await import("../../drizzle/schema");
    const lista = await db
      .select()
      .from(setores)
      .where(eq(setores.escritorioId, esc.escritorio.id))
      .orderBy(setores.nome);

    const result = [];
    for (const s of lista) {
      const colabs = await db
        .select({ id: colaboradores.id })
        .from(colaboradores)
        .where(and(
          eq(colaboradores.escritorioId, esc.escritorio.id),
          eq(colaboradores.setorId, s.id),
          eq(colaboradores.ativo, true),
        ));
      result.push({
        id: s.id,
        nome: s.nome,
        descricao: s.descricao || "",
        cor: s.cor,
        tipo: s.tipo,
        totalColaboradores: colabs.length,
        createdAt: s.createdAt,
      });
    }
    return result;
  }),

  criarSetor: protectedProcedure
    .input(z.object({
      nome: z.string().min(2).max(64),
      descricao: z.string().max(255).optional(),
      cor: z.string().max(20).optional(),
      tipo: z.enum(["comercial", "operacional", "suporte", "financeiro", "outro"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "equipe", "editar",
        "Sem permissão para gerenciar setores.",
      );
      const { getDb } = await import("../db");
    const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const { setores } = await import("../../drizzle/schema");
      try {
        const [novo] = await db.insert(setores).values({
          escritorioId: esc.escritorio.id,
          nome: input.nome.trim(),
          descricao: input.descricao?.trim() || null,
          cor: input.cor || "#6366f1",
          tipo: input.tipo || "outro",
        }).$returningId();
        return { id: novo?.id };
      } catch (err: any) {
        if (err?.code === "ER_DUP_ENTRY" || /Duplicate entry/i.test(err?.message ?? "")) {
          throw new Error("Já existe um setor com esse nome.");
        }
        throw err;
      }
    }),

  atualizarSetor: protectedProcedure
    .input(z.object({
      setorId: z.number(),
      nome: z.string().min(2).max(64).optional(),
      descricao: z.string().max(255).optional().nullable(),
      cor: z.string().max(20).optional(),
      tipo: z.enum(["comercial", "operacional", "suporte", "financeiro", "outro"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "equipe", "editar",
        "Sem permissão para gerenciar setores.",
      );
      const { getDb } = await import("../db");
    const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const { setores } = await import("../../drizzle/schema");
      const dadosUpdate: Record<string, unknown> = {};
      if (input.nome !== undefined) dadosUpdate.nome = input.nome.trim();
      if (input.descricao !== undefined) dadosUpdate.descricao = input.descricao?.trim() || null;
      if (input.cor !== undefined) dadosUpdate.cor = input.cor;
      if (input.tipo !== undefined) dadosUpdate.tipo = input.tipo;
      if (Object.keys(dadosUpdate).length === 0) return { success: true };

      try {
        await db.update(setores).set(dadosUpdate).where(and(
          eq(setores.id, input.setorId),
          eq(setores.escritorioId, esc.escritorio.id),
        ));
      } catch (err: any) {
        if (err?.code === "ER_DUP_ENTRY" || /Duplicate entry/i.test(err?.message ?? "")) {
          throw new Error("Já existe um setor com esse nome.");
        }
        throw err;
      }
      return { success: true };
    }),

  excluirSetor: protectedProcedure
    .input(z.object({ setorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      await exigirPermissao(
        ctx.user.id, "equipe", "editar",
        "Sem permissão para gerenciar setores.",
      );
      const { getDb } = await import("../db");
    const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const { setores, colaboradores } = await import("../../drizzle/schema");
      // Limpa setorId dos colaboradores que apontavam pra ele (não deleta
      // colaborador, só solta o vínculo — texto livre `departamento` continua).
      await db.update(colaboradores)
        .set({ setorId: null })
        .where(and(
          eq(colaboradores.escritorioId, esc.escritorio.id),
          eq(colaboradores.setorId, input.setorId),
        ));
      await db.delete(setores).where(and(
        eq(setores.id, input.setorId),
        eq(setores.escritorioId, esc.escritorio.id),
      ));
      return { success: true };
    }),
});
