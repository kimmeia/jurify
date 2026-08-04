/**
 * Resumo IA de movimentações judiciais.
 *
 * Por que existe: o texto bruto de uma movimentação do PJe é jurídico
 * (cheio de "Despacho dos Autos", "Conclusos para decisão", "Distribuídos
 * por dependência"...) e a notificação atual mostra os primeiros 200
 * caracteres — que muitas vezes são metadata sem valor pro user. O resumo
 * IA transforma isso em 1-2 frases em pt-BR claro pro user decidir se
 * precisa abrir o processo.
 *
 * Provider-neutral: o modelo é configurável por escritório (coluna
 * `escritorios.motor_resumo_modelo`). O prefixo do nome decide qual API:
 *   - "gpt-*"    → OpenAI  (default: gpt-4o-mini)
 *   - "claude-*" → Anthropic
 *
 * Graceful degradation: qualquer falha (key ausente, timeout, erro HTTP,
 * provider desconhecido) retorna null. O caller usa `resumoIA ?? texto`
 * — comportamento atual preservado quando IA cai.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { escritorios } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { resolverChaveIAEscritorio, type AIProvider } from "../_core/ai-call";

const log = createLogger("resumir-movimentacao");

/** Modelo default quando o escritório não configurou um. */
export const MODELO_DEFAULT = "gpt-4o-mini";

/** Default Anthropic quando a chave disponível é Claude mas o modelo
 *  configurado é de outro provider (Haiku: barato pra tarefa de alto volume). */
export const MODELO_DEFAULT_ANTHROPIC = "claude-haiku-4-5-20251001";

/** Timeout do request — não pode bloquear o cron de monitoramento. */
const TIMEOUT_MS = 8000;

/** Limite de chars do texto de entrada — corta antes de gastar tokens à toa. */
const MAX_INPUT_CHARS = 4000;

const SYSTEM_PROMPT = `Você é um assistente jurídico que resume movimentações de processos do PJe brasileiro.
Regras:
- Resuma em 1 frase curta (máx. 200 caracteres) em português do Brasil.
- Foque no que mudou no processo (ex: "Sentença julgou procedente o pedido", "Audiência designada para 15/03").
- Não use jargão desnecessário; escreva como pra um advogado ocupado entender em 3 segundos.
- Se a movimentação for puramente administrativa ("conclusos", "distribuído"), diga isso brevemente.
- Não invente dados que não estão no texto.
- Responda APENAS com o resumo, sem prefixos tipo "Resumo:" ou aspas.`;

export type Provider = "openai" | "anthropic" | "desconhecido";

/** Decide o provider a partir do nome do modelo. */
export function providerDoModelo(modelo: string): Provider {
  const m = modelo.toLowerCase().trim();
  if (m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) {
    return "openai";
  }
  if (m.startsWith("claude-")) {
    return "anthropic";
  }
  return "desconhecido";
}

/**
 * Busca o modelo configurado pelo escritório, ou retorna o default global.
 * Erros silenciosos (DB indisponível, escritório não existe) caem no default.
 */
export async function modeloParaEscritorio(escritorioId: number): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return MODELO_DEFAULT;
    const rows = await db
      .select({ modelo: escritorios.motorResumoModelo })
      .from(escritorios)
      .where(eq(escritorios.id, escritorioId))
      .limit(1);
    const modelo = rows[0]?.modelo;
    if (modelo && modelo.trim().length > 0) return modelo;
    return MODELO_DEFAULT;
  } catch (err: any) {
    log.warn({ escritorioId, err: err?.message ?? String(err) }, "modeloParaEscritorio falhou, usando default");
    return MODELO_DEFAULT;
  }
}

/**
 * Dispatcher por provider. A CHAVE vem do mesmo lugar que o resto da
 * plataforma usa (agentes de IA, `chamarIA`): `admin_integracoes` no banco,
 * via `resolverChaveIAEscritorio` (chave do escritório/agente → chave global
 * admin). Antes isto lia `process.env.OPENAI_API_KEY`/`ANTHROPIC_API_KEY`
 * direto — que fica vazio em produção porque a chave é configurada pela UI
 * (Admin → Integrações) e persiste criptografada no DB, não em env var. Efeito
 * do bug: a classificação era a ÚNICA feature de IA que nunca enxergava a
 * chave, então nenhuma movimentação recebia selo/resumo.
 *
 * O provider passa a vir da CHAVE resolvida, não do nome do modelo: se a chave
 * disponível não serve o modelo configurado pelo escritório, cai no default
 * daquele provider (a chave manda).
 */
async function chamarProvider(
  system: string,
  user: string,
  modeloPreferido: string,
  maxTokens: number,
  escritorioId?: number,
): Promise<string | null> {
  const keys = await resolverChaveIAEscritorio(escritorioId);
  if (!keys) {
    log.warn(
      { escritorioId },
      "classificação IA: nenhuma chave configurada (admin_integracoes / escritório) — pulando",
    );
    return null;
  }
  const modelo = modeloCompativel(modeloPreferido, keys.provider);
  if (keys.provider === "anthropic") return chamarAnthropic(system, user, modelo, maxTokens, keys.apiKey);
  return chamarOpenAI(system, user, modelo, maxTokens, keys.apiKey);
}

/** Usa o modelo configurado se o provider da chave o serve; senão, o default
 *  daquele provider — evita "configurei gpt-* mas só tenho chave Claude" = silêncio. */
function modeloCompativel(modeloPreferido: string, provider: AIProvider): string {
  if (providerDoModelo(modeloPreferido) === provider) return modeloPreferido;
  return provider === "anthropic" ? MODELO_DEFAULT_ANTHROPIC : MODELO_DEFAULT;
}

/** OpenAI Chat Completions. */
async function chamarOpenAI(system: string, user: string, modelo: string, maxTokens: number, apiKey: string): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelo,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text();
    log.warn({ status: res.status, body: t.slice(0, 200) }, "OpenAI retornou erro");
    return null;
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const out = data.choices?.[0]?.message?.content?.trim();
  return out && out.length > 0 ? out : null;
}

/** Anthropic Messages API. */
async function chamarAnthropic(system: string, user: string, modelo: string, maxTokens: number, apiKey: string): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelo,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text();
    log.warn({ status: res.status, body: t.slice(0, 200) }, "Anthropic retornou erro");
    return null;
  }
  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
  };
  const out = data.content?.[0]?.text?.trim();
  return out && out.length > 0 ? out : null;
}

/**
 * Gera resumo IA de uma movimentação. Retorna null quando:
 * - texto é vazio/curto demais pra valer resumir
 * - modelo desconhecido (nem gpt-* nem claude-*)
 * - API key do provider não configurada
 * - timeout / HTTP error / resposta vazia
 *
 * Nunca lança — caller pode assumir comportamento silencioso seguro.
 */
export async function resumirMovimentacao(
  texto: string,
  modelo: string = MODELO_DEFAULT,
  escritorioId?: number,
): Promise<string | null> {
  const limpo = (texto ?? "").trim();
  // Movimentações muito curtas (< 40 chars) geralmente já são auto-explicativas
  // ("Conclusos", "Arquivado") — resumir não agrega valor e gasta token.
  if (limpo.length < 40) return null;
  const truncado = limpo.length > MAX_INPUT_CHARS ? limpo.slice(0, MAX_INPUT_CHARS) : limpo;

  try {
    return await chamarProvider(SYSTEM_PROMPT, truncado, modelo, 120, escritorioId);
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      log.warn({ modelo, timeoutMs: TIMEOUT_MS }, "timeout no resumo IA");
      return null;
    }
    log.warn({ modelo, err: err?.message ?? String(err) }, "erro inesperado no resumo IA");
    return null;
  }
}

// ─── Classificação estruturada (resumo + desfecho + relevância) ──────────────

export type Desfecho = "favoravel" | "desfavoravel" | "parcial" | "neutro";
export type Relevancia = "relevante" | "rotina";
export type LadoCliente = "autor" | "reu" | "desconhecido";
export type ResumoClassificado = {
  resumo: string;
  desfecho: Desfecho | null;
  relevancia: Relevancia;
};

const DESFECHOS: Desfecho[] = ["favoravel", "desfavoravel", "parcial", "neutro"];

const SYSTEM_PROMPT_CLASSIFICACAO = `Você é um assistente jurídico que analisa UMA movimentação de processo do PJe brasileiro.
Responda APENAS com JSON válido (sem markdown, sem crases), exatamente neste formato:
{"resumo": "...", "relevancia": "relevante"|"rotina", "desfecho": "favoravel"|"desfavoravel"|"parcial"|"neutro"|null}

Regras:
- "resumo": 1 frase curta (máx. 200 caracteres) em pt-BR claro, focando no que mudou no processo. Sem jargão, sem prefixos, sem aspas.
- "relevancia": "rotina" para movimentação administrativa/de expediente (conclusos, distribuído, juntada de petição, remessa, mero despacho de impulso, publicação). "relevante" para decisões, sentenças, despachos que exijam providência, intimações e audiências.
- "desfecho": preencha SOMENTE quando a movimentação for uma DECISÃO/SENTENÇA/ACÓRDÃO/DESPACHO DECISÓRIO que resolve algo a favor ou contra uma parte. Avalie do ponto de vista do NOSSO cliente (informado na mensagem): "favoravel" se beneficia nosso cliente, "desfavoravel" se prejudica, "parcial" se procedente em parte, "neutro" se decisão sem vencedor claro. Use null quando NÃO for decisão de mérito (intimação, juntada, audiência designada, conclusos, etc.).
- Não invente dados que não estão no texto.`;

/**
 * Classifica uma movimentação: resumo + desfecho (favorável/desfavorável do
 * ponto de vista do NOSSO cliente) + relevância (relevante/rotina). Nunca
 * lança; retorna null quando não vale classificar ou a IA cai. Se a IA
 * responder algo que não é JSON, cai num fallback que ao menos aproveita o
 * texto como resumo (sem classificar).
 */
export async function classificarMovimentacao(
  texto: string,
  modelo: string = MODELO_DEFAULT,
  opts?: { ladoCliente?: LadoCliente; escritorioId?: number },
): Promise<ResumoClassificado | null> {
  const limpo = (texto ?? "").trim();
  if (limpo.length < 40) return null;
  const truncado = limpo.length > MAX_INPUT_CHARS ? limpo.slice(0, MAX_INPUT_CHARS) : limpo;

  const lado = opts?.ladoCliente ?? "desconhecido";
  const ladoTxt =
    lado === "autor" ? "O NOSSO cliente é o AUTOR (polo ativo) da ação."
    : lado === "reu" ? "O NOSSO cliente é o RÉU (polo passivo) da ação."
    : "Não se sabe de que lado o nosso cliente está — se não der pra inferir com segurança, use desfecho null.";
  const user = `${ladoTxt}\n\nMovimentação:\n${truncado}`;

  let raw: string | null;
  try {
    raw = await chamarProvider(SYSTEM_PROMPT_CLASSIFICACAO, user, modelo, 320, opts?.escritorioId);
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") log.warn({ modelo }, "timeout na classificação IA");
    else log.warn({ modelo, err: err?.message ?? String(err) }, "erro inesperado na classificação IA");
    return null;
  }
  if (!raw) return null;
  return parseClassificacao(raw);
}

/** Extrai o JSON da resposta (tolerante a crases/texto ao redor) e valida. */
export function parseClassificacao(raw: string): ResumoClassificado | null {
  const ini = raw.indexOf("{");
  const fim = raw.lastIndexOf("}");
  if (ini >= 0 && fim > ini) {
    try {
      const obj = JSON.parse(raw.slice(ini, fim + 1)) as Record<string, unknown>;
      const resumo = typeof obj.resumo === "string" ? obj.resumo.trim() : "";
      if (resumo) {
        const desfecho = DESFECHOS.includes(obj.desfecho as Desfecho) ? (obj.desfecho as Desfecho) : null;
        const relevancia: Relevancia = obj.relevancia === "rotina" ? "rotina" : "relevante";
        return { resumo: resumo.slice(0, 240), desfecho, relevancia };
      }
    } catch {
      // cai no fallback abaixo
    }
  }
  // Fallback: IA ignorou o JSON — aproveita o texto cru como resumo, sem selo.
  const fallback = raw.replace(/[`{}]/g, "").trim();
  if (fallback.length < 3) return null;
  return { resumo: fallback.slice(0, 240), desfecho: null, relevancia: "relevante" };
}

// ─── Análise completa (sobre o TEOR do documento) ────────────────────────────

/** Natureza do ato — decide o tom da UI e o que faz sentido oferecer. */
export type AtoProcessual =
  | "decisao"
  | "sentenca"
  | "acordao"
  | "despacho"
  | "intimacao"
  | "audiencia"
  | "expediente"
  | "outro";

export type ProvidenciaAnalise = {
  /** O prazo é NOSSO? Prazo de contestação do réu quando somos o autor não é. */
  exigida: boolean;
  /** O que precisa ser feito, em uma frase de ação. */
  descricao: string | null;
  prazoDias: number | null;
  prazoUteis: boolean;
  /** Data explícita quando o documento traz uma (audiência, perícia). YYYY-MM-DD. */
  dataExplicita: string | null;
  /** O que acontece se descumprir ("preclusão", "multa de 2% do valor da causa"). */
  consequencia: string | null;
  /** Trecho LITERAL do documento que fundamenta — é o que a UI grifa. */
  citacao: string | null;
};

export type AnaliseMovimentacao = {
  /** Manchete em linguagem de advogado ocupado, não o rótulo do PJe. */
  titulo: string;
  /** 1 a 4 frases do que mudou no processo. */
  pontos: string[];
  ato: AtoProcessual;
  desfecho: Desfecho | null;
  relevancia: Relevancia;
  providencia: ProvidenciaAnalise;
};

const ATOS: AtoProcessual[] = [
  "decisao", "sentenca", "acordao", "despacho", "intimacao", "audiencia", "expediente", "outro",
];

/**
 * O prompt insiste em duas coisas porque são as que estragam o produto quando
 * a IA erra:
 *
 * 1. **De quem é o prazo.** "Cite-se o réu para contestar em 15 dias" não é
 *    prazo do escritório quando o cliente é o autor. Marcar como nosso gera
 *    prazo fantasma na agenda; a confiança some no primeiro falso positivo.
 * 2. **Citação literal.** O advogado precisa ver a frase do juiz, não uma
 *    paráfrase — é o que ele vai colar na petição. Parafrasear aqui é pior
 *    que não citar, porque parece verificado e não é.
 */
const SYSTEM_PROMPT_ANALISE = `Você analisa UM ato processual de um processo brasileiro para um advogado que não vai abrir os autos.

Responda APENAS com JSON válido, sem markdown e sem crases:
{"titulo":"...","pontos":["..."],"ato":"decisao|sentenca|acordao|despacho|intimacao|audiencia|expediente|outro","desfecho":"favoravel|desfavoravel|parcial|neutro"|null,"relevancia":"relevante|rotina","providencia":{"exigida":true|false,"descricao":"..."|null,"prazoDias":15|null,"prazoUteis":true|false,"dataExplicita":"AAAA-MM-DD"|null,"consequencia":"..."|null,"citacao":"..."|null}}

titulo: uma frase que diz o que mudou e, se houver, o que o juiz mandou fazer. Escreva como quem avisa um colega no corredor. Nada de "Movimentação processual" nem de repetir o rótulo do PJe.

pontos: de 1 a 4 frases curtas. Cada uma deve carregar informação que só está no documento — o que foi deferido, o que foi negado e por quê, valores, condições. Se o juiz negou algo "por ora" ou "sem prejuízo de", diga, porque muda a estratégia.

ato: a natureza do que o juiz assinou.

desfecho: só quando o ato resolve algo a favor ou contra alguém, avaliado do ponto de vista do NOSSO cliente (informado na mensagem). Use null para intimação, expediente e ato sem vencedor.

relevancia: "rotina" para mero expediente; "relevante" para tudo que o advogado precisaria ler.

providencia.exigida: true SOMENTE se o ato impõe um prazo ou uma conduta AO NOSSO CLIENTE ou ao advogado dele. Preste atenção em quem é intimado. "Cite-se o réu para contestar em 15 dias", quando o nosso cliente é o autor, é prazo da parte contrária: exigida=false. Na dúvida sobre de quem é o prazo, use false e explique a dúvida no último ponto — prazo inventado na agenda de um advogado destrói a confiança no sistema inteiro.

providencia.citacao: quando exigida=true, copie a frase do documento que impõe o prazo, LITERALMENTE, com a pontuação e as palavras originais. Não resuma, não corrija, não traduza. Se não conseguir localizar a frase exata, use null.

providencia.prazoDias / prazoUteis: o número que o documento diz. Prazo processual é em dias úteis (art. 219 do CPC) salvo se o texto disser "corridos". Não calcule a data de vencimento — só devolva a quantidade.

providencia.dataExplicita: só quando o documento marca uma data (audiência, perícia, sessão). Formato AAAA-MM-DD.

Não invente nada que não esteja no texto.`;

/**
 * Analisa um ato processual a partir do TEOR do documento (ou, na falta dele,
 * do rótulo da movimentação — com resultado bem mais pobre, que é exatamente
 * o problema que a captura de teor resolve).
 *
 * Nunca lança. Retorna null quando não vale analisar ou a IA está fora.
 */
export async function analisarMovimentacao(
  entrada: {
    /** Rótulo do movimento na timeline do tribunal. */
    rotulo: string;
    /** Texto integral do documento, quando disponível. */
    teor?: string | null;
    /** Data do ato — a IA usa pra resolver "audiência na próxima terça". */
    dataEvento?: Date | null;
  },
  modelo: string = MODELO_DEFAULT,
  opts?: { ladoCliente?: LadoCliente; escritorioId?: number; nomeCliente?: string },
): Promise<AnaliseMovimentacao | null> {
  const rotulo = (entrada.rotulo ?? "").trim();
  const teor = (entrada.teor ?? "").trim();
  const corpo = teor || rotulo;
  if (corpo.length < 40) return null;

  const truncado = corpo.length > MAX_INPUT_ANALISE_CHARS ? corpo.slice(0, MAX_INPUT_ANALISE_CHARS) : corpo;

  const lado = opts?.ladoCliente ?? "desconhecido";
  const quem = opts?.nomeCliente ? `O NOSSO cliente é ${opts.nomeCliente}. ` : "";
  const ladoTxt =
    lado === "autor" ? `${quem}Ele é o AUTOR (polo ativo).`
    : lado === "reu" ? `${quem}Ele é o RÉU (polo passivo).`
    : `${quem}Não se sabe de que lado o nosso cliente está — se não der pra inferir com segurança pelo texto, use desfecho null e providencia.exigida false.`;

  const dataTxt = entrada.dataEvento
    ? `\nData do ato: ${entrada.dataEvento.toISOString().slice(0, 10)}.`
    : "";
  const teorTxt = teor
    ? `\n\nTeor do documento:\n${truncado}`
    : `\n\n(O documento não pôde ser lido — só temos o rótulo do movimento.
Nesse caso: devolva NO MÁXIMO 1 ponto, e só se ele acrescentar algo que já não esteja no título. É melhor "pontos": [] do que frases de enchimento como "a decisão pode impactar as partes" ou "não há informações sobre valores" — o advogado lê isso como ruído e passa a desconfiar do resumo inteiro.
Não invente conteúdo, e deixe providencia.exigida false se o rótulo não afirmar um prazo.)`;

  const user = `${ladoTxt}${dataTxt}\n\nRótulo do movimento no tribunal: ${rotulo}${teorTxt}`;

  let raw: string | null;
  try {
    raw = await chamarProvider(SYSTEM_PROMPT_ANALISE, user, modelo, 1200, opts?.escritorioId);
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") log.warn({ modelo }, "timeout na análise IA");
    else log.warn({ modelo, err: err?.message ?? String(err) }, "erro inesperado na análise IA");
    return null;
  }
  if (!raw) return null;
  return parseAnalise(raw);
}

/** Teor cabe muito mais que o resumo curto — é o ponto do recurso. */
const MAX_INPUT_ANALISE_CHARS = 24_000;

/**
 * Extrai e valida o JSON da resposta. Tolerante a crases e texto ao redor,
 * mas rígido no conteúdo: campo com tipo errado vira o default seguro em vez
 * de vazar `undefined` pra UI ou pra agenda.
 */
export function parseAnalise(raw: string): AnaliseMovimentacao | null {
  const ini = raw.indexOf("{");
  const fim = raw.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(ini, fim + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const titulo = typeof obj.titulo === "string" ? obj.titulo.trim() : "";
  if (!titulo) return null;

  const pontos = Array.isArray(obj.pontos)
    ? obj.pontos.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => p.trim().slice(0, 400))
        .slice(0, 4)
    : [];

  const ato = ATOS.includes(obj.ato as AtoProcessual) ? (obj.ato as AtoProcessual) : "outro";
  const desfecho = DESFECHOS.includes(obj.desfecho as Desfecho) ? (obj.desfecho as Desfecho) : null;
  const relevancia: Relevancia = obj.relevancia === "rotina" ? "rotina" : "relevante";

  const p = (obj.providencia ?? {}) as Record<string, unknown>;
  const prazoDias =
    typeof p.prazoDias === "number" && Number.isFinite(p.prazoDias) && p.prazoDias > 0 && p.prazoDias <= 365
      ? Math.round(p.prazoDias)
      : null;

  const providencia: ProvidenciaAnalise = {
    exigida: p.exigida === true,
    descricao: typeof p.descricao === "string" && p.descricao.trim() ? p.descricao.trim().slice(0, 300) : null,
    prazoDias,
    // Default do CPC é dia útil; só cai pra corrido quando a IA afirma.
    prazoUteis: p.prazoUteis === false ? false : true,
    dataExplicita: validarDataIso(p.dataExplicita),
    consequencia:
      typeof p.consequencia === "string" && p.consequencia.trim()
        ? p.consequencia.trim().slice(0, 200)
        : null,
    citacao: typeof p.citacao === "string" && p.citacao.trim().length > 12 ? p.citacao.trim().slice(0, 1200) : null,
  };

  // Providência sem prazo nem data nem descrição não é providência — é ruído
  // que acenderia a faixa vermelha do painel sem ter o que fazer.
  if (providencia.exigida && !providencia.prazoDias && !providencia.dataExplicita && !providencia.descricao) {
    providencia.exigida = false;
  }

  return { titulo: titulo.slice(0, 240), pontos, ato, desfecho, relevancia, providencia };
}

function validarDataIso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, a, mes, dia] = m;
  const d = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(dia)));
  if (d.getUTCMonth() + 1 !== Number(mes) || d.getUTCDate() !== Number(dia)) return null;
  return `${a}-${mes}-${dia}`;
}
