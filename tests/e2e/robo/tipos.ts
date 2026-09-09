/**
 * Vocabulário do robô de ação.
 *
 * O ponto que separa este robô dos outros dois é o terceiro estado.
 * Teste comum tem dois — passou ou falhou — e por isso um clique cujo
 * efeito ninguém conferiu conta como "passou". É o verde falso: a
 * varredura fica verde e o defeito continua lá.
 *
 * Aqui `ok` exige prova. Sem prova o resultado é `nao_verificada`, que
 * carrega o motivo por escrito e aparece no relatório separado das duas
 * outras. O robô nunca converte ausência de evidência em aprovação.
 */

/** Estados possíveis de uma ação exercitada (ou deliberadamente não). */
export type Estado = "ok" | "falhou" | "nao_verificada";

/**
 * Por que uma ação não virou `ok` nem `falhou`.
 *
 * As quatro primeiras são cercas: o robô decidiu não clicar. As três
 * últimas são cegueira: ele clicou (ou tentou) e não conseguiu concluir.
 * A distinção importa no relatório — cerca é decisão nossa e some quando
 * mudarmos a decisão; cegueira é dívida de instrumentação do app.
 */
export type Motivo =
  | "cerca_integracao_externa"
  | "cerca_credencial_tribunal"
  | "cerca_admin"
  | "cerca_encerra_sessao"
  | "dialogo_nativo"
  | "sem_prova_registrada"
  | "efeito_nao_observavel";

export const MOTIVO_TEXTO: Record<Motivo, string> = {
  cerca_integracao_externa:
    "não clicou de propósito: dispara integração externa (e-mail, cobrança, Meta) no mundo real",
  cerca_credencial_tribunal:
    "não clicou de propósito: usa credencial de tribunal, e login repetido pode bloquear a OAB",
  cerca_admin:
    "fora do alcance por regra: mexe em escritório de terceiros e o robô nunca é admin",
  cerca_encerra_sessao:
    "não clicou de propósito: encerraria a sessão e abortaria a varredura",
  dialogo_nativo:
    "abriu confirm() nativo do navegador — o robô dispensa e a ação não acontece",
  sem_prova_registrada:
    "clicou sem incidente, mas não existe prova registrada do efeito desta ação",
  efeito_nao_observavel:
    "clicou e a prova registrada não pôde ser avaliada na tela",
};

/** Uma ação encontrada pelo robô na varredura da rota. */
export interface AcaoDescoberta {
  /** Estável entre execuções: usado como chave do catálogo e do relatório. */
  id: string;
  rota: string;
  /** Nome acessível do controle — o que o usuário lê no botão. */
  nome: string;
  /** Ordem entre controles homônimos na mesma rota. */
  ocorrencia: number;
  /**
   * Posição na varredura do DOM desta carga, espelhada no atributo
   * `data-robo-acao`. Vale só enquanto a página não recarregar — é
   * endereço, não identidade. Quem identifica entre cargas é o `id`.
   */
  ocorrenciaDom: number;
}

export interface Veredito {
  estado: Estado;
  /** Preenchido só quando `estado` é `nao_verificada`. */
  motivo?: Motivo;
  /** O que o robô observou, em linguagem de relatório. */
  evidencia: string;
}

export interface ResultadoAcao extends AcaoDescoberta {
  veredito: Veredito;
}

export interface ResumoVarredura {
  mapeadas: number;
  exercitadas: number;
  ok: number;
  falhou: number;
  naoVerificadas: number;
}

export function resumir(resultados: readonly ResultadoAcao[]): ResumoVarredura {
  const conta = (e: Estado) =>
    resultados.filter((r) => r.veredito.estado === e).length;
  const ok = conta("ok");
  const falhou = conta("falhou");
  return {
    mapeadas: resultados.length,
    exercitadas: ok + falhou,
    ok,
    falhou,
    naoVerificadas: conta("nao_verificada"),
  };
}
