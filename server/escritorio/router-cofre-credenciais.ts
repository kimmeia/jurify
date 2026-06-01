/**
 * Router Cofre de Credenciais.
 *
 * Armazena credenciais (CPF/OAB + senha + 2FA TOTP) que permitem ao
 * motor próprio acessar tribunais autenticados (PJe TJCE, E-SAJ, etc)
 * com a OAB do dono do escritório.
 *
 * SEGURANÇA EM CAMADAS:
 *  1. `protectedProcedure` + gate `exigirAdminProcessos` — apenas
 *     dono/gestor (ou cargos personalizados com `verTodos` em processos)
 *     podem cadastrar/editar credenciais
 *  2. Senha + TOTP secret criptografados com AES-256-GCM
 *     (server/escritorio/crypto-utils.ts) ANTES de tocar disco
 *  3. Backend NUNCA retorna senha/TOTP em claro — só `usernameMascarado`
 *  4. `cofre_credenciais.escritorioId` isola credenciais por escritório
 *  5. Soft delete via status="removida" preserva auditoria
 *
 * Exceção ao gate admin: `listarParaSelecao` é user-level (qualquer
 * colaborador do escritório) pra alimentar dropdown de "selecionar
 * credencial" no fluxo de criar monitoramento.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, ne } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { cofreCredenciais } from "../../drizzle/schema";
import { encrypt, maskToken } from "./crypto-utils";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { checkPermission } from "./check-permission";
import { createLogger } from "../_core/logger";
import { configPorSistema } from "../processos/tribunais-pdpj";
import {
  COFRE_VALIDACOES,
  type CofreCredencialView,
  type SistemaCofre,
  type StatusCredencial,
} from "@shared/cofre-credenciais-types";

/**
 * Cofre é restrito a admin do módulo processos: cargo com `verTodos=true`
 * em processos. Hoje na matriz padrão: dono e gestor passam, atendente/SDR/
 * estagiário ficam bloqueados (têm verProprios mas não verTodos).
 *
 * Cargos personalizados com `verTodos=true` em processos também passam —
 * o gate é por permissão, não por nome de cargo.
 */
async function exigirAdminProcessos(userId: number): Promise<void> {
  const perm = await checkPermission(userId, "processos", "ver");
  if (!perm.verTodos) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Acesso ao cofre exige permissão administrativa em Processos (ver tudo). " +
        "Solicite ao dono do escritório.",
    });
  }
}

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

async function rowParaView(
  row: typeof cofreCredenciais.$inferSelect,
): Promise<CofreCredencialView> {
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
  /** Lista credenciais do escritório. Apenas admin de processos (dono/gestor). */
  listarMinhas: protectedProcedure.query(async ({ ctx }) => {
    await exigirAdminProcessos(ctx.user.id);
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
   * Variante de `listarMinhas` SEM gate de admin — qualquer colaborador
   * do escritório pode chamar pra preencher dropdown de "selecionar
   * credencial" no fluxo de criar monitoramento. Retorna a mesma view
   * mascarada (sem expor senha/secret).
   *
   * Justificativa: criar monitoramento é operação user-level (qualquer
   * colaborador com permissão `processos.editar` pode), mas só donos/
   * gestores podem CADASTRAR/EDITAR credenciais (`listarMinhas`).
   */
  listarParaSelecao: protectedProcedure.query(async ({ ctx }) => {
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
   * Lista os sistemas de tribunal disponíveis pra cadastro no cofre.
   * Hoje só `pje_tjce` tem adapter de login automatizado; outros aparecem
   * como "em desenvolvimento" pra setar expectativa correta no dropdown.
   */
  listarMinhasSistemasSuportados: protectedProcedure.query(() => {
    return [
      { id: "pje_tjce", label: "PJe TJCE — 1º grau (disponível)", disponivel: true },
      { id: "esaj_tjsp", label: "E-SAJ TJSP — em desenvolvimento", disponivel: false },
      { id: "pje_tjrj", label: "PJe TJRJ — em desenvolvimento", disponivel: false },
      { id: "pje_tjmg", label: "PJe TJMG — em desenvolvimento", disponivel: false },
      { id: "pje_restrito_trt7", label: "PJe TRT-7 — em desenvolvimento", disponivel: false },
    ];
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
      await exigirAdminProcessos(ctx.user.id);
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
        "[cofre] credencial cadastrada",
      );

      const [row] = await db
        .select()
        .from(cofreCredenciais)
        .where(eq(cofreCredenciais.id, insertId))
        .limit(1);
      return rowParaView(row);
    }),

  /** Soft delete da credencial — apenas admin de processos (dono/gestor). */
  removerMinha: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await exigirAdminProcessos(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

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

      log.info({ user: ctx.user.id, escritorioId, credencialId: input.id }, "[cofre] credencial removida");
      return { ok: true };
    }),

  /** Validar credencial — login real no tribunal. Apenas admin de processos (dono/gestor). */
  validarMinha: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await exigirAdminProcessos(ctx.user.id);
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
        "[cofre] validando credencial via login real",
      );

      const cfgTribunal = configPorSistema(cred.sistema);
      if (cfgTribunal) {
        const { PjeTjceScraper } = await import(
          "../../scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce"
        );
        const scraper = new PjeTjceScraper(
          {
            username: cred.username,
            password: cred.password,
            totpSecret: cred.totpSecret,
          },
          cfgTribunal,
        );
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
