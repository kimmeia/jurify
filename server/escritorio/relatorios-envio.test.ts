/**
 * Normalização de destinatários e corpo do e-mail dos relatórios.
 *
 * O campo é texto livre ("a@x.com, b@y.com") e vai direto pro Resend — um
 * endereço colado com espaço ou duplicado gasta rate-limit à toa e, no caso
 * de inválido, devolve 422 pro usuário sem explicação.
 */

import { describe, it, expect } from "vitest";
import {
  montarEmailRelatorio,
  normalizarDestinatarios,
  type RelatorioGerado,
} from "./relatorios-envio";

describe("normalizarDestinatarios", () => {
  it("separa por vírgula, ponto e vírgula e quebra de linha", () => {
    expect(normalizarDestinatarios("a@x.com, b@y.com; c@z.com\nd@w.com").validos).toEqual([
      "a@x.com", "b@y.com", "c@z.com", "d@w.com",
    ]);
  });

  it("apara espaços e normaliza caixa", () => {
    expect(normalizarDestinatarios("  Socio@Escritorio.COM.BR  ").validos).toEqual([
      "socio@escritorio.com.br",
    ]);
  });

  it("deduplica", () => {
    expect(normalizarDestinatarios("a@x.com, A@X.com, a@x.com").validos).toEqual(["a@x.com"]);
  });

  it("separa os inválidos em vez de mandar pro Resend", () => {
    const r = normalizarDestinatarios("bom@x.com, semarroba, sem@dominio, @x.com");
    expect(r.validos).toEqual(["bom@x.com"]);
    expect(r.invalidos).toEqual(["semarroba", "sem@dominio", "@x.com"]);
  });

  it("aceita array direto", () => {
    expect(normalizarDestinatarios(["a@x.com", "  b@y.com "]).validos).toEqual([
      "a@x.com", "b@y.com",
    ]);
  });

  it("lista vazia quando não veio nada útil", () => {
    expect(normalizarDestinatarios("   ,  ; ").validos).toEqual([]);
  });
});

function gerado(): RelatorioGerado {
  return {
    filename: "relatorio_atendimento_2026-07-01_2026-07-30.pdf",
    base64: "UERG",
    periodo: { dataInicio: "2026-07-01", dataFim: "2026-07-30" },
    destaques: [
      { rotulo: "Atendimentos", valor: "1.284", variacao: "+12%" },
      { rotulo: "Taxa de conversão", valor: "27%", variacao: "-4 p.p." },
      { rotulo: "Leads ganhos", valor: "90" },
    ],
  };
}

describe("montarEmailRelatorio", () => {
  it("traz período em formato brasileiro no assunto", () => {
    const { assunto } = montarEmailRelatorio({
      relatorio: "atendimento",
      gerado: gerado(),
      nomeEscritorio: "Rocha & Associados",
      programado: false,
    });
    expect(assunto).toBe("Relatório de Atendimento · 01/07/2026 a 30/07/2026");
  });

  it("repete os destaques no corpo — quem abre no celular não baixa o anexo", () => {
    const { html, texto } = montarEmailRelatorio({
      relatorio: "atendimento",
      gerado: gerado(),
      nomeEscritorio: "Rocha & Associados",
      programado: false,
    });
    expect(html).toContain("Atendimentos");
    expect(html).toContain("1.284");
    expect(texto).toContain("Atendimentos: 1.284 (+12%)");
    expect(texto).toContain("Leads ganhos: 90");
  });

  it("colore a variação por sinal, não por rótulo", () => {
    const { html } = montarEmailRelatorio({
      relatorio: "atendimento",
      gerado: gerado(),
      nomeEscritorio: "Rocha & Associados",
      programado: false,
    });
    // +12% em verde, -4 p.p. em vermelho.
    expect(html).toMatch(/#059669">\+12%/);
    expect(html).toMatch(/#e11d48">-4 p\.p\./);
  });

  it("cita o anexo pelo nome", () => {
    const { html, texto } = montarEmailRelatorio({
      relatorio: "producao",
      gerado: gerado(),
      nomeEscritorio: "Rocha & Associados",
      programado: false,
    });
    expect(html).toContain("relatorio_atendimento_2026-07-01_2026-07-30.pdf");
    expect(texto).toContain("relatorio_atendimento_2026-07-01_2026-07-30.pdf");
  });

  it("só o envio programado explica como parar de receber", () => {
    const manual = montarEmailRelatorio({
      relatorio: "financeiro",
      gerado: gerado(),
      nomeEscritorio: "Rocha & Associados",
      programado: false,
    });
    const programado = montarEmailRelatorio({
      relatorio: "financeiro",
      gerado: gerado(),
      nomeEscritorio: "Rocha & Associados",
      programado: true,
    });
    expect(manual.html).not.toContain("Programar envio");
    expect(programado.html).toContain("Programar envio");
  });
});
