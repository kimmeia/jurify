/**
 * Pricing — landing page.
 *
 * Renderiza os planos vindos da tabela `planos` via tRPC. Admin edita em
 * /admin/financeiro?tab=planos e mudanças refletem aqui imediatamente.
 *
 * Botão "Começar grátis" persiste o slug escolhido em sessionStorage
 * pra usar no signup (consumido pelo AuthForms na Fase 3 do roadmap de
 * Planos). Hoje o signup ainda não consome esse valor — o cliente é
 * redirecionado pra /plans depois e escolhe de novo. Em produção isso
 * será resolvido em fase posterior.
 */

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Sparkles } from "lucide-react";

interface Props {
  onCta: (modo: "login" | "signup") => void;
}

function formatBRL(centavos: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

export function Pricing({ onCta }: Props) {
  const { data: planos, isLoading } = trpc.subscription.plans.useQuery();

  const trialMaiorDias = useMemo(() => {
    if (!planos) return 0;
    return Math.max(0, ...planos.map((p: any) => p.trialDias ?? 0));
  }, [planos]);

  function selecionarPlano(slug: string) {
    try {
      sessionStorage.setItem("planoEscolhido", slug);
    } catch {
      // sessionStorage pode estar bloqueado (modo anônimo restrito)
    }
    onCta("signup");
  }

  return (
    <section id="pricing" className="max-w-6xl mx-auto px-4 py-20 lg:py-28">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <p className="text-sm font-semibold text-primary uppercase tracking-wide mb-3">Planos</p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          Comece grátis. Cancele quando quiser.
        </h2>
        <p className="text-muted-foreground mt-4 text-lg">
          {trialMaiorDias > 0
            ? `${trialMaiorDias} dias de teste gratuito. Sem cartão de crédito pra começar.`
            : "Sem cartão de crédito pra começar."}
        </p>
      </div>

      {isLoading || !planos ? (
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-[480px] rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {planos.map((p: any) => {
            const destaque = !!p.popular;
            const preco = p.precoMensalCentavos === 0 ? "Grátis" : formatBRL(p.precoMensalCentavos);
            return (
              <div
                key={p.slug}
                className={`rounded-2xl border p-7 flex flex-col ${
                  destaque ? "border-primary shadow-xl bg-card relative" : "bg-card"
                }`}
              >
                {destaque && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground border-0">
                    <Sparkles className="h-3 w-3 mr-1" />
                    Mais popular
                  </Badge>
                )}

                <h3 className="text-2xl font-bold">{p.nome}</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-6">
                  {p.publicoAlvo ?? p.descricao ?? ""}
                </p>

                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-bold tracking-tight">{preco}</span>
                  {p.precoMensalCentavos > 0 && (
                    <span className="text-muted-foreground">/mês</span>
                  )}
                </div>

                {p.trialDias > 0 && (
                  <p className="text-xs text-primary font-medium mb-4">
                    Teste {p.trialDias} dias grátis
                  </p>
                )}
                {p.trialDias === 0 && <div className="mb-4" />}

                <Button
                  className="w-full mb-6"
                  size="lg"
                  variant={destaque ? "default" : "outline"}
                  onClick={() => selecionarPlano(p.slug)}
                >
                  {p.precoMensalCentavos === 0 ? "Criar conta grátis" : "Começar grátis"}
                </Button>

                <ul className="space-y-2.5 text-sm">
                  {(p.features ?? []).map((f: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground mt-8">
        Valores em reais. Pagamento via Pix, boleto ou cartão (Asaas). NF-e emitida automaticamente.
      </p>
    </section>
  );
}
