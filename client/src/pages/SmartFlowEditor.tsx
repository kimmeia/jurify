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
  Plus, Save, Users, Webhook, Zap,
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
  getTipoPassoMeta,
  getGatilhoMeta,
  CAMPOS_CONDICIONAL,
  type GatilhoSmartflow,
  type TipoPasso,
  type TipoCanalMensagem,
} from "@shared/smartflow-types";

// ─── Ícones por tipo (mantidos no frontend p/ não poluir shared) ───────────

const TIPO_ICON: Record<TipoPasso, LucideIcon> = {
  ia_classificar: Brain,
  ia_responder: Bot,
  calcom_horarios: Calendar,
  calcom_agendar: CheckCircle2,
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
  agendamento_criado: Calendar,
  manual: Play,
};

// ─── Tipagem dos nós ───────────────────────────────────────────────────────

interface PassoNodeData extends Record<string, unknown> {
  tipo: TipoPasso;
  config: Record<string, unknown>;
  label: string;
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
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground/40" />
    </div>
  );
}

function GatilhoNodeView({ data, selected }: NodeProps<GatilhoNode>) {
  const meta = getGatilhoMeta(data.gatilho);
  const Icon = GATILHO_ICON[data.gatilho] ?? Zap;
  const resumo = resumirConfigGatilho(data.gatilho, data.configGatilho);

  return (
    <div
      className={`rounded-xl border-2 shadow-md bg-card min-w-[220px] max-w-[280px] ring-2 ring-offset-2 ring-offset-background transition-all ${
        selected ? "ring-amber-500 border-amber-500" : "ring-amber-500/40 border-amber-500/60"
      }`}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-t-[10px] bg-gradient-to-r from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40 text-amber-900 dark:text-amber-200">
        <Zap className="h-3.5 w-3.5 shrink-0" />
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-bold truncate">{meta.label}</span>
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
  if (g === "pagamento_vencido") {
    const d = Number(cfg.diasAtraso ?? 0);
    return d > 0 ? `≥ ${d} dia(s) de atraso` : "Qualquer atraso";
  }
  if (g === "pagamento_proximo_vencimento") {
    const d = Number(cfg.diasAntes ?? 3);
    return `${d} dia(s) antes`;
  }
  return "";
}

function resumirConfig(tipo: TipoPasso, config: Record<string, unknown>): string {
  if (!config) return "";
  switch (tipo) {
    case "ia_classificar":
      return Array.isArray(config.categorias) ? (config.categorias as string[]).join(", ") : "";
    case "ia_responder":
      return typeof config.prompt === "string" ? truncar(config.prompt, 60) : "";
    case "calcom_horarios":
      return config.duracao ? `${config.duracao} min` : "";
    case "whatsapp_enviar":
      return typeof config.template === "string" ? truncar(config.template, 50) : "";
    case "condicional": {
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

function criarNode(tipo: TipoPasso, y: number, config: Record<string, unknown> = {}): PassoNode {
  const meta = getTipoPassoMeta(tipo);
  return {
    id: novoNodeId(),
    type: "passo",
    position: { x: 80, y },
    data: { tipo, config, label: meta.label },
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

    const passos = (cenario.passos || []) as Array<{ id: number; tipo: TipoPasso; config: string | null }>;
    const passosNodes: PassoNode[] = passos.map((p, i) => {
      let cfg: Record<string, unknown> = {};
      try { cfg = p.config ? JSON.parse(p.config) : {}; } catch { cfg = {}; }
      return {
        id: `p${p.id}`,
        type: "passo",
        position: { x: 80, y: 140 + i * 120 },
        data: { tipo: p.tipo, config: cfg, label: getTipoPassoMeta(p.tipo).label },
      };
    });

    const es: Edge[] = [];
    // Conecta gatilho ao primeiro passo
    if (passosNodes.length > 0) {
      es.push({ id: `e-gatilho-${passosNodes[0].id}`, source: GATILHO_NODE_ID, target: passosNodes[0].id });
    }
    for (let i = 0; i < passosNodes.length - 1; i++) {
      es.push({ id: `e${passosNodes[i].id}-${passosNodes[i + 1].id}`, source: passosNodes[i].id, target: passosNodes[i + 1].id });
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

  /** Troca o tipo de gatilho (mantém o mesmo nó, só muda os dados). */
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
    const passos = passosList.map((n) => ({ tipo: n.data.tipo, config: n.data.config }));
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
          <div className="space-y-1.5 mb-5">
            {GATILHO_META.map((g) => {
              const Icon = GATILHO_ICON[g.id];
              const ativo = gatilhoNode?.data.gatilho === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => trocarGatilho(g.id)}
                  className={`w-full flex items-start gap-2 px-2.5 py-1.5 rounded border transition-all text-left ${
                    ativo
                      ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20 shadow-sm"
                      : "border-dashed border-border hover:border-solid hover:shadow-sm bg-background"
                  }`}
                  title={g.descricao}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
                  <span className="text-xs font-medium leading-tight flex-1">{g.label}</span>
                  {ativo && <Zap className="h-3 w-3 shrink-0 mt-0.5 text-amber-500 fill-amber-500" />}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Adicionar passo</p>
          <div className="space-y-1.5">
            {TIPO_PASSO_META.map((t) => {
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
}

function PainelConfig({ node, onChange, onRemove }: PainelConfigProps) {
  if (isGatilhoNode(node)) {
    const meta = getGatilhoMeta(node.data.gatilho);
    const Icon = GATILHO_ICON[node.data.gatilho] ?? Zap;
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40 text-amber-700 dark:text-amber-300">
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{meta.label}</p>
            <p className="text-[10px] text-muted-foreground truncate">{meta.descricao}</p>
          </div>
        </div>
        <ConfigGatilhoFields node={node} onChange={onChange} />
        <p className="text-[10px] text-muted-foreground pt-2 border-t">
          Para trocar o tipo de gatilho, clique em outra opção na paleta à esquerda.
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
          <br /> <strong>0</strong> = dispara imediatamente ao vencer.
        </p>
      </div>
    );
  }

  if (node.data.gatilho === "pagamento_proximo_vencimento") {
    return (
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
          Dispara o cenário quando a cobrança vence em até N dias. Roda 1×/dia via job.
        </p>
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
      return (
        <div>
          <Label className="text-xs">Prompt adicional</Label>
          <Textarea
            value={String(cfg.prompt || "")}
            onChange={(e) => onChange({ prompt: e.target.value })}
            placeholder="Ex: Você é um recepcionista de advocacia. Seja educado e objetivo."
            rows={5}
          />
        </div>
      );
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
      return (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Campo do contexto</Label>
            <Select value={String(cfg.campo || "intencao")} onValueChange={(v) => onChange({ campo: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAMPOS_CONDICIONAL.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Operador</Label>
            <Select value={String(cfg.operador || "igual")} onValueChange={(v) => onChange({ operador: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="igual">igual a</SelectItem>
                <SelectItem value="diferente">diferente de</SelectItem>
                <SelectItem value="existe">existe (preenchido)</SelectItem>
                <SelectItem value="nao_existe">não existe (vazio)</SelectItem>
                <SelectItem value="verdadeiro">é verdadeiro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Valor esperado</Label>
            <Input
              value={String(cfg.valor || "")}
              onChange={(e) => onChange({ valor: e.target.value })}
              placeholder="Ex: agendar"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Se a condição não for atendida, o fluxo para.
            </p>
          </div>
        </div>
      );
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
