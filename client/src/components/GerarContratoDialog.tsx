/**
 * Modal "Gerar contrato" — invocado a partir do detalhe do cliente.
 *
 * Fluxo:
 *  1. Operador escolhe um modelo de contrato cadastrado
 *  2. Se o modelo tem placeholders manuais, mostra inputs pra preencher
 *  3. Click "Gerar" → backend renderiza DOCX, retorna base64 → download
 */

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, FileText, Loader2, Variable } from "lucide-react";
import { toast } from "sonner";
import type { Placeholder } from "../../../shared/modelos-contrato-variaveis";

interface ModeloLista {
  id: number;
  nome: string;
  descricao: string | null;
  placeholders: Placeholder[];
}

interface Props {
  contatoId: number;
  contatoNome?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function GerarContratoDialog({ contatoId, contatoNome, open, onOpenChange }: Props) {
  const { data: modelos, isLoading } = (trpc as any).modelosContrato.listar.useQuery(undefined, {
    enabled: open,
  });

  const [modeloId, setModeloId] = useState<number | null>(null);
  const [valoresManuais, setValoresManuais] = useState<Record<string, string>>({});

  // Reset ao fechar
  useEffect(() => {
    if (!open) {
      setModeloId(null);
      setValoresManuais({});
    }
  }, [open]);

  const modeloSelecionado: ModeloLista | undefined = useMemo(() => {
    if (!modelos || modeloId == null) return undefined;
    return (modelos as ModeloLista[]).find((m) => m.id === modeloId);
  }, [modelos, modeloId]);

  const placeholdersManuais = useMemo(() => {
    if (!modeloSelecionado) return [];
    return modeloSelecionado.placeholders.filter((p) => p.tipo === "manual");
  }, [modeloSelecionado]);

  const placeholdersVariavel = useMemo(() => {
    if (!modeloSelecionado) return [];
    return modeloSelecionado.placeholders.filter((p) => p.tipo === "variavel");
  }, [modeloSelecionado]);

  const gerar = (trpc as any).modelosContrato.gerar.useMutation({
    onSuccess: (r: { nomeArquivo: string; base64: string }) => {
      // Decodifica base64 e dispara download
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.nomeArquivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Contrato gerado");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const todosPreenchidos = placeholdersManuais.every((p) =>
    (valoresManuais[String(p.numero)] || "").trim().length > 0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-info" />
            Gerar contrato
          </DialogTitle>
          <DialogDescription>
            {contatoNome ? `Cliente: ${contatoNome}` : "Escolha um modelo e preencha os campos manuais."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Modelo *</Label>
            {isLoading ? (
              <div className="h-9 rounded-md border bg-muted/30 px-3 flex items-center text-xs text-muted-foreground">
                Carregando...
              </div>
            ) : !modelos || modelos.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                Nenhum modelo cadastrado. Vá em <b>Modelos de contrato</b> e cadastre um primeiro.
              </div>
            ) : (
              <Select
                value={modeloId ? String(modeloId) : ""}
                onValueChange={(v) => {
                  setModeloId(Number(v));
                  setValoresManuais({});
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um modelo..." />
                </SelectTrigger>
                <SelectContent>
                  {(modelos as ModeloLista[]).map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {modeloSelecionado && (
            <>
              {/* Resumo das variáveis automáticas */}
              {placeholdersVariavel.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                  <p className="text-[11px] font-medium flex items-center gap-1 text-muted-foreground">
                    <Variable className="h-3 w-3" />
                    {placeholdersVariavel.length} variável(is) preenchidas automático
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {placeholdersVariavel.map((p) =>
                      p.tipo === "variavel" ? (
                        <Badge
                          key={p.numero}
                          variant="secondary"
                          className="text-[10px] h-5 font-mono"
                          title={p.variavel}
                        >
                          {`{{${p.numero}}}`} → {p.variavel}
                        </Badge>
                      ) : null,
                    )}
                  </div>
                </div>
              )}

              {/* Inputs pros placeholders manuais */}
              {placeholdersManuais.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium">Preencha os campos manuais:</p>
                  {placeholdersManuais.map((p) => {
                    if (p.tipo !== "manual") return null;
                    const key = String(p.numero);
                    return (
                      <div key={p.numero} className="space-y-1">
                        <Label className="text-xs">
                          {p.label} <span className="text-muted-foreground font-mono">({`{{${p.numero}}}`})</span>
                        </Label>
                        <Input
                          value={valoresManuais[key] || ""}
                          onChange={(e) =>
                            setValoresManuais((v) => ({ ...v, [key]: e.target.value }))
                          }
                          placeholder={p.dica || ""}
                        />
                        {p.dica && (
                          <p className="text-[10px] text-muted-foreground">{p.dica}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {placeholdersVariavel.length === 0 && placeholdersManuais.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Este modelo não tem placeholders. Será gerado idêntico ao original.
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={gerar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              modeloSelecionado &&
              gerar.mutate({
                modeloId: modeloSelecionado.id,
                contatoId,
                valoresManuais: placeholdersManuais.length > 0 ? valoresManuais : undefined,
              })
            }
            disabled={!modeloSelecionado || !todosPreenchidos || gerar.isPending}
          >
            {gerar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Gerar e baixar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
