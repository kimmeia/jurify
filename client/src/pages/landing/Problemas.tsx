/**
 * Seção "Problemas" — nomeia 3 dores antes de apresentar a solução.
 */

import { MessageSquareOff, ReceiptText, FileWarning } from "lucide-react";

const problemas = [
  {
    icon: MessageSquareOff,
    titulo: "Atendimento espalhado",
    desc: "WhatsApp do advogado vira caixa de mensagens. Cliente fica esperando e lead quente esfria.",
    box: "bg-amber-50",
    fg: "text-amber-700",
  },
  {
    icon: ReceiptText,
    titulo: "Cobrança e comissão na mão",
    desc: "Boleto avulso, controle no Excel, comissão calculada na unha no fim do mês. Erro caro.",
    box: "bg-rose-50",
    fg: "text-rose-700",
  },
  {
    icon: FileWarning,
    titulo: "Contrato repetitivo",
    desc: "Copia, cola, troca o nome. A mesma minuta 50 vezes por mês. Mandar pro cliente errado é questão de tempo.",
    box: "bg-blue-50",
    fg: "text-blue-700",
  },
];

export function Problemas() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-24 pb-4">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-violet-600">
          O que está custando dinheiro
        </p>
        <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
          Você reconhece esses 3 problemas?
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          São os mesmos no escritório de 1, 5 ou 50 advogados. Ferramentas espalhadas
          viram horas perdidas — e dinheiro na mesa.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {problemas.map((p) => (
          <div key={p.titulo} className="rounded-2xl border bg-card p-6 transition-colors hover:border-foreground/20">
            <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${p.box}`}>
              <p.icon className={`h-6 w-6 ${p.fg}`} />
            </div>
            <h3 className="mb-2 text-lg font-bold">{p.titulo}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
