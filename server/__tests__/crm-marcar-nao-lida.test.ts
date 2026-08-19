/**
 * Testes — marcação manual de "não lida" no Atendimento.
 *
 * O par de procedures precisa se desfazer mutuamente: marcarConversaNaoLida
 * grava o carimbo manual (bolinha sem número na lista) e marcarConversaLida
 * — disparada quando o atendente abre a conversa — tem que limpar esse
 * carimbo junto com o de leitura, senão a conversa aberta continuaria
 * "não lida" pra sempre. Ambas escopadas ao escritório do operador.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const captured = {
  updates: [] as { table: string; set: any }[],
};

function tableName(t: any): string {
  return (t?.[Symbol.for("drizzle:Name")] as string) || "";
}

function makeDb() {
  function builder(): any {
    const b: any = {
      from: () => b,
      innerJoin: () => b,
      leftJoin: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => Promise.resolve([]),
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

vi.mock("../escritorio/db-crm", () => ({
  criarContato: vi.fn(),
  criarOuReutilizarContato: vi.fn(),
  listarContatos: vi.fn(),
  atualizarContato: vi.fn(),
  unificarContatos: vi.fn(),
  buscarContatoPorTelefone: vi.fn(),
  criarConversa: vi.fn(),
  listarConversas: vi.fn(),
  contarConversasPorStatus: vi.fn(),
  contarAbertasPorAtendente: vi.fn(),
  atualizarConversa: vi.fn(),
  excluirConversa: vi.fn(),
  definirArquivada: vi.fn(),
  resumoArquivadas: vi.fn(),
  arquivarConversasDeCanaisDesativados: vi.fn(),
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

beforeEach(() => {
  captured.updates.length = 0;
});

describe("crm.marcarConversaNaoLida", () => {
  it("grava o carimbo manual na conversa", async () => {
    const r = await caller().crm.marcarConversaNaoLida({ conversaId: 7 });
    expect(r).toEqual({ success: true });

    const up = captured.updates.find((u) => u.table === "conversas");
    expect(up).toBeDefined();
    expect(up!.set.marcadaNaoLidaEm).toBeInstanceOf(Date);
    // Não pode encostar no carimbo de leitura: o contador numérico
    // (mensagens de entrada × lidaPeloAtendenteEm) continua como está.
    expect("lidaPeloAtendenteEm" in up!.set).toBe(false);
  });
});

describe("crm.marcarConversaLida", () => {
  it("limpa a marcação manual junto com o carimbo de leitura", async () => {
    const r = await caller().crm.marcarConversaLida({ conversaId: 7 });
    expect(r).toEqual({ success: true });

    const up = captured.updates.find((u) => u.table === "conversas");
    expect(up).toBeDefined();
    expect(up!.set.lidaPeloAtendenteEm).toBeInstanceOf(Date);
    expect(up!.set.marcadaNaoLidaEm).toBeNull();
  });
});
