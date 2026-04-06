import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";

export default function CheckoutSuccess() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  useEffect(() => {
    utils.subscription.current.invalidate();
    utils.dashboard.credits.invalidate();
    utils.dashboard.stats.invalidate();
    utils.dashboard.historico.invalidate();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full text-center">
        <CardHeader className="pb-4">
          <div className="mx-auto mb-4">
            <CheckCircle2 className="h-16 w-16 text-emerald-500" />
          </div>
          <CardTitle className="text-2xl">Pagamento Confirmado!</CardTitle>
          <CardDescription className="text-base">
            Sua assinatura foi ativada com sucesso. Você já pode acessar todos os
            módulos do seu plano.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            className="w-full"
            size="lg"
            onClick={() => setLocation("/dashboard")}
          >
            Ir para o Dashboard
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setLocation("/plans")}
          >
            Ver Meu Plano
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
