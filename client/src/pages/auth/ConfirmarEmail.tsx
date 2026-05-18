/**
 * Página pública de confirmação de email (Fase 2 do roadmap de Planos).
 *
 * Cliente clica no link do email → `/confirmar-email/:token` → este componente
 * chama `auth.confirmarEmail` que valida o token, marca a conta como
 * verificada e cria sessão. Em sucesso, redireciona pro destino correto:
 *   - `planoPretendido` é "free" ou null → /plans (cliente escolhe lá)
 *   - `planoPretendido` é plano pago → /plans (Fase 3 vai redirecionar pro fluxo de trial)
 *
 * Em erro mostra mensagem específica + CTA pra reenviar (precisa do email,
 * que pedimos no campo do mesmo card).
 */

import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

type Estado = "carregando" | "sucesso" | "erro";

export default function ConfirmarEmail() {
  const [, params] = useRoute("/confirmar-email/:token");
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const [estado, setEstado] = useState<Estado>("carregando");
  const [mensagemErro, setMensagemErro] = useState("");
  const [emailReenvio, setEmailReenvio] = useState("");

  const confirmarMut = trpc.auth.confirmarEmail.useMutation({
    onSuccess: async (data) => {
      setEstado("sucesso");
      await utils.auth.me.invalidate();
      // Limpa sessionStorage do plano se já consumimos (sub Fase 3 vai usar)
      try {
        if (data.planoPretendido) sessionStorage.setItem("planoEscolhido", data.planoPretendido);
      } catch {}
      toast.success("Email confirmado!");
      // Pequeno delay pra usuário ver mensagem de sucesso, depois redireciona
      setTimeout(() => setLocation("/plans"), 1200);
    },
    onError: (e) => {
      setEstado("erro");
      setMensagemErro(e.message);
    },
  });

  const reenviarMut = trpc.auth.reenviarConfirmacao.useMutation({
    onSuccess: () => toast.success("Email reenviado. Verifique sua caixa de entrada."),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (!params?.token) {
      setEstado("erro");
      setMensagemErro("Link inválido — token não encontrado.");
      return;
    }
    confirmarMut.mutate({ token: params.token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        {estado === "carregando" && (
          <CardContent className="py-12 text-center space-y-3">
            <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Confirmando seu email...</p>
          </CardContent>
        )}

        {estado === "sucesso" && (
          <CardContent className="py-12 text-center space-y-3">
            <CheckCircle2 className="h-14 w-14 mx-auto text-emerald-500" />
            <h2 className="text-xl font-semibold">Email confirmado!</h2>
            <p className="text-sm text-muted-foreground">
              Redirecionando para escolha do plano...
            </p>
          </CardContent>
        )}

        {estado === "erro" && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto h-14 w-14 rounded-full bg-amber-100 flex items-center justify-center mb-2 dark:bg-amber-900/40">
                <AlertCircle className="h-7 w-7 text-amber-700 dark:text-amber-200" />
              </div>
              <CardTitle>Não foi possível confirmar</CardTitle>
              <CardDescription>{mensagemErro}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email-reenvio">Seu email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email-reenvio"
                    type="email"
                    value={emailReenvio}
                    onChange={(e) => setEmailReenvio(e.target.value)}
                    placeholder="seu@email.com"
                    className="pl-9"
                  />
                </div>
              </div>
              <Button
                className="w-full"
                disabled={!emailReenvio.includes("@") || reenviarMut.isPending}
                onClick={() => reenviarMut.mutate({ email: emailReenvio.trim().toLowerCase() })}
              >
                {reenviarMut.isPending ? "Enviando..." : "Reenviar email de confirmação"}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setLocation("/")}>
                Voltar pra página inicial
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
