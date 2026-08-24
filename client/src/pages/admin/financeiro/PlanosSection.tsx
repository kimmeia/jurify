import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Edit, EyeOff, Loader2, Star, Plus, X, Check, Trash2, Package } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

function formatBRL(centavos: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

function exibirLimite(valor: number | null | undefined, ilimitadoSeNull = false): string {
  if (valor == null) return ilimitadoSeNull ? "∞" : "0";
  if (valor >= 999999) return "∞";
  return String(valor);
}

interface PlanoEditavel {
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
  creditosCalculosMes: number;
  jurisiaMensagensMes: number;
  atendentesInclusos: number | null;
  precoAtendenteAdicionalCentavos: number;
  modulosLiberados: string[];
  features: string[];
  popular: boolean;
  oculto: boolean;
  ordem: number;
  slugProtegido: boolean;
}

interface ModuloApp {
  id: string;
  nome: string;
  descricao: string;
  obrigatorio: boolean;
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

function EditarPlanoDialog({
  plano,
  modulosApp,
  catalogo,
  open,
  onOpenChange,
  onSaved,
}: {
  plano: PlanoEditavel | null;
  modulosApp: ModuloApp[];
  catalogo: ModuloCatalogo[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [publicoAlvo, setPublicoAlvo] = useState("");
  const [precoMensalReais, setPrecoMensalReais] = useState("");
  const [precoAnualReais, setPrecoAnualReais] = useState("");
  const [trialDias, setTrialDias] = useState("0");
  const [maxUsuarios, setMaxUsuarios] = useState("1");
  const [maxArmazenamentoMb, setMaxArmazenamentoMb] = useState("100");
  const [maxClientes, setMaxClientes] = useState<string>("");
  const [maxConexoesWhatsapp, setMaxConexoesWhatsapp] = useState("0");
  const [maxAgentesIa, setMaxAgentesIa] = useState("0");
  const [maxMonitoramentos, setMaxMonitoramentos] = useState<string>("");
  const [creditosCalculos, setCreditosCalculos] = useState("0");
  const [jurisiaMensagens, setJurisiaMensagens] = useState("0");
  const [atendentesInclusos, setAtendentesInclusos] = useState<string>("");
  const [precoAtendenteAdicional, setPrecoAtendenteAdicional] = useState<string>("");
  const [modulosLiberados, setModulosLiberados] = useState<string[]>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [novaFeature, setNovaFeature] = useState("");
  const [popular, setPopular] = useState(false);
  const [oculto, setOculto] = useState(false);
  const [ordem, setOrdem] = useState("0");

  useEffect(() => {
    if (plano && open) {
      setNome(plano.nome);
      setDescricao(plano.descricao ?? "");
      setPublicoAlvo(plano.publicoAlvo ?? "");
      setPrecoMensalReais((plano.precoMensalCentavos / 100).toFixed(2).replace(".", ","));
      setPrecoAnualReais(plano.precoAnualCentavos != null
        ? (plano.precoAnualCentavos / 100).toFixed(2).replace(".", ",")
        : "");
      setTrialDias(String(plano.trialDias));
      setMaxUsuarios(String(plano.maxUsuarios));
      setMaxArmazenamentoMb(String(plano.maxArmazenamentoMb));
      setMaxClientes(plano.maxClientes != null ? String(plano.maxClientes) : "");
      setMaxConexoesWhatsapp(String(plano.maxConexoesWhatsapp));
      setMaxAgentesIa(String(plano.maxAgentesIa));
      setMaxMonitoramentos(plano.maxMonitoramentosProcessos != null ? String(plano.maxMonitoramentosProcessos) : "");
      setCreditosCalculos(String(plano.creditosCalculosMes));
      setJurisiaMensagens(String(plano.jurisiaMensagensMes ?? 0));
      setAtendentesInclusos(plano.atendentesInclusos != null ? String(plano.atendentesInclusos) : "");
      setPrecoAtendenteAdicional(
        plano.precoAtendenteAdicionalCentavos > 0
          ? (plano.precoAtendenteAdicionalCentavos / 100).toFixed(2).replace(".", ",")
          : "",
      );
      setModulosLiberados([...plano.modulosLiberados]);
      setFeatures([...plano.features]);
      setPopular(plano.popular);
      setOculto(plano.oculto);
      setOrdem(String(plano.ordem));
    }
  }, [plano, open]);

  const editarMut = (trpc as any).admin.editarPlano.useMutation({
    onSuccess: () => {
      toast.success("Plano atualizado");
      onSaved();
      onOpenChange(false);
    },
    onError: (err: any) => toast.error("Erro ao salvar", { description: err.message }),
  });

  const handleSave = () => {
    if (!plano) return;
    const mensal = Math.round(parseFloat(precoMensalReais.replace(",", ".")) * 100);
    if (isNaN(mensal) || mensal < 0) {
      toast.error("Preço mensal inválido");
      return;
    }
    const anual = precoAnualReais.trim()
      ? Math.round(parseFloat(precoAnualReais.replace(",", ".")) * 100)
      : null;
    const adicionalCentavos = precoAtendenteAdicional.trim()
      ? Math.round(parseFloat(precoAtendenteAdicional.replace(",", ".")) * 100)
      : 0;
    if (isNaN(adicionalCentavos) || adicionalCentavos < 0) {
      toast.error("Preço do atendente adicional inválido");
      return;
    }
    editarMut.mutate({
      slug: plano.slug,
      nome,
      descricao: descricao.trim() || null,
      publicoAlvo: publicoAlvo.trim() || null,
      precoMensalCentavos: mensal,
      precoAnualCentavos: anual,
      trialDias: parseInt(trialDias, 10) || 0,
      maxUsuarios: parseInt(maxUsuarios, 10) || 1,
      maxArmazenamentoMb: parseInt(maxArmazenamentoMb, 10) || 0,
      maxClientes: maxClientes.trim() ? parseInt(maxClientes, 10) : null,
      maxConexoesWhatsapp: parseInt(maxConexoesWhatsapp, 10) || 0,
      maxAgentesIa: parseInt(maxAgentesIa, 10) || 0,
      maxMonitoramentosProcessos: maxMonitoramentos.trim() ? parseInt(maxMonitoramentos, 10) : null,
      creditosCalculosMes: parseInt(creditosCalculos, 10) || 0,
      jurisiaMensagensMes: parseInt(jurisiaMensagens, 10) || 0,
      atendentesInclusos: atendentesInclusos.trim() ? parseInt(atendentesInclusos, 10) : null,
      precoAtendenteAdicionalCentavos: adicionalCentavos,
      modulosLiberados,
      features,
      popular,
      oculto,
      ordem: parseInt(ordem, 10) || 0,
    });
  };

  if (!plano) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar plano: {plano.nome}</DialogTitle>
          <DialogDescription>
            Slug: <code className="text-xs">{plano.slug}</code>
            {plano.slugProtegido && " (protegido — não pode ser deletado)"}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="geral" className="mt-2">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="geral">Geral</TabsTrigger>
            <TabsTrigger value="limites">Limites</TabsTrigger>
            <TabsTrigger value="modulos">Módulos</TabsTrigger>
            <TabsTrigger value="features">Features (LP)</TabsTrigger>
          </TabsList>

          <TabsContent value="geral" className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição curta</Label>
              <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={255}
                placeholder="Para advogado autônomo ou dupla" />
            </div>
            <div className="space-y-1.5">
              <Label>Público alvo (subtitle do card)</Label>
              <Input value={publicoAlvo} onChange={(e) => setPublicoAlvo(e.target.value)} maxLength={255}
                placeholder="Advogado autônomo ou dupla" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Preço mensal (R$)</Label>
                <Input value={precoMensalReais} onChange={(e) => setPrecoMensalReais(e.target.value)}
                  inputMode="decimal" placeholder="97,00" />
              </div>
              <div className="space-y-1.5">
                <Label>Preço anual (R$) — opcional</Label>
                <Input value={precoAnualReais} onChange={(e) => setPrecoAnualReais(e.target.value)}
                  inputMode="decimal" placeholder="970,00" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Trial (dias sem cartão)</Label>
                <Input value={trialDias} onChange={(e) => setTrialDias(e.target.value)}
                  type="number" min={0} max={90} placeholder="14" />
                <p className="text-[10px] text-muted-foreground">0 = sem trial</p>
              </div>
              <div className="space-y-1.5">
                <Label>Ordem na LP</Label>
                <Input value={ordem} onChange={(e) => setOrdem(e.target.value)} type="number" min={0} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Atendentes inclusos</Label>
                <Input value={atendentesInclusos} onChange={(e) => setAtendentesInclusos(e.target.value)}
                  type="number" min={0} placeholder="vazio = sem cobrança por assento" />
                <p className="text-[10px] text-muted-foreground">
                  Colaboradores ativos contam. Vazio = não cobra por assento (planos atuais).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Atendente adicional (R$/mês)</Label>
                <Input value={precoAtendenteAdicional} onChange={(e) => setPrecoAtendenteAdicional(e.target.value)}
                  inputMode="decimal" placeholder="25,00" />
                <p className="text-[10px] text-muted-foreground">Cobrado por atendente além dos inclusos.</p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Popular</Label>
                <p className="text-xs text-muted-foreground">Badge "Mais Popular" no card</p>
              </div>
              <Switch checked={popular} onCheckedChange={setPopular} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Oculto na LP</Label>
                <p className="text-xs text-muted-foreground">
                  Some da landing e do /plans. Assinantes existentes seguem normalmente.
                </p>
              </div>
              <Switch checked={oculto} onCheckedChange={setOculto} />
            </div>
          </TabsContent>

          <TabsContent value="limites" className="space-y-3 mt-4">
            <p className="text-xs text-muted-foreground">
              Deixe vazio onde quiser "ilimitado" (clientes, monitoramentos). Use 999999 nos demais
              campos pra também tratar como ilimitado.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Usuários máximos</Label>
                <Input value={maxUsuarios} onChange={(e) => setMaxUsuarios(e.target.value)} type="number" min={1} />
              </div>
              <div className="space-y-1.5">
                <Label>Armazenamento (MB)</Label>
                <Input value={maxArmazenamentoMb} onChange={(e) => setMaxArmazenamentoMb(e.target.value)} type="number" min={0} />
              </div>
              <div className="space-y-1.5">
                <Label>Clientes ativos</Label>
                <Input value={maxClientes} onChange={(e) => setMaxClientes(e.target.value)}
                  type="number" min={0} placeholder="vazio = ilimitado" />
              </div>
              <div className="space-y-1.5">
                <Label>Conexões WhatsApp</Label>
                <Input value={maxConexoesWhatsapp} onChange={(e) => setMaxConexoesWhatsapp(e.target.value)} type="number" min={0} />
              </div>
              <div className="space-y-1.5">
                <Label>Agentes IA</Label>
                <Input value={maxAgentesIa} onChange={(e) => setMaxAgentesIa(e.target.value)} type="number" min={0} />
              </div>
              <div className="space-y-1.5">
                <Label>Monitoramentos processos</Label>
                <Input value={maxMonitoramentos} onChange={(e) => setMaxMonitoramentos(e.target.value)}
                  type="number" min={0} placeholder="vazio = ilimitado" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Créditos cálculos / mês</Label>
                <Input value={creditosCalculos} onChange={(e) => setCreditosCalculos(e.target.value)} type="number" min={0} />
              </div>
              <div>
                <Label>Mensagens JurisIA / mês</Label>
                <Input value={jurisiaMensagens} onChange={(e) => setJurisiaMensagens(e.target.value)} type="number" min={0} />
                <p className="text-[10px] text-muted-foreground mt-1">0 desliga o módulo neste plano.</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="modulos" className="space-y-2 mt-4">
            <p className="text-xs text-muted-foreground">
              Marque os módulos liberados nesse plano. Módulos obrigatórios são sempre liberados.
            </p>
            {(() => {
              const somaCesta = catalogo
                .filter((c) => modulosLiberados.includes(c.id))
                .reduce((s, c) => s + c.precoMensalCentavos, 0);
              const precoPacote = Math.round(parseFloat(precoMensalReais.replace(",", ".")) * 100);
              return somaCesta > 0 ? (
                <div className="rounded-lg border bg-muted/40 p-3 text-xs flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Soma avulsa dos módulos da cesta: <strong className="text-foreground">{formatBRL(somaCesta)}/mês</strong>
                  </span>
                  {!isNaN(precoPacote) && precoPacote > 0 && precoPacote < somaCesta && (
                    <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                      pacote a {formatBRL(precoPacote)} = {Math.round((1 - precoPacote / somaCesta) * 100)}% de combo
                    </span>
                  )}
                </div>
              ) : null;
            })()}
            {modulosApp.map((mod) => {
              const liberado = mod.obrigatorio || modulosLiberados.includes(mod.id);
              return (
                <div key={mod.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">{mod.nome}</Label>
                    <p className="text-xs text-muted-foreground">{mod.descricao}</p>
                    {mod.obrigatorio && (
                      <Badge variant="outline" className="mt-1 text-[10px]">Obrigatório</Badge>
                    )}
                  </div>
                  <Switch
                    checked={liberado}
                    disabled={mod.obrigatorio}
                    onCheckedChange={(v) => {
                      if (v) setModulosLiberados([...modulosLiberados.filter((x) => x !== mod.id), mod.id]);
                      else setModulosLiberados(modulosLiberados.filter((x) => x !== mod.id));
                    }}
                  />
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="features" className="space-y-2 mt-4">
            <p className="text-xs text-muted-foreground">
              Bullets que aparecem no card da landing page. Cada linha é uma feature visível.
            </p>
            {features.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="flex-1 text-sm truncate">{f}</span>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                  onClick={() => setFeatures(features.filter((_, idx) => idx !== i))}>
                  <X className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input value={novaFeature} onChange={(e) => setNovaFeature(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && novaFeature.trim()) {
                    setFeatures([...features, novaFeature.trim()]);
                    setNovaFeature("");
                  }
                }}
                placeholder="Ex: Até 5 colaboradores" className="text-sm" />
              <Button size="sm" variant="outline" onClick={() => {
                if (novaFeature.trim()) {
                  setFeatures([...features, novaFeature.trim()]);
                  setNovaFeature("");
                }
              }}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={editarMut.isPending}>
            {editarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CriarPlanoDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [precoMensalReais, setPrecoMensalReais] = useState("");

  const criarMut = (trpc as any).admin.criarPlano.useMutation({
    onSuccess: (res: any) => {
      toast.success(res.mensagem || "Plano criado");
      setNome(""); setDescricao(""); setPrecoMensalReais("");
      onCreated();
      onOpenChange(false);
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
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Criar plano</DialogTitle>
          <DialogDescription>
            Define só o essencial agora. Limites, módulos e features você ajusta depois clicando "Editar".
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
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlanosSection() {
  const { data: planos, isLoading, refetch } = (trpc as any).admin.listarPlanosEditaveis.useQuery();
  const { data: modulosApp } = (trpc as any).admin.listarModulosApp.useQuery();
  const { data: catalogo, refetch: refetchCatalogo } = (trpc as any).admin.listarCatalogoModulos.useQuery();
  const [editando, setEditando] = useState<PlanoEditavel | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [criarOpen, setCriarOpen] = useState(false);

  const deletarMut = (trpc as any).admin.deletarPlano.useMutation({
    onSuccess: () => {
      toast.success("Plano deletado");
      refetch();
    },
    onError: (err: any) => toast.error("Erro ao deletar", { description: err.message }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Edite preços, módulos liberados, limites e textos da landing page. Mudanças refletem instantaneamente.
        </p>
        <Button onClick={() => setCriarOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Criar plano
        </Button>
      </div>

      <CatalogoModulos catalogo={catalogo ?? []} onSaved={refetchCatalogo} />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-80 rounded-xl" />)}
        </div>
      ) : !planos || planos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nenhum plano cadastrado. Rode a migration 0108 ou crie o primeiro plano.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {planos.map((plano: PlanoEditavel) => (
            <Card
              key={plano.slug}
              className={`relative ${plano.popular ? "border-violet-500/50 shadow-md" : ""} ${plano.oculto ? "opacity-60" : ""}`}
            >
              {plano.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-violet-600 hover:bg-violet-600 text-white shadow-sm">
                    <Star className="h-3 w-3 mr-1" /> Popular
                  </Badge>
                </div>
              )}
              {plano.oculto && (
                <div className="absolute top-3 right-3">
                  <Badge variant="outline" className="text-[10px]">
                    <EyeOff className="h-2.5 w-2.5 mr-1" /> Oculto
                  </Badge>
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-lg">{plano.nome}</CardTitle>
                <CardDescription className="text-xs">{plano.descricao}</CardDescription>
                <code className="text-[10px] text-muted-foreground">{plano.slug}</code>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-2xl font-bold">
                    {formatBRL(plano.precoMensalCentavos)}
                    <span className="text-xs text-muted-foreground font-normal">/mês</span>
                  </p>
                  {plano.precoAnualCentavos != null && (
                    <p className="text-sm text-muted-foreground">{formatBRL(plano.precoAnualCentavos)}/ano</p>
                  )}
                  {plano.trialDias > 0 && (
                    <Badge variant="secondary" className="mt-1 text-[10px]">
                      {plano.trialDias} dias grátis
                    </Badge>
                  )}
                </div>

                <div className="text-xs space-y-1 border-t pt-3 text-muted-foreground">
                  <p>👥 <strong className="text-foreground">{exibirLimite(plano.maxUsuarios)}</strong> usuários</p>
                  <p>💾 <strong className="text-foreground">{exibirLimite(plano.maxArmazenamentoMb)} MB</strong></p>
                  <p>📒 <strong className="text-foreground">{exibirLimite(plano.maxClientes, true)}</strong> clientes</p>
                  <p>🧩 <strong className="text-foreground">{plano.modulosLiberados.length}</strong> módulos</p>
                  {plano.atendentesInclusos != null && (
                    <p>🎧 <strong className="text-foreground">{plano.atendentesInclusos}</strong> atendentes
                      {plano.precoAtendenteAdicionalCentavos > 0 && (
                        <span> · +{formatBRL(plano.precoAtendenteAdicionalCentavos)}/extra</span>
                      )}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    size="sm" variant="outline" className="flex-1 text-xs"
                    onClick={() => { setEditando(plano); setEditOpen(true); }}
                  >
                    <Edit className="h-3 w-3 mr-1" /> Editar
                  </Button>
                  {!plano.slugProtegido && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-xs text-destructive hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Deletar plano "{plano.nome}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação não pode ser desfeita. Não funciona se houver assinantes ativos.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => deletarMut.mutate({ slug: plano.slug })}
                          >
                            Deletar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditarPlanoDialog
        plano={editando}
        modulosApp={modulosApp ?? []}
        catalogo={catalogo ?? []}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={refetch}
      />

      <CriarPlanoDialog
        open={criarOpen}
        onOpenChange={setCriarOpen}
        onCreated={refetch}
      />
    </div>
  );
}
