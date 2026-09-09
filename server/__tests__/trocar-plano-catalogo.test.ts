/**
 * "Trocar plano" do painel pelo catálogo (mockup `mockup-trocar-plano-catalogo`,
 * "pode fazer" do dono em 09/09/2026 com as três decisões da proposta):
 *
 *  1. a assinatura atual espera o pagamento da nova — quem encerra é o
 *     webhook de pagamento, nunca o painel na hora da troca;
 *  2. planos ocultos aparecem numa dobra "Fora da vitrine" (nada some);
 *  3. cliente em teste que troca mantém o teste, com ≥7 dias pra pagar.
 *
 * O seletor lia a lista fixa `PLANS` (Free, Básico, Intermediário, Completo
 * com preço de antes do lançamento); os planos vendidos hoje nem apareciam.
 * E um plano sob consulta escolhido ali virava assinatura Asaas de R$ 0 — agora
 * ele pede o valor fechado no mesmo diálogo e passa por
 * `ativarAssinaturaNegociada` com o plano de destino.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

// ─── Banco falso: filas por tabela + captura de escritas com o WHERE lido ──

const NOME = Symbol.for("drizzle:Name");
const COLUNAS = Symbol.for("drizzle:Columns");
function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }
function ehColuna(x: any): boolean { return !!x && typeof x === "object" && "columnType" in x && x.table !== undefined; }
function refColuna(col: any): { tabela: string; chave: string } {
  const cols = col.table[COLUNAS] as Record<string, unknown>;
  const chave = Object.keys(cols).find((k) => cols[k] === col) ?? col.name;
  return { tabela: nomeTabela(col.table), chave };
}
type Token = { col: { tabela: string; chave: string } } | { op: string } | { valor: unknown };
function tokens(no: any, out: Token[] = []): Token[] {
  if (no === null || no === undefined) return out;
  if (Array.isArray(no)) { for (const n of no) tokens(n, out); return out; }
  const ctor = no.constructor?.name;
  if (ctor === "SQL") return tokens(no.queryChunks, out);
  if (ctor === "StringChunk") { const s = (no.value as string[]).join("").trim(); if (s && s !== "(" && s !== ")") out.push({ op: s }); return out; }
  if (ctor === "Param") { out.push({ valor: no.value }); return out; }
  if (ehColuna(no)) { out.push({ col: refColuna(no) }); return out; }
  return out;
}
function whereLegivel(where: unknown): string {
  return tokens(where)
    .map((t) => ("col" in t ? t.col.chave : "op" in t ? t.op : String(t.valor)))
    .join(" ");
}

const filas: Record<string, any[][]> = {};
const capturado = {
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any; where: string }[],
};
function proximaFila(table: string): any[] {
  const fila = filas[table];
  return fila && fila.length > 0 ? fila.shift()! : [];
}
function makeDb() {
  function builder(): any {
    let table = "";
    const b: any = {
      from: (t: any) => { table = nomeTabela(t); return b; },
      innerJoin: () => b,
      leftJoin: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => Promise.resolve(proximaFila(table)),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(proximaFila(table)).then(res, rej),
    };
    return b;
  }
  return {
    select: () => builder(),
    insert: (t: any) => ({
      values: (v: any) => { capturado.inserts.push({ table: nomeTabela(t), values: v }); return Promise.resolve([{ insertId: 77 }]); },
    }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: (w: unknown) => { capturado.updates.push({ table: nomeTabela(t), set: s, where: whereLegivel(w) }); return Promise.resolve([{ affectedRows: 1 }]); },
      }),
    }),
  };
}
const dbInstance = makeDb();

const getActiveSubscriptionMock = vi.fn(async (): Promise<any> => null);
vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return {
    ...real,
    getDb: vi.fn(async () => dbInstance),
    getActiveSubscription: (...a: unknown[]) => getActiveSubscriptionMock(...(a as [])),
    getUserSubscriptions: vi.fn(async () => []),
    getActiveSubscriptionComHeranca: vi.fn(async () => null),
  };
});

const criarAssinatura = vi.fn(async () => ({ id: "sub_new" }));
const cancelarAssinatura = vi.fn(async () => undefined);
const criarCliente = vi.fn(async () => ({ id: "cus_novo" }));
const listarCobrancas = vi.fn(async () => ({ data: [] as any[] }));
vi.mock("../billing/asaas-billing-client", () => ({
  getAdminAsaasClient: vi.fn(async () => ({ criarAssinatura, listarCobrancas, cancelarAssinatura, criarCliente })),
  isAsaasBillingConfigured: () => true,
  getAsaasBillingWebhookSecret: vi.fn(async () => "segredo"),
}));

/** Catálogo depois da 0217: três planos com preço, o Sob medida consultivo e dois ocultos. */
const PLANOS: Record<string, any> = {
  atende: { slug: "atende", nome: "Atende", precoMensalCentavos: 14700, precoAnualCentavos: 147000, precoSobConsulta: false, ctaDemonstracao: false, popular: false, oculto: false, ordem: 1 },
  escritorio: { slug: "escritorio", nome: "Escritório", precoMensalCentavos: 29700, precoAnualCentavos: 297000, precoSobConsulta: false, ctaDemonstracao: false, popular: true, oculto: false, ordem: 2 },
  escala: { slug: "escala", nome: "Escala", precoMensalCentavos: 59700, precoAnualCentavos: 597000, precoSobConsulta: false, ctaDemonstracao: false, popular: false, oculto: false, ordem: 3 },
  completo: { slug: "completo", nome: "Sob medida", precoMensalCentavos: 49700, precoAnualCentavos: 497000, precoSobConsulta: true, ctaDemonstracao: true, popular: false, oculto: false, ordem: 4 },
  "monitoramento-profissional": { slug: "monitoramento-profissional", nome: "Monitoramento Profissional", precoMensalCentavos: 0, precoAnualCentavos: null, precoSobConsulta: true, ctaDemonstracao: false, popular: false, oculto: true, ordem: 2 },
  basico: { slug: "basico", nome: "Básico", precoMensalCentavos: 9700, precoAnualCentavos: 97000, precoSobConsulta: false, ctaDemonstracao: false, popular: false, oculto: true, ordem: 0 },
};
const comuns = { descricao: "", publicoAlvo: null, features: ["x"], modulosLiberados: [], limites: { creditosCalculosMes: 10 }, trialDias: 14 };
const plano = (slug: string) => ({ ...comuns, ...PLANOS[slug] });
let catalogo: any[] = Object.keys(PLANOS).map(plano);

vi.mock("../billing/products-resolver", () => ({
  getPlanByIdResolved: vi.fn(async (id: string) =>
    PLANOS[id]
      ? { id, name: PLANOS[id].nome, priceMonthly: PLANOS[id].precoMensalCentavos, priceYearly: PLANOS[id].precoAnualCentavos ?? PLANOS[id].precoMensalCentavos * 12, currency: "brl" }
      : undefined,
  ),
  getPlansResolved: vi.fn(async () => []),
}));

vi.mock("../billing/planos-repo", async (importOriginal) => {
  const real = await importOriginal<typeof import("../billing/planos-repo")>();
  return {
    ...real,
    getAllPlanos: vi.fn(async () => catalogo),
    getPlanoBySlug: vi.fn(async (slug: string) => (PLANOS[slug] ? plano(slug) : undefined)),
    getPlanosVisiveis: vi.fn(async () => catalogo.filter((p) => !p.oculto)),
    invalidarCachePlanos: vi.fn(),
  };
});

const registrarAuditoriaMock = vi.fn(async () => {});
vi.mock("../_core/audit", () => ({
  registrarAuditoria: (...a: unknown[]) => (registrarAuditoriaMock as any)(...a),
}));

const { appRouter } = await import("../routers");

function ctxAdmin(): TrpcContext {
  return {
    user: {
      id: 1, openId: "adm", email: "adm@juridflow.com.br", name: "Admin", loginMethod: "google", role: "admin",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: { host: "app.juridflow.com.br" }, ip: "127.0.0.1" } as any,
    res: { clearCookie: () => {}, cookie: () => {} } as any,
  };
}
const admin = () => appRouter.createCaller(ctxAdmin());

const DIA = 24 * 60 * 60 * 1000;
const CLIENTE = { id: 7, name: "Carla", email: "carla@x.adv.br", asaasCustomerId: "cus_7" };
const SEM_ASAAS = { ...CLIENTE, asaasCustomerId: null };
const PAGANTE = { id: 40, userId: 7, asaasSubscriptionId: "sub_old", asaasCustomerId: "cus_7", planId: "atende", status: "active", cortesia: false, trialExpiraEm: null };
const EM_TESTE = { id: 41, userId: 7, asaasSubscriptionId: null, asaasCustomerId: null, planId: "completo", status: "trialing", cortesia: false, trialExpiraEm: Date.now() + 11 * DIA };

const insertsSub = () => capturado.inserts.filter((i) => i.table === "subscriptions");
const updatesSub = () => capturado.updates.filter((u) => u.table === "subscriptions");
const cancelamentosLocais = () => capturado.updates.filter((u) => u.set?.status === "canceled");

beforeEach(() => {
  capturado.inserts = [];
  capturado.updates = [];
  criarAssinatura.mockReset();
  criarAssinatura.mockResolvedValue({ id: "sub_new" });
  cancelarAssinatura.mockClear();
  criarCliente.mockClear();
  listarCobrancas.mockReset();
  listarCobrancas.mockResolvedValue({ data: [] });
  registrarAuditoriaMock.mockClear();
  getActiveSubscriptionMock.mockReset();
  getActiveSubscriptionMock.mockResolvedValue(null);
  catalogo = Object.keys(PLANOS).map(plano);
  for (const k of Object.keys(filas)) delete filas[k];
});

describe("admin.planosAtuais — o seletor lê o catálogo, não a lista fixa", () => {
  it("devolve o catálogo na ordem da vitrine, com os ocultos no fim (decisão 2: dobra, não sumiço)", async () => {
    const r = await admin().admin.planosAtuais();
    expect(r.map((p) => p.id)).toEqual(["atende", "escritorio", "escala", "completo", "basico", "monitoramento-profissional"]);
    expect(r.filter((p) => p.oculto).map((p) => p.id)).toEqual(["basico", "monitoramento-profissional"]);
    const completo = r.find((p) => p.id === "completo")!;
    expect(completo).toEqual(expect.objectContaining({ name: "Sob medida", precoSobConsulta: true, ctaDemonstracao: true }));
    expect(r.find((p) => p.id === "escritorio")!.popular).toBe(true);
    expect(r.find((p) => p.id === "atende")!.priceMonthly).toBe(14700);
  });

  it("nada da lista fixa PLANS entra quando o catálogo existe", async () => {
    const r = await admin().admin.planosAtuais();
    expect(r.map((p) => p.id)).not.toContain("free");
    expect(r.map((p) => p.id)).not.toContain("intermediario");
  });

  it("só com o catálogo VAZIO a lista fixa serve de reserva — e sem plano sob consulta nem oculto", async () => {
    catalogo = [];
    const r = await admin().admin.planosAtuais();
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((p) => p.precoSobConsulta === false && p.oculto === false)).toBe(true);
  });
});

describe("admin.trocarPlanoAdmin — plano com preço", () => {
  it("pagante: nasce uma linha nova aguardando pagamento e a atual NÃO é cancelada (decisão 1)", async () => {
    filas["users"] = [[CLIENTE], [CLIENTE]];
    filas["subscriptions"] = [[]];
    getActiveSubscriptionMock.mockResolvedValue(PAGANTE);
    listarCobrancas.mockResolvedValue({ data: [{ externalReference: "7:escritorio", invoiceUrl: "https://asaas/i/9", deleted: false }] });

    const r = await admin().admin.trocarPlanoAdmin({ userId: 7, newPlanId: "escritorio", interval: "monthly" });

    expect(r.success).toBe(true);
    expect(r.invoiceUrl).toBe("https://asaas/i/9");
    expect(r.mensagem).toContain("a atual continua até o pagamento cair");
    expect(criarAssinatura).toHaveBeenCalledTimes(1);
    expect((criarAssinatura.mock.calls[0] as any[])[0]).toEqual(expect.objectContaining({ customer: "cus_7", value: 297, cycle: "MONTHLY", externalReference: "7:escritorio" }));
    expect(insertsSub()).toHaveLength(1);
    expect(insertsSub()[0].values).toEqual(expect.objectContaining({ userId: 7, planId: "escritorio", asaasSubscriptionId: "sub_new", status: "incomplete" }));
    // Nem no Asaas, nem no banco: quem encerra a anterior é o webhook de pagamento.
    expect(cancelarAssinatura).not.toHaveBeenCalled();
    expect(cancelamentosLocais()).toHaveLength(0);
    expect(updatesSub()).toHaveLength(0);
  });

  it("em teste: a própria linha vira a assinatura do plano novo, teste mantido com ≥7 dias pra pagar (decisão 3)", async () => {
    filas["users"] = [[CLIENTE], [CLIENTE]];
    getActiveSubscriptionMock.mockResolvedValue(EM_TESTE);
    const antes = Date.now();

    const r = await admin().admin.trocarPlanoAdmin({ userId: 7, newPlanId: "atende", interval: "monthly" });

    expect(r.success).toBe(true);
    expect(insertsSub()).toHaveLength(0);
    expect(updatesSub()).toHaveLength(1);
    const up = updatesSub()[0];
    expect(up.where).toBe("id = 41");
    expect(up.set).toEqual(expect.objectContaining({ planId: "atende", status: "trialing", asaasSubscriptionId: "sub_new", asaasCustomerId: "cus_7", trialConvertido: true }));
    // Os 11 dias do teste ficam (é mais que os 7 de prazo) — nunca encurta.
    expect(up.set.trialExpiraEm).toBe(EM_TESTE.trialExpiraEm);
    expect(up.set.currentPeriodEnd).toBe(EM_TESTE.trialExpiraEm);
    expect(up.set.trialExpiraEm).toBeGreaterThanOrEqual(antes + 7 * DIA);
    expect(cancelarAssinatura).not.toHaveBeenCalled();
  });

  it("teste com menos de 7 dias ganha os 7 dias de prazo do boleto", async () => {
    filas["users"] = [[CLIENTE], [CLIENTE]];
    getActiveSubscriptionMock.mockResolvedValue({ ...EM_TESTE, trialExpiraEm: Date.now() + 2 * DIA });
    const antes = Date.now();
    await admin().admin.trocarPlanoAdmin({ userId: 7, newPlanId: "atende", interval: "monthly" });
    expect(updatesSub()[0].set.trialExpiraEm).toBeGreaterThanOrEqual(antes + 7 * DIA);
  });

  it("teste em cortesia não é mexido: ganha linha nova aguardando pagamento (o webhook poupa cortesia)", async () => {
    filas["users"] = [[CLIENTE], [CLIENTE]];
    filas["subscriptions"] = [[]];
    getActiveSubscriptionMock.mockResolvedValue({ ...EM_TESTE, cortesia: true });
    await admin().admin.trocarPlanoAdmin({ userId: 7, newPlanId: "atende", interval: "monthly" });
    expect(updatesSub()).toHaveLength(0);
    expect(insertsSub()[0].values).toEqual(expect.objectContaining({ planId: "atende", status: "incomplete" }));
  });

  it("sem cadastro no Asaas e sem CPF/CNPJ: recusa ANTES de falar com o Asaas", async () => {
    filas["users"] = [[SEM_ASAAS]];
    getActiveSubscriptionMock.mockResolvedValue(EM_TESTE);
    await expect(admin().admin.trocarPlanoAdmin({ userId: 7, newPlanId: "atende", interval: "monthly" })).rejects.toThrow(
      "informe o CPF/CNPJ pra emitir a cobrança",
    );
    expect(criarCliente).not.toHaveBeenCalled();
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(insertsSub()).toHaveLength(0);
    expect(updatesSub()).toHaveLength(0);
  });

  it("sem cadastro no Asaas mas com CPF/CNPJ: cria o cliente lá e segue", async () => {
    filas["users"] = [[SEM_ASAAS], [SEM_ASAAS]];
    getActiveSubscriptionMock.mockResolvedValue(EM_TESTE);
    const r = await admin().admin.trocarPlanoAdmin({ userId: 7, newPlanId: "atende", interval: "monthly", cpfCnpj: "529.982.247-25" });
    expect(r.success).toBe(true);
    expect(criarCliente).toHaveBeenCalledTimes(1);
    expect((criarCliente.mock.calls[0] as any[])[0]).toEqual(expect.objectContaining({ cpfCnpj: "52998224725", externalReference: "user:7" }));
    expect((criarAssinatura.mock.calls[0] as any[])[0]).toEqual(expect.objectContaining({ customer: "cus_novo" }));
    expect(updatesSub()[0].set).toEqual(expect.objectContaining({ asaasCustomerId: "cus_novo" }));
  });

  it("plano sob consulta continua recusado aqui — é o outro botão que fecha valor", async () => {
    filas["users"] = [[CLIENTE]];
    getActiveSubscriptionMock.mockResolvedValue(PAGANTE);
    await expect(admin().admin.trocarPlanoAdmin({ userId: 7, newPlanId: "completo", interval: "monthly" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(cancelarAssinatura).not.toHaveBeenCalled();
  });

  it("se o Asaas recusa a nova, nada muda: sem linha nova, sem update, sem cancelar", async () => {
    filas["users"] = [[CLIENTE], [CLIENTE]];
    getActiveSubscriptionMock.mockResolvedValue(EM_TESTE);
    criarAssinatura.mockRejectedValueOnce(new Error("Asaas fora"));
    await expect(admin().admin.trocarPlanoAdmin({ userId: 7, newPlanId: "atende", interval: "monthly" })).rejects.toThrow("Asaas fora");
    expect(insertsSub()).toHaveLength(0);
    expect(updatesSub()).toHaveLength(0);
    expect(cancelarAssinatura).not.toHaveBeenCalled();
  });

  it("a auditoria aponta pra assinatura mexida e diz pra qual plano foi", async () => {
    filas["users"] = [[CLIENTE], [CLIENTE]];
    getActiveSubscriptionMock.mockResolvedValue(EM_TESTE);
    await admin().admin.trocarPlanoAdmin({ userId: 7, newPlanId: "atende", interval: "monthly" });
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(expect.objectContaining({
      acao: "subscription.trocarPlanoAdmin",
      alvoId: 41,
      detalhes: expect.objectContaining({ newPlanId: "atende", asaasSubscriptionId: "sub_new" }),
    }));
  });
});

describe("admin.ativarAssinaturaNegociada — plano sob consulta escolhido no “Trocar plano”", () => {
  it("pagante trocando pra plano sob consulta: linha nova aguardando pagamento com o valor fechado; a atual fica", async () => {
    filas["subscriptions"] = [[PAGANTE]];
    filas["users"] = [[CLIENTE], [CLIENTE]];
    listarCobrancas.mockResolvedValue({ data: [{ externalReference: "7:completo", invoiceUrl: "https://asaas/i/5", deleted: false }] });

    const r = await admin().admin.ativarAssinaturaNegociada({ userId: 7, valorCentavos: 89900, interval: "monthly", planId: "completo", cpfCnpj: "" });

    expect(r.success).toBe(true);
    expect(r.invoiceUrl).toBe("https://asaas/i/5");
    expect(r.mensagem).toContain("Sob medida");
    expect((criarAssinatura.mock.calls[0] as any[])[0]).toEqual(expect.objectContaining({ value: 899, externalReference: "7:completo", description: "Sob medida — JuridFlow (valor fechado)" }));
    expect(insertsSub()).toHaveLength(1);
    expect(insertsSub()[0].values).toEqual(expect.objectContaining({ userId: 7, planId: "completo", status: "incomplete", valorNegociadoCentavos: 89900, asaasSubscriptionId: "sub_new" }));
    expect(updatesSub()).toHaveLength(0);
    expect(cancelarAssinatura).not.toHaveBeenCalled();
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(expect.objectContaining({
      alvoId: 77,
      detalhes: expect.objectContaining({ planId: "completo", trocaDePlano: true }),
    }));
  });

  it("pagante fechando valor do MESMO plano continua recusado — é o card Módulos & cobrança", async () => {
    filas["subscriptions"] = [[PAGANTE]];
    filas["users"] = [[CLIENTE]];
    await expect(admin().admin.ativarAssinaturaNegociada({ userId: 7, valorCentavos: 10000, interval: "monthly", planId: "atende" })).rejects.toThrow("Módulos & cobrança");
    filas["subscriptions"] = [[PAGANTE]];
    filas["users"] = [[CLIENTE]];
    await expect(admin().admin.ativarAssinaturaNegociada({ userId: 7, valorCentavos: 10000, interval: "monthly" })).rejects.toThrow("Módulos & cobrança");
    expect(criarAssinatura).not.toHaveBeenCalled();
  });

  it("em teste: a própria linha muda de plano, mantém o teste (≥7 dias) e grava o valor fechado", async () => {
    filas["subscriptions"] = [[EM_TESTE]];
    filas["users"] = [[CLIENTE], [CLIENTE]];
    const antes = Date.now();

    await admin().admin.ativarAssinaturaNegociada({ userId: 7, valorCentavos: 120000, interval: "yearly", planId: "monitoramento-profissional" });

    expect(insertsSub()).toHaveLength(0);
    const up = updatesSub()[0];
    expect(up.where).toBe("id = 41");
    expect(up.set).toEqual(expect.objectContaining({ planId: "monitoramento-profissional", status: "trialing", trialConvertido: true, valorNegociadoCentavos: 10000 }));
    expect(up.set.trialExpiraEm).toBeGreaterThanOrEqual(antes + 7 * DIA);
    expect(cancelarAssinatura).not.toHaveBeenCalled();
  });

  it("sem planId fecha o valor do plano que o cliente já tem — o botão da ficha não mudou", async () => {
    filas["subscriptions"] = [[EM_TESTE]];
    filas["users"] = [[CLIENTE], [CLIENTE]];
    await admin().admin.ativarAssinaturaNegociada({ userId: 7, valorCentavos: 50000, interval: "monthly" });
    expect(updatesSub()[0].set).toEqual(expect.objectContaining({ planId: "completo", valorNegociadoCentavos: 50000 }));
    expect((criarAssinatura.mock.calls[0] as any[])[0]).toEqual(expect.objectContaining({ externalReference: "7:completo" }));
  });

  it("assinatura Asaas pendurada de um teste (retry incompleto) sai da frente; a de pagante nunca", async () => {
    filas["subscriptions"] = [[{ ...EM_TESTE, asaasSubscriptionId: "sub_pendurada" }]];
    filas["users"] = [[CLIENTE], [CLIENTE]];
    await admin().admin.ativarAssinaturaNegociada({ userId: 7, valorCentavos: 50000, interval: "monthly", planId: "monitoramento-profissional" });
    expect(cancelarAssinatura).toHaveBeenCalledWith("sub_pendurada");
  });

  it("plano de destino desconhecido é recusado antes do Asaas", async () => {
    filas["subscriptions"] = [[EM_TESTE]];
    filas["users"] = [[CLIENTE]];
    await expect(admin().admin.ativarAssinaturaNegociada({ userId: 7, valorCentavos: 50000, interval: "monthly", planId: "nao-existe" })).rejects.toThrow("Plano não encontrado no catálogo");
    expect(criarAssinatura).not.toHaveBeenCalled();
  });

  it("cortesia continua fora: primeiro sai da cortesia", async () => {
    filas["subscriptions"] = [[{ ...PAGANTE, cortesia: true }]];
    filas["users"] = [[CLIENTE]];
    await expect(admin().admin.ativarAssinaturaNegociada({ userId: 7, valorCentavos: 50000, interval: "monthly", planId: "completo" })).rejects.toThrow("cortesia");
  });
});

describe("amarras no código", () => {
  const adm = ler("server/routers/admin.ts");
  const trocar = adm.slice(adm.indexOf("trocarPlanoAdmin: adminProcedure"), adm.indexOf("ativarAssinaturaNegociada: adminProcedure"));
  const ativar = adm.slice(adm.indexOf("ativarAssinaturaNegociada: adminProcedure"), adm.indexOf("marcarCortesia: adminProcedure"));
  const ficha = ler("client/src/pages/admin/AdminClients.tsx");
  const dialogo = ficha.slice(ficha.indexOf("{/* Trocar plano (admin)"), ficha.indexOf("{/* Ativar assinatura com valor fechado"));

  it("trocarPlanoAdmin nunca cancela — nem no Asaas nem no banco", () => {
    expect(trocar).not.toContain("cancelarAssinatura");
    expect(trocar).not.toContain('status: "canceled"');
  });

  it("ativarAssinaturaNegociada só cancela assinatura Asaas que NÃO é de pagante em dia", () => {
    expect(ativar).toContain("if (ultima?.asaasSubscriptionId && !pagante) {");
    expect(ativar).toContain("if (pagante && !trocaDePlano) {");
    expect(ativar).toContain("if (!ultima || pagante) {");
  });

  it("o diálogo do painel: catálogo com dobra, três caminhos, e o texto que diz que a atual continua", () => {
    expect(dialogo).toContain("A assinatura atual continua valendo até o");
    expect(dialogo).not.toContain("Cancela a assinatura atual no Asaas");
    expect(dialogo).toContain("Fora da vitrine");
    expect(dialogo).toContain("{planosVitrine.map(opcaoPlano)}");
    // A dobra aparece sempre que há oculto — nunca some, nunca fica trancada.
    expect(dialogo).toContain("{planosForaVitrine.length > 0 && (");
    expect(dialogo).toContain("{planosForaVitrine.map(opcaoPlano)}");
    expect(dialogo).toContain('{caminhoTroca === "sob" && planoEscolhido && (');
    expect(dialogo).toContain('{caminhoTroca === "preco" && planoEscolhido && (');
    expect(dialogo).toContain('{caminhoTroca === "atual" && (');
    expect(dialogo).toContain("Fechar valor e trocar");
    expect(dialogo).toContain("Este já é o plano atual.");
    expect(dialogo).toContain('disabled={trocaPendente || caminhoTroca !== "preco"}');
  });

  it("cada opção mostra “Sob consulta” ou o preço, “(atual)”, o selo e “oculto”", () => {
    const opcao = ficha.slice(ficha.indexOf("const opcaoPlano = ("), ficha.indexOf("return (\n    <div className=\"space-y-4\">"));
    expect(opcao).toContain('{p.precoSobConsulta ? "Sob consulta" : `${fmtBRLAdmin(p.priceMonthly / 100)}/mês`}');
    expect(opcao).toContain("(atual)");
    expect(opcao).toContain("🏆 mais popular");
    expect(opcao).toContain(">oculto</Badge>");
  });

  it("sob consulta vai pra ativarAssinaturaNegociada COM o plano de destino; com preço vai pro trocarPlanoAdmin com CPF/CNPJ", () => {
    const fluxo = ficha.slice(ficha.indexOf("const confirmarTrocaPreco = ("), ficha.indexOf("const opcaoPlano = ("));
    // Preço de tabela: o servidor exige CPF/CNPJ quando o cliente não tem cadastro no Asaas.
    expect(fluxo).toContain('interval: "monthly",\n      cpfCnpj: trocaCpf.trim() || undefined,\n    });');
    expect(fluxo).toContain("trocarPlanoMut.mutate({");
    // Sob consulta: valor + CPF/CNPJ + ciclo + plano de destino.
    expect(fluxo).toContain("fecharValorTrocaMut.mutate({");
    expect(fluxo).toContain('interval: trocaCiclo,\n      planId: planoEscolhido.id,\n    });');
    expect(ficha).toContain('const caminhoTroca: "vazio" | "atual" | "sob" | "preco" = !planoEscolhido');
    expect(ficha).toContain("const trocaPrecisaCpf = !user?.asaasCustomerId;");
    // O link da 1ª cobrança volta num toast nos três botões que criam assinatura.
    expect(ficha.match(/avisarAssinaturaCriada\(res\)/g)).toHaveLength(3);
  });

  it("o botão da ficha abre o diálogo sem plano pré-marcado (o atual aparece como “(atual)” na lista)", () => {
    expect(ficha).toContain("onClick={() => { setPlanoSelecionado(null); setTrocarOpen(true); }}");
  });
});
