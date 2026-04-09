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
  Loader2, Plus, MessageCircle, Wifi, WifiOff, Eye, X,
  Bot, Plug, Shield, CheckCircle, AlertTriangle, Link2,
} from "lucide-react";
import { toast } from "sonner";
import WhatsappQR from "@/components/integracoes/WhatsappQR";

export function AsaasDialog({ open, onClose, canEdit, asaasStatus, onRefresh }: { open: boolean; onClose: () => void; canEdit: boolean; asaasStatus: any; onRefresh: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const conectarMut = trpc.asaas.conectar.useMutation({
    onSuccess: (data) => {
      toast.success(data.mensagem);
      setApiKey("");
      onRefresh();
    },
    onError: (err: any) => toast.error("Falha ao conectar", { description: err.message, duration: 10000 }),
  });

  const desconectarMut = trpc.asaas.desconectar.useMutation({
    onSuccess: () => { toast.success("Asaas desconectado"); onRefresh(); },
    onError: (err: any) => toast.error(err.message),
  });

  const syncMut = trpc.asaas.sincronizarClientes.useMutation({
    onSuccess: (data: any) => toast.success(`${data.vinculados} vinculados, ${data.novos} novos, ${data.removidos || 0} removidos`),
    onError: (err: any) => toast.error(err.message),
  });

  const reconfWebhookMut = (trpc as any).asaas?.reconfigurarWebhook?.useMutation?.({
    onSuccess: () => toast.success("Webhook reconfigurado! Eventos do Asaas chegarao em tempo real."),
    onError: (err: any) => toast.error("Falha ao reconfigurar webhook", { description: err.message }),
  }) || {};

  const conectado = asaasStatus?.conectado;

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

          {conectado ? (
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

// ─── WhatsApp CoEx (Coexistence) Dialog ────────────────────────────────────

export function WhatsAppCoExDialog({ open, onClose, canal, canEdit, onRefresh }: { open: boolean; onClose: () => void; canal?: any; canEdit: boolean; onRefresh: () => void }) {
  const [conectando, setConectando] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);

  const { data: waConfig } = (trpc as any).whatsappCoex?.getConfig?.useQuery?.(undefined, { retry: false, enabled: open }) || { data: null };
  const exchangeMut = (trpc as any).whatsappCoex?.exchangeCode?.useMutation?.({
    onSuccess: (data: any) => { toast.success(`WhatsApp CoEx conectado! ${data.nome || ""} ${data.telefone || ""}`); onRefresh(); setConectando(false); },
    onError: (e: any) => { toast.error(e.message); setConectando(false); },
  }) || {};
  const excluirMut = trpc.configuracoes.excluirCanal.useMutation({
    onSuccess: () => { toast.success("Canal desconectado"); onRefresh(); onClose(); },
  });

  // Carregar Facebook SDK
  useEffect(() => {
    if (!waConfig?.appId || sdkLoaded) return;
    if ((window as any).FB) { setSdkLoaded(true); return; }

    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({ appId: waConfig.appId, cookie: true, xfbml: true, version: "v21.0" });
      setSdkLoaded(true);
    };

    if (!document.getElementById("facebook-jssdk")) {
      const js = document.createElement("script");
      js.id = "facebook-jssdk";
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      js.defer = true;
      document.body.appendChild(js);
    }
  }, [waConfig?.appId, sdkLoaded]);

  // Listener para sessionInfo (WABA ID + Phone Number ID)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "WA_EMBEDDED_SIGNUP") {
          const wabaId = data.data?.waba_id || "";
          const phoneNumberId = data.data?.phone_number_id || "";
          if (wabaId || phoneNumberId) {
            (window as any).__wa_signup_data = { wabaId, phoneNumberId };
          }
        }
      } catch {}
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleConectar = () => {
    if (!waConfig?.appId) { toast.error("WhatsApp Cloud API nao configurada pelo administrador."); return; }
    const FB = (window as any).FB;
    if (!FB) { toast.error("Facebook SDK nao carregado. Recarregue a pagina."); return; }
    setConectando(true);
    (window as any).__wa_signup_data = null;

    const loginOptions: any = {
      response_type: "code",
      override_default_response_type: true,
      scope: "whatsapp_business_management,whatsapp_business_messaging",
      extras: {
        setup: {},
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      },
    };
    if (waConfig.configId) loginOptions.config_id = waConfig.configId;

    FB.login(function (response: any) {
      if (response.authResponse?.code) {
        const signupData = (window as any).__wa_signup_data || {};
        exchangeMut.mutate?.({
          code: response.authResponse.code,
          wabaId: signupData.wabaId || "",
          phoneNumberId: signupData.phoneNumberId || "",
        });
      } else {
        setConectando(false);
        toast.error("Conexao cancelada ou nao autorizada.");
      }
    }, loginOptions);
  };

  const conectado = canal?.status === "conectado";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-xl shadow">🔗</div>
            WhatsApp CoEx
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-teal-50 border border-teal-200 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-teal-800">Mantenha o WhatsApp no celular + receba mensagens no CRM</p>
            <p className="text-[11px] text-teal-700">Clique em Conectar - o Facebook abrira para voce autorizar. Nao precisa de dados tecnicos.</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge variant="outline" className="text-[9px] text-teal-700 border-teal-300">Sem banimento</Badge>
              <Badge variant="outline" className="text-[9px] text-teal-700 border-teal-300">Historico 6 meses</Badge>
              <Badge variant="outline" className="text-[9px] text-teal-700 border-teal-300">Oficial Meta</Badge>
            </div>
          </div>

          {conectado ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">Conectado</p>
                    <p className="text-xs text-emerald-600">{canal.telefone || canal.nome || "WhatsApp CoEx"}</p>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs text-destructive" onClick={() => { if (confirm("Desconectar WhatsApp CoEx?")) excluirMut.mutate({ canalId: canal.id }); }}>Desconectar</Button>
            </div>
          ) : !waConfig?.appId ? (
            <div className="text-center py-6 space-y-2">
              <AlertTriangle className="h-8 w-8 text-amber-400 mx-auto" />
              <p className="text-sm font-medium">WhatsApp nao configurado</p>
              <p className="text-xs text-muted-foreground">O administrador precisa configurar o WhatsApp Cloud API no painel Admin -&gt; Integracoes primeiro.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <Button className="w-full h-12 text-base bg-[#1877F2] hover:bg-[#166FE5]" onClick={handleConectar} disabled={conectando || !sdkLoaded}>
                {conectando ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : (
                  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                )}
                {conectando ? "Conectando..." : "Conectar com Facebook"}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">Voce sera redirecionado para o Facebook para autorizar a conexao do seu WhatsApp Business.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// ─── WhatsApp API Oficial Dialog ───────────────────────────────────────────

export function WhatsAppAPIDialog({ open, onClose, canal, canEdit, onRefresh }: { open: boolean; onClose: () => void; canal?: any; canEdit: boolean; onRefresh: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [nome, setNome] = useState("WhatsApp API");

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("WhatsApp API configurado!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("Configuração atualizada!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!phoneNumberId || !accessToken) { toast.error("Phone Number ID e Access Token são obrigatórios"); return; }
    const config = { phoneNumberId, accessToken, verifyToken, businessAccountId };
    if (canal) {
      atualizarMut.mutate({ canalId: canal.id, config });
    } else {
      criarMut.mutate({ tipo: "whatsapp_api", nome, config });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center text-xl shadow">🟢</div>
            WhatsApp API Oficial
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!canal && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Nome do canal</Label>
              <Input placeholder="WhatsApp API" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!canEdit} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Phone Number ID *</Label>
            <Input type="password" placeholder="123456789..." value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Access Token *</Label>
            <Input type="password" placeholder="EAAxxxxxxx..." value={accessToken} onChange={(e) => setAccessToken(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Verify Token</Label>
              <Input placeholder="token-verificacao" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Business Account ID</Label>
              <Input placeholder="987654321..." value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value)} disabled={!canEdit} />
            </div>
          </div>
          <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 p-3">
            <p className="text-xs text-green-700 font-medium">Como configurar</p>
            <p className="text-[11px] text-green-600 mt-1">Acesse <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline">developers.facebook.com</a> → Seu App → WhatsApp → API Setup. Copie Phone Number ID e Access Token permanente.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={!phoneNumberId || !accessToken || criarMut.isPending || atualizarMut.isPending || !canEdit}>
            {(criarMut.isPending || atualizarMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
            {canal ? "Atualizar" : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Instagram Dialog ──────────────────────────────────────────────────────

export function InstagramDialog({ open, onClose, canal, canEdit, onRefresh }: { open: boolean; onClose: () => void; canal?: any; canEdit: boolean; onRefresh: () => void }) {
  const [pageId, setPageId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [nome, setNome] = useState("Instagram");

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("Instagram conectado!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("Configuração atualizada!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!pageId || !accessToken) { toast.error("Page ID e Access Token são obrigatórios"); return; }
    const config = { pageId, accessToken };
    if (canal) {
      atualizarMut.mutate({ canalId: canal.id, config });
    } else {
      criarMut.mutate({ tipo: "instagram", nome, config });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center text-xl shadow">📸</div>
            Instagram — Direct Messages
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!canal && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Nome do canal</Label>
              <Input placeholder="Instagram" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!canEdit} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Page ID (Instagram Business) *</Label>
            <Input type="password" placeholder="ID da página do Instagram" value={pageId} onChange={(e) => setPageId(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Access Token (Meta) *</Label>
            <Input type="password" placeholder="Token de acesso Meta" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="rounded-lg bg-pink-50 dark:bg-pink-950/20 border border-pink-200 p-3">
            <p className="text-xs text-pink-700 font-medium">Pré-requisitos</p>
            <p className="text-[11px] text-pink-600 mt-1">Sua conta deve ser Instagram Business conectada a uma página do Facebook. Configure em <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline">developers.facebook.com</a> → Instagram Messaging API.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={!pageId || !accessToken || criarMut.isPending || atualizarMut.isPending || !canEdit}>
            {(criarMut.isPending || atualizarMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
            {canal ? "Atualizar" : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Facebook Messenger Dialog ─────────────────────────────────────────────

export function FacebookDialog({ open, onClose, canal, canEdit, onRefresh }: { open: boolean; onClose: () => void; canal?: any; canEdit: boolean; onRefresh: () => void }) {
  const [pageId, setPageId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [nome, setNome] = useState("Facebook Messenger");

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("Facebook Messenger conectado!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("Configuração atualizada!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!pageId || !accessToken) { toast.error("Page ID e Access Token são obrigatórios"); return; }
    const config = { pageId, accessToken };
    if (canal) {
      atualizarMut.mutate({ canalId: canal.id, config });
    } else {
      criarMut.mutate({ tipo: "facebook", nome, config });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-xl shadow">💙</div>
            Facebook Messenger
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!canal && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Nome do canal</Label>
              <Input placeholder="Facebook Messenger" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!canEdit} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Page ID *</Label>
            <Input type="password" placeholder="ID da página do Facebook" value={pageId} onChange={(e) => setPageId(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Access Token *</Label>
            <Input type="password" placeholder="Token de acesso da página" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 p-3">
            <p className="text-xs text-blue-700 font-medium">Como configurar</p>
            <p className="text-[11px] text-blue-600 mt-1">Acesse <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline">developers.facebook.com</a> → Seu App → Messenger → Settings. Gere um Page Access Token permanente.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={!pageId || !accessToken || criarMut.isPending || atualizarMut.isPending || !canEdit}>
            {(criarMut.isPending || atualizarMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
            {canal ? "Atualizar" : "Conectar"}
          </Button>
        </DialogFooter>
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

// ─── Cal.com Integration (standalone para aba perfil — mantida por compatibilidade) ──

export function CalcomIntegration({ canEdit }: { canEdit: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://cal.com");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);

  const testarMut = trpc.calcom.testarConexaoDireta.useMutation({
    onSuccess: (res: any) => { setTestResult(res); if (res.ok) toast.success(`Conectado como ${res.user}`); else toast.error(res.error || "Erro"); setTesting(false); },
    onError: (e: any) => { setTestResult({ ok: false, error: e.message }); toast.error(e.message); setTesting(false); },
  });

  const salvarMut = trpc.calcom.salvarConfigDireta.useMutation({
    onSuccess: (res: any) => { toast.success(`Cal.com salvo! Conectado como ${res.user}`); setSaving(false); setApiKey(""); },
    onError: (e: any) => { toast.error(e.message); setSaving(false); },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">API Key *</Label>
          <Input type="password" placeholder="cal_live_xxxxxxxxxxxxxxx" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Base URL</Label>
          <Input placeholder="https://cal.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={!canEdit} />
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => { setTesting(true); setTestResult(null); testarMut.mutate({ apiKey, baseUrl }); }} disabled={!apiKey || testing || !canEdit}>
          {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />} Testar
        </Button>
        {testResult?.ok && <Button size="sm" onClick={() => { setSaving(true); salvarMut.mutate({ apiKey, baseUrl }); }} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Salvar</Button>}
        {testResult && <span className={`text-xs ${testResult.ok ? "text-emerald-600" : "text-red-600"}`}>{testResult.ok ? `✓ ${testResult.user}` : testResult.error}</span>}
      </div>
    </div>
  );
}
