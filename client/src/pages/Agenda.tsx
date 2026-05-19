import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  CalendarDays, Plus, Loader2, Clock, CheckCircle, ChevronLeft, ChevronRight,
  Trash2, ListTodo, CalendarClock, Sun, AlertTriangle, Search,
  Briefcase, Scale, Users, PhoneCall, MoreHorizontal, Check, MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { PulseDot, gradientAvatar, gerarIniciais } from "./dashboards/common";

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const TIPO_LABELS: Record<string, string> = {
  prazo_processual: "Prazo", audiencia: "Audiência", reuniao_comercial: "Reunião",
  tarefa: "Tarefa", follow_up: "Follow-up", outro: "Outro",
};

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente", em_andamento: "Em andamento", concluido: "Concluído",
  cancelado: "Cancelado", atrasado: "Atrasado", concluida: "Concluída", cancelada: "Cancelada",
};

const STATUS_CORES: Record<string, string> = {
  pendente: "bg-amber-100 text-amber-700 border-amber-200",
  em_andamento: "bg-blue-100 text-blue-700 border-blue-200",
  concluido: "bg-emerald-100 text-emerald-700 border-emerald-200",
  concluida: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelado: "bg-gray-100 text-gray-500 border-gray-200",
  cancelada: "bg-gray-100 text-gray-500 border-gray-200",
  atrasado: "bg-red-100 text-red-700 border-red-200",
};

const PRIOR_DOT: Record<string, string> = {
  urgente: "bg-red-500", critica: "bg-red-500", alta: "bg-orange-400", normal: "bg-blue-400", baixa: "bg-gray-300",
};

const PRIOR_LABEL: Record<string, string> = {
  urgente: "Urgente", critica: "Crítica", alta: "Alta", normal: "Normal", baixa: "Baixa",
};

const PRIOR_BADGE: Record<string, string> = {
  urgente: "bg-rose-100 text-rose-700",
  critica: "bg-rose-100 text-rose-700",
  alta: "bg-orange-100 text-orange-700",
  normal: "bg-slate-100 text-slate-600",
  baixa: "bg-slate-100 text-slate-500",
};

/** Cor da faixa lateral do EventoCard por tipo. Tarefas sempre violet. */
const COR_TIPO: Record<string, string> = {
  prazo_processual: "#f59e0b",
  audiencia: "#f43f5e",
  reuniao_comercial: "#3b82f6",
  tarefa: "#8b5cf6",
  follow_up: "#10b981",
  outro: "#64748b",
};

const TIPO_BADGE: Record<string, string> = {
  prazo_processual: "bg-amber-50 text-amber-700",
  audiencia: "bg-rose-50 text-rose-700",
  reuniao_comercial: "bg-blue-50 text-blue-700",
  tarefa: "bg-violet-50 text-violet-700",
  follow_up: "bg-emerald-50 text-emerald-700",
  outro: "bg-slate-100 text-slate-600",
};

function corDoEvento(ev: any): string {
  if (ev.fonte === "tarefa") return COR_TIPO.tarefa;
  if (ev.cor && ev.cor !== "#3b82f6") return ev.cor; // cor custom do user
  return COR_TIPO[ev.tipo] || COR_TIPO.outro;
}

function saudacaoContextual(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateFull(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
}

function isOverdue(dataInicio: string, status: string) {
  return new Date(dataInicio) < new Date() && ["pendente", "em_andamento"].includes(status);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CARD DE EVENTO
// ═══════════════════════════════════════════════════════════════════════════════

function EventoCard({ ev, onStatusChange, onDelete }: {
  ev: any;
  onStatusChange: (id: number, fonte: string, status: string) => void;
  onDelete: (id: number, fonte: string) => void;
}) {
  const overdue = isOverdue(ev.dataInicio, ev.status);
  const concluido = ev.status === "concluido" || ev.status === "concluida";
  const cancelado = ev.status === "cancelado" || ev.status === "cancelada";
  const cor = corDoEvento(ev);
  const tipoLabel = ev.fonte === "tarefa" ? "Tarefa" : TIPO_LABELS[ev.tipo] || ev.tipo;
  const prioridade = ev.prioridade || "normal";

  const inicio = new Date(ev.dataInicio);
  const hh = String(inicio.getHours()).padStart(2, "0");
  const mm = String(inicio.getMinutes()).padStart(2, "0");
  const horaInicio = `${hh}:${mm}`;
  const horaFim = ev.dataFim
    ? `${String(new Date(ev.dataFim).getHours()).padStart(2, "0")}:${String(new Date(ev.dataFim).getMinutes()).padStart(2, "0")}`
    : null;

  const responsavel = ev.responsavelNome;

  return (
    <div
      className={`group relative grid grid-cols-[64px_1fr_auto] gap-3 items-stretch bg-white border rounded-xl overflow-hidden transition-all hover:shadow-md hover:-translate-y-px ${
        overdue
          ? "border-rose-300 bg-gradient-to-r from-rose-50/60 to-white"
          : "border-slate-200 hover:border-slate-300"
      } ${concluido ? "opacity-60" : ""}`}
    >
      {/* Faixa lateral colorida por tipo */}
      <div className="w-[5px] shrink-0" style={{ background: cor }} />

      {/* Hora em destaque */}
      <div className="flex flex-col items-center justify-center py-2.5 min-w-[60px] border-r border-slate-100 -ml-3">
        {ev.diaInteiro ? (
          <p className="text-[9px] font-bold text-slate-500 tracking-wider text-center leading-tight">
            DIA<br />INTEIRO
          </p>
        ) : (
          <>
            <p className="text-lg font-bold text-slate-900 leading-none tabular-nums">{horaInicio}</p>
            {horaFim && (
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">{horaFim}</p>
            )}
          </>
        )}
      </div>

      {/* Conteúdo */}
      <div className="py-3 pr-2 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p
            className={`text-sm font-semibold leading-tight ${
              concluido ? "line-through text-slate-400" : cancelado ? "text-slate-400" : ""
            }`}
          >
            {ev.titulo}
          </p>
          {overdue && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">
              ⚠ Atrasado
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
          {ev.contatoNome && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              <span className="font-medium truncate max-w-[180px]">{ev.contatoNome}</span>
            </span>
          )}
          {ev.tipo && (
            <span
              className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                ev.fonte === "tarefa" ? TIPO_BADGE.tarefa : TIPO_BADGE[ev.tipo] || TIPO_BADGE.outro
              }`}
            >
              {tipoLabel}
            </span>
          )}
          {prioridade !== "normal" && (
            <span
              className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                PRIOR_BADGE[prioridade] || PRIOR_BADGE.normal
              }`}
            >
              {PRIOR_LABEL[prioridade] || prioridade}
            </span>
          )}
          {ev.local && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              <span className="truncate max-w-[140px]">{ev.local}</span>
            </span>
          )}
        </div>
      </div>

      {/* Avatar + ações */}
      <div className="flex items-center pr-3 gap-1.5">
        {responsavel && (
          <span
            className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-[0_0_0_2px_white] bg-gradient-to-br ${gradientAvatar(responsavel)}`}
            title={responsavel}
          >
            {gerarIniciais(responsavel)}
          </span>
        )}
        {!concluido && !cancelado && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-emerald-600 hover:bg-emerald-50"
            title="Concluir"
            onClick={(e) => {
              e.stopPropagation();
              onStatusChange(ev.id, ev.fonte, "concluido");
            }}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-rose-600 hover:bg-rose-50"
          title="Excluir"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("Excluir este evento?")) onDelete(ev.id, ev.fonte);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEW: CALENDÁRIO MENSAL
// ═══════════════════════════════════════════════════════════════════════════════

function CalendarioMensal({ eventos, onCriarEvento }: {
  eventos: any[];
  onCriarEvento?: () => void;
}) {
  const [mes, setMes] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [diaSelecionado, setDiaSelecionado] = useState<Date | null>(() => new Date());

  // Calendário ESTENDIDO (35 ou 42 dias) — preenche dias do mês anterior/seguinte
  // pra completar a grade 7 colunas × 5/6 linhas. Permite heatmap consistente.
  const grade = useMemo(() => {
    const first = new Date(mes.getFullYear(), mes.getMonth(), 1);
    const last = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const startOffset = first.getDay(); // 0=dom
    const dias: Array<{ date: Date; outroMes: boolean; eventos: any[] }> = [];

    // Dias do mês anterior pra preencher início da grade
    for (let i = startOffset; i > 0; i--) {
      const date = new Date(first);
      date.setDate(first.getDate() - i);
      dias.push({ date, outroMes: true, eventos: [] });
    }

    // Dias do mês corrente
    for (let d = 1; d <= last.getDate(); d++) {
      dias.push({
        date: new Date(mes.getFullYear(), mes.getMonth(), d),
        outroMes: false,
        eventos: [],
      });
    }

    // Dias do mês seguinte pra completar 6 semanas (42 células) ou 5 (35)
    const alvo = dias.length <= 35 ? 35 : 42;
    let dx = 1;
    while (dias.length < alvo) {
      const date = new Date(last);
      date.setDate(last.getDate() + dx);
      dias.push({ date, outroMes: true, eventos: [] });
      dx++;
    }

    // Associa eventos a cada dia (compara ano-mês-dia, ignora hora)
    const dateKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const mapaEventos = new Map<string, any[]>();
    for (const ev of eventos) {
      const k = dateKey(new Date(ev.dataInicio));
      const arr = mapaEventos.get(k) ?? [];
      arr.push(ev);
      mapaEventos.set(k, arr);
    }
    for (const dia of dias) {
      dia.eventos = mapaEventos.get(dateKey(dia.date)) ?? [];
    }

    return dias;
  }, [mes, eventos]);

  const isToday = (d: Date) => {
    const t = new Date();
    return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
  };
  const isSelected = (d: Date) => {
    if (!diaSelecionado) return false;
    return (
      d.getDate() === diaSelecionado.getDate() &&
      d.getMonth() === diaSelecionado.getMonth() &&
      d.getFullYear() === diaSelecionado.getFullYear()
    );
  };

  const mesLabel = mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const totalNoMes = grade.filter((d) => !d.outroMes).reduce((acc, d) => acc + d.eventos.length, 0);

  // Eventos do dia selecionado (pro painel lateral)
  const eventosDoDia = useMemo(() => {
    if (!diaSelecionado) return [];
    return grade.find(
      (d) =>
        d.date.getDate() === diaSelecionado.getDate() &&
        d.date.getMonth() === diaSelecionado.getMonth() &&
        d.date.getFullYear() === diaSelecionado.getFullYear(),
    )?.eventos ?? [];
  }, [grade, diaSelecionado]);

  // Heatmap tier: 0 = sem evento, 1 = 1-2 (amber), 2 = 3-4 (orange), 3 = 5+ (rose)
  function tier(count: number): 0 | 1 | 2 | 3 {
    if (count === 0) return 0;
    if (count <= 2) return 1;
    if (count <= 4) return 2;
    return 3;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold tracking-tight capitalize">{mesLabel}</h2>
          <p className="text-xs text-slate-500">{totalNoMes} evento(s) no mês</p>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-medium"
            onClick={() => {
              const hoje = new Date();
              setMes(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
              setDiaSelecionado(hoje);
            }}
          >
            Hoje
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Grid de dias */}
        <div>
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
              <div
                key={d}
                className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 text-center py-1"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {grade.map((dia, i) => {
              const t = tier(dia.eventos.length);
              const heatmapCls =
                dia.outroMes
                  ? "opacity-40 bg-slate-50 border-slate-200"
                  : t === 0
                    ? "bg-white border-slate-200"
                    : t === 1
                      ? "bg-amber-100 border-amber-200"
                      : t === 2
                        ? "bg-orange-200 border-orange-300"
                        : "bg-rose-200 border-rose-300";

              const numText =
                t === 0
                  ? "text-slate-400"
                  : t === 1
                    ? "text-amber-700"
                    : t === 2
                      ? "text-orange-700"
                      : "text-rose-700";

              return (
                <button
                  key={i}
                  onClick={() => setDiaSelecionado(dia.date)}
                  className={`aspect-square rounded-lg p-1.5 border text-left transition-all hover:scale-[1.02] ${heatmapCls} ${
                    isToday(dia.date)
                      ? "ring-2 ring-orange-500"
                      : isSelected(dia.date)
                        ? "ring-2 ring-slate-900"
                        : ""
                  }`}
                >
                  <p
                    className={`text-xs font-semibold ${dia.outroMes ? "text-slate-400" : isToday(dia.date) ? "text-orange-600 font-bold" : ""}`}
                  >
                    {dia.date.getDate()}
                  </p>
                  {!dia.outroMes && dia.eventos.length > 0 && (
                    <p className={`text-[9px] font-medium mt-1 ${numText}`}>
                      {isToday(dia.date) ? "HOJE · " : ""}
                      {dia.eventos.length} ev
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legenda heatmap */}
          <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
            <span>Eventos:</span>
            <span className="px-2 py-0.5 rounded border border-slate-200 bg-white">0</span>
            <span className="px-2 py-0.5 rounded border border-amber-200 bg-amber-100">1–2</span>
            <span className="px-2 py-0.5 rounded border border-orange-300 bg-orange-200">3–4</span>
            <span className="px-2 py-0.5 rounded border border-rose-300 bg-rose-200">5+</span>
          </div>
        </div>

        {/* Painel lateral: eventos do dia selecionado */}
        <aside className="bg-slate-50/50 border border-slate-200 rounded-xl p-3">
          {diaSelecionado ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                    {diaSelecionado.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}
                  </p>
                  <p className="text-base font-bold capitalize">
                    {diaSelecionado.toLocaleDateString("pt-BR", { weekday: "long" })}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    eventosDoDia.length === 0
                      ? "bg-slate-100 text-slate-500"
                      : "bg-orange-100 text-orange-700"
                  }`}
                >
                  {eventosDoDia.length} evento{eventosDoDia.length !== 1 ? "s" : ""}
                </span>
              </div>

              {eventosDoDia.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-4">
                  Dia sem compromissos.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {eventosDoDia
                    .sort((a: any, b: any) => new Date(a.dataInicio).getTime() - new Date(b.dataInicio).getTime())
                    .map((ev: any) => {
                      const cor = corDoEvento(ev);
                      const concluido = ev.status === "concluido" || ev.status === "concluida";
                      const inicio = new Date(ev.dataInicio);
                      return (
                        <div
                          key={`${ev.fonte}-${ev.id}`}
                          className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-white transition-colors ${concluido ? "opacity-60" : ""}`}
                        >
                          <span
                            className="w-1 h-7 rounded-full shrink-0"
                            style={{ background: cor }}
                          />
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-xs font-medium truncate ${concluido ? "line-through text-slate-400" : ""}`}
                            >
                              {ev.titulo}
                            </p>
                            <p className="text-[10px] text-slate-500 tabular-nums">
                              {ev.diaInteiro
                                ? "dia inteiro"
                                : `${String(inicio.getHours()).padStart(2, "0")}:${String(inicio.getMinutes()).padStart(2, "0")}`}
                              {ev.fonte === "compromisso" && ev.tipo === "prazo_processual" && " · prazo"}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {onCriarEvento && (
                <button
                  onClick={onCriarEvento}
                  className="w-full mt-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-dashed border-slate-300 rounded-lg hover:border-slate-400 transition-colors"
                >
                  + Adicionar evento neste dia
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-400 italic text-center py-8">
              Clique em um dia pra ver os eventos.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEW: HOJE
// ═══════════════════════════════════════════════════════════════════════════════

function HojeView({ onStatusChange, onDelete }: {
  onStatusChange: (id: number, fonte: string, status: string) => void;
  onDelete: (id: number, fonte: string) => void;
}) {
  const { data, isLoading } = trpc.agenda.hoje.useQuery(undefined, { refetchInterval: 30000 });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;

  const atrasados = data?.atrasados || [];
  const hoje = data?.hoje || [];
  const amanha = data?.amanha || [];
  const total = atrasados.length + hoje.length + amanha.length;

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <Sun className="h-10 w-10 opacity-30" />
        <p className="font-medium text-foreground">Dia tranquilo</p>
        <p className="text-sm">Nenhum compromisso ou tarefa para hoje e amanhã.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {atrasados.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-rose-600">
            <AlertTriangle className="h-4 w-4" />
            Atrasados ({atrasados.length})
          </h3>
          <div className="space-y-2">
            {atrasados.map(ev => (
              <EventoCard key={`${ev.fonte}-${ev.id}`} ev={ev} onStatusChange={onStatusChange} onDelete={onDelete} />
            ))}
          </div>
        </div>
      )}

      {/* TIMELINE HORÁRIA — só pra hoje, só pra eventos com hora */}
      {hoje.length > 0 && <TimelineHorariaHoje eventos={hoje} />}

      {/* Eventos "dia inteiro" do dia de hoje (não cabem na timeline) */}
      {hoje.filter((ev: any) => ev.diaInteiro).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-600">
            <ListTodo className="h-4 w-4" />
            Hoje · dia inteiro / sem hora
          </h3>
          <div className="space-y-2">
            {hoje.filter((ev: any) => ev.diaInteiro).map((ev: any) => (
              <EventoCard key={`${ev.fonte}-${ev.id}`} ev={ev} onStatusChange={onStatusChange} onDelete={onDelete} />
            ))}
          </div>
        </div>
      )}

      {amanha.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-500">
            <Clock className="h-4 w-4" />
            Amanhã ({amanha.length})
          </h3>
          <div className="space-y-2">
            {amanha.map(ev => (
              <EventoCard key={`${ev.fonte}-${ev.id}`} ev={ev} onStatusChange={onStatusChange} onDelete={onDelete} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Timeline horária de hoje ──────────────────────────────────────────────
/**
 * Linha do tempo vertical 7h–20h com marcador laranja na hora atual.
 * Eventos com hora (diaInteiro=false) ficam posicionados na linha.
 * Eventos "dia inteiro" não entram aqui (renderizam em seção separada).
 */
function TimelineHorariaHoje({ eventos }: { eventos: any[] }) {
  const HORA_INICIO = 7; // 07:00
  const HORA_FIM = 20; // 20:00
  const TOTAL_HORAS = HORA_FIM - HORA_INICIO;
  const ALTURA_PX = 720;

  const agora = new Date();
  const minAtual = (agora.getHours() - HORA_INICIO) * 60 + agora.getMinutes();
  const minMax = TOTAL_HORAS * 60;
  const nowOffset = (minAtual / minMax) * ALTURA_PX;
  const mostrarMarker = minAtual >= 0 && minAtual <= minMax;

  // Eventos com hora — calcula offset Y e altura
  const eventosComHora = eventos.filter((ev: any) => !ev.diaInteiro);
  const posicoes = eventosComHora.map((ev: any) => {
    const inicio = new Date(ev.dataInicio);
    const mins = (inicio.getHours() - HORA_INICIO) * 60 + inicio.getMinutes();
    let duracaoMin = 30;
    if (ev.dataFim) {
      const fim = new Date(ev.dataFim);
      duracaoMin = Math.max(20, Math.round((fim.getTime() - inicio.getTime()) / 60000));
    } else if (ev.tipo === "audiencia") {
      duracaoMin = 60;
    } else if (ev.tipo === "reuniao_comercial") {
      duracaoMin = 60;
    }
    const top = Math.max(0, (mins / minMax) * ALTURA_PX);
    const altura = Math.max(36, (duracaoMin / minMax) * ALTURA_PX);
    return { ev, top, altura };
  });

  return (
    <div>
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <Sun className="h-4 w-4 text-amber-500" />
        Hoje ({eventos.length})
      </h3>
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="relative" style={{ height: ALTURA_PX }}>
          {/* Marcações de hora */}
          {Array.from({ length: TOTAL_HORAS + 1 }, (_, i) => {
            const h = HORA_INICIO + i;
            const top = (i / TOTAL_HORAS) * ALTURA_PX;
            return (
              <div key={h} style={{ position: "absolute", top, left: 0, right: 0 }}>
                <span className="absolute left-0 -translate-y-1/2 text-[10px] font-semibold text-slate-400 tabular-nums w-12 text-right pr-2">
                  {String(h).padStart(2, "0")}:00
                </span>
                <div className="ml-12 border-t border-dashed border-slate-200" />
              </div>
            );
          })}

          {/* Marcador hora atual */}
          {mostrarMarker && (
            <div
              className="absolute left-12 right-0 pointer-events-none"
              style={{ top: nowOffset, height: 2 }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-orange-500 via-orange-400 to-transparent" />
              <span className="absolute -left-12 top-0 -translate-y-1/2 bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full tabular-nums">
                AGORA · {String(agora.getHours()).padStart(2, "0")}:{String(agora.getMinutes()).padStart(2, "0")}
              </span>
            </div>
          )}

          {/* Eventos */}
          {posicoes.map(({ ev, top, altura }: any) => {
            const cor = corDoEvento(ev);
            const concluido = ev.status === "concluido" || ev.status === "concluida";
            const inicio = new Date(ev.dataInicio);
            const horaStr = `${String(inicio.getHours()).padStart(2, "0")}:${String(inicio.getMinutes()).padStart(2, "0")}`;
            const tipoLabel = ev.fonte === "tarefa" ? "Tarefa" : TIPO_LABELS[ev.tipo] || ev.tipo;
            return (
              <div
                key={`${ev.fonte}-${ev.id}`}
                className={`absolute left-12 right-2 rounded-lg px-2.5 py-1.5 overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer ${concluido ? "opacity-60" : ""}`}
                style={{
                  top,
                  height: altura,
                  background: `linear-gradient(135deg, ${cor}22 0%, white 100%)`,
                  borderLeft: `4px solid ${cor}`,
                }}
                title={ev.titulo}
              >
                <div className="flex items-start justify-between gap-2 h-full">
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <p
                      className={`text-xs font-semibold truncate ${concluido ? "line-through text-slate-400" : "text-slate-900"}`}
                    >
                      {ev.titulo}
                    </p>
                    {altura > 36 && (
                      <p className="text-[10px] text-slate-500 tabular-nums truncate">
                        {horaStr} · {tipoLabel}
                        {ev.local && ` · ${ev.local}`}
                      </p>
                    )}
                  </div>
                  {ev.responsavelNome && (
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-[0_0_0_2px_white] shrink-0 bg-gradient-to-br ${gradientAvatar(ev.responsavelNome)}`}
                      title={ev.responsavelNome}
                    >
                      {gerarIniciais(ev.responsavelNome)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIALOG: CRIAR EVENTO
// ═══════════════════════════════════════════════════════════════════════════════

function CriarEventoDialog({ open, onOpenChange, onSuccess }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void;
}) {
  const [tipoEvento, setTipoEvento] = useState<"compromisso" | "tarefa">("compromisso");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [horaInicio, setHoraInicio] = useState("");
  const [tipo, setTipo] = useState("reuniao_comercial");
  const [prioridade, setPrioridade] = useState("normal");
  const [local, setLocal] = useState("");

  const criarCompMut = trpc.agenda.criarCompromisso.useMutation({
    onSuccess: () => { toast.success("Compromisso criado"); reset(); onSuccess(); },
    onError: (err) => toast.error(err.message),
  });

  const criarTarefaMut = trpc.agenda.criarTarefa.useMutation({
    onSuccess: () => { toast.success("Tarefa criada"); reset(); onSuccess(); },
    onError: (err) => toast.error(err.message),
  });

  const isPending = criarCompMut.isPending || criarTarefaMut.isPending;

  const reset = () => {
    setTitulo(""); setDescricao(""); setDataInicio(""); setHoraInicio("");
    setTipo("reuniao_comercial"); setPrioridade("normal"); setLocal("");
    onOpenChange(false);
  };

  const handleCriar = () => {
    if (tipoEvento === "compromisso") {
      const dateTimeStr = horaInicio ? `${dataInicio}T${horaInicio}:00` : `${dataInicio}T09:00:00`;
      criarCompMut.mutate({
        tipo: tipo as any,
        titulo,
        descricao: descricao || undefined,
        dataInicio: dateTimeStr,
        local: local || undefined,
        prioridade: prioridade as any,
        diaInteiro: !horaInicio,
      });
    } else {
      criarTarefaMut.mutate({
        titulo,
        descricao: descricao || undefined,
        dataVencimento: dataInicio ? `${dataInicio}T23:59:00` : undefined,
        prioridade: prioridade as any,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo evento</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Tipo de evento */}
          <div className="flex gap-2">
            <Button variant={tipoEvento === "compromisso" ? "default" : "outline"} size="sm" className="flex-1 text-xs"
              onClick={() => setTipoEvento("compromisso")}>
              <CalendarDays className="h-3.5 w-3.5 mr-1" /> Compromisso
            </Button>
            <Button variant={tipoEvento === "tarefa" ? "default" : "outline"} size="sm" className="flex-1 text-xs"
              onClick={() => setTipoEvento("tarefa")}>
              <ListTodo className="h-3.5 w-3.5 mr-1" /> Tarefa
            </Button>
          </div>

          <div>
            <Label className="text-xs">Título</Label>
            <Input placeholder={tipoEvento === "compromisso" ? "Audiência trabalhista" : "Preparar petição inicial"} value={titulo} onChange={e => setTitulo(e.target.value)} className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{tipoEvento === "compromisso" ? "Data" : "Prazo"}</Label>
              <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="mt-1" />
            </div>
            {tipoEvento === "compromisso" && (
              <div>
                <Label className="text-xs">Hora</Label>
                <Input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} className="mt-1" />
              </div>
            )}
            {tipoEvento === "tarefa" && (
              <div>
                <Label className="text-xs">Prioridade</Label>
                <Select value={prioridade} onValueChange={setPrioridade}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixa">Baixa</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {tipoEvento === "compromisso" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reuniao_comercial">Reunião</SelectItem>
                    <SelectItem value="audiencia">Audiência</SelectItem>
                    <SelectItem value="prazo_processual">Prazo processual</SelectItem>
                    <SelectItem value="follow_up">Follow-up</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Local</Label>
                <Input placeholder="Fórum, Zoom, etc." value={local} onChange={e => setLocal(e.target.value)} className="mt-1" />
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Descrição</Label>
            <Textarea placeholder="Detalhes..." value={descricao} onChange={e => setDescricao(e.target.value)} rows={2} className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCriar} disabled={isPending || !titulo || !dataInicio}>
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function Agenda() {
  const { user } = useAuth();
  const [tab, setTab] = useState("hoje");
  const [criarOpen, setCriarOpen] = useState(false);
  const [filtroFonte, setFiltroFonte] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("pendentes");
  const [busca, setBusca] = useState("");

  const { data: contadores } = trpc.agenda.contadores.useQuery(undefined, { refetchInterval: 30000 });

  const statusFilter = filtroStatus === "pendentes" ? "pendente" : filtroStatus === "concluidos" ? "concluido" : undefined;
  const { data: eventos, isLoading, refetch } = trpc.agenda.listar.useQuery(
    { fonte: filtroFonte as any, status: statusFilter, busca: busca || undefined },
    { refetchInterval: 30000 }
  );

  // Pra o calendário: query separada SEM filtros — mostra todos os eventos
  // do escritório, independente do que tá filtrado na lista. Refetch é
  // menos frequente (60s) porque calendário é navegação, não dashboard.
  const { data: eventosCalendario } = trpc.agenda.listar.useQuery(
    { fonte: "todos", status: undefined },
    { refetchInterval: 60000, enabled: tab === "calendario" },
  );

  const atualizarMut = trpc.agenda.atualizarStatus.useMutation({ onSuccess: () => { refetch(); toast.success("Atualizado"); } });
  const excluirMut = trpc.agenda.excluir.useMutation({ onSuccess: () => { refetch(); toast.success("Excluído"); } });

  const handleStatus = (id: number, fonte: string, status: string) => atualizarMut.mutate({ id, fonte: fonte as any, status });
  const handleDelete = (id: number, fonte: string) => excluirMut.mutate({ id, fonte: fonte as any });

  const nomeUser = user?.name?.split(" ")[0] || "Usuário";
  const hoje = new Date();
  const dataLabel = hoje.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="rounded-2xl bg-gradient-to-br from-amber-50/40 via-white to-orange-50/20 p-6 space-y-5">
      {/* ═══════════ HERO ═══════════ */}
      <div className="rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-rose-600 p-7 text-white relative overflow-hidden shadow-lg">
        <CalendarDays className="absolute -right-10 -bottom-12 w-56 h-56 opacity-10" strokeWidth={1.2} />
        <div className="relative">
          <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <PulseDot />
                <p className="text-xs font-medium text-white/85 uppercase tracking-wider">Agenda</p>
              </div>
              <p className="text-xs text-white/70 capitalize">{dataLabel}</p>
            </div>
            <Button
              onClick={() => setCriarOpen(true)}
              className="bg-white text-slate-900 hover:bg-slate-100 font-semibold shadow-sm h-9"
            >
              <Plus className="h-4 w-4 mr-1" /> Novo evento
            </Button>
          </div>

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
            <div className="lg:col-span-6">
              <p className="text-sm font-medium text-white/85 mb-1">
                {saudacaoContextual()}, {nomeUser}
              </p>
              <p className="text-xs text-white/65 mb-3">Eventos de hoje</p>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="num-hero text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                  {contadores?.hojeCount ?? 0}
                </span>
                {(contadores?.hojeCount ?? 0) === 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-white/15 text-white border border-white/20">
                    Dia tranquilo
                  </span>
                )}
              </div>
              <p className="text-xs text-white/65 mt-2">
                <b className="text-white">{contadores?.pendentesCount ?? 0}</b> pendente(s) no total
              </p>
            </div>

            <div className="lg:col-span-6">
              <p className="text-[10px] text-white/65 uppercase tracking-wider mb-2">Atenção</p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setTab("hoje")}
                  className="bg-white/10 rounded-lg px-3 py-2 border border-white/15 text-left hover:bg-white/15 transition-colors"
                >
                  <p className="text-xs text-white/70 mb-1">Hoje</p>
                  <p className="text-2xl font-bold tabular-nums leading-none">
                    {contadores?.hojeCount ?? 0}
                  </p>
                </button>
                <button
                  onClick={() => { setFiltroStatus("pendentes"); setTab("lista"); }}
                  className="bg-white/10 rounded-lg px-3 py-2 border border-white/15 text-left hover:bg-white/15 transition-colors"
                >
                  <p className="text-xs text-white/70 mb-1">⚠ Atrasados</p>
                  <p
                    className={`text-2xl font-bold tabular-nums leading-none ${(contadores?.atrasadosCount ?? 0) > 0 ? "text-rose-200" : ""}`}
                  >
                    {contadores?.atrasadosCount ?? 0}
                  </p>
                </button>
                <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                  <p className="text-xs text-white/70 mb-1">Pendentes</p>
                  <p className="text-2xl font-bold tabular-nums leading-none">
                    {contadores?.pendentesCount ?? 0}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ TABS PILL ═══════════ */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="bg-slate-50/80 backdrop-blur-sm border border-slate-200 rounded-xl p-1.5 inline-flex">
          <TabsList className="bg-transparent gap-1 p-0 h-auto">
            <TabsTrigger
              value="hoje"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <Sun className="h-3.5 w-3.5" /> Hoje
            </TabsTrigger>
            <TabsTrigger
              value="lista"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <ListTodo className="h-3.5 w-3.5" /> Lista
            </TabsTrigger>
            <TabsTrigger
              value="calendario"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <CalendarDays className="h-3.5 w-3.5" /> Calendário
            </TabsTrigger>
          </TabsList>
        </div>

        {/* HOJE */}
        <TabsContent value="hoje" className="mt-5">
          <HojeView onStatusChange={handleStatus} onDelete={handleDelete} />
        </TabsContent>

        {/* LISTA */}
        <TabsContent value="lista" className="mt-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[260px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Buscar por título, cliente, descrição..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-10 h-10 bg-white"
              />
            </div>
            <Select value={filtroFonte} onValueChange={setFiltroFonte}>
              <SelectTrigger className="w-36 h-10 text-xs bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="compromisso">Compromissos</SelectItem>
                <SelectItem value="tarefa">Tarefas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-36 h-10 text-xs bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pendentes">Pendentes</SelectItem>
                <SelectItem value="todos_status">Todos status</SelectItem>
                <SelectItem value="concluidos">Concluídos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : eventos && eventos.length > 0 ? (
            <div className="space-y-2">
              {eventos.map((ev: any) => (
                <EventoCard
                  key={`${ev.fonte}-${ev.id}`}
                  ev={ev}
                  onStatusChange={handleStatus}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-16 text-center">
                <CalendarClock className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">Nenhum evento encontrado.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* CALENDÁRIO */}
        <TabsContent value="calendario" className="mt-5">
          <CalendarioMensal
            eventos={eventosCalendario || []}
            onCriarEvento={() => setCriarOpen(true)}
          />
        </TabsContent>
      </Tabs>

      <CriarEventoDialog open={criarOpen} onOpenChange={setCriarOpen} onSuccess={refetch} />
    </div>
  );
}
