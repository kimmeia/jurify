/**
 * O cron de atraso do Kanban só LIGA a flag. Quando mover pra conclusão
 * passou a desligá-la, o cron religava uma hora depois — o card concluído
 * voltava a "⚠ Atrasado" sozinho. Aqui o UPDATE tem que deixar de fora quem
 * está em coluna de conclusão.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryBuilder } from "drizzle-orm/mysql-core";
import { escritorios, kanbanCards } from "../../drizzle/schema";

const filas: Record<string, any[]> = {};
const updates: { table: string; set: any; where: any }[] = [];

function tableName(t: any): string {
  return (t?.[Symbol.for("drizzle:Name")] as string) || "";
}

function makeDb() {
  function builder(): any {
    let table = "";
    const rows = () => filas[table] ?? [];
    const b: any = {
      from: (t: any) => { table = tableName(t); return b; },
      where: () => b,
      orderBy: () => b,
      limit: () => Promise.resolve(rows()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(rows()).then(res, rej),
    };
    return b;
  }
  return {
    select: () => builder(),
    update: (t: any) => ({
      set: (s: any) => ({
        where: (cond: any) => {
          updates.push({ table: tableName(t), set: s, where: cond });
          return Promise.resolve([{ affectedRows: 0 }]);
        },
      }),
    }),
  };
}

vi.mock("../db", () => ({ getDb: vi.fn(async () => makeDb()) }));
vi.mock("../escritorio/db-escritorio", () => ({ getEscritorioPorUsuario: vi.fn(async () => null) }));
vi.mock("../integracoes/asaas-sync", () => ({
  syncTodosEscritorios: vi.fn(async () => undefined),
  validarConexoesAsaasPendentes: vi.fn(async () => undefined),
}));
vi.mock("../integracoes/asaas-sync-historico", () => ({ processarSyncHistorico: vi.fn(async () => undefined) }));

const { verificarPrazosKanban } = await import("../_core/cron-jobs");

beforeEach(() => {
  for (const k of Object.keys(filas)) delete filas[k];
  updates.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-11T03:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("kanban-6 · cron não marca card em coluna de conclusão", () => {
  it("o UPDATE exclui as colunas de tipo 'conclusao' por subconsulta", async () => {
    filas[tableName(escritorios)] = [{ id: 1, fusoHorario: "America/Fortaleza" }];
    await verificarPrazosKanban();

    const up = updates.find((u) => u.table === tableName(kanbanCards));
    expect(up).toBeDefined();
    expect(up!.set).toEqual({ atrasado: true });

    const { sql, params } = new QueryBuilder().select().from(kanbanCards).where(up!.where).toSQL();
    // Sem os prefixos `tabela`. — o que importa é a subconsulta, não a forma.
    const semPrefixo = sql.replace(/`[a-z_]+`\./gi, "");
    expect(semPrefixo).toMatch(/`colunaIdKCard` not in \(select `id` from `kanban_colunas` where `tipoKC` = 'conclusao'\)/i);
    // As demais condições continuam: escritórios do fuso, flag desligada, prazo antes do corte.
    expect(params).toContain(1);
    expect(params).toContain(false);
  });
});
