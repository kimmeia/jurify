/**
 * Audit log helper — registra ações sensíveis do admin do Jurify.
 *
 * Uso:
 *   import { registrarAuditoria } from "../_core/audit";
 *
 *   await registrarAuditoria({
 *     ctx,
 *     acao: "user.bloquear",
 *     alvoTipo: "user",
 *     alvoId: targetUser.id,
 *     alvoNome: targetUser.name,
 *     detalhes: { motivo: input.motivo },
 *   });
 *
 * Quando o ator está em sessão de impersonation, o `actorUserId` registrado
 * é o do ADMIN ORIGINAL (impersonatedBy), não o user-alvo. Isso é crítico
 * pra que ações feitas durante impersonation não sejam atribuídas ao
 * cliente.
 */

import type { TrpcContext } from "./context";
import { getDb } from "../db";
import { auditLog, users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "./logger";

const log = createLogger("audit");

interface RegistrarAuditoriaInput {
  ctx: TrpcContext;
  acao: string;
  alvoTipo?: string;
  alvoId?: number;
  alvoNome?: string;
  detalhes?: Record<string, unknown>;
}

/**
 * Extrai o IP de origem da request, considerando proxies.
 * Trust proxy já está habilitado no Express, então req.ip resolve corretamente.
 */
function extrairIp(ctx: TrpcContext): string | null {
  const req = ctx.req as any;
  return (
    req?.ip ||
    req?.headers?.["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req?.socket?.remoteAddress ||
    null
  );
}

/**
 * Resolve o ator real da ação:
 * - Sem impersonation: o próprio user logado
 * - Com impersonation: o admin original (lookup por openId)
 */
async function resolverAtor(
  ctx: TrpcContext,
): Promise<{ id: number; name: string } | null> {
  if (!ctx.user) return null;

  const impersonatorOpenId = (ctx.user as any).impersonatedBy;
  if (!impersonatorOpenId) {
    return { id: ctx.user.id, name: ctx.user.name || ctx.user.email || "Admin" };
  }

  // Está impersonando — buscar admin original
  try {
    const db = await getDb();
    if (!db) return { id: ctx.user.id, name: ctx.user.name || "?" };
    const [admin] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.openId, impersonatorOpenId))
      .limit(1);
    if (admin) {
      return {
        id: admin.id,
        name: `${admin.name || admin.email || "Admin"} (impersonando)`,
      };
    }
  } catch (err) {
    log.warn({ err: String(err) }, "Falha ao resolver impersonator");
  }

  return { id: ctx.user.id, name: ctx.user.name || "?" };
}

/**
 * Registra uma entrada no audit_log.
 *
 * É fail-safe: se a inserção falhar, loga o erro mas NÃO lança —
 * a auditoria nunca pode bloquear a operação principal.
 */
export async function registrarAuditoria(input: RegistrarAuditoriaInput): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      log.warn({ acao: input.acao }, "DB indisponível — auditoria perdida");
      return;
    }

    const ator = await resolverAtor(input.ctx);
    if (!ator) {
      log.warn({ acao: input.acao }, "Sem ator — auditoria ignorada");
      return;
    }

    await db.insert(auditLog).values({
      actorUserId: ator.id,
      actorName: ator.name,
      acao: input.acao,
      alvoTipo: input.alvoTipo,
      alvoId: input.alvoId,
      alvoNome: input.alvoNome,
      detalhes: input.detalhes ? JSON.stringify(input.detalhes) : null,
      ip: extrairIp(input.ctx),
    });
  } catch (err: any) {
    // CRÍTICO: nunca lançar — auditoria não pode quebrar a operação
    log.error({ err: err.message, acao: input.acao }, "Falha ao registrar auditoria");
  }
}
