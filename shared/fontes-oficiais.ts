/**
 * As fontes oficiais de onde o robô busca material jurídico, e o que cada uma
 * entrega de verdade.
 *
 * A distinção que organiza a lista inteira: **metadado prova que o processo
 * existe; ementa é o que se cita na petição**. O DataJud dá o primeiro em 90+
 * tribunais e não dá o segundo em nenhum — por isso ele sozinho nunca fez
 * jurisprudência, só estatística. As fontes de ementa são os portais de
 * jurisprudência dos próprios tribunais, que publicam o acórdão justamente
 * para ser lido, sem credencial.
 *
 * Os endereços são os mesmos que `sondar-fontes.ts` bate uma vez para
 * descobrir se respondem do nosso servidor. **Sondar antes de ligar é a
 * regra**, e é por isso que toda fonte nasce DESLIGADA no banco: tribunal que
 * barra a faixa de IP do servidor responde normalmente no computador de casa,
 * e ligar um robô com base nesse verde falso é bater na porta fechada de hora
 * em hora.
 */

/** O que a fonte entrega. É isso que decide se ela vira citação ou número. */
export type TipoMaterial = "ementa" | "metadado";

/** Como o corpo da resposta é lido. */
export type FormatoFonte = "json" | "html";

export interface FonteOficial {
  id: string;
  nome: string;
  orgao: string;
  /** Justiça/abrangência, pra agrupar na tela. */
  escopo: "Superior" | "Estadual" | "Federal" | "Nacional";
  material: TipoMaterial;
  /** Frase curta que explica pro dono o que entra no acervo por essa porta. */
  entrega: string;
  /** De quanto em quanto tempo faz sentido voltar nessa fonte. */
  cadenciaHoras: number;
  formato: FormatoFonte;
  /** Sigla do tribunal no acervo — casa com `jurisia_processos.tribunal`. */
  tribunal: string;
  /**
   * Endereço da busca, com `{termo}` no lugar do que se procura.
   * Vazio = a fonte ainda não tem porta conhecida e só a sondagem descobre.
   */
  busca: string;
}

export const FONTES_OFICIAIS: readonly FonteOficial[] = [
  {
    id: "stj-scon",
    nome: "STJ · Jurisprudência (SCON)",
    orgao: "Superior Tribunal de Justiça",
    escopo: "Superior",
    material: "ementa",
    entrega: "Ementa e acórdão do STJ — é o que fundamenta tese em recurso.",
    cadenciaHoras: 24,
    formato: "html",
    tribunal: "STJ",
    busca: "https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre={termo}",
  },
  {
    id: "stf-jurisprudencia",
    nome: "STF · Jurisprudência",
    orgao: "Supremo Tribunal Federal",
    escopo: "Superior",
    material: "ementa",
    entrega: "Acórdãos, repercussão geral e teses de tema.",
    cadenciaHoras: 24,
    formato: "json",
    tribunal: "STF",
    busca:
      "https://jurisprudencia.stf.jus.br/api/search/search?base=acordaos&pageSize=25&page=1&queryString={termo}",
  },
  {
    id: "tjce-jurisprudencia",
    nome: "TJCE · Consulta de jurisprudência",
    orgao: "Tribunal de Justiça do Ceará",
    escopo: "Estadual",
    material: "ementa",
    entrega: "Ementa das câmaras do TJCE — o entendimento da casa onde o escritório atua.",
    cadenciaHoras: 12,
    formato: "html",
    tribunal: "TJCE",
    busca: "https://esaj.tjce.jus.br/cjsg/resultadoCompleta.do?dados.buscaInteiroTeor={termo}",
  },
  {
    id: "tjsp-cjsg",
    nome: "TJSP · Jurisprudência (CJSG)",
    orgao: "Tribunal de Justiça de São Paulo",
    escopo: "Estadual",
    material: "ementa",
    entrega: "Ementa do segundo grau paulista — o maior volume do país.",
    cadenciaHoras: 12,
    formato: "html",
    tribunal: "TJSP",
    busca: "https://esaj.tjsp.jus.br/cjsg/resultadoCompleta.do?dados.buscaInteiroTeor={termo}",
  },
  {
    id: "tjmg-jurisprudencia",
    nome: "TJMG · Jurisprudência",
    orgao: "Tribunal de Justiça de Minas Gerais",
    escopo: "Estadual",
    material: "ementa",
    entrega: "Ementa das câmaras cíveis mineiras.",
    cadenciaHoras: 24,
    formato: "html",
    tribunal: "TJMG",
    busca: "https://www5.tjmg.jus.br/jurisprudencia/pesquisaPalavrasEspelhoAcordao.do?palavras={termo}",
  },
  {
    id: "trf5-jurisprudencia",
    nome: "TRF5 · Jurisprudência",
    orgao: "Tribunal Regional Federal da 5ª Região",
    escopo: "Federal",
    material: "ementa",
    entrega: "Acórdãos federais do Nordeste.",
    cadenciaHoras: 24,
    formato: "html",
    tribunal: "TRF5",
    busca: "https://julia.trf5.jus.br/julia-fonetica/pesquisa?q={termo}",
  },
  {
    id: "datajud",
    nome: "DataJud · Base Nacional (CNJ)",
    orgao: "Conselho Nacional de Justiça",
    escopo: "Nacional",
    material: "metadado",
    entrega:
      "Classe, assunto, vara e movimentos de 90+ tribunais. Não traz texto de decisão — é o que vira estatística.",
    cadenciaHoras: 24,
    formato: "json",
    tribunal: "",
    busca: "",
  },
];

export function fonteOficialPorId(id: string): FonteOficial | undefined {
  return FONTES_OFICIAIS.find((f) => f.id === id);
}

export function fontesQueTrazemEmenta(): FonteOficial[] {
  return FONTES_OFICIAIS.filter((f) => f.material === "ementa");
}

/** O endereço da busca com o termo dentro, ou null quando a fonte não tem porta. */
export function urlDeBusca(fonte: FonteOficial, termo: string): string | null {
  if (!fonte.busca) return null;
  return fonte.busca.replace("{termo}", encodeURIComponent(termo));
}

/** Rótulo humano da cadência — a tela não mostra "168h". */
export function rotuloCadencia(horas: number): string {
  if (horas % 168 === 0) return horas === 168 ? "toda semana" : `a cada ${horas / 168} semanas`;
  if (horas % 24 === 0) return horas === 24 ? "todo dia" : `a cada ${horas / 24} dias`;
  return `a cada ${horas}h`;
}

/** Está na hora de voltar nessa fonte? Sem data anterior, sim. */
export function coletaDevida(
  fonte: FonteOficial,
  ultimaColetaEm: Date | null | undefined,
  agora: number,
): boolean {
  if (!ultimaColetaEm) return true;
  return agora - ultimaColetaEm.getTime() >= fonte.cadenciaHoras * 3_600_000;
}
