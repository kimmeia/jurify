/**
 * "Mesclar com outro cliente" da ficha (mockup `mockup-mesclar-cpf-diferente`,
 * "pode fazer" do dono em 10/09/2026), duas coisas no mesmo diálogo:
 *
 *  1. duas fichas com CPF preenchido e diferente podem ser duas pessoas com o
 *     mesmo telefone. Mesclar descarta o CPF da absorvida em silêncio, então a
 *     procedure recusa e a tela mostra os dois antes de deixar seguir;
 *  2. o texto dizia "operação definitiva" e "não há como desfazer". Desde 09/09
 *     o Mesclar manual passa por `unificarComRegistro` e fica desfazível por
 *     7 dias — a promessa era falsa nos dois passos.
 *
 * O aviso com o botão Desfazer só existia na conversa do Atendimento; quem
 * mescla pela ficha e não fala com o cliente por WhatsApp não achava a saída
 * que o texto novo promete, por isso ele passou a aparecer na ficha também.
 *
 * `crm.unificarContatos` também atende o "Vincular a cliente" do Atendimento?
 * NÃO: aquele caminho chama `unificarContatos` do db-crm direto, e continua
 * sem a trava de propósito (não foi pedido). Há teste abaixo travando isso.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

// ─── Banco falso ─────────────────────────────────────────────────────────────

const NOME = Symbol.for("drizzle:Name");
function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }

const filas: Record<string, any[][]> = {};
const padroes: Record<string, any[]> = {};
function proximaFila(table: string): any[] {
  const fila = filas[table];
  return fila && fila.length > 0 ? fila.shift()! : (padroes[table] ?? []);
}
function makeDb() {
  function builder(): any {
    let table = "";
    const b: any = {
      from: (t: any) => { table = nomeTabela(t); return b; },
      innerJoin: () => b, leftJoin: () => b,
      where: () => b, orderBy: () => b, groupBy: () => b, offset: () => b, limit: () => b,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(proximaFila(table)).then(res, rej),
    };
    return b;
  }
  return {
    select: () => builder(),
    selectDistinct: () => builder(),
    insert: () => ({ values: () => Promise.resolve([{ insertId: 901 }]) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }) }),
    delete: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }),
    execute: () => Promise.resolve([[]]),
  };
}
const dbInstance = makeDb();

vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return { ...real, getDb: vi.fn(async () => dbInstance) };
});

const PERM = {
  allowed: true, verTodos: true, verProprios: false, criar: true, editar: true, excluir: true,
  colaboradorId: 10, escritorioId: 1, cargo: "dono",
};
const checkPermissionMock = vi.fn(async () => ({ ...PERM }));
vi.mock("../escritorio/check-permission", () => ({
  checkPermission: (...a: unknown[]) => (checkPermissionMock as any)(...a),
  checkPermissionAdminOuMatriz: (...a: unknown[]) => (checkPermissionMock as any)(...a),
}));
vi.mock("../escritorio/db-escritorio", async (importOriginal) => {
  const real = await importOriginal<typeof import("../escritorio/db-escritorio")>();
  return {
    ...real,
    getEscritorioPorUsuario: vi.fn(async () => ({
      escritorio: { id: 1, nome: "Escritório Exemplo Advocacia", fusoHorario: "America/Sao_Paulo" },
    })),
  };
});
const unificarComRegistroMock = vi.fn(async () => ({ id: 55, tabelasAtualizadas: ["conversas"] }));
vi.mock("../escritorio/reconhecer-cadastro", async (importOriginal) => {
  const real = await importOriginal<typeof import("../escritorio/reconhecer-cadastro")>();
  return { ...real, unificarComRegistro: (...a: unknown[]) => unificarComRegistroMock(...(a as [])) };
});

const { appRouter } = await import("../routers");
const { cpfsConflitam, MENSAGEM_CPFS_DIFERENTES } = await import("../../shared/conferencia-cadastros");

function ctx(): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google", role: "user",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: { host: "app.juridflow.com.br" }, ip: "127.0.0.1" } as any,
    res: { clearCookie: () => {}, cookie: () => {} } as any,
  };
}
const caller = () => appRouter.createCaller(ctx());

const CPF_RENATA = "90744231820";
const CPF_ANDERSON = "31588047209";

beforeEach(() => {
  for (const k of Object.keys(filas)) delete filas[k];
  for (const k of Object.keys(padroes)) delete padroes[k];
  padroes["colaboradores"] = [{ id: 1, nome: "Ana P." }];
  unificarComRegistroMock.mockClear();
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue({ ...PERM });
});

// ─── A regra, pura ───────────────────────────────────────────────────────────

describe("cpfsConflitam: só é conflito com os DOIS lados preenchidos e diferentes", () => {
  it("dois CPFs diferentes conflitam", () => {
    expect(cpfsConflitam(CPF_RENATA, CPF_ANDERSON)).toBe(true);
  });

  it("um lado vazio não é conflito — o valor entra sem tirar nada de ninguém", () => {
    expect(cpfsConflitam(null, CPF_ANDERSON)).toBe(false);
    expect(cpfsConflitam(CPF_RENATA, "")).toBe(false);
    expect(cpfsConflitam(undefined, undefined)).toBe(false);
  });

  it("o mesmo CPF escrito de dois jeitos NÃO conflita (a máscara não conta, dos dois lados)", () => {
    expect(cpfsConflitam("907.442.318-20", CPF_RENATA)).toBe(false);
    expect(cpfsConflitam(CPF_RENATA, "907.442.318-20")).toBe(false);
  });

  it("texto sem dígito nenhum é o mesmo que vazio", () => {
    expect(cpfsConflitam("não informado", CPF_ANDERSON)).toBe(false);
  });
});

// ─── A trava no servidor ─────────────────────────────────────────────────────

describe("crm.unificarContatos: a trava não fica só na tela", () => {
  it("sem confirmação, CPFs diferentes recusam e NADA é mesclado", async () => {
    filas["contatos"] = [[
      { id: 40, cpfCnpj: CPF_ANDERSON },
      { id: 41, cpfCnpj: CPF_RENATA },
    ]];
    await expect(caller().crm.unificarContatos({ principalId: 40, duplicadoId: 41 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: MENSAGEM_CPFS_DIFERENTES });
    expect(unificarComRegistroMock).not.toHaveBeenCalled();
  });

  it("com a confirmação da tela, mescla e nem consulta os CPFs", async () => {
    // O par É conflitante: se a procedure ainda consultasse, ela travaria.
    filas["contatos"] = [[
      { id: 40, cpfCnpj: CPF_ANDERSON },
      { id: 41, cpfCnpj: CPF_RENATA },
    ]];
    const r = await caller().crm.unificarContatos({ principalId: 40, duplicadoId: 41, confirmarCpfDiferente: true });
    expect(r.unificacaoId).toBe(55);
    expect(unificarComRegistroMock).toHaveBeenCalledWith(dbInstance, expect.objectContaining({
      escritorioId: 1, principalId: 40, duplicadoId: 41, origem: "manual",
    }));
  });

  it("um CPF só (o caso comum: ficha do WhatsApp sem CPF) passa sem perguntar", async () => {
    filas["contatos"] = [[
      { id: 40, cpfCnpj: CPF_ANDERSON },
      { id: 41, cpfCnpj: null },
    ]];
    await caller().crm.unificarContatos({ principalId: 40, duplicadoId: 41 });
    expect(unificarComRegistroMock).toHaveBeenCalled();
  });

  it("o mesmo CPF com máscara diferente passa sem perguntar", async () => {
    filas["contatos"] = [[
      { id: 40, cpfCnpj: "907.442.318-20" },
      { id: 41, cpfCnpj: CPF_RENATA },
    ]];
    await caller().crm.unificarContatos({ principalId: 40, duplicadoId: 41 });
    expect(unificarComRegistroMock).toHaveBeenCalled();
  });

  it("a consulta dos CPFs é escopada pelo escritório", () => {
    const router = ler("server/escritorio/router-crm.ts");
    const proc = router.slice(router.indexOf("unificarContatos: protectedProcedure"), router.indexOf("unificacaoRecente: protectedProcedure"));
    expect(proc).toContain("eq(contatos.escritorioId, perm.escritorioId)");
    expect(proc).toContain("inArray(contatos.id, [input.principalId, input.duplicadoId])");
    // A ficha de outro escritório não volta na consulta: sem os dois CPFs não
    // há conflito, e a unificação já falha adiante por não achar o contato.
    expect(proc).toContain("cpfsConflitam");
  });
});

describe("a mesma regra vale nos dois lugares que mesclam à mão", () => {
  it("mesclarDuplicados (Conferência) usa o helper compartilhado, não uma cópia da conta", () => {
    const rc = ler("server/escritorio/router-clientes.ts");
    expect(rc).toContain("cpfsConflitam(cpfDe(par.principalId), cpfDe(par.duplicadoId))");
    expect(rc).not.toContain("cpfs.size > 1");
  });

  it('"Vincular a cliente" continua sem a trava, de propósito', () => {
    const router = ler("server/escritorio/router-crm.ts");
    const vincular = router.slice(router.indexOf("await unificarContatos(esc.escritorio.id"));
    expect(vincular.slice(0, 200)).not.toContain("cpfsConflitam");
  });
});

// ─── A tela ──────────────────────────────────────────────────────────────────

describe("o diálogo mostra o CPF que seria descartado", () => {
  const tela = ler("client/src/pages/Clientes.tsx");
  const dlg = tela.slice(tela.indexOf("function MesclarClienteDialog"));

  it("cada candidato com CPF diferente é marcado na lista", () => {
    expect(dlg).toContain("conflitaCom(c.cpfCnpj)");
    expect(dlg).toContain("CPF diferente");
  });

  it("o aviso nomeia quem fica e quem é descartado, e só aparece no conflito", () => {
    const inicio = dlg.indexOf('data-testid="aviso-cpf-diferente"');
    expect(inicio).toBeGreaterThan(0);
    const aviso = dlg.slice(inicio, inicio + 1200);
    expect(aviso).toContain("será descartado");
    expect(aviso).toContain("Não é duplicado");
    // Preso ao conflito: sem isso o bloco vira enfeite que nunca abre (ou abre sempre).
    const antes = dlg.slice(0, inicio);
    expect(antes.slice(antes.lastIndexOf("{"))).toContain("conflito &&");
  });

  it("a confirmação final também nomeia o CPF descartado", () => {
    const passo2 = dlg.slice(dlg.indexOf("Confirmação final"));
    expect(passo2).toContain("{clienteAtual.cpfCnpj}");
    expect(passo2).toContain("será descartado");
    expect(passo2.slice(0, passo2.indexOf("{clienteAtual.cpfCnpj}"))).toContain("conflito &&");
  });

  it("o botão que avança muda de nome quando há conflito", () => {
    expect(dlg).toContain('{conflito ? "Mesclar mesmo assim" : "Continuar"}');
  });

  it("a confirmação manda o aval pro servidor — sem isso a procedure recusa", () => {
    expect(dlg).toContain("onConfirmar(selecionado.id, conflito || undefined)");
    expect(tela).toContain("mesclarMut.mutate({ principalId, duplicadoId: id, confirmarCpfDiferente })");
  });

  it("o conflito sai da MESMA função do servidor", () => {
    expect(tela).toContain("cpfsConflitam");
    expect(dlg).toContain("cpfsConflitam(clienteAtual.cpfCnpj, cpf)");
  });
});

describe("a tela parou de prometer que é definitivo", () => {
  const tela = ler("client/src/pages/Clientes.tsx");
  const dlg = tela.slice(tela.indexOf("function MesclarClienteDialog"));

  it("os dois textos falsos sumiram", () => {
    expect(dlg).not.toContain("operação definitiva");
    expect(dlg).not.toContain("Não há como desfazer");
  });

  it("os dois passos dizem o prazo real", () => {
    expect(dlg).toContain("dá para desfazer por 7 dias");
    expect(dlg).toContain("Dá para desfazer por 7 dias");
  });

  it("o comentário do componente não documenta mais a premissa velha", () => {
    const doc = tela.slice(tela.indexOf('Dialog "Mesclar com outro cliente"'), tela.indexOf("function MesclarClienteDialog"));
    expect(doc).not.toContain("rollback no futuro");
    expect(doc).toMatch(/desfazível[\s*]+por 7 dias/);
  });
});

describe("o Desfazer aparece onde a mesclagem foi feita", () => {
  const tela = ler("client/src/pages/Clientes.tsx");

  it("a ficha lê a unificação recente e sabe desfazer", () => {
    expect(tela).toContain("crm.unificacaoRecente.useQuery");
    expect(tela).toContain("crm.desfazerUnificacao.useMutation");
    const inicio = tela.indexOf('data-testid="aviso-unificacao-ficha"');
    expect(inicio).toBeGreaterThan(0);
    // Preso ao dado: aviso que não depende da unificação não avisa nada.
    const antes = tela.slice(0, inicio);
    expect(antes.slice(antes.lastIndexOf("{"))).toContain("unificacao &&");
  });

  it("os hooks ficam ANTES da saída antecipada da ficha (React #310)", () => {
    const query = tela.indexOf("crm.unificacaoRecente.useQuery");
    const saida = tela.indexOf("if (detalheCarregando || registroDeOutroId)");
    expect(query).toBeGreaterThan(0);
    expect(saida).toBeGreaterThan(0);
    expect(query).toBeLessThan(saida);
  });

  it("desfazer recarrega a ficha, senão a tela fica com o que já não existe", () => {
    const bloco = tela.slice(tela.indexOf("crm.desfazerUnificacao.useMutation"), tela.indexOf("crm.desfazerUnificacao.useMutation") + 500);
    expect(bloco).toContain("refetchUnificacao()");
    expect(bloco).toContain("refetch()");
    expect(bloco).toContain("onError");
  });

  it("o aviso do Atendimento continua de pé — não foi movido, foi somado", () => {
    const atendimento = ler("client/src/pages/Atendimento.tsx");
    expect(atendimento).toContain('data-testid="aviso-unificacao"');
    expect(atendimento).toContain("crm.unificacaoRecente.useQuery");
  });
});
