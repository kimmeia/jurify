/**
 * Admin · Modelos de SmartFlow.
 *
 * O admin publica modelos (blueprints) que os escritórios clientes clonam
 * pela galeria do SmartFlow. Autoria reaproveita o editor do cliente:
 * o admin monta o fluxo no SmartFlow normal e "promove a modelo" aqui.
 */

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Zap, Sparkles, Plus, LayoutGrid, CheckCircle2, FileEdit, Copy,
  Loader2, Trash2, Search, Layers,
} from "lucide-react";
import { toast } from "sonner";

const CATEGORIAS = ["Cobrança", "Atendimento", "Agendamento", "Processos", "CRM", "Outros"];

function ChipKpi({ icon, cor, valor, label }: { icon: React.ReactNode; cor: string; valor: number | string; label: string }) {
  return (
    <div className="bg-card rounded-xl border border-border/60 px-3 py-2.5 flex items-center gap-2.5">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cor}`}>{icon}</div>
      <div className="leading-tight min-w-0">
        <p className="text-base font-bold leading-none tabular-nums truncate">{valor}</p>
        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wide mt-1">{label}</p>
      </div>
    </div>
  );
}

export default function AdminSmartflow() {
  const utils = trpc.useUtils();
  const [busca, setBusca] = useState("");
  const [promoverOpen, setPromoverOpen] = useState(false);
  const [editar, setEditar] = useState<any | null>(null);
  const [excluir, setExcluir] = useState<{ id: number; nome: string } | null>(null);

  const { data: templates = [], isLoading } = (trpc as any).adminSmartflow.listar.useQuery();

  const publicarMut = (trpc as any).adminSmartflow.publicar.useMutation({
    onSuccess: () => utils.adminSmartflow.listar.invalidate(),
    onError: (e: any) => toast.error(e.message),
  });
  const deletarMut = (trpc as any).adminSmartflow.deletar.useMutation({
    onSuccess: () => { toast.success("Modelo removido"); setExcluir(null); utils.adminSmartflow.listar.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (templates as any[]).filter((t) => !b || t.nome.toLowerCase().includes(b) || (t.categoria || "").toLowerCase().includes(b));
  }, [templates, busca]);

  const publicados = (templates as any[]).filter((t) => t.disponivelParaClientes).length;
  const clones = (templates as any[]).reduce((a, t) => a + (t.clones || 0), 0);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* HERO (pegada do SmartFlow do cliente) */}
      <div
        className="relative overflow-hidden rounded-2xl p-5 border"
        style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.08) 50%, rgba(236,72,153,0.06) 100%)", borderColor: "rgba(139,92,246,0.18)" }}
      >
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 flex items-center justify-center shadow-md">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">SmartFlow — Modelos</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <Sparkles className="h-3 w-3 text-violet-500" />
              <span>Publique fluxos prontos para os escritórios clonarem</span>
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setPromoverOpen(true)}
            className="bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-md"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Novo modelo
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ChipKpi icon={<LayoutGrid className="h-4 w-4" />} cor="bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" valor={templates.length} label="Modelos" />
          <ChipKpi icon={<CheckCircle2 className="h-4 w-4" />} cor="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" valor={publicados} label="Publicados" />
          <ChipKpi icon={<FileEdit className="h-4 w-4" />} cor="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" valor={templates.length - publicados} label="Rascunhos" />
          <ChipKpi icon={<Copy className="h-4 w-4" />} cor="bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300" valor={clones} label="Clones" />
        </div>
      </div>

      {/* busca */}
      {templates.length > 0 && (
        <div className="relative max-w-xs">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar modelo..." className="h-9 pl-8 text-xs" />
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <Skeleton className="h-44" /><Skeleton className="h-44" /><Skeleton className="h-44" />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border bg-card flex flex-col items-center py-16 text-center">
          <Layers className="h-12 w-12 text-muted-foreground/20 mb-4" />
          <h3 className="text-lg font-semibold">Nenhum modelo ainda</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Monte um fluxo no seu SmartFlow e promova a modelo — ele aparece na galeria dos escritórios pra ser clonado.
          </p>
          <Button size="sm" className="mt-4 bg-gradient-to-br from-violet-600 to-indigo-600" onClick={() => setPromoverOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Promover um fluxo a modelo
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {lista.map((t) => (
            <div key={t.id} className="relative rounded-xl border border-l-4 border-l-violet-500 bg-card p-4 transition-all hover:shadow-md">
              <div className="flex items-start gap-2.5 mb-2">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 shadow-sm bg-gradient-to-br ${t.gradiente || "from-violet-500 to-indigo-500"}`}>
                  <Zap className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate" title={t.nome}>{t.nome}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{t.categoria || "Sem categoria"} · {t.gatilho}</p>
                </div>
              </div>
              {t.descricao && <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-snug">{t.descricao}</p>}
              <div className="flex flex-wrap gap-1 mb-3">
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">{t.qtdPassos} passos</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300">{t.clones} clones</span>
                {!t.disponivelParaClientes && <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400">Rascunho</span>}
              </div>
              <div className="flex items-center justify-between gap-2 border-t pt-2.5">
                <div className="flex items-center gap-1.5">
                  <Switch
                    checked={t.disponivelParaClientes}
                    onCheckedChange={(v: boolean) => publicarMut.mutate({ id: t.id, disponivel: v })}
                    disabled={publicarMut.isPending}
                    aria-label="Disponível para clientes"
                  />
                  <span className="text-[10px] text-muted-foreground">Disponível</span>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditar(t)} title="Editar metadados">
                    <FileEdit className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => setExcluir({ id: t.id, nome: t.nome })} title="Excluir">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <PromoverDialog open={promoverOpen} onOpenChange={setPromoverOpen} />
      <EditarMetadadosDialog template={editar} onClose={() => setEditar(null)} />

      <AlertDialog open={excluir !== null} onOpenChange={(o) => { if (!o) setExcluir(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo <strong>{excluir?.nome}</strong> sai da galeria. Cenários já
              clonados pelos escritórios <strong>não</strong> são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletarMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); if (excluir) deletarMut.mutate({ id: excluir.id }); }}
            >
              {deletarMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null} Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Promover um fluxo (do escritório do admin) a modelo ───────────────────

function PromoverDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const { data: fluxos = [] } = (trpc as any).smartflow.listar.useQuery(undefined, { enabled: open });
  const [cenarioId, setCenarioId] = useState<string>("");
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("Outros");

  const criarMut = (trpc as any).adminSmartflow.criar.useMutation({
    onSuccess: () => {
      toast.success("Modelo criado! Ative o toggle pra publicar na galeria.");
      utils.adminSmartflow.listar.invalidate();
      onOpenChange(false);
      setCenarioId(""); setNome(""); setDescricao(""); setCategoria("Outros");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const promover = async () => {
    if (!cenarioId) { toast.error("Escolha um fluxo"); return; }
    try {
      const det = await (utils as any).smartflow.detalhe.fetch({ id: Number(cenarioId) });
      if (!det) { toast.error("Fluxo não encontrado"); return; }
      const passos = (det.passos || []).map((p: any) => {
        let config: any = {};
        try { config = typeof p.config === "string" ? JSON.parse(p.config || "{}") : (p.config || {}); } catch { config = {}; }
        return {
          clienteId: p.clienteId || (crypto.randomUUID?.() ?? `p-${p.id}`),
          tipo: p.tipo,
          config,
          ...(p.proximoSe && Object.keys(p.proximoSe).length > 0 ? { proximoSe: p.proximoSe } : {}),
        };
      });
      if (passos.length === 0) { toast.error("Esse fluxo não tem passos."); return; }
      criarMut.mutate({
        nome: nome.trim() || det.nome,
        descricao: descricao.trim(),
        gatilho: det.gatilho,
        configGatilho: det.configGatilho || undefined,
        passos,
        categoria,
        disponivelParaClientes: false,
      });
    } catch (e: any) {
      toast.error(e.message || "Falha ao ler o fluxo");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-violet-600" /> Promover fluxo a modelo</DialogTitle>
          <DialogDescription>
            Escolha um fluxo do seu SmartFlow. Ele é copiado como modelo (blueprint) —
            seu fluxo original continua intacto. Os campos editáveis (mensagens, dias…)
            viram o wizard que o cliente preenche ao clonar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Fluxo de origem</label>
            <Select value={cenarioId} onValueChange={setCenarioId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione um fluxo do seu SmartFlow" /></SelectTrigger>
              <SelectContent>
                {fluxos.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum fluxo no seu SmartFlow ainda.</div>
                ) : fluxos.map((f: any) => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nome público (opcional)</label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Herda o nome do fluxo se vazio" className="mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Descrição pública</label>
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="O que esse fluxo faz, em 1 linha" rows={2} className="mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Categoria</label>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={criarMut.isPending}>Cancelar</Button>
          <Button onClick={promover} disabled={criarMut.isPending || !cenarioId}>
            {criarMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null} Criar modelo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Editar metadados de um modelo existente ───────────────────────────────

function EditarMetadadosDialog({ template, onClose }: { template: any | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: full } = (trpc as any).adminSmartflow.detalhe.useQuery(
    { id: template?.id ?? 0 },
    { enabled: !!template },
  );
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("Outros");

  // Sincroniza os campos quando o detalhe carrega.
  useEffect(() => {
    if (full) { setNome(full.nome); setDescricao(full.descricao || ""); setCategoria(full.categoria || "Outros"); }
  }, [full]);

  const atualizarMut = (trpc as any).adminSmartflow.atualizar.useMutation({
    onSuccess: () => { toast.success("Modelo atualizado"); utils.adminSmartflow.listar.invalidate(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const salvar = () => {
    if (!full) return;
    atualizarMut.mutate({
      id: full.id,
      nome: nome.trim() || full.nome,
      descricao: descricao.trim(),
      icone: full.icone,
      gradiente: full.gradiente,
      gatilho: full.gatilho,
      configGatilho: full.configGatilho || undefined,
      passos: full.passos,
      categoria,
      badge: full.badge || undefined,
      dica: full.dica || undefined,
      disponivelParaClientes: full.disponivelParaClientes,
    });
  };

  return (
    <Dialog open={!!template} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar modelo</DialogTitle>
          <DialogDescription>Ajuste os metadados da galeria. Pra mudar os passos, edite o fluxo de origem e promova de novo.</DialogDescription>
        </DialogHeader>
        {!full ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3 py-1">
            <div><label className="text-xs font-medium text-muted-foreground">Nome público</label><Input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1 text-sm" /></div>
            <div><label className="text-xs font-medium text-muted-foreground">Descrição pública</label><Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} className="mt-1 text-sm" /></div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categoria</label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={atualizarMut.isPending}>Cancelar</Button>
          <Button onClick={salvar} disabled={!full || atualizarMut.isPending}>
            {atualizarMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
