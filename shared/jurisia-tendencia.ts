/**
 * O que o tribunal está decidindo AGORA — e se isso mudou.
 *
 * A estatística do recorte soma tudo que existe no acervo, e num tribunal isso
 * mistura o que ele fazia há dez anos com o que ele faz hoje. Pra quem está
 * decidindo se pega a causa, essa média é a informação errada: entendimento
 * jurisprudencial vira, e quando vira, o histórico inteiro passa a apontar pro
 * lado contrário do que vai acontecer.
 *
 * Por isso o recorte é medido em DOIS períodos — a janela recente e tudo que
 * veio antes — e o que interessa é a comparação: qual orientação domina hoje,
 * quão massiva ela é, e se ela é a mesma de antes.
 *
 * O módulo é agnóstico de eixo de propósito: recebe rótulos e contagens, e
 * serve tanto ao mérito (procedente/improcedente) quanto ao recurso
 * (provido/não conhecido). Quem escolhe o eixo é quem chama.
 */

/** Janela do "hoje". Dois anos cobre a renovação de composição de câmara sem
 *  ficar refém de um semestre atípico. */
export const JANELA_RECENTE_MESES = 24;

/** Abaixo disso a janela recente não sustenta afirmação de tendência. */
export const MIN_AMOSTRA_TENDENCIA = 10;

/**
 * A partir de qual fatia uma orientação deixa de ser "a mais comum" e passa a
 * ser o entendimento massivo do recorte. 60% num eixo de cinco ou seis saídas
 * é domínio folgado, não empate técnico.
 */
export const PISO_MASSIVO = 60;

export interface Orientacao {
  rotulo: string;
  quantidade: number;
  percentual: number;
}

export interface Tendencia {
  /** ISO do corte entre "recente" e "anterior". */
  desde: string;
  meses: number;
  /** Decididos dentro da janela. */
  recentes: number;
  /** Decididos antes dela. */
  anteriores: number;
  dominanteRecente: Orientacao | null;
  dominanteAnterior: Orientacao | null;
  /**
   * A orientação dominante hoje é OUTRA — o entendimento virou. Só é afirmado
   * quando os dois períodos têm amostra; sem base anterior não há virada, há
   * estreia.
   */
  virou: boolean;
  /** Quanto o dominante de hoje ganhou (ou perdeu) em relação ao que ele
   *  representava antes, em pontos percentuais. Null sem base anterior. */
  deltaPp: number | null;
  /** O dominante recente passa do piso — é entendimento massivo, não maioria
   *  apertada. */
  massivo: boolean;
  amostraPequena: boolean;
}

export interface EntradaTendencia {
  rotulo: string;
  quantidade: number;
}

/** Data de corte da janela, em ISO. `agora` é parâmetro pra manter a função
 *  pura e testável sem congelar relógio. */
export function corteDaJanela(agora: Date, meses = JANELA_RECENTE_MESES): Date {
  const d = new Date(agora.getTime());
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d;
}

function dominante(entradas: EntradaTendencia[]): Orientacao | null {
  const total = entradas.reduce((s, e) => s + Math.max(0, e.quantidade), 0);
  if (total === 0) return null;

  // Empate resolve pela ordem recebida — que é a ordem canônica do eixo, fixa.
  // Sortear o desempate faria o painel trocar de conclusão entre dois cliques.
  let melhor = entradas[0];
  for (const e of entradas) if (e.quantidade > melhor.quantidade) melhor = e;
  if (melhor.quantidade <= 0) return null;

  return {
    rotulo: melhor.rotulo,
    quantidade: melhor.quantidade,
    percentual: Math.round((melhor.quantidade * 100) / total),
  };
}

function fatiaDe(entradas: EntradaTendencia[], rotulo: string): number {
  const total = entradas.reduce((s, e) => s + Math.max(0, e.quantidade), 0);
  if (total === 0) return 0;
  const alvo = entradas.find((e) => e.rotulo === rotulo);
  return alvo ? Math.round((Math.max(0, alvo.quantidade) * 100) / total) : 0;
}

export function montarTendencia(args: {
  desde: Date;
  meses?: number;
  recente: EntradaTendencia[];
  anterior: EntradaTendencia[];
}): Tendencia {
  const recentes = args.recente.reduce((s, e) => s + Math.max(0, e.quantidade), 0);
  const anteriores = args.anterior.reduce((s, e) => s + Math.max(0, e.quantidade), 0);

  const dominanteRecente = dominante(args.recente);
  const dominanteAnterior = dominante(args.anterior);

  // Comparar contra período anterior vazio produziria "virou" em todo recorte
  // novo — que é ruído, não descoberta.
  const temBase = recentes > 0 && anteriores >= MIN_AMOSTRA_TENDENCIA;

  return {
    desde: args.desde.toISOString(),
    meses: args.meses ?? JANELA_RECENTE_MESES,
    recentes,
    anteriores,
    dominanteRecente,
    dominanteAnterior,
    virou:
      temBase &&
      !!dominanteRecente &&
      !!dominanteAnterior &&
      dominanteRecente.rotulo !== dominanteAnterior.rotulo,
    deltaPp:
      temBase && dominanteRecente
        ? dominanteRecente.percentual - fatiaDe(args.anterior, dominanteRecente.rotulo)
        : null,
    massivo:
      !!dominanteRecente &&
      recentes >= MIN_AMOSTRA_TENDENCIA &&
      dominanteRecente.percentual >= PISO_MASSIVO,
    amostraPequena: recentes < MIN_AMOSTRA_TENDENCIA,
  };
}

/**
 * A frase que a tela mostra e que também entra no contexto do modelo em modo
 * estratégia. Sem número — o número é da tela, e o modelo é recusado se
 * escrever um (`contemNumeroInventado`).
 */
export function frasearTendencia(t: Tendencia): string | null {
  if (!t.dominanteRecente) return null;
  const janela = `nos últimos ${t.meses} meses`;
  const alvo = t.dominanteRecente.rotulo.toLowerCase();

  if (t.amostraPequena) {
    return `Poucos casos decididos ${janela} — o que aparece hoje ainda não sustenta leitura de tendência.`;
  }
  if (t.virou) {
    const antes = t.dominanteAnterior?.rotulo.toLowerCase() ?? "outra coisa";
    return `O entendimento virou: ${janela} o desfecho dominante é "${alvo}", enquanto no período anterior era "${antes}".`;
  }
  if (t.massivo) {
    return `Entendimento consolidado: ${janela} o desfecho dominante é "${alvo}", e com folga.`;
  }
  return `${janela.charAt(0).toUpperCase()}${janela.slice(1)} o desfecho mais comum é "${alvo}", mas sem domínio folgado — o recorte segue disputado.`;
}
