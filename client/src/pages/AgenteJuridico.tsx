/**
 * Agente Jurídico (Fase 1 — Revisional): avalia a chance de sucesso e redige a
 * peça, fundamentado na base curada (RAG). A IA usa o modelo que o escritório
 * escolher; toda citação é verificada (grounding) e o advogado revisa/assina.
 */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Scale, Target, Sparkles, Download, AlertTriangle, CheckCircle2, Library, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { base64ToBlob, baixarBlob } from "@/pages/financeiro/helpers";

const MODELOS = [
  { v: "gpt-4o", label: "gpt-4o (OpenAI)", rec: true },
  { v: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Anthropic)", rec: true },
  { v: "gpt-4o-mini", label: "gpt-4o-mini (OpenAI — barato)", rec: false },
  { v: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (Anthropic)", rec: false },
];

const NOTA_INFO: Record<string, { label: string; cls: string }> = {
  alta: { label: "Alta", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  media: { label: "Média", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  baixa: { label: "Baixa", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

export default function AgenteJuridico() {
  const [fatos, setFatos] = useState("");
  const [tesesTxt, setTesesTxt] = useState("");
  const [modelo, setModelo] = useState("gpt-4o");
  const [tipo, setTipo] = useState<string>("");
  const [avaliacao, setAvaliacao] = useState<any | null>(null);
  const [pecaTexto, setPecaTexto] = useState<string>("");
  const [verificacao, setVerificacao] = useState<{ fontesUsadas: string[]; suspeitas: string[] } | null>(null);
  const [fontesOpen, setFontesOpen] = useState(false);
  const NF_VAZIO = { tipo: "sumula", identificador: "", titulo: "", texto: "", tags: "" };
  const [nf, setNf] = useState(NF_VAZIO);
  // Cliente/processo do caso — quando escolhidos, a peça é fundamentada nos
  // dados REAIS (qualificação, processo, anotações) em vez de genérica.
  const [buscaCliente, setBuscaCliente] = useState("");
  const [cliente, setCliente] = useState<{ id: number; nome: string } | null>(null);
  const [processoId, setProcessoId] = useState<number | null>(null);

  const { data: tipos } = (trpc as any).juridico.tiposPeca.useQuery(undefined, { retry: false });
  const tipoSel = tipo || tipos?.[0]?.id || "peticao_inicial_revisional";
  const teses = useMemo(() => tesesTxt.split(/[;\n]/).map((s) => s.trim()).filter(Boolean), [tesesTxt]);

  const avaliarMut = (trpc as any).juridico.avaliarSucesso.useMutation({
    onSuccess: (r: any) => {
      if (!r.disponivel) { toast.error("Não deu pra avaliar", { description: r.motivo }); setAvaliacao(null); return; }
      setAvaliacao(r.avaliacao);
      toast.success("Avaliação pronta");
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });

  const gerarMut = (trpc as any).juridico.gerarPeca.useMutation({
    onSuccess: (r: any) => {
      if (!r.disponivel || !r.texto) { toast.error("Não deu pra gerar", { description: r.motivo }); return; }
      setPecaTexto(r.texto);
      setVerificacao(r.verificacao);
      if (r.verificacao?.suspeitas?.length) {
        toast.warning(`${r.verificacao.suspeitas.length} citação(ões) sem respaldo — revise antes de usar`);
      } else {
        toast.success("Peça gerada");
      }
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

  // Fontes próprias do escritório (além da base global).
  const minhasFontesQ = (trpc as any).juridico.listarFontes.useQuery({ origem: "minhas" }, { retry: false, enabled: fontesOpen });
  const addFonteMut = (trpc as any).juridico.adicionarFonte.useMutation({
    onSuccess: (r: any) => {
      toast.success(r.indexada ? "Fonte adicionada e indexada" : "Fonte adicionada (configure a chave OpenAI pra indexar)");
      setNf(NF_VAZIO);
      minhasFontesQ.refetch();
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });
  const delFonteMut = (trpc as any).juridico.excluirFonte.useMutation({
    onSuccess: () => { toast.success("Fonte removida"); minhasFontesQ.refetch(); },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });

  // Busca de cliente (>=2 chars) + processos do cliente + dossiê (preview real).
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

  // Documentos a incluir na leitura — default: todos os do cliente.
  const [docsSelecionados, setDocsSelecionados] = useState<number[]>([]);
  useEffect(() => {
    setDocsSelecionados(((dossieQ.data?.documentos ?? []) as any[]).map((d) => d.id));
  }, [dossieQ.data]);

  const podeRodar = fatos.trim().length >= 10;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Scale className="h-5 w-5 text-violet-600" /> Agente Jurídico
            <Badge className="bg-violet-600 text-white">Revisional</Badge>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Avalie a chance de sucesso e gere a peça — fundamentado, citado e verificado. Você revisa e assina.
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => setFontesOpen(true)}>
          <Library className="h-4 w-4 mr-1.5" /> Fontes do escritório
        </Button>
      </div>

      {/* 1 · Cliente & processo — puxa os dados reais pro dossiê */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <Label className="text-xs font-semibold">Cliente do caso <span className="text-muted-foreground font-normal">(opcional — fundamenta a peça nos dados reais)</span></Label>
          {!cliente ? (
            <div className="space-y-2">
              <Input placeholder="Buscar cliente por nome ou CPF…" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} />
              {buscaCliente.trim().length >= 2 && (
                <div className="rounded-lg border divide-y max-h-52 overflow-y-auto">
                  {clientesQ.isLoading && <p className="text-xs text-muted-foreground p-2">Buscando…</p>}
                  {(clientesQ.data?.clientes ?? []).map((c: any) => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                      onClick={() => { setCliente({ id: c.id, nome: c.nome }); setProcessoId(null); setBuscaCliente(""); }}
                    >
                      {c.nome}{c.cpfCnpj ? <span className="text-muted-foreground"> · {c.cpfCnpj}</span> : null}
                    </button>
                  ))}
                  {!clientesQ.isLoading && (clientesQ.data?.clientes?.length ?? 0) === 0 && (
                    <p className="text-xs text-muted-foreground p-2">Nenhum cliente encontrado.</p>
                  )}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Sem cliente, a peça sai só com os fatos que você digitar (mais genérica).</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {cliente.nome}</div>
                <Button variant="ghost" size="sm" onClick={() => { setCliente(null); setProcessoId(null); }}>Trocar</Button>
              </div>
              {(processosQ.data?.length ?? 0) > 0 && (
                <div>
                  <Label className="text-xs">Processo</Label>
                  <Select value={processoId ? String(processoId) : ""} onValueChange={(v) => setProcessoId(v ? Number(v) : null)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha o processo (opcional)" /></SelectTrigger>
                    <SelectContent>
                      {(processosQ.data ?? []).map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.apelido || p.numeroCnj || `Processo ${p.id}`}{p.classe ? ` · ${p.classe}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {dossieQ.data && (
                <div className="rounded-lg border bg-violet-50/50 p-3 text-xs space-y-2">
                  {dossieQ.data.qualificacao && (
                    <div>
                      <p className="font-semibold text-violet-800">Qualificação (do cadastro)</p>
                      <p className="whitespace-pre-line text-violet-900/80">{dossieQ.data.qualificacao}</p>
                    </div>
                  )}
                  {dossieQ.data.processo && (
                    <div>
                      <p className="font-semibold text-violet-800">Processo</p>
                      <p className="whitespace-pre-line text-violet-900/80">{dossieQ.data.processo}</p>
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-violet-800">Documentos que o Agente vai ler ({docsSelecionados.length}/{dossieQ.data.documentos?.length ?? 0})</p>
                    {(dossieQ.data.documentos ?? []).length > 0 ? (
                      <div className="space-y-1 mt-1">
                        {dossieQ.data.documentos.map((d: any) => (
                          <label key={d.id} className="flex items-center gap-2 text-violet-900/80 cursor-pointer">
                            <input
                              type="checkbox"
                              className="accent-violet-600"
                              checked={docsSelecionados.includes(d.id)}
                              onChange={(e) => setDocsSelecionados((prev) => e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id))}
                            />
                            <span className="truncate">{d.nome}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-violet-900/60">Nenhum documento anexado a este cliente.</p>
                    )}
                    <p className="text-[10px] text-violet-700/70 mt-1">Lê texto de PDF/DOCX direto; foto/print e PDF escaneado via Vision (modelo do escritório).</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2 · Caso */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo de peça</Label>
              <Select value={tipoSel} onValueChange={setTipo}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(tipos ?? [{ id: "peticao_inicial_revisional", label: "Petição inicial — Revisional" }]).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Modelo de IA <span className="text-muted-foreground">(do seu escritório)</span></Label>
              <Select value={modelo} onValueChange={setModelo}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODELOS.map((m) => (
                    <SelectItem key={m.v} value={m.v}>{m.label}{m.rec ? " ★" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Fatos do caso</Label>
            <Textarea
              className="mt-1 min-h-[110px]"
              value={fatos}
              onChange={(e) => setFatos(e.target.value)}
              placeholder="Descreva os fatos: tipo de contrato, encargos questionados, valores, cálculo em anexo…"
            />
          </div>
          <div>
            <Label className="text-xs">Teses (uma por linha ou separadas por ;)</Label>
            <Textarea
              className="mt-1 min-h-[56px]"
              value={tesesTxt}
              onChange={(e) => setTesesTxt(e.target.value)}
              placeholder="Capitalização indevida; Juros abusivos; Repetição de indébito"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!podeRodar || avaliarMut.isPending}
              onClick={() => avaliarMut.mutate({ fatos, teses, modelo })}
            >
              {avaliarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Target className="h-4 w-4 mr-2" />}
              Avaliar viabilidade
            </Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!podeRodar || gerarMut.isPending}
              onClick={() => gerarMut.mutate({ fatos, teses, tipo: tipoSel, modelo, resumoAvaliacao: avaliacao?.resumo, contatoId: cliente?.id, processoId: processoId ?? undefined, documentoIds: cliente ? docsSelecionados : undefined })}
            >
              {gerarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Gerar peça
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 2 · Avaliação */}
      {avaliacao && (
        <Card>
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Viabilidade:</span>
              <span className={`inline-flex items-center px-3 py-1 rounded-lg text-sm font-bold border ${NOTA_INFO[avaliacao.nota]?.cls ?? ""}`}>
                {NOTA_INFO[avaliacao.nota]?.label ?? avaliacao.nota}
              </span>
            </div>
            {avaliacao.resumo && <p className="text-sm text-muted-foreground">{avaliacao.resumo}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FatoresBox titulo="✓ A favor" cor="emerald" itens={avaliacao.fatoresFavor} />
              <FatoresBox titulo="✕ Contra / atenção" cor="rose" itens={avaliacao.fatoresContra} />
            </div>
            {Array.isArray(avaliacao.teses) && avaliacao.teses.length > 0 && (
              <div className="rounded-lg border">
                <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b">Força por tese</div>
                {avaliacao.teses.map((t: any, i: number) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-sm border-b last:border-0">
                    <span>{t.nome}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${NOTA_INFO[t.forca]?.cls ?? ""}`}>{NOTA_INFO[t.forca]?.label ?? t.forca}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 3 · Peça + fontes */}
      {pecaTexto && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-4">
          <Card>
            <CardContent className="pt-5 space-y-3">
              <Label className="text-xs">Peça (edite antes de exportar)</Label>
              <Textarea className="min-h-[320px] font-mono text-[12.5px] leading-relaxed" value={pecaTexto} onChange={(e) => setPecaTexto(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={exportMut.isPending}
                  onClick={() => exportMut.mutate({ texto: pecaTexto, nomeArquivo: tipoSel })}
                >
                  {exportMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  Exportar DOCX
                </Button>
              </div>
              <div className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                ⚠️ Minuta gerada por IA. <b>Revisão e assinatura do advogado são obrigatórias</b> antes de protocolar.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Fontes usadas · {verificacao?.fontesUsadas?.length ?? 0}
                </p>
                <div className="space-y-1">
                  {(verificacao?.fontesUsadas ?? []).map((f) => (
                    <div key={f} className="text-xs flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" /> {f}
                    </div>
                  ))}
                  {(verificacao?.fontesUsadas?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">—</p>}
                </div>
              </div>
              {(verificacao?.suspeitas?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600 mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Alertas de citação · {verificacao!.suspeitas.length}
                  </p>
                  <div className="space-y-1">
                    {verificacao!.suspeitas.map((s, i) => (
                      <div key={i} className="text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-md px-2 py-1.5">
                        <b>{s}</b> — sem respaldo na base. Possível invenção; confira ou remova.
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Fontes do escritório — CRUD das fontes próprias (além da base global) */}
      <Dialog open={fontesOpen} onOpenChange={setFontesOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Library className="h-5 w-5 text-violet-600" /> Fontes do escritório</DialogTitle>
            <DialogDescription>
              Além da base global, cadastre suas próprias súmulas, jurisprudências ou modelos — o Agente usa nas avaliações e peças (junto com a base global).
            </DialogDescription>
          </DialogHeader>

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
              <div>
                <Label className="text-xs">Identificador</Label>
                <Input className="mt-1" value={nf.identificador} onChange={(e) => setNf({ ...nf, identificador: e.target.value })} placeholder="Ex.: Súmula 297/STJ" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Título (opcional)</Label>
              <Input className="mt-1" value={nf.titulo} onChange={(e) => setNf({ ...nf, titulo: e.target.value })} placeholder="Resumo curto" />
            </div>
            <div>
              <Label className="text-xs">Texto</Label>
              <Textarea className="mt-1 min-h-[70px]" value={nf.texto} onChange={(e) => setNf({ ...nf, texto: e.target.value })} placeholder="Enunciado / conteúdo que o Agente pode citar" />
            </div>
            <div>
              <Label className="text-xs">Tags (opcional)</Label>
              <Input className="mt-1" value={nf.tags} onChange={(e) => setNf({ ...nf, tags: e.target.value })} placeholder="capitalização, juros" />
            </div>
            <Button
              size="sm"
              disabled={addFonteMut.isPending || nf.identificador.trim().length < 2 || nf.texto.trim().length < 5}
              onClick={() => addFonteMut.mutate({
                tipo: nf.tipo,
                identificador: nf.identificador.trim(),
                titulo: nf.titulo.trim() || undefined,
                texto: nf.texto.trim(),
                tags: nf.tags.trim() || undefined,
              })}
            >
              {addFonteMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
              Adicionar fonte
            </Button>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Suas fontes ({minhasFontesQ.data?.length ?? 0})
            </p>
            {minhasFontesQ.isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
            {(minhasFontesQ.data ?? []).map((f: any) => (
              <div key={f.id} className="flex items-start justify-between gap-2 border rounded-md p-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{f.identificador}{f.titulo ? ` — ${f.titulo}` : ""}</p>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{f.texto}</p>
                  {!f.indexada && <span className="text-[10px] text-amber-600">não indexada (configure a chave OpenAI)</span>}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 hover:text-rose-600" disabled={delFonteMut.isPending} onClick={() => delFonteMut.mutate({ id: f.id })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {!minhasFontesQ.isLoading && (minhasFontesQ.data?.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma fonte própria ainda — a base global já está disponível.</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFontesOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FatoresBox({ titulo, cor, itens }: { titulo: string; cor: "emerald" | "rose"; itens: any[] }) {
  const head = cor === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className={`px-3 py-2 text-[11px] font-bold ${head}`}>{titulo}</div>
      {(Array.isArray(itens) ? itens : []).map((f: any, i: number) => (
        <div key={i} className="px-3 py-2 text-xs border-t first:border-t-0">
          {f.texto}
          {f.fonte && (
            <span className={`ml-1.5 inline-block text-[9.5px] font-bold rounded-full px-1.5 border ${f.fonteVerificada ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-rose-50 text-rose-600 border-rose-200"}`}>
              {f.fonte}{f.fonteVerificada ? "" : " ⚠"}
            </span>
          )}
        </div>
      ))}
      {(!Array.isArray(itens) || itens.length === 0) && <div className="px-3 py-2 text-xs text-muted-foreground">—</div>}
    </div>
  );
}
