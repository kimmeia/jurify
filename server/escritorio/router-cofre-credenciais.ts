/**
 * Router admin — Cofre de Credenciais (Frente B do Spike).
 *
 * Armazena credenciais (CPF/OAB + senha + 2FA TOTP) que permitem ao
 * motor próprio acessar tribunais autenticados (E-SAJ TJSP, TJCE,
 * PJe restrito, Eproc) com a OAB do dono do escritório.
 *
 * SEGURANÇA EM CAMADAS:
 *  1. `adminProcedure` — só admin do Jurify acessa endpoints
 *  2. Senha + TOTP secret criptografados com AES-256-GCM
 *     (server/escritorio/crypto-utils.ts) ANTES de tocar disco
 *  3. Backend NUNCA retorna senha/TOTP em claro — só `usernameMascarado`
 *  4. `cofre_credenciais.escritorioId` isola credenciais por escritório
 *  5. Soft delete via status="removida" preserva auditoria
 *
 * O admin do Jurify cadastra as credenciais associadas ao próprio
 * escritório (pega via `getEscritorioPorUsuario(ctx.user.id)`). Quando
 * a feature for promovida pra usuários comuns, este router muda de
 * adminProcedure pra protectedProcedure + verificação de cargo "dono".
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, ne } from "drizzle-orm";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { cofreCredenciais } from "../../drizzle/schema";
import { encrypt, maskToken } from "./crypto-utils";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { createLogger } from "../_core/logger";
import { ambienteSuportaTeste } from "../_core/ambiente";
import {
  COFRE_VALIDACOES,
  type CofreCredencialView,
  type SistemaCofre,
  type StatusCredencial,
} from "@shared/cofre-credenciais-types";

const log = createLogger("cofre-credenciais");

const SISTEMAS_VALIDOS: readonly SistemaCofre[] = [
  "pje_tjce", "pje_tjrj", "pje_tjmg", "pje_tjdft", "pje_tjpe", "pje_tjes",
  "pje_tjpr", "pje_tjrs", "pje_tjgo", "pje_*",
  "esaj_tjsp", "esaj_tjsc", "esaj_tjba", "esaj_tjam", "esaj_tjac",
  "esaj_tjto", "esaj_tjms", "esaj_tjal", "esaj_*",
  "pje_restrito_trt1", "pje_restrito_trt2", "pje_restrito_trt7",
  "pje_restrito_trt15", "pje_restrito_*",
  "eproc_trf2", "eproc_trf4", "eproc_*",
] as const;

/**
 * Resolve o escritório do admin logado. Lança FORBIDDEN se admin não
 * tem escritório vinculado (caso típico: SuperAdmin que ainda não
 * configurou escritório próprio durante o Spike).
 *
 * Quando o cofre virar feature genérica, esta função vira `getEscritorioOuLancar`
 * em `db-escritorio.ts` e é reusada por outros routers.
 */
async function resolverEscritorioId(userId: number): Promise<number> {
  const esc = await getEscritorioPorUsuario(userId);
  if (!esc) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Cofre de credenciais exige escritório cadastrado. " +
        "Crie um escritório primeiro em /configuracoes.",
    });
  }
  return esc.escritorio.id;
}

/**
 * Confirma que estamos em ambiente de teste antes de aceitar credenciais.
 * Em production o cofre fica desabilitado durante o Spike — a UI sequer
 * fica acessível na interface (admin-only), e este gate é defesa
 * adicional caso alguém chame o endpoint diretamente.
 */
function exigirAmbienteTeste() {
  if (!ambienteSuportaTeste()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Cofre de credenciais só está disponível em ambiente staging durante o Spike. " +
        "Em production será habilitado quando a Frente B do plano for promovida.",
    });
  }
}

/**
 * Converte uma row do banco (com campos criptografados) em view segura
 * para enviar ao frontend. NUNCA inclui senha ou TOTP secret.
 */
async function rowParaView(
  row: typeof cofreCredenciais.$inferSelect,
): Promise<CofreCredencialView> {
  // Username está criptografado — desencripta só o suficiente pra mostrar
  // mascarado. Decrypt completo é pra adapter na hora do login.
  const { decrypt } = await import("./crypto-utils");
  let usernameClean = "";
  try {
    usernameClean = decrypt(row.usernameEnc, row.usernameIv, row.usernameTag);
  } catch {
    usernameClean = "??";
  }
  return {
    id: row.id,
    escritorioId: row.escritorioId,
    sistema: row.sistema as SistemaCofre,
    apelido: row.apelido,
    usernameMascarado: maskToken(usernameClean, 4),
    tem2fa: !!row.totpSecretEnc,
    status: row.status as StatusCredencial,
    ultimoLoginSucessoEm: row.ultimoLoginSucessoEm?.toISOString() ?? null,
    ultimoErro: row.ultimoErro,
    criadoEm: row.createdAt.toISOString(),
    atualizadoEm: row.updatedAt.toISOString(),
  };
}

export const cofreCredenciaisRouter = router({
  /**
   * Lista credenciais do escritório do admin logado, ordenadas por
   * mais recente primeiro. Não inclui as marcadas como `removida`.
   */
  listar: adminProcedure.query(async ({ ctx }) => {
    exigirAmbienteTeste();
    const db = await getDb();
    if (!db) return [];
    const escritorioId = await resolverEscritorioId(ctx.user.id);

    const rows = await db
      .select()
      .from(cofreCredenciais)
      .where(
        and(
          eq(cofreCredenciais.escritorioId, escritorioId),
          ne(cofreCredenciais.status, "removida"),
        ),
      )
      .orderBy(desc(cofreCredenciais.createdAt));

    return Promise.all(rows.map(rowParaView));
  }),

  /**
   * Cadastra uma credencial nova. Criptografa todos os campos sensíveis
   * antes de gravar. Status inicial = "validando" (pendente de verificação
   * via login real — Sprint posterior).
   *
   * Validação real (com login no tribunal) virá no endpoint `validar`.
   * Por ora, status fica "validando" e o adapter vai aceitar pra teste
   * (`exigirAmbienteTeste()` já restringe o uso).
   */
  criar: adminProcedure
    .input(
      z.object({
        sistema: z.enum(SISTEMAS_VALIDOS as readonly [SistemaCofre, ...SistemaCofre[]]),
        apelido: z
          .string()
          .min(COFRE_VALIDACOES.apelidoMinLen)
          .max(COFRE_VALIDACOES.apelidoMaxLen),
        username: z
          .string()
          .min(COFRE_VALIDACOES.usernameMinLen)
          .max(COFRE_VALIDACOES.usernameMaxLen),
        password: z
          .string()
          .min(COFRE_VALIDACOES.passwordMinLen)
          .max(COFRE_VALIDACOES.passwordMaxLen),
        totpSecret: z
          .string()
          .min(COFRE_VALIDACOES.totpSecretMinLen)
          .max(COFRE_VALIDACOES.totpSecretMaxLen)
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      exigirAmbienteTeste();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

      const userEnc = encrypt(input.username);
      const passEnc = encrypt(input.password);
      const totpEnc = input.totpSecret ? encrypt(input.totpSecret) : null;

      const result = await db.insert(cofreCredenciais).values({
        escritorioId,
        sistema: input.sistema,
        apelido: input.apelido,
        usernameEnc: userEnc.encrypted,
        usernameIv: userEnc.iv,
        usernameTag: userEnc.tag,
        passwordEnc: passEnc.encrypted,
        passwordIv: passEnc.iv,
        passwordTag: passEnc.tag,
        totpSecretEnc: totpEnc?.encrypted,
        totpSecretIv: totpEnc?.iv,
        totpSecretTag: totpEnc?.tag,
        status: "validando",
        criadoPor: ctx.user.id,
      });
      const insertId = (result as unknown as { insertId: number }[])[0]?.insertId
        ?? (result as unknown as { insertId: number }).insertId;

      log.info(
        { admin: ctx.user.id, escritorioId, sistema: input.sistema, credencialId: insertId },
        "[cofre] credencial cadastrada",
      );

      const [row] = await db
        .select()
        .from(cofreCredenciais)
        .where(eq(cofreCredenciais.id, insertId))
        .limit(1);

      return rowParaView(row);
    }),

  /**
   * Soft delete — marca status="removida". Preserva linha pra auditoria
   * (quem cadastrou, quando, último login bem-sucedido). A linha NÃO
   * volta nas listagens depois de removida.
   */
  remover: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      exigirAmbienteTeste();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

      // Confirma que credencial pertence ao escritório do admin antes de remover
      const [existente] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.id, input.id),
            eq(cofreCredenciais.escritorioId, escritorioId),
          ),
        )
        .limit(1);

      if (!existente) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Credencial não encontrada" });
      }

      await db
        .update(cofreCredenciais)
        .set({ status: "removida" })
        .where(eq(cofreCredenciais.id, input.id));

      log.info(
        { admin: ctx.user.id, credencialId: input.id },
        "[cofre] credencial removida (soft delete)",
      );

      return { ok: true };
    }),

  /**
   * Dispara validação real da credencial via login no tribunal.
   *
   * Fluxo:
   *  1. Decripta credencial via `buscarCredencialDecriptada()`
   *  2. Resolve adapter pelo sistema (esaj_tjce → EsajTjceScraper)
   *  3. Tenta login real (Playwright headless)
   *  4. Se ok → salva storageState em cofre_sessoes + status="ativa"
   *  5. Se falha → status="erro" + mensagem técnica
   *
   * Latência típica: 8-25s (boot Chromium + navegação + auth + 2FA).
   *
   * Sistemas suportados (atualmente):
   *  - `esaj_tjce` — implementação completa
   *  - outros ESAJ — fallback "não implementado" até PoC validar TJCE
   */
  validar: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      exigirAmbienteTeste();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

      const [row] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.id, input.id),
            eq(cofreCredenciais.escritorioId, escritorioId),
          ),
        )
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Credencial não encontrada" });
      }

      const { buscarCredencialDecriptada, atualizarStatusAposLogin, salvarSessao } =
        await import("./cofre-helpers");

      const cred = await buscarCredencialDecriptada(input.id);
      if (!cred) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Credencial não pode ser decriptada (chave de criptografia mudou?)",
        });
      }

      log.info(
        { admin: ctx.user.id, credencialId: input.id, sistema: cred.sistema },
        "[cofre] validando credencial via login real",
      );

      // Resolução de adapter por sistema. Lazy import pra não carregar
      // Playwright em production (gate de ambiente já protege, mas
      // double-defense contra bundle de devDeps no esbuild).
      if (cred.sistema === "pje_tjce") {
        const { PjeTjceScraper } = await import(
          "../../scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce"
        );
        const scraper = new PjeTjceScraper({
          username: cred.username,
          password: cred.password,
          totpSecret: cred.totpSecret,
        });
        const resultado = await scraper.testarLogin();

        // Se adapter auto-configurou 2FA (capturou secret da tela
        // CONFIGURE_TOTP do Keycloak), atualiza credencial no cofre
        // com o secret novo. ANTES de salvar status — se a atualização
        // falhar, queremos saber.
        if (resultado.ok && resultado.totpSecretConfigurado) {
          const totpEnc = encrypt(resultado.totpSecretConfigurado);
          await db
            .update(cofreCredenciais)
            .set({
              totpSecretEnc: totpEnc.encrypted,
              totpSecretIv: totpEnc.iv,
              totpSecretTag: totpEnc.tag,
            })
            .where(eq(cofreCredenciais.id, input.id));
          log.info(
            { credencialId: input.id },
            "[cofre] TOTP auto-configurado via Keycloak — secret atualizado no cofre",
          );
        }

        await atualizarStatusAposLogin(input.id, {
          ok: resultado.ok,
          mensagemErro: resultado.ok ? null : `${resultado.mensagem}${resultado.detalhes ? ` (${resultado.detalhes})` : ""}`,
        });

        if (resultado.ok && resultado.storageStateJson) {
          // PDPJ-cloud (Keycloak) mantém sessão por ~2h via cookie KC.
          // Marcamos prazo conservador de 90min pra forçar relogin antes
          // que o tribunal expire e dê erro 401 inesperado.
          const expira = new Date(Date.now() + 90 * 60 * 1000);
          await salvarSessao(input.id, resultado.storageStateJson, expira);
        }

        return {
          ok: resultado.ok,
          mensagem: resultado.mensagem,
          latenciaMs: resultado.latenciaMs,
          screenshotPath: resultado.screenshotPath,
          // Quando 2FA foi auto-configurado, devolve o secret pro
          // frontend mostrar pro usuário cadastrar no app autenticador
          // dele também. Sem isso, ele NÃO consegue logar manualmente
          // depois (só via Jurify).
          totpSecretConfigurado: resultado.totpSecretConfigurado ?? null,
        };
      }

      // Sistemas não-implementados ainda — mensagens específicas pra
      // sistemas legados / descontinuados ajudam o admin a entender
      // o que fazer.
      if (cred.sistema === "esaj_tjce") {
        await db
          .update(cofreCredenciais)
          .set({
            ultimoLoginTentativaEm: new Date(),
            ultimoErro:
              "Sistema 'esaj_tjce' foi removido do Spike — TJCE migrou pro PJe. Remova esta credencial e cadastre nova como 'PJe TJCE'.",
          })
          .where(eq(cofreCredenciais.id, input.id));
        return {
          ok: false,
          mensagem:
            "TJCE não usa mais E-SAJ — migrou pro PJe há um tempo. " +
            "Remova esta credencial (botão Remover) e cadastre uma nova selecionando 'PJe TJCE' no campo Sistema.",
        };
      }

      await db
        .update(cofreCredenciais)
        .set({
          ultimoLoginTentativaEm: new Date(),
          ultimoErro: `Validação automática não implementada para sistema "${cred.sistema}" — apenas pje_tjce está pronto no Spike atual`,
        })
        .where(eq(cofreCredenciais.id, input.id));

      return {
        ok: false,
        mensagem:
          `Sistema "${cred.sistema}" ainda não tem adapter de login automatizado. ` +
          `Apenas pje_tjce está pronto no Spike atual — outros virão conforme demanda.`,
      };
    }),

  // ─── COFRE PESSOAL (não-admin) ──────────────────────────────────────────
  // Cada usuário cadastra suas próprias credenciais OAB. Filtra por
  // `criadoPor = ctx.user.id`. Usado pela UI /cofre-credenciais e
  // pelo roteador de consultas em /processos (motor próprio busca a
  // credencial DO USUÁRIO ATUAL, não do escritório admin).

  /** Lista credenciais pessoais do usuário logado. */
  listarMinhas: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(cofreCredenciais)
      .where(
        and(
          eq(cofreCredenciais.criadoPor, ctx.user.id),
          ne(cofreCredenciais.status, "removida"),
        ),
      )
      .orderBy(desc(cofreCredenciais.createdAt));
    return Promise.all(rows.map(rowParaView));
  }),

  /** Cadastra credencial pessoal. */
  cadastrarMinha: protectedProcedure
    .input(
      z.object({
        sistema: z.enum(SISTEMAS_VALIDOS as readonly [SistemaCofre, ...SistemaCofre[]]),
        apelido: z.string().min(COFRE_VALIDACOES.apelidoMinLen).max(COFRE_VALIDACOES.apelidoMaxLen),
        username: z.string().min(COFRE_VALIDACOES.usernameMinLen).max(COFRE_VALIDACOES.usernameMaxLen),
        password: z.string().min(COFRE_VALIDACOES.passwordMinLen).max(COFRE_VALIDACOES.passwordMaxLen),
        totpSecret: z.string().min(COFRE_VALIDACOES.totpSecretMinLen).max(COFRE_VALIDACOES.totpSecretMaxLen).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

      const userEnc = encrypt(input.username);
      const passEnc = encrypt(input.password);
      const totpEnc = input.totpSecret ? encrypt(input.totpSecret) : null;

      const result = await db.insert(cofreCredenciais).values({
        escritorioId,
        sistema: input.sistema,
        apelido: input.apelido,
        usernameEnc: userEnc.encrypted,
        usernameIv: userEnc.iv,
        usernameTag: userEnc.tag,
        passwordEnc: passEnc.encrypted,
        passwordIv: passEnc.iv,
        passwordTag: passEnc.tag,
        totpSecretEnc: totpEnc?.encrypted,
        totpSecretIv: totpEnc?.iv,
        totpSecretTag: totpEnc?.tag,
        status: "validando",
        criadoPor: ctx.user.id,
      });
      const insertId =
        (result as unknown as { insertId: number }[])[0]?.insertId ??
        (result as unknown as { insertId: number }).insertId;

      log.info(
        { user: ctx.user.id, escritorioId, sistema: input.sistema, credencialId: insertId },
        "[cofre-pessoal] credencial cadastrada",
      );

      const [row] = await db
        .select()
        .from(cofreCredenciais)
        .where(eq(cofreCredenciais.id, insertId))
        .limit(1);
      return rowParaView(row);
    }),

  /** Soft delete da credencial pessoal — só dono pode remover. */
  removerMinha: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const [existente] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.id, input.id),
            eq(cofreCredenciais.criadoPor, ctx.user.id),
          ),
        )
        .limit(1);
      if (!existente) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Credencial não encontrada" });
      }

      await db
        .update(cofreCredenciais)
        .set({ status: "removida" })
        .where(eq(cofreCredenciais.id, input.id));

      log.info({ user: ctx.user.id, credencialId: input.id }, "[cofre-pessoal] credencial removida");
      return { ok: true };
    }),

  /** Validar credencial pessoal — login real no tribunal. */
  validarMinha: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const [row] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.id, input.id),
            eq(cofreCredenciais.criadoPor, ctx.user.id),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Credencial não encontrada" });

      const { buscarCredencialDecriptada, atualizarStatusAposLogin, salvarSessao } =
        await import("./cofre-helpers");
      const cred = await buscarCredencialDecriptada(input.id);
      if (!cred) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Credencial não pode ser decriptada",
        });
      }

      log.info(
        { user: ctx.user.id, credencialId: input.id, sistema: cred.sistema },
        "[cofre-pessoal] validando credencial via login real",
      );

      if (cred.sistema === "pje_tjce") {
        const { PjeTjceScraper } = await import(
          "../../scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce"
        );
        const scraper = new PjeTjceScraper({
          username: cred.username,
          password: cred.password,
          totpSecret: cred.totpSecret,
        });
        const resultado = await scraper.testarLogin();

        if (resultado.ok && resultado.totpSecretConfigurado) {
          const totpEnc = encrypt(resultado.totpSecretConfigurado);
          await db
            .update(cofreCredenciais)
            .set({
              totpSecretEnc: totpEnc.encrypted,
              totpSecretIv: totpEnc.iv,
              totpSecretTag: totpEnc.tag,
            })
            .where(eq(cofreCredenciais.id, input.id));
        }

        await atualizarStatusAposLogin(input.id, {
          ok: resultado.ok,
          mensagemErro: resultado.ok
            ? null
            : `${resultado.mensagem}${resultado.detalhes ? ` (${resultado.detalhes})` : ""}`,
        });

        if (resultado.ok && resultado.storageStateJson) {
          const expira = new Date(Date.now() + 90 * 60 * 1000);
          await salvarSessao(input.id, resultado.storageStateJson, expira);
        }

        return {
          ok: resultado.ok,
          mensagem: resultado.mensagem,
          latenciaMs: resultado.latenciaMs,
        };
      }

      await db
        .update(cofreCredenciais)
        .set({
          ultimoLoginTentativaEm: new Date(),
          ultimoErro: `Validação automática não implementada para "${cred.sistema}" — apenas pje_tjce`,
        })
        .where(eq(cofreCredenciais.id, input.id));

      return {
        ok: false,
        mensagem: `Sistema "${cred.sistema}" ainda sem adapter automatizado.`,
      };
    }),
});
