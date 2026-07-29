/**
 * Regressão — relatório de comissão resolve o nome do cliente via
 * COALESCE(contatoBeneficiarioId, contatoId), igual dashboard/relatórios
 * comerciais.
 *
 * Bug protegido: o join era só por `contatoId`; cobrança de "pagamento de
 * terceiro" (contatoId=NULL + contatoBeneficiarioId preenchido) saía no PDF
 * sem nome — a descrição ("Cobrança gerada automaticamente a partir de Pix
 * recebido...") posava de cliente. Ela também não aparece na fila de órfãs
 * (que exige AMBOS null), então o operador não tinha como "consertar".
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(__dirname, "..", "escritorio", "db-comissoes.ts"),
  "utf8",
);

describe("db-comissoes — nome do cliente com beneficiário", () => {
  it("join de contatos usa COALESCE(beneficiário, pagador)", () => {
    expect(src).toMatch(
      /COALESCE\(\s*\$\{asaasCobrancas\.contatoBeneficiarioId\}\s*,\s*\$\{asaasCobrancas\.contatoId\}\s*\)/,
    );
  });

  it("não voltou o join simples por contatoId", () => {
    expect(src).not.toMatch(
      /leftJoin\(\s*contatos\s*,\s*eq\(\s*contatos\.id\s*,\s*asaasCobrancas\.contatoId\s*\)\s*\)/,
    );
  });
});
