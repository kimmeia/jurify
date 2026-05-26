/**
 * Seção-assinatura SmartFlow — banda escura com o grafo de automação.
 * Nós conectados por linhas com "dados fluindo" (dash animado) que
 * aparecem em cascata ao entrar na viewport. Mostra o diferencial mais
 * visual do produto (o construtor de fluxos com IA).
 */

import { motion } from "framer-motion";
import {
  MessageCircle,
  BrainCircuit,
  GitBranch,
  CalendarDays,
  DollarSign,
  Bell,
} from "lucide-react";
import { Aurora, Reveal } from "./lpkit";

const ease = [0.22, 1, 0.36, 1] as const;

type NodeDef = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
  tone: string;
  pos: string; // classes de posição (lg+)
  delay: number;
};

const NODES: NodeDef[] = [
  { icon: MessageCircle, title: "Mensagem recebida", sub: "Gatilho · WhatsApp", tone: "bg-[#25d366] text-white", pos: "left-0 top-[122px]", delay: 0 },
  { icon: BrainCircuit, title: "IA qualifica o lead", sub: "Agente · classifica intenção", tone: "bg-violet-500/30 text-violet-200", pos: "left-[248px] top-[40px]", delay: 0.15 },
  { icon: GitBranch, title: "É cliente?", sub: "Condição", tone: "bg-amber-500/25 text-amber-300", pos: "left-[250px] top-[210px]", delay: 0.3 },
  { icon: CalendarDays, title: "Agendar consulta", sub: "Ação · Agenda", tone: "bg-blue-500/25 text-blue-300", pos: "right-0 top-[16px]", delay: 0.45 },
  { icon: DollarSign, title: "Enviar cobrança", sub: "Ação · Asaas Pix", tone: "bg-emerald-500/20 text-emerald-300", pos: "right-0 top-[132px]", delay: 0.55 },
  { icon: Bell, title: "Notifica responsável", sub: "Ação", tone: "bg-violet-500/30 text-violet-200", pos: "right-0 top-[244px]", delay: 0.65 },
];

export function SmartFlow() {
  return (
    <section id="smartflow" className="relative overflow-hidden bg-[#0a0817] py-24">
      <div
        className="absolute inset-0 z-0"
        style={{ background: "radial-gradient(120% 100% at 50% 0%, #120d28, #0a0817)" }}
      />
      <Aurora className="z-0" intensity={0.5} />

      <div className="relative z-10 mx-auto max-w-6xl px-4">
        <Reveal className="mx-auto mb-14 max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.08em] text-violet-300">SmartFlow + Agentes IA</p>
          <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
            Automações que trabalham 24h por você
          </h2>
          <p className="mt-4 text-lg text-violet-100/70">
            Arrasta os passos num canvas visual. O agente qualifica o lead, agenda, cobra
            inadimplente e avisa o responsável — sozinho.
          </p>
        </Reveal>

        {/* Grafo (lg+) */}
        <div className="relative mx-auto hidden h-[320px] w-[980px] max-w-full lg:block">
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 980 320" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="sf-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#7c3aed" />
                <stop offset="1" stopColor="#e879f9" />
              </linearGradient>
            </defs>
            {[
              "M168 150 C 220 150, 220 70, 268 70",
              "M168 150 C 220 150, 220 235, 268 235",
              "M430 70 C 600 70, 640 45, 760 45",
              "M430 235 C 600 235, 600 162, 760 162",
              "M430 235 C 600 235, 640 270, 760 270",
            ].map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="url(#sf-grad)"
                strokeWidth={2.4}
                strokeLinecap="round"
                className="lp-flow-line"
                style={{ filter: "drop-shadow(0 0 6px rgba(168,85,247,.6))" }}
              />
            ))}
          </svg>

          {NODES.map((n) => (
            <motion.div
              key={n.title}
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: n.delay, ease }}
              className={`absolute flex items-center gap-2.5 whitespace-nowrap rounded-xl border border-violet-400/40 bg-[#1a1530]/85 px-3.5 py-3 text-[13px] font-semibold text-white shadow-[0_14px_40px_-14px_rgba(124,58,237,0.7)] backdrop-blur ${n.pos}`}
            >
              <span className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg ${n.tone}`}>
                <n.icon className="h-4 w-4" />
              </span>
              <span>
                {n.title}
                <span className="block text-[10.5px] font-medium text-white/55">{n.sub}</span>
              </span>
            </motion.div>
          ))}
        </div>

        {/* Fallback mobile: lista vertical */}
        <div className="mx-auto flex max-w-md flex-col gap-2.5 lg:hidden">
          {NODES.map((n, i) => (
            <Reveal key={n.title} delay={i * 0.05}>
              <div className="flex items-center gap-3 rounded-xl border border-violet-400/30 bg-[#1a1530]/80 px-4 py-3 text-white backdrop-blur">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${n.tone}`}>
                  <n.icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{n.title}</span>
                  <span className="block text-xs text-white/55">{n.sub}</span>
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
