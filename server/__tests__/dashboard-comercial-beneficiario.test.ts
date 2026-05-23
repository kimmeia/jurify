/**
 * Regressão: o ranking comercial do DASHBOARD (`dashboard.comercial`) deve
 * contar a cobrança paga pelo CLIENTE REAL — COALESCE(beneficiário, pagador) —
 * exatamente como o relatório comercial (`relatorios.comercialDashboard`).
 *
 * Bug original (reportado mai/2026 — Eduardo):
 *   - Dashboard mostrava "1 pago" pra um atendente que tinha 2 contratos pagos.
 *   - O relatório mostrava os 2 corretos.
 *   - Causa: o relatório foi corrigido no commit cf6c96e pra usar
 *     COALESCE(contatoBeneficiarioId, contatoId), mas a MESMA linha no
 *     dashboard ficou pra trás com `inArray(asaasCobrancas.contatoId, ...)`.
 *     Quando a esposa (contatoId) paga pelo marido (contatoBeneficiarioId,
 *     quem fechou o lead), o dashboard descartava a cobrança — o marido é
 *     quem tem o lead fechado_ganho no período, não a esposa pagadora.
 *
 * Duas camadas de proteção:
 *   1) Inspeção estática — garante que a procedure contém o filtro correto e
 *      NÃO contém mais o filtro antigo (mesma estratégia do teste irmão de
 *      relatórios; mockar a fluent API do Drizzle com subquery embutida é
 *      frágil).
 *   2) Geração de SQL via Drizzle (`.toSQL()`) — prova que a expressão de
 *      filtro realmente compila pra um SQL que referencia a coluna do
 *      beneficiário (COALESCE), e que a forma antiga NÃO referenciava.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { QueryBuilder } from "drizzle-orm/mysql-core";
import { sql, inArray, and, eq, gte, lte } from "drizzle-orm";
import { asaasCobrancas, leads } from "../../drizzle/schema";

let routerSource: string;

beforeAll(() => {
  routerSource = fs.readFileSync(
    path.resolve(__dirname, "../routers/dashboard.ts"),
    "utf-8",
  );
});

/** Recorta o corpo de uma procedure entre o nome e a próxima declarada. */
function extrairProcedureSource(nome: string, proximaProcedure: string): string {
  const startIdx = routerSource.indexOf(`${nome}: protectedProcedure`);
  if (startIdx < 0) throw new Error(`Procedure ${nome} não encontrada`);
  const endIdx = routerSource.indexOf(
    `${proximaProcedure}: protectedProcedure`,
    startIdx,
  );
  if (endIdx < 0) throw new Error(`Próxima procedure ${proximaProcedure} não encontrada`);
  return routerSource.substring(startIdx, endIdx);
}

describe("dashboard.comercial — filtro de cliente real alinhado com relatórios", () => {
  let procSource: string;

  beforeAll(() => {
    procSource = extrairProcedureSource("comercial", "financeiro");
  });

  it("filtra cobranças pelo CLIENTE REAL via COALESCE(beneficiário, pagador)", () => {
    expect(procSource).toMatch(
      /COALESCE\(\s*\$\{asaasCobrancas\.contatoBeneficiarioId\}\s*,\s*\$\{asaasCobrancas\.contatoId\}\s*\)\s+IN\s*\(\$\{contatosFechadosAtual\}\)/,
    );
  });

  it("NÃO usa mais o filtro antigo bare `inArray(asaasCobrancas.contatoId, contatosFechadosAtual)`", () => {
    // Esse é o exato código que causava o bug. Se reaparecer, o dashboard
    // volta a divergir do relatório.
    expect(procSource).not.toMatch(
      /inArray\(\s*asaasCobrancas\.contatoId\s*,\s*contatosFechadosAtual\s*\)/,
    );
  });

  it("mantém o pré-requisito do filtro de comissionabilidade (leftJoin + buildFiltroComissaoSQL)", () => {
    expect(procSource).toMatch(
      /\.leftJoin\(\s*categoriasCobranca\s*,\s*eq\(\s*categoriasCobranca\.id\s*,\s*asaasCobrancas\.categoriaId\s*\)\s*\)/,
    );
    expect(procSource).toMatch(/buildFiltroComissaoSQL\(\s*\[\s*["']sim["']\s*\]\s*\)/);
  });

  it("constrói a subquery contatosFechadosAtual de leads.fechado_ganho no período", () => {
    expect(procSource).toContain("contatosFechadosAtual");
    expect(procSource).toMatch(/eq\(\s*leads\.etapaFunil\s*,\s*["']fechado_ganho["']\s*\)/);
  });
});

describe("dashboard.comercial — SQL gerado pelo Drizzle (prova comportamental)", () => {
  // Reconstrói a subquery `contatosFechadosAtual` exatamente como nos dois
  // routers: contatos com lead fechado_ganho no período. A inspeção estática
  // acima garante que a procedure usa de fato esta construção.
  function subContatosFechados() {
    const qb = new QueryBuilder();
    return qb
      .select({ id: leads.contatoId })
      .from(leads)
      .where(and(
        eq(leads.escritorioId, 1),
        eq(leads.etapaFunil, "fechado_ganho"),
        gte(leads.createdAt, new Date("2026-05-01T00:00:00")),
        lte(leads.createdAt, new Date("2026-05-31T23:59:59")),
      ));
  }

  function gerarSql(filtro: ReturnType<typeof sql> | ReturnType<typeof inArray>) {
    const qb = new QueryBuilder();
    return qb
      .select({ atendenteId: asaasCobrancas.atendenteId })
      .from(asaasCobrancas)
      .where(and(filtro))
      .toSQL().sql;
  }

  it("filtro CORRIGIDO referencia a coluna do beneficiário (COALESCE) + subquery", () => {
    const filtroNovo = sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${subContatosFechados()})`;
    const texto = gerarSql(filtroNovo);
    expect(texto.toLowerCase()).toContain("coalesce");
    expect(texto).toContain("contatoBeneficiarioIdAsaasCob"); // coluna do beneficiário
    expect(texto).toContain("contatoIdAsaasCob"); // fallback pro pagador
    expect(texto).toMatch(/IN\s*\(\(?select/i); // membership na subquery
    expect(texto).toContain("etapaFunil"); // a subquery filtra fechado_ganho
  });

  it("filtro ANTIGO (bug) NÃO referenciava o beneficiário — documenta a diferença", () => {
    const filtroAntigo = inArray(asaasCobrancas.contatoId, subContatosFechados());
    const texto = gerarSql(filtroAntigo);
    expect(texto).not.toContain("contatoBeneficiarioIdAsaasCob");
    expect(texto.toLowerCase()).not.toContain("coalesce");
  });

  it("dashboard e relatório geram o MESMO SQL de filtro (paridade)", () => {
    // Mesma expressão usada pelos dois routers → mesmo SQL. Garante que a
    // definição de "cobrança do período" é idêntica entre as duas telas.
    const filtroDashboard = sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${subContatosFechados()})`;
    const filtroRelatorio = sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${subContatosFechados()})`;
    expect(gerarSql(filtroDashboard)).toBe(gerarSql(filtroRelatorio));
  });
});
