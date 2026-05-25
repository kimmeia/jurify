/**
 * CTA final — banner de fechamento antes do footer.
 */

import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface Props {
  onCta: (modo: "login" | "signup") => void;
}

export function CtaFinal({ onCta }: Props) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-700 via-violet-600 to-indigo-600 p-10 text-center lg:p-16">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />

        <div className="relative">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-white md:text-5xl">
            Comece em 5 minutos.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-white/90">
            14 dias grátis em qualquer plano. Sem cartão de crédito pra começar. Cancele quando
            quiser.
          </p>
          <Button
            size="lg"
            variant="secondary"
            className="mt-8 px-8 text-base shadow-xl"
            onClick={() => onCta("signup")}
          >
            Criar conta grátis
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
