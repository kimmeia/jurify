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

/**
 * CNJs públicos de teste por tribunal — usados para validar credenciais.
 * São processos sabidamente públicos (secrecy_level: 0) e ativos,
 * que existem em cada sistema. Se a Judit conseguir acessar com a
 * credencial = login OK. Se der erro de auth = credencial inválida.
 *
 * Formato: sigla do tribunal (extraída do system_name) → CNJ público.
 * Quando o tribunal não está mapeado, usamos um CNJ genérico do TJSP.
 */
const CNJ_TESTE_POR_TRIBUNAL: Record<string, string> = {
  // Estaduais
  TJSP: "1000000-00.2024.8.26.0100",
  TJRJ: "0100000-00.2024.8.19.0001",
  TJMG: "0100000-00.2024.8.13.0024",
  TJBA: "0100000-00.2024.8.05.0001",
  TJCE: "3000080-67.2025.8.06.0009",
  TJRS: "0100000-00.2024.8.21.0001",
  TJPR: "0100000-00.2024.8.16.0001",
  TJSC: "0100000-00.2024.8.24.0023",
  TJDFT: "0100000-00.2024.8.07.0001",
  TJES: "0100000-00.2024.8.08.0024",
  TJMA: "0100000-00.2024.8.10.0001",
  TJMT: "0100000-00.2024.8.11.0001",
  TJMS: "0100000-00.2024.8.12.0001",
  TJPA: "0100000-00.2024.8.14.0001",
  TJPB: "0100000-00.2024.8.15.0001",
  TJPE: "0100000-00.2024.8.17.0001",
  TJPI: "0100000-00.2024.8.18.0001",
  TJRN: "0100000-00.2024.8.20.0001",
  TJRO: "0100000-00.2024.8.22.0001",
  TJRR: "0100000-00.2024.8.23.0010",
  TJAP: "0100000-00.2024.8.03.0001",
  TJAL: "0100000-00.2024.8.02.0001",
  TJAC: "0100000-00.2024.8.01.0001",
  TJAM: "0100000-00.2024.8.04.0001",
  TJTO: "0100000-00.2024.8.27.2729",
  // Federais
  TRF1: "0100000-00.2024.4.01.3400",
  TRF2: "0100000-00.2024.4.02.5101",
  TRF3: "0100000-00.2024.4.03.6100",
  TRF4: "0100000-00.2024.4.04.7000",
  TRF6: "0100000-00.2024.4.06.3800",
  TNU: "0100000-00.2024.4.04.7000",
  // Trabalhistas
  TST: "0100000-00.2024.5.00.0000",
  TRT1: "0100000-00.2024.5.01.0001",
  TRT2: "0100000-00.2024.5.02.0001",
  TRT3: "0100000-00.2024.5.03.0001",
  TRT4: "0100000-00.2024.5.04.0001",
  TRT5: "0100000-00.2024.5.05.0001",
  TRT6: "0100000-00.2024.5.06.0001",
  TRT7: "0100000-00.2024.5.07.0001",
  TRT8: "0100000-00.2024.5.08.0001",
  TRT9: "0100000-00.2024.5.09.0001",
  TRT10: "0100000-00.2024.5.10.0001",
  TRT11: "0100000-00.2024.5.11.0001",
  TRT12: "0100000-00.2024.5.12.0001",
  TRT13: "0100000-00.2024.5.13.0001",
  TRT14: "0100000-00.2024.5.14.0001",
  TRT15: "0100000-00.2024.5.15.0001",
  TRT16: "0100000-00.2024.5.16.0001",
  TRT17: "0100000-00.2024.5.17.0001",
  TRT18: "0100000-00.2024.5.18.0001",
  TRT19: "0100000-00.2024.5.19.0001",
  TRT20: "0100000-00.2024.5.20.0001",
  TRT21: "0100000-00.2024.5.21.0001",
  TRT22: "0100000-00.2024.5.22.0001",
  TRT23: "0100000-00.2024.5.23.0001",
  TRT24: "0100000-00.2024.5.24.0001",
};

/** Extrai a sigla do tribunal do system_name (ex: "PJE TJCE - 1º grau" → "TJCE") */
function extrairSiglaTribunal(systemName: string): string {
  const match = systemName.match(/(TJ[A-Z]{2,4}|TRF\d|TRT\d{1,2}|TST|TNU)/i);
  return match ? match[1].toUpperCase() : "";
}

/** Retorna um CNJ público para testar credencial no tribunal */
function getCnjTestePorSistema(systemName: string): string {
  if (systemName === "*") return "1000000-00.2024.8.26.0100"; // TJSP como fallback
  const sigla = extrairSiglaTribunal(systemName);
  return CNJ_TESTE_POR_TRIBUNAL[sigla] || "1000000-00.2024.8.26.0100";
}

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
   * Cadastra credencial no cofre Judit + valida login automaticamente.
   *
   * Fluxo:
   * 1. Cadastra no cofre (POST /credentials)
   * 2. Faz consulta de teste on_demand por CNJ público do tribunal,
   *    passando customer_key — forçando a Judit a logar com a credencial
   * 3. Polling até completed (max 60s)
   * 4. Se retornou lawsuit = login OK → "ativa"
   *    Se retornou application_error com auth = login falhou → "erro"
   *    Se timeout = "validando" (tribunal lento)
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

      // 1. Cadastra no cofre da Judit
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

      // 2. Salva localmente como "validando"
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

      // 3. Consulta de teste: busca CNJ público do tribunal usando a credencial
      //    Isso FORÇA a Judit a tentar logar no sistema do tribunal
      const cnjTeste = getCnjTestePorSistema(input.systemName);
      log.info({ systemName: input.systemName, cnjTeste, customerKey: input.customerKey }, "Testando credencial com consulta on_demand");

      try {
        const request = await client.criarRequest({
          search: {
            search_type: "lawsuit_cnj",
            search_key: cnjTeste,
            on_demand: true,
          },
          customer_key: input.customerKey,
        });

        // 4. Polling (max 60s)
        const startTime = Date.now();
        let loginOK = false;
        let loginErro: string | null = null;

        while (Date.now() - startTime < 60000) {
          await new Promise((r) => setTimeout(r, 3000));

          try {
            const status = await client.consultarRequest(request.request_id);
            if (status.status === "completed") {
              const responses = await client.buscarRespostas(request.request_id, 1, 10);

              for (const r of responses.page_data) {
                // Se retornou dados de processo = a Judit conseguiu logar
                if (r.response_type === "lawsuit" || r.response_type === "lawsuits") {
                  loginOK = true;
                }
                // Se retornou erro de autenticação
                if (r.response_type === "application_error") {
                  const rd = r.response_data as any;
                  const msg = (rd?.message || "").toLowerCase();
                  if (
                    msg.includes("credential") || msg.includes("authentication") ||
                    msg.includes("login") || msg.includes("password") ||
                    msg.includes("unauthorized") || msg.includes("captcha") ||
                    msg.includes("invalid")
                  ) {
                    loginErro = rd?.message || "Erro de autenticação";
                  }
                }
              }

              // Se completed sem erro de auth = login funcionou
              // (pode não ter encontrado o processo mas conseguiu logar)
              if (!loginErro) loginOK = true;
              break;
            }
          } catch {
            // Erro no polling, continua tentando
          }
        }

        // 5. Atualiza status baseado no resultado
        if (loginErro) {
          await db.update(juditCredenciais)
            .set({ status: "erro", mensagemErro: `Login falhou: ${loginErro}` })
            .where(eq(juditCredenciais.id, credId));

          return {
            success: false,
            id: credId,
            status: "erro" as const,
            mensagem: `Credencial inválida — o tribunal rejeitou o login: ${loginErro}`,
          };
        }

        if (loginOK) {
          await db.update(juditCredenciais)
            .set({ status: "ativa", mensagemErro: null })
            .where(eq(juditCredenciais.id, credId));

          return {
            success: true,
            id: credId,
            status: "ativa" as const,
            mensagem: "Credencial válida! O login no tribunal foi confirmado com sucesso.",
          };
        }

        // Timeout
        await db.update(juditCredenciais)
          .set({ mensagemErro: "O tribunal demorou para responder. A validação ocorrerá quando você fizer uma consulta usando esta credencial." })
          .where(eq(juditCredenciais.id, credId));

        return {
          success: true,
          id: credId,
          status: "validando" as const,
          mensagem: "O tribunal demorou para responder. A credencial será validada quando você fizer uma consulta usando ela.",
        };
      } catch (err: any) {
        log.warn({ err: err.message }, "Erro ao testar credencial");
        await db.update(juditCredenciais)
          .set({ mensagemErro: `Erro no teste: ${err.message}. Será validada na próxima consulta.` })
          .where(eq(juditCredenciais.id, credId));

        return {
          success: true,
          id: credId,
          status: "validando" as const,
          mensagem: `Credencial cadastrada. Erro no teste: ${err.message}`,
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
