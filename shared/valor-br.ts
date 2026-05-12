/**
 * Normalização de valores monetários em formato BR.
 *
 * O usuário digita valores em formato brasileiro ("1.500,00", "R$ 3.000",
 * "3.000,00") e historicamente o sistema gravava a string crua no banco
 * (`leads.valorEstimado`, `asaas_cobrancas.valor` quando manual, etc).
 * Na hora de somar via `CAST(... AS DECIMAL)` no MySQL, o cast segue
 * convenção US (ponto = decimal): `CAST('3.000' AS DECIMAL)` retorna
 * `3.00` em vez de `3000.00`, distorcendo relatórios.
 *
 * Este módulo normaliza qualquer entrada do operador pra string em
 * formato US (`"3000.00"`) ANTES de gravar, e parseia tanto formato US
 * quanto BR ao LER — pra lidar com dados legacy do banco que ainda
 * estão no formato antigo.
 *
 * Heurística de disambiguação quando há apenas 1 ponto e sem vírgula:
 *  - ponto seguido de exatamente 3 dígitos no final → formato BR milhar
 *    (ex: "3.000" → 3000)
 *  - ponto seguido de 1, 2 ou 4+ dígitos → formato US decimal
 *    (ex: "3.5" → 3.5; "3.00" → 3.00; "3.0000" → 3.0)
 *
 * Quando há vírgula OU múltiplos pontos: assume BR (vírgula = decimal,
 * pontos = milhares).
 */

/**
 * Converte qualquer entrada de valor (formato BR ou US) em string US
 * com 2 casas decimais — pronta pra gravar como `varchar` e ser somada
 * via `CAST(... AS DECIMAL)`.
 *
 * Retorna `null` quando a entrada é vazia, nula ou não-parseável.
 */
export function normalizarValorBR(input: string | number | null | undefined): string | null {
  if (input == null) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return input.toFixed(2);
  }
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  if (!s) return null;

  const hasComma = s.includes(",");
  const dotCount = (s.match(/\./g) || []).length;

  if (hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (dotCount >= 2) {
    s = s.replace(/\./g, "");
  } else if (dotCount === 1) {
    const [int, frac] = s.split(".");
    if (frac.length === 3 && /^\d+$/.test(int) && /^\d+$/.test(frac)) {
      s = int + frac;
    }
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/**
 * Parseia valor (BR ou US) pra `number`. Aceita os mesmos formatos que
 * `normalizarValorBR` e mais. Útil pra leitura defensiva no client
 * quando o dado pode estar em formato legacy no banco.
 */
export function parseValorBR(input: string | number | null | undefined): number {
  const norm = normalizarValorBR(input);
  if (norm === null) return 0;
  const n = Number(norm);
  return Number.isFinite(n) ? n : 0;
}
