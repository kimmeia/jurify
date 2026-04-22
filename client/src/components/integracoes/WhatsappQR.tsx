/**
 * Componente WhatsApp QR — Conexão via QR Code com Baileys
 * Usado dentro da aba "Canais" em Configuracoes.tsx e como dialog standalone
 */

import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  MessageCircle, Loader2, CheckCircle, XCircle, Wifi, WifiOff,
  RefreshCw, Power, Smartphone, Clock, AlertTriangle, QrCode, MessageSquareReply, Save,
} from "lucide-react";
import { toast } from "sonner";
import {
  WHATSAPP_STATUS_LABELS,
  WHATSAPP_STATUS_CORES,
  formatPhoneBR,
} from "@shared/whatsapp-types";
import type { WhatsappSessionStatus } from "@shared/whatsapp-types";

interface WhatsappQRProps {
  canalId: number;
  canalNome: string;
  statusInicial?: string;
}

export default function WhatsappQR({ canalId, canalNome, statusInicial }: WhatsappQRProps) {
  const [polling, setPolling] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Query: status da sessão (polling manual)
  const statusQuery = trpc.whatsapp.statusSessao.useQuery(
    { canalId },
    {
      enabled: polling,
      refetchInterval: polling ? 3000 : false, // Poll a cada 3s quando ativo
    },
  );

  const status = statusQuery.data?.status || (statusInicial as WhatsappSessionStatus) || "desconectado";
  const sessionInfo = statusQuery.data;

  // Mutation: iniciar sessão
  const iniciarSessao = trpc.whatsapp.iniciarSessao.useMutation({
    onSuccess: (data) => {
      setConnecting(false);
      setPolling(true); // Começar polling para obter QR
      if (data.status === "aguardando_qr") {
        toast.info("Escaneie o QR Code com seu WhatsApp");
      } else if (data.status === "conectado") {
        toast.success("WhatsApp conectado!");
        setPolling(false);
      }
    },
    onError: (err) => {
      setConnecting(false);
      toast.error("Erro ao iniciar WhatsApp", { description: err.message });
    },
  });

  // Mutation: desconectar
  const desconectarSessao = trpc.whatsapp.desconectarSessao.useMutation({
    onSuccess: () => {
      setDisconnecting(false);
      setPolling(false);
      toast.success("WhatsApp desconectado");
      statusQuery.refetch();
    },
    onError: (err) => {
      setDisconnecting(false);
      toast.error("Erro ao desconectar", { description: err.message });
    },
  });

  // Parar polling quando conectado ou erro
  useEffect(() => {
    if (status === "conectado" || status === "erro" || status === "banido") {
      setPolling(false);
    }
  }, [status]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleConectar = () => {
    setConnecting(true);
    iniciarSessao.mutate({ canalId });
  };

  const handleDesconectar = () => {
    setDisconnecting(true);
    desconectarSessao.mutate({ canalId });
  };

  const handleReconectar = () => {
    setPolling(false);
    setConnecting(true);
    iniciarSessao.mutate({ canalId });
  };

  // ─── Status Badge ────────────────────────────────────────────────────────

  const statusCores = WHATSAPP_STATUS_CORES[status] || WHATSAPP_STATUS_CORES.desconectado;
  const statusLabel = WHATSAPP_STATUS_LABELS[status] || "Desconhecido";

  // ─── Renderização por Estado ──────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header com status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-emerald-600" />
          <span className="font-medium text-sm">{canalNome}</span>
        </div>
        <Badge className={`${statusCores} border text-xs`}>
          {status === "conectado" && <Wifi className="h-3 w-3 mr-1" />}
          {status === "desconectado" && <WifiOff className="h-3 w-3 mr-1" />}
          {(status === "aguardando_qr" || status === "conectando") && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          {statusLabel}
        </Badge>
      </div>

      {/* Conteúdo principal baseado no status */}
      {status === "desconectado" && (
        <Card>
          <CardContent className="pt-6 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
              <Smartphone className="h-8 w-8 text-gray-400" />
            </div>
            <div>
              <p className="font-medium">WhatsApp não conectado</p>
              <p className="text-sm text-muted-foreground mt-1">
                Clique em conectar para gerar o QR Code e vincular seu WhatsApp Business
              </p>
            </div>
            <Button onClick={handleConectar} disabled={connecting} className="bg-emerald-600 hover:bg-emerald-700">
              {connecting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <QrCode className="h-4 w-4 mr-2" />
              )}
              Conectar WhatsApp
            </Button>
          </CardContent>
        </Card>
      )}

      {(status === "aguardando_qr" || status === "conectando") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <QrCode className="h-4 w-4 text-amber-600" />
              Escaneie o QR Code
            </CardTitle>
            <CardDescription className="text-xs">
              Abra o WhatsApp no celular → Menu (⋮) → Aparelhos Conectados → Conectar Aparelho
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center space-y-4">
            {sessionInfo?.qrCode ? (
              <div className="p-4 bg-white rounded-xl border-2 border-dashed border-emerald-200">
                {sessionInfo.qrCode.startsWith("data:image") ? (
                  <img
                    src={sessionInfo.qrCode}
                    alt="QR Code WhatsApp"
                    className="w-64 h-64 rounded-lg"
                  />
                ) : (
                  <div className="w-64 h-64 flex items-center justify-center bg-gray-50 rounded-lg">
                    <div className="text-center space-y-2">
                      <QrCode className="h-12 w-12 text-emerald-600 mx-auto" />
                      <p className="text-xs text-muted-foreground">
                        QR Code gerado — aguardando scan...
                      </p>
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground text-center mt-2">
                  O código é atualizado automaticamente a cada 30s
                </p>
              </div>
            ) : (
              <div className="w-64 h-64 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mx-auto" />
                  <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleReconectar} disabled={connecting}>
                <RefreshCw className="h-3 w-3 mr-1" /> Gerar Novo QR
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setPolling(false); }}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {status === "conectado" && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="font-medium text-sm">WhatsApp Conectado</p>
                {sessionInfo?.telefone && (
                  <p className="text-xs text-muted-foreground">
                    {formatPhoneBR(sessionInfo.telefone)}
                  </p>
                )}
                {sessionInfo?.nomeDispositivo && (
                  <p className="text-xs text-muted-foreground">{sessionInfo.nomeDispositivo}</p>
                )}
              </div>
            </div>

            {sessionInfo?.uptime !== undefined && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Conectado há {formatUptime(sessionInfo.uptime)}
              </div>
            )}

            <Separator />

            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={handleDesconectar} disabled={disconnecting}>
                {disconnecting ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Power className="h-3 w-3 mr-1" />
                )}
                Desconectar
              </Button>
              <Button variant="outline" size="sm" onClick={() => statusQuery.refetch()}>
                <RefreshCw className="h-3 w-3 mr-1" /> Atualizar Status
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {status === "erro" && (
        <Card className="border-red-200">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="font-medium text-sm text-red-700">Erro na Conexão</p>
                <p className="text-xs text-red-600 mt-0.5">
                  {sessionInfo?.mensagemErro || "Não foi possível conectar ao WhatsApp"}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={handleReconectar} disabled={connecting}>
                {connecting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Tentar Novamente
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {status === "banido" && (
        <Card className="border-red-300">
          <CardContent className="pt-6 text-center space-y-3">
            <XCircle className="h-10 w-10 text-red-600 mx-auto" />
            <div>
              <p className="font-medium text-red-700">Número Banido</p>
              <p className="text-xs text-muted-foreground mt-1">
                Este número foi banido pelo WhatsApp. Use a API Oficial (WhatsApp Business API) para evitar este problema.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto-reply fixo — texto enviado quando nenhum cenário do SmartFlow
          bate com a mensagem recebida. Sem IA automática fora do fluxo. */}
      <AutoReplyCard canalId={canalId} />
    </div>
  );
}

// ─── Auto-reply (fallback sem SmartFlow) ─────────────────────────────────────

const AUTOREPLY_MAX = 500;

function AutoReplyCard({ canalId }: { canalId: number }) {
  const [texto, setTexto] = useState("");
  const [carregado, setCarregado] = useState(false);

  const query = trpc.configuracoes.obterAutoReply.useQuery({ canalId });
  const mutation = trpc.configuracoes.atualizarAutoReply.useMutation({
    onSuccess: () => {
      toast.success("Resposta padrão salva");
      query.refetch();
    },
    onError: (err) => {
      toast.error("Não foi possível salvar", { description: err.message });
    },
  });

  // Carrega o valor inicial quando a query resolve
  useEffect(() => {
    if (query.data && !carregado) {
      setTexto(query.data.texto ?? "");
      setCarregado(true);
    }
  }, [query.data, carregado]);

  const valorOriginal = query.data?.texto ?? "";
  const dirty = texto !== valorOriginal;

  const handleSalvar = () => {
    const limpo = texto.trim();
    mutation.mutate({ canalId, texto: limpo ? limpo : null });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquareReply className="h-4 w-4 text-emerald-600" />
          Resposta padrão (fallback)
        </CardTitle>
        <CardDescription className="text-xs">
          Enviada quando o SmartFlow não tem cenário pra responder a mensagem.
          Deixe em branco pra não enviar nada (operador atende manual pelo Atendimento).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`autoreply-${canalId}`} className="text-xs">
            Mensagem
          </Label>
          <Textarea
            id={`autoreply-${canalId}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, AUTOREPLY_MAX))}
            placeholder="Ex: Olá! Recebemos sua mensagem. Em breve um de nossos atendentes vai responder."
            rows={4}
            disabled={query.isLoading || mutation.isPending}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Máx. {AUTOREPLY_MAX} caracteres</span>
            <span>{texto.length}/{AUTOREPLY_MAX}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSalvar}
            disabled={!dirty || mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            Salvar
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTexto(valorOriginal)}
              disabled={mutation.isPending}
            >
              Descartar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} min`;
  const hrs = Math.floor(min / 60);
  const restMin = min % 60;
  if (hrs < 24) return `${hrs}h ${restMin}min`;
  const days = Math.floor(hrs / 24);
  const restHrs = hrs % 24;
  return `${days}d ${restHrs}h`;
}
