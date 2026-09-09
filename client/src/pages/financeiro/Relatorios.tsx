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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Loader2, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL, baixarBlob } from "./helpers";
import {
  BarraFiltro, CardRel, FiltroSelect, KpiRel, TituloSecao, calcularDelta,
  calcularDeltaPontos, periodoAnterior, useRelatorios,
} from "../relatorios/casca";
import { AcoesRelatorio } from "../relatorios/acoes";

export function RelatoriosTab() {
  const { periodo, comparar } = useRelatorios();
  const [criterio, setCriterio] = useState<"vencimento" | "pagamento">("vencimento");
  const [diagnosticoOpen, setDiagnosticoOpen] = useState(false);

  const dataInicio = periodo.inicio;
  const dataFim = periodo.fim;
  const rangeOk = dataInicio.length === 10 && dataFim.length === 10;

  // Relatório por VENCIMENTO (competência) bate com o painel Asaas; por
  // PAGAMENTO é o caixa puro. A ponte entre os dois vive na seção
  // "Composição do recebido" — que só faz sentido no modo competência.
  const dreQ = (trpc as any).financeiro?.dre?.useQuery?.(
    { dataInicio, dataFim, criterioReceita: criterio },
    { retry: false, enabled: rangeOk },
  );
  const dre = dreQ?.data;

  const ant = periodoAnterior(dataInicio, dataFim);
  const dreAntQ = (trpc as any).financeiro?.dre?.useQuery?.(
    { dataInicio: ant.inicio, dataFim: ant.fim, criterioReceita: criterio },
    { retry: false, enabled: rangeOk && comparar },
  );
  const dreAnt = comparar ? dreAntQ?.data : undefined;

  // Espelho do painel "Situação das cobranças" do Asaas (4 cards bruto/líquido)
  const situacaoQ = (trpc as any).financeiro?.situacaoCobrancasAsaas?.useQuery?.(
    { dataInicio, dataFim },
    { retry: false, enabled: rangeOk },
  );
  const situacao = situacaoQ?.data;

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
    { retry: false, enabled: rangeOk },
  );
  const kpis = kpisQ?.data;

  // Quebra por forma de pagamento do recebido POR VENCIMENTO (bate com Asaas)
  const formaVencQ = (trpc as any).financeiro?.recebidoVencimentoPorForma?.useQuery?.(
    { dataInicio, dataFim },
    { retry: false, enabled: rangeOk },
  );
  const formaVenc = formaVencQ?.data;

  const csvMut = (trpc as any).financeiro?.exportarDreCsv?.useMutation?.({
    onSuccess: (r: { filename: string; content: string; mimeType: string }) => {
      baixarBlob(r.content, r.filename, r.mimeType);
      toast.success("CSV baixado");
    },
    onError: (err: any) =>
      toast.error("Erro ao exportar CSV", { description: err.message }),
  });
  // "Recebido de outros meses" = caixa (pago no período) − competência
  // (vence no período). Completa as tabelas de receita pro total do caixa.
  // No modo pagamento a tabela já é o caixa, então a ponte não se aplica.
  const outrosMesesValor = criterio === "vencimento"
    ? Math.max(0, (kpis?.recebido ?? 0) - (kpis?.recebidoComVencimentoNoPeriodo ?? 0))
    : 0;
  const outrosMesesCount = criterio === "vencimento"
    ? Math.max(0, (kpis?.recebidoCount ?? 0) - (kpis?.recebidoComVencimentoNoPeriodoCount ?? 0))
    : 0;
  const outrosMeses =
    outrosMesesValor > 0
      ? { valor: outrosMesesValor, count: outrosMesesCount }
      : undefined;

  // KPIs do topo usam o CAIXA (receita de competência + outros meses), pra
  // bater com o total das tabelas e com o "Entrou no caixa" do Financeiro.
  const receitaCaixa = (dre?.receitas.total ?? 0) + outrosMesesValor;
  const despesaTotal = dre?.despesas.total ?? 0;
  const resultado = receitaCaixa - despesaTotal;
  const positivo = resultado >= 0;
  const margemCaixa = receitaCaixa > 0 ? (resultado / receitaCaixa) * 100 : NaN;

  const receitaAnt = dreAnt?.receitas.total ?? null;
  const despesaAnt = dreAnt?.despesas.total ?? null;
  const resultadoAnt = dreAnt ? (receitaAnt ?? 0) - (despesaAnt ?? 0) : null;
  const margemAnt = dreAnt && (receitaAnt ?? 0) > 0
    ? ((resultadoAnt ?? 0) / (receitaAnt ?? 1)) * 100
    : null;

  const maxBarra = Math.max(receitaCaixa, despesaTotal, Math.abs(resultado), 1);

  return (
    <div className="space-y-3">
      <AcoesRelatorio
        relatorio="financeiro"
        filtros={{}}
        pronto={!!dre}
        extras={
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setDiagnosticoOpen(true)}
              disabled={!dre}
              title="Quebra o número 'Caixa Asaas' por status e mostra cobranças nas bordas — pra você identificar se a divergência com o painel Asaas vem de RECEIVED_IN_CASH (pagamento manual) ou timezone (cobrança paga 21h-23h do último dia do mês anterior)"
            >
              <Search className="h-3.5 w-3.5 mr-1.5" />
              Diagnosticar divergência
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
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
          </>
        }
      />

      <BarraFiltro>
        <FiltroSelect
          rotulo="Critério"
          valor={criterio}
          onChange={(v) => setCriterio(v as "vencimento" | "pagamento")}
          opcoes={[
            { value: "vencimento", label: "Vencimento" },
            { value: "pagamento", label: "Pagamento" },
          ]}
        />
      </BarraFiltro>

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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiRel
              label="Receita total"
              valor={formatBRL(receitaCaixa)}
              cor="text-success-fg"
              delta={dreAnt ? calcularDelta(receitaCaixa, receitaAnt) : undefined}
              anterior={dreAnt ? `${formatBRL(receitaAnt ?? 0)} no período anterior` : null}
            />
            <KpiRel
              label="Despesa total"
              valor={formatBRL(despesaTotal)}
              cor="text-danger-fg"
              delta={dreAnt ? calcularDelta(despesaTotal, despesaAnt, true) : undefined}
              anterior={dreAnt ? `${formatBRL(despesaAnt ?? 0)} no período anterior` : null}
            />
            <KpiRel
              label="Resultado líquido"
              valor={formatBRL(resultado)}
              cor={positivo ? "text-success-fg" : "text-danger-fg"}
              delta={dreAnt ? calcularDelta(resultado, resultadoAnt) : undefined}
              anterior={dreAnt ? `${formatBRL(resultadoAnt ?? 0)} no período anterior` : null}
            />
            <KpiRel
              label="Margem"
              valor={isNaN(margemCaixa) ? "—" : `${margemCaixa.toFixed(1)}%`}
              cor={positivo ? "text-success-fg" : "text-danger-fg"}
              delta={dreAnt ? calcularDeltaPontos(margemCaixa, margemAnt) : undefined}
              anterior={
                margemAnt != null ? `${margemAnt.toFixed(1)}% no período anterior` : null
              }
            />
          </div>

          <CardRel
            icone={<Wallet className="h-4 w-4 text-muted-foreground" />}
            titulo="Resultado do período"
            aviso="receita − despesa"
          >
            <div className="px-4 pb-4 space-y-2.5">
              {[
                { rotulo: "Receita", valor: receitaCaixa, cor: "bg-success" },
                { rotulo: "Despesa", valor: despesaTotal, cor: "bg-danger" },
                {
                  rotulo: "Resultado",
                  valor: resultado,
                  cor: positivo ? "bg-info" : "bg-danger",
                },
              ].map((l) => (
                <div key={l.rotulo} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-xs">{l.rotulo}</span>
                  <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${l.cor}`}
                      style={{ width: `${Math.max((Math.abs(l.valor) / maxBarra) * 100, 1)}%` }}
                    />
                  </div>
                  <span className="w-32 shrink-0 text-right text-xs font-semibold tabular-nums">
                    {formatBRL(l.valor)}
                  </span>
                </div>
              ))}
            </div>
          </CardRel>

          {/* Composição do recebido: ponte entre competência (relatório) e
              caixa (Financeiro) — discrimina o que entrou de outros meses. */}
          {kpis && <ComposicaoRecebidoSection kpis={kpis} />}

          {/* Conferência com o Asaas: espelho dos 4 cards (bruto + líquido) */}
          {situacao && (
            <ConferenciaAsaasSection
              situacao={situacao}
              kpis={kpis}
              formaVenc={formaVenc}
            />
          )}

          <TituloSecao>Receitas</TituloSecao>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <TabelaDre
              titulo="Por categoria"
              colunaLabel="Categoria"
              total={dre.receitas.total}
              linhas={dre.receitas.porCategoria.map((c: any) => ({
                chave: String(c.categoriaId ?? "null"),
                nome: c.categoriaNome,
                total: c.total,
                count: c.count,
                semClassificacao: c.categoriaId === null,
              }))}
              accent="emerald"
              outrosMeses={outrosMeses}
            />
            {dre.receitas.porOrigem && dre.receitas.porOrigem.length > 0 && (
              <TabelaDre
                titulo="Por origem"
                aviso="de onde veio"
                colunaLabel="Origem"
                total={dre.receitas.total}
                linhas={dre.receitas.porOrigem}
                accent="emerald"
                outrosMeses={outrosMeses}
              />
            )}
          </div>

          {dre.receitas.porFormaPagamento && dre.receitas.porFormaPagamento.length > 0 && (
            <TabelaDre
              titulo="Por forma de pagamento"
              colunaLabel="Forma"
              total={dre.receitas.total}
              linhas={dre.receitas.porFormaPagamento}
              accent="emerald"
              outrosMeses={outrosMeses}
            />
          )}

          <TituloSecao>Despesas</TituloSecao>

          <TabelaDre
            titulo="Por categoria"
            colunaLabel="Categoria"
            total={dre.despesas.total}
            linhas={dre.despesas.porCategoria.map((c: any) => ({
              chave: String(c.categoriaId ?? "null"),
              nome: c.categoriaNome,
              total: c.total,
              count: c.count,
              semClassificacao: c.categoriaId === null,
            }))}
            accent="red"
          />
        </>
      )}
    </div>
  );
}

interface LinhaDre {
  chave: string;
  nome: string;
  total: number;
  count: number;
  /** Renderiza em itálico — lançamento sem categoria pede atenção. */
  semClassificacao?: boolean;
}

/**
 * Tabela de uma dimensão do DRE. Substitui as duas variantes que existiam
 * (categoria e dimensão livre) — só mudava o rótulo da primeira coluna.
 */
function TabelaDre({
  titulo,
  aviso,
  colunaLabel,
  total,
  linhas,
  accent,
  outrosMeses,
}: {
  titulo: string;
  aviso?: string;
  colunaLabel: string;
  total: number;
  linhas: LinhaDre[];
  accent: "emerald" | "red";
  /** Linha extra "Recebido de outros meses" — completa o total pro caixa. */
  outrosMeses?: { valor: number; count: number };
}) {
  const temOutros = !!outrosMeses && outrosMeses.valor > 0;
  const totalCaixa = total + (temOutros ? outrosMeses.valor : 0);
  const pct = (v: number) => (totalCaixa > 0 ? Math.round((v / totalCaixa) * 100) : 0);
  const corTitulo = accent === "emerald" ? "text-success-fg" : "text-danger-fg";

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <h3 className={`text-sm font-semibold ${corTitulo}`}>{titulo}</h3>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground">
          {aviso ?? formatBRL(totalCaixa)}
        </span>
      </div>
      {linhas.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">Sem lançamentos no período.</p>
      ) : (
        <div className="overflow-x-auto px-1 pb-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-wide">{colunaLabel}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">Qtd</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">% da seção</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.chave}>
                  <TableCell className="text-xs">
                    {l.semClassificacao ? (
                      <span className="italic text-muted-foreground">{l.nome}</span>
                    ) : (
                      l.nome
                    )}
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums text-muted-foreground">
                    {l.count}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-block rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
                      {pct(l.total)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums">
                    {formatBRL(l.total)}
                  </TableCell>
                </TableRow>
              ))}
              {temOutros && (
                <TableRow className="bg-warning-bg/50">
                  <TableCell className="text-xs text-warning-fg">
                    + Recebido de outros meses{" "}
                    <span className="text-[10px] text-warning-fg">(venceu antes, pago agora)</span>
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums text-warning-fg">
                    {outrosMeses.count}
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums text-warning-fg">
                    {pct(outrosMeses.valor)}%
                  </TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-warning-fg">
                    {formatBRL(outrosMeses.valor)}
                  </TableCell>
                </TableRow>
              )}
              <TableRow className="bg-muted/40 hover:bg-muted/40 font-semibold">
                <TableCell className="text-xs">
                  {temOutros ? "Total recebido (caixa)" : "Total"}
                </TableCell>
                <TableCell className="text-center text-xs tabular-nums">
                  {linhas.reduce((a, l) => a + l.count, 0) + (temOutros ? outrosMeses.count : 0)}
                </TableCell>
                <TableCell className="text-center text-xs tabular-nums text-muted-foreground">
                  100%
                </TableCell>
                <TableCell
                  className={`text-right text-xs tabular-nums ${
                    accent === "emerald" ? "text-success-fg" : "text-danger-fg"
                  }`}
                >
                  {formatBRL(totalCaixa)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * Dialog de diagnóstico de divergência entre "Caixa Asaas" (JuridFlow) e o
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
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Diagnóstico de divergência — Caixa Asaas</DialogTitle>
        </DialogHeader>

        {q?.isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/70" />
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <p className="text-xs text-muted-foreground">
              Período: <strong>{data.periodo.inicio}</strong> a{" "}
              <strong>{data.periodo.fim}</strong>. Compare cada bloco abaixo
              com o painel Asaas pra identificar a causa da diferença.
            </p>

            {/* Comparação ao vivo com o Asaas */}
            <section className="rounded-lg border border-info/30 bg-info-bg/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-info-fg">
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
              <p className="text-[11px] text-info-fg mb-2">
                Consulta o Asaas ao vivo (gasta cota) e cruza cobrança-a-cobrança.
                Identifica as cobranças que o JuridFlow conta como recebidas mas o
                Asaas não retorna — a causa do bruto estar maior aqui.
              </p>

              {comp && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-info-fg">Asaas (paymentDate)</p>
                      <p className="font-bold tabular-nums">{formatBRL(comp.totalAsaas.value)}</p>
                      <p className="text-[10px] text-muted-foreground">{comp.totalAsaas.count} cobranças</p>
                    </div>
                    <div>
                      <p className="text-info-fg">JuridFlow (dataPagamento)</p>
                      <p className="font-bold tabular-nums">{formatBRL(comp.totalJurify.value)}</p>
                      <p className="text-[10px] text-muted-foreground">{comp.totalJurify.count} cobranças</p>
                    </div>
                    <div>
                      <p className="text-info-fg">Diferença</p>
                      <p className="font-bold tabular-nums text-danger-fg">{formatBRL(comp.diferenca)}</p>
                    </div>
                  </div>

                  {comp.creditoMesDiferente && comp.creditoMesDiferente.count > 0 && (
                    <div className="bg-warning-bg border border-warning/30 rounded p-2 text-xs">
                      <p className="font-semibold text-warning-fg">
                        Crédito em mês diferente do pagamento: {comp.creditoMesDiferente.count} cobranças
                        ({formatBRL(comp.creditoMesDiferente.total)})
                      </p>
                      <p className="text-[11px] text-warning-fg mt-1">
                        Pagas neste mês mas creditadas em outro (boleto D+1 pago no fim do mês).
                        O painel "Recebidas" do Asaas filtra por data de crédito — por isso não
                        conta essas. Se este número bate com a diferença, mistério resolvido.
                      </p>
                    </div>
                  )}

                  {comp.asaasPorStatus && comp.asaasPorStatus.length > 0 && (
                    <div className="bg-white dark:bg-muted rounded p-2">
                      <p className="text-[11px] font-semibold text-info-fg mb-1">
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
                                  <span className="ml-1 text-[9px] text-warning-fg bg-warning-bg px-1 rounded">
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

                  <div className="text-xs bg-white dark:bg-muted rounded p-2 space-y-1">
                    <p>
                      <strong>{comp.soNoJurify.count}</strong> cobranças só no JuridFlow
                      (total <strong>{formatBRL(comp.soNoJurify.total)}</strong>) — o
                      Asaas não retornou no período. <strong>Esta é a causa provável.</strong>
                    </p>
                    <p>
                      <strong>{comp.statusDivergente.count}</strong> com status
                      diferente entre JuridFlow e Asaas.
                    </p>
                    <p>
                      <strong>{comp.soNoAsaas.count}</strong> só no Asaas
                      (total {formatBRL(comp.soNoAsaas.value)}) — Asaas tem como pago
                      mas o JuridFlow não.
                    </p>
                  </div>

                  {comp.soNoJurify.itens.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-info-fg mb-1">
                        Cobranças só no JuridFlow (sobrando)
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
                              <TableCell className="text-[9px] font-mono text-muted-foreground">{c.asaasPaymentId ?? "(manual)"}</TableCell>
                              <TableCell className="text-[10px] text-right tabular-nums">{formatBRL(Number(c.valor || 0))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {comp.statusDivergente.itens.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-info-fg mb-1">
                        Status divergente (JuridFlow ≠ Asaas)
                      </p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-[10px]">Descrição</TableHead>
                            <TableHead className="text-[10px]">Status JuridFlow</TableHead>
                            <TableHead className="text-[10px]">Status Asaas</TableHead>
                            <TableHead className="text-[10px] text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comp.statusDivergente.itens.map((d: any) => (
                            <TableRow key={d.row.id}>
                              <TableCell className="text-[10px] max-w-[140px] truncate">{d.row.descricao ?? "—"}</TableCell>
                              <TableCell className="text-[10px] font-mono">{d.row.status}</TableCell>
                              <TableCell className="text-[10px] font-mono text-danger-fg">{d.statusAsaas}</TableCell>
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
              <section className="rounded-lg border border-warning/30 bg-warning-bg/40 p-3">
                <h3 className="text-sm font-semibold text-warning-fg mb-2">
                  Resumo bruto vs líquido (hipótese: taxas Asaas)
                </h3>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-warning-fg">Total bruto (JuridFlow)</p>
                    <p className="text-base font-bold text-warning-fg tabular-nums">
                      {formatBRL(data.resumo.totalBruto)}
                    </p>
                  </div>
                  <div>
                    <p className="text-warning-fg">Total líquido (após taxas)</p>
                    <p className="text-base font-bold text-warning-fg tabular-nums">
                      {formatBRL(data.resumo.totalLiquido)}
                    </p>
                  </div>
                  <div>
                    <p className="text-warning-fg">Taxas (bruto − líquido)</p>
                    <p className="text-base font-bold text-warning-fg tabular-nums">
                      {formatBRL(data.resumo.totalTaxas)}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-warning-fg mt-2 leading-relaxed">
                  Se o "Total líquido" bate com o "Recebidos" do painel Asaas, o painel deles mostra
                  valor pós-taxas e nosso "Caixa Asaas" mostra bruto.{" "}
                  {data.resumo.comValorLiquido < data.resumo.totalCount && (
                    <span className="block mt-1 text-warning-fg">
                      ⚠ Apenas {data.resumo.comValorLiquido} de {data.resumo.totalCount} cobranças
                      têm valor líquido preenchido — sync incompleto pode estar mascarando a taxa real.
                    </span>
                  )}
                </p>
              </section>
            )}

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">
                1. Total por status (JuridFlow) — bruto vs líquido por forma de pagamento
              </h3>
              <p className="text-[11px] text-muted-foreground mb-2">
                Se a soma de <code>RECEIVED_IN_CASH</code> bate com a
                diferença que você está vendo, é hipótese A. Se a coluna "Taxa"
                bate, é hipótese das taxas (Asaas mostra líquido, JuridFlow mostra bruto).
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
                      <TableCell colSpan={7} className="text-xs text-muted-foreground text-center">
                        Sem dados no período.
                      </TableCell>
                    </TableRow>
                  )}
                  {data.porStatus.map((r: any, i: number) => (
                    <TableRow key={`${r.status}-${r.origem}-${r.formaPagamento}-${i}`}>
                      <TableCell className="text-xs font-mono">
                        {r.status}
                        {r.status === "RECEIVED_IN_CASH" && (
                          <span className="ml-1 text-[9px] text-warning-fg bg-warning-bg px-1 rounded">
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
                      <TableCell className="text-xs text-right tabular-nums font-medium text-warning-fg">
                        {formatBRL(r.taxa)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            {data.saudeValorLiquido && (
              <section className="rounded-lg border border-danger/30 bg-danger-bg/40 p-3">
                <h3 className="text-sm font-semibold text-danger-fg mb-2">
                  Saúde do valor líquido (netValue)
                </h3>
                <div className="grid grid-cols-4 gap-2 text-xs mb-3">
                  <div>
                    <p className="text-danger-fg">Sem líquido (null)</p>
                    <p className="font-bold tabular-nums">{data.saudeValorLiquido.nLiquidoNull}</p>
                  </div>
                  <div>
                    <p className="text-danger-fg">Líquido = 0</p>
                    <p className="font-bold tabular-nums">{data.saudeValorLiquido.nLiquidoZero}</p>
                  </div>
                  <div>
                    <p className="text-danger-fg">Suspeitos (&lt;80% do bruto)</p>
                    <p className="font-bold tabular-nums">{data.saudeValorLiquido.nLiquidoSuspeito}</p>
                  </div>
                  <div>
                    <p className="text-danger-fg">OK</p>
                    <p className="font-bold tabular-nums">{data.saudeValorLiquido.nLiquidoOk}</p>
                  </div>
                </div>
                <p className="text-[11px] text-danger-fg mb-2">
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
                        <TableCell className="text-[10px] text-right tabular-nums font-medium text-danger-fg">
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
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  2. Cobranças RECEIVED_IN_CASH no período
                </h3>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Cobranças marcadas como "pago em dinheiro/manual" (via
                  JuridFlow ou direto no Asaas). Total:{" "}
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
                        <TableCell className="text-[10px] font-mono text-muted-foreground">
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
              <h3 className="text-sm font-semibold text-foreground mb-2">
                3. Cobranças nas bordas do período (±2 dias)
              </h3>
              <p className="text-[11px] text-muted-foreground mb-2">
                Se aparecer cobrança paga no <strong>último dia do mês
                anterior</strong> ou no <strong>primeiro dia do próximo
                mês</strong>, pode ser timezone (UTC vs Brasília). Asaas
                pode classificar essa cobrança num mês diferente do JuridFlow.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-semibold text-foreground mb-1">
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
                          <TableCell colSpan={3} className="text-[11px] text-muted-foreground text-center">
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
                  <p className="text-[11px] font-semibold text-foreground mb-1">
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
                          <TableCell colSpan={3} className="text-[11px] text-muted-foreground text-center">
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
 * Composição do recebido: ponte entre o relatório (competência, por
 * vencimento) e o Financeiro (caixa, por pagamento). Discrimina o que
 * entrou de competência do mês vs o que veio de outros meses (pago agora).
 *   competência + outros meses = caixa real (= Financeiro)
 */
function ComposicaoRecebidoSection({ kpis }: { kpis: any }) {
  const caixa = kpis.recebido ?? 0;
  const caixaCount = kpis.recebidoCount ?? 0;
  const competencia = kpis.recebidoComVencimentoNoPeriodo ?? 0;
  const competenciaCount = kpis.recebidoComVencimentoNoPeriodoCount ?? 0;
  const outrosMeses = caixa - competencia;
  const outrosMesesCount = caixaCount - competenciaCount;
  if (caixa <= 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Composição do recebido</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            <tr>
              <td className="py-2.5">
                <span className="inline-flex items-center gap-2 text-foreground">
                  <span className="w-2 h-2 rounded-full bg-success" />
                  Com vencimento neste mês
                  <span className="text-[11px] text-muted-foreground/70">(competência = tabelas abaixo = Asaas)</span>
                </span>
              </td>
              <td className="py-2.5 text-right tabular-nums text-muted-foreground">{competenciaCount}</td>
              <td className="py-2.5 text-right tabular-nums font-medium">{formatBRL(competencia)}</td>
            </tr>
            <tr className="bg-warning-bg/40">
              <td className="py-2.5 px-1">
                <span className="inline-flex items-center gap-2 text-foreground">
                  <span className="w-2 h-2 rounded-full bg-warning" />
                  + Recebido de outros meses
                  <span className="text-[11px] text-muted-foreground/70">(venceu antes, pago agora)</span>
                </span>
              </td>
              <td className="py-2.5 text-right tabular-nums text-muted-foreground">{outrosMesesCount}</td>
              <td className="py-2.5 text-right tabular-nums font-medium text-warning-fg">{formatBRL(outrosMeses)}</td>
            </tr>
            <tr className="bg-success-bg/60 font-semibold border-t-2 border-success/30">
              <td className="py-2.5 px-1 text-foreground">
                = Entrou no caixa no período
                <span className="text-[11px] font-normal text-muted-foreground/70 ml-1">(= Financeiro)</span>
              </td>
              <td className="py-2.5 text-right tabular-nums text-muted-foreground">{caixaCount}</td>
              <td className="py-2.5 text-right tabular-nums text-success-fg">{formatBRL(caixa)}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/**
 * Conferência com o Asaas: espelha os 4 cards do painel "Situação das
 * cobranças" (Recebidas / Confirmadas / Aguardando / Vencidas) com bruto
 * e líquido, por vencimento — o cliente compara card a card. Detalhe por
 * forma de pagamento e caixa manual ficam atrás de "Ver detalhe".
 */
function ConferenciaAsaasSection({ situacao, kpis, formaVenc }: { situacao: any; kpis?: any; formaVenc?: any }) {
  const fmt = (v: number) => formatBRL(v);
  const cards = [
    { key: "recebidas", label: "Recebidas", cor: "text-success-fg", data: situacao.recebidas },
    { key: "confirmadas", label: "Confirmadas", cor: "text-info-fg", data: situacao.confirmadas },
    { key: "aguardando", label: "Aguardando pagam.", cor: "text-warning-fg", data: situacao.aguardando },
    { key: "vencidas", label: "Vencidas", cor: "text-danger-fg", data: situacao.vencidas },
  ];
  const manual = kpis?.recebidoManual ?? 0;
  const manualCount = kpis?.recebidoManualCount ?? 0;
  const [detalhe, setDetalhe] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-success text-success-on flex items-center justify-center text-xs font-bold">✓</span>
          Conferência com o Asaas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Abra o Asaas em "Situação das cobranças → Este mês" e compare card a card.
          Mesmos valores (bruto e líquido), mesmo critério (por vencimento).
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <div key={c.key} className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className={`text-lg font-bold tabular-nums ${c.cor}`}>{fmt(c.data.bruto)}</p>
              <p className="text-[11px] text-muted-foreground/70">{fmt(c.data.liquido)} líquido</p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">{c.data.count} cobranças</p>
            </div>
          ))}
        </div>

        {manual > 0 && (
          <div className="rounded-lg bg-muted p-3 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              <strong>Caixa Manual</strong> <span className="text-muted-foreground/70">(recebido por fora do Asaas — não aparece no painel deles)</span>
            </span>
            <span className="font-semibold tabular-nums">{fmt(manual)} · {manualCount}</span>
          </div>
        )}

        <button
          onClick={() => setDetalhe((d) => !d)}
          className="text-xs text-info-fg hover:underline"
        >
          {detalhe ? "Ocultar detalhe por forma ›" : "Ver detalhe por forma de pagamento ›"}
        </button>

        {detalhe && formaVenc?.itens?.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 bg-muted border-b border-border">
              <p className="text-xs font-semibold text-foreground">Recebidas por forma de pagamento (bate com Asaas)</p>
            </div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                {formaVenc.itens.map((f: any) => (
                  <tr key={f.forma}>
                    <td className="px-4 py-2 text-foreground">{f.forma}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{f.count} cobr.</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmt(f.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
