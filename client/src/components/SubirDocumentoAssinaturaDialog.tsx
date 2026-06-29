/**
 * Modal "Subir documento p/ assinatura" — para um contrato JÁ pronto
 * (PDF ou Word), sem modelo nem placeholders.
 *
 * Fluxo:
 *  1. Escolhe cliente + título + arquivo (PDF/DOCX).
 *  2. Sobe o arquivo (uploadRouter) e cria a assinatura (criarDeUpload):
 *     Word vira PDF no servidor.
 *  3. Abre o MESMO editor de posicionamento de campos usado ao gerar
 *     contrato a partir de modelo; ao salvar, mostra o link /assinar.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, FileText, Loader2, PenLine, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  EditorPosicionamentoCampos,
  type CampoParaSalvar,
} from "@/components/EditorPosicionamentoCampos";
import { ClienteCombobox } from "@/pages/financeiro/ClienteCombobox";

const MAX_MB = 95;
const ACCEPT = ".pdf,.docx";

function fileParaBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("Falha ao ler o arquivo."));
    r.readAsDataURL(file);
  });
}

export function SubirDocumentoAssinaturaDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cliente, setCliente] = useState<{ id: number; nome: string } | null>(null);
  const [titulo, setTitulo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [linkGerado, setLinkGerado] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<{
    assinaturaId: number;
    documentoUrl: string;
    linkFinal: string;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setCliente(null);
      setTitulo("");
      setArquivo(null);
      setEnviando(false);
      setLinkGerado(null);
      setEditorState(null);
    }
  }, [open]);

  const uploadMut = (trpc as any).upload.enviar.useMutation();
  const criarMut = (trpc as any).assinaturas.criarDeUpload.useMutation();
  const salvarCamposMut = (trpc as any).assinaturas.salvarCampos.useMutation({
    onSuccess: () => {
      if (!editorState) return;
      setLinkGerado(editorState.linkFinal);
      navigator.clipboard.writeText(editorState.linkFinal).catch(() => { /* http ignora */ });
      toast.success("Assinatura pronta com campos posicionados", { description: "Link copiado. Envie pro cliente." });
      setEditorState(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function escolherArquivo(f: File | null) {
    if (!f) return;
    const ext = (f.name.toLowerCase().split(".").pop() || "");
    if (ext !== "pdf" && ext !== "docx") {
      toast.error("Formato não suportado", { description: "Envie um PDF ou Word (.docx)." });
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande (${(f.size / 1024 / 1024).toFixed(1)} MB)`, { description: `Limite: ${MAX_MB} MB.` });
      return;
    }
    setArquivo(f);
    if (!titulo.trim()) setTitulo(f.name.replace(/\.(pdf|docx)$/i, ""));
  }

  async function handleEnviar() {
    if (!cliente || !arquivo || !titulo.trim()) return;
    try {
      setEnviando(true);
      const base64 = await fileParaBase64(arquivo);
      const up = await uploadMut.mutateAsync({
        nome: arquivo.name,
        tipo: arquivo.type || "application/octet-stream",
        base64,
        tamanho: arquivo.size,
      });
      const r = await criarMut.mutateAsync({
        contatoId: cliente.id,
        titulo: titulo.trim(),
        arquivoUrl: up.url,
      });
      const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${r.linkAssinatura}` : r.linkAssinatura;
      setEditorState({
        assinaturaId: r.assinaturaId,
        // endpoint dedicado (passa pelo auth, evita CORP do helmet) — igual GerarContratoDialog
        documentoUrl: `/api/assinatura/pdf/${r.assinaturaId}`,
        linkFinal: fullUrl,
      });
    } catch (e: any) {
      toast.error("Falha ao subir o documento", { description: e?.message });
    } finally {
      setEnviando(false);
    }
  }

  // Editor de posicionamento em tela cheia (mesmo do GerarContratoDialog).
  if (editorState) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setEditorState(null); onOpenChange(false); } }}>
        <DialogContent
          className="!max-w-[100vw] !w-screen !h-screen !rounded-none p-0 gap-0 flex flex-col"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <EditorPosicionamentoCampos
            pdfUrl={editorState.documentoUrl}
            onSalvar={async (campos: CampoParaSalvar[]) => {
              await salvarCamposMut.mutateAsync({ assinaturaId: editorState.assinaturaId, campos });
            }}
            onCancelar={() => {
              // Sem campos → cai no modo legado (carimbo na última página).
              setLinkGerado(editorState.linkFinal);
              setEditorState(null);
              toast.info("Sem campos posicionados", { description: "A assinatura cairá na última página (modo legado)." });
            }}
            salvando={salvarCamposMut.isPending}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-emerald-600" />
            Subir documento p/ assinatura
          </DialogTitle>
          <DialogDescription>
            Envie um contrato pronto (PDF ou Word) e posicione as assinaturas. Sem modelo nem placeholders.
          </DialogDescription>
        </DialogHeader>

        {linkGerado ? (
          <div className="space-y-4 py-2">
            <div className="rounded-md border-2 border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5 text-emerald-700">
                <PenLine className="h-4 w-4" /> Documento pronto para assinatura
              </p>
              <p className="text-xs text-muted-foreground">Link copiado pro clipboard. Envie pro cliente via WhatsApp ou email.</p>
              <div className="flex items-center gap-2 mt-2">
                <Input value={linkGerado} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(linkGerado); toast.success("Link copiado"); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">A assinatura também aparece na aba “Documentos” do cliente.</p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Cliente *</Label>
              <ClienteCombobox
                fonte="cadastro"
                value={cliente ? String(cliente.id) : ""}
                onChange={(id, cli) => setCliente(id && cli ? { id: Number(id), nome: cli.contatoNome } : null)}
                placeholder="Busque o cliente por nome, CPF ou telefone..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Título *</Label>
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Contrato de honorários — João" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Documento *</Label>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => escolherArquivo(e.target.files?.[0] || null)}
              />
              {arquivo ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{arquivo.name}</p>
                    <p className="text-[10px] text-muted-foreground">{(arquivo.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <button onClick={() => setArquivo(null)} className="text-muted-foreground hover:text-foreground" aria-label="Remover">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => inputRef.current?.click()}
                  className="w-full rounded-md border-2 border-dashed border-violet-200 bg-violet-50/40 hover:bg-violet-50 py-6 text-center"
                >
                  <Upload className="h-6 w-6 mx-auto text-violet-500" />
                  <p className="text-xs font-medium mt-1.5">Clique para escolher o arquivo</p>
                  <p className="text-[10px] text-muted-foreground">PDF ou Word (.docx) · até {MAX_MB} MB · Word vira PDF</p>
                </button>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          {linkGerado ? (
            <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">Fechar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando} className="sm:mr-auto">Cancelar</Button>
              <Button onClick={handleEnviar} disabled={!cliente || !arquivo || !titulo.trim() || enviando}>
                {enviando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PenLine className="h-4 w-4 mr-2" />}
                Posicionar assinaturas →
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
