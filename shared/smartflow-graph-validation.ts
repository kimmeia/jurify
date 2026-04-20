/**
 * Validação de grafo do SmartFlow — função pura usada pelo editor antes
 * de chamar `criar`/`atualizar`.
 *
 * Regras:
 *   - **Erro (bloqueia o save)**: ciclo no grafo. O engine tem proteção
 *     runtime (`MAX_PASSOS=50`) mas detectar no save evita frustração do
 *     usuário — ele vê o problema antes de executar.
 *   - **Aviso (não bloqueia)**: passos órfãos (sem caminho desde o gatilho)
 *     ou condicional sem nenhuma edge saindo (o fluxo vai terminar aí
 *     independente das condições — pode ser intencional, mas raramente é).
 *
 * Mantida em `shared/` porque é função pura — testável sem DOM/React e
 * reutilizável caso o backend valide também no futuro.
 */

import type { TipoPasso } from "./smartflow-types";

export interface PassoValidar {
  /** ID do nó no editor (não o id do DB). */
  nodeId: string;
  /** UUID estável do passo — alvo das edges. */
  clienteId: string;
  tipo: TipoPasso;
  config: Record<string, unknown>;
  /** Se o passo tem `proximoSe` explícito (passo em modo grafo). */
  temProximoSe: boolean;
}

export interface EdgeValidar {
  source: string;          // nodeId
  target: string;          // nodeId
  sourceHandle?: string | null;
}

export interface ResultadoValidacao {
  erros: string[];
  avisos: string[];
}

/**
 * Detecta ciclos no grafo via DFS com cores (WHITE → GRAY → BLACK). Um ciclo
 * é descoberto quando encontramos uma aresta apontando pra um nó GRAY (em
 * processamento na pilha atual).
 */
function temCiclo(
  nodes: string[],
  adjacencia: Map<string, string[]>,
): boolean {
  const cor = new Map<string, "white" | "gray" | "black">();
  for (const n of nodes) cor.set(n, "white");

  // DFS iterativo (evita stack overflow em grafos grandes).
  for (const inicio of nodes) {
    if (cor.get(inicio) !== "white") continue;
    const stack: Array<{ node: string; vizinhosIdx: number }> = [
      { node: inicio, vizinhosIdx: 0 },
    ];
    cor.set(inicio, "gray");

    while (stack.length > 0) {
      const topo = stack[stack.length - 1];
      const vizinhos = adjacencia.get(topo.node) || [];
      if (topo.vizinhosIdx >= vizinhos.length) {
        cor.set(topo.node, "black");
        stack.pop();
        continue;
      }
      const viz = vizinhos[topo.vizinhosIdx++];
      const corViz = cor.get(viz);
      if (corViz === "gray") return true; // back-edge
      if (corViz === "white") {
        cor.set(viz, "gray");
        stack.push({ node: viz, vizinhosIdx: 0 });
      }
      // black: já processado, ignora
    }
  }
  return false;
}

/**
 * Alcançáveis a partir de `raiz` (BFS). Usado pra detectar órfãos —
 * passos que estão no array mas não são atingíveis desde o gatilho.
 */
function alcancaveis(raiz: string, adjacencia: Map<string, string[]>): Set<string> {
  const visitados = new Set<string>();
  const fila = [raiz];
  while (fila.length > 0) {
    const atual = fila.shift()!;
    if (visitados.has(atual)) continue;
    visitados.add(atual);
    for (const viz of adjacencia.get(atual) || []) fila.push(viz);
  }
  return visitados;
}

/**
 * Valida um grafo de cenário SmartFlow. Retorna erros e avisos separados.
 * `erros` bloqueia o save; `avisos` aparece como warning mas deixa salvar.
 *
 * @param gatilhoNodeId ID do nó de gatilho (raiz do grafo).
 * @param passos lista de passos com metadados relevantes.
 * @param edges arestas do canvas (source → target).
 */
export function validarGrafo(
  gatilhoNodeId: string,
  passos: PassoValidar[],
  edges: EdgeValidar[],
): ResultadoValidacao {
  const erros: string[] = [];
  const avisos: string[] = [];

  if (passos.length === 0) {
    erros.push("Adicione pelo menos um passo ao cenário.");
    return { erros, avisos };
  }

  // Monta lista de adjacência (nodeId → [nodeId...]).
  const adjacencia = new Map<string, string[]>();
  const adicionar = (src: string, tgt: string) => {
    if (!adjacencia.has(src)) adjacencia.set(src, []);
    adjacencia.get(src)!.push(tgt);
  };
  for (const e of edges) adicionar(e.source, e.target);

  // Nodes = gatilho + passos.
  const todosNodes = [gatilhoNodeId, ...passos.map((p) => p.nodeId)];

  // Ciclo → erro.
  if (temCiclo(todosNodes, adjacencia)) {
    erros.push("Ciclo detectado no fluxo — um passo aponta (direta ou indiretamente) pra si mesmo.");
  }

  // Órfãos → aviso (passos sem caminho desde o gatilho).
  const vistos = alcancaveis(gatilhoNodeId, adjacencia);
  const orfaos = passos.filter((p) => !vistos.has(p.nodeId));
  if (orfaos.length > 0) {
    avisos.push(
      `${orfaos.length} passo(s) desconectado(s) do gatilho — não serão executados. Conecte ou remova.`,
    );
  }

  // Condicional sem edges saindo → aviso.
  const condicionaisOrfaos = passos.filter((p) => {
    if (p.tipo !== "condicional") return false;
    const saidas = edges.filter((e) => e.source === p.nodeId);
    return saidas.length === 0;
  });
  if (condicionaisOrfaos.length > 0) {
    avisos.push(
      `${condicionaisOrfaos.length} condicional(is) sem saídas conectadas — o fluxo encerra nesses nós.`,
    );
  }

  return { erros, avisos };
}
