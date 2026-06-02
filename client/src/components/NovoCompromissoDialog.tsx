import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Calendar, Plus, Loader2, X, Bell, Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import {
  TIPO_LABELS, TIPO_CORES, PRIORIDADE_LABELS,
  type TipoAgendamento, type PrioridadeAgendamento,
} from "@shared/agendamento-constants";

type Lembrete = {
  tipo: "notificacao_app" | "email" | "whatsapp";
  minutosAntes: number;
};

const LEMBRETE_PRESETS: Array<{ label: string; minutos: number }> = [
  { label: "10 min antes", minutos: 10 },
  { label: "30 min antes", minutos: 30 },
  { label: "1 hora antes", minutos: 60 },
  { label: "2 horas antes", minutos: 120 },
  { label: "1 dia antes", minutos: 1440 },
  { label: "2 dias antes", minutos: 2880 },
];

const DURACOES: Array<{ label: string; min: number }> = [
  { label: "15 minutos", min: 15 },
  { label: "30 minutos", min: 30 },
  { label: "1 hora", min: 60 },
  { label: "1h 30min", min: 90 },
  { label: "2 horas", min: 120 },
  { label: "Dia inteiro", min: -1 },
];

export type NovoCompromissoContexto = {
  contatoId?: number;
  contatoNome?: string;
};

export function NovoCompromissoDialog({
  open,
  onOpenChange,
  contexto,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contexto?: NovoCompromissoContexto;
  onCreated?: () => void;
}) {
  const [tipo, setTipo] = useState<TipoAgendamento>("reuniao_comercial");
  const [titulo, setTitulo] = useState("");
  const [data, setData] = useState("");
  const [hora, setHora] = useState("09:00");
  const [duracaoMin, setDuracaoMin] = useState(60);
  const [prioridade, setPrioridade] = useState<PrioridadeAgendamento>("normal");
  const [local, setLocal] = useState("");
  const [descricao, setDescricao] = useState("");
  const [lembretes, setLembretes] = useState<Lembrete[]>([{ tipo: "notificacao_app", minutosAntes: 30 }]);

  // Reseta/rehidrata quando abre. Título default depende do contexto.
  useEffect(() => {
    if (!open) return;
    setTipo("reuniao_comercial");
    setTitulo(contexto?.contatoNome ? `Reunião com ${contexto.contatoNome}` : "");
    setData("");
    setHora("09:00");
    setDuracaoMin(60);
    setPrioridade("normal");
    setLocal("");
    setDescricao("");
    setLembretes([{ tipo: "notificacao_app", minutosAntes: 30 }]);
  }, [open, contexto?.contatoNome]);

  const criar = trpc.agendamento.criar.useMutation({
    onSuccess: () => {
      toast.success("Compromisso criado!");
      onOpenChange(false);
      onCreated?.();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!titulo.trim() || !data) {
      toast.error("Preencha título e data.");
      return;
    }
    // Sempre toISOString — o servidor lê como UTC. Sem isso, "14:30" virava
    // 14:30 UTC = 11:30 local em UTC-3 (era o bug do botão Agendar antigo).
    const diaInteiro = duracaoMin === -1;
    const inicio = diaInteiro
      ? new Date(`${data}T00:00:00`).toISOString()
      : new Date(`${data}T${hora}:00`).toISOString();
    const fim = diaInteiro
      ? new Date(`${data}T23:59:00`).toISOString()
      : new Date(new Date(`${data}T${hora}:00`).getTime() + duracaoMin * 60_000).toISOString();

    criar.mutate({
      tipo,
      titulo: titulo.trim(),
      descricao: descricao.trim() || undefined,
      dataInicio: inicio,
      dataFim: fim,
      diaInteiro,
      local: local.trim() || undefined,
      prioridade,
      contatoId: contexto?.contatoId,
      corHex: TIPO_CORES[tipo],
      lembretes: lembretes.length > 0 ? lembretes : undefined,
    });
  };

  const adicionarLembrete = () => {
    setLembretes((prev) => [...prev, { tipo: "notificacao_app", minutosAntes: 30 }]);
  };
  const atualizarLembrete = (idx: number, patch: Partial<Lembrete>) => {
    setLembretes((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const removerLembrete = (idx: number) => {
    setLembretes((prev) => prev.filter((_, i) => i !== idx));
  };

  const iniciais = (nome: string) =>
    nome
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-indigo-600" />
            Novo Compromisso
          </DialogTitle>
          {contexto?.contatoId && contexto?.contatoNome && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-violet-100 text-violet-800 text-xs font-semibold">
                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-white text-[10px] font-bold">
                  {iniciais(contexto.contatoNome)}
                </span>
                Vinculado a: {contexto.contatoNome}
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoAgendamento)}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TIPO_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Título <span className="text-destructive">*</span></Label>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Audiência processo 123…"
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Data <span className="text-destructive">*</span></Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hora</Label>
              <Input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                disabled={duracaoMin === -1}
                className="text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Duração</Label>
              <Select value={String(duracaoMin)} onValueChange={(v) => setDuracaoMin(Number(v))}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURACOES.map((d) => (
                    <SelectItem key={d.min} value={String(d.min)}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Prioridade</Label>
              <Select value={prioridade} onValueChange={(v) => setPrioridade(v as PrioridadeAgendamento)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORIDADE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Local (opcional)</Label>
            <Input
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              placeholder="Sala, link da reunião, endereço…"
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Descrição (opcional)</Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              placeholder="Notas, contexto, links…"
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Lembretes</Label>
            {lembretes.length === 0 && (
              <p className="text-[11px] text-muted-foreground italic">Sem lembretes — você não vai ser notificado.</p>
            )}
            {lembretes.map((l, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <Select value={l.tipo} onValueChange={(v) => atualizarLembrete(idx, { tipo: v as Lembrete["tipo"] })}>
                  <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="notificacao_app"><span className="flex items-center gap-1.5"><Bell className="h-3 w-3" /> Notificação</span></SelectItem>
                    <SelectItem value="email"><span className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> Email</span></SelectItem>
                    <SelectItem value="whatsapp"><span className="flex items-center gap-1.5"><MessageCircle className="h-3 w-3" /> WhatsApp</span></SelectItem>
                  </SelectContent>
                </Select>
                <Select value={String(l.minutosAntes)} onValueChange={(v) => atualizarLembrete(idx, { minutosAntes: Number(v) })}>
                  <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEMBRETE_PRESETS.map((p) => (
                      <SelectItem key={p.minutos} value={String(p.minutos)}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={() => removerLembrete(idx)}
                  className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-destructive"
                  title="Remover lembrete"
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={adicionarLembrete}
              type="button"
              className="text-[11px] text-indigo-600 hover:underline font-semibold inline-flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Adicionar lembrete
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleSubmit}
            disabled={!titulo.trim() || !data || criar.isPending}
            className="bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700"
          >
            {criar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calendar className="h-4 w-4 mr-2" />}
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
