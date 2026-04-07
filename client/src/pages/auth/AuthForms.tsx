/**
 * Formulários de Login e Cadastro com email/senha + Google Sign-In.
 *
 * Componente único com tabs entre Login e Cadastro. Usado tanto no landing
 * page quanto numa página /auth dedicada.
 *
 * Google Sign-In via Google Identity Services (GIS) — carrega o script
 * sob demanda quando GOOGLE_CLIENT_ID está configurado no backend.
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Mail, Lock, User, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface AuthFormsProps {
  /** Callback chamado quando o login/cadastro é bem sucedido. */
  onSuccess?: () => void;
  /** Aba inicial (default: "login") */
  defaultTab?: "login" | "signup";
}

// Tipo do Google Identity Services (não declaramos `window.google` global pra
// não conflitar com Google Maps em outros componentes — usamos cast local).
interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  prompt: () => void;
}

function getGoogleGIS(): GoogleAccountsId | null {
  const w = window as unknown as { google?: { accounts?: { id?: GoogleAccountsId } } };
  return w.google?.accounts?.id ?? null;
}

export function AuthForms({ onSuccess, defaultTab = "login" }: AuthFormsProps) {
  const [tab, setTab] = useState<"login" | "signup">(defaultTab);
  const utils = trpc.useUtils();

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const signupMut = trpc.auth.signup.useMutation({
    onSuccess: async () => {
      toast.success("Conta criada com sucesso!");
      await utils.auth.me.invalidate();
      onSuccess?.();
    },
    onError: (e) => toast.error(e.message),
  });

  const loginEmailMut = trpc.auth.loginEmail.useMutation({
    onSuccess: async () => {
      toast.success("Bem-vindo de volta!");
      await utils.auth.me.invalidate();
      onSuccess?.();
    },
    onError: (e) => toast.error(e.message),
  });

  const loginGoogleMut = trpc.auth.loginGoogle.useMutation({
    onSuccess: async () => {
      toast.success("Login com Google realizado!");
      await utils.auth.me.invalidate();
      onSuccess?.();
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Google Sign-In ────────────────────────────────────────────────────────

  const { data: googleConfig } = trpc.auth.googleConfig.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const googleBtnRef = useRef<HTMLDivElement>(null);
  const [gisLoaded, setGisLoaded] = useState(false);

  // Carrega o script do Google Identity Services
  useEffect(() => {
    if (!googleConfig?.enabled) return;
    if (getGoogleGIS()) {
      setGisLoaded(true);
      return;
    }

    if (!document.getElementById("google-gis-script")) {
      const script = document.createElement("script");
      script.id = "google-gis-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => setGisLoaded(true);
      document.body.appendChild(script);
    }
  }, [googleConfig?.enabled]);

  // Inicializa e renderiza o botão Google quando o script carrega
  useEffect(() => {
    if (!gisLoaded || !googleConfig?.clientId || !googleBtnRef.current) return;
    const gis = getGoogleGIS();
    if (!gis) return;

    gis.initialize({
      client_id: googleConfig.clientId,
      callback: (response: { credential: string }) => {
        if (response.credential) {
          loginGoogleMut.mutate({ idToken: response.credential });
        }
      },
    });

    gis.renderButton(googleBtnRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: tab === "login" ? "signin_with" : "signup_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: googleBtnRef.current.offsetWidth || 320,
    });
  }, [gisLoaded, googleConfig?.clientId, tab, loginGoogleMut]);

  // ─── Form state ────────────────────────────────────────────────────────────

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginEmailMut.mutate({ email: loginEmail, password: loginPassword });
  };

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    if (signupPassword !== signupPasswordConfirm) {
      toast.error("As senhas não conferem");
      return;
    }
    if (signupPassword.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres");
      return;
    }
    signupMut.mutate({
      name: signupName.trim(),
      email: signupEmail.trim().toLowerCase(),
      password: signupPassword,
    });
  };

  const isLoading =
    loginEmailMut.isPending || signupMut.isPending || loginGoogleMut.isPending;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-md mx-auto">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="login">Entrar</TabsTrigger>
          <TabsTrigger value="signup">Criar conta</TabsTrigger>
        </TabsList>

        {/* ─── Tab Login ─── */}
        <TabsContent value="login" className="space-y-4 mt-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-email" className="text-xs">
                E-mail
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="login-email"
                  type="email"
                  placeholder="seu@email.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="login-password" className="text-xs">
                Senha
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isLoading || !loginEmail || !loginPassword}
            >
              {loginEmailMut.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Entrar
            </Button>
          </form>

          {googleConfig?.enabled && (
            <>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">ou</span>
                </div>
              </div>
              <div ref={googleBtnRef} className="flex justify-center min-h-[40px]" />
            </>
          )}
        </TabsContent>

        {/* ─── Tab Cadastro ─── */}
        <TabsContent value="signup" className="space-y-4 mt-6">
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="signup-name" className="text-xs">
                Nome completo
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="signup-name"
                  type="text"
                  placeholder="Seu nome"
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="name"
                  minLength={2}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signup-email" className="text-xs">
                E-mail
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="seu@email.com"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signup-password" className="text-xs">
                Senha (mínimo 6 caracteres)
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="signup-password"
                  type="password"
                  placeholder="••••••••"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  className="pl-9"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signup-password-confirm" className="text-xs">
                Confirmar senha
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="signup-password-confirm"
                  type="password"
                  placeholder="••••••••"
                  value={signupPasswordConfirm}
                  onChange={(e) => setSignupPasswordConfirm(e.target.value)}
                  className="pl-9"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>
              {signupPasswordConfirm.length > 0 && (
                <p
                  className={`text-[10px] flex items-center gap-1 ${
                    signupPassword === signupPasswordConfirm
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}
                >
                  {signupPassword === signupPasswordConfirm ? (
                    <>
                      <CheckCircle2 className="h-3 w-3" /> Senhas conferem
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3 w-3" /> Senhas diferentes
                    </>
                  )}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={
                isLoading ||
                !signupName ||
                !signupEmail ||
                !signupPassword ||
                signupPassword !== signupPasswordConfirm
              }
            >
              {signupMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar conta
            </Button>

            <p className="text-[10px] text-muted-foreground text-center">
              Ao se cadastrar, você concorda com os Termos de Uso e a Política de Privacidade.
            </p>
          </form>

          {googleConfig?.enabled && (
            <>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">ou</span>
                </div>
              </div>
              <div ref={googleBtnRef} className="flex justify-center min-h-[40px]" />
            </>
          )}
        </TabsContent>
      </Tabs>

      {!googleConfig?.enabled && (
        <p className="text-[10px] text-muted-foreground text-center mt-4">
          💡 Dica: configure <code className="font-mono">GOOGLE_CLIENT_ID</code> no servidor
          para habilitar login com Google.
        </p>
      )}
    </div>
  );
}
