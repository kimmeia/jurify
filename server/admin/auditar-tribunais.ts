/**
 * Auditoria não-invasiva dos tribunais candidatos ao motor próprio.
 *
 * Lógica pura (sem dependências de tRPC/DB) compartilhada entre:
 *   - a procedure admin `adminTribunais.auditar` (roda em staging, rede liberada)
 *   - o script CLI `scripts/spike-motor-proprio/poc-1-pje-scraper/audit-tribunais.ts`
 *
 * Para cada tribunal faz GET na porta de entrada (sem credencial), segue
 * redirects e identifica:
 *   - se redireciona pro PDPJ-cloud SSO (= a credencial do TJCE 1g já serve)
 *   - tecnologia (PJe / E-SAJ / Eproc / Projudi)
 *   - versão provável do PJe (1.x Seam, 2.x PrimeFaces, 4.x SPA)
 *   - estimativa de reuso do adapter TJCE atual
 *
 * Baseada no fluxo real do adapter de produção
 * (scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts):
 * acessa porta de entrada → redirect automático pro Keycloak
 * sso.cloud.pje.jus.br → login → volta pro tribunal (URLs .seam = PJe 1.x).
 */

export const HOST_PDPJ_SSO = "sso.cloud.pje.jus.br";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const HEADERS_BROWSER: Record<string, string> = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Ch-Ua":
    '"Google Chrome";v="130", "Chromium";v="130", "Not?A_Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export type AlvoAuditoria = { id: string; label: string; url: string };

export const ALVOS: AlvoAuditoria[] = [
  // Foco principal: TJCE em todas as instâncias possíveis
  { id: "tjce-entrada", label: "TJCE porta de entrada (baseline)", url: "https://pje.tjce.jus.br/" },
  { id: "tjce-1g", label: "TJCE 1º grau (PJe)", url: "https://pje.tjce.jus.br/pje1grau/" },
  { id: "tjce-2g", label: "TJCE 2º grau (PJe path)", url: "https://pje.tjce.jus.br/pje2grau/" },
  { id: "tjce-2g-alt", label: "TJCE 2º grau (subdomínio pje2g)", url: "https://pje2g.tjce.jus.br/" },
  { id: "tjce-esaj", label: "TJCE E-SAJ (consulta pública)", url: "https://esaj.tjce.jus.br/" },

  // Outros tribunais estaduais no PDPJ-cloud
  { id: "tjrj", label: "TJRJ (PJe)", url: "https://pje.tjrj.jus.br/" },
  { id: "tjmg", label: "TJMG (PJe)", url: "https://pje.tjmg.jus.br/" },
  { id: "tjdft", label: "TJDFT (PJe)", url: "https://pje.tjdft.jus.br/" },
  { id: "tjpe", label: "TJPE (PJe)", url: "https://pje.tjpe.jus.br/" },
  { id: "tjba", label: "TJBA (PJe)", url: "https://pje.tjba.jus.br/" },

  // Justiça do Trabalho
  { id: "trt7", label: "TRT-7 Ceará (PJe)", url: "https://pje.trt7.jus.br/" },
  { id: "trt2", label: "TRT-2 SP (PJe)", url: "https://pje.trt2.jus.br/" },

  // SSO central — checagem direta da disponibilidade do Keycloak
  { id: "pdpj-sso", label: "PDPJ-cloud SSO (Keycloak)", url: "https://sso.cloud.pje.jus.br/" },
];

export type GrauReuso = "BAIXO" | "MÉDIO" | "ALTO" | "N/A" | "INDETERMINADO";

export type ResultadoAuditoria = {
  id: string;
  label: string;
  urlInicial: string;
  urlFinal: string | null;
  httpStatus: number | null;
  usaPdpjCloud: boolean;
  tecnologia: string;
  versaoProvavel: string;
  reuso: GrauReuso;
  observacoes: string[];
  erro?: string;
};

export function detectarTecnologia(url: string, html: string, titulo: string): string {
  if (url.includes("esaj.") || /e-?saj/i.test(titulo)) return "E-SAJ (ASP.NET)";
  if (/eproc/i.test(url) || /eproc/i.test(titulo)) return "Eproc";
  if (url.includes("projudi") || /projudi/i.test(titulo)) return "Projudi";
  if (url.includes(HOST_PDPJ_SSO) || /keycloak|sign in/i.test(titulo)) return "Keycloak SSO";
  return "PJe";
}

export function detectarVersaoPje(html: string, finalUrl: string): string {
  const indicadores: string[] = [];

  // PJe 4.x: bundle SPA (Angular/React), endpoints REST
  if (/<app-root\b/i.test(html) || /ng-version=/i.test(html)) {
    indicadores.push("Angular SPA → PJe 4.x");
  }
  if (/webpackChunk/i.test(html) || /\bReactDOM\b/.test(html)) {
    indicadores.push("React/Webpack → PJe 4.x");
  }

  // PJe 2.x: PrimeFaces
  if (/primefaces/i.test(html) || /\bPrimeFaces\b/.test(html)) {
    indicadores.push("PrimeFaces → PJe 2.x");
  }

  // PJe 1.x: RichFaces + Seam (.seam na URL = pista forte, é o que o
  // adapter de produção do TJCE usa)
  if (
    /richfaces/i.test(html) ||
    /a4j\.framework/i.test(html) ||
    /\.seam\b/.test(html) ||
    /\.seam\b/.test(finalUrl)
  ) {
    indicadores.push("RichFaces/Seam → PJe 1.x");
  }

  // JSF genérico (sinal fraco, presente em 1.x e 2.x)
  if (/javax\.faces|jakarta\.faces|jsf\.js/i.test(html) && indicadores.length === 0) {
    indicadores.push("JSF (versão indeterminada)");
  }

  if (indicadores.length === 0) return "Indeterminada";
  return indicadores.join(" / ");
}

/**
 * Estima o reuso do adapter TJCE atual (PJe 1.x Seam) num tribunal:
 *   BAIXO  = mesma stack (PJe 1.x) → trocar só baseURL/selectors pontuais
 *   MÉDIO  = PJe 2.x (PrimeFaces) → reescrever navegação/selectors
 *   ALTO   = PJe 4.x ou outra tecnologia → adapter praticamente novo
 */
export function estimarReuso(versaoProvavel: string, tecnologia: string): GrauReuso {
  if (tecnologia !== "PJe" && !tecnologia.includes("Keycloak")) return "ALTO";
  if (/PJe 1\.x/.test(versaoProvavel)) return "BAIXO";
  if (/PJe 2\.x/.test(versaoProvavel)) return "MÉDIO";
  if (/PJe 4\.x/.test(versaoProvavel)) return "ALTO";
  return "INDETERMINADO";
}

/** Audita um único tribunal. Nunca lança — falhas viram `erro` no resultado. */
export async function auditarTribunal(
  alvo: AlvoAuditoria,
  opts: { timeoutMs?: number } = {},
): Promise<ResultadoAuditoria> {
  const obs: string[] = [];
  const timeoutMs = opts.timeoutMs ?? 15_000;
  try {
    const resp = await fetch(alvo.url, {
      method: "GET",
      redirect: "follow",
      headers: HEADERS_BROWSER,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const urlFinal = resp.url || alvo.url;
    const html = await resp.text().catch(() => "");
    // O <title> não é trivial sem DOM; extrai por regex simples.
    const tituloMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const titulo = tituloMatch?.[1]?.trim() ?? "";

    const usaPdpjCloud =
      urlFinal.includes(HOST_PDPJ_SSO) ||
      new RegExp(HOST_PDPJ_SSO.replace(/\./g, "\\.")).test(html);

    if (urlFinal !== alvo.url) obs.push(`Redirect: ${alvo.url} → ${urlFinal}`);
    if (usaPdpjCloud) obs.push("→ Passa pelo PDPJ-cloud SSO (credencial TJCE 1g serve)");
    if (resp.status === 403) obs.push("HTTP 403 — WAF pode estar bloqueando bot");
    if (resp.status === 404) obs.push("HTTP 404 — URL provavelmente incorreta");
    if (resp.status >= 500) obs.push(`HTTP ${resp.status} — servidor indisponível`);

    const tecnologia = detectarTecnologia(urlFinal, html, titulo);
    const versaoProvavel = detectarVersaoPje(html, urlFinal);

    return {
      id: alvo.id,
      label: alvo.label,
      urlInicial: alvo.url,
      urlFinal,
      httpStatus: resp.status,
      usaPdpjCloud,
      tecnologia,
      versaoProvavel,
      reuso: alvo.id === "pdpj-sso" ? "N/A" : estimarReuso(versaoProvavel, tecnologia),
      observacoes: obs,
    };
  } catch (err) {
    return {
      id: alvo.id,
      label: alvo.label,
      urlInicial: alvo.url,
      urlFinal: null,
      httpStatus: null,
      usaPdpjCloud: false,
      tecnologia: "Erro",
      versaoProvavel: "Erro",
      reuso: "INDETERMINADO",
      observacoes: obs,
      erro: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    };
  }
}

/**
 * Audita vários tribunais em paralelo (limitado pra não abrir 12 conexões
 * simultâneas). `ids` filtra por `AlvoAuditoria.id`; vazio = todos.
 */
export async function auditarTribunais(
  ids?: string[],
  opts: { timeoutMs?: number; concorrencia?: number } = {},
): Promise<ResultadoAuditoria[]> {
  const alvos =
    ids && ids.length > 0 ? ALVOS.filter((a) => ids.includes(a.id)) : ALVOS;
  const concorrencia = opts.concorrencia ?? 4;
  const resultados: ResultadoAuditoria[] = [];

  for (let i = 0; i < alvos.length; i += concorrencia) {
    const lote = alvos.slice(i, i + concorrencia);
    const parciais = await Promise.all(
      lote.map((alvo) => auditarTribunal(alvo, { timeoutMs: opts.timeoutMs })),
    );
    resultados.push(...parciais);
  }

  return resultados;
}
