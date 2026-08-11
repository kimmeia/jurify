/**
 * O enum de tipos de passo no banco tem que caber tudo que o editor oferece.
 *
 * O `ensureTables` do auto-migrate roda um `MODIFY COLUMN tipoPasso ENUM(...)`
 * a TODO boot, enquanto as migrations de arquivo rodam uma vez só. Com a lista
 * escrita à mão nos dois lugares, cada tipo novo entrava pela migration e era
 * apagado no reboot seguinte: `whatsapp_pergunta_opcoes` e `randomizar` viraram
 * blocos que a paleta oferecia, o usuário montava, e o save estourava com o
 * erro cru do MySQL na tela.
 *
 * Nada pegava isso — o typecheck não vê SQL em template string, e o teste do
 * router usa DB de mentira, que aceita qualquer enum.
 */

import { describe, expect, it } from "vitest";
import { smartflowCenarios, smartflowPassos } from "../../drizzle/schema";
import { listaEnumSql } from "../_core/auto-migrate";
import { TIPO_PASSO_META, GATILHO_META } from "../../shared/smartflow-types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const enumPassos = smartflowPassos.tipo.enumValues as readonly string[];
const enumGatilhos = smartflowCenarios.gatilho.enumValues as readonly string[];

describe("paleta do editor cabe no enum do banco", () => {
  it("todo tipo de passo oferecido existe no enum de smartflow_passos", () => {
    const faltando = TIPO_PASSO_META.map((t) => t.id).filter((id) => !enumPassos.includes(id));
    expect(
      faltando,
      `tipos que o editor oferece e o banco recusa: ${faltando.join(", ")}`,
    ).toEqual([]);
  });

  it("todo gatilho oferecido existe no enum de smartflow_cenarios", () => {
    const faltando = GATILHO_META.map((g) => g.id).filter((id) => !enumGatilhos.includes(id));
    expect(
      faltando,
      `gatilhos que o editor oferece e o banco recusa: ${faltando.join(", ")}`,
    ).toEqual([]);
  });
});

describe("o MODIFY de todo boot não encolhe o enum", () => {
  /**
   * A regressão original: o ALTER do boot tinha lista própria, menor que a do
   * schema, e desfazia a migration. Sair do schema fecha esse buraco — este
   * teste existe pra que ninguém reintroduza uma lista literal ali.
   */
  it("a lista SQL sai do schema do drizzle, não de literal no auto-migrate", () => {
    const fonte = readFileSync(join(__dirname, "..", "_core", "auto-migrate.ts"), "utf-8");
    const modifies = fonte.match(/MODIFY COLUMN (?:tipoPasso|gatilhoSF) ENUM\([^)]*\)/g) ?? [];
    expect(modifies.length).toBe(2);
    for (const m of modifies) {
      expect(m, `enum literal de volta no auto-migrate: ${m.slice(0, 80)}…`).toContain("listaEnumSql(");
    }
  });

  it("listaEnumSql devolve os valores na ordem do schema", () => {
    const sql = listaEnumSql(enumPassos);
    expect(sql.startsWith(`'${enumPassos[0]}'`)).toBe(true);
    expect(sql.split(",")).toHaveLength(enumPassos.length);
    for (const valor of enumPassos) expect(sql).toContain(`'${valor}'`);
  });

  it("cobre os dois tipos que a lista literal tinha perdido", () => {
    const sql = listaEnumSql(enumPassos);
    expect(sql).toContain("'whatsapp_pergunta_opcoes'");
    expect(sql).toContain("'randomizar'");
  });
});
