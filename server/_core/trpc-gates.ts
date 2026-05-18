/**
 * Gates de procedure pra controle de acesso por módulo do plano (Fase 4
 * do roadmap de Planos).
 *
 * `requireModulo('atendimento')` retorna uma procedure que herda do
 * `protectedProcedure` + valida que o plano do escritório libera o módulo.
 * Falha com FORBIDDEN + mensagem explícita pro frontend renderizar CTA de
 * upgrade.
 *
 * Cortesia tem prioridade: cliente em cortesia tem acesso a TODOS os módulos
 * (admin override). Trial em andamento usa os módulos do plano em trial
 * normalmente.
 *
 * Bypass de admin: usuário com `role='admin'` (admin do Jurify, não dono
 * de escritório) sempre passa, pra evitar bloquear suporte/diagnóstico.
 */

import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "./trpc";
import type { ModuloAppId } from "@shared/modulos-app";
import { MODULOS_APP_OBRIGATORIOS } from "@shared/modulos-app";

export function requireModulo(modulo: ModuloAppId) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    // Admin do Jurify sempre passa
    if (ctx.user.role === "admin") return next();

    // Módulos obrigatórios (dashboard, configurações) — sempre liberados
    if ((MODULOS_APP_OBRIGATORIOS as readonly string[]).includes(modulo)) {
      return next();
    }

    const { getEscritorioPorUsuario } = await import("../escritorio/db-escritorio");
    const { getActiveSubscriptionComHeranca } = await import("../db");
    const { getPlanoBySlug } = await import("../billing/planos-repo");

    const escVinculado = await getEscritorioPorUsuario(ctx.user.id);
    if (!escVinculado) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Configure seu escritório antes de usar este módulo.",
      });
    }

    const sub = await getActiveSubscriptionComHeranca(ctx.user.id);
    if (!sub) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Você precisa de um plano ativo pra usar este módulo.",
        cause: { motivo: "sem_plano", modulo },
      });
    }

    // Cortesia libera tudo
    if (sub.cortesia) return next();

    if (!sub.planId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Plano inválido. Entre em contato com o suporte.",
      });
    }

    const plano = await getPlanoBySlug(sub.planId);
    if (!plano) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Plano não encontrado no catálogo.",
      });
    }

    if (!plano.modulosLiberados.includes(modulo)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Módulo não disponível no plano "${plano.nome}". Faça upgrade pra continuar.`,
        cause: { motivo: "modulo_nao_liberado", modulo, planoAtual: plano.slug },
      });
    }

    return next();
  });
}
