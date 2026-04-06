import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, MessageCircle, TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight, Activity, Loader2 } from "lucide-react";

function formatBRL(v: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v); }
const ETAPA_LABELS: Record<string, string> = { novo: "Novo", qualificado: "Qualificado", proposta: "Proposta", negociacao: "Negociação", fechado_ganho: "Ganho", fechado_perdido: "Perdido" };
const ETAPA_CORES: Record<string, string> = { novo: "bg-slate-500", qualificado: "bg-blue-500", proposta: "bg-violet-500", negociacao: "bg-amber-500", fechado_ganho: "bg-emerald-500", fechado_perdido: "bg-red-500" };
const ORIGEM_LABELS: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", telefone: "Telefone", manual: "Manual", site: "Site" };
const TIPO_CALC: Record<string, string> = { bancario: "Bancário", trabalhista: "Trabalhista", imobiliario: "Imobiliário", tributario: "Tributário", previdenciario: "Previdenciário", atualizacao_monetaria: "Atualização" };

export default function Relatorios() {
  const [tab, setTab] = useState("operacional");
  return (<div className="space-y-5 max-w-7xl mx-auto">
    <div className="flex items-center gap-3"><div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40"><BarChart3 className="h-6 w-6 text-amber-600" /></div><div className="flex-1"><h1 className="text-2xl font-bold tracking-tight">Relatórios</h1><p className="text-sm text-muted-foreground">Métricas operacionais, comerciais e financeiras</p></div></div>
    <Tabs value={tab} onValueChange={setTab}><TabsList className="grid w-full grid-cols-3 h-10"><TabsTrigger value="operacional" className="text-xs sm:text-sm gap-1.5"><Activity className="h-3.5 w-3.5" /> Operacional</TabsTrigger><TabsTrigger value="comercial" className="text-xs sm:text-sm gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Comercial</TabsTrigger><TabsTrigger value="financeiro" className="text-xs sm:text-sm gap-1.5"><DollarSign className="h-3.5 w-3.5" /> Financeiro</TabsTrigger></TabsList>
      <TabsContent value="operacional" className="mt-4"><RelOp /></TabsContent>
      <TabsContent value="comercial" className="mt-4"><RelCom /></TabsContent>
      <TabsContent value="financeiro" className="mt-4"><RelFin /></TabsContent>
    </Tabs></div>);
}

function Kpi({ icon, label, value, small }: { icon: React.ReactNode; label: string; value: string | number; small?: boolean }) {
  return (<div className="rounded-xl border bg-card p-4 flex items-center gap-3"><div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">{icon}</div><div className="min-w-0"><p className={`font-bold leading-tight truncate ${small ? "text-sm" : "text-lg"}`}>{value}</p><p className="text-[10px] text-muted-foreground">{label}</p></div></div>);
}

function Bar({ dados, cor }: { dados: { label: string; value: number }[]; cor: string }) {
  const max = Math.max(...dados.map(d => d.value), 1);
  return (<div className="flex items-end gap-1 h-40 overflow-x-auto pb-6">{dados.map((d, i) => (<div key={i} className="flex flex-col items-center gap-1 min-w-[22px]" title={`${d.label}: ${d.value}`}><span className="text-[9px] text-muted-foreground">{d.value}</span><div className={`w-4 rounded-t ${cor}`} style={{ height: `${Math.max((d.value / max) * 100, 4)}%` }} /><span className="text-[8px] text-muted-foreground -rotate-45 w-8 truncate origin-top-left">{d.label}</span></div>))}</div>);
}

function RelOp() {
  const { data, isLoading } = trpc.relatorios.operacional.useQuery();
  if (isLoading) return <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;
  if (!data) return <p className="text-sm text-muted-foreground text-center py-12">Sem dados.</p>;
  const sl: Record<string, string> = { aguardando: "Aguardando", em_atendimento: "Em atendimento", resolvido: "Resolvido", fechado: "Fechado" };
  const sc: Record<string, string> = { aguardando: "text-amber-600", em_atendimento: "text-blue-600", resolvido: "text-emerald-600", fechado: "text-gray-500" };
  return (<div className="space-y-4">
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Kpi icon={<MessageCircle className="h-5 w-5 text-blue-500" />} label="Total Conversas" value={data.totalConversas} /><Kpi icon={<ArrowDownRight className="h-5 w-5 text-emerald-500" />} label="Msgs Recebidas" value={data.mensagensRecebidas} /><Kpi icon={<ArrowUpRight className="h-5 w-5 text-violet-500" />} label="Msgs Enviadas" value={data.mensagensEnviadas} /><Kpi icon={<Activity className="h-5 w-5 text-amber-500" />} label="Total Msgs" value={data.totalMensagens} /></div>
    <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Por Status</CardTitle></CardHeader><CardContent><div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{Object.entries(data.conversasPorStatus).map(([s, t]) => (<div key={s} className="rounded-lg border p-3 text-center"><p className={`text-2xl font-bold ${sc[s] || ""}`}>{t}</p><p className="text-xs text-muted-foreground">{sl[s] || s}</p></div>))}</div></CardContent></Card>
    <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Conversas / Dia (30d)</CardTitle></CardHeader><CardContent>{!data.conversasPorDia.length ? <p className="text-sm text-muted-foreground text-center py-6">Sem dados.</p> : <Bar dados={data.conversasPorDia.map((d: any) => ({ label: d.dia.slice(5), value: d.total }))} cor="bg-blue-500/80" />}</CardContent></Card>
    <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Mensagens / Dia (30d)</CardTitle></CardHeader><CardContent>{!data.mensagensPorDia.length ? <p className="text-sm text-muted-foreground text-center py-6">Sem dados.</p> : <Bar dados={data.mensagensPorDia.map((d: any) => ({ label: d.dia.slice(5), value: d.total }))} cor="bg-emerald-500/80" />}</CardContent></Card>
  </div>);
}

function RelCom() {
  const { data, isLoading } = trpc.relatorios.comercial.useQuery();
  if (isLoading) return <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;
  if (!data) return <p className="text-sm text-muted-foreground text-center py-12">Sem dados.</p>;
  return (<div className="space-y-4">
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3"><Kpi icon={<TrendingUp className="h-5 w-5 text-violet-500" />} label="Total Leads" value={data.totalLeads} /><Kpi icon={<ArrowUpRight className="h-5 w-5 text-emerald-500" />} label="Ganhos" value={data.leadsGanhos} /><Kpi icon={<ArrowDownRight className="h-5 w-5 text-red-500" />} label="Perdidos" value={data.leadsPerdidos} /><Kpi icon={<Activity className="h-5 w-5 text-blue-500" />} label="Conversão" value={`${data.taxaConversao}%`} /><Kpi icon={<DollarSign className="h-5 w-5 text-amber-500" />} label="Pipeline" value={formatBRL(data.valorPipeline)} small /></div>
    <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Funil de Vendas</CardTitle></CardHeader><CardContent><div className="space-y-2">{Object.entries(data.etapas).map(([e, info]: [string, any]) => { const max = Math.max(...Object.values(data.etapas).map((x: any) => x.total), 1); return (<div key={e} className="flex items-center gap-3"><div className="w-24 text-xs font-medium truncate">{ETAPA_LABELS[e] || e}</div><div className="flex-1 h-7 bg-muted/40 rounded-full overflow-hidden relative"><div className={`h-full rounded-full ${ETAPA_CORES[e] || "bg-gray-400"}`} style={{ width: `${Math.max((info.total / max) * 100, 3)}%` }} /><span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium">{info.total}</span></div><span className="text-xs text-muted-foreground w-24 text-right">{formatBRL(info.valor)}</span></div>); })}</div></CardContent></Card>
    <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Contatos por Origem</CardTitle></CardHeader><CardContent><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{data.contatosPorOrigem.map((o: any) => (<div key={o.origem} className="rounded-lg border p-3 text-center"><p className="text-xl font-bold">{o.total}</p><p className="text-xs text-muted-foreground">{ORIGEM_LABELS[o.origem] || o.origem}</p></div>))}</div></CardContent></Card>
    <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Leads / Mês (6m)</CardTitle></CardHeader><CardContent>{!data.leadsPorMes.length ? <p className="text-sm text-muted-foreground text-center py-6">Sem dados.</p> : <Bar dados={data.leadsPorMes.map((d: any) => ({ label: `${d.mes.slice(5)}/${d.mes.slice(2, 4)}`, value: d.total }))} cor="bg-violet-500/80" />}</CardContent></Card>
  </div>);
}

function RelFin() {
  const { data, isLoading } = trpc.relatorios.financeiro.useQuery();
  if (isLoading) return <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;
  if (!data) return <p className="text-sm text-muted-foreground text-center py-12">Sem dados.</p>;
  return (<div className="space-y-4">
    <div className="grid grid-cols-2 gap-3"><Kpi icon={<BarChart3 className="h-5 w-5 text-blue-500" />} label="Total Cálculos" value={data.totalCalculos} /><Kpi icon={<Activity className="h-5 w-5 text-emerald-500" />} label="Tipos" value={Object.keys(data.calculosPorTipo).length} /></div>
    <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Por Tipo</CardTitle></CardHeader><CardContent>{!Object.keys(data.calculosPorTipo).length ? <p className="text-sm text-muted-foreground text-center py-6">Nenhum cálculo.</p> : <div className="space-y-2">{Object.entries(data.calculosPorTipo).sort(([, a], [, b]) => (b as number) - (a as number)).map(([t, v]) => { const max = Math.max(...Object.values(data.calculosPorTipo) as number[], 1); return (<div key={t} className="flex items-center gap-3"><div className="w-28 text-xs font-medium truncate">{TIPO_CALC[t] || t}</div><div className="flex-1 h-6 bg-muted/40 rounded-full overflow-hidden relative"><div className="h-full rounded-full bg-blue-500/80" style={{ width: `${Math.max(((v as number) / max) * 100, 5)}%` }} /><span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium">{v as number}</span></div></div>); })}</div>}</CardContent></Card>
    <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Cálculos / Mês (6m)</CardTitle></CardHeader><CardContent>{!data.calculosPorMes.length ? <p className="text-sm text-muted-foreground text-center py-6">Sem dados.</p> : <Bar dados={data.calculosPorMes.map((d: any) => ({ label: `${d.mes.slice(5)}/${d.mes.slice(2, 4)}`, value: d.total }))} cor="bg-blue-500/80" />}</CardContent></Card>
  </div>);
}
