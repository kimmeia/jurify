import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertTriangle,
  Banknote,
  BookOpen,
  Bot,
  Brain,
  Calendar, CalendarCheck, CalendarClock, CalendarSearch, CalendarX,
  CheckCircle2,
  ChevronDown, ChevronRight,
  CircleDollarSign,
  Clock,
  DollarSign,
  FileText,
  GitBranch,
  Layers,
  LayoutGrid,
  Loader2,
  MessageCircle,
  Move,
  Pause,
  PhoneCall,
  Play,
  Plus,
  Repeat,
  Search,
  Sparkles,
  Tags as TagsIcon,
  UserPlus,
  Users,
  Variable as VariableIcon,
  Webhook,
  XCircle,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  CATEGORIAS_PASSO,
  GATILHO_META,
  GRUPO_META,
  TIPO_PASSO_META,
  getCategoriaDoTipo,
  getGatilhoMeta,
  type CategoriaPassoMeta,
  type GatilhoMeta,
  type GatilhoSmartflow,
  type GrupoSmartflow,
  type TipoPasso,
  type TipoPassoMeta,
} from "@shared/smartflow-types";

const TIPO_ICON: Record<TipoPasso, LucideIcon> = {
  ia_classificar: Brain,
  ia_responder: Bot,
  ia_consultar: Search,
  ia_atendente: Bot,
  ia_extrair_campos: Sparkles,
  crm_buscar_contato: Search,
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
  distribuir_atendimento: Users,
  condicional: GitBranch,
  para_cada_item: Repeat,
  esperar: Clock,
  webhook: Webhook,
  kanban_criar_card: LayoutGrid,
  kanban_mover_card: Move,
  kanban_atribuir_responsavel: UserPlus,
  kanban_tags: TagsIcon,
  contato_tags: TagsIcon,
  asaas_gerar_cobranca: Banknote,
  asaas_cancelar_cobranca: XCircle,
  asaas_consultar_valor_aberto: CircleDollarSign,
  asaas_marcar_recebida: CheckCircle2,
  definir_variavel: VariableIcon,
  definir_campo_personalizado: FileText,
};

const GRUPO_ICON: Record<GrupoSmartflow, LucideIcon> = {
  mensagem: MessageCircle,
  asaas: DollarSign,
  calcom: Calendar,
  crm: Users,
  ia: Bot,
  acoes: Layers,
  fluxo: Play,
};

const GRUPO_COR_ICONE: Record<GrupoSmartflow, string> = {
  mensagem: "text-blue-600",
  asaas: "text-emerald-600",
  calcom: "text-orange-600",
  crm: "text-violet-600",
  ia: "text-violet-600",
  acoes: "text-indigo-600",
  fluxo: "text-amber-600",
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

const GATILHO_GRADIENT: Record<GatilhoSmartflow, { from: string; to: string; bg: string; border: string }> = {
  whatsapp_mensagem: { from: "from-blue-500", to: "to-cyan-500", bg: "from-blue-50 to-cyan-50 dark:from-blue-950/40 dark:to-cyan-950/40", border: "border-blue-200 dark:border-blue-900" },
  mensagem_canal: { from: "from-blue-500", to: "to-cyan-500", bg: "from-blue-50 to-cyan-50 dark:from-blue-950/40 dark:to-cyan-950/40", border: "border-blue-200 dark:border-blue-900" },
  pagamento_recebido: { from: "from-emerald-500", to: "to-teal-600", bg: "from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40", border: "border-emerald-200 dark:border-emerald-900" },
  pagamento_vencido: { from: "from-amber-500", to: "to-red-500", bg: "from-amber-50 to-red-50 dark:from-amber-950/40 dark:to-red-950/40", border: "border-amber-200 dark:border-amber-900" },
  pagamento_proximo_vencimento: { from: "from-amber-400", to: "to-orange-500", bg: "from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40", border: "border-amber-200 dark:border-amber-900" },
  novo_lead: { from: "from-violet-500", to: "to-pink-500", bg: "from-violet-50 to-pink-50 dark:from-violet-950/40 dark:to-pink-950/40", border: "border-violet-200 dark:border-violet-900" },
  agendamento_criado: { from: "from-emerald-500", to: "to-green-600", bg: "from-orange-50 to-amber-50 dark:from-orange-950/40 dark:to-amber-950/40", border: "border-orange-200 dark:border-orange-900" },
  agendamento_cancelado: { from: "from-rose-500", to: "to-pink-600", bg: "from-orange-50 to-amber-50 dark:from-orange-950/40 dark:to-amber-950/40", border: "border-orange-200 dark:border-orange-900" },
  agendamento_remarcado: { from: "from-cyan-500", to: "to-blue-500", bg: "from-orange-50 to-amber-50 dark:from-orange-950/40 dark:to-amber-950/40", border: "border-orange-200 dark:border-orange-900" },
  agendamento_lembrete: { from: "from-orange-500", to: "to-amber-500", bg: "from-orange-50 to-amber-50 dark:from-orange-950/40 dark:to-amber-950/40", border: "border-orange-200 dark:border-orange-900" },
  manual: { from: "from-slate-600", to: "to-slate-800", bg: "from-slate-100 to-slate-200 dark:from-slate-900/60 dark:to-slate-800", border: "border-slate-300 dark:border-slate-700" },
};

interface PaletaProps {
  gatilhoAtual: GatilhoSmartflow;
  /** Chamado quando o usuário escolhe um novo tipo de gatilho. */
  onTrocarGatilho: (g: GatilhoSmartflow) => void;
  /** Foca o nó de gatilho no canvas (abre o painel direito pra configurar). */
  onFocarGatilho: () => void;
  /** Adiciona um passo do tipo escolhido ao canvas. */
  onAdicionarPasso: (tipo: TipoPasso) => void;
}

/**
 * Paleta esquerda do editor — gatilho destacado em cima, ações
 * agrupadas e colapsáveis em baixo. Busca inline filtra passos pelo
 * nome/descrição em todos os grupos simultaneamente (e auto-expande
 * grupos com match).
 */
export function EditorPaleta({
  gatilhoAtual,
  onTrocarGatilho,
  onFocarGatilho,
  onAdicionarPasso,
}: PaletaProps) {
  const [busca, setBusca] = useState("");
  // Grupos expandidos por default — ações é o que o usuário mais usa.
  const [expandidos, setExpandidos] = useState<Set<string>>(
    () => new Set(["acoes", "mensagem", "fluxo"]),
  );

  const buscaNorm = busca.trim().toLowerCase();
  const filtrarPasso = (t: TipoPassoMeta) =>
    !buscaNorm ||
    t.label.toLowerCase().includes(buscaNorm) ||
    t.descricao.toLowerCase().includes(buscaNorm);

  // Auto-expansão quando há busca: qualquer grupo com pelo menos 1 match abre.
  const grupos = useMemo(() => {
    const out: { grupo: GrupoSmartflow; label: string; itens: TipoPassoMeta[] }[] = [];
    for (const g of GRUPO_META) {
      const itens = TIPO_PASSO_META.filter((t) => t.grupo === g.id && filtrarPasso(t));
      if (itens.length === 0) continue;
      out.push({ grupo: g.id, label: g.label, itens });
    }
    return out;
  }, [buscaNorm]);

  const toggleGrupo = (g: GrupoSmartflow) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };
  const estaExpandido = (g: GrupoSmartflow) => {
    // Com busca ativa, força expansão dos que têm match.
    if (buscaNorm) return true;
    return expandidos.has(g);
  };

  const metaGatilho = getGatilhoMeta(gatilhoAtual);
  const GatIcon = GATILHO_ICON[gatilhoAtual] ?? Zap;
  const grad = GATILHO_GRADIENT[gatilhoAtual];

  return (
    <aside className="w-72 border-r bg-slate-50/60 dark:bg-slate-900/30 overflow-y-auto flex-shrink-0">
      {/* ─── GATILHO em destaque ─── */}
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Zap className="w-3 h-3 text-amber-600" />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Gatilho do fluxo
          </p>
        </div>

        <button
          onClick={onFocarGatilho}
          className={`w-full text-left rounded-xl border-2 bg-gradient-to-br ${grad.bg} ${grad.border} p-3 hover:shadow-md transition-all`}
          title="Clique pra configurar o gatilho"
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className={`w-9 h-9 rounded-lg bg-gradient-to-br ${grad.from} ${grad.to} flex items-center justify-center shadow-sm shrink-0`}
            >
              <GatIcon className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate">{metaGatilho.label}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                Clique pra configurar
              </p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
            {metaGatilho.descricao}
          </p>
        </button>

        <TrocarGatilhoPopover
          gatilhoAtual={gatilhoAtual}
          onEscolher={onTrocarGatilho}
        />
      </div>

      <div className="px-3"><div className="border-t border-border"></div></div>

      {/* ─── AÇÕES (passos) ─── */}
      <div className="p-3 space-y-3">
        <div className="flex items-center gap-1.5">
          <Layers className="w-3 h-3 text-violet-600" />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Ações disponíveis
          </p>
        </div>

        {/* Busca */}
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar passo..."
            className="h-7 pl-7 pr-2 text-[11px]"
          />
          {busca && (
            <button
              onClick={() => setBusca("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="Limpar busca"
            >
              <XCircle className="w-3 h-3" />
            </button>
          )}
        </div>

        {grupos.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic px-1 py-2">
            Nenhum passo corresponde à busca.
          </p>
        )}

        {grupos.map((g) => {
          const GrupoIcon = GRUPO_ICON[g.grupo] ?? Sparkles;
          const corIcone = GRUPO_COR_ICONE[g.grupo] ?? "text-slate-500";
          const aberto = estaExpandido(g.grupo);
          // Categorias do grupo (popovers tipo "Kanban", "Asaas", "Cal.com")
          const categorias = CATEGORIAS_PASSO.filter((c) => c.grupo === g.grupo);
          // Itens diretos do grupo (sem categoria popover)
          const diretos = g.itens.filter((t) => !getCategoriaDoTipo(t.id));

          if (diretos.length === 0 && categorias.length === 0) return null;

          return (
            <div key={g.grupo} className="border border-slate-200 dark:border-slate-800 rounded-lg bg-card overflow-hidden">
              <button
                onClick={() => toggleGrupo(g.grupo)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <GrupoIcon className={`w-3.5 h-3.5 ${corIcone}`} />
                  <span className="text-xs font-bold">{g.label}</span>
                  <span className="text-[9px] bg-slate-100 dark:bg-slate-800 text-muted-foreground px-1.5 py-0.5 rounded font-semibold">
                    {diretos.length + categorias.reduce((s, c) => s + c.tipos.length, 0)}
                  </span>
                </div>
                {aberto ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>

              {aberto && (
                <div className="px-1 pb-1 space-y-0.5 border-t border-slate-100 dark:border-slate-900">
                  {diretos.map((t) => (
                    <PassoItem key={t.id} tipo={t} onAdicionar={onAdicionarPasso} />
                  ))}
                  {categorias.map((cat) => (
                    <CategoriaSubgrupo
                      key={cat.id}
                      categoria={cat}
                      filtro={buscaNorm}
                      onAdicionar={onAdicionarPasso}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <p className="text-[10px] text-muted-foreground italic px-1 pt-1 leading-snug">
          💡 Arraste a bolinha do nó pro canvas vazio pra criar e conectar de uma vez só.
        </p>
      </div>
    </aside>
  );
}

/** Linha individual de um passo na paleta — clique adiciona ao canvas. */
function PassoItem({
  tipo,
  onAdicionar,
}: {
  tipo: TipoPassoMeta;
  onAdicionar: (t: TipoPasso) => void;
}) {
  const Icon = TIPO_ICON[tipo.id] ?? Zap;
  return (
    <button
      onClick={() => onAdicionar(tipo.id)}
      className="w-full flex items-start gap-2 px-2 py-1.5 rounded text-left hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors group"
      title={tipo.descricao}
    >
      <div className={`p-1 rounded ${tipo.cor} shrink-0 mt-0.5`}>
        <Icon className="w-3 h-3" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold leading-tight">{tipo.label}</p>
        <p className="text-[9px] text-muted-foreground line-clamp-1 mt-0.5">{tipo.descricao}</p>
      </div>
      <Plus className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-1" />
    </button>
  );
}

/**
 * Subgrupo de categoria — quando expandido, mostra todos os subtipos.
 * Diferente do grupo principal: este é colapsável dentro do grupo, com
 * sua própria seta. Subtipos filtrados pela busca aparecem direto.
 */
function CategoriaSubgrupo({
  categoria,
  filtro,
  onAdicionar,
}: {
  categoria: CategoriaPassoMeta;
  filtro: string;
  onAdicionar: (t: TipoPasso) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const subtipos = categoria.tipos
    .map((tipo) => TIPO_PASSO_META.find((m) => m.id === tipo))
    .filter((m): m is TipoPassoMeta => Boolean(m))
    .filter(
      (m) =>
        !filtro ||
        m.label.toLowerCase().includes(filtro) ||
        m.descricao.toLowerCase().includes(filtro),
    );
  if (subtipos.length === 0) return null;

  // Com filtro ativo, expande automaticamente
  const expandido = filtro ? true : aberto;

  return (
    <div>
      <button
        onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-900/50 text-left"
      >
        {expandido ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <span className="text-[11px] font-semibold flex-1">{categoria.label}</span>
        <span className="text-[9px] text-muted-foreground">{categoria.tipos.length}</span>
      </button>
      {expandido && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 dark:border-slate-800 pl-1">
          {subtipos.map((t) => (
            <PassoItem key={t.id} tipo={t} onAdicionar={onAdicionar} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Popover "Trocar gatilho" — lista todos os gatilhos disponíveis,
 * agrupados por categoria. Clicar troca e fecha o popover.
 */
function TrocarGatilhoPopover({
  gatilhoAtual,
  onEscolher,
}: {
  gatilhoAtual: GatilhoSmartflow;
  onEscolher: (g: GatilhoSmartflow) => void;
}) {
  const [open, setOpen] = useState(false);

  // Agrupa por categoria visual
  const porGrupo = useMemo(() => {
    const m = new Map<GrupoSmartflow, GatilhoMeta[]>();
    for (const g of GATILHO_META) {
      if (g.oculto) continue; // gatilhos legados (ex: WhatsApp QR) não aparecem pra escolher
      const list = m.get(g.grupo) ?? [];
      list.push(g);
      m.set(g.grupo, list);
    }
    return Array.from(m.entries());
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-2 text-[11px] h-7 gap-1.5 bg-white dark:bg-slate-950"
        >
          <Repeat className="w-3 h-3" />
          Trocar gatilho
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2 px-1">
          Escolha o evento que dispara o fluxo
        </p>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {porGrupo.map(([grupo, gatilhos]) => {
            const grupoMeta = GRUPO_META.find((g) => g.id === grupo);
            const GIcon = GRUPO_ICON[grupo] ?? Sparkles;
            const corIcone = GRUPO_COR_ICONE[grupo] ?? "text-slate-500";
            return (
              <div key={grupo}>
                <div className="flex items-center gap-1.5 px-1 mb-1">
                  <GIcon className={`w-3 h-3 ${corIcone}`} />
                  <p className="text-[10px] font-bold text-muted-foreground">
                    {grupoMeta?.label || grupo}
                  </p>
                </div>
                <div className="space-y-0.5">
                  {gatilhos.map((g) => {
                    const ativo = g.id === gatilhoAtual;
                    const GatIcon = GATILHO_ICON[g.id] ?? Zap;
                    return (
                      <button
                        key={g.id}
                        onClick={() => {
                          onEscolher(g.id);
                          setOpen(false);
                        }}
                        className={`w-full flex items-start gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                          ativo
                            ? "bg-violet-100 dark:bg-violet-950/40 border border-violet-300 dark:border-violet-800"
                            : "hover:bg-slate-100 dark:hover:bg-slate-900/50"
                        }`}
                      >
                        <GatIcon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${ativo ? "text-violet-600" : "text-muted-foreground"}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[11px] font-semibold leading-tight ${ativo ? "text-violet-700 dark:text-violet-300" : ""}`}>
                            {g.label}
                          </p>
                          <p className="text-[9px] text-muted-foreground line-clamp-1 mt-0.5">{g.descricao}</p>
                        </div>
                        {ativo && (
                          <CheckCircle2 className="w-3 h-3 text-violet-600 shrink-0 mt-1" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
