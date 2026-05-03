/**
 * Landing Page do Jurify.
 *
 * Monta as 8 seções em ordem (Hero → Problemas → Pilares → Demo →
 * Comparativo → Pricing → FAQ → CTA Final) + Navbar fixa no topo +
 * Footer. Auth via dialog do `AuthForms` (preserva fluxo existente).
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
import { Scale } from "lucide-react";

import { Hero } from "./landing/Hero";
import { Problemas } from "./landing/Problemas";
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
        <Problemas />
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

/** Navbar minimalista fixa no topo. */
function Navbar({ onCta }: { onCta: (modo: "login" | "signup") => void }) {
  return (
    <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
            <Scale className="h-5 w-5" />
          </div>
          <span className="font-bold text-lg tracking-tight">Jurify</span>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="#pricing"
            className="hidden sm:inline-block text-sm text-muted-foreground hover:text-foreground transition-colors px-3"
          >
            Planos
          </a>
          <a
            href="/roadmap"
            className="hidden sm:inline-block text-sm text-muted-foreground hover:text-foreground transition-colors px-3"
          >
            Roadmap
          </a>
          <Button variant="ghost" size="sm" onClick={() => onCta("login")}>
            Entrar
          </Button>
          <Button size="sm" onClick={() => onCta("signup")}>
            Começar grátis
          </Button>
        </div>
      </div>
    </nav>
  );
}
