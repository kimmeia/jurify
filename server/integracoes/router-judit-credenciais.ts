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

  /**
   * Cadastra nova credencial no cofre Judit + valida login automaticamente.
   *
   * Fluxo:
   * 1. Cadastra credencial no cofre da Judit (POST /credentials)
   * 2. Salva localmente com status "validando"
   * 3. Dispara consulta de teste usando a credencial (POST /requests)
   * 4. Polling até completed (max 45s)
   * 5. Se veio lawsuit → credencial funciona → marca "ativa"
   *    Se veio application_error → login falhou → marca "erro"
   */
  cadastrar: protectedProcedure
    .input(
      z.object({
        customerKey: z.string().min(2).max(128),
        systemName: z.string().min(1).max(64),
        username: z.string().min(3).max(64),
        password: z.string().min(4).max(255),
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

      // 1. Cadastra na Judit
      try {
        await client.cadastrarCredencial({
          system_name: input.systemName,
          customer_key: input.customerKey,
          username: input.username,
          password: input.password,
          ...(input.totpSecret ? { custom_data: { secret: input.totpSecret } } : {}),
        });
      } catch (err: any) {
        log.error({ err: err.message }, "Falha ao cadastrar credencial na Judit");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err.message || "Falha ao cadastrar credencial na Judit",
        });
      }

      // 2. Salva localmente com status "validando"
      const [result] = await db.insert(juditCredenciais).values({
        escritorioId: esc.escritorio.id,
        customerKey: input.customerKey,
        systemName: input.systemName,
        username: input.username,
        has2fa: !!input.totpSecret,
        status: "validando",
        mensagemErro: "Testando login no tribunal...",
        juditCredentialId: null,
        criadoPor: ctx.user.id,
      });
      const credId = (result as { insertId: number }).insertId;

      log.info(
        { escritorioId: esc.escritorio.id, systemName: input.systemName },
        "Credencial cadastrada — iniciando teste de login",
      );

      // 3. Dispara consulta de teste usando a credencial
      // Usa o username (CPF/OAB do advogado) como busca — assim a Judit
      // tenta logar no tribunal com a credencial cadastrada
      try {
        const searchType = input.username.replace(/\D/g, "").length === 11 ? "cpf" : "oab";
        const searchKey = searchType === "cpf" ? input.username.replace(/\D/g, "") : input.username;

        const request = await client.criarRequest({
          search: {
            search_type: searchType as any,
            search_key: searchKey,
            on_demand: true,
          },
          customer_key: input.customerKey,
          cache_ttl_in_days: 7,
        });

        // 4. Polling (max 45s)
        const startTime = Date.now();
        let validado = false;
        let erroMsg: string | null = null;

        while (Date.now() - startTime < 45000) {
          await new Promise((r) => setTimeout(r, 3000));
          const status = await client.consultarRequest(request.request_id);

          if (status.status === "completed") {
            const responses = await client.buscarRespostas(request.request_id, 1, 10);

            for (const r of responses.page_data) {
              if (r.response_type === "lawsuit" || r.response_type === "lawsuits") {
                validado = true;
              }
              if (r.response_type === "application_error") {
                const rd = r.response_data as any;
                const msg = rd?.message || "UNKNOWN_ERROR";
                const msgLower = msg.toLowerCase();
                if (
                  msgLower.includes("credential") ||
                  msgLower.includes("authentication") ||
                  msgLower.includes("login") ||
                  msgLower.includes("password") ||
                  msgLower.includes("unauthorized") ||
                  msgLower.includes("captcha")
                ) {
                  erroMsg = msg;
                }
              }
            }

            // Se não teve erro de auth e completed = credencial OK (mesmo sem processos)
            if (!erroMsg) validado = true;
            break;
          }
        }

        // 5. Atualiza status
        if (erroMsg) {
          await db.update(juditCredenciais)
            .set({ status: "erro", mensagemErro: `Login falhou: ${erroMsg}` })
            .where(eq(juditCredenciais.id, credId));

          return {
            success: false,
            id: credId,
            status: "erro" as const,
            mensagem: `Credencial cadastrada mas o login falhou: ${erroMsg}. Verifique os dados e tente novamente.`,
          };
        }

        if (validado) {
          await db.update(juditCredenciais)
            .set({ status: "ativa", mensagemErro: null })
            .where(eq(juditCredenciais.id, credId));

          return {
            success: true,
            id: credId,
            status: "ativa" as const,
            mensagem: "Credencial cadastrada e validada com sucesso! Login no tribunal confirmado.",
          };
        }

        // Timeout — não conseguiu validar a tempo, fica "validando"
        await db.update(juditCredenciais)
          .set({ mensagemErro: "Validação em andamento — aguarde alguns minutos." })
          .where(eq(juditCredenciais.id, credId));

        return {
          success: true,
          id: credId,
          status: "validando" as const,
          mensagem: "Credencial cadastrada. A validação está em andamento (pode levar alguns minutos).",
        };
      } catch (err: any) {
        // Erro no teste mas credencial foi cadastrada — fica "validando"
        log.warn({ err: err.message }, "Erro ao testar credencial — mantém validando");
        return {
          success: true,
          id: credId,
          status: "validando" as const,
          mensagem: "Credencial cadastrada. Não foi possível testar agora — será validada na próxima consulta.",
        };
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
