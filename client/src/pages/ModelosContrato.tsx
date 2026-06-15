/**
 * Página de modelos de contrato — CRUD de templates DOCX com placeholders
 * nomeados ({{nome completo}}, {{cpf}}, ...). Cada placeholder pode ser uma
 * "variável" (resolve automático do catálogo) ou "manual" (operador preenche
 * ao gerar).
 *
 * Componentes inline neste arquivo:
 *  - <ModelosContrato> — wrapper + hero + filtros + sidebar pastas + grid
 *  - <UploadWizardDialog> — 3 passos: arquivo → mapeamento → confirma
 *  - <MappingEditorDialog> — editar mapeamento de modelo existente
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GerarContratoDialog } from "@/components/GerarContratoDialog";
import { SubirDocumentoAssinaturaDialog } from "@/components/SubirDocumentoAssinaturaDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Folder,
  Loader2,
  Pencil,
  PenLine,
  Plus,
  Search,
  Trash2,
  Upload,
  Variable,
  Wand2,
  FileSignature,
  Info,
  ChevronDown,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import type { Placeholder } from "../../../shared/modelos-contrato-variaveis";
import { PulseDot } from "./dashboards/common";

interface ModeloLista {
  id: number;
  nome: string;
  descricao: string | null;
  arquivoNome: string;
  tamanho: number | null;
  placeholders: Placeholder[];
  pasta: string | null;
  ehParaAssinatura: boolean;
  createdAt: string | Date;
}

// ─── Cores determinísticas (hash → tom) ──────────────────────────────────────

const GRADIENTES_MODELO = [
  "from-indigo-500 to-violet-600",
  "from-emerald-500 to-teal-600",
  "from-pink-500 to-rose-600",
  "from-amber-500 to-orange-600",
  "from-cyan-500 to-blue-600",
  "from-violet-500 to-fuchsia-600",
  "from-slate-500 to-slate-700",
  "from-lime-500 to-emerald-600",
];
const CORES_PASTA = [
  { bg: "bg-indigo-100", fg: "text-indigo-600" },
  { bg: "bg-emerald-100", fg: "text-emerald-600" },
  { bg: "bg-amber-100", fg: "text-amber-600" },
  { bg: "bg-violet-100", fg: "text-violet-600" },
  { bg: "bg-cyan-100", fg: "text-cyan-600" },
  { bg: "bg-rose-100", fg: "text-rose-600" },
  { bg: "bg-lime-100", fg: "text-lime-600" },
  { bg: "bg-blue-100", fg: "text-blue-600" },
];

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function gradientDoModelo(nome: string): string {
  return GRADIENTES_MODELO[hash(nome) % GRADIENTES_MODELO.length]!;
}
function corDaPasta(nome: string): { bg: string; fg: string } {
  return CORES_PASTA[hash(nome) % CORES_PASTA.length]!;
}

// ─── Filtros ─────────────────────────────────────────────────────────────────

type FiltroChip = "todos" | "assinatura" | "sem_variaveis" | "sem_pasta";

function aplicarFiltro(modelos: ModeloLista[], chip: FiltroChip, busca: string): ModeloLista[] {
  let lista = modelos;
  if (chip === "assinatura") lista = lista.filter((m) => m.ehParaAssinatura);
  else if (chip === "sem_pasta") lista = lista.filter((m) => !m.pasta);
  else if (chip === "sem_variaveis") {
    lista = lista.filter(
      (m) => m.placeholders.length > 0 && m.placeholders.every((p) => p.tipo === "manual"),
    );
  }
  const termo = busca.trim().toLowerCase();
  if (termo) {
    lista = lista.filter(
      (m) =>
        m.nome.toLowerCase().includes(termo) ||
        (m.descricao || "").toLowerCase().includes(termo) ||
        m.arquivoNome.toLowerCase().includes(termo),
    );
  }
  return lista;
}

function formatRelativo(d: string | Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const dias = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (dias < 1) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias}d`;
  if (dias < 30) return `há ${Math.floor(dias / 7)}sem`;
  if (dias < 365) return `há ${Math.floor(dias / 30)}mês`;
  return `há ${Math.floor(dias / 365)}a`;
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function ModelosContrato() {
  const { data: meuEsc } = trpc.configuracoes.meuEscritorio.useQuery();
  const cargo = meuEsc?.colaborador.cargo;
  const isGestor = cargo === "dono" || cargo === "gestor";

  const utils = (trpc as any).useUtils();
  const { data: modelos, isLoading } = (trpc as any).modelosContrato.listar.useQuery();
  const excluir = (trpc as any).modelosContrato.excluir.useMutation({
    onSuccess: () => {
      utils.modelosContrato.listar.invalidate();
      toast.success("Modelo excluído");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [uploadOpen, setUploadOpen] = useState(false);
  const [avulsoOpen, setAvulsoOpen] = useState(false);
  const [subirOpen, setSubirOpen] = useState(false);
  const [editando, setEditando] = useState<ModeloLista | null>(null);
  const [excluindo, setExcluindo] = useState<ModeloLista | null>(null);
  const [chip, setChip] = useState<FiltroChip>("todos");
  const [busca, setBusca] = useState("");
  const [pastaAtiva, setPastaAtiva] = useState<string | null>(null); // null = todas

  const lista: ModeloLista[] = (modelos as ModeloLista[]) || [];

  // ── Agregados pro hero e sidebar ──
  const stats = useMemo(() => {
    const total = lista.length;
    const paraAssinatura = lista.filter((m) => m.ehParaAssinatura).length;
    let totalPlaceholders = 0;
    let totalVar = 0;
    let totalManual = 0;
    const pastasMap = new Map<string, number>();
    for (const m of lista) {
      totalPlaceholders += m.placeholders.length;
      totalVar += m.placeholders.filter((p) => p.tipo === "variavel").length;
      totalManual += m.placeholders.filter((p) => p.tipo === "manual").length;
      const p = m.pasta || "";
      pastasMap.set(p, (pastasMap.get(p) ?? 0) + 1);
    }
    const pastas = Array.from(pastasMap.entries())
      .sort(([a], [b]) => {
        if (a === "") return 1; // raiz por último
        if (b === "") return -1;
        return a.localeCompare(b);
      })
      .map(([nome, count]) => ({ nome, count }));
    return { total, paraAssinatura, totalPlaceholders, totalVar, totalManual, pastas };
  }, [lista]);

  // ── Aplicar filtros + pasta selecionada ──
  const filtrados = useMemo(() => {
    let l = aplicarFiltro(lista, chip, busca);
    if (pastaAtiva !== null) {
      l = l.filter((m) => (m.pasta || "") === pastaAtiva);
    }
    return l;
  }, [lista, chip, busca, pastaAtiva]);

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-50/40 via-white to-blue-50/20 p-6 space-y-6">
      {/* ═══════════ HERO ═══════════ */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-800 via-slate-700 to-indigo-700 p-7 text-white relative overflow-hidden shadow-lg">
        <FileText className="absolute -right-10 -bottom-12 w-56 h-56 opacity-10" strokeWidth={1.2} />
        <FileSignature className="absolute right-12 top-6 w-20 h-20 opacity-10" strokeWidth={1.2} />
        <div className="relative">
          <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <PulseDot />
                <p className="text-xs font-medium text-white/85 uppercase tracking-wider">
                  Modelos de contrato
                </p>
              </div>
              <p className="text-xs text-white/70">
                Templates DOCX com placeholders pra geração automática.
              </p>
            </div>
            {isGestor && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="bg-white text-slate-900 hover:bg-slate-100 shadow-sm font-semibold">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Novo
                    <ChevronDown className="h-4 w-4 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuItem onClick={() => setUploadOpen(true)} className="cursor-pointer items-start gap-2.5 py-2.5">
                    <FileText className="h-4 w-4 mt-0.5 text-indigo-600" />
                    <div>
                      <p className="text-sm font-medium">Modelo reutilizável</p>
                      <p className="text-[11px] text-muted-foreground">Sobe um .docx com placeholders pra reusar sempre.</p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAvulsoOpen(true)} className="cursor-pointer items-start gap-2.5 py-2.5">
                    <PenLine className="h-4 w-4 mt-0.5 text-violet-600" />
                    <div>
                      <p className="text-sm font-medium">Contrato avulso</p>
                      <p className="text-[11px] text-muted-foreground">Escolhe um modelo existente, preenche e gera (PDF ou assinatura).</p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSubirOpen(true)} className="cursor-pointer items-start gap-2.5 py-2.5">
                    <Upload className="h-4 w-4 mt-0.5 text-emerald-600" />
                    <div>
                      <p className="text-sm font-medium">Subir documento p/ assinatura</p>
                      <p className="text-[11px] text-muted-foreground">Sobe um PDF/Word pronto e só posiciona as assinaturas.</p>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
            <div className="lg:col-span-6">
              <p className="text-sm font-medium text-white/85 mb-1">Total de modelos</p>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                  {stats.total}
                </span>
                {stats.paraAssinatura > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-white/15 text-white border border-white/20">
                    <FileSignature className="w-3 h-3" />
                    {stats.paraAssinatura} pra assinatura
                  </span>
                )}
              </div>
              {stats.totalPlaceholders > 0 && (
                <p className="text-xs text-white/65 mt-2 tabular-nums">
                  <b className="text-white">{stats.totalPlaceholders}</b> placeholders mapeados ·{" "}
                  <b className="text-white">{stats.totalVar}</b> variáveis ·{" "}
                  <b className="text-white">{stats.totalManual}</b> manuais
                </p>
              )}
            </div>

            {/* Mini grid pastas no hero */}
            {stats.pastas.length > 0 && (
              <div className="lg:col-span-6">
                <p className="text-[10px] text-white/65 uppercase tracking-wider mb-2">
                  Organização por pasta
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {stats.pastas.slice(0, 4).map((p) => (
                    <div
                      key={p.nome || "__raiz__"}
                      className="bg-white/10 rounded-lg px-3 py-2 border border-white/15"
                    >
                      <p className="text-[11px] text-white/70 mb-1 truncate">
                        {p.nome || "Sem pasta"}
                      </p>
                      <p className="text-2xl font-bold tabular-nums leading-none">{p.count}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════ LOADING / EMPTY ═══════════ */}
      {isLoading ? (
        <div className="h-32 rounded-xl bg-slate-100 animate-pulse" />
      ) : stats.total === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground mb-2">Nenhum modelo cadastrado ainda</p>
            <p className="text-xs text-muted-foreground/70 mb-4 max-w-md mx-auto">
              Faça upload de um arquivo .docx contendo placeholders nomeados ({`{{nome completo}}`},{" "}
              {`{{cpf}}`}, ...) e configure cada um como variável ou preenchimento manual.
            </p>
            {isGestor && (
              <Button onClick={() => setUploadOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Subir primeiro modelo
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ═══════════ BUSCA + CHIPS ═══════════ */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[260px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar modelo por nome ou descrição..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-10 h-10 bg-white"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <ChipBtn ativo={chip === "todos"} onClick={() => setChip("todos")}>
                Todos <CountPill ativo={chip === "todos"}>{stats.total}</CountPill>
              </ChipBtn>
              <ChipBtn ativo={chip === "assinatura"} onClick={() => setChip("assinatura")}>
                Para assinatura{" "}
                <CountPill ativo={chip === "assinatura"}>{stats.paraAssinatura}</CountPill>
              </ChipBtn>
              {(() => {
                const semVar = lista.filter(
                  (m) =>
                    m.placeholders.length > 0 && m.placeholders.every((p) => p.tipo === "manual"),
                ).length;
                return semVar > 0 ? (
                  <ChipBtn
                    ativo={chip === "sem_variaveis"}
                    onClick={() => setChip("sem_variaveis")}
                    destaque="amber"
                  >
                    Sem variáveis <CountPill ativo={chip === "sem_variaveis"} tom="amber">{semVar}</CountPill>
                  </ChipBtn>
                ) : null;
              })()}
              {(stats.pastas.find((p) => p.nome === "")?.count ?? 0) > 0 && (
                <ChipBtn
                  ativo={chip === "sem_pasta"}
                  onClick={() => setChip("sem_pasta")}
                  destaque="rose"
                >
                  Sem pasta{" "}
                  <CountPill ativo={chip === "sem_pasta"} tom="rose">
                    {stats.pastas.find((p) => p.nome === "")?.count}
                  </CountPill>
                </ChipBtn>
              )}
            </div>
          </div>

          {/* ═══════════ SIDEBAR PASTAS + GRID ═══════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
            <aside className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 px-2 mb-2">
                Pastas
              </p>
              <PastaCard
                ativa={pastaAtiva === null}
                onClick={() => setPastaAtiva(null)}
                nome="Todas"
                count={stats.total}
                cor={{ bg: "bg-slate-100", fg: "text-slate-700" }}
                icone={Folder}
              />
              {stats.pastas.map((p) => {
                const cor = p.nome ? corDaPasta(p.nome) : { bg: "bg-slate-100", fg: "text-slate-500" };
                return (
                  <PastaCard
                    key={p.nome || "__raiz__"}
                    ativa={pastaAtiva === p.nome}
                    onClick={() => setPastaAtiva(p.nome)}
                    nome={p.nome || "Sem pasta"}
                    count={p.count}
                    cor={cor}
                    icone={p.nome ? Folder : FileText}
                  />
                );
              })}
            </aside>

            <main>
              {filtrados.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Search className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Nenhum modelo corresponde aos filtros.
                    </p>
                    {(busca || chip !== "todos" || pastaAtiva !== null) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-3 text-xs"
                        onClick={() => {
                          setBusca("");
                          setChip("todos");
                          setPastaAtiva(null);
                        }}
                      >
                        Limpar filtros
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <Folder className="w-4 h-4 text-indigo-600" />
                      {pastaAtiva === null
                        ? "Todos os modelos"
                        : pastaAtiva === ""
                          ? "Sem pasta"
                          : pastaAtiva}
                      <span className="text-[11px] text-slate-400 font-normal">
                        · {filtrados.length} modelo{filtrados.length === 1 ? "" : "s"}
                      </span>
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {filtrados.map((m) => (
                      <CardModelo
                        key={m.id}
                        modelo={m}
                        isGestor={!!isGestor}
                        onEditar={() => setEditando(m)}
                        onExcluir={() => setExcluindo(m)}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Dica */}
              {lista.length < 5 && (
                <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/40 p-4 flex items-start gap-3">
                  <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-blue-900">Dica</p>
                    <p className="text-[11px] text-blue-800 mt-0.5">
                      Suba modelos .docx com placeholders como{" "}
                      <code className="bg-white px-1 py-0.5 rounded text-[10px]">{`{{nome completo}}`}</code>{" "}
                      ou{" "}
                      <code className="bg-white px-1 py-0.5 rounded text-[10px]">{`{{cpf}}`}</code>.
                      O sistema reconhece variáveis do catálogo automaticamente; o que não bater fica
                      como preenchimento manual.
                    </p>
                  </div>
                </div>
              )}
            </main>
          </div>
        </>
      )}

      {/* ═══════════ DIALOGS ═══════════ */}
      {uploadOpen && (
        <UploadWizardDialog
          onClose={() => setUploadOpen(false)}
          onSuccess={() => {
            setUploadOpen(false);
            utils.modelosContrato.listar.invalidate();
          }}
        />
      )}

      {/* Contrato avulso: escolhe um modelo existente + cliente e gera. */}
      <GerarContratoDialog open={avulsoOpen} onOpenChange={setAvulsoOpen} />

      {/* Subir documento pronto (PDF/Word) só pra posicionar assinaturas. */}
      <SubirDocumentoAssinaturaDialog open={subirOpen} onOpenChange={setSubirOpen} />

      {editando && (
        <MappingEditorDialog
          modelo={editando}
          onClose={() => setEditando(null)}
          onSuccess={() => {
            setEditando(null);
            utils.modelosContrato.listar.invalidate();
          }}
        />
      )}

      {excluindo && (
        <Dialog open onOpenChange={(o) => !o && setExcluindo(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-warning" />
                Excluir &ldquo;{excluindo.nome}&rdquo;?
              </DialogTitle>
              <DialogDescription>
                O arquivo e o mapeamento serão removidos. Contratos já gerados não são afetados (eles
                não ficam armazenados).
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setExcluindo(null)} disabled={excluir.isPending}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => excluir.mutate({ id: excluindo.id }, { onSettled: () => setExcluindo(null) })}
                disabled={excluir.isPending}
              >
                {excluir.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function ChipBtn({
  ativo,
  onClick,
  children,
  destaque,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  destaque?: "amber" | "rose";
}) {
  const ativoBg = "bg-slate-900 text-white border-slate-900";
  const idleBg = "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900";
  const destaqueIdle =
    destaque === "amber"
      ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
      : destaque === "rose"
        ? "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
        : "";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
        ativo ? ativoBg : destaqueIdle || idleBg
      }`}
    >
      {children}
    </button>
  );
}

function CountPill({
  children,
  ativo,
  tom,
}: {
  children: React.ReactNode;
  ativo: boolean;
  tom?: "amber" | "rose";
}) {
  if (ativo)
    return <span className="bg-white/20 px-1.5 rounded-full text-[10px]">{children}</span>;
  if (tom === "amber")
    return <span className="bg-amber-100 text-amber-700 px-1.5 rounded-full text-[10px]">{children}</span>;
  if (tom === "rose")
    return <span className="bg-rose-100 text-rose-700 px-1.5 rounded-full text-[10px]">{children}</span>;
  return <span className="bg-slate-100 text-slate-600 px-1.5 rounded-full text-[10px]">{children}</span>;
}

function PastaCard({
  ativa,
  onClick,
  nome,
  count,
  cor,
  icone: Icone,
}: {
  ativa: boolean;
  onClick: () => void;
  nome: string;
  count: number;
  cor: { bg: string; fg: string };
  icone: typeof Folder;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
        ativa
          ? "border-indigo-400 bg-gradient-to-br from-indigo-50 to-white shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      <div className={`w-9 h-9 rounded-lg ${cor.bg} flex items-center justify-center shrink-0`}>
        <Icone className={`w-4 h-4 ${cor.fg}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{nome}</p>
        <p className="text-[11px] text-muted-foreground">
          {count} modelo{count === 1 ? "" : "s"}
        </p>
      </div>
    </button>
  );
}

function CardModelo({
  modelo,
  isGestor,
  onEditar,
  onExcluir,
}: {
  modelo: ModeloLista;
  isGestor: boolean;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  const totalVar = modelo.placeholders.filter((p) => p.tipo === "variavel").length;
  const totalManual = modelo.placeholders.filter((p) => p.tipo === "manual").length;
  const semVariaveis = modelo.placeholders.length > 0 && totalVar === 0;
  const gradient = gradientDoModelo(modelo.nome);

  const borda = semVariaveis
    ? "border-amber-300 bg-gradient-to-br from-amber-50/30 to-white"
    : "border-slate-200 hover:border-slate-400";

  return (
    <div
      className={`group relative bg-white border rounded-2xl p-4 transition-all hover:shadow-md hover:-translate-y-0.5 ${borda}`}
    >
      {/* Topo: ícone + nome + badge ASSIN ou pending */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradient} text-white shadow-sm flex items-center justify-center shrink-0`}
        >
          <FileText className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{modelo.nome}</p>
          {modelo.descricao && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{modelo.descricao}</p>
          )}
        </div>
        {semVariaveis ? (
          <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0">
            ⚠ Revisar
          </span>
        ) : modelo.ehParaAssinatura ? (
          <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 shrink-0">
            <FileSignature className="w-2.5 h-2.5 mr-0.5" />
            ASSIN
          </span>
        ) : null}
      </div>

      {/* Pills */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {totalVar > 0 && (
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
            <Variable className="w-2.5 h-2.5 mr-0.5" />
            {totalVar} variáve{totalVar === 1 ? "l" : "is"}
          </span>
        )}
        {totalManual > 0 && (
          <span
            className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              semVariaveis ? "bg-amber-100 text-amber-800" : "bg-amber-50 text-amber-700"
            }`}
          >
            {totalManual} manua{totalManual === 1 ? "l" : "is"}
            {semVariaveis ? " (revisar)" : ""}
          </span>
        )}
        {modelo.placeholders.length === 0 && (
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            Sem placeholders
          </span>
        )}
      </div>

      {/* Metadados */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-3 tabular-nums">
        <span className="truncate flex-1 mr-2">
          {modelo.arquivoNome}
          {modelo.tamanho ? ` · ${(modelo.tamanho / 1024).toFixed(0)} KB` : ""}
        </span>
        <span className="shrink-0">{formatRelativo(modelo.createdAt)}</span>
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1.5">
        {semVariaveis && isGestor ? (
          <Button
            size="sm"
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white h-8 text-xs"
            onClick={onEditar}
          >
            <Pencil className="w-3 h-3 mr-1" />
            Finalizar mapeamento
          </Button>
        ) : (
          <Button
            size="sm"
            variant="default"
            className="flex-1 h-8 text-xs"
            onClick={onEditar}
          >
            <Pencil className="w-3 h-3 mr-1" />
            Editar
          </Button>
        )}
        {isGestor && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
            onClick={onExcluir}
            title="Excluir"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Upload wizard ───────────────────────────────────────────────────────

function UploadWizardDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [pasta, setPasta] = useState("");
  const [ehParaAssinatura, setEhParaAssinatura] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [modeloId, setModeloId] = useState<number | null>(null);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);

  // Pastas existentes pra autocomplete (datalist)
  const { data: pastasExistentes } = (trpc as any).modelosContrato.listarPastas.useQuery();

  const upload = (trpc as any).modelosContrato.upload.useMutation({
    onSuccess: (r: { id: number; placeholdersDetectados: string[] }) => {
      setModeloId(r.id);
      // Backend já infere variável do catálogo quando possível (PR #231).
      // Aqui só inicializamos pro user revisar/ajustar no PlaceholdersMapper —
      // todos vão como manual, com label = nome (user troca pra variável
      // se quiser).
      setPlaceholders(
        r.placeholdersDetectados.map((nome) => ({
          nome,
          tipo: "manual" as const,
          label: nome,
        })),
      );
      if (r.placeholdersDetectados.length === 0) {
        toast.warning(
          "Nenhum placeholder {{nome}} encontrado — modelo só pode ser usado como anexo padrão",
        );
      }
      setStep(2);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const salvarMapping = (trpc as any).modelosContrato.salvarMapping.useMutation({
    onSuccess: () => {
      toast.success("Modelo salvo");
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".docx")) {
      toast.error("Apenas arquivos .docx são aceitos");
      return;
    }
    if (f.size > 2 * 1024 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx. 2GB)");
      return;
    }
    setArquivo(f);
    if (!nome) setNome(f.name.replace(/\.docx$/i, ""));
  }

  async function handleUpload() {
    if (!arquivo || !nome.trim()) return;
    const base64 = await fileToBase64(arquivo);
    upload.mutate({
      nome: nome.trim(),
      descricao: descricao.trim() || undefined,
      pasta: pasta.trim() || null,
      ehParaAssinatura,
      arquivoNome: arquivo.name,
      mimetype: arquivo.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      base64,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo modelo de contrato</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Suba o arquivo .docx contendo placeholders numerados."
              : "Configure o que cada placeholder vai puxar."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do modelo *</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Contrato de Honorários — Trabalhista"
                maxLength={150}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Descrição (opcional)</Label>
              <Textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Resumo do que este modelo cobre"
                rows={2}
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Pasta (opcional)</Label>
              <Input
                value={pasta}
                onChange={(e) => setPasta(e.target.value)}
                placeholder="Ex: Contratos/Honorários — use / pra subpastas"
                maxLength={255}
                list="pastas-existentes"
              />
              <datalist id="pastas-existentes">
                {(pastasExistentes as string[] | undefined)?.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <p className="text-[10px] text-muted-foreground">
                Organize modelos em pastas hierárquicas. Deixe em branco pra ficar na raiz.
              </p>
            </div>
            <div className="flex items-start gap-2 rounded-md border bg-muted/20 p-3">
              <Checkbox
                id="eh-para-assinatura"
                checked={ehParaAssinatura}
                onCheckedChange={(v) => setEhParaAssinatura(!!v)}
              />
              <div className="space-y-0.5">
                <Label
                  htmlFor="eh-para-assinatura"
                  className="text-xs cursor-pointer flex items-center gap-1.5"
                >
                  <PenLine className="h-3 w-3" />
                  Este modelo é um contrato (cliente precisa assinar)
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Quando marcado, aparece no botão &ldquo;Gerar contrato&rdquo; do detalhe do
                  cliente. Petições, pareceres e similares ficam ocultos lá.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Arquivo .docx *</Label>
              <div className="flex items-center gap-2">
                <Input type="file" accept=".docx" onChange={handleFileChange} className="flex-1" />
              </div>
              {arquivo && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {arquivo.name} · {(arquivo.size / 1024).toFixed(0)} KB
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                Escreva no DOCX placeholders com nome amigável:{" "}
                <code className="bg-muted px-1 rounded">{`{{nome completo}}`}</code>,
                <code className="bg-muted px-1 mx-0.5 rounded">{`{{nacionalidade}}`}</code>,
                <code className="bg-muted px-1 mx-0.5 rounded">{`{{CPF}}`}</code>. O sistema reconhece
                e mapeia automaticamente. Modelos com {`{{1}}, {{2}}`} legados continuam funcionando.
              </p>
            </div>
          </div>
        )}

        {step === 2 && modeloId && (
          <PlaceholdersMapper placeholders={placeholders} onChange={setPlaceholders} />
        )}

        <DialogFooter>
          {step === 2 && (
            <Button
              variant="ghost"
              onClick={() => setStep(1)}
              disabled={salvarMapping.isPending}
              className="mr-auto"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Voltar
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={upload.isPending || salvarMapping.isPending}>
            Cancelar
          </Button>
          {step === 1 && (
            <Button onClick={handleUpload} disabled={!arquivo || !nome.trim() || upload.isPending}>
              {upload.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Enviar e detectar placeholders
            </Button>
          )}
          {step === 2 && (
            <Button
              onClick={() =>
                modeloId &&
                salvarMapping.mutate({
                  id: modeloId,
                  placeholders,
                  // pasta + ehParaAssinatura vão junto pra refletir mudanças
                  // do step 1 caso user volte e edite; backend já gravou no
                  // upload mas se user mudou no caminho, salva o estado novo.
                  pasta: pasta.trim() || null,
                  ehParaAssinatura,
                })
              }
              disabled={salvarMapping.isPending || !validarMapping(placeholders)}
            >
              {salvarMapping.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Salvar modelo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit mapping (modelo existente) ─────────────────────────────────────

function MappingEditorDialog({
  modelo,
  onClose,
  onSuccess,
}: {
  modelo: ModeloLista;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [nome, setNome] = useState(modelo.nome);
  const [descricao, setDescricao] = useState(modelo.descricao || "");
  const [pasta, setPasta] = useState(modelo.pasta || "");
  const [ehParaAssinatura, setEhParaAssinatura] = useState(!!modelo.ehParaAssinatura);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>(modelo.placeholders);

  const { data: pastasExistentes } = (trpc as any).modelosContrato.listarPastas.useQuery();

  const salvar = (trpc as any).modelosContrato.salvarMapping.useMutation({
    onSuccess: () => {
      toast.success("Mapeamento atualizado");
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar &ldquo;{modelo.nome}&rdquo;</DialogTitle>
          <DialogDescription>
            Atualize o nome, descrição, pasta ou o mapeamento dos placeholders.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={150} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Descrição</Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Pasta</Label>
            <Input
              value={pasta}
              onChange={(e) => setPasta(e.target.value)}
              placeholder="Ex: Contratos/Honorários (vazio = raiz)"
              maxLength={255}
              list="pastas-existentes-edit"
            />
            <datalist id="pastas-existentes-edit">
              {(pastasExistentes as string[] | undefined)?.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="flex items-start gap-2 rounded-md border bg-muted/20 p-3">
            <Checkbox
              id="eh-para-assinatura-edit"
              checked={ehParaAssinatura}
              onCheckedChange={(v) => setEhParaAssinatura(!!v)}
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="eh-para-assinatura-edit"
                className="text-xs cursor-pointer flex items-center gap-1.5"
              >
                <PenLine className="h-3 w-3" />
                Este modelo é um contrato (cliente precisa assinar)
              </Label>
              <p className="text-[10px] text-muted-foreground">
                Quando marcado, aparece no botão &ldquo;Gerar contrato&rdquo; do detalhe
                do cliente.
              </p>
            </div>
          </div>
          <PlaceholdersMapper placeholders={placeholders} onChange={setPlaceholders} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              salvar.mutate({
                id: modelo.id,
                nome: nome.trim(),
                descricao: descricao.trim() || null,
                pasta: pasta.trim() || null,
                ehParaAssinatura,
                placeholders,
              })
            }
            disabled={salvar.isPending || !nome.trim() || !validarMapping(placeholders)}
          >
            {salvar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Placeholders mapper (compartilhado entre upload e edit) ─────────────

function PlaceholdersMapper({
  placeholders,
  onChange,
}: {
  placeholders: Placeholder[];
  onChange: (p: Placeholder[]) => void;
}) {
  const { data: catalogo } = (trpc as any).modelosContrato.catalogoVariaveis.useQuery();

  // Agrupa o catálogo por `grupo` pra renderizar SelectGroup.
  const catalogoAgrupado = useMemo(() => {
    if (!catalogo) return {} as Record<string, Array<{ path: string; label: string }>>;
    const acc: Record<string, Array<{ path: string; label: string }>> = {};
    for (const v of catalogo as Array<{ path: string; label: string; grupo: string }>) {
      if (!acc[v.grupo]) acc[v.grupo] = [];
      acc[v.grupo].push({ path: v.path, label: v.label });
    }
    return acc;
  }, [catalogo]);

  function atualizar(nome: string, patch: Partial<Placeholder>) {
    onChange(
      placeholders.map((p) => (p.nome === nome ? ({ ...p, ...patch } as Placeholder) : p)),
    );
  }

  if (placeholders.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        <Wand2 className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
        Nenhum placeholder <code className="text-[11px] bg-muted px-1 rounded">{`{{nome}}`}</code> encontrado no documento.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Para cada placeholder detectado, escolha se vai puxar de uma <b>variável</b> (preenche
        automático do cadastro) ou se será <b>manual</b> (você preenche na hora de gerar o contrato).
        <br />
        <span className="text-[10px]">
          Dica: escreva no DOCX nomes amigáveis como <code className="font-mono">{`{{nome completo}}`}</code>,
          <code className="font-mono">{` {{nacionalidade}}`}</code>, <code className="font-mono">{`{{CPF}}`}</code>
          — o sistema reconhece automaticamente.
        </span>
      </p>
      <div className="space-y-2">
        {placeholders.map((p) => (
          <div key={p.nome} className="rounded-lg border p-3 space-y-2 bg-card">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className="font-mono text-xs h-6 px-2 bg-info-bg text-info-fg border-0">
                {`{{${p.nome}}}`}
              </Badge>
              <div className="inline-flex rounded-md border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() =>
                    atualizar(p.nome, { tipo: "variavel", variavel: "" } as Partial<Placeholder>)
                  }
                  className={`px-3 py-1 text-xs rounded ${
                    p.tipo === "variavel" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Variável
                </button>
                <button
                  type="button"
                  onClick={() =>
                    atualizar(p.nome, {
                      tipo: "manual",
                      label: p.nome,
                    } as Partial<Placeholder>)
                  }
                  className={`px-3 py-1 text-xs rounded ${
                    p.tipo === "manual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Manual
                </button>
              </div>
            </div>

            {p.tipo === "variavel" && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Variável que será usada</Label>
                <Select
                  value={p.variavel || ""}
                  onValueChange={(v) => atualizar(p.nome, { variavel: v } as Partial<Placeholder>)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Selecione uma variável..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(catalogoAgrupado).map(([grupo, items]) => (
                      <SelectGroup key={grupo}>
                        <SelectLabel className="text-[10px] uppercase tracking-wide">{grupo}</SelectLabel>
                        {items.map((it) => (
                          <SelectItem key={it.path} value={it.path}>
                            {it.label}
                            <span className="ml-2 text-[10px] text-muted-foreground font-mono">{it.path}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {p.tipo === "manual" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Pergunta ao gerar *</Label>
                  <Input
                    value={p.label}
                    onChange={(e) =>
                      atualizar(p.nome, { label: e.target.value } as Partial<Placeholder>)
                    }
                    maxLength={120}
                    placeholder="Ex: Valor da causa"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Dica (opcional)</Label>
                  <Input
                    value={p.dica || ""}
                    onChange={(e) =>
                      atualizar(p.nome, { dica: e.target.value } as Partial<Placeholder>)
                    }
                    maxLength={120}
                    placeholder="Ex: R$ 10.000,00"
                    className="h-9"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function validarMapping(placeholders: Placeholder[]): boolean {
  for (const p of placeholders) {
    if (p.tipo === "variavel" && !p.variavel) return false;
    if (p.tipo === "manual" && !p.label.trim()) return false;
  }
  return true;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove o prefixo "data:...;base64,"
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}
