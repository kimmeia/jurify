/**
 * Página /esqueci-senha — solicita link de redefinição.
 *
 * Sempre exibe mensagem de sucesso (mesmo se email não existir) pra
 * não vazar quais emails têm conta. Backend faz o trabalho real e
 * só envia email se o user existir mesmo.
 */

import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";

export default function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);

  const mut = (trpc as any).auth.esqueciSenha.useMutation({
    onSuccess: () => setEnviado(true),
  });

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md">
        <Link href="/" className="text-sm text-violet-600 hover:underline inline-flex items-center gap-1 mb-6">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao login
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Esqueci minha senha</CardTitle>
            <CardDescription>
              Informe seu email e enviaremos um link pra você criar uma nova senha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {enviado ? (
              <div className="text-center py-4">
                <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500 mb-3" />
                <p className="font-medium">Pronto.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Se houver uma conta com esse email, você receberá o link de redefinição em alguns minutos.
                </p>
                <p className="text-xs text-muted-foreground mt-3">
                  O link expira em 1 hora. Cheque também a pasta de spam.
                </p>
                <Link href="/" className="inline-block mt-6 text-sm text-violet-600 hover:underline">
                  Voltar ao login
                </Link>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!email.trim()) return;
                  mut.mutate({ email: email.trim().toLowerCase() });
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs">E-mail</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9"
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={mut.isPending || !email.trim()}>
                  {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Enviar link de redefinição
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
