/**
 * Diferenciais — 3 coisas que software jurídico tradicional não faz.
 * Fala dos diferenciais técnicos do JuridFlow, sem desmoralizar concorrente.
 */

import { motion } from "framer-motion";
import { CheckCircle2, Wallet, BrainCircuit, FileSearch } from "lucide-react";
import { Reveal, staggerParent, staggerItem } from "./lpkit";

const diffs = [
  {
    icon: Wallet,
    titulo: "Asaas embutido",
    desc: "Não é só geração de boleto: é financeiro completo com Pix nativo, cartão, recorrência e comissão por atendente.",
    bullets: [
      "Pix instantâneo, sem taxa fixa por boleto",
      "Webhook: cliente pagou → comissão lançada",
      "Cobrança manual offline (dinheiro/transf.)",
    ],
  },
  {
    icon: BrainCircuit,
    titulo: "IA nativa, não plugin",
    desc: "Agentes que respondem no WhatsApp, qualificam leads e cobram inadimplentes — treinados com os documentos do seu escritório.",
    bullets: [
      "SmartFlow visual: arrasta passos, sem código",
      "Brief instantâneo + resposta sugerida",
      "Compliance Guard contra promessa de resultado",
    ],
  },
  {
    icon: FileSearch,
    titulo: "Motor próprio de processos",
    desc: "Monitora processos e novas ações por CPF/CNPJ com motor próprio, análise estratégica por IA e mensagem pronta pro cliente.",
    bullets: [
      "Alerta de movimentação nova com resumo por IA",
      "Cofre de credenciais OAB (segredo de justiça)",
      "Roadmap público: você vota nas próximas features",
    ],
  },
];

export function Comparativo() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <Reveal className="mx-auto mb-12 max-w-2xl text-center">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-info">
          Por que sair do que você usa hoje
        </p>
        <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
          3 coisas que ninguém mais faz
        </h2>
        <p className="mt-4 text-lg text-info/70">
          Software jurídico tradicional foca em CRM ou peticionamento. O JuridFlow foi
          construído pra ser o sistema operacional inteiro do escritório.
        </p>
      </Reveal>

      <motion.div
        variants={staggerParent}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="grid gap-5 lg:grid-cols-3"
      >
        {diffs.map((d) => (
          <motion.div
            key={d.titulo}
            variants={staggerItem}
            className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-7 transition-all hover:-translate-y-1 hover:border-info/30 hover:bg-white/[0.06] hover:shadow-[0_24px_50px_-22px_rgba(47,111,189,0.45)]"
          >
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-info/30 to-marca/25">
              <d.icon className="h-6 w-6 text-info" />
            </div>
            <h3 className="font-display mb-3 text-xl font-bold text-white">{d.titulo}</h3>
            <p className="mb-5 text-sm leading-relaxed text-info/65">{d.desc}</p>
            <ul className="mt-auto space-y-2.5 text-info/80">
              {d.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
