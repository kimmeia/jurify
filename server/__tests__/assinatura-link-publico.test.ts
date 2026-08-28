import { execSync } from "child_process";
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

const semComentarios = (fonte: string) =>
  fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/**
 * `/uploads/` dentro de string pode ser duas coisas bem diferentes: destino
 * de navegação (o bug) ou teste sobre um valor que veio do servidor ("isto é
 * arquivo interno?" — a correção). Só o primeiro interessa.
 */
const GUARDA = /(startsWith|endsWith|includes|indexOf|match|replace|test)\(\s*$/;

function urlsDeNavegacao(fonte: string): string[] {
  const achados: string[] = [];
  const re = /["'`](\/uploads\/[^"'`]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte))) {
    const antes = fonte.slice(Math.max(0, m.index - 40), m.index);
    if (GUARDA.test(antes)) continue;
    achados.push(m[1]);
  }
  return achados;
}

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
    const inicio = tela.indexOf("{urlLeitura && (");
    expect(inicio, "bloco do botão de leitura sumiu").toBeGreaterThan(0);
    const trecho = tela.slice(inicio, tela.indexOf("Abrir documento para leitura"));
    expect(trecho).toContain('target="_blank"');
    expect(trecho).toContain('rel="noopener noreferrer"');
    expect(trecho).toContain("href={urlLeitura}");
  });

  it("documento cadastrado como link externo continua abrindo direto", () => {
    // Regressão fácil de introduzir: mandar TODO documento pela rota por
    // token quebra quem usou "URL do Documento" (Google Docs), porque a rota
    // lê do disco.
    const calculo = tela.slice(tela.indexOf("const urlLeitura"), tela.indexOf("return (", tela.indexOf("const urlLeitura")));
    expect(calculo).toMatch(/https\?:/);
    expect(calculo).toContain("return bruta");
  });

  it("só http(s) vira link — javascript:/data: não", () => {
    const calculo = tela.slice(tela.indexOf("const urlLeitura"), tela.indexOf("return (", tela.indexOf("const urlLeitura")));
    expect(calculo).toMatch(/\/\^https\?:\\\/\\\//);
    expect(calculo).toContain("return null");
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
    // /uploads/pareceres/ é capability-URL pública por design (exceção
    // registrada no middleware de /uploads).
    const proibidas = urlsDeNavegacao(semComentarios(fonte)).filter(
      (u) => !u.startsWith("/uploads/pareceres/"),
    );
    expect(proibidas, `URL autenticada em página pública: ${proibidas.join(", ")}`).toEqual([]);
  });
});

describe("contrato da rota pública por token", () => {
  const rota = ler("server/escritorio/assinatura-pdf-route.ts");
  const trechoToken = rota.slice(rota.indexOf('app.get("/api/assinatura/pdf/token/:token"'));

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
    const helper = rota.slice(rota.indexOf("function resolverPathArquivo"), rota.indexOf("function urlExternaSegura"));
    expect(helper).toContain('startsWith("/uploads/")');
    expect(helper).toContain('includes("..")');
  });

  it("redireciona documento externo em vez de recusar", () => {
    expect(trechoToken).toContain("urlExternaSegura");
    expect(trechoToken).toContain("res.redirect(302");
  });

  it("redirect só pra http(s) — não vira execução de script na aba do cliente", () => {
    const helper = rota.slice(rota.indexOf("function urlExternaSegura"), rota.indexOf("function caminhoInterno"));
    expect(helper).toMatch(/protocol !== "http:"/);
    expect(helper).toMatch(/protocol !== "https:"/);
    // URL absoluta do próprio sistema é arquivo interno: redirecionar pra lá
    // devolveria o 401 que esta rota existe pra evitar.
    expect(helper).toContain('pathname.startsWith("/uploads/")');
  });

  it("confere o escritório do path (rota sem sessão é a mais exposta)", () => {
    expect(trechoToken).toContain("escritorio_");
    expect(trechoToken).toContain("a.escritorioId");
    expect(trechoToken).toContain("403");
  });

  it("arquivo sumido vira alerta, não só log perdido no stdout", () => {
    expect(rota).toContain('from "../_core/sentry"');
    expect(trechoToken).toContain("captureError");
    // Cliente abre em aba nova do celular: JSON cru é um beco sem saída.
    expect(trechoToken).toContain('req.accepts("html")');
  });

  it("nome do arquivo salvo é o título, sanitizado", () => {
    const helper = rota.slice(rota.indexOf("function cabecalhoNome"), rota.indexOf("const MIME_POR_EXT"));
    expect(helper).toContain("filename*=UTF-8''");
    // CR/LF em header derruba a resposta inteira (ERR_INVALID_CHAR) e título
    // é texto livre do operador.
    expect(helper).toMatch(/\[\\r\\n/);
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

describe("pdfjs no build legacy (celular antigo)", () => {
  it("a biblioteca resolve pro legacy", () => {
    // O build moderno usa Promise.withResolvers, ausente em iOS < 17.4 e em
    // Samsung Internet antigo: o preview do documento virava tela branca. O
    // legacy carrega o polyfill junto.
    expect(ler("vite.config.ts")).toContain("pdfjs-dist/legacy/build/pdf.mjs");
  });

  it("TODO worker importado é da mesma variante da biblioteca", () => {
    // Worker moderno + biblioteca legacy é o "sendWithPromise null": passa no
    // build, quebra no navegador. E cada variante extra vira mais um chunk de
    // ~1 MB no bundle.
    const arquivos = execSync("grep -rl 'pdf.worker' client/src", { cwd: raiz, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    expect(arquivos.length).toBeGreaterThan(0);
    const modernos = arquivos.filter((f) =>
      /from "pdfjs-dist\/build\/pdf\.worker/.test(ler(f)),
    );
    expect(modernos, `worker moderno com biblioteca legacy: ${modernos.join(", ")}`).toEqual([]);
  });
});
