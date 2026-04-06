import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckSquare, Plus, Loader2, Search, Calendar, Clock, AlertTriangle, User, Trash2, Check, X } from "lucide-react";

const STATUS_LABELS: Record<string, string> = { pendente: "Pendente", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada" };
const STATUS_CORES: Record<string, string> = { pendente: "bg-amber-100 text-amber-700", em_andamento: "bg-blue-100 text-blue-700", concluida: "bg-emerald-100 text-emerald-700", cancelada: "bg-gray-100 text-gray-500" };
const PRIOR_CORES: Record<string, string> = { urgente: "bg-red-500", alta: "bg-orange-400", normal: "bg-blue-400", baixa: "bg-gray-300" };

export default function Tarefas() {
  const [filtroStatus, setFiltroStatus] = useState<string>("todas");
  const [busca, setBusca] = useState(""); const [buscaD, setBuscaD] = useState("");
  const [showNova, setShowNova] = useState(false);
  useEffect(() => { const t = setTimeout(() => setBuscaD(busca), 300); return () => clearTimeout(t); }, [busca]);

  const { data: contadores } = (trpc as any).tarefas.contadores.useQuery(undefined, { refetchInterval: 30000 });
  const { data: tarefas, refetch } = (trpc as any).tarefas.listar.useQuery(
    { status: filtroStatus !== "todas" ? filtroStatus : undefined, busca: buscaD || undefined },
    { refetchInterval: 15000 }
  );
  const atualizarMut = (trpc as any).tarefas.atualizar.useMutation({ onSuccess: () => refetch() });
  const excluirMut = (trpc as any).tarefas.excluir.useMutation({ onSuccess: () => { refetch(); toast.success("Excluída."); } });

  const lista = tarefas || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><CheckSquare className="h-5 w-5 text-primary" /> Tarefas</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {contadores ? `${contadores.pendentes} pendentes · ${contadores.vencidas} vencidas · ${contadores.minhas} suas` : "Carregando..."}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNova(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Nova Tarefa</Button>
      </div>

      {/* Busca + filtros */}
      <div className="flex gap-2 items-center">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar tarefas..." value={busca} onChange={e => setBusca(e.target.value)} className="h-9 pl-9" />
        </div>
        <div className="flex gap-1">
          {(["todas", "pendente", "em_andamento", "concluida"] as const).map(s => (
            <Button key={s} variant={filtroStatus === s ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setFiltroStatus(s)}>
              {s === "todas" ? "Todas" : STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {!lista.length ? (
        <Card><CardContent className="text-center py-16">
          <CheckSquare className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma tarefa encontrada.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowNova(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Criar Tarefa</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {lista.map((t: any) => (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/20 transition-colors group">
              {/* Checkbox para concluir */}
              <button
                className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${t.status === "concluida" ? "bg-emerald-500 border-emerald-500 text-white" : "border-muted-foreground/30 hover:border-emerald-400"}`}
                onClick={() => atualizarMut.mutate({ id: t.id, status: t.status === "concluida" ? "pendente" : "concluida" })}
              >
                {t.status === "concluida" && <Check className="h-3 w-3" />}
              </button>

              {/* Barra de prioridade */}
              <div className={`w-1 h-8 rounded-full ${PRIOR_CORES[t.prioridade] || "bg-gray-300"}`} />

              {/* Conteúdo */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${t.status === "concluida" ? "line-through text-muted-foreground" : ""}`}>{t.titulo}</p>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                  {t.responsavelNome && <span className="flex items-center gap-0.5"><User className="h-2.5 w-2.5" /> {t.responsavelNome}</span>}
                  {t.dataVencimento && <span className={`flex items-center gap-0.5 ${t.vencida ? "text-red-500 font-medium" : ""}`}><Calendar className="h-2.5 w-2.5" /> {new Date(t.dataVencimento).toLocaleDateString("pt-BR")}</span>}
                  {t.vencida && <AlertTriangle className="h-3 w-3 text-red-500" />}
                </div>
              </div>

              {/* Status badge */}
              <Badge className={`text-[9px] px-1.5 py-0 ${STATUS_CORES[t.status] || ""}`}>{STATUS_LABELS[t.status]}</Badge>

              {/* Ações */}
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {t.status !== "em_andamento" && t.status !== "concluida" && (
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-blue-600" title="Iniciar" onClick={() => atualizarMut.mutate({ id: t.id, status: "em_andamento" })}><Clock className="h-3 w-3" /></Button>
                )}
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => { if (confirm("Excluir tarefa?")) excluirMut.mutate({ id: t.id }); }}><Trash2 className="h-3 w-3" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <NovaTarefaDialog open={showNova} onOpenChange={setShowNova} onSuccess={() => { refetch(); setShowNova(false); }} />
    </div>
  );
}

function NovaTarefaDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void }) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prioridade, setPrioridade] = useState<string>("normal");
  const [dataVenc, setDataVenc] = useState("");
  const criar = (trpc as any).tarefas.criar.useMutation({ onSuccess: () => { toast.success("Tarefa criada!"); setTitulo(""); setDescricao(""); setPrioridade("normal"); setDataVenc(""); onSuccess(); }, onError: (e: any) => toast.error(e.message) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Nova Tarefa</DialogTitle></DialogHeader>
      <div className="space-y-3 py-2">
        <div className="space-y-1.5"><Label>Título *</Label><Input placeholder="Ex: Ligar para João, Enviar contrato..." value={titulo} onChange={e => setTitulo(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Descrição</Label><Input placeholder="Detalhes opcionais" value={descricao} onChange={e => setDescricao(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Prioridade</Label>
            <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={prioridade} onChange={e => setPrioridade(e.target.value)}>
              <option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
            </select>
          </div>
          <div className="space-y-1.5"><Label>Vencimento</Label><Input type="date" value={dataVenc} onChange={e => setDataVenc(e.target.value)} /></div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button onClick={() => criar.mutate({ titulo, descricao: descricao || undefined, prioridade: prioridade as any, dataVencimento: dataVenc ? new Date(dataVenc + "T23:59:59").toISOString() : undefined })} disabled={!titulo || criar.isPending}>
          {criar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Criar
        </Button>
      </DialogFooter>
    </DialogContent></Dialog>
  );
}
