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
/**
 * Lista de sistemas suportados pela Judit — nomes EXATOS conforme
 * retornados por GET /credentials. O system_name no POST /credentials
 * deve ser um desses valores (ou "*" para curinga).
 */
export const SISTEMAS_TRIBUNAL = [
  { id: "*", label: "Todos os tribunais (curinga)" },
  // ESAJ
  { id: "ESAJ - TJSP - 1º grau", label: "ESAJ - TJSP - 1º grau" },
  { id: "ESAJ - TJSP - 2º grau", label: "ESAJ - TJSP - 2º grau" },
  { id: "ESAJ - TJCE - 1º grau", label: "ESAJ - TJCE - 1º grau" },
  { id: "ESAJ - TJCE - 2º grau", label: "ESAJ - TJCE - 2º grau" },
  { id: "ESAJ - TJAL - 1º grau", label: "ESAJ - TJAL - 1º grau" },
  { id: "ESAJ - TJAL - 2º grau", label: "ESAJ - TJAL - 2º grau" },
  { id: "ESAJ - TJAC - 1º grau", label: "ESAJ - TJAC - 1º grau" },
  { id: "ESAJ - TJAC - 2º grau", label: "ESAJ - TJAC - 2º grau" },
  { id: "ESAJ - TJAM - 1º grau", label: "ESAJ - TJAM - 1º grau" },
  { id: "ESAJ - TJAM - 2º grau", label: "ESAJ - TJAM - 2º grau" },
  { id: "ESAJ - TJMS - 1º grau", label: "ESAJ - TJMS - 1º grau" },
  { id: "ESAJ - TJMS - 2º grau", label: "ESAJ - TJMS - 2º grau" },
  // PJE Estadual
  { id: "PJE TJBA - 1º grau", label: "PJE TJBA - 1º grau" },
  { id: "PJE TJBA - 2º grau", label: "PJE TJBA - 2º grau" },
  { id: "PJE TJCE - 1º grau", label: "PJE TJCE - 1º grau" },
  { id: "PJE TJCE - 2º grau", label: "PJE TJCE - 2º grau" },
  { id: "PJE TJDFT - 1º grau", label: "PJE TJDFT - 1º grau" },
  { id: "PJE TJDFT - 2º grau", label: "PJE TJDFT - 2º grau" },
  { id: "PJE TJES - 1º grau", label: "PJE TJES - 1º grau" },
  { id: "PJE TJES - 2º grau", label: "PJE TJES - 2º grau" },
  { id: "PJE TJMA - 1º grau", label: "PJE TJMA - 1º grau" },
  { id: "PJE TJMA - 2º grau", label: "PJE TJMA - 2º grau" },
  { id: "PJE TJMG - 1º grau", label: "PJE TJMG - 1º grau" },
  { id: "PJE TJMG - 2º grau", label: "PJE TJMG - 2º grau" },
  { id: "PJE TJMT - 1º grau", label: "PJE TJMT - 1º grau" },
  { id: "PJE TJMT - 2º grau", label: "PJE TJMT - 2º grau" },
  { id: "PJE TJPA - 1º grau", label: "PJE TJPA - 1º grau" },
  { id: "PJE TJPA - 2º grau", label: "PJE TJPA - 2º grau" },
  { id: "PJE TJPB - 1º grau", label: "PJE TJPB - 1º grau" },
  { id: "PJE TJPB - 2º grau", label: "PJE TJPB - 2º grau" },
  { id: "PJE TJPE - 1º grau", label: "PJE TJPE - 1º grau" },
  { id: "PJE TJPE - 2º grau", label: "PJE TJPE - 2º grau" },
  { id: "PJE TJPI - 1º grau", label: "PJE TJPI - 1º grau" },
  { id: "PJE TJPI - 2º grau", label: "PJE TJPI - 2º grau" },
  { id: "PJE TJRJ - 1º grau", label: "PJE TJRJ - 1º grau" },
  { id: "PJE TJRN - 1º grau", label: "PJE TJRN - 1º grau" },
  { id: "PJE TJRN - 2º grau", label: "PJE TJRN - 2º grau" },
  { id: "PJE TJRO - 1º grau", label: "PJE TJRO - 1º grau" },
  { id: "PJE TJRO - 2º grau", label: "PJE TJRO - 2º grau" },
  { id: "PJE TJRR - 1º grau", label: "PJE TJRR - 1º grau" },
  { id: "PJE TJRR - 2º grau", label: "PJE TJRR - 2º grau" },
  { id: "PJE TJAP - 1º grau", label: "PJE TJAP - 1º grau" },
  { id: "PJE TJAP - 2º grau", label: "PJE TJAP - 2º grau" },
  // TJRJ próprio
  { id: "TJRJ - 1º grau", label: "TJRJ - 1º grau" },
  { id: "TJRJ - 2º grau", label: "TJRJ - 2º grau" },
  // EPROC
  { id: "EPROC - TJRS - 1º grau", label: "EPROC - TJRS - 1º grau" },
  { id: "EPROC - TJRS - 2º grau", label: "EPROC - TJRS - 2º grau" },
  { id: "EPROC - TJSC - 1º grau", label: "EPROC - TJSC - 1º grau" },
  { id: "EPROC - TJSC - 2º grau", label: "EPROC - TJSC - 2º grau" },
  { id: "EPROC - TJMG - 1º grau", label: "EPROC - TJMG - 1º grau" },
  { id: "EPROC - TJMG - 2º grau", label: "EPROC - TJMG - 2º grau" },
  { id: "EPROC - TJTO - 1º grau", label: "EPROC - TJTO - 1º grau" },
  { id: "EPROC - TJTO - 2º grau", label: "EPROC - TJTO - 2º grau" },
  // EPROC Federal
  { id: "EPROC - JFES - 1º grau", label: "EPROC - JFES - 1º grau" },
  { id: "EPROC - JFPR - 1º grau", label: "EPROC - JFPR - 1º grau" },
  { id: "EPROC - JFRJ - 1º grau", label: "EPROC - JFRJ - 1º grau" },
  { id: "EPROC - JFRS - 1º grau", label: "EPROC - JFRS - 1º grau" },
  { id: "EPROC - JFSC - 1º grau", label: "EPROC - JFSC - 1º grau" },
  { id: "EPROC - TRF2 - 2º grau", label: "EPROC - TRF2 - 2º grau" },
  { id: "EPROC - TRF4 - 2º grau", label: "EPROC - TRF4 - 2º grau" },
  { id: "EPROC - TRF6 - 1º grau", label: "EPROC - TRF6 - 1º grau" },
  { id: "EPROC - TRF6 - 2º grau", label: "EPROC - TRF6 - 2º grau" },
  { id: "EPROC - TNU - 2º grau", label: "EPROC - TNU - 2º grau" },
  // PJE Federal
  { id: "PJE TRF1 - 1º grau", label: "PJE TRF1 - 1º grau" },
  { id: "PJE TRF1 - 2º grau", label: "PJE TRF1 - 2º grau" },
  { id: "PJE TRF3 - 1º grau", label: "PJE TRF3 - 1º grau" },
  { id: "PJE TRF3 - 2º grau", label: "PJE TRF3 - 2º grau" },
  // PJE Trabalho
  { id: "PJE TST - 1º grau", label: "PJE TST - 1º grau" },
  { id: "PJE TST - 2º grau", label: "PJE TST - 2º grau" },
  { id: "PJE TST - 3º grau", label: "PJE TST - 3º grau" },
  { id: "PJE TRT1 - 1º grau", label: "PJE TRT1 - 1º grau (RJ)" },
  { id: "PJE TRT1 - 2º grau", label: "PJE TRT1 - 2º grau (RJ)" },
  { id: "PJE TRT2 - 1º grau", label: "PJE TRT2 - 1º grau (SP)" },
  { id: "PJE TRT2 - 2º grau", label: "PJE TRT2 - 2º grau (SP)" },
  { id: "PJE TRT3 - 1º grau", label: "PJE TRT3 - 1º grau (MG)" },
  { id: "PJE TRT3 - 2º grau", label: "PJE TRT3 - 2º grau (MG)" },
  { id: "PJE TRT4 - 1º grau", label: "PJE TRT4 - 1º grau (RS)" },
  { id: "PJE TRT4 - 2º grau", label: "PJE TRT4 - 2º grau (RS)" },
  { id: "PJE TRT5 - 1º grau", label: "PJE TRT5 - 1º grau (BA)" },
  { id: "PJE TRT5 - 2º grau", label: "PJE TRT5 - 2º grau (BA)" },
  { id: "PJE TRT6 - 1º grau", label: "PJE TRT6 - 1º grau (PE)" },
  { id: "PJE TRT6 - 2º grau", label: "PJE TRT6 - 2º grau (PE)" },
  { id: "PJE TRT7 - 1º grau", label: "PJE TRT7 - 1º grau (CE)" },
  { id: "PJE TRT7 - CE - 2º grau", label: "PJE TRT7 - CE - 2º grau" },
  { id: "PJE TRT8 - 1º grau", label: "PJE TRT8 - 1º grau (PA)" },
  { id: "PJE TRT8 - 2º grau", label: "PJE TRT8 - 2º grau (PA)" },
  { id: "PJE TRT9 - 1º grau", label: "PJE TRT9 - 1º grau (PR)" },
  { id: "PJE TRT9 - 2º grau", label: "PJE TRT9 - 2º grau (PR)" },
  { id: "PJE TRT10 - 1º grau", label: "PJE TRT10 - 1º grau (DF)" },
  { id: "PJE TRT10 - 2º grau", label: "PJE TRT10 - 2º grau (DF)" },
  { id: "PJE TRT11 - 1º grau", label: "PJE TRT11 - 1º grau (AM)" },
  { id: "PJE TRT11 - 2º grau", label: "PJE TRT11 - 2º grau (AM)" },
  { id: "PJE TRT12 - 1º grau", label: "PJE TRT12 - 1º grau (SC)" },
  { id: "PJE TRT12 - 2º grau", label: "PJE TRT12 - 2º grau (SC)" },
  { id: "PJE TRT13 - 1º grau", label: "PJE TRT13 - 1º grau (PB)" },
  { id: "PJE TRT13 - 2º grau", label: "PJE TRT13 - 2º grau (PB)" },
  { id: "PJE TRT14 - 1º grau", label: "PJE TRT14 - 1º grau (RO)" },
  { id: "PJE TRT14 - 2º grau", label: "PJE TRT14 - 2º grau (RO)" },
  { id: "PJE TRT15 - 1º grau", label: "PJE TRT15 - 1º grau (Campinas)" },
  { id: "PJE TRT15 - 2º grau", label: "PJE TRT15 - 2º grau (Campinas)" },
  { id: "PJE TRT16 - 1º grau", label: "PJE TRT16 - 1º grau (MA)" },
  { id: "PJE TRT16 - 2º grau", label: "PJE TRT16 - 2º grau (MA)" },
  { id: "PJE TRT17 - 1º grau", label: "PJE TRT17 - 1º grau (ES)" },
  { id: "PJE TRT17 - 2º grau", label: "PJE TRT17 - 2º grau (ES)" },
  { id: "PJE TRT18 - 1º grau", label: "PJE TRT18 - 1º grau (GO)" },
  { id: "PJE TRT18 - 2º grau", label: "PJE TRT18 - 2º grau (GO)" },
  { id: "PJE TRT19 - 1º grau", label: "PJE TRT19 - 1º grau (AL)" },
  { id: "PJE TRT19 - 2º grau", label: "PJE TRT19 - 2º grau (AL)" },
  { id: "PJE TRT20 - 1º grau", label: "PJE TRT20 - 1º grau (SE)" },
  { id: "PJE TRT20 - 2º grau", label: "PJE TRT20 - 2º grau (SE)" },
  { id: "PJE TRT21 - 1º grau", label: "PJE TRT21 - 1º grau (RN)" },
  { id: "PJE TRT21 - 2º grau", label: "PJE TRT21 - 2º grau (RN)" },
  { id: "PJE TRT22 - 1º grau", label: "PJE TRT22 - 1º grau (PI)" },
  { id: "PJE TRT22 - 2º grau", label: "PJE TRT22 - 2º grau (PI)" },
  { id: "PJE TRT23 - 1º grau", label: "PJE TRT23 - 1º grau (MT)" },
  { id: "PJE TRT23 - 2º grau", label: "PJE TRT23 - 2º grau (MT)" },
  { id: "PJE TRT24 - 1º grau", label: "PJE TRT24 - 1º grau (MS)" },
  { id: "PJE TRT24 - 2º grau", label: "PJE TRT24 - 2º grau (MS)" },
  // PJEINTER
  { id: "PJEINTER TJAP - 1º grau", label: "PJEINTER TJAP - 1º grau" },
  { id: "PJEINTER TJAP - 2º grau", label: "PJEINTER TJAP - 2º grau" },
  { id: "PJEINTER TJBA - 1º grau", label: "PJEINTER TJBA - 1º grau" },
  { id: "PJEINTER TJES - 1º grau", label: "PJEINTER TJES - 1º grau" },
  { id: "PJEINTER TJMT - 1º grau", label: "PJEINTER TJMT - 1º grau" },
  { id: "PJEINTER TJPB - 1º grau", label: "PJEINTER TJPB - 1º grau" },
  { id: "PJEINTER TJPB - 2º grau", label: "PJEINTER TJPB - 2º grau" },
  { id: "PJEINTER TJRJ - 1º grau", label: "PJEINTER TJRJ - 1º grau" },
  { id: "PJEINTER TJRO - 1º grau", label: "PJEINTER TJRO - 1º grau" },
  // PROJUDI
  { id: "PROJUDI TJBA - 1º grau", label: "PROJUDI TJBA - 1º grau" },
  { id: "PROJUDI TJBA - 2º grau", label: "PROJUDI TJBA - 2º grau" },
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
   * Cadastra nova credencial no cofre Judit + verifica se foi aceita.
   *
   * Fluxo:
   * 1. Cadastra credencial no cofre (POST /credentials)
   * 2. Verifica com GET /credentials?customer_key=X se o cofre aceitou
   * 3. Se o sistema aparece como "active" → marca "ativa"
   *    Se "not exists" ou não aparece → marca "erro"
   *
   * IMPORTANTE: isso confirma que a Judit ACEITOU a credencial no cofre,
   * mas o login real no tribunal só é testado quando uma consulta
   * on_demand é feita. Se a senha estiver errada, o erro aparece nesse
   * momento (via webhook application_error).
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

      // 2. Verifica se a Judit aceitou: GET /credentials?customer_key=X
      //    Retorna { systems: [{ name, customer_key, credential_status }] }
      let cofreAtivo = false;
      try {
        await new Promise((r) => setTimeout(r, 2000));
        const verificacao = await client.verificarCredencial(input.customerKey);

        // A resposta pode ter .systems[] ou ser o array direto
        const systems: any[] = Array.isArray(verificacao)
          ? verificacao
          : verificacao.systems || verificacao;

        for (const item of systems) {
          const sn = item.name || item.system_name || "";
          const ck = item.customer_key || "";
          const st = (item.credential_status || "").toLowerCase();

          // Verifica se o sistema + customer_key batem e status é "active"
          if (st === "active") {
            if (input.systemName === "*") {
              // Curinga: qualquer sistema com essa customer_key ativo
              if (ck === input.customerKey) { cofreAtivo = true; break; }
            } else if (sn === input.systemName && ck === input.customerKey) {
              cofreAtivo = true;
              break;
            }
          }
        }
      } catch (err: any) {
        log.warn({ err: err.message }, "Erro ao verificar credencial no cofre");
      }

      // 3. Salva localmente
      const status = cofreAtivo ? "ativa" : "validando";
      const [result] = await db.insert(juditCredenciais).values({
        escritorioId: esc.escritorio.id,
        customerKey: input.customerKey,
        systemName: input.systemName,
        username: input.username,
        has2fa: !!input.totpSecret,
        status: status as any,
        mensagemErro: cofreAtivo
          ? null
          : "Credencial cadastrada mas ainda não confirmada pelo cofre. Será validada na primeira consulta.",
        juditCredentialId: null,
        criadoPor: ctx.user.id,
      });
      const credId = (result as { insertId: number }).insertId;

      log.info(
        { escritorioId: esc.escritorio.id, systemName: input.systemName, cofreAtivo },
        `Credencial cadastrada — cofre ${cofreAtivo ? "confirmou" : "pendente"}`,
      );

      if (cofreAtivo) {
        return {
          success: true,
          id: credId,
          status: "ativa" as const,
          mensagem: "Credencial cadastrada e confirmada no cofre da Judit! O login real será validado na primeira consulta a um processo em segredo de justiça.",
        };
      }

      return {
        success: true,
        id: credId,
        status: "validando" as const,
        mensagem: "Credencial cadastrada no cofre. A validação do login acontece na primeira consulta a um processo em segredo de justiça.",
      };
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
