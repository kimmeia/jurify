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
import { Filter, X } from "lucide-react";

export type FiltrosKanban = {
  responsavelId?: number;
  prioridade?: "baixa" | "media" | "alta";
  tag?: string;
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
    f.tag ||
    f.prazoFiltro ||
    f.dataInicio ||
    f.dataFim
  );
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
        <Label className="text-[10px] text-muted-foreground">Tag</Label>
        <Input
          value={filtros.tag || ""}
          onChange={(e) => setFiltros({ ...filtros, tag: e.target.value || undefined })}
          placeholder="ex: vip"
          className="h-8 text-xs w-[120px]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Criado de</Label>
        <Input
          type="date"
          value={filtros.dataInicio || ""}
          onChange={(e) => setFiltros({ ...filtros, dataInicio: e.target.value || undefined })}
          className="h-8 text-xs w-[140px]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Criado até</Label>
        <Input
          type="date"
          value={filtros.dataFim || ""}
          onChange={(e) => setFiltros({ ...filtros, dataFim: e.target.value || undefined })}
          className="h-8 text-xs w-[140px]"
        />
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
