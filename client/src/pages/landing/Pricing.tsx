/**
 * Pricing — renderiza os planos vindos da tabela `planos` via tRPC.
 * Admin edita em /admin/financeiro?tab=planos e reflete aqui.
 *
 * "Começar grátis" persiste o slug em sessionStorage pra usar no signup.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Sparkles } from "lucide-react";
import { Reveal, staggerParent, staggerItem } from "./lpkit";

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
    <section id="pricing" className="border-y bg-gradient-to-b from-white to-violet-50/40">
      <div className="mx-auto max-w-6xl px-4 py-24">
        <Reveal className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.08em] text-violet-600">Planos</p>
          <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            Comece grátis. Cresça quando quiser.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {trialMaiorDias > 0
              ? `${trialMaiorDias} dias de teste em qualquer plano pago. Sem cartão de crédito pra começar.`
              : "Sem cartão de crédito pra começar."}
          </p>
        </Reveal>

        {isLoading || !planos ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[460px] rounded-2xl" />
            ))}
          </div>
        ) : (
          <motion.div
            variants={staggerParent}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-4"
          >
            {planos.map((p: any) => {
              const destaque = !!p.popular;
              const gratis = p.precoMensalCentavos === 0;
              const preco = gratis ? "R$ 0" : formatBRL(p.precoMensalCentavos);
              return (
                <motion.div
                  key={p.slug}
                  variants={staggerItem}
                  className={`relative flex flex-col rounded-2xl border bg-card p-6 transition-all hover:-translate-y-1 ${
                    destaque
                      ? "border-2 border-violet-600 shadow-[0_30px_70px_-24px_rgba(124,58,237,0.6)]"
                      : "hover:shadow-xl"
                  }`}
                >
                  {destaque && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 border-0 bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-[0_8px_22px_-6px_rgba(147,51,234,0.7)]">
                      <Sparkles className="mr-1 h-3 w-3" />
                      Mais popular
                    </Badge>
                  )}

                  <h3 className="font-display text-2xl font-bold">{p.nome}</h3>
                  <p className="mb-4 mt-1 min-h-[34px] text-[13px] text-muted-foreground">
                    {p.publicoAlvo ?? p.descricao ?? ""}
                  </p>

                  <div className="flex items-baseline gap-1">
                    <span className="font-display text-[38px] font-extrabold tracking-tight">{preco}</span>
                    {!gratis && <span className="text-muted-foreground">/mês</span>}
                  </div>

                  <p className="mb-1 mt-1.5 min-h-[18px] text-xs font-semibold text-violet-600">
                    {p.trialDias > 0 ? `Teste ${p.trialDias} dias grátis` : ""}
                  </p>

                  <Button
                    className={`my-4 w-full ${
                      destaque
                        ? "border-0 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-500 hover:to-purple-500"
                        : ""
                    }`}
                    size="lg"
                    variant={destaque ? "default" : "outline"}
                    onClick={() => selecionarPlano(p.slug)}
                  >
                    {gratis ? "Criar conta grátis" : "Começar grátis"}
                  </Button>

                  <ul className="space-y-2.5 text-sm">
                    {(p.features ?? []).map((f: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        <p className="mt-7 text-center text-[13px] text-muted-foreground">
          Valores em reais. Pagamento via Pix, boleto ou cartão (Asaas). Você só é cobrado se
          autorizar — nada automático no fim do teste.
        </p>
      </div>
    </section>
  );
}
