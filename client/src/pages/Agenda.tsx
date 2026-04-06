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
  Briefcase, Scale, Users, PhoneCall, MoreHorizontal, Check,
} from "lucide-react";
import { toast } from "sonner";

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

  return (
    <div className={`flex items-start gap-3 py-3 px-4 rounded-lg border transition-all hover:shadow-sm ${overdue ? "border-red-200 bg-red-50/50 dark:bg-red-950/10" : "bg-card"}`}>
      {/* Color dot */}
      <div className="mt-1.5 shrink-0">
        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ev.cor }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-medium ${ev.status === "concluido" || ev.status === "concluida" ? "line-through text-muted-foreground" : ""}`}>
            {ev.titulo}
          </p>
          {overdue && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${STATUS_CORES[ev.status] || ""}`}>
            {STATUS_LABELS[ev.status] || ev.status}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {ev.fonte === "compromisso" ? TIPO_LABELS[ev.tipo] || ev.tipo : "Tarefa"}
          </span>
          {ev.responsavelNome && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Users className="h-2.5 w-2.5" />{ev.responsavelNome}
            </span>
          )}
          {ev.contatoNome && (
            <span className="text-[10px] text-muted-foreground">
              → {ev.contatoNome}
            </span>
          )}
        </div>
      </div>

      {/* Date/time */}
      <div className="text-right shrink-0 space-y-0.5">
        <p className="text-xs font-medium">{formatDate(ev.dataInicio)}</p>
        {!ev.diaInteiro && <p className="text-[10px] text-muted-foreground">{formatTime(ev.dataInicio)}</p>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {ev.status !== "concluido" && ev.status !== "concluida" && ev.status !== "cancelado" && ev.status !== "cancelada" && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600" title="Concluir"
            onClick={() => onStatusChange(ev.id, ev.fonte, "concluido")}>
            <Check className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Excluir"
          onClick={() => { if (confirm("Excluir este evento?")) onDelete(ev.id, ev.fonte); }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEW: CALENDÁRIO MENSAL
// ═══════════════════════════════════════════════════════════════════════════════

function CalendarioMensal({ eventos, onStatusChange, onDelete }: {
  eventos: any[];
  onStatusChange: (id: number, fonte: string, status: string) => void;
  onDelete: (id: number, fonte: string) => void;
}) {
  const [mes, setMes] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  const diasDoMes = useMemo(() => {
    const first = new Date(mes.getFullYear(), mes.getMonth(), 1);
    const last = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const startDay = first.getDay(); // 0=dom
    const dias: Array<{ date: Date | null; eventos: any[] }> = [];

    // Preencher dias vazios antes
    for (let i = 0; i < startDay; i++) dias.push({ date: null, eventos: [] });

    // Dias do mês
    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(mes.getFullYear(), mes.getMonth(), d);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const evDia = eventos.filter(ev => {
        const evDate = new Date(ev.dataInicio);
        return `${evDate.getFullYear()}-${String(evDate.getMonth() + 1).padStart(2, "0")}-${String(evDate.getDate()).padStart(2, "0")}` === dateStr;
      });
      dias.push({ date, eventos: evDia });
    }

    return dias;
  }, [mes, eventos]);

  const isToday = (d: Date) => {
    const t = new Date();
    return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
  };

  const mesLabel = mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-sm font-semibold capitalize">{mesLabel}</h3>
        <Button variant="ghost" size="sm" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(d => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1.5 bg-muted/50">{d}</div>
        ))}
        {diasDoMes.map((dia, i) => (
          <div key={i} className={`min-h-[80px] p-1 bg-card ${!dia.date ? "bg-muted/20" : ""} ${dia.date && isToday(dia.date) ? "ring-2 ring-primary ring-inset" : ""}`}>
            {dia.date && (
              <>
                <p className={`text-xs font-medium mb-0.5 ${isToday(dia.date) ? "text-primary" : "text-muted-foreground"}`}>
                  {dia.date.getDate()}
                </p>
                <div className="space-y-0.5">
                  {dia.eventos.slice(0, 3).map(ev => (
                    <div key={`${ev.fonte}-${ev.id}`} className="text-[9px] px-1 py-0.5 rounded truncate" style={{ backgroundColor: ev.cor + "20", color: ev.cor, borderLeft: `2px solid ${ev.cor}` }}>
                      {!ev.diaInteiro && formatTime(ev.dataInicio) + " "}{ev.titulo}
                    </div>
                  ))}
                  {dia.eventos.length > 3 && (
                    <p className="text-[9px] text-muted-foreground text-center">+{dia.eventos.length - 3}</p>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
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
          <h3 className="text-sm font-semibold flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-4 w-4" />
            Atrasados ({atrasados.length})
          </h3>
          {atrasados.map(ev => (
            <EventoCard key={`${ev.fonte}-${ev.id}`} ev={ev} onStatusChange={onStatusChange} onDelete={onDelete} />
          ))}
        </div>
      )}

      {hoje.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sun className="h-4 w-4 text-amber-500" />
            Hoje ({hoje.length})
          </h3>
          {hoje.map(ev => (
            <EventoCard key={`${ev.fonte}-${ev.id}`} ev={ev} onStatusChange={onStatusChange} onDelete={onDelete} />
          ))}
        </div>
      )}

      {amanha.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            Amanhã ({amanha.length})
          </h3>
          {amanha.map(ev => (
            <EventoCard key={`${ev.fonte}-${ev.id}`} ev={ev} onStatusChange={onStatusChange} onDelete={onDelete} />
          ))}
        </div>
      )}
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

  const atualizarMut = trpc.agenda.atualizarStatus.useMutation({ onSuccess: () => { refetch(); toast.success("Atualizado"); } });
  const excluirMut = trpc.agenda.excluir.useMutation({ onSuccess: () => { refetch(); toast.success("Excluído"); } });

  const handleStatus = (id: number, fonte: string, status: string) => atualizarMut.mutate({ id, fonte: fonte as any, status });
  const handleDelete = (id: number, fonte: string) => excluirMut.mutate({ id, fonte: fonte as any });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-muted-foreground mt-1">Compromissos, tarefas e prazos em um só lugar.</p>
        </div>
        <Button onClick={() => setCriarOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Novo evento
        </Button>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="cursor-pointer hover:shadow-sm" onClick={() => setTab("hoje")}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Sun className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hoje</p>
                <p className="text-lg font-bold">{contadores?.hojeCount ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-sm" onClick={() => { setFiltroStatus("pendentes"); setTab("lista"); }}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Atrasados</p>
                <p className="text-lg font-bold text-red-600">{contadores?.atrasadosCount ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <ListTodo className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pendentes</p>
                <p className="text-lg font-bold">{contadores?.pendentesCount ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="hoje" className="gap-1.5"><Sun className="h-3.5 w-3.5" /> Hoje</TabsTrigger>
          <TabsTrigger value="lista" className="gap-1.5"><ListTodo className="h-3.5 w-3.5" /> Lista</TabsTrigger>
          <TabsTrigger value="calendario" className="gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Calendário</TabsTrigger>
        </TabsList>

        {/* HOJE */}
        <TabsContent value="hoje" className="mt-4">
          <HojeView onStatusChange={handleStatus} onDelete={handleDelete} />
        </TabsContent>

        {/* LISTA */}
        <TabsContent value="lista" className="mt-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-9 h-9" />
            </div>
            <Select value={filtroFonte} onValueChange={setFiltroFonte}>
              <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="compromisso">Compromissos</SelectItem>
                <SelectItem value="tarefa">Tarefas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pendentes">Pendentes</SelectItem>
                <SelectItem value="todos_status">Todos status</SelectItem>
                <SelectItem value="concluidos">Concluídos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
          ) : eventos && eventos.length > 0 ? (
            <div className="space-y-2">
              {eventos.map(ev => (
                <EventoCard key={`${ev.fonte}-${ev.id}`} ev={ev} onStatusChange={handleStatus} onDelete={handleDelete} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <CalendarClock className="h-10 w-10 opacity-30" />
              <p className="text-sm">Nenhum evento encontrado.</p>
            </div>
          )}
        </TabsContent>

        {/* CALENDÁRIO */}
        <TabsContent value="calendario" className="mt-4">
          <CalendarioMensal eventos={eventos || []} onStatusChange={handleStatus} onDelete={handleDelete} />
        </TabsContent>
      </Tabs>

      <CriarEventoDialog open={criarOpen} onOpenChange={setCriarOpen} onSuccess={refetch} />
    </div>
  );
}
