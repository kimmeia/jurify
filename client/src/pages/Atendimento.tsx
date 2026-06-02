import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { DndContext, closestCenter, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor, useDroppable } from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Headphones, MessageCircle, TrendingUp, BarChart3, Plus, Loader2, Send, Search, Phone, CheckCircle, XCircle, DollarSign, Inbox, PhoneCall, Percent, X, Trash2, Calendar, Mic, Square, PlusCircle, Zap, ArrowRightLeft, Link2, User, Check, AlertTriangle, List, Filter } from "lucide-react";
import { toast } from "sonner";
import { FinanceiroBadge, FinanceiroPopover } from "@/components/FinanceiroBadge";
import { STATUS_CONVERSA_LABELS, STATUS_CONVERSA_CORES, ETAPA_FUNIL_LABELS, ORIGEM_LABELS } from "@shared/crm-types";
import type { StatusConversa, EtapaFunil } from "@shared/crm-types";
import { parseValorBR } from "@shared/valor-br";
import { RespostaRapidaAutocomplete } from "@/components/atendimento/RespostaRapidaAutocomplete";
import { MagicBrief } from "./atendimento/magic-brief";
import { ConversationDiff } from "./atendimento/conversation-diff";
import { AIActionCards } from "./atendimento/ai-action-cards";
import { ComplianceGuard, ComplianceGuardBadge } from "./atendimento/compliance-guard";
import { LinhaTempoUnificada } from "./atendimento/linha-tempo-unificada";
import { AIRail } from "./atendimento/ai-rail";
import { CentroDeComando } from "./atendimento/centro-de-comando";
import { Sparkles, ScrollText, Bot } from "lucide-react";

function formatBRL(v: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v); }
function timeAgo(d: string) { if (!d) return ""; const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000); if (m < 1) return "agora"; if (m < 60) return m + "min"; const h = Math.floor(m / 60); if (h < 24) return h + "h"; return Math.floor(h / 24) + "d"; }
function initials(n: string) { return n.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase(); }

// Paleta determinística pra avatar. Mesmo nome → mesma cor sempre, em
// qualquer device. Inspirado em Slack/Linear: ajuda atendente reconhecer
// cliente recorrente sem ler o nome.
const AVATAR_PALETTE = [
  "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
];
function colorFromName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

/** Preview rico da última mensagem da conversa — adiciona ícone do tipo de mídia
 *  quando a mensagem não é texto puro. Faz com que o atendente identifique em
 *  segundos se a última msg foi áudio, foto, doc, etc. */
function previewMensagem(c: any): string {
  const tipo = c.ultimaMensagemTipo as string | undefined;
  const preview = c.ultimaMensagemPreview || "";
  if (!tipo || tipo === "texto") return preview || "Sem mensagens";
  const prefix = tipo === "audio" ? "🎤 Áudio"
    : tipo === "imagem" ? "📷 Foto"
    : tipo === "video" ? "🎥 Vídeo"
    : tipo === "documento" ? "📄 Documento"
    : tipo === "localizacao" ? "📍 Localização"
    : tipo === "contato" ? "👤 Contato"
    : tipo === "sticker" ? "🏷️ Sticker"
    : "";
  if (!prefix) return preview || "Sem mensagens";
  return preview ? `${prefix} · ${preview}` : prefix;
}

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
  // O `onClose` antes era chamado durante o render — React reclamava com
  // "Cannot update a component while rendering". Move pra dentro do effect,
  // que só roda depois do commit. Como o array de deps é vazio, dispara
  // 1x no mount (suficiente — o componente é desmontado em seguida).
  useEffect(() => {
    const clean = phone.replace(/\D/g, "");
    window.open("https://wa.me/" + clean, "_blank");
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

/**
 * Aplica máscara brasileira no telefone enquanto o usuário digita.
 * Aceita até 11 dígitos (DDD + 9 dígitos do celular). O DDI 55 é
 * adicionado automaticamente no envio.
 *
 *   "11999990000"   -> "(11) 99999-0000"
 *   "1199999"       -> "(11) 9999-9"
 *   "11"            -> "(11) "
 */
function maskPhoneBR(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/** Valida se o telefone tem ao menos DDD + número (10 ou 11 dígitos) */
function isValidPhoneBR(value: string): boolean {
  const d = value.replace(/\D/g, "");
  return d.length === 10 || d.length === 11;
}

function IniciarConversaDialog({
  open,
  onOpenChange,
  onSuccess,
  preencherDe,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: (id: number) => void;
  /** Pré-preenche nome/telefone quando o diálogo foi acionado vindo de outro
   *  lugar (ex.: botão "Inbox" na ficha do cliente). Seguro: se o contato
   *  já tem conversa, iniciarConversa reusa; senão cria. */
  preencherDe?: { nome?: string; telefone?: string } | null;
}) {
  const [tel, setTel] = useState(""); const [nome, setNome] = useState(""); const [msg, setMsg] = useState(""); const [canalId, setCanalId] = useState<number | null>(null);
  const { data: canais } = trpc.configuracoes.listarCanais.useQuery();
  // Inclui whatsapp_api (Cloud API) E whatsapp_qr (Baileys legado).
  // Quando há múltiplos números conectados, exige escolha explícita.
  const waCh = (canais?.canais || []).filter(
    (c: any) => (c.tipo === "whatsapp_api" || c.tipo === "whatsapp_qr") && c.status === "conectado",
  );
  useEffect(() => { if (waCh.length > 0 && !canalId) setCanalId(waCh[0].id); }, [waCh, canalId]);
  // Ao abrir com dados vindos do CRM, pré-popula os campos.
  useEffect(() => {
    if (open && preencherDe) {
      if (preencherDe.telefone) setTel(maskPhoneBR(preencherDe.telefone));
      if (preencherDe.nome) setNome(preencherDe.nome);
    }
  }, [open, preencherDe]);
  const ini = trpc.crm.iniciarConversa.useMutation({ onSuccess: (r: any) => { toast.success("Conversa iniciada!"); onOpenChange(false); setTel(""); setNome(""); setMsg(""); onSuccess(r.conversaId); }, onError: (e: any) => toast.error(e.message) });
  const telDigits = tel.replace(/\D/g, "");
  const telValido = isValidPhoneBR(tel);
  const handleEnviar = () => {
    if (!canalId || !msg) return;
    if (!telValido) { toast.error("Telefone inválido. Use DDD + número (ex: (11) 99999-0000)"); return; }
    // Envia só os dígitos — o servidor adiciona DDI 55 e converte para JID
    ini.mutate({ telefone: telDigits, nome: nome || undefined, mensagem: msg, canalId });
  };
  return (<Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-600" /> Nova Conversa</DialogTitle></DialogHeader>
    <div className="space-y-3 py-2"><div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Telefone *</Label><Input placeholder="(11) 99999-0000" value={tel} onChange={(e) => setTel(maskPhoneBR(e.target.value))} inputMode="tel" maxLength={16} className={tel && !telValido ? "border-red-400" : ""} />{tel && !telValido && <p className="text-[10px] text-red-500">DDD + número (10 ou 11 dígitos)</p>}</div><div className="space-y-1.5"><Label>Nome</Label><Input placeholder="Nome do contato" value={nome} onChange={(e) => setNome(e.target.value)} /></div></div>
    <div className="space-y-1.5"><Label>Mensagem *</Label><Input placeholder="Olá! Como posso ajudar?" value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
    {waCh.length > 1 && (
      <div className="space-y-1.5">
        <Label>Enviar a partir de</Label>
        <select
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={canalId ?? ""}
          onChange={(e) => setCanalId(Number(e.target.value))}
        >
          {waCh.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.telefone ? `${c.telefone} — ${c.nome}` : c.nome}
            </option>
          ))}
        </select>
      </div>
    )}
    {waCh.length === 0 && <p className="text-xs text-red-600">Nenhum WhatsApp conectado.</p>}</div>
    <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={handleEnviar} disabled={!telValido || !msg || !canalId || ini.isPending}>{ini.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} Enviar</Button></DialogFooter>
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
  const [inboxBusca, setInboxBusca] = useState("");
  // Filtros avançados que vão pro backend (atendente, setor, período). Status
  // continua client-side pra contadores baterem.
  const [atendentesFiltro, setAtendentesFiltro] = useState<number[]>([]);
  const [setorFiltro, setSetorFiltro] = useState<number | null>(null);
  const [periodoFiltro, setPeriodoFiltro] = useState<"todos" | "7d" | "30d" | "90d">("todos");
  const [showFiltros, setShowFiltros] = useState(false);
  const [waPopup, setWaPopup] = useState<string | null>(null); const [telPopup, setTelPopup] = useState<string | null>(null);
  const [showLinhaTempo, setShowLinhaTempo] = useState<number | null>(null);

  // Deep link vindo do CRM (ex.: botão "Inbox" na ficha do cliente):
  // /atendimento?contatoId=X abre automaticamente a conversa existente, ou
  // pré-preenche o diálogo de Nova Conversa se ainda não houver.
  const [contatoIdUrl] = useState<number | null>(() => {
    const p = new URLSearchParams(window.location.search);
    const raw = p.get("contatoId");
    return raw ? Number(raw) : null;
  });
  const [preencherConversa, setPreencherConversa] = useState<{ nome?: string; telefone?: string } | null>(null);
  const [contatoUrlConsumido, setContatoUrlConsumido] = useState(false);
  const { data: contatoUrl } = trpc.clientes.detalhe.useQuery(
    { id: contatoIdUrl ?? 0 },
    { enabled: !!contatoIdUrl, retry: false },
  );

  // Filtros que vão pro backend (atendente, setor, período). Status fica
  // client-side pra contadores baterem na coluna esquerda.
  const filtrosBackend = (() => {
    const f: any = {};
    if (atendentesFiltro.length > 0) f.atendenteIds = atendentesFiltro;
    if (setorFiltro) f.setorId = setorFiltro;
    if (periodoFiltro !== "todos") {
      const dias = periodoFiltro === "7d" ? 7 : periodoFiltro === "30d" ? 30 : 90;
      f.dataInicio = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
    }
    return Object.keys(f).length > 0 ? f : undefined;
  })();
  const { data: convsAll, refetch: rC } = trpc.crm.listarConversas.useQuery(filtrosBackend, { refetchInterval: 5000 });
  // Listas pros dropdowns de filtro. listarAtendentes já é usado no detalhe;
  // listarSetores entra novo no escopo principal pra alimentar o filtro.
  const { data: atendentesPrincipal } = trpc.crm.listarAtendentes.useQuery();
  const { data: setoresLista } = trpc.configuracoes.listarSetores.useQuery();
  const filtrosAtivos =
    (atendentesFiltro.length > 0 ? 1 : 0) +
    (setorFiltro ? 1 : 0) +
    (periodoFiltro !== "todos" ? 1 : 0);
  const limparFiltrosAvancados = () => {
    setAtendentesFiltro([]);
    setSetorFiltro(null);
    setPeriodoFiltro("todos");
  };
  const convs = (() => {
    const todas = convsAll || [];
    const porStatus = filtro === "todos" ? todas : todas.filter((c: any) => c.status === filtro);
    const q = inboxBusca.trim().toLowerCase();
    if (!q) return porStatus;
    const qDigits = q.replace(/\D/g, "");
    return porStatus.filter((c: any) => {
      if (c.contatoNome?.toLowerCase().includes(q)) return true;
      // Telefone: compara só dígitos (cliente pode digitar com ou sem máscara).
      if (qDigits && (c.contatoTelefone || "").replace(/\D/g, "").includes(qDigits)) return true;
      return false;
    });
  })();
  const counts = {
    todos: (convsAll || []).length,
    aguardando: (convsAll || []).filter((c: any) => c.status === "aguardando").length,
    em_atendimento: (convsAll || []).filter((c: any) => c.status === "em_atendimento").length,
    resolvido: (convsAll || []).filter((c: any) => c.status === "resolvido").length,
  };
  const { data: contatos, refetch: rCt } = trpc.crm.listarContatos.useQuery(busca ? { busca } : undefined);
  // Pausa o polling enquanto há drag em curso no Pipeline (senão refetch
  // chega no meio do drop, troca a referência do array `leads`, e o dnd-kit
  // perde o tracking — bug de "depois do 1º drag, os outros param").
  const [pipelineDragAtivo, setPipelineDragAtivo] = useState(false);
  const { data: leads, refetch: rL } = trpc.crm.listarLeads.useQuery(undefined, { refetchInterval: pipelineDragAtivo ? false : 8000 });
  const { data: canaisData } = trpc.configuracoes.listarCanais.useQuery();

  const hasWhatsapp = (canaisData?.canais || []).some((c: any) => (c.tipo === "whatsapp_qr" || c.tipo === "whatsapp_api") && c.status === "conectado");
  const hasTwilio = (canaisData?.canais || []).some((c: any) => c.tipo === "telefone_voip" && (c.status === "conectado" || c.temConfig));

  // Consome o contatoId da URL assim que `convs` carregou. Roda uma vez só
  // (contatoUrlConsumido evita reabrir o diálogo se o usuário navegar depois).
  useEffect(() => {
    if (contatoUrlConsumido || !contatoIdUrl || !convs) return;
    const conv = convs.find((c: any) => c.contatoId === contatoIdUrl);
    if (conv) {
      setSelId(conv.id);
      setTab("inbox");
    } else if (contatoUrl) {
      // Ainda não há conversa com esse contato — abre o diálogo já preenchido.
      setPreencherConversa({ nome: contatoUrl.nome || "", telefone: contatoUrl.telefone || "" });
      setShowIniciar(true);
    } else {
      return; // aguarda `contatoUrl` carregar
    }
    setContatoUrlConsumido(true);
    // Remove o param da URL pra evitar reabrir em navegação futura.
    const url = new URL(window.location.href);
    url.searchParams.delete("contatoId");
    window.history.replaceState({}, "", url.toString());
  }, [contatoIdUrl, convs, contatoUrl, contatoUrlConsumido]);

  const goToConversaFromLead = useCallback((conversaId: number) => {
    setSelId(conversaId);
    setTab("inbox");
  }, []);

  // Sem `max-w-7xl mx-auto` no wrapper: o Atendimento é dashboard-style e a
  // inbox ganha mais espaço útil pro chat (coluna do meio = `1fr`) quanto
  // mais largo for o viewport — o operador reclamava do canto vazio.
  return (
    <div className="space-y-5">
      <div
        className="relative overflow-hidden rounded-2xl p-5 border"
        style={{
          background:
            "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.08) 50%, rgba(236,72,153,0.06) 100%)",
          borderColor: "rgba(139,92,246,0.18)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 flex items-center justify-center shadow-md">
            <Headphones className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">Atendimento</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <Sparkles className="h-3 w-3 text-violet-500" />
              <span>Inbox · Pipeline · com Brief Instantâneo IA, Compliance Guard e Linha do Tempo Unificada</span>
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setShowIniciar(true)}
            className="bg-gradient-to-br from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          >
            <MessageCircle className="h-4 w-4 mr-1.5" /> Nova Conversa
          </Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 h-10">
          <TabsTrigger value="inbox" className="text-xs sm:text-sm gap-1.5"><Inbox className="h-3.5 w-3.5" /> Inbox</TabsTrigger>
          <TabsTrigger value="pipeline" className="text-xs sm:text-sm gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Pipeline</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox" className="mt-4">
          {/* Layout ULTRA: Lista | Chat hero | AI Rail (colapsa pra Customer 360°) */}
          {/* Altura travada na viewport (lg+) — sem isso, a coluna mais alta
              (lista de conversas) esticava o grid e o compositor "flutuava",
              deixando um vão embaixo. Cada coluna rola por dentro (min-h-0).
              No mobile (stack) mantém o fluxo natural com piso de 600px. */}
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_auto] gap-0 rounded-xl border bg-card overflow-hidden lg:h-[calc(100dvh-220px)]" style={{ minHeight: 600 }}>
            {/* Coluna 1: Lista de conversas */}
            <div className="border-r bg-muted/10 overflow-hidden flex flex-col lg:min-h-0">
              {/* Header: busca + pills de filtro com contador */}
              <div className="p-3 border-b space-y-2.5">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input
                      value={inboxBusca}
                      onChange={(e) => setInboxBusca(e.target.value)}
                      placeholder="Buscar por nome ou telefone…"
                      className="h-8 pl-8 pr-8 text-xs"
                    />
                    {inboxBusca && (
                      <button
                        onClick={() => setInboxBusca("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label="Limpar busca"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setShowFiltros((v) => !v)}
                    className={
                      "relative h-8 w-8 inline-flex items-center justify-center rounded-md border text-muted-foreground hover:bg-muted " +
                      (filtrosAtivos > 0 ? "border-primary text-primary" : "")
                    }
                    title="Filtros avançados (atendente, setor, período)"
                    aria-label="Filtros avançados"
                  >
                    <Filter className="h-3.5 w-3.5" />
                    {filtrosAtivos > 0 && (
                      <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                        {filtrosAtivos}
                      </span>
                    )}
                  </button>
                </div>
                {showFiltros && (
                  <div className="rounded-md border bg-background p-2.5 space-y-2.5 text-[11px]">
                    <div className="space-y-1">
                      <p className="font-medium text-muted-foreground">Atendentes</p>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                        {(atendentesPrincipal || []).map((a: any) => {
                          const ativo = atendentesFiltro.includes(a.id);
                          return (
                            <button
                              key={a.id}
                              onClick={() =>
                                setAtendentesFiltro((prev) =>
                                  ativo ? prev.filter((x) => x !== a.id) : [...prev, a.id],
                                )
                              }
                              className={
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 border text-[10px] " +
                                (ativo
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/30 hover:bg-muted")
                              }
                            >
                              {a.nome || `#${a.id}`}
                            </button>
                          );
                        })}
                        {(atendentesPrincipal || []).length === 0 && (
                          <span className="text-muted-foreground/60">Nenhum atendente cadastrado</span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-muted-foreground">Setor</p>
                      <select
                        value={setorFiltro ?? ""}
                        onChange={(e) => setSetorFiltro(e.target.value ? Number(e.target.value) : null)}
                        className="w-full h-7 rounded-md border bg-background px-2 text-[11px]"
                      >
                        <option value="">Todos os setores</option>
                        {(setoresLista || []).map((s: any) => (
                          <option key={s.id} value={s.id}>{s.nome}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-muted-foreground">Período</p>
                      <div className="grid grid-cols-4 gap-1">
                        {(["todos", "7d", "30d", "90d"] as const).map((p) => {
                          const label = p === "todos" ? "Todos" : p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : "90 dias";
                          const ativo = periodoFiltro === p;
                          return (
                            <button
                              key={p}
                              onClick={() => setPeriodoFiltro(p)}
                              className={
                                "h-6 rounded text-[10px] border " +
                                (ativo
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/30 hover:bg-muted")
                              }
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {filtrosAtivos > 0 && (
                      <button
                        onClick={limparFiltrosAvancados}
                        className="text-[10px] text-primary hover:underline"
                      >
                        Limpar filtros avançados
                      </button>
                    )}
                  </div>
                )}
                {/* Pills com contador. Scroll horizontal em mobile/colunas estreitas. */}
                <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-0.5 scrollbar-thin">
                  {([
                    { v: "todos", l: "Todas", n: counts.todos },
                    { v: "aguardando", l: "Aguardando", n: counts.aguardando },
                    { v: "em_atendimento", l: "Em atend.", n: counts.em_atendimento },
                    { v: "resolvido", l: "Resolvido", n: counts.resolvido },
                  ] as const).map((p) => {
                    const ativo = filtro === p.v;
                    return (
                      <button
                        key={p.v}
                        onClick={() => setFiltro(p.v)}
                        className={
                          "shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors " +
                          (ativo
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/60 text-muted-foreground hover:bg-muted")
                        }
                      >
                        <span>{p.l}</span>
                        <span className={"tabular-nums " + (ativo ? "opacity-90" : "opacity-70")}>
                          {p.n}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <ScrollArea className="flex-1 lg:min-h-0">
                {!convs?.length ? (
                  <div className="text-center py-16 px-4">
                    <MessageCircle className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {inboxBusca
                        ? "Nada encontrado"
                        : filtro === "todos"
                          ? "Nenhuma conversa"
                          : "Nenhuma neste filtro"}
                    </p>
                    {(inboxBusca || filtro !== "todos") && (
                      <button
                        onClick={() => { setInboxBusca(""); setFiltro("todos"); }}
                        className="text-xs text-primary hover:underline mt-2"
                      >
                        Limpar filtros
                      </button>
                    )}
                  </div>
                ) : (
                  convs.map((c: any) => {
                    const naoLidas = Number(c.naoLidas || 0);
                    const selecionada = selId === c.id;
                    return (
                      <button
                        key={c.id}
                        className={
                          "w-full text-left px-3 py-3 border-b transition-colors relative " +
                          (selecionada
                            ? "bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/30 dark:hover:bg-violet-950/40"
                            : "hover:bg-muted/40")
                        }
                        onClick={() => setSelId(c.id)}
                      >
                        {selecionada && (
                          <span className="absolute left-0 top-3 bottom-3 w-1 bg-violet-600 rounded-r" aria-hidden />
                        )}
                        <div className="flex items-start gap-2.5">
                          <div className="relative shrink-0">
                            <div
                              className={
                                "h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm " +
                                gradientFromName(c.contatoNome || "?")
                              }
                            >
                              {initials(c.contatoNome || "?")}
                            </div>
                            {/* Channel icon overlay (canto inferior direito) */}
                            {(c as any).canalTipo && (
                              <div
                                className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-background border-2 border-background flex items-center justify-center text-[8px]"
                                title={`${(c as any).canalNome || (c as any).canalTipo}${(c as any).canalTelefone ? ` · ${(c as any).canalTelefone}` : ""}`}
                              >
                                {(c as any).canalTipo?.startsWith("whatsapp") ? "💬"
                                  : (c as any).canalTipo === "instagram" ? "📷"
                                  : (c as any).canalTipo === "facebook" ? "🟪"
                                  : (c as any).canalTipo === "telefone_voip" ? "📞"
                                  : "💬"}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p
                                className={
                                  "text-sm truncate " +
                                  (naoLidas > 0 ? "font-bold text-foreground" : "font-medium")
                                }
                              >
                                {c.contatoNome}
                              </p>
                              <span
                                className={
                                  "text-[10px] shrink-0 tabular-nums " +
                                  (naoLidas > 0 ? "text-violet-600 font-bold" : "text-muted-foreground")
                                }
                              >
                                {timeAgo(c.ultimaMensagemAt)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-0.5">
                              <p
                                className={
                                  "text-xs truncate " +
                                  (naoLidas > 0 ? "text-foreground/85 font-medium" : "text-muted-foreground")
                                }
                              >
                                {previewMensagem(c)}
                              </p>
                              {naoLidas > 0 && (
                                <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-violet-600 text-white text-[10px] font-bold tabular-nums">
                                  {naoLidas > 99 ? "99+" : naoLidas}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                              {(c as any).temAtraso ? (
                                <span className="text-[9px] px-1.5 py-0 rounded font-bold bg-red-100 text-red-700 border border-red-200 inline-flex items-center gap-0.5">
                                  <AlertTriangle className="h-2.5 w-2.5" /> SLA crítico
                                </span>
                              ) : (
                                <span
                                  className={
                                    "text-[9px] px-1.5 py-0 rounded font-semibold border inline-flex items-center gap-1 " +
                                    (STATUS_CONVERSA_CORES[c.status as StatusConversa] || "")
                                  }
                                >
                                  <span
                                    className={
                                      "w-1.5 h-1.5 rounded-full " +
                                      (c.status === "aguardando" ? "bg-amber-500"
                                        : c.status === "em_atendimento" ? "bg-blue-500"
                                        : c.status === "resolvido" ? "bg-emerald-500"
                                        : "bg-slate-400")
                                    }
                                  />
                                  {STATUS_CONVERSA_LABELS[c.status as StatusConversa]}
                                </span>
                              )}
                              {(c as any).atendenteNome && (
                                <span className="text-[9px] px-1.5 py-0 rounded text-muted-foreground truncate max-w-[80px]" title={(c as any).atendenteNome}>
                                  · {(c as any).atendenteNome.split(" ")[0]}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </ScrollArea>
            </div>

            {/* Coluna 2: Chat hero */}
            <div className="bg-card overflow-hidden flex flex-col lg:min-h-0">
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
                  onAbrirLinhaTempo={() => {
                    const conv = (convs || []).find((c: any) => c.id === selId);
                    if (conv?.contatoId) setShowLinhaTempo(conv.contatoId);
                  }}
                />
              ) : (
                <CentroDeComando
                  convs={convs || []}
                  onAbrirConversa={setSelId}
                  onIniciar={() => setShowIniciar(true)}
                />
              )}
            </div>

            {/* Coluna 3: AI Rail (colapsável — clica no ✨ pra expandir o Customer 360°) */}
            {(() => {
              const convAtual = (convs || []).find((c: any) => c.id === selId);
              return (
                <AIRail
                  conversaId={selId}
                  contatoId={convAtual?.contatoId || null}
                  onAbrirLinhaTempo={() => convAtual?.contatoId && setShowLinhaTempo(convAtual.contatoId)}
                  onOpenWhatsapp={
                    hasWhatsapp
                      ? (p?: string) => setWaPopup(p || convAtual?.contatoTelefone || "")
                      : undefined
                  }
                />
              );
            })()}
          </div>
        </TabsContent>
        <TabsContent value="pipeline" className="mt-4"><PipelineKanban leads={leads || []} onUpdate={rL} onWA={hasWhatsapp ? (p) => setWaPopup(p) : undefined} onAddLead={() => setShowNovoLead(true)} onGoToConversa={goToConversaFromLead} onDragChange={setPipelineDragAtivo} /></TabsContent>
      </Tabs>
      {waPopup && <WhatsAppCallPopup phone={waPopup} onClose={() => setWaPopup(null)} />}
      {telPopup && <TwilioCallPopup phone={telPopup} onClose={() => setTelPopup(null)} />}
      <IniciarConversaDialog
        open={showIniciar}
        onOpenChange={(v) => { setShowIniciar(v); if (!v) setPreencherConversa(null); }}
        onSuccess={(id) => { setSelId(id); setTab("inbox"); rC(); setPreencherConversa(null); }}
        preencherDe={preencherConversa}
      />
      <NovoLeadDialog open={showNovoLead} onOpenChange={setShowNovoLead} onSuccess={rL} />
      {showLinhaTempo && (() => {
        const conv = (convs || []).find((c: any) => c.contatoId === showLinhaTempo);
        return (
          <LinhaTempoUnificada
            open={!!showLinhaTempo}
            onOpenChange={(v) => { if (!v) setShowLinhaTempo(null); }}
            contatoId={showLinhaTempo}
            contatoNome={conv?.contatoNome || "Cliente"}
          />
        );
      })()}
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

function ChatArea({ cid, convs, onUpdate, onLeadUpdate, onWA, onTel, onDeleted, onAbrirLinhaTempo }: { cid: number; convs: any[]; onUpdate: () => void; onLeadUpdate: () => void; onWA?: (p: string) => void; onTel?: (p: string) => void; onDeleted: () => void; onAbrirLinhaTempo?: () => void }) {
  const [msg, setMsg] = useState(""); const ref = useRef<HTMLDivElement>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showAgendar, setShowAgendar] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showTransferir, setShowTransferir] = useState(false);
  const [showVincular, setShowVincular] = useState(false);
  const [buscaVincular, setBuscaVincular] = useState("");
  const [tom, setTom] = useState<"formal" | "direto" | "empatico" | "amigavel">("empatico");
  const [confirmExcluirConversa, setConfirmExcluirConversa] = useState(false);

  // Compor com IA — gera sugestão no tom escolhido
  const composerSugestao = trpc.atendimentoIa.composerSugestao.useMutation({
    onSuccess: (data) => {
      setMsg(data.sugestao);
      if (data.ia === false) {
        toast.info("IA não configurada — usando template baseado no tom.");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Atendentes pra transferência
  const { data: atendentes } = trpc.crm.listarAtendentes.useQuery();
  const transferirMut = trpc.crm.transferirConversa.useMutation({
    onSuccess: () => { toast.success("Conversa transferida!"); setShowTransferir(false); onUpdate(); },
    onError: (e: any) => toast.error(e.message),
  });
  // Clientes pra vincular
  const { data: clientesBusca } = (trpc as any).clientes.listar.useQuery({ busca: buscaVincular || undefined, limite: 10 }, { enabled: showVincular });
  const vincularMut = trpc.crm.vincularConversaAoContato.useMutation({
    onSuccess: () => { toast.success("Conversa vinculada ao cliente!"); setShowVincular(false); onUpdate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const { data: tplList } = (trpc as any).templates?.listar?.useQuery?.(undefined, { retry: false }) || { data: [] };
  const conv = convs.find((c: any) => c.id === cid);
  const { data: msgs, refetch } = trpc.crm.listarMensagens.useQuery({ conversaId: cid }, { refetchInterval: 3000 });
  // Paginação cursor: `msgs` é o LIVE (últimas 50, polling). `older` acumula
  // pacotes anteriores carregados sob demanda — sem isso, conversa com >50
  // mensagens mostrava só uma fatia e o resto sumia.
  const utils = trpc.useUtils();
  const [older, setOlder] = useState<any[]>([]);
  const [maybeMore, setMaybeMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  useEffect(() => { setOlder([]); setMaybeMore(true); }, [cid]);
  // Sem msgs ainda, ou já carregou tudo (lote pequeno = chegou no início).
  useEffect(() => {
    if (msgs && msgs.length < 50 && older.length === 0) setMaybeMore(false);
  }, [msgs, older.length]);
  const carregarMaisAntigas = async () => {
    const refId = older[0]?.id ?? msgs?.[0]?.id;
    if (!refId || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const mais = await utils.crm.listarMensagens.fetch({ conversaId: cid, beforeId: refId });
      if (!mais || mais.length === 0) { setMaybeMore(false); return; }
      if (mais.length < 50) setMaybeMore(false);
      // Preserva scroll: o scroll do usuário fica no mesmo conteúdo quando
      // prependemos. Sem isso, jogar pra cima do tudo cada "carregar mais".
      const el = ref.current;
      const prevH = el?.scrollHeight ?? 0;
      setOlder((prev) => [...mais, ...prev]);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevH;
      });
    } finally { setLoadingOlder(false); }
  };
  const enviar = trpc.crm.enviarMensagem.useMutation({ onSuccess: () => { setMsg(""); refetch(); onUpdate(); }, onError: (e: any) => toast.error(e.message) });
  const atualizar = trpc.crm.atualizarConversa.useMutation({ onSuccess: () => { onUpdate(); toast.success("Atualizado!"); } });
  const excluir = trpc.crm.excluirConversa.useMutation({ onSuccess: () => { toast.success("Conversa excluída."); onDeleted(); }, onError: (e: any) => toast.error(e.message) });
  // Auto-scroll só dispara em mudanças do LIVE (polling/envio), não quando
  // prependemos antigas — senão o "carregar mais" pulava pra fim e o usuário
  // perdia o que queria ler.
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [msgs]);
  const send = () => { if (msg.trim()) enviar.mutate({ conversaId: cid, conteudo: msg.trim() }); };

  const handleDelete = () => setConfirmExcluirConversa(true);

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
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{conv?.contatoNome || "Contato"}</p>
            <Badge variant="outline" className={"text-[9px] px-1 py-0 " + (STATUS_CONVERSA_CORES[conv?.status as StatusConversa] || "")}>{STATUS_CONVERSA_LABELS[conv?.status as StatusConversa] || conv?.status}</Badge>
            {/* Badge do atendente responsável — bem visível em azul.
                Ajuda gestor/dono a identificar de quem é a conversa */}
            {(conv as any)?.atendenteNome ? (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200 gap-1 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800"
              >
                <User className="h-3 w-3" />
                {(conv as any).atendenteNome}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
              >
                Sem atendente
              </Badge>
            )}
            {conv?.contatoId && <FinanceiroBadge contatoId={conv.contatoId} />}
            {/* Badge do canal: mostra de qual número WhatsApp veio a conversa.
                Importante quando o escritório tem MÚLTIPLOS números conectados
                — sem isso, atendente não sabe por onde responder o cliente. */}
            {(conv as any)?.canalNome && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200 gap-1 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
                title={`Conversa recebida via ${(conv as any).canalNome || "canal"}${(conv as any).canalTelefone ? ` · ${(conv as any).canalTelefone}` : ""}`}
              >
                {(conv as any).canalTipo?.startsWith("whatsapp") ? "💬"
                  : (conv as any).canalTipo === "instagram" ? "📷"
                  : (conv as any).canalTipo === "facebook" ? "🟪"
                  : "📡"}
                {/* Mostra o NÚMERO (distingue múltiplos WhatsApp); cai pro nome se não houver. */}
                {(conv as any).canalTelefone || (conv as any).canalNome}
              </Badge>
            )}
          </div>
          {(conv?.contatoTelefone || conv?.chatIdExterno) && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {conv.contatoTelefone || conv.chatIdExterno?.replace(/@.*/, "")}
            </p>
          )}
        </div>
        {(conv?.contatoTelefone || conv?.chatIdExterno) && (onWA || onTel) && (() => {
          const tel = conv.contatoTelefone || conv.chatIdExterno?.replace(/@.*/, "") || "";
          return (
            <div className="flex items-center gap-1 shrink-0">
              {onWA && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600" title="WhatsApp" onClick={() => onWA(tel)}><PhoneCall className="h-3.5 w-3.5" /></Button>}
              {onTel && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600" title="Ligar" onClick={() => onTel(tel)}><Phone className="h-3.5 w-3.5" /></Button>}
            </div>
          );
        })()}
      </div>
      {/* Header linha 2: acoes */}
      <div className="flex items-center gap-1 mt-1.5 -mb-0.5 overflow-x-auto">
        {onAbrirLinhaTempo && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2 text-indigo-600 shrink-0 font-semibold"
            onClick={onAbrirLinhaTempo}
            title="Toda a vida jurídica do cliente em uma timeline"
          >
            <ScrollText className="h-3 w-3 mr-1" />Linha do Tempo
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-violet-600 shrink-0" onClick={() => setShowAddLead(true)}><TrendingUp className="h-3 w-3 mr-1" />Pipeline</Button>
        {conv?.contatoId && <FinanceiroPopover contatoId={conv.contatoId} />}
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-blue-600 shrink-0" onClick={() => setShowAgendar(true)}><Calendar className="h-3 w-3 mr-1" />Agendar</Button>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-orange-600 shrink-0" onClick={() => setShowTransferir(true)}><ArrowRightLeft className="h-3 w-3 mr-1" />Transferir</Button>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-indigo-600 shrink-0" onClick={() => setShowVincular(true)}><Link2 className="h-3 w-3 mr-1" />Vincular</Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-emerald-600 shrink-0" onClick={() => atualizar.mutate({ id: cid, status: "resolvido" })}><CheckCircle className="h-3 w-3 mr-1" />Resolver</Button>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 shrink-0" onClick={() => atualizar.mutate({ id: cid, status: "fechado" })}><XCircle className="h-3 w-3 mr-1" />Fechar</Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive shrink-0" title="Excluir" onClick={handleDelete}><Trash2 className="h-3 w-3" /></Button>
      </div>
    </div>
    {/* Alerta financeiro */}
    {conv?.contatoId && <AlertaFinanceiroChat contatoId={conv.contatoId} contatoNome={conv.contatoNome} />}
    {/* 🌟 Killer feature: Magic Brief Instantâneo (IA prevê motivo da conversa) */}
    <MagicBrief conversaId={cid} />
    {/* 🌟 Killer feature: Conversation Diff (o que mudou desde sua última resposta) */}
    <ConversationDiff conversaId={cid} />
    {/* 🌟 Killer feature: AI Action Cards (detecta intenção e oferece workflow 1-click) */}
    <AIActionCards
      conversaId={cid}
      contatoNome={conv?.contatoNome || "Cliente"}
      onEnviarMensagem={(texto) => setMsg(texto)}
    />
    {conv?.status === "em_atendimento" && (
      <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
          <Bot className="h-3.5 w-3.5 shrink-0" />
          <span><strong>Bot pausado</strong> — você está conduzindo o atendimento. O fluxo não responde enquanto isso.</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
          onClick={() => atualizar.mutate({ id: cid, status: "aguardando" })}
          title="Devolve o controle pro bot — o fluxo volta a responder na próxima mensagem do cliente"
        >
          Reativar bot
        </Button>
      </div>
    )}
    <div ref={ref} className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[360px] max-h-[420px] lg:min-h-0 lg:max-h-none">
      {maybeMore && (msgs?.length ?? 0) > 0 && (
        <div className="flex justify-center pb-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={carregarMaisAntigas}
            disabled={loadingOlder}
          >
            {loadingOlder ? "Carregando..." : "Carregar mensagens anteriores"}
          </Button>
        </div>
      )}
      {!msgs?.length && older.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-12">Nenhuma mensagem ainda.</p>
      ) : (
        [...older, ...(msgs || [])].map((m: any) => (
          <div key={m.id} className={"flex " + (m.direcao === "saida" ? "justify-end" : "justify-start")}>
            <div className={"max-w-[70%] rounded-2xl px-3.5 py-2 " + (m.direcao === "saida" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md") + (m.direcao === "saida" && m.status === "falha" ? " ring-2 ring-destructive/60" : "")}>
              {m.remetenteNome && m.direcao === "saida" && <p className="text-[10px] opacity-60 mb-0.5">{m.remetenteNome}</p>}
              {renderMsgContent(m)}
              <div className={"flex items-center gap-1 justify-end mt-1 text-[10px] " + (m.direcao === "saida" ? "opacity-70" : "text-muted-foreground")}>
                <span>{new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                {m.direcao === "saida" && m.status === "pendente" && <Loader2 className="h-3 w-3 animate-spin" aria-label="Enviando" />}
                {m.direcao === "saida" && (m.status === "enviada" || m.status === "entregue" || m.status === "lida") && <Check className="h-3 w-3" aria-label="Enviada" />}
                {m.direcao === "saida" && m.status === "falha" && (
                  <span title="Falha no envio — veja logs do WhatsApp">
                    <AlertTriangle className="h-3 w-3 text-red-200" aria-label="Falha no envio" />
                  </span>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
    {/* 🌟 Killer feature: Compliance Guard (verifica rascunho contra ética OAB) */}
    <ComplianceGuard
      rascunho={msg}
      onAplicarSugestao={(s) => setMsg(s)}
      onIgnorar={() => { /* registrar event log se quiser auditar */ }}
    />
    {/* Composer ULTRA: Tone Selector + Compor IA + Slash + Compliance badge */}
    <div className="border-t bg-muted/20">
      {/* Linha 1: Tone Selector + ✨ Compor IA + Compliance badge */}
      <div className="px-3 pt-2 pb-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide shrink-0">Tom:</span>
        <div className="inline-flex bg-background border rounded-lg p-0.5 gap-0 shadow-sm">
          {(["formal", "direto", "empatico", "amigavel"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTom(t)}
              className={
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition " +
                (tom === t
                  ? "bg-violet-100 text-violet-700 font-semibold"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {t === "formal" ? "Formal" : t === "direto" ? "Direto" : t === "empatico" ? "Empático" : "Amigável"}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] border-violet-300 text-violet-700 hover:bg-violet-50 hover:text-violet-700 px-2.5"
          disabled={composerSugestao.isPending}
          onClick={() => composerSugestao.mutate({ conversaId: cid, tom })}
          title="Gerar resposta com IA no tom selecionado"
        >
          {composerSugestao.isPending
            ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            : <Sparkles className="h-3 w-3 mr-1" />
          }
          Compor com IA
        </Button>
        <div className="flex-1" />
        <ComplianceGuardBadge />
      </div>

      {/* Linha 2: Composer */}
      <div className="p-3 pt-2 flex gap-2">
        <Popover open={showTemplates} onOpenChange={setShowTemplates}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 shrink-0" title="Respostas rápidas">
              <Zap className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-2" align="start" side="top">
            <p className="text-xs font-medium px-2 pb-0.5 text-muted-foreground">Respostas rápidas</p>
            <p className="text-[10px] px-2 pb-1.5 text-muted-foreground/80">
              Dica: digite <span className="font-mono bg-muted px-1 rounded">/</span> no campo de mensagem para autocompletar.
            </p>
            {tplList && tplList.length > 0 ? (
              <div className="max-h-56 overflow-y-auto space-y-0.5">
                {tplList.map((t: any) => (
                  <div
                    key={t.id}
                    className="rounded-md px-2 py-1.5 cursor-pointer hover:bg-muted text-sm transition-colors"
                    onClick={() => { setMsg(t.conteudo); setShowTemplates(false); }}
                  >
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-xs">{t.titulo}</p>
                      {t.atalho && (
                        <span className="font-mono text-[10px] bg-violet-100 text-violet-700 px-1 py-0.5 rounded">
                          /{t.atalho}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">{t.conteudo}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-3">Nenhum template. Crie em Configurações.</p>
            )}
          </PopoverContent>
        </Popover>
        <RespostaRapidaAutocomplete
          value={msg}
          onChange={setMsg}
          templates={(tplList || []) as any}
          onEnter={send}
          placeholder="Digite sua mensagem… ou clique em ✨ Compor com IA"
          className="bg-background"
        />
        <AudioRecordButton
          onSend={(args) => enviar.mutate({ conversaId: cid, conteudo: args.conteudo, tipo: args.tipo, mediaUrl: args.mediaUrl })}
        />
        <Button
          size="sm"
          onClick={send}
          disabled={!msg.trim() || enviar.isPending}
          className="px-4 bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
        >
          {enviar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>

      {/* Linha 3: Hint compacto */}
      <div className="px-3 pb-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <kbd className="font-mono bg-background px-1 py-0.5 rounded border text-[10px]">/</kbd> respostas rápidas
          <span className="mx-1.5">·</span>
          <kbd className="font-mono bg-background px-1 py-0.5 rounded border text-[10px]">Enter</kbd> enviar
        </span>
        {composerSugestao.data?.ia === false && (
          <span className="text-amber-600 text-[10px]">⚠ IA não configurada — usando template</span>
        )}
      </div>
    </div>
    {showAddLead && <AddLeadFromConversaDialog open={showAddLead} onOpenChange={setShowAddLead} conversaId={cid} onSuccess={onLeadUpdate} />}

    {/* Dialog transferir */}
    {showTransferir && (
      <Dialog open={showTransferir} onOpenChange={setShowTransferir}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-orange-600" /> Transferir conversa</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Selecione o atendente que receberá esta conversa:</p>
            {(atendentes || []).map((a: any) => (
              <button key={a.id} onClick={() => transferirMut.mutate({ conversaId: cid, novoAtendenteId: a.id })}
                className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 text-left transition-colors"
                disabled={transferirMut.isPending}
              >
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{(a.nome || "?")[0]}</div>
                <div className="flex-1"><p className="text-sm font-medium">{a.nome || a.email}</p><p className="text-[10px] text-muted-foreground">{a.cargo}</p></div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    )}

    {/* Dialog vincular a cliente */}
    {showVincular && (
      <Dialog open={showVincular} onOpenChange={(v) => { setShowVincular(v); setBuscaVincular(""); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-indigo-600" /> Vincular a cliente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Busque o cliente cadastrado para vincular esta conversa:</p>
            <Input placeholder="Buscar por nome, CPF..." value={buscaVincular} onChange={(e) => setBuscaVincular(e.target.value)} />
            <div className="max-h-48 overflow-y-auto space-y-1">
              {(clientesBusca?.clientes || []).map((c: any) => (
                <button key={c.id} onClick={() => vincularMut.mutate({ conversaId: cid, contatoId: c.id })}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/50 text-left transition-colors"
                  disabled={vincularMut.isPending}
                >
                  <User className="h-4 w-4 text-violet-500 shrink-0" />
                  <div className="flex-1 min-w-0"><p className="text-xs font-medium truncate">{c.nome}</p>{c.cpfCnpj && <p className="text-[9px] text-muted-foreground font-mono">{c.cpfCnpj}</p>}</div>
                </button>
              ))}
              {buscaVincular && (!clientesBusca?.clientes || clientesBusca.clientes.length === 0) && (
                <p className="text-xs text-muted-foreground text-center py-3">Nenhum cliente encontrado.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )}
    {showAgendar && <AgendarFromConversaDialog open={showAgendar} onOpenChange={setShowAgendar} contatoNome={conv?.contatoNome || ""} contatoTelefone={conv?.contatoTelefone || ""} />}

    <AlertDialog open={confirmExcluirConversa} onOpenChange={setConfirmExcluirConversa}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
          <AlertDialogDescription>
            A conversa <strong>{conv?.contatoNome || ""}</strong> e todas as mensagens
            serão removidas permanentemente. Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={excluir.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); excluir.mutate({ id: cid }); }}
            disabled={excluir.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {excluir.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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

/**
 * Botão de gravar nota de voz para o atendimento.
 *
 * Antes: enviava só o texto "🎵 Nota de voz (Xs)" — o cliente recebia uma
 * mensagem mentirosa sem áudio nenhum.
 *
 * Agora: usa MediaRecorder (suportado em todos os navegadores modernos),
 * grava o áudio pra blob, faz upload via uploadRouter (URL devolvida fica
 * acessível pelo Express static) e dispara onSend com tipo "audio" +
 * mediaUrl. O envio pro WhatsApp acontece no `crm.enviarMensagem`, que
 * agora propaga mediaUrl pro Baileys com ptt:true (vira nota de voz).
 *
 * Cancela com X (descarta blob). Em mobile, requer HTTPS.
 */
type EnvioComposer = { tipo: "texto" | "audio"; conteudo: string; mediaUrl?: string };

function AudioRecordButton({ onSend }: { onSend: (args: EnvioComposer) => void }) {
  const [estado, setEstado] = useState<"idle" | "gravando" | "enviando">("idle");
  const [duracao, setDuracao] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const canceladoRef = useRef(false);
  const inicioRef = useRef(0);

  const uploadMut = (trpc as any).upload.enviar.useMutation();

  const limparTudo = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
    setDuracao(0);
  }, []);

  useEffect(() => () => limparTudo(), [limparTudo]);

  const iniciarGravacao = async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Seu navegador não suporta gravação de áudio.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      toast.error("Gravação não suportada neste navegador.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Escolhe o mimeType com fallback — Safari só fala mp4, Chrome/FF webm.
      const candidatos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
      const mime = candidatos.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      canceladoRef.current = false;

      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data); };
      rec.onstop = async () => {
        const dur = Math.max(1, Math.round((Date.now() - inicioRef.current) / 1000));
        if (canceladoRef.current) { limparTudo(); setEstado("idle"); return; }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 800) { // áudio com menos de ~0.5s vira lixo
          toast.error("Gravação muito curta. Segure o botão por mais tempo.");
          limparTudo(); setEstado("idle"); return;
        }
        const tipoMime = blob.type.split(";")[0]; // sem ;codecs=...
        const extPorMime: Record<string, string> = {
          "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav",
        };
        const ext = extPorMime[tipoMime] || "webm";
        const nome = `nota-de-voz-${Date.now()}.${ext}`;
        try {
          setEstado("enviando");
          const base64 = await blobParaBase64(blob);
          const result = await uploadMut.mutateAsync({ nome, tipo: tipoMime, base64, tamanho: blob.size });
          onSend({ tipo: "audio", conteudo: `🎵 Nota de voz (${dur}s)`, mediaUrl: result.url });
        } catch (e: any) {
          toast.error(e?.message || "Falha ao enviar nota de voz.");
        } finally {
          limparTudo();
          setEstado("idle");
        }
      };

      rec.start();
      inicioRef.current = Date.now();
      setDuracao(0);
      setEstado("gravando");
      timerRef.current = setInterval(() => {
        setDuracao((d) => {
          // Hard limit de 2 min — protege contra esquecer o botão clicado.
          if (d >= 120) {
            try { rec.stop(); } catch { /* ignorar */ }
            return d;
          }
          return d + 1;
        });
      }, 1000);
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        toast.error("Permissão de microfone negada. Libere nas configurações do navegador.");
      } else if (err?.name === "NotFoundError") {
        toast.error("Nenhum microfone encontrado neste dispositivo.");
      } else {
        toast.error(err?.message || "Não foi possível acessar o microfone.");
      }
      limparTudo();
      setEstado("idle");
    }
  };

  const pararGravacao = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch { /* ignorar */ }
    }
  };

  const cancelarGravacao = () => {
    canceladoRef.current = true;
    pararGravacao();
  };

  const fmtDur = (s: number) => `${String(Math.floor(s / 60)).padStart(1, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (estado === "gravando") {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
          onClick={cancelarGravacao}
          title="Cancelar (descarta áudio)"
        >
          <X className="h-4 w-4" />
        </Button>
        <span className="text-xs font-mono tabular-nums text-rose-600 flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-rose-600 animate-pulse" />
          {fmtDur(duracao)}
        </span>
        <Button
          size="sm"
          variant="destructive"
          onClick={pararGravacao}
          className="px-3"
          title="Parar e enviar"
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  if (estado === "enviando") {
    return (
      <Button size="sm" variant="ghost" disabled className="h-9 w-9 p-0">
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={iniciarGravacao}
      className="h-9 w-9 p-0"
      title="Gravar nota de voz"
    >
      <Mic className="h-4 w-4" />
    </Button>
  );
}

/** Lê um Blob/File como Data URL base64 (data:mime;base64,xxx). */
function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("Falha ao ler áudio do navegador."));
    r.readAsDataURL(blob);
  });
}

function PipelineKanban({ leads, onUpdate, onWA, onAddLead, onGoToConversa, onDragChange }: { leads: any[]; onUpdate: () => void; onWA?: (p: string) => void; onAddLead: () => void; onGoToConversa: (conversaId: number) => void; onDragChange?: (ativo: boolean) => void }) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [excluirLeadAlvo, setExcluirLeadAlvo] = useState<{ id: number; nome: string } | null>(null);
  const [detalheLeadId, setDetalheLeadId] = useState<number | null>(null);
  // Filtros avançados
  const [responsaveisFiltro, setResponsaveisFiltro] = useState<number[]>([]);
  const [setorFiltro, setSetorFiltro] = useState<number | null>(null);
  const [periodoFiltro, setPeriodoFiltro] = useState<"todos" | "7d" | "30d" | "90d">("todos");
  const [valorMin, setValorMin] = useState<string>("");
  const [valorMax, setValorMax] = useState<string>("");
  const [showFiltros, setShowFiltros] = useState(false);
  const utils = trpc.useUtils();
  // OTIMISTIC UPDATE: muda etapa no cache antes da resposta do backend. Sem
  // isso, o card "voltava" pra coluna antiga até o refetch chegar (~400ms),
  // dando impressão de bug + atrapalhando o segundo drag em sequência.
  const mut = trpc.crm.atualizarLead.useMutation({
    onMutate: async (vars: any) => {
      await utils.crm.listarLeads.cancel();
      const snap = utils.crm.listarLeads.getData();
      if (vars.etapaFunil) {
        utils.crm.listarLeads.setData(undefined, (old: any) =>
          (old || []).map((l: any) => (l.id === vars.id ? { ...l, etapaFunil: vars.etapaFunil } : l)),
        );
      }
      return { snap };
    },
    onError: (e: any, _vars, ctx) => {
      toast.error(e.message);
      if (ctx?.snap) utils.crm.listarLeads.setData(undefined, ctx.snap);
    },
    onSettled: () => { onUpdate(); },
    onSuccess: () => { toast.success("Lead movido!"); },
  });
  const excluirMut = trpc.crm.excluirLead.useMutation({
    onSuccess: () => { toast.success("Lead excluído!"); setExcluirLeadAlvo(null); onUpdate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const total = leads.filter((l: any) => !l.etapaFunil.startsWith("fechado")).reduce((s: number, l: any) => s + parseValorBR(l.valorEstimado), 0);
  const al = activeId ? leads.find((l: any) => l.id === activeId) : null;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }));

  const handleDeleteLead = (id: number, nome: string) => setExcluirLeadAlvo({ id, nome });

  // Métricas inline (substituem o KPIs strip removido do header)
  const totalGanho = leads
    .filter((l: any) => l.etapaFunil === "fechado_ganho")
    .reduce((s: number, l: any) => s + parseValorBR(l.valorEstimado), 0);

  // Listas dos filtros (atendentes + setores)
  const { data: atendentesLista } = trpc.crm.listarAtendentes.useQuery();
  const { data: setoresFiltroLista } = trpc.configuracoes.listarSetores.useQuery();
  // Map de atendente → setor pra filtragem por setor (lead carrega responsavelId).
  const atendenteToSetor = useMemo(() => {
    const m: Record<number, number | null> = {};
    for (const a of (atendentesLista || []) as any[]) m[a.id] = a.setorId ?? null;
    return m;
  }, [atendentesLista]);

  // Busca local + filtros
  const buscaQ = busca.trim().toLowerCase();
  const buscaDigits = buscaQ.replace(/\D/g, "");
  const periodoMs = (() => {
    if (periodoFiltro === "todos") return null;
    const dias = periodoFiltro === "7d" ? 7 : periodoFiltro === "30d" ? 30 : 90;
    return Date.now() - dias * 24 * 60 * 60 * 1000;
  })();
  const vMin = valorMin ? parseValorBR(valorMin) : null;
  const vMax = valorMax ? parseValorBR(valorMax) : null;
  const leadsFiltrados = leads.filter((l: any) => {
    if (buscaQ) {
      const okNome = (l.contatoNome || "").toLowerCase().includes(buscaQ);
      const okTel = buscaDigits && (l.contatoTelefone || "").replace(/\D/g, "").includes(buscaDigits);
      if (!okNome && !okTel) return false;
    }
    if (responsaveisFiltro.length > 0 && !responsaveisFiltro.includes(l.responsavelId)) return false;
    if (setorFiltro && atendenteToSetor[l.responsavelId] !== setorFiltro) return false;
    if (periodoMs) {
      const t = l.ultimaAtividadeAt ? new Date(l.ultimaAtividadeAt).getTime() : (l.createdAt ? new Date(l.createdAt).getTime() : 0);
      if (t < periodoMs) return false;
    }
    if (vMin !== null || vMax !== null) {
      const v = parseValorBR(l.valorEstimado);
      if (vMin !== null && v < vMin) return false;
      if (vMax !== null && v > vMax) return false;
    }
    return true;
  });
  const filtrosAtivos =
    (responsaveisFiltro.length > 0 ? 1 : 0) +
    (setorFiltro ? 1 : 0) +
    (periodoFiltro !== "todos" ? 1 : 0) +
    (vMin !== null || vMax !== null ? 1 : 0);
  const limparFiltrosAv = () => {
    setResponsaveisFiltro([]); setSetorFiltro(null); setPeriodoFiltro("todos"); setValorMin(""); setValorMax("");
  };

  // Memoize a lista de IDs por etapa pra estabilizar referência do
  // SortableContext entre renders. Sem isso, cada render gera novo array de
  // items e o dnd-kit perde estado interno (sintoma: drag para de funcionar
  // após o 1º card movido).
  const itemsByEtapa = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const e of ETAPAS) map[e] = [];
    for (const l of leadsFiltrados) {
      if (map[l.etapaFunil]) map[l.etapaFunil].push(l);
    }
    return map;
  }, [leadsFiltrados]);
  const idsByEtapa = useMemo(() => {
    const m: Record<string, number[]> = {};
    for (const e of ETAPAS) m[e] = itemsByEtapa[e].map((l: any) => l.id);
    return m;
  }, [itemsByEtapa]);

  return (<div className="space-y-4">
    {/* Top bar: métricas inline + busca + filtros + toggle view + Novo Lead */}
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl border bg-card shadow-sm">
          <span className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
          <div className="leading-tight">
            <p className="text-base font-bold leading-none tabular-nums">{leads.length}</p>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-bold mt-0.5">leads</p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 shadow-sm">
          <div className="leading-tight">
            <p className="text-base font-bold leading-none tabular-nums text-emerald-700">{formatBRL(totalGanho)}</p>
            <p className="text-[9px] uppercase tracking-wide text-emerald-700/70 font-bold mt-0.5">ganhos</p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl border bg-card shadow-sm">
          <div className="leading-tight">
            <p className="text-base font-bold leading-none tabular-nums text-muted-foreground">{formatBRL(total)}</p>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-bold mt-0.5">em pipeline</p>
          </div>
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar lead…"
            className="h-9 pl-8 pr-3 text-xs w-48 bg-background"
          />
        </div>
        <button
          onClick={() => setShowFiltros((v) => !v)}
          className={
            "relative h-9 w-9 inline-flex items-center justify-center rounded-md border text-muted-foreground hover:bg-muted " +
            (filtrosAtivos > 0 ? "border-violet-500 text-violet-600" : "")
          }
          title="Filtros: atendente, setor, período, valor"
        >
          <Filter className="h-3.5 w-3.5" />
          {filtrosAtivos > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center">
              {filtrosAtivos}
            </span>
          )}
        </button>
        <div className="inline-flex items-center bg-muted/40 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setView("kanban")}
            className={
              "px-2.5 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition " +
              (view === "kanban" ? "bg-background text-violet-600 shadow-sm ring-1 ring-violet-300/40" : "text-muted-foreground hover:text-foreground")
            }
            title="Visualização Kanban"
          >
            <BarChart3 className="h-3.5 w-3.5 rotate-90" /> Kanban
          </button>
          <button
            type="button"
            onClick={() => setView("lista")}
            className={
              "px-2.5 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition " +
              (view === "lista" ? "bg-background text-violet-600 shadow-sm ring-1 ring-violet-300/40" : "text-muted-foreground hover:text-foreground")
            }
            title="Visualização Lista"
          >
            <List className="h-3.5 w-3.5" /> Lista
          </button>
        </div>
        <Button size="sm" onClick={onAddLead} className="bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-md">
          <Plus className="h-4 w-4 mr-1" /> Novo Lead
        </Button>
      </div>
    </div>

    {showFiltros && (
      <div className="rounded-xl border bg-card p-3 grid gap-3 md:grid-cols-4 text-[11px]">
        <div className="space-y-1.5">
          <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Atendente</p>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            {(atendentesLista || []).length === 0 && (
              <span className="text-muted-foreground/60">Nenhum cadastrado</span>
            )}
            {((atendentesLista || []) as any[]).map((a) => {
              const ativo = responsaveisFiltro.includes(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => setResponsaveisFiltro((p) => ativo ? p.filter((x) => x !== a.id) : [...p, a.id])}
                  className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 border text-[10px] " + (ativo ? "bg-violet-600 text-white border-violet-600" : "bg-muted/30 hover:bg-muted")}
                >
                  {a.nome || `#${a.id}`}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Setor</p>
          <select
            value={setorFiltro ?? ""}
            onChange={(e) => setSetorFiltro(e.target.value ? Number(e.target.value) : null)}
            className="w-full h-8 rounded-md border bg-background px-2 text-[11px]"
          >
            <option value="">Todos os setores</option>
            {((setoresFiltroLista || []) as any[]).map((s) => (
              <option key={s.id} value={s.id}>{s.nome}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Período</p>
          <div className="grid grid-cols-4 gap-1">
            {(["todos", "7d", "30d", "90d"] as const).map((p) => {
              const label = p === "todos" ? "Todos" : p === "7d" ? "7d" : p === "30d" ? "30d" : "90d";
              const ativo = periodoFiltro === p;
              return (
                <button
                  key={p}
                  onClick={() => setPeriodoFiltro(p)}
                  className={"h-7 rounded text-[10px] border " + (ativo ? "bg-violet-600 text-white border-violet-600" : "bg-muted/30 hover:bg-muted")}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Valor (R$)</p>
          <div className="flex items-center gap-1">
            <Input value={valorMin} onChange={(e) => setValorMin(e.target.value)} placeholder="Mín" className="h-8 text-[11px]" />
            <span className="text-muted-foreground">–</span>
            <Input value={valorMax} onChange={(e) => setValorMax(e.target.value)} placeholder="Máx" className="h-8 text-[11px]" />
          </div>
        </div>
        {filtrosAtivos > 0 && (
          <div className="md:col-span-4">
            <button onClick={limparFiltrosAv} className="text-[10px] text-violet-600 hover:underline">
              Limpar filtros
            </button>
          </div>
        )}
      </div>
    )}

    {view === "kanban" ? (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => { setActiveId(Number(e.active.id)); onDragChange?.(true); }}
        onDragCancel={() => { setActiveId(null); onDragChange?.(false); }}
        onDragEnd={(e: DragEndEvent) => {
          setActiveId(null);
          onDragChange?.(false);
          if (!e.over) return;
          const oid = String(e.over.id);
          if (ETAPAS.includes(oid as EtapaFunil)) {
            const ld = leads.find((l: any) => l.id === Number(e.active.id));
            if (ld && ld.etapaFunil !== oid) mut.mutate({ id: ld.id, etapaFunil: oid as EtapaFunil });
          }
        }}
      >
        <div className="overflow-x-auto -mx-2 pb-2">
          <div className="grid gap-3 px-2 pt-1" style={{ gridTemplateColumns: "200px 200px 200px 200px 1fr 200px" }}>
            {ETAPAS.map((etapa) => {
              const items = itemsByEtapa[etapa];
              const val = items.reduce((s: number, l: any) => s + parseValorBR(l.valorEstimado), 0);
              return (
                <KCol key={etapa} etapa={etapa} count={items.length} val={val}>
                  <SortableContext items={idsByEtapa[etapa]} strategy={verticalListSortingStrategy}>
                    {!items.length ? (
                      <div className="p-3 min-h-[120px] flex items-center justify-center">
                        <div
                          className="w-full h-20 rounded-lg flex items-center justify-center text-[11px] text-muted-foreground/60 opacity-40"
                          style={{ border: `1.5px dashed ${ETAPA_HEX[etapa]}`, background: "white" }}
                        >
                          arraste aqui
                        </div>
                      </div>
                    ) : (
                      <div className="p-2.5 space-y-2 max-h-[820px] overflow-y-auto">
                        {items.map((l: any) => (
                          <KCard key={l.id} lead={l} onWA={onWA} onDelete={handleDeleteLead} onGoToConversa={onGoToConversa} onOpen={() => setDetalheLeadId(l.id)} />
                        ))}
                      </div>
                    )}
                  </SortableContext>
                </KCol>
              );
            })}
          </div>
        </div>
        <DragOverlay>{al ? <KOver lead={al} /> : null}</DragOverlay>
      </DndContext>
    ) : (
      <KanbanLista
        leads={leadsFiltrados}
        onWA={onWA}
        onDelete={handleDeleteLead}
        onGoToConversa={onGoToConversa}
      />
    )}
    <LeadDetalheSheet
      lead={detalheLeadId ? (leads.find((l: any) => l.id === detalheLeadId) || null) : null}
      atendentes={(atendentesLista || []) as any[]}
      onClose={() => setDetalheLeadId(null)}
      onUpdate={onUpdate}
      onGoToConversa={onGoToConversa}
      onWA={onWA}
    />

    <AlertDialog open={!!excluirLeadAlvo} onOpenChange={(o) => !o && setExcluirLeadAlvo(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir lead do pipeline?</AlertDialogTitle>
          <AlertDialogDescription>
            O lead <strong>{excluirLeadAlvo?.nome}</strong> será removido do pipeline.
            O contato e a conversa continuam — só a negociação é apagada.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={excluirMut.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); if (excluirLeadAlvo) excluirMut.mutate({ id: excluirLeadAlvo.id }); }}
            disabled={excluirMut.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {excluirMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>);
}

/** Painel lateral do Pipeline: detalhes + notas (observacoes) + edição rápida. */
function LeadDetalheSheet({ lead, atendentes, onClose, onUpdate, onGoToConversa, onWA }: {
  lead: any | null;
  atendentes: any[];
  onClose: () => void;
  onUpdate: () => void;
  onGoToConversa: (conversaId: number) => void;
  onWA?: (p: string) => void;
}) {
  const [notas, setNotas] = useState("");
  const [valorEdit, setValorEdit] = useState("");
  const [probEdit, setProbEdit] = useState(50);
  const [respEdit, setRespEdit] = useState<number | null>(null);
  const [etapaEdit, setEtapaEdit] = useState<EtapaFunil>("novo");
  const [dirty, setDirty] = useState(false);
  // Re-hidrata quando troca de lead
  useEffect(() => {
    if (!lead) return;
    setNotas(lead.observacoes || "");
    setValorEdit(lead.valorEstimado || "");
    setProbEdit(lead.probabilidade ?? 50);
    setRespEdit(lead.responsavelId ?? null);
    setEtapaEdit(lead.etapaFunil as EtapaFunil);
    setDirty(false);
  }, [lead?.id]);
  const mutEdit = trpc.crm.atualizarLead.useMutation({
    onSuccess: () => { toast.success("Lead atualizado"); setDirty(false); onUpdate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const salvar = () => {
    if (!lead) return;
    mutEdit.mutate({
      id: lead.id,
      observacoes: notas,
      valorEstimado: valorEdit || undefined,
      probabilidade: probEdit,
      responsavelId: respEdit ?? undefined,
      etapaFunil: etapaEdit,
    });
  };
  const open = !!lead;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        {lead && (
          <>
            <SheetHeader className="space-y-1">
              <div className="flex items-start gap-3">
                <div className={"w-12 h-12 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0 " + gradientFromName(lead.contatoNome || "?")}>
                  {initials(lead.contatoNome || "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-left text-base truncate">{lead.contatoNome}</SheetTitle>
                  {lead.contatoTelefone && (
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Phone className="h-3 w-3" /> {lead.contatoTelefone}
                    </p>
                  )}
                </div>
              </div>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {lead.conversaId && (
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => onGoToConversa(lead.conversaId)}>
                    <Inbox className="h-3 w-3 mr-1" /> Ir pra conversa
                  </Button>
                )}
                {lead.contatoTelefone && onWA && (
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => onWA(lead.contatoTelefone)}>
                    <PhoneCall className="h-3 w-3 mr-1" /> WhatsApp
                  </Button>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Etapa</label>
                <select
                  value={etapaEdit}
                  onChange={(e) => { setEtapaEdit(e.target.value as EtapaFunil); setDirty(true); }}
                  className="w-full h-8 rounded-md border bg-background px-2 text-xs"
                >
                  {ETAPAS.map((e) => (
                    <option key={e} value={e}>{ETAPA_FUNIL_LABELS[e]}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Valor estimado</label>
                  <Input
                    value={valorEdit}
                    onChange={(e) => { setValorEdit(e.target.value); setDirty(true); }}
                    placeholder="R$ 0,00"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Probabilidade</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range" min={0} max={100} step={5}
                      value={probEdit}
                      onChange={(e) => { setProbEdit(Number(e.target.value)); setDirty(true); }}
                      className="flex-1"
                    />
                    <span className="text-xs tabular-nums w-10 text-right">{probEdit}%</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Responsável</label>
                <select
                  value={respEdit ?? ""}
                  onChange={(e) => { setRespEdit(e.target.value ? Number(e.target.value) : null); setDirty(true); }}
                  className="w-full h-8 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="">— Sem responsável —</option>
                  {atendentes.map((a) => (
                    <option key={a.id} value={a.id}>{a.nome || `#${a.id}`}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Notas / Observações</label>
                <textarea
                  value={notas}
                  onChange={(e) => { setNotas(e.target.value); setDirty(true); }}
                  placeholder="Anote tudo sobre esse lead: contexto, próximos passos, objeções, contatos da família..."
                  className="w-full min-h-[160px] rounded-md border bg-background px-2.5 py-2 text-xs resize-y"
                  maxLength={2000}
                />
                <p className="text-[10px] text-muted-foreground text-right">{notas.length}/2000</p>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t">
                <Button onClick={salvar} disabled={!dirty || mutEdit.isPending} className="flex-1 bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700">
                  {mutEdit.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  Salvar
                </Button>
                <Button variant="outline" onClick={onClose}>Fechar</Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Visualização tabular do Pipeline — alternativa ao Kanban. */
function KanbanLista({ leads, onWA, onDelete, onGoToConversa }: {
  leads: any[];
  onWA?: (p: string) => void;
  onDelete: (id: number, nome: string) => void;
  onGoToConversa: (conversaId: number) => void;
}) {
  if (!leads.length) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <TrendingUp className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Nenhum lead encontrado.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 border-b text-[10px] uppercase font-bold text-muted-foreground tracking-wide">
          <tr>
            <th className="px-3 py-2 text-left">Lead</th>
            <th className="px-3 py-2 text-left">Telefone</th>
            <th className="px-3 py-2 text-left">Etapa</th>
            <th className="px-3 py-2 text-right">Valor</th>
            <th className="px-3 py-2 text-right">Probab.</th>
            <th className="px-3 py-2 w-32"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {leads.map((l: any) => {
            const v = parseValorBR(l.valorEstimado);
            const corBg = l.etapaFunil === "fechado_ganho" ? "bg-emerald-100 text-emerald-700"
              : l.etapaFunil === "fechado_perdido" ? "bg-rose-100 text-rose-700"
              : l.etapaFunil === "negociacao" ? "bg-amber-100 text-amber-700"
              : l.etapaFunil === "proposta" ? "bg-violet-100 text-violet-700"
              : l.etapaFunil === "qualificado" ? "bg-blue-100 text-blue-700"
              : "bg-slate-100 text-slate-700";
            return (
              <tr key={l.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <div className={"w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 " + gradientFromName(l.contatoNome || "?")}>
                      {initials(l.contatoNome || "?")}
                    </div>
                    <span className="font-medium truncate">{l.contatoNome}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{l.contatoTelefone || "—"}</td>
                <td className="px-3 py-2">
                  <span className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold " + corBg}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: ETAPA_HEX[l.etapaFunil as EtapaFunil] }} />
                    {ETAPA_FUNIL_LABELS[l.etapaFunil as EtapaFunil]}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-bold text-emerald-700 text-xs">{v > 0 ? formatBRL(v) : "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">{l.probabilidade ? `${l.probabilidade}%` : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-0.5">
                    {l.conversaId && (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600" title="Ir para conversa" onClick={() => onGoToConversa(l.conversaId)}>
                        <Inbox className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {l.contatoTelefone && onWA && (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600" title="WhatsApp" onClick={() => onWA(l.contatoTelefone)}>
                        <PhoneCall className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Excluir lead" onClick={() => onDelete(l.id, l.contatoNome)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Cor hex por etapa (border-left + dashed empty boxes + dot da etapa) */
const ETAPA_HEX: Record<EtapaFunil, string> = {
  novo: "#94a3b8",
  qualificado: "#3b82f6",
  proposta: "#a855f7",
  negociacao: "#f59e0b",
  fechado_ganho: "#10b981",
  fechado_perdido: "#ef4444",
};

/** Gradients de avatar determinístico por hash do nome — paleta consistente. */
const AVATAR_GRADIENTS = [
  "bg-gradient-to-br from-violet-500 to-pink-500",
  "bg-gradient-to-br from-blue-500 to-cyan-500",
  "bg-gradient-to-br from-amber-500 to-red-500",
  "bg-gradient-to-br from-emerald-500 to-teal-600",
  "bg-gradient-to-br from-indigo-500 to-violet-500",
  "bg-gradient-to-br from-pink-500 to-rose-500",
  "bg-gradient-to-br from-teal-500 to-emerald-500",
];
function gradientFromName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

function KCol({ etapa, count, val, children }: { etapa: EtapaFunil; count: number; val: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa });
  const st = EST[etapa];
  const isGanho = etapa === "fechado_ganho";
  return (
    <div
      ref={setNodeRef}
      className={
        "rounded-2xl border flex flex-col transition-colors " +
        st.bg + " " + st.border +
        (isOver ? " ring-2 ring-primary/30" : "")
      }
    >
      <div
        className={"px-3 py-2.5 border-b " + st.border}
        style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.4), transparent)" }}
      >
        <div className="flex items-center gap-2">
          <span className={"h-2.5 w-2.5 rounded-full " + (isGanho ? st.dot + " animate-pulse" : st.dot)} />
          <span className={"text-sm font-semibold flex-1 truncate " + (isGanho ? "text-emerald-900" : "")}>
            {ETAPA_FUNIL_LABELS[etapa]}
          </span>
          <span
            className={
              "text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full " +
              (isGanho ? "bg-emerald-600 text-white" : "bg-white/70 text-muted-foreground")
            }
          >
            {count}
          </span>
        </div>
        {val > 0 && (
          <p className={"text-[11px] font-semibold mt-1 ml-4.5 " + (isGanho ? "text-emerald-700" : "text-muted-foreground")}>
            {formatBRL(val)} {isGanho ? "fechado" : "estimado"}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function KCard({ lead, onWA, onDelete, onGoToConversa, onOpen }: { lead: any; onWA?: (p: string) => void; onDelete: (id: number, nome: string) => void; onGoToConversa: (conversaId: number) => void; onOpen?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id });
  const v = parseValorBR(lead.valorEstimado);
  const hex = ETAPA_HEX[lead.etapaFunil as EtapaFunil] || ETAPA_HEX.novo;
  // Click no card abre detalhes/notas. Drag e click coexistem via
  // activationConstraint: { distance: 5 } no PointerSensor — se mover <5px
  // dnd-kit não inicia drag, então onClick dispara normal.
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        borderLeftColor: hex,
      }}
      {...attributes}
      {...listeners}
      onClick={() => { if (!isDragging) onOpen?.(); }}
      className="rounded-xl bg-background border border-border border-l-4 px-3 py-2.5 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-grab active:cursor-grabbing group"
    >
      <div className="flex items-start gap-2.5">
        <div className={"w-9 h-9 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 " + gradientFromName(lead.contatoNome || "?")}>
          {initials(lead.contatoNome || "?")}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold truncate">{lead.contatoNome}</p>
          {lead.contatoTelefone && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
              <Phone className="h-2.5 w-2.5 flex-shrink-0" /> {lead.contatoTelefone}
            </p>
          )}
          <div className="flex items-center justify-between mt-2 gap-2">
            {v > 0 ? (
              <span className="text-[13px] font-bold text-emerald-700">{formatBRL(v)}</span>
            ) : (
              <span className="text-[10px] text-muted-foreground">sem valor</span>
            )}
            {lead.probabilidade && lead.probabilidade !== 50 && (
              <span className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-0.5 flex-shrink-0">
                <Percent className="h-2.5 w-2.5" />{lead.probabilidade}%
              </span>
            )}
          </div>
          {lead.probabilidade > 0 && (
            <div className="h-1 rounded-full bg-muted overflow-hidden mt-1.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all"
                style={{ width: lead.probabilidade + "%" }}
              />
            </div>
          )}
          {/* Ações visíveis no hover */}
          <div className="flex items-center justify-end gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {lead.conversaId && (
              <Button
                variant="ghost" size="sm"
                className="h-6 px-1.5 text-[10px] text-blue-600"
                title="Ir para conversa"
                onClick={(e) => { e.stopPropagation(); onGoToConversa(lead.conversaId); }}
              >
                <Inbox className="h-3 w-3 mr-0.5" /> Inbox
              </Button>
            )}
            {lead.contatoTelefone && onWA && (
              <Button
                variant="ghost" size="sm"
                className="h-6 w-6 p-0 text-emerald-600"
                title="WhatsApp"
                onClick={(e) => { e.stopPropagation(); onWA(lead.contatoTelefone); }}
              >
                <PhoneCall className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost" size="sm"
              className="h-6 w-6 p-0 text-destructive"
              title="Excluir lead"
              onClick={(e) => { e.stopPropagation(); onDelete(lead.id, lead.contatoNome); }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
function KOver({ lead }: { lead: any }) {
  const v = parseValorBR(lead.valorEstimado);
  const hex = ETAPA_HEX[lead.etapaFunil as EtapaFunil] || ETAPA_HEX.novo;
  return (
    <div
      className="rounded-xl bg-background border-l-4 border-2 border-primary shadow-2xl p-3 w-[200px] rotate-3"
      style={{ borderLeftColor: hex }}
    >
      <div className="flex items-start gap-2.5">
        <div className={"w-9 h-9 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 " + gradientFromName(lead.contatoNome || "?")}>
          {initials(lead.contatoNome || "?")}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold truncate">{lead.contatoNome}</p>
          {v > 0 && <span className="text-[13px] font-bold text-emerald-700">{formatBRL(v)}</span>}
        </div>
      </div>
    </div>
  );
}
