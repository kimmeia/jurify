import { COOKIE_NAME, SESSION_DURATION_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { createLogger } from "./logger";

const log = createLogger("sdk");

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  /**
   * Impersonation: quando um admin "entra como" outro usuário, o JWT
   * contém o openId do usuário-alvo (campo openId acima) e o openId
   * do admin que iniciou a impersonation aqui. Toda ação fica auditada
   * em nome do admin original.
   */
  impersonatedBy?: string;
};

class SDKServer {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? SESSION_DURATION_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    const claims: Record<string, unknown> = {
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    };
    if (payload.impersonatedBy) {
      claims.impersonatedBy = payload.impersonatedBy;
    }

    return new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{
    openId: string;
    appId: string;
    name: string;
    impersonatedBy?: string;
  } | null> {
    if (!cookieValue) {
      log.debug("Missing session cookie");
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name, impersonatedBy } = payload as Record<string, unknown>;

      // Apenas openId é obrigatório. appId e name têm defaults razoáveis
      // pra suportar JWTs gerados sem essas variáveis configuradas.
      if (!isNonEmptyString(openId)) {
        log.warn("Session payload sem openId");
        return null;
      }

      return {
        openId,
        appId: isNonEmptyString(appId) ? appId : "jurify",
        name: isNonEmptyString(name) ? name : "Usuário",
        impersonatedBy: isNonEmptyString(impersonatedBy) ? impersonatedBy : undefined,
      };
    } catch (error) {
      log.warn({ err: String(error) }, "Session verification failed");
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<User & { impersonatedBy?: string }> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const user = await db.getUserByOpenId(session.openId);

    if (!user) {
      throw ForbiddenError("User not found");
    }

    // ─── Bloqueio de conta ────────────────────────────────────────────
    // Usuários bloqueados pelo admin não conseguem mais autenticar.
    // EXCEÇÃO: o admin que está impersonando — verificamos contra o
    // impersonator, não contra o user-alvo.
    if (user.bloqueado && !session.impersonatedBy) {
      log.warn(
        { userId: user.id, motivo: user.motivoBloqueio },
        "Tentativa de login de usuário bloqueado",
      );
      throw ForbiddenError(
        `Conta bloqueada${user.motivoBloqueio ? `: ${user.motivoBloqueio}` : ""}. Entre em contato com o suporte.`,
      );
    }

    // Atualiza lastSignedIn (mas só se NÃO for impersonation, pra não
    // bagunçar o "último acesso" real do usuário-alvo)
    if (!session.impersonatedBy) {
      await db.upsertUser({
        openId: user.openId,
        lastSignedIn: new Date(),
      });
    }

    return { ...user, impersonatedBy: session.impersonatedBy };
  }
}

export const sdk = new SDKServer();
