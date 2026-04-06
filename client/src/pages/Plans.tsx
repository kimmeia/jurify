import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Loader2, Zap, ArrowRight, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Plans() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const utils = trpc.useUtils();

  const { data: plans, isLoading } = trpc.subscription.plans.useQuery();
  const { data: currentSub } = trpc.subscription.current.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });
  const { data: credits } = trpc.dashboard.credits.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });

  const createCheckout = trpc.subscription.createCheckout.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("Redirecionando para o checkout...");
        window.open(data.url, "_blank");
      }
      setLoadingPlan(null);
    },
    onError: (error) => {
      toast.error("Erro ao criar sessão de checkout: " + error.message);
      setLoadingPlan(null);
    },
  });

  const changePlan = trpc.subscription.changePlan.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("Redirecionando para trocar de plano...");
        window.open(data.url, "_blank");
      }
      setLoadingPlan(null);
    },
    onError: (error) => {
      toast.error("Erro ao trocar de plano: " + error.message);
      setLoadingPlan(null);
    },
  });

  const cancelSub = trpc.subscription.cancel.useMutation({
    onSuccess: () => {
      toast.success("Assinatura cancelada. Acesso até o fim do período.");
      setCancelLoading(false);
      utils.subscription.current.invalidate();
      utils.dashboard.credits.invalidate();
    },
    onError: (error) => {
      toast.error("Erro ao cancelar: " + error.message);
      setCancelLoading(false);
    },
  });

  const reactivateSub = trpc.subscription.reactivate.useMutation({
    onSuccess: () => {
      toast.success("Assinatura reativada com sucesso!");
      setReactivateLoading(false);
      utils.subscription.current.invalidate();
      utils.dashboard.credits.invalidate();
    },
    onError: (error) => {
      toast.error("Erro ao reativar: " + error.message);
      setReactivateLoading(false);
    },
  });

  const handleSelectPlan = (planId: string) => {
    if (!user) {
      toast.error("Faça login para assinar um plano.");
      return;
    }
    setLoadingPlan(planId);

    if (currentSub && !plans?.find(p => p.id === planId)?.isOneTime) {
      changePlan.mutate({ newPlanId: planId, interval: billingInterval });
    } else {
      createCheckout.mutate({ planId, interval: billingInterval });
    }
  };

  const handleCancel = () => {
    if (!confirm("Tem certeza que deseja cancelar sua assinatura? Você manterá acesso até o fim do período atual.")) return;
    setCancelLoading(true);
    cancelSub.mutate();
  };

  const handleReactivate = () => {
    setReactivateLoading(true);
    reactivateSub.mutate();
  };

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  };

  const currentPlanId = currentSub?.planId;
  const isCanceling = currentSub?.cancelAtPeriodEnd;
  const subscriptionPlans = plans?.filter(p => !p.isOneTime) ?? [];
  const avulsoPlan = plans?.find(p => p.isOneTime);
  const creditsRemaining = credits?.creditsRemaining ?? 0;
  const creditsTotal = credits?.creditsTotal ?? 0;
  const isUnlimited = creditsTotal >= 999999;

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-4 space-y-8">
        <div className="text-center space-y-2">
          <Skeleton className="h-8 w-64 mx-auto" />
          <Skeleton className="h-4 w-96 mx-auto" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-8">
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {currentSub ? "Gerenciar Plano" : "Escolha seu Plano"}
        </h1>
        <p className="text-muted-foreground max-w-lg mx-auto">
          {currentSub
            ? "Gerencie sua assinatura, troque de plano ou compre créditos avulsos."
            : "Selecione o plano ideal para suas necessidades."}
        </p>
      </div>

      {/* Current plan info */}
      {currentSub && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-lg">
                    Plano {plans?.find(p => p.id === currentPlanId)?.name ?? currentPlanId}
                  </p>
                  {isCanceling ? (
                    <Badge variant="destructive" className="text-xs">Cancelamento Agendado</Badge>
                  ) : (
                    <Badge variant="default" className="text-xs">Ativo</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {isUnlimited
                    ? "Cálculos ilimitados"
                    : `${creditsRemaining} de ${creditsTotal} créditos restantes`}
                  {currentSub.currentPeriodEnd && (
                    <> · Renova em {new Date(currentSub.currentPeriodEnd).toLocaleDateString("pt-BR")}</>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                {isCanceling ? (
                  <Button variant="outline" size="sm" onClick={handleReactivate} disabled={reactivateLoading}>
                    {reactivateLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                    Reativar
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={handleCancel} disabled={cancelLoading} className="text-destructive hover:text-destructive">
                    {cancelLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <XCircle className="h-4 w-4 mr-1" />}
                    Cancelar Assinatura
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trial credits banner */}
      {!currentSub && creditsRemaining > 0 && (
        <Card className="border-emerald-300/50 bg-emerald-50/50 dark:bg-emerald-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-emerald-100 rounded-lg dark:bg-emerald-900/30">
                <Zap className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold">Você tem {creditsRemaining} crédito{creditsRemaining !== 1 ? "s" : ""} para testar</p>
                <p className="text-sm text-muted-foreground">Use o menu lateral para acessar os módulos de cálculo e experimentar a plataforma.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Avulso card */}
      {avulsoPlan && (
        <Card className="border-dashed">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-amber-100 rounded-lg dark:bg-amber-900/30">
                  <Zap className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="font-semibold">{avulsoPlan.name} — {formatPrice(avulsoPlan.priceMonthly)}</p>
                  <p className="text-sm text-muted-foreground">{avulsoPlan.description}</p>
                </div>
              </div>
              <Button variant="outline" disabled={loadingPlan !== null} onClick={() => handleSelectPlan(avulsoPlan.id)}>
                {loadingPlan === avulsoPlan.id ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...</>
                ) : (
                  <>Comprar 1 Crédito <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Billing Toggle */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setBillingInterval("monthly")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            billingInterval === "monthly"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Mensal
        </button>
        <button
          onClick={() => setBillingInterval("yearly")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            billingInterval === "yearly"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Anual
          <Badge variant="secondary" className="ml-2 text-[10px]">-20%</Badge>
        </button>
      </div>

      {/* Plans Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {subscriptionPlans.map((plan) => {
          const price = billingInterval === "monthly" ? plan.priceMonthly : plan.priceYearly;
          const isPopular = plan.popular;
          const isCurrentPlan = currentPlanId === plan.id;
          const planIndex = subscriptionPlans.findIndex(p => p.id === plan.id);
          const currentIndex = subscriptionPlans.findIndex(p => p.id === currentPlanId);
          const isUpgrade = currentSub && planIndex > currentIndex;
          const isDowngrade = currentSub && planIndex < currentIndex;

          let buttonLabel = "Assinar";
          if (isCurrentPlan) buttonLabel = "Plano Atual";
          else if (isUpgrade) buttonLabel = "Fazer Upgrade";
          else if (isDowngrade) buttonLabel = "Fazer Downgrade";

          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col ${isPopular ? "border-primary shadow-lg ring-1 ring-primary/20" : ""} ${isCurrentPlan ? "ring-2 ring-primary/40" : ""}`}
            >
              {isPopular && !isCurrentPlan && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="shadow-sm">Mais Popular</Badge>
                </div>
              )}
              {isCurrentPlan && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge variant="default" className="shadow-sm">Seu Plano</Badge>
                </div>
              )}
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="mb-6">
                  <span className="text-4xl font-bold text-foreground">{formatPrice(price)}</span>
                  <span className="text-muted-foreground text-sm">/{billingInterval === "monthly" ? "mês" : "ano"}</span>
                  {billingInterval === "yearly" && (
                    <p className="text-xs text-emerald-600 mt-1">
                      Economia de {formatPrice(plan.priceMonthly * 12 - plan.priceYearly)}/ano
                    </p>
                  )}
                </div>
                <ul className="space-y-3">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span className="text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={isCurrentPlan ? "secondary" : isPopular ? "default" : "outline"}
                  size="lg"
                  disabled={loadingPlan !== null || isCurrentPlan}
                  onClick={() => handleSelectPlan(plan.id)}
                >
                  {loadingPlan === plan.id ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...</>
                  ) : (
                    buttonLabel
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div className="text-center text-xs text-muted-foreground mt-8">
        <p>
          Ambiente de teste — Use o cartão{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">4242 4242 4242 4242</code>{" "}
          com qualquer data futura e CVC.
        </p>
      </div>
    </div>
  );
}
