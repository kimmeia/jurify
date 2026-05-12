/**
 * Relatórios — análises consolidadas do escritório.
 *
 * Consolidação de Métricas + Relatórios em 4 abas:
 *   Atendimento · Comercial · Produção · Cálculos
 *
 * Todas as abas respeitam o filtro de período selecionado no topo.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BarChart3, MessageCircle, TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight,
  Activity, Loader2, Users, CheckCircle2, Target, AlertTriangle, Percent,
  LayoutGrid, Calculator, CalendarRange, TrendingDown,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

// ───────────────────────── helpers ─────────────────────────

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

/** Ordem fixa do funil — primeiro estágio (novo) ao último (ganho/perdido).
 *  Usada pra renderizar o funil visual sempre na mesma sequência, mesmo
 *  quando alguma etapa está zerada. */
const ETAPAS_FUNIL = [
  "novo",
  "qualificado",
  "proposta",
  "negociacao",
  "fechado_ganho",
  "fechado_perdido",
] as const;

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
        <TabsContent value="comercial" className="mt-4 space-y-6">
          <DashboardComercial />
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

/** Range default = mês vigente. */
function rangeMesVigente(): { inicio: string; fim: string } {
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  return {
    inicio: ini.toISOString().slice(0, 10),
    fim: hoje.toISOString().slice(0, 10),
  };
}

function AbaAtendimento({ dias }: { dias: number }) {
  // Filtros locais sobrepõem o dias global. Default = mês vigente.
  const [setorId, setSetorId] = useState<number | null>(null);
  const [atendenteId, setAtendenteId] = useState<number | null>(null);
  const [{ inicio, fim }, setRange] = useState(rangeMesVigente);

  const { data: setoresList } = trpc.configuracoes.listarSetores.useQuery(undefined, { retry: false });
  const { data: colabsList } = trpc.configuracoes.listarColaboradoresParaFiltro.useQuery(
    { modulo: "relatorios" },
    { retry: false },
  );

  // Atendentes filtrados pelo setor (se selecionado). Quando troca setor,
  // limpa o atendente pra evitar combinação inválida.
  const atendentesFiltrados = ((colabsList?.colaboradores || []) as any[]).filter((c) => {
    if (setorId == null) return true;
    return c.setorId === setorId;
  });

  const { data, isLoading } = trpc.relatorios.atendimento.useQuery(
    {
      dataInicio: inicio,
      dataFim: fim,
      setorId: setorId ?? undefined,
      atendenteId: atendenteId ?? undefined,
    },
    { refetchInterval: 60_000 },
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Setor</Label>
              <Select
                value={setorId == null ? "__all__" : String(setorId)}
                onValueChange={(v) => {
                  const novo = v === "__all__" ? null : parseInt(v, 10);
                  setSetorId(novo);
                  // Se o atendente atual não pertence ao setor novo, limpa
                  if (novo != null && atendenteId != null) {
                    const aindaValido = ((colabsList?.colaboradores || []) as any[])
                      .some((c) => c.id === atendenteId && c.setorId === novo);
                    if (!aindaValido) setAtendenteId(null);
                  }
                }}
              >
                <SelectTrigger className="text-xs h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos os setores</SelectItem>
                  {(setoresList || []).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Atendente</Label>
              <Select
                value={atendenteId == null ? "__all__" : String(atendenteId)}
                onValueChange={(v) => setAtendenteId(v === "__all__" ? null : parseInt(v, 10))}
              >
                <SelectTrigger className="text-xs h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos os atendentes</SelectItem>
                  {atendentesFiltrados.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.userName || c.userEmail || `#${c.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">De</Label>
              <Input
                type="date"
                className="text-xs h-9"
                value={inicio}
                onChange={(e) => setRange((r) => ({ ...r, inicio: e.target.value }))}
                max={fim}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Até</Label>
              <Input
                type="date"
                className="text-xs h-9"
                value={fim}
                onChange={(e) => setRange((r) => ({ ...r, fim: e.target.value }))}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              Padrão: mês vigente. Filtros sobrepõem o período global do topo.
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => {
                setSetorId(null);
                setAtendenteId(null);
                setRange(rangeMesVigente());
              }}
            >
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <Empty />
      ) : (
        <AbaAtendimentoConteudo data={data} dias={dias} />
      )}
    </div>
  );
}

function AbaAtendimentoConteudo({ data, dias: _dias }: { data: any; dias: number }) {
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

/**
 * Aba Comercial.
 *
 * Filtros locais (somam ao filtro `dias` global do topo):
 *  - **Atendente**: select com colaboradores ativos do escritório.
 *    Default "todos".
 *  - **Período custom**: popover com inputs de data inicial/final que
 *    sobrepõem o `dias` global quando aplicado.
 *
 * Definições importantes da aba:
 *  - "Contratos fechados" = leads movidos pra etapa **Ganho** no pipeline
 *    (`etapaFunil = 'fechado_ganho'`) dentro do período.
 *  - "Taxa de conversão" = contratos fechados ÷ total de leads.
 *  - "Contatos por origem" só conta canais de captação ativa
 *    (whatsapp, instagram, facebook, manual). Asaas é cobrança de
 *    cliente já existente — não é lead novo.
 */
// ───────────────────── Dashboard Comercial (estilo Looker) ─────────────────────

function VariacaoBadge({ pct }: { pct: number }) {
  if (pct === 0) {
    return (
      <span className="inline-flex items-center text-[10px] text-muted-foreground">
        sem mudança
      </span>
    );
  }
  const up = pct > 0;
  const cor = up ? "text-emerald-600" : "text-red-600";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${cor}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function DashboardComercial() {
  // Filtros locais: setor (default = primeiro tipo='comercial'),
  // atendente, período (default mês vigente).
  // Valor inicial do setor é resolvido pelo useEffect quando setoresList chega
  // (evita "auto" sintético que duplicava o setor no dropdown).
  const [setorSel, setSetorSel] = useState<string>("");
  const [atendenteSel, setAtendenteSel] = useState<string>("__all__");
  const [{ inicio, fim }, setRange] = useState(rangeMesVigente);
  // Drill-down: card clicado abre Sheet lateral com clientes do atendente
  const [atendenteDrillDown, setAtendenteDrillDown] = useState<{ id: number; nome: string } | null>(null);

  // Query do drill-down — só dispara quando algum atendente for selecionado.
  // Usa o mesmo período do dashboard (inicio/fim).
  const { data: detalheAtendente, isLoading: loadingDetalhe } = (trpc as any).relatorios.detalheAtendenteComercial.useQuery(
    {
      atendenteId: atendenteDrillDown?.id,
      dataInicio: inicio,
      dataFim: fim,
    },
    { enabled: atendenteDrillDown != null, retry: false },
  );

  const { data: setoresList } = trpc.configuracoes.listarSetores.useQuery(undefined, { retry: false });
  const { data: colabsList } = trpc.configuracoes.listarColaboradoresParaFiltro.useQuery(
    { modulo: "relatorios" },
    { retry: false },
  );

  // Setores tipo='comercial'
  const setoresComerciais = ((setoresList || []) as any[]).filter((s) => s.tipo === "comercial");

  // Default: primeiro setor comercial. Roda só uma vez quando setoresList chega.
  useEffect(() => {
    if (setorSel === "" && setoresComerciais.length > 0) {
      setSetorSel(setoresComerciais.length > 1 ? "__all__" : String(setoresComerciais[0].id));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setoresList]);

  const setorIdEfetivo = setorSel === "__all__" || setorSel === ""
    ? undefined
    : parseInt(setorSel, 10);

  // Atendentes filtrados pelo setor escolhido. Quando setor="__all__",
  // pega atendentes de todos os setores comerciais.
  const atendentesComerciais = ((colabsList?.colaboradores || []) as any[]).filter((c) => {
    if (setorIdEfetivo != null) return c.setorId === setorIdEfetivo;
    const idsComerciais = new Set(setoresComerciais.map((s) => s.id));
    return c.setorId != null && idsComerciais.has(c.setorId);
  });

  const atendenteIdEfetivo = atendenteSel === "__all__" ? undefined : parseInt(atendenteSel, 10);

  const { data, isLoading } = (trpc as any).relatorios?.comercialDashboard?.useQuery?.(
    {
      dataInicio: inicio,
      dataFim: fim,
      setorId: setorIdEfetivo,
      atendenteId: atendenteIdEfetivo,
    },
    { refetchInterval: 60_000, retry: false },
  ) ?? { data: undefined, isLoading: false };

  // Sem setor comercial configurado: convida o admin a configurar.
  if (setoresComerciais.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-2">
          <Target className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">Nenhum setor do tipo Comercial</p>
          <p className="text-xs text-muted-foreground">
            Configure em <strong>Configurações → Equipe → Setores</strong> qual setor
            é "Comercial" pra ver o dashboard de fechamento.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Setor comercial</Label>
              <Select value={setorSel || (setoresComerciais[0]?.id ? String(setoresComerciais[0].id) : "__all__")} onValueChange={(v) => { setSetorSel(v); setAtendenteSel("__all__"); }}>
                <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {setoresComerciais.length > 1 && (
                    <SelectItem value="__all__">Todos os comerciais</SelectItem>
                  )}
                  {setoresComerciais.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Atendente</Label>
              <Select value={atendenteSel} onValueChange={setAtendenteSel}>
                <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  {atendentesComerciais.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.userName || c.userEmail || `#${c.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">De</Label>
              <Input type="date" className="text-xs h-9" value={inicio}
                onChange={(e) => setRange((r) => ({ ...r, inicio: e.target.value }))} max={fim} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Até</Label>
              <Input type="date" className="text-xs h-9" value={fim}
                onChange={(e) => setRange((r) => ({ ...r, fim: e.target.value }))}
                max={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading || !data ? (
        <LoadingBlock />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                  Recebido
                </div>
                <p className="text-2xl font-bold text-emerald-600">{formatBRL(data.kpis.faturado)}</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">vs anterior</span>
                  <VariacaoBadge pct={data.kpis.variacaoFaturado} />
                </div>
                <p className="text-[10px] text-muted-foreground italic">
                  cobranças pagas no período
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
                  Contratos pagos
                </div>
                <p className="text-2xl font-bold">{data.kpis.contratos}</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">vs anterior</span>
                  <VariacaoBadge pct={data.kpis.variacaoContratos} />
                </div>
                <p className="text-[10px] text-muted-foreground italic">
                  parcelas do mesmo contrato contam como 1
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Activity className="h-3.5 w-3.5 text-violet-500" />
                  Ticket médio
                </div>
                <p className="text-2xl font-bold">{formatBRL(data.kpis.ticketMedio)}</p>
                <p className="text-[10px] text-muted-foreground italic">
                  recebido ÷ contratos pagos
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Percent className="h-3.5 w-3.5 text-amber-500" />
                  Comissão
                </div>
                <p className="text-2xl font-bold text-amber-600">{formatBRL(data.kpis.comissao)}</p>
                <p className="text-[10px] text-muted-foreground italic">
                  fechamentos no período
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Ranking */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-amber-500" />
                Ranking de atendentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.ranking.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Sem atendentes no setor comercial selecionado.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.ranking.map((r: any, idx: number) => {
                    const medalha = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : null;
                    return (
                      <div
                        key={r.atendenteId}
                        role="button"
                        tabIndex={0}
                        onClick={() => setAtendenteDrillDown({ id: r.atendenteId, nome: r.nome })}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setAtendenteDrillDown({ id: r.atendenteId, nome: r.nome }); }}
                        className="border rounded-lg p-3 space-y-2 cursor-pointer hover:border-primary hover:bg-accent/30 transition-colors"
                        title="Clique pra ver os clientes deste atendente"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base w-6 text-center">
                            {medalha || <span className="text-xs text-muted-foreground">#{idx + 1}</span>}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{r.nome}</p>
                            {r.setorNome && (
                              <p className="text-[10px] text-muted-foreground">{r.setorNome}</p>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-md bg-blue-500/5 border border-blue-500/20 p-2">
                            <p className="text-[10px] text-muted-foreground">Fechado (pipeline)</p>
                            <p className="text-sm font-bold text-blue-700">{formatBRL(r.valorFechado || 0)}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {r.contratosFechados || 0} contrato(s)
                            </p>
                          </div>
                          <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-2">
                            <p className="text-[10px] text-muted-foreground">Recebido (caixa)</p>
                            <p className="text-sm font-bold text-emerald-700">{formatBRL(r.faturado)}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {r.contratosPagos || 0} pago(s)
                              {r.conversao != null && (
                                <span className="ml-1">· conv. {r.conversao.toFixed(0)}%</span>
                              )}
                            </p>
                          </div>
                        </div>

                        <p className="text-[10px] text-muted-foreground text-right">
                          Ticket médio: {formatBRL(r.ticketMedio)}
                        </p>
                        {r.meta != null && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-muted-foreground">
                                Meta: {formatBRL(r.meta)}
                              </span>
                              <span className="font-medium">
                                {(r.progressoMeta ?? 0).toFixed(1)}%
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full ${
                                  (r.progressoMeta ?? 0) >= 100 ? "bg-emerald-500" :
                                  (r.progressoMeta ?? 0) >= 70 ? "bg-blue-500" :
                                  (r.progressoMeta ?? 0) >= 40 ? "bg-amber-500" : "bg-red-500"
                                }`}
                                style={{ width: `${Math.min(100, r.progressoMeta ?? 0)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cobranças por dia */}
          {data.cobrancasPorDia.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Faturado por dia</CardTitle>
              </CardHeader>
              <CardContent>
                <BarsMini
                  dados={data.cobrancasPorDia.map((d: any) => ({
                    label: d.dia.slice(5),
                    value: d.faturado,
                  }))}
                  cor="bg-emerald-500/80"
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Drill-down: clientes fechados/pagos pelo atendente no período */}
      <Sheet open={atendenteDrillDown != null} onOpenChange={(o) => { if (!o) setAtendenteDrillDown(null); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{atendenteDrillDown?.nome || "Atendente"}</SheetTitle>
            <SheetDescription>
              Clientes fechados e pagamentos no período selecionado.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            {loadingDetalhe && (
              <p className="text-xs text-muted-foreground">Carregando...</p>
            )}

            {!loadingDetalhe && detalheAtendente && detalheAtendente.itens?.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhum cliente fechado ou pagamento registrado neste período.
              </p>
            )}

            {!loadingDetalhe && detalheAtendente && detalheAtendente.itens?.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-blue-500/5 border border-blue-500/20 p-2">
                    <p className="text-[10px] text-muted-foreground">Total fechado</p>
                    <p className="text-sm font-bold text-blue-700">{formatBRL(detalheAtendente.totalFechado || 0)}</p>
                  </div>
                  <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-2">
                    <p className="text-[10px] text-muted-foreground">Total recebido</p>
                    <p className="text-sm font-bold text-emerald-700">{formatBRL(detalheAtendente.totalRecebido || 0)}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {detalheAtendente.itens.map((it: any) => {
                    const statusInfo: Record<string, { label: string; cor: string }> = {
                      pago: { label: "Pago integral", cor: "bg-emerald-100 text-emerald-700" },
                      parcial: { label: "Parcial", cor: "bg-amber-100 text-amber-700" },
                      aguardando: { label: "Aguardando", cor: "bg-gray-100 text-gray-700" },
                      so_pago: { label: "Pago s/ lead", cor: "bg-blue-100 text-blue-700" },
                    };
                    const s = statusInfo[it.status] || statusInfo.aguardando;
                    return (
                      <div key={it.contatoId} className="border rounded-lg p-3 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium truncate" title={it.nome}>{it.nome}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${s.cor}`}>
                            {s.label}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                          <div>
                            <p className="text-[10px] text-muted-foreground">Fechado</p>
                            <p className="font-medium text-blue-700">{formatBRL(it.valorFechado)}</p>
                            {it.contratosFechados > 0 && (
                              <p className="text-[10px] text-muted-foreground">{it.contratosFechados} contrato(s)</p>
                            )}
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">Recebido</p>
                            <p className="font-medium text-emerald-700">{formatBRL(it.valorRecebido)}</p>
                            {it.contratosPagos > 0 && (
                              <p className="text-[10px] text-muted-foreground">{it.contratosPagos} pago(s)</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ───────────────────── aba: Comercial (legado: leads/funil) ─────────────────────

function AbaComercial({ dias }: { dias: number }) {
  // Atendente (string p/ Select shadcn — "todos" = sem filtro)
  const [responsavelSel, setResponsavelSel] = useState<string>("todos");

  // Range customizado (sobrepõe o `dias` global quando preenchido)
  const [rangeCustom, setRangeCustom] = useState<{ inicio: string; fim: string } | null>(null);
  const [rangePopoverOpen, setRangePopoverOpen] = useState(false);
  const [rangeInicioInput, setRangeInicioInput] = useState("");
  const [rangeFimInput, setRangeFimInput] = useState("");

  // Atendentes do escritório pra alimentar o select.
  // Usa procedure dedicada que filtra por permissão: atendente/SDR/estagiário
  // só vê ele mesmo aqui (não consegue filtrar relatório por outro colaborador).
  // Gestor/dono vê todos.
  const { data: colaboradoresData } = (trpc.configuracoes as any).listarColaboradoresParaFiltro?.useQuery(
    { modulo: "relatorios" },
    { retry: false, refetchOnWindowFocus: false },
  ) ?? { data: undefined };
  const atendentes = colaboradoresData?.colaboradores ?? [];

  const responsavelId =
    responsavelSel === "todos" ? undefined : Number(responsavelSel);

  const { data, isLoading } = trpc.relatorios.comercial.useQuery(
    {
      dias: rangeCustom ? undefined : dias,
      dataInicio: rangeCustom?.inicio,
      dataFim: rangeCustom?.fim,
      responsavelId,
    },
    { refetchInterval: 60_000 },
  );

  const labelRange = rangeCustom
    ? `${rangeCustom.inicio.split("-").reverse().join("/")} → ${rangeCustom.fim
        .split("-")
        .reverse()
        .join("/")}`
    : "Personalizar";

  return (
    <div className="space-y-4">
      {/* ── Faixa de filtros locais ──────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Atendente:</span>
        <Select value={responsavelSel} onValueChange={setResponsavelSel}>
          <SelectTrigger className="w-52 h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os atendentes</SelectItem>
            {atendentes.map((a: any) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.userName || a.userEmail}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground ml-2">Período:</span>
        <Popover
          open={rangePopoverOpen}
          onOpenChange={(o) => {
            setRangePopoverOpen(o);
            if (o) {
              if (rangeCustom) {
                setRangeInicioInput(rangeCustom.inicio);
                setRangeFimInput(rangeCustom.fim);
              } else {
                const hoje = new Date();
                const inicio = new Date(hoje);
                inicio.setDate(hoje.getDate() - dias);
                setRangeInicioInput(inicio.toISOString().slice(0, 10));
                setRangeFimInput(hoje.toISOString().slice(0, 10));
              }
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant={rangeCustom ? "default" : "outline"}
              size="sm"
              className="h-9 text-xs gap-1.5"
            >
              <CalendarRange className="h-3.5 w-3.5" />
              {labelRange}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">De</Label>
              <Input
                type="date"
                value={rangeInicioInput}
                onChange={(e) => setRangeInicioInput(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Até</Label>
              <Input
                type="date"
                value={rangeFimInput}
                onChange={(e) => setRangeFimInput(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Sobrepõe o filtro global de dias.
            </p>
            <div className="flex gap-2 pt-1">
              {rangeCustom && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={() => {
                    setRangeCustom(null);
                    setRangePopoverOpen(false);
                  }}
                >
                  Limpar
                </Button>
              )}
              <Button
                size="sm"
                className="flex-1 h-8 text-xs"
                disabled={
                  !rangeInicioInput ||
                  !rangeFimInput ||
                  rangeInicioInput > rangeFimInput
                }
                onClick={() => {
                  setRangeCustom({ inicio: rangeInicioInput, fim: rangeFimInput });
                  setRangePopoverOpen(false);
                }}
              >
                Aplicar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <Empty />
      ) : (
        <ComercialConteudo data={data} />
      )}
    </div>
  );
}

function ComercialConteudo({ data }: { data: any }) {
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

      {/* Linha de valores: receita / pipeline em aberto / pipeline perdido / leads perdidos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          icon={<TrendingDown className="h-5 w-5 text-red-500" />}
          label="Pipeline perdido"
          value={formatBRL(data.valorPerdido ?? 0)}
          small
          highlight="text-red-600"
        />
        <Kpi
          icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
          label="Leads perdidos"
          value={data.leadsPerdidos}
          highlight="text-red-600"
        />
      </div>

      {/* Funil — sempre todas as etapas em ordem (primeiro → último) */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Funil de Vendas</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(() => {
              const max = Math.max(
                ...ETAPAS_FUNIL.map((e) => data.etapas?.[e]?.total ?? 0),
                1,
              );
              return ETAPAS_FUNIL.map((e) => {
                const info = data.etapas?.[e] ?? { total: 0, valor: 0 };
                const pct = max > 0 ? (info.total / max) * 100 : 0;
                return (
                  <div key={e} className="flex items-center gap-3">
                    <div className="w-24 text-xs font-medium truncate">
                      {ETAPA_LABELS[e] || e}
                    </div>
                    <div className="flex-1 h-7 bg-muted/40 rounded-full overflow-hidden relative">
                      {info.total > 0 && (
                        <div
                          className={`h-full rounded-full ${ETAPA_CORES[e] || "bg-gray-400"}`}
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        />
                      )}
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium">
                        {info.total}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground w-24 text-right">
                      {formatBRL(info.valor)}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Origem dos contatos — whitelist de canais de captação */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Contatos por Origem</CardTitle>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Apenas canais de captação (WhatsApp, Instagram, Facebook, manual).
          </p>
        </CardHeader>
        <CardContent>
          {data.contatosPorOrigem.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Sem contatos no período.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
