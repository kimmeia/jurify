/**
 * O que está guardado da assinatura de um documento.
 *
 * Nome, CPF, IP, data e o desenho ficam gravados desde sempre e não
 * apareciam em lugar nenhum: quem olhava a ficha via só o selo e tinha que
 * adivinhar, pelo ícone de download que faltava, se havia comprovante. Aqui
 * a pergunta "esse documento foi mesmo assinado?" se responde olhando.
 */
import { Loader2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { EXPLICACAO_ESTADO, ROTULO_ESTADO, estadoDaAssinatura } from "@shared/assinatura-estado";

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 border-b py-1.5 text-xs last:border-b-0">
      <span className="font-semibold text-muted-foreground">{rotulo}</span>
      <span className="break-words">{children}</span>
    </div>
  );
}

export function DadosDaAssinaturaDialog({
  assinaturaId,
  onOpenChange,
}: {
  assinaturaId: number | null;
  onOpenChange: (aberto: boolean) => void;
}) {
  const { data, isLoading } = (trpc as any).assinaturas.dadosDaAssinatura.useQuery(
    { id: assinaturaId ?? 0 },
    { enabled: !!assinaturaId, retry: false },
  );

  const estado = data
    ? estadoDaAssinatura({
        status: data.status,
        assinadoAt: data.assinadoAt,
        assinaturaImagemUrl: data.assinaturaImagemUrl,
        ipAssinatura: data.ipAssinatura,
        documentoAssinadoUrl: data.documentoAssinadoUrl,
        comprovanteErro: data.comprovanteErro,
        documentoExterno: data.documentoExterno,
      })
    : null;

  return (
    <Dialog open={!!assinaturaId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Dados da assinatura</DialogTitle>
          <DialogDescription className="text-xs">
            {data?.titulo || "Carregando…"}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        )}

        {!isLoading && !data && (
          <p className="py-6 text-center text-xs text-muted-foreground">Não foi possível abrir este documento.</p>
        )}

        {data && estado && (
          <div data-testid="dados-da-assinatura">
            <p className="mb-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs leading-snug">
              <b>{ROTULO_ESTADO[estado]}</b> — {EXPLICACAO_ESTADO[estado]}
            </p>
            <Linha rotulo="Assinou">{data.assinantNome || <i className="text-danger-fg">sem registro</i>}</Linha>
            <Linha rotulo="CPF">{data.assinanteCpf || <span className="text-muted-foreground">não informado</span>}</Linha>
            <Linha rotulo="Data e hora">
              {data.assinadoAt
                ? new Date(data.assinadoAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
                : <i className="text-danger-fg">sem registro</i>}
            </Linha>
            <Linha rotulo="IP">{data.ipAssinatura || <i className="text-danger-fg">sem registro</i>}</Linha>
            <Linha rotulo="Desenho">
              {data.assinaturaImagemUrl ? (
                <img src={data.assinaturaImagemUrl} alt="Assinatura desenhada pelo cliente" className="max-h-16 rounded border bg-card p-1" />
              ) : (
                <i className="text-danger-fg">sem registro</i>
              )}
            </Linha>
            <Linha rotulo="Comprovante">
              {data.documentoAssinadoUrl ? (
                <a href={data.documentoAssinadoUrl} target="_blank" rel="noreferrer" className="text-info-fg underline">
                  baixar PDF assinado
                </a>
              ) : data.comprovanteErro ? (
                <span className="text-warning-fg">não gerado — {data.comprovanteErro}</span>
              ) : (
                <span className="text-muted-foreground">não gerado</span>
              )}
            </Linha>
            {(!data.temDesenhoAssinatura && !data.temIpAssinatura && data.status === "assinado") && (
              <p className="mt-3 rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-xs leading-snug text-danger-fg">
                Este documento está marcado como assinado e <b>não tem nenhum vestígio de quem assinou</b>.
                Não use como prova: confira com o cliente antes.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
