/**
 * O que o escritório configura no assistente.
 *
 * Duas coisas que só o escritório sabe e que mudam toda resposta: como o agente
 * deve escrever (tom, cláusulas padrão, preferências) e quais fontes próprias
 * ele pode citar — súmula, lei, precedente ou tese que a casa usa e que a base
 * global não tem. Fora daqui, a IA cita só o que está indexado.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Library, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

/** Diálogo de fontes próprias do escritório (base RAG do escritório). */
export function ConfigurarAgente({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
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
          <DialogTitle className="flex items-center gap-2"><Library className="h-5 w-5 text-violet-600 dark:text-violet-400" /> Configurar o Agente Jurídico</DialogTitle>
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
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 hover:text-rose-600 dark:hover:text-rose-400" disabled={delFonteMut.isPending} onClick={() => delFonteMut.mutate({ id: f.id })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          {!minhasFontesQ.isLoading && (minhasFontesQ.data?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">Nenhuma fonte própria ainda — a base global já está disponível.</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
