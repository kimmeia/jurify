import React, { createContext, useContext, useEffect, useState } from "react";
import { useLocation } from "wouter";

/**
 * Tema da aplicação.
 *
 * O padrão é claro: o app é usado o dia inteiro em escritório, e o escuro
 * como padrão pegava de surpresa quem nunca escolheu nada. Quem quer que o
 * app acompanhe o SO escolhe "sistema" — por isso a preferência tem três
 * valores e não dois: gravar "claro" pra quem quer acompanhar o notebook
 * congelaria a escolha errada.
 *
 * O que vai pro `<html>` é sempre o tema RESOLVIDO (claro ou escuro); a
 * preferência é o que fica salvo. Preferência já gravada manda — mudar o
 * padrão não mexe em quem escolheu.
 */
export type PreferenciaTema = "claro" | "escuro" | "sistema";
export type TemaResolvido = "claro" | "escuro";

const CHAVE = "jurify:tema";

/**
 * Rotas onde o tema escuro NUNCA se aplica, mesmo com preferência salva.
 *
 * Landing e login/cadastro são desenhadas com cores fixas (fundo claro,
 * painel de marca escuro próprio) — mas os componentes shadcn dentro delas
 * usam tokens (bg-background, dark:bg-input/30) que escurecem quando a
 * classe .dark está no <html>. Sem esta lista, quem usa o app no escuro
 * via a tela de login com inputs acinzentados e o chip "OU" preto.
 *
 * As demais rotas públicas (esqueci-senha, convite, assinatura, termos)
 * têm par escuro completo por design e ficam de fora de propósito.
 */
const ROTAS_SEMPRE_CLARAS = ["/", "/login", "/cadastro"];

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

  const [caminho] = useLocation();
  const forcarClaro = ROTAS_SEMPRE_CLARAS.includes(caminho);
  const tema: TemaResolvido = forcarClaro
    ? "claro"
    : preferencia === "sistema"
      ? doSistema
      : preferencia;

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
