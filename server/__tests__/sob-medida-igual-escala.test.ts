/**
 * "Sob medida" (slug completo) prometia "Tudo do Escala, e mais" e entregava
 * menos: a 0217 só trocou nome e textos, e os limites ficaram na seed 0108.
 * A 0226 iguala cada limite ao maior entre o atual e o do Escala, sem nunca
 * criar restrição nova (NULL = ilimitado e, nos tetos mensais, 0 = sem limite
 * são preservados) e sem tocar em preço, textos, ordem ou usuários.
 *
 * Os números do Escala são lidos da PRÓPRIA 0217, não digitados aqui: se a
 * 0226 esquecer um deles, ou usar outro valor, este teste acusa.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const mig = readFileSync(join(raiz, "drizzle/0226_sob_medida_igual_escala.sql"), "utf8");
const seed = readFileSync(join(raiz, "drizzle/0217_pacote_3_planos.sql"), "utf8");
const tetos = readFileSync(join(raiz, "drizzle/0221_limites_uso_mensal.sql"), "utf8");

/** Só os UPDATEs da migration, sem os comentários — para os asserts negativos. */
const soSql = mig
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

function escalaNa0217() {
  const i = seed.indexOf("'escala', 'Escala'");
  expect(i).toBeGreaterThan(-1);
  const linha = seed
    .slice(i)
    .split("\n")
    .find((l) => /^\s+\d+, \d+, 14,/.test(l))!;
  // mensal, anual, trial, usuários, MB, clientes, whatsapp, IA, processos, cpf, cálculos, jurisia
  const n = linha.trim().replace(/,$/, "").split(",").map((x) => x.trim());
  return { whatsapp: n[6], ia: n[7], processos: n[8], cpf: n[9], calculos: n[10], jurisia: n[11] };
}

function tetosDoEscalaNa0221() {
  const m = tetos.match(
    /max_consultas_processo_mes = (\d+),\s*max_buscas_documento_mes = (\d+),\s*max_resumos_ia_mes = (\d+)\s+WHERE slug = 'escala'/,
  );
  expect(m, "0221 não tem a linha do escala").toBeTruthy();
  return { consultas: m![1], buscas: m![2], resumos: m![3] };
}

function modulosDoEscalaNa0217(): string[] {
  const i = seed.indexOf("'escala', 'Escala'");
  const bloco = seed.slice(i, seed.indexOf("\n)", i));
  const m = bloco.match(/JSON_ARRAY\(([^)]*)\)/)!;
  return m[1].split(",").map((x) => x.trim().replace(/^'|'$/g, ""));
}

describe("migration 0226 — Sob medida entrega pelo menos o que o Escala entrega", () => {
  const e = escalaNa0217();
  const t = tetosDoEscalaNa0221();

  it("só mexe no plano completo (Sob medida)", () => {
    const wheres = soSql.match(/WHERE slug = '([a-z_-]+)'/g) ?? [];
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres) expect(w).toBe("WHERE slug = 'completo'");
  });

  it.each([
    ["max_conexoes_whatsapp", e.whatsapp],
    ["max_agentes_ia", e.ia],
    ["creditos_calculos_mes", e.calculos],
    ["jurisia_mensagens_mes", e.jurisia],
  ])("%s vira o maior entre o atual e o do Escala (%s)", (coluna, valor) => {
    expect(soSql).toContain(`${coluna} = GREATEST(${coluna}, ${valor})`);
  });

  it.each([
    ["max_monitoramentos_processos", e.processos],
    ["max_monitoramentos_cpf", e.cpf],
  ])("%s preserva NULL (ilimitado) e sobe até %s", (coluna, valor) => {
    expect(soSql).toContain(
      `${coluna} = CASE WHEN ${coluna} IS NULL THEN NULL ELSE GREATEST(${coluna}, ${valor}) END`,
    );
  });

  it.each([
    ["max_consultas_processo_mes", t.consultas],
    ["max_buscas_documento_mes", t.buscas],
    ["max_resumos_ia_mes", t.resumos],
  ])("%s preserva NULL e 0 (sem limite) e sobe até %s", (coluna, valor) => {
    expect(soSql).toContain(
      `${coluna} = CASE WHEN ${coluna} IS NULL OR ${coluna} = 0 THEN ${coluna} ELSE GREATEST(${coluna}, ${valor}) END`,
    );
  });

  it("JurisIA sai da cota 0 (módulo desligado) para a cota do Escala", () => {
    expect(Number(e.jurisia)).toBeGreaterThan(0);
    expect(soSql).toContain(`jurisia_mensagens_mes = GREATEST(jurisia_mensagens_mes, ${e.jurisia})`);
  });

  it("todo módulo da cesta do Escala entra na do Sob medida sem duplicar", () => {
    const modulos = modulosDoEscalaNa0217();
    expect(modulos.length).toBeGreaterThanOrEqual(15);
    for (const m of modulos) {
      expect(soSql).toContain(
        `IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('${m}')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', '${m}'))`,
      );
    }
  });

  it("não toca em preço, textos, ordem, usuários, armazenamento nem visibilidade", () => {
    for (const proibida of [
      "preco_mensal_centavos",
      "preco_anual_centavos",
      "preco_sob_consulta",
      "oculto",
      "ordem",
      "nome",
      "descricao",
      "features",
      "max_usuarios",
      "max_armazenamento_mb",
      "popular",
    ]) {
      expect(soSql, `a 0226 não pode mexer em ${proibida}`).not.toMatch(new RegExp(`\\b${proibida}\\s*=`));
    }
  });

  it("nunca reduz um limite: só GREATEST ou preservação", () => {
    const sets = soSql.match(/^\s+(\w+) = (.+?),?$/gm) ?? [];
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) {
      expect(s.includes("GREATEST(") || s.includes("THEN NULL") || s.includes("THEN max_")).toBe(true);
    }
  });
});
