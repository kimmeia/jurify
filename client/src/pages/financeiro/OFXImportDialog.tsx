/**
 * Diálogo de importação OFX → conciliação bancária.
 * Fluxo:
 *  1. User seleciona arquivo .OFX
 *  2. Backend parseia e sugere matches com despesas/cobranças pendentes
 *  3. UI mostra preview com checkbox por transação (já marca match exato)
 *  4. User confirma → backend marca paga/recebida cada match selecionado
 */

import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  FileUp,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "./helpers";

interface CandidatoMatch {
  id: number;
  tipo: "despesa" | "cobranca";
  descricao: string;
  valor: number;
  vencimento: string;
  diffDias: number;
}
interface SugestaoConciliacao {
  transacao: {
    fitid: string;
    data: string;
    valor: number;
    descricao: string;
    tipo: string;
  };
  candidatos: CandidatoMatch[];
  /** Quando true, esta transação já foi conciliada antes (mesmo FITID). */
  jaImportado?: boolean;
}

export function OFXImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<{
    totalTransacoes: number;
    comMatch: number;
    semMatch: number;
    jaImportadas?: number;
    sugestoes: SugestaoConciliacao[];
  } | null>(null);

  // Por FITID → entidade selecionada (id ou null = ignorar). Default
  // pré-seleciona o melhor candidato (primeiro), se houver match exato.
  const [selecoes, setSelecoes] = useState<Record<string, number | null>>({});

  const previewMut = (trpc as any).financeiro?.importarOFXPreview?.useMutation?.({
    onSuccess: (r: typeof preview) => {
      setPreview(r);
      if (r) {
        // Pré-seleciona melhor candidato em cada transação com match
        // exceto se já foi importada antes (FITID duplicado → cinza)
        const defaults: Record<string, number | null> = {};
        for (const s of r.sugestoes) {
          if (s.jaImportado) {
            defaults[s.transacao.fitid] = null;
          } else {
            defaults[s.transacao.fitid] =
              s.candidatos.length > 0 ? s.candidatos[0].id : null;
          }
        }
        setSelecoes(defaults);
      }
    },
    onError: (err: any) =>
      toast.error("Erro ao processar OFX", { description: err.message }),
  });

  const confirmarMut = (trpc as any).financeiro?.confirmarConciliacaoOFX?.useMutation?.({
    onSuccess: (r: {
      despesasMarcadas: number;
      cobrancasMarcadas: number;
      erros: string[];
    }) => {
      const total = r.despesasMarcadas + r.cobrancasMarcadas;
      if (total > 0) {
        toast.success(
          `${total} ${total === 1 ? "lançamento conciliado" : "lançamentos conciliados"}`,
          {
            description:
              r.erros.length > 0
                ? `${r.erros.length} aviso(s) — confira detalhes na conta`
                : undefined,
          },
        );
        onSuccess();
        onOpenChange(false);
        setPreview(null);
        setSelecoes({});
      } else {
        toast.warning("Nenhum lançamento foi conciliado", {
          description: r.erros[0],
        });
      }
    },
    onError: (err: any) =>
      toast.error("Erro ao conciliar", { description: err.message }),
  });

  async function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const conteudo = await file.text();
    previewMut?.mutate?.({ conteudo });
  }

  function confirmar() {
    if (!preview) return;
    const matches = preview.sugestoes
      .map((s) => {
        if (s.jaImportado) return null;
        const id = selecoes[s.transacao.fitid];
        if (!id) return null;
        const cand = s.candidatos.find((c) => c.id === id);
        if (!cand) return null;
        return {
          fitid: s.transacao.fitid,
          tipo: cand.tipo,
          entidadeId: cand.id,
          dataPagamento: s.transacao.data,
          valor: Math.abs(s.transacao.valor),
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (matches.length === 0) {
      toast.warning("Nenhuma transação selecionada");
      return;
    }
    confirmarMut?.mutate?.({ matches });
  }

  const matchesSelecionados = preview
    ? Object.values(selecoes).filter((v) => v !== null).length
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Importar extrato bancário (OFX)</DialogTitle>
          <DialogDescription>
            Conciliação automática: cada transação do extrato é comparada com
            suas despesas/cobranças pendentes. Você confirma quais marcam como
            pagas/recebidas.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <FileUp className="h-12 w-12 text-muted-foreground/40" />
            <div className="text-center space-y-1">
              <p className="text-sm">Selecione o arquivo .OFX do seu banco</p>
              <p className="text-xs text-muted-foreground">
                Itaú, Bradesco, Santander, Caixa, NuBank — todos exportam OFX
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ofx,application/x-ofx"
              className="hidden"
              onChange={handleArquivo}
              disabled={previewMut?.isPending}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={previewMut?.isPending}
            >
              {previewMut?.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {previewMut?.isPending ? "Processando..." : "Escolher arquivo"}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded border bg-card p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Transações
                </p>
                <p className="text-xl font-semibold">{preview.totalTransacoes}</p>
              </div>
              <div className="rounded border bg-emerald-50 dark:bg-emerald-950/20 p-3">
                <p className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  Com match
                </p>
                <p className="text-xl font-semibold text-emerald-700 dark:text-emerald-300">
                  {preview.comMatch}
                </p>
              </div>
              <div className="rounded border bg-amber-50 dark:bg-amber-950/20 p-3">
                <p className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Sem match
                </p>
                <p className="text-xl font-semibold text-amber-700 dark:text-amber-300">
                  {preview.semMatch}
                </p>
              </div>
              <div className="rounded border bg-muted/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Já importadas
                </p>
                <p className="text-xl font-semibold text-muted-foreground">
                  {preview.jaImportadas ?? 0}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto rounded border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">Descrição</TableHead>
                    <TableHead className="text-xs text-right">Valor</TableHead>
                    <TableHead className="text-xs">Match sugerido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sugestoes.map((s) => {
                    const ehEntrada = s.transacao.valor > 0;
                    const selecionado = selecoes[s.transacao.fitid];
                    return (
                      <TableRow
                        key={s.transacao.fitid}
                        className={s.jaImportado ? "opacity-50" : ""}
                      >
                        <TableCell className="px-2">
                          {ehEntrada ? (
                            <ArrowDownCircle className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <ArrowUpCircle className="h-4 w-4 text-red-600" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {s.transacao.data.split("-").reverse().join("/")}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="truncate max-w-xs" title={s.transacao.descricao}>
                            {s.transacao.descricao}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums font-medium">
                          {formatBRL(s.transacao.valor)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {s.jaImportado ? (
                            <span className="text-muted-foreground italic flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Já importada
                            </span>
                          ) : s.candidatos.length === 0 ? (
                            <span className="text-amber-700 dark:text-amber-400 italic flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> Sem match
                            </span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Input
                                type="checkbox"
                                checked={selecionado !== null && selecionado !== undefined}
                                onChange={(e) =>
                                  setSelecoes((prev) => ({
                                    ...prev,
                                    [s.transacao.fitid]: e.target.checked
                                      ? s.candidatos[0].id
                                      : null,
                                  }))
                                }
                                className="h-3.5 w-3.5 cursor-pointer"
                              />
                              <select
                                value={selecionado ?? ""}
                                onChange={(e) =>
                                  setSelecoes((prev) => ({
                                    ...prev,
                                    [s.transacao.fitid]: e.target.value
                                      ? parseInt(e.target.value)
                                      : null,
                                  }))
                                }
                                className="text-xs border rounded px-1 py-0.5 bg-background max-w-[300px] truncate"
                              >
                                <option value="">— ignorar —</option>
                                {s.candidatos.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.descricao} ({formatBRL(c.valor)}, venc{" "}
                                    {c.vencimento.split("-").reverse().slice(0, 2).join("/")})
                                  </option>
                                ))}
                              </select>
                              {selecionado !== null && selecionado !== undefined && (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          {preview && (
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null);
                setSelecoes({});
              }}
            >
              <X className="h-4 w-4 mr-2" /> Outro arquivo
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {preview && (
            <Button
              onClick={confirmar}
              disabled={matchesSelecionados === 0 || confirmarMut?.isPending}
            >
              {confirmarMut?.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Conciliar {matchesSelecionados}{" "}
              {matchesSelecionados === 1 ? "lançamento" : "lançamentos"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
