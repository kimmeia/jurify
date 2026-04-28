import { describe, expect, it } from "vitest";
import {
  calcularComissao,
  classificarCobranca,
  type CobrancaParaComissao,
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
