/**
 * CTA final — banner de fechamento antes do footer.
 */

import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Aurora, Reveal } from "./lpkit";

interface Props {
  onCta: (modo: "login" | "signup") => void;
}

export function CtaFinal({ onCta }: Props) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <Reveal>
        <div
          className="relative overflow-hidden rounded-[28px] p-12 text-center lg:p-16"
          style={{ background: "radial-gradient(120% 140% at 50% -10%, #2a1066, #0d0a1c)" }}
        >
          <Aurora intensity={0.6} />
          <div className="relative z-10">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-white md:text-5xl">
              Comece em 5 minutos.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-violet-100/85">
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
      </Reveal>
    </section>
  );
}
