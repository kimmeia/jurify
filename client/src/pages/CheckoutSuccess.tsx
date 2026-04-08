import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2, Clock } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";

/**
 * Página de sucesso após o cliente completar o pagamento no Asaas.
 *
 * O Asaas redireciona pra cá via `callback.successUrl` configurado em
 * `createCheckout`. Quando o cliente chega aqui, o pagamento já foi
 * feito mas o webhook do Asaas pode ainda não ter sido processado
 * (latência de segundos).
 *
 * Por isso fazemos polling de `subscription.current` a cada 2s até:
 *   a) O status virar "active" → redireciona pro dashboard
 *   b) Passar 30 segundos → mostra botão pra ir manualmente (o webhook
 *      pode ter atrasado ou pode ser boleto)
 */
export default function CheckoutSuccess() {
  const [, setLocation] = useLocation();
  const [elapsedSec, setElapsedSec] = useState(0);
  const [stopPolling, setStopPolling] = useState(false);

  const { data: currentSub, refetch } = trpc.subscription.current.useQuery(
    undefined,
    {
      retry: false,
      refetchInterval: stopPolling ? false : 2000,
    },
  );

  const isAtiva = currentSub?.status === "active";

  // Contador de segundos
  useEffect(() => {
    if (isAtiva || stopPolling) return;
    const t = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [isAtiva, stopPolling]);

  // Para o polling após 30 segundos
  useEffect(() => {
    if (elapsedSec >= 30 && !isAtiva) {
      setStopPolling(true);
    }
  }, [elapsedSec, isAtiva]);

  // Redirect automático quando ativar
  useEffect(() => {
    if (isAtiva) {
      const t = setTimeout(() => setLocation("/dashboard"), 1800);
      return () => clearTimeout(t);
    }
  }, [isAtiva, setLocation]);

  // ─── ESTADO: ATIVADA ───────────────────────────────────────────────
  if (isAtiva) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader className="pb-4">
            <div className="mx-auto mb-4">
              <CheckCircle2 className="h-16 w-16 text-emerald-500" />
            </div>
            <CardTitle className="text-2xl">Pagamento Confirmado! 🎉</CardTitle>
            <CardDescription className="text-base">
              Sua assinatura foi ativada. Você está sendo redirecionado para o
              dashboard...
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              size="lg"
              onClick={() => setLocation("/dashboard")}
            >
              Ir para o Dashboard agora
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── ESTADO: POLLING EM ANDAMENTO ──────────────────────────────────
  if (!stopPolling) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader className="pb-4">
            <div className="mx-auto mb-4 relative">
              <Clock className="h-16 w-16 text-blue-500" />
              <Loader2 className="h-6 w-6 text-blue-500 absolute -bottom-1 -right-1 animate-spin" />
            </div>
            <CardTitle className="text-2xl">Confirmando pagamento...</CardTitle>
            <CardDescription className="text-base">
              Recebemos a confirmação do Asaas. Aguardando o processamento
              final ({elapsedSec}s).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Normalmente leva menos de 10 segundos. Se você pagou com PIX ou
              cartão de crédito, a ativação é instantânea. Boletos levam 1-2
              dias úteis pra compensar.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── ESTADO: TIMEOUT DE 30s (webhook atrasou ou é boleto) ──────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full text-center">
        <CardHeader className="pb-4">
          <div className="mx-auto mb-4">
            <CheckCircle2 className="h-16 w-16 text-amber-500" />
          </div>
          <CardTitle className="text-2xl">Pagamento recebido</CardTitle>
          <CardDescription className="text-base">
            Seu pagamento foi recebido no Asaas, mas a confirmação final no
            nosso sistema ainda não chegou. Isso é normal em alguns casos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 p-3 text-xs text-left space-y-1">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              Por que pode estar demorando?
            </p>
            <ul className="text-amber-800/90 dark:text-amber-200/80 space-y-0.5 list-disc pl-4">
              <li>
                <strong>Boleto</strong>: compensação leva 1-2 dias úteis
              </li>
              <li>
                <strong>Cartão</strong>: análise antifraude pode levar alguns
                minutos
              </li>
              <li>
                <strong>PIX</strong>: raramente, um atraso no webhook do Asaas
              </li>
            </ul>
          </div>
          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              setStopPolling(false);
              setElapsedSec(0);
              refetch();
            }}
          >
            <Loader2 className="h-4 w-4 mr-2" />
            Verificar novamente
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setLocation("/plans")}
          >
            Voltar para planos
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
