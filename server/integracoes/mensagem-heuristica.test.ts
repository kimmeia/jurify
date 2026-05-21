import { describe, it, expect } from "vitest";
import { mensagemPareceTerValor } from "./agente-captura-campos";

describe("mensagemPareceTerValor — pula mensagens sociais puras", () => {
  it.each([
    "oi", "Oi", "OI", "olá", "Olá", "ola",
    "ok", "OK", "Okay", "okay", "blz", "beleza",
    "obrigado", "Obrigada", "valeu", "vlw",
    "tchau", "até", "ate",
    "bom dia", "boa tarde", "boa noite",
    "oi!", "ok.", "olá!",
  ])("pula saudação curta %p", (msg) => {
    expect(mensagemPareceTerValor(msg)).toBe(false);
  });

  it.each(["", "  ", "oi", "ab"])("pula muito curtas/vazias %p", (msg) => {
    expect(mensagemPareceTerValor(msg)).toBe(false);
  });
});

describe("mensagemPareceTerValor — captura termos temporais (regressão bug do print)", () => {
  it.each([
    "Rafael, para amanha",
    "Rafael, para amanhã",
    "queria agendar pra sexta",
    "sexta",
    "sexta-feira",
    "sextafeira",
    "segunda que vem",
    "terça",
    "terca",
    "quarta",
    "quinta",
    "sábado",
    "sabado",
    "domingo",
    "amanhã",
    "amanha",
    "hoje",
    "ontem",
    "anteontem",
    "depois de amanhã",
    "depois de amanha",
    "semana que vem",
    "mês que vem",
    "mes que vem",
    "próxima quinta",
    "proxima quinta",
    "de manhã",
    "de manha",
    "à tarde",
    "à noite",
    "agora pouco",
    "já vou",
  ])("captura termo temporal %p", (msg) => {
    expect(mensagemPareceTerValor(msg)).toBe(true);
  });
});

describe("mensagemPareceTerValor — captura intenção de agendamento", () => {
  it.each([
    "quero agendar",
    "Quero agendar",
    "pode marcar",
    "vamos reservar",
    "preciso reagendar",
    "tenho consulta",
    "vamos remarcar",
    "tem reunião",
    "tem reuniao",
    "tem audiência",
    "tem audiencia",
  ])("captura intenção %p", (msg) => {
    expect(mensagemPareceTerValor(msg)).toBe(true);
  });
});

describe("mensagemPareceTerValor — comportamento original preservado", () => {
  it.each([
    "12:00",
    "R$ 50.000",
    "valor é 1234",
    "cpf 123.456.789-00",
  ])("ainda captura números %p", (msg) => {
    expect(mensagemPareceTerValor(msg)).toBe(true);
  });

  it.each([
    "em janeiro",
    "março de 2026",
    "outubro",
  ])("ainda captura meses %p", (msg) => {
    expect(mensagemPareceTerValor(msg)).toBe(true);
  });

  it.each(["sim", "não", "nao", "Sim claro"])("ainda captura booleans %p", (msg) => {
    expect(mensagemPareceTerValor(msg)).toBe(true);
  });
});

describe("mensagemPareceTerValor — mensagens longas sempre passam", () => {
  it("passa quando texto > 30 chars (provavelmente tem informação)", () => {
    const msg = "Cláudio. Quero marcar uma audiência logo cedo";
    expect(msg.length).toBeGreaterThan(30);
    expect(mensagemPareceTerValor(msg)).toBe(true);
  });

  it("passa quando texto contém detalhes longos sem palavras-gatilho óbvias", () => {
    const msg = "Aquela coisa que conversamos ontem ficou ótima sim com certeza";
    // tem "ontem" e "sim", múltiplos hits
    expect(mensagemPareceTerValor(msg)).toBe(true);
  });
});
