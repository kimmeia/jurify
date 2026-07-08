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
  avaliarDiaSemana,
  avaliarHorarioEntre,
  calcularMomentoLembrete,
  calcularSlotsDoDia,
  chaveDiaLocal,
  contextoContemPagamento,
  contextoContemSlot,
  dateNoFuso,
  deveDispararLembrete,
  deveDispararProximo,
  deveDispararVencido,
  deveReentrarNoWaitNode,
  diasEntre,
  diasCalendarioAteVencimento,
  parseHoraHHMM,
  parseVencimento,
  slotTimestampChave,
  temHorarioConfigurado,
  ymdNoFuso,
} from "../smartflow/dispatcher-helpers";

const TZ = "America/Sao_Paulo"; // UTC-3 (Brasil não tem DST desde 2019)

describe("avaliarHorarioEntre (condição por horário)", () => {
  it("dentro da faixa 09:00–18:00 (14:00 Brasília)", () => {
    expect(avaliarHorarioEntre(new Date("2026-05-27T17:00:00Z"), "09:00", "18:00", TZ)).toBe(true);
  });
  it("fora da faixa (20:00 Brasília)", () => {
    expect(avaliarHorarioEntre(new Date("2026-05-27T23:00:00Z"), "09:00", "18:00", TZ)).toBe(false);
  });
  it("fim é exclusivo: 18:00 em ponto já está fora de 09:00–18:00", () => {
    expect(avaliarHorarioEntre(new Date("2026-05-27T21:00:00Z"), "09:00", "18:00", TZ)).toBe(false);
  });
  it("início é inclusivo: 09:00 em ponto está dentro", () => {
    expect(avaliarHorarioEntre(new Date("2026-05-27T12:00:00Z"), "09:00", "18:00", TZ)).toBe(true);
  });
  it("janela que cruza a meia-noite (22:00–06:00)", () => {
    expect(avaliarHorarioEntre(new Date("2026-05-28T02:00:00Z"), "22:00", "06:00", TZ)).toBe(true); // 23:00
    expect(avaliarHorarioEntre(new Date("2026-05-28T08:00:00Z"), "22:00", "06:00", TZ)).toBe(true); // 05:00
    expect(avaliarHorarioEntre(new Date("2026-05-27T15:00:00Z"), "22:00", "06:00", TZ)).toBe(false); // 12:00
  });
  it("formato inválido → false", () => {
    expect(avaliarHorarioEntre(new Date("2026-05-27T17:00:00Z"), "9h", "18h", TZ)).toBe(false);
  });
});

describe("avaliarDiaSemana (condição por dia da semana)", () => {
  // 2026-05-27 12:00 Brasília é uma QUARTA-feira (qua, índice 3).
  const quarta = new Date("2026-05-27T15:00:00Z");
  it("dias úteis → quarta bate", () => {
    expect(avaliarDiaSemana(quarta, "seg,ter,qua,qui,sex", TZ)).toBe(true);
  });
  it("fim de semana → quarta não bate", () => {
    expect(avaliarDiaSemana(quarta, "sab,dom", TZ)).toBe(false);
  });
  it("abreviação única e número equivalem (qua = 3)", () => {
    expect(avaliarDiaSemana(quarta, "qua", TZ)).toBe(true);
    expect(avaliarDiaSemana(quarta, "3", TZ)).toBe(true);
    expect(avaliarDiaSemana(quarta, "1,2", TZ)).toBe(false); // seg,ter
  });
  it("lista vazia → false", () => {
    expect(avaliarDiaSemana(quarta, "", TZ)).toBe(false);
  });
});

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

  it("dispara EXATAMENTE N dias antes — não no vencimento (0) nem antes/depois", () => {
    const cfg = { diasAntes: 3 };
    expect(deveDispararProximo(cfg, 3)).toBe(true); // exatamente 3 dias antes
    expect(deveDispararProximo(cfg, 0)).toBe(false); // vence hoje → NÃO
    expect(deveDispararProximo(cfg, 2)).toBe(false); // 2 dias — ainda não
    expect(deveDispararProximo(cfg, 4)).toBe(false); // 4 dias — cedo demais
  });

  it("'1 dia antes' dispara só na véspera (1), não no vencimento (0)", () => {
    const cfg = { diasAntes: 1 };
    expect(deveDispararProximo(cfg, 1)).toBe(true);
    expect(deveDispararProximo(cfg, 0)).toBe(false);
    expect(deveDispararProximo(cfg, 2)).toBe(false);
  });

  it("usa default 3 quando diasAntes não está configurado", () => {
    expect(deveDispararProximo({}, 3)).toBe(true);
    expect(deveDispararProximo({}, 2)).toBe(false);
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

  it("acha o slot quando o horário já passou (dispara a partir do horário)", () => {
    // Scheduler roda 09:05 → slot 09:00 já passou → dispara
    const agora = new Date("2026-04-20T09:05:00");
    expect(acharSlotAtivo(slots, agora, 15)).not.toBeNull();
    expect(acharSlotAtivo(slots, agora, 15)!.getHours()).toBe(9);
  });

  it("faz catch-up: dispara o slot que já passou mesmo se o tick atrasou (não perde no dia)", () => {
    // 10:00 está 60min depois do slot 09:00. Antes retornava null (janela de
    // 15min) e o horário morria no dia. Agora dispara — o dedupe garante 1×.
    const agora = new Date("2026-04-20T10:00:00");
    const achado = acharSlotAtivo(slots, agora, 15);
    expect(achado).not.toBeNull();
    expect(achado!.getHours()).toBe(9);
  });

  it("ignora slot futuro (agora < slot)", () => {
    const agora = new Date("2026-04-20T08:45:00");
    expect(acharSlotAtivo(slots, agora, 15)).toBeNull();
  });

  it("escolhe o slot mais recente que já passou (11:00, não 09:00)", () => {
    const agora = new Date("2026-04-20T11:05:00");
    const achado = acharSlotAtivo(slots, agora);
    expect(achado).not.toBeNull();
    expect(achado!.getHours()).toBe(11); // slot 11:00, o mais recente <= agora
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

  it("servidor UTC + fuso BR: passar o INSTANTE atual ancora o slot no dia LOCAL (regressão: cron de cobrança não disparava)", () => {
    // 18:45 em America/Sao_Paulo (UTC-3) = 21:45 UTC.
    const agora = new Date("2026-07-07T21:45:00.000Z");
    const cfg = { horarioInicial: "18:45", disparosPorDia: 1, intervaloMinutos: 15 };

    // CORRETO: passar `agora` → slot é HOJE (07/07) 18:45 SP = 21:45 UTC, e casa.
    const slotsOk = calcularSlotsDoDia(cfg, agora, "America/Sao_Paulo");
    expect(slotsOk[0].toISOString()).toBe("2026-07-07T21:45:00.000Z");
    expect(acharSlotAtivo(slotsOk, agora, 15)).not.toBeNull();

    // Documenta a origem do bug do dia: meia-noite UTC (o que o cron passava
    // como `hoje`) vira 06/07 (ontem em SP) — por isso passamos `agora`, não
    // `hoje`, no calcularSlotsDoDia.
    const hojeUtcMidnight = new Date("2026-07-07T00:00:00.000Z");
    const slotsBug = calcularSlotsDoDia(cfg, hojeUtcMidnight, "America/Sao_Paulo");
    expect(slotsBug[0].toISOString()).toBe("2026-07-06T21:45:00.000Z");
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

describe("diasCalendarioAteVencimento (dias de CALENDÁRIO, não floor de horas)", () => {
  const TZ = "America/Sao_Paulo";
  it("07/07 20h SP → vencimento 09/07 = 2 dias (bug: diasEntre dava 1)", () => {
    // Cenário exato do bug: às 20h de SP faltam ~25h pra meia-noite do 09;
    // diasEntre fazia floor → 1. Calendário: 07 → 09 = 2.
    const agora = new Date("2026-07-07T23:00:00.000Z"); // 20:00 em SP
    expect(diasCalendarioAteVencimento("2026-07-09", agora, TZ)).toBe(2);
  });
  it("vence amanhã = 1 em qualquer hora do dia", () => {
    expect(diasCalendarioAteVencimento("2026-07-08", new Date("2026-07-07T12:00:00.000Z"), TZ)).toBe(1); // 09h SP
    expect(diasCalendarioAteVencimento("2026-07-08", new Date("2026-07-07T23:00:00.000Z"), TZ)).toBe(1); // 20h SP
  });
  it("vence hoje = 0; venceu ontem = -1", () => {
    const agora = new Date("2026-07-07T15:00:00.000Z"); // 12h SP
    expect(diasCalendarioAteVencimento("2026-07-07", agora, TZ)).toBe(0);
    expect(diasCalendarioAteVencimento("2026-07-06", agora, TZ)).toBe(-1);
  });
  it("string inválida → 0 (não quebra)", () => {
    expect(diasCalendarioAteVencimento("", new Date("2026-07-07T15:00:00.000Z"), TZ)).toBe(0);
  });
});

describe("deveReentrarNoWaitNode (retomada de execução pausada)", () => {
  it("reentra no nó conversacional mesmo SEM nenhuma seta proximoSe (bug do Atendente IA)", () => {
    // Atendente IA puramente conversacional: 1 nó, sem ferramentas/ações ligadas
    // → nenhum proximoSe. Tem que reentrar (re-executar o agente), senão a
    // conversa morre após a 1ª resposta.
    const passos = [{ clienteId: "at", proximoSe: {} }];
    expect(deveReentrarNoWaitNode(passos, "at")).toBe(true);
  });

  it("reentra quando o nó de espera existe e tem setas", () => {
    const passos = [{ clienteId: "at", proximoSe: { agendar: "x" } }, { clienteId: "x" }];
    expect(deveReentrarNoWaitNode(passos, "at")).toBe(true);
  });

  it("não reentra quando não há nó de espera (fluxo linear legado)", () => {
    const passos = [{ clienteId: null }, { clienteId: null }];
    expect(deveReentrarNoWaitNode(passos, null)).toBe(false);
    expect(deveReentrarNoWaitNode(passos, undefined)).toBe(false);
  });

  it("não reentra quando o waitNodeId não bate com nenhum nó", () => {
    const passos = [{ clienteId: "a" }, { clienteId: "b" }];
    expect(deveReentrarNoWaitNode(passos, "inexistente")).toBe(false);
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

describe("calcularSlotsDoDia — teto anti-spam (MAX_DISPAROS_DIA)", () => {
  it("limita disparosPorDia alto ao teto (20 → 3 slots)", () => {
    const slots = calcularSlotsDoDia(
      { horarioInicial: "09:00", disparosPorDia: 20, intervaloMinutos: 60 },
      new Date("2026-05-01T12:00:00.000Z"),
    );
    expect(slots.length).toBe(3);
  });

  it("respeita 1×/dia (recomendado pra cobrança)", () => {
    const slots = calcularSlotsDoDia(
      { horarioInicial: "09:00", disparosPorDia: 1 },
      new Date("2026-05-01T12:00:00.000Z"),
    );
    expect(slots.length).toBe(1);
  });
});
