/**
 * Travas do catálogo de invariantes.
 *
 * Duas famílias de teste aqui, com motivos diferentes:
 *
 *  - **Contrato do catálogo** (ids únicos, campos preenchidos, ordenação).
 *    Barato e pega erro de digitação em regra nova.
 *
 *  - **Read-only e shadow mode**, por varredura de texto. O robô lê o banco
 *    de produção; a garantia de que ele não escreve não pode depender de
 *    alguém lembrar da regra na revisão. A varredura é grosseira de
 *    propósito: qualquer verbo de escrita no módulo derruba o teste, e
 *    quem realmente precisar escrever vai ter que mexer aqui — que é o
 *    ponto, escrever no banco vira decisão explícita.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listarRegras, REGRAS } from "./regras";
import { ORDEM_SEVERIDADE } from "./tipos";

const DIR = __dirname;

describe("catálogo de invariantes", () => {
  it("não repete id de regra", () => {
    const ids = REGRAS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("usa id no formato PREFIXO-NN", () => {
    for (const r of REGRAS) {
      expect(r.id, `id fora do padrão: ${r.id}`).toMatch(/^[A-Z]{3,4}-\d{2}$/);
    }
  });

  it("descreve invariante e correção prevista em toda regra", () => {
    for (const r of REGRAS) {
      expect(r.invariante.length, `${r.id} sem invariante`).toBeGreaterThan(20);
      expect(r.correcaoPrevista.length, `${r.id} sem correção prevista`).toBeGreaterThan(20);
      expect(r.titulo.length, `${r.id} sem título`).toBeGreaterThan(5);
      expect(r.tabela, `${r.id} sem tabela`).toBeTruthy();
    }
  });

  it("nasce toda regra em shadow mode", () => {
    // Promover regra é ato deliberado: exige histórico limpo e mudança de
    // código revisada. Regra nova entrando já autorizada a corrigir é
    // exatamente o que a fase 1 existe pra impedir.
    const promovidas = REGRAS.filter((r) => !r.shadow).map((r) => r.id);
    expect(promovidas).toEqual([]);
  });

  it("só marca nível A onde a correção é recálculo de valor derivado", () => {
    // Nível A é a única classe que o robô poderá corrigir sozinho no futuro.
    // A lista é curta de propósito e mudar ela é decisão de arquitetura.
    const nivelA = REGRAS.filter((r) => r.nivel === "A").map((r) => r.id).sort();
    expect(nivelA).toEqual(["CRED-01", "INT-02"]);
  });

  it("mantém dinheiro e vínculo entre escritórios fora de qualquer automação", () => {
    const porId = new Map(REGRAS.map((r) => [r.id, r]));
    expect(porId.get("COM-01")?.nivel).toBe("C");
    expect(porId.get("TEN-01")?.nivel).toBe("C");
  });

  it("listarRegras ordena por severidade e não vaza a função de detecção", () => {
    const metas = listarRegras();
    expect(metas.length).toBe(REGRAS.length);

    for (const m of metas) {
      expect(m).not.toHaveProperty("detectar");
    }

    const pesos = metas.map((m) => ORDEM_SEVERIDADE[m.severidade]);
    expect([...pesos].sort((a, b) => a - b)).toEqual(pesos);
  });
});

describe("robô auditor é read-only na fase 1", () => {
  const VERBOS_ESCRITA = [
    ".insert(",
    ".update(",
    ".delete(",
    ".execute(",
    "db.transaction(",
  ];

  for (const arquivo of ["regras.ts", "executor.ts", "cron-varredura.ts"]) {
    it(`${arquivo} não contém verbo de escrita no banco`, () => {
      const fonte = readFileSync(join(DIR, arquivo), "utf8");
      for (const verbo of VERBOS_ESCRITA) {
        expect(fonte.includes(verbo), `${arquivo} usa ${verbo}`).toBe(false);
      }
    });
  }

  it("o histórico só escreve na tabela do próprio robô", () => {
    // `historico.ts` é a única exceção ao read-only: ele grava o resultado
    // da varredura. A exceção continua estreita enquanto ele não tocar em
    // tabela de negócio — que é o que este teste mede.
    const fonte = readFileSync(join(DIR, "historico.ts"), "utf8");
    const alvos = [...fonte.matchAll(/\.(?:insert|update|delete)\(\s*(\w+)/g)].map((m) => m[1]);

    expect(alvos.length, "historico.ts deveria escrever em algo").toBeGreaterThan(0);
    for (const alvo of alvos) {
      expect(alvo, `historico.ts escreve em ${alvo}`).toBe("roboAuditorVarreduras");
    }
  });

  it("o router do robô não expõe procedure de correção", () => {
    const fonte = readFileSync(join(DIR, "..", "router-admin-auditoria-robo.ts"), "utf8");
    // O que protege o banco em shadow mode é não existir caminho de escrita
    // — não a UI escondendo o botão.
    expect(fonte).not.toMatch(/^\s*(corrigir|aplicar|desfazer)\s*:/m);
  });
});
