/**
 * Router admin — Módulo "Erros".
 *
 * Lê issues do Sentry via API REST. As credenciais ficam em
 * `admin_integracoes` com `provedor='sentry'` (configuradas pelo admin
 * em /admin/integracoes). Se ausentes/inválidas, retorna lista vazia
 * com `motivo` pra UI mostrar CTA "Configurar Sentry".
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { adminIntegracoes } from "../../drizzle/schema";
import { decrypt } from "../escritorio/crypto-utils";
import { createLogger } from "../_core/logger";

const log = createLogger("admin-router-erros");

interface SentryConfig {
  authToken: string;
  org: string;
  project: string;
}

async function carregarConfigSentry(): Promise<SentryConfig | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const [reg] = await db
      .select()
      .from(adminIntegracoes)
      .where(eq(adminIntegracoes.provedor, "sentry"))
      .limit(1);
    if (!reg?.apiKeyEncrypted || !reg.apiKeyIv || !reg.apiKeyTag) return null;
    const json = decrypt(reg.apiKeyEncrypted, reg.apiKeyIv, reg.apiKeyTag);
    const cfg = JSON.parse(json) as SentryConfig;
    if (!cfg.authToken || !cfg.org || !cfg.project) return null;
    return cfg;
  } catch (err: any) {
    log.warn({ err: err.message }, "Erro lendo config Sentry");
    return null;
  }
}

/**
 * Auto-cura de status: quando uma chamada real à API Sentry falha com
 * 4xx (token expirado, projeto não existe, etc), persiste isso em
 * `admin_integracoes.status="erro"` + `mensagemErro`. Assim o painel
 * /admin/integrations mostra o estado REAL, não o congelado do teste
 * inicial.
 *
 * Idempotente — se status já é "erro" com mesma mensagem, nada acontece.
 */
async function persistirErroSentry(httpStatus: number, mensagem: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(adminIntegracoes)
      .set({
        status: "erro",
        mensagemErro: `HTTP ${httpStatus}: ${mensagem}`,
        ultimoTeste: new Date(),
      })
      .where(eq(adminIntegracoes.provedor, "sentry"));
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha persistindo erro Sentry no DB");
  }
}

/** Auto-cura: limpa status de erro quando chamada à API funciona. */
async function persistirSucessoSentry(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(adminIntegracoes)
      .set({
        status: "conectado",
        mensagemErro: null,
        ultimoTeste: new Date(),
      })
      .where(eq(adminIntegracoes.provedor, "sentry"));
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha persistindo sucesso Sentry no DB");
  }
}

interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  shortId: string;
  permalink: string;
  level: "error" | "warning" | "info" | "fatal" | "debug";
  status: "resolved" | "unresolved" | "ignored";
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
}

export const adminErrosRouter = router({
  /**
   * Lista issues do projeto Sentry configurado.
   * Filtros: status (default unresolved), busca por título.
   * Paginação: cursor-based via header `Link` da API Sentry — abstraímos pra page/limite simples.
   */
  listar: adminProcedure
    .input(z.object({
      status: z.enum(["unresolved", "resolved", "ignored", "all"]).default("unresolved"),
      busca: z.string().max(255).optional(),
      limite: z.number().int().min(1).max(100).default(25),
      pagina: z.number().int().min(1).default(1),
    }))
    .query(async ({ input }) => {
      const cfg = await carregarConfigSentry();
      if (!cfg) {
        return { configurado: false as const, issues: [], total: 0, motivo: "sentry_nao_configurado" };
      }

      const params = new URLSearchParams();
      if (input.status !== "all") params.set("query", `is:${input.status}${input.busca ? ` ${input.busca}` : ""}`);
      else if (input.busca) params.set("query", input.busca);
      params.set("limit", String(input.limite));
      // Sentry API: cursor encoded como `0:offset:0`
      const offset = (input.pagina - 1) * input.limite;
      params.set("cursor", `0:${offset}:0`);

      const url = `https://sentry.io/api/0/projects/${encodeURIComponent(cfg.org)}/${encodeURIComponent(cfg.project)}/issues/?${params.toString()}`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${cfg.authToken}` },
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (!resp.ok) {
          log.warn({ status: resp.status }, "Sentry API retornou erro");
          // Auto-cura: persiste o erro real no DB pra painel /admin/integrations
          // mostrar status correto, não o congelado do teste inicial.
          const corpo = await resp.text().catch(() => "");
          await persistirErroSentry(resp.status, corpo.slice(0, 200) || resp.statusText);
          return { configurado: true as const, issues: [], total: 0, motivo: `sentry_http_${resp.status}` };
        }
        const data = (await resp.json()) as SentryIssue[];
        // Sucesso real → marca como conectado (cura status "erro" anterior)
        await persistirSucessoSentry();
        return {
          configurado: true as const,
          issues: data.map((i) => ({
            id: i.id,
            shortId: i.shortId,
            titulo: i.title,
            local: i.culprit,
            ocorrencias: parseInt(i.count, 10) || 0,
            usuariosAfetados: i.userCount || 0,
            primeiroVisto: i.firstSeen,
            ultimoVisto: i.lastSeen,
            nivel: i.level,
            status: i.status,
            link: i.permalink,
          })),
          total: data.length,
        };
      } catch (err: any) {
        clearTimeout(t);
        log.error({ err: err.message }, "Erro chamando Sentry API");
        return { configurado: true as const, issues: [], total: 0, motivo: err.name === "AbortError" ? "timeout" : "erro_rede" };
      }
    }),

  /** Marca um issue como resolvido. */
  resolver: adminProcedure
    .input(z.object({ issueId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const cfg = await carregarConfigSentry();
      if (!cfg) throw new Error("Sentry não configurado.");
      const url = `https://sentry.io/api/0/issues/${encodeURIComponent(input.issueId)}/`;
      const resp = await fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${cfg.authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      });
      if (!resp.ok) throw new Error(`Sentry retornou HTTP ${resp.status}`);
      return { success: true };
    }),
});
