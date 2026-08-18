/**
 * Três defeitos em fila, cada um escondendo o próximo.
 *
 * Só apareceram porque a correção do primeiro deixou o segundo aparecer, e
 * assim por diante. Vale registrar a ordem, porque quem mexer nisso depois vai
 * encontrar a mesma sequência se desfizer qualquer um dos elos.
 *
 * 1. PEDIA O DOCUMENTO PELA PORTA ERRADA. `context.request.get` é uma
 *    requisição com os cookies da sessão, sem página. No PJe a peça mora
 *    dentro de um visualizador JSF: sem navegador o script não roda e volta a
 *    casca da tela — o menu, que virou "teor" e foi resumido pela IA.
 *
 * 2. LIA O CORPO PELO CAMINHO ERRADO. Com o navegador aberto, a resposta do
 *    PDF é detectada, mas `response.body()` devolve lixo: o visualizador
 *    embutido do Chromium intercepta o PDF e entrega o HTML dele no lugar dos
 *    bytes. Medido: servidor mandou 1294 bytes de PDF, `body()` devolveu 345
 *    começando em "<!doctyp". Daí a divisão — o navegador serve pra DESCOBRIR
 *    o endereço, e os bytes vêm por requisição direta.
 *
 * 3. NÃO CONSEGUIA LER O PDF. `pdf-parse` quebra no Node 22+ com "bad XRef
 *    entry". O repo já sabia disso e contornava no chat do agente, mas o
 *    extrator usado pelo teor nunca recebeu o contorno. O documento chegava
 *    íntegro e falhava no último passo.
 */

import { readFileSync } from "fs";
import { join } from "path";
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { extrairTextoDocumento } from "../_core/agente-doc-extracao";
import {
  assinaturaDeArquivo,
  pareceBinario,
  textoDoDocumento,
} from "../processos/teor-documento";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const adapter = ler("scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts");
const router = ler("server/processos/router-movimentacoes.ts");

function pdfDeTeste(texto: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const partes: Buffer[] = [];
    doc.on("data", (c: Buffer) => partes.push(c));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.fontSize(12).text(texto);
    doc.end();
  });
}

describe("ler o PDF até o fim", () => {
  it("extrai o texto de um PDF de verdade", async () => {
    // Este teste falhava antes do fallback: `pdf-parse` levantava "bad XRef
    // entry" e o teor morria ali, com o documento correto na mão.
    const pdf = await pdfDeTeste("SENTENCA. Julgo IMPROCEDENTES os embargos de declaracao.");
    const r = await extrairTextoDocumento(pdf, "application/pdf");
    expect(r.erro).toBeNull();
    expect(r.texto).toContain("IMPROCEDENTES");
  });

  it("PDF ilegível diz o que o primeiro leitor reclamou", async () => {
    // Sem carregar o motivo original, "sem texto extraível" esconderia que o
    // problema foi a biblioteca, não o arquivo.
    const r = await extrairTextoDocumento(Buffer.from("nada disso é PDF"), "application/pdf");
    expect(r.texto).toBeNull();
    expect(r.erro).toMatch(/\[.+\]/);
  });

  it("o fallback existe e é o pdfjs que o resto do sistema usa", () => {
    const extrator = ler("server/_core/agente-doc-extracao.ts");
    expect(extrator).toContain("pdfjs-dist/legacy/build/pdf.mjs");
    const iPdfParse = extrator.indexOf('import("pdf-parse")');
    const iPdfjs = extrator.indexOf("textoPdfComPdfjs(buffer)");
    expect(iPdfParse).toBeGreaterThan(0);
    expect(iPdfjs, "pdfjs é a segunda tentativa, não a primeira").toBeGreaterThan(iPdfParse);
  });
});

describe("achar o documento dentro do visualizador", () => {
  it("o navegador descobre o endereço; os bytes vêm por requisição", () => {
    // Guardar `response.body()` de um PDF em iframe devolve o HTML do
    // visualizador do Chromium, não o arquivo.
    const i = adapter.indexOf("export async function abrirDocumentoNoNavegador");
    expect(i).toBeGreaterThan(0);
    const corpo = adapter.slice(i, i + 4200);
    expect(corpo).toContain("const enderecos: string[] = []");
    expect(corpo).toContain("enderecos.push(r.url())");
    expect(corpo, "os bytes não podem sair do response da página").not.toContain(
      "r.body().then",
    );
    expect(corpo).toContain("context.request\n        .get(endereco");
  });

  it("espera o AJAX do JSF antes de desistir", () => {
    // `domcontentloaded` numa tela JSF chega antes do documento existir.
    const i = adapter.indexOf("export async function abrirDocumentoNoNavegador");
    expect(adapter.slice(i, i + 4200)).toContain('waitForLoadState("networkidle"');
  });

  it("não exige `application/pdf` pra considerar candidato", () => {
    // Foi o primeiro filtro, e descartava o arquivo certo: o PJe entrega
    // documento como octet-stream, às vezes sem tipo e só com
    // `content-disposition: attachment`. Contra o tribunal de verdade o
    // relatório dizia "nenhuma resposta trouxe o documento" com o documento
    // tendo passado na frente.
    expect(adapter).toContain("function podeSerDocumento(");
    expect(adapter).toContain('headers["content-disposition"]');
    // A pergunta é a inversa: isto é claramente OUTRA coisa?
    for (const t of ["text/html", "application/json", "image/"]) {
      expect(adapter, t).toContain(`"${t}"`);
    }
  });

  it("quem decide de fato é o conteúdo, não o cabeçalho", () => {
    // `textoDoDocumento` reconhece PDF pelos bytes iniciais, então
    // octet-stream que seja PDF passa e HTML disfarçado não.
    expect(ler("server/processos/teor-documento.ts")).toContain(
      'corpo.subarray(0, 5).toString("latin1") === "%PDF-"',
    );
  });

  it("quando nada serve, guarda o que a aba Network mostraria", () => {
    // É o dado que faltava pra acertar a rota — sem pedir pra ninguém abrir o
    // DevTools.
    const i = adapter.indexOf("export async function abrirDocumentoNoNavegador");
    const corpo = adapter.slice(i, i + 4200);
    expect(corpo).toContain("vistas.push({ url: r.url(), status: r.status()");
    expect(corpo).toContain("erro: \"o visualizador abriu, mas nenhuma resposta trouxe o documento\"");
  });

  it("o botão de buscar usa o navegador, não a requisição solta", () => {
    expect(router).toContain("abrirDocumentoNoNavegador(url, sessao)");
    expect(router).toContain("[teor] visualizador abriu mas nenhuma resposta trouxe o documento");
  });
});

describe("arquivo da página não é documento", () => {
  // A primeira vez que o robô achou "o documento", o que ele trouxe foi a
  // fonte da tela. Sem texto de verdade pra ler, a IA resumiu o rótulo e
  // fixou um prazo de 15 dias que ninguém escreveu — prazo inventado em
  // escritório de advocacia é o pior resultado possível deste sistema.
  const woff2 = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(400, 0x42)]);

  it("reconhece a fonte pelos primeiros bytes", () => {
    expect(assinaturaDeArquivo(woff2)).toContain("WOFF2");
  });

  it("recusa a fonte mesmo quando o tipo mente", async () => {
    // O tribunal serve fonte como octet-stream, font/woff2 ou sem tipo — o
    // cabeçalho não é confiável, os bytes são.
    for (const ct of ["application/pdf", "application/octet-stream", null]) {
      await expect(textoDoDocumento(woff2, ct)).rejects.toThrow(/fonte/i);
    }
  });

  it("pega binário que escapou das assinaturas conhecidas", async () => {
    // Rede de segurança: qualquer coisa lida como UTF-8 vira string e passa
    // no piso de tamanho. Caractere de controle é a marca, e peça judicial
    // não tem nenhum.
    const lixo = Buffer.alloc(600);
    for (let i = 0; i < lixo.length; i++) lixo[i] = i % 7 === 0 ? 0x41 : i % 256;
    await expect(textoDoDocumento(lixo, "application/octet-stream")).rejects.toThrow();
  });

  it("decisão servida como HTML continua passando", async () => {
    // O PJe serve muita peça como HTML; barrar binário não pode barrar isso.
    const decisao = Buffer.from(
      "<html><body><p>Vistos. DEFIRO parcialmente a tutela provisória, " +
        "determinando a apresentação dos documentos em 15 dias.</p></body></html>",
      "utf-8",
    );
    await expect(textoDoDocumento(decisao, "text/html")).resolves.toContain("DEFIRO");
  });

  it("texto de verdade não é confundido com binário", () => {
    expect(pareceBinario("Vistos. Julgo procedente o pedido. Intime-se.")).toBe(false);
    expect(pareceBinario("acentuação, cedilha ç e travessão — tudo normal")).toBe(false);
  });

  it("a limpeza tira o teor e o prazo que saiu dele", () => {
    const m = ler("drizzle/0196_teor_binario.sql");
    expect(m).toContain("teor LIKE 'wOF2%'");
    expect(m).toContain("resumo_ia = NULL");
    expect(m).toContain("DELETE ps FROM prazos_sugeridos ps");
    expect(m).toContain("ps.status = 'pendente'");
  });
});
