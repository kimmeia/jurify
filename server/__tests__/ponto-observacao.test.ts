/**
 * Atraso só existe onde havia relógio.
 *
 * O caso que trouxe estes testes: o módulo de ponto entrou no ar às 15h08, o
 * primeiro heartbeat de todo mundo foi o do deploy, e o espelho acusou
 * "+429min" de gente que estava trabalhando desde as oito. A conta batia
 * (15:09 − 08:00 = 7h09), o que não batia era a premissa — às 08:00 não havia
 * nada registrando.
 *
 * A regra que fecha isso: o expediente daquele dia precisa ter COMEÇADO depois
 * de o ponto passar a observar aquele escritório. Ela some sozinha no segundo
 * dia e vale igual pra qualquer escritório novo.
 */

import { describe, expect, it } from "vitest";
import { pontualidadeApuravel } from "../rh/router-rh";
import { jornadaPadrao, type JornadaSemanal } from "../../shared/jornada";

const FUSO = "America/Fortaleza"; // UTC-3 o ano inteiro, sem horário de verão
const jornada: JornadaSemanal = jornadaPadrao(); // seg–sex, 08:00–18:00

/** 2026-08-12 é uma quarta-feira. */
const QUARTA = "2026-08-12";

describe("pontualidade apurável", () => {
  it("não apura o dia em que o ponto começou a registrar depois do expediente", () => {
    // Deploy às 15:08 locais = 18:08 UTC.
    const desde = new Date("2026-08-12T18:08:00.000Z");
    expect(pontualidadeApuravel(jornada, QUARTA, FUSO, desde)).toBe(false);
  });

  it("apura os dias seguintes ao início do registro", () => {
    const desde = new Date("2026-08-12T18:08:00.000Z");
    expect(pontualidadeApuravel(jornada, "2026-08-13", FUSO, desde)).toBe(true);
    expect(pontualidadeApuravel(jornada, "2026-08-31", FUSO, desde)).toBe(true);
  });

  it("apura o próprio dia quando o registro começou antes do expediente", () => {
    // Deploy às 06:00 locais = 09:00 UTC, duas horas antes das 08:00.
    const desde = new Date("2026-08-12T09:00:00.000Z");
    expect(pontualidadeApuravel(jornada, QUARTA, FUSO, desde)).toBe(true);
  });

  it("não inventa exceção quando não há marco de observação", () => {
    expect(pontualidadeApuravel(jornada, QUARTA, FUSO, null)).toBe(true);
  });

  it("não bloqueia dia sem expediente previsto", () => {
    // Domingo: sem expediente, não há atraso a apurar de qualquer jeito, e a
    // resposta `true` evita que o aviso de "não observado" apareça em folga.
    const desde = new Date("2026-08-12T18:08:00.000Z");
    expect(pontualidadeApuravel(jornada, "2026-08-16", FUSO, desde)).toBe(true);
  });

  it("não bloqueia quem não tem jornada definida", () => {
    const desde = new Date("2026-08-12T18:08:00.000Z");
    expect(pontualidadeApuravel(null, QUARTA, FUSO, desde)).toBe(true);
  });

  it("compara no fuso do escritório, não em UTC", () => {
    // 08:00 em Rio Branco (UTC-5) é 13:00 UTC; em Fortaleza (UTC-3), 11:00.
    // Um marco às 12:00 UTC cai ANTES do expediente acreano e DEPOIS do
    // cearense — se a comparação fosse feita em UTC os dois dariam igual.
    const desde = new Date("2026-08-12T12:00:00.000Z");
    expect(pontualidadeApuravel(jornada, QUARTA, "America/Rio_Branco", desde)).toBe(true);
    expect(pontualidadeApuravel(jornada, QUARTA, FUSO, desde)).toBe(false);
  });
});
