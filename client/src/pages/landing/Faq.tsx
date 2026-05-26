/**
 * FAQ — perguntas frequentes em accordion. Remove objeções antes do CTA.
 */

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "./lpkit";

const perguntas = [
  {
    q: "O JuridFlow substitui o Astrea / Aurum / Projuris?",
    a: "Em CRM, atendimento, financeiro e cobrança, sim — cobre o que esses fazem e mais. Na parte de peticionamento profundo, focamos em modelos editáveis em DOCX, não em geradores fechados.",
  },
  {
    q: "Funciona sem conexão com o Asaas?",
    a: "Sim. Despesas, comissões, modelos de contrato e CRM funcionam 100% offline. A cobrança você pode lançar manualmente (dinheiro, transferência, cartão presencial) e o sistema mantém o controle de a-receber.",
  },
  {
    q: "Preciso de cartão de crédito pra começar?",
    a: "Não. Os 14 dias grátis são liberados só com e-mail. Depois você escolhe um plano e a forma de pagamento (Pix, boleto ou cartão). Não cobramos automaticamente — você precisa autorizar.",
  },
  {
    q: "Como migro do meu sistema atual?",
    a: "Importação de clientes via CSV e, pra cobrança, é só conectar a API key do Asaas. O suporte ajuda na migração nos planos Intermediário e Completo.",
  },
  {
    q: "Tem suporte humano?",
    a: "Sim, em todos os planos. Chat no Básico/Intermediário; o Completo tem suporte prioritário e onboarding dedicado. E o roadmap é público — você vota nas próximas features.",
  },
];

export function Faq() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-24">
      <Reveal className="mb-10 text-center">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-violet-300">FAQ</p>
        <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
          Perguntas frequentes
        </h2>
      </Reveal>

      <Accordion type="single" collapsible className="space-y-3">
        {perguntas.map((p, i) => (
          <AccordionItem
            key={i}
            value={`faq-${i}`}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-5"
          >
            <AccordionTrigger className="py-4 text-left font-display font-bold text-white hover:no-underline">
              {p.q}
            </AccordionTrigger>
            <AccordionContent className="pb-5 leading-relaxed text-violet-100/70">
              {p.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
