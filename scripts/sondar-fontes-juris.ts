/**
 * Sondagem das fontes públicas de jurisprudência (STF, STJ, DataJud).
 *
 * Rode ISTO antes de eu escrever o ingestor. O objetivo não é coletar nada —
 * é descobrir, contra o serviço real, três coisas que não dá pra saber lendo
 * documentação:
 *
 *   1. O endpoint responde? (muita "API pública" de tribunal é SPA fechada)
 *   2. O que ele devolve — JSON ou HTML, e com quais campos?
 *   3. Vem EMENTA junto? É a pergunta que decide o produto: metadado diz que
 *      o acórdão existe, ementa é o que o advogado cita na petição.
 *
 * Cada candidato leva UMA requisição, com pausa entre elas. Isso não é
 * coleta, é bater na porta uma vez e ver quem atende.
 *
 *   pnpm tsx scripts/sondar-fontes-juris.ts
 *   pnpm tsx scripts/sondar-fontes-juris.ts --termo "dano moral consumidor"
 *   pnpm tsx scripts/sondar-fontes-juris.ts --url "https://algum.endpoint/api"
 *
 * Saída: tabela no terminal + corpos brutos em scripts/.sondagem/<timestamp>/.
 * Me mande a tabela; se algum candidato responder JSON, me mande o arquivo
 * dele também.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PAUSA_MS = 1_500;
const TIMEOUT_MS = 25_000;
const MAX_CORPO_SALVO = 400_000;

/** Chave pública do CNJ — a mesma que já está em server/jurisia/datajud-client.ts. */
const CHAVE_DATAJUD = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

const UA =
  "JuridFlow/1.0 (sondagem de viabilidade de fonte publica; 1 requisicao por endpoint)";

interface Candidato {
  fonte: string;
  nome: string;
  url: string;
  metodo?: "GET" | "POST";
  headers?: Record<string, string>;
  corpo?: unknown;
  /** O que essa requisição está tentando descobrir. Vai pro relatório. */
  pergunta: string;
}

const arg = (nome: string): string | null => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

const TERMO = arg("termo") ?? "dano moral";

function candidatos(): Candidato[] {
  const lista: Candidato[] = [];

  // ── DataJud: o caminho que JÁ temos código pronto pra consumir ──────────
  // Se os índices dos superiores responderem, ganhamos acórdão de instância
  // superior sem escrever adapter nenhum. A pergunta é se vem ementa.
  for (const alias of ["stj", "stf", "tst"]) {
    lista.push({
      fonte: "DataJud",
      nome: `índice api_publica_${alias}`,
      url: `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`,
      metodo: "POST",
      headers: { Authorization: `APIKey ${CHAVE_DATAJUD}`, "Content-Type": "application/json" },
      corpo: { size: 3, query: { match_all: {} } },
      pergunta: "índice existe? traz grau/movimentos? existe campo de ementa?",
    });
  }

  // ── STF ────────────────────────────────────────────────────────────────
  // O portal de jurisprudência é uma SPA; estes são os caminhos plausíveis
  // do backend dela e do portal de dados abertos. NENHUM foi verificado —
  // é exatamente isso que a sondagem responde.
  lista.push(
    {
      fonte: "STF",
      nome: "busca de jurisprudência (backend da SPA)",
      url: `https://jurisprudencia.stf.jus.br/api/search/search?base=acordaos&pageSize=5&page=1&queryString=${encodeURIComponent(TERMO)}`,
      pergunta: "a SPA tem backend JSON aberto? traz ementa?",
    },
    {
      fonte: "STF",
      nome: "portal de dados abertos",
      url: "https://dadosabertos.web.stf.jus.br/",
      pergunta: "existe portal com dataset pra baixar em lote?",
    },
    {
      fonte: "STF",
      nome: "portal institucional",
      url: "https://portal.stf.jus.br/",
      pergunta: "o domínio responde? (controle — se nem isso abrir, é rede)",
    },
  );

  // ── STJ ────────────────────────────────────────────────────────────────
  lista.push(
    {
      fonte: "STJ",
      nome: "SCON — pesquisa de jurisprudência",
      url: `https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre=${encodeURIComponent(TERMO)}`,
      pergunta: "responde HTML parseável ou exige sessão/captcha?",
    },
    {
      fonte: "STJ",
      nome: "portal de dados abertos",
      url: "https://dadosabertos.stj.jus.br/",
      pergunta: "existe portal com dataset pra baixar em lote?",
    },
    {
      fonte: "STJ",
      nome: "portal institucional",
      url: "https://www.stj.jus.br/",
      pergunta: "o domínio responde? (controle)",
    },
  );

  // ── LexML: a porta canônica do governo pra legislação ───────────────────
  lista.push({
    fonte: "LexML",
    nome: "SRU explain",
    url: "https://www.lexml.gov.br/busca/SRU?operation=explain",
    pergunta: "o protocolo de coleta está de pé? quais índices ele expõe?",
  });

  const extra = arg("url");
  if (extra) {
    lista.push({ fonte: "extra", nome: "informado na linha de comando", url: extra, pergunta: "?" });
  }

  return lista;
}

interface Resultado {
  fonte: string;
  nome: string;
  url: string;
  status: number | null;
  tipo: string;
  bytes: number;
  ms: number;
  veredito: "responde-json" | "responde-html" | "bloqueado" | "erro" | "vazio";
  /** Chaves do topo do JSON, ou título do HTML. O que dá pra afirmar sem abrir. */
  forma: string;
  /** Achou algo que pareça ementa/texto do acórdão? */
  temEmenta: boolean | null;
  erro: string | null;
  arquivo: string | null;
}

const CAMPOS_EMENTA = /ementa|acordao|acórdão|inteiroTeor|textoIntegral|decisao|tese/i;

/** Resume a forma do JSON sem despejar o payload — chaves, não conteúdo. */
function formaDoJson(v: unknown): { forma: string; temEmenta: boolean } {
  const chaves = (o: unknown): string[] =>
    o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o) : [];

  const topo = chaves(v);
  const partes: string[] = [];
  if (topo.length) partes.push(`topo: ${topo.slice(0, 8).join(", ")}`);

  // Cava até o primeiro registro pra mostrar o shape que interessa.
  let registro: unknown = null;
  const candidatosRegistro = [
    (v as any)?.hits?.hits?.[0]?._source,
    (v as any)?.result?.hits?.hits?.[0]?._source,
    Array.isArray((v as any)?.items) ? (v as any).items[0] : null,
    Array.isArray((v as any)?.content) ? (v as any).content[0] : null,
    Array.isArray((v as any)?.data) ? (v as any).data[0] : null,
    Array.isArray(v) ? (v as any)[0] : null,
  ];
  for (const c of candidatosRegistro) {
    if (c && typeof c === "object") {
      registro = c;
      break;
    }
  }
  if (registro) partes.push(`registro: ${chaves(registro).slice(0, 14).join(", ")}`);

  const serializado = JSON.stringify(v ?? {});
  const temEmenta = CAMPOS_EMENTA.test(Object.keys(registro ?? {}).join(" ")) ||
    CAMPOS_EMENTA.test(serializado.slice(0, 20_000));

  return { forma: partes.join(" · ") || "(json sem forma reconhecível)", temEmenta };
}

function tituloDoHtml(html: string): string {
  const m = /<title[^>]*>([\s\S]{0,160}?)<\/title>/i.exec(html);
  const t = m ? m[1].replace(/\s+/g, " ").trim() : "";
  const captcha = /captcha|recaptcha|cloudflare|challenge/i.test(html.slice(0, 40_000));
  return [t || "(sem <title>)", captcha ? "⚠ menciona captcha/challenge" : ""]
    .filter(Boolean)
    .join(" · ");
}

async function sondar(c: Candidato, pasta: string, i: number): Promise<Resultado> {
  const base: Resultado = {
    fonte: c.fonte,
    nome: c.nome,
    url: c.url,
    status: null,
    tipo: "",
    bytes: 0,
    ms: 0,
    veredito: "erro",
    forma: "",
    temEmenta: null,
    erro: null,
    arquivo: null,
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const inicio = Date.now();

  try {
    const res = await fetch(c.url, {
      method: c.metodo ?? "GET",
      headers: { "User-Agent": UA, Accept: "application/json, text/html;q=0.8", ...c.headers },
      body: c.corpo ? JSON.stringify(c.corpo) : undefined,
      signal: ctrl.signal,
      redirect: "follow",
    });

    const texto = await res.text();
    base.status = res.status;
    base.tipo = res.headers.get("content-type") ?? "";
    base.bytes = texto.length;
    base.ms = Date.now() - inicio;

    const arquivo = join(pasta, `${String(i).padStart(2, "0")}-${c.fonte}-${c.nome}`
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .slice(0, 120) + (base.tipo.includes("json") ? ".json" : ".txt"));
    writeFileSync(arquivo, texto.slice(0, MAX_CORPO_SALVO), "utf8");
    base.arquivo = arquivo;

    if (!texto.trim()) {
      base.veredito = "vazio";
      return base;
    }

    // Content-type mente com frequência em portal de tribunal; tenta parsear.
    try {
      const json = JSON.parse(texto);
      const { forma, temEmenta } = formaDoJson(json);
      base.veredito = "responde-json";
      base.forma = forma;
      base.temEmenta = temEmenta;
    } catch {
      base.veredito = res.status >= 400 ? "bloqueado" : "responde-html";
      base.forma = tituloDoHtml(texto);
      base.temEmenta = CAMPOS_EMENTA.test(texto.slice(0, 40_000));
    }

    if (res.status >= 400) base.veredito = "bloqueado";
    return base;
  } catch (err) {
    base.ms = Date.now() - inicio;
    base.erro = err instanceof Error ? err.message : String(err);
    base.veredito = "erro";
    return base;
  } finally {
    clearTimeout(t);
  }
}

const ICONE: Record<Resultado["veredito"], string> = {
  "responde-json": "🟢",
  "responde-html": "🟡",
  bloqueado: "🔴",
  vazio: "⚪",
  erro: "🔴",
};

async function main() {
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const pasta = join("scripts", ".sondagem", carimbo);
  mkdirSync(pasta, { recursive: true });

  const lista = candidatos();
  console.log(`\nSondando ${lista.length} endpoints — 1 requisição cada, ${PAUSA_MS}ms de pausa.`);
  console.log(`Termo de busca: "${TERMO}"`);
  console.log(`Corpos brutos em: ${pasta}\n`);

  const resultados: Resultado[] = [];
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i];
    process.stdout.write(`  [${i + 1}/${lista.length}] ${c.fonte} · ${c.nome} … `);
    const r = await sondar(c, pasta, i + 1);
    resultados.push(r);
    console.log(`${ICONE[r.veredito]} ${r.status ?? r.erro ?? ""} (${r.ms}ms)`);
    if (i < lista.length - 1) await new Promise((ok) => setTimeout(ok, PAUSA_MS));
  }

  console.log("\n" + "═".repeat(78));
  console.log("RESULTADO");
  console.log("═".repeat(78));

  for (const r of resultados) {
    console.log(`\n${ICONE[r.veredito]} ${r.fonte} · ${r.nome}`);
    console.log(`   ${r.url}`);
    console.log(
      `   status ${r.status ?? "—"} · ${r.tipo || "sem content-type"} · ${r.bytes.toLocaleString("pt-BR")} bytes · ${r.ms}ms`,
    );
    if (r.erro) console.log(`   erro: ${r.erro}`);
    if (r.forma) console.log(`   forma: ${r.forma}`);
    if (r.temEmenta !== null) {
      console.log(`   ementa/teor no payload: ${r.temEmenta ? "SIM (aparente)" : "não encontrei"}`);
    }
  }

  const json = resultados.filter((r) => r.veredito === "responde-json");
  const comEmenta = resultados.filter((r) => r.temEmenta === true);

  // Proxy corporativo devolve 403 curtinho em text/plain pra TODO domínio
  // bloqueado. Sem este aviso a saída se lê como "os tribunais fecharam",
  // que é a conclusão errada e cara.
  const cheiroDeProxy = resultados.filter(
    (r) => r.status === 403 && r.bytes < 400 && r.tipo.startsWith("text/plain"),
  );
  if (cheiroDeProxy.length >= resultados.length / 2) {
    console.log("\n" + "!".repeat(78));
    console.log("ATENÇÃO: quase tudo voltou 403 curto em text/plain, de domínios diferentes.");
    console.log("Esse é o padrão de PROXY bloqueando a saída — não dos tribunais recusando.");
    console.log("Rode de novo numa rede sem proxy antes de concluir qualquer coisa.");
    console.log("!".repeat(78));
  }

  console.log("\n" + "═".repeat(78));
  console.log(`${json.length} de ${resultados.length} responderam JSON.`);
  console.log(`${comEmenta.length} parecem trazer ementa/teor: ${comEmenta.map((r) => `${r.fonte}/${r.nome}`).join(", ") || "nenhum"}`);
  console.log("\nMe mande esta tabela. Dos que ficaram 🟢, mande também o arquivo em");
  console.log(`${pasta} — é dele que eu tiro o formato real em vez de supor.`);
  console.log("═".repeat(78) + "\n");

  writeFileSync(join(pasta, "resumo.json"), JSON.stringify(resultados, null, 2), "utf8");
}

main().catch((e) => {
  console.error("\nSondagem abortou:", e);
  process.exit(1);
});
