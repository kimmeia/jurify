import { describe, it, expect } from "vitest";
import { classificarGrupo } from "./router-movimentacoes";
import type { AnaliseMovimentacao } from "./resumir-movimentacao";

const analise = (exigida: boolean, relevancia: "relevante" | "rotina" = "relevante"): AnaliseMovimentacao => ({
  titulo: "t",
  pontos: [],
  ato: "decisao",
  desfecho: null,
  relevancia,
  providencia: {
    exigida,
    descricao: exigida ? "fazer algo" : null,
    prazoDias: exigida ? 15 : null,
    prazoUteis: true,
    dataExplicita: null,
    consequencia: null,
    citacao: null,
  },
});

describe("classificarGrupo", () => {
  it("prazo pendente sempre cai em 'exigem ação'", () => {
    expect(
      classificarGrupo({ relevancia: "rotina", temPrazoPendente: true, analise: analise(false, "rotina") }),
    ).toBe("exigem_acao");
  });

  it("providência da IA leva a 'exigem ação' mesmo sem prazo gravado", () => {
    // Caso real: audiência designada sem sugestão criada ainda.
    expect(
      classificarGrupo({ relevancia: "relevante", temPrazoPendente: false, analise: analise(true) }),
    ).toBe("exigem_acao");
  });

  it("prazo já resolvido não segura a movimentação em 'exigem ação'", () => {
    // O advogado aprovou ou descartou → temPrazoPendente false.
    expect(
      classificarGrupo({ relevancia: "relevante", temPrazoPendente: false, analise: analise(false) }),
    ).toBe("relevante");
  });

  it("rotina classificada pela IA vai pra rotina", () => {
    expect(
      classificarGrupo({ relevancia: "rotina", temPrazoPendente: false, analise: analise(false, "rotina") }),
    ).toBe("rotina");
  });

  it("sem análise cai em 'relevante', não em 'rotina'", () => {
    // Movimentação antiga ou IA fora: esconder algo não lido é pior que
    // mostrar demais.
    expect(classificarGrupo({ relevancia: null, temPrazoPendente: false, analise: null })).toBe(
      "relevante",
    );
  });

  it("relevância no banco decide quando não há análise estruturada", () => {
    expect(classificarGrupo({ relevancia: "rotina", temPrazoPendente: false, analise: null })).toBe(
      "rotina",
    );
  });
});
