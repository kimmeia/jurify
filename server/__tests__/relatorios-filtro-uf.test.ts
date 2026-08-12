/**
 * O filtro por estado tem que sobreviver ao zod.
 *
 * Este teste nasce de um bug que já existiu por alguns minutos aqui: a tela
 * passou a mandar `uf`, e o input de `exportarAtendimentoPdf` não declarava o
 * campo. Zod descarta chave desconhecida sem reclamar — então a tela mostrava
 * um estado e o PDF exportado trazia o relatório inteiro, com números
 * diferentes e nenhuma pista do porquê.
 *
 * Filtro que some em silêncio é pior que filtro que quebra: o número errado
 * circula fora da tela, num papel que alguém manda por e-mail.
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";

const procs = () => (appRouter as any)._def.procedures as Record<string, any>;

/** O primeiro parser do input da procedure. */
function inputDe(nome: string): { parse: (v: unknown) => any } {
  const p = procs()[nome];
  expect(p, `procedure ${nome} não existe`).toBeTruthy();
  const inputs = p._def.inputs as Array<{ parse: (v: unknown) => any }>;
  expect(inputs.length, `${nome} sem schema de input`).toBeGreaterThan(0);
  return inputs[0]!;
}

const COM_UF = ["relatorios.atendimento", "relatorios.exportarAtendimentoPdf"];

describe("filtro por estado", () => {
  it.each(COM_UF)("%s aceita uf e devolve o valor", (nome) => {
    const parsed = inputDe(nome).parse({ uf: "CE" });
    expect(parsed.uf).toBe("CE");
  });

  it.each(COM_UF)("%s recusa sigla de tamanho errado", (nome) => {
    // Sem o `.length(2)` qualquer string entraria e viraria comparação que
    // nunca casa — filtro que devolve zero sem dizer que o recorte é inválido.
    expect(() => inputDe(nome).parse({ uf: "CEA" })).toThrow();
    expect(() => inputDe(nome).parse({ uf: "C" })).toThrow();
  });

  it.each(COM_UF)("%s continua funcionando sem uf", (nome) => {
    expect(inputDe(nome).parse({}).uf).toBeUndefined();
    expect(() => inputDe(nome).parse(undefined)).not.toThrow();
  });

  it("os filtros antigos não foram perdidos no caminho", () => {
    const parsed = inputDe("relatorios.atendimento").parse({
      dataInicio: "2026-08-01",
      dataFim: "2026-08-31",
      setorId: 3,
      atendenteId: 7,
      canalId: 2,
      uf: "SP",
    });
    expect(parsed).toMatchObject({
      dataInicio: "2026-08-01",
      dataFim: "2026-08-31",
      setorId: 3,
      atendenteId: 7,
      canalId: 2,
      uf: "SP",
    });
  });

  it("confirmarEstado só aceita UF que existe", () => {
    // O que entra aqui vai direto pra `contatos.uf` e passa a contar como
    // FATO no relatório. Sigla inventada viraria um estado que o mapa não
    // sabe desenhar e uma linha de ranking que não bate com nada.
    const input = inputDe("customer360.confirmarEstado");
    expect(input.parse({ contatoId: 1, uf: "CE" })).toMatchObject({ uf: "CE" });
    expect(() => input.parse({ contatoId: 1, uf: "XX" })).toThrow();
    expect(() => input.parse({ contatoId: 1, uf: "ce" })).toThrow();
    expect(() => input.parse({ contatoId: 1 })).toThrow();
  });
});
