import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Página pública NÃO pode depender de rota autenticada.
 *
 * O que aconteceu (28/08): /uploads virou autenticado por LGPD (commit
 * 65cb0fd, 10/08) com a premissa escrita no código de que "o assinante
 * EXTERNO não usa este caminho". A premissa era falsa: o botão "Abrir
 * documento para leitura" da tela /assinar/:token fazia
 * window.open(doc.documentoUrl) — e documentoUrl é justamente
 * /uploads/assinaturas/escritorio_<id>/....
 *
 * No computador do advogado funcionava (cookie de sessão presente); no
 * celular do cliente, que nunca teve login, virava a tela branca com
 * {"error":"Não autenticado"}. Ninguém percebeu porque quem testa está
 * logado — por isso a amarra aqui é estática, não depende de repro.
 */

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/** Telas renderizadas SEM login (rotas fora do guard em App.tsx). */
const PAGINAS_PUBLICAS = [
  "client/src/pages/AssinarDocumento.tsx",
  "client/src/pages/Home.tsx",
  "client/src/pages/Termos.tsx",
  "client/src/pages/Privacidade.tsx",
];

describe("tela pública de assinatura", () => {
  const tela = ler("client/src/pages/AssinarDocumento.tsx");

  it("abre o documento pela rota por token, não pelo path /uploads", () => {
    expect(tela).toContain("/api/assinatura/pdf/token/${token}");
    // documentoUrl segue vindo do servidor (campo não removido), mas serve
    // só como "existe documento?" — nunca como destino de navegação.
    expect(tela).not.toMatch(/window\.open\(\s*doc\.documentoUrl/);
    expect(tela).not.toMatch(/href=\{\s*doc\.documentoUrl/);
  });

  it("usa âncora de verdade (pop-up por JS é bloqueado em celular)", () => {
    const trecho = tela.slice(
      tela.indexOf("Link do documento"),
      tela.indexOf("Info de expiração"),
    );
    expect(trecho).toContain('target="_blank"');
    expect(trecho).toContain('rel="noopener noreferrer"');
  });
});

describe("nenhuma página pública aponta pra rota autenticada", () => {
  it.each(PAGINAS_PUBLICAS)("%s não navega para /uploads", (arquivo) => {
    let fonte: string;
    try {
      fonte = ler(arquivo);
    } catch {
      return; // arquivo renomeado — outras suites cobrem a rota
    }
    // Só interessa /uploads usado como URL (string literal ou template),
    // não menção em comentário explicando por que NÃO se usa.
    const semComentarios = fonte
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const urlsUploads = semComentarios.match(/["'`]\/uploads\/[^"'`]*/g) || [];
    // /uploads/pareceres/ é capability-URL pública por design (exceção
    // registrada no middleware de /uploads).
    const proibidas = urlsUploads.filter((u) => !u.includes("/uploads/pareceres/"));
    expect(proibidas, `URL autenticada em página pública: ${proibidas.join(", ")}`).toEqual([]);
  });
});

describe("contrato da rota pública por token", () => {
  const rota = ler("server/escritorio/assinatura-pdf-route.ts");

  it("a rota que a tela chama existe no servidor", () => {
    expect(rota).toContain('app.get("/api/assinatura/pdf/token/:token"');
  });

  it("serve com Range (leitor de PDF do iOS pede faixas de bytes)", () => {
    expect(rota).toContain("acceptRanges: true");
    expect(rota).toContain("res.sendFile");
  });

  it("Content-Type sai da extensão — o documento nem sempre é PDF", () => {
    expect(rota).toContain("MIME_POR_EXT");
    expect(rota).toContain("wordprocessingml.document");
  });

  it("path traversal continua barrado", () => {
    const helper = rota.slice(rota.indexOf("function resolverPathArquivo"), rota.indexOf("MIME_POR_EXT"));
    expect(helper).toContain('startsWith("/uploads/")');
    expect(helper).toContain('includes("..")');
  });

  it("tem teto de requisições (link público) sem estrangular o Range", () => {
    const boot = ler("server/_core/index.ts");
    expect(boot).toContain('"/api/assinatura/pdf/token"');
    const trecho = boot.slice(boot.indexOf('"/api/assinatura/pdf/token"'), boot.indexOf('"/api/assinatura/pdf/token"') + 200);
    expect(trecho).toMatch(/max:\s*(\d{2,})/);
  });
});

describe("middleware de /uploads (o que quebrou)", () => {
  const boot = ler("server/_core/index.ts");

  it("segue exigindo sessão — a correção foi na tela, não em afrouxar o /uploads", () => {
    const trecho = boot.slice(boot.indexOf('"/uploads"'), boot.indexOf('express.static("./uploads")'));
    expect(trecho).toContain("authenticateRequest");
    expect(trecho).toContain('req.path.startsWith("/pareceres/")');
  });
});
