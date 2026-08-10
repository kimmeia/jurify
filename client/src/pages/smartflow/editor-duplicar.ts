/**
 * Duplicar um bloco do editor.
 *
 * Lógica pura, fora do componente, porque a parte que erra aqui não é a
 * interface — é a IDENTIDADE do clone. Dois blocos com o mesmo `clienteId`
 * fazem o `proximoSe` de um roteador apontar pros dois ao mesmo tempo, e o
 * fluxo salva torto sem nenhum erro na tela.
 */

/** O que a duplicação precisa saber de um nó. Deliberadamente menor que o
 *  nó do ReactFlow — assim o teste não precisa montar um grafo inteiro. */
export interface NoDuplicavel {
  id: string;
  type?: string;
  position: { x: number; y: number };
  /**
   * Estado de interação do ReactFlow. Declarado aqui de propósito: são
   * campos que o espalhamento carregaria em silêncio, e `selected` herdado
   * é justamente o que fazia arrastar a cópia arrastar o original junto —
   * o ReactFlow move TODOS os nós marcados como selecionados.
   */
  selected?: boolean;
  dragging?: boolean;
  data: {
    tipo: string;
    config: Record<string, unknown>;
    label?: string;
    clienteId: string;
  };
}

/**
 * Deslocamento da cópia. Nasce à direita e um pouco abaixo: exatamente em
 * cima do original ela pareceria não ter acontecido nada, e longe demais sai
 * do campo de visão de quem acabou de apertar Ctrl+D.
 */
export const DESLOCAMENTO_COPIA = { x: 48, y: 48 };

/**
 * Cópia profunda da config.
 *
 * `structuredClone` existe em todo navegador que o app suporta; o fallback é
 * pra ambiente de teste antigo. Cópia RASA seria um bug silencioso: editar a
 * lista de condições do clone mexeria na do original, porque as duas
 * apontariam pro mesmo array.
 */
function clonarConfig(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === "function") return structuredClone(config);
  return JSON.parse(JSON.stringify(config ?? {}));
}

export interface ResultadoDuplicacao {
  no: NoDuplicavel;
}

/**
 * Monta o clone. `novoId`/`novoClienteId` entram por parâmetro em vez de
 * serem gerados aqui pra função continuar determinística — o editor passa os
 * geradores dele, o teste passa valores fixos.
 */
export function duplicarNo(
  origem: NoDuplicavel,
  novoId: string,
  novoClienteId: string,
): ResultadoDuplicacao {
  return {
    no: {
      ...origem,
      id: novoId,
      position: {
        x: origem.position.x + DESLOCAMENTO_COPIA.x,
        y: origem.position.y + DESLOCAMENTO_COPIA.y,
      },
      // Zera o estado de interação. Herdar `selected` fazia o ReactFlow
      // considerar os dois nós selecionados, e arrastar um levava o outro
      // junto. `dragging` herdado no meio de um arrasto é da mesma família.
      selected: false,
      dragging: false,
      data: {
        ...origem.data,
        config: clonarConfig(origem.data.config),
        clienteId: novoClienteId,
      },
    },
  };
}

/**
 * Por que a cópia NÃO leva as setas de saída.
 *
 * Levar as de ENTRADA seria plausível — duas rotas caindo no mesmo tipo de
 * bloco acontece. Mas as de saída, não: o fluxo passaria a seguir por dois
 * caminhos idênticos a partir do mesmo ponto, que é quase sempre engano de
 * quem duplicou pra editar uma variação. Religar é um arrasto; desfazer uma
 * ramificação que ninguém pediu custa mais.
 *
 * Fica como função nomeada em vez de comentário solto porque é uma decisão de
 * produto, e a próxima pessoa que duplicar um bloco vai querer saber por quê.
 */
export function arestasDaCopia(): never[] {
  return [];
}
