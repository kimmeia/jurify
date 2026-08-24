/**
 * Prazos — a versão enxuta da Agenda pro pacote Acompanhamento Processual:
 * só prazos processuais e audiências, agrupados por dia, com o dono de cada
 * um. Grava na MESMA tabela da Agenda — contratar a Agenda completa depois
 * mostra tudo isto no calendário sem migração.
 *
 * Aparece no menu apenas quando o contrato tem `processos` e NÃO tem
 * `agenda` (quem tem Agenda usa o calendário completo; /prazos redireciona).
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CalendarClock, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

type FiltroTipo = "todos" | "prazo_processual" | "audiencia";

interface PrazoItem {
  id: number;
  tipo: string;
  titulo: string;
  dataInicio: string;
  diaInteiro: boolean;
  prioridade: string;
  concluido: boolean;
  responsavelId: number;
  responsavelNome: string | null;
  contatoNome: string | null;
  descricao: string | null;
  origemAlertaEm: string | null;
}

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function chaveDia(iso: string): string {
  return iso.slice(0, 10);
}

function rotuloDia(chave: string): string {
  const d = new Date(`${chave}T12:00:00`);
  return `${DIAS_SEMANA[d.getDay()]} · ${d.getDate()} ${MESES[d.getMonth()]}`;
}

function ehHoje(chave: string): boolean {
  const hoje = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return chave === `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
}

function TagTipo({ item }: { item: PrazoItem }) {
  if (item.tipo === "audiencia") {
    const hora = item.diaInteiro
      ? null
      : new Date(item.dataInicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return (
      <Badge variant="outline" className="text-[10px] font-bold border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10">
        AUDIÊNCIA{hora ? ` · ${hora}` : ""}
      </Badge>
    );
  }
  if (item.prioridade === "critica" || item.prioridade === "alta") {
    return (
      <Badge variant="outline" className="text-[10px] font-bold border-rose-500/40 text-rose-700 dark:text-rose-300 bg-rose-500/10">
        PRAZO FATAL
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] font-bold border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10">
      PRAZO
    </Badge>
  );
}

export default function Prazos() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.prazos.listar.useQuery(undefined);
  const { data: respData } = trpc.clientesEssencial.responsaveis.useQuery();

  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");
  const [filtroResp, setFiltroResp] = useState<string>("todos");
  const [criarOpen, setCriarOpen] = useState(false);

  const [novoTitulo, setNovoTitulo] = useState("");
  const [novoTipo, setNovoTipo] = useState<"prazo_processual" | "audiencia">("prazo_processual");
  const [novaData, setNovaData] = useState("");
  const [novaHora, setNovaHora] = useState("");
  const [novoResp, setNovoResp] = useState<string>("");
  const [novaDescricao, setNovaDescricao] = useState("");

  const criarMut = trpc.prazos.criar.useMutation({
    onSuccess: () => {
      utils.prazos.listar.invalidate();
      setCriarOpen(false);
      setNovoTitulo(""); setNovaData(""); setNovaHora(""); setNovaDescricao("");
      toast.success("Prazo criado");
    },
    onError: (err) => toast.error("Erro ao criar prazo", { description: err.message }),
  });

  const concluirMut = trpc.prazos.concluir.useMutation({
    onSuccess: () => utils.prazos.listar.invalidate(),
    onError: (err) => toast.error("Erro ao atualizar", { description: err.message }),
  });

  const itens: PrazoItem[] = data?.itens ?? [];
  const pendentes = itens.filter((i) => !i.concluido);
  const contagem = {
    todos: pendentes.length,
    prazo_processual: pendentes.filter((i) => i.tipo === "prazo_processual").length,
    audiencia: pendentes.filter((i) => i.tipo === "audiencia").length,
  };

  const filtrados = useMemo(() => {
    return itens.filter(
      (i) =>
        (filtroTipo === "todos" || i.tipo === filtroTipo) &&
        (filtroResp === "todos" || String(i.responsavelId) === filtroResp),
    );
  }, [itens, filtroTipo, filtroResp]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, PrazoItem[]>();
    for (const i of filtrados) {
      const chave = chaveDia(i.dataInicio);
      const lista = mapa.get(chave) ?? [];
      lista.push(i);
      mapa.set(chave, lista);
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtrados]);

  const submeter = () => {
    if (!novoTitulo.trim()) { toast.error("Informe o título"); return; }
    if (!novaData) { toast.error("Informe a data"); return; }
    const iso = new Date(`${novaData}T${novaHora || "09:00"}:00`).toISOString();
    criarMut.mutate({
      titulo: novoTitulo.trim(),
      tipo: novoTipo,
      dataInicio: iso,
      diaInteiro: !novaHora,
      responsavelId: novoResp ? Number(novoResp) : undefined,
      descricao: novaDescricao.trim() || undefined,
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight leading-tight flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-violet-600 dark:text-violet-400" /> Prazos
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            A versão enxuta da Agenda: só o que tem data, processo e dono. Prazo aprovado no alerta de movimentação nasce aqui.
          </p>
        </div>
        <Button onClick={() => setCriarOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Prazo manual
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["todos", `Todos · ${contagem.todos}`],
            ["prazo_processual", `Prazos · ${contagem.prazo_processual}`],
            ["audiencia", `Audiências · ${contagem.audiencia}`],
          ] as Array<[FiltroTipo, string]>
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setFiltroTipo(valor)}
            className={`h-8 rounded-lg border px-3 text-xs font-semibold transition-colors ${
              filtroTipo === valor
                ? "bg-foreground text-background border-foreground"
                : "bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            {rotulo}
          </button>
        ))}
        <div className="ml-2 w-52">
          <Select value={filtroResp} onValueChange={setFiltroResp}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Responsável: todos</SelectItem>
              {(respData?.itens ?? []).map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>{r.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : porDia.length === 0 ? (
        <div className="border rounded-xl py-14 text-center text-muted-foreground">
          <CalendarClock className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhum prazo no período. Aprove sugestões nos alertas de movimentação ou crie um manual.</p>
        </div>
      ) : (
        <div className="border rounded-xl bg-card divide-y">
          {porDia.map(([chave, lista]) => (
            <div key={chave} className="px-4 py-2.5">
              <div className="flex items-center gap-2 pb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{rotuloDia(chave)}</span>
                {ehHoje(chave) && (
                  <Badge className="text-[9px] h-4 px-1.5 bg-violet-600 hover:bg-violet-600 text-white">HOJE</Badge>
                )}
              </div>
              <div className="space-y-1">
                {lista.map((item) => (
                  <div key={item.id} className={`flex items-center gap-2.5 py-1 text-sm ${item.concluido ? "opacity-50" : ""}`}>
                    <Checkbox
                      checked={item.concluido}
                      onCheckedChange={(v) => concluirMut.mutate({ id: item.id, desfazer: v !== true })}
                      aria-label={`Concluir ${item.titulo}`}
                    />
                    <TagTipo item={item} />
                    <span className={`font-semibold ${item.concluido ? "line-through" : ""}`}>{item.titulo}</span>
                    {(item.contatoNome || item.descricao?.includes("CNJ:")) && (
                      <span className="text-xs text-muted-foreground truncate">
                        {item.contatoNome ?? item.descricao?.match(/CNJ: (\S+)/)?.[1]}
                      </span>
                    )}
                    {item.origemAlertaEm && (
                      <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10">
                        do alerta de {new Date(item.origemAlertaEm).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                      {item.responsavelNome ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Grava na mesma agenda do sistema — se o escritório contratar a Agenda completa, tudo isto aparece no calendário.
      </p>

      <Dialog open={criarOpen} onOpenChange={setCriarOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Prazo manual</DialogTitle>
            <DialogDescription>Prazo ou audiência fora dos alertas automáticos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={novoTitulo} onChange={(e) => setNovoTitulo(e.target.value)} placeholder="Contestação — João da Silva" maxLength={255} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={novoTipo} onValueChange={(v) => setNovoTipo(v as typeof novoTipo)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prazo_processual">Prazo</SelectItem>
                    <SelectItem value="audiencia">Audiência</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Responsável</Label>
                <Select value={novoResp} onValueChange={setNovoResp}>
                  <SelectTrigger><SelectValue placeholder="Eu mesmo" /></SelectTrigger>
                  <SelectContent>
                    {(respData?.itens ?? []).map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Hora (opcional)</Label>
                <Input type="time" value={novaHora} onChange={(e) => setNovaHora(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Input value={novaDescricao} onChange={(e) => setNovaDescricao(e.target.value)} placeholder="CNJ, vara, detalhes…" maxLength={2000} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCriarOpen(false)}>Cancelar</Button>
            <Button onClick={submeter} disabled={criarMut.isPending}>
              {criarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar prazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
