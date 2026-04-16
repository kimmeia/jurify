/**
 * Editor de Parecer Técnico com Revisão Profissional.
 *
 * O parecer é gerado automaticamente pelo motor, mas precisa ser:
 * 1. Revisado e (opcionalmente) editado pelo advogado responsável
 * 2. Assinado profissionalmente — Revisado por: Nome / OAB
 *
 * O nome do(a) advogado(a) é incluído no PDF exportado, indicando quem
 * assume a responsabilidade técnica pela análise. Sem essa identificação
 * o parecer é apenas um rascunho automático.
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Streamdown } from "streamdown";
import { Download, Loader2, Pencil, Eye, RotateCcw, User, Info, Mail, Share2 } from "lucide-react";
import { toast } from "sonner";

export interface ParecerEditorProps {
  /** Parecer original gerado pelo motor (Markdown). */
  parecerOriginal: string;
  /** Protocolo do cálculo — usado no nome do arquivo PDF. */
  protocolo?: string;
  /** Prefixo do nome do arquivo (ex: "parecer-trabalhista", "parecer-imobiliario"). */
  filenamePrefix?: string;
  /** Estado controlado do nome do revisor — opcional, permite compartilhar entre múltiplos pareceres. */
  revisadoPorNome?: string;
  onRevisadoPorNomeChange?: (v: string) => void;
  /** Estado controlado da OAB do revisor. */
  revisadoPorOab?: string;
  onRevisadoPorOabChange?: (v: string) => void;
  /** Habilita botões de compartilhamento (e-mail/WhatsApp via S3). */
  habilitarCompartilhamento?: boolean;
}

export function ParecerEditor({
  parecerOriginal,
  protocolo,
  filenamePrefix = "parecer-tecnico",
  revisadoPorNome: revisadoPorNomeProp,
  onRevisadoPorNomeChange,
  revisadoPorOab: revisadoPorOabProp,
  onRevisadoPorOabChange,
  habilitarCompartilhamento = false,
}: ParecerEditorProps) {
  const [parecerEditado, setParecerEditado] = useState(parecerOriginal);
  const [edicaoAtiva, setEdicaoAtiva] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isShareLoading, setIsShareLoading] = useState(false);

  // Estado interno do revisor (caso o consumidor não passe controlado)
  const [revisorNomeInterno, setRevisorNomeInterno] = useState("");
  const [revisorOabInterno, setRevisorOabInterno] = useState("");

  const revisadoPorNome = revisadoPorNomeProp ?? revisorNomeInterno;
  const revisadoPorOab = revisadoPorOabProp ?? revisorOabInterno;
  const setRevisadoPorNome = onRevisadoPorNomeChange ?? setRevisorNomeInterno;
  const setRevisadoPorOab = onRevisadoPorOabChange ?? setRevisorOabInterno;

  // Reset edição quando o parecer original mudar (novo cálculo)
  useEffect(() => {
    setParecerEditado(parecerOriginal);
    setEdicaoAtiva(false);
  }, [parecerOriginal]);

  const parecerFoiEditado = parecerEditado.trim() !== parecerOriginal.trim();

  async function exportPDF() {
    setIsPdfLoading(true);
    try {
      toast.info("Gerando PDF...");
      const markdownFinal = parecerEditado.trim() || parecerOriginal;
      const revisadoPor = revisadoPorNome.trim()
        ? { nome: revisadoPorNome.trim(), oab: revisadoPorOab.trim() || undefined }
        : undefined;
      const res = await fetch("/api/export/parecer-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parecerMarkdown: markdownFinal, protocolo, revisadoPor }),
      });
      if (!res.ok) throw new Error("Erro ao gerar PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = protocolo
        ? `${filenamePrefix}-${protocolo}.pdf`
        : `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF gerado com sucesso!");
    } catch {
      toast.error("Erro ao gerar PDF.");
    } finally {
      setIsPdfLoading(false);
    }
  }

  function restaurarOriginal() {
    if (confirm("Descartar alterações e voltar ao parecer original?")) {
      setParecerEditado(parecerOriginal);
    }
  }

  async function compartilhar(canal: "email" | "whatsapp") {
    setIsShareLoading(true);
    try {
      toast.info("Gerando link de compartilhamento...");
      const markdownFinal = parecerEditado.trim() || parecerOriginal;
      const revisadoPor = revisadoPorNome.trim()
        ? { nome: revisadoPorNome.trim(), oab: revisadoPorOab.trim() || undefined }
        : undefined;
      const res = await fetch("/api/export/parecer-pdf/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parecerMarkdown: markdownFinal, protocolo, revisadoPor }),
      });
      if (!res.ok) throw new Error("Erro ao gerar link");
      const { url } = await res.json();
      const assunto = encodeURIComponent("Parecer Técnico");
      const corpo = encodeURIComponent(`Segue o parecer técnico em PDF:\n\n${url}`);
      if (canal === "email") {
        window.open(`mailto:?subject=${assunto}&body=${corpo}`, "_blank");
      } else {
        window.open(`https://wa.me/?text=${corpo}`, "_blank");
      }
      toast.success("Link de compartilhamento gerado!");
    } catch {
      toast.error("Erro ao gerar link de compartilhamento.");
    } finally {
      setIsShareLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Revisão profissional */}
      <Card className="border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4 text-blue-600" /> Revisão profissional
          </CardTitle>
          <CardDescription>
            Identifique o(a) advogado(a) responsável pela revisão. O nome será incluído no PDF
            exportado, indicando quem assume a responsabilidade técnica pelo parecer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="revisadoPorNome">Nome do(a) advogado(a)</Label>
              <Input
                id="revisadoPorNome"
                type="text"
                placeholder="Ex: Dra. Maria Silva"
                value={revisadoPorNome}
                onChange={(e) => setRevisadoPorNome(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="revisadoPorOab">OAB (opcional)</Label>
              <Input
                id="revisadoPorOab"
                type="text"
                placeholder="Ex: SP 123.456"
                value={revisadoPorOab}
                onChange={(e) => setRevisadoPorOab(e.target.value)}
              />
            </div>
          </div>
          {!revisadoPorNome.trim() && (
            <p className="text-xs text-muted-foreground mt-3 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Sem identificação do revisor, o PDF sairá sem o bloco "Revisado por".
            </p>
          )}
        </CardContent>
      </Card>

      {/* Editor + Visualizador */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-row items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">Parecer Técnico</CardTitle>
              <CardDescription>
                {edicaoAtiva
                  ? "Edite em Markdown — # para títulos, ** para negrito, - para listas"
                  : "Revise e edite antes de exportar — você é responsável pelo conteúdo final"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {edicaoAtiva ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={restaurarOriginal}
                    className="flex items-center gap-2"
                    disabled={!parecerFoiEditado}
                  >
                    <RotateCcw className="h-4 w-4" /> Restaurar original
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEdicaoAtiva(false)}
                    className="flex items-center gap-2"
                  >
                    <Eye className="h-4 w-4" /> Pré-visualizar
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEdicaoAtiva(true)}
                  className="flex items-center gap-2"
                >
                  <Pencil className="h-4 w-4" /> Editar
                </Button>
              )}
              <Button
                variant="default"
                size="sm"
                disabled={isPdfLoading}
                onClick={exportPDF}
                className="flex items-center gap-2"
              >
                {isPdfLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Gerando...</>
                ) : (
                  <><Download className="h-4 w-4" /> Exportar PDF</>
                )}
              </Button>
              {habilitarCompartilhamento && (
                <>
                  <div className="h-4 w-px bg-border hidden sm:block" />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isShareLoading}
                    onClick={() => compartilhar("email")}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {isShareLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Mail className="h-4 w-4" /> E-mail</>}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isShareLoading}
                    onClick={() => compartilhar("whatsapp")}
                    className="text-muted-foreground hover:text-green-600 dark:hover:text-green-400 flex items-center gap-1"
                  >
                    {isShareLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Share2 className="h-4 w-4" /> WhatsApp</>}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {edicaoAtiva ? (
            <Textarea
              value={parecerEditado}
              onChange={(e) => setParecerEditado(e.target.value)}
              className="min-h-[600px] font-mono text-xs leading-relaxed"
              spellCheck={true}
            />
          ) : (
            <ScrollArea className="h-[600px] pr-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Streamdown>{parecerEditado || parecerOriginal}</Streamdown>
              </div>
            </ScrollArea>
          )}
          {parecerFoiEditado && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-3 flex items-center gap-1.5">
              <Pencil className="h-3 w-3" /> Parecer modificado em relação ao original gerado pelo sistema.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
