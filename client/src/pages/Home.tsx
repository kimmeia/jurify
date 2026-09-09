/**
 * Landing Page do JuridFlow (direção híbrida — hero dark cinematográfico,
 * corpo claro). Navbar scroll-aware + seções + Footer. CTAs de auth navegam
 * pras páginas dedicadas /login e /cadastro (URLs rastreáveis de campanha).
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
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const irParaAuth = (modo: "login" | "signup") =>
    setLocation(modo === "signup" ? "/cadastro" : "/login");

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
    <div className="dark marca-landing min-h-screen bg-[#050912]">
      {/* Navbar fixa */}
      <Navbar onCta={irParaAuth} />

      {/* Sections */}
      <main>
        <Hero onCta={irParaAuth} />
        <Integracoes />
        <Problemas />
        <SmartFlow />
        <Pilares />
        <Demo />
        <Comparativo />
        <Pricing onCta={irParaAuth} />
        <Faq />
        <CtaFinal onCta={irParaAuth} />
      </main>

      <LandingFooter />
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

  const linkCls = "hidden px-3 text-sm text-white/75 transition-colors hover:text-white sm:inline-block";

  return (
    <nav
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300",
        scrolled ? "border-white/10 bg-[#050912]/80 backdrop-blur-md" : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Logo className="text-xl" variant="dark" />

        <div className="flex items-center gap-2">
          <a href="#smartflow" className={linkCls}>Recursos</a>
          <a href="#pricing" className={linkCls}>Planos</a>
          <a href="/roadmap" className={linkCls}>Roadmap</a>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCta("login")}
            className="text-white hover:bg-white/10 hover:text-white"
          >
            Entrar
          </Button>
          <Button
            size="sm"
            onClick={() => onCta("signup")}
            className="cta-marca font-semibold"
          >
            Começar grátis
          </Button>
        </div>
      </div>
    </nav>
  );
}
