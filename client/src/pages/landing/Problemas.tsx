/**
 * Seção "Problemas" — articula 3 dores que o produto resolve.
 *
 * Padrão clássico de SaaS: nomear a dor antes da solução. Aumenta
 * empatia + demonstra entendimento do nicho.
 */

import { MessageSquareOff, ReceiptText, FileWarning } from "lucide-react";

const problemas = [
  {
    icon: MessageSquareOff,
    titulo: "Atendimento espalhado",
    desc: "WhatsApp do advogado vira caixa de mensagens. Cliente fica esperando e leads quentes esfriam.",
    cor: "text-warning",
  },
  {
    icon: ReceiptText,
    titulo: "Cobrança e comissão na mão",
    desc: "Boleto avulso, controle no Excel, comissão calculada na unha no fim do mês. Erro caro.",
    cor: "text-danger",
  },
  {
    icon: FileWarning,
    titulo: "Contrato repetitivo",
    desc: "Copia, cola, troca o nome. Mesma minuta 50 vezes por mês. Erro de cliente errado é questão de tempo.",
    cor: "text-info",
  },
];

export function Problemas() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-20 lg:py-28">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <p className="text-sm font-semibold text-primary uppercase tracking-wide mb-3">
          O que está custando dinheiro
        </p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          Você reconhece esses 3 problemas?
        </h2>
        <p className="text-muted-foreground mt-4 text-lg">
          São os mesmos no escritório de 1, 5 ou 50 advogados. Ferramentas
          espalhadas viram horas perdidas.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {problemas.map((p) => (
          <div
            key={p.titulo}
            className="rounded-xl border bg-card p-6 hover:border-foreground/20 transition-all"
          >
            <div className={`h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-4 ${p.cor}`}>
              <p.icon className="h-6 w-6" />
            </div>
            <h3 className="font-semibold text-lg mb-2">{p.titulo}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
