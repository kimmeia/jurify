/**
 * Aba "Relatórios" do módulo Financeiro — DRE por período + export.
 * Receitas e despesas agrupadas por categoria, resultado líquido e margem.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Download,
  FileText,
  Loader2,
  Receipt,
  Search,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "./helpers";

function inicioDoMesIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function fimDoMesIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
}

function presetParaRange(preset: "1m" | "3m" | "6m" | "12m"): {
  inicio: string;
  fim: string;
} {
  const meses = preset === "1m" ? 1 : preset === "3m" ? 3 : preset === "6m" ? 6 : 12;
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - 1), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  return {
    inicio: inicio.toISOString().slice(0, 10),
    fim: fim.toISOString().slice(0, 10),
  };
}

function baixarBlob(content: string | Blob, filename: string, mimeType: string) {
  const blob =
    typeof content === "string" ? new Blob([content], { type: mimeType }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

/** Converte base64 → Blob no navegador (sem libs externas). */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export function RelatoriosTab() {
  const [preset, setPreset] = useState<"1m" | "3m" | "6m" | "12m" | "custom">("1m");
  const [dataInicio, setDataInicio] = useState(inicioDoMesIso());
  const [dataFim, setDataFim] = useState(fimDoMesIso());
  const [diagnosticoOpen, setDiagnosticoOpen] = useState(false);

  // Sincroniza datas com preset quando preset muda (não-custom)
  function aplicarPreset(p: typeof preset) {
    setPreset(p);
    if (p !== "custom") {
      const r = presetParaRange(p);
      setDataInicio(r.inicio);
      setDataFim(r.fim);
    }
  }

  const dreQ = (trpc as any).financeiro?.dre?.useQuery?.(
    { dataInicio, dataFim },
    { retry: false, enabled: dataInicio.length === 10 && dataFim.length === 10 },
  );
  const dre = dreQ?.data;

  // KPIs com discriminação por situação de prazo — usa o mesmo range como
  // período de pagamento E de vencimento, pra separar no prazo / atraso /
  // adiantado e dar a ponte com o painel Asaas (por vencimento).
  const kpisQ = (trpc as any).asaas?.kpis?.useQuery?.(
    {
      pagamentoInicio: dataInicio,
      pagamentoFim: dataFim,
      vencimentoInicio: dataInicio,
      vencimentoFim: dataFim,
    },
    { retry: false, enabled: dataInicio.length === 10 && dataFim.length === 10 },
  );
  const kpis = kpisQ?.data;

  const csvMut = (trpc as any).financeiro?.exportarDreCsv?.useMutation?.({
    onSuccess: (r: { filename: string; content: string; mimeType: string }) => {
      baixarBlob(r.content, r.filename, r.mimeType);
      toast.success("CSV baixado");
    },
    onError: (err: any) =>
      toast.error("Erro ao exportar CSV", { description: err.message }),
  });
  const pdfMut = (trpc as any).financeiro?.exportarDrePdf?.useMutation?.({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => {
      const blob = base64ToBlob(r.base64, r.mimeType);
      baixarBlob(blob, r.filename, r.mimeType);
      toast.success("PDF baixado");
    },
    onError: (err: any) =>
      toast.error("Erro ao exportar PDF", { description: err.message }),
  });

  const resultado = dre?.resultadoLiquido ?? 0;
  const positivo = resultado >= 0;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-end gap-3 flex-wrap">
            <Tabs value={preset} onValueChange={(v) => aplicarPreset(v as any)}>
              <TabsList className="h-8">
                <TabsTrigger value="1m" className="text-xs px-3">
                  Mês atual
                </TabsTrigger>
                <TabsTrigger value="3m" className="text-xs px-3">
                  3m
                </TabsTrigger>
                <TabsTrigger value="6m" className="text-xs px-3">
                  6m
                </TabsTrigger>
                <TabsTrigger value="12m" className="text-xs px-3">
                  12m
                </TabsTrigger>
                <TabsTrigger value="custom" className="text-xs px-3">
                  Custom
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {preset === "custom" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">De</Label>
                  <Input
                    type="date"
                    value={dataInicio}
                    onChange={(e) => setDataInicio(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Até</Label>
                  <Input
                    type="date"
                    value={dataFim}
                    onChange={(e) => setDataFim(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </>
            )}
            <div className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => csvMut?.mutate?.({ dataInicio, dataFim })}
              disabled={!dre || csvMut?.isPending}
            >
              {csvMut?.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1.5" />
              )}
              CSV
            </Button>
            <Button
              size="sm"
              onClick={() => pdfMut?.mutate?.({ dataInicio, dataFim })}
              disabled={!dre || pdfMut?.isPending}
            >
              {pdfMut?.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5 mr-1.5" />
              )}
              PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDiagnosticoOpen(true)}
              disabled={!dre}
              title="Quebra o número 'Caixa Asaas' por status e mostra cobranças nas bordas — pra você identificar se a divergência com o painel Asaas vem de RECEIVED_IN_CASH (pagamento manual) ou timezone (cobrança paga 21h-23h do último dia do mês anterior)"
            >
              <Search className="h-3.5 w-3.5 mr-1.5" />
              Diagnosticar divergência
            </Button>
          </div>
        </CardContent>
      </Card>

      <DiagnosticoDivergenciaDialog
        open={diagnosticoOpen}
        onClose={() => setDiagnosticoOpen(false)}
        dataInicio={dataInicio}
        dataFim={dataFim}
      />

      {dreQ?.isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {dre && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <DreKpi
              icon={<TrendingUp className="h-4 w-4" />}
              label="Receita total"
              valor={dre.receitas.total}
              accent="text-emerald-600"
            />
            <DreKpi
              icon={<TrendingDown className="h-4 w-4" />}
              label="Despesa total"
              valor={dre.despesas.total}
              accent="text-red-600"
            />
            <DreKpi
              icon={<Wallet className="h-4 w-4" />}
              label="Resultado líquido"
              valor={resultado}
              accent={positivo ? "text-emerald-600" : "text-red-600"}
              destaque
            />
            <DreKpi
              icon={<Receipt className="h-4 w-4" />}
              label="Margem"
              valor={null}
              textoCustom={
                isNaN(dre.margemPercent)
                  ? "—"
                  : `${dre.margemPercent.toFixed(1)}%`
              }
              accent={positivo ? "text-emerald-600" : "text-red-600"}
            />
          </div>

          {/* Recebido: caixa real + discriminação de prazo + ponte Asaas */}
          {kpis && (kpis.recebido > 0 || kpis.recebidoComVencimentoNoPeriodo > 0) && (
            <RecebidoPorPrazoSection kpis={kpis} />
          )}

          {/* Tabela receitas */}
          <DreSection
            titulo="Receitas — por categoria"
            total={dre.receitas.total}
            categorias={dre.receitas.porCategoria}
            accent="emerald"
          />

          {/* Quebra adicional das receitas: Caixa Asaas vs Caixa Escritório */}
          {dre.receitas.porOrigem && dre.receitas.porOrigem.length > 0 && (
            <DreSectionDimensao
              titulo="Receitas — por origem (de onde veio)"
              total={dre.receitas.total}
              linhas={dre.receitas.porOrigem}
              colunaLabel="Origem"
              accent="emerald"
            />
          )}

          {/* Quebra por forma de pagamento (Pix/Cartão/Dinheiro/etc) */}
          {dre.receitas.porFormaPagamento && dre.receitas.porFormaPagamento.length > 0 && (
            <DreSectionDimensao
              titulo="Receitas — por forma de pagamento"
              total={dre.receitas.total}
              linhas={dre.receitas.porFormaPagamento}
              colunaLabel="Forma"
              accent="emerald"
            />
          )}

          {/* Tabela despesas */}
          <DreSection
            titulo="Despesas"
            total={dre.despesas.total}
            categorias={dre.despesas.porCategoria}
            accent="red"
          />
        </>
      )}
    </div>
  );
}

function DreSectionDimensao({
  titulo,
  total,
  linhas,
  colunaLabel,
  accent,
}: {
  titulo: string;
  total: number;
  linhas: Array<{
    chave: string;
    nome: string;
    total: number;
    count: number;
    percentual: number;
  }>;
  colunaLabel: string;
  accent: "emerald" | "red";
}) {
  const accentClass =
    accent === "emerald" ? "text-emerald-600" : "text-red-600";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`text-sm flex items-center gap-2 ${accentClass}`}>
          {accent === "emerald" ? (
            <TrendingUp className="h-4 w-4" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          )}
          {titulo}
          <span className="ml-auto font-mono text-base tabular-nums">
            {formatBRL(total)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {linhas.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            Sem lançamentos no período.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{colunaLabel}</TableHead>
                <TableHead className="text-xs text-right">Qtd</TableHead>
                <TableHead className="text-xs text-right">% da seção</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.chave}>
                  <TableCell className="text-xs">{l.nome}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {l.count}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {l.percentual.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums font-medium">
                    {formatBRL(l.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function DreKpi({
  icon,
  label,
  valor,
  accent,
  destaque,
  textoCustom,
}: {
  icon: React.ReactNode;
  label: string;
  valor: number | null;
  accent?: string;
  destaque?: boolean;
  /** Quando preenchido, mostra esse texto em vez de formatBRL(valor). */
  textoCustom?: string;
}) {
  return (
    <Card className={destaque ? "border-primary/40" : ""}>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span className={accent ?? ""}>{icon}</span>
          {label}
        </div>
        <p className={`text-xl font-semibold mt-1 ${accent ?? ""}`}>
          {textoCustom ?? (valor !== null ? formatBRL(valor) : "—")}
        </p>
      </CardContent>
    </Card>
  );
}

function DreSection({
  titulo,
  total,
  categorias,
  accent,
}: {
  titulo: string;
  total: number;
  categorias: Array<{
    categoriaId: number | null;
    categoriaNome: string;
    total: number;
    count: number;
    percentual: number;
  }>;
  accent: "emerald" | "red";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-600"
      : "text-red-600";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`text-sm flex items-center gap-2 ${accentClass}`}>
          {accent === "emerald" ? (
            <TrendingUp className="h-4 w-4" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          )}
          {titulo}
          <span className="ml-auto font-mono text-base tabular-nums">
            {formatBRL(total)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {categorias.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            Sem lançamentos no período.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Categoria</TableHead>
                <TableHead className="text-xs text-right">Qtd</TableHead>
                <TableHead className="text-xs text-right">% da seção</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categorias.map((cat) => (
                <TableRow key={String(cat.categoriaId ?? "null")}>
                  <TableCell className="text-xs">
                    {cat.categoriaId === null ? (
                      <span className="italic text-muted-foreground">
                        {cat.categoriaNome}
                      </span>
                    ) : (
                      cat.categoriaNome
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {cat.count}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {cat.percentual.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums font-medium">
                    {formatBRL(cat.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Dialog de diagnóstico de divergência entre "Caixa Asaas" (Jurify) e o
 * card "Recebidos" do painel Asaas. Mostra 3 cortes:
 *  1. Total por status pago — RECEIVED_IN_CASH (suspeito #1) é dinheiro
 *     marcado como recebido FORA do Asaas — painel Asaas pode excluir
 *     do "Recebidos" porque não caiu na conta.
 *  2. Lista detalhada de RECEIVED_IN_CASH — se a soma desses bate com
 *     a diferença observada, hipótese A confirmada.
 *  3. Cobranças nas BORDAS do período (±2 dias) — flagra timezone:
 *     pagamento 23h do último dia do mês anterior em UTC vira primeiro
 *     do mês em BRT.
 */
function DiagnosticoDivergenciaDialog({
  open,
  onClose,
  dataInicio,
  dataFim,
}: {
  open: boolean;
  onClose: () => void;
  dataInicio: string;
  dataFim: string;
}) {
  const q = (trpc as any).financeiro?.diagnosticoCaixaAsaas?.useQuery?.(
    { dataInicio, dataFim },
    { enabled: open, retry: false },
  );
  const data = q?.data;

  const compararMut = (trpc as any).financeiro?.compararRecebidoComAsaas?.useMutation?.({
    onError: (err: any) => toast.error("Erro ao comparar", { description: err.message }),
  });
  const comp = compararMut?.data;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Diagnóstico de divergência — Caixa Asaas</DialogTitle>
        </DialogHeader>

        {q?.isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <p className="text-xs text-slate-600">
              Período: <strong>{data.periodo.inicio}</strong> a{" "}
              <strong>{data.periodo.fim}</strong>. Compare cada bloco abaixo
              com o painel Asaas pra identificar a causa da diferença.
            </p>

            {/* Comparação ao vivo com o Asaas */}
            <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 dark:bg-indigo-950/20 p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
                  Comparação ao vivo com o Asaas
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => compararMut?.mutate?.({ dataInicio, dataFim })}
                  disabled={compararMut?.isPending}
                >
                  {compararMut?.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Comparar agora
                </Button>
              </div>
              <p className="text-[11px] text-indigo-800 dark:text-indigo-200 mb-2">
                Consulta o Asaas ao vivo (gasta cota) e cruza cobrança-a-cobrança.
                Identifica as cobranças que o Jurify conta como recebidas mas o
                Asaas não retorna — a causa do bruto estar maior aqui.
              </p>

              {comp && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-indigo-700 dark:text-indigo-300">Asaas (paymentDate)</p>
                      <p className="font-bold tabular-nums">{formatBRL(comp.totalAsaas.value)}</p>
                      <p className="text-[10px] text-slate-500">{comp.totalAsaas.count} cobranças</p>
                    </div>
                    <div>
                      <p className="text-indigo-700 dark:text-indigo-300">Jurify (dataPagamento)</p>
                      <p className="font-bold tabular-nums">{formatBRL(comp.totalJurify.value)}</p>
                      <p className="text-[10px] text-slate-500">{comp.totalJurify.count} cobranças</p>
                    </div>
                    <div>
                      <p className="text-indigo-700 dark:text-indigo-300">Diferença</p>
                      <p className="font-bold tabular-nums text-red-600">{formatBRL(comp.diferenca)}</p>
                    </div>
                  </div>

                  {comp.creditoMesDiferente && comp.creditoMesDiferente.count > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded p-2 text-xs">
                      <p className="font-semibold text-amber-900 dark:text-amber-100">
                        Crédito em mês diferente do pagamento: {comp.creditoMesDiferente.count} cobranças
                        ({formatBRL(comp.creditoMesDiferente.total)})
                      </p>
                      <p className="text-[11px] text-amber-800 dark:text-amber-200 mt-1">
                        Pagas neste mês mas creditadas em outro (boleto D+1 pago no fim do mês).
                        O painel "Recebidas" do Asaas filtra por data de crédito — por isso não
                        conta essas. Se este número bate com a diferença, mistério resolvido.
                      </p>
                    </div>
                  )}

                  {comp.asaasPorStatus && comp.asaasPorStatus.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded p-2">
                      <p className="text-[11px] font-semibold text-indigo-900 dark:text-indigo-100 mb-1">
                        Cobranças da API por status — o painel "Recebidas" do Asaas conta só RECEIVED.
                        RECEIVED_IN_CASH (pago manual) fica de fora lá, mas conta no Caixa Asaas aqui.
                      </p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-[10px]">Status</TableHead>
                            <TableHead className="text-[10px] text-right">Cobranças</TableHead>
                            <TableHead className="text-[10px] text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comp.asaasPorStatus.map((s: any) => (
                            <TableRow key={s.status}>
                              <TableCell className="text-[10px] font-mono">
                                {s.status}
                                {s.status === "RECEIVED_IN_CASH" && (
                                  <span className="ml-1 text-[9px] text-amber-700 bg-amber-50 px-1 rounded">
                                    fora do painel
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-[10px] text-right tabular-nums">{s.count}</TableCell>
                              <TableCell className="text-[10px] text-right tabular-nums">{formatBRL(s.value)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  <div className="text-xs bg-white dark:bg-slate-900 rounded p-2 space-y-1">
                    <p>
                      <strong>{comp.soNoJurify.count}</strong> cobranças só no Jurify
                      (total <strong>{formatBRL(comp.soNoJurify.total)}</strong>) — o
                      Asaas não retornou no período. <strong>Esta é a causa provável.</strong>
                    </p>
                    <p>
                      <strong>{comp.statusDivergente.count}</strong> com status
                      diferente entre Jurify e Asaas.
                    </p>
                    <p>
                      <strong>{comp.soNoAsaas.count}</strong> só no Asaas
                      (total {formatBRL(comp.soNoAsaas.value)}) — Asaas tem como pago
                      mas o Jurify não.
                    </p>
                  </div>

                  {comp.soNoJurify.itens.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-indigo-900 dark:text-indigo-100 mb-1">
                        Cobranças só no Jurify (sobrando)
                      </p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-[10px]">Data pag.</TableHead>
                            <TableHead className="text-[10px]">Status</TableHead>
                            <TableHead className="text-[10px]">Descrição</TableHead>
                            <TableHead className="text-[10px]">ID Asaas</TableHead>
                            <TableHead className="text-[10px] text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comp.soNoJurify.itens.map((c: any) => (
                            <TableRow key={c.id}>
                              <TableCell className="text-[10px]">{c.dataPagamento ?? "—"}</TableCell>
                              <TableCell className="text-[10px] font-mono">{c.status}</TableCell>
                              <TableCell className="text-[10px] max-w-[140px] truncate">{c.descricao ?? "—"}</TableCell>
                              <TableCell className="text-[9px] font-mono text-slate-500">{c.asaasPaymentId ?? "(manual)"}</TableCell>
                              <TableCell className="text-[10px] text-right tabular-nums">{formatBRL(Number(c.valor || 0))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {comp.statusDivergente.itens.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-indigo-900 dark:text-indigo-100 mb-1">
                        Status divergente (Jurify ≠ Asaas)
                      </p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-[10px]">Descrição</TableHead>
                            <TableHead className="text-[10px]">Status Jurify</TableHead>
                            <TableHead className="text-[10px]">Status Asaas</TableHead>
                            <TableHead className="text-[10px] text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comp.statusDivergente.itens.map((d: any) => (
                            <TableRow key={d.row.id}>
                              <TableCell className="text-[10px] max-w-[140px] truncate">{d.row.descricao ?? "—"}</TableCell>
                              <TableCell className="text-[10px] font-mono">{d.row.status}</TableCell>
                              <TableCell className="text-[10px] font-mono text-red-600">{d.statusAsaas}</TableCell>
                              <TableCell className="text-[10px] text-right tabular-nums">{formatBRL(Number(d.row.valor || 0))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </section>

            {data.resumo && (
              <section className="rounded-lg border border-amber-200 bg-amber-50/40 dark:bg-amber-950/20 p-3">
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">
                  Resumo bruto vs líquido (hipótese: taxas Asaas)
                </h3>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-amber-700 dark:text-amber-300">Total bruto (Jurify)</p>
                    <p className="text-base font-bold text-amber-900 dark:text-amber-100 tabular-nums">
                      {formatBRL(data.resumo.totalBruto)}
                    </p>
                  </div>
                  <div>
                    <p className="text-amber-700 dark:text-amber-300">Total líquido (após taxas)</p>
                    <p className="text-base font-bold text-amber-900 dark:text-amber-100 tabular-nums">
                      {formatBRL(data.resumo.totalLiquido)}
                    </p>
                  </div>
                  <div>
                    <p className="text-amber-700 dark:text-amber-300">Taxas (bruto − líquido)</p>
                    <p className="text-base font-bold text-amber-900 dark:text-amber-100 tabular-nums">
                      {formatBRL(data.resumo.totalTaxas)}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-amber-800 dark:text-amber-200 mt-2 leading-relaxed">
                  Se o "Total líquido" bate com o "Recebidos" do painel Asaas, o painel deles mostra
                  valor pós-taxas e nosso "Caixa Asaas" mostra bruto.{" "}
                  {data.resumo.comValorLiquido < data.resumo.totalCount && (
                    <span className="block mt-1 text-amber-700 dark:text-amber-300">
                      ⚠ Apenas {data.resumo.comValorLiquido} de {data.resumo.totalCount} cobranças
                      têm valor líquido preenchido — sync incompleto pode estar mascarando a taxa real.
                    </span>
                  )}
                </p>
              </section>
            )}

            <section>
              <h3 className="text-sm font-semibold text-slate-800 mb-2">
                1. Total por status (Jurify) — bruto vs líquido por forma de pagamento
              </h3>
              <p className="text-[11px] text-slate-500 mb-2">
                Se a soma de <code>RECEIVED_IN_CASH</code> bate com a
                diferença que você está vendo, é hipótese A. Se a coluna "Taxa"
                bate, é hipótese das taxas (Asaas mostra líquido, Jurify mostra bruto).
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Origem</TableHead>
                    <TableHead className="text-xs">Forma</TableHead>
                    <TableHead className="text-xs text-right">Qtd</TableHead>
                    <TableHead className="text-xs text-right">Bruto</TableHead>
                    <TableHead className="text-xs text-right">Líquido</TableHead>
                    <TableHead className="text-xs text-right">Taxa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.porStatus.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-xs text-slate-500 text-center">
                        Sem dados no período.
                      </TableCell>
                    </TableRow>
                  )}
                  {data.porStatus.map((r: any, i: number) => (
                    <TableRow key={`${r.status}-${r.origem}-${r.formaPagamento}-${i}`}>
                      <TableCell className="text-xs font-mono">
                        {r.status}
                        {r.status === "RECEIVED_IN_CASH" && (
                          <span className="ml-1 text-[9px] text-amber-700 bg-amber-50 px-1 rounded">
                            cash
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{r.origem}</TableCell>
                      <TableCell className="text-[11px]">{r.formaPagamento ?? "—"}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {r.count}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {formatBRL(r.valor)}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {formatBRL(r.valorLiquido)}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-medium text-amber-700">
                        {formatBRL(r.taxa)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            {data.saudeValorLiquido && (
              <section className="rounded-lg border border-red-200 bg-red-50/40 dark:bg-red-950/20 p-3">
                <h3 className="text-sm font-semibold text-red-900 dark:text-red-100 mb-2">
                  Saúde do valor líquido (netValue)
                </h3>
                <div className="grid grid-cols-4 gap-2 text-xs mb-3">
                  <div>
                    <p className="text-red-700 dark:text-red-300">Sem líquido (null)</p>
                    <p className="font-bold tabular-nums">{data.saudeValorLiquido.nLiquidoNull}</p>
                  </div>
                  <div>
                    <p className="text-red-700 dark:text-red-300">Líquido = 0</p>
                    <p className="font-bold tabular-nums">{data.saudeValorLiquido.nLiquidoZero}</p>
                  </div>
                  <div>
                    <p className="text-red-700 dark:text-red-300">Suspeitos (&lt;80% do bruto)</p>
                    <p className="font-bold tabular-nums">{data.saudeValorLiquido.nLiquidoSuspeito}</p>
                  </div>
                  <div>
                    <p className="text-red-700 dark:text-red-300">OK</p>
                    <p className="font-bold tabular-nums">{data.saudeValorLiquido.nLiquidoOk}</p>
                  </div>
                </div>
                <p className="text-[11px] text-red-800 dark:text-red-200 mb-2">
                  Se "Suspeitos" for alto, o netValue desses está corrompido (gravado errado no
                  sync/webhook). Top 20 cobranças com maior diferença bruto−líquido:
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">Status</TableHead>
                      <TableHead className="text-[10px]">Forma</TableHead>
                      <TableHead className="text-[10px]">Descrição</TableHead>
                      <TableHead className="text-[10px] text-right">Bruto</TableHead>
                      <TableHead className="text-[10px] text-right">Líquido</TableHead>
                      <TableHead className="text-[10px] text-right">Gap %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.saudeValorLiquido.topOutliers.map((o: any) => (
                      <TableRow key={o.id}>
                        <TableCell className="text-[10px] font-mono">{o.status}</TableCell>
                        <TableCell className="text-[10px]">{o.formaPagamento ?? "—"}</TableCell>
                        <TableCell className="text-[10px] max-w-[160px] truncate">{o.descricao ?? "—"}</TableCell>
                        <TableCell className="text-[10px] text-right tabular-nums">{formatBRL(o.valor)}</TableCell>
                        <TableCell className="text-[10px] text-right tabular-nums">{formatBRL(o.valorLiquido ?? 0)}</TableCell>
                        <TableCell className="text-[10px] text-right tabular-nums font-medium text-red-700">
                          {o.gapPercent.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            {data.recebidoEmCash.count > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-slate-800 mb-2">
                  2. Cobranças RECEIVED_IN_CASH no período
                </h3>
                <p className="text-[11px] text-slate-500 mb-2">
                  Cobranças marcadas como "pago em dinheiro/manual" (via
                  Jurify ou direto no Asaas). Total:{" "}
                  <strong>{formatBRL(data.recebidoEmCash.total)}</strong> em{" "}
                  {data.recebidoEmCash.count} cobranças.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Data pagamento</TableHead>
                      <TableHead className="text-xs">Descrição</TableHead>
                      <TableHead className="text-xs">ID Asaas</TableHead>
                      <TableHead className="text-xs text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recebidoEmCash.itens.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs">{c.dataPagamento ?? "—"}</TableCell>
                        <TableCell className="text-xs">{c.descricao ?? "—"}</TableCell>
                        <TableCell className="text-[10px] font-mono text-slate-500">
                          {c.asaasPaymentId ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {formatBRL(Number(c.valor || 0))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            <section>
              <h3 className="text-sm font-semibold text-slate-800 mb-2">
                3. Cobranças nas bordas do período (±2 dias)
              </h3>
              <p className="text-[11px] text-slate-500 mb-2">
                Se aparecer cobrança paga no <strong>último dia do mês
                anterior</strong> ou no <strong>primeiro dia do próximo
                mês</strong>, pode ser timezone (UTC vs Brasília). Asaas
                pode classificar essa cobrança num mês diferente do Jurify.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-semibold text-slate-700 mb-1">
                    Borda do início ({dataInicio} ±2d)
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px]">Data pag.</TableHead>
                        <TableHead className="text-[10px]">Status</TableHead>
                        <TableHead className="text-[10px] text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.bordaInicio.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-[11px] text-slate-500 text-center">
                            Nada na borda.
                          </TableCell>
                        </TableRow>
                      )}
                      {data.bordaInicio.map((c: any) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-[11px]">{c.dataPagamento ?? "—"}</TableCell>
                          <TableCell className="text-[10px] font-mono">{c.status}</TableCell>
                          <TableCell className="text-[11px] text-right tabular-nums">
                            {formatBRL(Number(c.valor || 0))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-700 mb-1">
                    Borda do fim ({dataFim} ±2d)
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px]">Data pag.</TableHead>
                        <TableHead className="text-[10px]">Status</TableHead>
                        <TableHead className="text-[10px] text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.bordaFim.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-[11px] text-slate-500 text-center">
                            Nada na borda.
                          </TableCell>
                        </TableRow>
                      )}
                      {data.bordaFim.map((c: any) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-[11px]">{c.dataPagamento ?? "—"}</TableCell>
                          <TableCell className="text-[10px] font-mono">{c.status}</TableCell>
                          <TableCell className="text-[11px] text-right tabular-nums">
                            {formatBRL(Number(c.valor || 0))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Seção "Recebido" com o caixa real (por data de pagamento) discriminado
 * por situação de prazo, mais a ponte com o painel Asaas (por vencimento).
 *
 * O número principal é o CAIXA REAL — quando o dinheiro entrou. As
 * sub-linhas mostram quanto entrou no prazo / em atraso / adiantado. A
 * tabela de reconciliação no fim mostra como o caixa vira o número do
 * Asaas (que conta por vencimento): tira o atraso, soma o pago adiantado
 * que vence no período.
 */
function RecebidoPorPrazoSection({ kpis }: { kpis: any }) {
  const caixaTotal = kpis.recebido ?? 0;          // tudo (asaas + manual)
  const manual = kpis.recebidoManual ?? 0;        // origem=manual (Caixa Escritório)
  const manualCount = kpis.recebidoManualCount ?? 0;
  const noPrazo = kpis.recebidoNoPrazo ?? 0;      // asaas, venc e pago no período
  const atraso = kpis.recebidoAtraso ?? 0;        // asaas, venc antes
  const adiantado = kpis.recebidoAdiantado ?? 0;  // asaas, vence depois
  const noPrazoCount = kpis.recebidoNoPrazoCount ?? 0;
  const atrasoCount = kpis.recebidoAtrasoCount ?? 0;
  const adiantadoCount = kpis.recebidoAdiantadoCount ?? 0;
  const caixaAsaas = noPrazo + atraso + adiantado; // só asaas
  const caixaAsaasCount = noPrazoCount + atrasoCount + adiantadoCount;
  const porVencimento = kpis.recebidoAsaasPorVencimento ?? 0; // ponte (bate com painel)
  const porVencimentoCount = kpis.recebidoAsaasPorVencimentoCount ?? 0;
  // Cobranças Asaas que vencem no período mas foram pagas fora dele (adiantado
  // em meses anteriores) — o que o Asaas conta a mais que o "no prazo".
  const vencPeriodoPagoFora = porVencimento - noPrazo;
  const vencPeriodoPagoForaCount = porVencimentoCount - noPrazoCount;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-600" />
          Recebido — fluxo de caixa real
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Caixa real total + discriminação Asaas */}
          <div className="lg:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Caixa real total (quando o dinheiro entrou)</p>
            <p className="text-2xl font-bold text-emerald-600 tabular-nums">{formatBRL(caixaTotal)}</p>
            <p className="text-xs text-slate-500 mb-3">{kpis.recebidoCount ?? 0} cobranças pagas no período</p>
            <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
              <p className="text-[11px] font-medium text-slate-500">Cobranças Asaas, por situação de prazo:</p>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  No prazo <span className="text-slate-400">(venceu no período)</span>
                </span>
                <span className="font-semibold tabular-nums">{formatBRL(noPrazo)} · {noPrazoCount}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Em atraso <span className="text-slate-400">(venceu antes)</span>
                </span>
                <span className="font-semibold tabular-nums">{formatBRL(atraso)} · {atrasoCount}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  Adiantado <span className="text-slate-400">(vence depois)</span>
                </span>
                <span className="font-semibold tabular-nums">{formatBRL(adiantado)} · {adiantadoCount}</span>
              </div>
              {manual > 0 && (
                <div className="flex items-center justify-between text-xs pt-1 border-t border-dashed border-slate-200 dark:border-slate-700">
                  <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                    Caixa Escritório <span className="text-slate-400">(manual, fora do Asaas)</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatBRL(manual)} · {manualCount}</span>
                </div>
              )}
            </div>
          </div>

          {/* Ponte Asaas */}
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20 p-4">
            <p className="text-xs text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">↻ Ponte com Asaas</p>
            <p className="text-[11px] text-indigo-800 dark:text-indigo-200 mb-2 leading-relaxed">
              Só cobranças Asaas, por vencimento. Bate com o card "Recebidas" do painel:
            </p>
            <p className="text-xl font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">{formatBRL(porVencimento)}</p>
            <p className="text-[11px] text-indigo-600 dark:text-indigo-400">
              {porVencimentoCount} cobranças · vencimento no período
            </p>
          </div>
        </div>

        {/* Reconciliação caixa → Asaas */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Reconciliação: caixa real → critério Asaas</p>
          </div>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              <tr>
                <td className="px-4 py-2 text-slate-700 dark:text-slate-300">No prazo <span className="text-slate-400">(venc. e pago no período)</span></td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">{noPrazoCount}</td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatBRL(noPrazo)}</td>
              </tr>
              <tr className="bg-amber-50/40 dark:bg-amber-950/10">
                <td className="px-4 py-2 text-slate-700 dark:text-slate-300">+ Recebido em atraso <span className="text-slate-400">(Asaas)</span></td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">{atrasoCount}</td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-amber-700">{formatBRL(atraso)}</td>
              </tr>
              {adiantado > 0 && (
                <tr className="bg-sky-50/40 dark:bg-sky-950/10">
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">+ Recebido adiantado <span className="text-slate-400">(Asaas)</span></td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{adiantadoCount}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-sky-700">{formatBRL(adiantado)}</td>
                </tr>
              )}
              <tr className="bg-emerald-50/40 dark:bg-emerald-950/10 font-medium border-t border-emerald-200">
                <td className="px-4 py-2 text-slate-800 dark:text-slate-200">= Caixa Asaas</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{caixaAsaasCount}</td>
                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{formatBRL(caixaAsaas)}</td>
              </tr>
              {manual > 0 && (
                <tr>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">+ Caixa Escritório <span className="text-slate-400">(manual)</span></td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{manualCount}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-700">{formatBRL(manual)}</td>
                </tr>
              )}
              <tr className="bg-emerald-50/60 dark:bg-emerald-950/20 font-semibold border-t-2 border-emerald-200">
                <td className="px-4 py-2 text-slate-900 dark:text-slate-100">= Caixa real total (Jurify)</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{kpis.recebidoCount ?? 0}</td>
                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{formatBRL(caixaTotal)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-slate-500" colSpan={3}>
                  <span className="text-[11px] italic">Pra chegar no critério do painel Asaas (por vencimento), partindo do Caixa Asaas:</span>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-slate-500">− Recebido em atraso <span className="text-slate-400">(não vence no período)</span></td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-400">{atrasoCount}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">− {formatBRL(atraso)}</td>
              </tr>
              {adiantado > 0 && (
                <tr>
                  <td className="px-4 py-2 text-slate-500">− Recebido adiantado <span className="text-slate-400">(não vence no período)</span></td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-400">{adiantadoCount}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">− {formatBRL(adiantado)}</td>
                </tr>
              )}
              <tr className="bg-sky-50/40 dark:bg-sky-950/10">
                <td className="px-4 py-2 text-slate-700 dark:text-slate-300">+ Vence no período, pago fora <span className="text-slate-400">(adiantado em outro mês)</span></td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">{vencPeriodoPagoForaCount}</td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-sky-700">{formatBRL(vencPeriodoPagoFora)}</td>
              </tr>
              <tr className="bg-indigo-50/60 dark:bg-indigo-950/20 font-semibold border-t-2 border-indigo-200">
                <td className="px-4 py-2 text-slate-900 dark:text-slate-100">= Por vencimento (= painel Asaas)</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{porVencimentoCount}</td>
                <td className="px-4 py-2 text-right tabular-nums text-indigo-700">{formatBRL(porVencimento)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
