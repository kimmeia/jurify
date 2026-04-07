import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { CustomerPanel } from "./atendimento/customer-panel";
import { DndContext, closestCenter, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor, useDroppable } from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Headphones, MessageCircle, Users, TrendingUp, BarChart3, Plus, Loader2, Send, Search, Phone, Mail, CheckCircle, XCircle, DollarSign, Inbox, PhoneCall, Percent, X, ExternalLink, Trash2, Calendar, Mic, Square, PlusCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { FinanceiroBadge, FinanceiroPopover } from "@/components/FinanceiroBadge";
import { STATUS_CONVERSA_LABELS, STATUS_CONVERSA_CORES, ETAPA_FUNIL_LABELS, ORIGEM_LABELS } from "@shared/crm-types";
import type { StatusConversa, EtapaFunil } from "@shared/crm-types";

function formatBRL(v: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v); }
function timeAgo(d: string) { if (!d) return ""; const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000); if (m < 1) return "agora"; if (m < 60) return m + "min"; const h = Math.floor(m / 60); if (h < 24) return h + "h"; return Math.floor(h / 24) + "d"; }
function initials(n: string) { return n.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase(); }

const EST: Record<EtapaFunil, { bg: string; border: string; header: string; dot: string }> = {
  novo: { bg: "bg-slate-50/80", border: "border-slate-200", header: "bg-slate-100", dot: "bg-slate-400" },
  qualificado: { bg: "bg-blue-50/80", border: "border-blue-200", header: "bg-blue-100", dot: "bg-blue-500" },
  proposta: { bg: "bg-violet-50/80", border: "border-violet-200", header: "bg-violet-100", dot: "bg-violet-500" },
  negociacao: { bg: "bg-amber-50/80", border: "border-amber-200", header: "bg-amber-100", dot: "bg-amber-500" },
  fechado_ganho: { bg: "bg-emerald-50/80", border: "border-emerald-200", header: "bg-emerald-100", dot: "bg-emerald-500" },
  fechado_perdido: { bg: "bg-red-50/80", border: "border-red-200", header: "bg-red-100", dot: "bg-red-400" },
};
const ETAPAS: EtapaFunil[] = ["novo", "qualificado", "proposta", "negociacao", "fechado_ganho", "fechado_perdido"];

function WhatsAppCallPopup({ phone, onClose }: { phone: string; onClose: () => void }) {
  const clean = phone.replace(/\D/g, "");
  useEffect(() => {
    window.open("https://wa.me/" + clean, "_blank");
  }, []);
  onClose();
  return null;
}

function TwilioCallPopup({ phone, onClose }: { phone: string; onClose: () => void }) {
  const clean = phone.replace(/\D/g, "");
  const [status, setStatus] = useState<"iniciando" | "discando" | "em_chamada" | "encerrada" | "erro">("iniciando");
  const [callSid, setCallSid] = useState<string | null>(null);
  const [dur, setDur] = useState(0);
  const [erroMsg, setErroMsg] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const iniciarMut = trpc.twilio.iniciarChamada.useMutation({
    onSuccess: (data) => {
      setCallSid(data.callSid || null);
      setStatus("discando");
    },
    onError: (e: any) => {
      setStatus("erro");
      setErroMsg(e.message || "Erro ao iniciar chamada");
    },
  });

  const statusMut = trpc.twilio.statusChamada.useMutation();
  const encerrarMut = trpc.twilio.encerrarChamada.useMutation({
    onSuccess: () => {
      setStatus("encerrada");
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    },
    onError: () => {
      // Se falhar ao encerrar via API, pelo menos fecha o popup
      setStatus("encerrada");
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    },
  });

  // Iniciar chamada ao montar
  useEffect(() => {
    iniciarMut.mutate({ destino: clean });
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Polling de status via tRPC mutation
  useEffect(() => {
    if (!callSid) return;
    pollRef.current = setInterval(() => {
      if (statusRef.current === "encerrada" || statusRef.current === "erro") {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      statusMut.mutate({ callSid }, {
        onSuccess: (data) => {
          const st = data.status;
          if ((st === "in-progress" || st === "ringing") && statusRef.current === "discando") {
            if (st === "in-progress") {
              setStatus("em_chamada");
              timerRef.current = setInterval(() => setDur(d => d + 1), 1000);
            }
          } else if (st === "in-progress" && statusRef.current !== "em_chamada") {
            setStatus("em_chamada");
            if (!timerRef.current) timerRef.current = setInterval(() => setDur(d => d + 1), 1000);
          } else if (["completed", "failed", "busy", "no-answer", "canceled"].includes(st)) {
            setStatus("encerrada");
            if (timerRef.current) clearInterval(timerRef.current);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        },
      });
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [callSid]);

  // Desligar: chama API do Twilio para encerrar a chamada de verdade
  const handleDesligar = () => {
    if (callSid && statusRef.current !== "encerrada" && statusRef.current !== "erro") {
      encerrarMut.mutate({ callSid });
    } else {
      setStatus("encerrada");
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    }
  };

  const fmt = (s: number) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");

  return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"><div className="bg-background rounded-2xl shadow-2xl w-[340px] p-8 text-center space-y-6">
    <div className={"h-20 w-20 rounded-full flex items-center justify-center mx-auto shadow-lg " + (status === "em_chamada" ? "bg-gradient-to-br from-green-500 to-emerald-600 animate-pulse" : "bg-gradient-to-br from-blue-500 to-blue-600")}><Phone className="h-10 w-10 text-white" /></div>
    <div>
      <p className="text-lg font-bold">+{clean}</p>
      <p className="text-sm text-muted-foreground mt-1">
        {status === "iniciando" ? "Conectando..." : status === "discando" ? "Discando..." : status === "em_chamada" ? fmt(dur) : status === "erro" ? "Erro na chamada" : "Chamada encerrada"}
      </p>
      {erroMsg && <p className="text-xs text-red-500 mt-2">{erroMsg}</p>}
    </div>
    {(status === "iniciando" || status === "discando") && <Loader2 className="h-6 w-6 animate-spin text-blue-500 mx-auto" />}
    <div className="flex justify-center gap-4">
      {status !== "encerrada" && status !== "erro" ? (
        <Button variant="destructive" size="lg" className="rounded-full h-14 w-14 p-0" onClick={handleDesligar} disabled={encerrarMut.isPending}>
          {encerrarMut.isPending ? <Loader2 className="h-6 w-6 animate-spin" /> : <Phone className="h-6 w-6 rotate-[135deg]" />}
        </Button>
      ) : (
        <Button variant="outline" onClick={onClose}>Fechar</Button>
      )}
    </div>
    <p className="text-[10px] text-muted-foreground">Twilio VoIP · Chamada real via API</p>
  </div></div>);
}

function IniciarConversaDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; onSuccess: (id: number) => void }) {
  const [tel, setTel] = useState(""); const [nome, setNome] = useState(""); const [msg, setMsg] = useState(""); const [canalId, setCanalId] = useState<number | null>(null);
  const { data: canais } = trpc.configuracoes.listarCanais.useQuery();
  const waCh = (canais?.canais || []).filter((c: any) => c.tipo === "whatsapp_qr" && c.status === "conectado");
  useEffect(() => { if (waCh.length > 0 && !canalId) setCanalId(waCh[0].id); }, [waCh, canalId]);
  const ini = trpc.crm.iniciarConversa.useMutation({ onSuccess: (r: any) => { toast.success("Conversa iniciada!"); onOpenChange(false); setTel(""); setNome(""); setMsg(""); onSuccess(r.conversaId); }, onError: (e: any) => toast.error(e.message) });
  return (<Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-600" /> Nova Conversa</DialogTitle></DialogHeader>
    <div className="space-y-3 py-2"><div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Telefone *</Label><Input placeholder="5585999990000" value={tel} onChange={(e) => setTel(e.target.value)} /></div><div className="space-y-1.5"><Label>Nome</Label><Input placeholder="Nome do contato" value={nome} onChange={(e) => setNome(e.target.value)} /></div></div>
    <div className="space-y-1.5"><Label>Mensagem *</Label><Input placeholder="Olá! Como posso ajudar?" value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
    {waCh.length === 0 && <p className="text-xs text-red-600">Nenhum WhatsApp conectado.</p>}</div>
    <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => { if (canalId && tel && msg) ini.mutate({ telefone: tel, nome: nome || undefined, mensagem: msg, canalId }); }} disabled={!tel || !msg || !canalId || ini.isPending}>{ini.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} Enviar</Button></DialogFooter>
  </DialogContent></Dialog>);
}

function NovoLeadDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void }) {
  const [nome, setNome] = useState(""); const [tel, setTel] = useState(""); const [valor, setValor] = useState(""); const [origem, setOrigem] = useState("");
  const criar = trpc.crm.criarContato.useMutation();
  const criarLead = trpc.crm.criarLead.useMutation({ onSuccess: () => { toast.success("Lead adicionado!"); onOpenChange(false); setNome(""); setTel(""); setValor(""); setOrigem(""); onSuccess(); }, onError: (e: any) => toast.error(e.message) });
  const handleCriar = async () => {
    if (!nome) { toast.error("Informe o nome"); return; }
    try {
      const contato = await criar.mutateAsync({ nome, telefone: tel || undefined, origem: "manual" as any });
      await criarLead.mutateAsync({ contatoId: contato.id, valorEstimado: valor || undefined, origemLead: origem || undefined });
    } catch (e: any) { toast.error(e.message); }
  };
  return (<Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-violet-600" /> Novo Lead</DialogTitle></DialogHeader>
    <div className="space-y-3 py-2">
      <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Nome *</Label><Input placeholder="Nome do lead" value={nome} onChange={(e) => setNome(e.target.value)} /></div><div className="space-y-1.5"><Label>Telefone</Label><Input placeholder="(85) 99999-0000" value={tel} onChange={(e) => setTel(e.target.value)} /></div></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Valor estimado</Label><Input placeholder="5000" value={valor} onChange={(e) => setValor(e.target.value)} /></div><div className="space-y-1.5"><Label>Origem</Label><Input placeholder="Indicação, Site..." value={origem} onChange={(e) => setOrigem(e.target.value)} /></div></div>
    </div>
    <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={handleCriar} disabled={!nome || criar.isPending || criarLead.isPending}>{(criar.isPending || criarLead.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />} Adicionar</Button></DialogFooter>
  </DialogContent></Dialog>);
}

function AddLeadFromConversaDialog({ open, onOpenChange, conversaId, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; conversaId: number; onSuccess: () => void }) {
  const [valor, setValor] = useState("");
  const criarLead = trpc.crm.criarLeadDeConversa.useMutation({
    onSuccess: () => { toast.success("Lead adicionado ao Pipeline!"); onOpenChange(false); setValor(""); onSuccess(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (<Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-violet-600" /> Adicionar ao Pipeline</DialogTitle></DialogHeader>
    <div className="space-y-3 py-2">
      <div className="space-y-1.5"><Label>Valor estimado (opcional)</Label><Input placeholder="5000" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
      <p className="text-xs text-muted-foreground">O contato desta conversa será adicionado como novo lead na etapa "Novo" do pipeline.</p>
    </div>
    <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => criarLead.mutate({ conversaId, valorEstimado: valor || undefined })} disabled={criarLead.isPending}>{criarLead.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlusCircle className="h-4 w-4 mr-2" />} Adicionar</Button></DialogFooter>
  </DialogContent></Dialog>);
}

function NovoContatoDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void }) {
  const [nome, setNome] = useState(""); const [tel, setTel] = useState(""); const [email, setEmail] = useState(""); const [orig, setOrig] = useState("manual");
  const criar = trpc.crm.criarContato.useMutation({ onSuccess: () => { toast.success("Contato criado!"); onOpenChange(false); setNome(""); setTel(""); setEmail(""); onSuccess(); }, onError: (e: any) => toast.error(e.message) });
  return (<Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Novo Contato</DialogTitle></DialogHeader><div className="space-y-3 py-2"><div className="space-y-1.5"><Label>Nome *</Label><Input placeholder="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} /></div><div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Telefone</Label><Input placeholder="(85) 99999-0000" value={tel} onChange={(e) => setTel(e.target.value)} /></div><div className="space-y-1.5"><Label>Email</Label><Input type="email" placeholder="email@..." value={email} onChange={(e) => setEmail(e.target.value)} /></div></div><div className="space-y-1.5"><Label>Origem</Label><Select value={orig} onValueChange={setOrig}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="whatsapp">WhatsApp</SelectItem><SelectItem value="instagram">Instagram</SelectItem><SelectItem value="facebook">Facebook</SelectItem><SelectItem value="telefone">Telefone</SelectItem><SelectItem value="site">Site</SelectItem></SelectContent></Select></div></div><DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => criar.mutate({ nome, telefone: tel || undefined, email: email || undefined, origem: orig as any })} disabled={!nome || criar.isPending}>{criar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Criar</Button></DialogFooter></DialogContent></Dialog>);
}

export default function Atendimento() {
  const [tab, setTab] = useState("inbox"); const [selId, setSelId] = useState<number | null>(null);
  const [showNovo, setShowNovo] = useState(false); const [showIniciar, setShowIniciar] = useState(false); const [showNovoLead, setShowNovoLead] = useState(false);
  const [busca, setBusca] = useState(""); const [filtro, setFiltro] = useState("todos");
  const [waPopup, setWaPopup] = useState<string | null>(null); const [telPopup, setTelPopup] = useState<string | null>(null);
  const { data: metricas } = trpc.crm.metricas.useQuery(undefined, { refetchInterval: 10000 });
  const { data: convs, refetch: rC } = trpc.crm.listarConversas.useQuery(filtro !== "todos" ? { status: filtro as StatusConversa } : undefined, { refetchInterval: 5000 });
  const { data: contatos, refetch: rCt } = trpc.crm.listarContatos.useQuery(busca ? { busca } : undefined);
  const { data: leads, refetch: rL } = trpc.crm.listarLeads.useQuery(undefined, { refetchInterval: 8000 });
  const { data: canaisData } = trpc.configuracoes.listarCanais.useQuery();

  const hasWhatsapp = (canaisData?.canais || []).some((c: any) => (c.tipo === "whatsapp_qr" || c.tipo === "whatsapp_api") && c.status === "conectado");
  const hasTwilio = (canaisData?.canais || []).some((c: any) => c.tipo === "telefone_voip" && (c.status === "conectado" || c.temConfig));

  const goToConversaFromLead = useCallback((conversaId: number) => {
    setSelId(conversaId);
    setTab("inbox");
  }, []);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-sky-100 to-blue-100 dark:from-sky-900/40 dark:to-blue-900/40"><Headphones className="h-6 w-6 text-sky-600" /></div>
        <div className="flex-1"><h1 className="text-2xl font-bold tracking-tight">Atendimento</h1><p className="text-sm text-muted-foreground">CRM — Inbox e Pipeline</p></div>
        <Button size="sm" onClick={() => setShowIniciar(true)} className="bg-emerald-600 hover:bg-emerald-700"><MessageCircle className="h-4 w-4 mr-1.5" /> Nova Conversa</Button>
      </div>
      {metricas && <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">{[{ v: metricas.totalContatos, l: "Contatos", c: "" }, { v: metricas.conversasAguardando, l: "Aguardando", c: "text-amber-600" }, { v: metricas.conversasAbertas, l: "Abertas", c: "text-blue-600" }, { v: metricas.leadsNovos, l: "Leads", c: "" }, { v: metricas.leadsGanhos, l: "Ganhos", c: "text-emerald-600" }, { v: formatBRL(metricas.valorPipeline), l: "Pipeline", c: "text-violet-600" }].map((k, i) => (<div key={i} className="rounded-lg border bg-card px-3 py-2 text-center"><p className={"text-lg font-bold leading-tight " + k.c}>{k.v}</p><p className="text-[10px] text-muted-foreground">{k.l}</p></div>))}</div>}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3 h-10">
          <TabsTrigger value="inbox" className="text-xs sm:text-sm gap-1.5"><Inbox className="h-3.5 w-3.5" /> Inbox</TabsTrigger>
          <TabsTrigger value="pipeline" className="text-xs sm:text-sm gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Pipeline</TabsTrigger>
          <TabsTrigger value="dashboard" className="text-xs sm:text-sm gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Dashboard</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox" className="mt-4">
          {/* Layout Customer 360: Lista | Chat | Painel contextual */}
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_320px] gap-4" style={{ minHeight: 600 }}>
            {/* Coluna 1: Lista de conversas */}
            <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
              <div className="p-3 border-b flex items-center gap-2">
                <p className="text-sm font-semibold flex-1">Conversas</p>
                <Select value={filtro} onValueChange={setFiltro}>
                  <SelectTrigger className="h-7 w-[110px] text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todas</SelectItem>
                    <SelectItem value="aguardando">Aguardando</SelectItem>
                    <SelectItem value="em_atendimento">Em atend.</SelectItem>
                    <SelectItem value="resolvido">Resolvido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ScrollArea className="flex-1">
                {!convs?.length ? (
                  <div className="text-center py-16 px-4">
                    <MessageCircle className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Nenhuma conversa</p>
                  </div>
                ) : (
                  convs.map((c: any) => (
                    <button
                      key={c.id}
                      className={
                        "w-full text-left px-3 py-3 border-b transition-all hover:bg-muted/40 " +
                        (selId === c.id
                          ? "bg-primary/5 border-l-[3px] border-l-primary"
                          : "border-l-[3px] border-l-transparent")
                      }
                      onClick={() => setSelId(c.id)}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          {initials(c.contatoNome || "?")}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium truncate">{c.contatoNome}</p>
                            <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                              {timeAgo(c.ultimaMensagemAt)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {c.ultimaMensagemPreview || "Sem mensagens"}
                          </p>
                          <div className="flex items-center gap-1 mt-1">
                            <Badge
                              variant="outline"
                              className={
                                "text-[9px] px-1.5 py-0 " +
                                (STATUS_CONVERSA_CORES[c.status as StatusConversa] || "")
                              }
                            >
                              {STATUS_CONVERSA_LABELS[c.status as StatusConversa]}
                            </Badge>
                            {(c as any).temAtraso && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1.5 py-0 bg-red-50 text-red-700 border-red-300 font-semibold"
                              >
                                ⚠ Atraso
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </ScrollArea>
            </div>

            {/* Coluna 2: Chat */}
            <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
              {selId ? (
                <ChatArea
                  cid={selId}
                  convs={convs || []}
                  onUpdate={rC}
                  onLeadUpdate={rL}
                  onWA={hasWhatsapp ? (p) => setWaPopup(p) : undefined}
                  onTel={hasTwilio ? (p) => setTelPopup(p) : undefined}
                  onDeleted={() => {
                    setSelId(null);
                    rC();
                  }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center min-h-[520px]">
                  <div className="text-center space-y-3">
                    <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto">
                      <MessageCircle className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                    <p className="text-sm text-muted-foreground">Selecione uma conversa</p>
                    <Button variant="outline" size="sm" onClick={() => setShowIniciar(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Iniciar nova
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Coluna 3: Customer 360 Panel */}
            <div className="rounded-xl border bg-card overflow-hidden flex flex-col max-h-[calc(100vh-12rem)]">
              {(() => {
                const convAtual = (convs || []).find((c: any) => c.id === selId);
                if (!selId || !convAtual?.contatoId) {
                  return (
                    <div className="flex-1 flex items-center justify-center p-6">
                      <div className="text-center space-y-2">
                        <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
                          <Users className="h-6 w-6 text-muted-foreground/30" />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Selecione uma conversa para ver o perfil do cliente
                        </p>
                      </div>
                    </div>
                  );
                }
                return (
                  <CustomerPanel
                    contatoId={convAtual.contatoId}
                    onOpenWhatsapp={
                      hasWhatsapp
                        ? (p) => setWaPopup(p || convAtual.contatoTelefone)
                        : undefined
                    }
                  />
                );
              })()}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="pipeline" className="mt-4"><PipelineKanban leads={leads || []} onUpdate={rL} onWA={hasWhatsapp ? (p) => setWaPopup(p) : undefined} onAddLead={() => setShowNovoLead(true)} onGoToConversa={goToConversaFromLead} /></TabsContent>
        <TabsContent value="dashboard" className="mt-4"><DashboardAtendimento /></TabsContent>
      </Tabs>
      {waPopup && <WhatsAppCallPopup phone={waPopup} onClose={() => setWaPopup(null)} />}
      {telPopup && <TwilioCallPopup phone={telPopup} onClose={() => setTelPopup(null)} />}
      <IniciarConversaDialog open={showIniciar} onOpenChange={setShowIniciar} onSuccess={(id) => { setSelId(id); setTab("inbox"); rC(); }} />
      <NovoLeadDialog open={showNovoLead} onOpenChange={setShowNovoLead} onSuccess={rL} />
    </div>
  );
}

/** Alerta financeiro no chat — verifica CPF do contato no Asaas */
function AlertaFinanceiroChat({ contatoId, contatoNome }: { contatoId: number; contatoNome: string }) {
  const { data: asaasStatus } = trpc.asaas.status.useQuery(undefined, { retry: false });
  const { data: resumo } = trpc.asaas.resumoContato.useQuery(
    { contatoId },
    { retry: false, enabled: !!asaasStatus?.conectado && !!contatoId }
  );

  if (!asaasStatus?.conectado || !resumo?.vinculado) return null;

  const vencido = resumo.vencido || 0;
  const pendente = resumo.pendente || 0;
  const total = vencido + pendente;

  if (total <= 0) return null;

  const formatBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  if (vencido > 0) {
    return (
      <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-red-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-red-700">{contatoNome} tem {formatBRL(vencido)} vencido{pendente > 0 ? ` + ${formatBRL(pendente)} pendente` : ""}</p>
          {resumo.cobrancas && resumo.cobrancas.length > 0 && (
            <p className="text-[10px] text-red-600 mt-0.5">
              {resumo.cobrancas.filter((c: any) => c.status === "OVERDUE").length} cobranca(s) vencida(s)
              {resumo.cobrancas.filter((c: any) => c.status === "PENDING").length > 0 && `, ${resumo.cobrancas.filter((c: any) => c.status === "PENDING").length} pendente(s)`}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2">
      <DollarSign className="h-4 w-4 text-amber-500 shrink-0" />
      <p className="text-xs font-medium text-amber-700 flex-1">{contatoNome} tem {formatBRL(pendente)} pendente</p>
    </div>
  );
}

function ChatArea({ cid, convs, onUpdate, onLeadUpdate, onWA, onTel, onDeleted }: { cid: number; convs: any[]; onUpdate: () => void; onLeadUpdate: () => void; onWA?: (p: string) => void; onTel?: (p: string) => void; onDeleted: () => void }) {
  const [msg, setMsg] = useState(""); const ref = useRef<HTMLDivElement>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showAgendar, setShowAgendar] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const { data: tplList } = (trpc as any).templates?.listar?.useQuery?.(undefined, { retry: false }) || { data: [] };
  const conv = convs.find((c: any) => c.id === cid);
  const { data: msgs, refetch } = trpc.crm.listarMensagens.useQuery({ conversaId: cid }, { refetchInterval: 3000 });
  const enviar = trpc.crm.enviarMensagem.useMutation({ onSuccess: () => { setMsg(""); refetch(); onUpdate(); }, onError: (e: any) => toast.error(e.message) });
  const atualizar = trpc.crm.atualizarConversa.useMutation({ onSuccess: () => { onUpdate(); toast.success("Atualizado!"); } });
  const excluir = trpc.crm.excluirConversa.useMutation({ onSuccess: () => { toast.success("Conversa excluída."); onDeleted(); }, onError: (e: any) => toast.error(e.message) });
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [msgs]);
  const send = () => { if (msg.trim()) enviar.mutate({ conversaId: cid, conteudo: msg.trim() }); };

  const handleDelete = () => {
    if (confirm("Excluir esta conversa e todas as mensagens? Esta ação não pode ser desfeita.")) {
      excluir.mutate({ id: cid });
    }
  };

  const renderMsgContent = (m: any) => {
    const content = m.conteudo || "";
    const mediaUrl = m.mediaUrl || "";
    
    // Extract media URL from content if embedded as [media:/path]
    const mediaMatch = content.match(/\[media:(\/[^\]]+)\]/);
    const resolvedMedia = mediaUrl || (mediaMatch ? mediaMatch[1] : "");
    const cleanContent = content.replace(/\n?\[media:[^\]]+\]/, "").trim();

    if (m.tipo === "audio") {
      return (<div className="space-y-1">
        {resolvedMedia ? (
          <audio controls className="max-w-[240px] h-8" src={resolvedMedia} />
        ) : (
          <div className="flex items-center gap-2"><Mic className="h-3.5 w-3.5 opacity-60" /><span className="text-[13px]">🎵 Áudio</span></div>
        )}
        {cleanContent && !cleanContent.startsWith("🎵") && <p className="text-[11px] opacity-60">{cleanContent}</p>}
      </div>);
    }
    if (m.tipo === "imagem") {
      return (<div className="space-y-1">
        {resolvedMedia ? (
          <img src={resolvedMedia} alt="Imagem" className="max-w-[240px] max-h-[200px] rounded-lg object-cover cursor-pointer" onClick={() => window.open(resolvedMedia, "_blank")} />
        ) : (
          <p className="text-[13px]">📷 Imagem</p>
        )}
        {cleanContent && !cleanContent.startsWith("📷") && <p className="text-[11px] opacity-80">{cleanContent}</p>}
      </div>);
    }
    if (m.tipo === "video") {
      return (<div><p className="text-[13px]">🎥 {cleanContent || "Vídeo"}</p></div>);
    }
    if (m.tipo === "documento") {
      return (<div>
        {resolvedMedia ? (
          <a href={resolvedMedia} target="_blank" rel="noopener noreferrer" className="text-[13px] underline">📄 {cleanContent || "Documento"}</a>
        ) : (
          <p className="text-[13px]">📄 {cleanContent || "Documento"}</p>
        )}
      </div>);
    }
    if (m.tipo === "localizacao") return (<p className="text-[13px]">📍 {cleanContent || "Localização"}</p>);
    if (m.tipo === "contato") return (<p className="text-[13px]">👤 {cleanContent || "Contato"}</p>);
    if (m.tipo === "sticker") return (<p className="text-[13px]">🏷️ Sticker</p>);
    return <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{content}</p>;
  };

  return (<>
    {/* Header linha 1: contato */}
    <div className="px-4 py-2.5 border-b">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-xs font-bold text-primary shrink-0">{initials(conv?.contatoNome || "?")}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold truncate">{conv?.contatoNome || "Contato"}</p>
            <Badge variant="outline" className={"text-[9px] px-1 py-0 " + (STATUS_CONVERSA_CORES[conv?.status as StatusConversa] || "")}>{STATUS_CONVERSA_LABELS[conv?.status as StatusConversa] || conv?.status}</Badge>
            {conv?.contatoId && <FinanceiroBadge contatoId={conv.contatoId} />}
          </div>
          {conv?.contatoTelefone && <p className="text-[10px] text-muted-foreground">{conv.contatoTelefone}</p>}
        </div>
        {conv?.contatoTelefone && (onWA || onTel) && (
          <div className="flex items-center gap-1 shrink-0">
            {onWA && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600" title="WhatsApp" onClick={() => onWA(conv.contatoTelefone)}><PhoneCall className="h-3.5 w-3.5" /></Button>}
            {onTel && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600" title="Ligar" onClick={() => onTel(conv.contatoTelefone)}><Phone className="h-3.5 w-3.5" /></Button>}
          </div>
        )}
      </div>
      {/* Header linha 2: acoes */}
      <div className="flex items-center gap-1 mt-1.5 -mb-0.5 overflow-x-auto">
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-violet-600 shrink-0" onClick={() => setShowAddLead(true)}><TrendingUp className="h-3 w-3 mr-1" />Pipeline</Button>
        {conv?.contatoId && <FinanceiroPopover contatoId={conv.contatoId} />}
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-blue-600 shrink-0" onClick={() => setShowAgendar(true)}><Calendar className="h-3 w-3 mr-1" />Agendar</Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-emerald-600 shrink-0" onClick={() => atualizar.mutate({ id: cid, status: "resolvido" })}><CheckCircle className="h-3 w-3 mr-1" />Resolver</Button>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 shrink-0" onClick={() => atualizar.mutate({ id: cid, status: "fechado" })}><XCircle className="h-3 w-3 mr-1" />Fechar</Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive shrink-0" title="Excluir" onClick={handleDelete}><Trash2 className="h-3 w-3" /></Button>
      </div>
    </div>
    {/* Alerta financeiro */}
    {conv?.contatoId && <AlertaFinanceiroChat contatoId={conv.contatoId} contatoNome={conv.contatoNome} />}
    <div ref={ref} className="flex-1 overflow-y-auto p-4 space-y-2" style={{ minHeight: 360, maxHeight: 420 }}>{!msgs?.length ? <p className="text-xs text-muted-foreground text-center py-12">Nenhuma mensagem ainda.</p> : msgs.map((m: any) => (<div key={m.id} className={"flex " + (m.direcao === "saida" ? "justify-end" : "justify-start")}><div className={"max-w-[70%] rounded-2xl px-3.5 py-2 " + (m.direcao === "saida" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md")}>{m.remetenteNome && m.direcao === "saida" && <p className="text-[10px] opacity-60 mb-0.5">{m.remetenteNome}</p>}{renderMsgContent(m)}<p className={"text-[10px] mt-1 text-right " + (m.direcao === "saida" ? "opacity-50" : "text-muted-foreground")}>{new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p></div></div>))}</div>
    <div className="p-3 border-t flex gap-2 bg-muted/20">
      <Popover open={showTemplates} onOpenChange={setShowTemplates}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0 shrink-0" title="Respostas rapidas"><Zap className="h-4 w-4" /></Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start" side="top">
          <p className="text-xs font-medium px-2 pb-1.5 text-muted-foreground">Respostas rapidas</p>
          {tplList && tplList.length > 0 ? (
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {tplList.map((t: any) => (
                <div key={t.id} className="rounded-md px-2 py-1.5 cursor-pointer hover:bg-muted text-sm transition-colors" onClick={() => { setMsg(t.conteudo); setShowTemplates(false); }}>
                  <p className="font-medium text-xs">{t.titulo}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{t.conteudo}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-3">Nenhum template. Crie em Configuracoes.</p>
          )}
        </PopoverContent>
      </Popover>
      <Input placeholder="Digite sua mensagem..." value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} className="bg-background" />
      <AudioRecordButton onSend={(text) => enviar.mutate({ conversaId: cid, conteudo: text })} />
      <Button size="sm" onClick={send} disabled={!msg.trim() || enviar.isPending} className="px-4">{enviar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
    </div>
    {showAddLead && <AddLeadFromConversaDialog open={showAddLead} onOpenChange={setShowAddLead} conversaId={cid} onSuccess={onLeadUpdate} />}
    {showAgendar && <AgendarFromConversaDialog open={showAgendar} onOpenChange={setShowAgendar} contatoNome={conv?.contatoNome || ""} contatoTelefone={conv?.contatoTelefone || ""} />}
  </>);
}

/** Dialog para agendar compromisso direto da conversa */
function AgendarFromConversaDialog({ open, onOpenChange, contatoNome, contatoTelefone }: { open: boolean; onOpenChange: (v: boolean) => void; contatoNome: string; contatoTelefone: string }) {
  const [titulo, setTitulo] = useState(`Reunião com ${contatoNome}`);
  const [tipo, setTipo] = useState<string>("reuniao_comercial");
  const [dataInicio, setDataInicio] = useState("");
  const [horaInicio, setHoraInicio] = useState("10:00");
  const [descricao, setDescricao] = useState(contatoTelefone ? `Contato: ${contatoTelefone}` : "");

  const criarAgendamento = trpc.agendamento.criar.useMutation({
    onSuccess: () => {
      toast.success("Agendamento criado!");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleCriar = () => {
    if (!titulo || !dataInicio) { toast.error("Preencha título e data"); return; }
    const dtInicio = `${dataInicio}T${horaInicio}:00`;
    criarAgendamento.mutate({ tipo: tipo as any, titulo, descricao: descricao || undefined, dataInicio: dtInicio });
  };

  return (<Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><Calendar className="h-5 w-5 text-blue-600" /> Agendar Compromisso</DialogTitle></DialogHeader>
    <div className="space-y-3 py-2">
      <div className="space-y-1.5"><Label>Título *</Label><Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Reunião com cliente" /></div>
      <div className="space-y-1.5"><Label>Tipo</Label>
        <Select value={tipo} onValueChange={setTipo}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="reuniao_comercial">Reunião Comercial</SelectItem>
          <SelectItem value="audiencia">Audiência</SelectItem>
          <SelectItem value="follow_up">Follow-up</SelectItem>
          <SelectItem value="tarefa">Tarefa</SelectItem>
          <SelectItem value="outro">Outro</SelectItem>
        </SelectContent></Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>Data *</Label><Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Hora</Label><Input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} /></div>
      </div>
      <div className="space-y-1.5"><Label>Descrição</Label><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Observações..." /></div>
    </div>
    <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={handleCriar} disabled={!titulo || !dataInicio || criarAgendamento.isPending}>{criarAgendamento.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calendar className="h-4 w-4 mr-2" />} Agendar</Button></DialogFooter>
  </DialogContent></Dialog>);
}

function AudioRecordButton({ onSend }: { onSend: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleToggle = () => {
    if (recording) {
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      const dur = duration;
      setDuration(0);
      onSend(`🎵 Nota de voz (${dur}s)`);
    } else {
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    }
  };

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  return (
    <Button size="sm" variant={recording ? "destructive" : "ghost"} onClick={handleToggle} className={recording ? "px-3 animate-pulse" : "px-2"} title={recording ? "Parar gravação" : "Gravar áudio"}>
      {recording ? (<><Square className="h-3.5 w-3.5 mr-1" /> {duration}s</>) : (<Mic className="h-4 w-4" />)}
    </Button>
  );
}

function PipelineKanban({ leads, onUpdate, onWA, onAddLead, onGoToConversa }: { leads: any[]; onUpdate: () => void; onWA?: (p: string) => void; onAddLead: () => void; onGoToConversa: (conversaId: number) => void }) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const mut = trpc.crm.atualizarLead.useMutation({ onSuccess: () => { toast.success("Lead movido!"); onUpdate(); }, onError: (e: any) => toast.error(e.message) });
  const excluirMut = trpc.crm.excluirLead.useMutation({ onSuccess: () => { toast.success("Lead excluído!"); onUpdate(); }, onError: (e: any) => toast.error(e.message) });
  const total = leads.filter((l: any) => !l.etapaFunil.startsWith("fechado")).reduce((s: number, l: any) => s + (parseFloat(l.valorEstimado || "0") || 0), 0);
  const al = activeId ? leads.find((l: any) => l.id === activeId) : null;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }));

  const handleDeleteLead = (id: number, nome: string) => {
    if (confirm(`Excluir lead "${nome}" do pipeline?`)) {
      excluirMut.mutate({ id });
    }
  };

  return (<div className="space-y-3">
    <div className="flex items-center gap-3"><p className="text-sm font-semibold">{leads.length} leads</p>{total > 0 && <><Separator orientation="vertical" className="h-4" /><p className="text-sm font-semibold text-violet-600">{formatBRL(total)} em pipeline</p></>}<div className="flex-1" /><Button size="sm" onClick={onAddLead}><Plus className="h-4 w-4 mr-1" /> Novo Lead</Button></div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(e: DragStartEvent) => setActiveId(Number(e.active.id))} onDragEnd={(e: DragEndEvent) => { setActiveId(null); if (!e.over) return; const oid = String(e.over.id); if (ETAPAS.includes(oid as EtapaFunil)) { const ld = leads.find((l: any) => l.id === Number(e.active.id)); if (ld && ld.etapaFunil !== oid) mut.mutate({ id: ld.id, etapaFunil: oid as EtapaFunil }); } }}>
      <div className="overflow-x-auto -mx-2 px-2 pb-4"><div className="flex gap-3" style={{ minWidth: 1000 }}>{ETAPAS.map((etapa) => { const items = leads.filter((l: any) => l.etapaFunil === etapa); const val = items.reduce((s: number, l: any) => s + (parseFloat(l.valorEstimado || "0") || 0), 0); const st = EST[etapa]; return (<KCol key={etapa} etapa={etapa} st={st} count={items.length} val={val}><SortableContext items={items.map((l: any) => l.id)} strategy={verticalListSortingStrategy}>{!items.length && <div className="flex items-center justify-center h-24"><p className="text-[10px] text-muted-foreground/50">Arraste leads aqui</p></div>}{items.map((l: any) => <KCard key={l.id} lead={l} onWA={onWA} onDelete={handleDeleteLead} onGoToConversa={onGoToConversa} />)}</SortableContext></KCol>); })}</div></div>
      <DragOverlay>{al ? <KOver lead={al} /> : null}</DragOverlay>
    </DndContext>
  </div>);
}
function KCol({ etapa, st, count, val, children }: { etapa: EtapaFunil; st: any; count: number; val: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa });
  return (<div className="flex-1 min-w-[170px]"><div className={"rounded-t-xl px-3 py-2.5 border border-b-0 " + st.header + " " + st.border}><div className="flex items-center gap-2"><div className={"h-2.5 w-2.5 rounded-full " + st.dot} /><span className="text-xs font-semibold flex-1">{ETAPA_FUNIL_LABELS[etapa]}</span><Badge variant="secondary" className="text-[10px] h-5 min-w-[20px] justify-center">{count}</Badge></div>{val > 0 && <p className="text-[10px] text-muted-foreground mt-1 ml-4">{formatBRL(val)}</p>}</div><div ref={setNodeRef} className={"border border-t-0 rounded-b-xl p-2 space-y-2 min-h-[250px] transition-colors " + st.bg + " " + st.border + (isOver ? " ring-2 ring-primary/30 bg-primary/5" : "")}>{children}</div></div>);
}
function KCard({ lead, onWA, onDelete, onGoToConversa }: { lead: any; onWA?: (p: string) => void; onDelete: (id: number, nome: string) => void; onGoToConversa: (conversaId: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id });
  const v = parseFloat(lead.valorEstimado || "0") || 0;
  return (<div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }} {...attributes} {...listeners} className="rounded-lg bg-background border shadow-sm hover:shadow-md transition-all p-3 space-y-2 cursor-grab active:cursor-grabbing">
    <div><p className="text-xs font-semibold truncate">{lead.contatoNome}</p>{lead.contatoTelefone && <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5"><Phone className="h-2.5 w-2.5" /> {lead.contatoTelefone}</p>}</div>
    {(v > 0 || (lead.probabilidade && lead.probabilidade !== 50)) && <div className="flex items-center gap-2">{v > 0 && <span className="text-xs font-bold text-emerald-600 flex items-center gap-0.5"><DollarSign className="h-3 w-3" />{formatBRL(v)}</span>}{lead.probabilidade && lead.probabilidade !== 50 && <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Percent className="h-2.5 w-2.5" />{lead.probabilidade}%</span>}</div>}
    {lead.probabilidade > 0 && <div className="h-1 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all" style={{ width: lead.probabilidade + "%" }} /></div>}
    <div className="flex justify-end gap-1">
      {lead.conversaId && (
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-blue-600" title="Ir para conversa" onClick={(e) => { e.stopPropagation(); onGoToConversa(lead.conversaId); }}><Inbox className="h-3 w-3 mr-0.5" /> Inbox</Button>
      )}
      {lead.contatoTelefone && onWA && <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-emerald-600" onClick={(e) => { e.stopPropagation(); onWA(lead.contatoTelefone); }}><PhoneCall className="h-3 w-3" /></Button>}
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" title="Excluir lead" onClick={(e) => { e.stopPropagation(); onDelete(lead.id, lead.contatoNome); }}><Trash2 className="h-3 w-3" /></Button>
    </div>
  </div>);
}
function KOver({ lead }: { lead: any }) { const v = parseFloat(lead.valorEstimado || "0") || 0; return (<div className="rounded-lg bg-background border-2 border-primary shadow-xl p-3 space-y-2 w-[170px] rotate-2"><p className="text-xs font-semibold truncate">{lead.contatoNome}</p>{v > 0 && <span className="text-xs font-bold text-emerald-600">{formatBRL(v)}</span>}</div>); }

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboard de Métricas do Atendimento
// ═══════════════════════════════════════════════════════════════════════════════

function DashboardAtendimento() {
  const { data, isLoading } = trpc.crm.metricasDetalhadas.useQuery(undefined, { refetchInterval: 30000 });

  if (isLoading) return <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;
  if (!data) return <Card><CardContent className="pt-6 text-center py-12"><BarChart3 className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" /><p className="text-sm text-muted-foreground">Sem dados disponíveis.</p></CardContent></Card>;

  const statusLabels: Record<string, string> = { aguardando: "Aguardando", em_atendimento: "Em atendimento", resolvido: "Resolvido", fechado: "Fechado" };
  const statusCores: Record<string, string> = { aguardando: "text-amber-600", em_atendimento: "text-blue-600", resolvido: "text-emerald-600", fechado: "text-gray-500" };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        <DashKpi label="Msgs Recebidas Hoje" value={data.msgsEntradaHoje} cor="text-blue-600" />
        <DashKpi label="Msgs Enviadas Hoje" value={data.msgsSaidaHoje} cor="text-violet-600" />
        <DashKpi label="Novas Conversas Hoje" value={data.novasHoje} cor="text-amber-600" />
        <DashKpi label="Resolvidas Hoje" value={data.resolvidasHoje} cor="text-emerald-600" />
        <DashKpi label="Tempo Médio Resposta" value={data.tempoMedioResposta ? `${data.tempoMedioResposta}min` : "—"} cor="text-rose-600" />
        <DashKpi label="Total Msgs Hoje" value={data.msgsTotalHoje} cor="" />
      </div>

      {/* Conversas por Status */}
      <Card><CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Conversas por Status</CardTitle></CardHeader><CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(data.conversasPorStatus || {}).map(([s, t]) => (
            <div key={s} className="rounded-lg border p-3 text-center">
              <p className={`text-2xl font-bold ${statusCores[s] || ""}`}>{t}</p>
              <p className="text-xs text-muted-foreground">{statusLabels[s] || s}</p>
            </div>
          ))}
        </div>
      </CardContent></Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Mensagens por Canal */}
        <Card><CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Mensagens por Canal (7 dias)</CardTitle></CardHeader><CardContent>
          {!(data.porCanal || []).length ? <p className="text-sm text-muted-foreground text-center py-6">Sem dados.</p> : (
            <div className="space-y-2">
              {data.porCanal.map((c: any, i: number) => {
                const max = Math.max(...data.porCanal.map((x: any) => x.total), 1);
                const pct = (c.total / max) * 100;
                const cores = ["bg-emerald-500", "bg-blue-500", "bg-violet-500", "bg-amber-500", "bg-rose-500"];
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-28 text-xs font-medium truncate">{c.nome}</div>
                    <div className="flex-1 h-6 bg-muted/40 rounded-full overflow-hidden relative">
                      <div className={`h-full rounded-full ${cores[i % cores.length]}`} style={{ width: `${Math.max(pct, 5)}%` }} />
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium">{c.total}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent></Card>

        {/* Ranking de Atendentes */}
        <Card><CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Ranking de Atendentes (30 dias)</CardTitle></CardHeader><CardContent>
          {!(data.ranking || []).length ? <p className="text-sm text-muted-foreground text-center py-6">Sem dados.</p> : (
            <div className="space-y-2">
              {data.ranking.map((r: any, i: number) => (
                <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/20">
                  <div className={"h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 " + (i === 0 ? "bg-amber-500" : i === 1 ? "bg-gray-400" : i === 2 ? "bg-amber-700" : "bg-muted-foreground/40")}>{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><p className="text-sm font-medium truncate">{r.nome}</p>{r.online && <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" title="Online" />}</div>
                    <p className="text-[10px] text-muted-foreground">{r.resolvidas} resolvidas · {r.emAtendimento} em atendimento</p>
                  </div>
                  <div className="text-right shrink-0"><p className="text-sm font-bold">{r.total}</p><p className="text-[9px] text-muted-foreground">total</p></div>
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>
      </div>
    </div>
  );
}

function DashKpi({ label, value, cor }: { label: string; value: string | number; cor: string }) {
  return (<div className="rounded-lg border bg-card px-3 py-2.5 text-center"><p className={`text-lg font-bold leading-tight ${cor}`}>{value}</p><p className="text-[9px] text-muted-foreground mt-0.5">{label}</p></div>);
}
