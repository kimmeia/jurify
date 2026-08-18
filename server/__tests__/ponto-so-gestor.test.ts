/**
 * Ponto é do gestor.
 *
 * O módulo mostra a jornada da equipe inteira — quem chegou tarde, quem tem
 * ocorrência de conduta, quem foi avaliado e com que nota. Não é informação
 * que um atendente deva ver do colega.
 *
 * O servidor sempre barrou os DADOS (`espelhoEquipe` exige `verTodos`), mas o
 * item aparecia no menu de todo mundo porque a regra usava a mesma checagem
 * dos outros módulos, que aceita `verProprios` — e quase todo cargo tem
 * `verProprios` em "equipe". Quem clicava caía numa tela do próprio ponto, o
 * que fazia o módulo parecer disponível para todos.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const layout = ler("client/src/components/AppLayout.tsx");
const pagina = ler("client/src/pages/Ponto.tsx");
const ficha = ler("client/src/pages/ponto/ficha.tsx");
const router = ler("server/rh/router-rh.ts");

describe("o servidor — a trava que sempre valeu", () => {
  it("o espelho da equipe exige enxergar além da própria linha", () => {
    const i = router.indexOf("espelhoEquipe: protectedProcedure");
    const corpo = router.slice(i, i + 900);
    expect(corpo).toContain('checkPermission(ctx.user.id, "equipe", "ver")');
    expect(corpo).toContain("!perm.verTodos");
  });

  it("as ações de gestão exigem verTodos E editar", () => {
    // Corrigir a jornada de outra pessoa, lançar ocorrência, aprovar atestado
    // e avaliar são atos sobre terceiros.
    const i = router.indexOf("async function exigirGestorDeEquipe");
    const corpo = router.slice(i, i + 500);
    expect(corpo).toContain("!perm.verTodos || !perm.editar");
    for (const p of ["ajustarDia", "registrarOcorrencia", "decidirAtestado", "avaliar"]) {
      const j = router.indexOf(`${p}: protectedProcedure`);
      expect(j, `${p} existe`).toBeGreaterThan(0);
      expect(router.slice(j, j + 1600)).toContain("exigirGestorDeEquipe");
    }
  });
});

describe("o menu", () => {
  it("Ponto exige verTodos, não verProprios", () => {
    // `canSee` aceita verProprios — certo pra quase todo módulo, errado pra
    // este: ver os próprios clientes é o trabalho de um atendente; ver o
    // ponto da equipe não é.
    expect(layout).toContain('rota: "/ponto", icone: Clock, ver: (_c, m) => m("equipe")');
    expect(layout).toContain("const canManage = (modulo: string)");
    expect(layout).toContain("verTodos");
  });

  it("enquanto as permissões carregam, ESCONDE", () => {
    // É o inverso do canSee, e de propósito: mostrar um módulo de gestão por
    // meio segundo pra quem não tem acesso é pior que ele aparecer meio
    // segundo depois pra quem tem.
    const i = layout.indexOf("const canManage = (modulo: string)");
    expect(layout.slice(i, i + 400)).toContain("if (!minhasPerms?.permissoes) return false;");
  });
});

describe("a página", () => {
  it("nega quem não gerencia equipe, em vez de mostrar o próprio ponto", () => {
    expect(pagina).toContain("const podeGerirEquipe =");
    expect(pagina).toContain("if (!podeGerirEquipe) {");
    expect(pagina).toContain("Ponto é do gestor");
  });

  it("a ficha individual tem a mesma régua", () => {
    // Alcançável digitando /ponto/12 na barra de endereço.
    expect(ficha).toContain("const podeGerirEquipe =");
    expect(ficha).toContain("if (!podeGerirEquipe) {");
  });

  it("não pede os dados de quem não pode vê-los", () => {
    // `enabled` evita a requisição inteira: sem ele a tela negava depois de
    // tomar 403, o que rende erro no console e ruído no monitoramento.
    expect(pagina).toContain("enabled: podeGerirEquipe");
    expect(ficha).toContain("enabled: podeGerirEquipe");
  });

  it("a saída antecipada fica DEPOIS de todos os hooks", () => {
    // Hook depois de `return` muda a contagem entre renders e o React derruba
    // a tela com o #310 — já aconteceu neste projeto.
    for (const [nome, arquivo] of [["Ponto", pagina], ["ficha", ficha]] as const) {
      const guarda = arquivo.indexOf("if (!podeGerirEquipe) {");
      const depois = arquivo.slice(guarda);
      expect(depois.match(/\buse(State|Effect|Memo|Query|Mutation|Utils)\b/), nome).toBeNull();
    }
  });
});
