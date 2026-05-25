import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  LayoutList,
  Maximize,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

/**
 * Mini-toolbar flutuante no canto inferior direito do canvas. Substitui
 * os Controls padrão do ReactFlow (que ficam no canto esquerdo e tem
 * estilo destoante do resto do app).
 *
 * Botões adicionados além do zoom/fit:
 *   - **Auto-arranjar**: reposiciona os nós em um grafo top-down,
 *     distribuindo ramos do condicional horizontalmente.
 *   - **Validar**: roda `validarGrafo` (mesma função do save) e mostra
 *     o resultado num toast antes do usuário tentar persistir.
 */
export function EditorCanvasToolbar({
  onZoomIn,
  onZoomOut,
  onFit,
  onAutoArranjar,
  onValidar,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onAutoArranjar: () => void;
  onValidar: () => void;
}) {
  return (
    <div className="absolute bottom-4 right-4 z-10 bg-card rounded-lg border border-slate-200 dark:border-slate-800 shadow-lg p-1 flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="w-7 h-7 p-0"
        onClick={onZoomIn}
        title="Aumentar zoom"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-7 h-7 p-0"
        onClick={onZoomOut}
        title="Diminuir zoom"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <div className="w-px h-5 bg-border mx-0.5"></div>
      <Button
        variant="ghost"
        size="sm"
        className="w-7 h-7 p-0"
        onClick={onFit}
        title="Enquadrar tudo na tela"
      >
        <Maximize className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-7 h-7 p-0 text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-950/30"
        onClick={onAutoArranjar}
        title="Reorganizar os nós automaticamente"
      >
        <LayoutList className="h-3.5 w-3.5" />
      </Button>
      <div className="w-px h-5 bg-border mx-0.5"></div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 gap-1 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
        onClick={onValidar}
        title="Verificar se o fluxo está bem montado (sem ciclos, sem condicional órfão)"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold">Validar</span>
      </Button>
    </div>
  );
}

/**
 * Algoritmo de auto-arranjo. Recebe nós e edges, devolve `Map<nodeId, {x, y}>`.
 *
 * Estratégia:
 *  1. BFS a partir do nó de gatilho atribuindo um "nível" (profundidade) a
 *     cada nó conectado. Nós não-alcançáveis ficam num nível "órfão" no fim.
 *  2. Em cada nível, distribui horizontalmente os nós (largura por nó +
 *     espaçamento), centralizando o conjunto sobre o eixo X do canvas.
 *  3. Y avança por nível com `LARGURA_VERTICAL` fixo (alta o suficiente
 *     pra caber nó + labels).
 *
 * Vantagem do BFS por nível: ramos do condicional (que apontam pra 2+ filhos)
 * ficam visualmente paralelos automaticamente — exatamente o layout que o
 * usuário queria desenhar à mão.
 */
export function calcularAutoLayout(
  nodes: Array<{ id: string; position: { x: number; y: number }; type?: string }>,
  edges: Array<{ source: string; target: string }>,
  gatilhoNodeId: string,
): Map<string, { x: number; y: number }> {
  // Layout ESQUERDA → DIREITA: cada nível avança no eixo X; nós irmãos do
  // mesmo nível (ex: ramos do if/else) empilham no eixo Y.
  const NIVEL_WIDTH = 340; // distância horizontal entre níveis
  const NODE_HEIGHT = 150; // altura aproximada de um card + respiro
  const NODE_GAP = 36;
  const X_START = 40;
  const Y_CENTER = 320;

  const adjacencia = new Map<string, string[]>();
  for (const e of edges) {
    if (!adjacencia.has(e.source)) adjacencia.set(e.source, []);
    adjacencia.get(e.source)!.push(e.target);
  }

  const nivel = new Map<string, number>();
  // BFS clássico, preservando ordem de descoberta dos filhos pra que
  // ramos do condicional fiquem no mesmo nível mas em ordem estável.
  const fila: string[] = [gatilhoNodeId];
  nivel.set(gatilhoNodeId, 0);
  while (fila.length > 0) {
    const cur = fila.shift()!;
    const curLevel = nivel.get(cur)!;
    const filhos = adjacencia.get(cur) || [];
    for (const f of filhos) {
      if (!nivel.has(f)) {
        nivel.set(f, curLevel + 1);
        fila.push(f);
      }
    }
  }

  // Nós não-alcançáveis (criados mas sem edge ainda) — vão pro "nível"
  // imediatamente abaixo do último nível atingido pelo BFS, distribuídos
  // horizontalmente como "órfãos".
  const orfaos: string[] = [];
  for (const n of nodes) {
    if (!nivel.has(n.id)) orfaos.push(n.id);
  }
  const maxNivel = nodes.reduce((m, n) => Math.max(m, nivel.get(n.id) ?? -1), -1);
  for (const o of orfaos) nivel.set(o, maxNivel + 1);

  // Agrupa por nível
  const porNivel = new Map<number, string[]>();
  for (const n of nodes) {
    const nv = nivel.get(n.id)!;
    if (!porNivel.has(nv)) porNivel.set(nv, []);
    porNivel.get(nv)!.push(n.id);
  }

  // Posiciona: nível → X, irmãos do nível espalhados no eixo Y (centralizados).
  const resultado = new Map<string, { x: number; y: number }>();
  const niveisOrdenados = Array.from(porNivel.keys()).sort((a, b) => a - b);
  for (const nv of niveisOrdenados) {
    const ids = porNivel.get(nv)!;
    const alturaTotal = ids.length * NODE_HEIGHT + (ids.length - 1) * NODE_GAP;
    const inicioY = Y_CENTER - alturaTotal / 2;
    ids.forEach((id, i) => {
      resultado.set(id, {
        x: X_START + nv * NIVEL_WIDTH,
        y: inicioY + i * (NODE_HEIGHT + NODE_GAP),
      });
    });
  }

  return resultado;
}
