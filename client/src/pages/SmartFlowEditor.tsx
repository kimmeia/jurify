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

import { useCallback, useEffect, useMemo, useState } from "react";
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
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, Brain, Bot, Calendar, CheckCircle2, Clock, DollarSign,
  GitBranch, LayoutGrid, Loader2, MessageCircle, PhoneCall, Play,
  Plus, Save, Users, Webhook, Zap, CalendarCheck, CalendarX, CalendarClock, CalendarSearch, Trash2,
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
  getTipoPassoMeta,
  getGatilhoMeta,
  CAMPOS_CONDICIONAL,
  type GatilhoMeta,
  type GatilhoSmartflow,
  type GrupoSmartflow,
  type TipoPassoMeta,
  type TipoPasso,
  type TipoCanalMensagem,
} from "@shared/smartflow-types";
import { validarGrafo } from "@shared/smartflow-graph-validation";

// ─── Ícones por tipo (mantidos no frontend p/ não poluir shared) ───────────

const TIPO_ICON: Record<TipoPasso, LucideIcon> = {
  ia_classificar: Brain,
  ia_responder: Bot,
  calcom_horarios: Calendar,
  calcom_agendar: CheckCircle2,
  calcom_listar: CalendarSearch,
  calcom_cancelar: CalendarX,
  calcom_remarcar: CalendarClock,
  whatsapp_enviar: MessageCircle,
  transferir: PhoneCall,
  condicional: GitBranch,
  esperar: Clock,
  webhook: Webhook,
  kanban_criar_card: LayoutGrid,
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
  kanban: LayoutGrid,
  fluxo: Play,
};

/**
 * Retorna a primeira operação (ordem definida em `GATILHO_META`) da
 * categoria. Usado quando o usuário clica numa categoria da paleta e
 * precisamos materializar um gatilho concreto no nó.
 */
function primeiraOperacaoDaCategoria(grupo: GrupoSmartflow): GatilhoSmartflow | null {
  const meta = GATILHO_META.find((g) => g.grupo === grupo);
  return meta?.id ?? null;
}

/** Operações (gatilhos) disponíveis numa categoria, mantendo a ordem de `GATILHO_META`. */
function operacoesDaCategoria(grupo: GrupoSmartflow): GatilhoMeta[] {
  return GATILHO_META.filter((g) => g.grupo === grupo);
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

function PassoNodeView({ data, selected }: NodeProps<PassoNode>) {
  const meta = getTipoPassoMeta(data.tipo);
  const Icon = TIPO_ICON[data.tipo] ?? Zap;
  const resumo = resumirConfig(data.tipo, data.config);

  // O condicional ganha um handle por ramo. Cada condição tem um id estável
  // (`config.condicoes[i].id`), mais o "fallback". Pros demais passos basta
  // um handle "default".
  const isCondicional = data.tipo === "condicional";
  const condicoes = isCondicional && Array.isArray((data.config as any).condicoes)
    ? ((data.config as any).condicoes as Array<{ id: string }>)
    : [];
  const totalHandles = isCondicional ? condicoes.length + 1 : 1;

  return (
    <div
      className={`rounded-lg border-2 shadow-sm bg-card min-w-[200px] max-w-[260px] ${
        selected ? "border-primary" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground/40" />
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-[6px] ${meta.cor}`}>
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold truncate">{meta.label}</span>
      </div>
      {resumo && (
        <div className="px-2.5 py-1.5 text-[10px] text-muted-foreground border-t bg-muted/30 rounded-b-[6px]">
          {resumo}
        </div>
      )}

      {isCondicional ? (
        <div className="px-2.5 py-2 border-t bg-muted/20 rounded-b-[6px] space-y-1">
          {condicoes.map((c, idx) => (
            <div key={c.id} className="flex items-center gap-1.5 text-[9px] relative py-0.5">
              <span className="flex-1 font-mono text-muted-foreground">cond {idx + 1}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={`cond_${c.id}`}
                style={{
                  right: -6,
                  top: "50%",
                  background: "#22c55e",
                  width: 8,
                  height: 8,
                }}
              />
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-[9px] relative py-0.5">
            <span className="flex-1 font-mono text-muted-foreground italic">fallback</span>
            <Handle
              type="source"
              position={Position.Right}
              id="fallback"
              style={{
                right: -6,
                top: "50%",
                background: "#f59e0b",
                width: 8,
                height: 8,
              }}
            />
          </div>
        </div>
      ) : (
        <Handle type="source" position={Position.Bottom} id="default" className="!bg-muted-foreground/40" />
      )}

      {/* Evita warnings do ReactFlow sobre handle não declarado. */}
      <span aria-hidden className="hidden">{totalHandles}</span>
    </div>
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

export default function SmartFlowEditor() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const utils = (trpc as any).useUtils?.() || (trpc as any).useContext?.();

  const editandoId = params.id ? Number(params.id) : null;
  const novo = !editandoId;

  // Dados gerais do cenário (gatilho vive como nó no canvas)
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");

  // Canvas começa com um nó de gatilho default (mensagem_canal).
  // O nó de gatilho tem ID fixo e não é deletável — usuário só troca o tipo
  // clicando na paleta.
  const [nodes, setNodes] = useState<AnyNode[]>(() => [criarGatilhoNode("mensagem_canal")]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
          es.push({
            id: `e-${prev.id}-${node.id}`,
            source: prev.id,
            target: node.id,
          });
        }
      }
    }

    setNodes([gatilhoNode, ...passosNodes]);
    setEdges(es);
  }, [cenario]);

  // Mutations
  const criarMut = (trpc as any).smartflow.criar.useMutation({
    onSuccess: () => {
      toast.success("Cenário criado!");
      utils?.smartflow?.listar?.invalidate();
      navigate("/smartflow");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const atualizarMut = (trpc as any).smartflow.atualizar.useMutation({
    onSuccess: () => {
      toast.success("Cenário atualizado!");
      utils?.smartflow?.listar?.invalidate();
      utils?.smartflow?.detalhe?.invalidate({ id: editandoId });
      navigate("/smartflow");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const selectedNode = nodes.find((n) => n.id === selectedId) || null;
  const gatilhoNode = nodes.find(isGatilhoNode) || null;

  // Callbacks canvas
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as AnyNode[]),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );
  const onConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge({ ...conn, animated: true }, eds)),
    [],
  );

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
      { id: `e${ultimoId}-${novoNode.id}`, source: ultimoId, target: novoNode.id, animated: true },
    ]);
    setSelectedId(novoNode.id);
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
    // Mapa nodeId → clienteId, pra traduzir edges em `proximoSe`.
    const nodeIdParaCliente = new Map<string, string>();
    for (const n of passosList) nodeIdParaCliente.set(n.id, n.data.clienteId);

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

    const passos = passosList.map((n) => {
      const mapa = proximoSePorNodeId.get(n.id);
      return {
        tipo: n.data.tipo,
        config: n.data.config,
        clienteId: n.data.clienteId,
        proximoSe: mapa && Object.keys(mapa).length > 0 ? mapa : undefined,
      };
    });
    // Validação de grafo antes de persistir — detecta ciclos (bloqueia),
    // órfãos e condicionais sem saída (apenas aviso).
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
    <div className="-m-6 flex flex-col h-[calc(100vh-3.5rem)] md:h-screen bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-background">
        <Button variant="ghost" size="sm" className="gap-1" asChild>
          <Link href="/smartflow">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
        </Button>
        <div className="h-8 w-px bg-border" />
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do cenário"
            className="max-w-xs font-semibold"
          />
        </div>
        <Button onClick={salvar} disabled={salvando} size="sm" className="gap-1">
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {novo ? "Criar" : "Salvar"}
        </Button>
      </div>

      {/* Descrição */}
      <div className="px-4 py-2 border-b bg-muted/30">
        <Input
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Descrição (opcional) — explique o que o cenário faz"
          className="bg-transparent border-none shadow-none text-sm"
        />
      </div>

      {/* Workspace */}
      <div className="flex flex-1 min-h-0">
        {/* Paleta esquerda */}
        <div className="w-60 border-r bg-muted/20 p-3 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Gatilho</p>
          <div className="mb-5 space-y-1.5">
            {/*
              Paleta lista CATEGORIAS, não operações. Ao clicar, se o gatilho
              atual já está na categoria, só re-seleciona o nó (a troca de
              operação acontece no painel direito). Se está em outra, troca
              pro primeiro gatilho da categoria.
            */}
            {GRUPO_META.filter((g) => operacoesDaCategoria(g.id).length > 0).map((grupo) => {
              const Icon = GRUPO_ICON[grupo.id];
              const grupoAtualGatilho = gatilhoNode ? getGatilhoMeta(gatilhoNode.data.gatilho).grupo : null;
              const ativo = grupoAtualGatilho === grupo.id;
              return (
                <button
                  key={grupo.id}
                  onClick={() => trocarCategoria(grupo.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded border transition-all text-left ${
                    ativo
                      ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20 shadow-sm"
                      : "border-dashed border-border hover:border-solid hover:shadow-sm bg-background"
                  }`}
                  title={`Categoria ${grupo.label} — ${operacoesDaCategoria(grupo.id).length} operação(ões)`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-amber-600" />
                  <span className="text-xs font-semibold leading-tight flex-1">{grupo.label}</span>
                  {ativo && <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500 fill-amber-500" />}
                </button>
              );
            })}
          </div>

          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Adicionar passo</p>
          <div className="space-y-3">
            {agrupar<TipoPassoMeta>(TIPO_PASSO_META).map((g) => (
              <div key={g.id}>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-1 font-semibold px-0.5">
                  {g.label}
                </p>
                <div className="space-y-1.5">
                  {g.itens.map((t) => {
                    const Icon = TIPO_ICON[t.id];
                    return (
                      <button
                        key={t.id}
                        onClick={() => adicionarPasso(t.id)}
                        className={`w-full flex items-start gap-2 px-2.5 py-1.5 rounded border border-dashed hover:border-solid hover:shadow-sm transition-all text-left ${t.cor}`}
                        title={t.descricao}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span className="text-xs font-medium leading-tight">{t.label}</span>
                        <Plus className="h-3 w-3 shrink-0 ml-auto mt-0.5 opacity-60" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_e, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-background !border" />
          </ReactFlow>

          {passoNodesOrdenados(nodes).length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none mt-32">
              <Card className="max-w-sm pointer-events-auto">
                <CardContent className="py-6 text-center">
                  <Zap className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-sm font-medium">Sem passos ainda</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Escolha um passo na coluna à esquerda para continuar a partir do gatilho.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Painel direito — config do nó selecionado */}
        <div className="w-80 border-l bg-background overflow-y-auto">
          {selectedNode ? (
            <PainelConfig
              node={selectedNode}
              onChange={atualizarConfigSelecionado}
              onRemove={removerSelecionado}
              onChangeGatilho={trocarGatilho}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              <p className="font-medium mb-1">Nenhum passo selecionado</p>
              <p className="text-xs">Clique em um nó do canvas para configurá-lo.</p>
            </div>
          )}
        </div>
      </div>
    </div>
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
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded ${meta.cor}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{meta.label}</p>
          <p className="text-[10px] text-muted-foreground truncate">{meta.descricao}</p>
        </div>
      </div>

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

interface CondicaoItem {
  id: string;
  campo: string;
  operador: string;
  valor?: string;
  valor2?: string;
}

function ConfigCondicionalFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const condicoes: CondicaoItem[] = Array.isArray(cfg.condicoes)
    ? (cfg.condicoes as CondicaoItem[])
    : [];

  const update = (next: CondicaoItem[]) => onChange({ condicoes: next });

  const adicionar = () => {
    const nova: CondicaoItem = {
      id: novoClienteId().slice(0, 8),
      campo: "intencao",
      operador: "igual",
      valor: "",
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
                <span className="text-[10px] font-semibold text-muted-foreground flex-1">Condição {idx + 1}</span>
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
              <Select value={c.campo || "intencao"} onValueChange={(v) => atualizar(idx, { campo: v })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CAMPOS_CONDICIONAL.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={c.operador || "igual"} onValueChange={(v) => atualizar(idx, { operador: v })}>
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
              {c.operador !== "existe" && c.operador !== "nao_existe" && c.operador !== "verdadeiro" && (
                <Input
                  value={String(c.valor || "")}
                  onChange={(e) => atualizar(idx, { valor: e.target.value })}
                  placeholder={c.operador === "entre" ? "Mínimo" : "Valor"}
                  className="h-7 text-xs"
                />
              )}
              {c.operador === "entre" && (
                <Input
                  value={String(c.valor2 || "")}
                  onChange={(e) => atualizar(idx, { valor2: e.target.value })}
                  placeholder="Máximo"
                  className="h-7 text-xs"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        As condições são avaliadas em ordem. Conecte cada saída do nó ao próximo passo
        (ramo verde = condição X; ramo amarelo = fallback). Sem conexão = fim do fluxo.
      </p>
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
    case "whatsapp_enviar":
      return (
        <div>
          <Label className="text-xs">Template da mensagem</Label>
          <Textarea
            value={String(cfg.template || "")}
            onChange={(e) => onChange({ template: e.target.value })}
            placeholder="Olá {nome}, vi sua mensagem sobre {intencao}."
            rows={4}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Variáveis: <code>{"{nome}"}</code>, <code>{"{intencao}"}</code>, <code>{"{horario}"}</code>.
          </p>
        </div>
      );
    case "transferir":
      return (
        <p className="text-xs text-muted-foreground">
          Marca a conversa como "em_atendimento" e encerra o fluxo. Útil em últimos passos de um caminho
          condicional (ex: quando IA classifica como emergência).
        </p>
      );
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
      return (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Título (opcional)</Label>
            <Input
              value={String(cfg.titulo || "")}
              onChange={(e) => onChange({ titulo: e.target.value })}
              placeholder="Deixe vazio para usar dados do pagamento"
            />
          </div>
          <div>
            <Label className="text-xs">Prioridade</Label>
            <Select value={String(cfg.prioridade || "media")} onValueChange={(v) => onChange({ prioridade: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="media">Média</SelectItem>
                <SelectItem value="baixa">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Se <code>funilId/colunaId</code> não forem configurados, usa o primeiro funil+coluna do escritório.
          </p>
        </div>
      );
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
