import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Cor de tela sai do tema, não da classe crua do Tailwind.
 *
 * O que motivou: trocar a paleta no `index.css` mudava o Dashboard e não mudava
 * Processos. Motivo medido — 10.551 classes de cor cravadas no client (905 só
 * em Processos, quase nenhuma no Dashboard). O tema não mandava nas telas que o
 * dono usa todo dia, e três rodadas de ajuste de cor não apareceram por isso.
 *
 * Com token, a troca de paleta é uma linha. Sem ele, é uma varredura de 182
 * arquivos — e é justamente essa varredura que ninguém repete.
 *
 * Vale também pro par claro/escuro escrito à mão: `bg-rose-50 dark:bg-rose-950`
 * é `bg-danger-bg`, e a versão em token não tem como esquecer um dos lados.
 */

const raiz = join(__dirname, "..", "..");

function tsxDoClient(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...tsxDoClient(caminho));
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
}

const PALETA =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|" +
  "teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTIL =
  "bg|text|border-[lrtbxy]|border|ring-offset|ring|fill|stroke|divide|" +
  "from|to|via|outline|accent|decoration|placeholder";
const CRAVADA = new RegExp(
  `\\b[a-z0-9@\\[\\]=._/-]*:?!?(?:${UTIL})-(?:${PALETA})-[0-9]{2,3}`,
  "g",
);

describe("a cor das telas sai do tema", () => {
  const arquivos = tsxDoClient(join(raiz, "client", "src"));

  it("encontra os arquivos do client (senão a varredura passa vazia)", () => {
    expect(arquivos.length).toBeGreaterThan(150);
  });

  it("nenhum .tsx do client crava cor da paleta do Tailwind", () => {
    const culpados: string[] = [];
    for (const arq of arquivos) {
      const achados = readFileSync(arq, "utf8").match(CRAVADA);
      if (achados) {
        culpados.push(`${arq.slice(raiz.length + 1)} → ${[...new Set(achados)].slice(0, 6).join(", ")}`);
      }
    }
    expect(culpados).toEqual([]);
  });
});

describe("o tema declara os papéis de cor nos DOIS temas", () => {
  const css = readFileSync(join(raiz, "client", "src", "index.css"), "utf8");
  const claro = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
  const escuro = css.slice(css.indexOf(".dark {"));

  const PAPEIS = ["info", "warning", "success", "danger", "neutral"];

  it.each(PAPEIS)("%s tem cor, tinta clara, véu e tinta-sobre-cheio", (papel) => {
    for (const sufixo of ["", "-fg", "-bg", "-on"]) {
      expect(claro, `claro: --${papel}${sufixo}`).toContain(`--${papel}${sufixo}:`);
      expect(escuro, `escuro: --${papel}${sufixo}`).toContain(`--${papel}${sufixo}:`);
    }
  });

  it("a tinta de cima inverte entre os temas", () => {
    // No claro o preenchimento é escuro (tinta clara); no escuro ele clareia
    // pra não sumir no fundo, e a tinta tem que escurecer junto. Foi o que
    // deixou `bg-warning text-white` ilegível no tema escuro.
    const lightness = (bloco: string, papel: string) => {
      const m = bloco.match(new RegExp(`--${papel}-on: oklch\\(([\\d.]+)`));
      return m ? Number(m[1]) : NaN;
    };
    for (const papel of ["info", "warning", "success", "danger"]) {
      expect(lightness(claro, papel), `claro ${papel}`).toBeGreaterThan(0.8);
      expect(lightness(escuro, papel), `escuro ${papel}`).toBeLessThan(0.5);
    }
  });

  it("a faixa de destaque é escura nos dois temas — o conteúdo dela é branco", () => {
    for (const [nome, bloco] of [["claro", claro], ["escuro", escuro]] as const) {
      for (const t of ["--hero:", "--hero-2:"]) {
        const m = bloco.match(new RegExp(`${t} oklch\\(([\\d.]+)`));
        expect(m, `${nome} ${t}`).not.toBeNull();
        expect(Number(m![1]), `${nome} ${t}`).toBeLessThan(0.45);
      }
    }
  });
});
