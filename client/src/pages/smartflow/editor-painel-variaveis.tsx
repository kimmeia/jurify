import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Brain,
  Briefcase,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  DollarSign,
  FileText,
  Info,
  MessageCircle,
  Search,
  User,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { Variavel } from "@/components/VariableInput";

/**
 * Metadados de cada categoria — label humano + ícone + cor. A ordem aqui
 * define a ordem de exibição no drawer.
 */
const CATEGORIA_META: Array<{
  id: string;
  label: string;
  icon: LucideIcon;
  cor: string;
  corBg: string;
}> = [
  { id: "passos", label: "Resultados de passos anteriores", icon: Workflow, cor: "text-amber-600", corBg: "bg-amber-50/60 dark:bg-amber-950/20" },
  { id: "cliente", label: "Dados do cliente", icon: User, cor: "text-violet-600", corBg: "bg-violet-50/60 dark:bg-violet-950/20" },
  { id: "campos_personalizados", label: "Campos personalizados do cadastro", icon: FileText, cor: "text-pink-600", corBg: "bg-pink-50/60 dark:bg-pink-950/20" },
  { id: "mensagem", label: "Mensagem / conversa", icon: MessageCircle, cor: "text-blue-600", corBg: "bg-blue-50/60 dark:bg-blue-950/20" },
  { id: "pagamento", label: "Pagamento / cobrança", icon: DollarSign, cor: "text-emerald-600", corBg: "bg-emerald-50/60 dark:bg-emerald-950/20" },
  { id: "acao", label: "Ação / processo", icon: Briefcase, cor: "text-indigo-600", corBg: "bg-indigo-50/60 dark:bg-indigo-950/20" },
  { id: "agendamento", label: "Agendamento", icon: Calendar, cor: "text-orange-600", corBg: "bg-orange-50/60 dark:bg-orange-950/20" },
  { id: "ia", label: "Resultados da IA", icon: Brain, cor: "text-fuchsia-600", corBg: "bg-fuchsia-50/60 dark:bg-fuchsia-950/20" },
];

const CATEGORIA_OUTROS = { id: "outros", label: "Outras informações", icon: Info, cor: "text-slate-600", corBg: "bg-slate-50/60 dark:bg-slate-900/40" };

/**
 * Drawer "Informações" — lista TODAS as variáveis disponíveis pro fluxo
 * agrupadas por categoria, com busca por nome humano. Clica num item e
 * insere `{{path}}` no campo focado (via `onInserir`).
 *
 * As variáveis vêm de 2 fontes mescladas pelo caller:
 *   1. catálogo do gatilho + campos personalizados (backend)
 *   2. variáveis publicadas pelos passos do fluxo (categoria "passos")
 */
export function PainelVariaveis({
  variaveis,
  onInserir,
}: {
  variaveis: Variavel[];
  /** Recebe o path da variável escolhida. O caller insere no input ativo. */
  onInserir?: (path: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());
  const [modoTecnico, setModoTecnico] = useState(false);

  const buscaNorm = busca.trim().toLowerCase();

  // Agrupa variáveis por categoria, respeitando a ordem de CATEGORIA_META.
  const grupos = useMemo(() => {
    const porCategoria = new Map<string, Variavel[]>();
    for (const v of variaveis) {
      const cat = v.categoria || "outros";
      if (buscaNorm && !v.label.toLowerCase().includes(buscaNorm) && !v.path.toLowerCase().includes(buscaNorm)) {
        continue;
      }
      const lista = porCategoria.get(cat) ?? [];
      lista.push(v);
      porCategoria.set(cat, lista);
    }
    const ordenados: Array<{ meta: typeof CATEGORIA_META[number]; vars: Variavel[] }> = [];
    for (const meta of CATEGORIA_META) {
      const vars = porCategoria.get(meta.id);
      if (vars && vars.length > 0) ordenados.push({ meta, vars });
    }
    // Categoria "outros" (sem categoria conhecida) vai no fim.
    const outros = porCategoria.get("outros");
    if (outros && outros.length > 0) ordenados.push({ meta: CATEGORIA_OUTROS, vars: outros });
    return ordenados;
  }, [variaveis, buscaNorm]);

  const totalFiltrado = grupos.reduce((s, g) => s + g.vars.length, 0);

  const toggle = (id: string) => {
    setColapsadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const inserir = (v: Variavel) => {
    if (onInserir) {
      onInserir(v.path);
      toast.success(`Inserido: ${v.label}`);
    } else {
      // Sem campo ativo — copia pro clipboard como fallback.
      navigator.clipboard?.writeText(`{{${v.path}}}`).then(
        () => toast.success(`Copiado: ${v.label}`),
        () => toast.error("Selecione um campo de texto primeiro."),
      );
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b bg-gradient-to-br from-slate-50 to-violet-50/30 dark:from-slate-900 dark:to-violet-950/20">
        <p className="text-xs uppercase tracking-wider font-bold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          Informações disponíveis
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Clique num item pra inserir no campo onde o cursor está
        </p>
      </div>

      <div className="p-2 border-b bg-background space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar (ex: nome, cpf, processo...)"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer px-0.5">
          <input
            type="checkbox"
            checked={modoTecnico}
            onChange={(e) => setModoTecnico(e.target.checked)}
            className="w-3 h-3"
          />
          Mostrar nome técnico ({`{{...}}`}) — pra quem programa
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {totalFiltrado === 0 ? (
          <p className="text-xs text-muted-foreground italic p-4 text-center">
            {variaveis.length === 0
              ? "Escolha um gatilho pra ver as variáveis disponíveis."
              : "Nenhuma informação corresponde à busca."}
          </p>
        ) : (
          grupos.map(({ meta, vars }) => {
            const Icon = meta.icon;
            const aberta = buscaNorm ? true : !colapsadas.has(meta.id);
            return (
              <div key={meta.id}>
                <button
                  onClick={() => toggle(meta.id)}
                  className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 ${meta.corBg} hover:brightness-95 transition-all text-left`}
                >
                  <Icon className={`w-3.5 h-3.5 ${meta.cor}`} />
                  <span className="text-xs font-bold flex-1">{meta.label}</span>
                  <span className="text-[9px] bg-white/60 dark:bg-black/20 px-1.5 py-0.5 rounded font-bold text-muted-foreground">
                    {vars.length}
                  </span>
                  {aberta ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </button>
                {aberta &&
                  vars.map((v) => (
                    <VariavelRow
                      key={v.path}
                      variavel={v}
                      cor={meta.cor}
                      modoTecnico={modoTecnico}
                      onInserir={() => inserir(v)}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function VariavelRow({
  variavel,
  cor,
  modoTecnico,
  onInserir,
}: {
  variavel: Variavel;
  cor: string;
  modoTecnico: boolean;
  onInserir: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      onClick={onInserir}
      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 border-l-2 border-transparent hover:border-violet-400 transition-all text-left group"
      title={`Inserir "${variavel.label}"`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[11.5px] font-semibold truncate">{variavel.label}</p>
        {modoTecnico ? (
          <code className="text-[9.5px] text-violet-600 dark:text-violet-400 font-mono">{`{{${variavel.path}}}`}</code>
        ) : (
          variavel.exemplo && (
            <p className="text-[9.5px] text-muted-foreground italic truncate">ex: {variavel.exemplo}</p>
          )
        )}
      </div>
      <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
    </button>
  );
}
