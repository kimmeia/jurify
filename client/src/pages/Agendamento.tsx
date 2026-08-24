/**
 * Página Agendamento — compromissos e prazos do escritório.
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  CalendarDays, Plus, Loader2, Clock,
  CheckCircle, ChevronLeft, ChevronRight, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  TIPO_LABELS, TIPO_CORES, PRIORIDADE_LABELS,
  type TipoAgendamento, type PrioridadeAgendamento,
} from "@shared/agendamento-constants";
import { NovoCompromissoDialog } from "@/components/NovoCompromissoDialog";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function formatDateBR(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function formatTimeBR(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const TIPO_ICONE_CORES: Record<string, string> = {
  prazo_processual: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/50",
  audiencia: "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800/50",
  reuniao_comercial: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/50",
  tarefa: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50",
  follow_up: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50",
  outro: "bg-gray-100 dark:bg-slate-800/60 text-gray-700 dark:text-slate-200 border-gray-200 dark:border-slate-700/80",
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Agendamento() {
  const [tab, setTab] = useState("calendario");
  const [showCriar, setShowCriar] = useState(false);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // Queries
  const agendamentosQuery = trpc.agendamento.listar.useQuery({
    dataInicio: new Date(currentYear, currentMonth, 1).toISOString(),
    dataFim: new Date(currentYear, currentMonth + 1, 0, 23, 59, 59).toISOString(),
  });
  const contadoresQuery = trpc.agendamento.contadores.useQuery();
  const proximosQuery = trpc.agendamento.proximos.useQuery({ limite: 5 });

  const agendamentos = agendamentosQuery.data || [];

  // Agrupar por dia
  const agendamentosPorDia = useMemo(() => {
    const map: Record<number, typeof agendamentos> = {};
    for (const a of agendamentos) {
      const dt = new Date(a.dataInicio);
      if (dt.getFullYear() === currentYear && dt.getMonth() === currentMonth) {
        const day = dt.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(a);
      }
    }
    return map;
  }, [agendamentos, currentYear, currentMonth]);

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); }
    else setCurrentMonth(currentMonth - 1);
    setSelectedDay(null);
  };

  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); }
    else setCurrentMonth(currentMonth + 1);
    setSelectedDay(null);
  };

  const c = contadoresQuery.data || { pendente: 0, em_andamento: 0, concluido: 0, atrasado: 0 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-orange-100 dark:bg-orange-900/30">
          <CalendarDays className="h-6 w-6 text-orange-600 dark:text-orange-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Agendamento</h1>
          <p className="text-sm text-muted-foreground">Compromissos, prazos e tarefas do escritório</p>
        </div>
        <Button onClick={() => setShowCriar(true)}>
          <Plus className="h-4 w-4 mr-2" /> Novo
        </Button>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Pendentes", val: c.pendente, cls: "border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/30", txtCls: "text-amber-600 dark:text-amber-400", numCls: "text-amber-700 dark:text-amber-300" },
          { label: "Em Andamento", val: c.em_andamento, cls: "border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/30", txtCls: "text-blue-600 dark:text-blue-400", numCls: "text-blue-700 dark:text-blue-300" },
          { label: "Concluídos", val: c.concluido, cls: "border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/30", txtCls: "text-emerald-600 dark:text-emerald-400", numCls: "text-emerald-700 dark:text-emerald-300" },
          { label: "Atrasados", val: c.atrasado, cls: "border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/30", txtCls: "text-red-600 dark:text-red-400", numCls: "text-red-700 dark:text-red-300" },
        ].map((item) => (
          <Card key={item.label} className={item.cls}>
            <CardContent className="pt-4 pb-3 px-4">
              <p className={`text-xs font-medium ${item.txtCls}`}>{item.label}</p>
              <p className={`text-2xl font-bold ${item.numCls}`}>{item.val}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="calendario">Calendário</TabsTrigger>
          <TabsTrigger value="lista">Lista</TabsTrigger>
          <TabsTrigger value="proximos">Próximos</TabsTrigger>
        </TabsList>

        {/* ─── Calendário ──────────────────────────────────────────── */}
        <TabsContent value="calendario" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
                <h3 className="text-lg font-semibold">{MESES[currentMonth]} {currentYear}</h3>
                <Button variant="ghost" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-px mb-1">
                {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                  <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px">
                {renderCalendarDays(currentYear, currentMonth, agendamentosPorDia, selectedDay, (day) => setSelectedDay(day === selectedDay ? null : day))}
              </div>

              {selectedDay && (
                <div className="mt-4 pt-4 border-t">
                  <h4 className="text-sm font-semibold mb-3">{selectedDay} de {MESES[currentMonth]}</h4>
                  {agendamentosPorDia[selectedDay]?.length ? (
                    <div className="space-y-2">
                      {agendamentosPorDia[selectedDay].map((a) => (
                        <AgendamentoCard key={a.id} agendamento={a} onUpdated={() => agendamentosQuery.refetch()} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum compromisso neste dia.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Lista ───────────────────────────────────────────────── */}
        <TabsContent value="lista" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {agendamentosQuery.isLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : agendamentos.length === 0 ? (
                <div className="text-center py-8">
                  <CalendarDays className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Nenhum compromisso neste mês</p>
                </div>
              ) : (
                <div className="space-y-2">{agendamentos.map((a) => (
                  <AgendamentoCard key={a.id} agendamento={a} onUpdated={() => agendamentosQuery.refetch()} />
                ))}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Próximos ────────────────────────────────────────────── */}
        <TabsContent value="proximos" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Próximos Compromissos</CardTitle></CardHeader>
            <CardContent>
              {proximosQuery.isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (proximosQuery.data || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum compromisso futuro.</p>
              ) : (
                <div className="space-y-2">
                  {(proximosQuery.data || []).map((a) => (
                    <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg border">
                      <div className="w-2 h-8 rounded-full" style={{ backgroundColor: a.corHex }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.titulo}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateBR(a.dataInicio)} às {formatTimeBR(a.dataInicio)}
                          {a.responsavelNome && ` • ${a.responsavelNome}`}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {TIPO_LABELS[a.tipo as TipoAgendamento] || a.tipo}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog Criar — usa o componente compartilhado */}
      <NovoCompromissoDialog
        open={showCriar}
        onOpenChange={(o) => { if (!o) setShowCriar(false); }}
        onCreated={() => {
          agendamentosQuery.refetch();
          contadoresQuery.refetch();
          proximosQuery.refetch();
        }}
      />
    </div>
  );
}

// ─── Calendar Grid ──────────────────────────────────────────────────────────

function renderCalendarDays(
  year: number, month: number, eventos: Record<number, any[]>,
  selectedDay: number | null, onSelect: (day: number) => void,
) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const cells = [];

  for (let i = 0; i < firstDay; i++) cells.push(<div key={`e-${i}`} className="h-20" />);

  for (let day = 1; day <= daysInMonth; day++) {
    const dayEvents = eventos[day] || [];
    const isToday = isCurrentMonth && today.getDate() === day;
    const isSelected = selectedDay === day;

    cells.push(
      <button key={day} onClick={() => onSelect(day)}
        className={`h-20 p-1 text-left border rounded-md transition-colors hover:bg-muted/50 ${
          isSelected ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20" : "border-transparent"
        } ${isToday ? "ring-2 ring-blue-300" : ""}`}>
        <span className={`text-xs font-medium ${isToday ? "bg-blue-600 text-white px-1.5 py-0.5 rounded-full" : "text-muted-foreground"}`}>{day}</span>
        <div className="mt-0.5 space-y-0.5 overflow-hidden">
          {dayEvents.slice(0, 3).map((e: any, i: number) => (
            <div key={i} className="text-[10px] leading-tight truncate px-1 py-0.5 rounded"
              style={{ backgroundColor: `${e.corHex}20`, color: e.corHex }}>{e.titulo}</div>
          ))}
          {dayEvents.length > 3 && <span className="text-[10px] text-muted-foreground">+{dayEvents.length - 3}</span>}
        </div>
      </button>
    );
  }
  return cells;
}

// ─── Agendamento Card ───────────────────────────────────────────────────────

function AgendamentoCard({ agendamento: a, onUpdated }: { agendamento: any; onUpdated: () => void }) {
  const atualizarMut = trpc.agendamento.atualizar.useMutation({
    onSuccess: () => { onUpdated(); toast.success("Atualizado"); },
    onError: (err: any) => toast.error(err.message),
  });
  const excluirMut = trpc.agendamento.excluir.useMutation({
    onSuccess: () => { onUpdated(); toast.success("Excluído"); },
    onError: (err: any) => toast.error(err.message),
  });
  const cores = TIPO_ICONE_CORES[a.tipo] || TIPO_ICONE_CORES.outro;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors">
      <div className="w-1.5 min-h-[3rem] rounded-full shrink-0" style={{ backgroundColor: a.corHex }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{a.titulo}</p>
          <Badge variant="outline" className={`text-[10px] ${cores} border shrink-0`}>
            {TIPO_LABELS[a.tipo as TipoAgendamento] || a.tipo}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatDateBR(a.dataInicio)} às {formatTimeBR(a.dataInicio)}
          {a.responsavelNome && ` • ${a.responsavelNome}`}
        </p>
        {a.descricao && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.descricao}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {a.status !== "concluido" && (
          <Button variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => atualizarMut.mutate({ id: a.id, status: "concluido" })}
            disabled={atualizarMut.isPending}
            title="Concluir">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => { if (confirm("Excluir?")) excluirMut.mutate({ id: a.id }); }} title="Excluir">
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </div>
    </div>
  );
}

// ─── Dialog Criar ───────────────────────────────────────────────────────────

