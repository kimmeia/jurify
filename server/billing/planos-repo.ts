/**
 * Repositório da tabela `planos` — fonte de verdade única do catálogo.
 *
 * O admin edita via /admin/planos. LP, /plans e validações de runtime
 * puxam daqui. Substitui o antigo `products.ts` (PLANS hardcoded) +
 * `planos_overrides` (apenas overrides).
 *
 * Cache: mantemos um cache em memória de 30s pra evitar query a cada
 * tela (catalog não muda toda hora). Invalidado quando admin edita.
 */

import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { planos, type PlanoRow } from "../../drizzle/schema";
import type { Plano } from "@shared/planos-types";
import type { ModuloAppId } from "@shared/modulos-app";
import { ehModuloValido } from "@shared/modulos-app";
import { createLogger } from "../_core/logger";

const log = createLogger("planos-repo");

interface CacheEntry {
  expiraEm: number;
  planos: Plano[];
}

let cache: CacheEntry | null = null;
const TTL_CACHE_MS = 30_000;

export function invalidarCachePlanos(): void {
  cache = null;
}

/**
 * Mapeia row do DB pra interface Plano (parseia JSON, normaliza tipos).
 * Em caso de JSON inválido, retorna arrays vazios — não quebra a chamada.
 */
function rowParaPlano(row: PlanoRow): Plano {
  const modulosRaw = Array.isArray(row.modulosLiberados)
    ? row.modulosLiberados
    : safeParseArray(row.modulosLiberados);
  const featuresRaw = Array.isArray(row.features)
    ? row.features
    : safeParseArray(row.features);

  const modulos = modulosRaw
    .filter((m): m is string => typeof m === "string")
    .filter(ehModuloValido) as ModuloAppId[];

  return {
    id: row.id,
    slug: row.slug,
    nome: row.nome,
    descricao: row.descricao,
    publicoAlvo: row.publicoAlvo,
    precoMensalCentavos: row.precoMensalCentavos,
    precoAnualCentavos: row.precoAnualCentavos,
    trialDias: row.trialDias,
    limites: {
      maxUsuarios: row.maxUsuarios,
      maxArmazenamentoMB: row.maxArmazenamentoMb,
      maxClientes: row.maxClientes,
      maxConexoesWhatsapp: row.maxConexoesWhatsapp,
      maxAgentesIa: row.maxAgentesIa,
      maxMonitoramentosProcessos: row.maxMonitoramentosProcessos,
      creditosCalculosMes: row.creditosCalculosMes,
    },
    modulosLiberados: modulos,
    features: featuresRaw.filter((f): f is string => typeof f === "string"),
    popular: row.popular,
    oculto: row.oculto,
    ordem: row.ordem,
    criadoEm: row.criadoEm.toISOString(),
    atualizadoEm: row.atualizadoEm.toISOString(),
  };
}

function safeParseArray(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      log.warn({ raw }, "JSON array inválido em planos");
      return [];
    }
  }
  return [];
}

/**
 * Retorna todos os planos da tabela, ordenados por `ordem` asc.
 * Inclui planos ocultos. Use `getPlanosVisiveis()` pra LP/checkout.
 */
export async function getAllPlanos(): Promise<Plano[]> {
  const agora = Date.now();
  if (cache && cache.expiraEm > agora) return cache.planos;

  const db = await getDb();
  if (!db) return [];

  const rows = await db.select().from(planos).orderBy(asc(planos.ordem));
  const mapped = rows.map(rowParaPlano);

  cache = { expiraEm: agora + TTL_CACHE_MS, planos: mapped };
  return mapped;
}

/**
 * Retorna apenas os planos visíveis na LP e em /plans (oculto=false).
 * Subscriptions existentes com plano oculto continuam válidas.
 */
export async function getPlanosVisiveis(): Promise<Plano[]> {
  const todos = await getAllPlanos();
  return todos.filter((p) => !p.oculto);
}

export async function getPlanoBySlug(slug: string): Promise<Plano | undefined> {
  const todos = await getAllPlanos();
  return todos.find((p) => p.slug === slug);
}

export async function getPlanoById(id: number): Promise<Plano | undefined> {
  const todos = await getAllPlanos();
  return todos.find((p) => p.id === id);
}

/**
 * Verifica se o plano com este slug libera o módulo informado.
 * Slug inexistente → false. Módulo obrigatório → sempre true (constante).
 */
export async function planoLiberaModulo(slug: string, modulo: ModuloAppId): Promise<boolean> {
  const plano = await getPlanoBySlug(slug);
  if (!plano) return false;
  return plano.modulosLiberados.includes(modulo);
}

/**
 * Helper pra UI admin: retorna planos formatados pra grid de edição.
 * Inclui ocultos e mantém ordem.
 */
export async function listarPlanosParaAdmin(): Promise<Plano[]> {
  return getAllPlanos();
}

/**
 * Insere/atualiza plano. Invalida cache. Usado pelo admin.
 */
export async function upsertPlano(
  dados: Omit<PlanoRow, "id" | "criadoEm" | "atualizadoEm"> & { id?: number },
): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  if (dados.id) {
    const { id, ...resto } = dados;
    await db.update(planos).set(resto).where(eq(planos.id, id));
    invalidarCachePlanos();
    return { id };
  }

  const result = await db.insert(planos).values(dados);
  invalidarCachePlanos();
  const insertId =
    (result as unknown as { insertId: number }[])[0]?.insertId ??
    (result as unknown as { insertId: number }).insertId;
  return { id: insertId };
}

export async function deletarPlano(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");
  await db.delete(planos).where(eq(planos.id, id));
  invalidarCachePlanos();
}
