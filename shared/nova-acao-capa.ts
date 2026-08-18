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

export type ParteDaCapa = {
  nome: string;
  polo: PoloParte;
  documento: string | null;
};

export type CapaNovaAcao = {
  classe: string | null;
  assuntos: string[];
  orgaoJulgador: string | null;
  /** Em reais. O scraper trabalha em centavos; a UI formata reais. */
  valorCausa: number | null;
  dataDistribuicao: string | null;
  partes: ParteDaCapa[];
  /** Onde o cliente monitorado está. "desconhecido" é resposta legítima. */
  poloDoCliente: PoloParte;
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

export function montarCapaNovaAcao(
  capa: CapaBruta,
  poloDoCliente: PoloParte,
  agoraIso: string,
): CapaNovaAcao {
  const partesBrutas = Array.isArray(capa.partes) ? capa.partes : [];
  const partes: ParteDaCapa[] = [];
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
    .map((a) => texto(a))
    .filter((a): a is string => !!a)
    .slice(0, LIMITE_ASSUNTOS);

  return {
    classe: texto(capa.classe),
    assuntos,
    orgaoJulgador: texto(capa.orgaoJulgador),
    valorCausa:
      typeof capa.valorCausaCentavos === "number" && Number.isFinite(capa.valorCausaCentavos)
        ? capa.valorCausaCentavos / 100
        : null,
    dataDistribuicao: texto(capa.dataDistribuicao, 40),
    partes,
    poloDoCliente,
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
  // Capa sem nada dentro não é capa: mostrar um bloco vazio na tela é pior
  // que mostrar o botão de carregar detalhes.
  const partes = Array.isArray(o.partes) ? o.partes : [];
  if (!o.classe && !o.orgaoJulgador && partes.length === 0) return null;
  return {
    classe: texto(o.classe),
    assuntos: (Array.isArray(o.assuntos) ? o.assuntos : [])
      .map((a) => texto(a))
      .filter((a): a is string => !!a),
    orgaoJulgador: texto(o.orgaoJulgador),
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
    poloDoCliente: lerPolo(o.poloDoCliente),
    coletadaEm: texto(o.coletadaEm, 40) ?? "",
  };
}

/**
 * O robô TENTOU ler a capa e não conseguiu?
 *
 * Diferente de "card antigo, detectado antes de existir capa": num card
 * antigo a chave nem existe, e a tela oferece carregar os detalhes como
 * sempre ofereceu. Aqui houve tentativa e o tribunal não devolveu — e isso
 * é uma informação, não um vazio. Era o caso que antes virava "polo ativo"
 * por omissão e sumia da caixa de pendentes.
 */
export function lerFalhaDeCapa(conteudoJson: string | null | undefined): boolean {
  if (!conteudoJson) return false;
  try {
    return (JSON.parse(conteudoJson) as { capaFalhou?: unknown })?.capaFalhou === true;
  } catch {
    return false;
  }
}
