/**
 * Router de autenticação — login próprio (email/senha) + Google Sign-In.
 *
 * Sem dependência de provedor OAuth externo. Funciona em qualquer ambiente.
 *
 * Endpoints:
 *   - me              → retorna o usuário autenticado (ou null)
 *   - logout          → limpa o cookie de sessão
 *   - signup          → cria conta com email + senha
 *   - loginEmail      → login com email + senha existente
 *   - loginGoogle     → login com idToken do Google Sign-In
 *   - googleConfig    → retorna o GOOGLE_CLIENT_ID público (para o frontend)
 */

import { z } from "zod";
import { COOKIE_NAME, SESSION_DURATION_MS } from "@shared/const";
import { publicProcedure, router } from "../_core/trpc";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import {
  upsertUser,
  getUserByEmail,
  getUserByGoogleSub,
  getUserByOpenId,
} from "../db";
import { hashPassword, verifyPassword } from "../_core/password";
import { createLogger } from "../_core/logger";

const log = createLogger("auth-router");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emailToOpenId(email: string): string {
  return `email-${Buffer.from(email.trim().toLowerCase()).toString("base64url")}`;
}

function googleSubToOpenId(sub: string): string {
  return `google-${sub}`;
}

async function setSessionCookie(
  ctx: { req: any; res: any },
  openId: string,
  name: string,
) {
  const sessionToken = await sdk.createSessionToken(openId, {
    name,
    expiresInMs: SESSION_DURATION_MS,
  });
  const cookieOptions = getSessionCookieOptions(ctx.req);
  ctx.res.cookie(COOKIE_NAME, sessionToken, {
    ...cookieOptions,
    maxAge: SESSION_DURATION_MS,
  });
}

/**
 * Verifica um ID Token do Google contra a API pública do Google.
 * Retorna { sub, email, name, picture } ou null se inválido.
 *
 * Sem dependência externa: usa fetch nativo do Node.
 */
async function verifyGoogleIdToken(idToken: string): Promise<{
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean;
} | null> {
  try {
    // Endpoint público do Google que valida e decodifica o token
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) {
      log.warn({ status: res.status }, "Google tokeninfo retornou erro");
      return null;
    }
    const data = await res.json();

    // Validações mínimas
    if (!data.sub || !data.email) return null;

    // Confere se o aud bate com nosso GOOGLE_CLIENT_ID (se configurado)
    const expectedAud = process.env.GOOGLE_CLIENT_ID;
    if (expectedAud && data.aud !== expectedAud) {
      log.warn({ aud: data.aud }, "Google token com aud inválido");
      return null;
    }

    return {
      sub: data.sub,
      email: data.email,
      name: data.name || data.email.split("@")[0],
      picture: data.picture,
      email_verified: data.email_verified === "true" || data.email_verified === true,
    };
  } catch (err) {
    log.error({ err: String(err) }, "Falha ao verificar Google ID token");
    return null;
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const authRouter = router({
  /** Retorna o usuário autenticado atualmente, ou null. */
  me: publicProcedure.query((opts) => opts.ctx.user),

  /** Encerra a sessão limpando o cookie. */
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),

  /** Indica se o login Google está disponível (GOOGLE_CLIENT_ID definido). */
  googleConfig: publicProcedure.query(() => {
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    return {
      enabled: !!clientId,
      clientId,
    };
  }),

  /** Cadastro com email + senha. */
  signup: publicProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        email: z.string().email().max(320),
        password: z.string().min(6).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();

      // Verifica se já existe
      const existing = await getUserByEmail(email);
      if (existing) {
        throw new Error("Já existe uma conta com este e-mail. Tente fazer login.");
      }

      const passwordHash = await hashPassword(input.password);
      const openId = emailToOpenId(email);

      await upsertUser({
        openId,
        name: input.name,
        email,
        loginMethod: "email",
        passwordHash,
        lastSignedIn: new Date(),
      });

      await setSessionCookie(ctx, openId, input.name);

      log.info({ email }, "Novo cadastro via email/senha");
      return { success: true, email, name: input.name } as const;
    }),

  /** Login com email + senha. */
  loginEmail: publicProcedure
    .input(
      z.object({
        email: z.string().email().max(320),
        password: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      const user = await getUserByEmail(email);

      if (!user || !user.passwordHash) {
        // Mensagem genérica pra não vazar se o email existe
        throw new Error("E-mail ou senha incorretos.");
      }

      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) {
        throw new Error("E-mail ou senha incorretos.");
      }

      // Atualiza lastSignedIn
      await upsertUser({
        openId: user.openId,
        lastSignedIn: new Date(),
      });

      await setSessionCookie(ctx, user.openId, user.name || email);

      log.info({ email }, "Login via email/senha");
      return { success: true, email, name: user.name } as const;
    }),

  /** Login/cadastro via Google Sign-In (recebe o ID token do GIS). */
  loginGoogle: publicProcedure
    .input(
      z.object({
        idToken: z.string().min(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await verifyGoogleIdToken(input.idToken);
      if (!profile) {
        throw new Error("Token do Google inválido.");
      }

      const email = profile.email.trim().toLowerCase();

      // Tenta achar usuário existente: por googleSub primeiro, depois por email
      let user = await getUserByGoogleSub(profile.sub);
      if (!user) user = await getUserByEmail(email);

      const openId = user?.openId || googleSubToOpenId(profile.sub);

      // Cria ou atualiza
      await upsertUser({
        openId,
        name: profile.name,
        email,
        googleSub: profile.sub,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      await setSessionCookie(ctx, openId, profile.name);

      log.info({ email, sub: profile.sub }, "Login via Google");
      return {
        success: true,
        email,
        name: profile.name,
        picture: profile.picture,
      } as const;
    }),
});
