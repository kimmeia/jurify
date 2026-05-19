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
  getDb,
} from "../db";
import { colaboradores, users, passwordResetTokens, emailConfirmationTokens } from "../../drizzle/schema";
import { and, eq, isNull, gt } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import {
  enviarEmailRedefinirSenha,
  enviarEmailBoasVindas,
  enviarEmailConfirmacao,
} from "../_core/email";

const CONFIRMACAO_EMAIL_TTL_MS = 24 * 60 * 60_000; // 24h

function gerarTokenConfirmacao(): string {
  return randomBytes(32).toString("hex");
}

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

  /**
   * Cadastro com email + senha.
   *
   * Fase 2: NÃO cria sessão imediatamente. Cria user com `emailVerificado=false`,
   * gera token e envia email de confirmação (válido 24h). Cliente precisa
   * clicar no link antes de conseguir logar.
   *
   * `planoSlug` opcional: slug do plano que o cliente escolheu na LP. Será
   * consumido na Fase 3 pra iniciar trial após a confirmação.
   */
  signup: publicProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        email: z.string().email().max(320),
        password: z.string().min(6).max(128),
        aceitouTermos: z.literal(true, {
          errorMap: () => ({ message: "Você precisa aceitar os Termos de Uso e a Política de Privacidade para criar a conta." }),
        }),
        /** Slug do plano escolhido na LP (sessionStorage do Pricing.tsx). */
        planoSlug: z.string().max(64).optional(),
        /**
         * Token de convite quando o signup veio de `/convite/:token`.
         * Quando presente e válido + email confere com o convite:
         *  - user é criado com emailVerificado=true (convite já é prova de
         *    posse do email — o dono validou ao convidar)
         *  - pula geração/envio do email de confirmação
         *  - aceita o convite e cria sessão direto
         *  - retorna `needsConfirmation: false` pro frontend ir pro dashboard
         * Convidado é colaborador — nunca passa por /plans (não escolhe plano).
         */
        conviteToken: z.string().min(16).max(128).optional(),
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

      // Se veio com conviteToken, valida ANTES de criar user — assim falhamos
      // cedo sem deixar conta órfã quando o link do convite está quebrado.
      let conviteValido:
        | { id: number; escritorioId: number; email: string }
        | null = null;
      if (input.conviteToken) {
        const dbConv = await getDb();
        if (!dbConv) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });
        const { convitesColaborador } = await import("../../drizzle/schema");
        const [conv] = await dbConv
          .select()
          .from(convitesColaborador)
          .where(eq(convitesColaborador.token, input.conviteToken))
          .limit(1);
        if (!conv) throw new TRPCError({ code: "BAD_REQUEST", message: "Convite não encontrado." });
        if (conv.status !== "pendente") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Convite já foi ${conv.status}.` });
        }
        if (new Date(conv.expiresAt) < new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Convite expirado." });
        }
        if (conv.email.toLowerCase() !== email) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Este convite é para ${conv.email}. Cadastre-se usando esse email.`,
          });
        }
        conviteValido = { id: conv.id, escritorioId: conv.escritorioId, email: conv.email };
      }

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

      // Pega o user recém-criado pra ter id + persistir planoPretendido
      const userCriado = await getUserByEmail(email);
      if (!userCriado) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao criar conta." });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

      // ─── Fluxo de signup via CONVITE ─────────────────────────────────────
      // Convidado não passa pelo email de confirmação — o dono já validou
      // o email ao mandar o convite. Marca verificado, aceita o convite e
      // cria sessão. Convidado nunca vai pra /plans (não escolhe plano).
      if (conviteValido) {
        await db.update(users)
          .set({ emailVerificado: true, emailVerificadoEm: new Date() })
          .where(eq(users.id, userCriado.id));

        try {
          const { aceitarConvite } = await import("../escritorio/db-escritorio");
          await aceitarConvite(input.conviteToken!, userCriado.id);
        } catch (err: any) {
          log.error({ userId: userCriado.id, err: err.message }, "Falha ao aceitar convite no signup");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: err.message || "Falha ao aceitar convite. Tente novamente.",
          });
        }

        await setSessionCookie(ctx, openId, input.name);

        log.info({ email, escritorioId: conviteValido.escritorioId }, "Cadastro via convite — confirmação pulada, convite aceito");

        return {
          success: true,
          email,
          name: input.name,
          needsConfirmation: false,
          conviteAceito: true,
        } as const;
      }

      // ─── Fluxo de signup PADRÃO (dono de novo escritório) ────────────────

      // Persiste plano escolhido (se veio da LP) pra Fase 3 consumir.
      // emailVerificado já é false por default da migration.
      if (input.planoSlug) {
        await db.update(users)
          .set({ planoPretendido: input.planoSlug })
          .where(eq(users.id, userCriado.id));
      }

      // Gera token de confirmação (24h)
      const token = gerarTokenConfirmacao();
      const expiraEm = new Date(Date.now() + CONFIRMACAO_EMAIL_TTL_MS);
      await db.insert(emailConfirmationTokens).values({
        userId: userCriado.id,
        token,
        expiresAt: expiraEm,
      });

      log.info({ email }, "Novo cadastro via email/senha — aguardando confirmação");

      // Email de confirmação — não bloqueia signup se Resend falhar (cliente
      // pode pedir "reenviar" depois). Erro fica em email_log pra admin ver.
      void enviarEmailConfirmacao({ email, nome: input.name, token }).then((r) => {
        if (!r.success) log.warn({ email, error: r.error }, "Falha ao enviar email de confirmação");
      });

      return {
        success: true,
        email,
        name: input.name,
        needsConfirmation: true,
      } as const;
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
        // Mensagem genérica pra não vazar se o email existe.
        // BAD_REQUEST (HTTP 400), não UNAUTHORIZED — o handler global
        // do frontend (main.tsx) trata UNAUTHORIZED como sessão expirada
        // e força logout+redirect, o que mata o toast antes de aparecer
        // num login com senha errada (user não estava logado mesmo).
        throw new TRPCError({ code: "BAD_REQUEST", message: "E-mail ou senha incorretos." });
      }

      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "E-mail ou senha incorretos." });
      }

      // Email não confirmado: bloqueia login. Frontend exibe botão pra
      // reenviar confirmação. `cause` carrega o motivo pra UI tratar.
      if (!user.emailVerificado) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Confirme seu email antes de entrar. Verifique sua caixa de entrada.",
          cause: { motivo: "email_nao_confirmado", email },
        });
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

      // Cria ou atualiza. Google já valida o email no provedor, então
      // marca emailVerificado=true automaticamente.
      await upsertUser({
        openId,
        name: profile.name,
        email,
        googleSub: profile.sub,
        loginMethod: "google",
        lastSignedIn: new Date(),
        emailVerificado: true,
        emailVerificadoEm: new Date(),
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

  /**
   * Confirma email via token enviado no signup. Marca `emailVerificado=true`,
   * invalida o token e cria sessão (login automático após confirmação).
   *
   * Retorna `planoPretendido` se houver — o frontend usa pra direcionar
   * o cliente pro fluxo de trial (Fase 3) ou pra /plans (fallback).
   */
  confirmarEmail: publicProcedure
    .input(z.object({ token: z.string().min(32).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

      const [reg] = await db
        .select()
        .from(emailConfirmationTokens)
        .where(eq(emailConfirmationTokens.token, input.token))
        .limit(1);

      if (!reg) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Link inválido ou já usado." });
      }
      if (reg.usedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este link já foi usado. Tente fazer login." });
      }
      if (reg.expiresAt < new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Link expirado. Solicite um novo email de confirmação.",
          cause: { motivo: "token_expirado" },
        });
      }

      const [userRow] = await db.select().from(users).where(eq(users.id, reg.userId)).limit(1);
      if (!userRow) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });

      // Bloqueia se conta foi banida no intervalo entre signup e confirmação
      if (userRow.bloqueado) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: userRow.motivoBloqueio || "Sua conta está bloqueada.",
        });
      }

      // Marca verificado + consome token (idempotente: se já estava
      // verificado, ainda cria sessão pra UX consistente).
      await db.update(users)
        .set({
          emailVerificado: true,
          emailVerificadoEm: new Date(),
          lastSignedIn: new Date(),
        })
        .where(eq(users.id, userRow.id));

      await db.update(emailConfirmationTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailConfirmationTokens.id, reg.id));

      await setSessionCookie(ctx, userRow.openId, userRow.name || userRow.email || "");

      log.info({ userId: userRow.id, email: userRow.email }, "Email confirmado");

      // Fase 3: se o cliente escolheu um plano na LP e o plano tem trial,
      // inicia automaticamente. Best-effort — se falhar (sem trial dias,
      // plano não existe, escritório já usou trial), só loga e segue. UI
      // recebe `trialIniciado=false` e redireciona pra /plans normal.
      let trialIniciado = false;
      if (userRow.planoPretendido) {
        try {
          const { getPlanoBySlug } = await import("../billing/planos-repo");
          const plano = await getPlanoBySlug(userRow.planoPretendido);
          if (plano && plano.trialDias > 0) {
            const { getEscritorioPorUsuario, criarEscritorio } = await import("../escritorio/db-escritorio");
            const { escritorios } = await import("../../drizzle/schema");
            const { subscriptions: subsTable } = await import("../../drizzle/schema");

            let escVinculado = await getEscritorioPorUsuario(userRow.id);
            if (!escVinculado) {
              const nome = userRow.name || userRow.email || "Meu escritório";
              await criarEscritorio(userRow.id, nome, userRow.email ?? undefined);
              escVinculado = await getEscritorioPorUsuario(userRow.id);
            }

            if (escVinculado && !escVinculado.escritorio.jaUsouTrial) {
              const agora = Date.now();
              const expiraEm = agora + plano.trialDias * 24 * 60 * 60 * 1000;
              await db.insert(subsTable).values({
                userId: userRow.id,
                planId: plano.slug,
                status: "trialing",
                trialIniciadoEm: agora,
                trialExpiraEm: expiraEm,
                currentPeriodEnd: expiraEm,
                creditsLimit: plano.limites.creditosCalculosMes,
              });
              await db.update(escritorios)
                .set({ jaUsouTrial: true, trialUsadoEm: new Date() })
                .where(eq(escritorios.id, escVinculado.escritorio.id));
              trialIniciado = true;
              log.info(
                { userId: userRow.id, planoSlug: plano.slug },
                "Trial iniciado automaticamente após confirmação de email",
              );
            }
          }
        } catch (err: any) {
          log.warn({ userId: userRow.id, err: err.message }, "Falha ao iniciar trial automaticamente");
        }
      }

      return {
        success: true,
        email: userRow.email,
        name: userRow.name,
        planoPretendido: userRow.planoPretendido,
        trialIniciado,
      } as const;
    }),

  /**
   * Reenvia email de confirmação. Rate limit estrito (1/min/email) pra
   * evitar abuso. Invalida tokens anteriores não usados.
   *
   * Sempre retorna sucesso (mesmo se email não existe) pra não vazar
   * existência de conta.
   */
  reenviarConfirmacao: publicProcedure
    .input(z.object({ email: z.string().email().max(320) }))
    .mutation(async ({ ctx, input }) => {
      const ip = ctx.req.ip || "unknown";
      const email = input.email.trim().toLowerCase();

      // Rate limit: 1/min/email + 3/h/IP
      const rlEmail = rateLimitConsume({
        name: "reenviar-confirmacao-email",
        key: email,
        max: 1,
        windowMs: 60_000,
      });
      if (!rlEmail.allowed) {
        return { success: true } as const;
      }
      const rlIp = rateLimitConsume({
        name: "reenviar-confirmacao-ip",
        key: ip,
        max: 3,
        windowMs: 60 * 60_000,
      });
      if (!rlIp.allowed) {
        return { success: true } as const;
      }

      const user = await getUserByEmail(email);
      if (!user) {
        log.info({ email }, "Reenvio solicitado pra email inexistente");
        return { success: true } as const;
      }
      if (user.emailVerificado) {
        // Já verificado — não envia, mas retorna sucesso pra não confundir.
        return { success: true } as const;
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Invalida tokens anteriores não usados (mantém histórico via usedAt)
      await db.update(emailConfirmationTokens)
        .set({ usedAt: new Date() })
        .where(and(
          eq(emailConfirmationTokens.userId, user.id),
          isNull(emailConfirmationTokens.usedAt),
        ));

      // Gera token novo
      const token = gerarTokenConfirmacao();
      const expiraEm = new Date(Date.now() + CONFIRMACAO_EMAIL_TTL_MS);
      await db.insert(emailConfirmationTokens).values({
        userId: user.id,
        token,
        expiresAt: expiraEm,
      });

      const r = await enviarEmailConfirmacao({
        email,
        nome: user.name || "",
        token,
      });
      if (!r.success) {
        log.warn({ email, error: r.error }, "Falha ao reenviar email de confirmação");
      }

      return { success: true } as const;
    }),
});
