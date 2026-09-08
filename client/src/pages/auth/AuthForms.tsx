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
import { UNAUTHED_ERR_MSG } from "@shared/const";
import {
  MENSAGEM_WHATSAPP_OBRIGATORIO,
  mascararTelefoneBR,
  normalizarWhatsappCadastro,
} from "@shared/telefone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Mail, Lock, User, AlertCircle, CheckCircle2, Phone } from "lucide-react";
import { toast } from "sonner";
import { TurnstileWidget, turnstileHabilitado } from "@/components/TurnstileWidget";

interface AuthFormsProps {
  /** Callback chamado quando o login/cadastro é bem sucedido. */
  onSuccess?: () => void;
  /** Aba inicial (default: "login") */
  defaultTab?: "login" | "signup";
  /** Email pré-preenchido (útil em fluxo de aceitar convite). */
  initialEmail?: string;
  /**
   * Token de convite quando este AuthForms está dentro do fluxo
   * `/convite/:token`. Quando presente, signup pula o email de confirmação
   * (o convite já é prova de posse do email) e aceita o convite junto
   * no mesmo procedure backend.
   */
  conviteToken?: string;
  /** Esconde o seletor de abas — usado pelas páginas /login e /cadastro,
   *  onde a troca de modo é navegação entre rotas, não tab. */
  hideTabs?: boolean;
}

// Tipo do Google Identity Services (não declaramos `window.google` global pra
// não conflitar com Google Maps em outros componentes — usamos cast local).
interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  prompt: () => void;
}

function getGoogleGIS(): GoogleAccountsId | null {
  const w = window as unknown as { google?: { accounts?: { id?: GoogleAccountsId } } };
  return w.google?.accounts?.id ?? null;
}

// Estado global pra evitar inicializar o Google SDK várias vezes (cada
// instância do AuthForms — Login modal, Cadastro modal — chamava initialize
// e o GSI loga warning sobre múltiplas inicializações).
let gisInitialized = false;
let gisCallback: ((response: { credential: string }) => void) | null = null;

export function AuthForms({ onSuccess, defaultTab = "login", initialEmail, conviteToken, hideTabs }: AuthFormsProps) {
  const [tab, setTab] = useState<"login" | "signup">(defaultTab);
  const utils = trpc.useUtils();

  // ─── Mutations ─────────────────────────────────────────────────────────────

  // Email pendente de confirmação (signup → tela "confirme seu email")
  const [emailPendenteConfirmacao, setEmailPendenteConfirmacao] = useState<string | null>(null);
  // Erro de login com email não confirmado: mostra CTA "reenviar email"
  const [emailNaoConfirmadoLogin, setEmailNaoConfirmadoLogin] = useState<string | null>(null);

  const signupMut = trpc.auth.signup.useMutation({
    onSuccess: async (data) => {
      if (data.needsConfirmation) {
        setEmailPendenteConfirmacao(data.email);
        toast.success("Cadastro recebido! Verifique seu email.");
      } else {
        // Fallback: legacy ou cenário sem confirmação
        toast.success("Conta criada com sucesso!");
        await utils.auth.me.invalidate();
        onSuccess?.();
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const reenviarConfirmacaoMut = trpc.auth.reenviarConfirmacao.useMutation({
    onSuccess: () => toast.success("Email reenviado. Verifique sua caixa de entrada."),
    onError: (e) => toast.error(e.message),
  });

  const loginEmailMut = trpc.auth.loginEmail.useMutation({
    onSuccess: async () => {
      toast.success("Bem-vindo de volta!");
      await utils.auth.me.invalidate();
      onSuccess?.();
    },
    onError: (e) => {
      // Erro específico: email não confirmado → expõe CTA pra reenviar.
      const motivo = (e.data as any)?.cause?.motivo;
      if (motivo === "email_nao_confirmado" || /confirme seu email/i.test(e.message)) {
        setEmailNaoConfirmadoLogin(loginEmail.trim().toLowerCase());
      }
      toast.error(e.message);
    },
  });

  // Conta nova pelo Google: o servidor NÃO cria a conta sem WhatsApp + aceite
  // e devolve `precisaWhatsapp`; o passo abaixo pede os dois e chama de novo
  // com o mesmo token do Google. Quem já tem conta nunca vê o passo.
  const [googlePendente, setGooglePendente] = useState<{ idToken: string; email: string; name: string } | null>(null);
  const [googleWhatsapp, setGoogleWhatsapp] = useState("");
  const [googleAceitou, setGoogleAceitou] = useState(false);

  const loginGoogleMut = trpc.auth.loginGoogle.useMutation({
    onSuccess: async (data, variables) => {
      if ("precisaWhatsapp" in data && data.precisaWhatsapp) {
        setGooglePendente({ idToken: variables.idToken, email: data.email, name: data.name });
        return;
      }
      setGooglePendente(null);
      toast.success("Login com Google realizado!");
      await utils.auth.me.invalidate();
      onSuccess?.();
    },
    onError: (e) => toast.error(e.message),
  });

  const concluirCadastroGoogle = () => {
    if (!googlePendente) return;
    const whatsapp = normalizarWhatsappCadastro(googleWhatsapp);
    if (!whatsapp) {
      toast.error(MENSAGEM_WHATSAPP_OBRIGATORIO);
      return;
    }
    if (!googleAceitou) {
      toast.error("Você precisa aceitar os Termos e a Política de Privacidade");
      return;
    }
    loginGoogleMut.mutate({ idToken: googlePendente.idToken, whatsapp, aceitouTermos: true });
  };

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

  // Inicializa o Google SDK uma única vez (global) e renderiza o botão local.
  // O callback é mantido em uma referência mutável global pra cada instância
  // do AuthForms poder injetar sua própria mutation sem reinicializar o SDK.
  useEffect(() => {
    if (!gisLoaded || !googleConfig?.clientId || !googleBtnRef.current) return;
    const gis = getGoogleGIS();
    if (!gis) return;

    // Atualiza o callback global apontando pra mutation desta instância
    gisCallback = (response: { credential: string }) => {
      if (response.credential) {
        loginGoogleMut.mutate({ idToken: response.credential, conviteToken });
      }
    };

    // Initialize só na primeira vez
    if (!gisInitialized) {
      gis.initialize({
        client_id: googleConfig.clientId,
        callback: (response: { credential: string }) => {
          gisCallback?.(response);
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      gisInitialized = true;
    }

    // Render do botão sempre roda (precisa do ref atual)
    gis.renderButton(googleBtnRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: tab === "login" ? "signin_with" : "signup_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: googleBtnRef.current.offsetWidth || 320,
    });
  }, [gisLoaded, googleConfig?.clientId, tab, loginGoogleMut, conviteToken]);

  // ─── Form state ────────────────────────────────────────────────────────────

  const [loginEmail, setLoginEmail] = useState(initialEmail || "");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState(initialEmail || "");
  // WhatsApp com DDD: obrigatório pra dono de escritório novo. Convidado de
  // um escritório não informa (decisão do dono) — o campo nem aparece.
  const [signupWhatsapp, setSignupWhatsapp] = useState("");
  const exigeWhatsapp = !conviteToken;
  const whatsappValido = !!normalizarWhatsappCadastro(signupWhatsapp);
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");
  const [aceitouTermos, setAceitouTermos] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

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
    if (!aceitouTermos) {
      toast.error("Você precisa aceitar os Termos e a Política de Privacidade");
      return;
    }
    const whatsapp = normalizarWhatsappCadastro(signupWhatsapp);
    if (exigeWhatsapp && !whatsapp) {
      toast.error(MENSAGEM_WHATSAPP_OBRIGATORIO);
      return;
    }
    // Lê plano escolhido na LP (persistido em sessionStorage pelo Pricing.tsx)
    let planoSlug: string | undefined;
    try {
      planoSlug = sessionStorage.getItem("planoEscolhido") || undefined;
    } catch {
      // sessionStorage bloqueado — ignora
    }
    if (turnstileHabilitado() && !turnstileToken) {
      toast.error("Só um segundo — confirmando que você não é um robô. Tente de novo.");
      return;
    }
    signupMut.mutate({
      name: signupName.trim(),
      email: signupEmail.trim().toLowerCase(),
      password: signupPassword,
      whatsapp: exigeWhatsapp ? (whatsapp ?? undefined) : undefined,
      aceitouTermos: true,
      planoSlug,
      conviteToken,
      turnstileToken: turnstileToken ?? undefined,
    });
  };

  const isLoading =
    loginEmailMut.isPending || signupMut.isPending || loginGoogleMut.isPending;

  // Mostra o motivo do último logout (ex: "Você foi removido do escritório").
  // Setado em main.tsx pelo handler de UNAUTHORIZED. Limpa após exibir
  // pra não ficar persistente entre logins.
  const [logoutMotivo, setLogoutMotivo] = useState<string | null>(null);
  useEffect(() => {
    try {
      const m = sessionStorage.getItem("logoutMotivo");
      if (m && m !== UNAUTHED_ERR_MSG) {
        setLogoutMotivo(m);
        sessionStorage.removeItem("logoutMotivo");
      }
    } catch {}
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  // Tela "Verifique seu email" — substitui o formulário após signup
  // bem-sucedido. Cliente precisa clicar no link no email pra continuar.
  if (emailPendenteConfirmacao) {
    return (
      <div className="w-full max-w-md mx-auto text-center space-y-4">
        <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Mail className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Verifique seu email</h2>
        <p className="text-sm text-muted-foreground">
          Enviamos um link de confirmação pra <strong>{emailPendenteConfirmacao}</strong>.
          Clique no link pra ativar sua conta. O link expira em 24 horas.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button
            variant="outline"
            disabled={reenviarConfirmacaoMut.isPending}
            onClick={() => reenviarConfirmacaoMut.mutate({ email: emailPendenteConfirmacao })}
          >
            {reenviarConfirmacaoMut.isPending ? "Enviando..." : "Reenviar email"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEmailPendenteConfirmacao(null)}>
            Voltar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto">
      {logoutMotivo && (
        <div className="mb-4 p-3 rounded-lg bg-warning-bg border border-warning/30 text-sm text-warning-fg dark:border-warning/30">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{logoutMotivo}</span>
          </div>
        </div>
      )}
      {emailNaoConfirmadoLogin && (
        <div className="mb-4 p-3 rounded-lg bg-warning-bg border border-warning/30 dark:border-warning/30">
          <div className="flex items-start gap-2 mb-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-warning-fg" />
            <span className="text-sm text-warning-fg">
              Confirme seu email antes de entrar. Não recebeu o link?
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={reenviarConfirmacaoMut.isPending}
            onClick={() => reenviarConfirmacaoMut.mutate({ email: emailNaoConfirmadoLogin })}
            className="ml-6"
          >
            {reenviarConfirmacaoMut.isPending ? "Enviando..." : "Reenviar email"}
          </Button>
        </div>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
        {!hideTabs && (
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Entrar</TabsTrigger>
            <TabsTrigger value="signup">Criar conta</TabsTrigger>
          </TabsList>
        )}

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
                  readOnly={!!initialEmail}
                  title={initialEmail ? "Email do convite — use este para aceitar" : undefined}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password" className="text-xs">
                  Senha
                </Label>
                <a href="/esqueci-senha" className="text-[11px] text-info-fg hover:underline">
                  Esqueci minha senha
                </a>
              </div>
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
                  readOnly={!!initialEmail}
                  title={initialEmail ? "Email do convite — use este para aceitar" : undefined}
                />
              </div>
            </div>

            {exigeWhatsapp && (
              <div className="space-y-1.5">
                <Label htmlFor="signup-whatsapp" className="text-xs">
                  WhatsApp (com DDD)
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="signup-whatsapp"
                    type="tel"
                    inputMode="tel"
                    placeholder="(85) 99123-4567"
                    value={signupWhatsapp}
                    onChange={(e) => setSignupWhatsapp(mascararTelefoneBR(e.target.value))}
                    className="pl-9"
                    required
                    autoComplete="tel-national"
                    maxLength={15}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  É por aqui que a gente fala com você sobre a conta e o plano.
                </p>
                {signupWhatsapp.length > 0 && !whatsappValido && (
                  <p className="text-[10px] flex items-center gap-1 text-danger-fg">
                    <AlertCircle className="h-3 w-3" /> {MENSAGEM_WHATSAPP_OBRIGATORIO}
                  </p>
                )}
              </div>
            )}

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
                      ? "text-success-fg"
                      : "text-danger-fg"
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

            <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={aceitouTermos}
                onChange={(e) => setAceitouTermos(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-info cursor-pointer"
                required
              />
              <span>
                Li e aceito os{" "}
                <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-info-fg hover:underline">
                  Termos de Uso
                </a>{" "}
                e a{" "}
                <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-info-fg hover:underline">
                  Política de Privacidade
                </a>
                , e declaro que o escritório é o responsável pelos dados de terceiros que inserir na plataforma.
              </span>
            </label>

            <TurnstileWidget onToken={setTurnstileToken} />

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={
                isLoading ||
                !signupName ||
                !signupEmail ||
                (exigeWhatsapp && !whatsappValido) ||
                !signupPassword ||
                signupPassword !== signupPasswordConfirm ||
                !aceitouTermos
              }
            >
              {signupMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar conta
            </Button>
            {!aceitouTermos && (
              <p className="text-center text-[10.5px] text-muted-foreground">
                marque o aceite acima pra habilitar o botão
              </p>
            )}
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

      {googleConfig && !googleConfig.enabled && (
        <p className="text-[10px] text-muted-foreground text-center mt-4">
          💡 Dica: configure <code className="font-mono">GOOGLE_CLIENT_ID</code> no servidor
          para habilitar login com Google.
        </p>
      )}

      {/* Passo do WhatsApp pra conta nova pelo Google — a conta só nasce depois daqui. */}
      <Dialog open={!!googlePendente} onOpenChange={(aberto) => { if (!aberto) setGooglePendente(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Falta só o seu WhatsApp</DialogTitle>
            <DialogDescription>
              Entrando como <strong>{googlePendente?.email}</strong>. É por aqui que a gente fala com
              você sobre a conta e o plano.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="google-whatsapp" className="text-xs">WhatsApp (com DDD)</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="google-whatsapp"
                  type="tel"
                  inputMode="tel"
                  placeholder="(85) 99123-4567"
                  value={googleWhatsapp}
                  onChange={(e) => setGoogleWhatsapp(mascararTelefoneBR(e.target.value))}
                  onKeyDown={(e) => { if (e.key === "Enter") concluirCadastroGoogle(); }}
                  className="pl-9"
                  autoComplete="tel-national"
                  maxLength={15}
                  autoFocus
                />
              </div>
              {googleWhatsapp.length > 0 && !normalizarWhatsappCadastro(googleWhatsapp) && (
                <p className="text-[10px] flex items-center gap-1 text-danger-fg">
                  <AlertCircle className="h-3 w-3" /> {MENSAGEM_WHATSAPP_OBRIGATORIO}
                </p>
              )}
            </div>
            <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={googleAceitou}
                onChange={(e) => setGoogleAceitou(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-info cursor-pointer"
              />
              <span>
                Li e aceito os{" "}
                <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-info-fg hover:underline">
                  Termos de Uso
                </a>{" "}
                e a{" "}
                <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-info-fg hover:underline">
                  Política de Privacidade
                </a>
                , e declaro que o escritório é o responsável pelos dados de terceiros que inserir na plataforma.
              </span>
            </label>
            <Button
              className="w-full"
              size="lg"
              disabled={loginGoogleMut.isPending || !normalizarWhatsappCadastro(googleWhatsapp) || !googleAceitou}
              onClick={concluirCadastroGoogle}
            >
              {loginGoogleMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar conta e entrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
