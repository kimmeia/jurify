/**
 * O menu lateral usa a cor da LOGO, e a logo não sai por arrasto.
 *
 * Já aconteceu duas vezes: em 02/09 uma troca de paleta levou a marca junto
 * e ela virou azul; em 04/09 ela voltou ao violeta, mas por um token só dela
 * (`--marca`), justamente pra não ir de arrasto na próxima. Em 13/09 o dono
 * aprovou o menu inteiro no escuro da logo — e o azul saiu de lá. Esta amarra
 * guarda as duas pontas: o menu é da família da logo, e a cor de AÇÃO do
 * conteúdo continua sendo o marinho.
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
/** Faixa do marinho de ação do conteúdo (#194b86 ≈ matiz 255). */
const MARINHO = (h: number) => h >= 245 && h <= 265;

describe("o menu veste a cor da logo", () => {
  it("o fundo do menu é violeta escuro nos dois temas — não o azul-ardósia de antes", () => {
    const fundos = valores("--sidebar");
    expect(fundos).toHaveLength(2);
    for (const f of fundos) {
      expect(VIOLETA(f.h)).toBe(true);
      expect(f.l).toBeLessThan(0.24); // escuro de verdade, como o da logo
      expect(f.c).toBeGreaterThan(0.02); // tem cor: cinza-azulado não serve
    }
  });

  it("o realce do item aberto (barra e ícone) também é da marca, não azul", () => {
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
