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
 * Detecta ciclos INSEGUROS no grafo via DFS com cores (WHITE → GRAY → BLACK).
 * Um ciclo é descoberto quando uma aresta aponta pra um nó GRAY (na pilha
 * atual). O ciclo é o trecho da pilha desse nó até o topo.
 *
 * Regra do SmartFlow: um ciclo é PERMITIDO se passa por um nó que PAUSA o
 * fluxo esperando o cliente (`whatsapp_aguardar_resposta`) — aí cada volta
 * espera uma mensagem nova, não gira infinito. É o padrão "volta pra IA até
 * o cliente confirmar". Um ciclo SEM esse nó giraria pra sempre = inseguro.
 *
 * Retorna `true` se achar pelo menos um ciclo SEM nó de espera.
 */
function temCicloInseguro(
  nodes: string[],
  adjacencia: Map<string, string[]>,
  nodesDeEspera: Set<string>,
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
      if (corViz === "gray") {
        // back-edge → ciclo do nó `viz` até o topo atual da pilha.
        const idx = stack.findIndex((s) => s.node === viz);
        const cicloNodes = idx >= 0 ? stack.slice(idx).map((s) => s.node) : [];
        const temEspera = cicloNodes.some((n) => nodesDeEspera.has(n));
        if (!temEspera) return true; // ciclo sem espera = giraria infinito
        // ciclo com espera = ok; segue procurando outros ciclos
      } else if (corViz === "white") {
        cor.set(viz, "gray");
        stack.push({ node: viz, vizinhosIdx: 0 });
      }
      // black: já processado, ignora
    }
  }
  return false;
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

  // Nós que PAUSAM o fluxo (aguardar resposta) — tornam um ciclo seguro.
  const nodesDeEspera = new Set(
    passos.filter((p) => p.tipo === "whatsapp_aguardar_resposta").map((p) => p.nodeId),
  );

  // Ciclo SEM um "Aguardar resposta" no caminho → erro (giraria pra sempre).
  // Ciclo COM espera é permitido (o loop conversacional "volta pra IA").
  if (temCicloInseguro(todosNodes, adjacencia, nodesDeEspera)) {
    erros.push(
      "Loop sem 'Aguardar resposta' — o bot giraria pra sempre. Coloque um passo 'Aguardar resposta' dentro do ciclo pra ele esperar a próxima mensagem do cliente a cada volta.",
    );
  }

  // Condicional sem edges saindo → ERRO (bloqueia salvamento).
  // Passos comuns podem ser "fim natural" do fluxo (o engine simplesmente
  // encerra), então não validamos sua saída. Órfãos também são permitidos —
  // podem ser alcançados só por um ramo específico de condicional. A única
  // regra rígida é: condicional precisa de pelo menos 1 saída conectada.
  const condicionaisSemSaida = passos.filter((p) => {
    if (p.tipo !== "condicional") return false;
    const saidas = edges.filter((e) => e.source === p.nodeId);
    return saidas.length === 0;
  });
  if (condicionaisSemSaida.length > 0) {
    erros.push(
      `${condicionaisSemSaida.length} condicional(is) sem saída conectada — conecte pelo menos uma condição ou o fallback.`,
    );
  }

  return { erros, avisos };
}
