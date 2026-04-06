import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  CalendarDays, Plus, Loader2, Trash2, CheckCircle, Clock, AlertTriangle,
  ChevronLeft, ChevronRight, List, LayoutGrid, MapPin, User,
} from "lucide-react";
import { toast } from "sonner";
import {
  TIPO_LABELS, TIPO_CORES, PRIORIDADE_LABELS, STATUS_LABELS,
  type TipoAgendamento, type PrioridadeAgendamento, type StatusAgendamento,
} from "@shared/agendamento-constants";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}
function formatTime(d: string) {
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function formatDateTime(d: string) {
  return `${formatDate(d)} às ${formatTime(d)}`;
}
function isSameDay(d1: Date, d2: Date) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

const TIPOS: { value: TipoAgendamento; label: string; cor: string }[] = [
  { value: "prazo_processual", label: "Prazo Processual", cor: "#ef4444" },
  { value: "audiencia", label: "Audiência", cor: "#8b5cf6" },
  { value: "reuniao_comercial", label: "Reunião Comercial", cor: "#3b82f6" },
  { value: "tarefa", label: "Tarefa", cor: "#10b981" },
  { value: "follow_up", label: "Follow-up", cor: "#f59e0b" },
  { value: "outro", label: "Outro", cor: "#6b7280" },
];

function PrioridadeBadge({ p }: { p: string }) {
  const colors: Record<string, string> = {
    baixa: "bg-gray-100 text-gray-600", normal: "bg-blue-100 text-blue-700",
    alta: "bg-amber-100 text-amber-700", critica: "bg-red-100 text-red-700",
  };
  return <Badge variant="outline" className={`text-[10px] ${colors[p] || ""}`}>{PRIORIDADE_LABELS[p as PrioridadeAgendamento] || p}</Badge>;
}

function StatusBadge({ s }: { s: string }) {
  const colors: Record<string, string> = {
    pendente: "bg-yellow-100 text-yellow-700", em_andamento: "bg-blue-100 text-blue-700",
    concluido: "bg-emerald-100 text-emerald-700", cancelado: "bg-gray-100 text-gray-500",
    atrasado: "bg-red-100 text-red-700",
  };
  return <Badge variant="outline" className={`text-[10px] ${colors[s] || ""}`}>{STATUS_LABELS[s as StatusAgendamento] || s}</Badge>;
}

// ─── Calendar Grid ──────────────────────────────────────────────────────────

function CalendarMonth({ ano, mes, eventos, onDayClick }: {
  ano: number; mes: number; eventos: any[]; onDayClick: (date: Date) => void;
}) {
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const diasNoMes = ultimoDia.getDate();
  const diaSemanaInicio = primeiroDia.getDay();
  const hoje = new Date();

  const cells: (number | null)[] = [];
  for (let i = 0; i < diaSemanaInicio; i++) cells.push(null);
  for (let d = 1; d <= diasNoMes; d++) cells.push(d);

  const getEventosDia = (dia: number) => {
    const date = new Date(ano, mes, dia);
    return eventos.filter((e: any) => isSameDay(new Date(e.dataInicio), date));
  };

  return (
    <div>
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
          <div key={d} className="bg-muted/50 p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
        ))}
        {cells.map((dia, i) => {
          if (dia === null) return <div key={`empty-${i}`} className="bg-background p-1 min-h-[80px]" />;
          const evts = getEventosDia(dia);
          const isHoje = isSameDay(new Date(ano, mes, dia), hoje);
          return (
            <div key={dia} className={`bg-background p-1 min-h-[80px] cursor-pointer hover:bg-muted/30 transition-colors ${isHoje ? "ring-2 ring-primary ring-inset" : ""}`}
              onClick={() => onDayClick(new Date(ano, mes, dia))}>
              <span className={`text-xs font-medium ${isHoje ? "text-primary font-bold" : "text-foreground"}`}>{dia}</span>
              <div className="mt-0.5 space-y-0.5">
                {evts.slice(0, 3).map((e: any) => (
                  <div key={e.id} className="text-[10px] leading-tight px-1 py-0.5 rounded truncate text-white" style={{ backgroundColor: e.corHex || "#3b82f6" }}>
                    {e.titulo}
                  </div>
                ))}
                {evts.length > 3 && <div className="text-[10px] text-muted-foreground px-1">+{evts.length - 3} mais</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Form Dialog ────────────────────────────────────────────────────────────

function AgendamentoFormDialog({ open, onOpenChange, onSuccess, defaultDate }: {
  open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void; defaultDate?: Date;
}) {
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<TipoAgendamento>("tarefa");
  const [descricao, setDescricao] = useState("");
  const [dataInicio, setDataInicio] = useState(defaultDate ? defaultDate.toISOString().slice(0, 16) : "");
  const [dataFim, setDataFim] = useState("");
  const [diaInteiro, setDiaInteiro] = useState(false);
  const [local, setLocal] = useState("");
  const [prioridade, setPrioridade] = useState<PrioridadeAgendamento>("normal");

  const criarMut = trpc.agendamento.criar.useMutation({
    onSuccess: () => { toast.success("Agendamento criado!"); onOpenChange(false); onSuccess(); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => {
    setTitulo(""); setTipo("tarefa"); setDescricao(""); setDataInicio(""); setDataFim(""); setDiaInteiro(false); setLocal(""); setPrioridade("normal");
  };

  const handleSubmit = () => {
    if (!titulo || !dataInicio) { toast.error("Preencha título e data."); return; }
    criarMut.mutate({
      tipo, titulo, descricao: descricao || undefined, dataInicio: new Date(dataInicio).toISOString(),
      dataFim: dataFim ? new Date(dataFim).toISOString() : undefined,
      diaInteiro, local: local || undefined, prioridade,
      corHex: TIPO_CORES[tipo],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Agendamento</DialogTitle>
          <DialogDescription>Crie um compromisso, prazo ou tarefa</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Tipo *</Label>
            <div className="grid grid-cols-3 gap-2">
              {TIPOS.map((t) => (
                <button key={t.value} onClick={() => setTipo(t.value)}
                  className={`p-2 rounded-lg border text-xs font-medium text-left transition-all ${tipo === t.value ? "ring-2 ring-offset-1" : "hover:bg-muted/50"}`}
                  style={{ borderColor: tipo === t.value ? t.cor : undefined }}>
                  <div className="h-2 w-2 rounded-full mb-1" style={{ backgroundColor: t.cor }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Título *</Label>
            <Input placeholder="Ex: Audiência TJ — Processo 123..." value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Data/hora início *</Label>
              <Input type="datetime-local" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Data/hora fim</Label>
              <Input type="datetime-local" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={diaInteiro} onCheckedChange={setDiaInteiro} id="diaInteiro" />
            <Label htmlFor="diaInteiro" className="text-sm cursor-pointer">Dia inteiro</Label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Local</Label>
              <Input placeholder="Endereço ou link" value={local} onChange={(e) => setLocal(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Prioridade</Label>
              <Select value={prioridade} onValueChange={(v) => setPrioridade(v as PrioridadeAgendamento)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="critica">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Textarea placeholder="Observações..." rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={criarMut.isPending}>
            {criarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Agendamento() {
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [mesAtual, setMesAtual] = useState(() => { const d = new Date(); return { ano: d.getFullYear(), mes: d.getMonth() }; });
  const [showForm, setShowForm] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");

  const inicioMes = new Date(mesAtual.ano, mesAtual.mes, 1);
  const fimMes = new Date(mesAtual.ano, mesAtual.mes + 1, 0);

  const { data: agendamentos = [], isLoading, refetch } = trpc.agendamento.listar.useQuery({
    dataInicio: inicioMes.toISOString(),
    dataFim: fimMes.toISOString(),
  });

  const deleteMut = trpc.agendamento.deletar.useMutation({
    onSuccess: () => { toast.success("Agendamento deletado!"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtrados = agendamentos.filter((a: any) => {
    if (filtroTipo !== "todos" && a.tipo !== filtroTipo) return false;
    if (filtroStatus !== "todos" && a.status !== filtroStatus) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Agendamentos</h1>
        <p className="text-muted-foreground">Gerencie seus compromissos, prazos e tarefas</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Calendário</CardTitle>
            <CardDescription>Visualize seus agendamentos</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant={viewMode === "calendar" ? "default" : "outline"} size="sm" onClick={() => setViewMode("calendar")}>
              <LayoutGrid className="h-4 w-4 mr-1" /> Calendário
            </Button>
            <Button variant={viewMode === "list" ? "default" : "outline"} size="sm" onClick={() => setViewMode("list")}>
              <List className="h-4 w-4 mr-1" /> Lista
            </Button>
            <Button onClick={() => setShowForm(true)} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Novo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {viewMode === "calendar" && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{new Date(mesAtual.ano, mesAtual.mes).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</h3>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setMesAtual((m) => ({ ...m, mes: m.mes - 1 === -1 ? 11 : m.mes - 1, ano: m.mes - 1 === -1 ? m.ano - 1 : m.ano }))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setMesAtual((m) => ({ ...m, mes: (m.mes + 1) % 12, ano: m.mes + 1 === 12 ? m.ano + 1 : m.ano }))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CalendarMonth ano={mesAtual.ano} mes={mesAtual.mes} eventos={filtrados} onDayClick={(d) => { setSelectedDate(d); setShowForm(true); }} />
            </>
          )}

          {viewMode === "list" && (
            <div className="space-y-2">
              <div className="flex gap-2 mb-4">
                <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os tipos</SelectItem>
                    {Object.entries(TIPO_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os status</SelectItem>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {filtrados.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">Nenhum agendamento encontrado</div>
              ) : (
                filtrados.map((a: any) => (
                  <Card key={a.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold">{a.titulo}</h4>
                          <PrioridadeBadge p={a.prioridade} />
                          <StatusBadge s={a.status} />
                        </div>
                        <p className="text-sm text-muted-foreground">{a.descricao}</p>
                        <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                          {a.dataInicio && <span><CalendarDays className="h-3 w-3 inline mr-1" />{formatDateTime(a.dataInicio)}</span>}
                          {a.local && <span><MapPin className="h-3 w-3 inline mr-1" />{a.local}</span>}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate({ id: a.id })} disabled={deleteMut.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AgendamentoFormDialog open={showForm} onOpenChange={setShowForm} onSuccess={() => refetch()} defaultDate={selectedDate} />
    </div>
  );
}

export { PrioridadeBadge, StatusBadge, CalendarMonth, AgendamentoFormDialog };
