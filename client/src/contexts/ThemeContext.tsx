import React, { createContext, useContext, useEffect, useState } from "react";

/**
 * Tema da aplicação.
 *
 * A preferência tem três valores porque "sistema" não é o mesmo que "claro":
 * quem deixa o notebook virar escuro à noite espera que o app acompanhe, e
 * gravar "claro" nesse caso congelaria a escolha errada.
 *
 * O que vai pro `<html>` é sempre o tema RESOLVIDO (claro ou escuro); a
 * preferência é o que fica salvo.
 */
export type PreferenciaTema = "claro" | "escuro" | "sistema";
export type TemaResolvido = "claro" | "escuro";

const CHAVE = "jurify:tema";

interface ThemeContextType {
  /** O que está valendo na tela agora. */
  tema: TemaResolvido;
  /** O que o usuário escolheu (pode ser "sistema"). */
  preferencia: PreferenciaTema;
  setPreferencia: (p: PreferenciaTema) => void;
  /** Compatibilidade com o uso anterior. */
  theme: TemaResolvido;
  toggleTheme: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function prefDoSistema(): TemaResolvido {
  if (typeof window === "undefined" || !window.matchMedia) return "claro";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

function lerPreferencia(padrao: PreferenciaTema): PreferenciaTema {
  try {
    const v = localStorage.getItem(CHAVE);
    if (v === "claro" || v === "escuro" || v === "sistema") return v;
    // Migração da chave antiga, que guardava só "light"/"dark".
    const antigo = localStorage.getItem("theme");
    if (antigo === "dark") return "escuro";
    if (antigo === "light") return "claro";
  } catch {
    // modo privado / storage bloqueado
  }
  return padrao;
}

export function ThemeProvider({
  children,
  defaultTheme = "sistema",
}: {
  children: React.ReactNode;
  defaultTheme?: PreferenciaTema;
  /** Aceito e ignorado — o tema é sempre alternável agora. */
  switchable?: boolean;
}) {
  const [preferencia, setPreferenciaState] = useState<PreferenciaTema>(() =>
    lerPreferencia(defaultTheme),
  );
  const [doSistema, setDoSistema] = useState<TemaResolvido>(prefDoSistema);

  // Acompanha a troca no SO enquanto o app está aberto — sem isso, escolher
  // "sistema" só valeria até o próximo reload.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const ouvir = (e: MediaQueryListEvent) => setDoSistema(e.matches ? "escuro" : "claro");
    mq.addEventListener("change", ouvir);
    return () => mq.removeEventListener("change", ouvir);
  }, []);

  const tema: TemaResolvido = preferencia === "sistema" ? doSistema : preferencia;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", tema === "escuro");
    // Faz o navegador pintar barra de rolagem e controles nativos no tom certo.
    document.documentElement.style.colorScheme = tema === "escuro" ? "dark" : "light";
  }, [tema]);

  const setPreferencia = (p: PreferenciaTema) => {
    setPreferenciaState(p);
    try {
      localStorage.setItem(CHAVE, p);
      localStorage.removeItem("theme");
    } catch {
      // modo privado: vale só nesta sessão
    }
  };

  const toggleTheme = () => setPreferencia(tema === "escuro" ? "claro" : "escuro");

  return (
    <ThemeContext.Provider
      value={{ tema, preferencia, setPreferencia, theme: tema, toggleTheme, switchable: true }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
