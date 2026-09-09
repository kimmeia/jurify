/**
 * Ponto é concessão explícita do dono.
 *
 * O módulo mostra a jornada da equipe inteira — quem chegou tarde, quem tem
 * ocorrência de conduta, quem foi avaliado e com que nota. Não é informação
 * que um atendente deva ver do colega, e também não é consequência automática
 * de gerenciar a equipe.
 *
 * Duas correções, nesta ordem. A primeira tirou atendente, SDR e estagiário:
 * o item pegava carona em "equipe" com a checagem que aceita `verProprios`, e
 * quase todo cargo tem isso lá. A segunda deu módulo próprio ao Ponto, porque
 * enquanto o gate fosse "equipe" o Gestor continuava vendo — não por escolha
 * de ninguém, mas porque veio junto com administrar o time.
 *
 * Agora a régua é: linha "Ponto" na matriz de cargos. Ninguém tem por padrão,
 * exceto o Dono. O dono concede a quem quiser.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { MODULOS, MODULOS_LABELS, MODULO_HERANCA } from "../../shared/permissoes-modulos";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const layout = ler("client/src/components/AppLayout.tsx");
const pagina = ler("client/src/pages/Ponto.tsx");
const ficha = ler("client/src/pages/ponto/ficha.tsx");
const router = ler("server/rh/router-rh.ts");
const permissoes = ler("server/escritorio/router-permissoes.ts");
const checkPerm = ler("server/escritorio/check-permission.ts");

describe("Ponto é um módulo da matriz", () => {
  it("aparece na fonte única, com rótulo", () => {
    expect(MODULOS).toContain("ponto");
    expect(MODULOS_LABELS.ponto).toBe("Ponto");
  });

  it("NÃO herda de equipe", () => {
    // Herdar é o padrão pra módulo desmembrado, e aqui seria o erro: devolveria
    // o Ponto ao Gestor, que é exatamente o acesso que o dono mandou fechar.
    expect(MODULO_HERANCA.ponto).toBeUndefined();
  });

  it("o padrão de fábrica é fechado pra todo mundo, menos o Dono", () => {
    const trecho = (cargo: string) => {
      const i = permissoes.indexOf(`"${cargo}": {`);
      expect(i, `cargo ${cargo}`).toBeGreaterThan(0);
      const corpo = permissoes.slice(i, i + 2000);
      const j = corpo.indexOf("ponto: p(");
      expect(j, `${cargo} declara ponto`).toBeGreaterThan(0);
      return corpo.slice(j, j + 60);
    };
    expect(trecho("Dono")).toContain("ponto: p(true, true, true, true, true)");
    for (const cargo of ["Gestor", "Atendente", "Estagiário", "SDR"]) {
      expect(trecho(cargo), cargo).toContain("ponto: p(false, false, false, false, false)");
    }
  });

  it("o fallback legado fecha do mesmo jeito", () => {
    // Cargo sem linha em permissoes_cargo cai aqui. Se o legado abrisse, a
    // matriz diria uma coisa e o sistema faria outra.
    for (const cargo of ["gestor", "atendente", "estagiario", "sdr"]) {
      const i = checkPerm.indexOf(`  ${cargo}: {`);
      expect(i, cargo).toBeGreaterThan(0);
      const corpo = checkPerm.slice(i, i + 1800);
      const j = corpo.indexOf("ponto: perm(");
      expect(j, `${cargo} declara ponto`).toBeGreaterThan(0);
      expect(corpo.slice(j, j + 48)).toContain("ponto: perm(false, false, false, false, false)");
    }
  });
});

describe("o servidor", () => {
  it("o espelho da equipe passa pelo módulo Ponto", () => {
    const i = router.indexOf("espelhoEquipe: protectedProcedure");
    const corpo = router.slice(i, i + 900);
    expect(corpo).toContain('checkPermission(ctx.user.id, "ponto", "ver")');
    expect(corpo).not.toContain('"equipe"');
  });

  it("as ações de gestão exigem editar no Ponto", () => {
    // Corrigir a jornada de outra pessoa, lançar ocorrência, aprovar atestado
    // e avaliar são atos sobre terceiros. Ver não autoriza reescrever.
    const i = router.indexOf("async function exigirGestorDeEquipe");
    const corpo = router.slice(i, i + 500);
    expect(corpo).toContain('checkPermission(userId, "ponto", "editar")');
    expect(corpo).toContain("!perm.editar");
    for (const p of ["ajustarDia", "registrarOcorrencia", "decidirAtestado", "avaliar"]) {
      const j = router.indexOf(`${p}: protectedProcedure`);
      expect(j, `${p} existe`).toBeGreaterThan(0);
      expect(router.slice(j, j + 1600)).toContain("exigirGestorDeEquipe");
    }
  });

  it("o próprio cartão continua sem gate", () => {
    // Esconder de alguém as horas que a empresa registrou sobre ele seria o
    // avesso do que uma folha de ponto serve.
    for (const p of ["meuEspelho", "registrarPausa"]) {
      const i = router.indexOf(`${p}: protectedProcedure`);
      expect(i, p).toBeGreaterThan(0);
      const corpo = router.slice(i, i + 1200);
      expect(corpo, p).not.toContain("exigirGestorDeEquipe");
      expect(corpo, p).not.toContain("checkPermission");
    }
  });
});

describe("o menu", () => {
  it("Ponto olha o módulo Ponto, não a Equipe", () => {
    expect(layout).toContain('rota: "/ponto", icone: Clock, ver: (_c, e) => e("ponto")');
  });

  it("enquanto as permissões carregam, ESCONDE", () => {
    // É o inverso do canSee, e de propósito: mostrar um módulo de gestão por
    // meio segundo pra quem não tem acesso é pior que ele aparecer meio
    // segundo depois pra quem tem.
    const i = layout.indexOf("const canSeeEstrito = (modulo: string)");
    expect(i).toBeGreaterThan(0);
    expect(layout.slice(i, i + 400)).toContain("if (!minhasPerms?.permissoes) return false;");
  });
});

describe("a página", () => {
  it("nega quem não tem o módulo, em vez de mostrar o próprio ponto", () => {
    expect(pagina).toContain("const podeVerPonto =");
    expect(pagina).toContain("permissoes?.ponto?.verTodos");
    expect(pagina).toContain("if (!podeVerPonto) {");
  });

  it("a ficha individual tem a mesma régua", () => {
    // Alcançável digitando /ponto/12 na barra de endereço.
    expect(ficha).toContain("const podeVerPonto =");
    expect(ficha).toContain("permissoes?.ponto?.verTodos");
    expect(ficha).toContain("if (!podeVerPonto) {");
  });

  it("não pede os dados de quem não pode vê-los", () => {
    // `enabled` evita a requisição inteira: sem ele a tela negava depois de
    // tomar 403, o que rende erro no console e ruído no monitoramento.
    expect(pagina).toContain("enabled: podeVerPonto");
    expect(ficha).toContain("enabled: podeVerPonto");
  });

  it("a mensagem diz onde se resolve", () => {
    // "Fale com o gestor" mandava pra pessoa errada: quem libera é o dono, e
    // o lugar é a matriz de cargos.
    expect(pagina).toContain("Configurações → Cargos");
  });

  it("a saída antecipada fica DEPOIS de todos os hooks", () => {
    // Hook depois de `return` muda a contagem entre renders e o React derruba
    // a tela com o #310 — já aconteceu neste projeto.
    for (const [nome, arquivo] of [["Ponto", pagina], ["ficha", ficha]] as const) {
      const guarda = arquivo.indexOf("if (!podeVerPonto) {");
      const depois = arquivo.slice(guarda);
      expect(depois.match(/\buse(State|Effect|Memo|Query|Mutation|Utils)\b/), nome).toBeNull();
    }
  });
});
