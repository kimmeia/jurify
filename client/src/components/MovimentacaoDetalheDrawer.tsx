/**
 * Drawer com detalhe de uma movimentação processual.
 *
 * Renderizado pelo NotificacoesSino quando o usuário clica numa notif
 * `tipo='movimentacao'` que tem `eventoId`. Mostra o texto completo da
 * mov + dados do monitoramento (apelido, CNJ, tribunal, data real
 * extraída do PJe — não a de detecção pelo cron).
 *
 * PR 3 vai adicionar botões de "Criar prazo" e "Criar tarefa"
 * pré-preenchidos com dados da mov.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { addBusinessDays, format } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ExternalLink,
  Clock,
  FileText,
  User,
  Loader2,
  CalendarClock,
  CheckSquare,
  Archive,
  Sparkles,
} from "lucide-react";

interface Props {
  eventoId: number | null;
  onClose: () => void;
}

const TIPO_LABEL: Record<string, string> = {
  lawsuit_cnj: "Processo",
  cpf: "CPF",
  cnpj: "CNPJ",
};

// Selo de desfecho da movimentação (classificação IA).
const DESFECHO_META: Record<string, { label: string; emoji: string; cls: string }> = {
  favoravel: { label: "Favorável", emoji: "🟢", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  desfavoravel: { label: "Desfavorável", emoji: "🔴", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  parcial: { label: "Parcial", emoji: "🟡", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  neutro: { label: "Sem mérito", emoji: "⚪", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

export default function MovimentacaoDetalheDrawer({ eventoId, onClose }: Props) {
  const [, setLocation] = useLocation();
  const [criarPrazoOpen, setCriarPrazoOpen] = useState(false);
  const [criarTarefaOpen, setCriarTarefaOpen] = useState(false);

  const { data, isLoading, error, refetch } = trpc.notificacoes.detalheEvento.useQuery(
    { eventoId: eventoId ?? 0 },
    { enabled: eventoId !== null && eventoId > 0, retry: false },
  );

  // Classifica a movimentação sob demanda (movs antigas não passaram pelo cron).
  const classificarMut = (trpc as any).processos.classificarEvento.useMutation({
    onSuccess: (r: any) => {
      if (r?.ok) { toast.success("Movimentação classificada ✨"); refetch(); }
      else toast.error("IA indisponível", { description: "Verifique a chave de IA nas configurações." });
    },
    onError: (e: any) => toast.error("Falha ao classificar", { description: e.message }),
  });

  const open = eventoId !== null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Detalhe da movimentação</SheetTitle>
          <SheetDescription>
            Movimentação detectada pelo monitoramento automático.
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="px-4 py-6 space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error?.data?.code === "NOT_FOUND" ? (
          // Evento foi limpo do banco (cron remove eventos antigos pra
          // liberar espaço — notificacoes.eventoId é intencionalmente um
          // soft FK). Mostra estado arquivado em vez de toast de erro.
          <div className="px-4 py-8 flex flex-col items-center gap-2 text-center">
            <Archive className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium">Movimentação arquivada</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Esta movimentação foi limpa do histórico (eventos antigos são
              removidos periodicamente para liberar espaço). O título e a
              data da notificação continuam disponíveis no inbox.
            </p>
          </div>
        ) : error ? (
          <div className="px-4 py-6 text-sm text-destructive">
            Não foi possível carregar: {error.message}
          </div>
        ) : data ? (
          <div className="px-4 py-4 space-y-4">
            {/* Classificação IA (desfecho / relevância / prazo) */}
            {(data.desfecho || data.relevancia || (data as any).prazoSugerido) && (
              <section className="flex items-center gap-1.5 flex-wrap">
                {data.desfecho && DESFECHO_META[data.desfecho] && (
                  <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${DESFECHO_META[data.desfecho].cls}`}>
                    {DESFECHO_META[data.desfecho].emoji} {DESFECHO_META[data.desfecho].label}
                  </span>
                )}
                {data.relevancia === "rotina" ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-slate-100 text-slate-500 border-slate-200">📄 Rotina</span>
                ) : data.relevancia === "relevante" ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-violet-50 text-violet-700 border-violet-200">⭐ Relevante</span>
                ) : null}
                {(data as any).prazoSugerido && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-orange-100 text-orange-700 border-orange-300">⏰ Requer prazo</span>
                )}
              </section>
            )}

            {/* Resumo IA (quando gerado) */}
            {data.resumoIa ? (
              <section className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Resumo (IA)</p>
                <p className="text-sm font-medium leading-snug">{data.resumoIa}</p>
              </section>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-full border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                disabled={classificarMut.isPending}
                onClick={() => classificarMut.mutate({ eventoId: data.id })}
              >
                {classificarMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                Classificar com IA
              </Button>
            )}

            {/* Cliente monitorado */}
            <section className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <User className="h-3 w-3" /> Cliente monitorado
              </p>
              <p className="text-sm font-medium">
                {data.apelido || data.searchKey || "(sem apelido)"}
              </p>
              {data.searchType && (
                <Badge variant="outline" className="text-[9px]">
                  {TIPO_LABEL[data.searchType] || data.searchType}: {data.searchKey}
                </Badge>
              )}
            </section>

            {/* CNJ + tribunal */}
            <section className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Processo
              </p>
              <p className="text-sm font-mono">{data.cnjAfetado || "—"}</p>
              {data.tribunal && (
                <Badge variant="outline" className="text-[9px] uppercase">
                  {data.tribunal}
                </Badge>
              )}
            </section>

            {/* Data real */}
            <section className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> Data da movimentação
              </p>
              <p className="text-sm">
                {new Date(data.dataEvento).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </p>
            </section>

            {/* Conteúdo */}
            <section className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> Texto da movimentação
              </p>
              <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                {data.conteudo}
              </div>
            </section>

            {/* Ações */}
            <section className="flex flex-col gap-2 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setCriarPrazoOpen(true)}
                >
                  <CalendarClock className="h-3.5 w-3.5 mr-1.5" />
                  Criar prazo
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setCriarTarefaOpen(true)}
                >
                  <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                  Criar tarefa
                </Button>
              </div>
              {data.monitoramentoId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLocation(`/processos?tab=movimentacoes`);
                    onClose();
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Ver monitoramento completo
                </Button>
              )}
            </section>
          </div>
        ) : eventoId !== null ? (
          <div className="px-4 py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : null}
      </SheetContent>

      {data && (
        <>
          <CriarPrazoDialog
            open={criarPrazoOpen}
            onClose={() => setCriarPrazoOpen(false)}
            evento={data}
            onSuccess={() => {
              setCriarPrazoOpen(false);
              onClose();
            }}
          />
          <CriarTarefaDialog
            open={criarTarefaOpen}
            onClose={() => setCriarTarefaOpen(false)}
            evento={data}
            onSuccess={() => {
              setCriarTarefaOpen(false);
              onClose();
            }}
          />
        </>
      )}
    </Sheet>
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  evento: {
    cnjAfetado: string | null;
    apelido: string | null;
    searchKey: string | null;
    dataEvento: Date | string;
    conteudo: string;
    prazoSugerido?: { titulo: string; dataSugerida: Date | string | null; prazoDias: number | null; prazoUteis: boolean } | null;
  };
  onSuccess: () => void;
}

/**
 * Sugestão de prazo: 5 dias úteis após a data da movimentação. Reflete
 * prazo padrão CPC pra resposta a despachos. Usuário pode ajustar.
 */
function dataSugerida(dataEvento: Date | string): string {
  const base = typeof dataEvento === "string" ? new Date(dataEvento) : dataEvento;
  return format(addBusinessDays(base, 5), "yyyy-MM-dd");
}

function tituloSugerido(evento: DialogProps["evento"]): string {
  const cliente = evento.apelido || evento.searchKey || "cliente";
  const trecho = evento.conteudo.split("\n")[0].slice(0, 60);
  return `${cliente}: ${trecho}`;
}

function CriarPrazoDialog({ open, onClose, evento, onSuccess }: DialogProps) {
  // Se a IA detectou um prazo (prazos_sugeridos), pré-preenche com ele:
  // título do prazo real + a data já calculada. Senão, cai no default (5 dias
  // úteis após a movimentação).
  const prazoSug = evento.prazoSugerido;
  const [titulo, setTitulo] = useState(
    prazoSug?.titulo
      ? `${evento.apelido || evento.searchKey || "cliente"}: ${prazoSug.titulo}`
      : tituloSugerido(evento),
  );
  const [dataLimite, setDataLimite] = useState(
    prazoSug?.dataSugerida
      ? format(new Date(prazoSug.dataSugerida), "yyyy-MM-dd")
      : dataSugerida(evento.dataEvento),
  );
  const [prioridade, setPrioridade] = useState<"baixa" | "normal" | "alta" | "critica">("normal");

  const criarMut = trpc.agendamento.criar.useMutation({
    onSuccess: () => {
      toast.success("Prazo criado!");
      onSuccess();
    },
    onError: (e) => toast.error("Falha ao criar prazo", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar prazo a partir da movimentação</DialogTitle>
          <DialogDescription>
            CNJ: <span className="font-mono">{evento.cnjAfetado || "—"}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="prazo-titulo">Título</Label>
            <Input
              id="prazo-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="prazo-data">Data limite</Label>
              <Input
                id="prazo-data"
                type="date"
                value={dataLimite}
                onChange={(e) => setDataLimite(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prazo-prio">Prioridade</Label>
              <Select value={prioridade} onValueChange={(v) => setPrioridade(v as typeof prioridade)}>
                <SelectTrigger id="prazo-prio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="critica">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sugestão: 5 dias úteis após a movimentação. Ajuste se a regra
            do processo for diferente.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={criarMut.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              criarMut.mutate({
                tipo: "prazo_processual",
                titulo,
                descricao: evento.conteudo,
                dataInicio: `${dataLimite}T09:00:00`,
                diaInteiro: true,
                prioridade,
              })
            }
            disabled={criarMut.isPending || !titulo.trim() || !dataLimite}
          >
            {criarMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Criar prazo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CriarTarefaDialog({ open, onClose, evento, onSuccess }: DialogProps) {
  const [titulo, setTitulo] = useState(tituloSugerido(evento));
  const [descricao, setDescricao] = useState(evento.conteudo);
  const [dataVencimento, setDataVencimento] = useState(dataSugerida(evento.dataEvento));
  const [prioridade, setPrioridade] = useState<"baixa" | "normal" | "alta" | "urgente">("normal");

  const criarMut = trpc.tarefas.criar.useMutation({
    onSuccess: () => {
      toast.success("Tarefa criada!");
      onSuccess();
    },
    onError: (e) => toast.error("Falha ao criar tarefa", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar tarefa a partir da movimentação</DialogTitle>
          <DialogDescription>
            CNJ: <span className="font-mono">{evento.cnjAfetado || "—"}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tarefa-titulo">Título</Label>
            <Input
              id="tarefa-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tarefa-desc">Descrição</Label>
            <Textarea
              id="tarefa-desc"
              rows={4}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tarefa-data">Vencimento</Label>
              <Input
                id="tarefa-data"
                type="date"
                value={dataVencimento}
                onChange={(e) => setDataVencimento(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tarefa-prio">Prioridade</Label>
              <Select value={prioridade} onValueChange={(v) => setPrioridade(v as typeof prioridade)}>
                <SelectTrigger id="tarefa-prio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={criarMut.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              criarMut.mutate({
                titulo,
                descricao: descricao || undefined,
                dataVencimento: dataVencimento ? `${dataVencimento}T23:59:59` : undefined,
                prioridade,
              })
            }
            disabled={criarMut.isPending || !titulo.trim()}
          >
            {criarMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Criar tarefa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
