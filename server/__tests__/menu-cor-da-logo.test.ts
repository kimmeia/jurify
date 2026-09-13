/**
 * O menu lateral usa a cor da LOGO, e a logo não sai por arrasto.
 *
 * Já aconteceu duas vezes: em 02/09 uma troca de paleta levou a marca junto
 * e ela virou azul; em 04/09 ela voltou ao violeta, mas por um token só dela
 * (`--marca`), justamente pra não ir de arrasto na próxima. Em 13/09 o dono
 * aprovou o menu inteiro no escuro da logo — e o azul saiu de lá. Esta amarra
 * guarda as três pontas: o escuro do menu é o navy do Devular (a mesma casa
 * de software; o roxo cheio ficou forte demais e o dono pediu este tom), o
 * acento continua sendo o violeta da marca, e a cor de AÇÃO do conteúdo
 * continua sendo o marinho.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "../..");
const css = readFileSync(join(RAIZ, "client/src/index.css"), "utf8");
const marcaJ = readFileSync(join(RAIZ, "client/src/components/MarcaJ.tsx"), "utf8");

/** Todas as definições de um token, na ordem (tema claro, depois escuro). */
function valores(token: string): { l: number; c: number; h: number }[] {
  const re = new RegExp(`^\\s*${token}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`, "gm");
  const achados: { l: number; c: number; h: number }[] = [];
  for (const m of css.matchAll(re)) achados.push({ l: +m[1], c: +m[2], h: +m[3] });
  return achados;
}

/** Faixa de matiz do violeta da marca (a logo é #7c3aed ≈ matiz 296). */
const VIOLETA = (h: number) => h >= 285 && h <= 305;
/** Navy do Devular, o escuro do menu (#1B2138 ≈ matiz 272). */
const NAVY_DEVULAR = (h: number) => h >= 262 && h <= 282;
/** Faixa do marinho de ação do conteúdo (#194b86 ≈ matiz 255). */
const MARINHO = (h: number) => h >= 245 && h <= 265;

describe("o menu veste a cor da logo", () => {
  it("o fundo do menu é o navy do Devular nos dois temas — nem o ardósia antigo, nem roxo cheio", () => {
    const fundos = valores("--sidebar");
    expect(fundos).toHaveLength(2);
    for (const f of fundos) {
      expect(NAVY_DEVULAR(f.h)).toBe(true);
      expect(f.l).toBeLessThan(0.27); // escuro de verdade
      expect(f.c).toBeGreaterThan(0.02); // tem cor: cinza puro não serve
      expect(f.c).toBeLessThan(0.06); // e não é roxo cheio: foi o que ficou forte demais
    }
  });

  it("a superfície do item aberto acompanha o mesmo navy", () => {
    const sup = valores("--sidebar-accent");
    expect(sup).toHaveLength(2);
    for (const v of sup) expect(NAVY_DEVULAR(v.h)).toBe(true);
  });

  it("o realce do item aberto (barra e ícone) é da marca — o acento entra com parcimônia, como o ponto coral do Devular", () => {
    const p = valores("--sidebar-primary");
    expect(p).toHaveLength(2);
    for (const v of p) expect(VIOLETA(v.h)).toBe(true);
  });

  it("o violeta da marca no escuro é claro o bastante pra ler", () => {
    const [marca] = valores("--marca-em-escuro");
    expect(VIOLETA(marca.h)).toBe(true);
    // O tom exato da logo dá 3:1 sobre o menu — abaixo do mínimo de leitura.
    // Daí a clareada mínima: menos que isto não passa de 4,5:1.
    expect(marca.l).toBeGreaterThanOrEqual(0.64);
  });

  it("«Jurid» no menu é branco puro, como na logo", () => {
    expect(marcaJ).toContain('tom === "sidebar" ? "text-white"');
  });

  it("o acento da marca vem do token da marca — nunca do realce do menu", () => {
    expect(marcaJ).toContain('tom === "sidebar" ? "text-marca-em-escuro"');
    expect(marcaJ).not.toMatch(/sidebar-primary/);
    expect(marcaJ).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("a cor de AÇÃO do conteúdo continua marinho — o violeta ficou no menu", () => {
    const primarias = valores("--primary");
    expect(primarias.length).toBeGreaterThanOrEqual(1);
    for (const p of primarias) expect(MARINHO(p.h)).toBe(true);
  });
});
