/**
 * Dinheiro e números em português do Brasil.
 *
 * Existe porque o mesmo valor aparecia de dois jeitos no sistema: o Dashboard
 * mostrava `R$ 10.700,00` e o Financeiro mostrava `R$ 10.7k` — com **ponto
 * decimal inglês**, num produto brasileiro. A causa era um `toFixed(1)`
 * (que sempre usa ponto) dentro de um `formatBRLShort` copiado idêntico em
 * `client/src/pages/financeiro/helpers.tsx` e
 * `client/src/pages/dashboards/common.tsx`.
 *
 * O `Intl` já sabe abreviar em pt-BR — "10,7 mil", "1,2 mi" — com a vírgula
 * certa. Não há motivo para dividir por 1000 na mão.
 *
 * Mora em `shared/` de propósito: o mesmo valor pode ser escrito na tela, no
 * PDF e no e-mail, e os três têm que dizer a mesma coisa.
 */

const CHEIO = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const CURTO = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** `1234.5` → `R$ 1.234,50`. A forma padrão; use esta salvo motivo contrário. */
export function moedaBR(valor: number): string {
  return CHEIO.format(Number.isFinite(valor) ? valor : 0);
}

/**
 * `10700` → `R$ 10,7 mil`. Só para onde o espaço é curto de verdade:
 * cartão de KPI, rótulo de eixo, cartão no celular.
 *
 * Abaixo de mil devolve o valor cheio — "R$ 840" abreviado não economiza
 * nada e ainda esconde os centavos.
 */
export function moedaCurtaBR(valor: number): string {
  const v = Number.isFinite(valor) ? valor : 0;
  return Math.abs(v) < 1000 ? CHEIO.format(v) : CURTO.format(v);
}

/** `1234.5` → `1.234,50`, sem o símbolo — para tabela que já tem coluna "R$". */
export function numeroBR(valor: number, casas = 2): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(Number.isFinite(valor) ? valor : 0);
}
