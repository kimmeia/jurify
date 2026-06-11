/**
 * Testes — crm.vincularConversaAoContato (botão "Vincular a cliente" do
 * Atendimento).
 *
 * Caso esposa do Rafael: número desconhecido chama → handler cria contato
 * fantasma (lead só com nome/telefone) + conversa. Ao vincular ao cliente
 * real, o fantasma deve ser ABSORVIDO via unificarContatos (conversa migra,
 * telefone vira secundário do cliente, fantasma some). Cadastro de origem
 * "rico" (CPF/email/processo/já-cliente) NÃO é absorvido — só a conversa
 * muda de dono. E a conversa precisa pertencer ao escritório do operador.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const captured = {
  updates: [] as { table: string; set: any }[],
};

// Filas de resultado por tabela: cada select.limit() consome 1 entrada.
const filas: Record<string, any[][]> = {};

function tableName(t: any): string {
  return (t?.[Symbol.for("drizzle:Name")] as string) || "";
}

function makeDb() {
  function builder(): any {
    let table = "";
    const b: any = {
      from: (t: any) => { table = tableName(t); return b; },
      innerJoin: () => b,
      leftJoin: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => {
        const fila = filas[table];
        const rows = fila && fila.length > 0 ? fila.shift()! : [];
        return Promise.resolve(rows);
      },
      then: (resolve: (v: unknown) => unknown) => resolve([]),
    };
    return b;
  }
  return {
    select: () => builder(),
    insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: () => {
          captured.updates.push({ table: tableName(t), set: s });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
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

const unificarContatosMock = vi.fn(async () => ({ tabelasAtualizadas: [] as string[] }));

vi.mock("../escritorio/db-crm", () => ({
  criarContato: vi.fn(),
  criarOuReutilizarContato: vi.fn(),
  listarContatos: vi.fn(),
  atualizarContato: vi.fn(),
  unificarContatos: (...args: unknown[]) => unificarContatosMock(...(args as [])),
  buscarContatoPorTelefone: vi.fn(),
  criarConversa: vi.fn(),
  listarConversas: vi.fn(),
  contarConversasPorStatus: vi.fn(),
  atualizarConversa: vi.fn(),
  excluirConversa: vi.fn(),
  enviarMensagem: vi.fn(),
  listarMensagens: vi.fn(),
  criarLead: vi.fn(),
  listarLeads: vi.fn(),
  atualizarLead: vi.fn(),
  excluirLead: vi.fn(),
  obterMetricasDashboard: vi.fn(),
  distribuirLead: vi.fn(),
  obterMetricasDetalhadas: vi.fn(),
}));

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

const fantasma = {
  id: 99, escritorioId: 1, nome: "Esposa (WhatsApp)", telefone: "5585991112222",
  cpfCnpj: null, email: null, estagio: "lead",
};

const cadastroRico = {
  id: 99, escritorioId: 1, nome: "Maria Rocha", telefone: "5585991112222",
  cpfCnpj: "55566677788", email: "maria@exemplo.com", estagio: "lead",
};

beforeEach(() => {
  captured.updates = [];
  unificarContatosMock.mockClear();
  for (const k of Object.keys(filas)) delete filas[k];
});

describe("crm.vincularConversaAoContato", () => {
  it("absorve contato fantasma via unificarContatos (telefone vira secundário do cliente)", async () => {
    filas["conversas"] = [[{ id: 5, contatoId: 99 }]];
    filas["contatos"] = [
      [{ id: 7 }],      // destino (Rafael)
      [fantasma],       // origem
    ];
    filas["cliente_processos"] = [[]]; // fantasma sem processo

    const r = await caller().crm.vincularConversaAoContato({ conversaId: 5, contatoId: 7 });

    expect(r).toEqual({ success: true, unificado: true });
    expect(unificarContatosMock).toHaveBeenCalledWith(1, 7, 99);
    // unificarContatos já migra a conversa — não pode haver update direto
    expect(captured.updates.filter((u) => u.table === "conversas")).toHaveLength(0);
  });

  it("origem com CPF/email NÃO é absorvida — só a conversa muda de dono", async () => {
    filas["conversas"] = [[{ id: 5, contatoId: 99 }]];
    filas["contatos"] = [
      [{ id: 7 }],
      [cadastroRico],
    ];

    const r = await caller().crm.vincularConversaAoContato({ conversaId: 5, contatoId: 7 });

    expect(r).toEqual({ success: true, unificado: false });
    expect(unificarContatosMock).not.toHaveBeenCalled();
    const upd = captured.updates.filter((u) => u.table === "conversas");
    expect(upd).toHaveLength(1);
    expect(upd[0].set).toEqual({ contatoId: 7 });
  });

  it("lead sem CPF/email mas COM processo vinculado não é absorvido", async () => {
    filas["conversas"] = [[{ id: 5, contatoId: 99 }]];
    filas["contatos"] = [
      [{ id: 7 }],
      [fantasma],
    ];
    filas["cliente_processos"] = [[{ id: 333 }]];

    const r = await caller().crm.vincularConversaAoContato({ conversaId: 5, contatoId: 7 });

    expect(r).toEqual({ success: true, unificado: false });
    expect(unificarContatosMock).not.toHaveBeenCalled();
    expect(captured.updates.filter((u) => u.table === "conversas")).toHaveLength(1);
  });

  it("conversa de outro escritório (lookup vazio) é rejeitada", async () => {
    filas["conversas"] = [[]];

    await expect(
      caller().crm.vincularConversaAoContato({ conversaId: 5, contatoId: 7 }),
    ).rejects.toThrow(/Conversa não encontrada/);
    expect(unificarContatosMock).not.toHaveBeenCalled();
    expect(captured.updates).toHaveLength(0);
  });

  it("contato destino inexistente no escritório é rejeitado", async () => {
    filas["conversas"] = [[{ id: 5, contatoId: 99 }]];
    filas["contatos"] = [[]];

    await expect(
      caller().crm.vincularConversaAoContato({ conversaId: 5, contatoId: 7 }),
    ).rejects.toThrow(/Contato não encontrado/);
  });

  it("vincular ao contato que já é dono da conversa é no-op", async () => {
    filas["conversas"] = [[{ id: 5, contatoId: 7 }]];
    filas["contatos"] = [[{ id: 7 }]];

    const r = await caller().crm.vincularConversaAoContato({ conversaId: 5, contatoId: 7 });

    expect(r).toEqual({ success: true, unificado: false });
    expect(unificarContatosMock).not.toHaveBeenCalled();
    expect(captured.updates).toHaveLength(0);
  });
});

describe("crm.marcarConversaLida", () => {
  it("grava lidaPeloAtendenteEm escopado ao escritório", async () => {
    const r = await caller().crm.marcarConversaLida({ conversaId: 5 });
    expect(r).toEqual({ success: true });
    const upd = captured.updates.filter((u) => u.table === "conversas");
    expect(upd).toHaveLength(1);
    expect(upd[0].set.lidaPeloAtendenteEm).toBeInstanceOf(Date);
  });
});
