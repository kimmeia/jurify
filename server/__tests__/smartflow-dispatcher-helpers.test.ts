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
  dateNoFuso,
  deveDispararLembrete,
  deveDispararProximo,
  deveDispararVencido,
  diasEntre,
  parseHoraHHMM,
  parseVencimento,
  slotTimestampChave,
  temHorarioConfigurado,
  ymdNoFuso,
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
  it("diasEntre calcula dias inteiros", () => {
    const hoje = new Date("2026-04-20T12:00:00");
    const ontem = new Date("2026-04-19T12:00:00");
    const semanaAtras = new Date("2026-04-13T12:00:00");
    expect(diasEntre(hoje, ontem)).toBe(1);
    expect(diasEntre(hoje, semanaAtras)).toBe(7);
    expect(diasEntre(ontem, hoje)).toBe(-1);
  });

  it("parseVencimento aceita formato ISO do Asaas (YYYY-MM-DD)", () => {
    const d = parseVencimento("2026-04-30");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(3); // abril = 3
    expect(d!.getDate()).toBe(30);
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
  const base = new Date("2026-04-20T00:00:00");

  it("retorna 1 slot quando disparosPorDia é default (1)", () => {
    const slots = calcularSlotsDoDia({ horarioInicial: "09:00" }, base);
    expect(slots).toHaveLength(1);
    expect(slots[0].getHours()).toBe(9);
    expect(slots[0].getMinutes()).toBe(0);
  });

  it("espalha N slots pelo intervaloMinutos", () => {
    const slots = calcularSlotsDoDia(
      { horarioInicial: "09:00", disparosPorDia: 3, intervaloMinutos: 120 },
      base,
    );
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => `${s.getHours()}:${s.getMinutes()}`)).toEqual([
      "9:0",
      "11:0",
      "13:0",
    ]);
  });

  it("intervalo de 90min também funciona", () => {
    const slots = calcularSlotsDoDia(
      { horarioInicial: "08:30", disparosPorDia: 2, intervaloMinutos: 90 },
      base,
    );
    expect(slots).toHaveLength(2);
    expect(slots[0].getHours()).toBe(8);
    expect(slots[0].getMinutes()).toBe(30);
    expect(slots[1].getHours()).toBe(10);
    expect(slots[1].getMinutes()).toBe(0);
  });

  it("retorna vazio quando horarioInicial ausente/inválido", () => {
    expect(calcularSlotsDoDia({}, base)).toEqual([]);
    expect(calcularSlotsDoDia({ horarioInicial: "lixo" }, base)).toEqual([]);
    expect(calcularSlotsDoDia(undefined, base)).toEqual([]);
  });
});

describe("acharSlotAtivo", () => {
  const base = new Date("2026-04-20T00:00:00");
  const slots = calcularSlotsDoDia(
    { horarioInicial: "09:00", disparosPorDia: 3, intervaloMinutos: 120 },
    base,
  );

  it("acha o slot se agora estiver na janela de tolerância", () => {
    // Scheduler roda 09:05, tolerância 15min → slot 09:00 bate
    const agora = new Date("2026-04-20T09:05:00");
    expect(acharSlotAtivo(slots, agora, 15)).not.toBeNull();
    expect(acharSlotAtivo(slots, agora, 15)!.getHours()).toBe(9);
  });

  it("ignora slot já passado há muito tempo", () => {
    // 10:00 está 60min depois do slot 09:00, fora da janela de 15min
    const agora = new Date("2026-04-20T10:00:00");
    expect(acharSlotAtivo(slots, agora, 15)).toBeNull();
  });

  it("ignora slot futuro (agora < slot)", () => {
    const agora = new Date("2026-04-20T08:45:00");
    expect(acharSlotAtivo(slots, agora, 15)).toBeNull();
  });

  it("escolhe o slot mais recente quando vários caem na janela", () => {
    // Tolerância alta absorve 2 slots — deve retornar o mais próximo de agora.
    const agora = new Date("2026-04-20T11:05:00");
    const achado = acharSlotAtivo(slots, agora, 300); // 5h
    expect(achado).not.toBeNull();
    expect(achado!.getHours()).toBe(11); // slot 11:00, não 09:00
  });
});

describe("slotTimestampChave / contextoContemSlot", () => {
  it("gera chave estável YYYY-MM-DDTHH:MM", () => {
    const slot = new Date("2026-04-22T09:00:00");
    expect(slotTimestampChave(slot)).toBe("2026-04-22T09:00");
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
  it("formata YYYY-MM-DD no timezone local", () => {
    const d = new Date(2026, 3, 5, 23, 59); // 5 de abril
    expect(chaveDiaLocal(d)).toBe("2026-04-05");
  });
});

describe("calcularMomentoLembrete / deveDispararLembrete", () => {
  it("1 dia antes às 18:00 (default)", () => {
    const startTime = new Date("2026-04-22T14:00:00");
    const momento = calcularMomentoLembrete(startTime, {})!;
    expect(momento.getFullYear()).toBe(2026);
    expect(momento.getMonth()).toBe(3); // abril
    expect(momento.getDate()).toBe(21);
    expect(momento.getHours()).toBe(18);
    expect(momento.getMinutes()).toBe(0);
  });

  it("2 dias antes às 09:30 via config", () => {
    const startTime = new Date("2026-04-22T14:00:00");
    const momento = calcularMomentoLembrete(startTime, { diasAntes: 2, horario: "09:30" })!;
    expect(momento.getDate()).toBe(20);
    expect(momento.getHours()).toBe(9);
    expect(momento.getMinutes()).toBe(30);
  });

  it("deveDispararLembrete respeita a janela", () => {
    // Booking às 14:00 de 22/04; lembrete às 18:00 do dia 21.
    const startTime = new Date("2026-04-22T14:00:00");
    // Agora está 18:10 → dentro de janela de 15min
    expect(deveDispararLembrete(startTime, {}, new Date("2026-04-21T18:10:00"), 15)).toBe(true);
    // Agora está 17:40 → ainda não alcançou o momento
    expect(deveDispararLembrete(startTime, {}, new Date("2026-04-21T17:40:00"), 15)).toBe(false);
    // Agora está 19:00 → fora da janela (passou há 60min)
    expect(deveDispararLembrete(startTime, {}, new Date("2026-04-21T19:00:00"), 15)).toBe(false);
  });
});

describe("dateNoFuso / ymdNoFuso — timezone IANA", () => {
  it("dateNoFuso: '09:00 em America/Sao_Paulo' → 12:00 UTC", () => {
    // 21 abr 2026, 09:00 em Brasília (UTC-3) == 12:00 UTC
    const d = dateNoFuso(2026, 4, 21, 9, 0, "America/Sao_Paulo");
    expect(d.toISOString()).toBe("2026-04-21T12:00:00.000Z");
  });

  it("dateNoFuso: '09:00 em America/Manaus' → 13:00 UTC (UTC-4)", () => {
    const d = dateNoFuso(2026, 4, 21, 9, 0, "America/Manaus");
    expect(d.toISOString()).toBe("2026-04-21T13:00:00.000Z");
  });

  it("dateNoFuso: '09:00 em America/Noronha' → 11:00 UTC (UTC-2)", () => {
    const d = dateNoFuso(2026, 4, 21, 9, 0, "America/Noronha");
    expect(d.toISOString()).toBe("2026-04-21T11:00:00.000Z");
  });

  it("ymdNoFuso: meia-noite UTC-3 vira o dia correto em Brasília", () => {
    // 2026-04-22 02:00 UTC == 2026-04-21 23:00 em SP (ainda dia 21)
    const d = new Date("2026-04-22T02:00:00.000Z");
    expect(ymdNoFuso(d, "America/Sao_Paulo")).toEqual({ y: 2026, m: 4, d: 21 });
  });
});

describe("calcularSlotsDoDia com fuso horário", () => {
  it("gera slots no fuso do escritório (Brasília), independente do TZ do processo", () => {
    // baseDia representa qualquer instante — o que importa é o Y/M/D em SP
    const baseDia = new Date("2026-04-21T15:00:00.000Z"); // 12:00 em SP
    const slots = calcularSlotsDoDia(
      { horarioInicial: "09:00", disparosPorDia: 3, intervaloMinutos: 120 },
      baseDia,
      "America/Sao_Paulo",
    );
    expect(slots).toHaveLength(3);
    // 09:00, 11:00, 13:00 em SP == 12:00, 14:00, 16:00 UTC
    expect(slots[0].toISOString()).toBe("2026-04-21T12:00:00.000Z");
    expect(slots[1].toISOString()).toBe("2026-04-21T14:00:00.000Z");
    expect(slots[2].toISOString()).toBe("2026-04-21T16:00:00.000Z");
  });

  it("dois escritórios em fusos diferentes disparam em momentos UTC distintos", () => {
    const baseDia = new Date("2026-04-21T15:00:00.000Z");
    const cfg = { horarioInicial: "09:00", disparosPorDia: 1 };
    const slotsSP = calcularSlotsDoDia(cfg, baseDia, "America/Sao_Paulo");
    const slotsManaus = calcularSlotsDoDia(cfg, baseDia, "America/Manaus");
    // 09:00 SP = 12:00 UTC ; 09:00 Manaus = 13:00 UTC — 1h de diferença
    expect(slotsManaus[0].getTime() - slotsSP[0].getTime()).toBe(60 * 60 * 1000);
  });

  it("sem tz preserva comportamento legado (usa TZ do processo)", () => {
    const baseDia = new Date("2026-04-21T15:00:00.000Z");
    const slots = calcularSlotsDoDia(
      { horarioInicial: "09:00", disparosPorDia: 1 },
      baseDia,
    );
    expect(slots).toHaveLength(1);
    // Comportamento legado: setHours local. Só conferimos que retornou algo,
    // o teste do legado acima já cobre o comportamento exato.
  });
});

describe("calcularMomentoLembrete com fuso horário", () => {
  it("'18:00 em Brasília' no dia anterior ao booking (UTC)", () => {
    const booking = new Date("2026-04-22T14:00:00.000Z");
    const momento = calcularMomentoLembrete(
      booking,
      { diasAntes: 1, horario: "18:00" },
      "America/Sao_Paulo",
    );
    // 21 abr 18:00 SP == 21:00 UTC
    expect(momento?.toISOString()).toBe("2026-04-21T21:00:00.000Z");
  });

  it("mesmo booking em Manaus dispara 1h depois (UTC-4)", () => {
    const booking = new Date("2026-04-22T14:00:00.000Z");
    const momento = calcularMomentoLembrete(
      booking,
      { diasAntes: 1, horario: "18:00" },
      "America/Manaus",
    );
    // 21 abr 18:00 Manaus == 22:00 UTC
    expect(momento?.toISOString()).toBe("2026-04-21T22:00:00.000Z");
  });
});
