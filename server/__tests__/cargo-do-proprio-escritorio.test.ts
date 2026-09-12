/**
 * Cargo personalizado só vale dentro do escritório que o criou.
 *
 * `permissoes_cargo` só tem cargoId — não tem escritorioId. Então:
 *  - `permissoes.atribuirCargo` gravava `colaboradores.cargoPersonalizadoId`
 *    com qualquer id vindo do client, inclusive cargo de OUTRO escritório;
 *  - `checkPermission` seguia esse id e aplicava a matriz de lá.
 * Agora atribuir cargo alheio é NOT_FOUND sem gravar nada, e um cargo
 * alheio já gravado é ignorado (cai no nome do cargo, como quando não há
 * cargo personalizado).
 *
 * Estilo caller com db falso: o `where` capturado é renderizado no dialeto
 * MySQL pra provar que a coluna de escritório entrou na consulta.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";
import { cargosPersonalizados, colaboradores } from "../../drizzle/schema";

const captured = {
  selects: [] as { table: string; where: unknown }[],
  updates: [] as { table: string; set: any; where: unknown }[],
};
const filas: Record<string, any[][]> = {};

function tableName(t: any): string {
  return (t?.[Symbol.for("drizzle:Name")] as string) || "";
}
function consumir(table: string): any[] {
  const fila = filas[table];
  return fila && fila.length > 0 ? fila.shift()! : [];
}
function makeDb() {
  function builder(): any {
    const rec = { table: "", where: undefined as unknown };
    const b: any = {
      from: (t: any) => { rec.table = tableName(t); captured.selects.push(rec); return b; },
      innerJoin: () => b,
      leftJoin: () => b,
      where: (w: unknown) => { rec.where = w; return b; },
      orderBy: () => b,
      limit: () => Promise.resolve(consumir(rec.table)),
      then: (resolve: (v: unknown) => unknown) => resolve(consumir(rec.table)),
    };
    return b;
  }
  return {
    select: () => builder(),
    insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: (w: unknown) => {
          captured.updates.push({ table: tableName(t), set: s, where: w });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }),
  };
}
const dbInstance = makeDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
}));

const ESCRITORIO_DO_GESTOR = 1;
const OUTRO_ESCRITORIO = 2;
const getEscritorioPorUsuarioMock = vi.fn(async (): Promise<any> => ({
  escritorio: { id: ESCRITORIO_DO_GESTOR, nome: "Esc Teste", fusoHorario: "America/Sao_Paulo" },
  colaborador: { id: 10, cargo: "dono" },
}));
vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: (...a: unknown[]) => (getEscritorioPorUsuarioMock as any)(...a),
}));

const { appRouter } = await import("../routers");
const { checkPermission, limparCachePermissoes } = await import("../escritorio/check-permission");

function fakeCtx(): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google",
      role: "user", asaasCustomerId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}
const caller = () => appRouter.createCaller(fakeCtx());

const dialeto = new MySqlDialect();
function render(where: unknown): { sql: string; params: unknown[] } {
  const q = dialeto.sqlToQuery(where as SQL);
  return { sql: q.sql, params: q.params };
}
const col = (c: { name: string }) => `\`${c.name}\``;

beforeEach(() => {
  captured.selects = [];
  captured.updates = [];
  for (const k of Object.keys(filas)) delete filas[k];
  getEscritorioPorUsuarioMock.mockClear();
  limparCachePermissoes();
});

describe("permissoes.atribuirCargo", () => {
  it("cargo de outro escritório: NOT_FOUND e nada gravado", async () => {
    filas.cargos_personalizados = [[]];

    await expect(caller().permissoes.atribuirCargo({ colaboradorId: 55, cargoId: 777 }))
      .rejects.toMatchObject({ code: "NOT_FOUND", message: "Cargo não encontrado neste escritório." });

    expect(captured.updates).toEqual([]);
  });

  it("a busca do cargo amarra id E escritório do gestor na mesma cláusula", async () => {
    filas.cargos_personalizados = [[]];
    await caller().permissoes.atribuirCargo({ colaboradorId: 55, cargoId: 777 }).catch(() => {});

    const busca = captured.selects.find((s) => s.table === "cargos_personalizados");
    expect(busca, "esperava consulta em cargos_personalizados").toBeTruthy();
    const { sql, params } = render(busca!.where);
    expect(sql).toContain(col(cargosPersonalizados.id));
    expect(sql).toContain(col(cargosPersonalizados.escritorioId));
    expect(params).toEqual([777, ESCRITORIO_DO_GESTOR]);
  });

  it("cargo do próprio escritório: grava no colaborador (escopado)", async () => {
    filas.cargos_personalizados = [[{ id: 777 }]];

    const r = await caller().permissoes.atribuirCargo({ colaboradorId: 55, cargoId: 777 });

    expect(r).toEqual({ success: true });
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0].table).toBe("colaboradores");
    expect(captured.updates[0].set).toEqual({ cargoPersonalizadoId: 777 });
    const { sql, params } = render(captured.updates[0].where);
    expect(sql).toContain(col(colaboradores.escritorioId));
    expect(params).toEqual([55, ESCRITORIO_DO_GESTOR]);
  });
});

describe("checkPermission — cargo personalizado gravado", () => {
  const MATRIZ_FINANCEIRO_TOTAL = [{
    cargoId: 99, modulo: "financeiro", verTodos: true, verProprios: true, criar: true, editar: true, excluir: true,
  }];

  function atendenteComCargo(cargoPersonalizadoId: number) {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: ESCRITORIO_DO_GESTOR },
      colaborador: { id: 10, cargo: "atendente", cargoPersonalizadoId },
    });
  }

  it("cargo de OUTRO escritório é ignorado: a matriz dele não vale, cai no cargo pelo nome", async () => {
    atendenteComCargo(99);
    // 1ª consulta: o cargo 99 pertence ao escritório 2; 2ª: busca pelo nome "Atendente" não acha nada.
    filas.cargos_personalizados = [[{ escritorioId: OUTRO_ESCRITORIO }], []];
    filas.permissoes_cargo = [MATRIZ_FINANCEIRO_TOTAL];

    const r = await checkPermission(100, "financeiro", "ver");

    expect(r.allowed).toBe(false);
    expect(r.verTodos).toBe(false);
    // A matriz alheia nem chegou a ser lida.
    expect(captured.selects.map((s) => s.table)).not.toContain("permissoes_cargo");
    expect(filas.permissoes_cargo).toHaveLength(1);
  });

  it("cargo alheio ignorado ainda respeita o cargo pelo NOME quando ele existe aqui", async () => {
    atendenteComCargo(99);
    filas.cargos_personalizados = [[{ escritorioId: OUTRO_ESCRITORIO }], [{ id: 5 }]];
    filas.permissoes_cargo = [[{ cargoId: 5, modulo: "financeiro", verTodos: false, verProprios: true, criar: false, editar: false, excluir: false }]];

    const r = await checkPermission(100, "financeiro", "ver");

    expect(r.allowed).toBe(true);
    expect(r.verTodos).toBe(false);
    expect(r.verProprios).toBe(true);
    const buscaPorNome = captured.selects.filter((s) => s.table === "cargos_personalizados")[1];
    expect(render(buscaPorNome.where).params).toEqual([ESCRITORIO_DO_GESTOR, "Atendente"]);
  });

  it("cargo do PRÓPRIO escritório segue valendo", async () => {
    atendenteComCargo(99);
    filas.cargos_personalizados = [[{ escritorioId: ESCRITORIO_DO_GESTOR }]];
    filas.permissoes_cargo = [MATRIZ_FINANCEIRO_TOTAL];

    const r = await checkPermission(100, "financeiro", "ver");

    expect(r.allowed).toBe(true);
    expect(r.verTodos).toBe(true);
    const buscaCargo = captured.selects.find((s) => s.table === "cargos_personalizados");
    expect(render(buscaCargo!.where).params).toEqual([99]);
  });
});
