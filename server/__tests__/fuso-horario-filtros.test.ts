/**
 * Testes do bug #7 — filtros de data na agenda perdiam compromissos do dia
 * por interpretar `new Date("2026-05-17")` como UTC.
 *
 * Servidor Railway/AWS roda em UTC. `new Date("2026-05-17")` cria o
 * instante `2026-05-17T00:00:00Z` UTC — que em São Paulo (UTC-3) é
 * `2026-05-16T21:00:00 BRT`. O filtro `gte(dataInicio, new Date("2026-05-17"))`
 * incluía eventos do dia 16/05 às 22h em "dia 17", e perdia o dia 17 inteiro
 * porque o `lte(dataInicio, new Date("2026-05-17"))` cortava em 21h BRT do
 * dia 16. Pior em Manaus (UTC-4): falha começava às 20h local.
 *
 * Fix: helpers `inicioDoDiaNoFuso` e `fimDoDiaNoFuso` interpretam YYYY-MM-DD
 * como dia local NO FUSO DO ESCRITÓRIO (lido de `escritorios.fusoHorario`).
 */

import { describe, it, expect } from "vitest";
import {
  inicioDoDiaNoFuso,
  fimDoDiaNoFuso,
  dataHojeBR,
  FUSO_HORARIO_PADRAO,
} from "../../shared/escritorio-types";

describe("inicioDoDiaNoFuso — fusos brasileiros oficiais", () => {
  it("America/Sao_Paulo (UTC-3) → 00h BRT = 03h UTC", () => {
    const d = inicioDoDiaNoFuso("2026-05-17", "America/Sao_Paulo");
    expect(d.toISOString()).toBe("2026-05-17T03:00:00.000Z");
  });

  it("America/Manaus (UTC-4) → 00h AMT = 04h UTC", () => {
    const d = inicioDoDiaNoFuso("2026-05-17", "America/Manaus");
    expect(d.toISOString()).toBe("2026-05-17T04:00:00.000Z");
  });

  it("America/Rio_Branco (UTC-5) → 00h ACT = 05h UTC", () => {
    const d = inicioDoDiaNoFuso("2026-05-17", "America/Rio_Branco");
    expect(d.toISOString()).toBe("2026-05-17T05:00:00.000Z");
  });

  it("America/Noronha (UTC-2) → 00h FNT = 02h UTC", () => {
    const d = inicioDoDiaNoFuso("2026-05-17", "America/Noronha");
    expect(d.toISOString()).toBe("2026-05-17T02:00:00.000Z");
  });

  it("default (sem tz) usa America/Sao_Paulo", () => {
    const d = inicioDoDiaNoFuso("2026-05-17");
    expect(d.toISOString()).toBe("2026-05-17T03:00:00.000Z");
    expect(FUSO_HORARIO_PADRAO).toBe("America/Sao_Paulo");
  });
});

describe("fimDoDiaNoFuso — fusos brasileiros oficiais", () => {
  it("America/Sao_Paulo → 23:59:59.999 BRT = 02:59:59.999 UTC do dia seguinte", () => {
    const d = fimDoDiaNoFuso("2026-05-17", "America/Sao_Paulo");
    expect(d.toISOString()).toBe("2026-05-18T02:59:59.999Z");
  });

  it("America/Manaus → 23:59:59.999 AMT = 03:59:59.999 UTC do dia seguinte", () => {
    const d = fimDoDiaNoFuso("2026-05-17", "America/Manaus");
    expect(d.toISOString()).toBe("2026-05-18T03:59:59.999Z");
  });

  it("America/Rio_Branco → 23:59:59.999 ACT = 04:59:59.999 UTC do dia seguinte", () => {
    const d = fimDoDiaNoFuso("2026-05-17", "America/Rio_Branco");
    expect(d.toISOString()).toBe("2026-05-18T04:59:59.999Z");
  });

  it("America/Noronha → 23:59:59.999 FNT = 01:59:59.999 UTC do dia seguinte", () => {
    const d = fimDoDiaNoFuso("2026-05-17", "America/Noronha");
    expect(d.toISOString()).toBe("2026-05-18T01:59:59.999Z");
  });
});

describe("inicio/fim no mesmo dia formam janela de 24h", () => {
  it("America/Sao_Paulo: fim - inicio = 24h - 1ms", () => {
    const inicio = inicioDoDiaNoFuso("2026-05-17", "America/Sao_Paulo");
    const fim = fimDoDiaNoFuso("2026-05-17", "America/Sao_Paulo");
    const diff = fim.getTime() - inicio.getTime();
    expect(diff).toBe(86400000 - 1);
  });

  it("America/Manaus: fim - inicio = 24h - 1ms", () => {
    const inicio = inicioDoDiaNoFuso("2026-05-17", "America/Manaus");
    const fim = fimDoDiaNoFuso("2026-05-17", "America/Manaus");
    const diff = fim.getTime() - inicio.getTime();
    expect(diff).toBe(86400000 - 1);
  });
});

describe("Edge cases — viradas de mês/ano", () => {
  it("31/12 → 01/01 (virada de ano)", () => {
    const inicio = inicioDoDiaNoFuso("2026-12-31", "America/Sao_Paulo");
    expect(inicio.toISOString()).toBe("2026-12-31T03:00:00.000Z");

    const fim = fimDoDiaNoFuso("2026-12-31", "America/Sao_Paulo");
    // Fim do dia 31/12/2026 BRT = 23:59:59.999 BRT = 02:59:59.999 UTC do 01/01/2027
    expect(fim.toISOString()).toBe("2027-01-01T02:59:59.999Z");
  });

  it("28/02 ano bissexto (2024 bissexto, 29/02 existe)", () => {
    const d = inicioDoDiaNoFuso("2024-02-29", "America/Sao_Paulo");
    expect(d.toISOString()).toBe("2024-02-29T03:00:00.000Z");
  });

  it("28/02 ano não-bissexto (2026 não-bissexto, 29/02 não existe)", () => {
    // 29/02/2026 não existe, mas a função apenas faz Date.UTC(2026, 1, 29)
    // que JavaScript normaliza para 01/03/2026. Comportamento aceitável —
    // input inválido vira data válida (não throw, não null).
    const d = inicioDoDiaNoFuso("2026-02-29", "America/Sao_Paulo");
    // Esperado: vira 01/03/2026 03:00 UTC
    expect(d.toISOString()).toBe("2026-03-01T03:00:00.000Z");
  });

  it("yyyy-mm-dd inválido lança Error", () => {
    expect(() => inicioDoDiaNoFuso("not-a-date", "America/Sao_Paulo")).toThrow();
    expect(() => fimDoDiaNoFuso("", "America/Sao_Paulo")).toThrow();
  });
});

describe("Regressão direta do bug #7 — filtro de UM dia inclui eventos das 10h BR", () => {
  it("filtro dataInicio=dataFim='2026-05-17' inclui compromisso das 10h BRT", () => {
    // Compromisso criado pelo usuário: dia 17/05/2026 às 10h BRT
    // MySQL armazena em UTC: 10h BRT = 13h UTC → 2026-05-17T13:00:00Z
    const compromisso = new Date("2026-05-17T13:00:00.000Z");

    const inicio = inicioDoDiaNoFuso("2026-05-17", "America/Sao_Paulo");
    const fim = fimDoDiaNoFuso("2026-05-17", "America/Sao_Paulo");

    // O filtro DEVE incluir o compromisso (inicio <= compromisso <= fim)
    expect(compromisso.getTime()).toBeGreaterThanOrEqual(inicio.getTime());
    expect(compromisso.getTime()).toBeLessThanOrEqual(fim.getTime());
  });

  it("filtro dia 17 em SP NÃO inclui compromisso das 22h BRT do dia 16 (não vaza pra trás)", () => {
    // Compromisso: dia 16/05 às 22h BRT = 17/05 01h UTC
    const compromissoDia16Tarde = new Date("2026-05-17T01:00:00.000Z");

    const inicio = inicioDoDiaNoFuso("2026-05-17", "America/Sao_Paulo");
    // inicio = 17/05 03h UTC = 00h BRT
    // compromisso = 17/05 01h UTC = 16/05 22h BRT → MENOR que inicio
    expect(compromissoDia16Tarde.getTime()).toBeLessThan(inicio.getTime());
  });

  it("filtro dia 17 em SP NÃO inclui compromisso da 01h BRT do dia 18 (não vaza pra frente)", () => {
    // Compromisso: dia 18/05 às 01h BRT = 18/05 04h UTC
    const compromissoDia18Inicio = new Date("2026-05-18T04:00:00.000Z");

    const fim = fimDoDiaNoFuso("2026-05-17", "America/Sao_Paulo");
    // fim = 18/05 02:59:59.999 UTC = 23:59:59.999 BRT do dia 17
    // compromisso = 18/05 04h UTC = 18/05 01h BRT → MAIOR que fim
    expect(compromissoDia18Inicio.getTime()).toBeGreaterThan(fim.getTime());
  });

  it("Manaus (UTC-4): janela 1 dia tem 24h exatas pro fuso correto", () => {
    // Operador em Manaus filtra dia 17. Compromisso criado em Manaus às
    // 10h AMT = 14h UTC.
    const compromissoAMT = new Date("2026-05-17T14:00:00.000Z");

    const inicio = inicioDoDiaNoFuso("2026-05-17", "America/Manaus");
    const fim = fimDoDiaNoFuso("2026-05-17", "America/Manaus");

    expect(compromissoAMT.getTime()).toBeGreaterThanOrEqual(inicio.getTime());
    expect(compromissoAMT.getTime()).toBeLessThanOrEqual(fim.getTime());
  });

  it("Fuso ERRADO no filtro deixaria escapar — prova que o tz importa", () => {
    // Mesmo compromisso: 17/05 às 22h Manaus = 18/05 02h UTC
    const compromisso = new Date("2026-05-18T02:00:00.000Z");

    // Se filtrarmos com fuso de Manaus pra 17/05, o compromisso ESTÁ no dia
    const fimManaus = fimDoDiaNoFuso("2026-05-17", "America/Manaus");
    expect(compromisso.getTime()).toBeLessThanOrEqual(fimManaus.getTime());

    // Mas se filtrarmos com fuso de SP pra 17/05 (errado pra operador
    // de Manaus), o compromisso ficaria FORA — bug se o sistema usasse
    // fuso fixo em vez do escolhido pelo escritório.
    const fimSP = fimDoDiaNoFuso("2026-05-17", "America/Sao_Paulo");
    // fimSP = 18/05 02:59:59.999 UTC, compromisso = 18/05 02:00:00 UTC
    // Nesse caso específico está DENTRO de SP também, mas se fosse
    // compromisso às 23h59 AMT = 03h59 UTC, ficaria fora de SP:
    const compromissoTarde = new Date("2026-05-18T03:30:00.000Z");
    expect(compromissoTarde.getTime()).toBeGreaterThan(fimSP.getTime());
    expect(compromissoTarde.getTime()).toBeLessThanOrEqual(fimManaus.getTime());
  });
});

describe("dataHojeBR — compatibilidade preservada (helper antigo continua funcionando)", () => {
  it("retorna YYYY-MM-DD válido", () => {
    const hoje = dataHojeBR("America/Sao_Paulo");
    expect(hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("inicioDoDiaNoFuso(dataHojeBR(tz), tz) <= agora <= fimDoDiaNoFuso(dataHojeBR(tz), tz)", () => {
    const tz = "America/Sao_Paulo";
    const agora = new Date();
    const inicio = inicioDoDiaNoFuso(dataHojeBR(tz), tz);
    const fim = fimDoDiaNoFuso(dataHojeBR(tz), tz);
    expect(agora.getTime()).toBeGreaterThanOrEqual(inicio.getTime());
    expect(agora.getTime()).toBeLessThanOrEqual(fim.getTime());
  });
});
