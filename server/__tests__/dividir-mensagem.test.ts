/**
 * Testes — dividirMensagemNatural / calcularDelayDigitacaoMs.
 *
 * Cobre as regras aprovadas no mockup: mensagem curta não divide; quebra
 * por parágrafos e frases; nunca quebra listas, valores (R$), datas,
 * horas, links e abreviações; frase curta gruda na vizinha; cap de
 * mensagens com excedente na última; delay proporcional por ritmo.
 */

import { describe, it, expect } from "vitest";
import {
  dividirMensagemNatural,
  dividirFrases,
  calcularDelayDigitacaoMs,
} from "../integracoes/dividir-mensagem";

const RESPOSTA_MOCKUP =
  "Olá, Rafael! Tudo bem? 😊 Recebi sua mensagem sobre o andamento do seu contrato e já verifiquei aqui no sistema. " +
  "Seu processo de instalação está na etapa final de agendamento — a equipe técnica confirmou disponibilidade para esta semana. " +
  "Temos dois horários disponíveis: quinta-feira (12/06) às 14h ou sexta-feira (13/06) às 9h. Qual deles fica melhor para você?";

describe("dividirMensagemNatural", () => {
  it("mensagem curta (<200 chars) sai inteira", () => {
    const txt = "Olá! Seu agendamento foi confirmado para quinta às 14h.";
    expect(dividirMensagemNatural(txt)).toEqual([txt]);
  });

  it("divide a resposta do mockup em múltiplas bolhas, começando pela saudação", () => {
    const partes = dividirMensagemNatural(RESPOSTA_MOCKUP);
    expect(partes.length).toBeGreaterThanOrEqual(3);
    expect(partes.length).toBeLessThanOrEqual(4);
    expect(partes[0]).toBe("Olá, Rafael! Tudo bem? 😊");
    // Nada se perde nem duplica
    expect(partes.join(" ").replace(/\s+/g, " ")).toBe(RESPOSTA_MOCKUP.replace(/\s+/g, " "));
  });

  it("divide por parágrafos quando existem", () => {
    const txt =
      "Primeiro parágrafo com a saudação e um contexto inicial da conversa toda.\n\n" +
      "Segundo parágrafo explicando os detalhes do processo em andamento agora.\n\n" +
      "Terceiro parágrafo com a pergunta final pro cliente decidir o caminho.";
    const partes = dividirMensagemNatural(txt);
    expect(partes).toHaveLength(3);
    expect(partes[1]).toContain("Segundo parágrafo");
  });

  it("NUNCA quebra bloco de lista — fica inteiro na mesma bolha", () => {
    const lista =
      "Para dar andamento, preciso destes documentos:\n" +
      "1. RG e CPF\n2. Comprovante de residência\n3. Procuração assinada\n4. Carteira de trabalho";
    const txt = `${"Contexto inicial da solicitação de documentos pro processo seguir. ".repeat(2)}\n\n${lista}`;
    const partes = dividirMensagemNatural(txt);
    const comLista = partes.find((p) => p.includes("1. RG e CPF"));
    expect(comLista).toBeDefined();
    expect(comLista).toContain("4. Carteira de trabalho");
  });

  it("não quebra valores (R$ 1.234,56), datas (12/06) e horas (14h)", () => {
    const txt =
      "O valor total da causa ficou em R$ 1.234,56 conforme combinado anteriormente com você. " +
      "A audiência foi marcada para 12/06 às 14h no fórum central da cidade. " +
      "Qualquer dúvida sobre o processo é só me chamar por aqui que eu te explico.";
    const partes = dividirMensagemNatural(txt);
    const tudo = partes.join("|");
    expect(tudo).toContain("R$ 1.234,56");
    expect(tudo).toContain("12/06 às 14h");
  });

  it("não quebra link no meio", () => {
    const txt =
      "Segue o link do boleto para pagamento da primeira parcela do contrato combinado. " +
      "Acesse https://www.asaas.com/i/abc123def456 para visualizar e pagar quando puder. " +
      "Depois me confirma por aqui pra eu dar baixa no sistema, por favor.";
    const partes = dividirMensagemNatural(txt);
    const comLink = partes.find((p) => p.includes("https://"));
    expect(comLink).toContain("https://www.asaas.com/i/abc123def456");
  });

  it("abreviações (Dr., Av., nº) não terminam frase", () => {
    const frases = dividirFrases(
      "O Dr. Silva vai te atender na Av. Santos Dumont, nº 1500. Chegue 10 minutos antes.",
    );
    expect(frases).toHaveLength(2);
    expect(frases[0]).toContain("Dr. Silva");
    expect(frases[0]).toContain("nº 1500.");
  });

  it("pergunta final curta gruda na bolha anterior (não vira bolha própria)", () => {
    const partes = dividirMensagemNatural(RESPOSTA_MOCKUP);
    const ultima = partes[partes.length - 1];
    expect(ultima).toContain("Qual deles fica melhor para você?");
    expect(ultima.length).toBeGreaterThan("Qual deles fica melhor para você?".length);
  });

  it("respeita o cap de mensagens — excedente concatenado na última", () => {
    const txt = Array.from({ length: 8 }, (_, i) =>
      `Parágrafo número ${i + 1} com conteúdo suficiente pra virar uma bolha própria aqui.`,
    ).join("\n\n");
    const partes = dividirMensagemNatural(txt, { maxMensagens: 3 });
    expect(partes).toHaveLength(3);
    expect(partes[2]).toContain("Parágrafo número 3");
    expect(partes[2]).toContain("Parágrafo número 8");
  });

  it("maxMensagens=1 desliga a divisão na prática", () => {
    expect(dividirMensagemNatural(RESPOSTA_MOCKUP, { maxMensagens: 1 })).toHaveLength(1);
  });

  it("minCharsParaDividir customizado é respeitado", () => {
    const txt = "Primeira frase completa do texto aqui. Segunda frase completa do texto na sequência agora mesmo.";
    expect(dividirMensagemNatural(txt, { minCharsParaDividir: 500 })).toEqual([txt]);
  });

  it("texto vazio/whitespace não explode", () => {
    expect(dividirMensagemNatural("")).toEqual([""]);
    expect(dividirMensagemNatural("   ")).toEqual(["   "]);
  });
});

describe("calcularDelayDigitacaoMs", () => {
  it("ritmo natural fica na faixa 1–3s, proporcional ao tamanho", () => {
    const curto = calcularDelayDigitacaoMs("Ok, perfeito!", "natural");
    const medio = calcularDelayDigitacaoMs("a".repeat(90), "natural");
    const longo = calcularDelayDigitacaoMs("a".repeat(400), "natural");
    expect(curto).toBe(1000);
    expect(medio).toBe(2250);
    expect(longo).toBe(3000);
    expect(curto).toBeLessThanOrEqual(medio);
    expect(medio).toBeLessThanOrEqual(longo);
  });

  it("ritmos rápido e calmo respeitam suas faixas", () => {
    expect(calcularDelayDigitacaoMs("a".repeat(400), "rapido")).toBe(1500);
    expect(calcularDelayDigitacaoMs("oi", "rapido")).toBe(500);
    expect(calcularDelayDigitacaoMs("oi", "calmo")).toBe(2000);
    expect(calcularDelayDigitacaoMs("a".repeat(400), "calmo")).toBe(5000);
  });

  it("ritmo inválido cai no natural", () => {
    expect(calcularDelayDigitacaoMs("a".repeat(90), "x" as any)).toBe(2250);
  });
});
