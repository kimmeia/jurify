/**
 * Página de aceitar convite — /convite/:token
 *
 * Fluxo:
 * 1. Busca dados do convite (público) → nome do escritório, email, cargo
 * 2. Se convite inválido/expirado → mensagem clara
 * 3. Se o usuário já está logado → aceita automaticamente
 * 4. Se não está logado → mostra AuthForms (Criar conta por padrão) com
 *    email pré-preenchido. Ao login/signup bem sucedido, aceita o convite.
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, UserPlus, Mail, Briefcase } from "lucide-react";
import { useLocation } from "wouter";
import { AuthForms } from "./auth/AuthForms";

const CARGO_LABELS: Record<string, string> = {
  gestor: "Gestor",
  atendente: "Atendente",
  estagiario: "Estagiário",
  sdr: "SDR",
};

export default function AceitarConvite({ token }: { token: string }) {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<
    "loading" | "accepting" | "success" | "error" | "needLogin" | "conviteInvalido"
  >("loading");
  const [mensagem, setMensagem] = useState("");

  // Busca info pública do convite (nome do escritório, email, cargo)
  const { data: convite, isLoading: loadConvite } = (trpc as any).configuracoes.consultarConvite.useQuery(
    { token },
    { retry: false },
  );

  const aceitarMut = (trpc as any).configuracoes.aceitarConvite.useMutation({
    onSuccess: () => {
      setStatus("success");
      setMensagem("Convite aceito! Você agora faz parte do escritório.");
      setTimeout(() => setLocation("/dashboard"), 2000);
    },
    onError: (e: any) => {
      setStatus("error");
      setMensagem(e.message || "Erro ao aceitar convite.");
    },
  });

  // Verifica validade do convite
  useEffect(() => {
    if (loadConvite || authLoading) return;

    if (!convite || !convite.encontrado) {
      setStatus("conviteInvalido");
      setMensagem("Convite não encontrado. Verifique se o link está correto.");
      return;
    }

    if (convite.status === "expirado") {
      setStatus("conviteInvalido");
      setMensagem("Este convite expirou. Peça um novo para o responsável do escritório.");
      return;
    }

    if (convite.status === "cancelado") {
      setStatus("conviteInvalido");
      setMensagem("Este convite foi cancelado.");
      return;
    }

    if (convite.status === "aceito") {
      // Convite já aceito — redireciona pra login/dashboard
      if (user) {
        setLocation("/dashboard");
      } else {
        setStatus("needLogin");
        setMensagem("Convite já foi aceito. Entre na sua conta.");
      }
      return;
    }

    // Convite válido e pendente
    if (!user) {
      setStatus("needLogin");
      return;
    }

    // Usuário logado → aceitar automaticamente
    if (status === "loading") {
      setStatus("accepting");
      aceitarMut.mutate({ token });
    }
  }, [convite, loadConvite, user, authLoading, status, token]);

  // Loading
  if (authLoading || loadConvite || status === "loading") {
    return (
      <CenteredLayout>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-3">Verificando convite...</p>
      </CenteredLayout>
    );
  }

  // Convite inválido/expirado/cancelado
  if (status === "conviteInvalido") {
    return (
      <CenteredLayout>
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <XCircle className="h-8 w-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold">Convite inválido</h2>
            <p className="text-sm text-muted-foreground">{mensagem}</p>
            <Button variant="outline" onClick={() => setLocation("/")}>Ir para o início</Button>
          </CardContent>
        </Card>
      </CenteredLayout>
    );
  }

  // Precisa fazer login/cadastro
  if (status === "needLogin" && convite?.encontrado) {
    return (
      <CenteredLayout>
        <div className="w-full max-w-md space-y-4">
          {/* Card de contexto */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-5 pb-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <UserPlus className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    Convite de {convite.nomeEscritorio}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cadastre-se para aceitar
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="gap-1">
                  <Mail className="h-3 w-3" />
                  {convite.email}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Briefcase className="h-3 w-3" />
                  {CARGO_LABELS[convite.cargo] || convite.cargo}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Form de login/cadastro */}
          <Card>
            <CardContent className="pt-6 pb-6">
              <AuthForms
                defaultTab="signup"
                initialEmail={convite.email}
                onSuccess={() => {
                  // Após login bem sucedido, o useEffect detectará user e chamará aceitarMut
                  setStatus("loading");
                }}
              />
            </CardContent>
          </Card>
        </div>
      </CenteredLayout>
    );
  }

  // Aceitando
  if (status === "accepting") {
    return (
      <CenteredLayout>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground mt-3">Aceitando convite...</p>
      </CenteredLayout>
    );
  }

  // Sucesso
  if (status === "success") {
    return (
      <CenteredLayout>
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-emerald-800 dark:text-emerald-200">{mensagem}</h2>
            <p className="text-xs text-muted-foreground">Redirecionando para o painel...</p>
          </CardContent>
        </Card>
      </CenteredLayout>
    );
  }

  // Erro
  return (
    <CenteredLayout>
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <XCircle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold">Não foi possível aceitar</h2>
          <p className="text-sm text-muted-foreground">{mensagem}</p>
          <Button variant="outline" onClick={() => setLocation("/")}>Voltar ao início</Button>
        </CardContent>
      </Card>
    </CenteredLayout>
  );
}

function CenteredLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100 dark:from-slate-950 dark:to-gray-900 p-4">
      <div className="flex flex-col items-center">{children}</div>
    </div>
  );
}
