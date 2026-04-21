import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BrainCircuit,
  Plus,
  Send,
  Loader2,
  User,
  Sparkles,
  MoreVertical,
  Pencil,
  Archive,
  Copy,
  Check,
  FileDown,
  Paperclip,
  X,
  ArrowLeft,
  FileText,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Sugestões iniciais por área de conhecimento ──────────────────────────

const SUGESTOES_POR_AREA: Record<string, string[]> = {
  "Direito Trabalhista": [
    "Redija contestação sobre horas extras",
    "Minuta de recurso ordinário",
    "Liste provas para rescisão indireta",
  ],
  "Direito Civil": [
    "Minuta de petição inicial de indenização",
    "Sugira teses de defesa em ação de cobrança",
    "Resuma este caso em tópicos",
  ],
  "Direito Tributário": [
    "Análise de auto de infração",
    "Teses para ação declaratória",
    "Resumo executivo do processo fiscal",
  ],
  "Direito Previdenciário": [
    "Minuta de pedido de revisão de benefício",
    "Liste documentos necessários para aposentadoria",
    "Redija recurso administrativo ao INSS",
  ],
  "Direito Bancário": [
    "Análise de abusividade em contrato",
    "Redija petição de revisão contratual",
    "Liste irregularidades neste contrato",
  ],
  "Direito Imobiliário": [
    "Minuta de ação de despejo",
    "Análise de distrato imobiliário",
    "Teses para ação de adjudicação compulsória",
  ],
  "Direito Empresarial": [
    "Análise de contrato social",
    "Minuta de notificação extrajudicial",
    "Resumo de due diligence",
  ],
  "Direito do Consumidor": [
    "Redija petição de reparação por vício do produto",
    "Teses para ação contra o fornecedor",
    "Análise de contrato de prestação de serviços",
  ],
  "Direito de Família": [
    "Minuta de divórcio consensual",
    "Sugira pedidos em ação de alimentos",
    "Resumo de acordo de guarda",
  ],
  "Direito Penal": [
    "Esboço de defesa preliminar",
    "Análise de denúncia do MP",
    "Teses para pedido de liberdade provisória",
  ],
  _default: [
    "Analise este caso em tópicos",
    "Sugira teses de defesa",
    "Resuma os fatos principais",
  ],
};

function sugestoesDoAgente(area?: string | null): string[] {
  if (!area) return SUGESTOES_POR_AREA._default;
  return SUGESTOES_POR_AREA[area] || SUGESTOES_POR_AREA._default;
}

// ─── Formatação de data relativa ──────────────────────────────────────────

function timeAgo(iso: string): string {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

// ─── Página principal ─────────────────────────────────────────────────────

export default function AgenteChat() {
  const params = useParams<{ id: string }>();
  const agenteId = Number(params.id);
  const [, navigate] = useLocation();

  const [threadAtiva, setThreadAtiva] = useState<number | null>(null);
  const [renomeandoId, setRenomeandoId] = useState<number | null>(null);
  const [novoTitulo, setNovoTitulo] = useState("");

  // ── Queries ──
  const { data: agente, isLoading: loadingAgente } = trpc.agentesIa.obter.useQuery(
    { id: agenteId },
    { enabled: Number.isFinite(agenteId) && agenteId > 0 },
  );

  const threadsQuery = trpc.agenteChat.listarThreads.useQuery(
    { agenteId },
    { enabled: Number.isFinite(agenteId) && agenteId > 0 },
  );
  const threads = threadsQuery.data || [];

  const mensagensQuery = trpc.agenteChat.listarMensagens.useQuery(
    { threadId: threadAtiva! },
    { enabled: !!threadAtiva },
  );
  const mensagens = mensagensQuery.data || [];

  // ── Mutations ──
  const criarThreadMut = trpc.agenteChat.criarThread.useMutation({
    onSuccess: (r) => {
      setThreadAtiva(r.id);
      threadsQuery.refetch();
    },
    onError: (err) => toast.error("Erro ao criar conversa", { description: err.message }),
  });

  const renomearMut = trpc.agenteChat.renomearThread.useMutation({
    onSuccess: () => {
      toast.success("Renomeado");
      setRenomeandoId(null);
      threadsQuery.refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const arquivarMut = trpc.agenteChat.arquivarThread.useMutation({
    onSuccess: () => {
      toast.success("Conversa arquivada");
      if (threadAtiva === renomeandoId) setThreadAtiva(null);
      threadsQuery.refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const enviarMut = trpc.agenteChat.enviarMensagem.useMutation({
    onSuccess: () => {
      mensagensQuery.refetch();
      threadsQuery.refetch();
    },
    onError: (err) => toast.error("Erro ao enviar", { description: err.message }),
  });

  // Seleciona automaticamente a thread mais recente ao carregar
  useEffect(() => {
    if (!threadAtiva && threads.length > 0) {
      setThreadAtiva(threads[0].id);
    }
  }, [threads, threadAtiva]);

  const threadAtivaObj = useMemo(
    () => threads.find((t) => t.id === threadAtiva) || null,
    [threads, threadAtiva],
  );

  if (loadingAgente) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!agente) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-muted-foreground">Agente não encontrado.</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/agentes-ia">Voltar</Link>
        </Button>
      </div>
    );
  }

  const sugestoes = sugestoesDoAgente(agente.areaConhecimento);

  return (
    <div className="flex h-[calc(100vh-var(--header-h,0px)-2rem)] gap-3">
      {/* ── Sidebar de threads ── */}
      <aside className="w-72 shrink-0 flex flex-col rounded-lg border bg-card">
        <div className="p-3 border-b">
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => navigate("/agentes-ia")}
              title="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="h-8 w-8 rounded-md bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0">
              <BrainCircuit className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{agente.nome}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {agente.areaConhecimento || agente.modelo}
              </p>
            </div>
          </div>
          <Button
            onClick={() => criarThreadMut.mutate({ agenteId })}
            disabled={criarThreadMut.isPending}
            className="w-full"
            size="sm"
          >
            {criarThreadMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5 mr-2" />
            )}
            Nova conversa
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {threadsQuery.isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : threads.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground">
                Nenhuma conversa ainda.
                <br />
                Clique em "Nova conversa".
              </div>
            ) : (
              threads.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-md px-2 py-1.5 cursor-pointer text-xs",
                    threadAtiva === t.id
                      ? "bg-primary/10 text-foreground"
                      : "hover:bg-muted text-muted-foreground",
                  )}
                  onClick={() => setThreadAtiva(t.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{t.titulo}</p>
                    <p className="text-[10px] opacity-60">{timeAgo(t.updatedAt)}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                      >
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem
                        onClick={() => {
                          setRenomeandoId(t.id);
                          setNovoTitulo(t.titulo);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-2" />
                        Renomear
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          if (confirm(`Arquivar "${t.titulo}"?`)) {
                            arquivarMut.mutate({ threadId: t.id, arquivada: true });
                          }
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Archive className="h-3.5 w-3.5 mr-2" />
                        Arquivar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* ── Área principal (chat) ── */}
      <main className="flex-1 flex flex-col min-w-0 rounded-lg border bg-card">
        {!threadAtiva ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6">
            <Sparkles className="h-12 w-12 opacity-20 mb-3" />
            <p className="text-sm">Crie ou selecione uma conversa para começar.</p>
          </div>
        ) : (
          <ChatArea
            threadId={threadAtiva}
            threadTitulo={threadAtivaObj?.titulo || ""}
            agenteNome={agente.nome}
            sugestoes={sugestoes}
            mensagens={mensagens}
            isLoadingMensagens={mensagensQuery.isLoading}
            isEnviando={enviarMut.isPending}
            onEnviar={(conteudo, anexo) =>
              enviarMut.mutate({ threadId: threadAtiva, conteudo, anexo })
            }
          />
        )}
      </main>

      {/* ── Dialog de renomear ── */}
      <Dialog open={!!renomeandoId} onOpenChange={(o) => !o && setRenomeandoId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear conversa</DialogTitle>
            <DialogDescription>Novo título para esta conversa.</DialogDescription>
          </DialogHeader>
          <Input
            value={novoTitulo}
            onChange={(e) => setNovoTitulo(e.target.value)}
            placeholder="Título da conversa"
            maxLength={200}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenomeandoId(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!renomeandoId) return;
                const t = novoTitulo.trim();
                if (!t) {
                  toast.error("Título obrigatório");
                  return;
                }
                renomearMut.mutate({ threadId: renomeandoId, titulo: t });
              }}
              disabled={renomearMut.isPending || !novoTitulo.trim()}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Área de chat (composer + mensagens) ──────────────────────────────────

interface ChatAreaProps {
  threadId: number;
  threadTitulo: string;
  agenteNome: string;
  sugestoes: string[];
  mensagens: Array<{
    id: number;
    role: string;
    conteudo: string;
    anexoUrl: string | null;
    anexoNome: string | null;
    anexoMime: string | null;
    tokensUsados: number;
    createdAt: string;
  }>;
  isLoadingMensagens: boolean;
  isEnviando: boolean;
  onEnviar: (
    conteudo: string,
    anexo?: { nome: string; tipo: string; base64: string },
  ) => void;
}

function ChatArea({
  threadId,
  threadTitulo,
  agenteNome,
  sugestoes,
  mensagens,
  isLoadingMensagens,
  isEnviando,
  onEnviar,
}: ChatAreaProps) {
  const [input, setInput] = useState("");
  const [anexoPendente, setAnexoPendente] = useState<{
    nome: string;
    tipo: string;
    base64: string;
  } | null>(null);
  const [copiandoId, setCopiandoId] = useState<number | null>(null);
  const [exportando, setExportando] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll ao receber mensagens
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLDivElement | null;
    if (viewport) {
      requestAnimationFrame(() => {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      });
    }
  }, [mensagens.length, isEnviando]);

  const enviar = (texto: string) => {
    if (!texto.trim() || isEnviando) return;
    onEnviar(texto.trim(), anexoPendente || undefined);
    setInput("");
    setAnexoPendente(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 15MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAnexoPendente({
        nome: file.name,
        tipo: file.type || "application/octet-stream",
        base64: reader.result as string,
      });
    };
    reader.readAsDataURL(file);
  };

  const copiar = async (id: number, texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiandoId(id);
      setTimeout(() => setCopiandoId(null), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const exportarPDF = async () => {
    setExportando(true);
    try {
      const res = await fetch("/api/export/chat-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ threadId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-${threadTitulo.slice(0, 30).replace(/[^a-z0-9]/gi, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF exportado");
    } catch (err: any) {
      toast.error("Erro ao exportar", { description: err.message });
    } finally {
      setExportando(false);
    }
  };

  const displayMsgs = mensagens.filter((m) => m.role !== "system");

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{threadTitulo || "Conversa"}</p>
          <p className="text-[10px] text-muted-foreground">
            {displayMsgs.length} {displayMsgs.length === 1 ? "mensagem" : "mensagens"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={exportarPDF}
          disabled={exportando || displayMsgs.length === 0}
        >
          {exportando ? (
            <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
          ) : (
            <FileDown className="h-3 w-3 mr-1.5" />
          )}
          Exportar PDF
        </Button>
      </div>

      {/* Mensagens */}
      <div ref={scrollRef} className="flex-1 overflow-hidden">
        {isLoadingMensagens ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : displayMsgs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-muted-foreground">
            <Sparkles className="h-10 w-10 opacity-20" />
            <p className="text-sm">Comece a conversar com o agente.</p>
            {sugestoes.length > 0 && (
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {sugestoes.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => enviar(prompt)}
                    disabled={isEnviando}
                    className="rounded-lg border bg-card px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="flex flex-col space-y-4 p-4">
              {displayMsgs.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex gap-3",
                    m.role === "user" ? "justify-end items-start" : "justify-start items-start",
                  )}
                >
                  {m.role === "assistant" && (
                    <div className="size-8 shrink-0 mt-1 rounded-full bg-primary/10 flex items-center justify-center">
                      <Sparkles className="size-4 text-primary" />
                    </div>
                  )}

                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-4 py-2.5 group relative",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {m.anexoNome && (
                      <div
                        className={cn(
                          "flex items-center gap-1.5 text-[11px] mb-1.5 rounded px-2 py-1",
                          m.role === "user" ? "bg-primary-foreground/10" : "bg-background",
                        )}
                      >
                        <FileText className="h-3 w-3 shrink-0" />
                        {m.anexoUrl ? (
                          <a
                            href={m.anexoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline truncate"
                          >
                            {m.anexoNome}
                          </a>
                        ) : (
                          <span className="truncate">{m.anexoNome}</span>
                        )}
                      </div>
                    )}
                    {m.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{m.conteudo}</Streamdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm">{m.conteudo}</p>
                    )}
                    {m.role === "assistant" && (
                      <button
                        onClick={() => copiar(m.id, m.conteudo)}
                        className="absolute -top-2 -right-2 bg-background border rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
                        title="Copiar resposta"
                      >
                        {copiandoId === m.id ? (
                          <Check className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>

                  {m.role === "user" && (
                    <div className="size-8 shrink-0 mt-1 rounded-full bg-secondary flex items-center justify-center">
                      <User className="size-4 text-secondary-foreground" />
                    </div>
                  )}
                </div>
              ))}

              {isEnviando && (
                <div className="flex items-start gap-3">
                  <div className="size-8 shrink-0 mt-1 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="size-4 text-primary" />
                  </div>
                  <div className="rounded-lg bg-muted px-4 py-2.5">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Composer */}
      <div className="border-t bg-background/50 shrink-0">
        {anexoPendente && (
          <div className="px-4 pt-3 flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs bg-muted rounded-md px-2 py-1 border">
              <FileText className="h-3 w-3" />
              <span className="truncate max-w-[200px]">{anexoPendente.nome}</span>
              <button
                onClick={() => {
                  setAnexoPendente(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="text-muted-foreground hover:text-destructive ml-1"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar(input);
          }}
          className="flex gap-2 p-3 items-end"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/json"
            onChange={handleFile}
            className="hidden"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-[38px] w-[38px] shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={isEnviando}
            title="Anexar arquivo"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar(input);
              }
            }}
            placeholder={`Pergunte para ${agenteNome}...`}
            className="flex-1 max-h-32 resize-none min-h-9"
            rows={1}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isEnviando}
            className="shrink-0 h-[38px] w-[38px]"
          >
            {isEnviando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
      </div>
    </>
  );
}
