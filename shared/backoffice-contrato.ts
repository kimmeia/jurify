/**
 * Contrato da portinha de leitura que o backoffice consome.
 *
 * O MESMO arquivo existe no Devular. O painel lê os dois produtos pela mesma
 * forma, então mudar um campo aqui sem mudar lá quebra a tela — por isso
 * `CONTRATO_BACKOFFICE_VERSAO`: o painel compara o número e avisa em vez de
 * desenhar número errado calado.
 */

export const CONTRATO_BACKOFFICE_VERSAO = 1;

export type StatusIntegracao = "ok" | "falha" | "desconhecido";

export interface IntegracaoResumo {
  /** Identificador estável do provedor ("asaas", "resend", …). */
  chave: string;
  nome: string;
  status: StatusIntegracao;
  /** ISO 8601, ou null quando nunca foi testada. */
  conferidaEm: string | null;
}

export interface ResumoBackoffice {
  contrato: number;
  /** "juridflow" | "devular" — quem respondeu. */
  produto: string;
  geradoEm: string;
  contas: {
    /** Assinaturas ativas que pagam. Cortesia não entra. */
    pagantes: number;
    emTeste: number;
    inadimplentes: number;
    /** null = este produto não sabe contar cortesias; o painel mostra "—". */
    cortesias: number | null;
    /** Donos de conta cadastrados, pagando ou não. */
    total: number;
  };
  receita: {
    mrrCentavos: number;
    moeda: "BRL";
  };
  integracoes: IntegracaoResumo[];
}

/** O que cada produto precisa reunir para montar a resposta. */
export interface EntradaResumo {
  produto: string;
  agora: Date;
  stats: {
    totalClients: number;
    activeSubscriptions: number;
    trialingSubscriptions: number;
    pastDueSubscriptions: number;
    /**
     * Opcional porque nem todo produto conta cortesias — o Devular ainda não
     * conta, e o caminho de banco-fora do JuridFlow também não devolve o
     * campo. Ausente vira `null` na resposta ("não sei"), nunca 0: dizer
     * "zero cortesias" quando ninguém contou é número inventado.
     */
    cortesiasAtivas?: number;
    mrr: number;
  };
  integracoes: Array<{
    provedor: string;
    nomeExibicao: string;
    status: string;
    ultimoTeste: Date | string | number | null;
  }>;
}

/**
 * "conectado" é o único estado que afirma que a integração respondeu.
 * "desconectado" é o DEFAULT da coluna, então uma integração que nunca foi
 * testada cairia em "falha" e pintaria de vermelho um painel saudável —
 * por isso ela vira "desconhecido" e só "erro" vira falha.
 */
export function statusDaIntegracao(bruto: string): StatusIntegracao {
  if (bruto === "conectado") return "ok";
  if (bruto === "erro") return "falha";
  return "desconhecido";
}

function paraIso(valor: Date | string | number | null): string | null {
  if (valor === null || valor === undefined) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Pura: recebe o que já foi lido do banco e devolve a resposta.
 *
 * Nenhum campo de segredo entra aqui de propósito — `apiKeyEncrypted` e
 * companhia nem chegam a ser selecionados na consulta, e há teste conferindo
 * que a resposta serializada não carrega chave nenhuma.
 */
export function montarResumoBackoffice(entrada: EntradaResumo): ResumoBackoffice {
  return {
    contrato: CONTRATO_BACKOFFICE_VERSAO,
    produto: entrada.produto,
    geradoEm: entrada.agora.toISOString(),
    contas: {
      pagantes: entrada.stats.activeSubscriptions,
      emTeste: entrada.stats.trialingSubscriptions,
      inadimplentes: entrada.stats.pastDueSubscriptions,
      cortesias: entrada.stats.cortesiasAtivas ?? null,
      total: entrada.stats.totalClients,
    },
    receita: {
      mrrCentavos: entrada.stats.mrr,
      moeda: "BRL",
    },
    integracoes: entrada.integracoes.map((i) => ({
      chave: i.provedor,
      nome: i.nomeExibicao,
      status: statusDaIntegracao(i.status),
      conferidaEm: paraIso(i.ultimoTeste),
    })),
  };
}
