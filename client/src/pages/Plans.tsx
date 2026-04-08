import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Loader2, ArrowRight, XCircle, AlertCircle, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

/** Máscara CPF/CNPJ — alterna conforme o usuário digita */
function maskCpfCnpj(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) {
    // CPF: 000.000.000-00
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  // CNPJ: 00.000.000/0000-00
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function isValidCpfCnpj(value: string): boolean {
  const d = value.replace(/\D/g, "");
  return d.length === 11 || d.length === 14;
}

export default function Plans() {
  const { user } = useAuth();
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Modal CPF/CNPJ — exibido na primeira assinatura (quando ainda não tem customer Asaas)
  const [cpfModalOpen, setCpfModalOpen] = useState(false);
  const [cpfInput, setCpfInput] = useState("");
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);

  // Estado "aguardando pagamento": mostrado após o usuário clicar em
  // assinar e ser redirecionado pro Asaas. Faz polling da subscription
  // atual pra detectar quando ficar ativa.
  const [awaitingPayment, setAwaitingPayment] = useState(false);

  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();

  const { data: plans, isLoading } = trpc.subscription.plans.useQuery();
  const { data: currentSub } = trpc.subscription.current.useQuery(undefined, {
    enabled: !!user,
    retry: false,
    // Polling a cada 3s quando awaiting — pro redirect rápido
    // quando o webhook ativa a subscription.
    refetchInterval: awaitingPayment ? 3000 : false,
  });
  const { data: billingOk } = trpc.subscription.billingConfigured.useQuery();

  // Detecta ativação: se estávamos aguardando E agora tem sub ativa,
  // para o polling, mostra sucesso e redireciona pro dashboard.
  useEffect(() => {
    if (awaitingPayment && currentSub && currentSub.status === "active") {
      setAwaitingPayment(false);
      toast.success("Pagamento confirmado! Bem-vindo ao Jurify 🎉", {
        duration: 5000,
      });
      // Delay curto pra o usuário ver o toast
      setTimeout(() => {
        setLocation("/dashboard");
      }, 1500);
    }
  }, [awaitingPayment, currentSub, setLocation]);

  const createCheckout = trpc.subscription.createCheckout.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("Abrindo página de pagamento do Asaas...");
        window.open(data.url, "_blank");
        setAwaitingPayment(true); // inicia polling
      } else {
        toast.warning(
          "Assinatura criada, mas link de pagamento não disponível ainda. Verifique seu e-mail.",
        );
      }
      setLoadingPlan(null);
      setCpfModalOpen(false);
      setCpfInput("");
      setPendingPlanId(null);
    },
    onError: (error) => {
      toast.error("Erro ao criar assinatura: " + error.message);
      setLoadingPlan(null);
    },
  });

  const changePlan = trpc.subscription.changePlan.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("Abrindo checkout pra troca de plano...");
        window.open(data.url, "_blank");
        setAwaitingPayment(true);
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
      toast.success("Assinatura cancelada.");
      setCancelLoading(false);
      utils.subscription.current.invalidate();
    },
    onError: (error) => {
      toast.error("Erro ao cancelar: " + error.message);
      setCancelLoading(false);
    },
  });

  const handleSelectPlan = (planId: string) => {
    if (!user) {
      toast.error("Faça login para assinar um plano.");
      return;
    }
    if (!billingOk) {
      toast.error("Sistema de cobrança indisponível. Contate o suporte.");
      return;
    }

    // Se já tem subscription ativa → trocar plano (não pede CPF de novo)
    if (currentSub && currentSub.asaasCustomerId) {
      setLoadingPlan(planId);
      changePlan.mutate({ newPlanId: planId, interval: billingInterval });
      return;
    }

    // Primeira assinatura → abrir modal pra pedir CPF/CNPJ
    setPendingPlanId(planId);
    setCpfModalOpen(true);
  };

  const handleConfirmCheckout = () => {
    if (!pendingPlanId) return;
    if (!isValidCpfCnpj(cpfInput)) {
      toast.error("CPF ou CNPJ inválido.");
      return;
    }
    setLoadingPlan(pendingPlanId);
    createCheckout.mutate({
      planId: pendingPlanId,
      interval: billingInterval,
      cpfCnpj: cpfInput.replace(/\D/g, ""),
    });
  };

  const handleCancel = () => {
    if (
      !confirm(
        "Tem certeza que deseja cancelar sua assinatura? O cancelamento é definitivo — para voltar você precisará criar uma nova assinatura.",
      )
    )
      return;
    setCancelLoading(true);
    cancelSub.mutate();
  };

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(cents / 100);
  };

  const currentPlanId = currentSub?.planId;
  const subscriptionPlans = plans ?? [];

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
            ? "Gerencie sua assinatura ou faça upgrade/downgrade do seu plano."
            : "Selecione o plano ideal para o seu escritório jurídico."}
        </p>
      </div>

      {/* Aviso quando o sistema de cobrança não está configurado */}
      {billingOk === false && (
        <Card className="border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-foreground">
                Sistema de cobrança em configuração
              </p>
              <p className="text-sm text-muted-foreground">
                A integração com o Asaas ainda não foi configurada pelo
                administrador. Os botões de assinatura ficarão disponíveis em
                breve.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Estado "aguardando pagamento" — polling ativo */}
      {awaitingPayment && (
        <Card className="border-blue-300/50 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="pt-6 flex items-start gap-3">
            <div className="relative">
              <Clock className="h-5 w-5 text-blue-600 mt-0.5" />
              <Loader2 className="h-3 w-3 text-blue-600 absolute -bottom-0.5 -right-0.5 animate-spin" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground">
                Aguardando confirmação do pagamento
              </p>
              <p className="text-sm text-muted-foreground">
                Complete o pagamento na aba do Asaas que foi aberta. Esta
                página vai atualizar automaticamente quando o pagamento for
                confirmado (pode levar alguns segundos após o pagamento).
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => {
                  utils.subscription.current.invalidate();
                  toast.info("Verificando...");
                }}
              >
                <Loader2 className="h-3 w-3 mr-1.5" />
                Verificar agora
              </Button>
            </div>
            <button
              onClick={() => setAwaitingPayment(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cancelar espera"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </CardContent>
        </Card>
      )}

      {/* Current plan info */}
      {currentSub && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-lg">
                    Plano{" "}
                    {plans?.find((p) => p.id === currentPlanId)?.name ??
                      currentPlanId}
                  </p>
                  <Badge variant="default" className="text-xs">
                    Ativo
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {currentSub.currentPeriodEnd && (
                    <>
                      Próxima cobrança em{" "}
                      {new Date(currentSub.currentPeriodEnd).toLocaleDateString(
                        "pt-BR",
                      )}
                    </>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  disabled={cancelLoading}
                  className="text-destructive hover:text-destructive"
                >
                  {cancelLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <XCircle className="h-4 w-4 mr-1" />
                  )}
                  Cancelar Assinatura
                </Button>
              </div>
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
          <Badge variant="secondary" className="ml-2 text-[10px]">
            2 meses grátis
          </Badge>
        </button>
      </div>

      {/* Plans Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {subscriptionPlans.map((plan) => {
          const price =
            billingInterval === "monthly" ? plan.priceMonthly : plan.priceYearly;
          const isPopular = plan.popular;
          const isCurrentPlan = currentPlanId === plan.id;
          const planIndex = subscriptionPlans.findIndex((p) => p.id === plan.id);
          const currentIndex = subscriptionPlans.findIndex(
            (p) => p.id === currentPlanId,
          );
          const isUpgrade = currentSub && planIndex > currentIndex;
          const isDowngrade = currentSub && planIndex < currentIndex;

          let buttonLabel = "Assinar";
          if (isCurrentPlan) buttonLabel = "Plano Atual";
          else if (isUpgrade) buttonLabel = "Fazer Upgrade";
          else if (isDowngrade) buttonLabel = "Fazer Downgrade";

          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col ${
                isPopular ? "border-primary shadow-lg ring-1 ring-primary/20" : ""
              } ${isCurrentPlan ? "ring-2 ring-primary/40" : ""}`}
            >
              {isPopular && !isCurrentPlan && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="shadow-sm">Mais Popular</Badge>
                </div>
              )}
              {isCurrentPlan && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge variant="default" className="shadow-sm">
                    Seu Plano
                  </Badge>
                </div>
              )}
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="mb-6">
                  <span className="text-4xl font-bold text-foreground">
                    {formatPrice(price)}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    /{billingInterval === "monthly" ? "mês" : "ano"}
                  </span>
                  {billingInterval === "yearly" && (
                    <p className="text-xs text-emerald-600 mt-1">
                      Economia de{" "}
                      {formatPrice(plan.priceMonthly * 12 - plan.priceYearly)}/ano
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
                  variant={
                    isCurrentPlan ? "secondary" : isPopular ? "default" : "outline"
                  }
                  size="lg"
                  disabled={
                    loadingPlan !== null || isCurrentPlan || billingOk === false
                  }
                  onClick={() => handleSelectPlan(plan.id)}
                >
                  {loadingPlan === plan.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...
                    </>
                  ) : (
                    <>
                      {buttonLabel}
                      {!isCurrentPlan && <ArrowRight className="ml-2 h-4 w-4" />}
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div className="text-center text-xs text-muted-foreground mt-8 space-y-1">
        <p>
          Pagamento seguro via <strong>Asaas</strong> — PIX, boleto ou cartão de
          crédito.
        </p>
        <p>O acesso é liberado automaticamente após confirmação do pagamento.</p>
      </div>

      {/* Modal CPF/CNPJ */}
      <Dialog open={cpfModalOpen} onOpenChange={setCpfModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar dados para cobrança</DialogTitle>
            <DialogDescription>
              Para emitir a cobrança no Asaas, precisamos do CPF ou CNPJ do
              titular. Esses dados são usados apenas para a emissão da fatura.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cpfCnpj">CPF ou CNPJ *</Label>
              <Input
                id="cpfCnpj"
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                value={cpfInput}
                onChange={(e) => setCpfInput(maskCpfCnpj(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isValidCpfCnpj(cpfInput))
                    handleConfirmCheckout();
                }}
                inputMode="numeric"
                maxLength={18}
                autoFocus
              />
              {cpfInput && !isValidCpfCnpj(cpfInput) && (
                <p className="text-[11px] text-red-500">
                  CPF (11 dígitos) ou CNPJ (14 dígitos) inválido
                </p>
              )}
            </div>
            {pendingPlanId && (
              <p className="text-xs text-muted-foreground">
                Plano selecionado:{" "}
                <strong>
                  {plans?.find((p) => p.id === pendingPlanId)?.name}
                </strong>
                {" — "}
                {formatPrice(
                  billingInterval === "monthly"
                    ? plans?.find((p) => p.id === pendingPlanId)
                        ?.priceMonthly ?? 0
                    : plans?.find((p) => p.id === pendingPlanId)
                        ?.priceYearly ?? 0,
                )}
                /{billingInterval === "monthly" ? "mês" : "ano"}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setCpfModalOpen(false);
                setCpfInput("");
                setPendingPlanId(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmCheckout}
              disabled={!isValidCpfCnpj(cpfInput) || createCheckout.isPending}
            >
              {createCheckout.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              Continuar para pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
