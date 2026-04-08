import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Package, Edit, Eye, EyeOff, RotateCcw, Loader2, Star, Plus, X, Check } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

function formatBRL(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

interface PlanoEditavel {
  id: string;
  defaultName: string;
  defaultDescription: string;
  defaultPriceMonthly: number;
  defaultPriceYearly: number;
  defaultFeatures: readonly string[];
  defaultPopular: boolean;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  features: string[];
  popular: boolean;
  oculto: boolean;
  hasOverride: boolean;
  updatedAt?: Date | null;
}

function EditarPlanoDialog({
  plano,
  open,
  onOpenChange,
  onSaved,
}: {
  plano: PlanoEditavel | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceMonthlyBRL, setPriceMonthlyBRL] = useState("");
  const [priceYearlyBRL, setPriceYearlyBRL] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [novaFeature, setNovaFeature] = useState("");
  const [popular, setPopular] = useState(false);
  const [oculto, setOculto] = useState(false);

  useEffect(() => {
    if (plano && open) {
      setName(plano.name);
      setDescription(plano.description);
      setPriceMonthlyBRL((plano.priceMonthly / 100).toFixed(2).replace(".", ","));
      setPriceYearlyBRL((plano.priceYearly / 100).toFixed(2).replace(".", ","));
      setFeatures([...plano.features]);
      setPopular(plano.popular);
      setOculto(plano.oculto);
    }
  }, [plano, open]);

  const editarMut = trpc.admin.editarPlano.useMutation({
    onSuccess: () => {
      toast.success("Plano atualizado");
      onSaved();
      onOpenChange(false);
    },
    onError: (err) => toast.error("Erro ao salvar", { description: err.message }),
  });

  const handleSave = () => {
    if (!plano) return;
    const monthlyCents = Math.round(parseFloat(priceMonthlyBRL.replace(",", ".")) * 100);
    const yearlyCents = Math.round(parseFloat(priceYearlyBRL.replace(",", ".")) * 100);
    if (isNaN(monthlyCents) || isNaN(yearlyCents)) {
      toast.error("Preço inválido");
      return;
    }
    editarMut.mutate({
      planId: plano.id,
      name,
      description,
      priceMonthly: monthlyCents,
      priceYearly: yearlyCents,
      features,
      popular,
      oculto,
    });
  };

  if (!plano) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar plano: {plano.defaultName}</DialogTitle>
          <DialogDescription>
            ID: <code className="text-xs">{plano.id}</code>. Estes valores
            sobrescrevem o hardcoded em <code className="text-xs">products.ts</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>

          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Preço mensal (R$)</Label>
              <Input
                value={priceMonthlyBRL}
                onChange={(e) => setPriceMonthlyBRL(e.target.value)}
                placeholder="99,00"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Preço anual (R$)</Label>
              <Input
                value={priceYearlyBRL}
                onChange={(e) => setPriceYearlyBRL(e.target.value)}
                placeholder="990,00"
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Features</Label>
            <div className="space-y-1.5">
              {features.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span className="flex-1 truncate">{f}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={() => setFeatures(features.filter((_, idx) => idx !== i))}
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  value={novaFeature}
                  onChange={(e) => setNovaFeature(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && novaFeature.trim()) {
                      setFeatures([...features, novaFeature.trim()]);
                      setNovaFeature("");
                    }
                  }}
                  placeholder="Nova feature..."
                  className="text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (novaFeature.trim()) {
                      setFeatures([...features, novaFeature.trim()]);
                      setNovaFeature("");
                    }
                  }}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label>Marcar como popular</Label>
              <p className="text-xs text-muted-foreground">Mostra badge "Mais Popular"</p>
            </div>
            <Switch checked={popular} onCheckedChange={setPopular} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label>Ocultar da página /plans</Label>
              <p className="text-xs text-muted-foreground">
                Esconde o plano do checkout público (assinaturas existentes
                continuam funcionando)
              </p>
            </div>
            <Switch checked={oculto} onCheckedChange={setOculto} />
          </div>
        </div>

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

export default function AdminPlanos() {
  const { data: planos, isLoading, refetch } = trpc.admin.listarPlanosEditaveis.useQuery();
  const [editando, setEditando] = useState<PlanoEditavel | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const resetMut = trpc.admin.resetarOverridePlano.useMutation({
    onSuccess: () => {
      toast.success("Override removido — plano voltou ao default");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/40 dark:to-purple-900/40">
          <Package className="h-6 w-6 text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Planos</h1>
          <p className="text-muted-foreground mt-1">
            Edite preços, features e visibilidade dos planos sem precisar de deploy.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {planos?.map((plan) => (
            <Card
              key={plan.id}
              className={`relative ${plan.popular ? "border-violet-500/50 shadow-md" : ""} ${plan.oculto ? "opacity-60" : ""}`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-violet-600 hover:bg-violet-600 text-white shadow-sm">
                    <Star className="h-3 w-3 mr-1" /> Popular
                  </Badge>
                </div>
              )}
              {plan.oculto && (
                <div className="absolute top-3 right-3">
                  <Badge variant="outline" className="text-[10px]">
                    <EyeOff className="h-2.5 w-2.5 mr-1" /> Oculto
                  </Badge>
                </div>
              )}
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  {plan.hasOverride && (
                    <Badge variant="secondary" className="text-[10px]">Modificado</Badge>
                  )}
                </div>
                <CardDescription className="text-xs">{plan.description}</CardDescription>
                <code className="text-[10px] text-muted-foreground">{plan.id}</code>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-2xl font-bold">{formatBRL(plan.priceMonthly)}<span className="text-xs text-muted-foreground font-normal">/mês</span></p>
                  <p className="text-sm text-muted-foreground">{formatBRL(plan.priceYearly)}/ano</p>
                </div>

                <ul className="space-y-1 text-xs text-muted-foreground border-t pt-3">
                  {plan.features.slice(0, 4).map((f: string, i: number) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Check className="h-3 w-3 text-emerald-600 mt-0.5 shrink-0" />
                      <span className="truncate">{f}</span>
                    </li>
                  ))}
                  {plan.features.length > 4 && (
                    <li className="text-[10px] italic">+ {plan.features.length - 4} mais</li>
                  )}
                </ul>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => {
                      setEditando({
                        ...plan,
                        features: [...plan.features],
                        defaultFeatures: [...plan.defaultFeatures],
                      } as PlanoEditavel);
                      setEditOpen(true);
                    }}
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    Editar
                  </Button>
                  {plan.hasOverride && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-muted-foreground"
                      title="Remove o override e volta ao default do código"
                      onClick={() => {
                        if (confirm(`Resetar plano ${plan.id} ao default do código?`)) {
                          resetMut.mutate({ planId: plan.id });
                        }
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditarPlanoDialog
        plano={editando}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={refetch}
      />
    </div>
  );
}
