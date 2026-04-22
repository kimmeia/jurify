/**
 * Testes dos predicados puros usados pelo dispatcher do SmartFlow.
 *
 * Cobre os três gatilhos novos introduzidos nesta sprint:
 *  - `mensagem_canal` (filtro por canal configurado)
 *  - `pagamento_vencido` (threshold mínimo de dias de atraso)
 *  - `pagamento_proximo_vencimento` (antecedência máxima em dias)
 *
 * E o dedupe que protege contra dispositivos duplicados na janela de 24h
 * (quando webhook PAYMENT_OVERDUE do Asaas concorre com o cobranças-scheduler).
 */

import { describe, it, expect } from "vitest";
import {
  aceitaCanal,
  acharSlotAtivo,
  calcularMomentoLembrete,
  calcularSlotsDoDia,
  chaveDiaLocal,
  contextoContemPagamento,
  contextoContemSlot,
  deveDispararLembrete,
  deveDispararProximo,
  deveDispararVencido,
  diasEntre,
  parseHoraHHMM,
  parseVencimento,
  slotTimestampChave,
  temHorarioConfigurado,
} from "../smartflow/dispatcher-helpers";

describe("aceitaCanal (gatilho mensagem_canal)", () => {
  it("aceita qualquer canal quando config.canais está vazio", () => {
    expect(aceitaCanal({}, "whatsapp_qr")).toBe(true);
    expect(aceitaCanal({ canais: [] }, "whatsapp_api")).toBe(true);
    expect(aceitaCanal(undefined, "instagram")).toBe(true);
  });

  it("filtra por canal quando canais está populado", () => {
    const cfg = { canais: ["whatsapp_qr" as const] };
    expect(aceitaCanal(cfg, "whatsapp_qr")).toBe(true);
    expect(aceitaCanal(cfg, "whatsapp_api")).toBe(false);
    expect(aceitaCanal(cfg, "instagram")).toBe(false);
  });

  it("aceita múltiplos canais simultâneos", () => {
    const cfg = { canais: ["whatsapp_qr" as const, "whatsapp_api" as const] };
    expect(aceitaCanal(cfg, "whatsapp_qr")).toBe(true);
    expect(aceitaCanal(cfg, "whatsapp_api")).toBe(true);
    expect(aceitaCanal(cfg, "facebook")).toBe(false);
  });
});

describe("deveDispararVencido (gatilho pagamento_vencido)", () => {
  it("dispara imediatamente quando diasAtraso=0 (default)", () => {
    expect(deveDispararVencido({}, 0)).toBe(true);
    expect(deveDispararVencido({}, 1)).toBe(true);
    expect(deveDispararVencido(undefined, 5)).toBe(true);
  });

  it("respeita o threshold configurado", () => {
    const cfg = { diasAtraso: 3 };
    expect(deveDispararVencido(cfg, 2)).toBe(false);
    expect(deveDispararVencido(cfg, 3)).toBe(true);
    expect(deveDispararVencido(cfg, 10)).toBe(true);
  });

  it("normaliza valores negativos para 0", () => {
    // um admin poderia digitar -1 — o predicado não explode, trata como 0
    expect(deveDispararVencido({ diasAtraso: -5 }, 0)).toBe(true);
  });
});

describe("deveDispararProximo (gatilho pagamento_proximo_vencimento)", () => {
  it("ignora pagamentos já vencidos (diasAteVencer < 0)", () => {
    expect(deveDispararProximo({ diasAntes: 3 }, -1)).toBe(false);
    expect(deveDispararProximo({ diasAntes: 10 }, -5)).toBe(false);
  });

  it("dispara dentro da janela configurada", () => {
    const cfg = { diasAntes: 3 };
    expect(deveDispararProximo(cfg, 0)).toBe(true); // vence hoje
    expect(deveDispararProximo(cfg, 3)).toBe(true); // no limite
    expect(deveDispararProximo(cfg, 4)).toBe(false);
  });

  it("usa default 3 quando diasAntes não está configurado", () => {
    expect(deveDispararProximo({}, 2)).toBe(true);
    expect(deveDispararProximo({}, 3)).toBe(true);
    expect(deveDispararProximo({}, 4)).toBe(false);
  });
});

describe("contextoContemPagamento (dedupe)", () => {
  it("reconhece pagamentoId no JSON serializado", () => {
    const ctx = JSON.stringify({
      mensagem: "Cobrança vencida",
      pagamentoId: "pay_abc123",
      diasAtraso: 5,
    });
    expect(contextoContemPagamento(ctx, "pay_abc123")).toBe(true);
  });

  it("não dá falso positivo com IDs parecidos", () => {
    const ctx = JSON.stringify({ pagamentoId: "pay_abc123_extra" });
    // LIKE parcial poderia dar false-positive, mas como cercamos com aspas
    // na chave+valor exatos, o match é exato:
    expect(contextoContemPagamento(ctx, "pay_abc123")).toBe(false);
    expect(contextoContemPagamento(ctx, "pay_abc123_extra")).toBe(true);
  });

  it("retorna false pra contexto vazio ou sem o campo", () => {
    expect(contextoContemPagamento(null, "pay_x")).toBe(false);
    expect(contextoContemPagamento("", "pay_x")).toBe(false);
    expect(contextoContemPagamento(JSON.stringify({}), "pay_x")).toBe(false);
    expect(contextoContemPagamento(JSON.stringify({ outroId: "pay_x" }), "pay_x")).toBe(false);
  });
});

describe("diasEntre / parseVencimento", () => {
  it("diasEntre calcula dias civis no fuso (default Sao_Paulo)", () => {
    const hoje = new Date("2026-04-20T15:00:00Z"); // 12:00 BRT de 20-abr
    const ontem = new Date("2026-04-19T15:00:00Z"); // 12:00 BRT de 19-abr
    const semanaAtras = new Date("2026-04-13T15:00:00Z");
    expect(diasEntre(hoje, ontem)).toBe(1);
    expect(diasEntre(hoje, semanaAtras)).toBe(7);
    expect(diasEntre(ontem, hoje)).toBe(-1);
  });

  it("diasEntre: 22-abr 01:00 UTC é véspera em BRT — ainda 0 dias de atraso", () => {
    const agora = new Date("2026-04-22T01:00:00Z"); // 22:00 BRT de 21-abr
    const venc = parseVencimento("2026-04-21", "America/Sao_Paulo")!;
    expect(diasEntre(agora, venc, "America/Sao_Paulo")).toBe(0);
  });

  it("diasEntre: 22-abr 04:00 UTC (01:00 BRT de 22) — 1 dia de atraso em BRT", () => {
    const agora = new Date("2026-04-22T04:00:00Z");
    const venc = parseVencimento("2026-04-21", "America/Sao_Paulo")!;
    expect(diasEntre(agora, venc, "America/Sao_Paulo")).toBe(1);
  });

  it("parseVencimento retorna meia-noite do dia no fuso informado", () => {
    const d = parseVencimento("2026-04-30", "America/Sao_Paulo");
    expect(d).not.toBeNull();
    // 00:00 BRT de 30-abr = 03:00 UTC de 30-abr.
    expect(d!.toISOString()).toBe("2026-04-30T03:00:00.000Z");
  });

  it("parseVencimento em UTC vira meia-noite UTC", () => {
    const d = parseVencimento("2026-04-30", "UTC");
    expect(d!.toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });

  it("parseVencimento devolve null para inputs inválidos", () => {
    expect(parseVencimento(null)).toBeNull();
    expect(parseVencimento("")).toBeNull();
    expect(parseVencimento("data-invalida")).toBeNull();
  });
});

describe("parseHoraHHMM", () => {
  it("aceita formatos válidos", () => {
    expect(parseHoraHHMM("09:00")).toEqual({ h: 9, m: 0 });
    expect(parseHoraHHMM("9:05")).toEqual({ h: 9, m: 5 });
    expect(parseHoraHHMM("23:59")).toEqual({ h: 23, m: 59 });
    expect(parseHoraHHMM("00:00")).toEqual({ h: 0, m: 0 });
  });

  it("rejeita inválidos", () => {
    expect(parseHoraHHMM("")).toBeNull();
    expect(parseHoraHHMM(null)).toBeNull();
    expect(parseHoraHHMM("24:00")).toBeNull();
    expect(parseHoraHHMM("10:60")).toBeNull();
    expect(parseHoraHHMM("abc")).toBeNull();
    expect(parseHoraHHMM("12")).toBeNull();
  });
});

describe("temHorarioConfigurado", () => {
  it("só é true quando horarioInicial é válido", () => {
    expect(temHorarioConfigurado({ horarioInicial: "09:00" })).toBe(true);
    expect(temHorarioConfigurado({ horarioInicial: "09:00", disparosPorDia: 3 })).toBe(true);
    expect(temHorarioConfigurado({})).toBe(false);
    expect(temHorarioConfigurado(undefined)).toBe(false);
    expect(temHorarioConfigurado({ horarioInicial: "" })).toBe(false);
    expect(temHorarioConfigurado({ horarioInicial: "lixo" })).toBe(false);
  });
});

describe("calcularSlotsDoDia", () => {
  // Base: meia-noite BRT de 2026-04-20 = 03:00 UTC.
  const baseBrt = new Date("2026-04-20T03:00:00Z");

  it("retorna 1 slot quando disparosPorDia é default (1)", () => {
    const slots = calcularSlotsDoDia({ horarioInicial: "09:00" }, baseBrt, "America/Sao_Paulo");
    expect(slots).toHaveLength(1);
    // 09:00 BRT = 12:00 UTC.
    expect(slots[0].toISOString()).toBe("2026-04-20T12:00:00.000Z");
  });

  it("espalha N slots pelo intervaloMinutos", () => {
    const slots = calcularSlotsDoDia(
      { horarioInicial: "09:00", disparosPorDia: 3, intervaloMinutos: 120 },
      baseBrt,
      "America/Sao_Paulo",
    );
    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-04-20T12:00:00.000Z",
      "2026-04-20T14:00:00.000Z",
      "2026-04-20T16:00:00.000Z",
    ]);
  });

  it("intervalo de 90min com primeiro às 08:30", () => {
    const slots = calcularSlotsDoDia(
      { horarioInicial: "08:30", disparosPorDia: 2, intervaloMinutos: 90 },
      baseBrt,
      "America/Sao_Paulo",
    );
    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-04-20T11:30:00.000Z",
      "2026-04-20T13:00:00.000Z",
    ]);
  });

  it("retorna vazio quando horarioInicial ausente/inválido", () => {
    expect(calcularSlotsDoDia({}, baseBrt, "America/Sao_Paulo")).toEqual([]);
    expect(calcularSlotsDoDia({ horarioInicial: "lixo" }, baseBrt, "America/Sao_Paulo")).toEqual([]);
    expect(calcularSlotsDoDia(undefined, baseBrt, "America/Sao_Paulo")).toEqual([]);
  });

  it("BUG DO USER: horarioInicial=00:01 em Sao_Paulo vira 03:01 UTC (não 00:01 UTC)", () => {
    // Se o scheduler interpretasse em UTC, o slot seria 00:01 UTC — aí o
    // tick das 00:15 UTC (21:15 Fortaleza véspera) disparava errado.
    const slots = calcularSlotsDoDia(
      { horarioInicial: "00:01" },
      new Date("2026-04-22T03:00:00Z"), // meia-noite BRT de 22-abr
      "America/Sao_Paulo",
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].toISOString()).toBe("2026-04-22T03:01:00.000Z");
  });

  it("mesmo horario em UTC explícito mantém comportamento antigo", () => {
    const slots = calcularSlotsDoDia(
      { horarioInicial: "00:01" },
      new Date("2026-04-22T00:00:00Z"),
      "UTC",
    );
    expect(slots[0].toISOString()).toBe("2026-04-22T00:01:00.000Z");
  });
});

describe("acharSlotAtivo", () => {
  // Slots 09:00/11:00/13:00 BRT = 12:00/14:00/16:00 UTC de 2026-04-20.
  const baseBrt = new Date("2026-04-20T03:00:00Z");
  const slots = calcularSlotsDoDia(
    { horarioInicial: "09:00", disparosPorDia: 3, intervaloMinutos: 120 },
    baseBrt,
    "America/Sao_Paulo",
  );

  it("acha o slot se agora estiver na janela de tolerância", () => {
    // Tick 09:05 BRT = 12:05 UTC. Slot 09:00 BRT = 12:00 UTC. Janela 15min bate.
    const agora = new Date("2026-04-20T12:05:00Z");
    const achado = acharSlotAtivo(slots, agora, 15);
    expect(achado?.toISOString()).toBe("2026-04-20T12:00:00.000Z");
  });

  it("ignora slot já passado há muito tempo", () => {
    const agora = new Date("2026-04-20T13:00:00Z"); // 60min depois do slot 12:00
    expect(acharSlotAtivo(slots, agora, 15)).toBeNull();
  });

  it("ignora slot futuro (agora < slot)", () => {
    const agora = new Date("2026-04-20T11:45:00Z");
    expect(acharSlotAtivo(slots, agora, 15)).toBeNull();
  });

  it("escolhe o slot mais recente quando vários caem na janela", () => {
    const agora = new Date("2026-04-20T14:05:00Z"); // 11:05 BRT
    const achado = acharSlotAtivo(slots, agora, 300);
    expect(achado?.toISOString()).toBe("2026-04-20T14:00:00.000Z"); // slot 11:00 BRT
  });

  it("BUG DO USER: tick 00:15 UTC não atende horário 00:01 BRT", () => {
    // 22-abr 00:15 UTC = 21-abr 21:15 BRT (Fortaleza). O slot real de "00:01
    // BRT de 22-abr" é 03:01 UTC — completamente fora da janela.
    const slotsBr = calcularSlotsDoDia(
      { horarioInicial: "00:01" },
      new Date("2026-04-22T03:00:00Z"),
      "America/Sao_Paulo",
    );
    const agora = new Date("2026-04-22T00:15:00Z");
    expect(acharSlotAtivo(slotsBr, agora, 15)).toBeNull();
  });

  it("BUG DO USER: tick 03:15 UTC atende horário 00:01 BRT (=00:15 BRT)", () => {
    const slotsBr = calcularSlotsDoDia(
      { horarioInicial: "00:01" },
      new Date("2026-04-22T03:00:00Z"),
      "America/Sao_Paulo",
    );
    const agora = new Date("2026-04-22T03:15:00Z");
    expect(acharSlotAtivo(slotsBr, agora, 15)?.toISOString()).toBe(
      "2026-04-22T03:01:00.000Z",
    );
  });
});

describe("slotTimestampChave / contextoContemSlot", () => {
  it("gera chave estável YYYY-MM-DDTHH:MM no fuso informado", () => {
    // 12:00 UTC de 22-abr = 09:00 BRT.
    const slot = new Date("2026-04-22T12:00:00Z");
    expect(slotTimestampChave(slot, "America/Sao_Paulo")).toBe("2026-04-22T09:00");
    expect(slotTimestampChave(slot, "UTC")).toBe("2026-04-22T12:00");
  });

  it("slot 03:01 UTC (00:01 BRT) gera chave coerente com o horário do user", () => {
    const slot = new Date("2026-04-22T03:01:00Z");
    expect(slotTimestampChave(slot, "America/Sao_Paulo")).toBe("2026-04-22T00:01");
  });

  it("contextoContemSlot faz match exato do slot", () => {
    const ctx = JSON.stringify({ pagamentoId: "abc", slotTimestamp: "2026-04-22T09:00" });
    expect(contextoContemSlot(ctx, "2026-04-22T09:00")).toBe(true);
    expect(contextoContemSlot(ctx, "2026-04-22T11:00")).toBe(false);
    expect(contextoContemSlot(null, "2026-04-22T09:00")).toBe(false);
    expect(contextoContemSlot(JSON.stringify({}), "2026-04-22T09:00")).toBe(false);
  });

  it("não faz match de slot em contexto com pagamentoId só", () => {
    // Dedupe por slot não deve confundir com dedupe por pagamentoId.
    const ctx = JSON.stringify({ pagamentoId: "abc" });
    expect(contextoContemSlot(ctx, "2026-04-22T09:00")).toBe(false);
  });
});

describe("chaveDiaLocal", () => {
  it("formata YYYY-MM-DD no fuso informado", () => {
    // 02:30 UTC de 22-abr = 23:30 BRT de 21-abr.
    const d = new Date("2026-04-22T02:30:00Z");
    expect(chaveDiaLocal(d, "America/Sao_Paulo")).toBe("2026-04-21");
    expect(chaveDiaLocal(d, "UTC")).toBe("2026-04-22");
  });
});

describe("calcularMomentoLembrete / deveDispararLembrete", () => {
  it("1 dia antes às 18:00 (default) em Sao_Paulo", () => {
    // Booking 14:00 UTC de 22-abr = 11:00 BRT. Lembrete default: dia
    // anterior às 18:00 local = 21-abr 21:00 UTC.
    const startTime = new Date("2026-04-22T14:00:00Z");
    const momento = calcularMomentoLembrete(startTime, {}, "America/Sao_Paulo")!;
    expect(momento.toISOString()).toBe("2026-04-21T21:00:00.000Z");
  });

  it("2 dias antes às 09:30 em Sao_Paulo", () => {
    const startTime = new Date("2026-04-22T14:00:00Z");
    const momento = calcularMomentoLembrete(
      startTime,
      { diasAntes: 2, horario: "09:30" },
      "America/Sao_Paulo",
    )!;
    // 20-abr 09:30 BRT = 12:30 UTC.
    expect(momento.toISOString()).toBe("2026-04-20T12:30:00.000Z");
  });

  it("em UTC: 1 dia antes às 18:00 = 21-abr 18:00 UTC", () => {
    const startTime = new Date("2026-04-22T14:00:00Z");
    const momento = calcularMomentoLembrete(startTime, {}, "UTC")!;
    expect(momento.toISOString()).toBe("2026-04-21T18:00:00.000Z");
  });

  it("deveDispararLembrete respeita a janela no fuso", () => {
    const startTime = new Date("2026-04-22T14:00:00Z"); // 11:00 BRT de 22
    // Lembrete default: 21-abr 18:00 BRT = 21-abr 21:00 UTC.
    // Tick 21:10 UTC → dentro da tolerância de 15min.
    expect(
      deveDispararLembrete(
        startTime,
        {},
        new Date("2026-04-21T21:10:00Z"),
        15,
        "America/Sao_Paulo",
      ),
    ).toBe(true);
    // Tick 20:40 UTC → ainda não alcançou.
    expect(
      deveDispararLembrete(
        startTime,
        {},
        new Date("2026-04-21T20:40:00Z"),
        15,
        "America/Sao_Paulo",
      ),
    ).toBe(false);
    // Tick 22:00 UTC → passou 60min, fora da janela.
    expect(
      deveDispararLembrete(
        startTime,
        {},
        new Date("2026-04-21T22:00:00Z"),
        15,
        "America/Sao_Paulo",
      ),
    ).toBe(false);
  });
});
