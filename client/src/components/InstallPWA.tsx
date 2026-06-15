/**
 * Convite de instalação do PWA (banner discreto) + ícone "J." inline.
 *
 * - Captura `beforeinstallprompt` (Android/Chrome/Edge desktop) e mostra um
 *   banner de 1 clique. Em iOS/Safari (que não dispara o evento) mostra uma
 *   dica de "Compartilhar → Adicionar à Tela de Início".
 * - O evento é capturado cedo no main.tsx (global `window.__pwaInstallPrompt`
 *   + ponte `pwa:installable`), então o banner nunca perde a corrida quando o
 *   navegador dispara antes do React montar.
 * - Não aparece se o app já está instalado (display-mode: standalone) nem se
 *   o usuário dispensou (lembrado em localStorage por 30 dias).
 *
 * O registro do service worker fica em pwa.ts (chamado no main.tsx).
 */
import { useEffect, useState } from "react";
import { X, Share } from "lucide-react";

const CHAVE_DISPENSA = "jurify:pwa:dispensadoEm";
const DISPENSA_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function jaInstalado(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
function dispensadoRecentemente(): boolean {
  const v = Number(localStorage.getItem(CHAVE_DISPENSA) || 0);
  return v > 0 && Date.now() - v < DISPENSA_MS;
}
function ehIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !(window as any).MSStream;
}

function IconeJ({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center font-display font-extrabold text-white shrink-0 select-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        borderRadius: size * 0.23,
        background: "linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%)",
        lineHeight: 1,
      }}
      aria-hidden
    >
      J<span style={{ color: "#c4b5fd" }}>.</span>
    </span>
  );
}

export function InstallPWA() {
  const [evento, setEvento] = useState<PromptEvent | null>(null);
  const [mostrarIOS, setMostrarIOS] = useState(false);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (jaInstalado() || dispensadoRecentemente()) return;

    // Evento já capturado cedo no main.tsx? Usa de imediato.
    if (window.__pwaInstallPrompt) {
      setEvento(window.__pwaInstallPrompt as PromptEvent);
      setVisivel(true);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvento(e as PromptEvent);
      setVisivel(true);
    };
    // Ponte do main.tsx: o evento foi capturado lá antes do React montar.
    const onBridge = () => {
      if (window.__pwaInstallPrompt) {
        setEvento(window.__pwaInstallPrompt as PromptEvent);
        setVisivel(true);
      }
    };
    const onInstalled = () => setVisivel(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("pwa:installable", onBridge);
    window.addEventListener("appinstalled", onInstalled);

    // iOS não dispara beforeinstallprompt — mostra dica manual após um tempo.
    let t: ReturnType<typeof setTimeout> | undefined;
    if (ehIOS()) {
      t = setTimeout(() => {
        setMostrarIOS(true);
        setVisivel(true);
      }, 3000);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("pwa:installable", onBridge);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!visivel) return null;

  const dispensar = () => {
    localStorage.setItem(CHAVE_DISPENSA, String(Date.now()));
    setVisivel(false);
  };
  const instalar = async () => {
    if (!evento) return;
    await evento.prompt();
    try { await evento.userChoice; } catch { /* ignore */ }
    window.__pwaInstallPrompt = undefined; // consumido — só dá pra usar 1x
    setVisivel(false);
    setEvento(null);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 pointer-events-none sm:flex sm:justify-center">
      <div className="pointer-events-auto mx-auto sm:mx-0 max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-3 flex items-center gap-3">
        <IconeJ size={44} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Instalar o JuridFlow</p>
          {mostrarIOS ? (
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-snug">
              Toque em <Share className="inline h-3 w-3 -mt-0.5" /> <span className="font-medium">Compartilhar</span> e depois em{" "}
              <span className="font-medium">"Adicionar à Tela de Início"</span>.
            </p>
          ) : (
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-snug">
              Acesso rápido na tela inicial, em tela cheia.
            </p>
          )}
        </div>
        {!mostrarIOS && (
          <button
            onClick={instalar}
            className="shrink-0 rounded-lg px-4 py-2 text-xs font-bold text-white"
            style={{ background: "linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%)" }}
          >
            Instalar
          </button>
        )}
        <button onClick={dispensar} className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Dispensar">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
