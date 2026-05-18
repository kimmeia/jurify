import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarIcon, Filter, X } from "lucide-react";

export type FiltrosKanban = {
  responsavelId?: number;
  prioridade?: "baixa" | "media" | "alta";
  prazoFiltro?: "vencidos" | "hoje" | "7dias" | "sem_prazo";
  dataInicio?: string;
  dataFim?: string;
};

export const FILTROS_VAZIOS: FiltrosKanban = {};

const SENTINEL_TODOS = "__all__";

function temFiltro(f: FiltrosKanban): boolean {
  return !!(
    f.responsavelId ||
    f.prioridade ||
    f.prazoFiltro ||
    f.dataInicio ||
    f.dataFim
  );
}

/** Formata "YYYY-MM-DD" → "DD/MM" pra label do botão Período. */
function formatDataCurta(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

export function FiltrosBar({
  filtros,
  setFiltros,
}: {
  filtros: FiltrosKanban;
  setFiltros: (f: FiltrosKanban) => void;
}) {
  const { data: colabsList } =
    (trpc as any).configuracoes?.listarColaboradoresParaFiltro?.useQuery?.(
      undefined,
      { retry: false },
    ) ?? { data: undefined };

  const colabs: Array<{ id: number; nome: string }> = colabsList || [];

  // Popover de período (Criado de/até). Inputs locais até "Aplicar".
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [deLocal, setDeLocal] = useState(filtros.dataInicio || "");
  const [ateLocal, setAteLocal] = useState(filtros.dataFim || "");

  const periodoAtivo = !!(filtros.dataInicio || filtros.dataFim);
  const periodoLabel = (() => {
    if (filtros.dataInicio && filtros.dataFim) {
      return `${formatDataCurta(filtros.dataInicio)} — ${formatDataCurta(filtros.dataFim)}`;
    }
    if (filtros.dataInicio) return `desde ${formatDataCurta(filtros.dataInicio)}`;
    if (filtros.dataFim) return `até ${formatDataCurta(filtros.dataFim)}`;
    return "Período…";
  })();

  return (
    <div className="rounded-lg border bg-card p-3 flex flex-wrap items-end gap-2">
      <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground mr-1">
        <Filter className="h-3.5 w-3.5" />
        Filtros
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Responsável</Label>
        <Select
          value={filtros.responsavelId ? String(filtros.responsavelId) : SENTINEL_TODOS}
          onValueChange={(v) =>
            setFiltros({ ...filtros, responsavelId: v === SENTINEL_TODOS ? undefined : Number(v) })
          }
        >
          <SelectTrigger className="h-8 text-xs w-[160px]">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SENTINEL_TODOS}>Todos</SelectItem>
            {colabs.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Prioridade</Label>
        <Select
          value={filtros.prioridade || SENTINEL_TODOS}
          onValueChange={(v) =>
            setFiltros({ ...filtros, prioridade: v === SENTINEL_TODOS ? undefined : (v as any) })
          }
        >
          <SelectTrigger className="h-8 text-xs w-[120px]">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SENTINEL_TODOS}>Todas</SelectItem>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="media">Média</SelectItem>
            <SelectItem value="baixa">Baixa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Prazo</Label>
        <Select
          value={filtros.prazoFiltro || SENTINEL_TODOS}
          onValueChange={(v) =>
            setFiltros({ ...filtros, prazoFiltro: v === SENTINEL_TODOS ? undefined : (v as any) })
          }
        >
          <SelectTrigger className="h-8 text-xs w-[140px]">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SENTINEL_TODOS}>Todos</SelectItem>
            <SelectItem value="vencidos">Vencidos</SelectItem>
            <SelectItem value="hoje">Vencem hoje</SelectItem>
            <SelectItem value="7dias">Próx 7 dias</SelectItem>
            <SelectItem value="sem_prazo">Sem prazo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Criado em</Label>
        <Popover
          open={popoverOpen}
          onOpenChange={(o) => {
            setPopoverOpen(o);
            // Hidrata inputs locais com o estado atual ao abrir.
            if (o) {
              setDeLocal(filtros.dataInicio || "");
              setAteLocal(filtros.dataFim || "");
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant={periodoAtivo ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1.5 min-w-[140px] justify-start"
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              <span>{periodoLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-2">
            <p className="text-xs font-semibold">Período de criação</p>
            <div className="space-y-1">
              <Label className="text-[10px]">De</Label>
              <Input
                type="date"
                value={deLocal}
                onChange={(e) => setDeLocal(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Até</Label>
              <Input
                type="date"
                value={ateLocal}
                onChange={(e) => setAteLocal(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex gap-2 pt-1">
              {periodoAtivo && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 h-8 text-xs"
                  onClick={() => {
                    setDeLocal("");
                    setAteLocal("");
                    setFiltros({ ...filtros, dataInicio: undefined, dataFim: undefined });
                    setPopoverOpen(false);
                  }}
                >
                  Limpar
                </Button>
              )}
              <Button
                size="sm"
                className="flex-1 h-8 text-xs"
                disabled={!!(deLocal && ateLocal && deLocal > ateLocal)}
                onClick={() => {
                  setFiltros({
                    ...filtros,
                    dataInicio: deLocal || undefined,
                    dataFim: ateLocal || undefined,
                  });
                  setPopoverOpen(false);
                }}
              >
                Aplicar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {temFiltro(filtros) && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs"
          onClick={() => setFiltros(FILTROS_VAZIOS)}
        >
          <X className="h-3 w-3 mr-1" />
          Limpar
        </Button>
      )}
    </div>
  );
}
