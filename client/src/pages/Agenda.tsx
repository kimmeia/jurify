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
  Briefcase, Scale, Users, PhoneCall, MoreHorizontal, Check, MapPin, Bell,
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
  prazo_processual: "#f43f5e",
  audiencia: "#8b5cf6",
  reuniao_comercial: "#10b981",
  tarefa: "#f59e0b",
  follow_up: "#06b6d4",
  outro: "#64748b",
};

/** Paleta do hora-block colorido à esquerda do card — mesma família que a faixa lateral. */
const HORA_BLOCK_BG: Record<string, string> = {
  prazo_processual: "from-rose-50 to-rose-100 border-rose-300",
  audiencia: "from-violet-50 to-violet-100 border-violet-300",
  reuniao_comercial: "from-emerald-50 to-emerald-100 border-emerald-300",
  tarefa: "from-amber-50 to-amber-100 border-amber-300",
  follow_up: "from-cyan-50 to-cyan-100 border-cyan-300",
  outro: "from-slate-50 to-slate-100 border-slate-300",
};
const HORA_BLOCK_TEXT: Record<string, string> = {
  prazo_processual: "text-rose-700",
  audiencia: "text-violet-700",
  reuniao_comercial: "text-emerald-700",
  tarefa: "text-amber-700",
  follow_up: "text-cyan-700",
  outro: "text-slate-700",
};

const TIPO_BADGE: Record<string, string> = {
  prazo_processual: "bg-rose-50 text-rose-700 border-rose-200",
  audiencia: "bg-violet-50 text-violet-700 border-violet-200",
  reuniao_comercial: "bg-emerald-50 text-emerald-700 border-emerald-200",
  tarefa: "bg-amber-50 text-amber-700 border-amber-200",
  follow_up: "bg-cyan-50 text-cyan-700 border-cyan-200",
  outro: "bg-slate-100 text-slate-600 border-slate-200",
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

/** Retorna texto curto de "tempo até / atrás" relativo a agora.
 *  Ex: "em 23min", "em 2h", "amanhã 9h", "atrasado 3h", "há 2 dias". */
function tempoRelativoAgenda(iso: string): { texto: string; urgencia: "agora" | "atrasado" | "futuro" | "longe" } {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = target - now;
  const diffMin = Math.round(diffMs / 60000);
  const diffH = Math.round(diffMs / 3600000);
  const diffDia = Math.round(diffMs / 86400000);

  if (diffMin < -60 * 24) return { texto: `há ${Math.abs(diffDia)}d`, urgencia: "atrasado" };
  if (diffMin < -60) return { texto: `atrasado ${Math.abs(diffH)}h`, urgencia: "atrasado" };
  if (diffMin < 0) return { texto: `atrasado ${Math.abs(diffMin)}min`, urgencia: "atrasado" };
  if (diffMin < 60) return { texto: `em ${diffMin}min`, urgencia: "agora" };
  if (diffH < 24) return { texto: `em ${diffH}h`, urgencia: "futuro" };
  if (diffDia === 1) return { texto: `amanhã ${new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, urgencia: "futuro" };
  if (diffDia < 7) return { texto: `em ${diffDia}d`, urgencia: "futuro" };
  return { texto: `em ${diffDia}d`, urgencia: "longe" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CARD DE EVENTO
// ═══════════════════════════════════════════════════════════════════════════════

function EventoCard({ ev, onStatusChange, onDelete, onEdit }: {
  ev: any;
  onStatusChange: (id: number, fonte: string, status: string) => void;
  onDelete: (id: number, fonte: string) => void;
  onEdit?: (ev: any) => void;
}) {
  const overdue = isOverdue(ev.dataInicio, ev.status);
  const concluido = ev.status === "concluido" || ev.status === "concluida";
  const cancelado = ev.status === "cancelado" || ev.status === "cancelada";
  const cor = corDoEvento(ev);
  const tipoKey = ev.fonte === "tarefa" ? "tarefa" : (ev.tipo as string) || "outro";
  const tipoLabel = ev.fonte === "tarefa" ? "Tarefa" : TIPO_LABELS[ev.tipo] || ev.tipo;
  const prioridade = ev.prioridade || "normal";

  const inicio = new Date(ev.dataInicio);
  const hh = String(inicio.getHours()).padStart(2, "0");
  const mm = String(inicio.getMinutes()).padStart(2, "0");
  const horaFim = ev.dataFim
    ? `${String(new Date(ev.dataFim).getHours()).padStart(2, "0")}:${String(new Date(ev.dataFim).getMinutes()).padStart(2, "0")}`
    : null;

  const responsavel = ev.responsavelNome;
  const contato = ev.contatoNome;
  const cnj = ev.cnj || null;
  const tribunal = ev.tribunal || null;

  // Tempo relativo só pra eventos pendentes (não vale pra concluído/cancelado)
  const rel = !concluido && !cancelado && !ev.diaInteiro
    ? tempoRelativoAgenda(ev.dataInicio)
    : null;

  // Hora-block: cores por tipo. Quando atrasado, força paleta rose.
  const horaBlockCls = overdue
    ? "from-rose-50 to-rose-100 border-rose-300"
    : rel?.urgencia === "agora"
      ? "from-orange-50 to-orange-100 border-orange-300"
      : HORA_BLOCK_BG[tipoKey] || HORA_BLOCK_BG.outro;
  const horaTextCls = overdue
    ? "text-rose-700"
    : rel?.urgencia === "agora"
      ? "text-orange-700"
      : HORA_BLOCK_TEXT[tipoKey] || HORA_BLOCK_TEXT.outro;

  // Bg do card por estado
  const cardBg = concluido
    ? "bg-slate-50"
    : overdue
      ? "bg-gradient-to-r from-rose-50/60 to-white"
      : rel?.urgencia === "agora"
        ? "bg-gradient-to-r from-orange-50/40 to-white"
        : "bg-white";

  const cardBorder = overdue
    ? "border-rose-200"
    : rel?.urgencia === "agora"
      ? "border-orange-200 ring-2 ring-orange-100"
      : "border-slate-200";

  // Badge de status/tempo
  const statusBadge = (() => {
    if (concluido) return { txt: `✓ Concluído${ev.dataConclusao ? " " + formatTime(ev.dataConclusao) : ""}`, cls: "bg-emerald-100 text-emerald-700 border-emerald-200" };
    if (cancelado) return { txt: "Cancelado", cls: "bg-slate-100 text-slate-500 border-slate-200" };
    if (!rel) return null;
    if (rel.urgencia === "atrasado") return { txt: `⚠ ${rel.texto}`, cls: "bg-rose-100 text-rose-700 border-rose-200 animate-pulse" };
    if (rel.urgencia === "agora") return { txt: `⏳ ${rel.texto}`, cls: "bg-orange-100 text-orange-700 border-orange-200 animate-pulse" };
    if (rel.urgencia === "futuro") return { txt: rel.texto, cls: "bg-blue-50 text-blue-700 border-blue-200" };
    return { txt: rel.texto, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  })();

  return (
    <div
      className={`group relative ${cardBg} ${cardBorder} border rounded-xl transition-all hover:shadow-[0_6px_20px_-6px_rgb(0_0_0_/_0.10)] hover:-translate-y-px ${concluido ? "opacity-65" : ""}`}
      style={{ borderLeft: `4px solid ${cor}` }}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Hora-block colorida à esquerda */}
        <div
          className={`flex flex-col items-center justify-center w-[64px] min-h-[64px] py-1.5 rounded-xl bg-gradient-to-br ${horaBlockCls} border shrink-0`}
        >
          {ev.diaInteiro ? (
            <>
              <p className={`text-[10px] font-bold leading-none tracking-wider ${horaTextCls}`}>DIA</p>
              <p className={`text-[10px] font-bold leading-none tracking-wider mt-1 ${horaTextCls}`}>INTEIRO</p>
            </>
          ) : (
            <>
              <p className={`text-xl font-extrabold leading-none tabular-nums tracking-tight ${horaTextCls}`}>{hh}</p>
              <p className={`text-[11px] font-bold leading-none mt-0.5 tabular-nums ${horaTextCls} opacity-80`}>{mm}</p>
              {horaFim && (
                <p className={`text-[8.5px] font-semibold leading-none mt-1.5 tabular-nums ${horaTextCls} opacity-60`}>
                  → {horaFim}
                </p>
              )}
            </>
          )}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          {/* Linha 1: badges de status/tipo/prioridade */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {statusBadge && (
              <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${statusBadge.cls}`}>
                {statusBadge.txt}
              </span>
            )}
            <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${TIPO_BADGE[tipoKey] || TIPO_BADGE.outro}`}>
              {tipoLabel}
            </span>
            {prioridade !== "normal" && (
              <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PRIOR_BADGE[prioridade] || PRIOR_BADGE.normal}`}>
                {PRIOR_LABEL[prioridade] || prioridade}
              </span>
            )}
          </div>

          {/* Título */}
          <p
            className={`text-sm font-bold tracking-tight leading-snug mt-1.5 ${
              concluido ? "line-through text-slate-400" : cancelado ? "text-slate-400" : "text-slate-900"
            }`}
          >
            {ev.titulo}
          </p>

          {/* Linha 2: cliente + processo */}
          {(contato || cnj || ev.local) && (
            <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-600 flex-wrap">
              {contato && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0 bg-gradient-to-br ${gradientAvatar(contato)}`}
                  >
                    {gerarIniciais(contato)}
                  </span>
                  <span className="font-medium truncate max-w-[200px]" title={contato}>
                    {contato}
                  </span>
                </span>
              )}
              {cnj && (
                <>
                  {contato && <span className="text-slate-300">·</span>}
                  <span className="inline-flex items-center gap-1">
                    <Scale className="w-3 h-3 text-indigo-500" />
                    <span className="font-mono text-indigo-700 text-[10.5px]">{cnj}</span>
                    {tribunal && <span className="text-slate-400 text-[10px] uppercase">{tribunal}</span>}
                  </span>
                </>
              )}
              {ev.local && (
                <>
                  {(contato || cnj) && <span className="text-slate-300">·</span>}
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    <span className="truncate max-w-[160px]">{ev.local}</span>
                  </span>
                </>
              )}
            </div>
          )}

          {/* Linha 3: responsável + lembretes (quando houver) */}
          {(responsavel || (ev.lembretes && ev.lembretes.length > 0)) && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {responsavel && (
                <span className="inline-flex items-center gap-1.5 text-[10.5px] text-slate-500">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white bg-gradient-to-br ${gradientAvatar(responsavel)}`}
                    title={responsavel}
                  >
                    {gerarIniciais(responsavel)}
                  </span>
                  <span>{responsavel}</span>
                </span>
              )}
              {ev.lembretes && ev.lembretes.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-medium">
                  <Bell className="w-2.5 h-2.5" />
                  {ev.lembretes.length} lembrete{ev.lembretes.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="flex flex-col gap-1 shrink-0 self-start">
          {!concluido && !cancelado && (
            <Button
              size="sm"
              className="h-7 text-[10.5px] rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm px-2.5"
              onClick={(e) => {
                e.stopPropagation();
                onStatusChange(ev.id, ev.fonte, "concluido");
              }}
            >
              <Check className="h-3 w-3 mr-1" />
              Concluir
            </Button>
          )}
          {onEdit && !concluido && !cancelado && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10.5px] rounded-lg border-slate-200 hover:bg-slate-50 px-2.5"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(ev);
              }}
            >
              Editar
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10.5px] rounded-lg text-slate-500 hover:bg-slate-100 px-2.5"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Excluir este evento?")) onDelete(ev.id, ev.fonte);
            }}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Excluir
          </Button>
        </div>
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

function HojeView({ onStatusChange, onDelete, onEdit }: {
  onStatusChange: (id: number, fonte: string, status: string) => void;
  onDelete: (id: number, fonte: string) => void;
  onEdit?: (ev: any) => void;
}) {
  const { data, isLoading } = trpc.agenda.hoje.useQuery(undefined, { refetchInterval: 30000 });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;

  const atrasados = data?.atrasados || [];
  const hoje = data?.hoje || [];
  const amanha = data?.amanha || [];
  const total = atrasados.length + hoje.length + amanha.length;

  // Próximo evento pendente (ignora atrasados — esses ficam na seção própria)
  const proximoEvento = (() => {
    const candidatos = [...hoje, ...amanha]
      .filter((e: any) => {
        if (e.diaInteiro) return false;
        if (["concluido", "concluida", "cancelado", "cancelada"].includes(e.status)) return false;
        return new Date(e.dataInicio).getTime() > Date.now();
      })
      .sort((a: any, b: any) => new Date(a.dataInicio).getTime() - new Date(b.dataInicio).getTime());
    return candidatos[0] || null;
  })();

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-slate-50 to-amber-50/30 py-16 text-center space-y-2">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 flex items-center justify-center mx-auto mb-1">
          <Sun className="h-7 w-7 text-amber-500/70" />
        </div>
        <p className="font-semibold text-slate-700">Dia tranquilo</p>
        <p className="text-sm text-slate-500">Nenhum compromisso ou tarefa para hoje e amanhã.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {proximoEvento && <ProximoEventoHero ev={proximoEvento} onStatusChange={onStatusChange} onEdit={onEdit} />}

      {atrasados.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-rose-600">
            <AlertTriangle className="h-4 w-4" />
            Atrasados ({atrasados.length})
          </h3>
          <div className="space-y-2">
            {atrasados.map(ev => (
              <EventoCard key={`${ev.fonte}-${ev.id}`} ev={ev} onStatusChange={onStatusChange} onDelete={onDelete} onEdit={onEdit} />
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
              <EventoCard key={`${ev.fonte}-${ev.id}`} ev={ev} onStatusChange={onStatusChange} onDelete={onDelete} onEdit={onEdit} />
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
              <EventoCard key={`${ev.fonte}-${ev.id}`} ev={ev} onStatusChange={onStatusChange} onDelete={onDelete} onEdit={onEdit} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Card destacado do "Próximo evento" — countdown vivo + ações rápidas. */
function ProximoEventoHero({ ev, onStatusChange, onEdit }: {
  ev: any;
  onStatusChange: (id: number, fonte: string, status: string) => void;
  onEdit?: (ev: any) => void;
}) {
  // Atualiza countdown a cada minuto
  const [agora, setAgora] = useState(Date.now());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => {
    const t = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const targetMs = new Date(ev.dataInicio).getTime();
  const diffMin = Math.max(0, Math.round((targetMs - agora) / 60000));
  const horas = Math.floor(diffMin / 60);
  const minutos = diffMin % 60;
  const countdownTxt = diffMin === 0
    ? "Agora!"
    : horas > 0
      ? `em ${horas}h ${minutos}min`
      : `em ${minutos}min`;

  const inicio = new Date(ev.dataInicio);
  const horaStr = `${String(inicio.getHours()).padStart(2, "0")}:${String(inicio.getMinutes()).padStart(2, "0")}`;
  const cor = corDoEvento(ev);
  const tipoLabel = ev.fonte === "tarefa" ? "Tarefa" : TIPO_LABELS[ev.tipo] || ev.tipo;

  return (
    <div
      className="relative overflow-hidden rounded-2xl border-2 p-5 bg-gradient-to-br from-orange-50 via-amber-50/60 to-white shadow-[0_4px_20px_-4px_rgb(249,115,22,0.18)]"
      style={{ borderColor: cor }}
    >
      <div className="absolute -top-6 -right-6 h-32 w-32 rounded-full bg-orange-200/30 blur-3xl" />
      <div className="relative flex items-start gap-4 flex-wrap">
        <div className="flex flex-col">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-700 mb-1">Próximo evento</p>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-extrabold text-slate-900 tabular-nums leading-none tracking-tight">{horaStr}</p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-600 text-white text-[10px] font-bold animate-pulse">
              ⏳ {countdownTxt}
            </span>
          </div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white"
              style={{ background: cor }}
            >
              {tipoLabel}
            </span>
            {ev.prioridade && ev.prioridade !== "normal" && (
              <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PRIOR_BADGE[ev.prioridade] || PRIOR_BADGE.normal}`}>
                {PRIOR_LABEL[ev.prioridade] || ev.prioridade}
              </span>
            )}
          </div>
          <p className="text-base font-bold tracking-tight text-slate-900">{ev.titulo}</p>
          <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-slate-600 flex-wrap">
            {ev.contatoNome && (
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white bg-gradient-to-br ${gradientAvatar(ev.contatoNome)}`}>
                  {gerarIniciais(ev.contatoNome)}
                </span>
                {ev.contatoNome}
              </span>
            )}
            {ev.local && (
              <>
                <span className="text-slate-300">·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-400" />
                  {ev.local}
                </span>
              </>
            )}
            {ev.responsavelNome && (
              <>
                <span className="text-slate-300">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white bg-gradient-to-br ${gradientAvatar(ev.responsavelNome)}`}>
                    {gerarIniciais(ev.responsavelNome)}
                  </span>
                  {ev.responsavelNome}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <Button
            size="sm"
            className="h-8 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 shadow-sm"
            onClick={() => onStatusChange(ev.id, ev.fonte, "concluido")}
          >
            <Check className="h-3 w-3 mr-1" />
            Cheguei / Concluir
          </Button>
          {onEdit && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs rounded-lg border-slate-200 bg-white"
              onClick={() => onEdit(ev)}
            >
              Editar
            </Button>
          )}
        </div>
      </div>
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
// VIEW: LISTA (com filter chips + agrupamento por períodos)
// ═══════════════════════════════════════════════════════════════════════════════

const TIPO_FILTRO_OPTS: Array<{ id: string; label: string; cor: string }> = [
  { id: "todos", label: "Todos", cor: "slate" },
  { id: "audiencia", label: "Audiências", cor: "violet" },
  { id: "prazo_processual", label: "Prazos", cor: "rose" },
  { id: "tarefa", label: "Tarefas", cor: "amber" },
  { id: "reuniao_comercial", label: "Reuniões", cor: "emerald" },
  { id: "follow_up", label: "Follow-up", cor: "cyan" },
];

function ListaView({
  busca, setBusca,
  filtroFonte, setFiltroFonte,
  filtroTipo, setFiltroTipo,
  filtroStatus, setFiltroStatus,
  eventos, isLoading,
  onStatusChange, onDelete, onEdit,
}: {
  busca: string; setBusca: (s: string) => void;
  filtroFonte: string; setFiltroFonte: (s: string) => void;
  filtroTipo: string; setFiltroTipo: (s: string) => void;
  filtroStatus: string; setFiltroStatus: (s: string) => void;
  eventos: any[] | undefined; isLoading: boolean;
  onStatusChange: (id: number, fonte: string, status: string) => void;
  onDelete: (id: number, fonte: string) => void;
  onEdit?: (ev: any) => void;
}) {
  // Filtra por tipo no client (backend filtra por fonte/status; tipo é mais específico)
  const eventosFiltrados = useMemo(() => {
    const arr = eventos || [];
    if (filtroTipo === "todos") return arr;
    if (filtroTipo === "tarefa") return arr.filter((e: any) => e.fonte === "tarefa");
    return arr.filter((e: any) => e.tipo === filtroTipo);
  }, [eventos, filtroTipo]);

  // Agrupa por período: Atrasado / Hoje / Amanhã / Esta semana / Próxima semana / Mais tarde
  const grupos = useMemo(() => {
    const now = new Date();
    const hojeIni = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const amanhaIni = new Date(hojeIni); amanhaIni.setDate(hojeIni.getDate() + 1);
    const depoisAmanhaIni = new Date(hojeIni); depoisAmanhaIni.setDate(hojeIni.getDate() + 2);
    const proxSemIni = new Date(hojeIni); proxSemIni.setDate(hojeIni.getDate() + 7);
    const proxSem2Ini = new Date(hojeIni); proxSem2Ini.setDate(hojeIni.getDate() + 14);

    const buckets: Record<string, any[]> = {
      atrasado: [], hoje: [], amanha: [], semana: [], proximaSemana: [], maisTarde: [],
    };

    for (const ev of eventosFiltrados) {
      const dt = new Date(ev.dataInicio);
      const isPendente = ["pendente", "em_andamento"].includes(ev.status);
      if (dt < hojeIni && isPendente) buckets.atrasado.push(ev);
      else if (dt < amanhaIni) buckets.hoje.push(ev);
      else if (dt < depoisAmanhaIni) buckets.amanha.push(ev);
      else if (dt < proxSemIni) buckets.semana.push(ev);
      else if (dt < proxSem2Ini) buckets.proximaSemana.push(ev);
      else buckets.maisTarde.push(ev);
    }

    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => new Date(a.dataInicio).getTime() - new Date(b.dataInicio).getTime());
    }
    return buckets;
  }, [eventosFiltrados]);

  const totalFiltrado = eventosFiltrados.length;

  return (
    <div className="space-y-4">
      {/* Barra de busca + select fonte (compromisso vs tarefa) */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por título, cliente, descrição…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-10 h-10 bg-white rounded-lg"
          />
        </div>
        <Select value={filtroFonte} onValueChange={setFiltroFonte}>
          <SelectTrigger className="w-36 h-10 text-xs bg-white rounded-lg"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="compromisso">Compromissos</SelectItem>
            <SelectItem value="tarefa">Tarefas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Chips: tipo + status */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {TIPO_FILTRO_OPTS.map((opt) => {
          const active = filtroTipo === opt.id;
          const ativoCls: Record<string, string> = {
            slate: "bg-slate-900 text-white border-slate-900 shadow-sm",
            violet: "bg-violet-600 text-white border-violet-600 shadow-sm",
            rose: "bg-rose-600 text-white border-rose-600 shadow-sm",
            amber: "bg-amber-500 text-white border-amber-500 shadow-sm",
            emerald: "bg-emerald-600 text-white border-emerald-600 shadow-sm",
            cyan: "bg-cyan-600 text-white border-cyan-600 shadow-sm",
          };
          const inativoDot: Record<string, string> = {
            slate: "bg-slate-400", violet: "bg-violet-500", rose: "bg-rose-500",
            amber: "bg-amber-500", emerald: "bg-emerald-500", cyan: "bg-cyan-500",
          };
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFiltroTipo(opt.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                active ? ativoCls[opt.cor] : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {opt.id !== "todos" && (
                <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-white/85" : inativoDot[opt.cor]}`} />
              )}
              {opt.label}
            </button>
          );
        })}
        <span className="text-slate-300 mx-1">·</span>
        {[
          { id: "pendentes", label: "Pendentes" },
          { id: "todos_status", label: "Todos status" },
          { id: "concluidos", label: "Concluídos" },
        ].map((opt) => {
          const active = filtroStatus === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFiltroStatus(opt.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                active ? "bg-slate-900 text-white border-slate-900 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Contador */}
      <p className="text-[11px] text-slate-500">
        <b className="font-semibold text-slate-700 tabular-nums">{totalFiltrado}</b> {totalFiltrado === 1 ? "evento" : "eventos"}
        {grupos.atrasado.length > 0 && (
          <> · <b className="font-semibold text-rose-600 tabular-nums">{grupos.atrasado.length}</b> atrasado{grupos.atrasado.length === 1 ? "" : "s"}</>
        )}
      </p>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : totalFiltrado === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-slate-50 to-amber-50/30 py-14 text-center space-y-2">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 flex items-center justify-center mx-auto mb-1">
            <CalendarClock className="h-7 w-7 text-amber-500/70" />
          </div>
          <p className="font-semibold text-slate-700">Nenhum evento com este filtro</p>
          <p className="text-xs text-slate-500">Tente trocar o filtro ou criar um novo evento.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {[
            { key: "atrasado", titulo: "Atrasados", icon: AlertTriangle, color: "text-rose-600" },
            { key: "hoje", titulo: "Hoje", icon: Sun, color: "text-orange-600" },
            { key: "amanha", titulo: "Amanhã", icon: Clock, color: "text-blue-600" },
            { key: "semana", titulo: "Esta semana", icon: CalendarDays, color: "text-violet-600" },
            { key: "proximaSemana", titulo: "Próxima semana", icon: CalendarDays, color: "text-slate-600" },
            { key: "maisTarde", titulo: "Mais tarde", icon: CalendarDays, color: "text-slate-500" },
          ].map((secao) => {
            const lista = grupos[secao.key];
            if (!lista || lista.length === 0) return null;
            const Icon = secao.icon;
            return (
              <div key={secao.key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${secao.color}`} />
                  <h3 className={`text-sm font-semibold tracking-tight ${secao.color}`}>{secao.titulo}</h3>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold tabular-nums">
                    {lista.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {lista.map((ev: any) => (
                    <EventoCard
                      key={`${ev.fonte}-${ev.id}`}
                      ev={ev}
                      onStatusChange={onStatusChange}
                      onDelete={onDelete}
                      onEdit={onEdit}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIALOG: CRIAR / EDITAR EVENTO
// ═══════════════════════════════════════════════════════════════════════════════

function CriarEventoDialog({ open, onOpenChange, onSuccess, eventoEdit }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void;
  eventoEdit?: any | null;
}) {
  const isEdit = !!eventoEdit;
  const [tipoEvento, setTipoEvento] = useState<"compromisso" | "tarefa">("compromisso");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [horaInicio, setHoraInicio] = useState("");
  const [tipo, setTipo] = useState("reuniao_comercial");
  const [prioridade, setPrioridade] = useState("normal");
  const [local, setLocal] = useState("");
  const [contatoId, setContatoId] = useState<number | null>(null);
  const [contatoNome, setContatoNome] = useState<string>("");
  const [contatoBusca, setContatoBusca] = useState("");
  const [contatoMenuOpen, setContatoMenuOpen] = useState(false);
  const [processoId, setProcessoId] = useState<number | null>(null);
  const [processoLabel, setProcessoLabel] = useState<string>("");
  const [processoBusca, setProcessoBusca] = useState("");
  const [processoMenuOpen, setProcessoMenuOpen] = useState(false);

  // Quando o dialog abre em modo EDIT, hidrata campos
  useMemo(() => {
    if (!open) return;
    if (eventoEdit) {
      setTipoEvento((eventoEdit.fonte as any) || "compromisso");
      setTitulo(eventoEdit.titulo || "");
      setDescricao(eventoEdit.descricao || "");
      const dt = new Date(eventoEdit.dataInicio);
      setDataInicio(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
      if (!eventoEdit.diaInteiro) {
        setHoraInicio(`${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`);
      } else {
        setHoraInicio("");
      }
      setTipo(eventoEdit.tipo || "reuniao_comercial");
      setPrioridade(eventoEdit.prioridade || "normal");
      setLocal(eventoEdit.local || "");
      setContatoId(eventoEdit.contatoId ?? null);
      setContatoNome(eventoEdit.contatoNome || "");
      setProcessoId(eventoEdit.processoId ?? null);
      setProcessoLabel(eventoEdit.cnj || "");
    } else {
      setTipoEvento("compromisso");
      setTitulo(""); setDescricao(""); setDataInicio(""); setHoraInicio("");
      setTipo("reuniao_comercial"); setPrioridade("normal"); setLocal("");
      setContatoId(null); setContatoNome(""); setContatoBusca("");
      setProcessoId(null); setProcessoLabel(""); setProcessoBusca("");
    }
  }, [open, eventoEdit?.id]);

  // Busca de clientes (somente quando dropdown aberto + busca >= 2 chars)
  const { data: clientesData } = trpc.clientes.listar.useQuery(
    { busca: contatoBusca || undefined, limite: 10 },
    { enabled: contatoMenuOpen && contatoBusca.length >= 2 },
  );
  const clientesOptions = clientesData?.clientes || [];

  // Busca de monitoramentos (processos) — usa listarParaSelecao
  const { data: monsData } = trpc.processos.meusMonitoramentos.useQuery(
    { tipoMonitoramento: "movimentacoes" },
    { enabled: processoMenuOpen, retry: false },
  );
  const processosOptions = useMemo(() => {
    const arr = (monsData || []) as any[];
    if (!processoBusca) return arr.slice(0, 10);
    const lower = processoBusca.toLowerCase().replace(/\D/g, "");
    return arr.filter((m: any) => {
      const key = String(m.searchKey || "").replace(/\D/g, "");
      const apelido = (m.apelido || "").toLowerCase();
      return key.includes(lower) || apelido.includes(processoBusca.toLowerCase());
    }).slice(0, 10);
  }, [monsData, processoBusca]);

  const criarCompMut = trpc.agenda.criarCompromisso.useMutation({
    onSuccess: () => { toast.success("Compromisso criado"); reset(); onSuccess(); },
    onError: (err) => toast.error(err.message),
  });

  const criarTarefaMut = trpc.agenda.criarTarefa.useMutation({
    onSuccess: () => { toast.success("Tarefa criada"); reset(); onSuccess(); },
    onError: (err) => toast.error(err.message),
  });

  const atualizarMut = (trpc.agenda as any).atualizar.useMutation({
    onSuccess: () => { toast.success("Evento atualizado"); reset(); onSuccess(); },
    onError: (err: any) => toast.error(err.message),
  });

  const isPending = criarCompMut.isPending || criarTarefaMut.isPending || atualizarMut.isPending;

  const reset = () => {
    setTitulo(""); setDescricao(""); setDataInicio(""); setHoraInicio("");
    setTipo("reuniao_comercial"); setPrioridade("normal"); setLocal("");
    setContatoId(null); setContatoNome(""); setContatoBusca("");
    setProcessoId(null); setProcessoLabel(""); setProcessoBusca("");
    onOpenChange(false);
  };

  const handleSubmit = () => {
    const dateTimeStr = tipoEvento === "compromisso"
      ? (horaInicio ? `${dataInicio}T${horaInicio}:00` : `${dataInicio}T09:00:00`)
      : (dataInicio ? `${dataInicio}T23:59:00` : "");

    if (isEdit && eventoEdit) {
      atualizarMut.mutate({
        id: eventoEdit.id,
        fonte: eventoEdit.fonte,
        titulo,
        descricao: descricao || null,
        dataInicio: dateTimeStr,
        diaInteiro: tipoEvento === "compromisso" ? !horaInicio : undefined,
        tipo: tipoEvento === "compromisso" ? (tipo as any) : undefined,
        local: tipoEvento === "compromisso" ? (local || null) : undefined,
        prioridade: prioridade as any,
        contatoId,
        processoId,
      });
      return;
    }

    if (tipoEvento === "compromisso") {
      criarCompMut.mutate({
        tipo: tipo as any,
        titulo,
        descricao: descricao || undefined,
        dataInicio: dateTimeStr,
        local: local || undefined,
        prioridade: prioridade as any,
        diaInteiro: !horaInicio,
        contatoId: contatoId ?? undefined,
        processoId: processoId ?? undefined,
      });
    } else {
      criarTarefaMut.mutate({
        titulo,
        descricao: descricao || undefined,
        dataVencimento: dataInicio ? `${dataInicio}T23:59:00` : undefined,
        prioridade: prioridade as any,
        contatoId: contatoId ?? undefined,
        processoId: processoId ?? undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar evento" : "Novo evento"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Tipo de evento — só na criação, edit mantém o tipo */}
          {!isEdit && (
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
          )}

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

          {/* Cliente / contato */}
          <div className="relative">
            <Label className="text-xs">Cliente / contato (opcional)</Label>
            {contatoId && contatoNome ? (
              <div className="mt-1 flex items-center gap-2 px-2.5 py-1.5 bg-violet-50 border border-violet-200 rounded-lg">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white bg-gradient-to-br ${gradientAvatar(contatoNome)}`}>
                  {gerarIniciais(contatoNome)}
                </span>
                <span className="flex-1 text-xs font-semibold truncate" title={contatoNome}>{contatoNome}</span>
                <button
                  type="button"
                  onClick={() => { setContatoId(null); setContatoNome(""); setContatoBusca(""); }}
                  className="text-[10px] text-violet-600 hover:underline"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <>
                <Input
                  className="mt-1"
                  placeholder="Buscar cliente por nome ou CPF/CNPJ…"
                  value={contatoBusca}
                  onChange={(e) => { setContatoBusca(e.target.value); setContatoMenuOpen(true); }}
                  onFocus={() => setContatoMenuOpen(true)}
                  onBlur={() => setTimeout(() => setContatoMenuOpen(false), 200)}
                />
                {contatoMenuOpen && contatoBusca.length >= 2 && clientesOptions.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg divide-y">
                    {clientesOptions.map((c: any) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => { setContatoId(c.id); setContatoNome(c.nome); setContatoMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-violet-50 text-left"
                      >
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white bg-gradient-to-br ${gradientAvatar(c.nome)}`}>
                          {gerarIniciais(c.nome)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{c.nome}</p>
                          {c.cpfCnpj && <p className="text-[10px] text-slate-500 font-mono">{c.cpfCnpj}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Processo monitorado */}
          <div className="relative">
            <Label className="text-xs">Processo vinculado (opcional)</Label>
            {processoId && processoLabel ? (
              <div className="mt-1 flex items-center gap-2 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg">
                <Scale className="h-4 w-4 text-indigo-600 shrink-0" />
                <span className="flex-1 text-xs font-mono font-bold text-indigo-700 truncate">{processoLabel}</span>
                <button
                  type="button"
                  onClick={() => { setProcessoId(null); setProcessoLabel(""); setProcessoBusca(""); }}
                  className="text-[10px] text-indigo-600 hover:underline"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <>
                <Input
                  className="mt-1"
                  placeholder="Buscar por CNJ ou apelido…"
                  value={processoBusca}
                  onChange={(e) => { setProcessoBusca(e.target.value); setProcessoMenuOpen(true); }}
                  onFocus={() => setProcessoMenuOpen(true)}
                  onBlur={() => setTimeout(() => setProcessoMenuOpen(false), 200)}
                />
                {processoMenuOpen && processosOptions.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg divide-y">
                    {processosOptions.map((m: any) => (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => {
                          setProcessoId(m.id);
                          setProcessoLabel(m.searchKey || m.apelido || `#${m.id}`);
                          setProcessoMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-indigo-50 text-left"
                      >
                        <Scale className="h-4 w-4 text-indigo-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono font-bold truncate">{m.searchKey}</p>
                          {m.apelido && <p className="text-[10px] text-slate-500 truncate">{m.apelido}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <Label className="text-xs">Descrição</Label>
            <Textarea placeholder="Detalhes..." value={descricao} onChange={e => setDescricao(e.target.value)} rows={2} className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isPending || !titulo || !dataInicio}>
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : isEdit ? <Check className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            {isEdit ? "Salvar alterações" : "Criar"}
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
  const [editEvento, setEditEvento] = useState<any | null>(null);
  const [filtroFonte, setFiltroFonte] = useState("todos");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
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
          <HojeView onStatusChange={handleStatus} onDelete={handleDelete} onEdit={(ev) => setEditEvento(ev)} />
        </TabsContent>

        {/* LISTA */}
        <TabsContent value="lista" className="mt-5 space-y-4">
          <ListaView
            busca={busca}
            setBusca={setBusca}
            filtroFonte={filtroFonte}
            setFiltroFonte={setFiltroFonte}
            filtroTipo={filtroTipo}
            setFiltroTipo={setFiltroTipo}
            filtroStatus={filtroStatus}
            setFiltroStatus={setFiltroStatus}
            eventos={eventos}
            isLoading={isLoading}
            onStatusChange={handleStatus}
            onDelete={handleDelete}
            onEdit={(ev) => setEditEvento(ev)}
          />
        </TabsContent>

        {/* CALENDÁRIO */}
        <TabsContent value="calendario" className="mt-5">
          <CalendarioMensal
            eventos={eventosCalendario || []}
            onCriarEvento={() => setCriarOpen(true)}
          />
        </TabsContent>
      </Tabs>

      <CriarEventoDialog
        open={criarOpen || !!editEvento}
        onOpenChange={(o) => {
          if (!o) { setCriarOpen(false); setEditEvento(null); }
          else setCriarOpen(true);
        }}
        eventoEdit={editEvento}
        onSuccess={() => { refetch(); setEditEvento(null); }}
      />
    </div>
  );
}
