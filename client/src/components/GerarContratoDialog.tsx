/**
 * Modal "Gerar contrato" — invocado a partir do detalhe do cliente.
 *
 * Fluxo:
 *  1. Operador escolhe um modelo de contrato (filtrado por
 *     `ehParaAssinatura=true` — petições/pareceres ficam de fora)
 *  2. Se o modelo tem placeholders manuais, mostra inputs pra preencher
 *  3. User escolhe entre 2 ações:
 *     a) "Baixar DOCX" — backend renderiza DOCX, retorna base64 → download
 *     b) "Enviar pra assinatura" — backend converte DOCX→PDF, salva em
 *        /uploads/assinaturas/, cria registro em assinaturas_digitais,
 *        retorna link /assinar/:token pra operador copiar/enviar.
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
import {
  Copy,
  Download,
  FileText,
  Loader2,
  PenLine,
  Variable,
} from "lucide-react";
import { toast } from "sonner";
import type { Placeholder } from "../../../shared/modelos-contrato-variaveis";

interface ModeloLista {
  id: number;
  nome: string;
  descricao: string | null;
  placeholders: Placeholder[];
  ehParaAssinatura: boolean;
}

interface Props {
  contatoId: number;
  contatoNome?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function GerarContratoDialog({ contatoId, contatoNome, open, onOpenChange }: Props) {
  const utils = (trpc as any).useUtils();
  const { data: modelos, isLoading } = (trpc as any).modelosContrato.listar.useQuery(undefined, {
    enabled: open,
  });

  const [modeloId, setModeloId] = useState<number | null>(null);
  const [valoresManuais, setValoresManuais] = useState<Record<string, string>>({});
  const [linkGerado, setLinkGerado] = useState<string | null>(null);

  // Reset ao fechar
  useEffect(() => {
    if (!open) {
      setModeloId(null);
      setValoresManuais({});
      setLinkGerado(null);
    }
  }, [open]);

  // Filtra modelos: só mostra os marcados como contrato pra assinatura.
  // Petições, pareceres e similares (ehParaAssinatura=false) ficam de fora.
  const modelosFiltrados = useMemo<ModeloLista[]>(() => {
    if (!modelos) return [];
    return (modelos as ModeloLista[]).filter((m) => m.ehParaAssinatura);
  }, [modelos]);

  const modeloSelecionado: ModeloLista | undefined = useMemo(() => {
    if (modeloId == null) return undefined;
    return modelosFiltrados.find((m) => m.id === modeloId);
  }, [modelosFiltrados, modeloId]);

  const placeholdersManuais = useMemo(() => {
    if (!modeloSelecionado) return [];
    return modeloSelecionado.placeholders.filter((p) => p.tipo === "manual");
  }, [modeloSelecionado]);

  const placeholdersVariavel = useMemo(() => {
    if (!modeloSelecionado) return [];
    return modeloSelecionado.placeholders.filter((p) => p.tipo === "variavel");
  }, [modeloSelecionado]);

  const baixarMut = (trpc as any).modelosContrato.gerar.useMutation({
    onSuccess: (r: { nomeArquivo: string; base64: string }) => {
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

  const assinaturaMut = (trpc as any).modelosContrato.gerarComoAssinatura.useMutation({
    onSuccess: (r: { assinaturaId: number; token: string; linkAssinatura: string }) => {
      // Constrói URL absoluta (linkAssinatura é só "/assinar/:token")
      const fullUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}${r.linkAssinatura}`
          : r.linkAssinatura;
      setLinkGerado(fullUrl);
      navigator.clipboard.writeText(fullUrl).catch(() => {
        /* clipboard pode falhar em http; ignora */
      });
      toast.success("Assinatura criada", {
        description: "Link copiado pro clipboard. Envie pro cliente.",
      });
      // Invalida lista de assinaturas do cliente pra aba "Documentos"
      // pegar a nova entrada na próxima abertura.
      utils.assinaturas?.listarPorCliente?.invalidate?.({ contatoId });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const todosPreenchidos = placeholdersManuais.every((p) =>
    (valoresManuais[p.nome] || "").trim().length > 0,
  );

  const isPending = baixarMut.isPending || assinaturaMut.isPending;

  function handleBaixar() {
    if (!modeloSelecionado) return;
    baixarMut.mutate({
      modeloId: modeloSelecionado.id,
      contatoId,
      valoresManuais: placeholdersManuais.length > 0 ? valoresManuais : undefined,
    });
  }

  function handleEnviarParaAssinatura() {
    if (!modeloSelecionado) return;
    assinaturaMut.mutate({
      modeloId: modeloSelecionado.id,
      contatoId,
      valoresManuais: placeholdersManuais.length > 0 ? valoresManuais : undefined,
    });
  }

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

        {linkGerado ? (
          // Estado pós-criação de assinatura: mostra link copiável + ação
          <div className="space-y-4 py-2">
            <div className="rounded-md border-2 border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5 text-emerald-700">
                <PenLine className="h-4 w-4" />
                Assinatura criada com sucesso
              </p>
              <p className="text-xs text-muted-foreground">
                Link copiado pro clipboard. Envie pro cliente via WhatsApp ou email.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <Input value={linkGerado} readOnly className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(linkGerado);
                    toast.success("Link copiado");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              A assinatura também aparece na aba &ldquo;Documentos&rdquo; do cliente,
              onde dá pra enviar via WhatsApp ou cancelar.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Modelo *</Label>
              {isLoading ? (
                <div className="h-9 rounded-md border bg-muted/30 px-3 flex items-center text-xs text-muted-foreground">
                  Carregando...
                </div>
              ) : modelosFiltrados.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground space-y-1">
                  <p>Nenhum modelo marcado como contrato.</p>
                  <p className="text-[10px]">
                    Vá em <b>Modelos de contrato</b>, edite o modelo desejado e marque a
                    flag &ldquo;Este modelo é um contrato (cliente precisa assinar)&rdquo;.
                  </p>
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
                    {modelosFiltrados.map((m) => (
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
                            key={p.nome}
                            variant="secondary"
                            className="text-[10px] h-5 font-mono"
                            title={p.variavel}
                          >
                            {`{{${p.nome}}}`} → {p.label ?? p.variavel}
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
                      return (
                        <div key={p.nome} className="space-y-1">
                          <Label className="text-xs">
                            {p.label}{" "}
                            <span className="text-muted-foreground font-mono">
                              ({`{{${p.nome}}}`})
                            </span>
                          </Label>
                          <Input
                            value={valoresManuais[p.nome] || ""}
                            onChange={(e) =>
                              setValoresManuais((v) => ({ ...v, [p.nome]: e.target.value }))
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
        )}

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          {linkGerado ? (
            <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
              Fechar
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
                className="sm:mr-auto"
              >
                Cancelar
              </Button>
              <Button
                variant="outline"
                onClick={handleBaixar}
                disabled={!modeloSelecionado || !todosPreenchidos || isPending}
              >
                {baixarMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Baixar DOCX
              </Button>
              <Button
                onClick={handleEnviarParaAssinatura}
                disabled={!modeloSelecionado || !todosPreenchidos || isPending}
              >
                {assinaturaMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <PenLine className="h-4 w-4 mr-2" />
                )}
                Enviar pra assinatura
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
