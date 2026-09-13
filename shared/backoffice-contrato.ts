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

/** Uma conta que paga (ou testa) o produto. Nunca o cliente FINAL dela. */
export interface ContaBackoffice {
  id: number;
  nome: string;
  email: string;
  /** Nome do plano como o catálogo mostra, ou null em conta sem plano. */
  plano: string | null;
  /** "ativa" | "em_teste" | "inadimplente" | "cortesia" | "sem_assinatura" */
  situacao: string;
  /** Mensalidade em centavos. null = cortesia, sem plano ou sob consulta. */
  valorCentavos: number | null;
  /** ISO 8601 — quando a conta foi criada. */
  desde: string;
  /** ISO 8601 do último acesso, ou null se nunca entrou. */
  ultimoAcesso: string | null;
}

export interface ListaContasBackoffice {
  contrato: number;
  produto: string;
  geradoEm: string;
  /** Total no produto inteiro, não só nesta página. */
  total: number;
  pagina: number;
  porPagina: number;
  contas: ContaBackoffice[];
}

export const CONTAS_POR_PAGINA = 50;

/**
 * Traduz o vocabulário interno de cada produto para o do painel.
 *
 * Cortesia é decidida ANTES do status porque no banco ela fica com
 * `status = "active"` — sem esta ordem, cortesia apareceria como conta
 * pagante e engordaria a lista de quem paga.
 */
export function situacaoDaConta(entrada: {
  subStatus: string | null;
  cortesia?: boolean | null;
  cortesiaExpiraEm?: number | null;
  agoraMs: number;
}): string {
  const { subStatus, cortesia, cortesiaExpiraEm, agoraMs } = entrada;
  if (cortesia && (!cortesiaExpiraEm || cortesiaExpiraEm > agoraMs)) return "cortesia";
  if (!subStatus) return "sem_assinatura";
  if (subStatus === "active") return "ativa";
  if (subStatus === "trialing") return "em_teste";
  if (subStatus === "past_due" || subStatus === "unpaid") return "inadimplente";
  return subStatus;
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
/** Pura: recebe as linhas já lidas do banco e monta a página de contas. */
export function montarListaContas(entrada: {
  produto: string;
  agora: Date;
  total: number;
  pagina: number;
  linhas: Array<{
    id: number;
    name: string | null;
    email: string | null;
    planNome: string | null;
    planId: string | null;
    subStatus: string | null;
    valorMensalCentavos: number | null;
    cortesia?: boolean | null;
    cortesiaExpiraEm?: number | null;
    createdAt: Date | string | number;
    lastSignedIn?: Date | string | number | null;
  }>;
}): ListaContasBackoffice {
  const agoraMs = entrada.agora.getTime();

  return {
    contrato: CONTRATO_BACKOFFICE_VERSAO,
    produto: entrada.produto,
    geradoEm: entrada.agora.toISOString(),
    total: entrada.total,
    pagina: entrada.pagina,
    porPagina: CONTAS_POR_PAGINA,
    contas: entrada.linhas.map((l) => ({
      id: l.id,
      // conta sem nome existe (cadastro parado antes de completar); o painel
      // precisa de algo para escrever na linha, e o id não ajuda ninguém
      nome: l.name?.trim() || "(sem nome)",
      email: l.email ?? "",
      plano: l.planNome ?? l.planId ?? null,
      situacao: situacaoDaConta({
        subStatus: l.subStatus,
        cortesia: l.cortesia,
        cortesiaExpiraEm: l.cortesiaExpiraEm,
        agoraMs,
      }),
      valorCentavos: typeof l.valorMensalCentavos === "number" ? l.valorMensalCentavos : null,
      desde: paraIso(l.createdAt) ?? entrada.agora.toISOString(),
      ultimoAcesso: paraIso(l.lastSignedIn ?? null),
    })),
  };
}

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
