/**
 * Helpers de instalação da PWA, compartilhados entre o banner (InstallPWA)
 * e o item "Instalar app" do menu de perfil.
 *
 * O `beforeinstallprompt` é capturado cedo no main.tsx e guardado em
 * `window.__pwaInstallPrompt`. Aqui só consumimos.
 */

type PromptInstalacao = {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function getPrompt(): PromptInstalacao | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __pwaInstallPrompt?: PromptInstalacao }).__pwaInstallPrompt;
}

/** App já está rodando instalado (tela inicial / standalone)? */
export function pwaInstalado(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad (Safari não emite beforeinstallprompt → instala manual). */
export function ehIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
}

/** Há instalador nativo disponível agora (Android/Chrome/Edge/desktop)? */
export function instalacaoNativaDisponivel(): boolean {
  return !!getPrompt();
}

/**
 * Dispara o instalador nativo. Retorna:
 *  - "accepted"/"dismissed": o navegador mostrou o instalador.
 *  - "indisponivel": não há prompt nativo (iOS ou navegador que não emitiu)
 *    → o caller deve mostrar as instruções manuais.
 */
export async function dispararInstalacao(): Promise<"accepted" | "dismissed" | "indisponivel"> {
  const ev = getPrompt();
  if (!ev) return "indisponivel";
  try {
    await ev.prompt();
    const escolha = await ev.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    (window as unknown as { __pwaInstallPrompt?: PromptInstalacao }).__pwaInstallPrompt = undefined;
    return escolha.outcome;
  } catch {
    return "indisponivel";
  }
}
