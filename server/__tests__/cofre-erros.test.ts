/**
 * Resumo do erro de login de tribunal.
 *
 * O scraper grava um diagnóstico longo — realm do Keycloak, inputs achados na
 * página, URL com parâmetros de sessão. É esse texto que resolve o caso, então
 * ele continua guardado inteiro. Mas jogado na grade vira um paredão por card,
 * e a tela some justamente na hora em que dez estados estão vermelhos.
 *
 * O que estes testes travam: o resumo separa "o portal recusou sua senha" de
 * "o endereço não existe". A diferença é quem tem que agir — no primeiro caso
 * o dono, no segundo a cobertura. Trocar isso manda ele procurar problema onde
 * não tem.
 */

import { describe, it, expect } from "vitest";
import { resumirErroCofre } from "../../shared/cofre-erros";

// O texto real que apareceu na tela do dono em 01/09, encurtado no meio.
const ERRO_REAL = `Login rejeitado pelo Keycloak (PDPJ-cloud). Username usado: "06***01" (14 chars). Mensagem do Keycloak: Usuario ou senha inválido. Inputs detectados: [{"name":"username","id":"username","type":"text"},{"name":"password","id":"password","type":"password"},{"name":"login","id":"kc-login","type":"submit"}]. URL: https://sso.cloud.pje.jus.br/auth/realms/pje/login-actions/authenticate?execution=c0cf406e-a9d7-4976-a188-03b59c51aab6&client_id=pje-tjrj-1g&tab_id=IRxvaIRVgqE. Title: Bem vindo ao PJe . Processo Judicial Eletrônico.`;

describe("resumirErroCofre", () => {
  it("credencial recusada é problema do dono, não da cobertura", () => {
    const r = resumirErroCofre(ERRO_REAL)!;
    expect(r.resumo).toBe("O portal recusou o usuário ou a senha.");
    // O caso real do dono em 01/09: ele ainda não tinha cadastro nesses
    // tribunais. Mandar "confira a senha" fazia procurar defeito onde não tem.
    expect(r.acao).toMatch(/cadastro neste tribunal/);
    // O resumo é UMA linha — o paredão é justamente o que ele resolve.
    expect(r.resumo.length).toBeLessThan(80);
    expect(r.resumo).not.toContain("Keycloak");
    expect(r.resumo).not.toContain("http");
  });

  it("endereço inexistente é problema da cobertura, não da senha", () => {
    const r = resumirErroCofre("page.goto: net::ERR_NAME_NOT_RESOLVED at https://pje.tjrj.jus.br/")!;
    expect(r.resumo).toBe("O endereço do portal não existe.");
    expect(r.acao).toMatch(/não a sua credencial/);
  });

  it("404 também é cobertura", () => {
    const r = resumirErroCofre("Resposta 404 Not Found ao abrir o login")!;
    expect(r.acao).toMatch(/não a sua credencial/);
  });

  it("instabilidade do tribunal não vira culpa de ninguém", () => {
    const t = resumirErroCofre("Timeout 30000ms exceeded waiting for selector")!;
    expect(t.resumo).toBe("O portal não respondeu a tempo.");
    expect(t.acao).toMatch(/tentar de novo mais tarde/);
    const c = resumirErroCofre("socket hang up")!;
    expect(c.acao).toMatch(/tentar de novo mais tarde/);
  });

  it("bloqueio manda PARAR de testar — insistir piora", () => {
    const r = resumirErroCofre("Conta temporariamente indisponível para este usuário")!;
    expect(r.resumo).toMatch(/bloqueou a conta/);
    expect(r.acao).toMatch(/Pare de testar/);
  });

  it("captcha explica por que apareceu", () => {
    const r = resumirErroCofre("Página apresentou reCAPTCHA antes do login")!;
    expect(r.acao).toMatch(/Logins seguidos/);
  });

  it("recusa por senha vence 'timeout' citado de passagem no diagnóstico", () => {
    // O texto cru costuma mencionar timeouts de espera de seletor mesmo quando
    // o motivo real foi a recusa. A ordem das regras é o que decide.
    const r = resumirErroCofre(
      "Usuario ou senha inválido. (esperou 30000ms pelo seletor de erro)",
    )!;
    expect(r.resumo).toBe("O portal recusou o usuário ou a senha.");
  });

  it("erro desconhecido devolve a primeira frase, curta", () => {
    const r = resumirErroCofre(
      `Falha estranha que ninguém previu. ${"x".repeat(400)}`,
    )!;
    expect(r.resumo).toBe("Falha estranha que ninguém previu.");
    expect(r.acao).toBe("");
  });

  it("frase única e comprida é cortada, não devolvida inteira", () => {
    const r = resumirErroCofre("y".repeat(400))!;
    expect(r.resumo.length).toBeLessThanOrEqual(120);
    expect(r.resumo.endsWith("…")).toBe(true);
  });

  it("sem erro, sem resumo", () => {
    expect(resumirErroCofre(null)).toBeNull();
    expect(resumirErroCofre("")).toBeNull();
    expect(resumirErroCofre("   ")).toBeNull();
  });
});

describe("a grade usa o resumo, não o texto cru", () => {
  it("mostra o resumo e guarda o cru atrás do detalhe", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const grade = fs.readFileSync(
      path.resolve(__dirname, "../../client/src/components/GradeTribunais.tsx"),
      "utf-8",
    );
    expect(grade).toContain("resumirErroCofre");
    // O cru não pode sumir: é ele que diz o realm e a URL exata.
    expect(grade).toContain("detalhe técnico");
    expect(grade).toMatch(/<pre[\s\S]{0,200}erro\.ultimoErro/);
  });
});
