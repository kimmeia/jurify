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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BarChart3, MessageCircle, TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight,
  Activity, CheckCircle2, Target,
  LayoutGrid, Calculator, Wallet, FileText, Loader2,
  TrendingDown, Hourglass, Repeat,
  CalendarCheck, XCircle, Users,
  PhoneOutgoing, PhoneIncoming, X,
} from "lucide-react";
import { toast } from "sonner";
import { RelatoriosTab as DreFinanceiroTab } from "./financeiro/Relatorios";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ComposedChart, Area,
} from "recharts";
import {
  formatBRLShort, formatDiaCurto, formatDiaCompleto, baixarBlob, base64ToBlob,
} from "./financeiro/helpers";
import { TIPOS_CANAL_COMUNICACAO } from "@shared/canal-types";
import {
  Avatar, BarrasDiarias, BarrasRotuladas, BarraFiltro, CardRel, FiltroSelect,
  KpiRel, PastilhaTaxa, ProvedorRelatorios, TituloSecao, calcularDelta,
  calcularDeltaPontos, useRelatorios,
} from "./relatorios/casca";
import { BlocoLeadsPorEstado } from "./relatorios/leads-por-estado";
import { AcoesRelatorio } from "./relatorios/acoes";

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

// ─── Componentes do redesign aba Atendimento ────────────────────────────────

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

function LoadingBlock() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Skeleton className="h-24" /><Skeleton className="h-24" />
      <Skeleton className="h-24" /><Skeleton className="h-24" />
    </div>
  );
}

function fmtDuracaoLonga(seg: number): string {
  if (!seg || seg <= 0) return "0m";
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  const s = seg % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

function Empty() {
  return <p className="text-sm text-muted-foreground text-center py-12">Sem dados.</p>;
}

// ───────────────────────── página ─────────────────────────

export default function Relatorios() {
  // Permissão por módulo — relatorios (atendimento/comercial/producao)
  // e calculos (aba de Cálculos). Atendente/estagiário tem só calculos.
  const { data: minhasPerms, isLoading: permsLoading } = trpc.permissoes.minhasPermissoes.useQuery(
    undefined,
    { retry: false, refetchOnWindowFocus: false },
  );
  const can = (modulo: string): boolean => {
    if (permsLoading || !minhasPerms?.permissoes) return true;
    const p = (minhasPerms.permissoes as Record<string, { verTodos: boolean; verProprios: boolean } | undefined>)[modulo];
    return !!(p?.verTodos || p?.verProprios);
  };
  const podeRelatorios = can("relatorios");
  const podeCalculos = can("calculos");
  const podeFinanceiro = can("financeiro");

  // Default tab: primeira permitida. Atendente sem relatorios cai em "calculos"
  // (ou "financeiro" se for a única acessível).
  const defaultTab = podeRelatorios
    ? "atendimento"
    : podeCalculos
      ? "calculos"
      : podeFinanceiro
        ? "financeiro"
        : "atendimento";
  const [tab, setTab] = useState(defaultTab);
  // Re-alinha o tab atual quando permissões chegam (evita mostrar
  // "atendimento" bloqueado pra atendente até o usuário clicar em algo).
  useEffect(() => {
    if (!permsLoading) {
      if (tab === "atendimento" && !podeRelatorios) {
        if (podeCalculos) setTab("calculos");
        else if (podeFinanceiro) setTab("financeiro");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, podeRelatorios, podeCalculos, podeFinanceiro]);

  const tabsVisiveis = [
    podeRelatorios && "atendimento",
    podeRelatorios && "comercial",
    podeRelatorios && "producao",
    podeRelatorios && "agenda",
    podeCalculos && "calculos",
    podeFinanceiro && "financeiro",
  ].filter(Boolean) as string[];

  return (
    <ProvedorRelatorios>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            Atendimento, comercial, produção, agenda, cálculos e financeiro — no mesmo período
          </p>
        </div>

        {tabsVisiveis.length > 0 && (
          <div className="flex items-center gap-0.5 rounded-xl bg-muted/60 p-1 w-fit max-w-full overflow-x-auto">
            {RELATORIOS.filter((r) => tabsVisiveis.includes(r.id)).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setTab(r.id)}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
                  tab === r.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <r.icone className="h-4 w-4" />
                {r.nome}
              </button>
            ))}
          </div>
        )}

        {tabsVisiveis.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Você não tem permissão para acessar nenhum relatório.
            </CardContent>
          </Card>
        ) : (
          <div>
            {tab === "atendimento" && podeRelatorios && <AbaAtendimento />}
            {tab === "comercial" && podeRelatorios && <DashboardComercial />}
            {tab === "producao" && podeRelatorios && <AbaProducao />}
            {tab === "agenda" && podeRelatorios && <AbaAgenda />}
            {tab === "calculos" && podeCalculos && <AbaCalculos />}
            {tab === "financeiro" && podeFinanceiro && <DreFinanceiroTab />}
          </div>
        )}
      </div>
    </ProvedorRelatorios>
  );
}

const RELATORIOS = [
  { id: "atendimento", nome: "Atendimento", icone: MessageCircle },
  { id: "comercial", nome: "Comercial", icone: TrendingUp },
  { id: "producao", nome: "Produção", icone: LayoutGrid },
  { id: "agenda", nome: "Agenda", icone: CalendarCheck },
  { id: "calculos", nome: "Cálculos", icone: Calculator },
  { id: "financeiro", nome: "Financeiro", icone: Wallet },
] as const;

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

/** Range = últimos N dias até hoje (corresponde ao select global do topo). */
function rangeDeDias(dias: number): { inicio: string; fim: string } {
  const hoje = new Date();
  const ini = new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
  return {
    inicio: ini.toISOString().slice(0, 10),
    fim: hoje.toISOString().slice(0, 10),
  };
}

const DIAS_DEFAULT_RELATORIO = 30;

function AbaAtendimento() {
  const { periodo, comparar } = useRelatorios();
  const [setorId, setSetorId] = useState<number | null>(null);
  const [atendenteId, setAtendenteId] = useState<number | null>(null);
  const [canalId, setCanalId] = useState<number | null>(null);
  // Estado escolhido no mapa. Mora aqui, e não no contexto compartilhado,
  // porque só esta aba tem de onde tirá-lo.
  const [uf, setUf] = useState<string | null>(null);

  const { data: setoresList } = trpc.configuracoes.listarSetores.useQuery(undefined, { retry: false });
  const { data: colabsList } = trpc.configuracoes.listarColaboradoresParaFiltro.useQuery(
    { modulo: "relatorios" },
    { retry: false },
  );
  const { data: canaisList } = trpc.configuracoes.listarCanais.useQuery(undefined, { retry: false });

  // Atendentes filtrados pelo setor (se selecionado). Quando troca setor,
  // limpa o atendente pra evitar combinação inválida.
  const atendentesFiltrados = ((colabsList?.colaboradores || []) as any[]).filter((c) => {
    if (setorId == null) return true;
    return c.setorId === setorId;
  });

  const { data, isLoading } = trpc.relatorios.atendimento.useQuery(
    {
      dataInicio: periodo.inicio,
      dataFim: periodo.fim,
      setorId: setorId ?? undefined,
      atendenteId: atendenteId ?? undefined,
      canalId: canalId ?? undefined,
      uf: uf ?? undefined,
      comparar,
    },
    { refetchInterval: 60_000 },
  );

  const canaisAtivos = (((canaisList as any)?.canais || []) as any[]).filter(
    (c) => c.status !== "removido" && TIPOS_CANAL_COMUNICACAO.includes(c.tipo),
  );

  return (
    <div className="space-y-3">
      <AcoesRelatorio
        relatorio="atendimento"
        filtros={{
          setorId: setorId ?? undefined,
          atendenteId: atendenteId ?? undefined,
          canalId: canalId ?? undefined,
          uf: uf ?? undefined,
        }}
        pronto={!!data}
      />

      <BarraFiltro>
        <FiltroSelect
          rotulo="Setor"
          valor={setorId == null ? "" : String(setorId)}
          onChange={(v) => {
            const novo = v === "" ? null : parseInt(v, 10);
            setSetorId(novo);
            if (novo != null && atendenteId != null) {
              const aindaValido = ((colabsList?.colaboradores || []) as any[])
                .some((c) => c.id === atendenteId && c.setorId === novo);
              if (!aindaValido) setAtendenteId(null);
            }
          }}
          opcoes={[
            { value: "", label: "Todos" },
            ...(setoresList || []).map((s) => ({ value: String(s.id), label: s.nome })),
          ]}
        />
        <FiltroSelect
          rotulo="Atendente"
          valor={atendenteId == null ? "" : String(atendenteId)}
          onChange={(v) => setAtendenteId(v === "" ? null : parseInt(v, 10))}
          opcoes={[
            { value: "", label: "Todos" },
            ...atendentesFiltrados.map((c) => ({
              value: String(c.id),
              label: c.userName || c.userEmail || `#${c.id}`,
            })),
          ]}
        />
        <FiltroSelect
          rotulo="Canal"
          valor={canalId == null ? "" : String(canalId)}
          onChange={(v) => setCanalId(v === "" ? null : parseInt(v, 10))}
          opcoes={[
            { value: "", label: "Todos" },
            ...canaisAtivos.map((c) => ({
              value: String(c.id),
              label: `${c.nome || c.tipo}${c.telefone ? ` · ${c.telefone}` : ""}`,
            })),
          ]}
        />
        {uf && (
          <button
            type="button"
            onClick={() => setUf(null)}
            title="Voltar a ver todos os estados"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-2.5 text-xs font-semibold text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
          >
            Estado: {uf}
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </BarraFiltro>

      {isLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <Empty />
      ) : (
        <AbaAtendimentoConteudo data={data} uf={uf} onUf={setUf} />
      )}
    </div>
  );
}

/** "14 min", "42s" — a granularidade que importa num tempo de resposta. */
function fmtTempoResposta(seg: number): string {
  if (!seg || seg <= 0) return "—";
  if (seg < 60) return `${Math.round(seg)}s`;
  const min = Math.round(seg / 60);
  if (min < 90) return `${min} min`;
  return `${(min / 60).toFixed(1).replace(".", ",")} h`;
}

function AbaAtendimentoConteudo({
  data,
  uf,
  onUf,
}: {
  data: any;
  uf: string | null;
  onUf: (uf: string | null) => void;
}) {
  const ant = data.anterior as any | null;
  const d = (atual: number | null, chave: string, menorEhMelhor = false) =>
    ant ? calcularDelta(atual, ant[chave], menorEhMelhor) : undefined;
  // Métricas que já são percentuais comparam em pontos, não em variação
  // relativa — ver `calcularDeltaPontos`.
  const dp = (atual: number | null, chave: string) =>
    ant ? calcularDeltaPontos(atual, ant[chave]) : undefined;
  const nAnt = (chave: string, fmt: (v: number) => string) =>
    ant && ant[chave] != null ? `${fmt(ant[chave])} no período anterior` : null;

  const lig = data.ligacoes;
  const ligAnt = ant?.ligacoes;
  const dLig = (atual: number | null, chave: string, menorEhMelhor = false) =>
    ligAnt ? calcularDelta(atual, ligAnt[chave], menorEhMelhor) : undefined;

  const volumeConversas = (data.conversasPorDia || []).map((v: any) => ({
    dia: v.dia,
    total: v.total,
  }));
  const mediaDia = volumeConversas.length > 0
    ? Math.round(data.totalConversas / volumeConversas.length)
    : 0;

  const tabela = (data.tabelaAtendentes || []) as any[];
  const totais = tabela.reduce(
    (acc, a) => ({
      atendimentos: acc.atendimentos + a.atendimentos,
      leadsTotal: acc.leadsTotal + a.leadsTotal,
      ganhos: acc.ganhos + a.ganhos,
      perdidos: acc.perdidos + a.perdidos,
      emAberto: acc.emAberto + a.emAberto,
      valorFechado: acc.valorFechado + a.valorFechado,
    }),
    { atendimentos: 0, leadsTotal: 0, ganhos: 0, perdidos: 0, emAberto: 0, valorFechado: 0 },
  );
  const taxaTotal = totais.atendimentos > 0
    ? Math.round((totais.ganhos / totais.atendimentos) * 100)
    : null;

  const ligacoesPorDia = (data.ligacoesPorDia || []).map((v: any) => ({
    dia: v.dia,
    total: v.total ?? (v.feitas || 0) + (v.recebidas || 0) + (v.perdidas || 0),
  }));
  const totalChamadas = ligacoesPorDia.reduce((a: number, v: any) => a + v.total, 0);

  return (
    <div className="space-y-3">
      {/* Quatro KPIs, na ordem em que a pergunta é feita: quanto entrou, quão
          rápido foi atendido, quanto virou contrato, e de que tamanho. Msgs
          enviadas/recebidas e "Conversa → Lead" saíram — eram volume de
          tráfego e um derivado que ninguém usava pra decidir, e sete cartões
          na primeira dobra fazem os quatro que importam sumirem no meio. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Dois números, dois nomes. O card conta conversa ABERTA no período;
            a linha de apoio conta conversa com mensagem no período, que é o
            que o Inbox mostra. Cliente recorrente que volta a escrever só
            entra na segunda — chamar as duas de "Atendimentos" era o que
            fazia as telas parecerem discordar. */}
        <KpiRel
          label="Conversas novas"
          valor={data.totalConversas.toLocaleString("pt-BR")}
          delta={d(data.totalConversas, "totalConversas")}
          anterior={`${data.conversasAtendidas.toLocaleString("pt-BR")} atendidas no período`}
        />
        <KpiRel
          label="Tempo p/ 1ª resposta"
          valor={fmtTempoResposta(data.segMedioPriResp)}
          delta={d(data.segMedioPriResp, "segMedioPriResp", true)}
          anterior={nAnt("segMedioPriResp", fmtTempoResposta)}
        />
        <KpiRel
          label="Taxa de conversão"
          valor={data.taxaConversao !== null ? `${data.taxaConversao}%` : "—"}
          delta={dp(data.taxaConversao, "taxaConversao")}
          anterior={
            nAnt("taxaConversao", (v) => `${v}%`)
            ?? `${data.leadsGanhos} ganhos de ${data.totalConversas} atendimentos`
          }
        />
        <KpiRel
          label="Ticket médio"
          valor={data.ticketMedio !== null ? formatBRL(data.ticketMedio) : "—"}
          delta={d(data.ticketMedio, "ticketMedio")}
          anterior={nAnt("ticketMedio", formatBRL) ?? "Valor médio dos contratos fechados"}
        />
      </div>

      {data.leadsPorEstado && (
        <BlocoLeadsPorEstado
          dados={data.leadsPorEstado}
          selecionada={uf}
          onSelecionar={(sigla) => onUf(sigla === uf ? null : sigla)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <CardRel
          className="lg:col-span-3"
          icone={<MessageCircle className="h-4 w-4 text-muted-foreground" />}
          titulo="Volume diário"
          aviso={
            volumeConversas.length > 0
              ? `${data.totalConversas.toLocaleString("pt-BR")} no período · média de ${mediaDia}/dia · fim de semana esmaecido`
              : undefined
          }
        >
          <BarrasDiarias dados={volumeConversas} cor="bg-violet-500" />
        </CardRel>

        <CardRel
          className="lg:col-span-2"
          icone={<Users className="h-4 w-4 text-muted-foreground" />}
          titulo="Ranking de atendentes"
          aviso="por atendimentos"
        >
          <div className="px-4 pb-3.5 space-y-2">
            {tabela.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum atendente com movimento.</p>
            )}
            {[...tabela]
              .sort((a, b) => b.atendimentos - a.atendimentos)
              .slice(0, 5)
              .map((a, i) => (
                <div key={a.colabId} className="flex items-center gap-2.5">
                  <Avatar nome={a.nome} indice={i} />
                  <span className={`flex-1 truncate text-xs ${a.removido ? "text-muted-foreground" : ""}`}>
                    {a.nome}
                    {a.removido && (
                      <span className="ml-1.5 text-[9.5px] uppercase tracking-wide">· removido</span>
                    )}
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {a.atendimentos.toLocaleString("pt-BR")}
                  </span>
                </div>
              ))}
          </div>
        </CardRel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <CardRel
          className="lg:col-span-3"
          icone={<TrendingDown className="h-4 w-4 text-muted-foreground" />}
          titulo="Motivos de perda"
          aviso={`${data.leadsPerdidos.toLocaleString("pt-BR")} oportunidades perdidas`}
        >
          {(data.motivosPerda || []).length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              Nenhum motivo registrado no período.
            </p>
          ) : (
            <BarrasRotuladas
              itens={(data.motivosPerda as any[]).slice(0, 6).map((m) => ({
                rotulo: m.motivo,
                valor: m.total,
              }))}
              cor="bg-rose-300 dark:bg-rose-800"
              mostrarPercentual={false}
            />
          )}
        </CardRel>

        <CardRel
          className="lg:col-span-2"
          icone={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          titulo="Atendimentos por canal"
          aviso={`${data.totalConversas.toLocaleString("pt-BR")} no período`}
        >
          {(data.porCanal || []).length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">Sem canal no período.</p>
          ) : (
            <div className="px-4 pb-3.5 space-y-2">
              {(data.porCanal as any[]).slice(0, 6).map((c, i) => (
                <div key={c.canalId ?? i} className="flex items-center gap-2.5">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-sm ${
                      CORES_CANAL[i % CORES_CANAL.length]
                    }`}
                  />
                  <span className="flex-1 truncate text-xs">{c.nome}</span>
                  <span className="text-sm font-bold tabular-nums">
                    {c.total.toLocaleString("pt-BR")}
                  </span>
                  <span className="w-9 text-right text-[11px] text-muted-foreground tabular-nums">
                    {data.totalConversas > 0
                      ? `${Math.round((c.total / data.totalConversas) * 100)}%`
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardRel>
      </div>

      <CardRel
        icone={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
        titulo="Detalhamento por atendente"
        aviso="volume × conversão × valor"
      >
        <div className="overflow-x-auto px-1 pb-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-wide">Atendente</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">Atend.</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">Oportunidades</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">Ganhos</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">Perdidos</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">Em aberto</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">Conv.</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-right">Valor fechado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tabela.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">
                    Nenhum atendente com movimento no período.
                  </TableCell>
                </TableRow>
              )}
              {tabela.map((a, i) => (
                <TableRow key={a.colabId}>
                  <TableCell className="text-xs font-medium">
                    {/* Removido aparece MARCADO, não escondido: o atendimento
                        dele está dentro do total de conversas, e sumir com a
                        linha faria a tabela somar menos que o KPI acima. */}
                    <span className={`flex items-center gap-2 ${a.removido ? "text-muted-foreground" : ""}`}>
                      <Avatar nome={a.nome} indice={i} />
                      <span className="truncate">{a.nome}</span>
                      {a.removido && (
                        <span
                          className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
                          title="Saiu do escritório — o trabalho do período continua contado"
                        >
                          removido
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums">{a.atendimentos}</TableCell>
                  <TableCell className="text-center text-xs tabular-nums">{a.leadsTotal}</TableCell>
                  <TableCell className="text-center text-xs font-semibold tabular-nums text-emerald-600">
                    {a.ganhos}
                  </TableCell>
                  <TableCell className="text-center text-xs font-semibold tabular-nums text-rose-600">
                    {a.perdidos}
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums text-muted-foreground">
                    {a.emAberto}
                  </TableCell>
                  <TableCell className="text-center">
                    <PastilhaTaxa taxa={a.taxaConversao} referencia={taxaTotal} />
                  </TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums">
                    {formatBRL(a.valorFechado)}
                  </TableCell>
                </TableRow>
              ))}
              {tabela.length > 0 && (
                <TableRow className="bg-muted/40 hover:bg-muted/40 font-semibold">
                  <TableCell className="text-xs">Total</TableCell>
                  <TableCell className="text-center text-xs tabular-nums">{totais.atendimentos}</TableCell>
                  <TableCell className="text-center text-xs tabular-nums">{totais.leadsTotal}</TableCell>
                  <TableCell className="text-center text-xs tabular-nums text-emerald-600">
                    {totais.ganhos}
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums text-rose-600">
                    {totais.perdidos}
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums text-muted-foreground">
                    {totais.emAberto}
                  </TableCell>
                  <TableCell className="text-center">
                    <PastilhaTaxa taxa={taxaTotal} />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatBRL(totais.valorFechado)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardRel>

      {(lig?.feitas > 0 || lig?.recebidas > 0 || lig?.perdidas > 0) && (
        <>
          <TituloSecao>Ligações</TituloSecao>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiRel
              label="Ligações feitas"
              valor={lig.feitas.toLocaleString("pt-BR")}
              delta={dLig(lig.feitas, "feitas")}
              anterior={ligAnt ? `${ligAnt.feitas.toLocaleString("pt-BR")} no período anterior` : null}
            />
            <KpiRel
              label="Recebidas"
              valor={lig.recebidas.toLocaleString("pt-BR")}
              delta={dLig(lig.recebidas, "recebidas")}
              anterior={ligAnt ? `${ligAnt.recebidas.toLocaleString("pt-BR")} no período anterior` : null}
            />
            <KpiRel
              label="Perdidas"
              valor={lig.perdidas.toLocaleString("pt-BR")}
              delta={dLig(lig.perdidas, "perdidas", true)}
              anterior={ligAnt ? `${ligAnt.perdidas.toLocaleString("pt-BR")} no período anterior` : null}
            />
            <KpiRel
              label="Taxa de atendimento"
              valor={lig.taxaAtendimento !== null ? `${lig.taxaAtendimento}%` : "—"}
              delta={ligAnt ? calcularDeltaPontos(lig.taxaAtendimento, ligAnt.taxaAtendimento) : undefined}
              anterior={
                ligAnt?.taxaAtendimento != null
                  ? `${ligAnt.taxaAtendimento}% no período anterior`
                  : "Recebidas ÷ (recebidas + perdidas + recusadas)"
              }
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            <CardRel
              className="lg:col-span-3"
              icone={<PhoneOutgoing className="h-4 w-4 text-muted-foreground" />}
              titulo="Volume diário de ligações"
              aviso={`${totalChamadas.toLocaleString("pt-BR")} chamadas no período`}
            >
              <BarrasDiarias dados={ligacoesPorDia} cor="bg-teal-500" />
            </CardRel>

            <CardRel
              className="lg:col-span-2"
              icone={<PhoneIncoming className="h-4 w-4 text-muted-foreground" />}
              titulo="Ligações por atendente"
              aviso="tempo total em chamada"
            >
              <div className="overflow-x-auto px-1 pb-2">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[10px] uppercase tracking-wide">Atendente</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wide text-center">Feitas</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wide text-center">Receb.</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wide text-center">Perd.</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wide text-right">Tempo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.ligacoesPorAtendente || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">
                          Sem ligações no período.
                        </TableCell>
                      </TableRow>
                    )}
                    {(data.ligacoesPorAtendente as any[]).map((a) => (
                      <TableRow key={a.colabId}>
                        <TableCell className="text-xs font-medium truncate max-w-[140px]">{a.nome}</TableCell>
                        <TableCell className="text-center text-xs tabular-nums">{a.feitas}</TableCell>
                        <TableCell className="text-center text-xs tabular-nums">{a.recebidas}</TableCell>
                        <TableCell className="text-center text-xs font-semibold tabular-nums text-rose-600">
                          {a.perdidas}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {fmtDuracaoLonga(a.duracaoTotalSeg ?? 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardRel>
          </div>
        </>
      )}
    </div>
  );
}

const CORES_CANAL = [
  "bg-emerald-500", "bg-green-500", "bg-rose-500",
  "bg-sky-500", "bg-violet-500", "bg-amber-500",
];

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
 *  - "Contratos fechados" = oportunidades movidas pra etapa **Ganho** no
 *    pipeline (`etapaFunil = 'fechado_ganho'`) dentro do período.
 *  - "Taxa de conversão" = contratos fechados ÷ total de oportunidades.
 *
 * "Oportunidade" é o nome do que a tabela `leads` guarda: uma NEGOCIAÇÃO, não
 * uma pessoa. A aba "Leads" em Clientes conta pessoas na fila, e as duas
 * contagens nunca batem — quem volta com um segundo caso entra de novo aqui e
 * some de lá ao virar cliente. A palavra separada é o que impede a soma.
 *  - "Contatos por origem" só conta canais de captação ativa
 *    (whatsapp, instagram, facebook, manual). Asaas é cobrança de
 *    cliente já existente — não é captação nova.
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

function corBarraMeta(progresso: number): string {
  if (progresso >= 100) return "bg-emerald-500";
  if (progresso >= 70) return "bg-blue-500";
  if (progresso >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function RankingPodioTabela({
  ranking,
  onSelecionar,
}: {
  ranking: any[];
  onSelecionar: (id: number, nome: string) => void;
}) {
  const topTres = ranking.slice(0, 3);
  const resto = ranking.slice(3);
  const bgsPodio = [
    "bg-amber-50 border-amber-300 dark:bg-amber-950/30",
    "bg-slate-100 border-slate-300 dark:bg-slate-800/40",
    "bg-orange-50 border-orange-300 dark:bg-orange-950/30",
  ];

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
        {topTres.map((r: any, idx: number) => {
          const medalha = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
          const progresso = r.progressoMeta ?? 0;
          return (
            <div
              key={r.atendenteId}
              role="button"
              tabIndex={0}
              onClick={() => onSelecionar(r.atendenteId, r.nome)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelecionar(r.atendenteId, r.nome); }}
              className={`border-2 rounded-lg p-3 space-y-2 cursor-pointer hover:shadow-md transition-shadow ${bgsPodio[idx]}`}
              title="Clique pra ver os clientes deste atendente"
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl">{medalha}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{r.nome}</p>
                  {r.setorNome && (
                    <p className="text-[10px] text-muted-foreground">{r.setorNome}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-blue-500/5 border border-blue-500/20 p-2">
                  <p className="text-[10px] text-muted-foreground">Fechado</p>
                  <p className="text-sm font-bold text-blue-700">{formatBRL(r.valorFechado || 0)}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {r.contratosFechados || 0} contrato(s)
                  </p>
                </div>
                <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-2">
                  <p className="text-[10px] text-muted-foreground">Recebido</p>
                  <p className="text-sm font-bold text-emerald-700">{formatBRL(r.faturado)}</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground text-right">
                Ticket médio: {formatBRL(r.ticketMedio)}
              </p>
              {r.meta != null && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span
                      className="text-muted-foreground"
                      title={`Meta mensal: ${formatBRL(r.meta)}`}
                    >
                      Meta: {formatBRL(r.metaPeriodo ?? r.meta)}
                    </span>
                    <span className="font-bold">{progresso.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/60 dark:bg-black/30 overflow-hidden">
                    <div
                      className={`h-full ${corBarraMeta(progresso)}`}
                      style={{ width: `${Math.min(100, progresso)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {resto.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-xs">#</TableHead>
              <TableHead className="text-xs">Atendente</TableHead>
              <TableHead className="text-xs text-right">Fechado</TableHead>
              <TableHead className="text-xs text-right">Contratos</TableHead>
              <TableHead className="text-xs text-right">Recebido</TableHead>
              <TableHead className="text-xs text-right">Ticket médio</TableHead>
              <TableHead className="text-xs w-36">Meta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resto.map((r: any, idxResto: number) => {
              const idx = idxResto + 3;
              const progresso = r.progressoMeta ?? 0;
              return (
                <TableRow
                  key={r.atendenteId}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelecionar(r.atendenteId, r.nome)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelecionar(r.atendenteId, r.nome); }}
                  className="cursor-pointer"
                  title="Clique pra ver os clientes deste atendente"
                >
                  <TableCell className="text-xs text-muted-foreground">#{idx + 1}</TableCell>
                  <TableCell className="text-xs">
                    <p className="font-medium truncate max-w-[180px]">{r.nome}</p>
                    {r.setorNome && (
                      <p className="text-[10px] text-muted-foreground">{r.setorNome}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-right font-medium text-blue-700 tabular-nums">
                    {formatBRL(r.valorFechado || 0)}
                  </TableCell>
                  <TableCell className="text-xs text-right text-muted-foreground tabular-nums">
                    {r.contratosFechados || 0}
                  </TableCell>
                  <TableCell className="text-xs text-right font-medium text-emerald-700 tabular-nums">
                    {formatBRL(r.faturado)}
                  </TableCell>
                  <TableCell className="text-xs text-right text-muted-foreground tabular-nums">
                    {formatBRL(r.ticketMedio)}
                  </TableCell>
                  <TableCell>
                    {r.meta != null ? (
                      <div className="flex items-center gap-2" title={`Meta: ${formatBRL(r.metaPeriodo ?? r.meta)}`}>
                        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden min-w-[40px]">
                          <div
                            className={`h-full ${corBarraMeta(progresso)}`}
                            style={{ width: `${Math.min(100, progresso)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-medium w-10 text-right tabular-nums">
                          {progresso.toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}

/**
 * Cards de "Fechamentos por origem" com drill-down: clicar numa origem
 * abre a lista de clientes daquele fechamento (mesmo recorte de
 * período/atendente do relatório). Aprovado via mockup.
 */
function FechamentosPorOrigemCard({ itens }: { itens: any[] }) {
  const [origemAberta, setOrigemAberta] = useState<string | null>(null);
  const aberta = itens.find((o: any) => o.origem === origemAberta);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Fechamentos por origem</CardTitle>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Origem registrada no cadastro do fechamento (Google revisional, Meta leilão, BNI, etc.).
          Clique num card para ver os clientes.
        </p>
      </CardHeader>
      <CardContent>
        {itens.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Sem fechamentos com origem cadastrada no período.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {itens.map((o: any) => (
                <button
                  key={o.origem}
                  type="button"
                  className={
                    "rounded-lg border p-3 text-center transition-all hover:border-emerald-300 hover:shadow-sm " +
                    (origemAberta === o.origem ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "")
                  }
                  onClick={() => setOrigemAberta(origemAberta === o.origem ? null : o.origem)}
                >
                  <p className="text-xl font-bold text-emerald-700">{o.total}</p>
                  <p className="text-xs text-muted-foreground truncate" title={o.origem}>{o.origem}</p>
                </button>
              ))}
            </div>
            {aberta && (aberta.fechamentos?.length ?? 0) > 0 && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/50 overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2 text-xs flex-wrap">
                  <span>
                    <strong className="text-emerald-900">{aberta.origem}</strong> · {aberta.total} fechamento(s) no período
                  </span>
                  <span className="ml-auto font-bold text-emerald-700">{formatBRL(aberta.valorTotal || 0)}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => setOrigemAberta(null)}
                  >
                    ✕ Fechar
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs bg-white">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-emerald-700 bg-emerald-50/80">
                        <th className="text-left px-3.5 py-1.5 font-semibold">Cliente</th>
                        <th className="text-left px-3.5 py-1.5 font-semibold">Fechado em</th>
                        <th className="text-right px-3.5 py-1.5 font-semibold">Valor</th>
                        <th className="text-left px-3.5 py-1.5 font-semibold">Responsável</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aberta.fechamentos.map((f: any, i: number) => (
                        <tr key={i} className="border-t">
                          <td className="px-3.5 py-1.5">
                            {f.contatoId ? (
                              <a href={`/clientes?id=${f.contatoId}`} className="text-blue-600 font-medium hover:underline">
                                {f.cliente}
                              </a>
                            ) : (
                              f.cliente
                            )}
                          </td>
                          <td className="px-3.5 py-1.5 text-muted-foreground">
                            {f.fechadoEm ? new Date(f.fechadoEm).toLocaleDateString("pt-BR") : "—"}
                          </td>
                          <td className="px-3.5 py-1.5 text-right font-semibold tabular-nums">{formatBRL(f.valor || 0)}</td>
                          <td className="px-3.5 py-1.5 text-muted-foreground">{f.responsavel || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
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
  const { data: detalheAtendente, isLoading: loadingDetalhe } = trpc.relatorios.detalheAtendenteComercial.useQuery(
    {
      atendenteId: atendenteDrillDown?.id ?? 0,
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

  const { data, isLoading } = trpc.relatorios.comercialDashboard.useQuery(
    {
      dataInicio: inicio,
      dataFim: fim,
      setorId: setorIdEfetivo,
      atendenteId: atendenteIdEfetivo,
    },
    { refetchInterval: 60_000, retry: false },
  );

  // Export PDF — mesmos filtros da tela. Padrão do `financeiro.exportarDrePdf`:
  // server gera via pdfkit, retorna base64, client baixa via blob.
  const pdfMut = (trpc as any).relatorios?.exportarComercialPdf?.useMutation?.({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => {
      const blob = base64ToBlob(r.base64, r.mimeType);
      baixarBlob(blob, r.filename, r.mimeType);
      toast.success("PDF baixado");
    },
    onError: (err: any) =>
      toast.error("Erro ao gerar PDF", { description: err.message }),
  });

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
          <div className="flex justify-end mt-3">
            <Button
              size="sm"
              onClick={() => pdfMut?.mutate?.({
                dataInicio: inicio,
                dataFim: fim,
                setorId: setorIdEfetivo,
                atendenteId: atendenteIdEfetivo,
              })}
              disabled={isLoading || !data || pdfMut?.isPending}
              title="Exporta o relatório comercial do período em PDF"
            >
              {pdfMut?.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5 mr-1.5" />
              )}
              PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading || !data ? (
        <LoadingBlock />
      ) : (
        <>
          {/* KPIs principais — 4 cards com métrica principal + secundária derivada */}
          {(() => {
            const faturado = data.kpis.faturado || 0;
            const clientesPagantes = data.kpis.clientesPagantes || 0;
            const clientesFechados = data.kpis.clientesFechados || 0;
            const contratosFechados = data.kpis.contratosFechados || 0;
            const valorTotalFechado = data.kpis.valorTotalFechado || 0;
            const pctRecebidoDoFechado = valorTotalFechado > 0
              ? (faturado / valorTotalFechado) * 100
              : null;
            // Cliente sobre cliente. Contra "contratos fechados" a razão
            // comparava unidades diferentes e podia passar de 100%.
            const pctPagantesDosFechados = clientesFechados > 0
              ? (clientesPagantes / clientesFechados) * 100
              : null;
            const ticketMedioFechado = contratosFechados > 0
              ? valorTotalFechado / contratosFechados
              : 0;
            const ticketMedioPago = data.kpis.ticketMedio || 0;
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="border-2 border-emerald-200">
                  <CardContent className="pt-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                      Recebido
                    </div>
                    <p className="text-2xl font-bold text-emerald-600 tabular-nums">{formatBRL(faturado)}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">vs anterior</span>
                      <VariacaoBadge pct={data.kpis.variacaoFaturado} />
                    </div>
                    <div className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-1 dark:bg-emerald-950/30">
                      {pctRecebidoDoFechado != null ? (
                        <>
                          <p className="text-[10px] text-emerald-700 font-semibold">
                            {pctRecebidoDoFechado.toFixed(1).replace(".", ",")}% do total fechado
                          </p>
                          <p className="text-[9px] text-muted-foreground">
                            de {formatBRL(valorTotalFechado)}
                          </p>
                        </>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">sem fechado no período</p>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground italic">
                      cobranças pagas no período
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-2 border-blue-200">
                  <CardContent className="pt-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
                      Contratos fechados
                    </div>
                    <p className="text-2xl font-bold text-blue-600 tabular-nums">{contratosFechados}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">vs anterior</span>
                      <VariacaoBadge pct={data.kpis.variacaoContratosFechados} />
                    </div>
                    <p className="text-[10px] text-muted-foreground italic">
                      leads ganhos no período
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-2 border-indigo-200">
                  <CardContent className="pt-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-indigo-500" />
                      Clientes que pagaram
                    </div>
                    <p className="text-2xl font-bold text-indigo-600 tabular-nums">{clientesPagantes}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">vs anterior</span>
                      <VariacaoBadge pct={data.kpis.variacaoClientesPagantes} />
                    </div>
                    <div className="rounded bg-indigo-50 border border-indigo-200 px-1.5 py-1 dark:bg-indigo-950/30">
                      {pctPagantesDosFechados != null ? (
                        <>
                          <p className="text-[10px] text-indigo-700 font-semibold">
                            {pctPagantesDosFechados.toFixed(1).replace(".", ",")}% dos que fecharam
                          </p>
                          <p className="text-[9px] text-muted-foreground">
                            {clientesPagantes} de {clientesFechados} clientes
                          </p>
                        </>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">sem fechado no período</p>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground italic">
                      quantas cobranças ele pagou não muda
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-2 border-violet-200">
                  <CardContent className="pt-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Activity className="h-3.5 w-3.5 text-violet-500" />
                      Ticket médio
                    </div>
                    <p className="text-2xl font-bold text-violet-600 tabular-nums">{formatBRL(ticketMedioFechado)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      fechado ÷ contratos fechados
                    </p>
                    <div className="rounded bg-violet-50 border border-violet-200 px-1.5 py-1 dark:bg-violet-950/30">
                      <p className="text-[10px] text-violet-700 font-semibold tabular-nums">
                        {formatBRL(ticketMedioPago)} recebido
                      </p>
                      <p className="text-[9px] text-muted-foreground">
                        recebido ÷ clientes que pagaram
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })()}

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
                <RankingPodioTabela
                  ranking={data.ranking}
                  onSelecionar={(id, nome) => setAtendenteDrillDown({ id, nome })}
                />
              )}
            </CardContent>
          </Card>

          {/* Faturado por dia — mesmo padrão visual do Financeiro */}
          {data.cobrancasPorDia.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Faturado por dia</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56 -mx-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={data.cobrancasPorDia.map((d: any) => ({
                        dia: d.dia,
                        faturado: d.faturado,
                      }))}
                      margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="relatoriosColorFaturado" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis
                        dataKey="dia"
                        tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickFormatter={formatDiaCurto}
                        stroke="#e5e7eb"
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickFormatter={formatBRLShort}
                        stroke="#e5e7eb"
                        width={60}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "white",
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        labelFormatter={formatDiaCompleto}
                        formatter={(v: number) => formatBRL(v)}
                      />
                      <Area
                        type="monotone"
                        dataKey="faturado"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#relatoriosColorFaturado)"
                        name="Faturado"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Funil de Vendas — mesmas etapas em ordem fixa do funil */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Funil de Vendas</CardTitle>
            </CardHeader>
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

          {/* Contatos por canal de captação — enum (whatsapp/instagram/...) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Contatos por canal de captação</CardTitle>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Por onde o contato chegou (WhatsApp, Instagram, Facebook, manual, telefone, site).
              </p>
            </CardHeader>
            <CardContent>
              {(!data.contatosPorOrigem || data.contatosPorOrigem.length === 0) ? (
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

          {/* Fechamentos por origem — texto livre do cadastro de fechamento */}
          <FechamentosPorOrigemCard itens={data.fechamentosPorOrigem || []} />
        </>
      )}

      {/* Drill-down: clientes fechados/pagos pelo atendente no período */}
      <Sheet open={atendenteDrillDown != null} onOpenChange={(o) => { if (!o) setAtendenteDrillDown(null); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{atendenteDrillDown?.nome || "Atendente"}</SheetTitle>
            <SheetDescription>
              Clientes fechados no período e cobranças comissionáveis recebidas — mesmos
              critérios do card de "Recebido" do ranking.
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
                      so_pago: { label: "Pago s/ oportunidade", cor: "bg-blue-100 text-blue-700" },
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

// ───────────────────── aba: Produção ─────────────────────

function AbaProducao() {
  const { periodo, comparar } = useRelatorios();
  // "todos" = sem filtro (undefined no backend); senão, funilId numérico
  const [funilSel, setFunilSel] = useState<string>("");
  const [respSel, setRespSel] = useState<string>("");

  const { data: funis } = trpc.kanban.listarFunis.useQuery(undefined, { retry: false });
  const { data: colabsList } = trpc.configuracoes.listarColaboradoresParaFiltro.useQuery(
    { modulo: "relatorios" },
    { retry: false },
  );

  const filtros = {
    dataInicio: periodo.inicio,
    dataFim: periodo.fim,
    funilId: funilSel === "" ? undefined : Number(funilSel),
    responsavelId: respSel === "" ? undefined : Number(respSel),
  };
  const { data, isLoading } = trpc.relatorios.producao.useQuery(
    { ...filtros, comparar },
    { refetchInterval: 60_000 },
  );

  return (
    <div className="space-y-3">
      <AcoesRelatorio relatorio="producao" filtros={filtros} pronto={!!data} />

      <BarraFiltro>
        <FiltroSelect
          rotulo="Funil"
          valor={funilSel}
          onChange={setFunilSel}
          opcoes={[
            { value: "", label: "Todos" },
            ...((funis || []) as any[]).map((f) => ({ value: String(f.id), label: f.nome })),
          ]}
        />
        <FiltroSelect
          rotulo="Responsável"
          valor={respSel}
          onChange={setRespSel}
          opcoes={[
            { value: "", label: "Todos" },
            ...((colabsList?.colaboradores || []) as any[]).map((c) => ({
              value: String(c.id),
              label: c.userName || c.userEmail || `#${c.id}`,
            })),
          ]}
        />
      </BarraFiltro>

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
  const ant = data.anterior as any | null;
  const mov = data.movimentacaoDetalhe;
  const colunas = (data.cardsPorColuna || []) as Array<{ coluna: string; total: number; conclusao: boolean }>;
  const totalColunas = colunas.reduce((a, c) => a + c.total, 0);
  const maxColuna = Math.max(...colunas.map((c) => c.total), 1);
  const maxMov = Math.max(mov?.entraram || 0, mov?.avancaram || 0, mov?.concluidos || 0, mov?.voltaram || 0, 1);

  const resp = (data.porResponsavel || []) as any[];
  const totaisResp = resp.reduce(
    (a, r) => ({ total: a.total + r.total, noPrazo: a.noPrazo + r.noPrazo, atrasados: a.atrasados + r.atrasados }),
    { total: 0, noPrazo: 0, atrasados: 0 },
  );
  const taxaTotalResp = totaisResp.total > 0
    ? Math.round((totaisResp.noPrazo / totaisResp.total) * 100)
    : null;

  const LINHAS_MOV = [
    { rotulo: "Entraram", valor: mov?.entraram ?? 0, cor: "bg-indigo-500" },
    { rotulo: "Avançaram de etapa", valor: mov?.avancaram ?? 0, cor: "bg-violet-500" },
    { rotulo: "Concluídos", valor: mov?.concluidos ?? 0, cor: "bg-emerald-600" },
    { rotulo: "Voltaram de etapa", valor: mov?.voltaram ?? 0, cor: "bg-amber-500" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiRel
          label="Processos no período"
          valor={data.cardsTotal.toLocaleString("pt-BR")}
          delta={ant ? calcularDelta(data.cardsTotal, ant.cardsTotal) : undefined}
          anterior={ant ? `${ant.cardsTotal.toLocaleString("pt-BR")} no período anterior` : null}
        />
        <KpiRel
          label="Dentro do prazo"
          valor={data.cardsDentroPrazo.toLocaleString("pt-BR")}
          cor="text-emerald-600"
          delta={ant ? calcularDelta(data.cardsDentroPrazo, ant.cardsDentroPrazo) : undefined}
          anterior={ant ? `${ant.cardsDentroPrazo.toLocaleString("pt-BR")} no período anterior` : null}
        />
        <KpiRel
          label="Atrasados"
          valor={data.cardsAtrasados.toLocaleString("pt-BR")}
          cor={data.cardsAtrasados > 0 ? "text-red-600" : undefined}
          delta={ant ? calcularDelta(data.cardsAtrasados, ant.cardsAtrasados, true) : undefined}
          anterior={ant ? `${ant.cardsAtrasados.toLocaleString("pt-BR")} no período anterior` : null}
        />
        <KpiRel
          label="Taxa dentro do prazo"
          valor={`${data.taxaDentroPrazo}%`}
          delta={ant ? calcularDeltaPontos(data.taxaDentroPrazo, ant.taxaDentroPrazo) : undefined}
          anterior={
            ant?.taxaDentroPrazo != null
              ? `${ant.taxaDentroPrazo}% no período anterior`
              : "Cards sem prazo estourado"
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <CardRel
          className="lg:col-span-3"
          icone={<LayoutGrid className="h-4 w-4 text-muted-foreground" />}
          titulo="Distribuição por etapa"
          aviso={
            colunas.length > 0
              ? `${totalColunas.toLocaleString("pt-BR")} processos · concluído em verde`
              : undefined
          }
        >
          {colunas.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">Nenhum card no funil.</p>
          ) : (
            <div className="px-4 pb-3.5 space-y-2">
              {colunas.map((c) => (
                <div key={c.coluna} className="flex items-center gap-3">
                  <span className="w-[38%] shrink-0 truncate text-xs">{c.coluna}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${c.conclusao ? "bg-emerald-600" : "bg-indigo-500"}`}
                      style={{ width: `${Math.max((c.total / maxColuna) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums">
                    {c.total.toLocaleString("pt-BR")}
                  </span>
                  <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {totalColunas > 0 ? `${Math.round((c.total / totalColunas) * 100)}%` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardRel>

        <CardRel
          className="lg:col-span-2"
          icone={<Repeat className="h-4 w-4 text-muted-foreground" />}
          titulo="Movimentação de cards"
          aviso="no período"
        >
          <div className="px-4 pb-3.5 space-y-2">
            {LINHAS_MOV.map((l) => (
              <div key={l.rotulo} className="flex items-center gap-3">
                <span className="w-[46%] shrink-0 truncate text-xs">{l.rotulo}</span>
                <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full ${l.cor}`}
                    style={{ width: `${Math.max((l.valor / maxMov) * 100, 2)}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums">
                  {l.valor.toLocaleString("pt-BR")}
                </span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">
                {(mov?.total ?? 0).toLocaleString("pt-BR")}
              </span>{" "}
              movimentações no total. "Voltaram de etapa" é o número que vale olhar: mede retrabalho.
            </p>
          </div>
        </CardRel>
      </div>

      <CardRel
        icone={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
        titulo="Produção por responsável"
        aviso="quem entrega no prazo"
      >
        <div className="overflow-x-auto px-1 pb-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-wide">Responsável</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">Processos</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">No prazo</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-center">Atrasados</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-right">Taxa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resp.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">
                    Nenhum processo com responsável no período.
                  </TableCell>
                </TableRow>
              )}
              {resp.map((r, i) => (
                <TableRow key={r.colabId}>
                  <TableCell className="text-xs font-medium">
                    <span className="flex items-center gap-2">
                      <Avatar nome={r.nome} indice={i} />
                      <span className="truncate">{r.nome}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums">{r.total}</TableCell>
                  <TableCell className="text-center text-xs font-semibold tabular-nums text-emerald-600">
                    {r.noPrazo}
                  </TableCell>
                  <TableCell className="text-center text-xs font-semibold tabular-nums text-rose-600">
                    {r.atrasados}
                  </TableCell>
                  <TableCell className="text-right">
                    <PastilhaTaxa taxa={r.taxaDentroPrazo} referencia={taxaTotalResp} />
                  </TableCell>
                </TableRow>
              ))}
              {resp.length > 0 && (
                <TableRow className="bg-muted/40 hover:bg-muted/40 font-semibold">
                  <TableCell className="text-xs">Total</TableCell>
                  <TableCell className="text-center text-xs tabular-nums">{totaisResp.total}</TableCell>
                  <TableCell className="text-center text-xs tabular-nums text-emerald-600">
                    {totaisResp.noPrazo}
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums text-rose-600">
                    {totaisResp.atrasados}
                  </TableCell>
                  <TableCell className="text-right">
                    <PastilhaTaxa taxa={taxaTotalResp} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardRel>
    </div>
  );
}

// ───────────────────── aba: Agenda ─────────────────────

const TIPO_AGENDA_LABELS: Record<string, string> = {
  prazo_processual: "Prazo processual",
  audiencia: "Audiência",
  reuniao_comercial: "Reunião comercial",
  tarefa: "Tarefa",
  follow_up: "Follow-up",
  outro: "Outro",
};

/** Formata o bucket "YYYY-MM-DD" da série conforme a granularidade. */
function formatBucketAgenda(bucket: string, gran: string): string {
  const [y, m, d] = bucket.split("-");
  if (!y || !m) return bucket;
  return gran === "mes" ? `${m}/${y}` : `${d}/${m}`;
}

function AbaAgenda() {
  const [periodoSel, setPeriodoSel] = useState<string>(String(DIAS_DEFAULT_RELATORIO));
  const [{ inicio, fim }, setRange] = useState(() => rangeDeDias(DIAS_DEFAULT_RELATORIO));
  const [tipoSel, setTipoSel] = useState<string>("todos");
  const [atendenteSel, setAtendenteSel] = useState<string>("__all__");

  const { data: colabsList } = trpc.configuracoes.listarColaboradoresParaFiltro.useQuery(
    { modulo: "relatorios" },
    { retry: false },
  );

  // Período: preset de dias OU range customizado (quando "custom").
  const filtroInput = {
    ...(periodoSel === "custom"
      ? { dataInicio: inicio, dataFim: fim }
      : { dias: Number(periodoSel) }),
    tipo: tipoSel === "todos" ? undefined : (tipoSel as any),
    atendenteId: atendenteSel === "__all__" ? undefined : Number(atendenteSel),
  };

  const { data, isLoading } = trpc.relatorios.agenda.useQuery(filtroInput, {
    refetchInterval: 60_000,
  });

  const pdfMut = (trpc as any).relatorios?.exportarAgendaPdf?.useMutation?.({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => {
      const blob = base64ToBlob(r.base64, r.mimeType);
      baixarBlob(blob, r.filename, r.mimeType);
      toast.success("PDF baixado");
    },
    onError: (err: any) => toast.error("Erro ao gerar PDF", { description: err.message }),
  });

  return (
    <div className="space-y-4">
      {/* Filtros locais */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Período:</span>
        <Select value={periodoSel} onValueChange={setPeriodoSel}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="15">Últimos 15 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
            <SelectItem value="365">Último ano</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>

        {periodoSel === "custom" && (
          <>
            <Input
              type="date"
              className="w-[140px] h-9 text-xs"
              value={inicio}
              max={fim}
              onChange={(e) => setRange((r) => ({ ...r, inicio: e.target.value }))}
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              className="w-[140px] h-9 text-xs"
              value={fim}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setRange((r) => ({ ...r, fim: e.target.value }))}
            />
          </>
        )}

        <span className="text-xs text-muted-foreground ml-2">Tipo:</span>
        <Select value={tipoSel} onValueChange={setTipoSel}>
          <SelectTrigger className="w-44 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {Object.entries(TIPO_AGENDA_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground ml-2">Atendente:</span>
        <Select value={atendenteSel} onValueChange={setAtendenteSel}>
          <SelectTrigger className="w-48 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os atendentes</SelectItem>
            {((colabsList?.colaboradores || []) as any[]).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.userName || c.userEmail || `#${c.id}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          className="h-9 ml-auto"
          disabled={pdfMut?.isPending || !data}
          onClick={() => pdfMut?.mutate?.(filtroInput)}
        >
          {pdfMut?.isPending ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <FileText className="h-4 w-4 mr-1.5" />
          )}
          Exportar PDF
        </Button>
      </div>

      {isLoading ? <LoadingBlock /> : !data ? <Empty /> : <AgendaConteudo data={data} />}
    </div>
  );
}

function AgendaConteudo({ data }: { data: any }) {
  const t = data.totais;
  const chartData = (data.serie || []).map((s: any) => ({
    label: formatBucketAgenda(s.bucket, data.granularidade),
    comp: s.compareceu,
    nao: s.naoCompareceu,
    rem: s.remarcado,
  }));
  const maxTipo = Math.max(1, ...(data.porTipo || []).map((x: any) => x.total));

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={<CalendarCheck className="h-5 w-5 text-slate-500" />} label="Agendamentos no período" value={t.total} />
        <Kpi icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />} label="Compareceram" value={t.compareceu} highlight="text-emerald-600" />
        <Kpi icon={<XCircle className="h-5 w-5 text-rose-500" />} label="Não vieram" value={t.naoCompareceu} highlight="text-rose-600" />
        <Kpi icon={<Repeat className="h-5 w-5 text-amber-500" />} label="Remarcaram" value={t.remarcado} highlight="text-amber-600" />
        <Kpi icon={<Hourglass className="h-5 w-5 text-slate-400" />} label="Sem resultado" value={t.pendente} />
        <Kpi
          icon={<Target className="h-5 w-5 text-violet-500" />}
          label="Taxa de comparecimento"
          value={t.taxaComparecimento == null ? "—" : `${t.taxaComparecimento}%`}
          highlight="text-violet-600"
        />
      </div>

      {/* Série temporal empilhada por resultado */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
            <span>Agendamentos por período</span>
            <span className="flex items-center gap-3 text-[11px] font-normal text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Compareceu</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />Não veio</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />Remarcou</span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Sem agendamentos no período.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="comp" name="Compareceu" stackId="a" fill="#10b981" />
                  <Bar dataKey="nao" name="Não veio" stackId="a" fill="#f43f5e" />
                  <Bar dataKey="rem" name="Remarcou" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Por tipo de compromisso */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Por tipo de compromisso</CardTitle></CardHeader>
          <CardContent>
            {(data.porTipo || []).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">Sem dados.</p>
            ) : (
              <div className="space-y-2.5">
                {data.porTipo.map((x: any) => (
                  <div key={x.tipo} className="flex items-center gap-3 text-sm">
                    <span className="w-36 shrink-0 truncate text-muted-foreground">{TIPO_AGENDA_LABELS[x.tipo] || x.tipo}</span>
                    <div className="flex-1 h-5 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-violet-500" style={{ width: `${(x.total / maxTipo) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right font-bold tabular-nums">{x.total}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ranking por atendente */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-violet-500" /> Por atendente</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(data.porAtendente || []).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">Sem agendamentos no período.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Atendente</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                    <TableHead className="text-xs text-right">Veio</TableHead>
                    <TableHead className="text-xs text-right">Não</TableHead>
                    <TableHead className="text-xs text-right">Remarc.</TableHead>
                    <TableHead className="text-xs text-right">Taxa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.porAtendente.map((a: any) => (
                    <TableRow key={a.colabId}>
                      <TableCell className="text-xs font-medium max-w-[160px] truncate">{a.nome}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-bold">{a.total}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-emerald-600">{a.compareceu}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-rose-600">{a.naoCompareceu}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-amber-600">{a.remarcado}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-semibold">{a.taxaComparecimento == null ? "—" : `${a.taxaComparecimento}%`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ───────────────────── aba: Cálculos ─────────────────────

function AbaCalculos() {
  const [dias, setDias] = useState<string>(String(DIAS_DEFAULT_RELATORIO));
  const { data, isLoading } = trpc.relatorios.calculos.useQuery(
    { dias: Number(dias) },
    { refetchInterval: 60_000 },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Período:</span>
        <Select value={dias} onValueChange={setDias}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="15">Últimos 15 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
            <SelectItem value="365">Último ano</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <Empty />
      ) : (
        <AbaCalculosConteudo data={data} />
      )}
    </div>
  );
}

function AbaCalculosConteudo({ data }: { data: any }) {
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
