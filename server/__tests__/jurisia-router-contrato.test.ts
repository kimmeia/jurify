/**
 * Contrato do router do JurisIA.
 *
 * Este teste existe por causa de um bug real desta base: uma procedure de
 * relatório chamava outra por nome dentro de um caller que não a continha, e
 * o `as any` no meio escondia isso do tsc — só quebrava em produção. Aqui a
 * garantia é que o namespace está registrado e que as procedures que a tela
 * chama existem com o tipo certo.
 */

import { describe, it, expect } from "vitest";
import { appRouter } from "../routers";

const defs = () => (appRouter as any)._def.procedures as Record<string, any>;

describe("router jurisia", () => {
  it("está registrado no appRouter", () => {
    const nomes = Object.keys(defs()).filter((k) => k.startsWith("jurisia."));
    expect(nomes.length).toBeGreaterThan(0);
  });

  it("expõe exatamente as procedures que a tela consome", () => {
    const nomes = Object.keys(defs()).filter((k) => k.startsWith("jurisia."));
    expect(nomes.sort()).toEqual([
      "jurisia.acervo",
      "jurisia.casosRecentes",
      "jurisia.conversa",
      "jurisia.conversar",
      "jurisia.estado",
      "jurisia.excluirPesquisa",
      "jurisia.perguntar",
      "jurisia.pesquisa",
      "jurisia.pesquisas",
      "jurisia.renomearPesquisa",
    ]);
  });

  it("as quatro mutations são mutation; o resto é query", () => {
    // Trocar o tipo quebra a tela sem quebrar o tsc — o client usa
    // useMutation/useQuery e o erro só aparece em runtime.
    const p = defs();
    const mutations = [
      "jurisia.perguntar",
      "jurisia.conversar",
      "jurisia.renomearPesquisa",
      "jurisia.excluirPesquisa",
    ];
    for (const [nome, proc] of Object.entries(p)) {
      if (!nome.startsWith("jurisia.")) continue;
      expect((proc as any)._def.type, nome).toBe(
        mutations.includes(nome) ? "mutation" : "query",
      );
    }
  });

  it("nenhuma procedura do JurisIA é pública", () => {
    // Acervo de escritório atrás de procedure pública seria vazamento direto.
    for (const [nome, proc] of Object.entries(defs())) {
      if (!nome.startsWith("jurisia.")) continue;
      const middlewares = (proc as any)._def.middlewares ?? [];
      expect(middlewares.length, `${nome} sem middleware de auth`).toBeGreaterThan(0);
    }
  });
});
