/**
 * Router por caller: a aba Consultar fora do TJCE.
 *
 *  - `consultarCNJ` de tribunal de consulta pública (TRT2, TRT15, TRF5) não
 *    pede credencial nem sessão, e COBRA a consulta como sempre cobrou;
 *  - `consultarDocumento` e `criarMonitoramentoNovasAcoes` levam o tribunal
 *    do pedido (sede por padrão) — a credencial é escolhida pra ELE e a
 *    sessão é a dele.
 *
 * Padrão de mocks de `processos-consultar-documento.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const iniciarConsultaMotorProprio = vi.fn(() => ({ requestId: "motor:x:fake", status: "running" as const }));
const iniciarConsultaDocumentoMotorProprio = vi.fn(() => ({ requestId: "motor:x:doc:fake", status: "running" as const }));
vi.mock("../processos/motor-proprio-runner", () => ({
  ehRequestMotorProprio: vi.fn(() => true),
  iniciarConsultaMotorProprio,
  iniciarConsultaDocumentoMotorProprio,
  obterStatusMotorProprio: vi.fn(),
  obterResultadoMotorProprio: vi.fn(),
}));

const recuperarSessao = vi.fn();
vi.mock("../escritorio/cofre-helpers", () => ({ recuperarSessao }));

const consumirUso = vi.fn();
vi.mock("../billing/limites-uso", () => ({
  consumirUso,
  verificarUso: vi.fn(async () => ({ permitido: true, usado: 0, limite: null, mensagem: null })),
  registrarUso: vi.fn(),
}));
vi.mock("../billing/escritorio-creditos", () => ({
  consumirCreditosEscritorio: vi.fn(),
  getSaldoEscritorio: vi.fn(async () => ({ saldo: 100, totalConsumido: 0, totalComprado: 100, cotaMensal: 0, ultimoReset: null })),
}));
vi.mock("../processos/limites-monitoramento", () => ({
  verificarLimiteMonitoramentos: vi.fn(async () => ({ permitido: true, mensagem: null })),
}));

const dbState = {
  credenciais: [] as Array<{ id: number; escritorioId: number; sistema: string; status: string; apelido: string }>,
  inseridos: [] as Array<Record<string, unknown>>,
};

function makeDb() {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: async (n: number) => dbState.credenciais.slice(0, n),
    orderBy: () => builder,
    then: (resolve: (v: unknown) => void) => resolve(dbState.credenciais),
  } as unknown as Record<string, unknown>;
  return {
    select: () => builder,
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        dbState.inseridos.push(v);
        return Promise.resolve([{ insertId: 42 }]);
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
}
vi.mock("../db", () => ({ getDb: vi.fn(async () => makeDb()) }));
vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste" },
    colaborador: { id: 10, cargo: "dono" },
  })),
}));

const { appRouter } = await import("../routers");
const { mensagemTribunalSemMotor } = await import("../../shared/tribunais-pje");

function caller() {
  const ctx = {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google", role: "user",
      asaasCustomerId: null, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as unknown as TrpcContext;
  return appRouter.createCaller(ctx);
}

const CNJ_TRT2 = "0001234-12.2024.5.02.0001";
const CNJ_TRT15 = "0001234-12.2024.5.15.0001";
const CNJ_TRF5 = "0001234-12.2024.4.05.0001";
const CNJ_TJMG = "0001234-12.2024.8.13.0001";
const CNJ_TJSP = "0001234-12.2024.8.26.0001";

beforeEach(() => {
  dbState.credenciais = [];
  dbState.inseridos = [];
  vi.clearAllMocks();
  consumirUso.mockResolvedValue(undefined);
});

describe("consultarCNJ — tribunal de consulta pública", () => {
  it.each([CNJ_TRT2, CNJ_TRT15, CNJ_TRF5])("%s: sem credencial no cofre, sem sessão, cobrando a consulta", async (cnj) => {
    const r = await caller().processos.consultarCNJ({ cnj });
    expect(r.status).toBe("running");
    expect(consumirUso).toHaveBeenCalledWith(1, "consulta_processo");
    expect(iniciarConsultaMotorProprio).toHaveBeenCalledWith(cnj, null);
    expect(recuperarSessao).not.toHaveBeenCalled();
  });

  it("a cobrança acontece ANTES de iniciar (mesma ordem do caminho com credencial)", async () => {
    const ordem: string[] = [];
    consumirUso.mockImplementation(async () => { ordem.push("cobrou"); });
    iniciarConsultaMotorProprio.mockImplementationOnce(() => { ordem.push("iniciou"); return { requestId: "motor:trt2:x", status: "running" as const }; });
    await caller().processos.consultarCNJ({ cnj: CNJ_TRT2 });
    expect(ordem).toEqual(["cobrou", "iniciou"]);
  });

  it("tribunal do registro continua exigindo credencial — e não cobra sem ela", async () => {
    await expect(caller().processos.consultarCNJ({ cnj: CNJ_TJMG })).rejects.toThrow(/cadastre sua credencial OAB/i);
    expect(consumirUso).not.toHaveBeenCalled();
    expect(iniciarConsultaMotorProprio).not.toHaveBeenCalled();
  });

  it("fora da cobertura: a mensagem do helper, sem cobrar", async () => {
    await expect(caller().processos.consultarCNJ({ cnj: CNJ_TJSP })).rejects.toThrow(mensagemTribunalSemMotor("TJSP"));
    expect(consumirUso).not.toHaveBeenCalled();
  });
});

describe("consultarDocumento — o tribunal vem do pedido", () => {
  it("codigoTribunal tjmg: credencial do TJMG, sessão do TJMG, runner recebe tjmg", async () => {
    dbState.credenciais = [{ id: 3, escritorioId: 1, sistema: "pje_tjmg", status: "ativa", apelido: "OAB MG" }];
    recuperarSessao.mockResolvedValue("sessao-mg");
    await caller().processos.consultarDocumento({ tipo: "cpf", valor: "12345678901", codigoTribunal: "tjmg" });
    expect(recuperarSessao).toHaveBeenCalledWith(3, "tjmg", { tentarRelogin: true });
    expect(iniciarConsultaDocumentoMotorProprio).toHaveBeenCalledWith("cpf", "12345678901", "sessao-mg", "tjmg", 3);
    expect(consumirUso).toHaveBeenCalledWith(1, "busca_documento");
  });

  it("a credencial nacional (pje_*) serve pra qualquer tribunal do registro", async () => {
    dbState.credenciais = [{ id: 4, escritorioId: 1, sistema: "pje_*", status: "ativa", apelido: "PDPJ" }];
    recuperarSessao.mockResolvedValue("sessao");
    await caller().processos.consultarDocumento({ tipo: "cpf", valor: "12345678901", codigoTribunal: "tjrj" });
    expect(recuperarSessao).toHaveBeenCalledWith(4, "tjrj", { tentarRelogin: true });
    expect(iniciarConsultaDocumentoMotorProprio).toHaveBeenCalledWith("cpf", "12345678901", "sessao", "tjrj", 4);
  });

  it("credencial só do TJCE não serve pro TJMG: credencial ausente, sem cobrar", async () => {
    dbState.credenciais = [{ id: 1, escritorioId: 1, sistema: "pje_tjce", status: "ativa", apelido: "OAB CE" }];
    await expect(
      caller().processos.consultarDocumento({ tipo: "cpf", valor: "12345678901", codigoTribunal: "tjmg" }),
    ).rejects.toThrow(/cadastre sua credencial OAB/i);
    expect(consumirUso).not.toHaveBeenCalled();
  });

  it("sem codigoTribunal continua na sede (a tela não mudou)", async () => {
    dbState.credenciais = [{ id: 1, escritorioId: 1, sistema: "esaj_tjce", status: "ativa", apelido: "OAB CE" }];
    recuperarSessao.mockResolvedValue("sessao-ce");
    await caller().processos.consultarDocumento({ tipo: "cpf", valor: "12345678901" });
    expect(recuperarSessao).toHaveBeenCalledWith(1, "tjce", { tentarRelogin: true });
    expect(iniciarConsultaDocumentoMotorProprio).toHaveBeenCalledWith("cpf", "12345678901", "sessao-ce", "tjce", 1);
  });

  it("tribunal de consulta pública não tem busca por parte: NOT_IMPLEMENTED antes do cofre", async () => {
    dbState.credenciais = [{ id: 4, escritorioId: 1, sistema: "pje_*", status: "ativa", apelido: "PDPJ" }];
    await expect(
      caller().processos.consultarDocumento({ tipo: "cpf", valor: "12345678901", codigoTribunal: "trt2" }),
    ).rejects.toThrow(/Busca por CPF\/CNPJ ainda não funciona no TRT2/);
    expect(recuperarSessao).not.toHaveBeenCalled();
    expect(consumirUso).not.toHaveBeenCalled();
  });
});

describe("criarMonitoramentoNovasAcoes — o tribunal-base vem do pedido", () => {
  it("codigoTribunal tjmg: credencial do TJMG e o monitor nasce com tribunal tjmg (sede segue vigiada)", async () => {
    dbState.credenciais = [{ id: 3, escritorioId: 1, sistema: "pje_tjmg", status: "ativa", apelido: "OAB MG" }];
    const r = await caller().processos.criarMonitoramentoNovasAcoes({
      tipo: "cpf", valor: "12345678901", codigoTribunal: "tjmg", tribunais: ["tjrj"],
    });
    expect(r.id).toBe(42);
    const mon = dbState.inseridos.find((v) => v.tipoMonitoramento === "novas_acoes")!;
    expect(mon.tribunal).toBe("tjmg");
    expect(mon.credencialId).toBe(3);
    expect(JSON.parse(mon.tribunais as string)).toEqual(["tjce", "tjmg", "tjrj"]);
  });

  it("sem codigoTribunal continua na sede, com a lista de sistemas de sempre (esaj_tjce vale)", async () => {
    dbState.credenciais = [{ id: 1, escritorioId: 1, sistema: "esaj_tjce", status: "ativa", apelido: "OAB CE" }];
    await caller().processos.criarMonitoramentoNovasAcoes({ tipo: "cnpj", valor: "12345678000190" });
    const mon = dbState.inseridos.find((v) => v.tipoMonitoramento === "novas_acoes")!;
    expect(mon.tribunal).toBe("tjce");
    expect(JSON.parse(mon.tribunais as string)).toEqual(["tjce"]);
  });

  it("a mensagem de 'tem, mas de outro tribunal' nomeia o tribunal pedido", async () => {
    dbState.credenciais = [{ id: 9, escritorioId: 1, sistema: "pje_tjsp", status: "ativa", apelido: "OAB SP" }];
    await expect(
      caller().processos.criarMonitoramentoNovasAcoes({ tipo: "cpf", valor: "12345678901", codigoTribunal: "tjmg" }),
    ).rejects.toThrow(/mas nenhuma de TJMG/);
    expect(dbState.inseridos).toHaveLength(0);
  });

  it("tribunal de consulta pública não vigia por CPF: NOT_IMPLEMENTED, nada inserido", async () => {
    dbState.credenciais = [{ id: 4, escritorioId: 1, sistema: "pje_*", status: "ativa", apelido: "PDPJ" }];
    await expect(
      caller().processos.criarMonitoramentoNovasAcoes({ tipo: "cpf", valor: "12345678901", codigoTribunal: "trt15" }),
    ).rejects.toThrow(/novas ações ainda não funciona no TRT15/);
    expect(dbState.inseridos).toHaveLength(0);
  });
});
