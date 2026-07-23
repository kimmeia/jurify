import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  Handshake, Plus, Loader2, TableIcon, Columns3, Phone, X, Pencil,
} from "lucide-react";

// ─── moeda em centavos (int no backend) ──────────────────────────────────────
const brl = (cents?: number | null) =>
  cents == null ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** "1.800,00" ou "1800.00" → centavos int. */
const paraCentavos = (s: string): number | undefined => {
  const limpo = s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
};
/** centavos int → "1800,00" (pra pré-preencher input de edição). */
const centsParaInput = (c?: number | null): string => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

type StatusAcordo = "negociando" | "proposta_enviada" | "fechado" | "cancelado";
const STATUS_META: Record<StatusAcordo, { label: string; cls: string; dot: string }> = {
  negociando: { label: "Negociando", cls: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300", dot: "bg-amber-500" },
  proposta_enviada: { label: "Proposta enviada", cls: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300", dot: "bg-blue-500" },
  fechado: { label: "Fechado", cls: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300", dot: "bg-emerald-500" },
  cancelado: { label: "Cancelado", cls: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300", dot: "bg-rose-500" },
};
const iniciais = (n?: string | null) => (n || "?").split(" ").slice(0, 2).map((x) => x[0]).join("").toUpperCase();
const timeAgo = (iso?: string) => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3.6e6);
  if (h < 1) return "agora há pouco";
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
};

function StatusBadge({ s }: { s: StatusAcordo }) {
  const m = STATUS_META[s];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />{m.label}
    </span>
  );
}

// ─── termômetro de valores ────────────────────────────────────────────────────
// Régua normalizada entre o LIMITE (disponível, 0%) e a META (pretendido, 100%),
// então a leitura vale nos dois sentidos: cobrando (quer o maior) ou pagando
// (quer o menor). A direção é inferida por pretendido × disponível — sem toggle.
type Termometro = {
  atual: number;
  progresso: number;      // 0..100 — posição da proposta atual rumo à meta
  distanciaMeta: number;  // centavos, sempre >= 0
  atingiuMeta: boolean;
  estourou: boolean;      // proposta passou do limite (lado errado da régua)
  cor: "rose" | "amber" | "emerald";
  cobrando: boolean;      // meta acima do limite = quer o maior
};
function calcTermometro(a: {
  valorInicial?: number | null; valorPretendido?: number | null;
  valorDisponivel?: number | null; valorProposta?: number | null;
}): Termometro | null {
  const ini = a.valorInicial, pre = a.valorPretendido, dis = a.valorDisponivel;
  if (ini == null || pre == null || dis == null) return null;
  const atual = a.valorProposta ?? ini;
  const span = pre - dis; // meta - limite (pode ser negativo ao pagar)
  const raw = span === 0 ? (atual === pre ? 100 : 0) : ((atual - dis) / span) * 100;
  const progresso = Math.max(0, Math.min(100, raw));
  const cor: Termometro["cor"] = progresso >= 85 ? "emerald" : progresso >= 40 ? "amber" : "rose";
  return {
    atual, progresso, distanciaMeta: Math.abs(pre - atual),
    atingiuMeta: raw >= 100, estourou: raw <= 0, cor, cobrando: pre >= dis,
  };
}
const COR_PILL: Record<Termometro["cor"], string> = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
};
const COR_TXT: Record<Termometro["cor"], string> = { emerald: "text-emerald-600", amber: "text-amber-600", rose: "text-rose-600" };
const COR_FILL: Record<Termometro["cor"], string> = { emerald: "bg-emerald-500", amber: "bg-amber-400", rose: "bg-rose-400" };
const EMOJI: Record<Termometro["cor"], string> = { emerald: "🟢", amber: "🟡", rose: "🔴" };
function statusTermometro(t: Termometro): string {
  if (t.atingiuMeta) return "meta atingida";
  if (t.estourou) return t.cobrando ? "abaixo do limite" : "acima do limite";
  return `a ${brl(t.distanciaMeta)} da meta`;
}

/** Barra compacta pra tabela/kanban — mostra o progresso rumo à meta de longe. */
function MiniBarra({ a }: { a: any }) {
  const t = calcTermometro(a);
  if (!t || a.status === "cancelado") return null;
  return (
    <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full ${COR_FILL[t.cor]}`} style={{ width: `${Math.max(4, t.progresso)}%` }} />
    </div>
  );
}

/** Painel de valores com a régua (usado no drawer de detalhe). */
function PainelTermometro({ a }: { a: any }) {
  const t = calcTermometro(a);
  if (!t) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-900 p-3 mb-4">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Valores da negociação</p>
        <p className="text-[12px] text-muted-foreground">Marcos ainda não informados. Toque em <b>Editar</b> para definir inicial, pretendido e disponível — o termômetro aparece em seguida.</p>
        <p className="text-lg font-bold tabular-nums mt-1">{brl(a.valorProposta)}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Valores da negociação</p>
        <span className={`text-[10px] rounded-full px-2 py-0.5 font-semibold ${COR_PILL[t.cor]}`}>{EMOJI[t.cor]} {statusTermometro(t)}</span>
      </div>
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[12px] text-muted-foreground">Proposta atual</span>
        <span className="text-2xl font-bold tabular-nums">{brl(t.atual)}</span>
      </div>
      <div className="relative pt-1 pb-1">
        <div className="h-2.5 rounded-full bg-gradient-to-r from-rose-300 via-amber-300 to-emerald-400" />
        <div className="absolute" style={{ left: `${t.progresso}%`, top: "2px", transform: "translateX(-50%)" }}>
          <div className="w-4 h-4 rounded-full bg-slate-900 dark:bg-white border-2 border-white dark:border-slate-900 shadow" />
        </div>
      </div>
      <div className="flex justify-between text-[11px] mt-1">
        <span className="text-rose-600 font-medium">Limite · <span className="tabular-nums">{brl(a.valorDisponivel)}</span></span>
        <span className="text-emerald-700 font-medium">Meta · <span className="tabular-nums">{brl(a.valorPretendido)}</span></span>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t text-[12px]">
        <span className="text-muted-foreground">Valor inicial (âncora)</span>
        <span className="tabular-nums text-muted-foreground">{brl(a.valorInicial)}</span>
      </div>
      <div className="flex items-center justify-between text-[12px] mt-1">
        <span className="text-muted-foreground">Progresso rumo à meta</span>
        <span className={`tabular-nums font-semibold ${COR_TXT[t.cor]}`}>{Math.round(t.progresso)}%</span>
      </div>
    </div>
  );
}

export default function Acordos() {
  const [vista, setVista] = useState<"tabela" | "kanban">("tabela");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | StatusAcordo>("todos");
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);

  const { data: acordos = [], isLoading, refetch } = trpc.acordos.listar.useQuery(
    filtroStatus === "todos" ? {} : { status: filtroStatus },
  );
  const { data: resumo } = trpc.acordos.resumo.useQuery();

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return acordos;
    return acordos.filter((a: any) =>
      (a.clienteNome || "").toLowerCase().includes(q) ||
      (a.parteContraria || "").toLowerCase().includes(q));
  }, [acordos, busca]);

  const onUpdate = () => { refetch(); };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Cabeçalho */}
      <header className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Handshake className="h-6 w-6 text-violet-600" /> Acordos
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Negociações extrajudiciais do escritório numa tela só — sem abrir cliente por cliente.
          </p>
        </div>
        <Button onClick={() => setNovoAberto(true)} className="bg-violet-600 hover:bg-violet-700">
          <Plus className="h-4 w-4 mr-1.5" /> Novo acordo
        </Button>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi titulo="Em negociação" valor={`${resumo?.emNegociacao ?? 0}`} sufixo="acordos" />
        <Kpi titulo="Valor em negociação" valor={brl(resumo?.valorEmNegociacao)} cor="text-amber-600" />
        <Kpi titulo="Fechados no mês" valor={brl(resumo?.valorFechadoMes)} sufixo={`(${resumo?.fechadosMes ?? 0})`} cor="text-emerald-600" />
        <Kpi titulo="Taxa de fechamento" valor={`${resumo?.taxaFechamento ?? 0}%`} />
      </div>

      {/* Controles */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="inline-flex rounded-lg border bg-background p-0.5 text-sm">
          <button onClick={() => setVista("tabela")} className={`px-3 py-1.5 rounded-md font-medium inline-flex items-center gap-1.5 ${vista === "tabela" ? "bg-violet-600 text-white" : "text-muted-foreground"}`}>
            <TableIcon className="h-3.5 w-3.5" /> Tabela
          </button>
          <button onClick={() => setVista("kanban")} className={`px-3 py-1.5 rounded-md font-medium inline-flex items-center gap-1.5 ${vista === "kanban" ? "bg-violet-600 text-white" : "text-muted-foreground"}`}>
            <Columns3 className="h-3.5 w-3.5" /> Kanban
          </button>
        </div>
        <Input placeholder="Buscar por cliente ou parte contrária…" value={busca} onChange={(e) => setBusca(e.target.value)} className="flex-1 min-w-[200px]" />
        <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as any)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="negociando">Negociando</SelectItem>
            <SelectItem value="proposta_enviada">Proposta enviada</SelectItem>
            <SelectItem value="fechado">Fechado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…</div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-16 border rounded-2xl bg-muted/20">
          <Handshake className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Nenhum acordo ainda. Clique em <b>Novo acordo</b> para registrar a primeira negociação.</p>
        </div>
      ) : vista === "tabela" ? (
        <TabelaAcordos acordos={filtrados} onAbrir={setDetalheId} />
      ) : (
        <KanbanAcordos acordos={filtrados} onAbrir={setDetalheId} />
      )}

      {detalheId != null && (
        <DrawerDetalhe id={detalheId} onClose={() => setDetalheId(null)} onUpdate={onUpdate} />
      )}
      {novoAberto && <DialogNovo onClose={() => setNovoAberto(false)} onCriado={onUpdate} />}
    </div>
  );
}

function Kpi({ titulo, valor, sufixo, cor }: { titulo: string; valor: string; sufixo?: string; cor?: string }) {
  return (
    <div className="bg-background rounded-2xl border p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{titulo}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${cor || ""}`}>{valor} {sufixo && <span className="text-sm font-medium text-muted-foreground">{sufixo}</span>}</p>
    </div>
  );
}

function TabelaAcordos({ acordos, onAbrir }: { acordos: any[]; onAbrir: (id: number) => void }) {
  return (
    <div className="bg-background rounded-2xl border overflow-x-auto">
      <table className="w-full text-[13px] min-w-[860px]">
        <thead>
          <tr className="text-left text-muted-foreground text-[10px] uppercase tracking-wide border-b bg-muted/40">
            <th className="px-4 py-2.5 font-semibold">Cliente</th>
            <th className="px-4 py-2.5 font-semibold">Parte contrária</th>
            <th className="px-4 py-2.5 font-semibold">Contato (quem negocia)</th>
            <th className="px-4 py-2.5 font-semibold">Responsável</th>
            <th className="px-4 py-2.5 font-semibold text-right">Proposta</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
            <th className="px-4 py-2.5 font-semibold">Atualizado</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {acordos.map((a) => (
            <tr key={a.id} className="hover:bg-violet-50/40 dark:hover:bg-violet-950/20 cursor-pointer" onClick={() => onAbrir(a.id)}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold flex items-center justify-center shrink-0">{iniciais(a.clienteNome)}</div>
                  <div className="min-w-0"><p className="font-medium truncate">{a.clienteNome}</p>{(a.processoApelido || a.processoNumeroCnj) && <p className="text-[11px] text-muted-foreground truncate">{a.processoApelido || a.processoNumeroCnj}</p>}</div>
                </div>
              </td>
              <td className="px-4 py-3">{a.parteContraria}</td>
              <td className="px-4 py-3">
                <p>{a.contatoContrarioNome || "—"}</p>
                {a.contatoContrarioTelefone && <p className="text-[11px] text-emerald-600 tabular-nums">{a.contatoContrarioTelefone}</p>}
              </td>
              <td className="px-4 py-3">{a.responsavelNome || "—"}</td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold min-w-[120px]">
                {brl(a.valorProposta)}
                {a.valorFechado != null && <p className="text-[10px] text-emerald-600 font-normal">fechou {brl(a.valorFechado)}</p>}
                <MiniBarra a={a} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge s={a.status} />
                {a.motivoCancelamento && <p className="text-[10px] text-rose-500 mt-0.5">{a.motivoCancelamento}</p>}
              </td>
              <td className="px-4 py-3 text-muted-foreground text-[12px]">{timeAgo(a.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KanbanAcordos({ acordos, onAbrir }: { acordos: any[]; onAbrir: (id: number) => void }) {
  const cols: StatusAcordo[] = ["negociando", "proposta_enviada", "fechado", "cancelado"];
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {cols.map((s) => {
        const items = acordos.filter((a) => a.status === s);
        return (
          <div key={s} className="bg-muted/30 rounded-2xl border p-2.5">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-[12px] font-semibold flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${STATUS_META[s].dot}`} />{STATUS_META[s].label}</span>
              <span className="text-[11px] text-muted-foreground">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((a) => (
                <div key={a.id} onClick={() => onAbrir(a.id)} className="bg-background rounded-xl border p-3 cursor-pointer hover:border-violet-300">
                  <p className="font-medium text-[13px]">{a.clienteNome}</p>
                  <p className="text-[11px] text-muted-foreground mb-1.5">vs {a.parteContraria}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-bold tabular-nums">{brl(a.valorProposta)}</span>
                    <span className="text-[11px] text-muted-foreground">{a.responsavelNome || "—"}</span>
                  </div>
                  <MiniBarra a={a} />
                  {a.motivoCancelamento && <p className="text-[10px] text-rose-500 mt-1.5 border-t pt-1.5">✕ {a.motivoCancelamento}</p>}
                  {a.valorFechado != null && <p className="text-[10px] text-emerald-600 mt-1.5 border-t pt-1.5">✓ fechou em {brl(a.valorFechado)}</p>}
                </div>
              ))}
              {items.length === 0 && <p className="text-[11px] text-muted-foreground/50 text-center py-3">vazio</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ICONE_TIPO: Record<string, string> = { proposta: "💬", contraproposta: "↩️", nota: "📝", fechamento: "✅", cancelamento: "✕" };

function DrawerDetalhe({ id, onClose, onUpdate }: { id: number; onClose: () => void; onUpdate: () => void }) {
  const { data: a, isLoading, refetch } = trpc.acordos.obter.useQuery({ id });
  const [cancelarAberto, setCancelarAberto] = useState(false);
  const [tratAberto, setTratAberto] = useState(false);
  const [fecharAberto, setFecharAberto] = useState(false);
  const [editarAberto, setEditarAberto] = useState(false);
  const atualizar = () => { refetch(); onUpdate(); };
  const emAberto = a?.status === "negociando" || a?.status === "proposta_enviada";

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0">
        {isLoading || !a ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <>
            <div className="px-5 py-4 border-b">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-10 w-10 rounded-full bg-violet-100 text-violet-700 text-sm font-bold flex items-center justify-center dark:bg-violet-950/40 dark:text-violet-300">{iniciais((a as any).clienteNome)}</div>
                  <div>
                    <p className="font-bold leading-tight">{(a as any).clienteNome ?? "Cliente"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Acordo #{a.id}
                      {((a as any).processoApelido || (a as any).processoNumeroCnj) && <> · {(a as any).processoApelido || (a as any).processoNumeroCnj}</>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {emAberto && (
                    <button onClick={() => setEditarAberto(true)}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-600 border border-violet-200 rounded-lg px-2 py-1 hover:bg-violet-50 dark:border-violet-900 dark:hover:bg-violet-950/40">
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                  )}
                  <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <StatusBadge s={a.status as StatusAcordo} />
                {(a as any).responsavelNome && (
                  <span className="text-[12px] text-muted-foreground">Responsável: <span className="font-medium text-foreground">{(a as any).responsavelNome}</span></span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="rounded-xl border p-3 mb-4">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">Parte contrária</p>
                <p className="font-medium text-[14px]">{a.parteContraria}</p>
                <div className="flex items-center justify-between mt-2">
                  <div>
                    <p className="text-[13px]">{a.contatoContrarioNome || "—"}</p>
                    {a.contatoContrarioTelefone && <p className="text-[12px] text-muted-foreground tabular-nums">{a.contatoContrarioTelefone}</p>}
                  </div>
                  {a.contatoContrarioTelefone && (
                    <a href={`https://wa.me/${a.contatoContrarioTelefone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <Phone className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  )}
                </div>
              </div>

              <PainelTermometro a={a} />
              {a.valorFechado != null && (
                <div className="flex items-center justify-between mb-4 rounded-xl border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-900 px-3 py-2 text-[13px]">
                  <span className="text-emerald-700 dark:text-emerald-300 font-semibold">Fechado em</span>
                  <span className="text-emerald-700 dark:text-emerald-300 font-bold tabular-nums">{brl(a.valorFechado)}</span>
                </div>
              )}
              {a.motivoCancelamento && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-[12px] text-rose-700 mb-4 dark:bg-rose-950/30 dark:text-rose-300">
                  Motivo do cancelamento: <b>{a.motivoCancelamento}</b>
                </div>
              )}

              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 mt-4">Histórico da negociação</p>
              <div className="space-y-3">
                {(a.tratativas || []).map((t: any) => (
                  <div key={t.id} className="flex gap-2.5">
                    <div className="mt-0.5">{ICONE_TIPO[t.tipo] || "•"}</div>
                    <div className="flex-1 border-l-2 border-muted pl-3 -ml-1">
                      <p className="text-[13px]">{t.conteudo}{t.valor != null && <span className="font-semibold tabular-nums"> · {brl(t.valor)}</span>}</p>
                      <p className="text-[11px] text-muted-foreground">{t.autor} · {new Date(t.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  </div>
                ))}
                {(a.tratativas || []).length === 0 && <p className="text-[12px] text-muted-foreground">Sem tratativas registradas.</p>}
              </div>
            </div>

            <div className="px-5 py-3 border-t">
              {a.status === "negociando" || a.status === "proposta_enviada" ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="flex-1 bg-violet-600 hover:bg-violet-700" onClick={() => setTratAberto(true)}>＋ Registrar</Button>
                  <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setFecharAberto(true)}>✓ Fechar</Button>
                  <Button size="sm" variant="outline" className="border-rose-200 text-rose-600 hover:text-rose-700" onClick={() => setCancelarAberto(true)}>Cancelar</Button>
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground text-center">Acordo {STATUS_META[a.status as StatusAcordo].label.toLowerCase()} — somente leitura.</p>
              )}
            </div>

            {tratAberto && <DialogTratativa acordoId={a.id} onClose={() => setTratAberto(false)} onFeito={atualizar} />}
            {fecharAberto && <DialogFechar acordoId={a.id} valorAtual={a.valorProposta} onClose={() => setFecharAberto(false)} onFeito={() => { atualizar(); }} />}
            {cancelarAberto && <DialogCancelar acordoId={a.id} onClose={() => setCancelarAberto(false)} onFeito={() => { atualizar(); }} />}
            {editarAberto && <DialogEditar a={a} onClose={() => setEditarAberto(false)} onFeito={atualizar} />}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DialogNovo({ onClose, onCriado }: { onClose: () => void; onCriado: () => void }) {
  const [contatoId, setContatoId] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  const [parteContraria, setParteContraria] = useState("");
  const [contatoNome, setContatoNome] = useState("");
  const [contatoTel, setContatoTel] = useState("");
  const [valInicial, setValInicial] = useState("");
  const [valPretendido, setValPretendido] = useState("");
  const [valDisponivel, setValDisponivel] = useState("");
  const [processoId, setProcessoId] = useState<string>("nenhum");

  const { data: clientesData } = trpc.clientes.listar.useQuery({ busca: busca || undefined, limite: 20, estagio: "todos" }, { enabled: busca.length >= 2 });
  const clientes = (clientesData as any)?.clientes ?? [];
  const { data: processos = [] } = trpc.clienteProcessos.listar.useQuery({ contatoId: contatoId! }, { enabled: !!contatoId });

  const criar = trpc.acordos.criar.useMutation({
    onSuccess: () => { toast.success("Acordo criado"); onCriado(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const submeter = () => {
    if (!contatoId) { toast.error("Selecione o cliente"); return; }
    if (!parteContraria.trim()) { toast.error("Informe a parte contrária"); return; }
    const ini = paraCentavos(valInicial), pre = paraCentavos(valPretendido), dis = paraCentavos(valDisponivel);
    if (ini == null || pre == null || dis == null) { toast.error("Preencha os três valores da negociação"); return; }
    criar.mutate({
      contatoId,
      processoId: processoId !== "nenhum" ? Number(processoId) : undefined,
      parteContraria: parteContraria.trim(),
      contatoContrarioNome: contatoNome.trim() || undefined,
      contatoContrarioTelefone: contatoTel.trim() || undefined,
      valorInicial: ini,
      valorPretendido: pre,
      valorDisponivel: dis,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Novo acordo</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px] max-h-[70vh] overflow-y-auto">
          <div>
            <Label className="text-[12px]">Cliente</Label>
            {contatoId ? (
              <div className="flex items-center justify-between border rounded-lg px-3 py-2 mt-1">
                <span className="font-medium">{clientes.find((c: any) => c.id === contatoId)?.nome || busca}</span>
                <button onClick={() => { setContatoId(null); setProcessoId("nenhum"); }} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <>
                <Input placeholder="Buscar cliente do escritório…" value={busca} onChange={(e) => setBusca(e.target.value)} className="mt-1" />
                {clientes.length > 0 && (
                  <div className="border rounded-lg mt-1 max-h-40 overflow-y-auto divide-y">
                    {clientes.map((c: any) => (
                      <button key={c.id} onClick={() => setContatoId(c.id)} className="w-full text-left px-3 py-2 hover:bg-muted">
                        <p className="font-medium">{c.nome}</p>{c.telefone && <p className="text-[11px] text-muted-foreground">{c.telefone}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {contatoId && processos.length > 0 && (
            <div>
              <Label className="text-[12px]">Processo vinculado <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Select value={processoId} onValueChange={setProcessoId}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">— nenhum / extrajudicial puro —</SelectItem>
                  {(processos as any[]).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.apelido || p.numeroCnj || `Processo #${p.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div><Label className="text-[12px]">Parte contrária</Label><Input placeholder="Ex.: Construtora Alfa Ltda" value={parteContraria} onChange={(e) => setParteContraria(e.target.value)} className="mt-1" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-[12px]">Contato (outro lado)</Label><Input placeholder="Ex.: Dr. Ricardo" value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-[12px]">Telefone do contato</Label><Input placeholder="(85) 9…" value={contatoTel} onChange={(e) => setContatoTel(e.target.value)} className="mt-1 tabular-nums" /></div>
          </div>

          <div className="border-t pt-3">
            <Label className="text-[12px] font-semibold">Valores da negociação</Label>
            <div className="grid grid-cols-3 gap-2 mt-1.5">
              <div><Label className="text-[11px] text-muted-foreground">Inicial <span className="text-muted-foreground/60">âncora</span></Label><Input placeholder="R$ 0,00" value={valInicial} onChange={(e) => setValInicial(e.target.value)} className="mt-1 tabular-nums" /></div>
              <div><Label className="text-[11px] text-emerald-700">Pretendido <span className="text-muted-foreground/60">meta</span></Label><Input placeholder="R$ 0,00" value={valPretendido} onChange={(e) => setValPretendido(e.target.value)} className="mt-1 tabular-nums border-emerald-300" /></div>
              <div><Label className="text-[11px] text-rose-700">Disponível <span className="text-muted-foreground/60">limite</span></Label><Input placeholder="R$ 0,00" value={valDisponivel} onChange={(e) => setValDisponivel(e.target.value)} className="mt-1 tabular-nums border-rose-200" /></div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">A proposta atual nasce do <b>inicial</b> e o sentido (cobrar = quer o maior / pagar = quer o menor) é detectado automaticamente por <b>pretendido × disponível</b>.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button className="bg-violet-600 hover:bg-violet-700" onClick={submeter} disabled={criar.isPending}>
            {criar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Criar acordo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogEditar({ a, onClose, onFeito }: { a: any; onClose: () => void; onFeito: () => void }) {
  const [parteContraria, setParteContraria] = useState<string>(a.parteContraria ?? "");
  const [contatoNome, setContatoNome] = useState<string>(a.contatoContrarioNome ?? "");
  const [contatoTel, setContatoTel] = useState<string>(a.contatoContrarioTelefone ?? "");
  const [responsavelUserId, setResponsavelUserId] = useState<string | undefined>(undefined);
  const [processoId, setProcessoId] = useState<string>(a.processoId != null ? String(a.processoId) : "nenhum");
  const [valInicial, setValInicial] = useState<string>(centsParaInput(a.valorInicial));
  const [valPretendido, setValPretendido] = useState<string>(centsParaInput(a.valorPretendido));
  const [valDisponivel, setValDisponivel] = useState<string>(centsParaInput(a.valorDisponivel));

  const { data: colabData } = trpc.configuracoes.listarColaboradoresParaFiltro.useQuery({ modulo: "clientes" });
  const colaboradores = (colabData as any)?.colaboradores ?? [];
  const { data: processos = [] } = trpc.clienteProcessos.listar.useQuery({ contatoId: a.contatoId }, { enabled: !!a.contatoId });
  const respAtualUserId = colaboradores.find((c: any) => c.id === a.responsavelId)?.userId;
  const respValue = responsavelUserId ?? (respAtualUserId != null ? String(respAtualUserId) : "");

  const m = trpc.acordos.editar.useMutation({
    onSuccess: () => { toast.success("Acordo atualizado"); onFeito(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const salvar = () => {
    if (!parteContraria.trim()) { toast.error("Informe a parte contrária"); return; }
    const ini = paraCentavos(valInicial), pre = paraCentavos(valPretendido), dis = paraCentavos(valDisponivel);
    if (ini == null || pre == null || dis == null) { toast.error("Preencha os três valores da negociação"); return; }
    m.mutate({
      id: a.id,
      parteContraria: parteContraria.trim(),
      contatoContrarioNome: contatoNome.trim() || undefined,
      contatoContrarioTelefone: contatoTel.trim() || undefined,
      responsavelUserId: respValue ? Number(respValue) : undefined,
      processoId: processoId !== "nenhum" ? Number(processoId) : null,
      valorInicial: ini,
      valorPretendido: pre,
      valorDisponivel: dis,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Editar acordo</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px] max-h-[70vh] overflow-y-auto">
          <div className="text-[12px] text-muted-foreground">Cliente: <b className="text-foreground">{a.clienteNome}</b> <span className="text-muted-foreground/60">(fixo — vinculado ao cadastro)</span></div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-[12px]">Parte contrária</Label><Input value={parteContraria} onChange={(e) => setParteContraria(e.target.value)} className="mt-1" /></div>
            <div>
              <Label className="text-[12px]">Responsável</Label>
              <Select value={respValue} onValueChange={setResponsavelUserId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                <SelectContent>
                  {colaboradores.map((c: any) => (
                    <SelectItem key={c.userId} value={String(c.userId)}>{c.userName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-[12px]">Contato (outro lado)</Label><Input value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-[12px]">Telefone do contato</Label><Input value={contatoTel} onChange={(e) => setContatoTel(e.target.value)} className="mt-1 tabular-nums" /></div>
          </div>
          <div>
            <Label className="text-[12px]">Processo vinculado</Label>
            <Select value={processoId} onValueChange={setProcessoId}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">— nenhum / extrajudicial puro —</SelectItem>
                {(processos as any[]).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.apelido || p.numeroCnj || `Processo #${p.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="border-t pt-3">
            <Label className="text-[12px] font-semibold">Valores da negociação</Label>
            <div className="grid grid-cols-3 gap-2 mt-1.5">
              <div><Label className="text-[11px] text-muted-foreground">Inicial <span className="text-muted-foreground/60">âncora</span></Label><Input value={valInicial} onChange={(e) => setValInicial(e.target.value)} className="mt-1 tabular-nums" /></div>
              <div><Label className="text-[11px] text-emerald-700">Pretendido <span className="text-muted-foreground/60">meta</span></Label><Input value={valPretendido} onChange={(e) => setValPretendido(e.target.value)} className="mt-1 tabular-nums border-emerald-300" /></div>
              <div><Label className="text-[11px] text-rose-700">Disponível <span className="text-muted-foreground/60">limite</span></Label><Input value={valDisponivel} onChange={(e) => setValDisponivel(e.target.value)} className="mt-1 tabular-nums border-rose-200" /></div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">A proposta atual (R$ {centsParaInput(a.valorProposta) || "0,00"}) vem da última tratativa — muda ao registrar proposta/contraproposta, não aqui.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button className="bg-violet-600 hover:bg-violet-700" onClick={salvar} disabled={m.isPending}>
            {m.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogTratativa({ acordoId, onClose, onFeito }: { acordoId: number; onClose: () => void; onFeito: () => void }) {
  const [tipo, setTipo] = useState<"proposta" | "contraproposta" | "nota">("proposta");
  const [valor, setValor] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [daContraria, setDaContraria] = useState(false);
  const m = trpc.acordos.registrarTratativa.useMutation({
    onSuccess: () => { toast.success("Tratativa registrada"); onFeito(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Registrar tratativa</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <div>
            <Label className="text-[12px]">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="proposta">Proposta (nossa)</SelectItem>
                <SelectItem value="contraproposta">Contraproposta</SelectItem>
                <SelectItem value="nota">Nota / andamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {tipo !== "nota" && (
            <div><Label className="text-[12px]">Valor</Label><Input placeholder="R$ 0,00" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1 tabular-nums" /></div>
          )}
          <div><Label className="text-[12px]">Descrição</Label><Textarea placeholder="O que foi tratado…" value={conteudo} onChange={(e) => setConteudo(e.target.value)} className="mt-1 h-20" /></div>
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={daContraria} onChange={(e) => setDaContraria(e.target.checked)} /> Registro veio da parte contrária
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button className="bg-violet-600 hover:bg-violet-700" disabled={m.isPending || !conteudo.trim()} onClick={() =>
            m.mutate({ acordoId, tipo, valor: valor ? paraCentavos(valor) : undefined, conteudo: conteudo.trim(), daParteContraria: daContraria })
          }>{m.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogFechar({ acordoId, valorAtual, onClose, onFeito }: { acordoId: number; valorAtual?: number | null; onClose: () => void; onFeito: () => void }) {
  const [valor, setValor] = useState(valorAtual != null ? String((valorAtual / 100).toFixed(2)).replace(".", ",") : "");
  const m = trpc.acordos.fechar.useMutation({
    onSuccess: () => { toast.success("Acordo fechado 🎉"); onFeito(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="text-emerald-700">Fechar acordo</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <div><Label className="text-[12px]">Valor final acordado</Label><Input placeholder="R$ 0,00" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1 tabular-nums" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={m.isPending} onClick={() => {
            const c = paraCentavos(valor);
            if (c == null) { toast.error("Informe o valor"); return; }
            m.mutate({ acordoId, valorFechado: c });
          }}>{m.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Confirmar fechamento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MOTIVOS = [
  "Cliente preferiu prosseguir com a ação",
  "Parte contrária recusou a proposta",
  "Valor abaixo do aceitável",
  "Sem resposta da parte contrária",
  "Outro",
];
function DialogCancelar({ acordoId, onClose, onFeito }: { acordoId: number; onClose: () => void; onFeito: () => void }) {
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [obs, setObs] = useState("");
  const m = trpc.acordos.cancelar.useMutation({
    onSuccess: () => { toast.success("Acordo cancelado"); onFeito(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="text-rose-700">Cancelar acordo</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <p className="text-muted-foreground">O motivo fica registrado no histórico e aparece na lista.</p>
          <div>
            <Label className="text-[12px]">Motivo</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{MOTIVOS.map((mo) => <SelectItem key={mo} value={mo}>{mo}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Textarea placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} className="h-20" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button className="bg-rose-600 hover:bg-rose-700" disabled={m.isPending} onClick={() => m.mutate({ acordoId, motivo, observacao: obs.trim() || undefined })}>
            {m.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Confirmar cancelamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
