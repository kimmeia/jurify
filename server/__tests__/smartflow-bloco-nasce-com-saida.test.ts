/**
 * Bloco cujas saídas vêm da config precisa nascer com pelo menos uma.
 *
 * No canvas, esses blocos desenham um handle por item da config — logo, config
 * vazia = nenhuma bolinha na borda = nada de onde arrastar a seta. O
 * randomizador nascia com `opcoes: []` e ficava assim: parecia que arrastar
 * estava quebrado, quando na verdade não existia saída pra puxar.
 *
 * O typecheck não alcança isso (a saída é JSX condicional) e nenhum teste de
 * servidor tocava a criação de nó do editor.
 */

import { describe, expect, it } from "vitest";
import { configInicialPasso } from "../../shared/smartflow-types";

/** Passos cujo handle de saída é gerado a partir de um array na config. */
const SAIDA_VEM_DA_CONFIG: Array<{ tipo: string; chave: string; minimo: number }> = [
  { tipo: "randomizar", chave: "opcoes", minimo: 2 },
];

describe("configInicialPasso", () => {
  for (const { tipo, chave, minimo } of SAIDA_VEM_DA_CONFIG) {
    it(`${tipo} nasce com pelo menos ${minimo} saída(s)`, () => {
      const cfg = configInicialPasso(tipo);
      const itens = cfg[chave];
      expect(Array.isArray(itens), `${tipo}.${chave} deveria ser array`).toBe(true);
      expect((itens as unknown[]).length).toBeGreaterThanOrEqual(minimo);
    });

    it(`toda saída inicial de ${tipo} tem id — o handle é cond_<id>`, () => {
      const itens = configInicialPasso(tipo)[chave] as Array<{ id?: string }>;
      const semId = itens.filter((o) => !o.id || !o.id.trim());
      expect(semId, "sem id vira handle 'cond_undefined', duplicado entre as opções").toEqual([]);
      // Handle duplicado: o ReactFlow não distingue as saídas e a ligação erra o ramo.
      expect(new Set(itens.map((o) => o.id)).size).toBe(itens.length);
    });
  }

  it("distribuir_atendimento mantém o padrão 'todos do setor'", () => {
    expect(configInicialPasso("distribuir_atendimento")).toEqual({ modoDistribuicao: "todos" });
  });

  it("passo sem default nasce com config vazia", () => {
    expect(configInicialPasso("whatsapp_enviar")).toEqual({});
  });
});
