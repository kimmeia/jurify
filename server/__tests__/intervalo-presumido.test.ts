/**
 * O almoço que ninguém bateu.
 *
 * O caso que trouxe estes testes: Eduardo tem jornada 12:00–18:00 com 60min de
 * intervalo — 5h de trabalho previstas. Entrou meio-dia, saiu 17h40, nunca
 * clicou em "sair pro almoço". O espelho mostrava 5h40 realizadas contra 5h
 * previstas e o dava como +40min adiantado, quando na prática ele almoçou e
 * não registrou.
 *
 * A assimetria era estrutural: o previsto SEMPRE desconta o intervalo do
 * contrato, o realizado só descontava a pausa registrada. Todo esquecimento do
 * botão virava saldo positivo, todo dia, pra todo mundo.
 */

import { describe, expect, it } from "vitest";
import { intervaloPresumido, minutosDoExpediente } from "../../shared/jornada";

describe("o previsto do expediente", () => {
  it("desconta o intervalo do contrato — 12h às 18h com 1h de almoço são 5h", () => {
    // A conta que gerou a dúvida: a janela é de 6h, a jornada de trabalho é 5h.
    expect(minutosDoExpediente({ inicio: "12:00", fim: "18:00", intervaloMin: 60 })).toBe(300);
  });

  it("sem intervalo contratado, a janela inteira é jornada", () => {
    expect(minutosDoExpediente({ inicio: "12:00", fim: "18:00", intervaloMin: 0 })).toBe(360);
  });
});

describe("intervalo presumido", () => {
  it("presume o almoço do contrato quando ninguém bateu a pausa", () => {
    // 5h40 entre entrada e saída, 1h de intervalo contratado e nenhuma pausa
    // registrada: o líquido vira 4h40, e o dia deixa de ser +40min.
    expect(intervaloPresumido(340, 0, 60)).toBe(60);
  });

  it("pausa registrada manda — não desconta duas vezes", () => {
    // Fato observado ganha de presunção. Presumir por cima tiraria o almoço
    // duas vezes do mesmo dia.
    expect(intervaloPresumido(340, 45, 60)).toBe(0);
  });

  it("sem intervalo no contrato não presume nada", () => {
    expect(intervaloPresumido(340, 0, 0)).toBe(0);
  });

  it("dia curto demais não comporta o almoço", () => {
    // Quem ficou 40 minutos não tirou uma hora de intervalo no meio, e
    // descontar zeraria o dia dela.
    expect(intervaloPresumido(40, 0, 60)).toBe(0);
    expect(intervaloPresumido(60, 0, 60)).toBe(0);
    expect(intervaloPresumido(61, 0, 60)).toBe(60);
  });

  it("dia sem horas apuradas não presume", () => {
    // Dia em andamento ou inconsistente: `minutos` é null e não há de onde
    // descontar.
    expect(intervaloPresumido(null, 0, 60)).toBe(0);
  });

  it("o caso do Eduardo, fim a fim", () => {
    const expediente = { inicio: "12:00", fim: "18:00", intervaloMin: 60 };
    const previsto = minutosDoExpediente(expediente);
    const bruto = 340; // 12:00 → 17:40
    const presumido = intervaloPresumido(bruto, 0, expediente.intervaloMin);
    const liquido = bruto - presumido;

    expect(previsto).toBe(300);
    expect(presumido).toBe(60);
    expect(liquido).toBe(280);
    // Antes: 340 − 300 = +40min de crédito por um almoço não registrado.
    // Agora: 280 − 300 = −20min, que é o que a jornada dele realmente ficou.
    expect(liquido - previsto).toBe(-20);
  });

  it("quem bate a pausa direitinho não é penalizado", () => {
    // Mesma jornada, mesmo horário, mas com o almoço registrado: o resultado
    // tem que ser o mesmo de quem não bateu. É isso que tira o prêmio do
    // esquecimento sem criar um castigo pra quem colabora.
    const bruto = 340;
    const comPausa = bruto - 60; // pausa de 1h registrada e já descontada
    expect(intervaloPresumido(comPausa, 60, 60)).toBe(0);
    expect(comPausa).toBe(280);
  });
});
