import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plug,
  Unplug,
  RefreshCw,
  ExternalLink,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Mail,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";

// ─── WhatsApp Cloud Form (3 campos) ────────────────────────────────────────

function WhatsAppCloudForm({ onConnect, isConnecting }: { onConnect: (json: string) => void; isConnecting: boolean }) {
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  const handleSubmit = () => {
    if (!appId || !appSecret || !verifyToken) { toast.error("Preencha os 3 campos"); return; }
    const json = JSON.stringify({ appId, appSecret, webhookVerifyToken: verifyToken });
    onConnect(json);
  };

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/whatsapp` : "/api/webhooks/whatsapp";

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">App ID *</Label>
        <Input placeholder="123456789012345" value={appId} onChange={(e) => setAppId(e.target.value)} className="font-mono text-sm" />
        <p className="text-[10px] text-muted-foreground">Meta Developers → seu app → Settings → Basic → App ID</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">App Secret *</Label>
        <Input type="password" placeholder="abc123def456..." value={appSecret} onChange={(e) => setAppSecret(e.target.value)} className="font-mono text-sm" />
        <p className="text-[10px] text-muted-foreground">Meta Developers → seu app → Settings → Basic → App Secret</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Webhook Verify Token *</Label>
        <Input placeholder="meu_token_seguro_123" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} className="font-mono text-sm" />
        <p className="text-[10px] text-muted-foreground">Defina um token. Use o mesmo em Meta App → WhatsApp → Configuration → Verify Token</p>
      </div>
      <div className="rounded-lg bg-muted/50 border p-3 space-y-1.5">
        <p className="text-xs font-semibold">Webhook URL (cole no Meta App):</p>
        <div className="flex items-center gap-2">
          <code className="text-[11px] bg-background px-2 py-1 rounded border flex-1 truncate">{webhookUrl}</code>
          <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("URL copiada!"); }}>Copiar</Button>
        </div>
      </div>
      <Button onClick={handleSubmit} disabled={isConnecting || !appId || !appSecret || !verifyToken} className="w-full">
        {isConnecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
        Conectar
      </Button>
    </div>
  );
}

// Logo SVG inline para cada integração
function IntegrationLogo({ id, className }: { id: string; className?: string }) {
  if (id === "whatsapp_cloud") {
    return (
      <div className={`flex items-center justify-center rounded-lg bg-emerald-600/10 ${className}`}>
        <span className="text-base">💬</span>
      </div>
    );
  }
  if (id === "asaas") {
    return (
      <div className={`flex items-center justify-center rounded-lg bg-sky-500/10 ${className}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" fill="#1969E5" />
          <path
            d="M12 6.5v11M9.5 9.2c0-1.1.9-2 2-2h1.5c1.1 0 2 .9 2 2 0 1-.7 1.7-1.6 1.9l-2.3.4c-1 .2-1.6.9-1.6 1.9 0 1.1.9 2 2 2H14c1.1 0 2-.9 2-2"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  }
  if (id === "openai") {
    return (
      <div className={`flex items-center justify-center rounded-lg bg-green-500/10 ${className}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="#10A37F" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z"/>
        </svg>
      </div>
    );
  }
  if (id === "resend") {
    return (
      <div className={`flex items-center justify-center rounded-lg bg-black/5 dark:bg-white/10 ${className}`}>
        <Mail className="h-4 w-4 text-foreground" />
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center rounded-lg bg-emerald-500/10 ${className}`}>
      <span className="text-base font-bold text-emerald-600">J</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "conectado") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25 hover:bg-emerald-500/15">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Conectado
      </Badge>
    );
  }
  if (status === "erro") {
    return (
      <Badge variant="destructive" className="font-normal">
        <XCircle className="h-3 w-3 mr-1" />
        Erro
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      <Unplug className="h-3 w-3 mr-1" />
      Desconectado
    </Badge>
  );
}

function IntegracaoCard({
  integracao,
  onRefresh,
}: {
  integracao: {
    id: string;
    nome: string;
    descricao: string;
    docUrl: string;
    services: string[];
    status: string;
    ultimoTeste: string | null;
    mensagemErro: string | null;
    apiKeyPreview: string | null;
  };
  onRefresh: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isRetesting, setIsRetesting] = useState(false);
  const [isConfigWebhook, setIsConfigWebhook] = useState(false);

  const configWebhookMutation = trpc.adminIntegracoes.configurarWebhookAsaas.useMutation({
    onSuccess: (res) => {
      toast.success("Webhook configurado!", { description: res.mensagem });
      onRefresh();
    },
    onError: (err) => {
      toast.error("Falha ao configurar webhook", { description: err.message });
    },
    onSettled: () => setIsConfigWebhook(false),
  });

  const handleConfigWebhook = () => {
    setIsConfigWebhook(true);
    configWebhookMutation.mutate({ baseUrl: window.location.origin });
  };

  const salvarMutation = trpc.adminIntegracoes.salvar.useMutation({
    onSuccess: () => {
      toast.success("Integração conectada com sucesso");
      setApiKey("");
      onRefresh();
    },
    onError: (err) => {
      toast.error("Falha ao conectar", {
        description: err.message,
        duration: 10000,
      });
    },
    onSettled: () => setIsConnecting(false),
  });

  const desconectarMutation = trpc.adminIntegracoes.desconectar.useMutation({
    onSuccess: () => {
      toast.success("Integração desconectada");
      onRefresh();
    },
    onError: (err) => {
      toast.error("Erro ao desconectar", { description: err.message });
    },
    onSettled: () => setIsDisconnecting(false),
  });

  const retestarMutation = trpc.adminIntegracoes.retestar.useMutation({
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Conexão OK", { description: res.mensagem });
      } else {
        toast.error("Falha na conexão", { description: res.mensagem });
      }
      onRefresh();
    },
    onError: (err) => {
      toast.error("Erro ao retestar", { description: err.message });
    },
    onSettled: () => setIsRetesting(false),
  });

  const handleConnect = (overrideKey?: string) => {
    const key = overrideKey || apiKey;
    if (!key.trim()) {
      toast.error("Insira a API key");
      return;
    }
    setIsConnecting(true);
    salvarMutation.mutate({ provedor: integracao.id, apiKey: key.trim() });
  };

  const handleDisconnect = () => {
    setIsDisconnecting(true);
    desconectarMutation.mutate({ provedor: integracao.id });
  };

  const handleRetest = () => {
    setIsRetesting(true);
    retestarMutation.mutate({ provedor: integracao.id });
  };

  const isConectado = integracao.status === "conectado";
  const isErro = integracao.status === "erro";

  return (
    <Card
      className={`transition-all flex flex-col h-full ${
        isConectado
          ? "border-emerald-500/30 shadow-sm"
          : isErro
          ? "border-destructive/30"
          : ""
      }`}
    >
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <IntegrationLogo id={integracao.id} className="h-8 w-8 shrink-0" />
            <CardTitle className="text-sm truncate">{integracao.nome}</CardTitle>
          </div>
          <a
            href={integracao.docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={integracao.status} />
        </div>
        <CardDescription className="text-xs line-clamp-2">
          {integracao.descricao}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 flex-1 flex flex-col">
        {/* Services tags — compactos */}
        <div className="flex flex-wrap gap-1">
          {integracao.services.slice(0, 4).map((s) => (
            <span
              key={s}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              {s}
            </span>
          ))}
        </div>

        {/* Se está conectado — mostra info e ações */}
        {isConectado && (
          <div className="space-y-2 pt-1 mt-auto">
            {/* Key preview */}
            {integracao.apiKeyPreview && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3 w-3 text-emerald-500" />
                <span className="font-mono text-[10px] truncate">
                  {integracao.apiKeyPreview}
                </span>
              </div>
            )}

            {/* Último teste */}
            {integracao.ultimoTeste && (
              <p className="text-[10px] text-muted-foreground">
                Testado{" "}
                {new Date(integracao.ultimoTeste).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}

            {/* Actions — compactas */}
            <div className="flex items-center gap-1 pt-1 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetest}
                disabled={isRetesting}
                className="text-[10px] h-7 px-2"
              >
                {isRetesting ? (
                  <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-2.5 w-2.5 mr-1" />
                )}
                Testar
              </Button>

              {/* Botão exclusivo do Asaas: configurar webhook automaticamente */}
              {integracao.id === "asaas" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConfigWebhook}
                  disabled={isConfigWebhook}
                  className="text-[10px] h-7 px-2"
                  title="Cadastra automaticamente o webhook do Jurify no painel do Asaas"
                >
                  {isConfigWebhook ? (
                    <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                  ) : (
                    <Plug className="h-2.5 w-2.5 mr-1" />
                  )}
                  Webhook
                </Button>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[10px] h-7 px-2 text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/50 hover:bg-destructive/5"
                    disabled={isDisconnecting}
                  >
                    {isDisconnecting ? (
                      <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                    ) : (
                      <Unplug className="h-2.5 w-2.5 mr-1" />
                    )}
                    Remover
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Desconectar {integracao.nome}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      A API key será removida do sistema. Você precisará inserir
                      uma nova key para reconectar. {integracao.id === "asaas" ? (
                        "Assinaturas ativas dos escritórios continuarão sendo cobradas pelo Asaas — o sistema só não poderá criar novas até reconectar."
                      ) : (
                        "Recursos ativos no provedor continuarão funcionando no lado deles, mas o sistema não poderá mais consultá-los."
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDisconnect}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        {/* Se está com erro — mostra mensagem e permite reconectar */}
        {isErro && (
          <div className="space-y-3 pt-1">
            {integracao.mensagemErro && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{integracao.mensagemErro}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetest}
                disabled={isRetesting}
                className="text-xs"
              >
                {isRetesting ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1.5" />
                )}
                Retestar conexão
              </Button>
            </div>
          </div>
        )}

        {/* Se está desconectado — mostra formulário para conectar */}
        {!isConectado && !isErro && (
          <div className="space-y-2 pt-1 mt-auto">
            {integracao.id === "whatsapp_cloud" ? (
              <WhatsAppCloudForm
                onConnect={(json) => handleConnect(json)}
                isConnecting={isConnecting}
              />
            ) : (
            <div className="space-y-1.5">
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder="Cole sua API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConnect();
                  }}
                  className="pr-8 font-mono text-xs h-8"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showKey ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </button>
              </div>
              <Button
                onClick={() => handleConnect()}
                disabled={isConnecting || !apiKey.trim()}
                className="w-full h-8 text-xs"
              >
                {isConnecting ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : (
                  <Plug className="h-3 w-3 mr-1.5" />
                )}
                Conectar
              </Button>
              <p className="text-[10px] text-muted-foreground">
                {integracao.id === "asaas" ? (
                  <>Cole a API key do <a
                      href="https://www.asaas.com/config/integracao"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >painel Asaas</a>. Sandbox/prod auto-detectado.</>
                ) : integracao.id === "openai" ? (
                  <>Cole uma key <code className="bg-muted px-1 rounded">sk-...</code> de <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >platform.openai.com</a>.</>
                ) : integracao.id === "resend" ? (
                  <>Cole uma key <code className="bg-muted px-1 rounded">re_...</code> de <a
                      href="https://resend.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >resend.com/api-keys</a>. Todos os escritórios usarão esta configuração para enviar convites de equipe.</>
                ) : (
                  <>Cole a key do <a
                      href={integracao.docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >painel do provedor</a>. Criptografada AES-256.</>
                )}
              </p>
            </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminIntegrations() {
  const {
    data: integracoes,
    isLoading,
    refetch,
  } = trpc.adminIntegracoes.listar.useQuery(undefined, { retry: false });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Integrações
        </h1>
        <p className="text-muted-foreground mt-1">
          Gerencie suas integrações com APIs externas. As chaves são
          criptografadas e a conexão persiste até você desconectar manualmente.
        </p>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <Skeleton className="h-10 w-10 rounded-lg" />
              <Skeleton className="h-5 w-32 mt-2" />
              <Skeleton className="h-4 w-64 mt-1" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      ) : integracoes && integracoes.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {integracoes.map((integ) => (
            <IntegracaoCard
              key={integ.id}
              integracao={{
                ...integ,
                ultimoTeste: integ.ultimoTeste ? String(integ.ultimoTeste) : null,
              }}
              onRefresh={() => refetch()}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Plug className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium text-foreground mb-2">
              Nenhuma integração disponível
            </p>
            <p className="text-sm text-center max-w-md">
              As integrações com APIs externas aparecerão aqui quando
              estiverem configuradas no sistema.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
