/**
 * Página /redefinir-senha?token=... — finaliza o reset.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, ArrowLeft, CheckCircle2, AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function RedefinirSenha() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [showSenha, setShowSenha] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));
  }, []);

  const mut = (trpc as any).auth.redefinirSenha.useMutation({
    onSuccess: () => {
      setSucesso(true);
      setTimeout(() => setLocation("/"), 3000);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const podeSubmeter =
    !!token &&
    novaSenha.length >= 6 &&
    novaSenha === confirmar &&
    !mut.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md">
        <Link href="/" className="text-sm text-violet-600 hover:underline inline-flex items-center gap-1 mb-6">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao login
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Redefinir senha</CardTitle>
            <CardDescription>Escolha uma nova senha pra sua conta.</CardDescription>
          </CardHeader>
          <CardContent>
            {!token ? (
              <div className="text-center py-4">
                <AlertCircle className="h-12 w-12 mx-auto text-amber-500 mb-3" />
                <p className="font-medium">Link inválido</p>
                <p className="text-sm text-muted-foreground mt-1">
                  O link de redefinição parece estar incompleto ou foi quebrado pelo email.
                </p>
                <Link href="/esqueci-senha" className="inline-block mt-6 text-sm text-violet-600 hover:underline">
                  Solicitar novo link
                </Link>
              </div>
            ) : sucesso ? (
              <div className="text-center py-4">
                <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500 mb-3" />
                <p className="font-medium">Senha redefinida.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Você será redirecionado para o login em instantes.
                </p>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!podeSubmeter) return;
                  mut.mutate({ token, novaSenha });
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="novaSenha" className="text-xs">Nova senha (mínimo 6 caracteres)</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="novaSenha"
                      type={showSenha ? "text" : "password"}
                      value={novaSenha}
                      onChange={(e) => setNovaSenha(e.target.value)}
                      className="pl-9 pr-9"
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSenha(!showSenha)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmar" className="text-xs">Confirme a senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirmar"
                      type={showSenha ? "text" : "password"}
                      value={confirmar}
                      onChange={(e) => setConfirmar(e.target.value)}
                      className="pl-9"
                      required
                      autoComplete="new-password"
                    />
                  </div>
                  {confirmar.length > 0 && confirmar !== novaSenha && (
                    <p className="text-xs text-red-600">As senhas não conferem.</p>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={!podeSubmeter}>
                  {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Redefinir senha
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
