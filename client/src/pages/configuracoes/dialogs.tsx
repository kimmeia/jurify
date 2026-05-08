/**
 * Dialogs de configuração de canais e integrações.
 *
 * Extraídos de Configuracoes.tsx para manter o arquivo principal legível.
 * Cada componente é um Dialog independente que abre/fecha via prop `open`.
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Loader2, Plus, MessageCircle, Wifi, WifiOff, Eye, EyeOff, X,
  Bot, Plug, Shield, CheckCircle, AlertTriangle, Link2,
} from "lucide-react";
import { toast } from "sonner";
import WhatsappQR from "@/components/integracoes/WhatsappQR";

export function AsaasDialog({ open, onClose, canEdit, asaasStatus, onRefresh }: { open: boolean; onClose: () => void; canEdit: boolean; asaasStatus: any; onRefresh: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const conectarMut = trpc.asaas.conectar.useMutation({
    onSuccess: (data: any) => {
      // 429 → backend salvou key mas marcou aguardandoValidacao
      if (data.aguardandoValidacao) {
        toast.warning("Chave salva — Asaas em rate limit", {
          description: data.mensagem,
          duration: 12000,
        });
      } else {
        toast.success(data.mensagem);
      }
      setApiKey("");
      onRefresh();
    },
    onError: (err: any) => toast.error("Falha ao conectar", { description: err.message, duration: 10000 }),
  });

  const desconectarMut = trpc.asaas.desconectar.useMutation({
    onSuccess: () => { toast.success("Asaas desconectado"); onRefresh(); },
    onError: (err: any) => toast.error(err.message),
  });

  const validarAgoraMut = (trpc.asaas as any).validarAgora?.useMutation?.({
    onSuccess: (r: any) => {
      if (r.ok) {
        toast.success("Conexão validada — Asaas conectado!");
      } else if (r.status === "aguardando_validacao") {
        toast.warning("Ainda em rate limit", { description: r.mensagem, duration: 10000 });
      } else {
        toast.error("Validação falhou", { description: r.mensagem, duration: 10000 });
      }
      onRefresh();
    },
    onError: (err: any) => toast.error("Erro ao validar", { description: err.message }),
  }) || {};

  const syncMut = trpc.asaas.sincronizarClientes.useMutation({
    onSuccess: (data: any) => toast.success(`${data.vinculados} vinculados, ${data.novos} novos, ${data.removidos || 0} removidos`),
    onError: (err: any) => toast.error(err.message),
  });

  const reconfWebhookMut = (trpc as any).asaas?.reconfigurarWebhook?.useMutation?.({
    onSuccess: () => toast.success("Webhook reconfigurado! Eventos do Asaas chegarao em tempo real."),
    onError: (err: any) => toast.error("Falha ao reconfigurar webhook", { description: err.message }),
  }) || {};

  const conectado = asaasStatus?.conectado;
  const aguardandoValidacao = asaasStatus?.status === "aguardando_validacao";
  const erroConexao = asaasStatus?.status === "erro";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-xl shadow-md">💰</div>
            <div>
              <span>Asaas</span>
              {conectado && <Badge variant="outline" className="ml-2 text-[10px] text-emerald-600 bg-emerald-50 border-emerald-200"><Wifi className="h-3 w-3 mr-1" />Conectado</Badge>}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Conecte sua conta do Asaas para criar cobranças (boleto, Pix, cartão de crédito) e acompanhar o status financeiro dos seus clientes direto no CRM e Atendimento.
          </p>

          {aguardandoValidacao ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-amber-900 dark:text-amber-200 font-semibold">Aguardando validação</span>
                  <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px]">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Pendente
                  </Badge>
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Sua chave foi <strong>salva com sucesso</strong>, mas o Asaas está em
                  cota excedida (rate limit 12h). Vamos retentar automaticamente a cada
                  30min — você não precisa fazer nada.
                </p>
                {asaasStatus?.mensagemErro && (
                  <p className="text-[10px] text-amber-700/70 font-mono bg-amber-100/50 dark:bg-amber-900/20 p-1.5 rounded">
                    {asaasStatus.mensagemErro}
                  </p>
                )}
                {asaasStatus?.apiKeyPreview && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">API Key salva</span>
                    <span className="font-mono">{asaasStatus.apiKeyPreview}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => validarAgoraMut.mutate?.()}
                  disabled={validarAgoraMut.isPending}
                >
                  {validarAgoraMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plug className="h-3 w-3 mr-1" />}
                  Tentar validar agora
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs text-destructive hover:text-destructive"
                  onClick={() => { if (confirm("Remover chave Asaas salva?")) desconectarMut.mutate(); }}
                  disabled={desconectarMut.isPending}
                >
                  <WifiOff className="h-3 w-3 mr-1" />
                  Cancelar
                </Button>
              </div>
            </div>
          ) : conectado ? (
            <div className="space-y-3">
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25 hover:bg-emerald-500/15 text-[10px]">
                    <CheckCircle className="h-3 w-3 mr-1" />Conectado
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Modo</span>
                  <span className="text-xs font-medium">{asaasStatus.modo === "sandbox" ? "Sandbox (teste)" : "Produção"}</span>
                </div>
                {asaasStatus.apiKeyPreview && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">API Key</span>
                    <span className="text-xs font-mono">{asaasStatus.apiKeyPreview}</span>
                  </div>
                )}
                {asaasStatus.saldo && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Saldo</span>
                    <span className="text-xs font-medium">R$ {parseFloat(asaasStatus.saldo).toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
                  {syncMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Link2 className="h-3 w-3 mr-1" />}
                  Sincronizar clientes
                </Button>
                <Button variant="outline" size="sm" className="text-xs text-destructive hover:text-destructive" onClick={() => { if (confirm("Desconectar o Asaas? As cobranças existentes serão mantidas.")) desconectarMut.mutate(); }} disabled={desconectarMut.isPending}>
                  <WifiOff className="h-3 w-3 mr-1" />
                  Desconectar
                </Button>
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => reconfWebhookMut.mutate?.({ webhookUrl: window.location.origin })} disabled={reconfWebhookMut.isPending}>
                {reconfWebhookMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wifi className="h-3 w-3 mr-1" />}
                Reconfigurar Webhook (sync em tempo real)
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {erroConexao && asaasStatus?.mensagemErro && (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3">
                  <p className="text-xs font-semibold text-red-900 dark:text-red-200">Última tentativa falhou</p>
                  <p className="text-xs text-red-800 dark:text-red-200 mt-1">
                    {asaasStatus.mensagemErro}
                  </p>
                </div>
              )}
              <div>
                <Label className="text-xs">API Key do Asaas</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder="$aact_..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setShowKey(!showKey)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Gere sua API key em <strong>Minha Conta → Integrações</strong> no painel do Asaas. A key será criptografada (AES-256).
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => conectarMut.mutate({ apiKey: apiKey.trim(), webhookUrl: window.location.origin })}
                disabled={conectarMut.isPending || apiKey.trim().length < 10}
              >
                {conectarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
                Conectar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── WhatsApp QR Dialog ────────────────────────────────────────────────────

export function WhatsAppQRDialog({ open, onClose, canal, canEdit, isDono, onRefresh }: { open: boolean; onClose: () => void; canal?: any; canEdit: boolean; isDono: boolean; onRefresh: () => void }) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [newNome, setNewNome] = useState("");
  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("Canal WhatsApp criado!"); setNewNome(""); setShowNewForm(false); onRefresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-xl shadow">💬</div>
            WhatsApp — Conexão QR Code
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {canal ? (
            <WhatsappQR canalId={canal.id} canalNome={canal.nome || "WhatsApp"} statusInicial={canal.status} />
          ) : (
            <div className="text-center py-6 space-y-3">
              <MessageCircle className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">Nenhum canal WhatsApp QR configurado.</p>
              {canEdit && !showNewForm && (
                <Button size="sm" onClick={() => setShowNewForm(true)}><Plus className="h-4 w-4 mr-1" /> Criar Canal</Button>
              )}
            </div>
          )}
          {showNewForm && (
            <div className="space-y-3 p-4 border rounded-lg bg-muted/20">
              <div className="space-y-1.5">
                <Label>Nome do canal *</Label>
                <Input placeholder="WhatsApp Comercial" value={newNome} onChange={(e) => setNewNome(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => criarMut.mutate({ tipo: "whatsapp_qr", nome: newNome })} disabled={!newNome || criarMut.isPending}>
                  {criarMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Criar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNewForm(false)}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Twilio Dialog ──────────────────────────────────────────────────────────

export function TwilioDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const [sid, setSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const { data: canaisData, refetch } = trpc.configuracoes.listarCanais.useQuery();
  const twilioCanal = (canaisData?.canais || []).find((c: any) => c.tipo === "telefone_voip");

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("Twilio configurado com sucesso!"); refetch(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("Twilio atualizado!"); refetch(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!sid || !authToken || !phoneNumber) { toast.error("Preencha todos os campos"); return; }
    const config = { twilioSid: sid, twilioAuthToken: authToken, twilioPhoneNumber: phoneNumber };
    if (twilioCanal) {
      atualizarMut.mutate({ canalId: twilioCanal.id, config, telefone: phoneNumber });
    } else {
      criarMut.mutate({ tipo: "telefone_voip", nome: "Twilio VoIP", telefone: phoneNumber, config });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-xl shadow">📞</div>
            Twilio VoIP — Ligações
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Account SID *</Label>
            <Input type="password" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={sid} onChange={(e) => setSid(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Auth Token *</Label>
            <Input type="password" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={authToken} onChange={(e) => setAuthToken(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Número Twilio *</Label>
            <Input placeholder="+5585999990000" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} disabled={!canEdit} />
            <p className="text-[10px] text-muted-foreground">Número comprado no Twilio Console</p>
          </div>
          <div className="rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 p-3">
            <p className="text-xs text-purple-700 font-medium">Como obter credenciais</p>
            <p className="text-[11px] text-purple-600 mt-1">Acesse <a href="https://www.twilio.com/console" target="_blank" rel="noopener noreferrer" className="underline">twilio.com/console</a> → copie Account SID e Auth Token → compre um número em Phone Numbers.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={!sid || !authToken || !phoneNumber || criarMut.isPending || atualizarMut.isPending || !canEdit}>
            {(criarMut.isPending || atualizarMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
            {twilioCanal ? "Atualizar" : "Salvar (criptografado)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cal.com Dialog ─────────────────────────────────────────────────────────

export function CalcomDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://cal.com");
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);

  const testarMut = trpc.calcom.testarConexaoDireta.useMutation({
    onSuccess: (res: any) => { setTestResult(res); if (res.ok) toast.success(`Conectado como ${res.user}`); else toast.error(res.error); },
    onError: (e: any) => { setTestResult({ ok: false, error: e.message }); toast.error(e.message); },
  });

  const salvarMut = trpc.calcom.salvarConfigDireta.useMutation({
    onSuccess: (res: any) => { toast.success(`Cal.com salvo! Conectado como ${res.user}`); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-sky-600 flex items-center justify-center text-xl shadow">📅</div>
            Cal.com — Agendamento Online
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">API Key do Cal.com *</Label>
            <Input type="password" placeholder="cal_live_xxxxxxxxxxxxxxx" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={!canEdit} />
            <p className="text-[10px] text-muted-foreground">Gere em Cal.com → Settings → Security → API Keys</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Base URL</Label>
            <Input placeholder="https://cal.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={!canEdit} />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => { setTestResult(null); testarMut.mutate({ apiKey, baseUrl }); }} disabled={!apiKey || testarMut.isPending || !canEdit}>
              {testarMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
              Testar Conexão
            </Button>
            {testResult && (
              <span className={`text-xs flex items-center gap-1 ${testResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                {testResult.ok ? <><CheckCircle className="h-3 w-3" /> {testResult.user}</> : <><X className="h-3 w-3" /> {testResult.error}</>}
              </span>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvarMut.mutate({ apiKey, baseUrl })} disabled={!apiKey || salvarMut.isPending || !canEdit}>
            {salvarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Salvar e Conectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ChatGPT Dialog ─────────────────────────────────────────────────────────
//
// Armazena APENAS a API Key compartilhada da OpenAI para o escritório.
// Os agentes (com prompt, modelo, comportamento) são criados/gerenciados
// na aba "Agentes de IA". Esta tela é apenas pra cadastrar a credencial
// uma única vez por escritório.

export function ChatGPTDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const { data: canaisData, refetch } = trpc.configuracoes.listarCanais.useQuery();
  const chatgptCanal = (canaisData?.canais || []).find((c: any) => c.tipo === "chatgpt" || (c.tipo === "whatsapp_api" && (c.nome || "").includes("ChatGPT")));

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("Chave OpenAI salva! Agora crie agentes em 'Agentes de IA'."); refetch(); onClose(); setApiKey(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("Chave OpenAI atualizada!"); refetch(); onClose(); setApiKey(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!apiKey || apiKey.trim().length < 20) { toast.error("Informe uma API Key válida (sk-...)"); return; }
    // Mantém o canal como "ChatGPT Bot" mas só com a key — os agentes herdam dela
    const config = { openaiApiKey: apiKey.trim() };
    if (chatgptCanal) {
      atualizarMut.mutate({ canalId: chatgptCanal.id, config });
    } else {
      criarMut.mutate({ tipo: "chatgpt" as any, nome: "ChatGPT Bot", config });
    }
  };

  const conectado = !!chatgptCanal;
  const isPending = criarMut.isPending || atualizarMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center text-xl shadow">🤖</div>
            <div>
              <span>OpenAI / ChatGPT</span>
              {conectado && <Badge className="ml-2 bg-emerald-500/15 text-emerald-700 border-emerald-500/25 text-[10px]"><CheckCircle className="h-3 w-3 mr-1" />Configurada</Badge>}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Salve a sua chave da OpenAI uma única vez. Depois, crie e personalize
            seus agentes de IA (prompt, modelo, canal vinculado) na aba <strong>Agentes de IA</strong>.
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">API Key da OpenAI {conectado ? "(deixe vazio para manter a atual)" : "*"}</Label>
            <div className="flex gap-2">
              <Input
                type={showKey ? "text" : "password"}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!canEdit}
                className="font-mono text-sm"
              />
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setShowKey(!showKey)}>
                <Eye className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Gere em <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline">platform.openai.com/api-keys</a>.
              A chave é criptografada (AES-256-GCM) antes de ir pro banco.
            </p>
          </div>

          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 p-3 space-y-1">
            <p className="text-xs font-semibold text-blue-700">📌 Próximo passo</p>
            <p className="text-[11px] text-blue-600">
              Após salvar a chave, vá em <strong>Configurações → Agentes de IA</strong> para criar
              chatbots com prompts personalizados, vincular a canais (WhatsApp, Instagram) e ativar
              respostas automáticas.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={(!apiKey && !conectado) || isPending || !canEdit}>
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bot className="h-4 w-4 mr-2" />}
            {conectado ? "Atualizar chave" : "Salvar chave"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// CLAUDE (ANTHROPIC)
// ═══════════════════════════════════════════════════════════════════════════════

export function ClaudeDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const { data: canaisData, refetch } = trpc.configuracoes.listarCanais.useQuery();
  const claudeCanal = (canaisData?.canais || []).find((c: any) => c.tipo === "claude" || (c.nome || "").includes("Claude"));

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("Chave Claude (Anthropic) salva!"); refetch(); onClose(); setApiKey(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("Chave Claude atualizada!"); refetch(); onClose(); setApiKey(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!apiKey || apiKey.trim().length < 20) { toast.error("Informe uma API Key válida (sk-ant-...)"); return; }
    const config = { anthropicApiKey: apiKey.trim() };
    if (claudeCanal) {
      atualizarMut.mutate({ canalId: claudeCanal.id, config });
    } else {
      criarMut.mutate({ tipo: "claude" as any, nome: "Claude Anthropic", config });
    }
  };

  const conectado = !!claudeCanal;
  const isPending = criarMut.isPending || atualizarMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-xl shadow">🧠</div>
            <div>
              <span>Claude — Anthropic</span>
              {conectado && <Badge className="ml-2 bg-emerald-500/15 text-emerald-700 border-emerald-500/25 text-[10px]"><CheckCircle className="h-3 w-3 mr-1" />Configurada</Badge>}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Salve a chave da Anthropic para usar Claude nos agentes de IA.
            Modelos disponíveis: Claude Sonnet 4, Claude Haiku.
            Obtenha sua chave em <strong>console.anthropic.com</strong>.
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">API Key da Anthropic {conectado ? "(deixe vazio para manter)" : "*"}</Label>
            <div className="flex gap-2">
              <Input
                type={showKey ? "text" : "password"}
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!canEdit}
                className="font-mono text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={(!apiKey && !conectado) || isPending || !canEdit}>
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {conectado ? "Atualizar chave" : "Salvar chave"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
