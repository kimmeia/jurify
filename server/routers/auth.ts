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
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME, SESSION_DURATION_MS } from "@shared/const";
import { publicProcedure, router } from "../_core/trpc";
import { getSessionCookieOptions } from "../_core/cookies";
import { consume as rateLimitConsume, reset as rateLimitReset } from "../_core/rate-limit";
import { sdk } from "../_core/sdk";
import {
  upsertUser,
  getUserByEmail,
  getUserByGoogleSub,
  getUserByOpenId,
  getDb,
} from "../db";
import { colaboradores, users, passwordResetTokens } from "../../drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { enviarEmailRedefinirSenha, enviarEmailBoasVindas } from "../_core/email";

/** Bloqueia login de usuário que foi removido de TODOS os escritórios
 *  em que tinha vínculo. Mantém o flag de remoção visível pra ele entender
 *  por que não consegue mais entrar. */
async function bloquearSeRemovido(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const [ativo] = await db
    .select({ id: colaboradores.id })
    .from(colaboradores)
    .where(and(eq(colaboradores.userId, userId), eq(colaboradores.ativo, true)))
    .limit(1);
  if (ativo) return; // tem vínculo ativo — pode logar
  const [inativo] = await db
    .select({ id: colaboradores.id })
    .from(colaboradores)
    .where(and(eq(colaboradores.userId, userId), eq(colaboradores.ativo, false)))
    .limit(1);
  if (inativo) {
    throw new Error(
      "Você foi removido do escritório. Entre em contato com o responsável para reativar seu acesso.",
    );
  }
  // Sem vínculo nenhum: deixa logar (caso onboarding — usuário criando primeiro escritório)
}
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
        // LGPD: aceite explícito dos Termos + Política. Frontend só
        // habilita o botão com isso true. Validamos de novo aqui (defesa
        // em profundidade).
        aceitouTermos: z.literal(true, {
          errorMap: () => ({ message: "Você precisa aceitar os Termos de Uso e a Política de Privacidade para criar a conta." }),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Anti-spam: máximo 3 cadastros / IP / hora.
      const ip = ctx.req.ip || "unknown";
      const rl = rateLimitConsume({ name: "auth-signup", key: ip, max: 3, windowMs: 60 * 60_000 });
      if (!rl.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Muitos cadastros do seu IP. Tente novamente em ${Math.ceil(rl.retryAfter / 60)} minutos.`,
        });
      }

      const email = input.email.trim().toLowerCase();

      // Verifica se já existe
      const existing = await getUserByEmail(email);
      if (existing) {
        // Caso especial: usuário pode ter sido removido como colaborador
        // antes do hard-delete do PR #33, ficando órfão (sem vínculo
        // ativo). Permite o re-cadastro nesse caso, deletando o registro
        // órfão antes de criar o novo.
        const db = await getDb();
        let orfao = false;
        if (db) {
          const [vincAtivo] = await db
            .select({ id: colaboradores.id })
            .from(colaboradores)
            .where(
              and(eq(colaboradores.userId, existing.id), eq(colaboradores.ativo, true)),
            )
            .limit(1);
          // Sem vínculo ativo → considera órfão
          if (!vincAtivo) orfao = true;
        }

        if (orfao) {
          // Limpa registros antigos (se houver) e o próprio user
          if (db) {
            try {
              await db.delete(colaboradores).where(eq(colaboradores.userId, existing.id));
            } catch {}
            try {
              await db.delete(users).where(eq(users.id, existing.id));
            } catch (err: any) {
              throw new Error(
                "Não foi possível recriar a conta — entre em contato com o suporte. (FK constraint)",
              );
            }
          }
          // Continua o fluxo normal de criação abaixo
        } else {
          throw new Error("Já existe uma conta com este e-mail. Tente fazer login.");
        }
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
        aceitouTermosEm: new Date(),
      });

      await setSessionCookie(ctx, openId, input.name);

      log.info({ email }, "Novo cadastro via email/senha");

      // Email de boas-vindas — não bloqueia signup se falhar (Resend
      // pode estar fora ou config faltando). Só loga.
      void enviarEmailBoasVindas({ email, nome: input.name }).then((r) => {
        if (!r.success) log.warn({ email, error: r.error }, "Falha ao enviar email de boas-vindas");
      });

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
      const ip = ctx.req.ip || "unknown";

      // Rate limit anti-bruteforce: dois eixos, cada um cobre um cenário.
      // (1) IP: 10 tentativas / 15min — proteje contra password spraying
      //     (mesmo IP testando vários emails).
      // (2) email: 5 tentativas / 1h — proteje contra brute force focado
      //     numa conta específica vindo de IPs diferentes.
      const rlIp = rateLimitConsume({ name: "login-ip", key: ip, max: 10, windowMs: 15 * 60_000 });
      if (!rlIp.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Muitas tentativas. Tente novamente em ${Math.ceil(rlIp.retryAfter / 60)} minutos.`,
        });
      }
      const rlEmail = rateLimitConsume({ name: "login-email", key: email, max: 5, windowMs: 60 * 60_000 });
      if (!rlEmail.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Muitas tentativas para esse e-mail. Tente novamente em ${Math.ceil(rlEmail.retryAfter / 60)} minutos.`,
        });
      }

      const user = await getUserByEmail(email);

      if (!user || !user.passwordHash) {
        // Mensagem genérica pra não vazar se o email existe
        throw new Error("E-mail ou senha incorretos.");
      }

      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) {
        throw new Error("E-mail ou senha incorretos.");
      }

      // Bloqueia login se o usuário foi removido de todos os escritórios
      await bloquearSeRemovido(user.id);

      // Sucesso: limpa contadores pra não penalizar usuário legítimo que
      // errou senha algumas vezes antes de acertar.
      rateLimitReset("login-ip", ip);
      rateLimitReset("login-email", email);

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
      // Anti-flood: 20 tentativas / IP / 15min. Google já valida o token,
      // então o limite é mais frouxo do que email/senha.
      const ip = ctx.req.ip || "unknown";
      const rl = rateLimitConsume({ name: "login-google", key: ip, max: 20, windowMs: 15 * 60_000 });
      if (!rl.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Muitas tentativas. Tente novamente em ${Math.ceil(rl.retryAfter / 60)} minutos.`,
        });
      }

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

      // Bloqueia login se o usuário foi removido de todos os escritórios
      // (faz após upsert pra ter o user.id correto, mesmo se foi recém-criado)
      const userPos = user || (await getUserByEmail(email));
      if (userPos) await bloquearSeRemovido(userPos.id);

      await setSessionCookie(ctx, openId, profile.name);

      log.info({ email, sub: profile.sub }, "Login via Google");
      return {
        success: true,
        email,
        name: profile.name,
        picture: profile.picture,
      } as const;
    }),

  /**
   * "Esqueci minha senha" — gera token de reset e envia email.
   *
   * Sempre retorna sucesso (mesmo se email não existe) pra não vazar
   * existência de conta. Logamos internamente o caso pra suporte.
   */
  esqueciSenha: publicProcedure
    .input(z.object({ email: z.string().email().max(320) }))
    .mutation(async ({ ctx, input }) => {
      const ip = ctx.req.ip || "unknown";

      // Rate limit duplo: 3/IP/h evita spam de IP malicioso, 3/email/h
      // evita ficar mandando email pra um user que está sendo flooded.
      const rlIp = rateLimitConsume({ name: "reset-ip", key: ip, max: 3, windowMs: 60 * 60_000 });
      if (!rlIp.allowed) return { success: true } as const;
      const rlEmail = rateLimitConsume({ name: "reset-email", key: input.email.toLowerCase(), max: 3, windowMs: 60 * 60_000 });
      if (!rlEmail.allowed) return { success: true } as const;

      const email = input.email.trim().toLowerCase();
      const user = await getUserByEmail(email);

      if (!user || !user.passwordHash) {
        // User não existe OU é só Google (não tem senha pra resetar).
        log.info({ email }, "Solicitação de reset pra user inexistente ou Google-only");
        return { success: true } as const;
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Invalida tokens anteriores não usados — best practice: 1 ativo por user.
      await db
        .update(passwordResetTokens)
        .set({ usadoEm: new Date() })
        .where(and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usadoEm),
        ));

      const token = randomUUID();
      const expiraEm = new Date(Date.now() + 60 * 60_000); // 1h

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        token,
        expiraEm,
      });

      const result = await enviarEmailRedefinirSenha({
        email,
        nome: user.name || "",
        token,
      });
      if (!result.success) {
        log.error({ email, error: result.error }, "Falha ao enviar email de reset");
      }

      return { success: true } as const;
    }),

  /**
   * Redefinir senha usando token. Valida que existe, não foi usado e não
   * expirou. Marca como usado, troca a senha do user.
   */
  redefinirSenha: publicProcedure
    .input(z.object({
      token: z.string().min(20).max(64),
      novaSenha: z.string().min(6).max(128),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [reg] = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.token, input.token))
        .limit(1);

      if (!reg) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Link inválido. Solicite uma nova redefinição." });
      }
      if (reg.usadoEm) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este link já foi usado. Solicite uma nova redefinição." });
      }
      if (reg.expiraEm.getTime() < Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este link expirou. Solicite uma nova redefinição." });
      }

      const [user] = await db.select().from(users).where(eq(users.id, reg.userId)).limit(1);
      if (!user) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Usuário não encontrado." });
      }

      const passwordHash = await hashPassword(input.novaSenha);

      await upsertUser({
        openId: user.openId,
        passwordHash,
      });

      await db
        .update(passwordResetTokens)
        .set({ usadoEm: new Date() })
        .where(eq(passwordResetTokens.id, reg.id));

      // Limpa rate limits do user — provou identidade.
      rateLimitReset("login-email", user.email || "");

      log.info({ userId: user.id }, "Senha redefinida via token");
      return { success: true } as const;
    }),
});
