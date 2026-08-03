/**
 * Testes — `diaAtualEmTz` / `inicioDiasAtrasEmTz`.
 *
 * Bug protegido: painéis usavam `CURDATE()` do MySQL, que responde conforme o
 * TZ da SESSÃO. Em produção (Railway roda em UTC) o dia virava às 21h de
 * Brasília — mensagem/conversa da noite era contada como "amanhã", e os cards
 * do Atendimento nunca fechavam com o filtro de período do inbox.
 */

import { describe, it, expect } from "vitest";
import { diaAtualEmTz, inicioDiasAtrasEmTz } from "../_core/dates";

const TZ = "America/Sao_Paulo";

/** Data (YYYY-MM-DD) que um instante representa no fuso informado. */
function diaNoFuso(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Hora:minuto que um instante representa no fuso informado. */
function horaNoFuso(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

describe("diaAtualEmTz", () => {
  it("início cai na meia-noite do fuso pedido, não do UTC", () => {
    const { inicio } = diaAtualEmTz(TZ);
    expect(horaNoFuso(inicio, TZ)).toBe("00:00");
  });

  it("início pertence ao dia de HOJE naquele fuso", () => {
    const { inicio } = diaAtualEmTz(TZ);
    expect(diaNoFuso(inicio, TZ)).toBe(diaNoFuso(new Date(), TZ));
  });

  it("a janela do dia dura exatamente 24h", () => {
    const { inicio, fim } = diaAtualEmTz(TZ);
    expect(fim.getTime() - inicio.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("agora está sempre dentro da janela [início, fim)", () => {
    const { inicio, fim } = diaAtualEmTz(TZ);
    const agora = Date.now();
    expect(agora).toBeGreaterThanOrEqual(inicio.getTime());
    expect(agora).toBeLessThan(fim.getTime());
  });

  it("em Brasília o início NÃO é meia-noite UTC (era esse o bug do CURDATE)", () => {
    const { inicio } = diaAtualEmTz(TZ);
    // UTC-3 → meia-noite local é 03:00 UTC.
    expect(inicio.getUTCHours()).toBe(3);
  });

  it("funciona pra outro fuso (escritório configurado fora de SP)", () => {
    const { inicio } = diaAtualEmTz("America/Manaus"); // UTC-4
    expect(horaNoFuso(inicio, "America/Manaus")).toBe("00:00");
    expect(inicio.getUTCHours()).toBe(4);
  });
});

describe("inicioDiasAtrasEmTz", () => {
  it("N dias atrás continua ancorado na meia-noite local", () => {
    const d7 = inicioDiasAtrasEmTz(TZ, 7);
    expect(horaNoFuso(d7, TZ)).toBe("00:00");
  });

  it("recua exatamente N dias em relação ao início de hoje", () => {
    const { inicio } = diaAtualEmTz(TZ);
    const d30 = inicioDiasAtrasEmTz(TZ, 30);
    expect(inicio.getTime() - d30.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
