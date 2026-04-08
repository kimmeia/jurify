/**
 * Router tRPC — Cofre de Credenciais Judit
 *
 * Permite ao escritório cadastrar credenciais de login (CPF/OAB + senha)
 * nos sistemas de tribunal. Essas credenciais são necessárias para:
 *   1. Monitorar processos em segredo de justiça
 *   2. Acessar processos que exigem autenticação de advogado
 *   3. Obter informações restritas de clientes representados
 *
 * As senhas são cadastradas DIRETAMENTE na Judit via
 * POST https://crawler.prod.judit.io/credentials — a Judit criptografa
 * e nunca permite recuperar. Localmente armazenamos apenas metadados
 * (username, system_name, status) + o ID retornado pela Judit pra
 * listagem/remoção.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { juditCredenciais } from "../../drizzle/schema";
import { eq, and, desc, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { getJuditClient } from "./judit-webhook";
import { createLogger } from "../_core/logger";

const log = createLogger("router-judit-credenciais");

/**
 * Lista de sistemas suportados. Exibida no select do frontend.
 * "*" é curinga — tenta usar a credencial em qualquer tribunal.
 */
export const SISTEMAS_TRIBUNAL = [
  { id: "*", label: "Todos os tribunais (curinga)" },
  { id: "tjsp", label: "TJ-SP — São Paulo" },
  { id: "tjrj", label: "TJ-RJ — Rio de Janeiro" },
  { id: "tjmg", label: "TJ-MG — Minas Gerais" },
  { id: "tjrs", label: "TJ-RS — Rio Grande do Sul" },
  { id: "tjpr", label: "TJ-PR — Paraná" },
  { id: "tjsc", label: "TJ-SC — Santa Catarina" },
  { id: "tjba", label: "TJ-BA — Bahia" },
  { id: "tjdft", label: "TJ-DFT — Distrito Federal" },
  { id: "trf1", label: "TRF-1 — Federal 1ª Região" },
  { id: "trf2", label: "TRF-2 — Federal 2ª Região" },
  { id: "trf3", label: "TRF-3 — Federal 3ª Região" },
  { id: "trf4", label: "TRF-4 — Federal 4ª Região" },
  { id: "trf5", label: "TRF-5 — Federal 5ª Região" },
  { id: "tst", label: "TST — Superior Trabalho" },
  { id: "trt2", label: "TRT-2 — Trabalho SP" },
  { id: "trt15", label: "TRT-15 — Trabalho Campinas" },
  { id: "stj", label: "STJ — Superior Justiça" },
  { id: "stf", label: "STF — Supremo" },
];

async function requireJuditClient() {
  const client = await getJuditClient();
  if (!client) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Integração Judit.IO indisponível. O admin precisa configurar em /admin/integrations.",
    });
  }
  return client;
}

export const juditCredenciaisRouter = router({
  /** Retorna a lista estática de sistemas de tribunal suportados */
  listarSistemasSuportados: protectedProcedure.query(() => SISTEMAS_TRIBUNAL),

  /** Lista credenciais do escritório (somente metadados, sem senhas) */
  listar: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select()
      .from(juditCredenciais)
      .where(
        and(
          eq(juditCredenciais.escritorioId, esc.escritorio.id),
          ne(juditCredenciais.status, "removida"),
        ),
      )
      .orderBy(desc(juditCredenciais.createdAt));

    return rows.map((r) => ({
      id: r.id,
      customerKey: r.customerKey,
      systemName: r.systemName,
      username: r.username,
      has2fa: r.has2fa,
      status: r.status,
      mensagemErro: r.mensagemErro,
      createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
    }));
  }),

  /** Cadastra nova credencial no cofre Judit + registra metadados local */
  cadastrar: protectedProcedure
    .input(
      z.object({
        customerKey: z.string().min(2).max(128),
        systemName: z.string().min(1).max(64),
        username: z.string().min(3).max(64),
        password: z.string().min(4).max(255),
        /** Secret do 2FA (opcional) */
        totpSecret: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN", message: "Escritório não encontrado" });
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas donos e gestores podem gerenciar credenciais",
        });
      }

      const client = await requireJuditClient();
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      // 1. Cadastra na Judit primeiro
      try {
        const resposta = await client.cadastrarCredencial({
          system_name: input.systemName,
          customer_key: input.customerKey,
          username: input.username,
          password: input.password,
          ...(input.totpSecret ? { custom_data: { secret: input.totpSecret } } : {}),
        });

        // 2. Salva metadados localmente
        const juditCredId = resposta.credential_id || resposta.id || null;
        const [result] = await db.insert(juditCredenciais).values({
          escritorioId: esc.escritorio.id,
          customerKey: input.customerKey,
          systemName: input.systemName,
          username: input.username,
          has2fa: !!input.totpSecret,
          status: "ativa",
          juditCredentialId: juditCredId,
          criadoPor: ctx.user.id,
        });

        log.info(
          { escritorioId: esc.escritorio.id, systemName: input.systemName, juditCredId },
          "Credencial cadastrada com sucesso",
        );

        return {
          success: true,
          id: (result as { insertId: number }).insertId,
          juditCredentialId: juditCredId,
          mensagem: "Credencial cadastrada. A Judit vai validar o login na próxima consulta.",
        };
      } catch (err: any) {
        log.error({ err: err.message }, "Falha ao cadastrar credencial");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err.message || "Falha ao cadastrar credencial na Judit",
        });
      }
    }),

  /**
   * Remove uma credencial — soft delete local + DELETE na Judit.
   * Monitoramentos que dependiam dessa credencial param de funcionar.
   */
  remover: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN", message: "Escritório não encontrado" });
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
      }

      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [cred] = await db
        .select()
        .from(juditCredenciais)
        .where(
          and(
            eq(juditCredenciais.id, input.id),
            eq(juditCredenciais.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!cred) throw new TRPCError({ code: "NOT_FOUND", message: "Credencial não encontrada" });

      // Deleta na Judit (best-effort — se falhar, ainda marca removida)
      if (cred.juditCredentialId) {
        try {
          const client = await getJuditClient();
          if (client) {
            await client.deletarCredencial(cred.juditCredentialId);
          }
        } catch (err: any) {
          log.warn(
            { err: err.message, credId: cred.juditCredentialId },
            "Falha ao deletar na Judit — marcando removida localmente mesmo assim",
          );
        }
      }

      // Soft delete local
      await db
        .update(juditCredenciais)
        .set({ status: "removida" })
        .where(eq(juditCredenciais.id, input.id));

      return { success: true };
    }),

  /**
   * Re-tenta marcar como ativa uma credencial que estava com erro.
   * Útil quando o usuário corrigiu a senha externamente (não dá pra
   * atualizar a senha na Judit sem cadastrar de novo).
   */
  marcarAtiva: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN", message: "Escritório não encontrado" });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      await db
        .update(juditCredenciais)
        .set({ status: "ativa", mensagemErro: null })
        .where(
          and(
            eq(juditCredenciais.id, input.id),
            eq(juditCredenciais.escritorioId, esc.escritorio.id),
          ),
        );

      return { success: true };
    }),
});
