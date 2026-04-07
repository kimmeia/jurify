import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { getLoginUrl, isOAuthConfigured } from "@/const";
import {
  Calculator,
  Landmark,
  Building2,
  Briefcase,
  Receipt,
  ShieldCheck,
  TrendingUp,
  ArrowRight,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

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
  const oauthConfigured = isOAuthConfigured();

  // Check subscription for user role
  const { data: subscription, isFetched: subFetched } = trpc.subscription.current.useQuery(
    undefined,
    {
      enabled: !!user && user.role === "user",
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  // Verifica se o login de demonstração está habilitado no servidor
  const { data: devLoginEnabled } = trpc.auth.devLoginEnabled.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const devLoginMut = trpc.auth.devLogin.useMutation({
    onSuccess: async () => {
      toast.success("Login de demonstração ativado!");
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleStart = () => {
    if (oauthConfigured) {
      window.location.href = getLoginUrl();
    } else if (devLoginEnabled) {
      devLoginMut.mutate({ role: "admin" });
    } else {
      toast.error(
        "Login não configurado. Configure VITE_OAUTH_PORTAL_URL ou ALLOW_DEV_LOGIN=true no servidor.",
      );
    }
  };

  useEffect(() => {
    if (loading) return;
    if (!user) return;

    // Admin goes to admin panel
    if (user.role === "admin") {
      setLocation("/admin");
      return;
    }

    // User: wait for subscription query to finish
    if (!subFetched) return;

    // User with active subscription → dashboard
    if (subscription) {
      setLocation("/dashboard");
    } else {
      // User without subscription → plans page
      setLocation("/plans");
    }
  }, [loading, user, subscription, subFetched, setLocation]);

  if (loading) return null;
  if (user) return null; // Will redirect via useEffect

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
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
            Simplifique seus cálculos bancários, imobiliários, trabalhistas,
            tributários, previdenciários e de atualização monetária com nossa
            plataforma especializada.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button
              size="lg"
              className="text-base px-8 shadow-lg hover:shadow-xl transition-all"
              onClick={handleStart}
              disabled={devLoginMut.isPending}
            >
              {devLoginMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : !oauthConfigured && devLoginEnabled ? (
                <Sparkles className="mr-2 h-4 w-4" />
              ) : null}
              {!oauthConfigured && devLoginEnabled
                ? "Entrar em modo demonstração"
                : "Começar Agora"}
              {!devLoginMut.isPending && (
                <ArrowRight className="ml-2 h-4 w-4" />
              )}
            </Button>
          </div>

          {!oauthConfigured && devLoginEnabled && (
            <p className="text-xs text-muted-foreground mt-3">
              ⚡ Modo demonstração ativo — você entra como admin sem precisar de senha.
            </p>
          )}
          {!oauthConfigured && !devLoginEnabled && (
            <p className="text-xs text-amber-600 mt-3">
              ⚠ Login não configurado. Para testar, defina <code className="font-mono bg-muted px-1 rounded">ALLOW_DEV_LOGIN=true</code> nas variáveis de ambiente.
            </p>
          )}
        </div>
      </div>

      {/* Features Grid */}
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

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="max-w-5xl mx-auto px-4 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} SaaS de Cálculos. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}
