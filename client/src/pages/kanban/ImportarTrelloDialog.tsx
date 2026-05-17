/**
 * Dialog "Importar do Trello" — cola JSON, vê preview, confirma.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (funilId: number) => void;
}

export function ImportarTrelloDialog({ open, onOpenChange, onSuccess }: Props) {
  const [json, setJson] = useState("");
  const [ignorarArchivados, setIgnorarArchivados] = useState(true);
  const [preview, setPreview] = useState<{
    nome: string;
    colunas: number;
    cards: number;
    listasIgnoradas: number;
    cardsIgnorados: number;
    primeirasColunas: string[];
  } | null>(null);

  const preverMut = (trpc as any).kanban.preverImportTrello.useMutation({
    onSuccess: (r: any) => setPreview(r),
    onError: (err: any) => {
      setPreview(null);
      toast.error("JSON inválido", { description: err.message });
    },
  });
  const importarMut = (trpc as any).kanban.importarDoTrello.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Funil "${r.funilNome}" importado!`, {
        description: `${r.colunasCriadas} colunas, ${r.cardsCriados} cards. ${
          r.listasIgnoradas + r.cardsIgnorados > 0
            ? `${r.listasIgnoradas + r.cardsIgnorados} item(ns) ignorado(s).`
            : ""
        }`,
      });
      onSuccess?.(r.funilId);
      handleClose();
    },
    onError: (err: any) =>
      toast.error("Falha ao importar", { description: err.message }),
  });

  const handleClose = () => {
    setJson("");
    setPreview(null);
    onOpenChange(false);
  };

  const handleFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 20MB)");
      return;
    }
    const txt = await file.text();
    setJson(txt);
    setPreview(null);
  };

  const handleValidar = () => {
    if (!json.trim()) {
      toast.error("Cola o JSON do board primeiro");
      return;
    }
    preverMut.mutate({ json, ignorarArchivados });
  };

  const handleImportar = () => {
    importarMut.mutate({ json, ignorarArchivados });
  };

  const validando = preverMut.isPending;
  const importando = importarMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !importando && !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" /> Importar do Trello
          </DialogTitle>
          <DialogDescription>
            No Trello, abra o board → Menu → <strong>Print and Export → Export as JSON</strong>.
            Cole o conteúdo abaixo (ou arraste o arquivo).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Textarea + upload */}
          <div className="space-y-2">
            <Label className="text-xs">JSON do board</Label>
            <Textarea
              value={json}
              onChange={(e) => {
                setJson(e.target.value);
                setPreview(null);
              }}
              placeholder='{ "name": "Casos em andamento", "lists": [...], "cards": [...] }'
              className="font-mono text-xs h-32"
              disabled={validando || importando}
            />
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                  disabled={validando || importando}
                />
                ou clique aqui para escolher o arquivo .json
              </label>
              <span className="text-[10px] text-muted-foreground">
                {json.length > 0 && `${(json.length / 1024).toFixed(0)} KB`}
              </span>
            </div>
          </div>

          {/* Opções */}
          <div className="flex items-center justify-between border rounded p-3">
            <div>
              <Label className="text-xs cursor-pointer" htmlFor="ig-arch">
                Ignorar listas e cards arquivados
              </Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Recomendado. Boards velhos geralmente têm muito conteúdo arquivado.
              </p>
            </div>
            <Switch
              id="ig-arch"
              checked={ignorarArchivados}
              onCheckedChange={(v) => {
                setIgnorarArchivados(v);
                setPreview(null);
              }}
              disabled={validando || importando}
            />
          </div>

          {/* Botão validar */}
          {!preview && (
            <Button
              onClick={handleValidar}
              disabled={!json.trim() || validando || importando}
              variant="outline"
              className="w-full"
            >
              {validando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Validar e prever importação
            </Button>
          )}

          {/* Preview */}
          {preview && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3 space-y-3 dark:bg-emerald-950/30 dark:border-emerald-900">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                JSON válido — prévia da importação
              </p>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-background border rounded p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">Funil novo</p>
                  <p className="font-bold truncate" title={preview.nome}>
                    {preview.nome}
                  </p>
                </div>
                <div className="bg-background border rounded p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">Colunas</p>
                  <p className="text-lg font-bold tabular-nums">{preview.colunas}</p>
                </div>
                <div className="bg-background border rounded p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">Cards</p>
                  <p className="text-lg font-bold tabular-nums">{preview.cards}</p>
                </div>
              </div>
              {preview.primeirasColunas.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  <strong>Primeiras colunas:</strong> {preview.primeirasColunas.join(" · ")}
                  {preview.colunas > preview.primeirasColunas.length &&
                    ` (+${preview.colunas - preview.primeirasColunas.length})`}
                </p>
              )}
              {(preview.listasIgnoradas > 0 || preview.cardsIgnorados > 0) && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  ⚠ Ignorados: {preview.listasIgnoradas} lista(s),{" "}
                  {preview.cardsIgnorados} card(s) (arquivados, sem nome, ou em lista
                  removida).
                </p>
              )}
              <p className="text-[10px] text-muted-foreground italic">
                Membros, anexos e comentários do Trello não são importados.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={importando}>
            Cancelar
          </Button>
          <Button
            onClick={handleImportar}
            disabled={!preview || importando || validando}
          >
            {importando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {preview ? `Importar ${preview.cards} cards` : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
