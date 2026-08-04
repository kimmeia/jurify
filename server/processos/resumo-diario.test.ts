import { describe, it, expect } from "vitest";
import {
  assuntoEmail,
  textoWhatsApp,
  textoEmail,
  htmlEmail,
  textoRestante,
  type DadosResumo,
  type ItemResumo,
} from "./resumo-diario";

const item = (over: Partial<ItemResumo> = {}): ItemResumo => ({
  cliente: "Maria Aparecida do Nascimento",
  cnj: "0261912-66.2023.8.06.0001",
  titulo: "Tutela deferida em parte — e o juiz mandou você juntar os extratos",
  pontos: ["Deferiu a suspensão dos descontos.", "Indeferiu a devolução em dobro por ora."],
  citacao: "Junte a parte autora, no prazo de 15 (quinze) dias úteis, o extrato integral.",
  desfecho: "parcial",
  ehAudiencia: false,
  prazoData: new Date("2026-08-17T00:00:00Z"),
  prazoDiasUteisRestantes: 9,
  vara: "2ª Vara Cível",
  ...over,
});

const dados = (over: Partial<DadosResumo> = {}): DadosResumo => ({
  nomeDestinatario: "Bruno",
  dataRef: "2026-08-04",
  totalMovimentacoes: 25,
  totalProcessos: 19,
  exigemAcao: [item()],
  relevantes: ["perícia favorável (Luciana Prado)"],
  totalRelevantes: 5,
  totalRotina: 17,
  paradosHaMuito: [],
  urlCentral: "https://juridflow.com.br/movimentacoes",
  ...over,
});

describe("textoRestante", () => {
  it("traduz o número em algo acionável", () => {
    expect(textoRestante(9)).toBe("9 dias úteis");
    expect(textoRestante(1)).toBe("1 dia útil");
    expect(textoRestante(0)).toBe("vence hoje");
    expect(textoRestante(-3)).toBe("3 dias vencido");
    expect(textoRestante(-1)).toBe("1 dia vencido");
    expect(textoRestante(null)).toBe("");
  });
});

describe("assuntoEmail", () => {
  it("carrega o número — 'Resumo diário' não diz se dá pra esperar", () => {
    expect(assuntoEmail(dados())).toContain("1 movimentação exige sua ação hoje");
    expect(assuntoEmail(dados())).toContain("2026-08-04");
  });

  it("pluraliza", () => {
    expect(assuntoEmail(dados({ exigemAcao: [item(), item()] }))).toContain(
      "2 movimentações exigem sua ação hoje",
    );
  });

  it("avisa quando algo está no prazo final", () => {
    const s = assuntoEmail(dados({ exigemAcao: [item({ prazoDiasUteisRestantes: 0 })] }));
    expect(s).toContain("⚠");
    expect(s).toContain("1 no prazo final");
  });

  it("dia sem nada acionável diz isso no assunto", () => {
    expect(assuntoEmail(dados({ exigemAcao: [] }))).toContain("Nenhuma movimentação exige sua ação");
  });
});

describe("textoWhatsApp", () => {
  it("traz cliente, título e prazo de cada item acionável", () => {
    const t = textoWhatsApp(dados())!;
    expect(t).toContain("Bom dia, Bruno");
    expect(t).toContain("*Maria Aparecida do Nascimento*");
    expect(t).toContain("Tutela deferida em parte");
    expect(t).toContain("⏰ Vence 17/08 — 9 dias úteis");
  });

  it("audiência usa outro verbo e outro ícone", () => {
    const t = textoWhatsApp(
      dados({ exigemAcao: [item({ ehAudiencia: true, prazoData: new Date("2026-09-09T00:00:00Z") })] }),
    )!;
    expect(t).toContain("📌 Audiência em 09/09");
    expect(t).not.toContain("⏰ Vence");
  });

  it("não manda mensagem quando nada exige ação", () => {
    // Mandar "nada pra você hoje" todo dia é o caminho mais rápido pro
    // advogado silenciar o número.
    expect(textoWhatsApp(dados({ exigemAcao: [] }))).toBeNull();
  });

  it("não lista as relevantes nem a rotina — só conta", () => {
    const t = textoWhatsApp(dados())!;
    expect(t).toContain("5 movimentações relevantes sem prazo e 17 de rotina");
    expect(t).not.toContain("Luciana Prado");
  });

  it("omite a linha do resto quando não há resto", () => {
    const t = textoWhatsApp(dados({ totalRelevantes: 0, totalRotina: 0, relevantes: [] }))!;
    expect(t).not.toContain("Fora essas");
    expect(t).toContain("Ver tudo:");
  });

  it("sempre termina com o link da central", () => {
    expect(textoWhatsApp(dados())!.trimEnd().endsWith("https://juridflow.com.br/movimentacoes")).toBe(true);
  });
});

describe("htmlEmail", () => {
  it("mostra o placar dos três grupos", () => {
    const h = htmlEmail(dados());
    expect(h).toContain(">1<"); // exigem ação
    expect(h).toContain(">5<"); // relevantes
    expect(h).toContain(">17<"); // rotina
    expect(h).toContain("Exigem ação");
  });

  it("cita o juiz literalmente", () => {
    expect(htmlEmail(dados())).toContain("Junte a parte autora");
  });

  it("escapa HTML vindo do documento", () => {
    const h = htmlEmail(dados({ exigemAcao: [item({ cliente: 'Fulano <script>alert("x")</script>' })] }));
    expect(h).not.toContain("<script>alert");
    expect(h).toContain("&lt;script&gt;");
  });

  it("dia vazio ainda gera e-mail coerente", () => {
    const h = htmlEmail(dados({ exigemAcao: [], totalRelevantes: 0, totalRotina: 0, relevantes: [] }));
    expect(h).toContain("nenhuma exige providência sua");
    expect(h).not.toContain("Exigem ação sua");
  });

  it("inclui o aviso sobre os limites da contagem de prazo", () => {
    const h = htmlEmail(dados());
    expect(h).toContain("Confira o inteiro teor antes de peticionar");
    expect(h).toContain("feriado local");
  });

  it("processo parado vira o 'vale um olhar'", () => {
    const h = htmlEmail(dados({ paradosHaMuito: [{ cliente: "Espólio de Raimundo", dias: 73 }] }));
    expect(h).toContain("Vale um olhar");
    expect(h).toContain("73 dias");
  });

  it("usa tabela e estilo inline — cliente de e-mail ignora <style> e flexbox", () => {
    const h = htmlEmail(dados());
    expect(h).toContain("<table");
    expect(h).not.toContain("display:flex");
  });
});

describe("textoEmail", () => {
  it("carrega o essencial em texto puro", () => {
    const t = textoEmail(dados());
    expect(t).toContain("Maria Aparecida do Nascimento");
    expect(t).toContain("Vence 17/08 — 9 dias úteis");
    expect(t).toContain("https://juridflow.com.br/movimentacoes");
  });
});
