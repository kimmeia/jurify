import { describe, it, expect } from "vitest";
import {
  deveBuscarTeor,
  extrairTextoDeHtml,
  normalizarTeor,
  truncarTeor,
  localizarTrecho,
  classificarFalhaTeor,
  textoDoDocumento,
  normalizarParaBusca,
  MAX_TEOR_CHARS,
} from "./teor-documento";

describe("deveBuscarTeor", () => {
  it("abre documento para movimentação que decide algo", () => {
    for (const t of [
      "Decisão proferida nos autos",
      "Julgado procedente em parte o pedido",
      "Sentença registrada",
      "Despacho: manifeste-se a parte autora",
      "Audiência de conciliação designada",
      "Intimação eletrônica expedida",
      "Homologado o acordo entre as partes",
      "Concedida a tutela de urgência",
    ]) {
      expect(deveBuscarTeor(t), t).toBe(true);
    }
  });

  it("ignora expediente de rotina", () => {
    for (const t of [
      "Conclusos para decisão",
      "Distribuído por sorteio",
      "Remetidos os Autos (em grau de recurso) para Instância Superior",
      "Juntada de petição",
      "Publicado no DJE",
      "Arquivado definitivamente",
      "Certidão emitida",
      "Decurso de prazo",
    ]) {
      expect(deveBuscarTeor(t), t).toBe(false);
    }
  });

  it("bloqueio vence gatilho quando os dois batem", () => {
    // "manifestação" (gatilho) dentro de "juntada" (bloqueio)
    expect(deveBuscarTeor("Juntada de petição de manifestação")).toBe(false);
    // "decisão" (gatilho) dentro de "conclusos" (bloqueio)
    expect(deveBuscarTeor("Conclusos para decisão")).toBe(false);
  });

  it("ignora texto curto ou vazio", () => {
    expect(deveBuscarTeor("")).toBe(false);
    expect(deveBuscarTeor("Ok")).toBe(false);
  });

  it("não depende de acento nem de caixa", () => {
    expect(deveBuscarTeor("SENTENCA PROFERIDA")).toBe(true);
    expect(deveBuscarTeor("sentença proferida")).toBe(true);
  });
});

describe("extrairTextoDeHtml", () => {
  it("remove script/style e preserva quebra de bloco", () => {
    const html = `
      <html><head><style>.x{color:red}</style></head>
      <body><script>var a=1;</script>
      <p>DECISÃO</p>
      <p>Defiro a liminar.</p>
      </body></html>`;
    const out = extrairTextoDeHtml(html);
    expect(out).not.toContain("color:red");
    expect(out).not.toContain("var a");
    // Parágrafos ficam separados por linha em branco — é o que dá pra
    // distinguir dispositivo de relatório quando o texto vai pra IA.
    expect(out).toBe("DECISÃO\n\nDefiro a liminar.");
  });

  it("decodifica entidades", () => {
    expect(extrairTextoDeHtml("<p>Manifesta&ccedil;&atilde;o &amp; prazo</p>")).toBe(
      "Manifestação & prazo",
    );
    expect(extrairTextoDeHtml("<p>&#68;espacho</p>")).toBe("Despacho");
  });

  it("converte <br> em quebra de linha", () => {
    expect(extrairTextoDeHtml("a<br>b<br/>c")).toBe("a\nb\nc");
  });

  it("string vazia devolve vazio", () => {
    expect(extrairTextoDeHtml("")).toBe("");
  });
});

describe("normalizarTeor", () => {
  it("remove numeração de página solta", () => {
    const bruto = "Vistos.\n3\nDefiro.\nPágina 2 de 12\n- 7 -\nIntime-se.";
    expect(normalizarTeor(bruto)).toBe("Vistos.\nDefiro.\nIntime-se.");
  });

  it("colapsa espaço e limita linhas em branco a uma", () => {
    expect(normalizarTeor("a    b\n\n\n\nc")).toBe("a b\n\nc");
  });

  it("não come número que faz parte de frase", () => {
    const t = normalizarTeor("Prazo de 15 dias\n2024");
    expect(t).toContain("Prazo de 15 dias");
    // "2024" sozinho numa linha É removido — é o comportamento desejado
    // (rodapé de PDF), e o ano relevante aparece dentro da frase.
    expect(t).toBe("Prazo de 15 dias");
  });
});

describe("truncarTeor", () => {
  it("não mexe em texto dentro do limite", () => {
    expect(truncarTeor("curto", 100)).toBe("curto");
  });

  it("preserva começo e fim ao cortar", () => {
    const texto = `INÍCIO${"x".repeat(500)}DISPOSITIVO`;
    const out = truncarTeor(texto, 200);
    expect(out.startsWith("INÍCIO")).toBe(true);
    expect(out.endsWith("DISPOSITIVO")).toBe(true);
    expect(out).toContain("trecho omitido");
    expect(out.length).toBeLessThan(texto.length);
  });

  it("usa MAX_TEOR_CHARS por padrão", () => {
    const texto = "y".repeat(MAX_TEOR_CHARS + 100);
    expect(truncarTeor(texto)).toContain("trecho omitido");
  });
});

describe("localizarTrecho", () => {
  const teor = `DECISÃO

Vistos. Presentes os requisitos do art. 300 do CPC, DEFIRO PARCIALMENTE a tutela.

Junte a parte autora, no prazo de 15 (quinze) dias úteis, o extrato integral do
benefício dos últimos 5 (cinco) anos, sob pena de preclusão.

Intime-se.`;

  it("acha o trecho mesmo quando a IA perde acento e caixa", () => {
    const achado = localizarTrecho(
      teor,
      "junte a parte autora, no prazo de 15 (quinze) dias uteis",
    );
    expect(achado).toContain("Junte a parte autora");
    expect(achado).toContain("dias úteis"); // devolve o ORIGINAL, acentuado
  });

  it("acha quando a IA colapsou a quebra de linha do documento", () => {
    const achado = localizarTrecho(teor, "o extrato integral do benefício dos últimos 5");
    expect(achado).toContain("extrato integral");
  });

  it("tolera aspas ao redor da citação", () => {
    expect(localizarTrecho(teor, '"DEFIRO PARCIALMENTE a tutela"')).toContain(
      "DEFIRO PARCIALMENTE",
    );
  });

  it("cai no prefixo quando a IA citou além do que existe", () => {
    const achado = localizarTrecho(
      teor,
      "Junte a parte autora, no prazo de 15 (quinze) dias úteis, sob pena de multa diária",
    );
    expect(achado).toContain("Junte a parte autora");
  });

  it("devolve null quando o trecho não existe no documento", () => {
    expect(localizarTrecho(teor, "condeno o réu ao pagamento de honorários")).toBeNull();
  });

  it("devolve null para agulha curta demais pra ser confiável", () => {
    expect(localizarTrecho(teor, "Vistos")).toBeNull();
  });

  it("devolve null com entradas vazias", () => {
    expect(localizarTrecho("", "qualquer coisa")).toBeNull();
    expect(localizarTrecho(teor, "")).toBeNull();
  });
});

describe("classificarFalhaTeor", () => {
  it("sigilo vira indisponivel (não adianta re-tentar)", () => {
    expect(classificarFalhaTeor(new Error("Processo em SEGREDO DE JUSTIÇA")).status).toBe(
      "indisponivel",
    );
    expect(classificarFalhaTeor(new Error("HTTP 403 Forbidden")).status).toBe("indisponivel");
  });

  it("404 vira indisponivel", () => {
    expect(classificarFalhaTeor(new Error("HTTP 404 not found")).status).toBe("indisponivel");
  });

  it("timeout vira erro (transitório, vale re-tentar)", () => {
    const r = classificarFalhaTeor(new Error("Navigation timeout of 30000ms exceeded"));
    expect(r.status).toBe("erro");
    expect(r.motivo).toMatch(/tempo esgotado/);
  });

  it("PDF escaneado vira erro com motivo legível", () => {
    const r = classificarFalhaTeor(new Error("PDF sem texto extraível (possivelmente escaneado)"));
    expect(r.status).toBe("erro");
    expect(r.motivo).toMatch(/escaneado/);
  });

  it("erro desconhecido preserva a mensagem original truncada", () => {
    const r = classificarFalhaTeor(new Error("x".repeat(400)));
    expect(r.status).toBe("erro");
    expect(r.motivo.length).toBeLessThanOrEqual(200);
  });

  it("entrada nula não quebra", () => {
    expect(classificarFalhaTeor(null).status).toBe("erro");
  });
});

describe("textoDoDocumento", () => {
  it("HTML pelo content-type", async () => {
    const buf = Buffer.from("<html><body><p>Ante o exposto, JULGO PROCEDENTE o pedido formulado na inicial.</p></body></html>");
    await expect(textoDoDocumento(buf, "text/html; charset=utf-8")).resolves.toContain(
      "JULGO PROCEDENTE",
    );
  });

  it("texto puro", async () => {
    const buf = Buffer.from("Decisão: defiro a gratuidade da justiça requerida pela parte autora.");
    await expect(textoDoDocumento(buf, "text/plain")).resolves.toContain("defiro a gratuidade");
  });

  it("corpo vazio falha explicitamente", async () => {
    await expect(textoDoDocumento(Buffer.alloc(0), "text/html")).rejects.toThrow(/vazio/);
  });

  it("HTML sem texto útil falha em vez de gravar lixo", async () => {
    await expect(textoDoDocumento(Buffer.from("<html><body></body></html>"), "text/html")).rejects.toThrow(
      /sem texto/,
    );
  });

  it("content-type mentiroso cai no sniff do magic number do PDF", async () => {
    // %PDF- no início mas servido como text/html: precisa ir pro parser de
    // PDF (e falhar como PDF inválido), não ser lido como HTML.
    const buf = Buffer.from("%PDF-1.4\ncorpo inválido");
    await expect(textoDoDocumento(buf, "text/html")).rejects.toThrow();
  });
});

describe("normalizarParaBusca", () => {
  it("tira acento, caixa e espaço repetido", () => {
    expect(normalizarParaBusca("  SENTENÇA   Proferida\nNos Autos ")).toBe(
      "sentenca proferida nos autos",
    );
  });

  it("entrada nula vira string vazia", () => {
    expect(normalizarParaBusca(undefined as unknown as string)).toBe("");
  });
});
