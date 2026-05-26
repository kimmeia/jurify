/**
 * Kit de motion/visual compartilhado da landing page.
 *
 * - Aurora: blobs de gradiente borrados (fundo cinematográfico).
 * - Reveal: fade + sobe ao entrar na viewport (uma vez).
 * - CountUp: anima um número de 0 até o valor quando entra na tela.
 *
 * Loops de ambiente (drift/bob/dash) vêm de classes CSS em index.css;
 * aqui ficam só as animações orquestradas pelo framer-motion.
 */

import { animate, motion, useInView, type Variants } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ---------- Aurora (fundo de gradiente vivo) ---------- */
export function Aurora({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden style={{ opacity: intensity }}>
      <span className="lp-drift-a absolute -left-[8%] -top-[12%] block h-[460px] w-[620px] rounded-full mix-blend-screen blur-[70px]" style={{ background: "radial-gradient(circle, #7c3aed, transparent 65%)" }} />
      <span className="lp-drift-b absolute -right-[6%] -top-[16%] block h-[520px] w-[560px] rounded-full mix-blend-screen blur-[70px]" style={{ background: "radial-gradient(circle, #4f46e5, transparent 65%)" }} />
      <span className="lp-drift-c absolute left-[30%] top-[24%] block h-[420px] w-[680px] rounded-full opacity-60 mix-blend-screen blur-[70px]" style={{ background: "radial-gradient(circle, #c026d3, transparent 68%)" }} />
    </div>
  );
}

/* ---------- Reveal (fade + rise on scroll) ---------- */
const ease = [0.22, 1, 0.36, 1] as const;

export function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
  as,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
}) {
  const Cmp = (motion as any)[as ?? "div"];
  return (
    <Cmp
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease }}
    >
      {children}
    </Cmp>
  );
}

/* Stagger container/item pra grids */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};

/* ---------- CountUp ---------- */
export function CountUp({
  value,
  prefix = "",
  suffix = "",
  className,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, {
      duration: 1.4,
      ease,
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {Math.round(display).toLocaleString("pt-BR")}
      {suffix}
    </span>
  );
}
