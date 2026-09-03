/**
 * A taxa de uma cobrança paga tem DUAS fontes: o webhook (origem
 * `taxa_asaas`, value − netValue) e o cron do extrato (`PAYMENT_FEE`,
 * origem `extrato_asaas`). As duas continuam existindo — o que estes testes
 * travam é que a segunda a chegar reconhece a primeira e não lança a taxa
 * de novo, em qualquer ordem:
 *  - extrato depois do webhook → "coberto" (nada inserido, contado à parte)
 *  - extrato antes do webhook → insere amarrado à cobrança
 *    (`cobrancaOriginalId`), e `gerarDespesaTaxaAsaas` acha e desiste
 *  - sem `payment`, sem cobrança local, ou tipo que não é taxa de cobrança →
 *    comportamento de sempre
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Captured = {
  op: "select" | "insert";
  table: string;
  values?: any;
};

let captured: Captured[] = [];
let selectQueue: unknown[][] = [];
let nextInsertId = 1;

function tableName(t: unknown): string {
  const anyT = t as any;
  return anyT?._?.name || anyT?.[Symbol.for("drizzle:Name")] || "unknown";
}

function nextSelectResult(): unknown[] {
  return selectQueue.shift() ?? [];
}

function makeSelectBuilder(table: unknown) {
  const b: any = {
    from(_t: unknown) { return b; },
    where(_w: unknown) {
      captured.push({ op: "select", table: tableName(table) });
      return b;
    },
    limit: (_n: number) => Promise.resolve(nextSelectResult()),
    then: (r: (v: unknown) => unknown) => r(nextSelectResult()),
  };
  return b;
}

const mockDb = {
  select: (_cols?: unknown) => ({
    from(table: unknown) { return makeSelectBuilder(table); },
  }),
  insert: (table: unknown) => ({
    values(values: unknown) {
      captured.push({ op: "insert", table: tableName(table), values });
      const id = nextInsertId++;
      return {
        $returningId: () => Promise.resolve([{ id }]),
        then: (r: any) => r([{ insertId: id, affectedRows: 1 }]),
      };
    },
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

const { sincronizarExtratoAsaas } = await import("../integracoes/asaas-extrato");
const { gerarDespesaTaxaAsaas } = await import("../integracoes/asaas-despesas-auto");

function fakeClient(movs: any[]): any {
  return {
    listarMovimentacoes: vi.fn(async () => ({ data: movs, hasMore: false, limit: 100, offset: 0 })),
  };
}

function mov(overrides: any): any {
  return {
    object: "financialTransaction",
    id: "fin_" + Math.random().toString(36).slice(2, 10),
    value: -1.99,
    balance: 100,
    type: "PAYMENT_FEE",
    date: "2026-05-11",
    description: null,
    payment: null,
    ...overrides,
  };
}

const selectsEm = (table: string) => captured.filter((c) => c.op === "select" && c.table === table);
const insertsEm = (table: string) => captured.filter((c) => c.op === "insert" && c.table === table);

const COBRANCA_LOCAL = { id: 41 };
const CATEGORIA = { id: 7 };

beforeEach(() => {
  captured = [];
  selectQueue = [];
  nextInsertId = 1;
});

describe("extrato → PAYMENT_FEE de cobrança que o webhook já lançou", () => {
  it("cobrança local COM despesa taxa_asaas → nada inserido, conta em cobertasPeloWebhook", async () => {
    selectQueue.push([COBRANCA_LOCAL]); // asaas_cobrancas pelo asaasPaymentId
    selectQueue.push([{ id: 900 }]);    // despesas: taxa_asaas já existe

    const r = await sincronizarExtratoAsaas(10, fakeClient([mov({ payment: "pay_abc" })]), {
      criadoPorUserId: 5,
    });

    expect(r.cobertasPeloWebhook).toBe(1);
    expect(r.novasDespesas).toBe(0);
    expect(r.duplicadas).toBe(0);
    expect(r.erros).toBe(0);
    expect(r.totalProcessadas).toBe(1);
    expect(insertsEm("despesas")).toHaveLength(0);
    expect(selectsEm("asaas_cobrancas")).toHaveLength(1);
    expect(selectsEm("despesas")).toHaveLength(1);
  });

  it("cobrança local SEM despesa taxa_asaas → insere amarrada à cobrança (cobrancaOriginalId)", async () => {
    selectQueue.push([COBRANCA_LOCAL]);
    selectQueue.push([]);          // nenhuma taxa_asaas
    selectQueue.push([CATEGORIA]); // categoria já existe

    const r = await sincronizarExtratoAsaas(
      10,
      fakeClient([mov({ id: "fin_9", payment: "pay_abc", value: -1.99 })]),
      { criadoPorUserId: 5 },
    );

    expect(r.novasDespesas).toBe(1);
    expect(r.cobertasPeloWebhook).toBe(0);
    const [ins] = insertsEm("despesas");
    expect(ins.values.cobrancaOriginalId).toBe(COBRANCA_LOCAL.id);
    expect(ins.values.origem).toBe("extrato_asaas");
    expect(ins.values.asaasFinTransId).toBe("fin_9");
    expect(ins.values.asaasFinTransType).toBe("PAYMENT_FEE");
    expect(ins.values.valor).toBe("1.99");
  });

  it("PAYMENT_FEE sem `payment` → insere como antes, sem consultar cobrança nem amarrar", async () => {
    selectQueue.push([CATEGORIA]);

    const r = await sincronizarExtratoAsaas(10, fakeClient([mov({ payment: null })]), {
      criadoPorUserId: 5,
    });

    expect(r.novasDespesas).toBe(1);
    expect(r.cobertasPeloWebhook).toBe(0);
    expect(selectsEm("asaas_cobrancas")).toHaveLength(0);
    const [ins] = insertsEm("despesas");
    expect(ins.values.cobrancaOriginalId ?? null).toBeNull();
  });

  it("`payment` que não existe localmente → insere como antes, sem procurar taxa_asaas", async () => {
    selectQueue.push([]);          // cobrança não achada
    selectQueue.push([CATEGORIA]);

    const r = await sincronizarExtratoAsaas(10, fakeClient([mov({ payment: "pay_de_outro_lugar" })]), {
      criadoPorUserId: 5,
    });

    expect(r.novasDespesas).toBe(1);
    expect(r.cobertasPeloWebhook).toBe(0);
    expect(selectsEm("asaas_cobrancas")).toHaveLength(1);
    expect(selectsEm("despesas")).toHaveLength(0);
    const [ins] = insertsEm("despesas");
    expect(ins.values.cobrancaOriginalId ?? null).toBeNull();
  });

  it("TRANSFER com `payment` → não é taxa de cobrança: não consulta cobrança, insere como antes", async () => {
    selectQueue.push([CATEGORIA]);

    const r = await sincronizarExtratoAsaas(
      10,
      fakeClient([mov({ type: "TRANSFER", value: -500, payment: "pay_abc" })]),
      { criadoPorUserId: 5 },
    );

    expect(r.novasDespesas).toBe(1);
    expect(r.cobertasPeloWebhook).toBe(0);
    expect(selectsEm("asaas_cobrancas")).toHaveLength(0);
    const [ins] = insertsEm("despesas");
    expect(ins.values.cobrancaOriginalId ?? null).toBeNull();
    expect(ins.values.asaasFinTransType).toBe("TRANSFER");
  });

  it("REFUND_REQUEST_FEE é outra taxa (o webhook não a gera) → entra mesmo com taxa_asaas da cobrança", async () => {
    // Se a amarra cobrisse este tipo, a fila abaixo seria lida como
    // "cobrança + taxa_asaas existente" e a taxa do estorno sumiria.
    selectQueue.push([CATEGORIA]);
    selectQueue.push([COBRANCA_LOCAL]);
    selectQueue.push([{ id: 900 }]);

    const r = await sincronizarExtratoAsaas(
      10,
      fakeClient([mov({ type: "REFUND_REQUEST_FEE", value: -3.49, payment: "pay_abc" })]),
      { criadoPorUserId: 5 },
    );

    expect(r.novasDespesas).toBe(1);
    expect(r.cobertasPeloWebhook).toBe(0);
    expect(selectsEm("asaas_cobrancas")).toHaveLength(0);
    const [ins] = insertsEm("despesas");
    expect(ins.values.cobrancaOriginalId ?? null).toBeNull();
    expect(ins.values.valor).toBe("3.49");
  });

  it("uma página mista soma cada coisa no seu campo", async () => {
    selectQueue.push([COBRANCA_LOCAL]); // fee coberta: cobrança…
    selectQueue.push([{ id: 900 }]);    // …com taxa_asaas
    selectQueue.push([{ id: 42 }]);     // fee nova: cobrança…
    selectQueue.push([]);               // …sem taxa_asaas
    selectQueue.push([CATEGORIA]);      // categoria "Taxas Asaas"
    selectQueue.push([{ id: 8 }]);      // categoria da TRANSFER

    const r = await sincronizarExtratoAsaas(
      10,
      fakeClient([
        mov({ id: "fin_a", payment: "pay_coberta" }),
        mov({ id: "fin_b", payment: "pay_nova" }),
        mov({ id: "fin_c", type: "TRANSFER", value: -200 }),
        mov({ id: "fin_d", type: "PAYMENT_RECEIVED", value: 100 }),
      ]),
      { criadoPorUserId: 5 },
    );

    expect(r.totalProcessadas).toBe(4);
    expect(r.cobertasPeloWebhook).toBe(1);
    expect(r.novasDespesas).toBe(2);
    expect(r.ignoradas).toBe(1);
    expect(r.duplicadas).toBe(0);
    expect(r.erros).toBe(0);
    const ids = insertsEm("despesas").map((i) => i.values.asaasFinTransId);
    expect(ids).toEqual(["fin_b", "fin_c"]);
    expect(insertsEm("despesas")[0].values.cobrancaOriginalId).toBe(42);
  });
});

describe("webhook → gerarDespesaTaxaAsaas quando o extrato já importou a taxa", () => {
  const params = {
    escritorioId: 1,
    cobrancaOriginalId: COBRANCA_LOCAL.id,
    valor: 100,
    valorLiquido: 98.01,
    dataPagamento: "2026-05-11",
    descricaoCobranca: "Honorário",
    criadoPorUserId: 7,
  };

  it("despesa extrato_asaas da cobrança existe → created=false com o id dela, nada inserido", async () => {
    selectQueue.push([{ id: 10 }]);  // categoria "Taxas Asaas"
    selectQueue.push([{ id: 321 }]); // despesas: extrato_asaas amarrada à cobrança

    const r = await gerarDespesaTaxaAsaas(params);

    expect(r).toEqual({ created: false, despesaId: 321 });
    expect(insertsEm("despesas")).toHaveLength(0);
    expect(selectsEm("despesas")).toHaveLength(1);
  });

  it("sem despesa do extrato → insere a taxa_asaas normalmente", async () => {
    selectQueue.push([{ id: 10 }]);
    selectQueue.push([]);

    const r = await gerarDespesaTaxaAsaas(params);

    expect(r.created).toBe(true);
    expect(r.despesaId).toBe(1);
    const [ins] = insertsEm("despesas");
    expect(ins.values.origem).toBe("taxa_asaas");
    expect(ins.values.cobrancaOriginalId).toBe(COBRANCA_LOCAL.id);
    expect(ins.values.valor).toBe("1.99");
  });

  it("taxa zero continua saindo antes de qualquer consulta", async () => {
    const r = await gerarDespesaTaxaAsaas({ ...params, valorLiquido: 100 });
    expect(r).toEqual({ created: false, despesaId: null });
    expect(captured).toHaveLength(0);
  });
});
