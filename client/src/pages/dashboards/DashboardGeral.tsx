/**
 * Dashboard GERAL — visão consolidada pra dono/admin.
 *
 * Aplica o mesmo padrão visual dos painéis setoriais (hero card com
 * gradient, KPI cards modernos, avatares no feed) mas com tema "geral"
 * (slate executive) e dados agregados do escritório inteiro.
 *
 * Diferente dos painéis setoriais, aqui mostramos VALORES (R$ recebido,
 * vencido, pipeline) pra que o dono enxergue a saúde financeira de uma
 * vez só.
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp,
  ArrowRight,
  DollarSign,
  MessageCircle,
  CheckSquare,
  Gavel,
  AlertTriangle,
  Activity,
  Sparkles,
  CalendarDays,
} from "lucide-react";
import { useLocation } from "wouter";
import { moduloOcultoNoMenu } from "@/config/visibility";
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
  FaixaSemana,
  LinhaLista,
  ListaCard,
  PainelTopo,
  PulseDot,
  SubNumero,
  SubNumeros,
  formatBRL,
  formatEixoValor,
  formatPercent,
  formatDataCurta,
} from "./common";

/** Vencido no gráfico. Segunda matiz da paleta de visualização do app —
 *  passa na checagem de daltonismo em par com a primeira, que é o recebido. */
const COR_VENCIDO = "var(--viz-2)";

// ─── Rota com fallback (módulos podem estar ocultos) ─────────────────────────

function rotaSegura(rotaOriginal: string, fallback: string): string {
  if (rotaOriginal.startsWith("/atendimento") && moduloOcultoNoMenu("atendimento")) return fallback;
  if (rotaOriginal.startsWith("/calculos") && moduloOcultoNoMenu("calculos")) return fallback;
  if (rotaOriginal.startsWith("/smartflow") && moduloOcultoNoMenu("smartflow")) return fallback;
  if (rotaOriginal.startsWith("/agentes-ia") && moduloOcultoNoMenu("agentesIa")) return fallback;
  return rotaOriginal;
}

function formatRelative(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

const ACTIVITY_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  // Cada fundo precisa do par escuro: sem ele são seis quadradinhos claros
  // acesos em cima de um card escuro.
  pagamento: { icon: DollarSign, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40" },
  mensagem: { icon: MessageCircle, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/40" },
  movimentacao: { icon: Gavel, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-950/40" },
  tarefa: { icon: CheckSquare, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/40" },
  agendamento: { icon: CalendarDays, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40" },
  lead: { icon: TrendingUp, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/40" },
};

/** Legenda das séries do gráfico. Duas linhas no mesmo eixo sem legenda
 *  obrigam a pessoa a adivinhar qual cor é o quê. */
function LegendaSerie({ cor, rotulo }: { cor: string; rotulo: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-[3px] w-3.5 rounded-full" style={{ background: cor }} />
      {rotulo}
    </span>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function DashboardGeral() {
  const { user } = useAuth();
  const [, nav] = useLocation();

  // Dashboard mostra SEMPRE o mês civil corrente (dia 1 até hoje). Pra ver
  // outros períodos, o usuário vai em /relatorios — esta tela é "visão do
  // mês" e não tem seletor de range. O range é calculado no servidor, no fuso
  // do escritório, pra não depender do relógio do browser (que fazia o gráfico
  // "pular o dia 1" perto da virada de dia em UTC).

  const { data: credits } = trpc.dashboard.credits.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });
  const { data: r } = trpc.dashboard.resumoEscritorio.useQuery(undefined, {
    enabled: !!user,
    retry: false,
    refetchInterval: 60_000,
  });
  const { data: cashFlow } = trpc.dashboard.cashFlow.useQuery(
    undefined,
    { enabled: !!user, retry: false, refetchInterval: 120_000 },
  );
  const { data: feed } = trpc.dashboard.activityFeed.useQuery(
    { limit: 5 },
    { enabled: !!user, retry: false, refetchInterval: 30_000 },
  );

  const creditsUsed = credits?.creditsUsed ?? 0;
  const creditsTotal = credits?.creditsTotal ?? 50;
  const creditsRemaining = credits?.creditsRemaining ?? creditsTotal;
  const isUnlimited = creditsTotal >= 999_999;
  const ok = !!r;

  const totalHoje = ok ? r.agenda.totalHojeCount : 0;
  // Contagens reais do dia. As listas vêm com LIMIT 5 — usar `.length` delas
  // fazia o rodapé do card dizer "5 compromissos" embaixo de um card que
  // dizia "12 hoje".
  const compromissosHoje = ok ? r.agenda.compromissosHojeCount : 0;
  const tarefasHoje = ok ? r.agenda.tarefasHojeCount : 0;
  const naListaHoje = ok ? r.agenda.compromissosHoje.length + r.agenda.tarefasHoje.length : 0;
  const foraDaLista = Math.max(0, totalHoje - naListaHoje);

  const recebido = cashFlow?.totalRecebido ?? 0;
  const pendente = cashFlow?.totalPendente ?? 0;
  const vencido = cashFlow?.totalVencido ?? 0;
  // Contagens do MESMO recorte do valor ao lado. Antes o hint de "vencido no
  // período" trazia o total de inadimplentes de todos os tempos, de outra
  // procedure — dois recortes lado a lado lidos como um só.
  const cobrancasPendentes = cashFlow?.cobrancasPendentes ?? 0;
  const clientesVencidos = cashFlow?.clientesVencidos ?? 0;
  const temVencidoNoGrafico = (cashFlow?.pontos ?? []).some((p) => p.vencido > 0);

  // Variação aproximada: saldo (recebido - vencido). Positiva se receita
  // supera inadimplência, negativa caso contrário. Não é variação MoM
  // (precisaria de segunda query) — fica como sinalizador grosseiro.
  const saldoLiquido = recebido - vencido;
  const taxaInadimplencia = recebido + vencido > 0
    ? +((vencido / (recebido + vencido)) * 100).toFixed(1)
    : 0;
  const nomeUser = user?.name?.split(" ")[0] || "Usuário";
  const dataInicio = cashFlow?.pontos[0]?.data;
  const dataFim = cashFlow?.pontos[cashFlow.pontos.length - 1]?.data;
  // Nome do mês deriva do início do range (já no fuso do escritório) pra bater
  // com o período exibido; antes de carregar, cai no mês local como fallback.
  const nomeMesAtual = new Intl.DateTimeFormat("pt-BR", { month: "long" })
    .format(dataInicio ? new Date(`${dataInicio}T12:00:00`) : new Date())
    .replace(/^./, (c) => c.toUpperCase());
  // Data do cabeçalho do calendário. Vem do dia marcado como "hoje" na faixa
  // da semana (calculado no servidor) pra não divergir dele quando o relógio
  // do browser está em outro fuso.
  const diaDeHoje = ok ? r.agenda.semana?.find((d) => d.hoje)?.data : undefined;
  const dataPorExtenso = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  })
    .format(diaDeHoje ? new Date(`${diaDeHoje}T12:00:00`) : new Date())
    .replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="space-y-3.5">
      <PainelTopo
        titulo={`Bom dia, ${nomeUser}`}
        subtitulo={
          dataInicio && dataFim ? (
            <span className="tabular-nums">
              Painel geral · {formatDataCurta(dataInicio)} a {formatDataCurta(dataFim)}
            </span>
          ) : (
            `Painel geral · ${nomeMesAtual}`
          )
        }
        acao={
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => nav("/relatorios")}>
            Ver outros períodos
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        }
      />

      {/* ═══════════ O QUE PRECISA DE VOCÊ ═══════════
          Cada número aparece UMA vez, aqui, onde dá pra agir sobre ele. Antes
          eles se repetiam nos chips coloridos E nos cards de contexto E nos
          KPIs, em cinco cores de mesmo peso. */}
      {ok && (
        <FaixaAcoes>
          {r.agenda.atrasados > 0 && (
            <AcaoCard
              icone={AlertTriangle}
              valor={r.agenda.atrasados}
              label="compromissos atrasados"
              critico
              onClick={() => nav("/agenda")}
            />
          )}
          {r.crm.conversasAguardando > 0 && (
            <AcaoCard
              icone={MessageCircle}
              valor={r.crm.conversasAguardando}
              label="conversas aguardando"
              onClick={() => nav(rotaSegura("/atendimento", "/clientes"))}
            />
          )}
          {r.processos.movimentacoesNaoLidas > 0 && (
            <AcaoCard
              icone={Gavel}
              valor={r.processos.movimentacoesNaoLidas}
              label="movimentações novas"
              onClick={() => nav("/processos?tab=movimentacoes")}
            />
          )}
          {/* "compromissos hoje" mentia: o número soma compromissos E tarefas,
              e o card ao lado listava só cinco deles. */}
          <AcaoCard
            icone={CalendarDays}
            valor={totalHoje}
            label={totalHoje === 1 ? "item na agenda de hoje" : "itens na agenda de hoje"}
            onClick={() => nav("/agenda")}
          />
        </FaixaAcoes>
      )}

      {/* Grid de duas linhas em vez de duas COLUNAS empilhadas: assim o card
          da agenda tem a altura da linha — a mesma do card do gráfico — em vez
          de esticar até o fim da coluna inteira. */}
      <div className="grid gap-3.5 lg:grid-cols-3">
        {/* ═══════════ DINHEIRO ═══════════ */}
        <div className="lg:col-span-2">
          <BlocoPrincipal
            rotulo={`Recebido em ${nomeMesAtual.toLowerCase()}`}
            valor={formatBRL(recebido)}
            badge={
              saldoLiquido >= 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-bold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <TrendingUp className="h-3 w-3" />
                  Saldo positivo
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11.5px] font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  <AlertTriangle className="h-3 w-3" />
                  Saldo negativo
                </span>
              )
            }
            grafico={
              cashFlow && cashFlow.pontos.length > 0 ? (
                <>
                  <div className="flex items-center justify-end gap-3.5 px-2 pb-1 text-[10.5px] text-muted-foreground">
                    <LegendaSerie cor={COR_SERIE} rotulo="Recebido" />
                    <LegendaSerie cor={COR_VENCIDO} rotulo="Vencido" />
                  </div>
                  <div className="h-[168px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={cashFlow.pontos} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="serieRecebido" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COR_SERIE} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={COR_SERIE} stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="serieVencido" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COR_VENCIDO} stopOpacity={0.16} />
                            <stop offset="100%" stopColor={COR_VENCIDO} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        {/* Grade só horizontal e recessiva: linha vertical em
                            série temporal compete com os dados. */}
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
                          fill="url(#serieRecebido)"
                          name="Recebido"
                          dot={{ r: 3, fill: "var(--card)", stroke: COR_SERIE, strokeWidth: 2 }}
                          activeDot={{ r: 5, fill: COR_SERIE, stroke: "var(--card)", strokeWidth: 2 }}
                        />
                        {/* Vencido entra pelo dia do vencimento — mesma data em
                            que a linha do recebido responde "entrou quanto?".
                            Tracejada porque é dinheiro que NÃO entrou: sólida
                            do lado de uma sólida, as duas leem como receita. */}
                        <Area
                          type="monotone"
                          dataKey="vencido"
                          stroke={COR_VENCIDO}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          fill="url(#serieVencido)"
                          name="Vencido"
                          dot={false}
                          activeDot={{ r: 4, fill: COR_VENCIDO, stroke: "var(--card)", strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {!temVencidoNoGrafico && (
                    <p className="px-2 pt-1 text-right text-[10px] text-muted-foreground/70">
                      Nenhum vencimento em atraso caiu nos dias do período.
                    </p>
                  )}
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
                valor={formatBRL(pendente)}
                hint={
                  cobrancasPendentes > 0
                    ? `${cobrancasPendentes} ${cobrancasPendentes === 1 ? "cobrança" : "cobranças"} a vencer`
                    : undefined
                }
              />
              <SubNumero
                label="Vencido no período"
                valor={formatBRL(vencido)}
                ruim={vencido > 0}
                tag={
                  vencido > 0 ? (
                    <span className="rounded border border-rose-200 bg-rose-50 px-1.5 text-[10px] font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                      {formatPercent(taxaInadimplencia, 0)}
                    </span>
                  ) : undefined
                }
                hint={
                  clientesVencidos > 0
                    ? `${clientesVencidos} ${clientesVencidos === 1 ? "cliente" : "clientes"} no período`
                    : undefined
                }
              />
              <SubNumero
                label="Pipeline aberto"
                valor={ok ? formatBRL(r.pipeline.valorPipeline) : "—"}
                hint={
                  ok && r.pipeline.leadsAbertos > 0
                    ? `${r.pipeline.leadsAbertos} ${r.pipeline.leadsAbertos === 1 ? "lead" : "leads"} em negociação`
                    : undefined
                }
              />
            </SubNumeros>
          </BlocoPrincipal>
        </div>

        {/* ═══════════ O DIA ═══════════ */}
        {/* Fora do fluxo a partir de `lg`: assim quem define a altura da linha
            é o card do gráfico, e a agenda se ajusta a ele (rolando por
            dentro). No fluxo normal aconteceria o contrário — dez itens de
            agenda esticariam a linha e o card ficaria com o dobro da altura do
            vizinho, que é como estava. Abaixo de `lg` cada card fica na sua
            linha e a altura volta a ser a natural. */}
        <div className="relative min-h-0">
          <div className="lg:absolute lg:inset-0">
          {ok && (
            <ListaCard
              titulo="Agenda de hoje"
              subtitulo={dataPorExtenso}
              acaoLabel="Ver agenda"
              onAcao={() => nav("/agenda")}
              esticar
              topo={
                <FaixaSemana
                  dias={r.agenda.semana ?? []}
                  onDia={(d) => nav(`/agenda?data=${d}`)}
                />
              }
              rodape={
                <>
                  <span>
                    {compromissosHoje} {compromissosHoje === 1 ? "compromisso" : "compromissos"} ·{" "}
                    {tarefasHoje} {tarefasHoje === 1 ? "tarefa" : "tarefas"}
                  </span>
                  {r.agenda.atrasados > 0 && (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      {r.agenda.atrasados} atrasados
                    </span>
                  )}
                </>
              }
            >
              {totalHoje === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-muted-foreground">Dia tranquilo.</p>
              ) : (
                <>
                  {r.agenda.compromissosHoje.map((c: any) => (
                    <LinhaLista
                      key={`c-${c.id}`}
                      cor={c.cor || COR_SERIE}
                      quando={c.hora}
                      texto={c.titulo}
                      onClick={() => nav("/agenda")}
                    />
                  ))}
                  {r.agenda.tarefasHoje.map((t: any) => (
                    <LinhaLista
                      key={`t-${t.id}`}
                      cor="var(--viz-4)"
                      quando="—"
                      texto={t.titulo}
                      onClick={() => nav("/tarefas")}
                    />
                  ))}
                  {/* As listas vêm com LIMIT 5. Sem esta linha o card mostrava
                      cinco itens embaixo de um contador que dizia doze. */}
                  {foraDaLista > 0 && (
                    <button
                      onClick={() => nav("/agenda")}
                      className="mx-2 mt-1 rounded-md px-2 py-1.5 text-left text-[11.5px] font-semibold text-violet-600 hover:bg-accent dark:text-violet-400"
                    >
                      + {foraDaLista} {foraDaLista === 1 ? "item" : "itens"} na agenda de hoje
                    </button>
                  )}
                </>
              )}
            </ListaCard>
          )}
          </div>
        </div>

        {/* Últimas movimentações do acervo */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  Atividade recente
                </CardTitle>
                <PulseDot />
              </div>
            </CardHeader>
            <CardContent>
              {!feed || feed.length === 0 ? (
                <div className="text-center py-8">
                  <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">Nenhuma atividade recente.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {feed.slice(0, 5).map((item: any) => {
                    const cfg = ACTIVITY_ICONS[item.tipo] || ACTIVITY_ICONS.mensagem;
                    const Icon = cfg.icon;
                    return (
                      <div
                        key={item.id}
                        onClick={() => item.link && nav(item.link)}
                        className="flex items-start gap-3 group cursor-pointer"
                      >
                        <div className={`h-9 w-9 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                          <Icon className={`h-4 w-4 ${cfg.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate group-hover:text-primary">
                            {item.titulo}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {item.descricao}
                          </p>
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5 tabular-nums">
                            {formatRelative(item.timestamp)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Créditos */}
        <div className="lg:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-500" />
                Créditos de cálculo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isUnlimited ? (
                <div className="flex items-center gap-3">
                  <div className="h-2 w-full rounded-full bg-emerald-100 dark:bg-emerald-950/50">
                    <div className="h-2 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 w-full" />
                  </div>
                  <span className="text-xs text-emerald-600 font-semibold whitespace-nowrap">
                    ∞ Ilimitado
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground tabular-nums">
                      <b className="text-foreground">{creditsUsed}</b> usados de{" "}
                      <b className="text-foreground">{creditsTotal}</b>
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      <b className="text-foreground">{creditsRemaining}</b> restante(s)
                    </span>
                  </div>
                  <Progress
                    value={
                      creditsTotal > 0
                        ? Math.min(100, Math.round((creditsUsed / creditsTotal) * 100))
                        : 0
                    }
                    className="h-2"
                  />
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

