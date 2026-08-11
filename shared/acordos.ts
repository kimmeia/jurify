/**
 * Regras da negociação que o servidor e a tela precisam ler igual.
 *
 * Ficam aqui, e não dentro do router ou do componente, porque as duas pontas
 * decidem coisas a partir delas: o backend conta quantos acordos estão travados
 * pro card do topo, o frontend pinta a linha de vermelho. Duas cópias da mesma
 * regra divergem no primeiro ajuste.
 */

/**
 * A partir de quantos dias sem nenhuma tratativa a negociação conta como parada.
 *
 * Quinze dias é meio mês: tempo suficiente pra que "estou esperando eles
 * responderem" tenha deixado de ser verdade e virado esquecimento. O número
 * exato importa menos que existir um — sem corte, uma negociação de 31 dias
 * parada parece igual a uma de ontem, que é como o módulo estava.
 */
export const DIAS_PARADO_ALERTA = 15;

/** Dias inteiros entre a última movimentação e agora. Nunca negativo — data no
 *  futuro (relógio torto, importação) vira 0 em vez de "-3 dias parado". */
export function diasSemMovimento(ultimaEm: string | Date | null | undefined, agora = new Date()): number | null {
  if (!ultimaEm) return null;
  const t = ultimaEm instanceof Date ? ultimaEm.getTime() : new Date(ultimaEm).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((agora.getTime() - t) / 86400000));
}

export function estaParado(
  ultimaEm: string | Date | null | undefined,
  agora = new Date(),
): boolean {
  const d = diasSemMovimento(ultimaEm, agora);
  return d != null && d >= DIAS_PARADO_ALERTA;
}

export type VezDe = "nos" | "eles" | null;

/**
 * De quem é o próximo movimento, deduzido da última tratativa.
 *
 * É o dado mais acionável de uma negociação e o módulo não o exibia em lugar
 * nenhum, mesmo tendo tudo no banco. A dedução é direta: proposta nossa no ar →
 * a bola está com eles; qualquer coisa que veio deles → está com a gente.
 *
 * `nota` não move a bola: registrar "liguei e não atenderam" não transfere a
 * obrigação de responder pra ninguém.
 */
export function vezDeQuem(
  tipo: string | null | undefined,
  daParteContraria: boolean,
  anterior: VezDe = null,
): VezDe {
  if (!tipo) return null;
  if (tipo === "nota") return anterior;
  if (tipo === "fechamento" || tipo === "cancelamento") return null;
  return daParteContraria ? "nos" : "eles";
}

/**
 * Quanto do caminho entre o limite e a meta a proposta na mesa já percorreu.
 *
 * O caso normal do setor é acordo de QUITAÇÃO: o cliente deve 100 mil e quer
 * quitar por 10. Então a meta é o número BAIXO (10 mil), o limite é o teto que
 * o cliente aguenta pagar (digamos 25 mil), e a proposta é o que a outra parte
 * aceita receber hoje (digamos 40 mil) — nesse exemplo, ainda fora do teto.
 *
 * A régua é normalizada entre o LIMITE (0%) e a META (100%), então vale nos
 * dois sentidos sem toggle: quitando, avançar é o número CAIR; cobrando, é o
 * número subir. A direção sai sozinha do sinal de `meta - limite`.
 *
 * Devolve null quando falta algum marco — sem os três não existe régua, e
 * inventar 0% faria uma negociação sem dados parecer uma negociação péssima.
 */
export function progressoNegociacao(a: {
  valorPretendido?: number | null;
  valorDisponivel?: number | null;
  valorProposta?: number | null;
  valorInicial?: number | null;
}): number | null {
  const meta = a.valorPretendido;
  const limite = a.valorDisponivel;
  if (meta == null || limite == null) return null;
  const atual = a.valorProposta ?? a.valorInicial;
  if (atual == null) return null;
  const span = meta - limite;
  if (span === 0) return atual === meta ? 100 : 0;
  const bruto = ((atual - limite) / span) * 100;
  return Math.max(0, Math.min(100, +bruto.toFixed(1)));
}

/**
 * Desconto obtido sobre o valor de origem, em %.
 *
 * Num acordo de quitação é O número do negócio: dívida de 100 mil quitada por
 * 22 mil são 78% de desconto, e é isso que o cliente contratou o escritório
 * pra conseguir. "R$ 22.000,00" sozinho não diz se foi bom.
 *
 * Vale nos dois sentidos — cobrando, é o quanto se abriu mão do valor cheio.
 */
export function descontoSobreOrigem(
  valorOrigem: number | null | undefined,
  valorAtual: number | null | undefined,
): number | null {
  if (valorOrigem == null || valorAtual == null || valorOrigem <= 0) return null;
  return +(((valorOrigem - valorAtual) / valorOrigem) * 100).toFixed(1);
}
