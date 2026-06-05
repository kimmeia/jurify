import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import { trpc } from "@/lib/trpc";
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
import { NovoCompromissoDialog } from "@/components/NovoCompromissoDialog";
import { MessageCircle, TrendingUp, BarChart3, Plus, Loader2, Send, Search, Phone, CheckCircle, XCircle, Inbox, PhoneCall, Percent, X, Trash2, Calendar, Mic, Square, PlusCircle, Zap, ArrowRightLeft, Link2, User, Check, AlertTriangle, List, Filter, Image as ImageIcon, FileText, Paperclip } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

// Interpola placeholders `{{nome}}`, `{{telefone}}`, `{{email}}`,
// `{{atendente}}`, `{{escritorio}}` no conteúdo do template. Variáveis
// vazias viram string vazia em vez de manter o placeholder, pra não enviar
// "Olá {{nome}}" pro cliente se ele não tiver nome cadastrado.
function interpolarTemplate(
  texto: string,
  ctx: { nome?: string | null; telefone?: string | null; email?: string | null; atendente?: string | null; escritorio?: string | null },
): string {
  const map: Record<string, string> = {
    nome: ctx.nome || "",
    telefone: ctx.telefone || "",
    email: ctx.email || "",
    atendente: ctx.atendente || "",
    escritorio: ctx.escritorio || "",
  };
  return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key) => {
    const k = String(key).toLowerCase();
    return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : `{{${key}}}`;
  });
}
import { toast } from "sonner";
import { FinanceiroBadge, FinanceiroPopover } from "@/components/FinanceiroBadge";
import { STATUS_CONVERSA_LABELS, STATUS_CONVERSA_CORES, ETAPA_FUNIL_LABELS, ORIGEM_LABELS } from "@shared/crm-types";
import type { StatusConversa, EtapaFunil } from "@shared/crm-types";
import { parseValorBR } from "@shared/valor-br";
import { FUSO_HORARIO_PADRAO, dataHojeBR, rotuloDataConversa } from "@shared/escritorio-types";
import { RespostaRapidaAutocomplete } from "@/components/atendimento/RespostaRapidaAutocomplete";
import { MagicBrief } from "./atendimento/magic-brief";
import { ConversationDiff } from "./atendimento/conversation-diff";
import { AIActionCards } from "./atendimento/ai-action-cards";
import { ComplianceGuard, ComplianceGuardBadge } from "./atendimento/compliance-guard";
import { LinhaTempoUnificada } from "./atendimento/linha-tempo-unificada";
import { AIRail } from "./atendimento/ai-rail";
import { CentroDeComando } from "./atendimento/centro-de-comando";
import { FilaChamadas } from "./atendimento/fila-chamadas";
import { useChamadaWhatsapp } from "@/hooks/whatsapp-call-context";
import { useBotToggle, botStatusInfo } from "./atendimento/use-bot-toggle";
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

const EST: Record<EtapaFunil, { bg: string; border: string; header: string; dot: string; text: string }> = {
  novo: { bg: "bg-slate-100", border: "border-slate-200", header: "bg-slate-100", dot: "bg-slate-400", text: "text-slate-700" },
  qualificado: { bg: "bg-blue-100", border: "border-blue-200", header: "bg-blue-100", dot: "bg-blue-500", text: "text-blue-700" },
  proposta: { bg: "bg-violet-100", border: "border-violet-200", header: "bg-violet-100", dot: "bg-violet-500", text: "text-violet-700" },
  negociacao: { bg: "bg-amber-100", border: "border-amber-200", header: "bg-amber-100", dot: "bg-amber-500", text: "text-amber-700" },
  fechado_ganho: { bg: "bg-emerald-100", border: "border-emerald-200", header: "bg-emerald-100", dot: "bg-emerald-500", text: "text-emerald-700" },
  fechado_perdido: { bg: "bg-red-100", border: "border-red-200", header: "bg-red-100", dot: "bg-red-400", text: "text-red-700" },
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
  // Período customizado (datas escolhidas pelo usuário). Quando preenchido,
  // tem prioridade sobre os presets acima.
  const [dataIni, setDataIni] = useState(""); // "YYYY-MM-DD"
  const [dataFim, setDataFim] = useState("");
  const [showFiltros, setShowFiltros] = useState(false);
  const [waPopup, setWaPopup] = useState<string | null>(null); const [telPopup, setTelPopup] = useState<string | null>(null);
  // Ligação de voz via WhatsApp (Calling API). Instância global (montada no
  // AppLayout) — a chamada toca em qualquer tela; aqui só usamos pra ligar.
  const chamadaWa = useChamadaWhatsapp();
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
    // Range customizado tem prioridade; senão, preset relativo.
    if (dataIni) f.dataInicio = new Date(dataIni + "T00:00:00").toISOString();
    if (dataFim) f.dataFim = new Date(dataFim + "T23:59:59").toISOString();
    if (!dataIni && !dataFim && periodoFiltro !== "todos") {
      const dias = periodoFiltro === "7d" ? 7 : periodoFiltro === "30d" ? 30 : 90;
      f.dataInicio = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
    }
    return Object.keys(f).length > 0 ? f : undefined;
  })();
  // Limite alto: o Inbox precisa enxergar além de 100 (escritório com muitos
  // contatos). Os contadores reais vêm de contarConversas (não do array).
  const { data: convsAll, refetch: rC } = trpc.crm.listarConversas.useQuery(
    { ...(filtrosBackend ?? {}), limite: 300 },
    { refetchInterval: 5000 },
  );
  const { data: countsData } = trpc.crm.contarConversas.useQuery(filtrosBackend, { refetchInterval: 5000 });
  // Listas pros dropdowns de filtro. listarAtendentes já é usado no detalhe;
  // listarSetores entra novo no escopo principal pra alimentar o filtro.
  const { data: atendentesPrincipal } = trpc.crm.listarAtendentes.useQuery();
  const { data: setoresLista } = trpc.configuracoes.listarSetores.useQuery();
  const filtrosAtivos =
    (atendentesFiltro.length > 0 ? 1 : 0) +
    (setorFiltro ? 1 : 0) +
    (periodoFiltro !== "todos" ? 1 : 0) +
    (dataIni || dataFim ? 1 : 0);
  const limparFiltrosAvancados = () => {
    setAtendentesFiltro([]);
    setSetorFiltro(null);
    setPeriodoFiltro("todos");
    setDataIni("");
    setDataFim("");
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
  // Contadores REAIS (do banco), não o length da lista capada — senão "Todas
  // 100" mentia com mais de 100 conversas.
  const counts = {
    todos: countsData?.todos ?? 0,
    aguardando: countsData?.aguardando ?? 0,
    em_atendimento: countsData?.em_atendimento ?? 0,
    resolvido: countsData?.resolvido ?? 0,
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

  // Abre a aba "Chamadas" quando o widget flutuante pede (mesma página via
  // evento; vindo de outra página via flag no sessionStorage).
  useEffect(() => {
    if (sessionStorage.getItem("jurify_abrir_chamadas")) {
      sessionStorage.removeItem("jurify_abrir_chamadas");
      setTab("chamadas");
    }
    const abrir = () => setTab("chamadas");
    window.addEventListener("jurify:abrir-chamadas", abrir);
    return () => window.removeEventListener("jurify:abrir-chamadas", abrir);
  }, []);

  // Sem `max-w-7xl mx-auto` no wrapper: o Atendimento é dashboard-style e a
  // inbox ganha mais espaço útil pro chat (coluna do meio = `1fr`) quanto
  // mais largo for o viewport — o operador reclamava do canto vazio.
  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        {/* Barra única: tabs Inbox/Pipeline à esquerda + Nova Conversa à direita.
            Substitui o card hero "Atendimento" que ocupava ~74px sem agregar — o
            nome da seção já está no menu lateral. */}
        <div className="flex items-center gap-3 flex-wrap">
          <TabsList className="h-10 w-auto">
            <TabsTrigger value="inbox" className="text-xs sm:text-sm gap-1.5 px-4"><Inbox className="h-3.5 w-3.5" /> Inbox</TabsTrigger>
            <TabsTrigger value="pipeline" className="text-xs sm:text-sm gap-1.5 px-4"><TrendingUp className="h-3.5 w-3.5" /> Pipeline</TabsTrigger>
            <TabsTrigger value="chamadas" className="text-xs sm:text-sm gap-1.5 px-4">
              <Phone className="h-3.5 w-3.5" /> Chamadas
              {chamadaWa.filaAoVivo.length > 0 && (
                <span className="ml-0.5 h-4 min-w-4 px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {chamadaWa.filaAoVivo.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={() => setShowIniciar(true)}
            className="h-10 bg-gradient-to-br from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-md shadow-emerald-500/20"
          >
            <MessageCircle className="h-4 w-4 mr-1.5" /> Nova Conversa
          </Button>
        </div>
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
                      {/* Período exato — escolhe as datas que quiser (sobrepõe os presets). */}
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        <div className="space-y-0.5">
                          <label className="text-[9px] text-muted-foreground">De</label>
                          <input
                            type="date"
                            value={dataIni}
                            max={dataFim || undefined}
                            onChange={(e) => setDataIni(e.target.value)}
                            className="w-full h-7 rounded-md border bg-background px-2 text-[11px]"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[9px] text-muted-foreground">Até</label>
                          <input
                            type="date"
                            value={dataFim}
                            min={dataIni || undefined}
                            onChange={(e) => setDataFim(e.target.value)}
                            className="w-full h-7 rounded-md border bg-background px-2 text-[11px]"
                          />
                        </div>
                      </div>
                      {(dataIni || dataFim) && (
                        <p className="text-[9px] text-muted-foreground">Período exato ativo — os presets acima ficam ignorados.</p>
                      )}
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
                  onTransferido={() => {
                    setSelId(null);
                    rC();
                  }}
                  onAbrirLinhaTempo={() => {
                    const conv = (convs || []).find((c: any) => c.id === selId);
                    if (conv?.contatoId) setShowLinhaTempo(conv.contatoId);
                  }}
                  onLigarWhatsApp={(info) => chamadaWa.ligar(info)}
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
                  conversaStatus={convAtual?.status}
                  onUpdate={rC}
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
        <TabsContent value="chamadas"><FilaChamadas chamada={chamadaWa} /></TabsContent>
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

function ChatArea({ cid, convs, onUpdate, onLeadUpdate, onWA, onTel, onDeleted, onTransferido, onAbrirLinhaTempo, onLigarWhatsApp }: { cid: number; convs: any[]; onUpdate: () => void; onLeadUpdate: () => void; onWA?: (p: string) => void; onTel?: (p: string) => void; onDeleted: () => void; onTransferido?: () => void; onAbrirLinhaTempo?: () => void; onLigarWhatsApp?: (info: { canalId: number; telefone: string; contatoId?: number; contatoNome?: string; conversaId: number }) => void }) {
  const [msg, setMsg] = useState(""); const ref = useRef<HTMLDivElement>(null);
  // Mídia "pendente": foi anexada via template (ou upload manual no futuro)
  // mas ainda não foi enviada. Renderiza preview acima do composer e é
  // limpa após o send. Sem isso, escolher template com PDF só substituía o
  // texto e perdia a mídia.
  const [pendingMedia, setPendingMedia] = useState<{ url: string; tipo: "imagem" | "video" | "audio" | "documento"; nome?: string } | null>(null);
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
    onSuccess: () => { toast.success("Conversa transferida!"); setShowTransferir(false); (onTransferido ?? onUpdate)(); },
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
  const bot = botStatusInfo(conv?.status);
  const botToggle = useBotToggle(onUpdate);
  const { data: msgs, refetch } = trpc.crm.listarMensagens.useQuery({ conversaId: cid }, { refetchInterval: 3000 });
  // Fuso do escritório (Configurações → Escritório) — datas/horas do chat
  // seguem o relógio do operador, não o UTC do server.
  const { data: meuEscr } = trpc.configuracoes.meuEscritorio.useQuery();
  const tz = meuEscr?.escritorio?.fusoHorario || FUSO_HORARIO_PADRAO;
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
  const enviar = trpc.crm.enviarMensagem.useMutation({
    onSuccess: () => { setMsg(""); setPendingMedia(null); refetch(); onUpdate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const atualizar = trpc.crm.atualizarConversa.useMutation({ onSuccess: () => { onUpdate(); toast.success("Atualizado!"); } });
  const excluir = trpc.crm.excluirConversa.useMutation({ onSuccess: () => { toast.success("Conversa excluída."); onDeleted(); }, onError: (e: any) => toast.error(e.message) });
  // Auto-scroll só dispara em mudanças do LIVE (polling/envio), não quando
  // prependemos antigas — senão o "carregar mais" pulava pra fim e o usuário
  // perdia o que queria ler.
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [msgs]);
  const send = () => {
    const texto = msg.trim();
    if (!texto && !pendingMedia) return;
    enviar.mutate({
      conversaId: cid,
      conteudo: texto || (pendingMedia?.nome ?? ""),
      tipo: pendingMedia?.tipo,
      mediaUrl: pendingMedia?.url,
    });
  };
  // Aplica template: interpola {{nome}}, {{telefone}}, {{email}}, {{atendente}},
  // {{escritorio}} contra o contato atual e o usuário logado. Mídia anexada
  // ao template vai pra `pendingMedia` e é incluída no próximo envio.
  const { user: usuarioLogado } = useAuth();
  const aplicarTemplate = (t: any) => {
    const c = convs.find((x: any) => x.id === cid);
    const interpolado = interpolarTemplate(String(t.conteudo || ""), {
      nome: c?.contatoNome,
      telefone: c?.contatoTelefone,
      email: c?.contatoEmail,
      atendente: usuarioLogado?.name,
      escritorio: (usuarioLogado as any)?.escritorioNome,
    });
    setMsg(interpolado);
    if (t.midiaUrl && t.midiaTipo) {
      setPendingMedia({ url: String(t.midiaUrl), tipo: t.midiaTipo, nome: t.titulo });
    } else {
      setPendingMedia(null);
    }
    setShowTemplates(false);
  };

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
            {/* Pill do bot: indicador + toggle rápido. O controle completo vive no
                Customer 360, mas este atalho garante visibilidade com o painel colapsado. */}
            {bot.managed && conv && (
              <button
                type="button"
                onClick={() => botToggle.toggle(conv.id, bot.pausado)}
                disabled={botToggle.pending}
                title={bot.pausado ? "Bot pausado — clique para reativar" : "Bot ativo — clique para pausar e assumir"}
                className={
                  "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-semibold transition disabled:opacity-50 " +
                  (bot.pausado
                    ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800")
                }
              >
                <span className={"w-1.5 h-1.5 rounded-full " + (bot.pausado ? "bg-amber-500" : "bg-emerald-500")} />
                <Bot className="h-3 w-3" />
                {bot.pausado ? "Bot pausado" : "Bot ativo"}
              </button>
            )}
          </div>
          {(conv?.contatoTelefone || conv?.chatIdExterno) && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {conv.contatoTelefone || conv.chatIdExterno?.replace(/@.*/, "")}
            </p>
          )}
        </div>
        {(conv?.contatoTelefone || conv?.chatIdExterno) && (onWA || onTel || onLigarWhatsApp) && (() => {
          const tel = conv.contatoTelefone || conv.chatIdExterno?.replace(/@.*/, "") || "";
          const podeLigarWa = !!onLigarWhatsApp && conv?.canalTipo === "whatsapp_api" && !!conv?.canalId && !!tel;
          return (
            <div className="flex items-center gap-1 shrink-0">
              {onWA && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600" title="Abrir conversa no WhatsApp" onClick={() => onWA(tel)}><PhoneCall className="h-3.5 w-3.5" /></Button>}
              {podeLigarWa && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-green-600" title="Ligar via WhatsApp" onClick={() => onLigarWhatsApp!({ canalId: conv.canalId, telefone: tel.replace(/\D/g, ""), contatoId: conv.contatoId, contatoNome: conv.contatoNome, conversaId: conv.id })}><Phone className="h-3.5 w-3.5" /></Button>}
              {onTel && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600" title="Ligar (Twilio)" onClick={() => onTel(tel)}><Phone className="h-3.5 w-3.5" /></Button>}
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
        (() => {
          const todas = [...older, ...(msgs || [])];
          return todas.map((m: any, i: number) => {
            const anterior = i > 0 ? todas[i - 1] : null;
            const novaData = !anterior || dataHojeBR(tz, new Date(anterior.createdAt)) !== dataHojeBR(tz, new Date(m.createdAt));
            return (
              <Fragment key={m.id}>
                {novaData && (
                  <div className="flex justify-center">
                    <span className="bg-muted text-muted-foreground text-[11px] font-medium px-3 py-1 rounded-full">
                      {rotuloDataConversa(m.createdAt, tz)}
                    </span>
                  </div>
                )}
                <div className={"flex " + (m.direcao === "saida" ? "justify-end" : "justify-start")}>
                  <div className={"max-w-[70%] rounded-2xl px-3.5 py-2 " + (m.direcao === "saida" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md") + (m.direcao === "saida" && m.status === "falha" ? " ring-2 ring-destructive/60" : "")}>
                    {m.remetenteNome && m.direcao === "saida" && <p className="text-[10px] opacity-60 mb-0.5">{m.remetenteNome}</p>}
                    {renderMsgContent(m)}
                    <div className={"flex items-center gap-1 justify-end mt-1 text-[10px] " + (m.direcao === "saida" ? "opacity-70" : "text-muted-foreground")}>
                      <span>{new Date(m.createdAt).toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}</span>
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
              </Fragment>
            );
          });
        })()
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

      {/* Preview de mídia anexada (vinda do template). Some ao enviar. */}
      {pendingMedia && (
        <div className="mx-3 mb-1 flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-md px-2.5 py-1.5">
          {pendingMedia.tipo === "imagem" ? <ImageIcon className="h-3.5 w-3.5 text-emerald-700 shrink-0" /> :
           pendingMedia.tipo === "documento" ? <FileText className="h-3.5 w-3.5 text-emerald-700 shrink-0" /> :
           <Paperclip className="h-3.5 w-3.5 text-emerald-700 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200 truncate">
              {pendingMedia.nome || pendingMedia.tipo}
            </p>
            <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 truncate">{pendingMedia.url}</p>
          </div>
          <button
            onClick={() => setPendingMedia(null)}
            className="text-emerald-700 hover:text-emerald-900 shrink-0"
            title="Remover anexo"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
              <div className="max-h-72 overflow-y-auto space-y-0.5">
                {tplList.map((t: any) => (
                  <div
                    key={t.id}
                    className="rounded-md px-2 py-1.5 cursor-pointer hover:bg-muted text-sm transition-colors"
                    onClick={() => aplicarTemplate(t)}
                  >
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-xs">{t.titulo}</p>
                      {t.atalho && (
                        <span className="font-mono text-[10px] bg-violet-100 text-violet-700 px-1 py-0.5 rounded">
                          /{t.atalho}
                        </span>
                      )}
                      {t.midiaTipo && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded">
                          {t.midiaTipo === "imagem" ? <ImageIcon className="h-2.5 w-2.5" /> :
                           t.midiaTipo === "documento" ? <FileText className="h-2.5 w-2.5" /> :
                           <Paperclip className="h-2.5 w-2.5" />}
                          {t.midiaTipo}
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
          interpolar={(c) => {
            const conv = convs.find((x: any) => x.id === cid);
            return interpolarTemplate(c, {
              nome: conv?.contatoNome,
              telefone: conv?.contatoTelefone,
              email: conv?.contatoEmail,
              atendente: usuarioLogado?.name,
              escritorio: (usuarioLogado as any)?.escritorioNome,
            });
          }}
          onTemplateConfirmado={(tpl) => {
            if (tpl.midiaUrl && tpl.midiaTipo) {
              setPendingMedia({ url: String(tpl.midiaUrl), tipo: tpl.midiaTipo, nome: tpl.titulo });
            }
          }}
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
    {showAgendar && (
      <NovoCompromissoDialog
        open={showAgendar}
        onOpenChange={setShowAgendar}
        contexto={conv?.contatoId ? { contatoId: conv.contatoId, contatoNome: conv?.contatoNome || "" } : undefined}
      />
    )}

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
  // Drag HTML5 nativo (mesmo padrão do Kanban). Tentativas anteriores com
  // dnd-kit quebravam quando o drop caía sobre outro card (e.over.id virava
  // id numérico, não a etapa) ou logo após fechar o Sheet (Radix prendia
  // pointer-events). HTML5 nativo + handlers explícitos resolve os 2.
  const [dragLeadId, setDragLeadId] = useState<number | null>(null);
  const [dragOverLeadId, setDragOverLeadId] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [compacto, setCompacto] = useState(false);
  const [excluirLeadAlvo, setExcluirLeadAlvo] = useState<{ id: number; nome: string } | null>(null);
  const [detalheLeadId, setDetalheLeadId] = useState<number | null>(null);
  // Bug conhecido do Radix Dialog (1.x): ao fechar o Sheet/Dialog ele às vezes
  // deixa o body em `pointer-events: none` por um frame extra. Isso captura o
  // pointerdown do próximo card, e o dnd-kit não consegue iniciar drag. Após
  // fechar o Sheet, força limpeza. Idempotente — se já estiver limpo, no-op.
  useEffect(() => {
    if (detalheLeadId !== null) return;
    const id = setTimeout(() => {
      if (document.body.style.pointerEvents === "none") {
        document.body.style.pointerEvents = "";
      }
    }, 100);
    return () => clearTimeout(id);
  }, [detalheLeadId]);
  // Filtros avançados
  const [responsaveisFiltro, setResponsaveisFiltro] = useState<number[]>([]);
  const [setorFiltro, setSetorFiltro] = useState<number | null>(null);
  const [canalFiltro, setCanalFiltro] = useState<number | null>(null);
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
  const handleDeleteLead = (id: number, nome: string) => setExcluirLeadAlvo({ id, nome });

  // Métricas "do mês" usam `fechadoEm` (timestamp setado APENAS quando o lead
  // virou fechado_ganho/perdido). Antes usava `updatedAt`, que muda em
  // qualquer edição — leads fechados há meses sumiam da view só porque
  // ninguém editou desde, e edições no card davam a impressão de "fechou
  // agora" mesmo quando o status não tinha mudado.
  const inicioMesTs = useMemo(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const fechouNoMes = (l: any) =>
    l.fechadoEm && new Date(l.fechadoEm).getTime() >= inicioMesTs;

  // Handler único de drop: move lead pra etapa destino com optimistic update.
  // Cobre tanto drop na coluna (id da etapa) quanto drop sobre outro card
  // (pega a etapa do card-alvo).
  const moverLeadPara = (etapaDestino: EtapaFunil) => {
    if (!dragLeadId) return;
    const id = dragLeadId;
    setDragLeadId(null);
    setDragOverLeadId(null);
    onDragChange?.(false);
    const ld = leads.find((l: any) => l.id === id);
    if (!ld || ld.etapaFunil === etapaDestino) return;
    mut.mutate({ id, etapaFunil: etapaDestino });
  };

  // Listas dos filtros (atendentes + setores + canais)
  const { data: atendentesLista } = trpc.crm.listarAtendentes.useQuery();
  const { data: setoresFiltroLista } = trpc.configuracoes.listarSetores.useQuery();
  const { data: canaisFiltroLista } = trpc.configuracoes.listarCanais.useQuery();
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
    if (canalFiltro && l.canalId !== canalFiltro) return false;
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
    (canalFiltro ? 1 : 0) +
    (periodoFiltro !== "todos" ? 1 : 0) +
    (vMin !== null || vMax !== null ? 1 : 0);
  const limparFiltrosAv = () => {
    setResponsaveisFiltro([]); setSetorFiltro(null); setCanalFiltro(null); setPeriodoFiltro("todos"); setValorMin(""); setValorMax("");
  };

  // Cards agrupados por etapa pro board. As colunas de FECHADO (ganho e
  // perdido) só mostram os do mês corrente — alinhado com KPI e taxa de
  // conversão. Usa `fechadoEm` (não `updatedAt`) pra ser fiel ao momento
  // real do fechamento, sem ser afetado por edições posteriores no card.
  const itemsByEtapa = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const e of ETAPAS) map[e] = [];
    for (const l of leadsFiltrados) {
      if (l.etapaFunil === "fechado_ganho" || l.etapaFunil === "fechado_perdido") {
        if (!l.fechadoEm || new Date(l.fechadoEm).getTime() < inicioMesTs) continue;
      }
      if (map[l.etapaFunil]) map[l.etapaFunil].push(l);
    }
    return map;
  }, [leadsFiltrados, inicioMesTs]);

  // KPIs agora usam `leadsFiltrados` — respeitam Setor, Atendente, Período
  // e faixa de Valor aplicados via filtros. Sem filtros, equivalente a leads.
  // - Total de leads: contagem do conjunto filtrado.
  // - Em pipeline: soma dos leads abertos (não fechados).
  // - Ganhos do mês: soma dos fechados_ganho cujo fechadoEm cai no mês.
  // - Taxa de conversão: ganhos/(ganhos+perdidos) do mês.
  const total = leadsFiltrados.filter((l: any) => !l.etapaFunil.startsWith("fechado")).reduce((s: number, l: any) => s + parseValorBR(l.valorEstimado), 0);
  const totalGanhoMes = leadsFiltrados
    .filter((l: any) => l.etapaFunil === "fechado_ganho" && fechouNoMes(l))
    .reduce((s: number, l: any) => s + parseValorBR(l.valorEstimado), 0);
  const fechadosGanhoMes = leadsFiltrados.filter((l: any) => l.etapaFunil === "fechado_ganho" && fechouNoMes(l)).length;
  const fechadosPerdMes = leadsFiltrados.filter((l: any) => l.etapaFunil === "fechado_perdido" && fechouNoMes(l)).length;
  const taxaConv = fechadosGanhoMes + fechadosPerdMes > 0
    ? Math.round((fechadosGanhoMes / (fechadosGanhoMes + fechadosPerdMes)) * 100)
    : null;

  return (<div className="space-y-4">
    {/* Hero gradient com 4 KPIs */}
    <div
      className="relative overflow-hidden rounded-2xl px-6 py-5 text-white shadow-lg"
      style={{
        background:
          "radial-gradient(circle at 20% 0%, rgba(255,255,255,0.18), transparent 40%), " +
          "radial-gradient(circle at 80% 100%, rgba(255,255,255,0.12), transparent 50%), " +
          "linear-gradient(135deg, #4338ca 0%, #4f46e5 40%, #06b6d4 100%)",
      }}
    >
      <div className="flex items-start gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight leading-tight">Pipeline de Vendas</h2>
          <p className="text-xs text-white/85 mt-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full text-[10px] font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              Atualização ao vivo
            </span>
            Negociações em andamento · arraste os cards entre etapas
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-4">
        <KpiCard
          label="Total de leads"
          value={String(leadsFiltrados.length)}
          hint={(filtrosAtivos > 0 || buscaQ) ? `de ${leads.length} no total` : undefined}
        />
        <KpiCard label="Ganhos do mês" value={formatBRL(totalGanhoMes)} hint={new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })} />
        <KpiCard label="Em pipeline" value={formatBRL(total)} />
        <KpiCard label="Taxa de conversão" value={taxaConv !== null ? `${taxaConv}%` : "—"} hint={taxaConv === null ? "sem fechamentos no mês" : `${fechadosGanhoMes} ganhos / ${fechadosPerdMes} perdidos`} />
      </div>
    </div>

    {/* Toolbar */}
    <div className="rounded-xl border bg-card p-2.5 flex items-center gap-2 flex-wrap">
      <div className="relative flex-1 max-w-xs">
        <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou telefone…"
          className="h-9 pl-8 pr-3 text-xs bg-muted/30"
        />
      </div>
      <button
        onClick={() => setShowFiltros((v) => !v)}
        className={
          "relative h-9 px-3 inline-flex items-center gap-1.5 rounded-md border text-xs font-semibold transition " +
          (filtrosAtivos > 0 || showFiltros
            ? "border-violet-500 text-violet-700 bg-violet-50"
            : "text-muted-foreground hover:bg-muted")
        }
        title="Filtros: atendente, setor, período, valor"
      >
        <Filter className="h-3.5 w-3.5" />
        Filtros
        {filtrosAtivos > 0 && (
          <span className="inline-flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-violet-600 text-white text-[9px] font-bold">
            {filtrosAtivos}
          </span>
        )}
      </button>
      <div className="flex-1" />
      <div className="inline-flex items-center bg-muted/40 rounded-lg p-0.5">
        <button
          type="button"
          onClick={() => setCompacto(false)}
          className={
            "px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition " +
            (!compacto ? "bg-background text-violet-600 shadow-sm" : "text-muted-foreground hover:text-foreground")
          }
          title="Cards no tamanho normal"
        >
          Normal
        </button>
        <button
          type="button"
          onClick={() => setCompacto(true)}
          className={
            "px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition " +
            (compacto ? "bg-background text-violet-600 shadow-sm" : "text-muted-foreground hover:text-foreground")
          }
          title="Cards menores — cabem mais por coluna"
        >
          Compacto
        </button>
      </div>
      <div className="inline-flex items-center bg-muted/40 rounded-lg p-0.5">
        <button
          type="button"
          onClick={() => setView("kanban")}
          className={
            "px-2.5 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition " +
            (view === "kanban" ? "bg-background text-violet-600 shadow-sm" : "text-muted-foreground hover:text-foreground")
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
            (view === "lista" ? "bg-background text-violet-600 shadow-sm" : "text-muted-foreground hover:text-foreground")
          }
          title="Visualização Lista"
        >
          <List className="h-3.5 w-3.5" /> Lista
        </button>
      </div>
      <Button size="sm" onClick={onAddLead} className="bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-md h-9">
        <Plus className="h-4 w-4 mr-1" /> Novo Lead
      </Button>
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
          <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Canal de comunicação</p>
          <select
            value={canalFiltro ?? ""}
            onChange={(e) => setCanalFiltro(e.target.value ? Number(e.target.value) : null)}
            className="w-full h-8 rounded-md border bg-background px-2 text-[11px]"
          >
            <option value="">Todos os canais</option>
            {(((canaisFiltroLista as any)?.canais || []) as any[])
              .filter((c) => c.status !== "removido")
              .map((c) => {
                const telLabel = c.telefone ? ` · ${c.telefone}` : "";
                return (
                  <option key={c.id} value={c.id}>
                    {c.nome || c.tipo}{telLabel}
                  </option>
                );
              })}
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
      // Mesmo layout do Kanban de tarefas: flex horizontal com scroll, colunas
      // de largura fixa, maxHeight + scroll interno, header sticky. Drag HTML5
      // nativo (não dnd-kit) — comprovadamente confiável em produção.
      <div className="flex gap-4 overflow-x-auto pb-4 px-2">
        {ETAPAS.map((etapa) => {
          const items = itemsByEtapa[etapa];
          const val = items.reduce((s: number, l: any) => s + parseValorBR(l.valorEstimado), 0);
          const st = EST[etapa];
          const isGanho = etapa === "fechado_ganho";
          const isOver = dragLeadId !== null;
          return (
            <div
              key={etapa}
              className={
                "flex-shrink-0 rounded-xl p-3 flex flex-col gap-2 bg-muted/30 " +
                (compacto ? "w-60" : "w-72")
              }
              style={{ maxHeight: "calc(100vh - 260px)" }}
              onDragOver={(e) => { if (dragLeadId) e.preventDefault(); }}
              onDrop={() => moverLeadPara(etapa)}
            >
              {/* Header sticky no topo da coluna */}
              <div
                className="sticky top-0 z-10 bg-muted/30 backdrop-blur -mx-3 -mt-3 px-3 pt-3 pb-2 rounded-t-xl"
              >
                <div className="flex items-center gap-2">
                  <span className={"h-2.5 w-2.5 rounded-full shrink-0 " + (isGanho ? st.dot + " animate-pulse" : st.dot)} />
                  <span className={"text-xs font-bold uppercase tracking-wide flex-1 truncate " + (isGanho ? "text-emerald-800" : "text-foreground")}>
                    {ETAPA_FUNIL_LABELS[etapa]}
                  </span>
                  <Badge variant="outline" className={"text-[10px] h-5 px-1.5 shrink-0 " + (isGanho ? "bg-emerald-600 text-white border-emerald-600" : "")}>
                    {items.length}
                  </Badge>
                </div>
                {val > 0 && (
                  <p className={"text-[11px] font-semibold mt-1 ml-[18px] " + (isGanho ? "text-emerald-700" : "text-muted-foreground")}>
                    {formatBRL(val)} {isGanho ? "fechado" : "estimado"}
                  </p>
                )}
              </div>

              {/* Lista de cards com scroll interno */}
              <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
                {items.length === 0 ? (
                  <div
                    className={
                      "rounded-lg flex items-center justify-center text-[11px] py-6 transition-colors " +
                      (isOver
                        ? "border-2 border-dashed border-violet-400 bg-violet-50 text-violet-700"
                        : "border border-dashed border-slate-300 text-muted-foreground/60")
                    }
                  >
                    {isOver ? "soltar aqui" : "arraste aqui"}
                  </div>
                ) : (
                  items.map((l: any) => (
                    <KCard
                      key={l.id}
                      lead={l}
                      onWA={onWA}
                      onDelete={handleDeleteLead}
                      onGoToConversa={onGoToConversa}
                      onOpen={() => setDetalheLeadId(l.id)}
                      compacto={compacto}
                      isDragging={dragLeadId === l.id}
                      isOver={dragOverLeadId === l.id && dragLeadId !== l.id}
                      onDragStartLead={() => { setDragLeadId(l.id); onDragChange?.(true); }}
                      onDragEndLead={() => { setDragLeadId(null); setDragOverLeadId(null); onDragChange?.(false); }}
                      onDragOverLead={() => {
                        if (dragLeadId && dragLeadId !== l.id && dragOverLeadId !== l.id) {
                          setDragOverLeadId(l.id);
                        }
                      }}
                      onDropOnLead={() => {
                        // Drop sobre outro card: move pra etapa desse card (mesmo
                        // fix que tentei no dnd-kit, mas agora explícito).
                        if (!dragLeadId || dragLeadId === l.id) return;
                        moverLeadPara(l.etapaFunil as EtapaFunil);
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
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
  const etapaSt = lead ? EST[lead.etapaFunil as EtapaFunil] : null;
  // Formata telefone tipo "85 98811-1508" (DDI opcional). Pra simplificar
  // só assumo formato BR 10/11/12/13 dígitos com ou sem 55 prefix.
  const fmtTel = (tel: string | null | undefined): string => {
    if (!tel) return "";
    const d = tel.replace(/\D/g, "");
    if (d.length >= 12 && d.startsWith("55")) {
      const rest = d.slice(2);
      const ddd = rest.slice(0, 2);
      const num = rest.slice(2);
      if (num.length === 9) return `${ddd} ${num.slice(0, 5)}-${num.slice(5)}`;
      if (num.length === 8) return `${ddd} ${num.slice(0, 4)}-${num.slice(4)}`;
    }
    if (d.length === 11) return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
    return tel;
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col gap-0">
        {lead && (
          <>
            {/* HEADER */}
            <div className="px-5 pt-5 pb-4 border-b">
              <div className="flex items-start gap-3 pr-8">
                <div className={"w-[52px] h-[52px] rounded-xl flex items-center justify-center text-white text-base font-bold flex-shrink-0 " + gradientFromName(lead.contatoNome || "?")}>
                  {initials(lead.contatoNome || "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SheetTitle className="text-left text-lg leading-tight truncate">{lead.contatoNome}</SheetTitle>
                    {etapaSt && (
                      <span className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide " + etapaSt.bg + " " + etapaSt.text}>
                        <span className={"h-1.5 w-1.5 rounded-full " + etapaSt.dot} />
                        {ETAPA_FUNIL_LABELS[lead.etapaFunil as EtapaFunil]}
                      </span>
                    )}
                  </div>
                  {lead.contatoTelefone && (
                    <p className="text-[12.5px] text-muted-foreground flex items-center gap-1.5 mt-1">
                      <Phone className="h-3 w-3" /> {fmtTel(lead.contatoTelefone)}
                    </p>
                  )}
                </div>
              </div>
              {/* Quick actions */}
              <div className="grid grid-cols-2 gap-2 mt-3.5">
                {lead.conversaId ? (
                  <button
                    onClick={() => onGoToConversa(lead.conversaId)}
                    className="h-9 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-[12.5px] font-semibold hover:bg-blue-100"
                  >
                    <Inbox className="h-3.5 w-3.5" /> Ir pra conversa
                  </button>
                ) : (
                  <div className="h-9 rounded-lg bg-muted/30 border border-dashed text-muted-foreground text-[11px] inline-flex items-center justify-center">Sem conversa</div>
                )}
                {lead.contatoTelefone && onWA ? (
                  <button
                    onClick={() => onWA(lead.contatoTelefone)}
                    className="h-9 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[12.5px] font-semibold hover:bg-emerald-100"
                  >
                    <PhoneCall className="h-3.5 w-3.5" /> WhatsApp
                  </button>
                ) : (
                  <div className="h-9 rounded-lg bg-muted/30 border border-dashed text-muted-foreground text-[11px] inline-flex items-center justify-center">Sem WhatsApp</div>
                )}
              </div>
            </div>

            {/* BODY */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

              {/* Seção: Status e Valor */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                  <BarChart3 className="h-3 w-3" /> Status e Valor
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground/80">Etapa</label>
                    <select
                      value={etapaEdit}
                      onChange={(e) => { setEtapaEdit(e.target.value as EtapaFunil); setDirty(true); }}
                      className="w-full h-9 rounded-lg border bg-background px-2.5 text-[13px]"
                    >
                      {ETAPAS.map((e) => (
                        <option key={e} value={e}>{ETAPA_FUNIL_LABELS[e]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-foreground/80">Valor estimado</label>
                      <Input
                        value={valorEdit}
                        onChange={(e) => { setValorEdit(e.target.value); setDirty(true); }}
                        placeholder="R$ 0,00"
                        className="h-9 text-[13px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-foreground/80">Probabilidade</label>
                      <div className="flex items-center gap-2.5 h-9 px-3 rounded-lg border bg-background">
                        <input
                          type="range" min={0} max={100} step={5}
                          value={probEdit}
                          onChange={(e) => { setProbEdit(Number(e.target.value)); setDirty(true); }}
                          className="flex-1"
                        />
                        <span className="text-[13px] font-bold text-violet-700 tabular-nums w-9 text-right">{probEdit}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground/80">Responsável</label>
                    <select
                      value={respEdit ?? ""}
                      onChange={(e) => { setRespEdit(e.target.value ? Number(e.target.value) : null); setDirty(true); }}
                      className="w-full h-9 rounded-lg border bg-background px-2.5 text-[13px]"
                    >
                      <option value="">— Sem responsável —</option>
                      {atendentes.map((a) => (
                        <option key={a.id} value={a.id}>{a.nome || `#${a.id}`}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Seção: Notas */}
              <div className="pt-5 border-t">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                  <ScrollText className="h-3 w-3" /> Notas e Observações
                </p>
                <textarea
                  value={notas}
                  onChange={(e) => { setNotas(e.target.value); setDirty(true); }}
                  placeholder="Contexto, próximos passos, objeções, contatos da família…"
                  className="w-full min-h-[180px] rounded-lg border bg-background px-3 py-2.5 text-[13px] resize-y leading-relaxed placeholder:italic placeholder:text-muted-foreground/60"
                  maxLength={2000}
                />
                <p className="text-[10.5px] text-muted-foreground text-right mt-1">{notas.length} / 2000</p>
              </div>
            </div>

            {/* FOOTER */}
            <div className="px-5 py-3.5 border-t bg-background shadow-[0_-4px_12px_rgba(0,0,0,0.04)] flex items-center gap-2">
              <Button variant="outline" onClick={onClose} className="font-semibold">
                Fechar
              </Button>
              <Button
                onClick={salvar}
                disabled={!dirty || mutEdit.isPending}
                className="flex-1 h-10 bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 font-bold shadow-md shadow-indigo-500/25"
              >
                {mutEdit.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
                Salvar alterações
              </Button>
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

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white/12 border border-white/20 backdrop-blur-sm px-3.5 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-85">{label}</p>
      <p className="text-xl font-extrabold leading-tight tabular-nums mt-0.5 -tracking-tight">{value}</p>
      {hint && <p className="text-[10px] opacity-80 mt-0.5">{hint}</p>}
    </div>
  );
}

/** Cor do chip baseada na origem do lead (paleta segura, fallback cinza). */
function corOrigem(origem: string): { bg: string; text: string; dot: string } {
  const s = (origem || "").toLowerCase();
  if (s.includes("indica")) return { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500" };
  if (s.includes("facebook") || s.includes("fb") || s.includes("instagram") || s.includes("meta")) return { bg: "bg-violet-100", text: "text-violet-700", dot: "bg-violet-500" };
  if (s.includes("google")) return { bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-500" };
  if (s.includes("site") || s.includes("organico")) return { bg: "bg-cyan-100", text: "text-cyan-700", dot: "bg-cyan-500" };
  if (s.includes("ligac") || s.includes("telefone") || s.includes("call")) return { bg: "bg-amber-100", text: "text-amber-700", dot: "bg-amber-500" };
  if (s.includes("evento") || s.includes("present")) return { bg: "bg-pink-100", text: "text-pink-700", dot: "bg-pink-500" };
  return { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-400" };
}

/** Badge contextual por etapa: diz o próximo passo pro atendente. */
const ACAO_POR_ETAPA: Partial<Record<EtapaFunil, { label: string; emoji: string; tone: "amber" | "emerald" }>> = {
  qualificado: { label: "Enviar proposta", emoji: "⚡", tone: "amber" },
  proposta: { label: "Aguardando assinatura", emoji: "📄", tone: "amber" },
  negociacao: { label: "Negociar fechamento", emoji: "🤝", tone: "amber" },
  fechado_ganho: { label: "Lançar cobrança", emoji: "💰", tone: "emerald" },
};

function KCard({ lead, onWA, onDelete, onGoToConversa, onOpen, compacto, isDragging, isOver, onDragStartLead, onDragEndLead, onDragOverLead, onDropOnLead }: {
  lead: any;
  onWA?: (p: string) => void;
  onDelete: (id: number, nome: string) => void;
  onGoToConversa: (conversaId: number) => void;
  onOpen?: () => void;
  compacto?: boolean;
  isDragging?: boolean;
  isOver?: boolean;
  onDragStartLead?: () => void;
  onDragEndLead?: () => void;
  onDragOverLead?: () => void;
  onDropOnLead?: () => void;
}) {
  const v = parseValorBR(lead.valorEstimado);
  const hex = ETAPA_HEX[lead.etapaFunil as EtapaFunil] || ETAPA_HEX.novo;
  const etapa = lead.etapaFunil as EtapaFunil;
  const isGanho = etapa === "fechado_ganho";
  const isPerd = etapa === "fechado_perdido";

  // Dias parado: usa updatedAt do lead. Escala: ≤3d cinza, 4-7d laranja
  // (warn), >7d vermelho (danger). Pra Ganho/Perdido não mostra dias —
  // mostra "✓ Fechado" / "Encerrado".
  const diasParado = lead.updatedAt ? Math.floor((Date.now() - new Date(lead.updatedAt).getTime()) / (24 * 60 * 60 * 1000)) : null;
  const paradoCls = diasParado === null || isGanho || isPerd
    ? "text-muted-foreground"
    : diasParado > 7 ? "text-red-700 font-semibold"
    : diasParado > 3 ? "text-orange-700 font-semibold"
    : "text-muted-foreground";

  const acao = ACAO_POR_ETAPA[etapa];
  const corOrig = lead.origemLead ? corOrigem(lead.origemLead) : null;

  // Background sutil pra Ganho/Perdido (mostra status do card só de bater o olho)
  const cardBg = isGanho
    ? "bg-gradient-to-br from-emerald-50/70 to-white"
    : isPerd
    ? "bg-gradient-to-br from-rose-50/70 to-white"
    : "bg-white";

  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStartLead?.(); }}
      onDragEnd={() => onDragEndLead?.()}
      onDragOver={(e) => {
        if (isDragging) return;
        e.preventDefault();
        e.stopPropagation();
        onDragOverLead?.();
      }}
      onDrop={(e) => {
        if (isDragging) return;
        e.preventDefault();
        e.stopPropagation();
        onDropOnLead?.();
      }}
      style={{ borderLeftColor: hex, opacity: isDragging ? 0.4 : 1 }}
      onClick={() => { if (!isDragging) onOpen?.(); }}
      className={
        "relative rounded-xl border border-l-[3px] shadow-sm hover:shadow-md hover:border-slate-400 transition-all cursor-pointer active:cursor-grabbing group " +
        cardBg +
        (isOver ? " ring-2 ring-violet-500 ring-offset-1 border-violet-300" : " border-slate-200") +
        (compacto ? " px-2.5 py-2" : " p-3")
      }
    >
      <div className="flex items-start gap-2.5">
        <div className={(compacto ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-[11px]") + " rounded-lg flex items-center justify-center text-white font-bold flex-shrink-0 " + gradientFromName(lead.contatoNome || "?")}>
          {initials(lead.contatoNome || "?")}
        </div>
        <div className="flex-1 min-w-0">
          <p className={(compacto ? "text-[12px]" : "text-[13px]") + " font-semibold truncate text-foreground"}>{lead.contatoNome}</p>
          {!compacto && lead.contatoTelefone && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
              <Phone className="h-2.5 w-2.5 flex-shrink-0" /> {lead.contatoTelefone}
            </p>
          )}

          {/* Tag de origem (se houver) */}
          {!compacto && corOrig && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              <span className={"inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold " + corOrig.bg + " " + corOrig.text}>
                <span className={"h-1 w-1 rounded-full " + corOrig.dot} />
                {lead.origemLead}
              </span>
            </div>
          )}

          {/* Valor + probabilidade */}
          <div className="flex items-center justify-between mt-1.5 gap-2">
            {v > 0 ? (
              <span className={(compacto ? "text-[12px]" : "text-[13.5px]") + " font-extrabold text-emerald-700 tabular-nums -tracking-tight"}>{formatBRL(v)}</span>
            ) : (
              <span className="text-[10px] text-muted-foreground italic">sem valor</span>
            )}
            {lead.probabilidade > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-0.5 flex-shrink-0 font-semibold">
                <Percent className="h-2.5 w-2.5" />{lead.probabilidade}%
              </span>
            )}
          </div>
          {!compacto && lead.probabilidade > 0 && (
            <div className="h-1 rounded-full bg-muted overflow-hidden mt-1">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all"
                style={{ width: lead.probabilidade + "%" }}
              />
            </div>
          )}

          {/* Badge de ação contextual por etapa */}
          {!compacto && acao && (
            <div className={
              "mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide border " +
              (acao.tone === "emerald"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-amber-50 text-amber-800 border-amber-200")
            }>
              <span>{acao.emoji}</span> {acao.label}
            </div>
          )}

          {/* Footer: responsável + dias parado */}
          {!compacto && (
            <div className="mt-1.5 pt-1.5 border-t border-dashed border-muted flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {lead.responsavelNome ? (
                  <>
                    <span className={"h-4 w-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0 " + gradientFromName(lead.responsavelNome)}>
                      {initials(lead.responsavelNome)}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate font-medium">{lead.responsavelNome.split(" ")[0]}</span>
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground italic">Sem dono</span>
                )}
              </div>
              <span className={"text-[10px] tabular-nums flex items-center gap-0.5 flex-shrink-0 " + paradoCls}>
                {isGanho ? "✓ Fechado" : isPerd ? "Encerrado" :
                  diasParado === null ? "" :
                  diasParado === 0 ? "hoje" :
                  diasParado === 1 ? "1d" :
                  diasParado > 7 ? `${diasParado}d sem retorno` :
                  `${diasParado}d`}
              </span>
            </div>
          )}

          {/* Ações no hover (mantidas — atalho rápido sem abrir painel) */}
          <div className="flex items-center justify-end gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
