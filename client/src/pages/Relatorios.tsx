/**
 * Relatórios — análises consolidadas do escritório.
 *
 * Consolidação de Métricas + Relatórios em 4 abas:
 *   Atendimento · Comercial · Produção · Cálculos
 *
 * Todas as abas respeitam o filtro de período selecionado no topo.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3, MessageCircle, TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight,
  Activity, Loader2, Users, CheckCircle2, Target, AlertTriangle, Percent,
  LayoutGrid, Calculator,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

// ───────────────────────── helpers ─────────────────────────

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

const ETAPA_LABELS: Record<string, string> = {
  novo: "Novo",
  qualificado: "Qualificado",
  proposta: "Proposta",
  negociacao: "Negociação",
  fechado_ganho: "Ganho",
  fechado_perdido: "Perdido",
};
const ETAPA_CORES: Record<string, string> = {
  novo: "bg-slate-500",
  qualificado: "bg-blue-500",
  proposta: "bg-violet-500",
  negociacao: "bg-amber-500",
  fechado_ganho: "bg-emerald-500",
  fechado_perdido: "bg-red-500",
};
const ORIGEM_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  telefone: "Telefone",
  manual: "Manual",
  site: "Site",
};
const TIPO_CALC: Record<string, string> = {
  bancario: "Bancário",
  trabalhista: "Trabalhista",
  imobiliario: "Imobiliário",
  tributario: "Tributário",
  previdenciario: "Previdenciário",
  atualizacao_monetaria: "Atualização",
};
const STATUS_LABELS: Record<string, string> = {
  aguardando: "Aguardando",
  em_atendimento: "Em atendimento",
  resolvido: "Resolvido",
  fechado: "Fechado",
};
const STATUS_CORES: Record<string, string> = {
  aguardando: "text-amber-600",
  em_atendimento: "text-blue-600",
  resolvido: "text-emerald-600",
  fechado: "text-gray-500",
};

function Kpi({
  icon, label, value, small, highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  small?: boolean;
  highlight?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <p className={`font-bold leading-tight truncate ${small ? "text-base" : "text-xl"} ${highlight || ""}`}>
              {value}
            </p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BarsMini({ dados, cor }: { dados: { label: string; value: number }[]; cor: string }) {
  const max = Math.max(...dados.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1 h-40 overflow-x-auto pb-6">
      {dados.map((d, i) => (
        <div
          key={i}
          className="flex flex-col items-center gap-1 min-w-[22px]"
          title={`${d.label}: ${d.value}`}
        >
          <span className="text-[9px] text-muted-foreground">{d.value}</span>
          <div
            className={`w-4 rounded-t ${cor}`}
            style={{ height: `${Math.max((d.value / max) * 100, 4)}%` }}
          />
          <span className="text-[8px] text-muted-foreground -rotate-45 w-8 truncate origin-top-left">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Skeleton className="h-24" /><Skeleton className="h-24" />
      <Skeleton className="h-24" /><Skeleton className="h-24" />
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground text-center py-12">Sem dados.</p>;
}

// ───────────────────────── página ─────────────────────────

export default function Relatorios() {
  const [tab, setTab] = useState("atendimento");
  const [dias, setDias] = useState("30");
  const diasNum = Number(dias);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40">
          <BarChart3 className="h-6 w-6 text-amber-600" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            Atendimento, comercial, produção jurídica e cálculos
          </p>
        </div>
        <Select value={dias} onValueChange={setDias}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="15">Últimos 15 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
            <SelectItem value="365">Último ano</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-4 h-10">
          <TabsTrigger value="atendimento" className="text-xs sm:text-sm gap-1.5">
            <MessageCircle className="h-3.5 w-3.5" /> Atendimento
          </TabsTrigger>
          <TabsTrigger value="comercial" className="text-xs sm:text-sm gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> Comercial
          </TabsTrigger>
          <TabsTrigger value="producao" className="text-xs sm:text-sm gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" /> Produção
          </TabsTrigger>
          <TabsTrigger value="calculos" className="text-xs sm:text-sm gap-1.5">
            <Calculator className="h-3.5 w-3.5" /> Cálculos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="atendimento" className="mt-4">
          <AbaAtendimento dias={diasNum} />
        </TabsContent>
        <TabsContent value="comercial" className="mt-4">
          <AbaComercial dias={diasNum} />
        </TabsContent>
        <TabsContent value="producao" className="mt-4">
          <AbaProducao dias={diasNum} />
        </TabsContent>
        <TabsContent value="calculos" className="mt-4">
          <AbaCalculos dias={diasNum} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ───────────────────── aba: Atendimento ─────────────────────

function AbaAtendimento({ dias }: { dias: number }) {
  const { data, isLoading } = trpc.relatorios.atendimento.useQuery(
    { dias },
    { refetchInterval: 60_000 },
  );
  if (isLoading) return <LoadingBlock />;
  if (!data) return <Empty />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi icon={<MessageCircle className="h-5 w-5 text-blue-500" />} label="Total Conversas" value={data.totalConversas} />
        <Kpi icon={<ArrowDownRight className="h-5 w-5 text-emerald-500" />} label="Msgs Recebidas" value={data.mensagensRecebidas} />
        <Kpi icon={<ArrowUpRight className="h-5 w-5 text-violet-500" />} label="Msgs Enviadas" value={data.mensagensEnviadas} />
        <Kpi icon={<Activity className="h-5 w-5 text-amber-500" />} label="Total Msgs" value={data.totalMensagens} />
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Por Status</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(data.conversasPorStatus).length === 0 ? (
              <p className="col-span-full text-sm text-muted-foreground text-center py-2">
                Nenhuma conversa no período.
              </p>
            ) : (
              Object.entries(data.conversasPorStatus).map(([s, t]) => (
                <div key={s} className="rounded-lg border p-3 text-center">
                  <p className={`text-2xl font-bold ${STATUS_CORES[s] || ""}`}>{t as number}</p>
                  <p className="text-xs text-muted-foreground">{STATUS_LABELS[s] || s}</p>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Conversas / Dia</CardTitle></CardHeader>
        <CardContent>
          {!data.conversasPorDia.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sem dados.</p>
          ) : (
            <BarsMini
              dados={data.conversasPorDia.map((d: any) => ({ label: d.dia.slice(5), value: d.total }))}
              cor="bg-blue-500/80"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Mensagens / Dia</CardTitle></CardHeader>
        <CardContent>
          {!data.mensagensPorDia.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sem dados.</p>
          ) : (
            <BarsMini
              dados={data.mensagensPorDia.map((d: any) => ({ label: d.dia.slice(5), value: d.total }))}
              cor="bg-emerald-500/80"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────── aba: Comercial ─────────────────────

function AbaComercial({ dias }: { dias: number }) {
  const { data, isLoading } = trpc.relatorios.comercial.useQuery(
    { dias },
    { refetchInterval: 60_000 },
  );
  if (isLoading) return <LoadingBlock />;
  if (!data) return <Empty />;

  return (
    <div className="space-y-4">
      {/* KPIs principais */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi icon={<MessageCircle className="h-5 w-5 text-blue-500" />} label="Conversas" value={data.conversasAtendidas} />
        <Kpi icon={<Users className="h-5 w-5 text-violet-500" />} label="Total Leads" value={data.totalLeads} />
        <Kpi
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
          label="Contratos fechados"
          value={data.leadsGanhos}
          highlight="text-emerald-600"
        />
        <Kpi
          icon={<Target className="h-5 w-5 text-indigo-500" />}
          label="Taxa de conversão"
          value={`${data.taxaConversao}%`}
          highlight="text-indigo-600"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi
          icon={<DollarSign className="h-5 w-5 text-emerald-500" />}
          label="Receita (ganhos)"
          value={formatBRL(data.valorGanho)}
          small
          highlight="text-emerald-600"
        />
        <Kpi
          icon={<TrendingUp className="h-5 w-5 text-amber-500" />}
          label="Pipeline estimado"
          value={formatBRL(data.valorPipeline)}
          small
        />
        <Kpi
          icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
          label="Leads perdidos"
          value={data.leadsPerdidos}
          highlight="text-red-600"
        />
      </div>

      {/* Funil */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Funil de Vendas</CardTitle></CardHeader>
        <CardContent>
          {Object.keys(data.etapas).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sem leads no período.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(data.etapas).map(([e, info]: [string, any]) => {
                const max = Math.max(
                  ...Object.values(data.etapas).map((x: any) => x.total),
                  1,
                );
                return (
                  <div key={e} className="flex items-center gap-3">
                    <div className="w-24 text-xs font-medium truncate">
                      {ETAPA_LABELS[e] || e}
                    </div>
                    <div className="flex-1 h-7 bg-muted/40 rounded-full overflow-hidden relative">
                      <div
                        className={`h-full rounded-full ${ETAPA_CORES[e] || "bg-gray-400"}`}
                        style={{ width: `${Math.max((info.total / max) * 100, 3)}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium">
                        {info.total}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground w-24 text-right">
                      {formatBRL(info.valor)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Origem dos contatos */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Contatos por Origem</CardTitle></CardHeader>
        <CardContent>
          {data.contatosPorOrigem.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sem contatos cadastrados.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {data.contatosPorOrigem.map((o: any) => (
                <div key={o.origem} className="rounded-lg border p-3 text-center">
                  <p className="text-xl font-bold">{o.total}</p>
                  <p className="text-xs text-muted-foreground">
                    {ORIGEM_LABELS[o.origem] || o.origem}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Leads por mês */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Leads / Mês (últimos 6m)</CardTitle></CardHeader>
        <CardContent>
          {!data.leadsPorMes.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sem dados.</p>
          ) : (
            <BarsMini
              dados={data.leadsPorMes.map((d: any) => ({
                label: `${d.mes.slice(5)}/${d.mes.slice(2, 4)}`,
                value: d.total,
              }))}
              cor="bg-violet-500/80"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────── aba: Produção ─────────────────────

function AbaProducao({ dias }: { dias: number }) {
  // "todos" = sem filtro (null no backend); senão, funilId numérico como string
  const [funilSel, setFunilSel] = useState<string>("todos");

  const { data: funis } = (trpc as any).kanban.listarFunis.useQuery(undefined, {
    retry: false,
  });

  const funilIdInput = funilSel === "todos" ? undefined : Number(funilSel);
  const { data, isLoading } = trpc.relatorios.producao.useQuery(
    { dias, funilId: funilIdInput } as any,
    { refetchInterval: 60_000 },
  );

  return (
    <div className="space-y-4">
      {/* Filtro de funil */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Funil:</span>
        <Select value={funilSel} onValueChange={setFunilSel}>
          <SelectTrigger className="w-56 h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os funis</SelectItem>
            {(funis || []).map((f: any) => (
              <SelectItem key={f.id} value={String(f.id)}>
                {f.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <Empty />
      ) : (
        <ProducaoConteudo data={data} />
      )}
    </div>
  );
}

function ProducaoConteudo({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi icon={<LayoutGrid className="h-5 w-5 text-indigo-500" />} label="Processos no período" value={data.cardsTotal} />
        <Kpi
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
          label="Dentro do prazo"
          value={data.cardsDentroPrazo}
          highlight="text-emerald-600"
        />
        <Kpi
          icon={<AlertTriangle className={`h-5 w-5 ${data.cardsAtrasados > 0 ? "text-red-500" : "text-gray-400"}`} />}
          label="Atrasados"
          value={data.cardsAtrasados}
          highlight={data.cardsAtrasados > 0 ? "text-red-600" : ""}
        />
        <Kpi
          icon={<Percent className="h-5 w-5 text-blue-500" />}
          label="Taxa dentro do prazo"
          value={`${data.taxaDentroPrazo}%`}
          highlight="text-blue-600"
        />
      </div>

      {data.cardsPorColuna.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Distribuição por etapa</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.cardsPorColuna}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="coluna" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-3">
            <ArrowUpRight className="h-6 w-6 text-blue-500" />
            <div>
              <p className="text-lg font-bold">{data.movimentacoes}</p>
              <p className="text-[10px] text-muted-foreground">
                Movimentações de cards no período (entradas, andamentos, conclusões)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────── aba: Cálculos ─────────────────────

function AbaCalculos({ dias }: { dias: number }) {
  const { data, isLoading } = trpc.relatorios.calculos.useQuery(
    { dias },
    { refetchInterval: 60_000 },
  );
  if (isLoading) return <LoadingBlock />;
  if (!data) return <Empty />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Kpi icon={<BarChart3 className="h-5 w-5 text-blue-500" />} label="Total de Cálculos" value={data.totalCalculos} />
        <Kpi
          icon={<Activity className="h-5 w-5 text-emerald-500" />}
          label="Tipos usados"
          value={Object.keys(data.calculosPorTipo).length}
        />
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Por Tipo</CardTitle></CardHeader>
        <CardContent>
          {Object.keys(data.calculosPorTipo).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum cálculo no período.
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(data.calculosPorTipo)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([t, v]) => {
                  const max = Math.max(
                    ...(Object.values(data.calculosPorTipo) as number[]),
                    1,
                  );
                  return (
                    <div key={t} className="flex items-center gap-3">
                      <div className="w-28 text-xs font-medium truncate">
                        {TIPO_CALC[t] || t}
                      </div>
                      <div className="flex-1 h-6 bg-muted/40 rounded-full overflow-hidden relative">
                        <div
                          className="h-full rounded-full bg-blue-500/80"
                          style={{ width: `${Math.max(((v as number) / max) * 100, 5)}%` }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium">
                          {v as number}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Cálculos / Mês (últimos 6m)</CardTitle></CardHeader>
        <CardContent>
          {!data.calculosPorMes.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sem dados.</p>
          ) : (
            <BarsMini
              dados={data.calculosPorMes.map((d: any) => ({
                label: `${d.mes.slice(5)}/${d.mes.slice(2, 4)}`,
                value: d.total,
              }))}
              cor="bg-blue-500/80"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
