/**
 * Dashboard FINANCEIRO — pra setor tipo='financeiro'.
 *
 * Receita contra inadimplência. O gráfico é o MESMO do painel Geral, alimentado
 * pela mesma procedure (`dashboard.cashFlow`): dois números iguais em telas
 * diferentes precisam vir da mesma conta, senão eles divergem e a pessoa passa
 * a não confiar em nenhum dos dois.
 *
 * Os devedores não ganham barra de porcentagem: barra compara contra uma meta,
 * e aqui não existe meta. Transformar reais em "100%, 68%, 51%" inventaria uma
 * escala que o número não tem.
 */

import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  AcaoCard,
  BlocoPrincipal,
  COR_SERIE,
  FaixaAcoes,
  LinhaNumero,
  LinhaValor,
  ListaCard,
  PainelTopo,
  SubNumero,
  SubNumeros,
  formatBRL,
  formatDataCurta,
  formatEixoValor,
  formatPercent,
} from "./common";

const COR_VENCIDO = "var(--viz-2)";

function diasDesde(dataIso: string | null): number | null {
  if (!dataIso) return null;
  const alvo = new Date(`${dataIso}T12:00:00`).getTime();
  if (Number.isNaN(alvo)) return null;
  return Math.max(0, Math.floor((Date.now() - alvo) / 86400000));
}

export default function DashboardFinanceiro() {
  const [, nav] = useLocation();
  const { data, isLoading } = (trpc as any).dashboard.financeiro.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: cashFlow } = trpc.dashboard.cashFlow.useQuery(undefined, {
    retry: false,
    refetchInterval: 120_000,
  });

  if (isLoading) return <Esqueleto />;
  // O servidor devolve o sentinel ZERO (período com datas vazias) quando falta
  // `dashboard.verTodos` — é o sinal de "sem permissão".
  if (!data || !data.periodo?.dataInicio) {
    return (
      <div className="rounded-md border bg-card px-4 py-6">
        <p className="text-sm text-muted-foreground">Sem permissão para ver o painel financeiro.</p>
      </div>
    );
  }

  const pagamentos = cashFlow?.pagamentosRecebidos ?? 0;
  const ticketMedio = pagamentos > 0 ? (cashFlow?.totalRecebido ?? 0) / pagamentos : null;
  const saldoPositivo = data.recebido >= data.vencido;
  const devedores: any[] = data.topDevedores ?? [];
  const cobrancasVencidas = cashFlow?.cobrancasVencidas ?? 0;

  return (
    <div className="space-y-3.5">
      <PainelTopo
        titulo="Painel Financeiro"
        subtitulo={
          <span className="tabular-nums">
            Receita do escritório · {formatDataCurta(data.periodo.dataInicio)} a{" "}
            {formatDataCurta(data.periodo.dataFim)}
          </span>
        }
        acao={
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => nav("/financeiro")}>
            Ver financeiro
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        }
      />

      {(data.clientesInadimplentes > 0 || cobrancasVencidas > 0) && (
        <FaixaAcoes>
          {data.clientesInadimplentes > 0 && (
            <AcaoCard
              icone={AlertTriangle}
              valor={data.clientesInadimplentes}
              label={
                data.clientesInadimplentes === 1
                  ? "cliente com cobrança vencida"
                  : "clientes com cobrança vencida"
              }
              critico
              onClick={() => nav("/financeiro?tab=clientes&chip=inadimplentes")}
            />
          )}
          {cobrancasVencidas > 0 && (
            <AcaoCard
              icone={Clock}
              valor={cobrancasVencidas}
              label={
                cobrancasVencidas === 1
                  ? "cobrança vencida no período"
                  : "cobranças vencidas no período"
              }
              onClick={() => nav("/financeiro")}
            />
          )}
        </FaixaAcoes>
      )}

      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BlocoPrincipal
            rotulo="Recebido no período"
            valor={formatBRL(data.recebido)}
            badge={
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${
                  saldoPositivo
                    ? "border-success/30 bg-success-bg text-success-fg"
                    : "border-danger/30 bg-danger-bg text-danger-fg"
                }`}
              >
                {saldoPositivo ? "Saldo positivo" : "Saldo negativo"}
              </span>
            }
            grafico={
              cashFlow && cashFlow.pontos.length > 0 ? (
                <>
                  <div className="flex items-center justify-end gap-3.5 px-2 pb-1 text-[10.5px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="h-[3px] w-3.5 rounded-full" style={{ background: COR_SERIE }} />
                      Recebido
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-[3px] w-3.5 rounded-full" style={{ background: COR_VENCIDO }} />
                      Vencido
                    </span>
                  </div>
                  <div className="h-[168px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={cashFlow.pontos} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="finRecebido" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COR_SERIE} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={COR_SERIE} stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="finVencido" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COR_VENCIDO} stopOpacity={0.16} />
                            <stop offset="100%" stopColor={COR_VENCIDO} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="0" vertical={false} stroke="var(--border)" />
                        <XAxis
                          dataKey="data"
                          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                          tickFormatter={(d) => formatDataCurta(d)}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={24}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                          tickFormatter={(v) => formatEixoValor(v)}
                          tickLine={false}
                          axisLine={false}
                          width={38}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--popover)",
                            border: "1px solid var(--border)",
                            borderRadius: "8px",
                            fontSize: "12px",
                            color: "var(--popover-foreground)",
                          }}
                          labelFormatter={(d) => formatDataCurta(d)}
                          formatter={(v: number, nome) => [formatBRL(v), nome]}
                        />
                        <Area
                          type="monotone"
                          dataKey="recebido"
                          stroke={COR_SERIE}
                          strokeWidth={2}
                          fill="url(#finRecebido)"
                          name="Recebido"
                          dot={{ r: 3, fill: "var(--card)", stroke: COR_SERIE, strokeWidth: 2 }}
                          activeDot={{ r: 5, fill: COR_SERIE, stroke: "var(--card)", strokeWidth: 2 }}
                        />
                        {/* Tracejada porque é dinheiro que NÃO entrou: sólida do
                            lado de uma sólida, as duas leem como receita. */}
                        <Area
                          type="monotone"
                          dataKey="vencido"
                          stroke={COR_VENCIDO}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          fill="url(#finVencido)"
                          name="Vencido"
                          dot={false}
                          activeDot={{ r: 4, fill: COR_VENCIDO, stroke: "var(--card)", strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <div className="flex h-[168px] items-center justify-center text-xs text-muted-foreground">
                  Sem dados no período.
                </div>
              )
            }
          >
            <SubNumeros>
              <SubNumero
                label="A receber, em dia"
                valor={formatBRL(data.pendente)}
                hint={
                  (cashFlow?.cobrancasPendentes ?? 0) > 0
                    ? `${cashFlow!.cobrancasPendentes} ${cashFlow!.cobrancasPendentes === 1 ? "cobrança" : "cobranças"} a vencer`
                    : undefined
                }
              />
              <SubNumero
                label="Vencido no período"
                valor={formatBRL(data.vencido)}
                ruim={data.vencido > 0}
                tag={
                  data.vencido > 0 ? (
                    <span className="rounded border border-danger/30 bg-danger-bg px-1.5 text-[10px] font-bold text-danger-fg">
                      {formatPercent(data.percentInadimplenciaValor, 0)}
                    </span>
                  ) : undefined
                }
                hint={
                  data.clientesInadimplentes > 0
                    ? `${data.clientesInadimplentes} ${data.clientesInadimplentes === 1 ? "cliente" : "clientes"} no período`
                    : undefined
                }
              />
              <SubNumero
                label="Ticket médio recebido"
                valor={ticketMedio != null ? formatBRL(ticketMedio) : "—"}
                hint={
                  pagamentos > 0
                    ? `${pagamentos} ${pagamentos === 1 ? "pagamento" : "pagamentos"} no período`
                    : undefined
                }
              />
            </SubNumeros>
          </BlocoPrincipal>
        </div>

        <div className="relative min-h-0">
          <div className="lg:absolute lg:inset-0">
            <ListaCard
              titulo="Maiores valores em aberto"
              subtitulo="Não filtrado por setor"
              acaoLabel="Ver todos"
              onAcao={() => nav("/financeiro?tab=clientes&chip=inadimplentes")}
              esticar
              rodape={
                devedores.length > 0 ? (
                  <>
                    <span>
                      {devedores.length} de {data.clientesInadimplentes}{" "}
                      {data.clientesInadimplentes === 1 ? "cliente" : "clientes"}
                    </span>
                    <span className="font-semibold text-danger-fg">
                      {formatBRL(devedores.reduce((s: number, d: any) => s + d.valor, 0))}
                    </span>
                  </>
                ) : undefined
              }
            >
              {devedores.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                  Nenhum cliente com cobrança vencida.
                </p>
              ) : (
                devedores.map((d: any, i: number) => {
                  const dias = diasDesde(d.vencimentoMaisAntigo ?? null);
                  return (
                    <LinhaValor
                      key={d.contatoId}
                      nome={d.nome}
                      indice={i}
                      detalhe={
                        dias != null
                          ? `${d.cobrancasVencidas} ${d.cobrancasVencidas === 1 ? "vencida" : "vencidas"} · a mais antiga há ${dias} ${dias === 1 ? "dia" : "dias"}`
                          : `${d.cobrancasVencidas} ${d.cobrancasVencidas === 1 ? "cobrança vencida" : "cobranças vencidas"}`
                      }
                      valor={formatBRL(d.valor)}
                      rodapeValor="em aberto"
                      onClick={() => nav(`/clientes?id=${d.contatoId}`)}
                    />
                  );
                })
              )}
            </ListaCard>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="overflow-hidden rounded-md border bg-card">
            <div className="px-4 pt-3.5">
              <p className="text-sm font-bold leading-tight">Inadimplência por cliente</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Cliente inadimplente = com ao menos uma cobrança vencida no período.
              </p>
            </div>
            <div className="px-4 pb-4 pt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, data.percentInadimplenciaClientes ?? 0)}%`,
                    background: COR_VENCIDO,
                  }}
                />
              </div>
            </div>
            <SubNumeros>
              <SubNumero
                label="Com cobrança vencida"
                valor={data.clientesInadimplentes}
                ruim={data.clientesInadimplentes > 0}
                hint="clientes no período"
              />
              <SubNumero
                label="Total com cobrança"
                valor={data.clientesComCobranca}
                hint="base de comparação"
              />
              <SubNumero
                label="Inadimplência por cliente"
                valor={formatPercent(data.percentInadimplenciaClientes)}
                hint={`${data.clientesInadimplentes} de ${data.clientesComCobranca}`}
              />
            </SubNumeros>
          </div>
        </div>
      </div>

      {devedores.length === 0 && data.clientesInadimplentes === 0 && (
        <div className="rounded-md border border-success/30 bg-success-bg px-4 py-3 dark:border-success/30">
          <p className="text-sm text-success-fg">
            Nenhum cliente inadimplente no período.
          </p>
        </div>
      )}
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-3.5">
      <div className="h-14 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-2.5 sm:grid-cols-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-[62px] animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="h-[366px] animate-pulse rounded-md bg-muted lg:col-span-2" />
        <div className="h-[366px] animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}
