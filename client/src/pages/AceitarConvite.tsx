/**
 * Página de aceitar convite — /convite/:token
 * 
 * Fluxo:
 * 1. Usuário recebe link → abre /convite/abc123
 * 2. Se não logado → redireciona para login (Google) com returnTo
 * 3. Se logado → aceita convite automaticamente
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle, UserPlus, LogIn } from "lucide-react";
import { useLocation } from "wouter";

export default function AceitarConvite({ token }: { token: string }) {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "accepting" | "success" | "error" | "needLogin">("loading");
  const [mensagem, setMensagem] = useState("");

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

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setStatus("needLogin");
      return;
    }

    // Usuário logado → aceitar automaticamente
    if (status === "loading") {
      setStatus("accepting");
      aceitarMut.mutate({ token });
    }
  }, [user, authLoading, status]);

  // Loading auth
  if (authLoading || status === "loading") {
    return (
      <CenteredLayout>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-3">Verificando convite...</p>
      </CenteredLayout>
    );
  }

  // Precisa fazer login
  if (status === "needLogin") {
    return (
      <CenteredLayout>
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto">
              <UserPlus className="h-8 w-8 text-blue-600" />
            </div>
            <h2 className="text-xl font-bold">Convite para Escritório</h2>
            <p className="text-sm text-muted-foreground">
              Você recebeu um convite para participar de um escritório. Faça login para aceitar.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                // Redireciona para login e volta para esta página depois
                window.location.href = `/api/login?returnTo=/convite/${token}`;
              }}
            >
              <LogIn className="h-4 w-4 mr-2" /> Entrar com Google
            </Button>
          </CardContent>
        </Card>
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
