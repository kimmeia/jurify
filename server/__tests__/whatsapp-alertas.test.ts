import { describe, it, expect } from "vitest";
import { avaliarTransicaoSaude } from "../integracoes/whatsapp-alertas";

describe("avaliarTransicaoSaude — alertas só em TRANSIÇÃO", () => {
  it("GREEN → YELLOW gera alerta de degradação", () => {
    const alertas = avaliarTransicaoSaude({ qualidadeAnterior: "GREEN", qualidadeNova: "YELLOW" });
    expect(alertas).toHaveLength(1);
    expect(alertas[0].titulo).toContain("AMARELO");
  });

  it("YELLOW → RED gera alerta vermelho (proativos pausados)", () => {
    const alertas = avaliarTransicaoSaude({ qualidadeAnterior: "YELLOW", qualidadeNova: "RED" });
    expect(alertas).toHaveLength(1);
    expect(alertas[0].titulo).toContain("VERMELHO");
    expect(alertas[0].mensagem).toContain("pausados");
  });

  it("RED → GREEN gera alerta de recuperação", () => {
    const alertas = avaliarTransicaoSaude({ qualidadeAnterior: "RED", qualidadeNova: "GREEN" });
    expect(alertas).toHaveLength(1);
    expect(alertas[0].titulo).toContain("verde");
  });

  it("mesmo valor persistido de novo = silêncio (health-check horário não vira spam)", () => {
    expect(avaliarTransicaoSaude({ qualidadeAnterior: "YELLOW", qualidadeNova: "YELLOW" })).toHaveLength(0);
    expect(avaliarTransicaoSaude({ qualidadeAnterior: "GREEN", qualidadeNova: "GREEN" })).toHaveLength(0);
  });

  it("primeira leitura GREEN (sem anterior) não alerta", () => {
    expect(avaliarTransicaoSaude({ qualidadeAnterior: null, qualidadeNova: "GREEN" })).toHaveLength(0);
  });

  it("rebaixamento de tier alerta; upgrade não", () => {
    const down = avaliarTransicaoSaude({
      qualidadeAnterior: "GREEN",
      qualidadeNova: "GREEN",
      tierAnterior: "TIER_1K",
      tierNovo: "TIER_250",
    });
    expect(down).toHaveLength(1);
    expect(down[0].titulo).toContain("rebaixado");

    const up = avaliarTransicaoSaude({
      qualidadeAnterior: "GREEN",
      qualidadeNova: "GREEN",
      tierAnterior: "TIER_250",
      tierNovo: "TIER_1K",
    });
    expect(up).toHaveLength(0);
  });

  it("queda de qualidade + rebaixamento de tier no mesmo evento = 2 alertas", () => {
    const alertas = avaliarTransicaoSaude({
      qualidadeAnterior: "GREEN",
      qualidadeNova: "RED",
      tierAnterior: "TIER_1K",
      tierNovo: "TIER_250",
    });
    expect(alertas).toHaveLength(2);
  });
});
