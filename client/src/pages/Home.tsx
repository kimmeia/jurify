import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  Calculator,
  Landmark,
  Building2,
  Briefcase,
  Receipt,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
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

const features = [
  { icon: Landmark, label: "Bancário", desc: "Juros, amortização e revisão contratual" },
  { icon: Building2, label: "Imobiliário", desc: "Financiamentos e correções imobiliárias" },
  { icon: Briefcase, label: "Trabalhista", desc: "Verbas rescisórias e horas extras" },
  { icon: Receipt, label: "Tributário", desc: "Impostos, multas e atualizações fiscais" },
  { icon: ShieldCheck, label: "Previdenciário", desc: "Benefícios e tempo de contribuição" },
  { icon: TrendingUp, label: "Cálculos Diversos", desc: "Índices e correção de valores" },
];

export default function Home() {
  const { user, loading, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [authOpen, setAuthOpen] = useState<"login" | "signup" | null>(null);

  // Check subscription for user role
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

    // Admin goes to admin panel imediatamente
    if (user.role === "admin") {
      setLocation("/admin");
      return;
    }

    // User: redireciona pro dashboard se já tem subscription, senão pra /plans.
    // NÃO espera `subFetched` ficar true — se a query falhar ou demorar,
    // o usuário ficaria preso na home indefinidamente. Usa o último valor
    // disponível e deixa o /plans/dashboard tratar a falta de subscription.
    if (subscription) {
      setLocation("/dashboard");
    } else if (subFetched) {
      // Query terminou sem assinatura → vai pra /plans
      setLocation("/plans");
    } else {
      // Query ainda em andamento — não bloqueia. Após 1s, força /plans.
      const t = setTimeout(() => setLocation("/plans"), 1000);
      return () => clearTimeout(t);
    }
  }, [loading, user, subscription, subFetched, setLocation]);

  if (loading) return null;
  if (user) return null; // Will redirect via useEffect

  return (
    <div className="min-h-screen bg-background">
      {/* ─── Hero ─── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/3" />
        <div className="relative max-w-5xl mx-auto px-4 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium mb-8">
            <Calculator className="h-4 w-4" />
            Plataforma de Cálculos Jurídicos
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground mb-6 leading-tight">
            Cálculos jurídicos
            <br />
            <span className="text-primary">precisos e eficientes</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
            Simplifique seus cálculos bancários, imobiliários, trabalhistas, tributários,
            previdenciários e de atualização monetária com nossa plataforma especializada.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              className="text-base px-8 shadow-lg hover:shadow-xl transition-all"
              onClick={() => setAuthOpen("signup")}
            >
              Criar conta grátis
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-base px-8"
              onClick={() => setAuthOpen("login")}
            >
              Já tenho conta
            </Button>
          </div>
        </div>
      </div>

      {/* ─── Features Grid ─── */}
      <div className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-semibold text-center text-foreground mb-10">
          Módulos Disponíveis
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.label}
              className="group rounded-xl border bg-card p-6 hover:shadow-md hover:border-primary/20 transition-all"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-1">{f.label}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Footer ─── */}
      <footer className="border-t py-8">
        <div className="max-w-5xl mx-auto px-4 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} Jurify. Todos os direitos reservados.
        </div>
      </footer>

      {/* ─── Modal de autenticação ─── */}
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
