import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { X } from "lucide-react";

const LS_KEY = "jurify:financeiro:atribuir:filtros:v1";

export type FiltrosAtribuirState = {
  apenasSemAtribuicao: boolean;
  apenasSemDecisaoComissao: boolean;
  q: string;
  criadoDe: string;
  criadoAte: string;
  recebidoDe: string;
  recebidoAte: string;
  atendenteIds: number[];
  incluirSemAtendente: boolean;
  categoriaIds: number[];
  incluirSemCategoria: boolean;
  statuses: string[];
  formasPagamento: string[];
  valorMin: string;
  valorMax: string;
  comissao: ("sim" | "nao" | "indef")[];
};

export const FILTROS_DEFAULT: FiltrosAtribuirState = {
  apenasSemAtribuicao: true,
  apenasSemDecisaoComissao: false,
  q: "",
  criadoDe: "",
  criadoAte: "",
  recebidoDe: "",
  recebidoAte: "",
  atendenteIds: [],
  incluirSemAtendente: false,
  categoriaIds: [],
  incluirSemCategoria: false,
  statuses: [],
  formasPagamento: [],
  valorMin: "",
  valorMax: "",
  comissao: [],
};

const STATUS_OPCOES = [
  { value: "PENDING", label: "Pendente" },
  { value: "RECEIVED", label: "Recebido" },
  { value: "CONFIRMED", label: "Confirmado" },
  { value: "OVERDUE", label: "Vencido" },
  { value: "REFUNDED", label: "Estornado" },
  { value: "RECEIVED_IN_CASH", label: "Recebido em dinheiro" },
  { value: "CHARGEBACK_REQUESTED", label: "Chargeback solicitado" },
  { value: "CHARGEBACK_DISPUTE", label: "Chargeback em disputa" },
  { value: "AWAITING_CHARGEBACK_REVERSAL", label: "Aguardando reversão" },
  { value: "DUNNING_REQUESTED", label: "Cobrança em negativação" },
  { value: "DUNNING_RECEIVED", label: "Recebido em negativação" },
  { value: "AWAITING_RISK_ANALYSIS", label: "Em análise de risco" },
];

const FORMA_PGTO_OPCOES = [
  { value: "PIX", label: "PIX" },
  { value: "BOLETO", label: "Boleto" },
  { value: "CREDIT_CARD", label: "Cartão de crédito" },
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "TRANSFERENCIA", label: "Transferência" },
  { value: "OUTRO", label: "Outro" },
  { value: "UNDEFINED", label: "Indefinido" },
];

const COMISSAO_OPCOES = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
  { value: "indef", label: "Indefinida" },
];

function carregarLS(): FiltrosAtribuirState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FiltrosAtribuirState>;
    return { ...FILTROS_DEFAULT, ...parsed };
  } catch {
    return null;
  }
}

export function useFiltrosAtribuir() {
  const [filtros, setFiltros] = useState<FiltrosAtribuirState>(
    () => carregarLS() ?? FILTROS_DEFAULT,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(filtros));
      } catch {
        // localStorage indisponível (modo privado, quota) — não fatal
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filtros]);

  const resetar = () => setFiltros(FILTROS_DEFAULT);

  return { filtros, setFiltros, resetar };
}

/**
 * Converte o state da UI no input aceito pela procedure tRPC.
 * Strings vazias viram undefined; arrays vazios não são enviados;
 * valorMin/Max são parseados pra número (NaN vira undefined).
 */
export function filtrosParaInput(f: FiltrosAtribuirState) {
  const num = (s: string): number | undefined => {
    if (!s.trim()) return undefined;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    apenasSemAtribuicao: f.apenasSemAtribuicao,
    apenasSemDecisaoComissao: f.apenasSemDecisaoComissao,
    q: f.q.trim() ? f.q.trim() : undefined,
    criadoDe: f.criadoDe || undefined,
    criadoAte: f.criadoAte || undefined,
    recebidoDe: f.recebidoDe || undefined,
    recebidoAte: f.recebidoAte || undefined,
    atendenteIds: f.atendenteIds.length > 0 ? f.atendenteIds : undefined,
    incluirSemAtendente: f.incluirSemAtendente,
    categoriaIds: f.categoriaIds.length > 0 ? f.categoriaIds : undefined,
    incluirSemCategoria: f.incluirSemCategoria,
    statuses: f.statuses.length > 0 ? f.statuses : undefined,
    formasPagamento:
      f.formasPagamento.length > 0
        ? (f.formasPagamento as (
            | "BOLETO"
            | "CREDIT_CARD"
            | "PIX"
            | "UNDEFINED"
            | "DINHEIRO"
            | "TRANSFERENCIA"
            | "OUTRO"
          )[])
        : undefined,
    valorMin: num(f.valorMin),
    valorMax: num(f.valorMax),
    comissao: f.comissao.length > 0 ? f.comissao : undefined,
    limit: 200 as const,
  };
}

export function contarFiltrosAtivos(f: FiltrosAtribuirState): number {
  let n = 0;
  if (!f.apenasSemAtribuicao) n++;
  if (f.apenasSemDecisaoComissao) n++;
  if (f.q.trim()) n++;
  if (f.criadoDe || f.criadoAte) n++;
  if (f.recebidoDe || f.recebidoAte) n++;
  if (f.atendenteIds.length > 0 || f.incluirSemAtendente) n++;
  if (f.categoriaIds.length > 0 || f.incluirSemCategoria) n++;
  if (f.statuses.length > 0) n++;
  if (f.formasPagamento.length > 0) n++;
  if (f.valorMin.trim() || f.valorMax.trim()) n++;
  if (f.comissao.length > 0) n++;
  return n;
}

interface Props {
  filtros: FiltrosAtribuirState;
  setFiltros: (f: FiltrosAtribuirState) => void;
  resetar: () => void;
  atendentes: { id: number; userName: string | null; cargo: string }[];
  categorias: { id: number; nome: string }[];
}

export function FiltrosAtribuir({
  filtros,
  setFiltros,
  resetar,
  atendentes,
  categorias,
}: Props) {
  const set = <K extends keyof FiltrosAtribuirState>(
    key: K,
    val: FiltrosAtribuirState[K],
  ) => setFiltros({ ...filtros, [key]: val });

  const atendentesOpcoes = useMemo(
    () =>
      atendentes.map((a) => ({
        value: String(a.id),
        label: a.userName ?? `#${a.id}`,
      })),
    [atendentes],
  );
  const categoriasOpcoes = useMemo(
    () => categorias.map((c) => ({ value: String(c.id), label: c.nome })),
    [categorias],
  );

  const ativos = contarFiltrosAtivos(filtros);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Buscar (cliente ou descrição)</Label>
          <Input
            placeholder="Ex: João, honorário..."
            value={filtros.q}
            onChange={(e) => set("q", e.target.value)}
            className="h-9 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <MultiSelectFilter
            placeholder="Todos"
            options={STATUS_OPCOES}
            value={filtros.statuses}
            onChange={(v) => set("statuses", v)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Categoria</Label>
          <MultiSelectFilter
            placeholder="Todas"
            options={categoriasOpcoes}
            value={filtros.categoriaIds.map(String)}
            onChange={(v) => set("categoriaIds", v.map(Number))}
          />
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Checkbox
              checked={filtros.incluirSemCategoria}
              onCheckedChange={(v) =>
                set("incluirSemCategoria", Boolean(v))
              }
            />
            Incluir sem categoria
          </label>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Atendente</Label>
          <MultiSelectFilter
            placeholder="Todos"
            options={atendentesOpcoes}
            value={filtros.atendenteIds.map(String)}
            onChange={(v) => set("atendenteIds", v.map(Number))}
          />
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Checkbox
              checked={filtros.incluirSemAtendente}
              onCheckedChange={(v) =>
                set("incluirSemAtendente", Boolean(v))
              }
            />
            Incluir sem atendente
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Forma de pagamento</Label>
          <MultiSelectFilter
            placeholder="Todas"
            options={FORMA_PGTO_OPCOES}
            value={filtros.formasPagamento}
            onChange={(v) => set("formasPagamento", v)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Comissão</Label>
          <MultiSelectFilter
            placeholder="Qualquer"
            options={COMISSAO_OPCOES}
            value={filtros.comissao}
            onChange={(v) =>
              set("comissao", v as ("sim" | "nao" | "indef")[])
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Recebido de</Label>
          <Input
            type="date"
            value={filtros.recebidoDe}
            onChange={(e) => set("recebidoDe", e.target.value)}
            className="h-9 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Recebido até</Label>
          <Input
            type="date"
            value={filtros.recebidoAte}
            onChange={(e) => set("recebidoAte", e.target.value)}
            className="h-9 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Criado de</Label>
          <Input
            type="date"
            value={filtros.criadoDe}
            onChange={(e) => set("criadoDe", e.target.value)}
            className="h-9 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Criado até</Label>
          <Input
            type="date"
            value={filtros.criadoAte}
            onChange={(e) => set("criadoAte", e.target.value)}
            className="h-9 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Valor mín (R$)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0,00"
            value={filtros.valorMin}
            onChange={(e) => set("valorMin", e.target.value)}
            className="h-9 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Valor máx (R$)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0,00"
            value={filtros.valorMax}
            onChange={(e) => set("valorMax", e.target.value)}
            className="h-9 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={filtros.apenasSemAtribuicao}
            onCheckedChange={(v) =>
              set("apenasSemAtribuicao", Boolean(v))
            }
          />
          Apenas sem atendente/categoria
        </label>
        <label
          className="flex items-center gap-2 text-xs"
          title="Cobranças sem categoria E sem decisão manual de comissionável — típico em PIX direto pro Asaas"
        >
          <Checkbox
            checked={filtros.apenasSemDecisaoComissao}
            onCheckedChange={(v) =>
              set("apenasSemDecisaoComissao", Boolean(v))
            }
          />
          Sem decisão de comissão
        </label>
        <div className="flex-1" />
        {ativos > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetar}
            className="text-xs h-8"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Limpar filtros ({ativos})
          </Button>
        )}
      </div>
    </div>
  );
}
