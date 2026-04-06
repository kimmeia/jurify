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

// Logo SVG inline para a Judit (verde institucional)
function IntegrationLogo({ id, className }: { id: string; className?: string }) {
  if (id === "whatsapp_cloud") {
    return (
      <div className={`flex items-center justify-center rounded-lg bg-emerald-600/10 ${className}`}>
        <span className="text-lg">💬</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center rounded-lg bg-emerald-500/10 ${className}`}>
      <span className="text-lg font-bold text-emerald-600">J</span>
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
      className={`transition-all ${
        isConectado
          ? "border-emerald-500/30 shadow-sm"
          : isErro
          ? "border-destructive/30"
          : ""
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <IntegrationLogo id={integracao.id} className="h-10 w-10 shrink-0" />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{integracao.nome}</CardTitle>
                <StatusBadge status={integracao.status} />
              </div>
              <CardDescription>{integracao.descricao}</CardDescription>
            </div>
          </div>
          <a
            href={integracao.docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Services tags */}
        <div className="flex flex-wrap gap-1.5">
          {integracao.services.map((s) => (
            <span
              key={s}
              className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              {s}
            </span>
          ))}
        </div>

        {/* Se está conectado — mostra info e ações */}
        {isConectado && (
          <div className="space-y-3 pt-1">
            {/* Key preview */}
            {integracao.apiKeyPreview && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span className="font-mono text-xs">
                  {integracao.apiKeyPreview}
                </span>
              </div>
            )}

            {/* Último teste */}
            {integracao.ultimoTeste && (
              <p className="text-xs text-muted-foreground">
                Último teste:{" "}
                {new Date(integracao.ultimoTeste).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
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
                Retestar
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/50 hover:bg-destructive/5"
                    disabled={isDisconnecting}
                  >
                    {isDisconnecting ? (
                      <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    ) : (
                      <Unplug className="h-3 w-3 mr-1.5" />
                    )}
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Desconectar {integracao.nome}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      A API key será removida do sistema. Você precisará inserir
                      uma nova key para reconectar. Monitoramentos ativos na
                      Judit continuarão funcionando no lado deles, mas o sistema
                      não poderá mais consultá-los.
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
          <div className="space-y-3 pt-1">
            {integracao.id === "whatsapp_cloud" ? (
              <WhatsAppCloudForm
                onConnect={(json) => handleConnect(json)}
                isConnecting={isConnecting}
              />
            ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                API Key
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder="Cole sua API key aqui"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConnect();
                    }}
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting || !apiKey.trim()}
                  className="shrink-0"
                >
                  {isConnecting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plug className="h-4 w-4 mr-2" />
                  )}
                  Conectar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                A key será criptografada (AES-256) antes de ser salva. Obtenha sua key no{" "}
                <a
                  href="https://plataforma.judit.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground transition-colors"
                >
                  painel da Judit
                </a>
                .
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
        <div className="grid gap-6 lg:grid-cols-2">
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
        <div className="grid gap-6 lg:grid-cols-2">
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
