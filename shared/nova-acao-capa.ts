/**
 * A capa do processo, guardada no momento em que a nova ação é detectada.
 *
 * Pra decidir se avisa ou cala, o cron de novas ações já abre a capa de cada
 * CNJ novo: classe, assunto, partes com polo, vara, valor e data de
 * distribuição passam todos pelas mãos dele. Ele usava duas coisas — o polo,
 * pra saber se o cliente é autor; a data, pra saber se é processo velho — e
 * jogava o resto fora. O card ficava com o número do processo e mais nada, e
 * a tela ainda oferecia "Carregar detalhes — 1 crédito" pra buscar de novo
 * exatamente o que já tinha sido lido.
 *
 * Guardar aqui não custa consulta nova: é o mesmo scrape, escrito em vez de
 * descartado.
 */

import { lerPolo, type PoloParte } from "./polo-parte";
import { textoMencionaOab } from "./nova-acao-polo";

export type ParteDaCapa = {
  nome: string;
  polo: PoloParte;
  documento: string | null;
};

/**
 * De onde veio o que está no card.
 *
 * "processo" é a página do processo (traz tudo). "lista" é a tabela de
 * resultados da busca, que tem menos campos mas é de graça. "datajud" é o
 * banco público do CNJ, reserva das duas — ele não publica as partes.
 */
export const FONTES_CAPA = ["processo", "lista", "datajud"] as const;
export type FonteCapa = (typeof FONTES_CAPA)[number];

export const ROTULO_FONTE_CAPA: Record<FonteCapa, string> = {
  processo: "Lido no processo",
  lista: "Lido na lista do tribunal",
  datajud: "Natureza pelo DataJud (CNJ)",
};

export function lerFonteCapa(v: unknown): FonteCapa | null {
  return typeof v === "string" && (FONTES_CAPA as readonly string[]).includes(v)
    ? (v as FonteCapa)
    : null;
}

export type CapaNovaAcao = {
  classe: string | null;
  assuntos: string[];
  orgaoJulgador: string | null;
  /** Em reais. O scraper trabalha em centavos; a UI formata reais. */
  valorCausa: number | null;
  dataDistribuicao: string | null;
  partes: ParteDaCapa[];
  /** Ausente em capa antiga, gravada antes de existir procedência. */
  fonte: FonteCapa | null;
  /** Onde o cliente monitorado está. "desconhecido" é resposta legítima. */
  poloDoCliente: PoloParte;
  /**
   * A OAB do escritório aparece entre as partes (o tribunal lista o advogado
   * junto do polo). Diz "foi o escritório que ajuizou" — informação pra tela,
   * não prova de polo: o polo continua vindo do documento/nome do cliente.
   */
  advogadoDoEscritorio: boolean;
  /** Quando foi lida. Distingue capa da detecção de card antigo sem capa. */
  coletadaEm: string;
};

/** Um processo com 40 litisconsortes não pode inchar a linha do evento. */
export const LIMITE_PARTES = 12;
const LIMITE_ASSUNTOS = 6;
const LIMITE_NOME = 160;

type CapaBruta = {
  classe?: string | null;
  assuntos?: unknown;
  orgaoJulgador?: string | null;
  valorCausaCentavos?: number | null;
  dataDistribuicao?: string | null;
  partes?: unknown;
};

function texto(v: unknown, limite = LIMITE_NOME): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, limite) : null;
}

/**
 * Títulos de coluna e de seção que o tribunal escreve na tela.
 *
 * O scraper procura um campo pelo nome e lê o que está do lado. Quando a
 * página aberta é a TABELA DE RESULTADOS da busca em vez da página do
 * processo, o que está do lado de "Classe judicial" é o título da coluna
 * seguinte — e foi assim que "Polo ativo" virou a natureza da ação num card.
 * Valor que É um desses títulos não é valor de campo nenhum: não entra na
 * gravação e é descartado também na leitura, pra limpar o que já está gravado.
 */
const ROTULOS_DE_TABELA = [
  "polo ativo",
  "polo passivo",
  "outros interessados",
  "terceiros",
  "terceiro interessado",
  "partes",
  "classe judicial",
  "classe",
  "orgao julgador",
  "vara",
  "juizo",
  "numero do processo",
  "processo",
  "autuado em",
  "autuacao",
  "ultima distribuicao",
  "distribuicao",
  "data de distribuicao",
  "assunto",
  "assuntos",
  "valor da causa",
  "situacao",
  "advogado",
  "advogados",
  "acoes",
];

/** Sem acento, sem caixa e sem os dois-pontos que o tribunal cola no rótulo. */
function chaveDeRotulo(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[:\s]+$/, "")
    .toLowerCase();
}

export function ehRotuloDeTabela(v: string | null | undefined): boolean {
  if (typeof v !== "string") return false;
  return ROTULOS_DE_TABELA.includes(chaveDeRotulo(v));
}

/** `texto`, mas recusando título de coluna travestido de valor. */
function valorDeCampo(v: unknown, limite = LIMITE_NOME): string | null {
  const s = texto(v, limite);
  return s && ehRotuloDeTabela(s) ? null : s;
}

/**
 * Sobrou alguma coisa pra mostrar?
 *
 * Depois de descartar os rótulos, uma capa pode ficar sem nada dentro — e capa
 * vazia não pode nem virar card nem sobrescrever capa boa de processo vigiado.
 */
export function capaTemConteudo(capa: CapaNovaAcao | null | undefined): boolean {
  if (!capa) return false;
  return !!capa.classe || !!capa.orgaoJulgador || capa.partes.length > 0 || capa.assuntos.length > 0;
}

export function montarCapaNovaAcao(
  capa: CapaBruta,
  poloDoCliente: PoloParte,
  agoraIso: string,
  opcoes: { oabEscritorio?: string | null; fonte?: FonteCapa } = {},
): CapaNovaAcao {
  const partesBrutas = Array.isArray(capa.partes) ? capa.partes : [];
  const partes: ParteDaCapa[] = [];
  // Varre TODAS as partes brutas pela OAB — o advogado costuma vir depois
  // das partes e o corte de LIMITE_PARTES não pode escondê-lo.
  const advogadoDoEscritorio = partesBrutas.some((p) =>
    textoMencionaOab(typeof (p as Record<string, unknown>)?.nome === "string" ? String((p as Record<string, unknown>).nome) : null, opcoes.oabEscritorio),
  );
  for (const p of partesBrutas.slice(0, LIMITE_PARTES)) {
    const o = p as Record<string, unknown>;
    const nome = texto(o?.nome);
    if (!nome) continue;
    partes.push({
      nome,
      polo: lerPolo(o?.polo),
      documento: texto(o?.documento, 32),
    });
  }

  const assuntos = (Array.isArray(capa.assuntos) ? capa.assuntos : [])
    .map((a) => valorDeCampo(a))
    .filter((a): a is string => !!a)
    .slice(0, LIMITE_ASSUNTOS);

  return {
    classe: valorDeCampo(capa.classe),
    assuntos,
    orgaoJulgador: valorDeCampo(capa.orgaoJulgador),
    valorCausa:
      typeof capa.valorCausaCentavos === "number" && Number.isFinite(capa.valorCausaCentavos)
        ? capa.valorCausaCentavos / 100
        : null,
    dataDistribuicao: texto(capa.dataDistribuicao, 40),
    partes,
    fonte: opcoes.fonte ?? null,
    poloDoCliente,
    advogadoDoEscritorio,
    coletadaEm: agoraIso,
  };
}

/**
 * Lê a capa do `conteudoJson` do evento. Nunca lança: card antigo não tem
 * capa, e JSON quebrado de alguma versão anterior também não pode derrubar
 * a listagem inteira.
 */
export function lerCapaNovaAcao(conteudoJson: string | null | undefined): CapaNovaAcao | null {
  if (!conteudoJson) return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudoJson);
  } catch {
    return null;
  }
  const capa = (bruto as { capa?: unknown })?.capa;
  if (!capa || typeof capa !== "object") return null;
  const o = capa as Record<string, unknown>;
  const partes = Array.isArray(o.partes) ? o.partes : [];
  const lida: CapaNovaAcao = {
    classe: valorDeCampo(o.classe),
    assuntos: (Array.isArray(o.assuntos) ? o.assuntos : [])
      .map((a) => valorDeCampo(a))
      .filter((a): a is string => !!a),
    orgaoJulgador: valorDeCampo(o.orgaoJulgador),
    valorCausa: typeof o.valorCausa === "number" ? o.valorCausa : null,
    dataDistribuicao: texto(o.dataDistribuicao, 40),
    partes: partes.slice(0, LIMITE_PARTES).map((p) => {
      const q = p as Record<string, unknown>;
      return {
        nome: texto(q?.nome) ?? "",
        polo: lerPolo(q?.polo),
        documento: texto(q?.documento, 32),
      };
    }).filter((p) => !!p.nome),
    fonte: lerFonteCapa(o.fonte),
    poloDoCliente: lerPolo(o.poloDoCliente),
    advogadoDoEscritorio: o.advogadoDoEscritorio === true,
    coletadaEm: texto(o.coletadaEm, 40) ?? "",
  };
  // Capa sem nada dentro não é capa: mostrar um bloco vazio na tela é pior
  // que mostrar o botão de carregar detalhes. A conta é feita DEPOIS de
  // descartar os rótulos — senão um "Polo ativo" gravado na classe mantinha
  // de pé uma capa que não tem mais nada.
  return capaTemConteudo(lida) ? lida : null;
}

/**
 * O robô TENTOU ler a capa e não conseguiu?
 *
 * Diferente de "card antigo, detectado antes de existir capa": num card
 * antigo a chave nem existe, e a tela oferece carregar os detalhes como
 * sempre ofereceu. Aqui houve tentativa e o tribunal não devolveu — e isso
 * é uma informação, não um vazio. Era o caso que antes virava "polo ativo"
 * por omissão e sumia da caixa de pendentes.
 *
 * Capa gravada que não sobrevive à leitura (só tinha rótulo de coluna dentro)
 * conta como falha também: o robô achou que tinha lido, mas não leu nada. É o
 * que devolve o aviso âmbar e os botões de recuperar pros cards que já estão
 * gravados errados.
 */
export function lerFalhaDeCapa(conteudoJson: string | null | undefined): boolean {
  if (!conteudoJson) return false;
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudoJson);
  } catch {
    return false;
  }
  if ((bruto as { capaFalhou?: unknown })?.capaFalhou === true) return true;
  const capa = (bruto as { capa?: unknown })?.capa;
  if (!capa || typeof capa !== "object") return false;
  return lerCapaNovaAcao(conteudoJson) === null;
}
