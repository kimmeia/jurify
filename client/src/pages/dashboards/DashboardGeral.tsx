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
  FaixaAcoes,
  LinhaLista,
  ListaCard,
  PainelTopo,
  PulseDot,
  SubNumero,
  SubNumeros,
  formatBRL,
  formatBRLShort,
  formatPercent,
  formatDataCurta,
} from "./common";

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
  pagamento: { icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50" },
  mensagem: { icon: MessageCircle, color: "text-blue-600", bg: "bg-blue-50" },
  movimentacao: { icon: Gavel, color: "text-indigo-600", bg: "bg-indigo-50" },
  tarefa: { icon: CheckSquare, color: "text-violet-600", bg: "bg-violet-50" },
  agendamento: { icon: CalendarDays, color: "text-amber-600", bg: "bg-amber-50" },
  lead: { icon: TrendingUp, color: "text-rose-600", bg: "bg-rose-50" },
};

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
  const { data: clientesStats } = (trpc as any).clientes?.estatisticas?.useQuery?.(
    undefined,
    { enabled: !!user, retry: false, refetchInterval: 60_000 },
  ) || { data: null };
  const aguardandoDocs: number = clientesStats?.aguardandoDocumentacao ?? 0;

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
  const inadimplentes: number = clientesStats?.inadimplentes ?? 0;

  const recebido = cashFlow?.totalRecebido ?? 0;
  const pendente = cashFlow?.totalPendente ?? 0;
  const vencido = cashFlow?.totalVencido ?? 0;

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
          <AcaoCard
            icone={CalendarDays}
            valor={totalHoje}
            label={totalHoje === 1 ? "compromisso hoje" : "compromissos hoje"}
            onClick={() => nav("/agenda")}
          />
        </FaixaAcoes>
      )}

      <div className="grid gap-3.5 lg:grid-cols-3">
        {/* ═══════════ DINHEIRO ═══════════ */}
        <div className="flex flex-col gap-3.5 lg:col-span-2">
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
                <div className="h-[168px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cashFlow.pontos} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="serieRecebido" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2a78d6" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#2a78d6" stopOpacity={0.02} />
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
                        tickFormatter={(v) => formatBRLShort(v)}
                        tickLine={false}
                        axisLine={false}
                        width={62}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: "10px",
                          fontSize: "12px",
                          color: "var(--popover-foreground)",
                        }}
                        labelFormatter={(d) => formatDataCurta(d)}
                        formatter={(v: number) => [formatBRL(v), "Recebido"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="recebido"
                        stroke="#2a78d6"
                        strokeWidth={2}
                        fill="url(#serieRecebido)"
                        name="Recebido"
                        dot={{ r: 3, fill: "#fff", stroke: "#2a78d6", strokeWidth: 2 }}
                        activeDot={{ r: 5, fill: "#2a78d6", stroke: "#fff", strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
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
                hint={ok ? `${r.pipeline.leadsAbertos} leads em negociação` : undefined}
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
                hint={inadimplentes > 0 ? `${inadimplentes} clientes inadimplentes` : undefined}
              />
              <SubNumero
                label="Pipeline aberto"
                valor={ok ? formatBRL(r.pipeline.valorPipeline) : "—"}
                hint={ok ? `${r.pipeline.leadsAbertos} leads em negociação` : undefined}
              />
            </SubNumeros>
          </BlocoPrincipal>

        {/* Últimas movimentações do acervo */}
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-slate-600" />
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

        {/* ═══════════ O DIA ═══════════ */}
        <div className="flex min-h-0 flex-col gap-3.5">
          {ok && (
            <ListaCard
              titulo="Hoje"
              acaoLabel="Ver agenda"
              onAcao={() => nav("/agenda")}
              esticar
              rodape={
                <>
                  <span>
                    {r.agenda.compromissosHoje.length} compromissos · {r.agenda.tarefasHoje.length} tarefas
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
                      cor={c.cor || "#2a78d6"}
                      quando={c.hora}
                      texto={c.titulo}
                      onClick={() => nav("/agenda")}
                    />
                  ))}
                  {r.agenda.tarefasHoje.map((t: any) => (
                    <LinhaLista
                      key={`t-${t.id}`}
                      cor="#eda100"
                      quando="—"
                      texto={t.titulo}
                      onClick={() => nav("/tarefas")}
                    />
                  ))}
                </>
              )}
            </ListaCard>
          )}

          {/* Créditos */}
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-500" />
                Créditos de cálculo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isUnlimited ? (
                <div className="flex items-center gap-3">
                  <div className="h-2 w-full rounded-full bg-emerald-100">
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
                      <b className="text-slate-900">{creditsUsed}</b> usados de{" "}
                      <b className="text-slate-900">{creditsTotal}</b>
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      <b className="text-slate-900">{creditsRemaining}</b> restante(s)
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

