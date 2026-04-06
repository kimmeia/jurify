import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Calculator, Landmark, Building2, Briefcase, ShieldCheck, TrendingUp, Clock, FileText, Zap, ArrowRight, CreditCard, BarChart3, Headphones, CalendarDays, Settings, DollarSign, AlertTriangle, Users, MessageCircle, CheckSquare, Sun, Wallet, Scale, Bell, Gavel, Eye } from "lucide-react";
import { useLocation } from "wouter";

function formatBRL(v: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v); }
function formatDate(d: Date | string) { return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }); }

const PRIOR_DOT: Record<string, string> = { urgente: "bg-red-500", critica: "bg-red-500", alta: "bg-orange-400", normal: "bg-blue-400", baixa: "bg-gray-300" };
const TIPO_AGENDA: Record<string, string> = { prazo_processual: "Prazo", audiencia: "Audiencia", reuniao_comercial: "Reuniao", follow_up: "Follow-up", outro: "Outro" };
const tipoLabel: Record<string, string> = { bancario: "Bancario", trabalhista: "Trabalhista", imobiliario: "Imobiliario", previdenciario: "Previdenciario", atualizacao_monetaria: "Diversos" };
const tipoColor: Record<string, string> = { bancario: "bg-blue-100 text-blue-700", trabalhista: "bg-amber-100 text-amber-700", imobiliario: "bg-emerald-100 text-emerald-700", previdenciario: "bg-rose-100 text-rose-700", atualizacao_monetaria: "bg-teal-100 text-teal-700" };

export default function Dashboard() {
  const { user } = useAuth();
  const [, nav] = useLocation();
  const { data: subscription } = trpc.subscription.current.useQuery(undefined, { enabled: !!user, retry: false });
  const { data: stats } = trpc.dashboard.stats.useQuery(undefined, { enabled: !!user, retry: false });
  const { data: historico } = trpc.dashboard.historico.useQuery(undefined, { enabled: !!user, retry: false });
  const { data: credits } = trpc.dashboard.credits.useQuery(undefined, { enabled: !!user, retry: false });
  const { data: r } = trpc.dashboard.resumoEscritorio.useQuery(undefined, { enabled: !!user, retry: false, refetchInterval: 60000 });

  const creditsUsed = credits?.creditsUsed ?? 0;
  const creditsTotal = credits?.creditsTotal ?? 50;
  const creditsRemaining = credits?.creditsRemaining ?? creditsTotal;
  const isUnlimited = creditsTotal >= 999999;
  const ok = !!r;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ola, {user?.name?.split(" ")[0] || "Usuario"}</h1>
          <p className="text-muted-foreground mt-1">Resumo do seu dia e do escritorio.</p>
        </div>
        <div className="flex items-center gap-2">
          {ok && r.notificacoesNaoLidas > 0 && (
            <Badge variant="destructive" className="text-xs gap-1"><Bell className="h-3 w-3" />{r.notificacoesNaoLidas}</Badge>
          )}
          {subscription && <Badge variant={subscription.status === "active" ? "default" : "secondary"} className="text-xs">{subscription.status === "active" ? "Plano Ativo" : subscription.status}</Badge>}
        </div>
      </div>

      {/* Alertas urgentes */}
      {ok && (r.agenda.atrasados > 0 || r.crm.conversasAguardando > 0 || r.financeiro.vencido > 0 || r.processos.movimentacoesNaoLidas > 0) && (
        <div className="flex flex-wrap gap-2">
          {r.processos.movimentacoesNaoLidas > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 cursor-pointer hover:bg-blue-100" onClick={() => nav("/processos")}>
              <Gavel className="h-4 w-4 text-blue-600" /><span className="text-sm text-blue-700 font-medium">{r.processos.movimentacoesNaoLidas} movimentacao(oes) nova(s)</span><ArrowRight className="h-3 w-3 text-blue-400" />
            </div>
          )}
          {r.agenda.atrasados > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 cursor-pointer hover:bg-red-100" onClick={() => nav("/agenda")}>
              <AlertTriangle className="h-4 w-4 text-red-500" /><span className="text-sm text-red-700 font-medium">{r.agenda.atrasados} atrasado(s)</span><ArrowRight className="h-3 w-3 text-red-400" />
            </div>
          )}
          {r.crm.conversasAguardando > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 cursor-pointer hover:bg-amber-100" onClick={() => nav("/atendimento")}>
              <MessageCircle className="h-4 w-4 text-amber-500" /><span className="text-sm text-amber-700 font-medium">{r.crm.conversasAguardando} aguardando</span><ArrowRight className="h-3 w-3 text-amber-400" />
            </div>
          )}
          {r.financeiro.vencido > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 cursor-pointer hover:bg-red-100" onClick={() => nav("/financeiro")}>
              <DollarSign className="h-4 w-4 text-red-500" /><span className="text-sm text-red-700 font-medium">{formatBRL(r.financeiro.vencido)} vencido</span><ArrowRight className="h-3 w-3 text-red-400" />
            </div>
          )}
        </div>
      )}

      {/* KPIs */}
      {ok && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <Card className="cursor-pointer hover:shadow-sm" onClick={() => nav("/processos")}><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2"><Scale className="h-5 w-5 text-indigo-500" /><div><p className="text-xl font-bold">{r.processos.ativos}</p><p className="text-[10px] text-muted-foreground">Processos</p></div></div></CardContent></Card>
          <Card className="cursor-pointer hover:shadow-sm" onClick={() => nav("/agenda")}><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2"><Sun className="h-5 w-5 text-amber-500" /><div><p className="text-xl font-bold">{r.agenda.compromissosHoje.length + r.agenda.tarefasHoje.length}</p><p className="text-[10px] text-muted-foreground">Hoje</p></div></div></CardContent></Card>
          <Card className="cursor-pointer hover:shadow-sm" onClick={() => nav("/atendimento")}><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-blue-500" /><div><p className="text-xl font-bold">{r.crm.conversasAguardando + r.crm.conversasAbertas}</p><p className="text-[10px] text-muted-foreground">Conversas</p></div></div></CardContent></Card>
          <Card className="cursor-pointer hover:shadow-sm" onClick={() => nav("/atendimento")}><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-violet-500" /><div><p className="text-xl font-bold">{r.pipeline.leadsAbertos}</p><p className="text-[10px] text-muted-foreground">Leads</p></div></div></CardContent></Card>
          <Card className="cursor-pointer hover:shadow-sm" onClick={() => nav("/financeiro")}><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" /><div><p className="text-xl font-bold text-emerald-600">{formatBRL(r.financeiro.recebido)}</p><p className="text-[10px] text-muted-foreground">Recebido</p></div></div></CardContent></Card>
          <Card className="cursor-pointer hover:shadow-sm" onClick={() => nav("/financeiro")}><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2"><Clock className="h-5 w-5 text-amber-500" /><div><p className="text-xl font-bold text-amber-600">{formatBRL(r.financeiro.pendente)}</p><p className="text-[10px] text-muted-foreground">Pendente</p></div></div></CardContent></Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Coluna 1: Processos + Agenda */}
        <div className="space-y-6">
          {/* Movimentacoes recentes */}
          {ok && r.processos.ativos > 0 && (
            <Card>
              <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-sm font-medium flex items-center gap-2"><Gavel className="h-4 w-4 text-indigo-500" />Processos{r.processos.movimentacoesNaoLidas > 0 && <Badge variant="destructive" className="text-[9px] px-1.5 py-0">{r.processos.movimentacoesNaoLidas} nova(s)</Badge>}</CardTitle><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => nav("/processos")}>Ver<ArrowRight className="h-3 w-3 ml-1" /></Button></div></CardHeader>
              <CardContent>
                {r.processos.movimentacoesRecentes.length > 0 ? (
                  <div className="space-y-2.5">
                    {r.processos.movimentacoesRecentes.map((m: any) => (
                      <div key={m.id} className="flex items-start gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1.5 -mx-2" onClick={() => nav("/processos")}>
                        <Eye className="h-3 w-3 text-indigo-400 mt-1 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{m.nome}</p>
                          <p className="text-[10px] text-muted-foreground">{m.numeroCnj} {m.dataHora ? ` \u2022 ${formatDate(m.dataHora)}` : ""}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-3">{r.processos.ativos} processo(s) ativo(s), sem movimentacoes recentes.</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Agenda do dia */}
          {ok && (
            <Card>
              <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-sm font-medium flex items-center gap-2"><CalendarDays className="h-4 w-4 text-amber-500" />Agenda de hoje</CardTitle><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => nav("/agenda")}>Ver<ArrowRight className="h-3 w-3 ml-1" /></Button></div></CardHeader>
              <CardContent>
                {r.agenda.compromissosHoje.length === 0 && r.agenda.tarefasHoje.length === 0 ? (
                  <div className="text-center py-3"><Sun className="h-5 w-5 text-muted-foreground/30 mx-auto mb-1" /><p className="text-xs text-muted-foreground">Dia tranquilo.</p></div>
                ) : (
                  <div className="space-y-2">
                    {r.agenda.compromissosHoje.map((c: any) => (
                      <div key={`c-${c.id}`} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-muted/50 rounded px-2 -mx-2" onClick={() => nav("/agenda")}>
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: c.cor || "#3b82f6" }} />
                        <span className="text-xs font-mono text-muted-foreground shrink-0">{c.hora}</span>
                        <span className="text-sm truncate flex-1">{c.titulo}</span>
                      </div>
                    ))}
                    {r.agenda.tarefasHoje.map((t: any) => (
                      <div key={`t-${t.id}`} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-muted/50 rounded px-2 -mx-2" onClick={() => nav("/agenda")}>
                        <div className={`h-2 w-2 rounded-full shrink-0 ${PRIOR_DOT[t.prioridade] || "bg-blue-400"}`} />
                        <CheckSquare className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate flex-1">{t.titulo}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Creditos */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><CreditCard className="h-4 w-4 text-muted-foreground" />Creditos</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {isUnlimited ? (
                <div className="flex items-center gap-2"><div className="h-2 w-full rounded-full bg-emerald-100"><div className="h-2 rounded-full bg-emerald-500 w-full" /></div><span className="text-xs text-emerald-600 font-medium">Ilimitado</span></div>
              ) : (
                <><div className="flex justify-between text-xs text-muted-foreground"><span>{creditsUsed}/{creditsTotal}</span><span>{creditsRemaining} restante(s)</span></div><Progress value={creditsTotal > 0 ? Math.min(100, Math.round((creditsUsed / creditsTotal) * 100)) : 0} className="h-2" /></>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Coluna 2: Financeiro + Escritorio */}
        <div className="space-y-6">
          {ok && (
            <Card>
              <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-sm font-medium flex items-center gap-2"><DollarSign className="h-4 w-4 text-emerald-500" />Financeiro</CardTitle><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => nav("/financeiro")}>Ver<ArrowRight className="h-3 w-3 ml-1" /></Button></div></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-2 rounded-lg bg-emerald-50"><p className="text-lg font-bold text-emerald-600">{formatBRL(r.financeiro.recebido)}</p><p className="text-[10px] text-muted-foreground">Recebido</p></div>
                  <div className="p-2 rounded-lg bg-amber-50"><p className="text-lg font-bold text-amber-600">{formatBRL(r.financeiro.pendente)}</p><p className="text-[10px] text-muted-foreground">Pendente</p></div>
                  <div className="p-2 rounded-lg bg-red-50"><p className="text-lg font-bold text-red-600">{formatBRL(r.financeiro.vencido)}</p><p className="text-[10px] text-muted-foreground">Vencido</p></div>
                </div>
              </CardContent>
            </Card>
          )}

          {ok && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Escritorio</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/60" onClick={() => nav("/clientes")}><Users className="h-4 w-4 mx-auto text-blue-500 mb-1" /><p className="text-lg font-bold">{r.crm.totalContatos}</p><p className="text-[10px] text-muted-foreground">Contatos</p></div>
                  <div className="text-center p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/60" onClick={() => nav("/atendimento")}><MessageCircle className="h-4 w-4 mx-auto text-amber-500 mb-1" /><p className="text-lg font-bold">{r.crm.conversasAguardando}</p><p className="text-[10px] text-muted-foreground">Aguardando</p></div>
                  <div className="text-center p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/60" onClick={() => nav("/atendimento")}><TrendingUp className="h-4 w-4 mx-auto text-violet-500 mb-1" /><p className="text-lg font-bold">{r.pipeline.leadsAbertos}</p><p className="text-[10px] text-muted-foreground">Leads</p></div>
                  <div className="text-center p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/60" onClick={() => nav("/atendimento")}><Wallet className="h-4 w-4 mx-auto text-emerald-500 mb-1" /><p className="text-lg font-bold">{formatBRL(r.pipeline.valorPipeline)}</p><p className="text-[10px] text-muted-foreground">Pipeline</p></div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Calculos recentes */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" />Calculos recentes</CardTitle></CardHeader>
            <CardContent>
              {!historico || historico.length === 0 ? (
                <div className="text-center py-3"><Calculator className="h-5 w-5 text-muted-foreground/30 mx-auto mb-1" /><p className="text-xs text-muted-foreground">Nenhum calculo.</p></div>
              ) : (
                <div className="space-y-2">
                  {historico.map((item: any) => (
                    <div key={item.id} className="flex items-start gap-2">
                      <div className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${tipoColor[item.tipo] ?? "bg-gray-100 text-gray-700"}`}>{tipoLabel[item.tipo] ?? item.tipo}</div>
                      <div className="min-w-0 flex-1"><p className="text-xs font-medium truncate">{item.titulo}</p><p className="text-[10px] text-muted-foreground">{formatDate(item.createdAt)}</p></div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Coluna 3: Atalhos + Stats */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><Zap className="h-4 w-4 text-muted-foreground" />Acesso rapido</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: Scale, label: "Processos", path: "/processos", color: "text-indigo-600" },
                  { icon: CalendarDays, label: "Agenda", path: "/agenda", color: "text-orange-600" },
                  { icon: Headphones, label: "Atendimento", path: "/atendimento", color: "text-sky-600" },
                  { icon: DollarSign, label: "Financeiro", path: "/financeiro", color: "text-emerald-600" },
                  { icon: Landmark, label: "Bancario", path: "/calculos/bancario", color: "text-blue-600" },
                  { icon: Briefcase, label: "Trabalhista", path: "/calculos/trabalhista", color: "text-amber-600" },
                  { icon: ShieldCheck, label: "Previdenciario", path: "/calculos/previdenciario", color: "text-rose-600" },
                  { icon: Settings, label: "Config.", path: "/configuracoes", color: "text-gray-600" },
                ].map((m) => (
                  <Button key={m.path} variant="outline" className="h-auto py-2.5 justify-start gap-2 text-left" onClick={() => nav(m.path)}>
                    <m.icon className={`h-4 w-4 ${m.color} shrink-0`} />
                    <span className="text-xs font-medium">{m.label}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Card><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2"><Calculator className="h-4 w-4 text-blue-500" /><div><p className="text-lg font-bold">{stats?.totalCalculos ?? 0}</p><p className="text-[10px] text-muted-foreground">Calculos</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2"><FileText className="h-4 w-4 text-emerald-500" /><div><p className="text-lg font-bold">{stats?.totalPareceres ?? 0}</p><p className="text-[10px] text-muted-foreground">Pareceres</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-amber-500" /><div><p className="text-lg font-bold">{Object.keys(stats?.porTipo ?? {}).length}</p><p className="text-[10px] text-muted-foreground">Modulos</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2"><Zap className="h-4 w-4 text-purple-500" /><div><p className="text-lg font-bold">{isUnlimited ? "\u221E" : creditsRemaining}</p><p className="text-[10px] text-muted-foreground">Creditos</p></div></div></CardContent></Card>
          </div>
        </div>
      </div>
    </div>
  );
}
