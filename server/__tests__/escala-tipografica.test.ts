/**
 * Trava a escala tipográfica nas telas já migradas.
 *
 * O problema que isto impede de voltar: a cor do JuridFlow virou sistema
 * (9.639 usos de token semântico, zero cor solta), mas o TAMANHO não — eram
 * 2.856 `text-[Npx]` escritos à mão em 33 valores distintos. E o que ficou no
 * menor deles era justamente o que mais importa: na lista de Processos, o
 * selo "2º grau?" e o PRAZO do cliente saíam em 9px. Uma única linha da lista
 * usava seis tamanhos diferentes (13 · 9 · 10,5 · 12 · 11,5 · 10px).
 *
 * Quem lê é advogado, lê o dia inteiro, e boa parte usa óculos. 9px num
 * monitor comum dá ~6,8pt — menor que a letra miúda de um contrato.
 *
 * Daí as duas regras abaixo, e o motivo de existir teste em vez de só
 * combinar: escala é o tipo de coisa que uma tela nova fura sem querer, e
 * `tsc` não enxerga classe de CSS. O projeto não tem ESLint (ver
 * `react-hooks-apos-return.test.ts` para o mesmo raciocínio).
 *
 * O escopo é a lista `TELAS_MIGRADAS` de propósito: as telas fora dela ainda
 * não foram migradas, e um teste que já nasce vermelho é um teste que alguém
 * desliga. Ao migrar uma tela nova, acrescente-a aqui — é essa linha que
 * transforma a migração em algo que não desanda.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..");

/** Telas cuja tipografia já saiu dos valores soltos. Cresce a cada fatia. */
const TELAS_MIGRADAS = [
  "client/src/pages/Processos.tsx",
  "client/src/pages/Clientes.tsx",
  "client/src/pages/Atendimento.tsx",
  "client/src/pages/Agenda.tsx",
  "client/src/pages/Kanban.tsx",
  "client/src/pages/Financeiro.tsx",
];

/** Os sete degraus declarados em `client/src/index.css`. */
const DEGRAUS = ["micro", "apoio", "corpo", "secao", "titulo", "numero", "pagina"];

const TAMANHO_SOLTO = /text-\[(\d+(?:\.\d+)?)px\]/g;

function ler(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

describe("escala tipográfica", () => {
  it("declara os sete degraus no index.css", () => {
    const css = ler("client/src/index.css");
    for (const degrau of DEGRAUS) {
      expect(css, `--text-${degrau} sumiu do @theme`).toMatch(
        new RegExp(`--text-${degrau}\\s*:`),
      );
    }
  });

  it("mantém o piso de 11px — nenhum degrau abaixo disso", () => {
    const css = ler("client/src/index.css");
    for (const degrau of DEGRAUS) {
      const m = css.match(new RegExp(`--text-${degrau}\\s*:\\s*([\\d.]+)px`));
      expect(m, `--text-${degrau} precisa estar declarado em px`).not.toBeNull();
      expect(
        Number(m![1]),
        `--text-${degrau} caiu para ${m![1]}px; o piso combinado é 11px`,
      ).toBeGreaterThanOrEqual(11);
    }
  });

  it.each(TELAS_MIGRADAS)("%s não volta a escrever tamanho na mão", (rel) => {
    const achados = [...ler(rel).matchAll(TAMANHO_SOLTO)].map((m) => m[0]);
    expect(
      achados,
      `use um degrau da escala (${DEGRAUS.map((d) => `text-${d}`).join(", ")}) ` +
        `em vez de tamanho solto. Encontrados: ${[...new Set(achados)].join(", ")}`,
    ).toEqual([]);
  });

  it("o selo e o prazo da lista de Processos continuam legíveis", () => {
    // Estes dois eram o caso que motivou a escala: o aviso de que o processo
    // subiu para recurso e o prazo do cliente, ambos em 9px. Se alguém
    // reescrever a linha, é aqui que aparece.
    const tela = ler("client/src/pages/Processos.tsx");
    const linhaDoSelo = tela
      .split("\n")
      .find((l) => l.includes("bg-warning-bg text-warning-fg") && l.includes("shrink-0"));
    expect(linhaDoSelo, 'o selo "2º grau?" da lista sumiu ou foi reescrito').toBeDefined();
    expect(linhaDoSelo).toContain("text-micro");
    // Caixa alta em 9px era a pior combinação possível: ilegível E mais larga
    // que a caixa normal (medido na Inter: "prazo vence hoje" encolhe 5,7px
    // trocando MAIÚSCULA por caixa normal, mesmo subindo a fonte).
    expect(linhaDoSelo, "o selo voltou para caixa alta").not.toContain("uppercase");
  });
});
