import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Celular de verdade pelo user-agent. Alguns aparelhos (e a PWA instalada em
 * certas telas/configurações de zoom) reportam largura >= 768px, o que fazia
 * o app cair no layout de desktop (sidebar inteira + conteúdo cortando na
 * horizontal) em vez do app focado de Atendimento. O UA de phone — Android
 * com "Mobile", ou iPhone/iPod — é o sinal confiável de "é celular",
 * independente da largura. Tablets (Android sem "Mobile", iPad que se
 * apresenta como Macintosh) seguem no layout completo.
 */
function ehCelularPorUA(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPod/.test(ua) || (/Android/.test(ua) && /Mobile/i.test(ua));
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined
  );

  React.useEffect(() => {
    const calcular = () => window.innerWidth < MOBILE_BREAKPOINT || ehCelularPorUA();
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(calcular());
    mql.addEventListener("change", onChange);
    setIsMobile(calcular());
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

