/**
 * Tela sem login não pode depender de URL que exige login.
 *
 * O caso (28/08): em 10/08 o /uploads deixou de ser estático e passou a
 * exigir sessão + tenancy (LGPD). O commit trazia a premissa escrita no
 * comentário — "o assinante EXTERNO não usa este caminho". Usava: o botão
 * "Abrir documento para leitura" de /assinar/:token chamava
 * `window.open(doc.documentoUrl)`, e `documentoUrl` é
 * /uploads/assinaturas/escritorio_<id>/... O cliente do escritório, que
 * nunca teve login, levava {"error":"Não autenticado"} no celular. No
 * computador do advogado abria, porque lá o cookie existe — foi por isso
 * que passou por todo mundo.
 *
 * Por que uma varredura por `"/uploads` não teria pego: na linha que
 * quebrou não existia a string "/uploads". A URL vinha do SERVIDOR, dentro
 * do payload do tRPC. O que precisa ser proibido, então, não é o literal —
 * é a PROVENIÊNCIA: numa página pública, campo de resposta de tRPC não
 * pode virar destino de navegação, porque do lado do client ele é uma
 * string opaca e ninguém revisa a rota que a serve.
 *
 * As páginas públicas são DERIVADAS do App.tsx (rota fora de guarda), não
 * listadas à mão — rota pública nova entra na varredura sozinha.
 */

import { describe, expect, it } from "vitest";
import { GATE_PROPRIO, ler, paginasPublicas, semComentarios } from "./_paginas-publicas";

/**
 * Identificadores ligados a uma resposta do tRPC:
 *   const { data: doc, ... } = trpc.x.y.useQuery(...)
 *   const { data } = trpc.x.y.useQuery(...)
 * É a fronteira que interessa — tudo que vem daí é string escolhida pelo
 * servidor, não pela tela.
 */
export function identificadoresDoServidor(fonte: string): string[] {
  const nomes = new Set<string>();
  for (const m of fonte.matchAll(
    /const\s*\{([^}]*)\}\s*=\s*\(?\s*trpc[\s\S]{0,200}?\.use(?:Query|Mutation|SuspenseQuery)\s*\(/g,
  )) {
    for (const campo of m[1].split(",")) {
      const [chave, apelido] = campo.split(":").map((s) => s.trim().split("=")[0].trim());
      if (chave === "data") nomes.add(apelido || "data");
    }
  }
  return [...nomes];
}

/** Onde uma string vira endereço que o navegador vai buscar. */
const SUMIDOUROS = [
  /window\.open\s*\(\s*([^),]+)/g,
  /window\.location(?:\.href)?\s*=\s*([^;]+)/g,
  /location\.assign\s*\(\s*([^)]+)/g,
  /\bhref=\{([^}]+)\}/g,
  /\bsrc=\{([^}]+)\}/g,
  /\bfile=\{([^}]+)\}/g,
  /\bdata=\{([^}]+)\}/g,
];

export interface UrlSuspeita {
  arquivo: string;
  expressao: string;
  origem: string;
  via: string | null;
}

/** Lê um campo do payload? `doc.documentoUrl`, `convite?.url`, `data["x"]`. */
function leCampoDe(expr: string, origem: string): boolean {
  return new RegExp(`\\b${origem}\\s*(\\??\\.|\\[)`).test(expr);
}

/**
 * Corpo do `const <nome> = ...` no arquivo, pra seguir UM salto de apelido.
 *
 * Existe porque indireção de uma linha derrota a varredura ingênua: a tela
 * de assinatura passou a montar `const urlLeitura = (() => { ... })()` e a
 * usar `href={urlLeitura}`. O campo do servidor continua lá dentro; só
 * deixou de aparecer no sumidouro.
 */
function corpoDaConst(fonte: string, nome: string): string | null {
  const i = fonte.search(new RegExp(`\\bconst\\s+${nome}\\s*=`));
  if (i < 0) return null;
  // Começa antes do `const` pra enxergar o comentário do marcador, que por
  // convenção vai na linha de cima (ou no bloco de doc logo acima).
  const ini = Math.max(0, i - 400);
  // Até a linha em branco seguinte ou 900 chars — o bastante pra IIFE curta
  // e pra ternário de uma linha, sem varrer o componente inteiro.
  const trecho = fonte.slice(ini, i + 900);
  const fim = trecho.indexOf("\n\n", i - ini);
  return fim > 0 ? trecho.slice(0, fim) : trecho;
}

/**
 * Marcador pra caso legítimo: URL escolhida pelo servidor que a tela pública
 * PODE abrir (link externo cadastrado pelo escritório, por exemplo). Vai na
 * linha de cima, com motivo. Declarar é barato; descobrir no celular do
 * cliente do dono, não.
 *
 *   // url-do-servidor-ok: link externo do cadastro, validado pra http(s)
 */
const MARCADOR = /url-do-servidor-ok:/;

export function analisarFonte(bruto: string, arquivo = "(fonte)"): UrlSuspeita[] {
  const fonte = semComentarios(bruto);
  const origens = identificadoresDoServidor(fonte);
  if (origens.length === 0) return [];

  const achados: UrlSuspeita[] = [];
  const registrar = (expressao: string, origem: string, via: string | null) => {
    achados.push({ arquivo, expressao: expressao.slice(0, 90), origem, via });
  };

  for (const re of SUMIDOUROS) {
    for (const m of fonte.matchAll(re)) {
      const expr = m[1].trim();
      for (const origem of origens) {
        if (leCampoDe(expr, origem)) {
          registrar(expr, origem, null);
          continue;
        }
        // Sumidouro alimentado por apelido local: abre o `const` e refaz a
        // pergunta lá dentro.
        const apelido = /^[a-zA-Z_$][\w$]*$/.exec(expr)?.[0];
        if (!apelido) continue;
        const corpo = corpoDaConst(bruto, apelido);
        if (corpo && !MARCADOR.test(corpo) && leCampoDe(semComentarios(corpo), origem)) {
          registrar(`${apelido} = … ${origem}.…`, origem, apelido);
        }
      }
    }
  }
  return achados;
}

export const urlsDeProveniencaServidor = (arquivo: string): UrlSuspeita[] =>
  analisarFonte(ler(arquivo), arquivo);

/** Literal de /uploads usado como ENDEREÇO (não em comparação de string). */
export function literaisUploadsEmSumidouro(arquivo: string): string[] {
  const fonte = semComentarios(ler(arquivo));
  const achados: string[] = [];
  for (const re of SUMIDOUROS) {
    for (const m of fonte.matchAll(re)) {
      for (const u of m[1].match(/["'`]\/uploads\/[^"'`]*/g) || []) {
        if (!u.includes("/uploads/pareceres/")) achados.push(`${arquivo}: ${u}`);
      }
    }
  }
  return achados;
}

describe("página pública não navega para URL vinda do servidor", () => {
  const publicas = paginasPublicas();

  it("a lista de páginas públicas sai do App.tsx e inclui a de assinatura", () => {
    // Sem esta âncora, um App.tsx renomeado deixaria a varredura verde por
    // não ter olhado nada — que é o modo mais comum de um teste destes morrer.
    expect(publicas).toContain("client/src/pages/AssinarDocumento.tsx");
    expect(publicas).toContain("client/src/pages/AceitarConvite.tsx");
    expect(publicas.length).toBeGreaterThanOrEqual(8);
    expect(publicas.some((p) => p.includes("/admin/"))).toBe(false);
  });

  it("nenhuma tela sem login usa campo de resposta tRPC como endereço", () => {
    const achados = publicas.flatMap(urlsDeProveniencaServidor);
    const relatorio = achados
      .map(
        (a) =>
          `${a.arquivo}: usa \`${a.expressao}\` como URL — ${a.origem} vem do tRPC` +
          `${a.via ? ` (via ${a.via})` : ""}.\n` +
          `    Quem abre esta tela não tem sessão. Sirva por rota com capability ` +
          `própria (ex.: /api/assinatura/pdf/token/:token) em vez do path interno — ` +
          `ou marque "url-do-servidor-ok: <motivo>" se for endereço externo mesmo.`,
      )
      .join("\n");
    expect(relatorio).toBe("");
  });

  it("literal de /uploads não passa como endereço (fora de pareceres)", () => {
    // Só quando o literal É o destino: `bruta.startsWith("/uploads/")` numa
    // normalização é uso legítimo e não pode gritar.
    expect(publicas.flatMap(literaisUploadsEmSumidouro)).toEqual([]);
  });

  it("o editor de planos segue com gate próprio (por isso está na exceção)", () => {
    const editor = ler(GATE_PROPRIO[0]);
    expect(editor).toContain('user.role !== "admin"');
    expect(editor).toContain("<Redirect to=");
  });
});

describe("proveniência — a heurística em si", () => {
  it("reconhece o formato de binding usado na casa", () => {
    const fonte = `
      const { data: doc, isLoading } = (trpc as any).assinaturas.visualizarPorToken.useQuery({ token });
      const { data: campos = [] } = trpc.assinaturas.listarCamposPorToken.useQuery({ token });
    `;
    expect(identificadoresDoServidor(fonte).sort()).toEqual(["campos", "doc"]);
  });

  const bind = `const { data: doc } = (trpc as any).assinaturas.visualizarPorToken.useQuery({ token });`;

  it("acusa o window.open exato que quebrou", () => {
    const achados = analisarFonte(`${bind}\nwindow.open(doc.documentoUrl, "_blank");`);
    expect(achados).toHaveLength(1);
    expect(achados[0].expressao).toContain("doc.documentoUrl");
  });

  it("absolve o href montado por token", () => {
    const achados = analisarFonte(
      `${bind}\nhref={\`/api/assinatura/pdf/token/\${token}\`}`,
    );
    expect(achados).toEqual([]);
  });

  it("atravessa apelido de uma linha — indireção não é escapatória", () => {
    // Foi assim que a tela ficou depois da correção: o campo do servidor
    // sumiu do sumidouro e foi morar num `const`.
    const achados = analisarFonte(
      `${bind}\nconst urlLeitura = doc.documentoUrl || null;\n\nhref={urlLeitura}`,
    );
    expect(achados).toHaveLength(1);
    expect(achados[0].via).toBe("urlLeitura");
  });

  it("marcador declarado libera o caso legítimo", () => {
    const achados = analisarFonte(
      `${bind}\n// url-do-servidor-ok: link externo do cadastro, validado pra http(s)\n` +
        `const urlLeitura = doc.documentoUrl || null;\n\nhref={urlLeitura}`,
    );
    expect(achados).toEqual([]);
  });

  it("`doc` sem campo (ex.: enabled) não é endereço", () => {
    expect(analisarFonte(`${bind}\nhref={"/"} \nconst x = { enabled: !!doc };`)).toEqual([]);
  });
});
