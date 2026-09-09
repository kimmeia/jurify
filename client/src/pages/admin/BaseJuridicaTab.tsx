import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Edit, Loader2, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

export default function BaseJuridicaTab() {
  // Base jurídica (RAG) do Agente Jurídico — popular/indexar com 1 clique.
  const { data: baseStatus, refetch: refetchBase } = (trpc as any).juridico.statusBaseGlobal.useQuery(undefined, { retry: false });
  const seedBaseMut = (trpc as any).juridico.seedBaseRevisional.useMutation({
    onSuccess: (r: any) => {
      toast.success("Base jurídica atualizada", {
        description: `${r.inseridas} nova(s) fonte(s), ${r.indexadas} indexada(s).${r.indexou ? "" : " (sem chave OpenAI — não indexou)"}`,
      });
      refetchBase();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  // Subir decisão/jurisprudência pra base GLOBAL (RAG) — amplia o conhecimento.
  // Vive num Dialog: o formulário sempre aberto ocupava meia tela (feedback
  // do dono: poluição visual) — agora abre no clique e some ao salvar.
  const [decisaoOpen, setDecisaoOpen] = useState(false);
  const [decisaoFile, setDecisaoFile] = useState<File | null>(null);
  const [decisaoLink, setDecisaoLink] = useState("");
  const [decisaoId, setDecisaoId] = useState("");
  const [decisaoTitulo, setDecisaoTitulo] = useState("");
  const subirDecisaoMut = (trpc as any).juridico.subirDecisao.useMutation({
    onSuccess: (r: any) => {
      toast.success("Decisão adicionada à base", { description: `${r.trechos} trecho(s), ${r.indexadas} indexado(s) (via ${r.via}).` });
      setDecisaoFile(null); setDecisaoLink(""); setDecisaoId(""); setDecisaoTitulo("");
      setDecisaoOpen(false);
      refetchBase(); fontesGlobaisQ.refetch();
    },
    onError: (err: any) => toast.error("Erro ao subir decisão", { description: err.message }),
  });
  async function enviarDecisao() {
    if (decisaoId.trim().length < 2 || (!decisaoFile && !decisaoLink.trim())) return;
    let base64: string | undefined; let nomeArquivo: string | undefined;
    if (decisaoFile) {
      nomeArquivo = decisaoFile.name;
      base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = reject;
        reader.readAsDataURL(decisaoFile);
      });
    }
    subirDecisaoMut.mutate({ identificador: decisaoId.trim(), titulo: decisaoTitulo.trim() || undefined, base64, nomeArquivo, link: decisaoLink.trim() || undefined });
  }

  // Gestão da base: filtro por área, busca, editar/excluir.
  const [baseArea, setBaseArea] = useState<string>("");
  const [baseBusca, setBaseBusca] = useState("");
  const fontesGlobaisQ = (trpc as any).juridico.listarFontesGlobais.useQuery(
    { area: baseArea || undefined, busca: baseBusca.trim() || undefined },
    { retry: false },
  );
  const [fonteEdit, setFonteEdit] = useState<any | null>(null);
  const editarFonteMut = (trpc as any).juridico.editarFonteGlobal.useMutation({
    onSuccess: () => { toast.success("Fonte atualizada"); setFonteEdit(null); fontesGlobaisQ.refetch(); refetchBase(); },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });
  const [fonteExcluir, setFonteExcluir] = useState<any | null>(null);
  const excluirFonteMut = (trpc as any).juridico.excluirFonteGlobal.useMutation({
    onSuccess: () => { toast.success("Fonte excluída"); setFonteExcluir(null); fontesGlobaisQ.refetch(); refetchBase(); },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });

  const total = baseStatus?.total ?? 0;
  const indexadas = baseStatus?.indexadas ?? 0;

  return (
    <div className="space-y-4">
      {/* Faixa única: números + as 3 ações. A descrição do que é a base
          mora no hub (ContextoAba); formulário só abre quando pedir. */}
      <Card>
        <CardContent className="pt-5 pb-5 flex flex-wrap items-center gap-x-7 gap-y-3">
          <div>
            <p className="text-2xl font-bold tabular-nums leading-none">{total}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-1">fontes</p>
          </div>
          <div>
            <p className={"text-2xl font-bold tabular-nums leading-none " + (indexadas < total ? "text-warning-fg" : "text-success-fg")}>
              {indexadas}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-1">indexadas</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setDecisaoOpen(true)}>
              <Upload className="h-4 w-4 mr-1.5" /> Subir decisão
            </Button>
            <Button size="sm" variant="outline" onClick={() => setFonteEdit({ id: null, tipo: "sumula", identificador: "", orgao: "", area: baseArea || "", titulo: "", texto: "", tags: "" })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Nova fonte
            </Button>
            <Button size="sm" variant="outline" onClick={() => seedBaseMut.mutate()} disabled={seedBaseMut.isPending}>
              {seedBaseMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
              {total > 0 ? "Reindexar" : "Popular / indexar"}
            </Button>
          </div>
          {total > 0 && indexadas < total && (
            <span className="w-full text-[11px] text-warning-fg">
              Há fontes não indexadas — clique em Reindexar (precisa de chave OpenAI).
            </span>
          )}
        </CardContent>
      </Card>

      {/* Subir decisão / jurisprudência — em dialog: aberto só quando pedir */}
      <Dialog open={decisaoOpen} onOpenChange={setDecisaoOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-info-fg" /> Subir decisão / jurisprudência
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">
            Arquivo (PDF/DOCX/imagem — Vision) ou link de súmula/acórdão. O conteúdo é lido,
            fatiado e indexado — passa a valer pra todos os escritórios.
          </p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Identificador *</Label>
              <Input className="mt-1 h-9" placeholder="Ex.: REsp 1.061.530/RS" value={decisaoId} onChange={(e) => setDecisaoId(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Título (opcional)</Label>
              <Input className="mt-1 h-9" placeholder="Resumo curto" value={decisaoTitulo} onChange={(e) => setDecisaoTitulo(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Link (opcional)</Label>
              <Input className="mt-1 h-9" placeholder="https://... (súmula/acórdão)" value={decisaoLink} onChange={(e) => setDecisaoLink(e.target.value)} />
            </div>
            <input
              type="file"
              accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
              onChange={(e) => setDecisaoFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecisaoOpen(false)}>Cancelar</Button>
            <Button size="sm" disabled={(!decisaoFile && !decisaoLink.trim()) || decisaoId.trim().length < 2 || subirDecisaoMut.isPending} onClick={enviarDecisao}>
              {subirDecisaoMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
              Subir decisão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fontes da base: filtro por área, busca, editar/excluir */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Fontes da base ({fontesGlobaisQ.data?.fontes?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button className={"text-[11px] px-2.5 py-1 rounded-full border " + (!baseArea ? "bg-info text-info-on border-info/30" : "bg-background")} onClick={() => setBaseArea("")}>Todas</button>
            {(fontesGlobaisQ.data?.areas ?? []).map((a: any) => (
              <button key={a.area} className={"text-[11px] px-2.5 py-1 rounded-full border " + (baseArea === a.area ? "bg-info text-info-on border-info/30" : "bg-background")} onClick={() => setBaseArea(a.area)}>
                {a.area} <span className="opacity-60">{a.n}</span>
              </button>
            ))}
          </div>
          <Input className="h-9 mb-2" placeholder="Buscar por identificador, texto ou tag…" value={baseBusca} onChange={(e) => setBaseBusca(e.target.value)} />
          <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
            {fontesGlobaisQ.isLoading && <p className="text-xs text-muted-foreground p-3">Carregando…</p>}
            {(fontesGlobaisQ.data?.fontes ?? []).map((f: any) => (
              <div key={f.id} className="flex items-start gap-2 p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate">{f.identificador}</span>
                    <span className="text-[10px] px-1.5 rounded bg-muted">{f.tipo}</span>
                    <span className="text-[10px] text-muted-foreground">{f.area}</span>
                    {!f.indexada && <span className="text-[10px] text-warning-fg">não indexada</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">{f.titulo || f.texto}</p>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setFonteEdit({ ...f, orgao: f.orgao || "", titulo: f.titulo || "", tags: f.tags || "" })}><Edit className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 hover:text-danger-fg" onClick={() => setFonteExcluir(f)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
            {!fontesGlobaisQ.isLoading && (fontesGlobaisQ.data?.fontes?.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground p-3">Nenhuma fonte {baseArea ? `na área "${baseArea}"` : "ainda"}.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Editar / criar fonte (dialog) */}
      <Dialog open={!!fonteEdit} onOpenChange={(o) => !o && setFonteEdit(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{fonteEdit?.id ? "Editar fonte" : "Nova fonte"}</DialogTitle></DialogHeader>
          {fonteEdit && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Tipo</Label>
                  <Select value={fonteEdit.tipo} onValueChange={(v) => setFonteEdit({ ...fonteEdit, tipo: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sumula">Súmula</SelectItem>
                      <SelectItem value="lei">Lei / artigo</SelectItem>
                      <SelectItem value="precedente">Precedente</SelectItem>
                      <SelectItem value="tese">Tese / modelo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Área</Label><Input className="mt-1" value={fonteEdit.area} onChange={(e) => setFonteEdit({ ...fonteEdit, area: e.target.value })} placeholder="Ex.: revisional_bancaria" /></div>
              </div>
              <div><Label className="text-xs">Identificador *</Label><Input className="mt-1" value={fonteEdit.identificador} onChange={(e) => setFonteEdit({ ...fonteEdit, identificador: e.target.value })} placeholder="Ex.: Súmula 297/STJ" /></div>
              <div><Label className="text-xs">Título</Label><Input className="mt-1" value={fonteEdit.titulo} onChange={(e) => setFonteEdit({ ...fonteEdit, titulo: e.target.value })} /></div>
              <div><Label className="text-xs">Texto *</Label><Textarea className="mt-1 min-h-[90px]" value={fonteEdit.texto} onChange={(e) => setFonteEdit({ ...fonteEdit, texto: e.target.value })} /></div>
              <div><Label className="text-xs">Tags</Label><Input className="mt-1" value={fonteEdit.tags} onChange={(e) => setFonteEdit({ ...fonteEdit, tags: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFonteEdit(null)}>Cancelar</Button>
            <Button
              disabled={editarFonteMut.isPending || subirDecisaoMut.isPending || !fonteEdit || fonteEdit.identificador.trim().length < 2 || fonteEdit.texto.trim().length < 3}
              onClick={() => {
                if (fonteEdit.id) {
                  editarFonteMut.mutate({ id: fonteEdit.id, tipo: fonteEdit.tipo, identificador: fonteEdit.identificador.trim(), orgao: fonteEdit.orgao || undefined, area: fonteEdit.area || undefined, titulo: fonteEdit.titulo || undefined, texto: fonteEdit.texto.trim(), tags: fonteEdit.tags || undefined });
                } else {
                  subirDecisaoMut.mutate({ identificador: fonteEdit.identificador.trim(), titulo: fonteEdit.titulo || undefined, area: fonteEdit.area || undefined, tipo: fonteEdit.tipo, texto: fonteEdit.texto.trim() }, { onSuccess: () => setFonteEdit(null) });
                }
              }}
            >
              {(editarFonteMut.isPending || subirDecisaoMut.isPending) ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excluir fonte (confirmação) */}
      <AlertDialog open={!!fonteExcluir} onOpenChange={(o) => !o && setFonteExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir fonte?</AlertDialogTitle>
            <AlertDialogDescription>Remove <strong>{fonteExcluir?.identificador}</strong> da base global. O agente deixa de citá-la.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirFonteMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={excluirFonteMut.isPending} onClick={(e) => { e.preventDefault(); if (fonteExcluir) excluirFonteMut.mutate({ id: fonteExcluir.id }); }}>
              {excluirFonteMut.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
