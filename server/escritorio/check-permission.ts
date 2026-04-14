/**
 * Middleware de Permissões — Controle de Acesso Granular
 * 
 * Uso em qualquer rota tRPC:
 * 
 *   const perm = await checkPermission(ctx.user.id, "clientes", "criar");
 *   if (!perm.allowed) throw new Error("Sem permissão.");
 *   // Se ver_proprios (não ver_todos), filtrar por perm.colaboradorId
 * 
 * Retorna:
 * - allowed: boolean — se o usuário pode executar a ação
 * - verTodos: boolean — se pode ver dados de todos
 * - verProprios: boolean — se pode ver apenas os seus
 * - colaboradorId: number — ID do colaborador (para filtrar dados)
 * - escritorioId: number — ID do escritório
 * - cargo: string — cargo do colaborador
 */

import { getDb } from "../db";
import { colaboradores, cargosPersonalizados, permissoesCargo } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getEscritorioPorUsuario } from "./db-escritorio";

export interface PermissionResult {
  allowed: boolean;
  verTodos: boolean;
  verProprios: boolean;
  criar: boolean;
  editar: boolean;
  excluir: boolean;
  colaboradorId: number;
  escritorioId: number;
  cargo: string;
}

// Cache simples por request (evita múltiplas queries no mesmo handler)
const cache = new Map<string, { data: PermissionResult; ts: number }>();
const CACHE_TTL = 30000; // 30 segundos

// Permissões padrão para cargos legados (quando não tem cargo personalizado).
// Precisa bater com os MODULOS do router-permissoes.ts e com canSee() do AppLayout.
const PERMISSOES_LEGADO: Record<string, Record<string, PermissionResult>> = {
  dono: defaultPerm(true, true, true, true, true),
  gestor: {
    dashboard: perm(true, true, false, false, false),
    calculos: perm(true, true, true, true, true),
    clientes: perm(true, true, true, true, false),
    processos: perm(true, true, true, true, false),
    atendimento: perm(true, true, true, true, false),
    kanban: perm(true, true, true, true, false),
    agenda: perm(true, true, true, true, false),
    smartflow: perm(true, true, true, true, false),
    agentesIa: perm(true, true, true, true, false),
    relatorios: perm(true, true, false, false, false),
    financeiro: perm(true, true, true, true, false),
    configuracoes: perm(false, false, false, false, false),
    equipe: perm(true, true, false, false, false),
    // legados mantidos por retrocompat com dados antigos
    pipeline: perm(true, true, true, true, false),
    agendamento: perm(true, true, true, true, false),
  },
  atendente: {
    dashboard: perm(true, true, false, false, false),
    calculos: perm(true, true, true, true, false),
    clientes: perm(false, true, true, true, false),
    processos: perm(false, true, true, true, false),
    atendimento: perm(false, true, true, true, false),
    kanban: perm(false, true, true, true, false),
    agenda: perm(false, true, true, true, false),
    smartflow: perm(false, false, false, false, false),
    agentesIa: perm(false, true, false, false, false),
    relatorios: perm(false, false, false, false, false),
    financeiro: perm(false, false, false, false, false),
    configuracoes: perm(false, false, false, false, false),
    equipe: perm(false, true, false, false, false),
    pipeline: perm(false, true, true, true, false),
    agendamento: perm(false, true, true, true, false),
  },
  estagiario: {
    dashboard: perm(true, true, false, false, false),
    calculos: perm(true, true, false, false, false),
    clientes: perm(false, false, false, false, false),
    processos: perm(false, true, false, false, false),
    atendimento: perm(false, false, false, false, false),
    kanban: perm(false, false, false, false, false),
    agenda: perm(false, true, false, false, false),
    smartflow: perm(false, false, false, false, false),
    agentesIa: perm(false, false, false, false, false),
    relatorios: perm(false, false, false, false, false),
    financeiro: perm(false, false, false, false, false),
    configuracoes: perm(false, false, false, false, false),
    equipe: perm(false, true, false, false, false),
    pipeline: perm(false, false, false, false, false),
    agendamento: perm(false, true, false, false, false),
  },
};

function perm(vt: boolean, vp: boolean, c: boolean, e: boolean, x: boolean): PermissionResult {
  return { allowed: vt || vp, verTodos: vt, verProprios: vp, criar: c, editar: e, excluir: x, colaboradorId: 0, escritorioId: 0, cargo: "" };
}

function defaultPerm(vt: boolean, vp: boolean, c: boolean, e: boolean, x: boolean): Record<string, PermissionResult> {
  const modules = [
    "dashboard", "calculos", "clientes", "processos", "atendimento",
    "kanban", "agenda", "smartflow", "agentesIa", "relatorios", "financeiro",
    "configuracoes", "equipe",
    // legados
    "pipeline", "agendamento",
  ];
  const result: Record<string, PermissionResult> = {};
  for (const m of modules) result[m] = perm(vt, vp, c, e, x);
  return result;
}

/**
 * Verifica se o usuário tem permissão para uma ação em um módulo.
 */
export async function checkPermission(
  userId: number,
  modulo: string,
  acao: "ver" | "criar" | "editar" | "excluir" = "ver",
): Promise<PermissionResult> {
  // Cache check
  const cacheKey = `${userId}:${modulo}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return applyAction(cached.data, acao);
  }

  const esc = await getEscritorioPorUsuario(userId);
  if (!esc) return { allowed: false, verTodos: false, verProprios: false, criar: false, editar: false, excluir: false, colaboradorId: 0, escritorioId: 0, cargo: "" };

  const base = { colaboradorId: esc.colaborador.id, escritorioId: esc.escritorio.id, cargo: esc.colaborador.cargo };

  // Dono sempre tem tudo
  if (esc.colaborador.cargo === "dono") {
    const result = { allowed: true, verTodos: true, verProprios: true, criar: true, editar: true, excluir: true, ...base };
    cache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  }

  // Tentar cargo personalizado
  const cargoId = (esc.colaborador as any).cargoPersonalizadoId;
  if (cargoId) {
    const db = await getDb();
    if (db) {
      const [permRow] = await db.select().from(permissoesCargo)
        .where(and(eq(permissoesCargo.cargoId, cargoId), eq(permissoesCargo.modulo, modulo)))
        .limit(1);

      if (permRow) {
        const result: PermissionResult = {
          allowed: permRow.verTodos || permRow.verProprios,
          verTodos: permRow.verTodos,
          verProprios: permRow.verProprios,
          criar: permRow.criar,
          editar: permRow.editar,
          excluir: permRow.excluir,
          ...base,
        };
        cache.set(cacheKey, { data: result, ts: Date.now() });
        return applyAction(result, acao);
      }
    }
  }

  // Fallback: permissões legadas baseadas no cargo
  const legado = PERMISSOES_LEGADO[esc.colaborador.cargo]?.[modulo];
  if (legado) {
    const result = { ...legado, ...base };
    cache.set(cacheKey, { data: result, ts: Date.now() });
    return applyAction(result, acao);
  }

  // Default: sem permissão
  return { allowed: false, verTodos: false, verProprios: false, criar: false, editar: false, excluir: false, ...base };
}

function applyAction(perm: PermissionResult, acao: "ver" | "criar" | "editar" | "excluir"): PermissionResult {
  switch (acao) {
    case "ver": return { ...perm, allowed: perm.verTodos || perm.verProprios };
    case "criar": return { ...perm, allowed: perm.criar };
    case "editar": return { ...perm, allowed: perm.editar };
    case "excluir": return { ...perm, allowed: perm.excluir };
    default: return perm;
  }
}

/** Limpa cache (chamar quando permissões são atualizadas) */
export function limparCachePermissoes() {
  cache.clear();
}
