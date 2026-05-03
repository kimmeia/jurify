/**
 * CTA final — banner de fechamento antes do footer.
 *
 * Reforça a oferta (7 dias grátis, sem cartão) e dá o último empurrão.
 */

import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface Props {
  onCta: (modo: "login" | "signup") => void;
}

export function CtaFinal({ onCta }: Props) {
  return (
    <section className="max-w-5xl mx-auto px-4 py-20 lg:py-28">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-primary/80 p-10 lg:p-14 text-center">
        {/* Pattern decorativo */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-20 -right-20 h-72 w-72 rounded-full bg-white blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-white blur-3xl" />
        </div>

        <div className="relative">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-primary-foreground mb-4">
            Comece em 5 minutos.
          </h2>
          <p className="text-lg lg:text-xl text-primary-foreground/90 max-w-xl mx-auto mb-8">
            7 dias grátis em qualquer plano. Sem cartão de crédito pra
            começar. Cancele quando quiser.
          </p>
          <Button
            size="lg"
            variant="secondary"
            className="text-base px-8 shadow-xl"
            onClick={() => onCta("signup")}
          >
            Criar conta grátis
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </section>
  );
}
