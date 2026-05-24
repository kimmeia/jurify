/**
 * Editor visual do SmartFlow — canvas ReactFlow com paleta de passos
 * e painel de configuração do nó selecionado.
 *
 * Rotas:
 *   /smartflow/novo          → cria cenário novo
 *   /smartflow/:id/editar    → edita cenário existente
 *
 * Ao salvar, os nós são ordenados pela posição Y e serializados como
 * passos sequenciais (campo `ordem` gerado automaticamente). As arestas
 * são puramente visuais — a execução do engine é linear.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnectEnd,
  type OnConnectStart,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, Banknote, BookOpen, Brain, Bot, Calendar, CheckCircle2, ChevronDown, Circle,
  CircleDollarSign, Clock, DollarSign, Eraser, FileText, GitBranch, LayoutGrid, Loader2, MessageCircle,
  Move, Pause, PhoneCall, Play, Plus, Repeat, Save, Sparkles, Tags as TagsIcon, UserPlus, Users, Webhook, Zap,
  CalendarCheck, CalendarX, CalendarClock, CalendarSearch, Trash2, XCircle,
  Variable as VariableIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  TIPO_PASSO_META,
  GATILHO_META,
  TIPO_CANAL_META,
  GRUPO_META,
  CATEGORIAS_PASSO,
  getTipoPassoMeta,
  getGatilhoMeta,
  getCategoriaDoTipo,
  CAMPOS_CONDICIONAL,
  type CategoriaPassoMeta,
  type GatilhoMeta,
  type GatilhoSmartflow,
  type GrupoSmartflow,
  type TipoPassoMeta,
  type TipoPasso,
  type TipoCanalMensagem,
} from "@shared/smartflow-types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { validarGrafo } from "@shared/smartflow-graph-validation";
import { VariableInput, VariableTrigger } from "@/components/VariableInput";
import { TagsChipPicker } from "@/components/TagsChipPicker";
import { useSmartFlowVariaveis } from "@/hooks/useSmartFlowVariaveis";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EditorTopbar } from "./smartflow/editor-topbar";
import { EditorPaleta } from "./smartflow/editor-paleta";
import { EditorTestarDialog } from "./smartflow/editor-testar-dialog";
import { EditorCanvasToolbar, calcularAutoLayout } from "./smartflow/editor-canvas-toolbar";
import { variaveisPublicadasPorPasso } from "./smartflow/editor-painel-saida";
import { PainelVariaveis } from "./smartflow/editor-painel-variaveis";
import { validarPasso, ValidacaoPassoPanel } from "./smartflow/editor-validacao-passo";
import { VariaveisFluxoContext } from "@/hooks/useSmartFlowVariaveis";
import type { Variavel } from "@/components/VariableInput";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Ícones por tipo (mantidos no frontend p/ não poluir shared) ───────────

const TIPO_ICON: Record<TipoPasso, LucideIcon> = {
  ia_classificar: Brain,
  ia_responder: Bot,
  ia_extrair_campos: Sparkles,
  crm_buscar_contato: Users,
  crm_listar_acoes_cliente: BookOpen,
  processo_buscar_movimentacoes: BookOpen,
  calcom_horarios: Calendar,
  calcom_agendar: CheckCircle2,
  calcom_listar: CalendarSearch,
  calcom_cancelar: CalendarX,
  calcom_remarcar: CalendarClock,
  agenda_criar: CalendarCheck,
  whatsapp_enviar: MessageCircle,
  whatsapp_aguardar_resposta: Pause,
  transferir: PhoneCall,
  condicional: GitBranch,
  para_cada_item: Repeat,
  esperar: Clock,
  webhook: Webhook,
  kanban_criar_card: LayoutGrid,
  kanban_mover_card: Move,
  kanban_atribuir_responsavel: UserPlus,
  kanban_tags: TagsIcon,
  asaas_gerar_cobranca: Banknote,
  asaas_cancelar_cobranca: XCircle,
  asaas_consultar_valor_aberto: CircleDollarSign,
  asaas_marcar_recebida: CheckCircle2,
  definir_variavel: VariableIcon,
  definir_campo_personalizado: FileText,
};

/** Ícone representativo de cada categoria popover. */
const CATEGORIA_ICON: Record<string, LucideIcon> = {
  kanban: LayoutGrid,
  agendamento: Calendar,
  asaas: DollarSign,
  geral: Sparkles,
};

const GATILHO_ICON: Record<GatilhoSmartflow, LucideIcon> = {
  whatsapp_mensagem: MessageCircle,
  mensagem_canal: MessageCircle,
  pagamento_recebido: DollarSign,
  pagamento_vencido: AlertTriangle,
  pagamento_proximo_vencimento: Clock,
  novo_lead: Users,
  agendamento_criado: CalendarCheck,
  agendamento_cancelado: CalendarX,
  agendamento_remarcado: CalendarClock,
  agendamento_lembrete: Clock,
  manual: Play,
};

/**
 * Ícone representativo por categoria (grupo). Usado na paleta lateral,
 * que lista categorias em vez de cada operação individual.
 */
const GRUPO_ICON: Record<GrupoSmartflow, LucideIcon> = {
  mensagem: MessageCircle,
  asaas: DollarSign,
  calcom: Calendar,
  crm: Users,
  ia: Bot,
  acoes: Zap,
  fluxo: Play,
};

/**
 * Retorna a primeira operação (ordem definida em `GATILHO_META`) da
 * categoria. Usado quando o usuário clica numa categoria da paleta e
 * precisamos materializar um gatilho concreto no nó.
 */
function primeiraOperacaoDaCategoria(grupo: GrupoSmartflow): GatilhoSmartflow | null {
  const meta = GATILHO_META.find((g) => g.grupo === grupo && !g.oculto);
  return meta?.id ?? null;
}

/** Operações (gatilhos) disponíveis numa categoria, mantendo a ordem de `GATILHO_META`. Gatilhos ocultos (legados) ficam de fora. */
function operacoesDaCategoria(grupo: GrupoSmartflow): GatilhoMeta[] {
  return GATILHO_META.filter((g) => g.grupo === grupo && !g.oculto);
}

// ─── Tipagem dos nós ───────────────────────────────────────────────────────

interface PassoNodeData extends Record<string, unknown> {
  tipo: TipoPasso;
  config: Record<string, unknown>;
  label: string;
  /**
   * UUID estável do passo — sobrevive a salvamentos (o backend preserva via
   * coluna `clienteIdPasso`). As edges do canvas são persistidas em
   * `proximoSe` referenciando este id, não o id do ReactFlow.
   */
  clienteId: string;
}

interface GatilhoNodeData extends Record<string, unknown> {
  gatilho: GatilhoSmartflow;
  configGatilho: Record<string, unknown>;
  label: string;
}

type PassoNode = Node<PassoNodeData, "passo">;
type GatilhoNode = Node<GatilhoNodeData, "gatilho">;
type AnyNode = PassoNode | GatilhoNode;

/** ID fixo do nó de gatilho — permite identificá-lo sem ambiguidade. */
const GATILHO_NODE_ID = "__gatilho__";

// ─── Nós visuais ───────────────────────────────────────────────────────────

/**
 * Gradiente do header + cor da borda por "família visual" do passo.
 * Agrupa tipos relacionados na mesma cor pra bater o olho e identificar.
 */
const FAMILIA_COR_NO: Record<TipoPasso, { grad: string; border: string }> = {
  ia_classificar: { grad: "from-violet-500 to-indigo-500", border: "border-violet-300 dark:border-violet-800" },
  ia_responder: { grad: "from-violet-500 to-indigo-500", border: "border-violet-300 dark:border-violet-800" },
  ia_extrair_campos: { grad: "from-fuchsia-500 to-purple-500", border: "border-fuchsia-300 dark:border-fuchsia-800" },
  crm_buscar_contato: { grad: "from-violet-500 to-pink-500", border: "border-violet-300 dark:border-violet-800" },
  crm_listar_acoes_cliente: { grad: "from-violet-500 to-pink-500", border: "border-violet-300 dark:border-violet-800" },
  processo_buscar_movimentacoes: { grad: "from-indigo-500 to-blue-500", border: "border-indigo-300 dark:border-indigo-800" },
  calcom_horarios: { grad: "from-orange-500 to-amber-500", border: "border-orange-300 dark:border-orange-800" },
  calcom_agendar: { grad: "from-orange-500 to-amber-500", border: "border-orange-300 dark:border-orange-800" },
  calcom_listar: { grad: "from-orange-500 to-amber-500", border: "border-orange-300 dark:border-orange-800" },
  calcom_cancelar: { grad: "from-rose-500 to-pink-500", border: "border-rose-300 dark:border-rose-800" },
  calcom_remarcar: { grad: "from-cyan-500 to-blue-500", border: "border-cyan-300 dark:border-cyan-800" },
  agenda_criar: { grad: "from-orange-500 to-amber-500", border: "border-orange-300 dark:border-orange-800" },
  whatsapp_enviar: { grad: "from-teal-500 to-cyan-600", border: "border-teal-300 dark:border-teal-800" },
  whatsapp_aguardar_resposta: { grad: "from-cyan-500 to-blue-500", border: "border-cyan-300 dark:border-cyan-800" },
  transferir: { grad: "from-amber-500 to-orange-500", border: "border-amber-300 dark:border-amber-800" },
  condicional: { grad: "from-amber-500 to-orange-500", border: "border-amber-300 dark:border-amber-800" },
  para_cada_item: { grad: "from-amber-500 to-yellow-500", border: "border-amber-300 dark:border-amber-800" },
  esperar: { grad: "from-slate-500 to-slate-600", border: "border-slate-300 dark:border-slate-700" },
  webhook: { grad: "from-pink-500 to-rose-500", border: "border-pink-300 dark:border-pink-800" },
  kanban_criar_card: { grad: "from-indigo-500 to-violet-500", border: "border-indigo-300 dark:border-indigo-800" },
  kanban_mover_card: { grad: "from-indigo-500 to-violet-500", border: "border-indigo-300 dark:border-indigo-800" },
  kanban_atribuir_responsavel: { grad: "from-indigo-500 to-violet-500", border: "border-indigo-300 dark:border-indigo-800" },
  kanban_tags: { grad: "from-indigo-500 to-violet-500", border: "border-indigo-300 dark:border-indigo-800" },
  asaas_gerar_cobranca: { grad: "from-emerald-500 to-teal-600", border: "border-emerald-300 dark:border-emerald-800" },
  asaas_cancelar_cobranca: { grad: "from-rose-500 to-pink-500", border: "border-rose-300 dark:border-rose-800" },
  asaas_consultar_valor_aberto: { grad: "from-emerald-500 to-teal-600", border: "border-emerald-300 dark:border-emerald-800" },
  asaas_marcar_recebida: { grad: "from-emerald-500 to-green-600", border: "border-emerald-300 dark:border-emerald-800" },
  definir_variavel: { grad: "from-slate-500 to-slate-600", border: "border-slate-300 dark:border-slate-700" },
  definir_campo_personalizado: { grad: "from-slate-500 to-slate-600", border: "border-slate-300 dark:border-slate-700" },
};

function PassoNodeView({ data, selected }: NodeProps<PassoNode>) {
  const meta = getTipoPassoMeta(data.tipo);
  const Icon = TIPO_ICON[data.tipo] ?? Zap;
  const resumo = resumirConfig(data.tipo, data.config);
  const cor = FAMILIA_COR_NO[data.tipo] ?? { grad: "from-slate-500 to-slate-600", border: "border-border" };

  // Gatilho atual (pra validar). Lido direto do ReactFlow a cada render —
  // sem memo, senão o valor congela no mount e não acompanha troca de gatilho.
  const { getNodes } = useReactFlow();
  const gatilho = (getNodes() as AnyNode[]).find(isGatilhoNode)?.data.gatilho ?? "mensagem_canal";

  // Validação → status dot + mensagem inline.
  const validacoes = validarPasso(data.tipo, gatilho, data.config);
  const temErro = validacoes.some((v) => v.severidade === "erro");
  const temAviso = !temErro && validacoes.some((v) => v.severidade === "aviso");
  const statusCor = temErro ? "bg-red-400" : temAviso ? "bg-amber-400" : "bg-emerald-400";
  const primeiroProblema = validacoes.find((v) => v.severidade === "erro")
    ?? validacoes.find((v) => v.severidade === "aviso");

  // Variáveis publicadas pra mostrar como chips no rodapé.
  const publicadas = variaveisPublicadasPorPasso(data.tipo, data.config);

  // O condicional ganha um handle por ramo. Cada condição tem um id estável
  // (`config.condicoes[i].id`), mais o "fallback". Pros demais passos basta
  // um handle "default".
  const isCondicional = data.tipo === "condicional";
  const condicoes = isCondicional && Array.isArray((data.config as any).condicoes)
    ? ((data.config as any).condicoes as Array<{ id: string; label?: string }>)
    : [];

  return (
    <div
      className={`rounded-xl border-2 shadow-sm bg-card min-w-[230px] max-w-[290px] overflow-hidden transition-shadow ${
        selected ? "ring-2 ring-violet-400 ring-offset-1 border-violet-400" : cor.border
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground/40" />

      {/* Header com gradiente da família + status dot */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-r ${cor.grad} text-white`}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[11px] font-bold truncate flex-1 uppercase tracking-wide">{meta.label}</span>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${statusCor}`}
          title={temErro ? "Tem erro de configuração" : temAviso ? "Tem aviso" : "Configuração OK"}
          style={{ boxShadow: "0 0 0 2px rgba(255,255,255,0.5)" }}
        />
      </div>

      {/* Body: preview da config */}
      {resumo && (
        <div className="px-2.5 py-1.5 text-[10px] text-muted-foreground border-t bg-card">
          {resumo}
        </div>
      )}

      {/* Validação inline (só erro/aviso, compacto) */}
      {primeiroProblema && (
        <div
          className={`px-2.5 py-1 text-[9.5px] flex items-start gap-1 border-t leading-snug ${
            temErro
              ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
              : "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"
          }`}
        >
          <AlertTriangle className="h-2.5 w-2.5 shrink-0 mt-0.5" />
          <span className="line-clamp-2">{primeiroProblema.mensagem}</span>
        </div>
      )}

      {/* Footer: chips de variáveis publicadas */}
      {publicadas.length > 0 && (
        <div className="px-2 py-1.5 bg-muted/40 border-t flex flex-wrap items-center gap-1">
          <span className="text-[8.5px] uppercase tracking-wider text-muted-foreground font-bold">dá</span>
          {publicadas.slice(0, 2).map((v) => (
            <span
              key={v.path}
              className="text-[8.5px] font-mono font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 truncate max-w-[110px]"
              title={v.label}
            >
              {`{{${v.path}}}`}
            </span>
          ))}
          {publicadas.length > 2 && (
            <span className="text-[8.5px] text-muted-foreground">+{publicadas.length - 2}</span>
          )}
        </div>
      )}

      {isCondicional ? (
        <div className="border-t bg-muted/20 py-1">
          {condicoes.map((c, idx) => (
            <HandleRow
              key={c.id}
              handleId={`cond_${c.id}`}
              label={c.label?.trim() || `Condição ${idx + 1}`}
              cor="#22c55e"
            />
          ))}
          <HandleRow handleId="fallback" label="fallback" italic cor="#f59e0b" />
        </div>
      ) : data.tipo === "para_cada_item" ? (
        // Loop tem 2 saídas: "corpo" (subfluxo da iteração) e "depois"
        // (continuação após o loop terminar).
        <div className="border-t bg-muted/20 py-1">
          <HandleRow handleId="corpo" label="🔁 corpo do loop" cor="#f59e0b" />
          <HandleRow handleId="depois" label="depois (terminou)" cor="#3b82f6" />
        </div>
      ) : (
        <Handle type="source" position={Position.Bottom} id="default" className="!bg-muted-foreground/40" />
      )}
    </div>
  );
}

/**
 * Linha de um handle de saída no nó condicional. O handle é renderizado
 * com `position: relative` dentro do flex da linha — o ReactFlow identifica
 * pelo DOM e posiciona a edge corretamente. Isso evita o bug de todos os
 * handles caírem em `top: 50%` (sobrepostos).
 */
function HandleRow({
  handleId,
  label,
  cor,
  italic,
}: {
  handleId: string;
  label: string;
  cor: string;
  italic?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 text-[10px]">
      <span
        className={`flex-1 truncate ${italic ? "italic text-muted-foreground" : "text-foreground/80"}`}
      >
        {label}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        id={handleId}
        style={{
          // `position: relative` sai do default absolute do ReactFlow —
          // assim o handle fica *nesta* linha, não no centro vertical do nó.
          position: "relative",
          top: "auto",
          right: "auto",
          transform: "translateX(50%)",
          background: cor,
          width: 10,
          height: 10,
          border: "2px solid white",
        }}
      />
    </div>
  );
}

/**
 * Botão da paleta que abre Popover com os subtipos de uma categoria.
 * Usado pra agrupar Kanban/Agendamento/Asaas/Geral em 1 linha cada.
 */
function CategoriaPopoverButton({
  categoria,
  onPick,
}: {
  categoria: CategoriaPassoMeta;
  onPick: (tipo: TipoPasso) => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = CATEGORIA_ICON[categoria.id] ?? Sparkles;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded border border-dashed hover:border-solid hover:shadow-sm transition-all text-left bg-card"
          title={`${categoria.tipos.length} ações disponíveis`}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-medium leading-tight">{categoria.label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 ml-auto opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-64 p-1.5 space-y-1"
      >
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground px-1.5 pt-1 pb-0.5 font-semibold">
          {categoria.label}
        </p>
        {categoria.tipos.map((tipo) => {
          const meta = TIPO_PASSO_META.find((m) => m.id === tipo);
          if (!meta) return null;
          const ItemIcon = TIPO_ICON[tipo];
          return (
            <button
              key={tipo}
              onClick={() => {
                onPick(tipo);
                setOpen(false);
              }}
              className={`w-full flex items-start gap-2 px-2 py-1.5 rounded border border-dashed hover:border-solid hover:shadow-sm transition-all text-left ${meta.cor}`}
              title={meta.descricao}
            >
              <ItemIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium leading-tight">{meta.label}</div>
                <div className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">
                  {meta.descricao}
                </div>
              </div>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function GatilhoNodeView({ data, selected }: NodeProps<GatilhoNode>) {
  const meta = getGatilhoMeta(data.gatilho);
  const OpIcon = GATILHO_ICON[data.gatilho] ?? Zap;
  const resumo = resumirConfigGatilho(data.gatilho, data.configGatilho);
  const grupoMeta = GRUPO_META.find((g) => g.id === meta.grupo);
  const GrupoIconComp = GRUPO_ICON[meta.grupo] ?? Zap;

  return (
    <div
      className={`rounded-xl border-2 shadow-md bg-card min-w-[220px] max-w-[280px] ring-2 ring-offset-2 ring-offset-background transition-all ${
        selected ? "ring-amber-500 border-amber-500" : "ring-amber-500/40 border-amber-500/60"
      }`}
    >
      {/* Linha 1: categoria — tipo "pasta". */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-t-[10px] bg-gradient-to-r from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40 text-amber-900 dark:text-amber-200">
        <Zap className="h-3 w-3 shrink-0" />
        <GrupoIconComp className="h-3 w-3 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wider truncate">
          {grupoMeta?.label || "Gatilho"}
        </span>
      </div>

      {/* Linha 2: operação específica selecionada. */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t bg-card">
        <OpIcon className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
        <span className="text-xs font-semibold truncate">{meta.label}</span>
      </div>

      {resumo && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t bg-muted/30 rounded-b-[10px]">
          {resumo}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-amber-500" />
    </div>
  );
}

const nodeTypes = { passo: PassoNodeView, gatilho: GatilhoNodeView };

/**
 * Edge customizada "removivel". Renderiza o caminho Bezier padrão + um
 * botão X no ponto médio, visível somente no hover. Clicar no X remove
 * a edge via `setEdges` injetado por `useReactFlow`. Também suporta a
 * tecla Delete/Backspace via `deleteKeyCode` do próprio ReactFlow.
 */
function RemovivelEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd } = props;
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });
  return (
    <>
      {/* Caminho mais grosso invisível por cima pra aumentar hit area. */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: "pointer" }}
      />
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="smartflow-edge-delete"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEdges((eds) => eds.filter((ed) => ed.id !== id));
            }}
            title="Remover conexão"
            className="flex items-center justify-center w-5 h-5 rounded-full bg-background border border-destructive/60 text-destructive shadow-sm hover:bg-destructive hover:text-white transition-colors text-[10px]"
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { removivel: RemovivelEdge };

/**
 * Menu flutuante posicionado em `(x, y)` de tela, com a lista completa de
 * passos agrupada por categoria. Usado quando o usuário arrasta uma
 * conexão e solta no canvas vazio — ao escolher um passo, o editor cria
 * o nó na posição e conecta automaticamente. Fecha em Escape ou clique
 * fora.
 */
function MenuConectarPasso({
  x,
  y,
  onEscolher,
  onFechar,
}: {
  x: number;
  y: number;
  onEscolher: (tipo: TipoPasso) => void;
  onFechar: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onFechar]);

  return (
    <>
      <div
        onClick={onFechar}
        className="fixed inset-0 z-40"
        style={{ cursor: "default" }}
      />
      <div
        className="fixed z-50 bg-popover border rounded-md shadow-lg p-2 w-64 max-h-[60vh] overflow-y-auto"
        style={{ top: y, left: x }}
      >
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1 font-semibold">
          Conectar a um novo passo
        </p>
        {agrupar<TipoPassoMeta>(TIPO_PASSO_META).map((g) => (
          <div key={g.id} className="mb-2 last:mb-0">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 px-1 mb-0.5 font-semibold">
              {g.label}
            </p>
            <div className="space-y-0.5">
              {g.itens.map((t) => {
                const Icon = TIPO_ICON[t.id] ?? Zap;
                return (
                  <button
                    key={t.id}
                    onClick={() => onEscolher(t.id)}
                    className="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-accent"
                    title={t.descricao}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function resumirConfigGatilho(g: GatilhoSmartflow, cfg: Record<string, unknown>): string {
  if (!cfg) return "";
  if (g === "mensagem_canal") {
    const canais = Array.isArray(cfg.canais) ? (cfg.canais as string[]) : [];
    if (canais.length === 0) return "Qualquer canal";
    return canais
      .map((c) => TIPO_CANAL_META.find((m) => m.id === c)?.label || c)
      .join(", ");
  }
  if (g === "pagamento_vencido" || g === "pagamento_proximo_vencimento") {
    const base =
      g === "pagamento_vencido"
        ? Number(cfg.diasAtraso ?? 0) > 0
          ? `≥ ${Number(cfg.diasAtraso)} dia(s) atraso`
          : "qualquer atraso"
        : `${Number(cfg.diasAntes ?? 3)} dia(s) antes`;
    const horario = typeof cfg.horarioInicial === "string" ? cfg.horarioInicial : "";
    if (!horario) return base;
    const disparos = Number(cfg.disparosPorDia ?? 1);
    const dias = Number(cfg.repetirPorDias ?? 1);
    return `${base} · ${disparos}×/dia das ${horario}${dias > 1 ? ` por ${dias}d` : ""}`;
  }
  if (g === "agendamento_lembrete") {
    const dias = Number(cfg.diasAntes ?? 1);
    const horario = typeof cfg.horario === "string" ? cfg.horario : "18:00";
    if (dias === 0) return `No dia às ${horario}`;
    if (dias === 1) return `Véspera às ${horario}`;
    return `${dias} dias antes às ${horario}`;
  }
  return "";
}

function resumirConfig(tipo: TipoPasso, config: Record<string, unknown>): string {
  if (!config) return "";
  switch (tipo) {
    case "ia_classificar":
      return Array.isArray(config.categorias) ? (config.categorias as string[]).join(", ") : "";
    case "ia_responder":
      if (typeof config.agenteId === "number" && config.agenteId > 0) return `Agente #${config.agenteId}`;
      return typeof config.prompt === "string" ? truncar(config.prompt, 60) : "";
    case "calcom_horarios":
      return config.duracao ? `${config.duracao} min` : "";
    case "calcom_listar":
      return config.status ? String(config.status) : "upcoming";
    case "calcom_cancelar":
      return typeof config.bookingId === "string" && config.bookingId ? `#${config.bookingId}` : "usa {agendamentoId}";
    case "calcom_remarcar":
      return typeof config.novoHorario === "string" && config.novoHorario
        ? truncar(String(config.novoHorario), 30)
        : "usa {horarioEscolhido}";
    case "whatsapp_enviar":
      return typeof config.template === "string" ? truncar(config.template, 50) : "";
    case "condicional": {
      const cs = Array.isArray(config.condicoes) ? (config.condicoes as any[]) : [];
      if (cs.length > 0) {
        return `${cs.length} condição(ões) + fallback`;
      }
      // Shape legado
      const campo = config.campo || "";
      const op = config.operador || "igual";
      const valor = config.valor || "";
      return `${campo} ${op} ${valor}`.trim();
    }
    case "esperar":
      return config.delayMinutos ? `${config.delayMinutos} min` : "";
    case "webhook":
      return typeof config.url === "string" ? truncar(config.url, 40) : "";
    case "kanban_criar_card":
      return config.prioridade ? `Prioridade ${config.prioridade}` : "";
    case "kanban_mover_card": {
      const card = String(config.cardId || "").trim() || "{{kanbanCardId}}";
      const col = config.colunaDestinoId ? `→ #${config.colunaDestinoId}` : "→ ?";
      return `${truncar(card, 18)} ${col}`;
    }
    case "kanban_atribuir_responsavel": {
      if (config.responsavelId) return `colaborador #${config.responsavelId}`;
      return config.responsavelAuto === false ? "(sem auto)" : "auto (atendente)";
    }
    case "kanban_tags": {
      const modo = String(config.modo || "adicionar");
      const tags = String(config.tags || "").trim();
      return tags ? `${modo}: ${truncar(tags, 24)}` : modo;
    }
    case "definir_variavel": {
      const chave = String(config.chave || "").trim();
      const valor = String(config.valor || "").trim();
      if (!chave) return "(sem nome)";
      return valor ? `${chave} = ${truncar(valor, 24)}` : chave;
    }
    case "definir_campo_personalizado": {
      const chave = String(config.chave || "").trim();
      const valor = String(config.valor || "").trim();
      if (!chave) return "(sem campo)";
      return valor ? `${chave} = ${truncar(valor, 24)}` : chave;
    }
    case "asaas_gerar_cobranca": {
      const valor = String(config.valor || "").trim();
      const tipo = String(config.tipoCobranca || "BOLETO");
      return valor ? `${tipo}: R$ ${truncar(valor, 12)}` : tipo;
    }
    case "asaas_cancelar_cobranca": {
      const id = String(config.pagamentoId || "").trim() || "{{pagamentoId}}";
      return truncar(id, 18);
    }
    case "asaas_consultar_valor_aberto":
      return "lê resumo financeiro";
    case "asaas_marcar_recebida": {
      const id = String(config.pagamentoId || "").trim() || "{{pagamentoId}}";
      return truncar(id, 18);
    }
    default:
      return "";
  }
}

function truncar(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function novoNodeId() {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Gera um UUID v4-ish usando `crypto.randomUUID` (navegador moderno) ou
 * fallback manual quando indisponível. Usado como `clienteId` estável dos
 * passos — referenciado pelas edges em `proximoSe`.
 */
function novoClienteId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* fallback */ }
  return "cli_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function criarNode(tipo: TipoPasso, y: number, config: Record<string, unknown> = {}): PassoNode {
  const meta = getTipoPassoMeta(tipo);
  return {
    id: novoNodeId(),
    type: "passo",
    position: { x: 80, y },
    data: { tipo, config, label: meta.label, clienteId: novoClienteId() },
  };
}

function criarGatilhoNode(
  gatilho: GatilhoSmartflow,
  configGatilho: Record<string, unknown> = {},
): GatilhoNode {
  const meta = getGatilhoMeta(gatilho);
  return {
    id: GATILHO_NODE_ID,
    type: "gatilho",
    position: { x: 80, y: 10 },
    data: { gatilho, configGatilho, label: meta.label },
    deletable: false,
  };
}

function isGatilhoNode(n: AnyNode): n is GatilhoNode {
  return n.type === "gatilho";
}

/** Extrai só os nós de passo, ordenados pela posição Y (top-to-bottom). */
function passoNodesOrdenados(nodes: AnyNode[]): PassoNode[] {
  return nodes
    .filter((n): n is PassoNode => n.type === "passo")
    .slice()
    .sort((a, b) => a.position.y - b.position.y);
}

/**
 * Agrupa um array de metas por `grupo` e devolve na ordem definida por
 * `GRUPO_META.ordem`. Grupos vazios são omitidos. Usado pra renderizar a
 * paleta do editor com seções por provider/categoria.
 */
function agrupar<T extends { grupo: GrupoSmartflow }>(
  itens: ReadonlyArray<T>,
): Array<{ id: GrupoSmartflow; label: string; itens: T[] }> {
  const porGrupo = new Map<GrupoSmartflow, T[]>();
  for (const item of itens) {
    if (!porGrupo.has(item.grupo)) porGrupo.set(item.grupo, []);
    porGrupo.get(item.grupo)!.push(item);
  }
  return GRUPO_META
    .filter((g) => porGrupo.has(g.id))
    .map((g) => ({ id: g.id, label: g.label, itens: porGrupo.get(g.id)! }));
}

// ─── Componente principal ─────────────────────────────────────────────────

/**
 * Wrapper que provê o contexto do ReactFlow pra TODO o editor — não só pro
 * `<ReactFlow>`. Necessário porque o painel direito (fora do `<ReactFlow>`)
 * usa `useReactFlow()` pra ler o gatilho atual na validação dos passos.
 * Sem o provider, esse hook quebra com "zustand provider ... ancestor".
 */
export default function SmartFlowEditor() {
  return (
    <ReactFlowProvider>
      <SmartFlowEditorInner />
    </ReactFlowProvider>
  );
}

function SmartFlowEditorInner() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const utils = (trpc as any).useUtils?.() || (trpc as any).useContext?.();

  const editandoId = params.id ? Number(params.id) : null;
  const novo = !editandoId;

  // Dados gerais do cenário (gatilho vive como nó no canvas)
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");

  // Estado de "alterações não salvas". Cada handler de mutação no canvas
  // chama `marcarDirty()`. Reseta ao carregar o cenário e após save OK.
  // `loadedRef` evita marcar dirty durante o load inicial (o setNodes do
  // useEffect disparado pelo `cenario` não deve ser interpretado como edição).
  const [dirty, setDirty] = useState(false);
  const [ultimoSalvado, setUltimoSalvado] = useState<Date | null>(null);
  const loadedRef = useRef(false);
  const marcarDirty = useCallback(() => {
    if (loadedRef.current) setDirty(true);
  }, []);

  // Dialogs do editor
  const [testarOpen, setTestarOpen] = useState(false);
  const [excluirOpen, setExcluirOpen] = useState(false);

  // Canvas começa com um nó de gatilho default (mensagem_canal).
  // O nó de gatilho tem ID fixo e não é deletável — usuário só troca o tipo
  // clicando na paleta.
  const [nodes, setNodes] = useState<AnyNode[]>(() => [criarGatilhoNode("mensagem_canal")]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Estado para o menu "conectar a um novo passo": quando o usuário arrasta
  // uma conexão de um handle e solta no canvas vazio, abrimos uma lista de
  // passos. Ao escolher, criamos o passo na posição do mouse e conectamos
  // o handle de origem ao novo nó.
  const [rfInstance, setRfInstance] = useState<any>(null);
  const conexaoPendenteRef = useRef<{ nodeId: string; handleId: string | null } | null>(null);
  const [menuConexao, setMenuConexao] = useState<{
    x: number;
    y: number;
    source: { nodeId: string; handleId: string | null };
  } | null>(null);

  // Carrega cenário existente
  const { data: cenario, isLoading } = (trpc as any).smartflow.detalhe.useQuery(
    { id: editandoId },
    { enabled: !!editandoId },
  );

  useEffect(() => {
    if (!cenario) return;
    setNome(cenario.nome || "");
    setDescricao(cenario.descricao || "");
    const gatilhoAtual = (cenario.gatilho as GatilhoSmartflow) || "mensagem_canal";
    const configGatilhoAtual = (cenario.configGatilho as Record<string, unknown>) || {};
    const gatilhoNode = criarGatilhoNode(gatilhoAtual, configGatilhoAtual);

    const passos = (cenario.passos || []) as Array<{
      id: number;
      tipo: TipoPasso;
      config: string | null;
      clienteId?: string | null;
      proximoSe?: Record<string, string> | null;
    }>;

    const passosNodes: PassoNode[] = passos.map((p, i) => {
      let cfg: Record<string, unknown> = {};
      try { cfg = p.config ? JSON.parse(p.config) : {}; } catch { cfg = {}; }
      return {
        id: `p${p.id}`,
        type: "passo",
        position: { x: 80, y: 140 + i * 120 },
        data: {
          tipo: p.tipo,
          config: cfg,
          label: getTipoPassoMeta(p.tipo).label,
          // Cenários legados (pré-branching) não têm clienteId — gera um.
          clienteId: p.clienteId || novoClienteId(),
        },
      };
    });

    // clienteId → id do nó ReactFlow, pra reconstruir edges.
    const porClienteId = new Map<string, string>();
    for (const n of passosNodes) porClienteId.set(n.data.clienteId, n.id);

    const es: Edge[] = [];
    // Conecta gatilho ao primeiro passo visualmente (sempre presente).
    if (passosNodes.length > 0) {
      es.push({
        id: `e-gatilho-${passosNodes[0].id}`,
        source: GATILHO_NODE_ID,
        target: passosNodes[0].id,
        type: "removivel",
        animated: true,
      });
    }

    // Reconstrói edges a partir de `proximoSe` persistido. Se um passo não
    // tem `proximoSe`, ligamos linear (passo anterior → este) pra manter o
    // visual coerente em cenários legados.
    for (let i = 0; i < passosNodes.length; i++) {
      const p = passos[i];
      const node = passosNodes[i];
      const mapa = p.proximoSe;
      if (mapa && typeof mapa === "object" && Object.keys(mapa).length > 0) {
        for (const [chave, alvoClienteId] of Object.entries(mapa)) {
          const targetNodeId = porClienteId.get(alvoClienteId);
          if (!targetNodeId) continue;
          es.push({
            id: `e-${node.id}-${chave}-${targetNodeId}`,
            source: node.id,
            target: targetNodeId,
            sourceHandle: chave,
            type: "removivel",
            animated: true,
          });
        }
      } else if (i > 0) {
        // Sem proximoSe: edge linear com handle "default"
        const prev = passosNodes[i - 1];
        const prevMapa = passos[i - 1].proximoSe;
        // Só desenha edge linear se o anterior também não tiver proximoSe
        // (senão viraria duplicata visual).
        if (!prevMapa || Object.keys(prevMapa).length === 0) {
          // Passos não-condicionais saem do handle "default" (bottom).
          // Incluir `sourceHandle` explícito garante persistência idempotente.
          es.push({
            id: `e-${prev.id}-${node.id}`,
            source: prev.id,
            target: node.id,
            sourceHandle: "default",
            type: "removivel",
            animated: true,
          });
        }
      }
    }

    setNodes([gatilhoNode, ...passosNodes]);
    setEdges(es);

    // Snapshot do estado salvo — referência pra "Salvo há X" e dirty.
    setDirty(false);
    setUltimoSalvado(cenario.updatedAt ? new Date(cenario.updatedAt as any) : new Date());
    // Defer setting loadedRef até o próximo tick pra evitar que o próprio
    // setNodes/setEdges acima dispare callbacks que marquem dirty.
    requestAnimationFrame(() => { loadedRef.current = true; });
  }, [cenario]);

  // Em cenário novo, libera o gating de dirty no mount (não tem load assíncrono).
  useEffect(() => {
    if (novo) {
      requestAnimationFrame(() => { loadedRef.current = true; });
    }
  }, [novo]);

  // Mutations
  const criarMut = (trpc as any).smartflow.criar.useMutation({
    onSuccess: (r: any) => {
      toast.success("Cenário criado!");
      utils?.smartflow?.listar?.invalidate();
      setDirty(false);
      setUltimoSalvado(new Date());
      // Em vez de voltar pra lista, fica no editor agora editando o cenário
      // recém-criado — assim o usuário pode ativar/testar sem 2 navegações.
      if (r?.id) navigate(`/smartflow/${r.id}/editar`);
      else navigate("/smartflow");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const atualizarMut = (trpc as any).smartflow.atualizar.useMutation({
    onSuccess: () => {
      toast.success("Cenário atualizado!");
      utils?.smartflow?.listar?.invalidate();
      utils?.smartflow?.detalhe?.invalidate({ id: editandoId });
      setDirty(false);
      setUltimoSalvado(new Date());
    },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleAtivoMut = (trpc as any).smartflow.toggleAtivo.useMutation({
    onSuccess: () => {
      utils?.smartflow?.detalhe?.invalidate({ id: editandoId });
      utils?.smartflow?.listar?.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const deletarMut = (trpc as any).smartflow.deletar.useMutation({
    onSuccess: () => {
      toast.success("Cenário excluído");
      utils?.smartflow?.listar?.invalidate();
      navigate("/smartflow");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const selectedNode = nodes.find((n) => n.id === selectedId) || null;
  const gatilhoNode = nodes.find(isGatilhoNode) || null;

  // Catálogo de variáveis do backend (gatilho + campos personalizados).
  const { data: catalogoVars } = (trpc as any).smartflow.catalogoVariaveis.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  // Lista COMPLETA de variáveis do fluxo: variáveis do gatilho atual +
  // campos personalizados (do backend) + variáveis publicadas por cada
  // passo no canvas (categoria "passos"). Provida via Context pra todos os
  // VariableInput/Trigger e pro drawer "Informações".
  const variaveisCompletas: Variavel[] = useMemo(() => {
    const gatilhoAtual = gatilhoNode?.data.gatilho ?? "mensagem_canal";
    const doGatilho: Variavel[] = Array.isArray(catalogoVars)
      ? ((catalogoVars.find((c: any) => c.gatilho === gatilhoAtual)?.variaveis as Variavel[]) ?? [])
      : [];
    const vistos = new Set(doGatilho.map((v) => v.path));
    const dosPassos: Variavel[] = [];
    for (const node of nodes) {
      if (node.type !== "passo") continue;
      const pn = node as PassoNode;
      const pub = variaveisPublicadasPorPasso(pn.data.tipo, pn.data.config);
      for (const v of pub) {
        if (vistos.has(v.path)) continue;
        vistos.add(v.path);
        dosPassos.push({
          path: v.path,
          label: v.label,
          exemplo: "",
          // Campos personalizados persistidos viram categoria própria;
          // resto é "resultado de passo anterior".
          categoria: v.path.startsWith("cliente.campos.") ? "campos_personalizados" : "passos",
        });
      }
    }
    return [...doGatilho, ...dosPassos];
  }, [catalogoVars, gatilhoNode, nodes]);

  // Callbacks canvas. Drag/move/select também passa por `onNodesChange`,
  // mas só os tipos com efeito persistente marcam dirty (skip "select").
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds) as AnyNode[]);
      const algumPersistente = changes.some(
        (c) => c.type !== "select" && c.type !== "dimensions",
      );
      if (algumPersistente) marcarDirty();
    },
    [marcarDirty],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      const algumPersistente = changes.some((c) => c.type !== "select");
      if (algumPersistente) marcarDirty();
    },
    [marcarDirty],
  );
  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...conn,
            // Conexões de passos comuns usam o handle "default" por convenção
            // (mesma chave usada em `proximoSe`). O nó de gatilho, porém, tem
            // um único source handle sem id — passar sourceHandle aqui faria
            // o ReactFlow rejeitar a conexão.
            sourceHandle:
              conn.source === GATILHO_NODE_ID
                ? null
                : conn.sourceHandle ?? "default",
            type: "removivel",
            animated: true,
          },
          eds,
        ),
      );
      marcarDirty();
    },
    [marcarDirty],
  );

  /** Guarda a origem da conexão pra reaproveitar no `onConnectEnd`. */
  const onConnectStart = useCallback<OnConnectStart>((_ev, params) => {
    if (params.nodeId) {
      conexaoPendenteRef.current = {
        nodeId: params.nodeId,
        handleId: params.handleId ?? null,
      };
    } else {
      conexaoPendenteRef.current = null;
    }
  }, []);

  /**
   * Ao soltar uma conexão no **canvas vazio**, abre um menu com a lista de
   * passos. O passo escolhido é criado na posição do mouse e conectado
   * automaticamente ao handle de origem.
   */
  const onConnectEnd = useCallback<OnConnectEnd>((ev) => {
    const source = conexaoPendenteRef.current;
    conexaoPendenteRef.current = null;
    if (!source) return;

    const target = (ev.target as HTMLElement | null) ?? null;
    // `react-flow__pane` é o fundo do canvas; qualquer outro alvo significa
    // que o drop foi em cima de um handle/nó — deixamos o fluxo normal
    // do ReactFlow tratar.
    if (!target || !target.classList?.contains("react-flow__pane")) return;

    const x = "clientX" in ev ? ev.clientX : (ev as TouchEvent).changedTouches?.[0]?.clientX ?? 0;
    const y = "clientY" in ev ? ev.clientY : (ev as TouchEvent).changedTouches?.[0]?.clientY ?? 0;
    setMenuConexao({ x, y, source });
  }, []);

  const adicionarPasso = (tipo: TipoPasso) => {
    const passos = nodes.filter((n) => n.type === "passo");
    const ultimaY = passos.length
      ? Math.max(...passos.map((n) => n.position.y))
      : 120; // abaixo do gatilho
    const novoNode = criarNode(tipo, ultimaY + 120);
    const ultimoId = passos.length > 0
      ? passos[passos.length - 1].id
      : GATILHO_NODE_ID;
    setNodes((nds) => [...nds, novoNode]);
    setEdges((eds) => [
      ...eds,
      {
        id: `e${ultimoId}-${novoNode.id}`,
        source: ultimoId,
        target: novoNode.id,
        // Sempre explícito — evita divergência entre edge criada e edge
        // recarregada do banco (sourceHandle "default" persistido no proximoSe).
        sourceHandle: ultimoId === GATILHO_NODE_ID ? undefined : "default",
        type: "removivel",
        animated: true,
      },
    ]);
    setSelectedId(novoNode.id);
    marcarDirty();
  };

  /**
   * Troca o tipo de gatilho do nó único. Mantém o mesmo nó — só muda os
   * dados. Zera `configGatilho` porque a shape muda entre operações.
   */
  const trocarGatilho = (novoGatilho: GatilhoSmartflow) => {
    setNodes((nds) =>
      nds.map((n) =>
        isGatilhoNode(n)
          ? {
              ...n,
              data: { ...n.data, gatilho: novoGatilho, configGatilho: {}, label: getGatilhoMeta(novoGatilho).label },
            }
          : n,
      ),
    );
    setSelectedId(GATILHO_NODE_ID);
    marcarDirty();
  };

  /**
   * Seleciona uma categoria de gatilho. Se o gatilho atual já pertence à
   * categoria, não faz nada (o usuário troca a operação dentro do painel).
   * Caso contrário, muda pro primeiro gatilho da categoria.
   */
  const trocarCategoria = (grupo: GrupoSmartflow) => {
    if (!gatilhoNode) return;
    const grupoAtual = getGatilhoMeta(gatilhoNode.data.gatilho).grupo;
    if (grupoAtual === grupo) {
      setSelectedId(GATILHO_NODE_ID);
      return;
    }
    const primeira = primeiraOperacaoDaCategoria(grupo);
    if (primeira) trocarGatilho(primeira);
  };

  const removerSelecionado = () => {
    if (!selectedId) return;
    if (selectedId === GATILHO_NODE_ID) {
      toast.error("O gatilho não pode ser removido. Troque o tipo na paleta à esquerda.");
      return;
    }
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
    marcarDirty();
  };

  /**
   * Auto-arranja todos os nós em layout top-down (BFS por nível a partir
   * do gatilho). Ramos do condicional aparecem lado a lado.
   */
  const autoArranjar = () => {
    const layout = calcularAutoLayout(
      nodes.map((n) => ({ id: n.id, position: n.position, type: n.type as string })),
      edges.map((e) => ({ source: e.source, target: e.target })),
      GATILHO_NODE_ID,
    );
    setNodes((nds) =>
      nds.map((n) => {
        const pos = layout.get(n.id);
        return pos ? { ...n, position: pos } : n;
      }),
    );
    marcarDirty();
    // Re-enquadra após o reflow do canvas.
    setTimeout(() => rfInstance?.fitView?.({ padding: 0.15, duration: 400 }), 50);
    toast.success("Nós reorganizados");
  };

  /**
   * Roda `validarGrafo` (mesma função usada no save) sem persistir. Útil
   * pra ver erros antes de tentar salvar — toast lista o problema.
   */
  const validarFluxo = () => {
    const passosList = passoNodesOrdenados(nodes);
    if (passosList.length === 0) {
      toast.warning("Adicione pelo menos um passo pra validar o fluxo.");
      return;
    }
    const proximoSePorNodeId = new Map<string, Record<string, string>>();
    const nodeIdParaCliente = new Map<string, string>();
    for (const n of passosList) nodeIdParaCliente.set(n.id, n.data.clienteId);
    for (const e of edges) {
      if (e.source === GATILHO_NODE_ID) continue;
      const alvoCliente = nodeIdParaCliente.get(e.target);
      if (!alvoCliente) continue;
      const chave = e.sourceHandle || "default";
      const atual = proximoSePorNodeId.get(e.source) ?? {};
      atual[chave] = alvoCliente;
      proximoSePorNodeId.set(e.source, atual);
    }
    const passosParaValidar = passosList.map((n) => ({
      nodeId: n.id,
      clienteId: n.data.clienteId,
      tipo: n.data.tipo,
      config: n.data.config,
      temProximoSe: !!proximoSePorNodeId.get(n.id),
    }));
    const edgesParaValidar = edges.map((e) => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    }));
    const r = validarGrafo(GATILHO_NODE_ID, passosParaValidar, edgesParaValidar);
    if (r.erros.length > 0) {
      toast.error(r.erros.join(" "), { duration: 6000 });
      return;
    }
    if (r.avisos.length > 0) {
      toast.warning(r.avisos.join(" "), { duration: 5000 });
      return;
    }
    toast.success("Fluxo válido — pronto pra salvar.");
  };

  const atualizarConfigSelecionado = (patch: Record<string, unknown>) => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        if (isGatilhoNode(n)) {
          return {
            ...n,
            data: { ...n.data, configGatilho: { ...n.data.configGatilho, ...patch } },
          };
        }
        return { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } };
      }),
    );
    marcarDirty();
  };

  const salvar = () => {
    if (!nome.trim() || nome.trim().length < 2) {
      toast.error("Nome é obrigatório (mínimo 2 caracteres).");
      return;
    }
    if (!gatilhoNode) {
      toast.error("Selecione um gatilho.");
      return;
    }
    const passosList = passoNodesOrdenados(nodes);
    if (passosList.length === 0) {
      toast.error("Adicione pelo menos um passo.");
      return;
    }

    // O alvo do gatilho precisa ser o **primeiro** passo na lista salva
    // (o load reconecta o gatilho → passos[0] automaticamente). Sem isso,
    // a edge gatilho→alvo "muda" ao salvar+recarregar: o load assume Y
    // mínimo como alvo. Encontra o target da edge vinda do gatilho e move
    // pro início.
    const edgeGatilho = edges.find((e) => e.source === GATILHO_NODE_ID);
    let passosOrdenados = passosList;
    if (edgeGatilho) {
      const alvoNode = passosList.find((n) => n.id === edgeGatilho.target);
      if (alvoNode && passosList[0]?.id !== alvoNode.id) {
        passosOrdenados = [alvoNode, ...passosList.filter((n) => n.id !== alvoNode.id)];
      }
    }

    // Mapa nodeId → clienteId, pra traduzir edges em `proximoSe`.
    const nodeIdParaCliente = new Map<string, string>();
    for (const n of passosOrdenados) nodeIdParaCliente.set(n.id, n.data.clienteId);

    // Para cada passo, agrega as edges que saem dele em um objeto
    // `{ sourceHandle: clienteIdAlvo }`. Edges sem sourceHandle usam "default".
    // Edges cujo source é o nó de gatilho ou cujo target é outro passo não
    // rastreado pelo mapa são ignoradas.
    const proximoSePorNodeId = new Map<string, Record<string, string>>();
    for (const e of edges) {
      if (e.source === GATILHO_NODE_ID) continue;
      const alvoCliente = nodeIdParaCliente.get(e.target);
      if (!alvoCliente) continue;
      const chave = e.sourceHandle || "default";
      const atual = proximoSePorNodeId.get(e.source) ?? {};
      atual[chave] = alvoCliente;
      proximoSePorNodeId.set(e.source, atual);
    }

    const passos = passosOrdenados.map((n) => {
      const mapa = proximoSePorNodeId.get(n.id);
      return {
        tipo: n.data.tipo,
        config: n.data.config,
        clienteId: n.data.clienteId,
        proximoSe: mapa && Object.keys(mapa).length > 0 ? mapa : undefined,
      };
    });
    // Validação de grafo antes de persistir — detecta ciclos (bloqueia)
    // e condicional sem saída conectada (bloqueia).
    const passosParaValidar = passosOrdenados.map((n) => ({
      nodeId: n.id,
      clienteId: n.data.clienteId,
      tipo: n.data.tipo,
      config: n.data.config,
      temProximoSe: !!proximoSePorNodeId.get(n.id),
    }));
    const edgesParaValidar = edges.map((e) => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    }));
    const validacao = validarGrafo(GATILHO_NODE_ID, passosParaValidar, edgesParaValidar);
    if (validacao.erros.length > 0) {
      toast.error(validacao.erros.join(" "));
      return;
    }
    for (const aviso of validacao.avisos) {
      toast.warning(aviso);
    }

    const base = {
      nome,
      descricao: descricao || undefined,
      gatilho: gatilhoNode.data.gatilho,
      configGatilho: Object.keys(gatilhoNode.data.configGatilho).length > 0
        ? gatilhoNode.data.configGatilho
        : undefined,
      passos,
    };
    if (editandoId) {
      atualizarMut.mutate({ id: editandoId, ...base });
    } else {
      criarMut.mutate(base);
    }
  };

  if (editandoId && isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const salvando = criarMut.isPending || atualizarMut.isPending;

  return (
    // Anula o padding p-6 do <main> do AppLayout e ocupa toda a viewport
    // (menos o header mobile h-14). Sem altura explícita o ReactFlow
    // colapsa pra 0px e o canvas fica invisível.
    // Provê a lista completa de variáveis pra todos os VariableInput/Trigger
    // do editor (inclui variáveis publicadas pelos passos do fluxo).
    <VariaveisFluxoContext.Provider value={variaveisCompletas}>
    <div className="-m-6 flex flex-col h-[calc(100vh-3.5rem)] md:h-screen bg-background">
      <EditorTopbar
        nome={nome}
        onNomeChange={(n) => { setNome(n); marcarDirty(); }}
        gatilho={gatilhoNode?.data.gatilho ?? "mensagem_canal"}
        nPassos={nodes.filter((n) => n.type === "passo").length}
        dirty={dirty}
        ultimoSalvado={ultimoSalvado}
        ativo={!!cenario?.ativo}
        cenarioId={editandoId}
        salvando={salvando}
        togglePending={toggleAtivoMut.isPending}
        onSalvar={salvar}
        onAtivoChange={(novoAtivo) => {
          if (!editandoId) return;
          toggleAtivoMut.mutate({ id: editandoId, ativo: novoAtivo });
        }}
        onTestar={() => setTestarOpen(true)}
        onExcluir={() => setExcluirOpen(true)}
      />

      {/* Descrição (sub-bar) */}
      <div className="px-4 py-2 border-b bg-muted/30">
        <Input
          value={descricao}
          onChange={(e) => { setDescricao(e.target.value); marcarDirty(); }}
          placeholder="Descrição (opcional) — explique o que o cenário faz"
          className="bg-transparent border-none shadow-none text-sm"
        />
      </div>

      {/* Workspace */}
      <div className="flex flex-1 min-h-0">
        <EditorPaleta
          gatilhoAtual={gatilhoNode?.data.gatilho ?? "mensagem_canal"}
          onTrocarGatilho={trocarGatilho}
          onFocarGatilho={() => setSelectedId(GATILHO_NODE_ID)}
          onAdicionarPasso={adicionarPasso}
        />

        {/* Canvas — fundo sutil em gradiente pra dar hierarquia visual */}
        <div
          className="flex-1 relative"
          style={{
            background:
              "linear-gradient(135deg, rgba(241, 245, 249, 0.4) 0%, rgba(255, 255, 255, 0.6) 50%, rgba(237, 233, 254, 0.2) 100%)",
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_e, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onInit={setRfInstance}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "removivel", animated: true }}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <MiniMap pannable zoomable className="!bg-background !border" />
          </ReactFlow>

          <EditorCanvasToolbar
            onZoomIn={() => rfInstance?.zoomIn?.()}
            onZoomOut={() => rfInstance?.zoomOut?.()}
            onFit={() => rfInstance?.fitView?.({ padding: 0.15, duration: 300 })}
            onAutoArranjar={autoArranjar}
            onValidar={validarFluxo}
          />

          {passoNodesOrdenados(nodes).length === 0 && (
            // Hint discreto no rodapé do canvas — não cobre o nó de gatilho.
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
              <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border bg-background/80 backdrop-blur px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm">
                <Zap className="h-3 w-3 text-muted-foreground/60" />
                Adicione um passo pela paleta à esquerda ou arraste a bolinha do gatilho.
              </div>
            </div>
          )}

          {/* Menu de "conectar a um novo passo" — aparece quando o usuário
              solta a conexão no canvas vazio. */}
          {menuConexao && (
            <MenuConectarPasso
              x={menuConexao.x}
              y={menuConexao.y}
              onFechar={() => setMenuConexao(null)}
              onEscolher={(tipo) => {
                if (!rfInstance) return;
                const flowPos = rfInstance.screenToFlowPosition({ x: menuConexao.x, y: menuConexao.y });
                const novoNode = criarNode(tipo, 0);
                novoNode.position = flowPos;
                setNodes((nds) => [...nds, novoNode]);
                setEdges((eds) => [
                  ...eds,
                  {
                    id: `e-${menuConexao.source.nodeId}-${novoNode.id}`,
                    source: menuConexao.source.nodeId,
                    target: novoNode.id,
                    // Gatilho não tem id no handle — passar null preserva o
                    // comportamento do ReactFlow. Passos comuns usam "default".
                    sourceHandle:
                      menuConexao.source.nodeId === GATILHO_NODE_ID
                        ? null
                        : menuConexao.source.handleId ?? "default",
                    type: "removivel",
                    animated: true,
                  },
                ]);
                setSelectedId(novoNode.id);
                setMenuConexao(null);
                marcarDirty();
              }}
            />
          )}
        </div>

        {/* Painel direito — config do nó selecionado (com abas) */}
        <div className="w-96 border-l bg-background overflow-y-auto flex flex-col">
          {selectedNode ? (
            <Tabs defaultValue="config" className="flex flex-col flex-1">
              <TabsList className="grid grid-cols-2 mx-2 mt-2 h-8 shrink-0">
                <TabsTrigger value="config" className="text-[11px] gap-1">
                  ⚙ Configurar
                </TabsTrigger>
                <TabsTrigger value="info" className="text-[11px] gap-1">
                  📚 Informações
                </TabsTrigger>
              </TabsList>
              <TabsContent value="config" className="flex-1 mt-0 overflow-y-auto">
                <PainelConfig
                  node={selectedNode}
                  onChange={atualizarConfigSelecionado}
                  onRemove={removerSelecionado}
                  onChangeGatilho={trocarGatilho}
                />
              </TabsContent>
              <TabsContent value="info" className="flex-1 mt-0 overflow-y-auto p-0 data-[state=active]:flex data-[state=active]:flex-col">
                <PainelVariaveis variaveis={variaveisCompletas} />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              <p className="font-medium mb-1">Nenhum passo selecionado</p>
              <p className="text-xs">Clique em um nó do canvas para configurá-lo.</p>
            </div>
          )}
        </div>
      </div>

      {/* Dialog de teste — só faz sentido em cenário já salvo. */}
      {editandoId && gatilhoNode && (
        <EditorTestarDialog
          open={testarOpen}
          onOpenChange={setTestarOpen}
          cenarioId={editandoId}
          gatilho={gatilhoNode.data.gatilho}
          dirty={dirty}
        />
      )}

      {/* AlertDialog de exclusão — confirma antes de remover do banco. */}
      <AlertDialog open={excluirOpen} onOpenChange={setExcluirOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este cenário?</AlertDialogTitle>
            <AlertDialogDescription>
              O cenário <strong>{nome || "sem nome"}</strong> será removido
              permanentemente. As execuções históricas continuam no log, mas
              o cenário não vai mais disparar. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletarMut.isPending || !editandoId}
              onClick={(e) => {
                e.preventDefault();
                if (editandoId) deletarMut.mutate({ id: editandoId });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletarMut.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Excluindo...</>
              ) : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </VariaveisFluxoContext.Provider>
  );
}

// ─── Painel de config (gatilho ou passo) ──────────────────────────────────

interface PainelConfigProps {
  node: AnyNode;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
  /** Troca o tipo do gatilho — usado pelo Select de operação no painel. */
  onChangeGatilho?: (gatilho: GatilhoSmartflow) => void;
}

function PainelConfig({ node, onChange, onRemove, onChangeGatilho }: PainelConfigProps) {
  if (isGatilhoNode(node)) {
    const meta = getGatilhoMeta(node.data.gatilho);
    const Icon = GATILHO_ICON[node.data.gatilho] ?? Zap;
    const grupo = meta.grupo;
    const grupoMeta = GRUPO_META.find((g) => g.id === grupo);
    const operacoes = operacoesDaCategoria(grupo);
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40 text-amber-700 dark:text-amber-300">
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {grupoMeta?.label || "Gatilho"}
            </p>
            <p className="text-sm font-semibold truncate">{meta.label}</p>
          </div>
        </div>

        {/* Select de operação — só aparece quando há mais de uma na categoria. */}
        {operacoes.length > 1 && onChangeGatilho && (
          <div>
            <Label className="text-xs">Operação</Label>
            <Select
              value={node.data.gatilho}
              onValueChange={(v) => onChangeGatilho(v as GatilhoSmartflow)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {operacoes.map((op) => {
                  const OpIcon = GATILHO_ICON[op.id] ?? Zap;
                  return (
                    <SelectItem key={op.id} value={op.id}>
                      <span className="inline-flex items-center gap-2">
                        <OpIcon className="h-3.5 w-3.5" />
                        {op.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">{meta.descricao}</p>
          </div>
        )}
        {operacoes.length <= 1 && (
          <p className="text-[10px] text-muted-foreground">{meta.descricao}</p>
        )}

        <ConfigGatilhoFields node={node} onChange={onChange} />

        <p className="text-[10px] text-muted-foreground pt-2 border-t">
          Para trocar a categoria, clique em outra na paleta à esquerda.
        </p>
      </div>
    );
  }

  const meta = getTipoPassoMeta(node.data.tipo);
  const Icon = TIPO_ICON[node.data.tipo] ?? Zap;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded ${meta.cor}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{meta.label}</p>
          <p className="text-[10px] text-muted-foreground truncate">{meta.descricao}</p>
        </div>
      </div>

      <ValidacaoPainel node={node} />

      <ConfigFields node={node} onChange={onChange} />

      <div className="pt-2 border-t">
        <Button variant="destructive" size="sm" onClick={onRemove} className="w-full">
          Remover passo
        </Button>
      </div>
    </div>
  );
}

/**
 * Renderiza os avisos de validação do passo selecionado, consultando o
 * gatilho atual via contexto do ReactFlow. Componente fino — só liga
 * o validador ao painel.
 */
function ValidacaoPainel({ node }: { node: PassoNode }) {
  const { getNodes } = useReactFlow();
  const allNodes = getNodes() as AnyNode[];
  const gatilhoNode = allNodes.find(isGatilhoNode);
  const gatilho = gatilhoNode?.data.gatilho ?? "mensagem_canal";
  const itens = validarPasso(node.data.tipo, gatilho, node.data.config);
  return <ValidacaoPassoPanel itens={itens} />;
}

/**
 * Grupo de inputs pra configurar a janela de disparo dos gatilhos Asaas:
 * horário inicial do dia, quantos disparos/dia, intervalo entre eles, e
 * por quantos dias repete. Todos opcionais — cenários sem `horarioInicial`
 * caem no modo legado do scheduler (1×/dia, dedupe 24h).
 */
function JanelaDisparoFields({
  cfg,
  onChange,
  rotuloDias,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  rotuloDias: string;
}) {
  return (
    <div className="rounded border p-2 space-y-2 bg-muted/10">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Janela de disparo (opcional)
      </p>
      <div>
        <Label className="text-xs">Primeiro horário do dia</Label>
        <Input
          type="time"
          value={String(cfg.horarioInicial || "")}
          onChange={(e) => onChange({ horarioInicial: e.target.value })}
          placeholder="09:00"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Em branco = modo antigo (1×/dia, sem horário fixo).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Disparos/dia</Label>
          <Input
            type="number"
            min={1}
            max={10}
            value={Number(cfg.disparosPorDia ?? 1)}
            onChange={(e) => onChange({ disparosPorDia: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
        <div>
          <Label className="text-xs">Intervalo (min)</Label>
          <Input
            type="number"
            min={15}
            max={720}
            step={15}
            value={Number(cfg.intervaloMinutos ?? 120)}
            onChange={(e) => onChange({ intervaloMinutos: Math.max(15, Number(e.target.value) || 120) })}
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">{rotuloDias}</Label>
        <Input
          type="number"
          min={1}
          max={30}
          value={Number(cfg.repetirPorDias ?? 1)}
          onChange={(e) => onChange({ repetirPorDias: Math.max(1, Number(e.target.value) || 1) })}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Após N dias de lembretes, o cenário para de disparar pra essa cobrança.
        </p>
      </div>
    </div>
  );
}

function ConfigGatilhoFields({
  node,
  onChange,
}: {
  node: GatilhoNode;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const cfg = node.data.configGatilho;

  if (node.data.gatilho === "mensagem_canal") {
    const atuais = new Set<string>(Array.isArray(cfg.canais) ? (cfg.canais as string[]) : []);
    const toggle = (id: TipoCanalMensagem, checked: boolean) => {
      const prox = new Set(atuais);
      if (checked) prox.add(id);
      else prox.delete(id);
      onChange({ canais: Array.from(prox) });
    };
    return (
      <div className="space-y-2">
        <Label className="text-xs">Canais que disparam o fluxo</Label>
        <div className="space-y-1.5">
          {TIPO_CANAL_META.map((c) => {
            const checked = atuais.has(c.id);
            const disabled = !!c.emBreve;
            return (
              <label
                key={c.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs cursor-pointer ${
                  disabled
                    ? "opacity-50 cursor-not-allowed border-dashed"
                    : checked
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(v) => toggle(c.id, v === true)}
                />
                <span className="flex-1">{c.label}</span>
                {c.emBreve && <Badge variant="outline" className="text-[9px] ml-auto">Em breve</Badge>}
              </label>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Sem seleção = dispara em qualquer canal conectado.
        </p>
      </div>
    );
  }

  if (node.data.gatilho === "pagamento_vencido") {
    return (
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Dias mínimos de atraso</Label>
          <Input
            type="number"
            min={0}
            max={365}
            value={Number(cfg.diasAtraso ?? 0)}
            onChange={(e) => onChange({ diasAtraso: Math.max(0, Number(e.target.value) || 0) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            O cenário só dispara se o pagamento estiver atrasado há pelo menos N dias.
          </p>
        </div>
        <JanelaDisparoFields cfg={cfg} onChange={onChange} rotuloDias="Repetir por (dias)" />
      </div>
    );
  }

  if (node.data.gatilho === "pagamento_proximo_vencimento") {
    return (
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Dias antes do vencimento</Label>
          <Input
            type="number"
            min={1}
            max={60}
            value={Number(cfg.diasAntes ?? 3)}
            onChange={(e) => onChange({ diasAntes: Math.max(1, Number(e.target.value) || 1) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Dispara quando a cobrança vence em até N dias.
          </p>
        </div>
        <JanelaDisparoFields cfg={cfg} onChange={onChange} rotuloDias="Lembrar por (dias)" />
      </div>
    );
  }

  if (node.data.gatilho === "agendamento_lembrete") {
    return (
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Dias antes do agendamento</Label>
          <Input
            type="number"
            min={0}
            max={30}
            value={Number(cfg.diasAntes ?? 1)}
            onChange={(e) => onChange({ diasAntes: Math.max(0, Number(e.target.value) || 0) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            <strong>0</strong> = no mesmo dia. <strong>1</strong> = véspera.
          </p>
        </div>
        <div>
          <Label className="text-xs">Horário</Label>
          <Input
            type="time"
            value={String(cfg.horario || "18:00")}
            onChange={(e) => onChange({ horario: e.target.value })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Momento do dia em que o lembrete é enviado (timezone America/Sao_Paulo).
          </p>
        </div>
      </div>
    );
  }

  if (node.data.gatilho === "whatsapp_mensagem") {
    return (
      <p className="text-xs text-muted-foreground">
        Gatilho legado, restrito a WhatsApp QR (Baileys). Prefira o gatilho
        <strong> Mensagem recebida </strong>, que aceita qualquer canal.
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      Este gatilho não tem configurações adicionais.
    </p>
  );
}

function ConfigIaResponderFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const agenteId = typeof cfg.agenteId === "number" ? cfg.agenteId : 0;
  const { data: agentes, isLoading } = (trpc as any).agentesIa.listar.useQuery();

  const agentesAtivos: Array<{ id: number; nome: string; modelo: string; ativo: boolean; temApiKey: boolean }> =
    (agentes || []).filter((a: any) => a.ativo);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Agente de IA</Label>
        <Select
          value={String(agenteId || "__livre__")}
          onValueChange={(v) => onChange({ agenteId: v === "__livre__" ? undefined : Number(v) })}
        >
          <SelectTrigger>
            <SelectValue placeholder={isLoading ? "Carregando…" : "Escolha um agente"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__livre__">
              <span className="text-muted-foreground">— Prompt livre (sem agente) —</span>
            </SelectItem>
            {agentesAtivos.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.nome} <span className="text-muted-foreground ml-2 text-[10px]">{a.modelo}</span>
                {!a.temApiKey && <span className="ml-2 text-[9px] text-destructive">sem API key</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          Usa o prompt, modelo e documentos de treinamento já cadastrados no agente. Crie/edite agentes em
          <strong> Integrações → Agentes de IA</strong>.
        </p>
      </div>

      {!agenteId && (
        <div>
          <Label className="text-xs">Prompt adicional</Label>
          <Textarea
            value={String(cfg.prompt || "")}
            onChange={(e) => onChange({ prompt: e.target.value })}
            placeholder="Ex: Você é um recepcionista de advocacia. Seja educado e objetivo."
            rows={5}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Preenchido apenas se nenhum agente for selecionado acima.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Config do passo `ia_extrair_campos`. Lista de campos a extrair (cada um
 * tem chave + tipo + descrição + obrigatório + persistir). UI:
 *   - Linha por campo, com botão remover.
 *   - Seletor de "tipo" (texto, número, data, email, etc.).
 *   - Checkbox "Persistir no cadastro do cliente" — quando marcado, integra
 *     com camposPersonalizadosCliente (precisa que a chave exista no catálogo).
 *   - Quick-add "Importar do catálogo" que adiciona campos pré-configurados
 *     a partir do catálogo do escritório (`camposPersonalizadosCliente`).
 */
function ConfigIaExtrairCamposFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  interface CampoLocal {
    chave: string;
    tipo: "texto" | "numero" | "boolean" | "data" | "email" | "cpf" | "cnpj" | "telefone" | "lista_texto";
    descricao?: string;
    obrigatorio?: boolean;
    persistir?: boolean;
  }
  const campos: CampoLocal[] = Array.isArray(cfg.campos)
    ? (cfg.campos as CampoLocal[]).map((c) => ({ ...c, tipo: c.tipo || "texto" }))
    : [];

  const { data: camposCatalogo } = (trpc as any).camposCliente.listar.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const opcoesDoCatalogo: Array<{ chave: string; label: string; tipo: string }> = Array.isArray(camposCatalogo)
    ? camposCatalogo.map((c: any) => ({ chave: c.chave, label: c.label || c.chave, tipo: c.tipo || "texto" }))
    : [];

  // Tipos no catálogo (texto/numero/data/textarea/select/boolean) precisam
  // ser normalizados pros tipos da extração. textarea/select → texto.
  const normalizarTipo = (catalogoTipo: string): CampoLocal["tipo"] => {
    if (catalogoTipo === "numero") return "numero";
    if (catalogoTipo === "boolean") return "boolean";
    if (catalogoTipo === "data") return "data";
    return "texto";
  };

  const atualizarCampo = (i: number, patch: Partial<CampoLocal>) => {
    const novo = campos.slice();
    novo[i] = { ...novo[i], ...patch };
    onChange({ campos: novo });
  };
  const removerCampo = (i: number) => {
    onChange({ campos: campos.filter((_, j) => j !== i) });
  };
  const adicionarCampo = (preset?: Partial<CampoLocal>) => {
    const novoCampo: CampoLocal = {
      chave: preset?.chave || "",
      tipo: preset?.tipo || "texto",
      descricao: preset?.descricao || "",
      persistir: preset?.persistir ?? false,
    };
    onChange({ campos: [...campos, novoCampo] });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">De onde vem a mensagem?</Label>
        <Input
          value={String(cfg.fonteMensagem || "mensagem")}
          onChange={(e) => onChange({ fonteMensagem: e.target.value })}
          placeholder="mensagem"
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Caminho no contexto. Default <code>mensagem</code>. Quando vier
          depois de "aguardar resposta", troque pra <code>respostaUsuario</code>.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Campos a extrair</Label>
          <span className="text-[10px] text-muted-foreground">{campos.length} campo(s)</span>
        </div>

        {campos.length === 0 && (
          <p className="text-[10px] text-muted-foreground italic mb-2">
            Adicione pelo menos 1 campo abaixo. A IA vai ler a mensagem e tentar
            preencher cada um — campos que ela não achar ficam vazios.
          </p>
        )}

        <div className="space-y-2">
          {campos.map((c, i) => (
            <div key={i} className="border border-slate-200 dark:border-slate-800 rounded-md p-2 bg-muted/20 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Input
                  value={c.chave}
                  onChange={(e) => atualizarCampo(i, { chave: e.target.value })}
                  placeholder="cpf"
                  className="font-mono text-xs h-7 flex-1"
                />
                <Select
                  value={c.tipo}
                  onValueChange={(v) => atualizarCampo(i, { tipo: v as CampoLocal["tipo"] })}
                >
                  <SelectTrigger className="h-7 text-xs w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="texto">Texto</SelectItem>
                    <SelectItem value="numero">Número</SelectItem>
                    <SelectItem value="boolean">Verdadeiro/Falso</SelectItem>
                    <SelectItem value="data">Data</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="cpf">CPF</SelectItem>
                    <SelectItem value="cnpj">CNPJ</SelectItem>
                    <SelectItem value="telefone">Telefone</SelectItem>
                    <SelectItem value="lista_texto">Lista de textos</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive"
                  onClick={() => removerCampo(i)}
                  title="Remover campo"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <Input
                value={c.descricao || ""}
                onChange={(e) => atualizarCampo(i, { descricao: e.target.value })}
                placeholder="Descrição (opcional) — ajuda a IA a entender o que extrair"
                className="text-[11px] h-7"
              />
              <div className="flex items-center gap-3 flex-wrap text-[10px]">
                <label className="flex items-center gap-1 cursor-pointer">
                  <Checkbox
                    checked={!!c.obrigatorio}
                    onCheckedChange={(v) => atualizarCampo(i, { obrigatorio: !!v })}
                  />
                  Obrigatório
                </label>
                <label className="flex items-center gap-1 cursor-pointer" title="Salva no cadastro do cliente (precisa de contatoId e que a chave exista no catálogo)">
                  <Checkbox
                    checked={!!c.persistir}
                    onCheckedChange={(v) => atualizarCampo(i, { persistir: !!v })}
                  />
                  Salvar no cadastro
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => adicionarCampo()}
            className="h-7 text-xs gap-1"
          >
            <Plus className="h-3 w-3" />
            Adicionar campo
          </Button>
          {opcoesDoCatalogo.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <BookOpen className="h-3 w-3" />
                  Importar do catálogo
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5 px-1">
                  Campos personalizados do escritório
                </p>
                <div className="space-y-0.5 max-h-72 overflow-y-auto">
                  {opcoesDoCatalogo.map((opt) => {
                    const jaAdded = campos.some((c) => c.chave === opt.chave);
                    return (
                      <button
                        key={opt.chave}
                        onClick={() =>
                          adicionarCampo({
                            chave: opt.chave,
                            tipo: normalizarTipo(opt.tipo),
                            descricao: opt.label,
                            persistir: true,
                          })
                        }
                        disabled={jaAdded}
                        className={`w-full text-left text-[11px] px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-900/50 ${
                          jaAdded ? "opacity-40 cursor-not-allowed" : ""
                        }`}
                      >
                        <p className="font-medium">{opt.label}</p>
                        <p className="text-[9px] text-muted-foreground font-mono">{opt.chave} · {opt.tipo}</p>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-2.5 text-[10px] text-blue-900 dark:text-blue-200 leading-snug">
        <strong>Como funciona:</strong> a IA recebe a mensagem e devolve um objeto
        com os campos que conseguiu extrair (campos não mencionados ficam fora —
        sem invenção). Os valores ficam em <code>{`{{extracao.<chave>}}`}</code>.
        Quando "Salvar no cadastro" estiver ✅ e o contexto tiver <code>contatoId</code>,
        também grava em <code>{`{{cliente.campos.<chave>}}`}</code>.
      </div>
    </div>
  );
}

/**
 * Config do passo `crm_buscar_contato` — escolha do campo + valor interpolável.
 * Mostra exemplos de variáveis típicas (`{{telefoneCliente}}`, `{{extracao.cpf}}`)
 * pra ensinar o uso.
 */
function ConfigCrmBuscarContatoFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const tipoBusca = String(cfg.tipoBusca || "telefone");
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (path: string) => {
    const atual = String(cfg.valor || "");
    onChange({ valor: atual + (atual ? " " : "") + `{{${path}}}` });
  };

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs">Buscar por</Label>
        <Select value={tipoBusca} onValueChange={(v) => onChange({ tipoBusca: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="telefone">Telefone</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="cpfCnpj">CPF / CNPJ</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Valor a buscar</Label>
          <VariableTrigger
            inputId="cfg-crm-buscar-valor"
            variaveis={variaveis}
            onInsert={insertNoCfg}
          />
        </div>
        <VariableInput
          id="cfg-crm-buscar-valor"
          value={String(cfg.valor || "")}
          onChange={(v) => onChange({ valor: v })}
          variaveis={variaveis}
          placeholder={
            tipoBusca === "cpfCnpj"
              ? "{{extracao.cpf}}"
              : tipoBusca === "email"
              ? "{{extracao.email}}"
              : "{{telefoneCliente}}"
          }
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Suporta interpolação. Match exato — se o cliente cadastrou com 55 mas
          o gatilho veio sem (ou vice-versa), use <code>ia_extrair_campos</code> antes
          pra normalizar.
        </p>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-2.5 text-[10px] text-blue-900 dark:text-blue-200 leading-snug">
        <strong>Resultado:</strong> se achar, popula <code>contatoId</code>,{" "}
        <code>nomeCliente</code>, <code>telefoneCliente</code>,{" "}
        <code>cliente.campos.*</code>. Use <code>contatoEncontrado</code> num
        passo condicional pra ramificar.
      </div>
    </div>
  );
}

/**
 * Config do passo `crm_listar_acoes_cliente` — filtros opcionais por tipo
 * de processo (litigioso/extrajudicial), polo do cliente e limite.
 */
function ConfigCrmListarAcoesClienteFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs">Filtrar por tipo</Label>
        <Select
          value={String(cfg.tipoFiltro || "todos")}
          onValueChange={(v) => onChange({ tipoFiltro: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="litigioso">Litigiosos (judicial)</SelectItem>
            <SelectItem value="extrajudicial">Extrajudiciais</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Filtrar por polo do cliente</Label>
        <Select
          value={String(cfg.poloFiltro || "todos")}
          onValueChange={(v) => onChange({ poloFiltro: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="ativo">Ativo (autor)</SelectItem>
            <SelectItem value="passivo">Passivo (réu)</SelectItem>
            <SelectItem value="interessado">Interessado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Limite</Label>
        <Input
          type="number"
          min={1}
          max={50}
          value={Number(cfg.limite ?? 10)}
          onChange={(e) => onChange({ limite: Math.max(1, Math.min(50, Number(e.target.value) || 10)) })}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Ações vão pra <code>{`{{acoes}}`}</code> (lista) e{" "}
          <code>{`{{acoesQuantidade}}`}</code>. Use{" "}
          <strong>"Para cada item"</strong> pra iterar.
        </p>
      </div>
    </div>
  );
}

/**
 * Config do passo `processo_buscar_movimentacoes` — interpolação no
 * processoId (default `{{acaoId}}`), multiselect de tipos de evento,
 * janela de dias e limite.
 */
function ConfigProcessoBuscarMovimentacoesFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (path: string) => onChange({ processoId: `{{${path}}}` });
  const tiposAtuais = Array.isArray(cfg.tipos) ? (cfg.tipos as string[]) : [];

  const TIPOS_OPCOES = [
    { id: "movimentacao", label: "Movimentação" },
    { id: "publicacao_dje", label: "Publicação DJE" },
    { id: "sentenca", label: "Sentença" },
    { id: "despacho", label: "Despacho" },
    { id: "audiencia", label: "Audiência" },
    { id: "intimacao", label: "Intimação" },
    { id: "citacao", label: "Citação" },
    { id: "mandado", label: "Mandado" },
    { id: "nova_acao", label: "Nova ação" },
    { id: "outro", label: "Outro" },
  ];

  const toggleTipo = (id: string) => {
    const novo = tiposAtuais.includes(id)
      ? tiposAtuais.filter((t) => t !== id)
      : [...tiposAtuais, id];
    onChange({ tipos: novo });
  };

  return (
    <div className="space-y-2">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Processo a consultar</Label>
          <VariableTrigger
            inputId="cfg-mov-processo"
            variaveis={variaveis}
            onInsert={insertNoCfg}
          />
        </div>
        <VariableInput
          id="cfg-mov-processo"
          value={String(cfg.processoId || "")}
          onChange={(v) => onChange({ processoId: v })}
          variaveis={variaveis}
          placeholder="{{acaoEscolhida.id}} ou número CNJ"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Pode ser ID (cliente_processos.id), CNJ ou variável. Default se vazio:{" "}
          <code>{`{{acaoId}}`}</code> do contexto.
        </p>
      </div>

      <div>
        <Label className="text-xs">Tipos a incluir (vazio = todos)</Label>
        <div className="grid grid-cols-2 gap-1 mt-1 max-h-40 overflow-y-auto border rounded p-1.5 bg-muted/10">
          {TIPOS_OPCOES.map((opt) => (
            <label
              key={opt.id}
              className="flex items-center gap-1.5 text-[11px] cursor-pointer px-1 py-0.5 rounded hover:bg-muted/40"
            >
              <Checkbox
                checked={tiposAtuais.includes(opt.id)}
                onCheckedChange={() => toggleTipo(opt.id)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Janela (dias)</Label>
          <Input
            type="number"
            min={1}
            max={365}
            value={Number(cfg.diasJanela ?? 30)}
            onChange={(e) =>
              onChange({ diasJanela: Math.max(1, Math.min(365, Number(e.target.value) || 30)) })
            }
          />
        </div>
        <div>
          <Label className="text-xs">Limite</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={Number(cfg.limite ?? 10)}
            onChange={(e) =>
              onChange({ limite: Math.max(1, Math.min(50, Number(e.target.value) || 10)) })
            }
          />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Eventos vão pra <code>{`{{movimentacoes}}`}</code>; o mais recente
        fica em <code>{`{{movimentacaoMaisRecente}}`}</code>.
      </p>
    </div>
  );
}

interface RequisitoCondicao {
  campo: string;
  operador: string;
  valor?: string;
  valor2?: string;
}

interface CondicaoItem {
  id: string;
  label?: string;
  /** Requisitos da condição (compostos). Combinados pela `logica`. */
  requisitos?: RequisitoCondicao[];
  /** Como combinar os requisitos: "E" (todos) ou "OU" (qualquer). Default "E". */
  logica?: "E" | "OU";
  // Legado (1 requisito inline) — cenários antigos. Engine e UI normalizam.
  campo?: string;
  operador?: string;
  valor?: string;
  valor2?: string;
}

/** Normaliza uma condição (legada ou nova) numa lista de requisitos pra UI. */
function requisitosDaCondicao(c: CondicaoItem): RequisitoCondicao[] {
  if (Array.isArray(c.requisitos) && c.requisitos.length > 0) return c.requisitos;
  return [{ campo: c.campo || "intencao", operador: c.operador || "igual", valor: c.valor, valor2: c.valor2 }];
}

/**
 * Categoriza um path de variável pra agrupamento no combobox do If/Else.
 * Heurística por prefixo. Sempre retorna uma categoria; default = "Outros".
 */
function categorizarVariavelCondicao(path: string): string {
  if (path.startsWith("cliente.campos.")) return "Personalizados";
  if (path.startsWith("cliente.")) return "Cliente";
  if (path.startsWith("pagamento") || path.startsWith("cobrancas") || path === "valorTotalAberto" || path === "valorTotalVencido" || path === "cobrancasAbertasQtd") return "Pagamento (Asaas)";
  if (path.startsWith("kanban") || path === "kanbanCardId") return "Kanban";
  if (path.startsWith("calcom") || path === "horarioEscolhido" || path === "agendamentoId" || path === "bookingsQuantidade") return "Agendamento (Cal.com)";
  if (["mensagem", "intencao", "respostaIA", "transferir"].includes(path)) return "Mensagem/IA";
  return "Outros";
}

function ConfigCondicionalFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  // Catálogo dinâmico — mesmo do autocomplete `{{...}}`. Inclui campos
  // personalizados do escritório (`cliente.campos.<chave>`).
  const variaveis = useSmartFlowVariaveis();
  // Mantém os 11 paths legados pra cenários antigos que salvaram
  // exatamente esses valores (a maioria já vem no catálogo, mas
  // `transferir`, `bookingsQuantidade` e similares não estão lá).
  const sugestoesAgrupadas = useMemo(() => {
    const map = new Map<string, { path: string; label: string }>();
    for (const v of variaveis) {
      if (!map.has(v.path)) map.set(v.path, { path: v.path, label: v.label || v.path });
    }
    for (const k of CAMPOS_CONDICIONAL) {
      if (!map.has(k)) map.set(k, { path: k, label: k });
    }
    // Agrupa por categoria, preserva ordem alfabética dentro do grupo.
    const grupos = new Map<string, { path: string; label: string }[]>();
    for (const item of map.values()) {
      const cat = categorizarVariavelCondicao(item.path);
      if (!grupos.has(cat)) grupos.set(cat, []);
      grupos.get(cat)!.push(item);
    }
    const ORDEM_GRUPOS = [
      "Cliente", "Personalizados", "Pagamento (Asaas)",
      "Agendamento (Cal.com)", "Kanban", "Mensagem/IA", "Outros",
    ];
    return ORDEM_GRUPOS
      .filter((g) => grupos.has(g))
      .map((g) => ({
        nome: g,
        itens: grupos.get(g)!.sort((a, b) => a.path.localeCompare(b.path)),
      }));
  }, [variaveis]);

  const condicoes: CondicaoItem[] = Array.isArray(cfg.condicoes)
    ? (cfg.condicoes as CondicaoItem[])
    : [];

  const update = (next: CondicaoItem[]) => onChange({ condicoes: next });

  const adicionar = () => {
    const nova: CondicaoItem = {
      id: novoClienteId().slice(0, 8),
      logica: "E",
      requisitos: [{ campo: "intencao", operador: "igual", valor: "" }],
    };
    update([...condicoes, nova]);
  };

  const atualizar = (idx: number, patch: Partial<CondicaoItem>) => {
    const next = condicoes.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    update(next);
  };

  const remover = (idx: number) => {
    update(condicoes.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Condições</Label>
        <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px]" onClick={adicionar}>
          <Plus className="h-3 w-3" /> Adicionar
        </Button>
      </div>

      {condicoes.length === 0 ? (
        <p className="text-[11px] text-muted-foreground border border-dashed rounded p-3">
          Sem condições — clique em <strong>Adicionar</strong>. Cada condição vira uma saída do nó (verde). Quando nenhuma bate, o fluxo segue pela saída <em>fallback</em> (amarela).
        </p>
      ) : (
        <div className="space-y-2">
          {condicoes.map((c, idx) => (
            <div key={c.id} className="rounded border p-2 space-y-1.5 bg-muted/20">
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-semibold text-muted-foreground flex-1">
                  {c.label?.trim() || `Condição ${idx + 1}`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 p-0 text-destructive"
                  onClick={() => remover(idx)}
                  title="Remover condição"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <Input
                value={String(c.label || "")}
                onChange={(e) => atualizar(idx, { label: e.target.value })}
                placeholder={`Nome (ex: "Condição ${idx + 1}", "Cliente VIP"…)`}
                className="h-7 text-xs"
              />
              {(() => {
                const reqs = requisitosDaCondicao(c);
                const logica = c.logica === "OU" ? "OU" : "E";
                const setReqs = (novos: RequisitoCondicao[]) =>
                  atualizar(idx, { requisitos: novos, logica, campo: undefined, operador: undefined, valor: undefined, valor2: undefined });
                const atualizarReq = (ri: number, patch: Partial<RequisitoCondicao>) =>
                  setReqs(reqs.map((r, j) => (j === ri ? { ...r, ...patch } : r)));
                return (
                  <div className="space-y-1.5">
                    {reqs.length > 1 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">Combinar:</span>
                        <div className="flex rounded border overflow-hidden">
                          {(["E", "OU"] as const).map((op) => (
                            <button
                              key={op}
                              type="button"
                              onClick={() => atualizar(idx, { logica: op })}
                              className={`px-2 py-0.5 text-[10px] font-bold ${logica === op ? "bg-violet-600 text-white" : "bg-card text-muted-foreground hover:bg-accent"}`}
                            >
                              {op === "E" ? "E (todos)" : "OU (qualquer)"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {reqs.map((r, ri) => (
                      <div key={ri} className="space-y-1.5">
                        {ri > 0 && <div className="text-[9px] font-bold text-violet-500 text-center">{logica}</div>}
                        <div className="flex items-start gap-1">
                          <div className="flex-1 space-y-1.5">
                            <CampoCondicaoCombobox
                              value={String(r.campo || "")}
                              onChange={(v) => atualizarReq(ri, { campo: v })}
                              grupos={sugestoesAgrupadas}
                            />
                            <Select value={r.operador || "igual"} onValueChange={(v) => atualizarReq(ri, { operador: v })}>
                              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="igual">igual a</SelectItem>
                                <SelectItem value="diferente">diferente de</SelectItem>
                                <SelectItem value="existe">existe (preenchido)</SelectItem>
                                <SelectItem value="nao_existe">não existe (vazio)</SelectItem>
                                <SelectItem value="verdadeiro">é verdadeiro</SelectItem>
                                <SelectItem value="maior">maior que (número)</SelectItem>
                                <SelectItem value="menor">menor que (número)</SelectItem>
                                <SelectItem value="contem">contém (texto)</SelectItem>
                                <SelectItem value="entre">entre (range numérico)</SelectItem>
                              </SelectContent>
                            </Select>
                            {r.operador !== "existe" && r.operador !== "nao_existe" && r.operador !== "verdadeiro" && (
                              <Input
                                value={String(r.valor || "")}
                                onChange={(e) => atualizarReq(ri, { valor: e.target.value })}
                                placeholder={r.operador === "entre" ? "Mínimo" : "Valor"}
                                className="h-7 text-xs"
                              />
                            )}
                            {r.operador === "entre" && (
                              <Input
                                value={String(r.valor2 || "")}
                                onChange={(e) => atualizarReq(ri, { valor2: e.target.value })}
                                placeholder="Máximo"
                                className="h-7 text-xs"
                              />
                            )}
                          </div>
                          {reqs.length > 1 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-6 p-0 text-destructive shrink-0"
                              onClick={() => setReqs(reqs.filter((_, j) => j !== ri))}
                              title="Remover requisito"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 text-[10px] w-full justify-center border border-dashed"
                      onClick={() => setReqs([...reqs, { campo: "intencao", operador: "igual", valor: "" }])}
                    >
                      <Plus className="h-3 w-3" /> Adicionar requisito (E/OU)
                    </Button>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        As condições são avaliadas em ordem. Conecte cada saída do nó ao próximo passo
        (ramo verde = condição X; ramo amarelo = fallback). Sem conexão = fim do fluxo.
        O campo aceita caminhos com ponto (ex: <code>cliente.nome</code>,{" "}
        <code>cliente.campos.oab</code>) — mesmas variáveis do autocomplete <code>{"{{...}}"}</code>.
      </p>
    </div>
  );
}

/**
 * Combobox shadcn/cmdk pra escolher campo no If/Else. Sugestões agrupadas
 * por categoria (Cliente / Personalizados / Pagamento / Kanban / etc) com
 * busca fuzzy. Aceita digitação livre via Enter — escape hatch pra paths
 * que não estão no catálogo.
 */
function CampoCondicaoCombobox({
  value,
  onChange,
  grupos,
}: {
  value: string;
  onChange: (next: string) => void;
  grupos: Array<{ nome: string; itens: Array<{ path: string; label: string }> }>;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full h-7 flex items-center justify-between px-2 text-xs font-mono rounded border bg-card hover:bg-accent text-left"
          title={value || "Escolha um campo"}
        >
          <span className={value ? "truncate" : "text-muted-foreground truncate"}>
            {value || "Campo (ex: intencao, cliente.nome…)"}
          </span>
          <ChevronDown className="h-3 w-3 ml-1 opacity-60 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Buscar ou digitar caminho..."
            value={busca}
            onValueChange={setBusca}
          />
          <CommandList className="max-h-72">
            <CommandEmpty>
              <div className="text-xs px-2 py-1.5">
                Sem sugestões. Pressione Enter pra usar{" "}
                <code className="text-[10px]">{busca}</code>.
              </div>
              {busca.trim() && (
                <button
                  type="button"
                  className="w-full text-left text-xs px-2 py-1.5 hover:bg-accent border-t"
                  onClick={() => {
                    onChange(busca.trim());
                    setBusca("");
                    setOpen(false);
                  }}
                >
                  Usar <code className="text-[10px]">{busca.trim()}</code>
                </button>
              )}
            </CommandEmpty>
            {grupos.map((g) => (
              <CommandGroup key={g.nome} heading={g.nome}>
                {g.itens.map((item) => (
                  <CommandItem
                    key={item.path}
                    value={`${item.path} ${item.label}`}
                    onSelect={() => {
                      onChange(item.path);
                      setBusca("");
                      setOpen(false);
                    }}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="font-mono text-[11px] truncate">{item.path}</span>
                      {item.label !== item.path && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          {item.label}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Campos do nó "Enviar mensagem WhatsApp" — texto livre com autocomplete
 * de variáveis. Compat com formato legado `{nome}` e `{intencao}` (engine
 * resolve via aliases em interpolar.ts).
 */
function ConfigWhatsappEnviarFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (path: string) => {
    const atual = String(cfg.template || "");
    onChange({ template: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label className="text-xs">Template da mensagem</Label>
        <VariableTrigger
          inputId="cfg-whatsapp-template"
          variaveis={variaveis}
          onInsert={insertNoCfg}
        />
      </div>
      <VariableInput
        id="cfg-whatsapp-template"
        as="textarea"
        rows={4}
        highlight
        preview
        value={String(cfg.template || "")}
        onChange={(v) => onChange({ template: v })}
        variaveis={variaveis}
        placeholder="Olá {{nomeCliente}}, vi sua mensagem sobre {{intencao}}."
      />
      <p className="text-[10px] text-muted-foreground mt-1">
        Use <code>{"{{"}</code> pra inserir variável dinâmica. Aliases legado
        (<code>{"{nome}"}</code>, <code>{"{intencao}"}</code>, <code>{"{horario}"}</code>) continuam funcionando.
      </p>
    </div>
  );
}

/**
 * Config do passo `transferir`. Pausa o bot (marca a conversa como
 * "em_atendimento") e, opcionalmente, envia uma mensagem de despedida antes
 * de pausar. Campo vazio = pausa em silêncio.
 */
function ConfigTransferirFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  // Diferencia "ainda não configurado" (undefined → usa texto padrão no motor)
  // de "configurado vazio" (string vazia → silêncio).
  const definido = typeof cfg.mensagem === "string";
  const insertNoCfg = (path: string) => {
    const atual = String(cfg.mensagem || "");
    onChange({ mensagem: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  return (
    <div className="space-y-2">
      <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2">
        <p className="text-[11px] text-amber-800 dark:text-amber-300">
          Ao chegar aqui, o fluxo <strong>encerra</strong> e o bot <strong>para de responder</strong> essa
          conversa (fica "em atendimento"). Um atendente assume pela tela de Atendimento.
        </p>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Mensagem de despedida (opcional)</Label>
          <VariableTrigger
            inputId="cfg-transferir-mensagem"
            variaveis={variaveis}
            onInsert={insertNoCfg}
          />
        </div>
        <VariableInput
          id="cfg-transferir-mensagem"
          as="textarea"
          rows={3}
          highlight
          preview
          value={String(cfg.mensagem ?? "")}
          onChange={(v) => onChange({ mensagem: v })}
          variaveis={variaveis}
          placeholder="Vou transferir você para um de nossos advogados. Um momento, por favor."
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {definido
            ? "Deixe em branco para pausar o bot sem enviar nenhuma mensagem."
            : "Sem preencher, enviamos uma mensagem padrão de transferência. Edite para personalizar — ou apague tudo para pausar em silêncio."}
        </p>
      </div>
    </div>
  );
}

/**
 * Config do passo `whatsapp_aguardar_resposta`. Envia mensagem + lista
 * opcional de opções (vira menu numerado) + timeout. O fluxo pausa até
 * o cliente responder; quando há opções, a resposta é parseada pra
 * `opcaoEscolhida`.
 */
function ConfigWhatsappAguardarRespostaFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  const opcoes: string[] = Array.isArray(cfg.opcoes) ? (cfg.opcoes as string[]) : [];
  const insertNoCfg = (path: string) => {
    const atual = String(cfg.template || "");
    onChange({ template: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  const atualizarOpcao = (i: number, valor: string) => {
    const novo = opcoes.slice();
    novo[i] = valor;
    onChange({ opcoes: novo });
  };
  const removerOpcao = (i: number) => {
    onChange({ opcoes: opcoes.filter((_, j) => j !== i) });
  };
  const adicionarOpcao = () => {
    onChange({ opcoes: [...opcoes, ""] });
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Mensagem (pergunta ao cliente)</Label>
          <VariableTrigger
            inputId="cfg-aguardar-template"
            variaveis={variaveis}
            onInsert={insertNoCfg}
          />
        </div>
        <VariableInput
          id="cfg-aguardar-template"
          as="textarea"
          rows={3}
          highlight
          preview
          value={String(cfg.template || "")}
          onChange={(v) => onChange({ template: v })}
          variaveis={variaveis}
          placeholder="Sobre qual das suas ações você quer saber?"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          O menu de opções (se preenchido) é anexado automaticamente abaixo da mensagem.
        </p>
      </div>

      <div>
        <Label className="text-xs">
          Opções (vira menu numerado — vazio = pergunta aberta)
        </Label>
        <div className="space-y-1.5 mt-1">
          {opcoes.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-muted-foreground w-4">{i + 1}.</span>
              <Input
                value={o}
                onChange={(e) => atualizarOpcao(i, e.target.value)}
                placeholder="Texto da opção"
                className="text-xs h-7"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive"
                onClick={() => removerOpcao(i)}
                title="Remover opção"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={adicionarOpcao}
            className="h-7 text-xs gap-1 w-full"
          >
            <Plus className="h-3 w-3" />
            Adicionar opção
          </Button>
        </div>
        {opcoes.length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Resposta do cliente vai pra <code>{`{{respostaUsuario}}`}</code>.
            Quando bate com uma opção, <code>{`{{opcaoEscolhida}}`}</code> é populado{" "}
            (<code>indice</code>, <code>texto</code>, <code>numero</code>).
          </p>
        )}
      </div>

      <div>
        <Label className="text-xs">Timeout (minutos)</Label>
        <Input
          type="number"
          min={1}
          max={7 * 24 * 60}
          value={Number(cfg.timeoutMinutos ?? 1440)}
          onChange={(e) =>
            onChange({
              timeoutMinutos: Math.max(1, Math.min(7 * 24 * 60, Number(e.target.value) || 1440)),
            })
          }
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Quanto esperar antes de desistir. Default 1440 (24h). Quando expira,
          o fluxo continua pelo ramo <code>timeout</code> do <code>proximoSe</code>{" "}
          (se configurado) ou termina.
        </p>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-2.5 text-[10px] text-amber-900 dark:text-amber-200 leading-snug">
        <strong>Limitação:</strong> só 1 execução por (cenário + contato) pode
        aguardar ao mesmo tempo. Mensagens novas do cliente retomam essa
        execução pendente — pra começar fluxo do zero, espere o timeout
        ou pause/exclua o cenário.
      </div>
    </div>
  );
}

/**
 * Config do passo `para_cada_item` — loop sobre lista do contexto.
 *  - caminhoLista: ex "acoes", "movimentacoes", "cliente.processos"
 *  - nomeVarItem: nome da variável dentro da iteração (default "item")
 *  - limite: máximo de iterações (default 20, max 200)
 *
 * No canvas, o nó tem 2 saídas: "corpo" (subfluxo da iteração) e "depois"
 * (continuação). O editor visual cuida das edges; aqui só a config.
 */
function ConfigParaCadaItemFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs">Caminho da lista no contexto</Label>
        <Input
          value={String(cfg.caminhoLista || "")}
          onChange={(e) => onChange({ caminhoLista: e.target.value })}
          placeholder="acoes"
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Ex: <code>acoes</code> (do passo "Listar ações"), <code>movimentacoes</code>{" "}
          (de "Buscar movimentações") ou <code>cliente.processos</code> (dot-notation).
          Lista ausente = zero iterações sem erro.
        </p>
      </div>

      <div>
        <Label className="text-xs">Nome da variável do item</Label>
        <Input
          value={String(cfg.nomeVarItem || "")}
          onChange={(e) => onChange({ nomeVarItem: e.target.value })}
          placeholder="item"
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Default <code>item</code>. Dentro do corpo do loop você acessa via{" "}
          <code>{`{{item.id}}`}</code>, <code>{`{{item.apelido}}`}</code>, etc.
          Trocar é útil em loops aninhados.
        </p>
      </div>

      <div>
        <Label className="text-xs">Limite de iterações</Label>
        <Input
          type="number"
          min={1}
          max={200}
          value={Number(cfg.limite ?? 20)}
          onChange={(e) =>
            onChange({ limite: Math.max(1, Math.min(200, Number(e.target.value) || 20)) })
          }
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Default 20. Lista maior é truncada — protege contra loops infinitos.
        </p>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-2.5 text-[10px] text-amber-900 dark:text-amber-200 leading-snug">
        <strong>Como conectar no canvas:</strong> arraste a saída <strong>"corpo"</strong>{" "}
        pro primeiro passo da iteração. O último passo do corpo deve conectar
        de volta neste loop (ou simplesmente terminar). A saída{" "}
        <strong>"depois"</strong> continua quando o loop terminar.
      </div>
    </div>
  );
}

function ConfigKanbanCriarCardFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  // Variáveis disponíveis pro autocomplete `{{...}}`. Lista achatada
  // (todos os gatilhos) — usuário escolhe a que faz sentido pro fluxo.
  // Refinamento por gatilho do cenário fica como melhoria futura.
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (campo: string) => (path: string) => {
    const atual = String(cfg[campo] || "");
    onChange({ [campo]: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  const { data: funis } = (trpc as any).kanban.listarFunis.useQuery();
  const funilId = cfg.funilId ? Number(cfg.funilId) : undefined;
  const { data: funilData } = (trpc as any).kanban.obterFunil.useQuery(
    { funilId: funilId! },
    { enabled: !!funilId },
  );
  const { data: equipeData } = (trpc as any).configuracoes.listarColaboradores.useQuery();
  const colaboradoresAtivos = (
    equipeData && "colaboradores" in equipeData ? equipeData.colaboradores : []
  ).filter((c: any) => c.ativo);
  const colunas = funilData?.colunas || [];

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs">Quadro</Label>
        <Select
          value={cfg.funilId ? String(cfg.funilId) : "_padrao"}
          onValueChange={(v) =>
            onChange({
              funilId: v === "_padrao" ? null : Number(v),
              colunaId: null,
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_padrao">Primeiro quadro disponível</SelectItem>
            {(funis || []).map((f: any) => (
              <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Coluna inicial</Label>
        <Select
          value={cfg.colunaId ? String(cfg.colunaId) : "_primeira"}
          onValueChange={(v) =>
            onChange({ colunaId: v === "_primeira" ? null : Number(v) })
          }
          disabled={!funilId}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_primeira">Primeira coluna do quadro</SelectItem>
            {colunas.map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!funilId && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Escolha um quadro pra liberar as colunas.
          </p>
        )}
      </div>

      {/* Aviso sobre o vínculo automático com ação (multi-ação) */}
      <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
        <b>📎 Vínculo automático com ação</b>: quando o gatilho é{" "}
        <code className="rounded bg-blue-100 px-1 dark:bg-blue-900/50">pagamento_recebido</code>{" "}
        e a cobrança está vinculada a 1+ ações, o passo dispara uma vez por
        ação e cria <b>1 card por (cliente, ação)</b>. Próximas parcelas
        pagas não duplicam — a idempotência detecta o card existente.
        Use {"{{acaoApelido}}"} no título pra cada card mostrar sua ação.
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Título</Label>
          <VariableTrigger
            inputId="cfg-titulo"
            variaveis={variaveis}
            onInsert={insertNoCfg("titulo")}
          />
        </div>
        <VariableInput
          id="cfg-titulo"
          value={String(cfg.titulo || "")}
          onChange={(v) => onChange({ titulo: v })}
          variaveis={variaveis}
          placeholder="Deixe vazio pra usar dados do contexto. Use {{ pra inserir variável."
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Descrição</Label>
          <VariableTrigger
            inputId="cfg-descricao"
            variaveis={variaveis}
            onInsert={insertNoCfg("descricao")}
          />
        </div>
        <VariableInput
          id="cfg-descricao"
          as="textarea"
          rows={2}
          highlight
          value={String(cfg.descricao || "")}
          onChange={(v) => onChange({ descricao: v })}
          variaveis={variaveis}
          placeholder="Detalhes do card (opcional). Use {{ pra inserir variável."
        />
      </div>

      <div>
        <Label className="text-xs">Responsável</Label>
        <Select
          value={
            cfg.responsavelId
              ? String(cfg.responsavelId)
              : cfg.responsavelAuto === false
                ? "_nenhum"
                : "_auto"
          }
          onValueChange={(v) => {
            if (v === "_auto") onChange({ responsavelId: null, responsavelAuto: true });
            else if (v === "_nenhum") onChange({ responsavelId: null, responsavelAuto: false });
            else onChange({ responsavelId: Number(v), responsavelAuto: false });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_auto">Atendente do cliente (auto)</SelectItem>
            <SelectItem value="_nenhum">Sem responsável</SelectItem>
            {colaboradoresAtivos.map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.userName ?? "—"} ({c.cargo})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          <strong>Auto</strong> usa o atendente cadastrado no cliente. Se o cliente
          não tem atendente, fica vazio. Recebe notificação quando o card é criado
          pela automação.
        </p>
      </div>

      <div>
        <Label className="text-xs">Número CNJ (opcional)</Label>
        <Input
          value={String(cfg.cnj || "")}
          onChange={(e) => onChange({ cnj: e.target.value })}
          placeholder="0000000-00.0000.0.00.0000"
          className="font-mono"
        />
      </div>

      <div>
        <Label className="text-xs">Prazo em dias (opcional)</Label>
        <Input
          type="number"
          min={1}
          value={cfg.prazoDias != null ? String(cfg.prazoDias) : ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange({ prazoDias: v ? Number(v) : null });
          }}
          placeholder="Vazio = usa o prazo padrão do quadro"
        />
      </div>

      <div>
        <Label className="text-xs">Tags</Label>
        <TagsChipPicker
          value={String(cfg.tags || "")}
          onChange={(v) => onChange({ tags: v })}
          placeholder="Buscar ou criar tag..."
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Tags são salvas no cliente vinculado (single-source) — editar aqui altera o cadastro do cliente.
          Crie tags novas que ficam disponíveis no Kanban e clientes.
        </p>
      </div>

      <div>
        <Label className="text-xs">Prioridade</Label>
        <Select value={String(cfg.prioridade || "media")} onValueChange={(v) => onChange({ prioridade: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="media">Média</SelectItem>
            <SelectItem value="baixa">Baixa</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * Input padronizado pra `cardId` dos passos de manipulação de card.
 * Default visual: `{{kanbanCardId}}` (preenchido por um passo `kanban_criar_card`
 * anterior). Usuário pode sobrescrever com outra variável ou ID literal.
 */
function CardIdField({
  cfg,
  onChange,
  inputId,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  inputId: string;
}) {
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (path: string) => {
    const atual = String(cfg.cardId || "");
    onChange({ cardId: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label className="text-xs">ID do card</Label>
        <VariableTrigger inputId={inputId} variaveis={variaveis} onInsert={insertNoCfg} />
      </div>
      <VariableInput
        id={inputId}
        value={String(cfg.cardId || "")}
        onChange={(v) => onChange({ cardId: v })}
        variaveis={variaveis}
        placeholder="{{kanbanCardId}} (default — card criado num passo anterior)"
      />
      <p className="text-[10px] text-muted-foreground mt-1">
        Vazio = usa <code>{"{{kanbanCardId}}"}</code> do contexto, preenchido por
        "Criar card Kanban" anterior.
      </p>
    </div>
  );
}

function ConfigKanbanMoverCardFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { data: funis } = (trpc as any).kanban.listarFunis.useQuery();
  const [funilSelecionado, setFunilSelecionado] = useState<number | undefined>(undefined);
  const { data: funilData } = (trpc as any).kanban.obterFunil.useQuery(
    { funilId: funilSelecionado! },
    { enabled: !!funilSelecionado },
  );
  const colunas = funilData?.colunas || [];

  return (
    <div className="space-y-2">
      <CardIdField cfg={cfg} onChange={onChange} inputId="cfg-kmover-cardid" />

      <div>
        <Label className="text-xs">Quadro</Label>
        <Select
          value={funilSelecionado ? String(funilSelecionado) : ""}
          onValueChange={(v) => {
            setFunilSelecionado(Number(v));
            onChange({ colunaDestinoId: null });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Escolha o quadro..." />
          </SelectTrigger>
          <SelectContent>
            {(funis || []).map((f: any) => (
              <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Coluna destino</Label>
        <Select
          value={cfg.colunaDestinoId ? String(cfg.colunaDestinoId) : ""}
          onValueChange={(v) => onChange({ colunaDestinoId: Number(v) })}
          disabled={!funilSelecionado}
        >
          <SelectTrigger>
            <SelectValue placeholder="Escolha a coluna..." />
          </SelectTrigger>
          <SelectContent>
            {colunas.map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!funilSelecionado && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Escolha um quadro pra liberar as colunas.
          </p>
        )}
      </div>
    </div>
  );
}

function ConfigKanbanAtribuirResponsavelFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { data: equipeData } = (trpc as any).configuracoes.listarColaboradores.useQuery();
  const colaboradoresAtivos = (
    equipeData && "colaboradores" in equipeData ? equipeData.colaboradores : []
  ).filter((c: any) => c.ativo);

  return (
    <div className="space-y-2">
      <CardIdField cfg={cfg} onChange={onChange} inputId="cfg-katribuir-cardid" />

      <div>
        <Label className="text-xs">Responsável</Label>
        <Select
          value={
            cfg.responsavelId
              ? String(cfg.responsavelId)
              : cfg.responsavelAuto === false
                ? "_nenhum"
                : "_auto"
          }
          onValueChange={(v) => {
            if (v === "_auto") onChange({ responsavelId: null, responsavelAuto: true });
            else if (v === "_nenhum") onChange({ responsavelId: null, responsavelAuto: false });
            else onChange({ responsavelId: Number(v), responsavelAuto: false });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_auto">Atendente do cliente (auto)</SelectItem>
            <SelectItem value="_nenhum">Não alterar</SelectItem>
            {colaboradoresAtivos.map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.userName ?? "—"} ({c.cargo})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          <strong>Auto</strong> usa o atendente cadastrado no cliente vinculado ao card.
          Recebe notificação de "atribuído".
        </p>
      </div>
    </div>
  );
}

function ConfigAgendaCriarFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  const { data: equipeData } = (trpc as any).configuracoes.listarColaboradores.useQuery();
  const colaboradoresAtivos = (
    equipeData && "colaboradores" in equipeData ? equipeData.colaboradores : []
  ).filter((c: any) => c.ativo);
  const insertTitulo = (path: string) => {
    const atual = String(cfg.titulo || "");
    onChange({ titulo: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  const insertDescricao = (path: string) => {
    const atual = String(cfg.descricao || "");
    onChange({ descricao: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  const respValor = cfg.responsavelVar
    ? "_var"
    : cfg.responsavelAuto
      ? "_auto"
      : cfg.responsavelId
        ? String(cfg.responsavelId)
        : "";
  const acao = (cfg.acao as string) || "agendar";

  const responsavelField = (label: string, hint: string) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select
        value={respValor}
        onValueChange={(v) => {
          if (v === "_auto") onChange({ responsavelAuto: true, responsavelId: null, responsavelVar: "" });
          else if (v === "_var") onChange({ responsavelAuto: false, responsavelId: null, responsavelVar: cfg.responsavelVar || "{{atendenteResponsavelId}}" });
          else onChange({ responsavelId: Number(v), responsavelAuto: false, responsavelVar: "" });
        }}
      >
        <SelectTrigger><SelectValue placeholder="Escolha o responsável" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_auto">Atendente do cliente (automático)</SelectItem>
          <SelectItem value="_var">Variável / expressão…</SelectItem>
          {colaboradoresAtivos.map((c: any) => (
            <SelectItem key={c.id} value={String(c.id)}>{c.userName ?? "—"} ({c.cargo})</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {respValor === "_var" ? (
        <Input
          className="mt-1 font-mono text-xs"
          value={String(cfg.responsavelVar ?? "")}
          onChange={(e) => onChange({ responsavelVar: e.target.value })}
          placeholder="{{atendenteResponsavelId}}"
        />
      ) : null}
      <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>
    </div>
  );

  const dataField = (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Data/hora</Label>
          <VariableInput
            id="cfg-agenda-data"
            highlight
            value={String(cfg.dataInicio ?? "")}
            onChange={(v) => onChange({ dataInicio: v })}
            variaveis={variaveis}
            placeholder="vazio = agora"
          />
        </div>
        <div>
          <Label className="text-xs">Duração (min)</Label>
          <Input
            type="number"
            min={15}
            value={Number(cfg.duracaoMinutos) || 60}
            onChange={(e) => onChange({ duracaoMinutos: Number(e.target.value) || 60 })}
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-1">
        Pode usar uma variável capturada (ex: <code>{"{{data_agendamento}}"}</code>).
      </p>
    </>
  );

  const tituloField = (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label className="text-xs">Título</Label>
        <VariableTrigger inputId="cfg-agenda-titulo" variaveis={variaveis} onInsert={insertTitulo} />
      </div>
      <VariableInput
        id="cfg-agenda-titulo"
        highlight
        value={String(cfg.titulo ?? "")}
        onChange={(v) => onChange({ titulo: v })}
        variaveis={variaveis}
        placeholder="Consulta inicial — {{nomeCliente}}"
      />
    </div>
  );

  const descricaoField = (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label className="text-xs">Descrição do caso (opcional)</Label>
        <VariableTrigger inputId="cfg-agenda-descricao" variaveis={variaveis} onInsert={insertDescricao} />
      </div>
      <VariableInput
        id="cfg-agenda-descricao"
        as="textarea"
        rows={3}
        highlight
        value={String(cfg.descricao ?? "")}
        onChange={(v) => onChange({ descricao: v })}
        variaveis={variaveis}
        placeholder="Resumo do caso pro advogado já chegar situado. Ex: Financiamento de R$ {{valor_financiado}}, {{parcelas_atrasadas}} parcelas em atraso."
      />
    </div>
  );

  const agendamentoIdField = (
    <div>
      <Label className="text-xs">Qual agendamento?</Label>
      <Input
        className="font-mono text-xs"
        value={String(cfg.agendamentoIdVar ?? "")}
        onChange={(e) => onChange({ agendamentoIdVar: e.target.value })}
        placeholder="{{agendamentoInternoId}}"
      />
      <p className="text-[10px] text-muted-foreground mt-1">
        ID do compromisso. Vazio usa <code>{"{{agendamentoInternoId}}"}</code> (criado por um passo "Agendar" anterior).
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">O que fazer</Label>
        <Select value={acao} onValueChange={(v) => onChange({ acao: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="agendar">Agendar (criar compromisso)</SelectItem>
            <SelectItem value="verificar_horario">Verificar horário disponível</SelectItem>
            <SelectItem value="consultar">Consultar agenda (horários livres)</SelectItem>
            <SelectItem value="editar">Editar / remarcar</SelectItem>
            <SelectItem value="cancelar">Cancelar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {acao === "agendar" && (
        <>
          <div className="rounded-md bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900 p-2">
            <p className="text-[11px] text-orange-800 dark:text-orange-300">
              Cria o compromisso na <strong>Agenda do escritório</strong>, vinculado ao cliente. Nasce <strong>"pendente"</strong> pra equipe confirmar.
            </p>
          </div>
          {responsavelField("Responsável (advogado)", 'Atendente do cliente = quem pegou o lead. Ou um advogado fixo, ou uma variável.')}
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={(cfg.tipo as string) || "reuniao_comercial"} onValueChange={(v) => onChange({ tipo: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reuniao_comercial">Reunião comercial</SelectItem>
                <SelectItem value="follow_up">Follow-up</SelectItem>
                <SelectItem value="tarefa">Tarefa</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {tituloField}
          {dataField}
          <label className="flex items-start gap-2 cursor-pointer rounded-md border p-2 bg-muted/20">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={!!cfg.verificarDisponibilidade}
              onChange={(e) => onChange({ verificarDisponibilidade: e.target.checked })}
            />
            <span className="text-[11px] leading-snug">
              <strong>Verificar disponibilidade</strong> antes de marcar. Em conflito, não cria e marca <code>agendaDisponivel = false</code>.
              <span className="text-muted-foreground"> (só com horário específico.)</span>
            </span>
          </label>
          {descricaoField}
        </>
      )}

      {acao === "verificar_horario" && (
        <>
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-2">
            <p className="text-[11px] text-blue-800 dark:text-blue-300">
              Só <strong>verifica</strong> se o responsável tem o horário livre — não cria nada. Saída: <code>agendaDisponivel</code> (use numa Decisão).
            </p>
          </div>
          {responsavelField("Responsável (advogado)", "De quem checar a agenda.")}
          {dataField}
        </>
      )}

      {acao === "consultar" && (
        <>
          <div className="rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900 p-2">
            <p className="text-[11px] text-violet-800 dark:text-violet-300">
              Calcula os <strong>horários LIVRES</strong> do responsável (datas em <strong>ISO 8601</strong>, fuso de Brasília) e salva num campo. Use esse campo no prompt de um passo <strong>"Responder com IA"</strong> pra ela oferecer os horários ao cliente.
            </p>
          </div>
          {responsavelField("Responsável (advogado)", "De quem calcular os horários livres.")}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Dias pra frente</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={Number(cfg.diasParaFrente) || 7}
                onChange={(e) => onChange({ diasParaFrente: Number(e.target.value) || 7 })}
              />
            </div>
            <div>
              <Label className="text-xs">Duração da reunião</Label>
              <Select
                value={String(Number(cfg.duracaoSlotMinutos) || 30)}
                onValueChange={(v) => onChange({ duracaoSlotMinutos: Number(v) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutos</SelectItem>
                  <SelectItem value="30">30 minutos</SelectItem>
                  <SelectItem value="60">1 hora</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Hora início (comercial)</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={Number.isFinite(Number(cfg.horaInicio)) ? Number(cfg.horaInicio) : 9}
                onChange={(e) => onChange({ horaInicio: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label className="text-xs">Hora fim (comercial)</Label>
              <Input
                type="number"
                min={1}
                max={24}
                value={Number.isFinite(Number(cfg.horaFim)) ? Number(cfg.horaFim) : 18}
                onChange={(e) => onChange({ horaFim: Number(e.target.value) })}
              />
            </div>
          </div>
          <label className="flex items-start gap-2 cursor-pointer rounded-md border p-2 bg-muted/20">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={!!cfg.incluirFimDeSemana}
              onChange={(e) => onChange({ incluirFimDeSemana: e.target.checked })}
            />
            <span className="text-[11px] leading-snug">
              <strong>Incluir fim de semana</strong> (sábado e domingo). Desmarcado = só dias úteis.
            </span>
          </label>
          <div>
            <Label className="text-xs">Salvar em</Label>
            <Input
              className="font-mono text-xs"
              value={String(cfg.salvarEm ?? "")}
              onChange={(e) => onChange({ salvarEm: e.target.value })}
              placeholder="horariosLivres"
            />
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1">
            Depois use <code>{`{{${String(cfg.salvarEm || "horariosLivres")}}}`}</code> no prompt da IA.
          </p>
        </>
      )}

      {acao === "editar" && (
        <>
          {agendamentoIdField}
          {responsavelField("Novo responsável (opcional)", "Deixe sem escolher pra não trocar o responsável.")}
          {dataField}
          {tituloField}
          {descricaoField}
        </>
      )}

      {acao === "cancelar" && (
        <>
          {agendamentoIdField}
          <p className="text-[11px] text-muted-foreground">Marca o compromisso como <strong>cancelado</strong> na agenda.</p>
        </>
      )}
    </div>
  );
}

function ConfigKanbanTagsFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (path: string) => {
    const atual = String(cfg.tags || "");
    onChange({ tags: atual + (atual ? ", " : "") + `{{${path}}}` });
  };
  const modo = (cfg.modo as string) || "adicionar";

  return (
    <div className="space-y-2">
      <CardIdField cfg={cfg} onChange={onChange} inputId="cfg-ktags-cardid" />

      <div>
        <Label className="text-xs">Modo</Label>
        <Select value={modo} onValueChange={(v) => onChange({ modo: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="adicionar">Adicionar (mantém as existentes)</SelectItem>
            <SelectItem value="remover">Remover</SelectItem>
            <SelectItem value="definir">Definir (substitui todas)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Tags (separe por vírgula)</Label>
          <VariableTrigger
            inputId="cfg-ktags-tags"
            variaveis={variaveis}
            onInsert={insertNoCfg}
          />
        </div>
        <VariableInput
          id="cfg-ktags-tags"
          value={String(cfg.tags || "")}
          onChange={(v) => onChange({ tags: v })}
          variaveis={variaveis}
          placeholder="VIP, urgente, {{intencao}}"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {modo === "definir"
            ? "Substitui todas as tags. Vazio remove todas."
            : modo === "remover"
              ? "Remove as tags listadas (case-insensitive)."
              : "Adiciona à lista atual sem duplicar."}
        </p>
      </div>
    </div>
  );
}

/**
 * Config do passo "Definir variável" — guarda valor no contexto
 * pra usar em passos seguintes via {{chave}}. O valor suporta
 * interpolação de outras variáveis (ex: valor="{{pagamentoValor}}").
 */
function ConfigDefinirVariavelFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (campo: string) => (path: string) => {
    const atual = String(cfg[campo] || "");
    onChange({ [campo]: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  const chave = String(cfg.chave || "");
  const chaveValida = chave === "" || /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(chave);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Nome da variável</Label>
        <Input
          value={chave}
          onChange={(e) => onChange({ chave: e.target.value })}
          placeholder="valorComJuros"
          maxLength={64}
          className={chaveValida ? "font-mono text-xs" : "border-destructive font-mono text-xs"}
        />
        <p className={`text-[10px] mt-1 ${chaveValida ? "text-muted-foreground" : "text-destructive"}`}>
          {!chaveValida
            ? "Use letras, números, _ e . (pra aninhar). Deve começar com letra ou _"
            : chave
              ? `Em passos seguintes, use {{${chave}}} pra ler o valor.`
              : "Letras, números, _ e . (pra aninhar). Ex: valorComJuros, cliente.observado"}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Valor</Label>
          <VariableTrigger
            inputId="cfg-defvar-valor"
            variaveis={variaveis}
            onInsert={insertNoCfg("valor")}
          />
        </div>
        <VariableInput
          id="cfg-defvar-valor"
          value={String(cfg.valor || "")}
          onChange={(v) => onChange({ valor: v })}
          variaveis={variaveis}
          placeholder="Ex: confirmado, ou {{pagamentoValor}}"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Pode ser texto fixo ou referenciar outras variáveis com{" "}
          <code className="text-[10px]">{`{{...}}`}</code>. O valor é guardado como
          texto.
        </p>
      </div>
    </div>
  );
}

/**
 * Definir campo personalizado — persiste no `contatos.camposPersonalizados`
 * do cliente vinculado à execução. Lista de chaves vem do catálogo do
 * escritório (`configuracoes.listarCamposPersonalizadosCliente`); se a
 * lista estiver vazia, oferece input livre.
 */
function ConfigDefinirCampoPersonalizadoFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (path: string) => {
    const atual = String(cfg.valor || "");
    onChange({ valor: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  // Catálogo de campos personalizados do escritório.
  const { data: camposCatalogo } = (trpc as any).camposCliente.listar.useQuery(
    undefined,
    {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  );
  const opcoes: Array<{ chave: string; label: string }> = Array.isArray(camposCatalogo)
    ? camposCatalogo.map((c: any) => ({ chave: c.chave, label: c.label || c.chave }))
    : [];

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs">Campo personalizado</Label>
        {opcoes.length > 0 ? (
          <Select
            value={String(cfg.chave || "")}
            onValueChange={(v) => onChange({ chave: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Escolha o campo..." />
            </SelectTrigger>
            <SelectContent>
              {opcoes.map((o) => (
                <SelectItem key={o.chave} value={o.chave}>
                  {o.label} <span className="text-muted-foreground ml-1 text-[10px]">({o.chave})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={String(cfg.chave || "")}
            onChange={(e) => onChange({ chave: e.target.value })}
            placeholder="oab"
            className="font-mono text-xs"
          />
        )}
        <p className="text-[10px] text-muted-foreground mt-1">
          {opcoes.length > 0
            ? "Cadastre novos campos em Configurações → Campos personalizados de cliente."
            : "Nenhum campo cadastrado ainda — digite a chave aqui ou crie em Configurações."}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Valor</Label>
          <VariableTrigger
            inputId="cfg-defcampo-valor"
            variaveis={variaveis}
            onInsert={insertNoCfg}
          />
        </div>
        <VariableInput
          id="cfg-defcampo-valor"
          value={String(cfg.valor || "")}
          onChange={(v) => onChange({ valor: v })}
          variaveis={variaveis}
          placeholder="Ex: ativo, ou {{intencao}}"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Persiste no cadastro do cliente vinculado à execução.
        </p>
      </div>
    </div>
  );
}

function ConfigAsaasGerarCobrancaFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (campo: string) => (path: string) => {
    const atual = String(cfg[campo] || "");
    onChange({ [campo]: atual + (atual ? " " : "") + `{{${path}}}` });
  };

  return (
    <div className="space-y-2">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Valor (R$)</Label>
          <VariableTrigger
            inputId="cfg-asaas-valor"
            variaveis={variaveis}
            onInsert={insertNoCfg("valor")}
          />
        </div>
        <VariableInput
          id="cfg-asaas-valor"
          value={String(cfg.valor || "")}
          onChange={(v) => onChange({ valor: v })}
          variaveis={variaveis}
          placeholder="1500.00 ou {{pagamentoValor}}"
        />
      </div>

      <div>
        <Label className="text-xs">Tipo de cobrança</Label>
        <Select
          value={String(cfg.tipoCobranca || "BOLETO")}
          onValueChange={(v) => onChange({ tipoCobranca: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BOLETO">Boleto</SelectItem>
            <SelectItem value="PIX">PIX</SelectItem>
            <SelectItem value="CREDIT_CARD">Cartão de crédito</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Vencimento (dias)</Label>
        <Input
          type="number"
          min={1}
          value={cfg.vencimentoDias != null ? String(cfg.vencimentoDias) : ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange({ vencimentoDias: v ? Number(v) : null });
          }}
          placeholder="7"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Descrição</Label>
          <VariableTrigger
            inputId="cfg-asaas-descricao"
            variaveis={variaveis}
            onInsert={insertNoCfg("descricao")}
          />
        </div>
        <VariableInput
          id="cfg-asaas-descricao"
          value={String(cfg.descricao || "")}
          onChange={(v) => onChange({ descricao: v })}
          variaveis={variaveis}
          placeholder="Honorários — {{nomeCliente}}"
        />
      </div>

      <p className="text-[10px] text-muted-foreground">
        O ID e o link da cobrança ficam em <code>{"{{pagamentoId}}"}</code> e
        <code> {"{{pagamentoLink}}"}</code> pra usar nos próximos passos.
      </p>
    </div>
  );
}

function ConfigAsaasCancelarCobrancaFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (path: string) => {
    const atual = String(cfg.pagamentoId || "");
    onChange({ pagamentoId: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  return (
    <div className="space-y-2">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">ID da cobrança</Label>
          <VariableTrigger
            inputId="cfg-asaas-cancelar-id"
            variaveis={variaveis}
            onInsert={insertNoCfg}
          />
        </div>
        <VariableInput
          id="cfg-asaas-cancelar-id"
          value={String(cfg.pagamentoId || "")}
          onChange={(v) => onChange({ pagamentoId: v })}
          variaveis={variaveis}
          placeholder="{{pagamentoId}} (default — gerado num passo anterior)"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Vazio = usa <code>{"{{pagamentoId}}"}</code> do contexto.
        </p>
      </div>
    </div>
  );
}

function ConfigAsaasConsultarValorAbertoFields() {
  return (
    <p className="text-xs text-muted-foreground">
      Lê o resumo financeiro do cliente vinculado e grava no contexto:{" "}
      <code>{"{{valorTotalAberto}}"}</code>, <code>{"{{valorTotalVencido}}"}</code>,
      <code> {"{{cobrancasAbertasQtd}}"}</code>. Útil pra ramificar (If/Else) ou
      compor mensagens.
    </p>
  );
}

function ConfigAsaasMarcarRecebidaFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const variaveis = useSmartFlowVariaveis();
  const insertNoCfg = (campo: string) => (path: string) => {
    const atual = String(cfg[campo] || "");
    onChange({ [campo]: atual + (atual ? " " : "") + `{{${path}}}` });
  };
  return (
    <div className="space-y-2">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">ID da cobrança</Label>
          <VariableTrigger
            inputId="cfg-asaas-receber-id"
            variaveis={variaveis}
            onInsert={insertNoCfg("pagamentoId")}
          />
        </div>
        <VariableInput
          id="cfg-asaas-receber-id"
          value={String(cfg.pagamentoId || "")}
          onChange={(v) => onChange({ pagamentoId: v })}
          variaveis={variaveis}
          placeholder="{{pagamentoId}}"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Valor recebido (R$, opcional)</Label>
          <VariableTrigger
            inputId="cfg-asaas-receber-valor"
            variaveis={variaveis}
            onInsert={insertNoCfg("valorRecebido")}
          />
        </div>
        <VariableInput
          id="cfg-asaas-receber-valor"
          value={String(cfg.valorRecebido || "")}
          onChange={(v) => onChange({ valorRecebido: v })}
          variaveis={variaveis}
          placeholder="Vazio = valor da cobrança"
        />
      </div>

      <div>
        <Label className="text-xs">Data do recebimento (opcional)</Label>
        <Input
          type="date"
          value={String(cfg.dataRecebimento || "")}
          onChange={(e) => onChange({ dataRecebimento: e.target.value })}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Vazio = hoje. Útil quando o pagamento entrou por fora (PIX manual, transferência).
        </p>
      </div>
    </div>
  );
}

function ConfigFields({ node, onChange }: { node: PassoNode; onChange: (patch: Record<string, unknown>) => void }) {
  const cfg = node.data.config;

  switch (node.data.tipo) {
    case "ia_classificar": {
      const lista = Array.isArray(cfg.categorias) ? (cfg.categorias as string[]).join(", ") : "";
      return (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Categorias (separadas por vírgula)</Label>
            <Input
              value={lista}
              onChange={(e) =>
                onChange({
                  categorias: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              placeholder="agendar, duvida, emergencia, outro"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              A IA escolherá uma dessas categorias. O resultado vai para o contexto como <code>intencao</code>.
            </p>
          </div>
        </div>
      );
    }
    case "ia_responder":
      return <ConfigIaResponderFields cfg={cfg} onChange={onChange} />;
    case "ia_extrair_campos":
      return <ConfigIaExtrairCamposFields cfg={cfg} onChange={onChange} />;
    case "whatsapp_aguardar_resposta":
      return <ConfigWhatsappAguardarRespostaFields cfg={cfg} onChange={onChange} />;
    case "para_cada_item":
      return <ConfigParaCadaItemFields cfg={cfg} onChange={onChange} />;
    case "crm_buscar_contato":
      return <ConfigCrmBuscarContatoFields cfg={cfg} onChange={onChange} />;
    case "crm_listar_acoes_cliente":
      return <ConfigCrmListarAcoesClienteFields cfg={cfg} onChange={onChange} />;
    case "processo_buscar_movimentacoes":
      return <ConfigProcessoBuscarMovimentacoesFields cfg={cfg} onChange={onChange} />;
    case "calcom_horarios":
      return (
        <div>
          <Label className="text-xs">Duração da reunião (min)</Label>
          <Input
            type="number"
            value={Number(cfg.duracao || 30)}
            min={5}
            max={240}
            onChange={(e) => onChange({ duracao: Number(e.target.value) || 30 })}
          />
        </div>
      );
    case "calcom_agendar":
      return (
        <p className="text-xs text-muted-foreground">
          Confirma o horário escolhido no Cal.com. Requer que exista um passo <strong>Buscar horários</strong> antes.
        </p>
      );
    case "calcom_listar":
      return (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Status</Label>
            <Select
              value={String(cfg.status || "upcoming")}
              onValueChange={(v) => onChange({ status: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming">Próximos</SelectItem>
                <SelectItem value="past">Passados</SelectItem>
                <SelectItem value="cancelled">Cancelados</SelectItem>
                <SelectItem value="unconfirmed">Não confirmados</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              A lista de agendamentos vai pro contexto como <code>bookings</code> (quantidade em <code>bookingsQuantidade</code>).
            </p>
          </div>
        </div>
      );
    case "calcom_cancelar":
      return (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">ID do agendamento (opcional)</Label>
            <Input
              value={String(cfg.bookingId || "")}
              onChange={(e) => onChange({ bookingId: e.target.value })}
              placeholder="Deixe vazio para usar {agendamentoId} do contexto"
            />
          </div>
          <div>
            <Label className="text-xs">Motivo (opcional)</Label>
            <Input
              value={String(cfg.motivo || "")}
              onChange={(e) => onChange({ motivo: e.target.value })}
              placeholder="Ex: Cliente solicitou cancelamento"
            />
          </div>
        </div>
      );
    case "calcom_remarcar":
      return (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">ID do agendamento (opcional)</Label>
            <Input
              value={String(cfg.bookingId || "")}
              onChange={(e) => onChange({ bookingId: e.target.value })}
              placeholder="Deixe vazio para usar {agendamentoId} do contexto"
            />
          </div>
          <div>
            <Label className="text-xs">Novo horário (opcional)</Label>
            <Input
              value={String(cfg.novoHorario || "")}
              onChange={(e) => onChange({ novoHorario: e.target.value })}
              placeholder="ISO 8601. Vazio usa {horarioEscolhido} do contexto"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Use um passo <strong>Buscar horários</strong> antes para popular <code>horarioEscolhido</code>.
            </p>
          </div>
          <div>
            <Label className="text-xs">Motivo (opcional)</Label>
            <Input
              value={String(cfg.motivo || "")}
              onChange={(e) => onChange({ motivo: e.target.value })}
              placeholder="Ex: Cliente pediu para remarcar"
            />
          </div>
        </div>
      );
    case "agenda_criar":
      return <ConfigAgendaCriarFields cfg={cfg} onChange={onChange} />;
    case "whatsapp_enviar":
      return <ConfigWhatsappEnviarFields cfg={cfg} onChange={onChange} />;
    case "transferir":
      return <ConfigTransferirFields cfg={cfg} onChange={onChange} />;
    case "condicional":
      return <ConfigCondicionalFields cfg={cfg} onChange={onChange} />;
    case "esperar":
      return (
        <div>
          <Label className="text-xs">Aguardar (minutos)</Label>
          <Input
            type="number"
            value={Number(cfg.delayMinutos || 5)}
            min={1}
            max={60 * 24 * 7}
            onChange={(e) => onChange({ delayMinutos: Number(e.target.value) || 5 })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            O fluxo pausa e retoma automaticamente após o tempo escolhido (via scheduler interno).
          </p>
        </div>
      );
    case "webhook":
      return (
        <div>
          <Label className="text-xs">URL (POST)</Label>
          <Input
            value={String(cfg.url || "")}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://meu-servico.com/webhook"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Envia o contexto inteiro em JSON. A resposta vai para <code>contexto.webhookResultado</code>.
          </p>
        </div>
      );
    case "kanban_criar_card":
      return <ConfigKanbanCriarCardFields cfg={cfg} onChange={onChange} />;
    case "kanban_mover_card":
      return <ConfigKanbanMoverCardFields cfg={cfg} onChange={onChange} />;
    case "kanban_atribuir_responsavel":
      return <ConfigKanbanAtribuirResponsavelFields cfg={cfg} onChange={onChange} />;
    case "kanban_tags":
      return <ConfigKanbanTagsFields cfg={cfg} onChange={onChange} />;
    case "definir_variavel":
      return <ConfigDefinirVariavelFields cfg={cfg} onChange={onChange} />;
    case "definir_campo_personalizado":
      return <ConfigDefinirCampoPersonalizadoFields cfg={cfg} onChange={onChange} />;
    case "asaas_gerar_cobranca":
      return <ConfigAsaasGerarCobrancaFields cfg={cfg} onChange={onChange} />;
    case "asaas_cancelar_cobranca":
      return <ConfigAsaasCancelarCobrancaFields cfg={cfg} onChange={onChange} />;
    case "asaas_consultar_valor_aberto":
      return <ConfigAsaasConsultarValorAbertoFields />;
    case "asaas_marcar_recebida":
      return <ConfigAsaasMarcarRecebidaFields cfg={cfg} onChange={onChange} />;
    default:
      return (
        <p className="text-xs text-muted-foreground">
          Passo sem configuração — usa valores padrão.
        </p>
      );
  }
}

// Helper para mostrar badge de status no canvas (não usado diretamente —
// reservado para evoluções futuras, como exibir progresso de execução).
export function SmartFlowStatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className="text-[9px]">{status}</Badge>;
}
