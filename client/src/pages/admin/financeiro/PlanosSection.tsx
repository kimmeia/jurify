import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Edit, GripVertical, Loader2, Package, Plus, Sparkles, Star } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

function formatBRL(centavos: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

export interface PlanoEditavel {
  id: number;
  slug: string;
  nome: string;
  descricao: string | null;
  publicoAlvo: string | null;
  precoMensalCentavos: number;
  precoAnualCentavos: number | null;
  trialDias: number;
  maxUsuarios: number;
  maxArmazenamentoMb: number;
  maxClientes: number | null;
  maxConexoesWhatsapp: number;
  maxAgentesIa: number;
  maxMonitoramentosProcessos: number | null;
  maxMonitoramentosCpf: number | null;
  creditosCalculosMes: number;
  jurisiaMensagensMes: number;
  precoSobConsulta: boolean;
  ctaDemonstracao: boolean;
  atendentesInclusos: number | null;
  precoAtendenteAdicionalCentavos: number;
  modulosLiberados: string[];
  features: string[];
  popular: boolean;
  oculto: boolean;
  ordem: number;
  slugProtegido: boolean;
  assinantesAtivos: number;
  emTeste: number;
}

interface ModuloCatalogo {
  id: string;
  nome: string;
  descricao: string;
  precoMensalCentavos: number;
}

/**
 * Catálogo de módulos — preço mensal da venda avulsa, editável inline.
 * Também é a referência da "soma da cesta" mostrada na edição de planos.
 */
function CatalogoModulos({
  catalogo,
  onSaved,
}: {
  catalogo: ModuloCatalogo[];
  onSaved: () => void;
}) {
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [valor, setValor] = useState("");

  const salvarMut = (trpc as any).admin.salvarPrecoModulo.useMutation({
    onSuccess: () => {
      toast.success("Preço atualizado");
      setEditandoId(null);
      onSaved();
    },
    onError: (err: any) => toast.error("Erro ao salvar preço", { description: err.message }),
  });

  const salvar = (modulo: string) => {
    const centavos = Math.round(parseFloat(valor.replace(/\./g, "").replace(",", ".")) * 100);
    if (isNaN(centavos) || centavos < 0) { toast.error("Preço inválido"); return; }
    salvarMut.mutate({ modulo, precoMensalCentavos: centavos });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Catálogo de módulos — valores mensais</CardTitle>
        <CardDescription className="text-xs">
          Preço da venda avulsa de cada módulo. Vale como referência pra montar pacotes;
          o pacote tem preço próprio (desconto de combo). R$ 0,00 = a definir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {catalogo.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 py-1 border-b border-dashed last:border-0 sm:[&:nth-last-child(-n+2)]:border-0 lg:[&:nth-last-child(-n+3)]:border-0">
              <span className="text-sm truncate" title={m.descricao}>{m.nome}</span>
              {editandoId === m.id ? (
                <span className="flex items-center gap-1 shrink-0">
                  <Input
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    inputMode="decimal"
                    className="h-7 w-24 text-right text-xs"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") salvar(m.id); if (e.key === "Escape") setEditandoId(null); }}
                  />
                  <Button size="sm" className="h-7 text-xs px-2" disabled={salvarMut.isPending} onClick={() => salvar(m.id)}>
                    {salvarMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-sm tabular-nums shrink-0 hover:text-violet-600 dark:hover:text-violet-400 group"
                  onClick={() => {
                    setEditandoId(m.id);
                    setValor(m.precoMensalCentavos > 0 ? (m.precoMensalCentavos / 100).toFixed(2).replace(".", ",") : "");
                  }}
                >
                  <span className={m.precoMensalCentavos === 0 ? "text-muted-foreground italic" : "font-medium"}>
                    {m.precoMensalCentavos === 0 ? "a definir" : `${formatBRL(m.precoMensalCentavos)}/mês`}
                  </span>
                  <Edit className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CriarPlanoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [precoMensalReais, setPrecoMensalReais] = useState("");
  const [, setLocation] = useLocation();

  const criarMut = (trpc as any).admin.criarPlano.useMutation({
    onSuccess: (res: any) => {
      toast.success(res.mensagem || "Plano criado");
      setNome(""); setDescricao(""); setPrecoMensalReais("");
      onOpenChange(false);
      // Nasce oculto até o admin terminar de montar — segue direto pro editor.
      if (res.slug) setLocation(`/admin/planos/${res.slug}`);
    },
    onError: (err: any) => toast.error("Erro ao criar plano", { description: err.message }),
  });

  const handleSave = () => {
    if (!nome.trim()) { toast.error("Informe o nome"); return; }
    const mensal = Math.round(parseFloat(precoMensalReais.replace(",", ".")) * 100);
    if (isNaN(mensal) || mensal < 0) { toast.error("Preço mensal inválido"); return; }
    criarMut.mutate({
      nome: nome.trim(),
      descricao: descricao.trim() || undefined,
      precoMensalCentavos: mensal,
      oculto: true,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Criar plano</DialogTitle>
          <DialogDescription>
            Só o essencial agora — na sequência abre o editor completo, com o plano
            ainda fora da vitrine.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nome *</Label>
            <Input placeholder="Ex: Enterprise" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} maxLength={255}
              placeholder="Para grandes escritórios" />
          </div>
          <div className="space-y-1.5">
            <Label>Preço mensal (R$) *</Label>
            <Input value={precoMensalReais} onChange={(e) => setPrecoMensalReais(e.target.value)}
              inputMode="decimal" placeholder="999,00" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={criarMut.isPending || !nome.trim() || !precoMensalReais}>
            {criarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Criar e abrir editor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function descreverAssinantes(p: PlanoEditavel): string {
  const partes: string[] = [];
  if (p.assinantesAtivos > 0) partes.push(`${p.assinantesAtivos} ${p.assinantesAtivos === 1 ? "escritório assina" : "escritórios assinam"}`);
  if (p.emTeste > 0) partes.push(`${p.emTeste} em teste grátis`);
  return partes.length > 0 ? partes.join(" · ") : "sem assinantes";
}

function resumoDoPlano(p: PlanoEditavel): string {
  const partes: string[] = [p.slug];
  if (p.maxMonitoramentosProcessos != null && p.maxMonitoramentosProcessos > 0) {
    partes.push(`vigia ${p.maxMonitoramentosProcessos} processos`);
  }
  if (p.maxMonitoramentosCpf != null && p.maxMonitoramentosCpf > 0) {
    partes.push(`${p.maxMonitoramentosCpf} CPFs`);
  }
  partes.push(`${p.maxUsuarios >= 999999 ? "∞" : p.maxUsuarios} usuários`);
  if (!p.precoSobConsulta) partes.push(`${formatBRL(p.precoMensalCentavos)}/mês`);
  return partes.join(" · ");
}

function LinhaPlano({
  plano,
  arrastavel,
  onToggleVitrine,
  onDuplicar,
  mutando,
  dragHandlers,
}: {
  plano: PlanoEditavel;
  arrastavel: boolean;
  onToggleVitrine: (p: PlanoEditavel, naVitrine: boolean) => void;
  onDuplicar: (p: PlanoEditavel) => void;
  mutando: boolean;
  dragHandlers?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const [, setLocation] = useLocation();
  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-4 py-3 border-t first:border-t-0 ${plano.oculto ? "opacity-70" : ""}`}
      {...(arrastavel ? dragHandlers : {})}
    >
      {arrastavel ? (
        <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab shrink-0" />
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{plano.nome}</span>
          {plano.precoSobConsulta && (
            <Badge variant="outline" className="text-[10px] font-bold border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
              SOB CONSULTA
            </Badge>
          )}
          {plano.popular && (
            <Badge variant="outline" className="text-[10px] font-bold border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <Star className="h-2.5 w-2.5 mr-0.5" /> MAIS POPULAR
            </Badge>
          )}
          {plano.ctaDemonstracao && (
            <Badge variant="outline" className="text-[10px] font-bold border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300">
              DEMONSTRAÇÃO
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{resumoDoPlano(plano)}</p>
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{descreverAssinantes(plano)}</span>
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground whitespace-nowrap cursor-pointer">
        <Switch
          checked={!plano.oculto}
          disabled={mutando}
          onCheckedChange={(v) => onToggleVitrine(plano, v)}
        />
        {plano.oculto ? "escondido" : "na vitrine"}
      </label>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={mutando}
          onClick={() => onDuplicar(plano)}>
          <Copy className="h-3 w-3 mr-1" /> Duplicar
        </Button>
        <Button size="sm" variant="outline"
          className="h-8 text-xs border-violet-300 text-violet-700 hover:text-violet-800 dark:border-violet-800 dark:text-violet-300"
          onClick={() => setLocation(`/admin/planos/${plano.slug}`)}>
          Editar
        </Button>
      </div>
    </div>
  );
}

export function PlanosSection() {
  const { data: planos, isLoading, refetch } = (trpc as any).admin.listarPlanosEditaveis.useQuery();
  const { data: catalogo, refetch: refetchCatalogo } = (trpc as any).admin.listarCatalogoModulos.useQuery();
  const [criarOpen, setCriarOpen] = useState(false);
  const [arrastandoSlug, setArrastandoSlug] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const editarMut = (trpc as any).admin.editarPlano.useMutation({
    onSuccess: () => refetch(),
    onError: (err: any) => toast.error("Erro ao salvar", { description: err.message }),
  });
  const duplicarMut = (trpc as any).admin.duplicarPlano.useMutation({
    onSuccess: (res: any) => {
      toast.success("Cópia criada fora da vitrine — ajuste e ligue quando quiser");
      refetch();
      if (res.slug) setLocation(`/admin/planos/${res.slug}`);
    },
    onError: (err: any) => toast.error("Erro ao duplicar", { description: err.message }),
  });
  const reordenarMut = (trpc as any).admin.reordenarPlanos.useMutation({
    onSuccess: () => refetch(),
    onError: (err: any) => {
      toast.error("Erro ao reordenar", { description: err.message });
      refetch();
    },
  });

  const lista: PlanoEditavel[] = planos ?? [];
  const naVitrine = lista.filter((p) => !p.oculto);
  const foraDaVitrine = lista.filter((p) => p.oculto);
  const mutando = editarMut.isPending || duplicarMut.isPending || reordenarMut.isPending;

  const toggleVitrine = (p: PlanoEditavel, ligar: boolean) => {
    editarMut.mutate(
      { slug: p.slug, oculto: !ligar },
      {
        onSuccess: () =>
          toast.success(
            ligar ? `"${p.nome}" entrou na vitrine` : `"${p.nome}" saiu da vitrine — assinantes atuais não mudam`,
          ),
      },
    );
  };

  const soltarSobre = (alvoSlug: string) => {
    if (!arrastandoSlug || arrastandoSlug === alvoSlug) return;
    const slugs = naVitrine.map((p) => p.slug);
    const de = slugs.indexOf(arrastandoSlug);
    const para = slugs.indexOf(alvoSlug);
    if (de < 0 || para < 0) return;
    slugs.splice(de, 1);
    slugs.splice(para, 0, arrastandoSlug);
    reordenarMut.mutate({ slugs });
  };

  return (
    <div className="space-y-6">
      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : lista.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nenhum plano cadastrado. Rode a migration 0108 ou crie o primeiro plano.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2 flex flex-row flex-wrap items-center gap-3 space-y-0">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  Na vitrine do site
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  {naVitrine.length} {naVitrine.length === 1 ? "plano" : "planos"} · arraste pra mudar a ordem na página de preços
                </CardDescription>
              </div>
              <Button className="ml-auto" size="sm" onClick={() => setCriarOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Criar plano
              </Button>
            </CardHeader>
            <CardContent className="p-0 pb-1">
              {naVitrine.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">
                  Nenhum plano visível no site — a página de preços está vazia.
                </p>
              ) : (
                naVitrine.map((p) => (
                  <LinhaPlano
                    key={p.slug}
                    plano={p}
                    arrastavel
                    mutando={mutando}
                    onToggleVitrine={toggleVitrine}
                    onDuplicar={(pl) => duplicarMut.mutate({ slug: pl.slug })}
                    dragHandlers={{
                      draggable: true,
                      onDragStart: () => setArrastandoSlug(p.slug),
                      onDragEnd: () => setArrastandoSlug(null),
                      onDragOver: (e: React.DragEvent) => e.preventDefault(),
                      onDrop: () => soltarSobre(p.slug),
                    } as React.HTMLAttributes<HTMLDivElement>}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-muted-foreground">Fora da vitrine</CardTitle>
              <CardDescription className="text-xs">
                {foraDaVitrine.length} {foraDaVitrine.length === 1 ? "plano" : "planos"} · quem já assina continua igual
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 pb-1">
              {foraDaVitrine.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">Nenhum plano escondido.</p>
              ) : (
                foraDaVitrine.map((p) => (
                  <LinhaPlano
                    key={p.slug}
                    plano={p}
                    arrastavel={false}
                    mutando={mutando}
                    onToggleVitrine={toggleVitrine}
                    onDuplicar={(pl) => duplicarMut.mutate({ slug: pl.slug })}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}

      <CatalogoModulos catalogo={catalogo ?? []} onSaved={refetchCatalogo} />

      <CriarPlanoDialog open={criarOpen} onOpenChange={setCriarOpen} />
    </div>
  );
}
