/**
 * Pacote de 3 planos (proposta v2, "pode fazer" do dono em 09/09/2026):
 * Atende R$ 147 · Escritório R$ 297 · Escala R$ 597, com Atendimento em
 * todos, anual = 10× o mensal, 14 dias de teste. Tudo é dado do catálogo —
 * a vitrine, a tela "Meu plano", os limites e os créditos leem a tabela.
 *
 * O que fica travado: os números aprovados na migration, módulos válidos,
 * um só "mais popular", os planos de Monitoramento só ESCONDIDOS (nunca
 * apagados) e o Completo virando "Sob medida" ainda sob consulta.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ehModuloValido } from "../../shared/modulos-app";
import { cotaMensalDoPlano } from "../billing/escritorio-creditos";

const raiz = join(__dirname, "..", "..");
const mig = readFileSync(join(raiz, "drizzle/0217_pacote_3_planos.sql"), "utf8");

/** A tupla de VALUES de um plano, do slug até o `ordem`. */
function tuplaDe(slug: string): string {
  const i = mig.indexOf(`'${slug}', `);
  expect(i, `plano ${slug} não está na migration`).toBeGreaterThan(-1);
  const fim = mig.indexOf("\n)", i);
  return mig.slice(i, fim);
}

const numerosDe = (slug: string) => {
  // Linha numérica: mensal, anual, trial, usuários, MB, clientes, whatsapp, IA, processos, cpf, cálculos, jurisia
  const linha = tuplaDe(slug).split("\n").find((l) => /^\s+\d+, \d+, 14,/.test(l))!;
  expect(linha, `${slug}: linha de limites`).toBeTruthy();
  return linha.trim().replace(/,$/, "").split(",").map((x) => x.trim());
};

describe("migration 0217 — os três planos como aprovados", () => {
  it.each([
    ["atende", ["14700", "147000", "14", "2", "2048", "NULL", "1", "1", "300", "15", "20", "0"]],
    ["escritorio", ["29700", "297000", "14", "5", "10240", "NULL", "2", "3", "1000", "50", "100", "0"]],
    ["escala", ["59700", "597000", "14", "15", "51200", "NULL", "5", "10", "2500", "150", "300", "200"]],
  ])("%s: preço, anual, teste, usuários, GB, WhatsApp, IA, processos, CPFs, cálculos, JurisIA", (slug, esperado) => {
    expect(numerosDe(slug)).toEqual(esperado);
  });

  it("anual é 10× o mensal (2 meses grátis) em todos", () => {
    for (const slug of ["atende", "escritorio", "escala"]) {
      const [mensal, anual] = numerosDe(slug).map(Number);
      expect(anual, slug).toBe(mensal * 10);
    }
  });

  it("todo módulo citado existe no catálogo, e Atendimento está nos três", () => {
    for (const slug of ["atende", "escritorio", "escala"]) {
      const t = tuplaDe(slug);
      const cesta = t.match(/JSON_ARRAY\(((?:'[a-z_]+',?)+)\)/)![1].match(/'([a-z_]+)'/g)!.map((x) => x.slice(1, -1));
      for (const m of cesta) expect(ehModuloValido(m), `${slug}: módulo desconhecido ${m}`).toBe(true);
      expect(cesta, slug).toContain("atendimento");
      expect(cesta, slug).toContain("agentes_ia");
      expect(cesta, slug).toContain("processos");
    }
    expect(tuplaDe("escritorio")).toContain("'financeiro'");
    expect(tuplaDe("escala")).toContain("'jurisia'");
    expect(tuplaDe("atende")).not.toContain("'financeiro'");
  });

  it("o cartão diz que novas ações cobrem o TJCE por enquanto (decisão 4)", () => {
    for (const slug of ["atende", "escritorio", "escala"]) {
      expect(tuplaDe(slug)).toContain("novas ações: TJCE por enquanto");
    }
  });

  it("os créditos que cada plano financia batem com a fórmula do catálogo", () => {
    // O mockup prometeu 845 / 2.850 / 7.550 — é o que `cotaMensalDoPlano`
    // devolve pros limites acima (cálculos + processos×2 + CPFs×15).
    const cota = (calc: number, proc: number, cpf: number) =>
      cotaMensalDoPlano({ creditosCalculosMes: calc, maxMonitoramentosProcessos: proc, maxMonitoramentosCpf: cpf } as any);
    expect(cota(20, 300, 15)).toBe(845);
    expect(cota(100, 1000, 50)).toBe(2850);
    expect(cota(300, 2500, 150)).toBe(7550);
  });

  it("um selo só: popular vai pro Escritório e sai dos outros", () => {
    expect(tuplaDe("escritorio")).toMatch(/FALSE, FALSE, TRUE, FALSE, 2\s*$/);
    expect(tuplaDe("atende")).toMatch(/FALSE, FALSE, FALSE, FALSE, 1\s*$/);
    expect(tuplaDe("escala")).toMatch(/FALSE, FALSE, FALSE, FALSE, 3\s*$/);
    expect(mig).toContain("UPDATE planos SET popular = FALSE WHERE slug <> 'escritorio';");
  });

  it("Monitoramento sai da vitrine escondido, nunca apagado", () => {
    expect(mig).toContain("UPDATE planos SET oculto = TRUE WHERE slug IN ('monitoramento-essencial','monitoramento-profissional');");
    expect(mig).not.toMatch(/DELETE\s+FROM/i);
    expect(mig).not.toMatch(/DROP\s/i);
  });

  it("Completo vira “Sob medida”: continua sob consulta, com demonstração, na 4ª posição", () => {
    const i = mig.indexOf("nome = 'Sob medida'");
    expect(i).toBeGreaterThan(-1);
    const trecho = mig.slice(i, mig.indexOf("WHERE slug = 'completo'", i));
    expect(trecho).toContain("preco_sob_consulta = TRUE");
    expect(trecho).toContain("cta_demonstracao = TRUE");
    expect(trecho).toContain("ordem = 4");
    expect(trecho).toContain("oculto = FALSE");
    // O preço mensal do Completo não é tocado: a fatura de quem já assina lê esse número.
    expect(trecho).not.toContain("preco_mensal_centavos");
  });

  it("nenhum texto carrega ponto-e-vírgula ou apóstrofo solto (o aplicador divide por “;” e a string por “'”)", () => {
    const strings = mig.match(/'[^'\n]*'/g) ?? [];
    for (const s of strings) expect(s, s).not.toContain(";");
    // Cada linha de texto tem número par de aspas simples (nenhum apóstrofo dentro).
    for (const linha of mig.split("\n")) {
      const aspas = (linha.match(/'/g) ?? []).length;
      expect(aspas % 2, `aspas ímpares em: ${linha}`).toBe(0);
    }
  });
});
