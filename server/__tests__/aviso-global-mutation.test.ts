/**
 * Aviso global quando um clique falha: 26 botões chamavam o servidor sem
 * `onError` e ficavam mudos na recusa. O tratamento vive no MutationCache
 * do QueryClient (main.tsx) e só age quando a mutation não tem aviso
 * próprio nem pediu silêncio (`meta.semAvisoGlobal` — "Esqueci a senha").
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { mensagemDeFalha, TITULO_FALHA_PADRAO } from "../../shared/mensagem-de-falha";

const CLIENT = path.resolve(__dirname, "../../client/src");
const main = readFileSync(path.join(CLIENT, "main.tsx"), "utf-8");
const esqueci = readFileSync(path.join(CLIENT, "pages/EsqueciSenha.tsx"), "utf-8");

describe("mensagemDeFalha", () => {
  it("mensagem do servidor vai como está", () => {
    expect(mensagemDeFalha({ message: "Sem permissão para editar conversas.", data: { code: "FORBIDDEN" } })).toEqual({
      titulo: "Sem permissão",
      descricao: "Sem permissão para editar conversas.",
    });
    expect(mensagemDeFalha({ message: "Conversa não encontrada.", data: { code: "NOT_FOUND" } })).toEqual({
      titulo: TITULO_FALHA_PADRAO,
      descricao: "Conversa não encontrada.",
    });
  });

  it("falha de rede vira 'sem conexão' em português", () => {
    expect(mensagemDeFalha({ message: "Failed to fetch" }).descricao).toMatch(/Sem conexão/);
    expect(mensagemDeFalha({ message: "NetworkError when attempting to fetch resource." }).descricao).toMatch(/Sem conexão/);
  });

  it("erro interno genérico vira texto legível; erro interno com mensagem própria mantém a mensagem", () => {
    expect(mensagemDeFalha({ message: "Internal server error", data: { code: "INTERNAL_SERVER_ERROR" } }).descricao).toMatch(/Erro no servidor/);
    expect(mensagemDeFalha({ message: "Database indisponível", data: { code: "INTERNAL_SERVER_ERROR" } }).descricao).toBe("Database indisponível");
  });

  it("erro sem mensagem não mostra 'undefined'", () => {
    const r = mensagemDeFalha(null);
    expect(r.titulo).toBe(TITULO_FALHA_PADRAO);
    expect(r.descricao).not.toMatch(/undefined/);
  });
});

describe("main.tsx — tratamento global no MutationCache", () => {
  const bloco = main.slice(main.indexOf("getMutationCache().subscribe"));

  it("avisa com toast quando a mutation falha", () => {
    expect(bloco).toContain("avisarFalhaSemTratamento(");
    expect(main).toMatch(/function avisarFalhaSemTratamento/);
    expect(main).toContain("toast.error(");
  });

  it("não duplica: mutation com onError próprio fica de fora", () => {
    expect(main).toMatch(/typeof\s+opcoes\.onError\s*===\s*"function"\)\s*return;/);
  });

  it("respeita quem pediu silêncio (meta.semAvisoGlobal) e não avisa em 'não autenticado' (o redirect cuida)", () => {
    const inicio = main.indexOf("function avisarFalhaSemTratamento");
    const fn = main.slice(inicio, main.indexOf("toast.error(", inicio));
    expect(fn).toMatch(/meta[^\n]*semAvisoGlobal[^\n]*return;/);
    expect(fn).toMatch(/if \(ehNaoAutenticado\(error\)\) return;/);
  });

  it("usa o texto compartilhado", () => {
    expect(main).toContain("mensagemDeFalha(");
  });
});

describe("Esqueci a senha fica de fora de propósito", () => {
  it("declara meta.semAvisoGlobal", () => {
    expect(esqueci).toMatch(/meta:\s*\{\s*semAvisoGlobal:\s*true\s*\}/);
  });
});
