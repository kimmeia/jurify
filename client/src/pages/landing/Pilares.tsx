/**
 * Módulos em bento grid — uma célula-destaque escura (Atendimento) ancora
 * o layout, cercada por cards de vidro e um card largo (Processos).
 */

import { motion } from "framer-motion";
import {
  Headphones,
  Users,
  DollarSign,
  TrendingUp,
  FileText,
  Calculator,
  FileSearch,
} from "lucide-react";
import { Reveal, staggerParent, staggerItem } from "./lpkit";

export function Pilares() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <Reveal className="mx-auto mb-12 max-w-2xl text-center">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-violet-300">Tudo num só lugar</p>
        <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
          Módulos que conversam entre si
        </h2>
        <p className="mt-4 text-lg text-violet-100/70">
          Cliente cadastrado aqui já aparece na cobrança, no contrato, no atendimento e no
          SmartFlow. Sem integração frágil entre sistemas diferentes.
        </p>
      </Reveal>

      <motion.div
        variants={staggerParent}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:auto-rows-[168px]"
      >
        {/* Feature cell — destaque */}
        <motion.div
          variants={staggerItem}
          className="group relative overflow-hidden rounded-2xl border border-violet-400/40 p-6 text-white sm:col-span-2 lg:row-span-2"
          style={{ background: "radial-gradient(120% 120% at 100% 0%, #1a1140, #0c0a1c)" }}
        >
          <div className="pointer-events-none absolute -bottom-8 -right-8 h-40 w-40 rounded-full blur-2xl" style={{ background: "radial-gradient(circle, rgba(124,58,237,.5), transparent 70%)" }} />
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/50 bg-violet-500/25">
            <Headphones className="h-5 w-5 text-violet-200" />
          </div>
          <h3 className="font-display text-2xl font-bold">Atendimento omnichannel</h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-violet-100/70">
            WhatsApp, Instagram e e-mail num inbox só. Brief de IA, linha do tempo unificada e
            resposta sugerida. O lead nunca esfria.
          </p>
          <div className="mt-5 flex gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#25d366]/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"><i className="h-1.5 w-1.5 rounded-full bg-[#25d366]" /> WhatsApp</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-500/20 px-2.5 py-1 text-[11px] font-semibold text-pink-300"><i className="h-1.5 w-1.5 rounded-full bg-[#e1306c]" /> Instagram</span>
          </div>
        </motion.div>

        <BentoCell icon={Users} titulo="CRM jurídico" desc="CPF/CNPJ, profissão, endereço — pronto pra contrato." />
        <BentoCell icon={DollarSign} titulo="Financeiro + Asaas" desc="Pix, boleto e cartão. Recorrência e fluxo de caixa." />
        <BentoCell icon={TrendingUp} titulo="Comissões" desc="Fechou? Calcula a comissão e lança a despesa." />
        <BentoCell icon={FileText} titulo="Modelos de contrato" desc="DOCX com placeholders que viram campos." />
        <BentoCell icon={Calculator} titulo="Cálculos jurídicos" desc="Bancário, trabalhista, tributário. Resultado em PDF." />

        {/* Wide cell */}
        <motion.div
          variants={staggerItem}
          className="group rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition-all hover:-translate-y-1 hover:border-violet-400/40 hover:bg-white/[0.06] hover:shadow-[0_24px_50px_-22px_rgba(124,58,237,0.45)] lg:col-span-3"
        >
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/30 to-fuchsia-500/15">
            <FileSearch className="h-5 w-5 text-violet-200" />
          </div>
          <h3 className="font-bold text-white">Processos &amp; Kanban — motor próprio</h3>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-violet-100/65">
            Monitoramento por CPF/CNPJ direto nos tribunais, alertas de movimentação por
            palavra-chave e prazos no Kanban.
          </p>
        </motion.div>
      </motion.div>
    </section>
  );
}

function BentoCell({
  icon: Icon,
  titulo,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  titulo: string;
  desc: string;
}) {
  return (
    <motion.div
      variants={staggerItem}
      className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-all hover:-translate-y-1 hover:border-violet-400/40 hover:bg-white/[0.06] hover:shadow-[0_24px_50px_-22px_rgba(124,58,237,0.45)]"
    >
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/30 to-fuchsia-500/15 transition-transform group-hover:scale-110">
        <Icon className="h-5 w-5 text-violet-200" />
      </div>
      <h3 className="mb-1.5 font-bold text-white">{titulo}</h3>
      <p className="text-sm leading-relaxed text-violet-100/65">{desc}</p>
    </motion.div>
  );
}
