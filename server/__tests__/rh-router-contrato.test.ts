/**
 * Contrato do router de RH.
 *
 * Ponto é o documento que vira pagamento, e as duas leituras têm regras de
 * acesso opostas: o próprio ponto é direito de quem trabalha, o dos outros é
 * gestão. Um gate frouxo aqui expõe a jornada de todo mundo pra qualquer
 * colaborador; um gate apertado demais esconde de alguém as horas que a
 * empresa registrou sobre ele.
 *
 * O tipo de cada procedure também importa: trocar query por mutation quebra a
 * tela sem quebrar o tsc, porque o client escolhe `useQuery`/`useMutation` e o
 * erro só aparece em runtime.
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";

const procs = () => (appRouter as any)._def.procedures as Record<string, any>;

function proc(nome: string) {
  const p = procs()[nome];
  expect(p, `procedure ${nome} não existe`).toBeTruthy();
  return p;
}

function input(nome: string): { parse: (v: unknown) => any } {
  return proc(nome)._def.inputs[0];
}

describe("router rh", () => {
  it("expõe exatamente as procedures que a tela consome", () => {
    const nomes = Object.keys(procs()).filter((k) => k.startsWith("rh."));
    expect(nomes.sort()).toEqual([
      "rh.ajustarDia",
      "rh.espelhoEquipe",
      "rh.meuEspelho",
      "rh.registrarPausa",
    ]);
  });

  it("nenhuma procedure de ponto é pública", () => {
    for (const [nome, p] of Object.entries(procs())) {
      if (!nome.startsWith("rh.")) continue;
      expect((p as any)._def.middlewares?.length ?? 0, `${nome} sem auth`).toBeGreaterThan(0);
    }
  });

  it("leitura é query, escrita é mutation", () => {
    expect(proc("rh.meuEspelho")._def.type).toBe("query");
    expect(proc("rh.espelhoEquipe")._def.type).toBe("query");
    expect(proc("rh.registrarPausa")._def.type).toBe("mutation");
    expect(proc("rh.ajustarDia")._def.type).toBe("mutation");
  });
});

describe("validação de entrada", () => {
  it("competência só no formato AAAA-MM", () => {
    expect(input("rh.meuEspelho").parse({ competencia: "2026-08" }).competencia).toBe("2026-08");
    expect(() => input("rh.meuEspelho").parse({ competencia: "08/2026" })).toThrow();
    expect(() => input("rh.meuEspelho").parse({ competencia: "2026" })).toThrow();
  });

  it("ajuste exige dia completo e um motivo escrito", () => {
    const i = input("rh.ajustarDia");
    const base = { colaboradorId: 1, dia: "2026-08-11", observacao: "Esqueceu de bater a saída" };
    expect(i.parse({ ...base, saida: "18:00" }).saida).toBe("18:00");

    // Corrigir a jornada de outra pessoa sem dizer por quê deixa o espelho
    // certo e não auditável — e folha sem rastro não vale como prova pra
    // nenhum dos dois lados.
    expect(() => i.parse({ ...base, observacao: "" })).toThrow();
    expect(() => i.parse({ ...base, observacao: "ok" })).toThrow();

    expect(() => i.parse({ ...base, dia: "2026-08" })).toThrow();
    expect(() => i.parse({ ...base, saida: "18h" })).toThrow();
  });

  it("hora vazia é permitida — é como se apaga uma marcação errada", () => {
    const i = input("rh.ajustarDia");
    const r = i.parse({
      colaboradorId: 1,
      dia: "2026-08-11",
      observacao: "Não trabalhou neste dia",
      entrada: "",
      saida: "",
    });
    expect(r.entrada).toBe("");
    expect(r.saida).toBe("");
  });

  it("pausa só aceita os dois lados que existem", () => {
    expect(input("rh.registrarPausa").parse({ lado: "inicio" }).lado).toBe("inicio");
    expect(() => input("rh.registrarPausa").parse({ lado: "almoco" })).toThrow();
  });
});
