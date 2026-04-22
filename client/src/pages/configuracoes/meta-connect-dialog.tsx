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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, CheckCircle, AlertTriangle, Wifi, Unlink } from "lucide-react";
import { toast } from "sonner";

export type MetaChannelType = "whatsapp" | "instagram" | "messenger";

interface MetaConnectDialogProps {
  open: boolean;
  onClose: () => void;
  channel: MetaChannelType;
  canal?: any; // objeto do canal já conectado (se existir)
  onRefresh: () => void;
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
}: MetaConnectDialogProps) {
  const meta = CHANNEL_META[channel];
  const [conectando, setConectando] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);

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

    // redirect_uri que o SDK usou internamente quando abriu o popup.
    // A Meta exige que o mesmo valor seja passado na troca do code no
    // backend (GET /oauth/access_token). Com "modo estrito para URIs"
    // ativo no painel, o match é caractere a caractere.
    //
    // O SDK do Facebook Login usa a URL COMPLETA da página chamadora
    // (sem query/hash) como redirect_uri — inclui o path onde o popup
    // foi aberto. Ex: se o popup abre em /configuracoes, o SDK registra
    // "https://app.com/configuracoes" e a Meta exige esse mesmo valor
    // no momento da troca.
    //
    // Por isso enviamos window.location.href limpo (sem query/hash).
    // Requer que a URL da página esteja cadastrada na lista de URIs
    // válidos do painel Meta Developers.
    const redirectUri = typeof window !== "undefined"
      ? window.location.href.split("?")[0].split("#")[0]
      : undefined;
    // Log ajuda o usuário a conferir qual URI está sendo enviada — útil
    // pra comparar com a lista cadastrada no painel Meta quando der erro.
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.info("[MetaConnect] redirect_uri =", redirectUri);
    }

    FB.login(function (response: any) {
      if (!response.authResponse?.code) {
        setConectando(false);
        toast.error("Conexão cancelada ou não autorizada.");
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
  const conectado = canal?.status === "conectado" && !whatsappIncompleto;
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
    </Dialog>
  );
}
