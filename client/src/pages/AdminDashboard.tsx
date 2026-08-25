import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CreditCard,
  TrendingDown,
  DollarSign,
  AlertCircle,
  Activity,
  Target,
  Zap,
  CheckCircle2,
  Hourglass,
} from "lucide-react";
import { useLocation } from "wouter";
import {
  HeroCard,
  KPICard,
  Avatar,
  formatBRL,
} from "./dashboards/common";

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

/** "vence qua 27", "vence hoje", "venceu há 2d" — a urgência em uma palavra. */
function venceLabel(quando: string | number | Date): string {
  const alvo = new Date(quando);
  const hoje = new Date();
  const dias = Math.floor((alvo.getTime() - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()) / 86_400_000);
  if (dias < 0) return dias === -1 ? "venceu ontem" : `venceu há ${-dias}d`;
  if (dias === 0) return "vence hoje";
  const dia = alvo.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" }).replace(".", "");
  return `vence ${dia}`;
}

interface PlanoResumo {
  slug: string;
  nome: string;
  precoSobConsulta: boolean;
  popular: boolean;
  oculto: boolean;
  assinantesAtivos: number;
  emTeste: number;
}

/** Cartão de alerta da faixa "Precisa de você". */
function AlertaCard({
  tom,
  selo,
  titulo,
  linhas,
  acaoLabel,
  onAcao,
}: {
  tom: "ambar" | "rosa";
  selo: string;
  titulo: string;
  linhas: Array<{ texto: React.ReactNode; direita?: string }>;
  acaoLabel: string;
  onAcao: () => void;
}) {
  const borda = tom === "ambar" ? "border-l-amber-500" : "border-l-rose-500";
  const pill =
    tom === "ambar"
      ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
      : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800";
  return (
    <Card className={`border-l-4 ${borda}`}>
      <CardContent className="pt-4 pb-4 space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[10px] font-bold ${pill}`}>{selo}</Badge>
          <span className="text-sm font-bold">{titulo}</span>
          <button
            className="ml-auto text-xs font-semibold text-violet-700 dark:text-violet-400 hover:underline whitespace-nowrap"
            onClick={onAcao}
          >
            {acaoLabel} →
          </button>
        </div>
        {linhas.map((l, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{l.texto}</span>
            {l.direita && <span className="ml-auto text-[11px] text-muted-foreground/70 whitespace-nowrap">{l.direita}</span>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Faixa "Precisa de você": só existe quando existe pendência. Testes grátis
 * vencendo = a hora de fechar a venda; inadimplência e erros = o que não
 * pode ficar parado. Sem nada, a faixa vira "tudo em dia".
 */
function PrecisaDeVoce() {
  const [, setLocation] = useLocation();
  const pendencias = trpc.admin.pendenciasDashboard.useQuery(undefined, { retry: false });
  const inadimplentes = trpc.admin.listarInadimplentes.useQuery(undefined, { retry: false });
  // Mesma query (mesmo cache) do badge do menu e da Saúde do sistema.
  const erros = trpc.adminErros.listar.useQuery(
    { status: "unresolved", limite: 25, pagina: 1 },
    { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: false },
  );

  const carregando = pendencias.isLoading || inadimplentes.isLoading || erros.isLoading;
  const trials = pendencias.data?.trialsVencendo ?? [];
  const inad = inadimplentes.data ?? [];
  const errosAbertos = erros.data?.configurado ? (erros.data?.total ?? 0) : 0;
  const totalPendencias = (trials.length > 0 ? 1 : 0) + (inad.length > 0 ? 1 : 0) + (errosAbertos > 0 ? 1 : 0);

  if (carregando) return <Skeleton className="h-28 w-full rounded-xl" />;

  if (totalPendencias === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20">
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm text-emerald-900 dark:text-emerald-200">
            <span className="font-semibold">Tudo em dia.</span> Nenhum teste grátis vencendo,
            sem inadimplência e sem erros abertos.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Precisa de você · {totalPendencias} {totalPendencias === 1 ? "pendência" : "pendências"}
      </p>
      <div className="grid gap-3 lg:grid-cols-3">
        {trials.length > 0 && (
          <AlertaCard
            tom="ambar"
            selo="VENCE ESTA SEMANA"
            titulo={`${trials.length} ${trials.length === 1 ? "teste grátis" : "testes grátis"}`}
            acaoLabel="ver clientes"
            onAcao={() => setLocation("/admin/clients")}
            linhas={[
              ...trials.slice(0, 2).map((t) => ({
                texto: (
                  <>
                    <b className="font-semibold text-foreground">{t.userName || t.userEmail}</b> · {t.planNome}
                  </>
                ),
                direita: t.trialExpiraEm ? venceLabel(t.trialExpiraEm) : undefined,
              })),
              ...(trials.length > 2
                ? [{ texto: <span className="text-muted-foreground/70">+{trials.length - 2} outros</span> }]
                : [{ texto: <span className="text-muted-foreground/70">chame no WhatsApp antes de vencer — é a hora de fechar</span> }]),
            ]}
          />
        )}
        {inad.length > 0 && (
          <AlertaCard
            tom="rosa"
            selo="INADIMPLENTE"
            titulo={`${inad.length} ${inad.length === 1 ? "cliente" : "clientes"}`}
            acaoLabel="abrir Inadimplência"
            onAcao={() => setLocation("/admin/financeiro?aba=inadimplencia")}
            linhas={inad.slice(0, 3).map((c) => ({
              texto: (
                <>
                  <b className="font-semibold text-foreground">{c.userName || c.userEmail}</b> · {c.planName}
                </>
              ),
            }))}
          />
        )}
        {errosAbertos > 0 && (
          <AlertaCard
            tom="rosa"
            selo="SISTEMA"
            titulo={`${errosAbertos} ${errosAbertos === 1 ? "erro aberto" : "erros abertos"}`}
            acaoLabel="abrir Saúde"
            onAcao={() => setLocation("/admin/saude?aba=erros")}
            linhas={(erros.data?.issues ?? []).slice(0, 3).map((i: any) => ({
              texto: <span className="truncate">{i.titulo}</span>,
            }))}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Assinantes por plano, direto do catálogo — plano novo entra sozinho.
 * Os ocultos com assinantes viram um resumo "fora da vitrine".
 */
function AssinantesPorPlano() {
  const { data: planos, isLoading } = (trpc as any).admin.listarPlanosEditaveis.useQuery();
  const lista: PlanoResumo[] = planos ?? [];
  const naVitrine = lista.filter((p) => !p.oculto);
  const antigos = lista.filter((p) => p.oculto && (p.assinantesAtivos > 0 || p.emTeste > 0));

  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Assinantes por plano
      </p>
      {isLoading ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {naVitrine.map((p) => (
            <Card key={p.slug}>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-bold">{p.nome}</span>
                  {p.precoSobConsulta && (
                    <Badge variant="outline" className="text-[9px] font-bold border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                      SOB CONSULTA
                    </Badge>
                  )}
                  {p.popular && (
                    <Badge variant="outline" className="text-[9px] font-bold border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      ★ POPULAR
                    </Badge>
                  )}
                </div>
                <div className="mt-3 flex items-baseline gap-6">
                  <div>
                    <p className="text-xl font-bold tabular-nums">{p.assinantesAtivos}</p>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">assinando</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold tabular-nums text-violet-700 dark:text-violet-400">{p.emTeste}</p>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">em teste</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {antigos.length > 0 && (
            <Card className="border-dashed bg-muted/40">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-muted-foreground">Planos antigos</span>
                  <Badge variant="outline" className="text-[9px] font-bold">FORA DA VITRINE</Badge>
                </div>
                <div className="mt-2.5 space-y-1">
                  {antigos.map((p) => (
                    <div key={p.slug} className="flex justify-between text-xs text-muted-foreground">
                      <span>{p.nome}</span>
                      <span className="font-semibold text-foreground tabular-nums">
                        {p.assinantesAtivos + p.emTeste}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = trpc.admin.stats.useQuery(undefined, {
    retry: false,
  });

  const { data: churn, isLoading: churnLoading } = trpc.admin.metricasChurn.useQuery(undefined, {
    retry: false,
  });

  const { data: recentUsers, isLoading: usersLoading } = trpc.admin.recentUsers.useQuery(undefined, {
    retry: false,
  });

  const { data: recentSubs, isLoading: subsLoading } = trpc.admin.recentSubscriptions.useQuery(undefined, {
    retry: false,
  });

  const { data: pendencias } = trpc.admin.pendenciasDashboard.useQuery(undefined, { retry: false });

  const now = new Date();
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);

  const mrr = stats?.mrr ?? 0;
  const arr = mrr * 12;
  const assinantesPagantes = stats?.activeSubscriptions ?? 0;
  const ticketMedio = assinantesPagantes > 0 ? mrr / assinantesPagantes : 0;
  const conversao = stats?.conversionRate ?? 0;
  const retencao = churn?.retencao12m ?? 0;
  const emTeste = stats?.trialingSubscriptions ?? 0;
  const vencendo = pendencias?.trialsVencendo?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* ─── O que precisa de ação vem antes de qualquer número ─── */}
      <PrecisaDeVoce />

      {/* ─── Hero executivo ─── */}
      {statsLoading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : (
        <HeroCard
          tema="geral"
          setorLabel="Plataforma · Visão consolidada"
          periodo={{ dataInicio: ymd(inicioMes), dataFim: ymd(now) }}
          badgeDireito={
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white/15 border border-white/20">
              <Zap className="h-3.5 w-3.5" /> Tempo real
            </span>
          }
          tituloPrincipal="Receita recorrente mensal (MRR)"
          valorPrincipal={formatBRL(mrr / 100)}
          legenda={
            <>
              ARR projetado: {formatBRL(arr / 100)}
              {ticketMedio > 0 && <> · ticket médio {formatBRL(ticketMedio / 100)}/mês</>}
            </>
          }
          progresso={{
            valor: conversao,
            labelDir: <span>{conversao}%</span>,
          }}
          ringValue={retencao}
          ringLabel={`${retencao}%`}
          ringSublabel="Retenção 12m"
          decoracaoIcon={Activity}
        />
      )}

      {/* ─── KPI cards ─── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Receita mensal (MRR)"
          value={statsLoading ? <Skeleton className="h-7 w-24" /> : formatBRL(mrr / 100)}
          icon={DollarSign}
          iconBg="bg-emerald-500/10"
          iconFg="text-emerald-600 dark:text-emerald-400"
        />
        <KPICard
          label="Assinaturas pagas"
          value={statsLoading ? <Skeleton className="h-7 w-16" /> : assinantesPagantes}
          icon={CreditCard}
          iconBg="bg-indigo-500/10"
          iconFg="text-indigo-600 dark:text-indigo-400"
          hint={
            (stats?.cortesiasAtivas ?? 0) > 0
              ? `cortesia não conta — ${stats?.cortesiasAtivas} ${(stats?.cortesiasAtivas ?? 0) === 1 ? "cortesia ativa" : "cortesias ativas"}`
              : "cortesia e teste grátis não contam"
          }
        />
        <KPICard
          label="Em teste grátis agora"
          value={statsLoading ? <Skeleton className="h-7 w-16" /> : emTeste}
          icon={Hourglass}
          iconBg="bg-violet-500/10"
          iconFg="text-violet-600 dark:text-violet-400"
          badge={
            vencendo > 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300">
                {vencendo} {vencendo === 1 ? "vence" : "vencem"} esta semana
              </span>
            ) : undefined
          }
        />
        <KPICard
          label="Conversão trial → pago"
          value={statsLoading ? <Skeleton className="h-7 w-16" /> : `${conversao}%`}
          icon={Target}
          iconBg="bg-amber-500/10"
          iconFg="text-amber-600 dark:text-amber-400"
          hint="Clientes com plano ativo"
        />
      </div>

      {/* ─── Assinantes por plano (dinâmico, direto do catálogo) ─── */}
      <AssinantesPorPlano />

      {/* ─── Churn & retenção ─── */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" /> Churn & retenção
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <KPICard
            label="Média móvel de cancelamentos"
            value={
              churnLoading ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                `${(churn?.churnAtual ?? 0).toFixed(2)}%`
              )
            }
            icon={TrendingDown}
            iconBg="bg-rose-500/10"
            iconFg="text-rose-600 dark:text-rose-400"
            valueColor={churnColor(churn?.churnAtual ?? 0)}
            hint="Churn (últimos 3 meses)"
          />
          <KPICard
            label="ARPU ÷ churn rate mensal"
            value={churnLoading ? <Skeleton className="h-7 w-28" /> : formatBRL((churn?.ltvEstimado ?? 0) / 100)}
            icon={Target}
            iconBg="bg-violet-500/10"
            iconFg="text-violet-600 dark:text-violet-400"
            hint="LTV estimado"
          />
          <KPICard
            label="Clientes antigos ainda ativos"
            value={churnLoading ? <Skeleton className="h-7 w-20" /> : `${retencao}%`}
            icon={Activity}
            iconBg="bg-indigo-500/10"
            iconFg="text-indigo-600 dark:text-indigo-400"
            hint="Retenção 12 meses"
          />
        </div>
      </div>

      {/* ─── Tabelas: últimas assinaturas + novos clientes ─── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="px-5 pt-5 pb-3 border-b border-border">
            <h3 className="text-base font-semibold text-foreground">Últimas assinaturas</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Assinaturas mais recentes na plataforma.
            </p>
          </div>
          <CardContent className="p-0">
            {subsLoading ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recentSubs && recentSubs.length > 0 ? (
              <ul className="divide-y divide-border">
                {recentSubs.map((sub) => (
                  <li key={sub.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar nome={sub.userName || "—"} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-foreground">
                        {sub.userName || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {sub.planName || "Sem plano"}
                      </p>
                    </div>
                    <SubscriptionStatusBadge status={sub.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState texto="Nenhuma assinatura encontrada." />
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 pt-5 pb-3 border-b border-border">
            <h3 className="text-base font-semibold text-foreground">Novos clientes</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Últimos clientes registados na plataforma.
            </p>
          </div>
          <CardContent className="p-0">
            {usersLoading ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recentUsers && recentUsers.length > 0 ? (
              <ul className="divide-y divide-border">
                {recentUsers.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar nome={u.name || u.email || "—"} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-foreground">
                        {u.name || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {u.email || "—"}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(u.createdAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState texto="Nenhum cliente encontrado." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function churnColor(rate: number): string {
  if (rate < 3) return "text-emerald-600 dark:text-emerald-400";
  if (rate < 7) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function EmptyState({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
      <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
      <p className="text-sm">{texto}</p>
    </div>
  );
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const variants: Record<
    string,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    active: { label: "Ativa", variant: "default" },
    trialing: { label: "Trial", variant: "secondary" },
    canceled: { label: "Cancelada", variant: "destructive" },
    past_due: { label: "Vencida", variant: "destructive" },
    incomplete: { label: "Incompleta", variant: "outline" },
    unpaid: { label: "Não paga", variant: "destructive" },
    paused: { label: "Pausada", variant: "secondary" },
  };

  const config = variants[status] || { label: status, variant: "outline" as const };

  return (
    <Badge variant={config.variant} className="text-[10px] shrink-0">
      {config.label}
    </Badge>
  );
}
