/**
 * Regressão: o drill-down (`detalheAtendenteComercial`) DEVE aplicar os
 * MESMOS filtros do card "Recebido" do ranking comercial (`comercialDashboard`).
 *
 * Bug original (reportado pela Beatriz, mai/2026):
 *   - Card ranking mostrava R$ 3.500 de "Recebido".
 *   - Drawer ao clicar mostrava soma de R$ 6.000 nos clientes.
 *   - Diferença: drawer não filtrava por (1) cobrança comissionável e
 *     (2) cliente com lead fechado_ganho no mesmo período.
 *
 * Por que inspeção estática? Mockar a fluent API do Drizzle (with subqueries
 * embutidas em `sql\`... IN (\${subquery})\``) é frágil e o resultado do teste
 * fica preso a detalhes do ORM. A invariante aqui é estrutural — certos
 * pedaços de código TÊM que estar presentes dentro do corpo da procedure.
 *
 * Se alguém remover qualquer um dos filtros num refactor futuro, algum
 * desses checks quebra.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

let routerSource: string;

beforeAll(() => {
  routerSource = fs.readFileSync(
    path.resolve(__dirname, "../escritorio/router-relatorios.ts"),
    "utf-8",
  );
});

/** Recorta o corpo de uma procedure entre o nome e a próxima `:` no mesmo nível.
 *  Heurística simples mas suficiente — as procedures do router começam com
 *  `<nome>: protectedProcedure` e o limite é a próxima procedure declarada. */
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

describe("detalheAtendenteComercial — filtros alinhados com ranking comercial", () => {
  let procSource: string;

  beforeAll(() => {
    procSource = extrairProcedureSource("detalheAtendenteComercial", "producao");
  });

  it("aplica buildFiltroComissaoSQL(['sim']) na query de cobranças (filtro de comissionabilidade)", () => {
    // Bug original: sem esse filtro, cobranças não-comissionáveis (ex: custas
    // judiciais) entravam no Recebido do drawer mas NÃO no card do ranking.
    expect(procSource).toMatch(/buildFiltroComissaoSQL\(\s*\[\s*["']sim["']\s*\]\s*\)/);
  });

  it("faz leftJoin com categoriasCobranca (pré-requisito do filtro de comissionabilidade)", () => {
    // buildFiltroComissaoSQL referencia categoriasCobranca.comissionavel —
    // sem o JOIN, a SQL gerada quebra ou ignora a flag de categoria.
    expect(procSource).toMatch(
      /\.leftJoin\(\s*categoriasCobranca\s*,\s*eq\(\s*categoriasCobranca\.id\s*,\s*asaasCobrancas\.categoriaId\s*\)\s*\)/,
    );
  });

  it("constrói subquery contatosFechadosAtual de leads.etapaFunil='fechado_ganho'", () => {
    // Cliente real (COALESCE beneficiário/pagador) precisa ter um lead
    // fechado_ganho no MESMO período pra a cobrança contar como "venda
    // do período". Cliente antigo que paga agora fica fora da meta corrente.
    expect(procSource).toContain("contatosFechadosAtual");
    expect(procSource).toMatch(/eq\(\s*leads\.etapaFunil\s*,\s*["']fechado_ganho["']\s*\)/);
  });

  it("usa contatosFechadosAtual no IN da query de cobranças", () => {
    // Sem o IN, a subquery é construída mas não filtra nada — sintoma do
    // bug que esse teste protege contra reintrodução.
    expect(procSource).toMatch(/IN\s*\(\$\{contatosFechadosAtual\}\)/);
  });

  it("agrupa cliente real via COALESCE(beneficiário, pagador)", () => {
    // Caso "esposa paga marido": cobrança paga por Maria com beneficiário
    // Carlos deve agrupar em Carlos. Sem o COALESCE, Maria apareceria como
    // outro cliente no drawer.
    expect(procSource).toMatch(
      /COALESCE\(\s*\$\{asaasCobrancas\.contatoBeneficiarioId\}\s*,\s*\$\{asaasCobrancas\.contatoId\}\s*\)/,
    );
  });
});

describe("comercialDashboard — invariância (não pode regredir)", () => {
  let procSource: string;

  beforeAll(() => {
    procSource = extrairProcedureSource("comercialDashboard", "detalheAtendenteComercial");
  });

  it("continua aplicando buildFiltroComissaoSQL(['sim']) em todas as queries de cobranças", () => {
    // O router faz a mesma operação em vários pontos: KPI agregado atual,
    // KPI agregado anterior, ranking por atendente e cobranças por dia.
    // Esperamos pelo menos 4 chamadas (uma por bloco de cobranças).
    const matches = procSource.match(/buildFiltroComissaoSQL\(\s*\[\s*["']sim["']\s*\]\s*\)/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("continua filtrando cobranças por cliente com lead fechado no período (contatosFechadosAtual + Ant)", () => {
    // 3 usos do `contatosFechadosAtual` (KPI atual, ranking, cobranças/dia)
    // e 1 uso do `contatosFechadosAnt` (KPI período anterior) — totalizando
    // 4 IN-clauses de filtro de cliente-com-lead-no-período.
    expect(procSource).toContain("contatosFechadosAtual");
    expect(procSource).toContain("contatosFechadosAnt");
    const matchesAtual = procSource.match(/IN\s*\(\$\{contatosFechadosAtual\}\)/g);
    const matchesAnt = procSource.match(/IN\s*\(\$\{contatosFechadosAnt\}\)/g);
    const totalIns = (matchesAtual?.length ?? 0) + (matchesAnt?.length ?? 0);
    expect(totalIns).toBeGreaterThanOrEqual(4);
  });
});

describe("Status do cliente no drill-down — semântica de combinação", () => {
  /**
   * A semântica de status é parte do contrato do drawer e usada pelo front
   * (badge de cor + texto). Re-implementamos a lógica aqui pra travar a
   * regra sem precisar rodar a procedure.
   */
  function statusDoCliente(valorFechado: number, valorRecebido: number) {
    if (valorFechado === 0 && valorRecebido > 0) return "so_pago" as const;
    if (valorRecebido === 0) return "aguardando" as const;
    if (valorRecebido + 0.01 >= valorFechado) return "pago" as const;
    return "parcial" as const;
  }

  it("cliente com fechado mas sem cobrança → 'aguardando'", () => {
    expect(statusDoCliente(5000, 0)).toBe("aguardando");
  });

  it("cliente com cobrança mas sem lead fechado próprio → 'so_pago'", () => {
    expect(statusDoCliente(0, 1500)).toBe("so_pago");
  });

  it("pagamento parcial < fechado → 'parcial'", () => {
    expect(statusDoCliente(5000, 3000)).toBe("parcial");
  });

  it("pagamento exato → 'pago'", () => {
    expect(statusDoCliente(5000, 5000)).toBe("pago");
  });

  it("pagamento ligeiramente acima do fechado (arred. centavos) → 'pago'", () => {
    // Margem de 1 centavo protege contra arredondamento — 5000.00 vs 5000.005
    expect(statusDoCliente(5000, 5000.005)).toBe("pago");
  });

  it("zero fechado e zero recebido → 'aguardando'", () => {
    expect(statusDoCliente(0, 0)).toBe("aguardando");
  });
});
