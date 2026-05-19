/**
 * Tests do detector heurístico de prazos em movimentações processuais.
 *
 * O detector roda no cron a cada nova movimentação detectada. Falsos
 * positivos poluem o painel de alertas; falsos negativos perdemos prazo
 * (pior). Pra cobrir, testamos textos REAIS extraídos de movs do PJe
 * TJCE (alguns sanitizados pra remover identificadores).
 */

import { describe, it, expect } from "vitest";
import { detectarSugestaoPrazo } from "../processos/detector-prazos";

const dataBase = new Date("2026-05-19T00:00:00Z");

function ctx() {
  return { dataEvento: dataBase };
}

describe("detector-prazos — audiências com data explícita", () => {
  it("audiência designada para DD/MM/AAAA", () => {
    const r = detectarSugestaoPrazo(
      "AUDIÊNCIA DE CONCILIAÇÃO designada para 15/06/2026.",
      ctx(),
    );
    expect(r).not.toBeNull();
    expect(r!.tipo).toBe("audiencia");
    expect(r!.dataSugerida?.getMonth()).toBe(5); // junho (0-indexed)
    expect(r!.dataSugerida?.getDate()).toBe(15);
    expect(r!.dataSugerida?.getFullYear()).toBe(2026);
  });

  it("audiência com hora explícita", () => {
    const r = detectarSugestaoPrazo(
      "Audiência marcada para 20/07/2026 às 14:30",
      ctx(),
    );
    expect(r!.tipo).toBe("audiencia");
    expect(r!.dataSugerida?.getHours()).toBe(14);
    expect(r!.dataSugerida?.getMinutes()).toBe(30);
  });

  it("audiência com formato DD-MM-AAAA", () => {
    const r = detectarSugestaoPrazo(
      "audiencia aprazada em 10-08-2026",
      ctx(),
    );
    expect(r!.tipo).toBe("audiencia");
    expect(r!.dataSugerida?.getMonth()).toBe(7);
  });

  it("audiência com ano de 2 dígitos", () => {
    const r = detectarSugestaoPrazo(
      "Audiência designada para 30/12/26",
      ctx(),
    );
    expect(r!.dataSugerida?.getFullYear()).toBe(2026);
  });

  it("rejeita audiência muito no futuro (> 5 anos)", () => {
    const r = detectarSugestaoPrazo(
      "Audiência designada para 15/06/2099",
      ctx(),
    );
    expect(r).toBeNull();
  });

  it("rejeita data inválida (mês 13)", () => {
    const r = detectarSugestaoPrazo(
      "Audiência designada para 01/13/2026",
      ctx(),
    );
    expect(r).toBeNull();
  });
});

describe("detector-prazos — prazos com N dias", () => {
  it("prazo de réplica de 15 dias", () => {
    const r = detectarSugestaoPrazo(
      "Intime-se a parte autora para apresentar réplica no prazo de 15 dias.",
      ctx(),
    );
    expect(r).not.toBeNull();
    expect(r!.tipo).toBe("prazo_processual");
    expect(r!.titulo).toContain("Réplica");
    expect(r!.prazoDias).toBe(15);
  });

  it("contestação de 15 dias úteis", () => {
    const r = detectarSugestaoPrazo(
      "Cite-se a parte ré para apresentar contestação no prazo de 15 dias úteis.",
      ctx(),
    );
    expect(r!.tipo).toBe("prazo_processual");
    expect(r!.titulo).toContain("Contestação");
    expect(r!.prazoUteis).toBe(true);
  });

  it("recurso de 15 dias", () => {
    const r = detectarSugestaoPrazo(
      "Da decisão cabe recurso de apelação, no prazo de 15 dias.",
      ctx(),
    );
    expect(r!.titulo).toContain("Recurso");
  });

  it("embargos de declaração", () => {
    const r = detectarSugestaoPrazo(
      "Cabe interpor embargos de declaração no prazo de 5 dias.",
      ctx(),
    );
    expect(r!.titulo).toContain("Embargos");
    expect(r!.prazoDias).toBe(5);
  });

  it("manifestação", () => {
    const r = detectarSugestaoPrazo(
      "Manifeste-se a parte autora em 5 dias.",
      ctx(),
    );
    expect(r!.titulo).toContain("Manifestação");
    expect(r!.prazoDias).toBe(5);
  });

  it("intimação simples com prazo", () => {
    const r = detectarSugestaoPrazo(
      "Intimação. Prazo de 10 dias.",
      ctx(),
    );
    expect(r!.tipo).toBe("prazo_processual");
    expect(r!.titulo).toMatch(/Intima/i);
  });

  it("calcula data absoluta a partir da dataEvento", () => {
    const r = detectarSugestaoPrazo(
      "Réplica em 15 dias.",
      ctx(),
    );
    expect(r!.dataSugerida).not.toBeNull();
    const diff = (r!.dataSugerida!.getTime() - dataBase.getTime()) / (1000 * 60 * 60 * 24);
    expect(diff).toBeCloseTo(15, 0); // 15 dias corridos
  });

  it("rejeita prazos absurdos (> 180 dias)", () => {
    const r = detectarSugestaoPrazo(
      "Aguarde por 365 dias.",
      ctx(),
    );
    expect(r).toBeNull();
  });
});

describe("detector-prazos — sentença/acórdão (prazo recursal default)", () => {
  it("sentença publicada → 15 dias úteis recurso", () => {
    const r = detectarSugestaoPrazo(
      "Sentença publicada nesta data, na forma do CPC.",
      ctx(),
    );
    expect(r).not.toBeNull();
    expect(r!.tipo).toBe("prazo_processual");
    expect(r!.titulo).toContain("Recurso");
    expect(r!.prazoDias).toBe(15);
    expect(r!.prazoUteis).toBe(true);
    expect(r!.motivo).toMatch(/CPC|recursal/i);
  });

  it("acórdão proferido também aciona", () => {
    const r = detectarSugestaoPrazo(
      "Acórdão proferido em sessão virtual.",
      ctx(),
    );
    expect(r).not.toBeNull();
    expect(r!.titulo).toContain("Recurso");
  });
});

describe("detector-prazos — negativos (não deve falar)", () => {
  it("vazio", () => {
    expect(detectarSugestaoPrazo("", ctx())).toBeNull();
  });

  it("apenas \"juntada\"", () => {
    expect(detectarSugestaoPrazo("Juntada de petição", ctx())).toBeNull();
  });

  it("conclusão sem prazo explícito", () => {
    expect(detectarSugestaoPrazo("Conclusão.", ctx())).toBeNull();
  });

  it("redistribuição interna", () => {
    expect(
      detectarSugestaoPrazo("Processo redistribuído por dependência.", ctx()),
    ).toBeNull();
  });

  it("texto muito curto", () => {
    expect(detectarSugestaoPrazo("ok", ctx())).toBeNull();
  });

  it("número solto não é prazo", () => {
    expect(detectarSugestaoPrazo("Houve 50 protocolos no dia.", ctx())).toBeNull();
  });
});

describe("detector-prazos — trecho de origem", () => {
  it("inclui trecho contextual pra mostrar na UI", () => {
    const texto =
      "Bloco anterior. Intime-se a parte autora para apresentar réplica no prazo de 15 dias. Bloco posterior.";
    const r = detectarSugestaoPrazo(texto, ctx());
    expect(r!.trechoOrigem).toContain("réplica");
    expect(r!.trechoOrigem.length).toBeLessThanOrEqual(220);
  });
});
