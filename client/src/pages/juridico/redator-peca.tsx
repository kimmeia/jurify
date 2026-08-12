/**
 * Redator de peças — a conversa sobre um caso concreto.
 *
 * O advogado escolhe cliente + processo; o agente lê a movimentação, os
 * documentos anexados e a base de fontes do escritório, e devolve estratégia
 * ou minuta no timbre da casa. Toda peça é minuta: revisão humana antes de
 * protocolar.
 *
 * Vive dentro do JurisIA, no modo "Redigir peça". A rota própria que ele tinha
 * (/agente-juridico) virou redirect — dois lugares pra mesma coisa era o
 * problema, não a solução.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Scale, Send, Download, Library, Plus, Trash2, FileText, Search } from "lucide-react";
import { toast } from "sonner";
import { base64ToBlob, baixarBlob } from "@/pages/financeiro/helpers";

const MODELOS = [
  { v: "gpt-4o", label: "gpt-4o (OpenAI)" },
  { v: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Anthropic)" },
  { v: "gpt-4o-mini", label: "gpt-4o-mini (OpenAI — barato)" },
  { v: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (Anthropic)" },
];

type Fatia = { resultado: string; rotulo: string; quantidade: number; percentual: number };
type Prova = {
  rotulo: string;
  total: number;
  comResultado: number;
  fatias: Fatia[];
  jurisprudencia: number;
  amostraPequena: boolean;
};
type Msg = {
  role: "user" | "assistant";
  content: string;
  contexto?: { andamentos: number; precedentes: number; documentos?: number; acervo?: number };
  prova?: Prova | null;
};

const SUGESTOES = [
  "Analise a estratégia deste caso.",
  "Qual recurso é cabível agora?",
  "O que os tribunais decidem sobre isso?",
  "Gere a petição inicial.",
];

export function RedatorPeca() {
  const [cliente, setCliente] = useState<{ id: number; nome: string } | null>(null);
  const [processoId, setProcessoId] = useState<number | null>(null);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [modelo, setModelo] = useState("gpt-4o");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [fontesOpen, setFontesOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const clientesQ = (trpc as any).clientes.listar.useQuery(
    { busca: buscaCliente, estagio: "cliente", limite: 8 },
    { enabled: buscaCliente.trim().length >= 2, retry: false },
  );
  const processosQ = (trpc as any).clienteProcessos.listar.useQuery(
    { contatoId: cliente?.id ?? 0 },
    { enabled: !!cliente, retry: false },
  );
  const dossieQ = (trpc as any).juridico.contextoDoCliente.useQuery(
    { contatoId: cliente?.id ?? 0, processoId: processoId ?? undefined },
    { enabled: !!cliente, retry: false },
  );

  const conversarMut = (trpc as any).juridico.conversar.useMutation({
    onSuccess: (r: any) => {
      if (!r.resposta) { toast.error("Não deu pra responder", { description: r.erro }); return; }
      setMsgs((m) => [...m, { role: "assistant", content: r.resposta, contexto: r.contexto, prova: r.prova ?? null }]);
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });
  const exportMut = (trpc as any).juridico.exportarPecaDocx.useMutation({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => {
      baixarBlob(base64ToBlob(r.base64, r.mimeType), r.filename, r.mimeType);
      toast.success("DOCX exportado");
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, conversarMut.isPending]);

  const movLinhas = useMemo(
    () => String(dossieQ.data?.movimentacao || "").split("\n").filter(Boolean).slice(0, 8),
    [dossieQ.data],
  );

  function enviar(texto: string) {
    const t = texto.trim();
    if (!t || conversarMut.isPending) return;
    const novas: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(novas);
    setInput("");
    conversarMut.mutate({
      contatoId: cliente?.id,
      processoId: processoId ?? undefined,
      modelo,
      mensagens: novas.map((m) => ({ role: m.role, content: m.content })),
    });
  }

  function novaConversa() { setMsgs([]); setInput(""); }

  return (
    <div className="flex h-[calc(100dvh-230px)] min-h-[500px] flex-col overflow-hidden rounded-xl border bg-card">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-background">
        <p className="text-[11.5px] text-muted-foreground">
          Escolha o caso à esquerda — o agente lê o processo, os documentos e a base do escritório.
        </p>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setFontesOpen(true)}><Library className="h-4 w-4 mr-1.5" /> Configurar</Button>
        <Button variant="outline" size="sm" onClick={novaConversa}><Plus className="h-4 w-4 mr-1.5" /> Nova conversa</Button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[290px_1fr] min-h-0">
        {/* Rail — contexto do caso */}
        <div className="hidden lg:block border-r bg-muted/20 overflow-y-auto p-3.5 space-y-4">
          <div>
            <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Caso em análise</p>
            {!cliente ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <Input className="h-9 pl-8 text-xs" placeholder="Buscar cliente…" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} />
                </div>
                {buscaCliente.trim().length >= 2 && (
                  <div className="rounded-lg border divide-y bg-background max-h-56 overflow-y-auto">
                    {clientesQ.isLoading && <p className="text-xs text-muted-foreground p-2">Buscando…</p>}
                    {(clientesQ.data?.clientes ?? []).map((c: any) => (
                      <button key={c.id} className="w-full text-left px-2.5 py-2 text-xs hover:bg-muted" onClick={() => { setCliente({ id: c.id, nome: c.nome }); setProcessoId(null); setBuscaCliente(""); }}>
                        {c.nome}
                      </button>
                    ))}
                    {!clientesQ.isLoading && (clientesQ.data?.clientes?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground p-2">Nada encontrado.</p>}
                  </div>
                )}
                <p className="text-[10.5px] text-muted-foreground">Escolha um caso pra o agente ler o processo e os documentos. Também dá pra perguntar sem caso.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-sm text-violet-900 leading-tight">{cliente.nome}</p>
                  <button className="text-[11px] text-violet-600 font-medium shrink-0" onClick={() => { setCliente(null); setProcessoId(null); }}>trocar</button>
                </div>
                {dossieQ.data?.processo && <p className="text-[11px] text-violet-800/80 mt-1.5 whitespace-pre-line">{dossieQ.data.processo}</p>}
                {(processosQ.data?.length ?? 0) > 1 && (
                  <Select value={processoId ? String(processoId) : ""} onValueChange={(v) => setProcessoId(v ? Number(v) : null)}>
                    <SelectTrigger className="mt-2 h-8 text-[11px]"><SelectValue placeholder="Trocar processo" /></SelectTrigger>
                    <SelectContent>
                      {(processosQ.data ?? []).map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.apelido || p.numeroCnj || `Processo ${p.id}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>

          {cliente && movLinhas.length > 0 && (
            <div>
              <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Movimentação</p>
              <div className="space-y-1.5 border-l-2 border-border pl-3">
                {movLinhas.map((l, i) => (
                  <p key={i} className={"text-[11px] leading-snug " + (i === 0 ? "text-foreground font-medium" : "text-muted-foreground")}>{l.replace(/^-\s*/, "")}</p>
                ))}
              </div>
            </div>
          )}

          {cliente && (dossieQ.data?.documentos?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Documentos</p>
              {(dossieQ.data.documentos ?? []).map((d: any) => (
                <div key={d.id} className="flex items-center gap-2 text-[11.5px] text-muted-foreground py-0.5"><FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{d.nome}</span></div>
              ))}
            </div>
          )}

          <div>
            <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">Modelo de IA</p>
            <Select value={modelo} onValueChange={setModelo}>
              <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>{MODELOS.map((m) => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {/* Chat */}
        <div className="flex flex-col min-h-0">
          <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
            {msgs.length === 0 && (
              <div className="max-w-2xl mx-auto text-center mt-8">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-700 text-white flex items-center justify-center mx-auto mb-3"><Scale className="h-6 w-6" /></div>
                <p className="font-semibold">Como posso ajudar no caso?</p>
                <p className="text-sm text-muted-foreground mt-1">Analiso a estratégia, leio a movimentação e os documentos, pesquiso a jurisprudência e redijo a peça no timbre do escritório.</p>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {SUGESTOES.map((s) => (
                    <button key={s} className="text-xs bg-muted hover:bg-muted/70 rounded-full px-3 py-1.5" onClick={() => enviar(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={"flex gap-2.5 max-w-3xl " + (m.role === "user" ? "ml-auto flex-row-reverse" : "")}>
                <div className={"h-7 w-7 rounded-lg shrink-0 flex items-center justify-center text-sm " + (m.role === "user" ? "bg-muted" : "bg-gradient-to-br from-violet-600 to-purple-700 text-white")}>
                  {m.role === "user" ? "🧑" : "⚖️"}
                </div>
                <div className="min-w-0">
                  {m.role === "assistant" && m.contexto && (m.contexto.andamentos > 0 || m.contexto.precedentes > 0 || (m.contexto.documentos ?? 0) > 0 || (m.contexto.acervo ?? 0) > 0) && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {m.contexto.andamentos > 0 && <span className="text-[10.5px] bg-muted border rounded-full px-2 py-0.5">🔎 {m.contexto.andamentos} andamentos</span>}
                      {(m.contexto.documentos ?? 0) > 0 && <span className="text-[10.5px] bg-muted border rounded-full px-2 py-0.5">📄 {m.contexto.documentos} documentos</span>}
                      {m.contexto.precedentes > 0 && <span className="text-[10.5px] bg-muted border rounded-full px-2 py-0.5">⚖️ {m.contexto.precedentes} precedentes</span>}
                      {(m.contexto.acervo ?? 0) > 0 && <span className="text-[10.5px] border rounded-full px-2 py-0.5 border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">📊 {m.contexto.acervo} decididos no acervo</span>}
                    </div>
                  )}
                  <div className={"rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed " + (m.role === "user" ? "bg-violet-600 text-white" : "bg-muted")}>
                    {m.role === "assistant" ? <ComAncoras texto={m.content} /> : m.content}
                  </div>
                  {m.role === "assistant" && <LegendaAncoras texto={m.content} />}
                  {m.role === "assistant" && m.prova && <ProvaAcervo p={m.prova} />}
                  {m.role === "assistant" && (
                    <button
                      className="text-[11px] text-muted-foreground hover:text-violet-600 mt-1 inline-flex items-center gap-1"
                      onClick={() => exportMut.mutate({ texto: m.content, nomeArquivo: "peca" })}
                      disabled={exportMut.isPending}
                    >
                      <Download className="h-3 w-3" /> Exportar como DOCX
                    </button>
                  )}
                </div>
              </div>
            ))}
            {conversarMut.isPending && (
              <div className="flex gap-2.5 max-w-3xl">
                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600 to-purple-700 text-white flex items-center justify-center text-sm">⚖️</div>
                <div className="rounded-2xl px-3.5 py-2.5 bg-muted text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analisando o caso…</div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t bg-background p-3">
            <div className="flex items-end gap-2 border rounded-2xl px-3 py-2 max-w-3xl mx-auto">
              <Textarea
                className="flex-1 border-0 shadow-none focus-visible:ring-0 resize-none min-h-[24px] max-h-32 p-0 text-sm"
                rows={1}
                placeholder="Pergunte, peça uma peça ou refine (ex.: 'deixa mais enxuto')…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(input); } }}
              />
              <Button size="icon" className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600 to-purple-700 shrink-0" disabled={!input.trim() || conversarMut.isPending} onClick={() => enviar(input)}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10.5px] text-muted-foreground text-center mt-1.5">Minuta gerada por IA — revisão e assinatura do advogado obrigatórias antes de protocolar.</p>
          </div>
        </div>
      </div>

      <FontesDialog open={fontesOpen} onOpenChange={setFontesOpen} />
    </div>
  );
}

/** Cor e significado de cada âncora — a mesma tríade em texto, legenda e prova. */
const ANCORA: Record<string, { rotulo: string; classe: string }> = {
  D: { rotulo: "documento do caso", classe: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600" },
  F: { rotulo: "fonte do escritório", classe: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800" },
  A: { rotulo: "acervo público", classe: "bg-violet-50 text-violet-700 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800" },
};

/**
 * Troca `[D]`, `[F]` e `[A]` por selo.
 *
 * O agente marca a origem de cada afirmação no próprio texto. Sem virar selo
 * aqui, o advogado leria colchetes soltos no meio da peça — e a marca, que
 * existe pra reduzir conferência, viraria sujeira.
 */
function ComAncoras({ texto }: { texto: string }) {
  const partes = texto.split(/(\[[DFA]\])/g);
  return (
    <>
      {partes.map((p, i) => {
        const m = /^\[([DFA])\]$/.exec(p);
        if (!m) return <span key={i}>{p}</span>;
        const a = ANCORA[m[1]!]!;
        return (
          <span
            key={i}
            title={a.rotulo}
            className={`mx-0.5 inline-flex h-[15px] w-[15px] items-center justify-center rounded border align-[2px] text-[9px] font-extrabold ${a.classe}`}
          >
            {m[1]}
          </span>
        );
      })}
    </>
  );
}

/** Legenda com a contagem por origem. Só aparece quando há marca no texto. */
function LegendaAncoras({ texto }: { texto: string }) {
  const contagem: Record<string, number> = { D: 0, F: 0, A: 0 };
  for (const m of texto.matchAll(/\[([DFA])\]/g)) contagem[m[1]!] = (contagem[m[1]!] ?? 0) + 1;
  const usadas = Object.entries(contagem).filter(([, n]) => n > 0);
  if (usadas.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {usadas.map(([k, n]) => (
        <span key={k} className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className={`inline-flex h-[15px] w-[15px] items-center justify-center rounded border text-[9px] font-extrabold ${ANCORA[k]!.classe}`}>
            {k}
          </span>
          {ANCORA[k]!.rotulo} · {n}
        </span>
      ))}
    </div>
  );
}

const COR_FATIA: Record<string, string> = {
  procedente: "var(--viz-1)",
  parcial: "var(--viz-2)",
  improcedente: "var(--viz-3)",
  acordo: "var(--viz-4)",
  extinto_sem_merito: "var(--viz-5)",
};

/**
 * A prova do acervo, abaixo da resposta.
 *
 * O número vive AQUI e não no texto: veio de contagem em SQL sobre o recorte,
 * e o modelo tem ordem de não reescrevê-lo. É a mesma hierarquia da Pesquisa —
 * estatística primeiro, leitura depois.
 */
function ProvaAcervo({ p }: { p: Prova }) {
  return (
    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/25">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-violet-700 dark:text-violet-300">
          Como este tribunal vem decidindo
        </p>
        <p className="text-[10.5px] text-violet-700/80 dark:text-violet-300/70">{p.rotulo}</p>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {p.comResultado.toLocaleString("pt-BR")} processos decididos · {p.jurisprudencia.toLocaleString("pt-BR")} em
        segunda instância
      </p>
      <div className="mt-2 space-y-1">
        {p.fatias
          .filter((f) => f.quantidade > 0)
          .map((f) => (
            <div key={f.resultado} className="grid grid-cols-[118px_1fr_auto] items-center gap-2">
              <span className="truncate text-[11px] text-foreground/80">{f.rotulo}</span>
              <span className="h-2 overflow-hidden rounded-[2px]" style={{ background: "var(--viz-trilho)" }}>
                <span
                  className="block h-full rounded-r-[4px]"
                  style={{ background: COR_FATIA[f.resultado] ?? "var(--viz-1)", width: `${f.percentual}%`, minWidth: "3px" }}
                />
              </span>
              <span className="flex text-[11px] tabular-nums">
                <span className="w-9 text-right font-bold">{f.percentual}%</span>
                <span className="w-12 text-right text-muted-foreground">({f.quantidade})</span>
              </span>
            </div>
          ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        {p.amostraPequena
          ? "Amostra pequena — com esse número de casos decididos isto é indício, não tese firmada."
          : "Contado no banco sobre o recorte inteiro. É estatística do tribunal, não precedente citável."}
      </p>
    </div>
  );
}

/** Diálogo de fontes próprias do escritório (base RAG do escritório). */
function FontesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const NF_VAZIO = { tipo: "sumula", identificador: "", titulo: "", texto: "", link: "", tags: "" };
  const [nf, setNf] = useState(NF_VAZIO);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const minhasFontesQ = (trpc as any).juridico.listarFontes.useQuery({ origem: "minhas" }, { retry: false, enabled: open });
  const addFonteMut = (trpc as any).juridico.adicionarFonte.useMutation({
    onSuccess: (r: any) => { toast.success(r.indexada ? "Fonte adicionada e indexada" : "Fonte adicionada (configure a chave OpenAI pra indexar)"); setNf(NF_VAZIO); minhasFontesQ.refetch(); },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });
  const delFonteMut = (trpc as any).juridico.excluirFonte.useMutation({
    onSuccess: () => { toast.success("Fonte removida"); minhasFontesQ.refetch(); },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });

  // Instruções personalizadas do agente (edita o "prompt"/comportamento).
  const instrQ = (trpc as any).juridico.obterInstrucoesAgente.useQuery(undefined, { retry: false, enabled: open });
  const [instr, setInstr] = useState("");
  useEffect(() => { if (instrQ.data) setInstr(instrQ.data.instrucoes || ""); }, [instrQ.data]);
  const salvarInstrMut = (trpc as any).juridico.salvarInstrucoesAgente.useMutation({
    onSuccess: () => toast.success("Instruções do agente salvas"),
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Library className="h-5 w-5 text-violet-600" /> Configurar o Agente Jurídico</DialogTitle>
          <DialogDescription>Ajuste como o agente se comporta e cadastre fontes próprias — ele usa tudo nas respostas e peças.</DialogDescription>
        </DialogHeader>

        {/* Instruções do agente (edita o comportamento/prompt) */}
        <div className="space-y-2 rounded-lg border p-3">
          <Label className="text-xs font-semibold">Instruções do agente <span className="text-muted-foreground font-normal">(tom, cláusulas padrão, preferências de redação)</span></Label>
          <Textarea
            className="min-h-[90px] text-sm"
            placeholder="Ex.: Sempre pedir tutela de urgência quando cabível. Usar linguagem sóbria. Incluir o número da OAB no rodapé. Priorizar teses do TJCE."
            value={instr}
            onChange={(e) => setInstr(e.target.value)}
          />
          <Button size="sm" disabled={salvarInstrMut.isPending} onClick={() => salvarInstrMut.mutate({ instrucoes: instr })}>
            {salvarInstrMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null} Salvar instruções
          </Button>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={nf.tipo} onValueChange={(v) => setNf({ ...nf, tipo: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sumula">Súmula</SelectItem>
                  <SelectItem value="lei">Lei / artigo</SelectItem>
                  <SelectItem value="precedente">Precedente</SelectItem>
                  <SelectItem value="tese">Tese / modelo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Identificador</Label><Input className="mt-1" value={nf.identificador} onChange={(e) => setNf({ ...nf, identificador: e.target.value })} placeholder="Ex.: Súmula 297/STJ" /></div>
          </div>
          <div><Label className="text-xs">Título (opcional)</Label><Input className="mt-1" value={nf.titulo} onChange={(e) => setNf({ ...nf, titulo: e.target.value })} placeholder="Resumo curto" /></div>
          <p className="text-[10.5px] text-muted-foreground">Preencha <b>um</b>: cole o texto, informe o link (ex.: súmula) ou anexe o arquivo (PDF/DOCX/imagem) — a IA lê o conteúdo.</p>
          <div><Label className="text-xs">Texto</Label><Textarea className="mt-1 min-h-[60px]" value={nf.texto} onChange={(e) => setNf({ ...nf, texto: e.target.value })} placeholder="Enunciado / conteúdo…" /></div>
          <div><Label className="text-xs">Link</Label><Input className="mt-1" value={nf.link} onChange={(e) => setNf({ ...nf, link: e.target.value })} placeholder="https://... (súmula, acórdão)" /></div>
          <div><Label className="text-xs">Arquivo</Label><input type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" className="mt-1 text-xs block" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></div>
          <Button size="sm" disabled={addFonteMut.isPending || nf.identificador.trim().length < 2 || (!nf.texto.trim() && !nf.link.trim() && !arquivo)}
            onClick={async () => {
              let arquivoBase64: string | undefined; let nomeArquivo: string | undefined;
              if (arquivo) {
                nomeArquivo = arquivo.name;
                arquivoBase64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(arquivo); });
              }
              addFonteMut.mutate({
                tipo: nf.tipo, identificador: nf.identificador.trim(), titulo: nf.titulo.trim() || undefined,
                texto: nf.texto.trim() || undefined, link: nf.link.trim() || undefined,
                arquivoBase64, nomeArquivo, tags: nf.tags.trim() || undefined,
              });
              setArquivo(null);
            }}>
            {addFonteMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />} Adicionar fonte
          </Button>
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Suas fontes ({minhasFontesQ.data?.length ?? 0})</p>
          {(minhasFontesQ.data ?? []).map((f: any) => (
            <div key={f.id} className="flex items-start justify-between gap-2 border rounded-md p-2">
              <div className="min-w-0"><p className="text-sm font-medium truncate">{f.identificador}{f.titulo ? ` — ${f.titulo}` : ""}</p><p className="text-[11px] text-muted-foreground line-clamp-2">{f.texto}</p></div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 hover:text-rose-600" disabled={delFonteMut.isPending} onClick={() => delFonteMut.mutate({ id: f.id })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          {!minhasFontesQ.isLoading && (minhasFontesQ.data?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">Nenhuma fonte própria ainda — a base global já está disponível.</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
