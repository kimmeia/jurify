import { trpc } from "@/lib/trpc";

/**
 * Banner que aparece no topo de toda página quando o ambiente NÃO é
 * produção. Lê `JURIFY_AMBIENTE` exposto pelo `/api/health` (via tRPC
 * `auth.me` ou query dedicada — usamos fetch direto pra não acoplar
 * com tRPC e funcionar mesmo sem login).
 *
 * Cores e severidade:
 *  - staging: amarelo, "STAGING — não use dados reais"
 *  - dev local: cinza, "DEV LOCAL"
 *  - produção: não renderiza nada
 */

import { useEffect, useState } from "react";

type Ambiente = "production" | "staging" | "development" | "unknown";

export function EnvironmentBanner() {
  const [ambiente, setAmbiente] = useState<Ambiente>("unknown");

  useEffect(() => {
    let cancelado = false;
    fetch("/api/health/live")
      .then((r) => r.json())
      .then((data: { ambiente?: string }) => {
        if (cancelado) return;
        const a = (data.ambiente || "unknown") as Ambiente;
        setAmbiente(a);
      })
      .catch(() => {
        if (!cancelado) setAmbiente("unknown");
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (ambiente === "production" || ambiente === "unknown") return null;

  const config = {
    staging: {
      bg: "bg-amber-500",
      text: "text-amber-950",
      label: "🟡 STAGING — não use dados reais. Tudo aqui é descartável.",
    },
    development: {
      bg: "bg-slate-700",
      text: "text-slate-50",
      label: "💻 DEV LOCAL",
    },
  }[ambiente];

  if (!config) return null;

  return (
    <div
      className={`${config.bg} ${config.text} text-center py-1 text-xs font-medium tracking-wide select-none`}
      role="status"
    >
      {config.label}
    </div>
  );
}
