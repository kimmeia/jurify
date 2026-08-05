/**
 * Regras de disparo dos relatórios programados.
 *
 * O cron roda de hora em hora pra TODOS os escritórios; quem decide se um
 * agendamento vence agora é `venceAgora`, no fuso de cada escritório. Errar
 * aqui manda relatório de madrugada, no dia errado, ou não manda nunca.
 */

import { describe, it, expect } from "vitest";
import {
  diaLocalEm,
  horaLocalEm,
  janelaDoEnvio,
  venceAgora,
} from "./cron-relatorios-programados";

const SP = "America/Sao_Paulo";
const MANAUS = "America/Manaus";

/** 08:00 em São Paulo (UTC-3) = 11:00 UTC. */
const asUtc = (iso: string) => new Date(iso);

const base = {
  frequencia: "diaria" as const,
  diaSemana: 1,
  diaMes: 1,
  hora: 8,
  ativo: true,
};

describe("horaLocalEm", () => {
  it("converte pro fuso do escritório", () => {
    expect(horaLocalEm(SP, asUtc("2026-08-05T11:00:00Z"))).toBe(8);
    // Manaus é UTC-4: às 11h UTC lá são 7h, não 8h.
    expect(horaLocalEm(MANAUS, asUtc("2026-08-05T11:00:00Z"))).toBe(7);
  });

  it("cai pro UTC quando o fuso é inválido", () => {
    expect(horaLocalEm("Nao/Existe", asUtc("2026-08-05T11:00:00Z"))).toBe(11);
  });

  it("trata meia-noite local como 0, não 24", () => {
    expect(horaLocalEm(SP, asUtc("2026-08-05T03:00:00Z"))).toBe(0);
  });
});

describe("diaLocalEm", () => {
  it("usa a data do fuso, não a do servidor", () => {
    // 02:00 UTC do dia 6 ainda é dia 5 em São Paulo.
    expect(diaLocalEm(SP, asUtc("2026-08-06T02:00:00Z"))).toBe("2026-08-05");
  });
});

describe("venceAgora", () => {
  it("diária dispara todo dia na hora certa", () => {
    expect(venceAgora(base, SP, asUtc("2026-08-05T11:00:00Z"))).toBe(true);
    expect(venceAgora(base, SP, asUtc("2026-08-06T11:00:00Z"))).toBe(true);
  });

  it("não dispara fora da hora", () => {
    expect(venceAgora(base, SP, asUtc("2026-08-05T12:00:00Z"))).toBe(false);
  });

  it("respeita o fuso do escritório", () => {
    // 11h UTC é 8h em SP mas 7h em Manaus — só um dispara.
    const agora = asUtc("2026-08-05T11:00:00Z");
    expect(venceAgora(base, SP, agora)).toBe(true);
    expect(venceAgora(base, MANAUS, agora)).toBe(false);
    // Uma hora depois é a vez de Manaus.
    expect(venceAgora(base, MANAUS, asUtc("2026-08-05T12:00:00Z"))).toBe(true);
  });

  it("agendamento desativado nunca vence", () => {
    expect(venceAgora({ ...base, ativo: false }, SP, asUtc("2026-08-05T11:00:00Z"))).toBe(false);
  });

  it("semanal só dispara no dia da semana escolhido", () => {
    // 2026-08-05 é uma quarta-feira (3).
    const quarta = asUtc("2026-08-05T11:00:00Z");
    const semanal = { ...base, frequencia: "semanal" as const };
    expect(venceAgora({ ...semanal, diaSemana: 3 }, SP, quarta)).toBe(true);
    expect(venceAgora({ ...semanal, diaSemana: 1 }, SP, quarta)).toBe(false);
  });

  it("semanal usa o dia LOCAL — véspera à noite não conta como o dia seguinte", () => {
    // 2026-08-06T02:00Z ainda é quarta 05 em SP; um agendamento de quinta (4)
    // não pode disparar aí.
    const madrugada = asUtc("2026-08-06T02:00:00Z");
    const semanal = { ...base, frequencia: "semanal" as const, hora: 23 };
    expect(venceAgora({ ...semanal, diaSemana: 4 }, SP, madrugada)).toBe(false);
    expect(venceAgora({ ...semanal, diaSemana: 3 }, SP, madrugada)).toBe(true);
  });

  it("mensal só dispara no dia do mês escolhido", () => {
    const dia5 = asUtc("2026-08-05T11:00:00Z");
    const mensal = { ...base, frequencia: "mensal" as const };
    expect(venceAgora({ ...mensal, diaMes: 5 }, SP, dia5)).toBe(true);
    expect(venceAgora({ ...mensal, diaMes: 1 }, SP, dia5)).toBe(false);
  });
});

describe("janelaDoEnvio", () => {
  it("cobre os N dias fechados antes do disparo", () => {
    // Disparo em 01/08 com janela de 30 dias → 02/07 a 31/07. O dia do
    // disparo fica de fora porque ainda não terminou.
    expect(janelaDoEnvio("2026-08-01", 30)).toEqual({
      dataInicio: "2026-07-02",
      dataFim: "2026-07-31",
    });
  });

  it("janela de 1 dia é o dia anterior", () => {
    expect(janelaDoEnvio("2026-08-01", 1)).toEqual({
      dataInicio: "2026-07-31",
      dataFim: "2026-07-31",
    });
  });

  it("atravessa a virada do ano", () => {
    expect(janelaDoEnvio("2026-01-01", 7)).toEqual({
      dataInicio: "2025-12-25",
      dataFim: "2025-12-31",
    });
  });
});
