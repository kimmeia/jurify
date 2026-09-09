import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * A landing é superfície ESCURA fixa — não acompanha o tema do app.
 *
 * O que motivou: a tokenização de cor por nome trocou `from-violet-300 via-
 * fuchsia-300` por `from-info via-danger` sem ninguém abrir a página. No tema
 * escuro `--info` é um azul pálido, e o botão principal virou uma mancha clara
 * com letra preta que o dono descreveu como "não destaca". Medido no pixel da
 * página renderizada, 82 de 181 textos estavam abaixo do mínimo de leitura.
 *
 * O conserto não foi "escolher outra cor bonita": o par preenchimento/tinta do
 * CTA e o violeta da marca são valores MEDIDOS (7,3:1 no botão, 4,6:1 na logo
 * sobre o brilho do topo). É isso que estes testes travam.
 */

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const css = () => ler("client/src/index.css");
const home = () => ler("client/src/pages/Home.tsx");
const hero = () => ler("client/src/pages/landing/Hero.tsx");

/** Recorta um bloco do CSS pra a asserção não pescar a mesma palavra noutra regra. */
function bloco(fonte: string, abre: string): string {
  const i = fonte.indexOf(abre);
  expect(i, `bloco ${abre} sumiu do index.css`).toBeGreaterThan(-1);
  const fim = fonte.indexOf("\n}", i);
  return fonte.slice(i, fim);
}

describe("CTA da landing", () => {
  it("pinta e escreve por conta própria, sem depender de --info", () => {
    const b = bloco(css(), ".cta-marca {");
    // fundo próprio: se voltar a ser var(--info) o botão some no escuro de novo
    expect(b).toMatch(/background-image:\s*linear-gradient\([^)]*oklch\(/);
    expect(b).not.toContain("var(--info");
    // tinta branca cravada: é o par que foi medido
    expect(b).toMatch(/color:\s*oklch\(1 0 0\)/);
  });

  it("o hover não devolve a cor do texto ao tema", () => {
    // sem isto, o `hover:text-*` do Button base reassume e a letra escurece
    expect(bloco(css(), ".cta-marca:hover {")).toMatch(/color:\s*oklch\(1 0 0\)/);
  });

  it("o pulse é anel de sombra, nunca transform sobre a letra", () => {
    const k = bloco(css(), "@keyframes cta-pulso {");
    expect(k).toContain("box-shadow");
    expect(k).not.toMatch(/\btransform\b|\bopacity\b|\bfilter\b/);
    // o anel abre a partir de 0 e some: é o que impede o botão de "pular"
    expect(k).toMatch(/0 0 0 0 /);
    expect(k).toMatch(/0 0 0 13px [^;]*\/ 0\)/);
  });

  it("desliga pra quem pediu menos animação no sistema", () => {
    const m = css().match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) ?? [];
    const alvo = m.find((t) => t.includes(".cta-marca"));
    expect(alvo, "sem guarda de prefers-reduced-motion no CTA").toBeTruthy();
    expect(alvo).toContain(".cta-branco");
    expect(alvo).toMatch(/animation:\s*none/);
  });

  it("está nos CTAs primários — e não no botão secundário ao lado", () => {
    // dois botões pulsando lado a lado brigam entre si; o dono aprovou assim
    expect(hero()).toContain("cta-marca");
    expect(hero()).toMatch(/Ver demonstração/);
    const secundario = hero().slice(hero().indexOf('variant="outline"'), hero().indexOf("Ver demonstração"));
    expect(secundario).not.toContain("cta-marca");

    expect(home()).toContain("cta-marca");
    expect(ler("client/src/pages/landing/CtaFinal.tsx")).toContain("cta-branco");

    // Planos tem DOIS botões de assinar (o do card e o da vitrine). Contar é o
    // que impede um deles de voltar ao apagado sem ninguém ver.
    const planos = ler("client/src/pages/landing/Pricing.tsx");
    expect([...planos.matchAll(/cta-marca/g)]).toHaveLength(2);
  });

  it("nenhum CTA da landing pinta com bg-info de novo", () => {
    // `bg-info + text-info-on` no escuro é justamente o par apagado que o dono
    // recusou. Vale só nos arquivos de CTA: o print falso do app (Demo.tsx) usa
    // o mesmo par DENTRO da ilha de tema claro, e ali está certo.
    for (const f of ["Hero.tsx", "Pricing.tsx", "CtaFinal.tsx"]) {
      const t = ler(`client/src/pages/landing/${f}`);
      for (const m of t.matchAll(/<Button[\s\S]{0,400}?\/?>/g)) {
        expect(m[0], `${f}: botão voltou pro bg-info apagado`).not.toMatch(/bg-info\b[^/]/);
      }
    }
    expect(home()).not.toMatch(/<Button[\s\S]{0,400}?bg-info\b[^/]/);
  });
});

describe("a marca fora da paleta do produto", () => {
  it("existe nos dois temas e é exposta como classe", () => {
    expect(bloco(css(), ":root {")).toMatch(/--marca:\s*oklch\(/);
    expect(bloco(css(), ".dark {")).toMatch(/--marca:\s*oklch\(/);
    // sem --marca-em-escuro o "J." do menu (escuro mesmo no tema claro) some
    expect(bloco(css(), ":root {")).toMatch(/--marca-em-escuro:\s*oklch\(/);
    expect(css()).toContain("--color-marca: var(--marca)");
    expect(css()).toContain("--color-marca-em-escuro: var(--marca-em-escuro)");
  });

  it("a logo usa a marca, não o azul do produto", () => {
    // era text-info-fg: media 1,3:1 no fundo escuro da landing
    expect(ler("client/src/pages/landing/Logo.tsx")).toContain("text-marca");
    expect(ler("client/src/pages/landing/Logo.tsx")).not.toContain("text-info");

    const marcaJ = ler("client/src/components/MarcaJ.tsx");
    expect(marcaJ).toContain("text-marca-em-escuro");
    expect(marcaJ).toContain("text-marca");
    expect(marcaJ).not.toMatch(/text-info(-fg)?"/);
  });

  it("a landing clareia a marca só nela, por causa do brilho atrás da logo", () => {
    expect(bloco(css(), ".marca-landing {")).toMatch(/--marca:\s*oklch\(/);
    expect(home()).toContain("marca-landing");
  });
});

describe("a landing como superfície escura", () => {
  it("se declara escura, e os prints do app são ilha clara", () => {
    expect(home()).toMatch(/className="dark marca-landing min-h-screen/);
    // sem a ilha, o texto dos "prints" fica branco sobre branco. A varredura é
    // por CADA moldura branca do print, não pela primeira: `hover:bg-white/20`
    // do botão secundário casa antes e escondia a moldura de verdade.
    // A moldura EXTERNA do print (a que tem `border-black/5`) é a que carrega a
    // ilha; o `bg-white` de dentro dela já herda, e o `hover:bg-white/20` do
    // botão secundário não é print nenhum.
    const moldura = /className="([^"]*\bborder-black\/5\b[^"]*\bbg-white\b(?!\/)[^"]*)"/g;
    for (const f of ["client/src/pages/landing/Hero.tsx", "client/src/pages/landing/Demo.tsx"]) {
      const achou = [...ler(f).matchAll(moldura)].map((m) => m[1]);
      expect(achou.length, `${f} perdeu o print de tema claro`).toBeGreaterThan(0);
      for (const cls of achou) expect(cls, `${f}: moldura sem ilha clara`).toContain("tema-claro");
    }
  });

  it("o roxo saiu do fundo e sobrou só como marca no brilho", () => {
    const arq = [
      "Hero.tsx", "Pricing.tsx", "Pilares.tsx", "Problemas.tsx", "Comparativo.tsx",
      "SmartFlow.tsx", "CtaFinal.tsx", "Demo.tsx", "Integracoes.tsx", "LandingFooter.tsx",
    ];
    const roxo = /#7c3aed|#4f46e5|#c026d3|#4c1d95|124,\s*58,\s*237|147,\s*51,\s*234|168,\s*85,\s*247/;
    for (const f of arq) {
      expect(roxo.test(ler(`client/src/pages/landing/${f}`)), `${f} voltou a ter roxo cravado`).toBe(false);
    }
    expect(roxo.test(home()), "Home.tsx voltou a ter roxo cravado").toBe(false);
    // o Aurora guarda UMA nota de violeta de propósito: é a marca no fundo
    expect(ler("client/src/pages/landing/lpkit.tsx")).toContain("#7c3aed");
  });

  it("a manchete termina na marca, não no salmão", () => {
    expect(hero()).toContain("from-info via-marca to-marca");
    expect(hero()).not.toContain("via-danger");
  });
});
