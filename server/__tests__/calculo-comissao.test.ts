import { describe, expect, it } from "vitest";
import {
  calcularComissao,
  classificarCobranca,
  selecionarFaixa,
  type CobrancaParaComissao,
  type FaixaComissao,
  type RegraComissao,
} from "../../shared/calculo-comissao";

const REGRA_PADRAO: RegraComissao = { aliquotaPercent: 4, valorMinimo: 100 };

function cobranca(
  overrides: Partial<CobrancaParaComissao>,
): CobrancaParaComissao {
  return {
    id: 1,
    valor: 1000,
    dataPagamento: new Date("2026-04-15"),
    atendenteId: 7,
    categoriaComissionavel: true,
    comissionavelOverride: null,
    ...overrides,
  };
}

describe("classificarCobranca", () => {
  it("comissionável quando categoria comissionável e acima do mínimo", () => {
    const r = classificarCobranca(cobranca({ valor: 500 }), REGRA_PADRAO);
    expect(r.comissionavel).toBe(true);
  });

  it("exclui por override manual mesmo com categoria comissionável", () => {
    const r = classificarCobranca(
      cobranca({ valor: 5000, comissionavelOverride: false }),
      REGRA_PADRAO,
    );
    expect(r).toEqual({ comissionavel: false, motivo: "override_manual" });
  });

  it("override TRUE força inclusão mesmo com categoria não comissionável", () => {
    const r = classificarCobranca(
      cobranca({
        valor: 500,
        categoriaComissionavel: false,
        comissionavelOverride: true,
      }),
      REGRA_PADRAO,
    );
    expect(r.comissionavel).toBe(true);
  });

  it("exclui pela categoria quando override é null", () => {
    const r = classificarCobranca(
      cobranca({ valor: 500, categoriaComissionavel: false }),
      REGRA_PADRAO,
    );
    expect(r).toEqual({
      comissionavel: false,
      motivo: "categoria_nao_comissionavel",
    });
  });

  it("comissionável por padrão quando categoria é null (sem categoria)", () => {
    const r = classificarCobranca(
      cobranca({ valor: 500, categoriaComissionavel: null }),
      REGRA_PADRAO,
    );
    expect(r.comissionavel).toBe(true);
  });

  it("exclui valor estritamente abaixo do mínimo", () => {
    const r = classificarCobranca(cobranca({ valor: 99.99 }), REGRA_PADRAO);
    expect(r).toEqual({ comissionavel: false, motivo: "abaixo_minimo" });
  });

  it("inclui valor exatamente igual ao mínimo", () => {
    const r = classificarCobranca(cobranca({ valor: 100 }), REGRA_PADRAO);
    expect(r.comissionavel).toBe(true);
  });

  it("override TRUE ainda é cortado pelo valor mínimo", () => {
    const r = classificarCobranca(
      cobranca({ valor: 50, comissionavelOverride: true }),
      REGRA_PADRAO,
    );
    expect(r).toEqual({ comissionavel: false, motivo: "abaixo_minimo" });
  });
});

describe("calcularComissao", () => {
  it("totais e comissão batem em cenário misto", () => {
    const cobrancas = [
      cobranca({ id: 1, valor: 5000 }), // comissionável
      cobranca({ id: 2, valor: 80, categoriaComissionavel: false }), // categoria
      cobranca({ id: 3, valor: 50 }), // abaixo do mínimo
      cobranca({ id: 4, valor: 3000, comissionavelOverride: false }), // override
    ];
    const r = calcularComissao(cobrancas, REGRA_PADRAO);

    expect(r.comissionaveis.map((c) => c.id)).toEqual([1]);
    expect(r.naoComissionaveis.map((n) => n.cobranca.id)).toEqual([2, 3, 4]);
    expect(r.naoComissionaveis.map((n) => n.motivo)).toEqual([
      "categoria_nao_comissionavel",
      "abaixo_minimo",
      "override_manual",
    ]);
    expect(r.totais.bruto).toBe(8130);
    expect(r.totais.comissionavel).toBe(5000);
    expect(r.totais.naoComissionavel).toBe(3130);
    expect(r.totais.valorComissao).toBe(200); // 4% de 5000
  });

  it("lista vazia retorna zeros", () => {
    const r = calcularComissao([], REGRA_PADRAO);
    expect(r.comissionaveis).toEqual([]);
    expect(r.naoComissionaveis).toEqual([]);
    expect(r.totais).toEqual({
      bruto: 0,
      comissionavel: 0,
      naoComissionavel: 0,
      valorComissao: 0,
    });
  });

  it("alíquota zero produz comissão zero mas mantém comissionáveis listadas", () => {
    const r = calcularComissao(
      [cobranca({ valor: 1000 })],
      { aliquotaPercent: 0, valorMinimo: 0 },
    );
    expect(r.comissionaveis).toHaveLength(1);
    expect(r.totais.valorComissao).toBe(0);
  });

  it("preserva precisão de 2 casas decimais em valores fracionados", () => {
    const r = calcularComissao(
      [
        cobranca({ id: 1, valor: 199.95 }),
        cobranca({ id: 2, valor: 100.05 }),
      ],
      { aliquotaPercent: 7.5, valorMinimo: 0 },
    );
    expect(r.totais.comissionavel).toBe(300);
    expect(r.totais.valorComissao).toBe(22.5);
  });
});

// ─── Modo faixas (cumulativo) ────────────────────────────────────────────────

const FAIXAS_BASE: FaixaComissao[] = [
  { limiteAte: 20000, aliquotaPercent: 4 },
  { limiteAte: 30000, aliquotaPercent: 5 },
  { limiteAte: null, aliquotaPercent: 6 },
];

describe("selecionarFaixa", () => {
  it("retorna null quando tabela está vazia", () => {
    expect(selecionarFaixa([], 10000)).toBeNull();
  });

  it("escolhe a primeira faixa quando o valor cai dentro", () => {
    const r = selecionarFaixa(FAIXAS_BASE, 15000);
    expect(r?.ordem).toBe(0);
    expect(r?.faixa.aliquotaPercent).toBe(4);
  });

  it("escolhe a faixa intermediária para valor dentro dela", () => {
    const r = selecionarFaixa(FAIXAS_BASE, 25000);
    expect(r?.faixa.aliquotaPercent).toBe(5);
  });

  it("trata valor exatamente igual ao limite como pertencente à faixa", () => {
    const r = selecionarFaixa(FAIXAS_BASE, 20000);
    expect(r?.faixa.aliquotaPercent).toBe(4);
  });

  it("usa última faixa (sem teto) quando valor estoura todos os limites", () => {
    const r = selecionarFaixa(FAIXAS_BASE, 50000);
    expect(r?.faixa.aliquotaPercent).toBe(6);
  });

  it("usa a última faixa explícita quando todas têm teto e valor estoura", () => {
    const finitas: FaixaComissao[] = [
      { limiteAte: 1000, aliquotaPercent: 2 },
      { limiteAte: 2000, aliquotaPercent: 3 },
    ];
    const r = selecionarFaixa(finitas, 9999);
    expect(r?.faixa.aliquotaPercent).toBe(3);
  });

  it("ordena faixas internamente quando entrada está fora de ordem", () => {
    const desordenadas: FaixaComissao[] = [
      { limiteAte: 30000, aliquotaPercent: 5 },
      { limiteAte: 20000, aliquotaPercent: 4 },
    ];
    const r = selecionarFaixa(desordenadas, 25000);
    expect(r?.faixa.aliquotaPercent).toBe(5);
  });
});

describe("calcularComissao — modo faixas (cumulativo)", () => {
  function cobrPaga(id: number, valor: number): CobrancaParaComissao {
    return {
      id,
      valor,
      dataPagamento: new Date("2026-04-15"),
      atendenteId: 7,
      categoriaComissionavel: true,
      comissionavelOverride: null,
    };
  }

  it("exemplo do dono: recebeu R$ 20.000 → 4% sobre 20.000 = R$ 800", () => {
    const r = calcularComissao([cobrPaga(1, 20000)], {
      modo: "faixas",
      aliquotaPercent: 0,
      valorMinimo: 100,
      faixas: FAIXAS_BASE,
    });
    expect(r.aliquotaAplicada).toBe(4);
    expect(r.totais.valorComissao).toBe(800);
    expect(r.faixaAplicada?.limiteAte).toBe(20000);
  });

  it("exemplo do dono: recebeu R$ 25.000 → 5% sobre 25.000 = R$ 1.250 (cumulativo)", () => {
    const r = calcularComissao(
      [cobrPaga(1, 15000), cobrPaga(2, 10000)],
      {
        modo: "faixas",
        aliquotaPercent: 0,
        valorMinimo: 100,
        faixas: FAIXAS_BASE,
      },
    );
    expect(r.totais.comissionavel).toBe(25000);
    expect(r.aliquotaAplicada).toBe(5);
    expect(r.totais.valorComissao).toBe(1250);
    expect(r.faixaAplicada?.ordem).toBe(1);
  });

  it("estoura a maior faixa → usa última (sem teto) — R$ 100.000 × 6% = R$ 6.000", () => {
    const r = calcularComissao([cobrPaga(1, 100000)], {
      modo: "faixas",
      aliquotaPercent: 0,
      valorMinimo: 100,
      faixas: FAIXAS_BASE,
    });
    expect(r.aliquotaAplicada).toBe(6);
    expect(r.totais.valorComissao).toBe(6000);
    expect(r.faixaAplicada?.limiteAte).toBeNull();
  });

  it("baseFaixa=bruto: mensalidade infla a faixa mas não a comissão", () => {
    // 22k comissionável + 5k mensalidade não-comissionável = 27k bruto.
    // Bruto 27k cai na faixa de 30k (5%). Comissão = 5% × 22k = 1.100.
    const cobrancas: CobrancaParaComissao[] = [
      cobrPaga(1, 22000),
      {
        id: 2,
        valor: 5000,
        dataPagamento: new Date("2026-04-15"),
        atendenteId: 7,
        categoriaComissionavel: false,
        comissionavelOverride: null,
      },
    ];
    const r = calcularComissao(cobrancas, {
      modo: "faixas",
      aliquotaPercent: 0,
      valorMinimo: 100,
      faixas: FAIXAS_BASE,
      baseFaixa: "bruto",
    });
    expect(r.totais.bruto).toBe(27000);
    expect(r.totais.comissionavel).toBe(22000);
    expect(r.aliquotaAplicada).toBe(5);
    expect(r.totais.valorComissao).toBe(1100);
  });

  it("baseFaixa=comissionavel (default): mensalidade não influencia faixa nem cálculo", () => {
    const cobrancas: CobrancaParaComissao[] = [
      cobrPaga(1, 18000),
      {
        id: 2,
        valor: 5000,
        dataPagamento: new Date("2026-04-15"),
        atendenteId: 7,
        categoriaComissionavel: false,
        comissionavelOverride: null,
      },
    ];
    const r = calcularComissao(cobrancas, {
      modo: "faixas",
      aliquotaPercent: 0,
      valorMinimo: 100,
      faixas: FAIXAS_BASE,
      // baseFaixa omitido → "comissionavel"
    });
    expect(r.totais.bruto).toBe(23000);
    expect(r.totais.comissionavel).toBe(18000);
    // 18k cai na faixa de 20k (4%) — bruto não conta.
    expect(r.aliquotaAplicada).toBe(4);
    expect(r.totais.valorComissao).toBe(720);
  });

  it("filtro de valor mínimo continua excluindo cobranças pequenas no modo faixas", () => {
    const r = calcularComissao(
      [cobrPaga(1, 22000), cobrPaga(2, 80)],
      {
        modo: "faixas",
        aliquotaPercent: 0,
        valorMinimo: 100,
        faixas: FAIXAS_BASE,
      },
    );
    expect(r.totais.comissionavel).toBe(22000);
    expect(r.naoComissionaveis).toHaveLength(1);
    expect(r.naoComissionaveis[0].motivo).toBe("abaixo_minimo");
    expect(r.aliquotaAplicada).toBe(5); // 22k cai na faixa de 30k
  });

  it("modo faixas com tabela vazia cai no flat (alíquota fallback)", () => {
    const r = calcularComissao([cobrPaga(1, 5000)], {
      modo: "faixas",
      aliquotaPercent: 3,
      valorMinimo: 0,
      faixas: [],
    });
    expect(r.aliquotaAplicada).toBe(3);
    expect(r.totais.valorComissao).toBe(150);
    expect(r.faixaAplicada).toBeUndefined();
  });

  it("modo flat ignora faixas mesmo se passadas", () => {
    const r = calcularComissao([cobrPaga(1, 25000)], {
      modo: "flat",
      aliquotaPercent: 4,
      valorMinimo: 0,
      faixas: FAIXAS_BASE,
    });
    expect(r.aliquotaAplicada).toBe(4);
    expect(r.totais.valorComissao).toBe(1000);
    expect(r.faixaAplicada).toBeUndefined();
  });
});
