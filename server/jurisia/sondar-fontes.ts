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
import { repararMojibake } from "../../shared/texto-mojibake";

const PAUSA_PADRAO_MS = 1_500;
const TIMEOUT_MS = 25_000;
/** O bastante pra eu deduzir o formato dos campos; não é pra guardar dado. */
const AMOSTRA_MAX = 2_500;

const UA = "JuridFlow/1.0 (sondagem de viabilidade de fonte publica; 1 requisicao por endpoint)";

/**
 * UA de navegador, usado só na REPETIÇÃO de um 403.
 *
 * Não é disfarce — é diagnóstico. 403 que passa trocando o UA é filtro de
 * cabeçalho, e conserta-se numa linha. 403 que persiste é bloqueio de faixa
 * de IP, e aí a decisão é outra: rodar o coletor em outro lugar. Sem essa
 * distinção, os dois casos se parecem e a gente escolhe errado.
 */
const UA_NAVEGADOR =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Separa "não existe" de "não me deixaram entrar" — não são o mesmo problema. */
function diagnosticarFalha(err: unknown): { causa: CausaFalha; detalhe: string } {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code ?? "";
  const msg = e?.cause?.message ?? e?.message ?? String(err);

  if (e?.name === "AbortError") return { causa: "timeout", detalhe: "estourou o tempo limite" };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { causa: "dns", detalhe: "domínio não resolve — o endereço provavelmente não existe" };
  }
  if (code === "ECONNREFUSED") return { causa: "tcp", detalhe: "conexão recusada na porta" };
  if (code === "ECONNRESET") return { causa: "tcp", detalhe: "conexão derrubada no meio" };
  if (code === "UND_ERR_CONNECT_TIMEOUT") {
    return { causa: "tcp", detalhe: "não completou a conexão — cheira a firewall silencioso" };
  }
  if (code.startsWith("CERT_") || /certificate|self.signed|TLS/i.test(msg)) {
    return { causa: "tls", detalhe: "handshake TLS falhou" };
  }
  return { causa: "outra", detalhe: msg.slice(0, 180) };
}

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

export type CausaFalha = "dns" | "tcp" | "tls" | "timeout" | "outra";

/**
 * O que o DataJud devolveu de fato no primeiro processo.
 *
 * `grau` é o campo que decide se o registro entra na base como jurisprudência
 * — se o STJ não mandar "SUP", o classificador devolve null e o acórdão vira
 * "indefinido". Melhor descobrir aqui do que depois de ingerir 100 mil.
 */
export interface AmostraDataJud {
  grau: string | null;
  classe: string | null;
  orgao: string | null;
  movimentos: number;
  primeirosMovimentos: string[];
  campos: string[];
}

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
  /** Por que falhou, quando falhou sem responder. */
  causa: CausaFalha | null;
  /**
   * Repetimos o 403 com UA de navegador?
   * "passou" → filtro de cabeçalho, conserta fácil.
   * "persistiu" → bloqueio de IP, muda onde o coletor roda.
   */
  retryNavegador: "passou" | "persistiu" | null;
  /** Só pros índices do DataJud. */
  datajud: AmostraDataJud | null;
  /** Vocabulário devolvido por agregação: nome do movimento e quantas vezes. */
  vocabulario: Array<{ nome: string; quantidade: number }> | null;
}

export async function candidatosPadrao(termo: string): Promise<CandidatoSonda[]> {
  const lista: CandidatoSonda[] = [];

  // A chave passa pelo mesmo resolvedor da varredura: sondar com uma chave
  // diferente da que a produção usa responderia a pergunta errada.
  // `stf` saiu da lista: o índice devolveu 404 na sondagem de 10/08 — o STF
  // não alimenta a base do CNJ. Não readicionar sem evidência nova.
  const chave = await chaveDataJud();
  for (const alias of ["stj", "tst", "tse", "stm"]) {
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

  // O vocabulário real, não o que eu lembro da TPU.
  //
  // `deduzirDesfecho` fala 1ª instância ("procedência", "extinção sem
  // resolução do mérito") e no STJ isso não aparece — lá é "negado
  // provimento", "não conhecido". Pra ensinar sem chutar, pergunto ao índice
  // quais movimentos existem de fato e com que frequência.
  lista.push({
    fonte: "DataJud",
    nome: "vocabulário de movimentos do STJ",
    url: "https://api-publica.datajud.cnj.jus.br/api_publica_stj/_search",
    metodo: "POST",
    headers: { Authorization: `APIKey ${chave}`, "Content-Type": "application/json" },
    corpo: {
      size: 0,
      aggs: { movimentos: { terms: { field: "movimentos.nome.keyword", size: 80 } } },
    },
    pergunta: "quais movimentos o STJ usa? é o que calibra o desfecho de recurso",
  });

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
      // `dadosabertos.web.stf.jus.br` não resolve (sondagem de 10/08). Este é
      // o candidato sem o "web".
      url: "https://dadosabertos.stf.jus.br/",
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
      pergunta: "o 403 é do cabeçalho ou do IP? (repete com UA de navegador)",
    },
    {
      fonte: "STJ",
      nome: "portal institucional",
      url: "https://www.stj.jus.br/",
      pergunta: "controle do domínio — mesmo 403 do SCON?",
    },
    {
      fonte: "DJEN",
      nome: "Comunica API — com filtro",
      url: "https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab=1&ufOab=CE&pagina=1",
      pergunta: "o 403 é do cabeçalho ou do IP? (repete com UA de navegador)",
    },
    {
      fonte: "DJEN",
      nome: "Comunica API — raiz, sem filtro",
      url: "https://comunicaapi.pje.jus.br/api/v1/comunicacao",
      pergunta: "o 403 vem do endpoint ou dos parâmetros que eu inventei?",
    },
    {
      fonte: "CNJ",
      nome: "portal de dados abertos",
      url: "https://dadosabertos.cnj.jus.br/",
      pergunta: "existe dataset do CNJ pra baixar em lote?",
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

function vocabularioDe(json: unknown): Array<{ nome: string; quantidade: number }> | null {
  const buckets = (json as any)?.aggregations?.movimentos?.buckets;
  if (!Array.isArray(buckets) || buckets.length === 0) return null;
  return buckets
    .filter((b: any) => typeof b?.key === "string")
    .map((b: any) => ({ nome: repararMojibake(b.key), quantidade: Number(b.doc_count ?? 0) }));
}

function amostraDataJud(json: unknown): AmostraDataJud | null {
  const fonte = (json as any)?.hits?.hits?.[0]?._source;
  if (!fonte || typeof fonte !== "object") return null;

  const movs = Array.isArray(fonte.movimentos) ? fonte.movimentos : [];
  return {
    grau: typeof fonte.grau === "string" ? fonte.grau : null,
    classe: fonte.classe?.nome ?? null,
    orgao: fonte.orgaoJulgador?.nome ?? null,
    movimentos: movs.length,
    primeirosMovimentos: movs
      .slice(0, 4)
      .map((m: any) => (typeof m?.nome === "string" ? m.nome : "(sem nome)")),
    campos: Object.keys(fonte).slice(0, 20),
  };
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
    causa: null,
    retryNavegador: null,
    datajud: null,
    vocabulario: null,
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
      r.datajud = amostraDataJud(json);
      r.vocabulario = vocabularioDe(json);
    } catch {
      r.veredito = "responde-html";
      r.forma = formaDoHtml(texto);
      r.temEmenta = CAMPOS_EMENTA.test(texto.slice(0, 40_000));
    }

    if (res.status >= 400) {
      r.veredito = "bloqueado";
      if (res.status === 403) r.retryNavegador = await repetirComoNavegador(c);
    }
    return r;
  } catch (err) {
    r.ms = Date.now() - inicio;
    const d = diagnosticarFalha(err);
    r.causa = d.causa;
    r.erro = d.detalhe;
    r.veredito = "erro";
    return r;
  } finally {
    clearTimeout(t);
  }
}

/** Uma segunda batida, só pra saber se o 403 era do cabeçalho ou do IP. */
async function repetirComoNavegador(c: CandidatoSonda): Promise<"passou" | "persistiu"> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(c.url, {
      method: c.metodo ?? "GET",
      headers: {
        "User-Agent": UA_NAVEGADOR,
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9",
        ...c.headers,
      },
      body: c.corpo ? JSON.stringify(c.corpo) : undefined,
      signal: ctrl.signal,
      redirect: "follow",
    });
    return res.status === 403 ? "persistiu" : "passou";
  } catch {
    return "persistiu";
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
