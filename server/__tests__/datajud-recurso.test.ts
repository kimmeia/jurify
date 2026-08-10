import { describe, expect, it } from "vitest";
import {
  deduzirDesfechoRecurso,
  ORDEM_RECURSO,
  rotuloRecurso,
  type ResultadoRecurso,
} from "../../shared/datajud-recurso";

const mov = (nome: string, dia = "2024-01-01") => ({
  nome,
  dataHora: `${dia}T12:00:00.000Z`,
});

/** Classifica um movimento sozinho — é assim que se confere frase por frase. */
const so = (nome: string): ResultadoRecurso | null =>
  deduzirDesfechoRecurso([mov(nome)])?.resultado ?? null;

/**
 * As frases vieram da agregação no índice api_publica_stj, com a grafia do
 * tribunal — inclusive as inconsistentes ("Não-Provimento" com hífen e
 * "conhecimento para..." em minúscula no meio da tabela).
 */
describe("deduzirDesfechoRecurso — vocabulário real do STJ", () => {
  it("classifica não-conhecimento", () => {
    expect(so("Não Conhecimento de recurso")).toBe("nao_conhecido");
    expect(so("Conhecimento para não conhecer do Recurso Especial")).toBe("nao_conhecido");
    expect(so("Não conhecimento do habeas corpus")).toBe("nao_conhecido");
    expect(so("Negação de seguimento")).toBe("nao_conhecido");
  });

  it("classifica não-provimento", () => {
    expect(so("Não-Provimento")).toBe("nao_provido");
    expect(so("Conhecimento para negar provimento ao recurso especial")).toBe("nao_provido");
    expect(so("Conhecimento em Parte e Não-Provimento ou Denegação")).toBe("nao_provido");
  });

  it("classifica provimento", () => {
    expect(so("Provimento")).toBe("provido");
    expect(so("Conhecimento para dar provimento ao Recurso Especial ")).toBe("provido");
  });

  it("classifica provimento parcial", () => {
    expect(so("Provimento em Parte")).toBe("parcialmente_provido");
  });

  it("separa conhecer em parte de prover em parte", () => {
    // Dois eixos diferentes: o quanto foi conhecido e o quanto foi provido.
    // Aqui o provimento foi NEGADO por inteiro — só a admissibilidade é que
    // foi parcial. Classificar como parcial inflaria a taxa de sucesso.
    expect(so("conhecimento para conhecer em parte o recurso especial e negar provimento")).toBe(
      "nao_provido",
    );
    expect(so("conhecimento para conhecer em parte o recurso especial e dar provimento")).toBe(
      "provido",
    );
  });

  it("classifica prejudicado e desistência", () => {
    expect(so("Recurso prejudicado")).toBe("prejudicado");
    expect(so("Desistência de Recurso")).toBe("desistencia");
  });

  it("ignora movimento processual", () => {
    for (const nome of [
      "Distribuição",
      "Conclusão",
      "Disponibilização no Diário da Justiça Eletrônico",
      "Publicação",
      "Ato ordinatório",
      "Recebimento",
      "Trânsito em julgado",
      "Protocolo de Petição",
      "Baixa Definitiva",
      "Remessa",
      "Redistribuição",
      "Inclusão em pauta",
      "Mero expediente",
      "Liminar",
      "Habeas corpus",
      "Mudança de Classe Processual",
      "Decurso de Prazo",
      "Retirada de pauta",
      "Outras Decisões",
      "Devolução dos autos à origem ",
    ]) {
      expect(so(nome)).toBeNull();
    }
  });
});

describe("deduzirDesfechoRecurso — embargos de declaração", () => {
  it("não deixa ED sobrescrever o resultado do recurso", () => {
    // O caso que motivou a exclusão: recurso provido, ED rejeitado depois.
    // Sem o filtro, o último movimento decisivo inverteria o resultado.
    const d = deduzirDesfechoRecurso([
      mov("Provimento", "2024-03-01"),
      mov("Não-Acolhimento de Embargos de Declaração", "2024-06-01"),
    ]);
    expect(d?.resultado).toBe("provido");
  });

  it("ED sozinho não produz resultado de recurso", () => {
    expect(so("Acolhimento de Embargos de Declaração")).toBeNull();
    expect(so("Não-Acolhimento de Embargos de Declaração")).toBeNull();
  });
});

describe("deduzirDesfechoRecurso — sequência", () => {
  it("fica com a palavra final quando o colegiado revê a monocrática", () => {
    const d = deduzirDesfechoRecurso([
      mov("Distribuição", "2024-01-10"),
      mov("Negação de seguimento", "2024-02-20"),
      mov("Provimento", "2024-09-05"),
      mov("Trânsito em julgado", "2024-11-01"),
    ]);
    expect(d?.resultado).toBe("provido");
    expect(d?.em).toBe("2024-09-05T12:00:00.000Z");
    expect(d?.movimento).toBe("Provimento");
  });

  it("ordena por data, não pela ordem que chegou", () => {
    const d = deduzirDesfechoRecurso([
      mov("Provimento", "2024-09-05"),
      mov("Não-Provimento", "2024-02-01"),
    ]);
    expect(d?.resultado).toBe("provido");
  });

  it("devolve null quando nada decidiu", () => {
    expect(deduzirDesfechoRecurso([mov("Distribuição"), mov("Conclusão")])).toBeNull();
    expect(deduzirDesfechoRecurso([])).toBeNull();
  });

  it("aguenta movimento malformado", () => {
    const sujo = [
      { nome: "Provimento", dataHora: "2024-05-01T00:00:00.000Z" },
      { nome: null, dataHora: "2024-06-01T00:00:00.000Z" },
      { nome: "Não-Provimento", dataHora: null },
    ] as never;
    expect(deduzirDesfechoRecurso(sujo)?.resultado).toBe("provido");
  });
});

describe("rótulos", () => {
  it("tem rótulo pra toda a ordem canônica", () => {
    for (const r of ORDEM_RECURSO) {
      expect(rotuloRecurso(r).length).toBeGreaterThan(0);
    }
    expect(new Set(ORDEM_RECURSO).size).toBe(ORDEM_RECURSO.length);
  });
});
