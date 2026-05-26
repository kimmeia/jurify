/**
 * Seção "Problemas" — nomeia 3 dores antes de apresentar a solução.
 */

import { motion } from "framer-motion";
import { MessageSquareOff, ReceiptText, FileWarning } from "lucide-react";
import { Reveal, staggerParent, staggerItem } from "./lpkit";

const problemas = [
  {
    icon: MessageSquareOff,
    titulo: "Atendimento espalhado",
    desc: "WhatsApp do advogado vira caixa de mensagens. Cliente fica esperando e lead quente esfria.",
    box: "bg-amber-500/15 border border-amber-400/20",
    fg: "text-amber-300",
  },
  {
    icon: ReceiptText,
    titulo: "Cobrança e comissão na mão",
    desc: "Boleto avulso, controle no Excel, comissão calculada na unha no fim do mês. Erro caro.",
    box: "bg-rose-500/15 border border-rose-400/20",
    fg: "text-rose-300",
  },
  {
    icon: FileWarning,
    titulo: "Contrato repetitivo",
    desc: "Copia, cola, troca o nome. A mesma minuta 50 vezes por mês. Mandar pro cliente errado é questão de tempo.",
    box: "bg-blue-500/15 border border-blue-400/20",
    fg: "text-blue-300",
  },
];

export function Problemas() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-24 pb-4">
      <Reveal className="mx-auto mb-12 max-w-2xl text-center">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-violet-300">
          O que está custando dinheiro
        </p>
        <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
          Você reconhece esses 3 problemas?
        </h2>
        <p className="mt-4 text-lg text-violet-100/70">
          São os mesmos no escritório de 1, 5 ou 50 advogados. Ferramentas espalhadas
          viram horas perdidas — e dinheiro na mesa.
        </p>
      </Reveal>

      <motion.div
        variants={staggerParent}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="grid gap-5 md:grid-cols-3"
      >
        {problemas.map((p) => (
          <motion.div
            key={p.titulo}
            variants={staggerItem}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition-all hover:-translate-y-1 hover:border-violet-400/40 hover:bg-white/[0.06] hover:shadow-[0_24px_50px_-22px_rgba(124,58,237,0.45)]"
          >
            <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${p.box}`}>
              <p.icon className={`h-6 w-6 ${p.fg}`} />
            </div>
            <h3 className="mb-2 text-lg font-bold text-white">{p.titulo}</h3>
            <p className="text-sm leading-relaxed text-violet-100/65">{p.desc}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
