/**
 * Landing Page do JuridFlow (direção híbrida — hero dark cinematográfico,
 * corpo claro). Navbar scroll-aware + seções + Footer. Auth via dialog do
 * `AuthForms` (preserva fluxo existente).
 *
 * Comportamento de redirect (preservado da versão anterior):
 *  - Admin → /admin
 *  - User com subscription → /dashboard
 *  - User sem subscription → /plans
 *  - User loading subscription → aguarda 1s, força /plans pra evitar
 *    ficar preso na home se a query falhar.
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AuthForms } from "./auth/AuthForms";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";

import { Logo } from "./landing/Logo";
import { Hero } from "./landing/Hero";
import { Integracoes } from "./landing/Integracoes";
import { Problemas } from "./landing/Problemas";
import { SmartFlow } from "./landing/SmartFlow";
import { Pilares } from "./landing/Pilares";
import { Demo } from "./landing/Demo";
import { Comparativo } from "./landing/Comparativo";
import { Pricing } from "./landing/Pricing";
import { Faq } from "./landing/Faq";
import { CtaFinal } from "./landing/CtaFinal";
import { LandingFooter } from "./landing/LandingFooter";

export default function Home() {
  const { user, loading, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [authOpen, setAuthOpen] = useState<"login" | "signup" | null>(null);

  // Subscription check (mesmo fluxo da versão anterior — preserva
  // redirect pra /dashboard ou /plans quando logado).
  const { data: subscription, isFetched: subFetched } = trpc.subscription.current.useQuery(
    undefined,
    {
      enabled: !!user && user.role === "user",
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    if (loading) return;
    if (!user) return;

    if (user.role === "admin") {
      setLocation("/admin");
      return;
    }

    if (subscription) {
      setLocation("/dashboard");
    } else if (subFetched) {
      setLocation("/plans");
    } else {
      const t = setTimeout(() => setLocation("/plans"), 1000);
      return () => clearTimeout(t);
    }
  }, [loading, user, subscription, subFetched, setLocation]);

  if (loading) return null;
  if (user) return null; // redirect via useEffect

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar fixa */}
      <Navbar onCta={setAuthOpen} />

      {/* Sections */}
      <main>
        <Hero onCta={setAuthOpen} />
        <Integracoes />
        <Problemas />
        <SmartFlow />
        <Pilares />
        <Demo />
        <Comparativo />
        <Pricing onCta={setAuthOpen} />
        <Faq />
        <CtaFinal onCta={setAuthOpen} />
      </main>

      <LandingFooter />

      {/* Modal de autenticação (preservado do fluxo anterior) */}
      <Dialog open={!!authOpen} onOpenChange={(o) => !o && setAuthOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">
              {authOpen === "signup" ? "Crie sua conta" : "Bem-vindo de volta"}
            </DialogTitle>
            <DialogDescription className="text-center text-xs">
              {authOpen === "signup"
                ? "Cadastre-se em segundos. Sem cartão de crédito."
                : "Entre com seu e-mail ou conta Google."}
            </DialogDescription>
          </DialogHeader>
          <AuthForms
            defaultTab={authOpen || "login"}
            onSuccess={async () => {
              setAuthOpen(null);
              await refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Navbar fixa scroll-aware: transparente com texto claro sobre o hero
 * escuro; ao rolar vira vidro branco com texto escuro.
 */
function Navbar({ onCta }: { onCta: (modo: "login" | "signup") => void }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const linkCls = cn(
    "hidden px-3 text-sm transition-colors sm:inline-block",
    scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white",
  );

  return (
    <nav
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300",
        scrolled ? "border-border bg-background/80 backdrop-blur-md" : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Logo className="text-xl" variant={scrolled ? "light" : "dark"} />

        <div className="flex items-center gap-2">
          <a href="#smartflow" className={linkCls}>Recursos</a>
          <a href="#pricing" className={linkCls}>Planos</a>
          <a href="/roadmap" className={linkCls}>Roadmap</a>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCta("login")}
            className={scrolled ? "" : "text-white hover:bg-white/10 hover:text-white"}
          >
            Entrar
          </Button>
          <Button
            size="sm"
            onClick={() => onCta("signup")}
            className="border-0 bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-[0_8px_22px_-6px_rgba(147,51,234,0.6)] hover:from-violet-500 hover:to-purple-500"
          >
            Começar grátis
          </Button>
        </div>
      </div>
    </nav>
  );
}
