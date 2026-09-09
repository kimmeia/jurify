/**
 * Widget do Cloudflare Turnstile em modo "interaction-only": invisível pra
 * quase todo visitante, só vira desafio quando o tráfego parece robô.
 *
 * Só renderiza (e só carrega o script) quando VITE_TURNSTILE_SITE_KEY
 * existe no build — sem a chave, o cadastro segue exatamente como antes
 * (o servidor também é fail-open sem TURNSTILE_SECRET_KEY).
 */
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

const SITE_KEY = (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY as string | undefined;

export function turnstileHabilitado(): boolean {
  return Boolean(SITE_KEY);
}

export function TurnstileWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // O callback vive num ref pra montagem não depender da identidade da
  // função — senão cada render do form remontaria o widget.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    const montar = () => {
      if (!window.turnstile || !ref.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        appearance: "interaction-only",
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    };
    if (window.turnstile) {
      montar();
      return;
    }
    const existente = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
    if (existente) {
      existente.addEventListener("load", montar);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.dataset.turnstile = "1";
    s.onload = montar;
    document.head.appendChild(s);
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={ref} />;
}
