/**
 * Componente compartilhado de anexos pra despesas e cobranças.
 * Mostra lista atual + upload de novos. Usa as procedures
 * `anexarArquivo`, `listarAnexos`, `obterUrlDownloadAnexo`, `excluirAnexo`.
 */

import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useFinanceiroPerms } from "./helpers";

const MIME_PERMITIDOS = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/xml",
  "text/xml",
]);
const TAMANHO_MAX_BYTES = 5 * 1024 * 1024;

function iconePorMime(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon className="h-3.5 w-3.5" />;
  return <FileText className="h-3.5 w-3.5" />;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Lê arquivo do <input type="file"> e devolve base64 (sem prefixo data:). */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",", 2)[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

export function AnexosFinanceiro({
  tipoEntidade,
  entidadeId,
}: {
  tipoEntidade: "despesa" | "cobranca";
  entidadeId: number;
}) {
  const perms = useFinanceiroPerms();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const utils = trpc.useUtils();

  const { data: anexos = [], isLoading } = (trpc as any).financeiro?.listarAnexos?.useQuery?.(
    { tipoEntidade, entidadeId },
    { retry: false, enabled: entidadeId > 0 },
  ) || { data: [], isLoading: false };

  const anexarMut = (trpc as any).financeiro?.anexarArquivo?.useMutation?.({
    onSuccess: () => {
      toast.success("Anexo enviado");
      (utils as any).financeiro?.listarAnexos?.invalidate?.({ tipoEntidade, entidadeId });
    },
    onError: (err: any) =>
      toast.error("Erro ao enviar anexo", { description: err.message }),
  });
  const excluirMut = (trpc as any).financeiro?.excluirAnexo?.useMutation?.({
    onSuccess: () => {
      toast.success("Anexo removido");
      (utils as any).financeiro?.listarAnexos?.invalidate?.({ tipoEntidade, entidadeId });
    },
    onError: (err: any) =>
      toast.error("Erro ao remover anexo", { description: err.message }),
  });
  const urlMut = (trpc as any).financeiro?.obterUrlDownloadAnexo?.useMutation?.({
    onSuccess: (r: { url: string; filename: string }) => {
      // Abre em nova aba — browser decide preview vs download por content-type
      window.open(r.url, "_blank", "noopener,noreferrer");
    },
    onError: (err: any) =>
      toast.error("Erro ao gerar link", { description: err.message }),
  });

  async function handleArquivoSelecionado(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // limpa pra permitir reupload do mesmo arquivo
    if (!file) return;

    if (!MIME_PERMITIDOS.has(file.type)) {
      toast.error("Tipo de arquivo não suportado", {
        description: "Aceitos: PDF, PNG, JPG, WEBP, XML.",
      });
      return;
    }
    if (file.size > TAMANHO_MAX_BYTES) {
      toast.error("Arquivo grande demais", {
        description: `${(file.size / 1024 / 1024).toFixed(1)}MB > 5MB`,
      });
      return;
    }

    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      await anexarMut?.mutateAsync?.({
        tipoEntidade,
        entidadeId,
        filename: file.name,
        mimeType: file.type,
        conteudoBase64: base64,
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          Anexos
          {anexos.length > 0 && (
            <span className="text-[10px] tabular-nums">({anexos.length})</span>
          )}
        </div>
        {perms.podeCriar && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.xml,application/pdf,image/*,application/xml,text/xml"
              className="hidden"
              onChange={handleArquivoSelecionado}
              disabled={uploading}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={uploading || entidadeId <= 0}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Upload className="h-3 w-3 mr-1" />
              )}
              {uploading ? "Enviando..." : "Anexar"}
            </Button>
          </>
        )}
      </div>

      {isLoading ? (
        <div className="text-[11px] text-muted-foreground italic">Carregando...</div>
      ) : anexos.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic">
          Nenhum anexo. Adicione boletos, recibos ou notas fiscais.
        </div>
      ) : (
        <ul className="space-y-1">
          {anexos.map((a: any) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1 text-xs"
            >
              <span className="text-muted-foreground shrink-0">
                {iconePorMime(a.mimeType)}
              </span>
              <span className="flex-1 truncate" title={a.filename}>
                {a.filename}
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {formatBytes(a.tamanhoBytes)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => urlMut?.mutate?.({ id: a.id })}
                disabled={urlMut?.isPending}
                title="Baixar"
              >
                <Download className="h-3 w-3" />
              </Button>
              {perms.podeExcluir && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-destructive"
                  onClick={() => {
                    if (confirm(`Remover "${a.filename}"?`)) {
                      excluirMut?.mutate?.({ id: a.id });
                    }
                  }}
                  disabled={excluirMut?.isPending}
                  title="Remover"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
