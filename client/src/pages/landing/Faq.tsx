/**
 * FAQ — 5 perguntas frequentes em accordion.
 *
 * Removemos objeções comuns ANTES de pedir o cadastro. Cada
 * resposta tem um link de saída pro CTA final.
 */

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const perguntas = [
  {
    q: "O Jurify substitui o Astrea / Aurum / Projuris?",
    a: "Em quase tudo, sim. Na parte de peticionamento profundo (geração automática de petições com cálculos embutidos no PDF), continuamos focando em modelos editáveis em DOCX, não em geradores fechados. Pra CRM, atendimento, financeiro e cobrança, o Jurify cobre o que esses concorrentes fazem e mais.",
  },
  {
    q: "Como migro do meu sistema atual?",
    a: "Importação de clientes via CSV (formato simples: nome, CPF, telefone, email). Pra cobrança, você pode usar nossa integração com o Asaas existente (basta conectar a API key) ou começar do zero. Suporte ajuda na migração nos planos Intermediário e Completo.",
  },
  {
    q: "Funciona sem conexão com o Asaas?",
    a: "Sim. Despesas, comissões, modelos de contrato e CRM funcionam 100% offline. Cobrança você pode lançar manualmente (dinheiro, transferência, cartão presencial) e o sistema mantém o controle de a-receber sem precisar do Asaas.",
  },
  {
    q: "Tem suporte humano?",
    a: "Sim, em todos os planos. Chat com tempo de resposta < 4h em horário comercial no Básico/Intermediário; Completo tem WhatsApp dedicado e onboarding 1:1. Roadmap público também: você vota nas próximas features.",
  },
  {
    q: "Preciso de cartão de crédito pra começar?",
    a: "Não. Os 7 dias grátis são liberados só com email. Após esse período, você escolhe um plano e pagamento (Pix, boleto ou cartão). Não cobramos automaticamente — você precisa autorizar.",
  },
];

export function Faq() {
  return (
    <section className="max-w-3xl mx-auto px-4 py-20 lg:py-28">
      <div className="text-center mb-12">
        <p className="text-sm font-semibold text-primary uppercase tracking-wide mb-3">
          FAQ
        </p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          Perguntas frequentes
        </h2>
      </div>

      <Accordion type="single" collapsible className="space-y-2">
        {perguntas.map((p, i) => (
          <AccordionItem
            key={i}
            value={`faq-${i}`}
            className="border rounded-lg px-5 bg-card"
          >
            <AccordionTrigger className="text-left font-semibold hover:no-underline py-4">
              {p.q}
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground leading-relaxed pb-5">
              {p.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
