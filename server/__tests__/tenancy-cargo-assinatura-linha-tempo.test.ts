/**
 * Testes — amarração de escritório em três procedures que cruzavam tenants
 * (auditoria de lançamento 03/09, bloqueador A):
 *
 *  - permissoes.atualizarCargo: `permissoes_cargo` só tem cargoId, então o
 *    loop delete+insert reescrevia as permissões de um cargo de OUTRO
 *    escritório (o update do cargo era escopado, o loop não).
 *  - assinaturas.excluir: `assinatura_campos` só tem assinaturaId; os campos
 *    de uma assinatura alheia eram apagados ANTES do delete escopado — o
 *    cliente do outro escritório abria o link e caía no modo legado.
 *  - atendimentoIa.linhaTempoUnificada: processos e cobranças filtrados só
 *    por contatoId (valor/status de cobrança alheia vazavam) e sem gate de
 *    Financeiro.
 *
 * Estilo caller: db falso com filas por tabela. O `where` capturado é
 * renderizado pelo dialeto MySQL pra provar que a coluna de escritório
 * entrou na consulta — tirar o `eq(escritorioId, …)` derruba o teste.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";
import {
  asaasCobrancas,
  assinaturasDigitais,
  cargosPersonalizados,
  clienteProcessos,
  contatos,
} from "../../drizzle/schema";

const captured = {
  selects: [] as { table: string; where: unknown }[],
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any }[],
  deletes: [] as { table: string; where: unknown }[],
};

// Filas de resultado por tabela: cada consulta (limit() ou await direto)
// consome 1 entrada; tabela sem fila devolve [].
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
      from: (t: any) => {
        rec.table = tableName(t);
        captured.selects.push(rec);
        return b;
      },
      innerJoin: () => b,
      leftJoin: () => b,
      where: (w: unknown) => {
        rec.where = w;
        return b;
      },
      orderBy: () => b,
      limit: () => Promise.resolve(consumir(rec.table)),
      then: (resolve: (v: unknown) => unknown) => resolve(consumir(rec.table)),
    };
    return b;
  }
  return {
    select: () => builder(),
    insert: (t: any) => ({
      values: (v: any) => {
        captured.inserts.push({ table: tableName(t), values: v });
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: () => {
          captured.updates.push({ table: tableName(t), set: s });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
    delete: (t: any) => ({
      where: (w: unknown) => {
        captured.deletes.push({ table: tableName(t), where: w });
        return Promise.resolve([{ affectedRows: 1 }]);
      },
    }),
  };
}

const dbInstance = makeDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste", fusoHorario: "America/Sao_Paulo" },
    colaborador: { id: 10, cargo: "dono" },
  })),
}));

let financeiroVer = true;
const checkPermissionMock = vi.fn(async () => ({
  allowed: financeiroVer,
  verTodos: financeiroVer,
  verProprios: financeiroVer,
  colaboradorId: 10,
  escritorioId: 1,
}));

vi.mock("../escritorio/check-permission", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../escritorio/check-permission")>();
  return {
    ...orig,
    checkPermission: (...args: unknown[]) => checkPermissionMock(...(args as [])),
  };
});

const { appRouter } = await import("../routers");

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

function caller() {
  return appRouter.createCaller(fakeCtx());
}

const dialeto = new MySqlDialect();

/** SQL + params do `where` como o MySQL receberia. */
function render(where: unknown): { sql: string; params: unknown[] } {
  const q = dialeto.sqlToQuery(where as SQL);
  return { sql: q.sql, params: q.params };
}

function whereDoSelect(table: string) {
  const s = captured.selects.filter((x) => x.table === table);
  expect(s, `esperava um select em ${table}`).not.toHaveLength(0);
  return render(s[0].where);
}

function col(c: { name: string }): string {
  return `\`${c.name}\``;
}

const tabelasConsultadas = () => captured.selects.map((s) => s.table);

beforeEach(() => {
  captured.selects = [];
  captured.inserts = [];
  captured.updates = [];
  captured.deletes = [];
  for (const k of Object.keys(filas)) delete filas[k];
  financeiroVer = true;
  checkPermissionMock.mockClear();
});

// ─── permissoes.atualizarCargo ───────────────────────────────────────────────

const PERMS = {
  clientes: { verTodos: true, verProprios: true, criar: true, editar: false, excluir: false },
};

describe("permissoes.atualizarCargo — cargo tem que ser do escritório", () => {
  it("cargo de outro escritório: erro e NADA gravado em permissoes_cargo", async () => {
    filas["cargos_personalizados"] = [[]];

    await expect(
      caller().permissoes.atualizarCargo({ id: 5, nome: "Recepção", permissoes: PERMS }),
    ).rejects.toThrow(/Cargo não encontrado/);

    expect(captured.deletes.filter((d) => d.table === "permissoes_cargo")).toHaveLength(0);
    expect(captured.inserts.filter((i) => i.table === "permissoes_cargo")).toHaveLength(0);
    expect(captured.updates).toHaveLength(0);
  });

  it("cargo próprio: conferência escopada, depois update + permissões gravadas", async () => {
    filas["cargos_personalizados"] = [[{ id: 5, escritorioId: 1, isDefault: false }]];

    const r = await caller().permissoes.atualizarCargo({ id: 5, nome: "Recepção", permissoes: PERMS });

    expect(r).toEqual({ success: true });

    const q = whereDoSelect("cargos_personalizados");
    expect(q.sql).toContain(col(cargosPersonalizados.escritorioId));
    expect(q.params).toEqual(expect.arrayContaining([5, 1]));

    expect(captured.updates).toEqual([{ table: "cargos_personalizados", set: { nome: "Recepção" } }]);

    const dels = captured.deletes.filter((d) => d.table === "permissoes_cargo");
    expect(dels).toHaveLength(1);
    const ins = captured.inserts.filter((i) => i.table === "permissoes_cargo");
    expect(ins).toHaveLength(1);
    expect(ins[0].values).toMatchObject({ cargoId: 5, modulo: "clientes", verTodos: true, editar: false });
  });
});

// ─── assinaturas.excluir ─────────────────────────────────────────────────────

describe("assinaturas.excluir — dono conferido ANTES do cascade dos campos", () => {
  it("assinatura de outro escritório: erro e ZERO delete (nem os campos)", async () => {
    filas["assinaturas_digitais"] = [[]];

    await expect(caller().assinaturas.excluir({ id: 3 })).rejects.toThrow(/Assinatura não encontrada/);

    expect(captured.deletes).toHaveLength(0);
  });

  it("assinatura própria: select escopado, depois campos e assinatura apagados", async () => {
    filas["assinaturas_digitais"] = [[{ id: 3, escritorioId: 1, status: "pendente" }]];

    const r = await caller().assinaturas.excluir({ id: 3 });

    expect(r).toEqual({ success: true });

    const q = whereDoSelect("assinaturas_digitais");
    expect(q.sql).toContain(col(assinaturasDigitais.escritorioId));
    expect(q.params).toEqual(expect.arrayContaining([3, 1]));

    expect(captured.deletes.map((d) => d.table)).toEqual(["assinatura_campos", "assinaturas_digitais"]);
    expect(render(captured.deletes[1].where).sql).toContain(col(assinaturasDigitais.escritorioId));
  });
});

// ─── atendimentoIa.linhaTempoUnificada ───────────────────────────────────────

const CONTATO = { id: 7, escritorioId: 1, nome: "Maria" };
const PROCESSO = { id: 1, escritorioId: 1, contatoId: 7, cnj: null };
const COBRANCA = {
  id: 50, escritorioId: 1, contatoId: 7, asaasPaymentId: "pay_1",
  status: "RECEIVED", valor: "150.00", dataPagamento: "2026-08-01", vencimento: "2026-08-01",
  descricao: "Honorários", formaPagamento: "PIX",
};

describe("atendimentoIa.linhaTempoUnificada — contato do escritório + gate de Financeiro", () => {
  it("contato de outro escritório: erro antes de consultar qualquer coisa", async () => {
    filas["contatos"] = [[]];

    await expect(
      caller().atendimentoIa.linhaTempoUnificada({ contatoId: 7 }),
    ).rejects.toThrow(/Contato não encontrado/);

    // O middleware do protectedProcedure consulta colaboradores antes; o que
    // importa é que DEPOIS de contatos nada mais foi lido.
    const tabelas = tabelasConsultadas();
    expect(tabelas).toContain("contatos");
    expect(tabelas.slice(tabelas.indexOf("contatos") + 1)).toEqual([]);
    expect(checkPermissionMock).not.toHaveBeenCalled();
  });

  it("sem financeiro.ver: asaas_cobrancas NEM é consultada e não sai evento de pagamento", async () => {
    financeiroVer = false;
    filas["contatos"] = [[CONTATO]];
    filas["cliente_processos"] = [[PROCESSO]];
    filas["asaas_cobrancas"] = [[COBRANCA]];

    const r = await caller().atendimentoIa.linhaTempoUnificada({ contatoId: 7 });

    expect(checkPermissionMock).toHaveBeenCalledWith(100, "financeiro", "ver");
    expect(tabelasConsultadas()).not.toContain("asaas_cobrancas");
    expect(filas["asaas_cobrancas"]).toHaveLength(1);
    expect(r.eventos.some((e) => e.tipo === "pagamento")).toBe(false);
    expect(r.counts.pagamentos).toBe(0);
  });

  it("com financeiro.ver: pagamentos aparecem, e processos/cobranças amarrados ao escritório", async () => {
    filas["contatos"] = [[CONTATO]];
    filas["cliente_processos"] = [[PROCESSO]];
    filas["asaas_cobrancas"] = [[COBRANCA]];

    const r = await caller().atendimentoIa.linhaTempoUnificada({ contatoId: 7 });

    expect(checkPermissionMock).toHaveBeenCalledWith(100, "financeiro", "ver");

    const pagamentos = r.eventos.filter((e) => e.tipo === "pagamento");
    expect(pagamentos).toHaveLength(1);
    expect(pagamentos[0]).toMatchObject({ id: "cob-50", subtipo: "pago" });
    expect(r.counts.pagamentos).toBe(1);

    const qc = whereDoSelect("contatos");
    expect(qc.sql).toContain(col(contatos.escritorioId));
    expect(qc.params).toEqual(expect.arrayContaining([7, 1]));

    const qp = whereDoSelect("cliente_processos");
    expect(qp.sql).toContain(col(clienteProcessos.escritorioId));
    expect(qp.params).toEqual(expect.arrayContaining([7, 1]));

    const qa = whereDoSelect("asaas_cobrancas");
    expect(qa.sql).toContain(col(asaasCobrancas.escritorioId));
    expect(qa.params).toEqual(expect.arrayContaining([7, 1]));
  });
});
