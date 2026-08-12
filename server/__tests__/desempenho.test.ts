/**
 * Desempenho — a regra que a ficha do RH e o relatório de Atendimento dividem.
 *
 * O motivo destes testes é o mesmo motivo do arquivo existir: o número aparece
 * em dois lugares, e um escritório que lê "12 ganhos" na ficha e "10" no
 * relatório para de confiar nos dois. As consultas são diferentes; a regra de
 * como as linhas viram números é uma só, e é ela que está travada aqui.
 */

import { describe, expect, it } from "vitest";
import {
  agregarDesempenho,
  baldeDaEtapa,
  DESEMPENHO_VAZIO,
  formatarEspera,
  taxaDeConversao,
} from "../../shared/desempenho";

describe("balde da etapa", () => {
  it("separa desfecho de negociação viva", () => {
    expect(baldeDaEtapa("fechado_ganho")).toBe("ganhos");
    expect(baldeDaEtapa("fechado_perdido")).toBe("perdidos");
    for (const e of ["novo", "qualificado", "proposta", "negociacao"]) {
      expect(baldeDaEtapa(e), e).toBe("emAberto");
    }
  });

  it("etapa desconhecida conta como em aberto, não some", () => {
    // Se sumisse, o total da tabela pararia de bater com a soma das colunas no
    // dia em que alguém acrescentasse uma etapa ao funil.
    expect(baldeDaEtapa("renegociacao")).toBe("emAberto");
    expect(baldeDaEtapa("")).toBe("emAberto");
  });
});

describe("taxa de conversão", () => {
  it("é ganhos ÷ atendimentos, a mesma base do KPI do relatório", () => {
    expect(taxaDeConversao(19, 495)).toBe(4);
    expect(taxaDeConversao(2, 10)).toBe(20);
  });

  it("sem atendimento devolve null, não 0%", () => {
    // 0% diria "atendeu e não fechou nada". O que houve foi não atender.
    expect(taxaDeConversao(0, 0)).toBeNull();
    expect(taxaDeConversao(3, 0)).toBeNull();
  });
});

describe("agregação", () => {
  const linhas = [
    { etapa: "fechado_ganho", total: 3, valor: 15000 },
    { etapa: "fechado_perdido", total: 2, valor: 8000 },
    { etapa: "proposta", total: 4, valor: 20000 },
    { etapa: "novo", total: 1, valor: 0 },
  ];

  it("as partes somam o total", () => {
    const d = agregarDesempenho(linhas, { atendimentos: 30 });
    expect(d.oportunidades).toBe(10);
    expect(d.ganhos + d.perdidos + d.emAberto).toBe(d.oportunidades);
    expect(d.ganhos).toBe(3);
    expect(d.perdidos).toBe(2);
    expect(d.emAberto).toBe(5);
  });

  it("valor fechado soma só o que fechou como ganho", () => {
    // Somar o valor ESTIMADO de quem não fechou daria um faturamento que não
    // existe — e é o tipo de número que vira meta.
    expect(agregarDesempenho(linhas, { atendimentos: 30 }).valorFechado).toBe(15000);
  });

  it("calcula a conversão sobre os atendimentos recebidos", () => {
    expect(agregarDesempenho(linhas, { atendimentos: 30 }).taxaConversao).toBe(10);
    expect(agregarDesempenho(linhas).taxaConversao).toBeNull();
  });

  it("carrega os extras sem mexer neles", () => {
    const d = agregarDesempenho([], {
      atendimentos: 5,
      agendamentos: 7,
      agendamentosConcluidos: 4,
      segPrimeiraResposta: 900,
    });
    expect(d).toMatchObject({
      atendimentos: 5,
      agendamentos: 7,
      agendamentosConcluidos: 4,
      segPrimeiraResposta: 900,
      oportunidades: 0,
      valorFechado: 0,
    });
  });

  it("período sem nada não quebra", () => {
    expect(agregarDesempenho([])).toEqual(DESEMPENHO_VAZIO);
  });

  it("sobrevive a valor nulo vindo do SQL", () => {
    const d = agregarDesempenho(
      [{ etapa: "fechado_ganho", total: 2, valor: null as unknown as number }],
      { atendimentos: 4 },
    );
    expect(d.ganhos).toBe(2);
    expect(d.valorFechado).toBe(0);
  });
});

describe("tempo de espera", () => {
  it("mostra minutos abaixo de uma hora e h+min acima", () => {
    expect(formatarEspera(1440)).toBe("24min");
    expect(formatarEspera(6420)).toBe("1h47");
    expect(formatarEspera(7200)).toBe("2h00");
  });

  it("sem dado vira travessão, e não '0min'", () => {
    expect(formatarEspera(null)).toBe("—");
    expect(formatarEspera(0)).toBe("—");
    expect(formatarEspera(Number.NaN)).toBe("—");
  });
});
