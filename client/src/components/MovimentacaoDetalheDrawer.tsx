/**
 * Drawer com detalhe de uma movimentação processual.
 *
 * Renderizado pelo NotificacoesSino quando o usuário clica numa notif
 * `tipo='movimentacao'` que tem `eventoId`. Mostra o texto completo da
 * mov + dados do monitoramento (apelido, CNJ, tribunal, data real
 * extraída do PJe — não a de detecção pelo cron).
 *
 * PR 3 vai adicionar botões de "Criar prazo" e "Criar tarefa"
 * pré-preenchidos com dados da mov.
 */
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Clock, FileText, User, Loader2 } from "lucide-react";

interface Props {
  eventoId: number | null;
  onClose: () => void;
}

const TIPO_LABEL: Record<string, string> = {
  lawsuit_cnj: "Processo",
  cpf: "CPF",
  cnpj: "CNPJ",
};

export default function MovimentacaoDetalheDrawer({ eventoId, onClose }: Props) {
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = trpc.notificacoes.detalheEvento.useQuery(
    { eventoId: eventoId ?? 0 },
    { enabled: eventoId !== null && eventoId > 0, retry: false },
  );

  const open = eventoId !== null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Detalhe da movimentação</SheetTitle>
          <SheetDescription>
            Movimentação detectada pelo monitoramento automático.
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="px-4 py-6 space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error ? (
          <div className="px-4 py-6 text-sm text-destructive">
            Não foi possível carregar: {error.message}
          </div>
        ) : data ? (
          <div className="px-4 py-4 space-y-4">
            {/* Cliente monitorado */}
            <section className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <User className="h-3 w-3" /> Cliente monitorado
              </p>
              <p className="text-sm font-medium">
                {data.apelido || data.searchKey || "(sem apelido)"}
              </p>
              {data.searchType && (
                <Badge variant="outline" className="text-[9px]">
                  {TIPO_LABEL[data.searchType] || data.searchType}: {data.searchKey}
                </Badge>
              )}
            </section>

            {/* CNJ + tribunal */}
            <section className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Processo
              </p>
              <p className="text-sm font-mono">{data.cnjAfetado || "—"}</p>
              {data.tribunal && (
                <Badge variant="outline" className="text-[9px] uppercase">
                  {data.tribunal}
                </Badge>
              )}
            </section>

            {/* Data real */}
            <section className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> Data da movimentação
              </p>
              <p className="text-sm">
                {new Date(data.dataEvento).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </p>
            </section>

            {/* Conteúdo */}
            <section className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> Texto da movimentação
              </p>
              <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                {data.conteudo}
              </div>
            </section>

            {/* Ações */}
            <section className="flex flex-col gap-2 pt-2">
              {data.monitoramentoId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLocation(`/processos?tab=movimentacoes`);
                    onClose();
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Ver monitoramento completo
                </Button>
              )}
              {/* PR 3: botões "Criar prazo" e "Criar tarefa" entram aqui */}
            </section>
          </div>
        ) : eventoId !== null ? (
          <div className="px-4 py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
