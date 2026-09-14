/**
 * As fontes oficiais de onde o robô busca material jurídico, e o que cada uma
 * entrega de verdade.
 *
 * A distinção que organiza a lista inteira, nas palavras do dono ("deveria ter
 * súmulas stj/stf, acórdãos, resp"): o material que vira CITAÇÃO na peça é
 * súmula, ementa de acórdão e tese de repetitivo. Metadado (classe, vara,
 * movimento) só prova que o processo existe — é o que o DataJud dá em 90+
 * tribunais, e é por isso que ele sozinho nunca fez jurisprudência, só
 * estatística.
 *
 * **Súmula e ementa se buscam de jeitos diferentes**, e é essa a razão de
 * `listaCompleta` existir ao lado de `busca`: súmula é conjunto FECHADO (o STJ
 * tem algumas centenas, mudam poucas por ano), então se pega a lista inteira e
 * pronto; ementa é acervo que não acaba, então se busca por termo, de tempos em
 * tempos, e o que é novo entra.
 *
 * `situacao` é o resultado MEDIDO da sondagem rodada em produção — não é
 * palpite e não é documentação de portal. Ele existe porque "a informação é
 * pública" e "o nosso servidor consegue ler" são duas coisas diferentes: o STJ
 * publica tudo aberto e ainda assim barra a faixa de IP do Railway. Toda fonte
 * nasce DESLIGADA no banco justamente por isso.
 */

/** O que a fonte entrega. É isso que decide se ela vira citação ou número. */
export type TipoMaterial = "sumula" | "ementa" | "metadado";

/** Como o corpo da resposta é lido. */
export type FormatoFonte = "json" | "html";

/**
 * O que a sondagem de 14/09/2026 mediu, de dentro do servidor de produção.
 *
 * `porta_aberta` é diferente de `coleta_liberada` de propósito: o site
 * responder 200 prova que o caminho existe, não que a página de resultado
 * devolve julgado — a sondagem bate na página de entrada, e página de entrada
 * de tribunal menciona a palavra "ementa" no rótulo do campo de busca. Quem
 * confirma é a primeira coleta.
 */
export type SituacaoFonte =
  | "coleta_liberada"
  | "porta_aberta"
  | "recusa_nosso_servidor"
  | "endereco_a_corrigir"
  | "certificado"
  | "nao_sondada";

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
  /**
   * Endereço que lista o conjunto inteiro, sem termo de busca. Só faz sentido
   * pra material fechado (súmula): pedir "todas" não existe em acervo de
   * acórdão.
   */
  listaCompleta?: string;
  situacao: SituacaoFonte;
  /** O que foi medido, em uma linha. Vazio quando nunca se mediu. */
  notaDaSondagem?: string;
}

export const FONTES_OFICIAIS: readonly FonteOficial[] = [
  // ── Súmulas: o pedido do dono, e o material mais barato de manter ──────────
  // Conjunto fechado, texto curto, muda pouco: uma vez dentro, serve pra
  // sempre e é a citação mais segura que existe (não se discute a existência
  // de uma súmula).
  {
    id: "stj-sumulas",
    nome: "STJ · Súmulas",
    orgao: "Superior Tribunal de Justiça",
    escopo: "Superior",
    material: "sumula",
    entrega: "O enunciado de cada súmula do STJ, com o número — é a citação mais forte e a que nunca envelhece.",
    cadenciaHoras: 168,
    formato: "html",
    tribunal: "STJ",
    busca: "",
    listaCompleta: "https://scon.stj.jus.br/SCON/sumstj/toc.jsp",
    situacao: "recusa_nosso_servidor",
    notaDaSondagem:
      "O domínio do STJ devolveu 403 também com identificação de navegador: é a faixa de IP do servidor que está barrada, não o pedido.",
  },
  {
    id: "stf-sumulas",
    nome: "STF · Súmulas",
    orgao: "Supremo Tribunal Federal",
    escopo: "Superior",
    material: "sumula",
    entrega: "Enunciado das súmulas do STF.",
    cadenciaHoras: 168,
    formato: "json",
    tribunal: "STF",
    busca: "",
    listaCompleta:
      "https://jurisprudencia.stf.jus.br/api/search/search?base=sumulas&pageSize=500&page=1&queryString=",
    situacao: "certificado",
    notaDaSondagem:
      "A busca do STF travou no certificado de segurança (não foi recusa do tribunal) — esse tipo de trava quase sempre é do nosso lado.",
  },
  {
    id: "stf-sumulas-vinculantes",
    nome: "STF · Súmulas vinculantes",
    orgao: "Supremo Tribunal Federal",
    escopo: "Superior",
    material: "sumula",
    entrega: "As súmulas que obrigam todos os juízes e a administração pública.",
    cadenciaHoras: 168,
    formato: "json",
    tribunal: "STF",
    busca: "",
    listaCompleta:
      "https://jurisprudencia.stf.jus.br/api/search/search?base=sumulasVinculantes&pageSize=200&page=1&queryString=",
    situacao: "nao_sondada",
    notaDaSondagem: "Endereço candidato, deduzido do padrão da busca do STF. Ainda não medido.",
  },
  {
    id: "lexml-sumulas",
    nome: "LexML · Rede de informação legislativa e jurídica",
    orgao: "Governo federal (Senado/CNJ)",
    escopo: "Nacional",
    material: "sumula",
    entrega:
      "Porta feita para máquina, do próprio governo, que indexa súmulas e legislação — é a única da lista que não é site de tribunal.",
    cadenciaHoras: 168,
    formato: "html",
    tribunal: "",
    busca: "",
    listaCompleta:
      "https://www.lexml.gov.br/busca/SRU?operation=searchRetrieve&version=1.1&maximumRecords=100&query=tipoDocumento%3Dsumula",
    situacao: "porta_aberta",
    notaDaSondagem:
      "O LexML respondeu do nosso servidor. Falta comprovar se a resposta traz o texto do enunciado ou só o registro.",
  },

  // ── Ementas de acórdão: o que o dono chamou de "acórdãos, resp" ────────────
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
    situacao: "recusa_nosso_servidor",
    notaDaSondagem:
      "403 que persistiu na segunda tentativa: o tribunal barra o nosso servidor. Ligar aqui não traz nada até sairmos por outra porta.",
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
    situacao: "certificado",
    notaDaSondagem: "Travou no certificado de segurança do site, não em recusa. Conserto provável do nosso lado.",
  },
  {
    id: "tjsp-cjsg",
    nome: "TJSP · Jurisprudência (2º grau)",
    orgao: "Tribunal de Justiça de São Paulo",
    escopo: "Estadual",
    material: "ementa",
    entrega: "Ementa do segundo grau paulista — o maior volume do país.",
    cadenciaHoras: 12,
    formato: "html",
    tribunal: "TJSP",
    // O endereço da sondagem era `consultaCompleta.do` (a página do
    // formulário); quem devolve resultado é `resultadoCompleta.do` com o termo.
    // O que ficou provado é que o host responde do nosso servidor.
    busca: "https://esaj.tjsp.jus.br/cjsg/resultadoCompleta.do?dados.buscaInteiroTeor={termo}",
    situacao: "porta_aberta",
    notaDaSondagem: "Respondeu do nosso servidor em 612ms. É a fonte de ementa mais promissora da lista.",
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
    situacao: "porta_aberta",
    notaDaSondagem: "Respondeu do nosso servidor em 646ms.",
  },
  {
    id: "trf4-jurisprudencia",
    nome: "TRF4 · Jurisprudência",
    orgao: "Tribunal Regional Federal da 4ª Região",
    escopo: "Federal",
    material: "ementa",
    entrega: "Acórdãos federais do Sul — inclui matéria previdenciária e tributária.",
    cadenciaHoras: 24,
    formato: "html",
    tribunal: "TRF4",
    busca: "https://jurisprudencia.trf4.jus.br/pesquisa/resultado_pesquisa.php?txtValor={termo}",
    situacao: "porta_aberta",
    notaDaSondagem: "Respondeu do nosso servidor em 1180ms. Entrou na lista depois da sondagem.",
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
    situacao: "endereco_a_corrigir",
    notaDaSondagem:
      "O TJCE não usa e-SAJ para jurisprudência (o e-SAJ daqui é de São Paulo) — este endereço foi deduzido e precisa ser trocado pelo portal real do tribunal.",
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
    situacao: "nao_sondada",
    notaDaSondagem: "Não entrou na sondagem. Endereço deduzido do padrão do tribunal.",
  },

  // ── Metadado: prova que o processo existe, não serve de citação ────────────
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
    situacao: "coleta_liberada",
    notaDaSondagem: "Os quatro índices dos tribunais superiores responderam. Nenhum traz campo de ementa.",
  },
];

export function fonteOficialPorId(id: string): FonteOficial | undefined {
  return FONTES_OFICIAIS.find((f) => f.id === id);
}

/**
 * A fonte entra no acervo de citação?
 *
 * Súmula e ementa entram; metadado não. O robô, o painel e a tela decidem por
 * esta função em vez de comparar com `"ementa"` cada um por sua conta — foi
 * assim que o JurisIA passou um mês cobrando de um lado e liberando de outro.
 */
export function fonteCitavel(f: FonteOficial): boolean {
  return f.material === "sumula" || f.material === "ementa";
}

export function fontesQueTrazemEmenta(): FonteOficial[] {
  return FONTES_OFICIAIS.filter(fonteCitavel);
}

/**
 * O endereço a bater nesta fonte.
 *
 * Súmula ignora o termo de propósito: o conjunto é fechado, então se pega a
 * lista inteira. Buscar súmula por palavra traria um pedaço do que já caberia
 * todo.
 */
export function enderecoDaFonte(fonte: FonteOficial, termo: string): string | null {
  if (fonte.material === "sumula") return fonte.listaCompleta || null;
  return urlDeBusca(fonte, termo);
}

/** O endereço da busca com o termo dentro, ou null quando a fonte não tem porta. */
export function urlDeBusca(fonte: FonteOficial, termo: string): string | null {
  if (!fonte.busca) return null;
  return fonte.busca.replace("{termo}", encodeURIComponent(termo));
}

/**
 * Vale a pena ligar esta fonte hoje?
 *
 * Não bloqueia nada — a chave continua clicável, porque medida velha não pode
 * decidir para sempre e tribunal desbloqueia. É só o aviso de onde o clique tem
 * chance de trazer material.
 */
export function ligarTemChance(f: FonteOficial): boolean {
  return f.situacao === "coleta_liberada" || f.situacao === "porta_aberta";
}

/** A situação dita em português, para a tela não precisar de tradutor. */
export function rotuloSituacao(s: SituacaoFonte): { frase: string; deQuemE: string } {
  switch (s) {
    case "coleta_liberada":
      return { frase: "Funciona e já traz material", deQuemE: "" };
    case "porta_aberta":
      return {
        frase: "O site responde do nosso servidor",
        deQuemE: "falta a primeira coleta confirmar que vem texto de decisão",
      };
    case "recusa_nosso_servidor":
      return {
        frase: "O tribunal barra o nosso servidor",
        deQuemE: "só passa saindo por outra porta de internet",
      };
    case "certificado":
      return {
        frase: "Trava no certificado de segurança do site",
        deQuemE: "quase sempre é conserto do nosso lado",
      };
    case "endereco_a_corrigir":
      return { frase: "O endereço está errado", deQuemE: "conserto do nosso lado" };
    case "nao_sondada":
      return { frase: "Ainda não foi medida", deQuemE: "rode a sondagem antes de ligar" };
  }
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
