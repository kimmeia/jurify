import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * A vitrine de planos se enquadra sozinha ao número de planos.
 *
 * O que motivou: a grade era `lg:grid-cols-4` cravada, e a vitrine tem 3
 * planos. Medido na página renderizada, sobravam 284px vazios à direita no
 * desktop; no tablet as 2 colunas deixavam um card órfão na segunda linha com
 * 376px de sobra ao lado. Trocar "4" por "3" à mão só empurraria o problema
 * pro dia em que a vitrine mudar — quem decide a quantidade é o painel.
 *
 * A segunda metade é o alinhamento: o preço tem dois tamanhos ("R$ 5,00" ×
 * "Sob consulta") e o CTA tem um ou dois botões, então as listas de itens
 * começavam em pontos diferentes — 306/356/355px no desktop, e 306/401/420 em
 * 1024px. As alturas reservadas resolvem isso, e são MÍNIMOS de propósito:
 * cortar texto pra alinhar seria pior que o desalinho.
 */

const arquivo = join(__dirname, "..", "..", "client/src/pages/landing/Pricing.tsx");
const fonte = () => readFileSync(arquivo, "utf8");

/** Recorta o corpo da função que decide a grade, pra não pescar classe de fora. */
function decisorDaGrade(): string {
  const t = fonte();
  const i = t.indexOf("const gradeDosPlanos");
  expect(i, "sumiu a função que decide a grade").toBeGreaterThan(-1);
  return t.slice(i, t.indexOf("function selecionarPlano"));
}

describe("grade da vitrine de planos", () => {
  it("é decidida pela quantidade de planos, não cravada", () => {
    // o `switch` em si, não só a lista de dependências do useMemo — trocar o
    // discriminante por uma constante passava despercebido
    expect(decisorDaGrade()).toMatch(/switch \(planos\?\.length \?\? 0\)/);
    // a classe da grade tem que sair daqui e ser aplicada na grade de verdade
    expect(fonte()).toContain("${gradeDosPlanos}");
  });

  it("cobre 1, 2, 3 e 4-ou-mais planos", () => {
    const g = decisorDaGrade();
    expect(g).toMatch(/case 1:/);
    expect(g).toMatch(/case 2:[\s\S]*?sm:grid-cols-2/);
    expect(g).toMatch(/case 3:[\s\S]*?lg:grid-cols-3/);
    // o `default` é o que impede a grade de sumir quando entrar um 5º plano
    expect(g).toMatch(/default:[\s\S]*?lg:grid-cols-4/);
  });

  it("com 3 planos pula a etapa de 2 colunas, que é a que deixa o órfão", () => {
    const tres = decisorDaGrade().match(/case 3:[\s\S]*?return "([^"]+)"/);
    expect(tres, "o caso de 3 planos sumiu").toBeTruthy();
    expect(tres![1]).not.toMatch(/(?:sm|md):grid-cols-2/);
    // e limita a largura antes do lg, senão o card sozinho estica a página toda
    expect(tres![1]).toMatch(/max-w-md/);
    expect(tres![1]).toMatch(/mx-auto/);
  });

  it("poucos planos não esticam a página inteira", () => {
    const g = decisorDaGrade();
    for (const caso of ["case 1:", "case 2:"]) {
      // `[^"]*` e não `[^"]+`: com `return ""` o "+" pulava pro case seguinte
      // e o teste aprovava um caso vazio
      const t = g.slice(g.indexOf(caso)).match(/return "([^"]*)"/);
      expect(t![1], `${caso} ficou sem classe nenhuma`).not.toBe("");
      expect(t![1], `${caso} sem limite de largura`).toMatch(/max-w-/);
      expect(t![1], `${caso} sem centralizar`).toMatch(/mx-auto/);
    }
  });

  it("o esqueleto de carregamento usa a mesma grade do caso comum", () => {
    // senão a página salta de 4 colunas pra 3 quando os planos chegam
    const t = fonte();
    const esq = t.slice(t.indexOf("<Skeleton") - 400, t.indexOf("<Skeleton"));
    expect(esq).toMatch(/lg:grid-cols-3/);
    expect(esq).not.toMatch(/lg:grid-cols-4/);
  });
});

describe("cards alinhados entre si", () => {
  const reservas = () => [...fonte().matchAll(/min-h-\[([^\]]+)\]/g)].map((m) => m[1]);

  it("os dois tamanhos de preço reservam a MESMA altura", () => {
    const t = fonte();
    // "Sob consulta" (30px) e o preço em número (38px): sem a mesma reserva, o
    // card com número fica 11px mais alto e a lista dele desce junto
    for (const marca of ['text-\\[30px\\]', 'text-\\[38px\\]']) {
      const re = new RegExp(`<div className="([^"]*)"[^>]*>\\s*(?:\\{[^}]*\\}\\s*)?<span className="[^"]*${marca}`);
      const m = t.match(re);
      expect(m, `bloco de preço ${marca} sumiu`).toBeTruthy();
      expect(m![1], `preço ${marca} sem altura reservada`).toContain("min-h-[58px]");
    }
  });

  it("o bloco de botões reserva altura de DOIS botões nos dois casos", () => {
    // um card tem um botão e os outros têm dois; sem a reserva, as listas
    // desalinham em ~50px
    const blocos = [...fonte().matchAll(/className="my-4 flex ([^"]*)flex-col gap-2"/g)];
    expect(blocos.length, "os dois blocos de CTA deveriam existir").toBe(2);
    for (const b of blocos) expect(b[1]).toContain("min-h-[104px]");
  });

  it("nome e subtítulo também reservam, senão o resto desalinha atrás", () => {
    expect(fonte()).toMatch(/<h3 className="[^"]*min-h-\[2\.4em\]/);
    // a descrição ("Pra quem advoga sozinho…") tem uma ou duas linhas conforme
    // a largura do card, então ela também precisa de piso
    expect(fonte()).toMatch(/<p className="mb-4 mt-1 min-h-\[34px\]/);
    expect(reservas().filter((r) => r === "32px").length).toBe(2);
  });

  it("toda reserva é mínimo, nunca altura fixa — texto não pode ser cortado", () => {
    // só o card: o esqueleto de carregamento tem altura fixa de propósito,
    // porque ele é um retângulo cinza e não tem texto pra cortar
    const t = fonte();
    const i = t.indexOf("{planos.map((p: any) => {");
    expect(i, "sumiu o laço que desenha os cards").toBeGreaterThan(-1);
    const card = t.slice(i);
    // o lookbehind é necessário: `\b` casa entre o "-" e o "h" de `min-h-[34px]`
    expect(card).not.toMatch(/(?<!min-)(?<!max-)\bh-\[\d+(?:px|rem)\]/);
    expect(card).not.toMatch(/\bmax-h-\[/);
    expect(card).not.toMatch(/\boverflow-hidden\b/);
    expect(card).not.toMatch(/\btruncate\b|\bline-clamp-/);
    expect(reservas().length).toBeGreaterThanOrEqual(6);
  });
});
