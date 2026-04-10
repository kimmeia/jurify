import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Settings, Heart, Server, CreditCard, Shield, Globe, Clock,
  CheckCircle2, XCircle, AlertTriangle, Cpu, HardDrive,
  MessageSquare, Users, Building2, Radio, Bot, UserCheck,
  Radar, KeyRound, Coins, Activity,
} from "lucide-react";

function HealthIcon({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "erro") return <XCircle className="h-4 w-4 text-destructive" />;
  return <AlertTriangle className="h-4 w-4 text-amber-500" />;
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function CanalStatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    conectado: { cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25", label: "Conectado" },
    desconectado: { cls: "bg-gray-500/15 text-gray-600 border-gray-500/25", label: "Desconectado" },
    pendente: { cls: "bg-amber-500/15 text-amber-700 border-amber-500/25", label: "Pendente" },
    erro: { cls: "bg-red-500/15 text-red-700 border-red-500/25", label: "Erro" },
    banido: { cls: "bg-red-500/15 text-red-700 border-red-500/25", label: "Banido" },
  };
  const cfg = map[status] || { cls: "", label: status };
  return <Badge className={`${cfg.cls} hover:${cfg.cls} text-[10px] font-normal`}>{cfg.label}</Badge>;
}

export default function AdminSettings() {
  const { data: health, isLoading: loadHealth } = trpc.admin.systemHealth.useQuery(undefined, { retry: false });
  const { data: planos, isLoading: loadPlanos } = trpc.admin.planosAtuais.useQuery(undefined, { retry: false });
  const { data: ops, isLoading: loadOps } = trpc.admin.operacional.useQuery(undefined, { retry: false });
  const { data: juditKpis } = (trpc as any).adminJudit?.kpis?.useQuery?.(undefined, { refetchInterval: 30000 }) || { data: undefined };

  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Configurações</h1>
        <p className="text-muted-foreground mt-1">Saúde do sistema, planos, e visão operacional.</p>
      </div>

      {/* Saúde do Sistema */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Heart className="h-4 w-4 text-muted-foreground" />
            Saúde do sistema
          </CardTitle>
          <CardDescription>Status de serviços e variáveis de ambiente essenciais.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadHealth ? (
            <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : health ? (
            <div className="space-y-4">
              {/* System info mini cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Uptime</p>
                    <p className="font-medium">{formatUptime(health.uptime)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Node.js</p>
                    <p className="font-medium">{health.nodeVersion}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Memória</p>
                    <p className="font-medium">{health.memoryMB} MB</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Planos</p>
                    <p className="font-medium">{health.plansCount}</p>
                  </div>
                </div>
              </div>

              {/* Health checks */}
              <div className="space-y-1.5">
                {health.checks.map((check) => (
                  <div key={check.nome} className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/30">
                    <div className="flex items-center gap-2.5">
                      <HealthIcon status={check.status} />
                      <span className="text-sm font-medium">{check.nome}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{check.detalhe}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Planos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              Planos ativos
            </CardTitle>
            <CardDescription>Planos configurados no sistema (código fonte).</CardDescription>
          </CardHeader>
          <CardContent>
            {loadPlanos ? (
              <Skeleton className="h-32 w-full" />
            ) : planos && planos.length > 0 ? (
              <div className="space-y-3">
                {planos.map((p) => (
                  <div key={p.id} className="border rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{p.name}</span>
                      <Badge variant="outline" className="text-[10px]">{p.id}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                    <div className="flex gap-4 text-xs">
                      <span>Mensal: <span className="font-medium">{formatCurrency(p.priceMonthly)}</span></span>
                      <span>Anual: <span className="font-medium">{formatCurrency(p.priceYearly)}</span></span>
                      <span>Créditos: <span className="font-medium">{p.creditsPerMonth >= 999999 ? "Ilimitado" : p.creditsPerMonth}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum plano configurado.</p>
            )}
          </CardContent>
        </Card>

        {/* Operacional */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              Visão operacional
            </CardTitle>
            <CardDescription>Escritórios, canais, conversas e agentes.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadOps ? (
              <Skeleton className="h-32 w-full" />
            ) : ops ? (
              <div className="space-y-4">
                {/* Counters */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="h-4 w-4 text-blue-500" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Escritórios</p>
                      <p className="font-bold">{ops.escritorios}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <UserCheck className="h-4 w-4 text-emerald-500" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Colaboradores</p>
                      <p className="font-bold">{ops.colaboradores}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-violet-500" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Contatos</p>
                      <p className="font-bold">{ops.contatos}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <MessageSquare className="h-4 w-4 text-amber-500" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Conversas</p>
                      <p className="font-bold">{ops.conversas.total}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Globe className="h-4 w-4 text-pink-500" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Leads</p>
                      <p className="font-bold">{ops.leads.total}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Bot className="h-4 w-4 text-teal-500" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Agentes IA</p>
                      <p className="font-bold">{ops.agentesIa}</p>
                    </div>
                  </div>
                </div>

                {/* Conversas breakdown */}
                {ops.conversas.total > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Conversas: {ops.conversas.aguardando} aguardando, {ops.conversas.em_atendimento} em atendimento
                  </div>
                )}

                {/* Canais */}
                {ops.canais.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Canais integrados</p>
                    {ops.canais.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/30">
                        <div className="flex items-center gap-2">
                          <Radio className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{c.nome || c.tipo}</span>
                          {c.telefone && <span className="text-xs text-muted-foreground font-mono">{c.telefone}</span>}
                        </div>
                        <CanalStatusBadge status={c.status} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Leads por etapa */}
                {ops.leads.total > 0 && Object.keys(ops.leads.porEtapa).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Funil de leads</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(ops.leads.porEtapa).map(([etapa, count]) => (
                        <span key={etapa} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {etapa}: {count as number}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
      {/* Saúde Judit */}
      {juditKpis && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Radar className="h-4 w-4 text-indigo-500" />
              Integração Judit.IO
              <Badge variant="outline" className="text-[9px] ml-2 gap-1">
                <Activity className="h-2.5 w-2.5 text-emerald-500 animate-pulse" /> Tempo real
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Coins className="h-3 w-3" /> Créditos
                </div>
                <p className="text-lg font-bold">{(juditKpis.creditos?.saldoTotal || 0).toLocaleString("pt-BR")}</p>
                <p className="text-[10px] text-muted-foreground">
                  saldo total · {juditKpis.creditos?.escritoriosComCredito || 0} escritórios
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Radar className="h-3 w-3" /> Monitoramentos
                </div>
                <p className="text-lg font-bold">{juditKpis.monitoramentos?.ativos || 0}</p>
                <p className="text-[10px] text-muted-foreground">
                  ativos · {juditKpis.monitoramentos?.pausados || 0} pausados
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <KeyRound className="h-3 w-3" /> Credenciais
                </div>
                <p className="text-lg font-bold">{juditKpis.credenciais?.ativas || 0}</p>
                <p className="text-[10px] text-muted-foreground">
                  ativas · {juditKpis.credenciais?.erro || 0} com erro
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3 w-3" /> Alertas
                </div>
                <p className={`text-lg font-bold ${juditKpis.creditos?.escritoriosSaldoBaixo > 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {juditKpis.creditos?.escritoriosSaldoBaixo || 0}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  escritórios saldo &lt;10 · 24h: -{juditKpis.ultimas24h?.creditosConsumidos || 0} cred
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
