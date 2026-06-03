/**
 * Página Agendamento — Compromissos, Prazos e Cal.com
 * Etapa 2 + 4: Calendário com integrações
 */

import { useState, useMemo, useEffect } from "react";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  CalendarDays, Plus, Loader2, Clock,
  CheckCircle, ChevronLeft, ChevronRight, Trash2, Ban, CalendarOff, Download,
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
  prazo_processual: "bg-red-100 text-red-700 border-red-200",
  audiencia: "bg-violet-100 text-violet-700 border-violet-200",
  reuniao_comercial: "bg-blue-100 text-blue-700 border-blue-200",
  tarefa: "bg-emerald-100 text-emerald-700 border-emerald-200",
  follow_up: "bg-amber-100 text-amber-700 border-amber-200",
  outro: "bg-gray-100 text-gray-700 border-gray-200",
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Agendamento() {
  const [tab, setTab] = useState("calendario");
  const [showCriar, setShowCriar] = useState(false);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [bloquearDialog, setBloquearDialog] = useState<{ ano: number; mes: number; dia: number } | null>(null);

  // Queries
  const agendamentosQuery = trpc.agendamento.listar.useQuery({
    dataInicio: new Date(currentYear, currentMonth, 1).toISOString(),
    dataFim: new Date(currentYear, currentMonth + 1, 0, 23, 59, 59).toISOString(),
  });
  const contadoresQuery = trpc.agendamento.contadores.useQuery();
  const proximosQuery = trpc.agendamento.proximos.useQuery({ limite: 5 });
  const bloqueiosQuery = trpc.agendamento.bloqueiosListar.useQuery();

  const agendamentos = agendamentosQuery.data || [];
  const bloqueios = bloqueiosQuery.data || [];

  // Resolve quais dias do MÊS visível estão bloqueados, expandindo
  // recorrência anual (feriado fixo bate todo ano nessa data/mês).
  // Map: dia → bloqueios aplicáveis (1+ pode existir).
  const bloqueiosPorDia = useMemo(() => {
    const map: Record<number, typeof bloqueios> = {};
    const mes2 = String(currentMonth + 1).padStart(2, "0");
    for (const b of bloqueios) {
      const [bAno, bMes, bDia] = b.data.split("-");
      const bate = b.recorrenteAnual ? bMes === mes2 : (bMes === mes2 && Number(bAno) === currentYear);
      if (!bate) continue;
      const dia = Number(bDia);
      if (!map[dia]) map[dia] = [];
      map[dia].push(b);
    }
    return map;
  }, [bloqueios, currentMonth, currentYear]);

  const importarMut = trpc.agendamento.bloqueioImportarFeriadosNacionais.useMutation({
    onSuccess: (r) => {
      bloqueiosQuery.refetch();
      toast.success(r.criados > 0
        ? `${r.criados} feriado(s) importado(s)${r.jaExistiam ? ` (${r.jaExistiam} já existiam)` : ""}`
        : "Todos os feriados nacionais já estavam cadastrados.");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const removerBloqueioMut = trpc.agendamento.bloqueioExcluir.useMutation({
    onSuccess: () => { bloqueiosQuery.refetch(); toast.success("Bloqueio removido"); },
    onError: (e: any) => toast.error(e.message),
  });

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
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-orange-100 dark:bg-orange-900/30">
          <CalendarDays className="h-6 w-6 text-orange-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Agendamento</h1>
          <p className="text-sm text-muted-foreground">Compromissos, prazos e tarefas do escritório</p>
        </div>
        <Button
          variant="outline"
          onClick={() => importarMut.mutate({ ano: currentYear })}
          disabled={importarMut.isPending}
          title={`Cria os 12 feriados federais de ${currentYear} como bloqueios anuais recorrentes. Idempotente — não duplica se já existirem.`}
        >
          {importarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Feriados {currentYear}
        </Button>
        <Button onClick={() => setShowCriar(true)}>
          <Plus className="h-4 w-4 mr-2" /> Novo
        </Button>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Pendentes", val: c.pendente, cls: "border-amber-200 bg-amber-50/50", txtCls: "text-amber-600", numCls: "text-amber-700" },
          { label: "Em Andamento", val: c.em_andamento, cls: "border-blue-200 bg-blue-50/50", txtCls: "text-blue-600", numCls: "text-blue-700" },
          { label: "Concluídos", val: c.concluido, cls: "border-emerald-200 bg-emerald-50/50", txtCls: "text-emerald-600", numCls: "text-emerald-700" },
          { label: "Atrasados", val: c.atrasado, cls: "border-red-200 bg-red-50/50", txtCls: "text-red-600", numCls: "text-red-700" },
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
                {renderCalendarDays(currentYear, currentMonth, agendamentosPorDia, bloqueiosPorDia, selectedDay, (day) => setSelectedDay(day === selectedDay ? null : day))}
              </div>

              {selectedDay && (
                <div className="mt-4 pt-4 border-t">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold">{selectedDay} de {MESES[currentMonth]}</h4>
                    <Button size="sm" variant="outline"
                      onClick={() => setBloquearDialog({ ano: currentYear, mes: currentMonth, dia: selectedDay })}
                    >
                      <Ban className="h-3.5 w-3.5 mr-1.5" /> Bloquear
                    </Button>
                  </div>
                  {bloqueiosPorDia[selectedDay]?.length ? (
                    <div className="space-y-1.5 mb-3">
                      {bloqueiosPorDia[selectedDay].map((b) => (
                        <div key={b.id} className="flex items-center gap-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-md px-2.5 py-1.5">
                          <CalendarOff className="h-3.5 w-3.5 text-red-600 shrink-0" />
                          <span className="font-medium text-red-700 dark:text-red-300">
                            {b.horaInicio && b.horaFim ? `${b.horaInicio}–${b.horaFim}` : "Dia inteiro"}
                          </span>
                          {b.motivo && <span className="text-red-600/80 dark:text-red-400/80 truncate">· {b.motivo}</span>}
                          {b.recorrenteAnual && <Badge variant="outline" className="ml-1 text-[10px] h-4 px-1 border-red-300 text-red-700">anual</Badge>}
                          <button
                            className="ml-auto text-red-600 hover:text-red-800"
                            onClick={() => removerBloqueioMut.mutate({ id: b.id })}
                            title="Remover bloqueio"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {agendamentosPorDia[selectedDay]?.length ? (
                    <div className="space-y-2">
                      {agendamentosPorDia[selectedDay].map((a) => (
                        <AgendamentoCard key={a.id} agendamento={a} onUpdated={() => agendamentosQuery.refetch()} />
                      ))}
                    </div>
                  ) : (!bloqueiosPorDia[selectedDay]?.length && (
                    <p className="text-sm text-muted-foreground">Nenhum compromisso neste dia.</p>
                  ))}
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

      <BloquearDiaDialog
        ctx={bloquearDialog}
        onOpenChange={(o) => { if (!o) setBloquearDialog(null); }}
        onCreated={() => bloqueiosQuery.refetch()}
      />
    </div>
  );
}

// ─── Bloquear Dia Dialog ────────────────────────────────────────────────────

function BloquearDiaDialog({
  ctx, onOpenChange, onCreated,
}: {
  ctx: { ano: number; mes: number; dia: number } | null;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [modo, setModo] = useState<"dia" | "horario">("dia");
  const [horaInicio, setHoraInicio] = useState("12:00");
  const [horaFim, setHoraFim] = useState("14:00");
  const [motivo, setMotivo] = useState("");
  const [recorrenteAnual, setRecorrenteAnual] = useState(false);

  // Reset ao abrir/trocar de dia
  useEffect(() => {
    if (ctx) {
      setModo("dia"); setHoraInicio("12:00"); setHoraFim("14:00");
      setMotivo(""); setRecorrenteAnual(false);
    }
  }, [ctx]);

  const criarMut = trpc.agendamento.bloqueioCriar.useMutation({
    onSuccess: () => { onCreated(); onOpenChange(false); toast.success("Bloqueio criado"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!ctx) return null;
  const dataISO = `${ctx.ano}-${String(ctx.mes + 1).padStart(2, "0")}-${String(ctx.dia).padStart(2, "0")}`;

  return (
    <Dialog open={!!ctx} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bloquear {ctx.dia} de {MESES[ctx.mes]} de {ctx.ano}</DialogTitle>
          <DialogDescription>
            Dias e horários bloqueados não aparecem na agenda do cliente — a IA não oferece.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setModo("dia")}
              className={`flex-1 px-3 py-2 text-sm rounded-md border ${modo === "dia" ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20 font-medium" : "border-muted"}`}
            >
              Dia inteiro
            </button>
            <button
              type="button"
              onClick={() => setModo("horario")}
              className={`flex-1 px-3 py-2 text-sm rounded-md border ${modo === "horario" ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20 font-medium" : "border-muted"}`}
            >
              Horário específico
            </button>
          </div>

          {modo === "horario" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="bloq-ini">Início</Label>
                <Input id="bloq-ini" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bloq-fim">Fim</Label>
                <Input id="bloq-fim" type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="bloq-motivo">Motivo (opcional)</Label>
            <Input id="bloq-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: Feriado municipal, evento interno..." maxLength={200} />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="bloq-anual" className="cursor-pointer">Repetir todo ano nessa data</Label>
              <p className="text-xs text-muted-foreground">Use pra feriados fixos (ex: 25/12, 01/01).</p>
            </div>
            <Switch id="bloq-anual" checked={recorrenteAnual} onCheckedChange={setRecorrenteAnual} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => criarMut.mutate({
              data: dataISO,
              horaInicio: modo === "horario" ? horaInicio : null,
              horaFim: modo === "horario" ? horaFim : null,
              motivo: motivo.trim() || null,
              recorrenteAnual,
            })}
            disabled={criarMut.isPending}
          >
            {criarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Bloquear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Calendar Grid ──────────────────────────────────────────────────────────

function renderCalendarDays(
  year: number, month: number, eventos: Record<number, any[]>,
  bloqueiosPorDia: Record<number, Array<{ horaInicio: string | null; motivo: string | null }>>,
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
    const dayBloqueios = bloqueiosPorDia[day] || [];
    const diaInteiroBloqueado = dayBloqueios.some((b) => !b.horaInicio);
    const isToday = isCurrentMonth && today.getDate() === day;
    const isSelected = selectedDay === day;

    cells.push(
      <button key={day} onClick={() => onSelect(day)}
        className={`h-20 p-1 text-left border rounded-md transition-colors hover:bg-muted/50 ${
          isSelected
            ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
            : diaInteiroBloqueado
              ? "border-red-200 bg-red-50/60 dark:bg-red-900/10"
              : "border-transparent"
        } ${isToday ? "ring-2 ring-blue-300" : ""}`}
        title={diaInteiroBloqueado ? dayBloqueios.find((b) => !b.horaInicio)?.motivo || "Dia bloqueado" : undefined}
      >
        <span className={`text-xs font-medium ${isToday ? "bg-blue-600 text-white px-1.5 py-0.5 rounded-full" : diaInteiroBloqueado ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>
          {day}
        </span>
        <div className="mt-0.5 space-y-0.5 overflow-hidden">
          {diaInteiroBloqueado ? (
            <div className="text-[10px] leading-tight truncate px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 flex items-center gap-1">
              <CalendarOff className="h-2.5 w-2.5" />
              <span className="truncate">{dayBloqueios.find((b) => !b.horaInicio)?.motivo || "Bloqueado"}</span>
            </div>
          ) : (
            <>
              {dayEvents.slice(0, 3).map((e: any, i: number) => (
                <div key={i} className="text-[10px] leading-tight truncate px-1 py-0.5 rounded"
                  style={{ backgroundColor: `${e.corHex}20`, color: e.corHex }}>{e.titulo}</div>
              ))}
              {dayEvents.length > 3 && <span className="text-[10px] text-muted-foreground">+{dayEvents.length - 3}</span>}
              {dayBloqueios.length > 0 && (
                <div className="text-[10px] text-red-600 dark:text-red-400">{dayBloqueios.length} bloqueio(s)</div>
              )}
            </>
          )}
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
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
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

