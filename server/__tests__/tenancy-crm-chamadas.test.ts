/**
 * Amarras de escritório no CRM e nas chamadas: id vindo do client
 * (conversa, contato, canal) só vale se pertencer ao escritório de quem
 * chama. Antes, `enviarMensagem` gravava em conversa ALHEIA e enviava pelo
 * WhatsApp alheio; `criarConversa`/`iniciarConversa` prendiam a conversa a
 * um número de outro escritório; `criarLead` e `iniciarChamada` puxavam
 * nome/telefone de contato alheio pro Pipeline e pra fila de chamadas.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

import { contatos, conversas, canaisIntegrados } from "../../drizzle/schema";

const captured = {
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any }[],
};

const filas: Record<string, any[][]> = {};
// Condições de `where` por tabela, na ordem em que os selects rodaram —
// é o que prova que a consulta filtra por escritório e não só por id.
const wheres: Record<string, any[]> = {};

function tableName(t: any): string {
  return (t?.[Symbol.for("drizzle:Name")] as string) || "";
}

/** Nomes das colunas citadas numa condição drizzle (`and(eq(...), ...)`). */
function colunasDoWhere(cond: any, acc: string[] = [], depth = 0): string[] {
  if (!cond || depth > 8) return acc;
  if (Array.isArray(cond)) { cond.forEach((c) => colunasDoWhere(c, acc, depth + 1)); return acc; }
  if (cond.queryChunks) return colunasDoWhere(cond.queryChunks, acc, depth + 1);
  if (typeof cond === "object" && cond.name && cond.table) acc.push(cond.name);
  return acc;
}

function makeDb() {
  function builder(): any {
    let table = "";
    const b: any = {
      from: (t: any) => { table = tableName(t); return b; },
      innerJoin: () => b,
      leftJoin: () => b,
      where: (cond: any) => { (wheres[table] ||= []).push(cond); return b; },
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
  };
}

const dbInstance = makeDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste", fusoHorario: "America/Sao_Paulo", ownerId: 100 },
    colaborador: { id: 10, cargo: "dono" },
  })),
}));

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => ({
    allowed: true, verTodos: true, verProprios: false, colaboradorId: 10, escritorioId: 1,
  })),
  checkPermissionAdminOuMatriz: vi.fn(async () => ({
    allowed: true, verTodos: true, verProprios: false, colaboradorId: 10, escritorioId: 1,
  })),
}));

const enviarMensagemDb = vi.fn(async () => 123);
const criarConversaDb = vi.fn(async () => 77);
const criarLeadDb = vi.fn(async () => 55);
const criarOuReutilizarContatoDb = vi.fn(async () => ({ id: 9, criado: false }));

vi.mock("../escritorio/db-crm", () => ({
  criarContato: vi.fn(),
  criarOuReutilizarContato: (...a: unknown[]) => criarOuReutilizarContatoDb(...(a as [])),
  listarContatos: vi.fn(),
  atualizarContato: vi.fn(),
  unificarContatos: vi.fn(),
  buscarContatoPorTelefone: vi.fn(),
  criarConversa: (...a: unknown[]) => criarConversaDb(...(a as [])),
  listarConversas: vi.fn(async () => []),
  contarConversasPorStatus: vi.fn(),
  atualizarConversa: vi.fn(async () => undefined),
  excluirConversa: vi.fn(),
  enviarMensagem: (...a: unknown[]) => enviarMensagemDb(...(a as [])),
  listarMensagens: vi.fn(),
  criarLead: (...a: unknown[]) => criarLeadDb(...(a as [])),
  listarLeads: vi.fn(),
  atualizarLead: vi.fn(),
  excluirLead: vi.fn(),
  obterMetricasDashboard: vi.fn(),
  distribuirLead: vi.fn(async () => null),
  obterMetricasDetalhadas: vi.fn(),
}));

vi.mock("../atendimento/episodios", () => ({
  registrarMensagemNoEpisodio: vi.fn(async () => undefined),
}));

// Calling API: canal configurado, sem CoEx, conta não restrita, Meta responde.
const iniciarChamadaMeta = vi.fn(async () => "call_1");
vi.mock("../escritorio/db-canais", () => ({
  obterConfigCanal: vi.fn(async () => ({ accessToken: "tok", phoneNumberId: "pn", wabaId: "w" })),
}));
vi.mock("../integracoes/coex", () => ({ canalEhCoex: () => false }));
vi.mock("../integracoes/whatsapp-cloud", () => ({
  WhatsAppCloudClient: class {
    iniciarChamada = (...a: unknown[]) => iniciarChamadaMeta(...(a as []));
  },
}));
vi.mock("../integracoes/whatsapp-envio-guard", () => ({
  canalEstaRestrito: vi.fn(async () => ({ restrito: false })),
  podeEnviar: vi.fn(async () => ({ ok: true })),
  podeDispararTemplate: vi.fn(async () => ({ ok: true })),
  registrarSucessoEnvio: vi.fn(),
  registrarSucessoTemplate: vi.fn(),
  registrarFalhaEnvio: vi.fn(),
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

const caller = () => appRouter.createCaller(fakeCtx());

beforeEach(() => {
  captured.inserts = [];
  captured.updates = [];
  enviarMensagemDb.mockClear();
  criarConversaDb.mockClear();
  criarLeadDb.mockClear();
  criarOuReutilizarContatoDb.mockClear();
  iniciarChamadaMeta.mockClear();
  for (const k of Object.keys(filas)) delete filas[k];
  for (const k of Object.keys(wheres)) delete wheres[k];
});

const filtraPorEscritorio = (table: string, coluna: string, i = 0) =>
  expect(colunasDoWhere(wheres[table]?.[i]), `where de ${table}[${i}]`).toContain(coluna);

describe("crm.enviarMensagem", () => {
  it("conversa de outro escritório: recusa ANTES de gravar qualquer coisa", async () => {
    filas["conversas"] = [[]];
    await expect(
      caller().crm.enviarMensagem({ conversaId: 5, conteudo: "oi" }),
    ).rejects.toThrow(/Conversa não encontrada/);
    expect(enviarMensagemDb).not.toHaveBeenCalled();
    expect(captured.updates).toHaveLength(0);
  });

  it("conversa do próprio escritório: grava normalmente", async () => {
    filas["conversas"] = [[{ id: 5 }], [{ contatoId: 9, atendenteId: 10 }], []];
    const r = await caller().crm.enviarMensagem({ conversaId: 5, conteudo: "oi" });
    expect(r).toEqual({ id: 123 });
    expect(enviarMensagemDb).toHaveBeenCalledTimes(1);
    // a trava, a leitura do episódio e a busca do canal: todas por escritório
    filtraPorEscritorio("conversas", conversas.escritorioId.name, 0);
    filtraPorEscritorio("conversas", conversas.escritorioId.name, 1);
    filtraPorEscritorio("conversas", conversas.escritorioId.name, 2);
  });
});

describe("crm.criarConversa", () => {
  it("contato de outro escritório: recusa", async () => {
    filas["contatos"] = [[]];
    await expect(caller().crm.criarConversa({ contatoId: 9, canalId: 3 })).rejects.toThrow(/Contato não encontrado/);
    expect(criarConversaDb).not.toHaveBeenCalled();
  });

  it("canal de outro escritório: recusa", async () => {
    filas["contatos"] = [[{ id: 9 }]];
    filas["canais_integrados"] = [[]];
    await expect(caller().crm.criarConversa({ contatoId: 9, canalId: 3 })).rejects.toThrow(/Canal não encontrado/);
    expect(criarConversaDb).not.toHaveBeenCalled();
  });

  it("contato e canal do escritório: cria", async () => {
    filas["contatos"] = [[{ id: 9 }]];
    filas["canais_integrados"] = [[{ id: 3 }]];
    const r = await caller().crm.criarConversa({ contatoId: 9, canalId: 3 });
    expect(r).toEqual({ id: 77, atendenteId: 10 });
    expect(criarConversaDb).toHaveBeenCalledWith(expect.objectContaining({ escritorioId: 1, contatoId: 9, canalId: 3 }));
    filtraPorEscritorio("contatos", contatos.escritorioId.name);
    filtraPorEscritorio("canais_integrados", canaisIntegrados.escritorioId.name);
  });
});

describe("crm.iniciarConversa", () => {
  it("canal de outro escritório: recusa antes de criar contato", async () => {
    filas["canais_integrados"] = [[]];
    await expect(
      caller().crm.iniciarConversa({ telefone: "85997965706", mensagem: "oi", canalId: 3 }),
    ).rejects.toThrow(/Canal não encontrado/);
    expect(criarOuReutilizarContatoDb).not.toHaveBeenCalled();
    expect(criarConversaDb).not.toHaveBeenCalled();
  });

  it("canal do escritório: segue o fluxo", async () => {
    filas["canais_integrados"] = [[{ id: 3 }]];
    const r = await caller().crm.iniciarConversa({ telefone: "85997965706", mensagem: "oi", canalId: 3 });
    expect(r.conversaId).toBe(77);
    expect(criarOuReutilizarContatoDb).toHaveBeenCalledTimes(1);
    filtraPorEscritorio("canais_integrados", canaisIntegrados.escritorioId.name);
  });
});

describe("crm.criarLead", () => {
  it("contato de outro escritório: recusa", async () => {
    filas["contatos"] = [[]];
    await expect(caller().crm.criarLead({ contatoId: 9 })).rejects.toThrow(/Contato não encontrado/);
    expect(criarLeadDb).not.toHaveBeenCalled();
  });

  it("conversa de outro escritório: recusa", async () => {
    filas["contatos"] = [[{ id: 9 }]];
    filas["conversas"] = [[]];
    await expect(caller().crm.criarLead({ contatoId: 9, conversaId: 5 })).rejects.toThrow(/Conversa não encontrada/);
    expect(criarLeadDb).not.toHaveBeenCalled();
    filtraPorEscritorio("conversas", conversas.escritorioId.name);
  });

  it("contato do escritório: cria com quem criou como responsável", async () => {
    filas["contatos"] = [[{ id: 9 }]];
    const r = await caller().crm.criarLead({ contatoId: 9 });
    expect(r).toEqual({ id: 55, responsavelId: 10 });
    expect(criarLeadDb).toHaveBeenCalledWith(expect.objectContaining({ escritorioId: 1, contatoId: 9 }));
    filtraPorEscritorio("contatos", contatos.escritorioId.name);
  });
});

describe("whatsappCalling.iniciarChamada", () => {
  const base = { canalId: 3, telefone: "5585997965706", sdpOffer: "v=0" };

  it("contatoId de outro escritório: recusa sem ligar", async () => {
    filas["contatos"] = [[]];
    await expect(caller().whatsappCalling.iniciarChamada({ ...base, contatoId: 9 })).rejects.toThrow(/Contato não encontrado/);
    expect(iniciarChamadaMeta).not.toHaveBeenCalled();
    expect(captured.inserts).toHaveLength(0);
  });

  it("conversaId de outro escritório: recusa sem ligar", async () => {
    filas["conversas"] = [[]];
    await expect(caller().whatsappCalling.iniciarChamada({ ...base, conversaId: 5 })).rejects.toThrow(/Conversa não encontrada/);
    expect(iniciarChamadaMeta).not.toHaveBeenCalled();
  });

  it("contato e conversa do escritório: liga e registra a chamada", async () => {
    filas["contatos"] = [[{ id: 9 }]];
    filas["conversas"] = [[{ id: 5 }]];
    const r = await caller().whatsappCalling.iniciarChamada({ ...base, contatoId: 9, conversaId: 5 });
    expect(r).toEqual({ status: "chamando", callId: "call_1" });
    expect(captured.inserts.find((i) => i.table === "chamadas")?.values).toEqual(
      expect.objectContaining({ escritorioId: 1, contatoId: 9, conversaId: 5 }),
    );
    filtraPorEscritorio("contatos", contatos.escritorioId.name);
    filtraPorEscritorio("conversas", conversas.escritorioId.name);
  });

  it("sem contatoId nem conversaId: nada a conferir, liga", async () => {
    const r = await caller().whatsappCalling.iniciarChamada(base);
    expect(r.status).toBe("chamando");
  });
});
