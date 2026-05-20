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
import { StatusPlanoBadge } from "@/components/StatusPlanoBadge";
import { resolverStatusVisual } from "@/lib/subscription-status";
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
      toast.success("Pagamento confirmado! Bem-vindo ao JuridFlow 🎉", {
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
      <div className="max-w-6xl mx-auto py-6 px-2 space-y-5">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  const currentPlanName = plans?.find((p) => p.id === currentPlanId)?.name ?? currentPlanId;
  const currentPlanData = plans?.find((p) => p.id === currentPlanId);
  const currentPrice = currentPlanData
    ? (billingInterval === "monthly" ? currentPlanData.priceMonthly : currentPlanData.priceYearly)
    : 0;

  return (
    <div className="max-w-6xl mx-auto py-6 px-2 space-y-5">

      {/* HERO gradient — substitui título plain */}
      {currentSub ? (
        <div className="relative overflow-hidden rounded-2xl p-6 text-white shadow-lg"
             style={{ background: "linear-gradient(135deg,#4f46e5 0%,#7c3aed 45%,#c026d3 100%)" }}>
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-3xl pointer-events-none" />
          <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            {/* Plano atual */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/80 font-semibold mb-1">Plano atual</p>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-2xl font-extrabold tracking-tight">{currentPlanName}</p>
                <StatusPlanoBadge status={resolverStatusVisual(currentSub)} />
              </div>
              {currentPrice > 0 && (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold tabular-nums">{formatPrice(currentPrice)}</span>
                  <span className="text-[10px] text-white/70">/{billingInterval === "monthly" ? "mês" : "ano"}</span>
                </div>
              )}
              <p className="text-[11px] text-white/80 mt-2">
                {currentSub.status === "trialing" && (currentSub as any).diasRestantesTrial != null
                  ? `Trial termina em ${(currentSub as any).diasRestantesTrial} dia${(currentSub as any).diasRestantesTrial === 1 ? "" : "s"}`
                  : currentSub.currentPeriodEnd
                    ? `Próxima cobrança em ${new Date(currentSub.currentPeriodEnd).toLocaleDateString("pt-BR")}`
                    : null}
              </p>
            </div>

            {/* Recursos do plano em destaque */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/80 font-semibold mb-2">Recursos inclusos</p>
              <ul className="space-y-1">
                {(currentPlanData?.features || []).slice(0, 4).map((feature, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[11px] text-white/90">
                    <Check className="h-3 w-3 text-emerald-300 shrink-0" />
                    <span className="truncate">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Ações */}
            <div className="flex flex-col gap-2">
              {currentSub.status !== "trialing" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  disabled={cancelLoading}
                  className="bg-white/12 border border-white/25 text-white hover:bg-white/20 backdrop-blur-sm"
                >
                  {cancelLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <XCircle className="h-4 w-4 mr-1.5" />
                  )}
                  Cancelar assinatura
                </Button>
              )}
              <p className="text-[10px] text-white/65 text-center">
                Pagamento seguro via <b className="text-white">Asaas</b> · PIX · Boleto · Cartão
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center space-y-3 py-6">
          <h1 className="text-3xl font-bold tracking-tight">Escolha seu plano</h1>
          <p className="text-sm text-slate-500 max-w-lg mx-auto">
            Selecione o plano ideal para o seu escritório jurídico.
          </p>
        </div>
      )}

      {/* Aviso quando o sistema de cobrança não está configurado */}
      {billingOk === false && (
        <div className="rounded-xl border-l-[3px] border-l-amber-500 border border-amber-200 bg-amber-50/50 p-3.5 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-900">Sistema de cobrança em configuração</p>
            <p className="text-[11px] text-amber-700 mt-0.5">
              A integração com o Asaas ainda não foi configurada. Os botões de assinatura ficarão disponíveis em breve.
            </p>
          </div>
        </div>
      )}

      {/* Estado "aguardando pagamento" — polling ativo */}
      {awaitingPayment && (
        <div className="rounded-xl border-l-[3px] border-l-blue-500 border border-blue-200 bg-blue-50/50 p-3.5 flex items-start gap-3">
          <div className="relative shrink-0">
            <Clock className="h-5 w-5 text-blue-600 mt-0.5" />
            <Loader2 className="h-3 w-3 text-blue-600 absolute -bottom-0.5 -right-0.5 animate-spin" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-blue-900">Aguardando confirmação do pagamento</p>
            <p className="text-[11px] text-blue-700 mt-0.5">
              Complete o pagamento na aba do Asaas que foi aberta. Esta página vai atualizar automaticamente.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-7 text-[11px] border-blue-300 text-blue-700 hover:bg-blue-100"
              onClick={() => { utils.subscription.current.invalidate(); toast.info("Verificando..."); }}
            >
              <Loader2 className="h-3 w-3 mr-1" /> Verificar agora
            </Button>
          </div>
          <button onClick={() => setAwaitingPayment(false)} className="text-slate-400 hover:text-slate-700" aria-label="Cancelar espera">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Billing Toggle — estilo segmented control */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold tracking-tight">
            {currentSub ? "Trocar de plano" : "Planos disponíveis"}
          </p>
          <p className="text-[11px] text-slate-500">
            {currentSub ? "Upgrade pra desbloquear recursos · downgrade reduz limites" : "Escolha o melhor pro tamanho do seu escritório"}
          </p>
        </div>
        <div className="bg-slate-100 border border-slate-200 rounded-lg p-1 inline-flex gap-0.5">
          <button
            onClick={() => setBillingInterval("monthly")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              billingInterval === "monthly"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Mensal
          </button>
          <button
            onClick={() => setBillingInterval("yearly")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1.5 ${
              billingInterval === "yearly"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Anual
            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">−2 meses</span>
          </button>
        </div>
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

          const isTrial = currentSub?.status === "trialing";

          let buttonLabel = "Assinar";
          if (isCurrentPlan && isTrial) buttonLabel = "Continuar com este plano";
          else if (isCurrentPlan) buttonLabel = "Plano Atual";
          else if (isUpgrade) buttonLabel = "Fazer Upgrade";
          else if (isDowngrade) buttonLabel = "Fazer Downgrade";

          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border bg-white p-6 ${
                isCurrentPlan
                  ? "border-2 border-violet-500 bg-violet-50/30 ring-4 ring-violet-100"
                  : isPopular
                    ? "border-2 border-amber-300 bg-gradient-to-br from-amber-50/40 to-orange-50/40 shadow-lg"
                    : "border-slate-200"
              }`}
            >
              {isPopular && !isCurrentPlan && (
                <span className="absolute -top-2.5 right-3 px-2 py-0.5 bg-amber-500 text-white text-[9px] rounded-full font-bold tracking-wider uppercase shadow-sm">
                  🏆 Mais escolhido
                </span>
              )}
              {isCurrentPlan && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-violet-600 text-white text-[9px] rounded-full font-bold tracking-wider uppercase shadow-sm">
                  ✓ Plano atual
                </span>
              )}

              <div>
                <p className={`text-[11px] font-bold uppercase tracking-wider ${
                  isCurrentPlan ? "text-violet-700" : isPopular ? "text-amber-700" : "text-slate-500"
                }`}>
                  {plan.name}
                </p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className={`text-3xl font-extrabold tracking-tight tabular-nums ${
                    isCurrentPlan ? "text-violet-700" : isPopular ? "text-amber-700" : "text-slate-900"
                  }`}>
                    {formatPrice(price)}
                  </span>
                  <span className="text-xs text-slate-400 font-normal">
                    /{billingInterval === "monthly" ? "mês" : "ano"}
                  </span>
                </div>
                {billingInterval === "yearly" && (
                  <p className="text-[10px] text-emerald-700 font-semibold mt-1">
                    Economia de {formatPrice(plan.priceMonthly * 12 - plan.priceYearly)}/ano
                  </p>
                )}
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">{plan.description}</p>
              </div>

              <ul className="space-y-2 mt-5 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11.5px]">
                    <Check className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
                      isCurrentPlan ? "text-violet-600" : isPopular ? "text-amber-600" : "text-emerald-600"
                    }`} />
                    <span className="text-slate-700">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                className={`w-full mt-5 ${
                  isCurrentPlan
                    ? "bg-violet-100 text-violet-700 hover:bg-violet-100 cursor-default"
                    : isPopular
                      ? "bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-sm"
                      : ""
                }`}
                variant={isCurrentPlan || isPopular ? "default" : "outline"}
                size="sm"
                disabled={loadingPlan !== null || isCurrentPlan || billingOk === false}
                onClick={() => handleSelectPlan(plan.id)}
              >
                {loadingPlan === plan.id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando…
                  </>
                ) : isCurrentPlan ? (
                  <>✓ Você está aqui</>
                ) : (
                  <>
                    {isUpgrade && <>↑ </>}
                    {isDowngrade && <>↓ </>}
                    {buttonLabel}
                    {!isCurrentPlan && <ArrowRight className="ml-1.5 h-3.5 w-3.5" />}
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </div>

      {!currentSub && (
        <div className="text-center text-[11px] text-slate-500 mt-6 space-y-0.5">
          <p>
            Pagamento seguro via <b className="text-slate-700">Asaas</b> · PIX · Boleto · Cartão
          </p>
          <p>O acesso é liberado automaticamente após confirmação do pagamento.</p>
        </div>
      )}

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
