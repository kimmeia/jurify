/**
 * Escolha das colunas antes de gerar o PDF de cards.
 *
 * O botão baixava o funil inteiro. Num quadro onde "Encerrado" sozinho
 * carrega mais cards que todo o resto, isso torna o PDF inútil pro uso real
 * — imprimir o recorte em que se está trabalhando.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Download, Loader2, TriangleAlert } from "lucide-react";

export type ColunaExport = { id: number; nome: string; total: number };

export function ExportarPdfDialog({
  open,
  onClose,
  funilNome,
  colunas,
  gerando,
  onExportar,
}: {
  open: boolean;
  onClose: () => void;
  funilNome: string;
  colunas: ColunaExport[];
  gerando: boolean;
  onExportar: (colunasIds: number[]) => void;
}) {
  const [marcadas, setMarcadas] = useState<number[]>([]);
  const aberto = useRef(false);

  // Só na ABERTURA, e é por isso que existe o ref. O quadro faz polling de 5s;
  // com `colunas` na lista de dependências, cada refetch trocava a identidade
  // do array, o efeito rodava de novo e remarcava tudo — a coluna que a pessoa
  // acabou de desmarcar voltava sozinha segundos depois.
  useEffect(() => {
    if (!open) {
      aberto.current = false;
      return;
    }
    if (aberto.current) return;
    aberto.current = true;
    setMarcadas(colunas.map((c) => c.id));
  }, [open, colunas]);

  const selecionadas = useMemo(
    () => colunas.filter((c) => marcadas.includes(c.id)),
    [colunas, marcadas],
  );
  const totalCards = selecionadas.reduce((s, c) => s + c.total, 0);

  const alternar = (id: number) =>
    setMarcadas((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Exportar cards em PDF</DialogTitle>
          <DialogDescription>
            Funil <b className="text-foreground">{funilNome}</b>
          </DialogDescription>
        </DialogHeader>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
              Colunas no PDF
            </p>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px] font-bold text-muted-foreground"
                onClick={() => setMarcadas(colunas.map((c) => c.id))}
              >
                Todas
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px] font-bold text-muted-foreground"
                onClick={() => setMarcadas([])}
              >
                Nenhuma
              </Button>
            </div>
          </div>

          <div className="rounded-lg border divide-y overflow-hidden max-h-[320px] overflow-y-auto">
            {colunas.map((c) => {
              const on = marcadas.includes(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 px-3 h-[42px] cursor-pointer ${
                    on ? "bg-violet-50 dark:bg-violet-950/40" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() => alternar(c.id)}
                  />
                  <span
                    className={`h-[18px] w-[18px] rounded-[5px] border-2 shrink-0 flex items-center justify-center ${
                      on
                        ? "bg-violet-600 border-violet-600 text-white"
                        : "border-border bg-card"
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span
                    className={`text-[13px] font-semibold flex-1 truncate ${
                      on ? "text-violet-900 dark:text-violet-200" : ""
                    }`}
                  >
                    {c.nome}
                  </span>
                  <span
                    className={`text-[11.5px] tabular-nums shrink-0 ${
                      on
                        ? "font-bold text-violet-700 dark:text-violet-300"
                        : "text-muted-foreground"
                    }`}
                  >
                    {c.total} {c.total === 1 ? "card" : "cards"}
                  </span>
                </label>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground leading-snug mt-2.5">
            A contagem já considera os filtros e a busca do quadro. No PDF cada coluna vira
            um bloco com seu subtotal, na ordem do quadro, e dentro dele os cards saem do
            cadastro mais recente para o mais antigo.
          </p>
        </div>

        <DialogFooter className="sm:justify-start gap-3">
          {marcadas.length === 0 ? (
            <p className="text-[12px] flex-1 font-semibold text-amber-700 inline-flex items-center gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5" />
              Marque uma coluna
            </p>
          ) : (
            <p className="text-[12px] flex-1">
              <b className="tabular-nums">{selecionadas.length}</b> de {colunas.length} colunas
              <span className="text-muted-foreground"> · </span>
              <b className="tabular-nums text-violet-700 dark:text-violet-300">{totalCards}</b>{" "}
              cards
            </p>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={marcadas.length === 0 || gerando}
            onClick={() => onExportar(marcadas)}
          >
            {gerando ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1.5" />
            )}
            Baixar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
