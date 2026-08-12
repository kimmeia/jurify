/**
 * A resposta da conversa única do JurisIA — o que a tela mostra e o que fica
 * gravado.
 *
 * A conversa é uma só: ela decide sozinha se mede o acervo, se lê os autos, se
 * abre os documentos do cliente e se consulta a base do escritório. O que muda
 * de turno pra turno é o que ela conseguiu usar — e é isso que este tipo
 * carrega, porque reabrir a conversa amanhã tem que mostrar exatamente o mesmo
 * painel de hoje (o acervo cresce a cada varredura; recontar daria outro
 * número).
 *
 * `tipo: "una"` é o discriminante contra o formato antigo. `jurisia_mensagens`
 * já guarda `PesquisaGravada` das pesquisas estruturadas, e essas linhas não
 * têm o campo — quem lê o histórico distingue por ele em vez de adivinhar pela
 * forma.
 */

import type { Comparacao } from "./jurisia-estrategia";

export interface FatiaProva {
  resultado: string;
  rotulo: string;
  quantidade: number;
  percentual: number;
}

/**
 * O recorte medido, com o número já contado em SQL.
 *
 * Vive separado do texto de propósito: o modelo recebe a distribuição para
 * raciocinar e tem ordem explícita de não reescrevê-la. O único número do
 * acervo na tela é este.
 */
export interface ProvaGravada {
  rotulo: string;
  descricaoFiltro: string;
  total: number;
  comResultado: number;
  fatias: FatiaProva[];
  /** Quantos do recorte são acórdão — o resto é sentença de 1º grau. */
  jurisprudencia: number;
  amostraPequena: boolean;
  /**
   * O escritório contra o tribunal, no mesmo recorte. Era o que o modo
   * "Estratégia" entregava de diferente dos outros dois; some o modo, fica o
   * cruzamento. Null quando o escritório não tem caso desse tipo.
   */
  comparacao?: Comparacao | null;
}

/** O que a IA conseguiu consultar neste turno. Zero = não usou, não "falhou". */
export interface ConsultaFeita {
  documentosLidos: number;
  documentosTotal: number;
  movimentacoes: number;
  fontesEscritorio: number;
  /** Processos já decididos no recorte medido. */
  acervo: number;
}

export interface ConversaUnaGravada {
  tipo: "una";
  texto: string;
  prova: ProvaGravada | null;
  consulta: ConsultaFeita;
  /** Documentos que existem no caso e não puderam ser lidos, com o motivo. */
  naoLidos: string[];
  /** Checagens que não passaram. Aviso, não descarte — ver `avisos-resposta`. */
  avisos: string[];
  caso: { nome: string | null; processo: string | null } | null;
}

/** Discrimina o formato novo do `PesquisaGravada` antigo, sem chutar pela forma. */
export function ehConversaUna(r: unknown): r is ConversaUnaGravada {
  return !!r && typeof r === "object" && (r as { tipo?: unknown }).tipo === "una";
}
