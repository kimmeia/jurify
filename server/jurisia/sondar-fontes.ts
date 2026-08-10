/**
 * Sondagem das fontes públicas de jurisprudência.
 *
 * Antes de escrever coletor, descobrir contra o serviço real três coisas que
 * documentação não responde: o endpoint existe, devolve JSON ou HTML, e — a
 * que decide o produto — se vem ementa. Metadado prova que o acórdão existe;
 * ementa é o que se cita na petição.
 *
 * Roda no servidor de propósito. O que importa não é se a rede do dono
 * alcança o STJ, é se a NOSSA alcança: se o tribunal barrar a faixa de IP do
 * Railway e não a casa dele, sondar do notebook devolveria um verde falso.
 *
 * Uma requisição por candidato, com pausa entre elas. Não é coleta.
 */

import { chaveDataJud } from "./datajud-client";

const PAUSA_PADRAO_MS = 1_500;
const TIMEOUT_MS = 25_000;
/** O bastante pra eu deduzir o formato dos campos; não é pra guardar dado. */
const AMOSTRA_MAX = 2_500;

const UA = "JuridFlow/1.0 (sondagem de viabilidade de fonte publica; 1 requisicao por endpoint)";

export interface CandidatoSonda {
  fonte: string;
  nome: string;
  url: string;
  metodo?: "GET" | "POST";
  headers?: Record<string, string>;
  corpo?: unknown;
  /** O que esta requisição está tentando descobrir. */
  pergunta: string;
}

export type VereditoSonda =
  | "responde-json"
  | "responde-html"
  | "bloqueado"
  | "vazio"
  | "erro";

export interface ResultadoSonda {
  fonte: string;
  nome: string;
  url: string;
  pergunta: string;
  status: number | null;
  tipo: string;
  bytes: number;
  ms: number;
  veredito: VereditoSonda;
  /** Chaves do topo e do primeiro registro — forma, não conteúdo. */
  forma: string;
  /** Achou algo que pareça ementa/teor? null quando nem deu pra olhar. */
  temEmenta: boolean | null;
  erro: string | null;
  /** Começo do corpo cru. É daqui que sai o formato real dos campos. */
  amostra: string;
}

export async function candidatosPadrao(termo: string): Promise<CandidatoSonda[]> {
  const lista: CandidatoSonda[] = [];

  // A chave passa pelo mesmo resolvedor da varredura: sondar com uma chave
  // diferente da que a produção usa responderia a pergunta errada.
  const chave = await chaveDataJud();
  for (const alias of ["stj", "stf", "tst"]) {
    lista.push({
      fonte: "DataJud",
      nome: `índice api_publica_${alias}`,
      url: `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`,
      metodo: "POST",
      headers: { Authorization: `APIKey ${chave}`, "Content-Type": "application/json" },
      corpo: { size: 3, query: { match_all: {} } },
      pergunta: "índice existe? traz grau e movimentos? existe campo de ementa?",
    });
  }

  lista.push(
    {
      fonte: "STF",
      nome: "busca de jurisprudência (backend da SPA)",
      url: `https://jurisprudencia.stf.jus.br/api/search/search?base=acordaos&pageSize=5&page=1&queryString=${encodeURIComponent(termo)}`,
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
    {
      fonte: "STJ",
      nome: "SCON — pesquisa de jurisprudência",
      url: `https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre=${encodeURIComponent(termo)}`,
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
    {
      fonte: "DJEN",
      nome: "Comunica API (CNJ)",
      url: "https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab=1&ufOab=CE&pagina=1",
      pergunta: "a API de publicações está aberta? qual o shape da comunicação?",
    },
    {
      fonte: "LexML",
      nome: "SRU explain",
      url: "https://www.lexml.gov.br/busca/SRU?operation=explain",
      pergunta: "o protocolo de coleta está de pé? quais índices ele expõe?",
    },
  );

  return lista;
}

const CAMPOS_EMENTA = /ementa|acordao|acórdão|inteiroTeor|textoIntegral|decisao|tese/i;

const chavesDe = (o: unknown): string[] =>
  o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o) : [];

/** Resume a forma do JSON sem despejar o payload — chaves, não conteúdo. */
function formaDoJson(v: unknown): { forma: string; temEmenta: boolean } {
  const partes: string[] = [];
  const topo = chavesDe(v);
  if (topo.length) partes.push(`topo: ${topo.slice(0, 8).join(", ")}`);

  const candidatos = [
    (v as any)?.hits?.hits?.[0]?._source,
    (v as any)?.result?.hits?.hits?.[0]?._source,
    Array.isArray((v as any)?.items) ? (v as any).items[0] : null,
    Array.isArray((v as any)?.content) ? (v as any).content[0] : null,
    Array.isArray((v as any)?.data) ? (v as any).data[0] : null,
    Array.isArray(v) ? (v as any)[0] : null,
  ];
  const registro = candidatos.find((c) => c && typeof c === "object") ?? null;
  if (registro) partes.push(`registro: ${chavesDe(registro).slice(0, 14).join(", ")}`);

  const temEmenta =
    CAMPOS_EMENTA.test(chavesDe(registro).join(" ")) ||
    CAMPOS_EMENTA.test(JSON.stringify(v ?? {}).slice(0, 20_000));

  return { forma: partes.join(" · ") || "(json sem forma reconhecível)", temEmenta };
}

function formaDoHtml(html: string): string {
  const m = /<title[^>]*>([\s\S]{0,160}?)<\/title>/i.exec(html);
  const titulo = m ? m[1].replace(/\s+/g, " ").trim() : "";
  const barreira = /captcha|recaptcha|cloudflare|challenge/i.test(html.slice(0, 40_000));
  return [titulo || "(sem <title>)", barreira ? "⚠ menciona captcha/challenge" : ""]
    .filter(Boolean)
    .join(" · ");
}

export async function sondarUm(c: CandidatoSonda): Promise<ResultadoSonda> {
  const r: ResultadoSonda = {
    fonte: c.fonte,
    nome: c.nome,
    url: c.url,
    pergunta: c.pergunta,
    status: null,
    tipo: "",
    bytes: 0,
    ms: 0,
    veredito: "erro",
    forma: "",
    temEmenta: null,
    erro: null,
    amostra: "",
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
    r.status = res.status;
    r.tipo = res.headers.get("content-type") ?? "";
    r.bytes = texto.length;
    r.ms = Date.now() - inicio;
    r.amostra = texto.slice(0, AMOSTRA_MAX);

    if (!texto.trim()) {
      r.veredito = "vazio";
      return r;
    }

    // Content-type mente com frequência em portal de tribunal; tenta parsear.
    try {
      const json = JSON.parse(texto);
      const { forma, temEmenta } = formaDoJson(json);
      r.veredito = "responde-json";
      r.forma = forma;
      r.temEmenta = temEmenta;
    } catch {
      r.veredito = "responde-html";
      r.forma = formaDoHtml(texto);
      r.temEmenta = CAMPOS_EMENTA.test(texto.slice(0, 40_000));
    }

    if (res.status >= 400) r.veredito = "bloqueado";
    return r;
  } catch (err) {
    r.ms = Date.now() - inicio;
    r.erro = err instanceof Error ? err.message : String(err);
    r.veredito = "erro";
    return r;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Proxy corporativo devolve 403 curtinho em text/plain pra TODO domínio
 * bloqueado. Sem este aviso a saída se lê como "os tribunais fecharam", que é
 * a conclusão errada e cara.
 */
export function pareceBloqueioDeRede(rs: ResultadoSonda[]): boolean {
  if (rs.length === 0) return false;
  const suspeitos = rs.filter(
    (r) => r.status === 403 && r.bytes < 400 && r.tipo.startsWith("text/plain"),
  );
  return suspeitos.length >= rs.length / 2;
}

export interface SondagemCompleta {
  resultados: ResultadoSonda[];
  termo: string;
  bloqueioDeRede: boolean;
  comEmenta: string[];
}

export async function sondarFontes(opts?: {
  termo?: string;
  pausaMs?: number;
  extras?: string[];
  aoProgredir?: (feito: number, total: number, atual: CandidatoSonda) => void;
}): Promise<SondagemCompleta> {
  const termo = opts?.termo?.trim() || "dano moral";
  const pausa = opts?.pausaMs ?? PAUSA_PADRAO_MS;

  const lista = await candidatosPadrao(termo);
  for (const url of opts?.extras ?? []) {
    lista.push({ fonte: "extra", nome: "informado à mão", url, pergunta: "?" });
  }

  const resultados: ResultadoSonda[] = [];
  for (let i = 0; i < lista.length; i++) {
    opts?.aoProgredir?.(i, lista.length, lista[i]);
    resultados.push(await sondarUm(lista[i]));
    if (i < lista.length - 1 && pausa > 0) {
      await new Promise((ok) => setTimeout(ok, pausa));
    }
  }

  return {
    resultados,
    termo,
    bloqueioDeRede: pareceBloqueioDeRede(resultados),
    comEmenta: resultados.filter((r) => r.temEmenta).map((r) => `${r.fonte}/${r.nome}`),
  };
}
