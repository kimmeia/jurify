/**
 * "Meu plano" fora do combinado (print do dono, 08/09): Essencial a R$ 5,00
 * com "Fazer Downgrade", R$ 497,00 no cabeçalho de um plano sob consulta e
 * dois "Mais escolhido". Dois eram dado editado no painel, um era código —
 * e o downgrade abria um checkout de verdade no Asaas.
 *
 * O que fica travado aqui:
 *  - plano sob consulta nunca vira checkout nem troca automática, também no
 *    `changePlan` (só o `createCheckout` recusava);
 *  - ciclo anual só existe com preço anual cadastrado — sem ele o servidor
 *    cobraria 12× o mensal vendido como "−2 meses";
 *  - "Mais popular" é um selo só: ligar num plano desliga nos outros;
 *  - a tela respeita "sob consulta" no cabeçalho e some com o toggle anual
 *    quando nenhum plano tem preço anual (decisão do dono).
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
/** `slug <> 'pro'` → "slug <> pro" — legível o bastante pra afirmar no teste. */
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
      values: (v: any) => { capturado.inserts.push({ table: nomeTabela(t), values: v }); return Promise.resolve([{ insertId: 1 }]); },
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
const listarCobrancas = vi.fn(async () => ({ data: [{ externalReference: "100:pago", invoiceUrl: "https://asaas/i/1", deleted: false }] }));
vi.mock("../billing/asaas-billing-client", () => ({
  getAdminAsaasClient: vi.fn(async () => ({ criarAssinatura, listarCobrancas, cancelarAssinatura: vi.fn() })),
  isAsaasBillingConfigured: () => true,
  getAsaasBillingWebhookSecret: vi.fn(async () => "segredo"),
}));

/** Vitrine do lançamento como a 0203 deixou, mais um plano pago com anual real. */
const PLANOS: Record<string, any> = {
  "monitoramento-essencial": { slug: "monitoramento-essencial", nome: "Monitoramento Essencial", precoMensalCentavos: 0, precoAnualCentavos: null, precoSobConsulta: true, ctaDemonstracao: false, popular: false, trialDias: 14 },
  "monitoramento-profissional": { slug: "monitoramento-profissional", nome: "Monitoramento Profissional", precoMensalCentavos: 0, precoAnualCentavos: null, precoSobConsulta: true, ctaDemonstracao: false, popular: true, trialDias: 14 },
  // Como está em produção: a seed 0108 deixou 49700/497000 no Completo e a
  // 0203 só ligou "sob consulta" por cima — nenhuma migration zerou isso.
  completo: { slug: "completo", nome: "JuridFlow Completo", precoMensalCentavos: 49700, precoAnualCentavos: 497000, precoSobConsulta: true, ctaDemonstracao: true, popular: false, trialDias: 14 },
  pago: { slug: "pago", nome: "Pago", precoMensalCentavos: 19900, precoAnualCentavos: 199000, precoSobConsulta: false, ctaDemonstracao: false, popular: false, trialDias: 0 },
  "pago-so-mensal": { slug: "pago-so-mensal", nome: "Pago só mensal", precoMensalCentavos: 9900, precoAnualCentavos: null, precoSobConsulta: false, ctaDemonstracao: false, popular: false, trialDias: 0 },
};
const comuns = { descricao: "", publicoAlvo: null, features: [], modulosLiberados: [], limites: { creditosCalculosMes: 10 }, oculto: false };
const plano = (slug: string) => ({ ...comuns, ...PLANOS[slug] });

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
    getPlanoBySlug: vi.fn(async (slug: string) => (PLANOS[slug] ? plano(slug) : undefined)),
    getPlanosVisiveis: vi.fn(async () => ["monitoramento-essencial", "monitoramento-profissional", "completo", "pago"].map(plano)),
    invalidarCachePlanos: vi.fn(),
  };
});

const registrarAuditoriaMock = vi.fn(async () => {});
vi.mock("../_core/audit", () => ({
  registrarAuditoria: (...a: unknown[]) => (registrarAuditoriaMock as any)(...a),
}));

const { appRouter } = await import("../routers");
const { planoTemPrecoAnual } = await import("../routers/subscription");

function ctxDe(role: "user" | "admin"): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google", role,
      asaasCustomerId: "cus_1", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: { host: "app.juridflow.com.br" }, ip: "127.0.0.1" } as any,
    res: { clearCookie: () => {}, cookie: () => {} } as any,
  };
}
const cliente = () => appRouter.createCaller(ctxDe("user"));
const admin = () => appRouter.createCaller(ctxDe("admin"));

beforeEach(() => {
  capturado.inserts = [];
  capturado.updates = [];
  criarAssinatura.mockClear();
  getActiveSubscriptionMock.mockReset();
  getActiveSubscriptionMock.mockResolvedValue({ id: 1, asaasSubscriptionId: "sub_old", asaasCustomerId: "cus_1", planId: "completo", status: "trialing" });
  for (const k of Object.keys(filas)) delete filas[k];
});

describe("planoTemPrecoAnual", () => {
  it("só conta preço anual de verdade — null e 0 são “não vendemos anual”", () => {
    expect(planoTemPrecoAnual({ precoAnualCentavos: null })).toBe(false);
    expect(planoTemPrecoAnual({ precoAnualCentavos: 0 })).toBe(false);
    expect(planoTemPrecoAnual(undefined)).toBe(false);
    expect(planoTemPrecoAnual({ precoAnualCentavos: 1 })).toBe(true);
  });

  it("plano sob consulta não tem preço anual público, mesmo com número velho no banco", () => {
    expect(planoTemPrecoAnual({ precoAnualCentavos: 497000, precoSobConsulta: true })).toBe(false);
    expect(planoTemPrecoAnual({ precoAnualCentavos: 497000, precoSobConsulta: false })).toBe(true);
  });
});

describe("subscription.plans", () => {
  it("diz pra tela se cada plano tem preço anual — é o que decide se o toggle aparece", async () => {
    const r = await cliente().subscription.plans();
    const porSlug = Object.fromEntries(r.map((p) => [p.slug, p]));
    expect((porSlug["monitoramento-essencial"] as any).temPrecoAnual).toBe(false);
    // O Completo tem 497000 gravado e é sob consulta: NÃO conta — senão a
    // vitrine do lançamento (três planos sob consulta) trazia o toggle de volta.
    expect((porSlug["completo"] as any).temPrecoAnual).toBe(false);
    expect((porSlug["pago"] as any).temPrecoAnual).toBe(true);
    expect((porSlug["monitoramento-essencial"] as any).precoSobConsulta).toBe(true);
  });
});

describe("subscription.changePlan / createCheckout — o que não pode virar cobrança", () => {
  it("troca pra plano sob consulta é recusada ANTES de falar com o Asaas", async () => {
    await expect(
      cliente().subscription.changePlan({ newPlanId: "monitoramento-essencial", interval: "monthly" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("sob consulta — fale com a gente") });
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(capturado.inserts).toHaveLength(0);
  });

  it("ciclo anual sem preço anual cadastrado é recusado nos dois caminhos", async () => {
    await expect(
      cliente().subscription.changePlan({ newPlanId: "pago-so-mensal", interval: "yearly" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("não tem preço anual") });
    await expect(
      cliente().subscription.createCheckout({ planId: "pago-so-mensal", interval: "yearly" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(criarAssinatura).not.toHaveBeenCalled();
  });

  it("plano pago com anual de verdade continua contratável no anual (a trava não fecha demais)", async () => {
    filas["users"] = [[{ id: 100, asaasCustomerId: "cus_1" }]];
    filas["subscriptions"] = [[]];
    const r = await cliente().subscription.changePlan({ newPlanId: "pago", interval: "yearly" });
    expect(r.asaasSubscriptionId).toBe("sub_new");
    expect(criarAssinatura).toHaveBeenCalledTimes(1);
    expect((criarAssinatura.mock.calls[0] as any[])[0]).toEqual(expect.objectContaining({ cycle: "YEARLY", value: 1990 }));
  });
});

describe("admin.editarPlano / criarPlano — um só “Mais popular”", () => {
  it("ligar o selo num plano desliga nos outros (WHERE slug <> o editado)", async () => {
    filas["planos"] = [[{ id: 2, slug: "monitoramento-profissional" }]];
    await admin().admin.editarPlano({ slug: "monitoramento-profissional", popular: true });
    const ups = capturado.updates.filter((u) => u.table === "planos");
    expect(ups).toHaveLength(2);
    expect(ups[0].set).toEqual(expect.objectContaining({ popular: true }));
    expect(ups[0].where).toBe("slug = monitoramento-profissional");
    expect(ups[1].set).toEqual(expect.objectContaining({ popular: false }));
    expect(ups[1].where).toBe("slug <> monitoramento-profissional");
  });

  it("desligar o selo (ou editar outra coisa) não mexe nos outros planos", async () => {
    filas["planos"] = [[{ id: 2, slug: "monitoramento-profissional" }], [{ id: 2, slug: "monitoramento-profissional" }]];
    await admin().admin.editarPlano({ slug: "monitoramento-profissional", popular: false });
    await admin().admin.editarPlano({ slug: "monitoramento-profissional", nome: "Profissional" });
    expect(capturado.updates.filter((u) => u.table === "planos")).toHaveLength(2);
    expect(capturado.updates.every((u) => u.where === "slug = monitoramento-profissional")).toBe(true);
  });

  it("plano novo criado já com o selo também apaga o selo dos outros", async () => {
    filas["planos"] = [[]];
    const r = await admin().admin.criarPlano({ nome: "Plano Novo", precoMensalCentavos: 1000, popular: true });
    expect(capturado.inserts.find((i) => i.table === "planos")?.values).toEqual(expect.objectContaining({ popular: true }));
    const up = capturado.updates.find((u) => u.table === "planos");
    expect(up?.set).toEqual(expect.objectContaining({ popular: false }));
    expect(up?.where).toBe(`slug <> ${r.slug}`);
  });
});

describe("amarras no código", () => {
  const sub = ler("server/routers/subscription.ts");
  const plans = ler("client/src/pages/Plans.tsx");

  it("createCheckout e changePlan passam pela MESMA trava, antes do cliente Asaas", () => {
    for (const nome of ["createCheckout:", "changePlan:"]) {
      const i = sub.indexOf(nome);
      const corpo = sub.slice(i, sub.indexOf(".mutation(", i) + 4000);
      const trava = corpo.indexOf("await exigirPlanoContratavel(");
      const asaas = corpo.indexOf("await getAdminAsaasClient()");
      expect(trava, nome).toBeGreaterThan(-1);
      expect(trava, `${nome}: a trava tem que vir antes do Asaas`).toBeLessThan(asaas);
    }
  });

  it("o cabeçalho respeita “sob consulta”: nada de R$ 497,00 em cima de um plano sem preço público", () => {
    expect(plans).toContain("const sobConsultaAtual = !!(currentPlanData as any)?.precoSobConsulta;");
    expect(plans).toContain("const currentPrice = currentPlanData && !sobConsultaAtual");
    expect(plans).toContain("{sobConsultaAtual ? (");
    expect(plans).toContain("· o valor é fechado na conversa");
    // O botão do cabeçalho leva pra conversa — e a mensagem sabe que é teste.
    expect(plans).toContain("fecharValorComAGente(currentPlanName ?? \"JuridFlow\", emTeste)");
    expect(plans).toContain("Estou no teste do ${nomePlano} e quero fechar o valor.");
    expect(plans).toContain("Nada é cobrado sem você fechar o valor.");
  });

  it("o toggle Mensal/Anual só existe com preço anual de verdade, e sem “−2 meses” inventado", () => {
    expect(plans).toContain("const temPrecoAnual = (plans ?? []).some((p) => !!(p as any).temPrecoAnual);");
    expect(plans).toContain('const intervalo: "monthly" | "yearly" = temPrecoAnual ? billingInterval : "monthly";');
    expect(plans).toContain("{temPrecoAnual && (");
    expect(plans).not.toContain("−2 meses");
    expect(plans).toContain("economize até {formatPrice(economiaAnual)}/ano");
    // Toda comparação e toda mutation usam o intervalo derivado, não o estado cru.
    expect(plans.match(/billingInterval/g)).toHaveLength(2);
    expect(plans).toContain("changePlan.mutate({ newPlanId: planId, interval: intervalo })");
    expect(plans).toContain("interval: intervalo,");
  });

  it("um só “Mais escolhido” na tela, e o card do plano de demonstração diz “Agendar demonstração”", () => {
    expect(plans).toContain("const popularId = subscriptionPlans.find((p) => p.popular)?.id ?? null;");
    expect(plans).toContain("const isPopular = plan.id === popularId;");
    expect(plans).toContain('buttonLabel = demonstracao ? "💬 Agendar demonstração" : "💬 Falar com a gente"');
    // Seta de upgrade/downgrade não cabe num botão de conversa.
    expect(plans).toContain("{isUpgrade && !sobConsulta && <>↑ </>}");
    expect(plans).toContain("{isDowngrade && !sobConsulta && <>↓ </>}");
    expect(plans).toContain("Todos os planos são fechados na conversa");
  });

  it("o editor de plano avisa que o selo é exclusivo", () => {
    expect(ler("client/src/pages/admin/AdminPlanoEditor.tsx")).toContain("ligar aqui desliga nos outros");
  });

  it("a migration devolve o Essencial ao combinado e deixa um único popular — sem tocar no preço do Completo", () => {
    const mig = ler("drizzle/0216_planos_vitrine_lancamento.sql");
    const essencial = mig.slice(mig.indexOf("UPDATE planos SET"), mig.indexOf("WHERE slug = 'monitoramento-essencial'"));
    expect(essencial).toContain("preco_sob_consulta = TRUE");
    expect(essencial).toContain("popular = FALSE");
    expect(essencial).toContain("preco_mensal_centavos = 0");
    expect(essencial).toContain("preco_anual_centavos = NULL");
    expect(mig).toContain("UPDATE planos SET popular = FALSE WHERE slug <> 'monitoramento-profissional';");
    // O preço mensal só é mexido no Essencial: quem já assina o Completo tem a
    // fatura composta lendo esse número.
    expect(mig.match(/preco_mensal_centavos/g)).toHaveLength(1);
    expect(mig).not.toContain("'completo'");
  });
});
