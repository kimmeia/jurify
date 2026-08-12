/**
 * Conduta e faltas — as regras que decidem se um dia desconta.
 *
 * O que está sendo protegido aqui é a diferença entre "abonei" e "ainda não
 * decidi". Um atestado alegado e não conferido não pode virar abono por
 * omissão nem desconto por desconfiança: fica aguardando, e alguém olha. Todo
 * teste abaixo existe pra impedir que um refactor colapse esses três estados
 * em dois.
 */

import { describe, expect, it } from "vitest";
import {
  contarFaltas,
  dependeDeAprovacao,
  exigeMotivo,
  MOTIVOS_FALTA,
  situacaoDaFalta,
  situacaoDoDia,
  TIPOS_OCORRENCIA,
} from "../../shared/ocorrencias";

const falta = (motivo: any, aprovadoEm: Date | null = null) =>
  ({ tipo: "falta" as const, motivo, aprovadoEm });

describe("situação de uma falta", () => {
  it("injustificada desconta", () => {
    expect(situacaoDaFalta(falta("injustificada"))).toBe("descontada");
  });

  it("atestado não abona sozinho — espera alguém olhar o documento", () => {
    expect(situacaoDaFalta(falta("atestado"))).toBe("aguardando");
  });

  it("atestado aprovado abona", () => {
    expect(situacaoDaFalta(falta("atestado", new Date("2026-08-12T12:00:00Z")))).toBe("abonada");
  });

  it("justificada, folga, férias e licença abonam sem precisar de aprovação", () => {
    for (const m of ["justificada", "folga", "ferias", "licenca"]) {
      expect(situacaoDaFalta(falta(m)), m).toBe("abonada");
    }
  });

  it("falta sem motivo fica aguardando, não vira desconto silencioso", () => {
    expect(situacaoDaFalta(falta(null))).toBe("aguardando");
  });

  it("conduta não tem situação de falta", () => {
    for (const tipo of ["advertencia", "elogio", "observacao"] as const) {
      expect(situacaoDaFalta({ tipo, motivo: null, aprovadoEm: null }), tipo).toBeNull();
    }
  });

  it("todo motivo da lista resolve pra alguma situação", () => {
    // Motivo novo que ninguém mapeou cairia num undefined que a tela renderiza
    // como espaço em branco — e o dia sumiria da apuração sem avisar.
    for (const m of MOTIVOS_FALTA) {
      expect(["abonada", "descontada", "aguardando"], m).toContain(situacaoDaFalta(falta(m)));
    }
  });
});

describe("situação do dia com mais de uma ocorrência", () => {
  it("desconto prevalece sobre abono", () => {
    // Resolver o empate pelo caso mais leve esconderia justamente a linha que
    // precisa de conversa.
    expect(situacaoDoDia([falta("folga"), falta("injustificada")])).toBe("descontada");
  });

  it("aguardando prevalece sobre abono", () => {
    expect(situacaoDoDia([falta("folga"), falta("atestado")])).toBe("aguardando");
  });

  it("desconto prevalece sobre aguardando", () => {
    expect(situacaoDoDia([falta("atestado"), falta("injustificada")])).toBe("descontada");
  });

  it("dia só com conduta não tem situação de falta", () => {
    expect(situacaoDoDia([
      { tipo: "elogio", motivo: null, aprovadoEm: null },
      { tipo: "advertencia", motivo: null, aprovadoEm: null },
    ])).toBeNull();
  });

  it("dia sem ocorrência nenhuma não tem situação", () => {
    expect(situacaoDoDia([])).toBeNull();
  });
});

describe("contagem de faltas", () => {
  it("conta por dia, não por linha", () => {
    // Duas faltas lançadas no mesmo dia são UM dia de ausência. Somar as linhas
    // inflaria o número que vai pro RH.
    const c = contarFaltas([
      { ...falta("injustificada"), dia: "2026-08-03" },
      { ...falta("injustificada"), dia: "2026-08-03" },
    ]);
    expect(c.total).toBe(1);
    expect(c.descontadas).toBe(1);
  });

  it("separa abonadas, descontadas e aguardando", () => {
    const c = contarFaltas([
      { ...falta("ferias"), dia: "2026-08-03" },
      { ...falta("injustificada"), dia: "2026-08-04" },
      { ...falta("atestado"), dia: "2026-08-05" },
      { ...falta("atestado", new Date()), dia: "2026-08-06" },
    ]);
    expect(c).toEqual({ total: 4, abonadas: 2, descontadas: 1, aguardando: 1 });
  });

  it("as partes sempre fecham com o total", () => {
    const c = contarFaltas([
      { ...falta("folga"), dia: "2026-08-01" },
      { ...falta("atestado"), dia: "2026-08-02" },
      { ...falta("injustificada"), dia: "2026-08-03" },
      { tipo: "elogio", motivo: null, aprovadoEm: null, dia: "2026-08-04" },
    ]);
    expect(c.abonadas + c.descontadas + c.aguardando).toBe(c.total);
    expect(c.total).toBe(3); // o elogio não é falta
  });

  it("conduta não entra na contagem de faltas", () => {
    const c = contarFaltas([
      { tipo: "advertencia", motivo: null, aprovadoEm: null, dia: "2026-08-01" },
      { tipo: "observacao", motivo: null, aprovadoEm: null, dia: "2026-08-02" },
    ]);
    expect(c.total).toBe(0);
  });
});

describe("exigências do formulário", () => {
  it("só falta pede motivo", () => {
    expect(exigeMotivo("falta")).toBe(true);
    for (const t of TIPOS_OCORRENCIA.filter((t) => t !== "falta")) {
      expect(exigeMotivo(t), t).toBe(false);
    }
  });

  it("atestado é o único motivo que depende de aprovação", () => {
    expect(dependeDeAprovacao("atestado")).toBe(true);
    for (const m of MOTIVOS_FALTA.filter((m) => m !== "atestado")) {
      expect(dependeDeAprovacao(m), m).toBe(false);
    }
  });
});
