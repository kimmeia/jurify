/**
 * Dialog unificado para conectar WhatsApp, Instagram ou Messenger.
 *
 * Fluxo: um único botão "Conectar com Facebook" abre o popup de OAuth do
 * Facebook com os escopos apropriados ao canal selecionado. Ao autorizar,
 * o `code` OAuth é enviado ao backend (metaChannels.connect*) que troca
 * por access_token, busca informações do canal e persiste criptografado.
 *
 * Diferença do padrão antigo:
 *   ✗ Antes: cliente precisava preencher App ID, Secret, Page ID, Access Token
 *     manualmente (conhecimento técnico profundo)
 *   ✓ Agora: 1 clique. Tudo é resolvido via Embedded Signup / Facebook Login.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, CheckCircle, AlertTriangle, Wifi, Unlink, KeyRound, FileText, UserCircle, Phone } from "lucide-react";
import { toast } from "sonner";
import { WhatsAppTemplatesDialog } from "./whatsapp-templates-dialog";
import { WhatsAppProfileDialog } from "./whatsapp-profile-dialog";
import { WhatsAppCallingDialog } from "./whatsapp-calling-dialog";

export type MetaChannelType = "whatsapp" | "instagram" | "messenger";

interface MetaConnectDialogProps {
  open: boolean;
  onClose: () => void;
  channel: MetaChannelType;
  canal?: any; // objeto do canal já conectado (se existir)
  onRefresh: () => void;
  canEdit?: boolean;
}

// ─── Metadata por canal ──────────────────────────────────────────────────────

const CHANNEL_META: Record<
  MetaChannelType,
  {
    title: string;
    emoji: string;
    gradient: string;
    description: string;
    benefits: string[];
    scope: string;
    featureType?: string;
  }
> = {
  whatsapp: {
    title: "WhatsApp Business",
    emoji: "💬",
    gradient: "from-emerald-500 to-green-600",
    description:
      "Conecte seu número de WhatsApp Business com a API oficial da Meta. Receba e envie mensagens direto pelo Inbox, sem risco de banimento.",
    benefits: ["API oficial Meta", "Sem risco de banimento", "Mensagens ilimitadas", "Chatbot e IA"],
    scope: "whatsapp_business_management,whatsapp_business_messaging",
    featureType: "whatsapp_business_app_onboarding",
  },
  instagram: {
    title: "Instagram Business",
    emoji: "📸",
    gradient: "from-pink-500 to-rose-600",
    description:
      "Receba e responda Direct Messages do Instagram Business. Pré-requisito: sua conta do Instagram precisa estar configurada como Business e vinculada a uma página do Facebook.",
    benefits: ["DMs no Inbox", "Resposta rápida", "Histórico completo", "Compatível com Stories"],
    scope: "instagram_basic,instagram_manage_messages,pages_show_list,pages_manage_metadata",
  },
  messenger: {
    title: "Facebook Messenger",
    emoji: "💙",
    gradient: "from-blue-500 to-indigo-600",
    description:
      "Conecte sua página do Facebook para receber mensagens do Messenger diretamente no Inbox.",
    benefits: ["Multi-páginas", "Botões interativos", "Notificações em tempo real", "Templates"],
    scope: "pages_messaging,pages_show_list,pages_manage_metadata",
  },
};

// ─── Componente ──────────────────────────────────────────────────────────────

export function MetaConnectDialog({
  open,
  onClose,
  channel,
  canal,
  onRefresh,
  canEdit = true,
}: MetaConnectDialogProps) {
  const meta = CHANNEL_META[channel];
  const [conectando, setConectando] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [pin, setPin] = useState("");
  const [subDialog, setSubDialog] = useState<"templates" | "perfil" | "ligacao" | null>(null);

  const { data: metaConfig } = trpc.metaChannels.getConfig.useQuery(undefined, {
    enabled: open,
    retry: false,
  });

  const connectWhatsAppMut = trpc.metaChannels.connectWhatsApp.useMutation({
    onSuccess: (d) => {
      toast.success(`WhatsApp conectado! ${d.nome || ""} ${d.telefone || ""}`);
      onRefresh();
      setConectando(false);
      onClose();
    },
    onError: (e: any) => {
      // Se for erro de redirect_uri, adiciona descrição com a URI que foi
      // tentada — usuário compara com o painel Meta Developers e ajusta.
      const uri = typeof window !== "undefined"
        ? window.location.href.split("?")[0].split("#")[0]
        : "";
      const isRedirectErr = /redirect_uri/i.test(e?.message || "");
      if (isRedirectErr && uri) {
        toast.error(e.message, {
          description: `URI enviada pelo navegador: ${uri}. Cadastre essa URI exata em "URIs de redirecionamento do OAuth válidos" no painel Meta Developers.`,
          duration: 15000,
        });
      } else {
        toast.error(e.message);
      }
      setConectando(false);
    },
  });

  const connectInstagramMut = trpc.metaChannels.connectInstagram.useMutation({
    onSuccess: (d) => {
      toast.success(`Instagram conectado! @${d.username}`);
      onRefresh();
      setConectando(false);
      onClose();
    },
    onError: (e: any) => {
      // Se for erro de redirect_uri, adiciona descrição com a URI que foi
      // tentada — usuário compara com o painel Meta Developers e ajusta.
      const uri = typeof window !== "undefined"
        ? window.location.href.split("?")[0].split("#")[0]
        : "";
      const isRedirectErr = /redirect_uri/i.test(e?.message || "");
      if (isRedirectErr && uri) {
        toast.error(e.message, {
          description: `URI enviada pelo navegador: ${uri}. Cadastre essa URI exata em "URIs de redirecionamento do OAuth válidos" no painel Meta Developers.`,
          duration: 15000,
        });
      } else {
        toast.error(e.message);
      }
      setConectando(false);
    },
  });

  const connectMessengerMut = trpc.metaChannels.connectMessenger.useMutation({
    onSuccess: (d) => {
      toast.success(`Messenger conectado! ${d.pageName}`);
      onRefresh();
      setConectando(false);
      onClose();
    },
    onError: (e: any) => {
      // Se for erro de redirect_uri, adiciona descrição com a URI que foi
      // tentada — usuário compara com o painel Meta Developers e ajusta.
      const uri = typeof window !== "undefined"
        ? window.location.href.split("?")[0].split("#")[0]
        : "";
      const isRedirectErr = /redirect_uri/i.test(e?.message || "");
      if (isRedirectErr && uri) {
        toast.error(e.message, {
          description: `URI enviada pelo navegador: ${uri}. Cadastre essa URI exata em "URIs de redirecionamento do OAuth válidos" no painel Meta Developers.`,
          duration: 15000,
        });
      } else {
        toast.error(e.message);
      }
      setConectando(false);
    },
  });

  const testConnMut = trpc.metaChannels.testConnection.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success("Conexão OK!");
      else toast.error("Falha no teste", { description: r.error });
      onRefresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const excluirMut = trpc.configuracoes.excluirCanal.useMutation({
    onSuccess: () => {
      toast.success("Canal desconectado");
      onRefresh();
      onClose();
    },
  });

  const registerMut = trpc.metaChannels.registerWhatsAppNumber.useMutation({
    onSuccess: () => {
      toast.success("Número registrado na Cloud API! Já pode enviar mensagens.");
      setPin("");
      onRefresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const subscribeMut = trpc.metaChannels.subscribeWebhooks.useMutation({
    onSuccess: () => {
      toast.success("Webhooks re-inscritos. Mensagens recebidas vão começar a chegar no Atendimento.");
      onRefresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ─── Carrega o Facebook SDK ────────────────────────────────────────────────

  useEffect(() => {
    if (!open || !metaConfig?.appId || sdkLoaded) return;
    if ((window as any).FB) {
      setSdkLoaded(true);
      return;
    }

    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId: metaConfig.appId,
        cookie: true,
        xfbml: true,
        version: "v21.0",
      });
      setSdkLoaded(true);
    };

    if (!document.getElementById("facebook-jssdk")) {
      const js = document.createElement("script");
      js.id = "facebook-jssdk";
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      js.defer = true;
      document.body.appendChild(js);
    }
  }, [open, metaConfig?.appId, sdkLoaded]);

  // Listener para sessionInfo do WhatsApp Embedded Signup
  useEffect(() => {
    if (channel !== "whatsapp") return;
    const handler = (event: MessageEvent) => {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      )
        return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "WA_EMBEDDED_SIGNUP") {
          const wabaId = data.data?.waba_id || "";
          const phoneNumberId = data.data?.phone_number_id || "";
          if (wabaId || phoneNumberId) {
            (window as any).__wa_signup_data = { wabaId, phoneNumberId };
          }
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [channel]);

  // ─── Trigger do login ──────────────────────────────────────────────────────

  const handleConectar = () => {
    if (!metaConfig?.appId) {
      toast.error("Meta API não configurada", {
        description: "O administrador precisa cadastrar o App Meta em Admin → Integrações.",
      });
      return;
    }
    const FB = (window as any).FB;
    if (!FB) {
      toast.error("Facebook SDK não carregado. Recarregue a página.");
      return;
    }
    setConectando(true);
    (window as any).__wa_signup_data = null;

    const loginOptions: any = {
      response_type: "code",
      override_default_response_type: true,
      scope: meta.scope,
    };

    // WhatsApp Embedded Signup usa config_id específico
    if (channel === "whatsapp") {
      loginOptions.extras = {
        setup: {},
        featureType: meta.featureType,
        sessionInfoVersion: "3",
      };
      if (metaConfig.configId) loginOptions.config_id = metaConfig.configId;
    }

    // Dois fluxos distintos determinam se passamos redirect_uri:
    //
    //  - Embedded Signup (WhatsApp com config_id): a Meta usa um
    //    redirect_uri INTERNO opaco no popup. Qualquer valor que a gente
    //    mande na troca do code dá mismatch. Portanto não enviamos nada —
    //    o backend omite o parâmetro no exchange.
    //
    //  - Facebook Login clássico (Instagram / Messenger, ou WhatsApp sem
    //    config_id): a Meta exige o mesmo redirect_uri usado no popup,
    //    que o SDK deriva de window.location.href (sem query/hash). A URL
    //    precisa estar cadastrada na lista de URIs válidos do painel.
    //
    // A presença de config_id em loginOptions é o sinal do fluxo.
    const isEmbeddedSignup = !!loginOptions.config_id;
    const redirectUri = isEmbeddedSignup
      ? undefined
      : typeof window !== "undefined"
        ? window.location.href.split("?")[0].split("#")[0]
        : undefined;
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.info(
        "[MetaConnect] fluxo =",
        isEmbeddedSignup ? "Embedded Signup" : "Facebook Login clássico",
        "| redirect_uri =",
        redirectUri ?? "<omitido>",
      );
    }

    FB.login(function (response: any) {
      if (!response.authResponse?.code) {
        setConectando(false);
        // FB.login não devolve `code` em cenários BEM diferentes: o usuário
        // fechou a janela, não aprovou as permissões, ou o login ficou
        // incompleto (ex.: confirmação em duas etapas pendente). Nenhum é uma
        // "falha" definitiva — todos são recuperáveis. Por isso não usamos um
        // erro vermelho genérico de "conexão cancelada", que assustava à toa.
        if (response?.status === "not_authorized") {
          toast.warning("Permissões não aprovadas", {
            description:
              "Você entrou no Facebook mas não aprovou as permissões. Tente de novo e autorize para conectar.",
          });
        } else {
          toast.warning("Conexão não concluída", {
            description:
              "O login no Facebook não foi finalizado (janela fechada ou aprovação pendente — ex.: confirmação em duas etapas). Pode tentar de novo.",
          });
        }
        return;
      }

      const code = response.authResponse.code;

      if (channel === "whatsapp") {
        const sig = (window as any).__wa_signup_data || {};
        connectWhatsAppMut.mutate({
          code,
          wabaId: sig.wabaId || "",
          phoneNumberId: sig.phoneNumberId || "",
          redirectUri,
        });
      } else if (channel === "instagram") {
        connectInstagramMut.mutate({ code, redirectUri });
      } else if (channel === "messenger") {
        connectMessengerMut.mutate({ code, redirectUri });
      }
    }, loginOptions);
  };

  // WhatsApp API: só é realmente conectado se tiver telefone verificado.
  // Conexões abortadas no meio do Embedded Signup deixam registro com
  // status="conectado" + telefone vazio — tratar como conexão incompleta.
  const whatsappIncompleto =
    channel === "whatsapp" &&
    canal?.status === "conectado" &&
    !canal?.telefone;
  // WhatsApp API: mesmo com telefone, a Cloud API exige POST /register
  // pra ativar envio de mensagens. Embedded Signup só vincula à WABA.
  const whatsappPrecisaRegistrar =
    channel === "whatsapp" &&
    canal?.status === "conectado" &&
    !!canal?.telefone &&
    !canal?.registradoCloudApi;
  const conectado =
    canal?.status === "conectado" && !whatsappIncompleto && !whatsappPrecisaRegistrar;
  const comErro = canal?.status === "erro" || whatsappIncompleto;
  const mensagemErro = whatsappIncompleto
    ? "Conexão não finalizada — o número WhatsApp não foi selecionado. Clique em Reconectar e complete o Embedded Signup até o fim."
    : canal?.mensagemErro;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div
              className={`h-10 w-10 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-xl shadow`}
            >
              {meta.emoji}
            </div>
            <div>
              <span>{meta.title}</span>
              {conectado && (
                <Badge className="ml-2 bg-emerald-500/15 text-emerald-700 border-emerald-500/25 text-[10px]">
                  <Wifi className="h-3 w-3 mr-1" />
                  Conectado
                </Badge>
              )}
              {comErro && (
                <Badge className="ml-2 bg-red-500/15 text-red-700 border-red-500/25 text-[10px]">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Erro
                </Badge>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Descrição e benefícios */}
          <p className="text-sm text-muted-foreground leading-relaxed">{meta.description}</p>

          <div className="flex flex-wrap gap-1.5">
            {meta.benefits.map((b) => (
              <Badge
                key={b}
                variant="outline"
                className="text-[10px] font-normal text-muted-foreground"
              >
                {b}
              </Badge>
            ))}
          </div>

          {/* Estado: conectado */}
          {conectado && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-800">Conectado</p>
                  <p className="text-xs text-emerald-600 truncate">
                    {canal?.telefone || canal?.nome || meta.title}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => testConnMut.mutate({ canalId: canal.id })}
                  disabled={testConnMut.isPending}
                >
                  {testConnMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                  )}
                  Testar conexão
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    if (confirm(`Desconectar ${meta.title}?`)) {
                      excluirMut.mutate({ canalId: canal.id });
                    }
                  }}
                >
                  <Unlink className="h-3.5 w-3.5 mr-1" />
                  Desconectar
                </Button>
              </div>
              {channel === "whatsapp" && (
                <>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setSubDialog("templates")}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1" />
                      Templates
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setSubDialog("perfil")}
                    >
                      <UserCircle className="h-3.5 w-3.5 mr-1" />
                      Perfil do número
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setSubDialog("ligacao")}
                    >
                      <Phone className="h-3.5 w-3.5 mr-1" />
                      Ligação
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => subscribeMut.mutate({ canalId: canal.id })}
                    disabled={subscribeMut.isPending}
                  >
                    {subscribeMut.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    ) : null}
                    Não está recebendo mensagens? Re-inscrever webhooks
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Estado: com erro */}
          {comErro && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <p className="text-sm font-medium text-red-800">Conexão falhou</p>
              </div>
              {mensagemErro && (
                <p className="text-xs text-red-700">{mensagemErro}</p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={handleConectar}
                disabled={conectando || !sdkLoaded}
              >
                Reconectar
              </Button>
            </div>
          )}

          {/* Estado: vinculado mas falta registrar na Cloud API */}
          {whatsappPrecisaRegistrar && !comErro && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-900">
                    Falta registrar na Cloud API
                  </p>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    O número{" "}
                    <code className="bg-amber-100 px-1 py-0.5 rounded">{canal?.telefone}</code>{" "}
                    foi vinculado à sua conta WhatsApp Business, mas a Meta exige uma
                    última etapa pra ativar o envio de mensagens: registrar o número
                    na Cloud API com um PIN de 6 dígitos (verificação em duas etapas).
                  </p>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Este PIN será o seu PIN de 2FA do WhatsApp Business — guarde-o em
                    local seguro. Se já definiu um PIN no WhatsApp Manager, use ele.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">PIN de 6 dígitos *</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="font-mono text-base tracking-widest text-center"
                />
              </div>
              <Button
                size="sm"
                className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => registerMut.mutate({ canalId: canal.id, pin })}
                disabled={registerMut.isPending || pin.length !== 6}
              >
                {registerMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4 mr-2" />
                )}
                Registrar na Cloud API
              </Button>
            </div>
          )}

          {/* Estado: Meta API não configurada pelo admin */}
          {!conectado && !comErro && !metaConfig?.appId && (
            <div className="text-center py-6 space-y-2">
              <AlertTriangle className="h-8 w-8 text-amber-400 mx-auto" />
              <p className="text-sm font-medium">Meta API não configurada</p>
              <p className="text-xs text-muted-foreground">
                O administrador do sistema precisa cadastrar o App Meta em
                <br />
                <strong>Admin → Integrações</strong> antes que você possa conectar.
              </p>
            </div>
          )}

          {/* Estado: pronto para conectar */}
          {!conectado && !comErro && metaConfig?.appId && (
            <div className="space-y-3">
              <Button
                className="w-full h-12 text-base bg-[#1877F2] hover:bg-[#166FE5] text-white"
                onClick={handleConectar}
                disabled={conectando || !sdkLoaded}
              >
                {conectando ? (
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="white">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                )}
                {conectando
                  ? "Conectando..."
                  : sdkLoaded
                    ? "Conectar com Facebook"
                    : "Carregando..."}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                Você será redirecionado para o Facebook para autorizar a conexão.
                Nenhuma senha é armazenada — apenas o token de acesso criptografado.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>

      {channel === "whatsapp" && canal?.id && (
        <>
          <WhatsAppTemplatesDialog
            open={subDialog === "templates"}
            onClose={() => setSubDialog(null)}
            canalId={canal.id}
            canEdit={canEdit}
          />
          <WhatsAppProfileDialog
            open={subDialog === "perfil"}
            onClose={() => setSubDialog(null)}
            canalId={canal.id}
            canEdit={canEdit}
          />
          <WhatsAppCallingDialog
            open={subDialog === "ligacao"}
            onClose={() => setSubDialog(null)}
            canalId={canal.id}
            canEdit={canEdit}
          />
        </>
      )}
    </Dialog>
  );
}
