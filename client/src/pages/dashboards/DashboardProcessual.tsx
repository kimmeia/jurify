/**
 * Variante processual do dashboard — o painel pós-login de quem contratou
 * só o pacote Acompanhamento Processual. Zero widget de módulo não
 * contratado: movimentações, monitoramentos, novas ações e prazos.
 *
 * Quem tem a suíte completa nunca vê esta tela (Dashboard.tsx decide pelo
 * contrato via pacoteProcessualPuro).
 */

import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KPICard, PainelTopo } from "./common";
import { Bell, CalendarClock, FileSearch, Radar } from "lucide-react";

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function tempoRelativo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `há ${Math.max(1, min)}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default function DashboardProcessual() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data, isLoading } = trpc.painelProcessual.resumo.useQuery(undefined, {
    refetchInterval: 2 * 60_000,
    retry: false,
  });

  const primeiroNome = (user?.name ?? "").split(" ")[0] || "!";

  if (isLoading || !data) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const prazos = data.prazosSemana.filter((p) => !p.concluido);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <PainelTopo
        titulo={`${saudacao()}, ${primeiroNome}`}
        subtitulo="Acompanhamento processual do escritório"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Movimentações a resolver"
          value={data.movimentacoesAResolver}
          icon={Bell}
          iconBg="bg-rose-100 dark:bg-rose-900/30"
          iconFg="text-rose-600 dark:text-rose-300"
          hint={
            data.sugestoesPrazoPendentes > 0
              ? `${data.sugestoesPrazoPendentes} sugestão${data.sugestoesPrazoPendentes > 1 ? "es" : ""} de prazo aguardando`
              : "últimos 30 dias"
          }
        />
        <KPICard
          label="Monitoramentos ativos"
          value={data.monitoramentosAtivos}
          icon={Radar}
          iconBg="bg-violet-100 dark:bg-violet-900/30"
          iconFg="text-violet-600 dark:text-violet-300"
          badge={
            data.monitoramentosParados > 0 ? (
              <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-600 dark:text-rose-300">
                {data.monitoramentosParados} parado{data.monitoramentosParados > 1 ? "s" : ""}
              </Badge>
            ) : undefined
          }
          hint="CNJ + CPF/CNPJ"
        />
        <KPICard
          label="Novas ações pendentes"
          value={data.novasAcoesPendentes}
          icon={FileSearch}
          iconBg="bg-amber-100 dark:bg-amber-900/30"
          iconFg="text-amber-600 dark:text-amber-300"
          hint="aguardando triagem"
        />
        <KPICard
          label="Prazos desta semana"
          value={prazos.length}
          icon={CalendarClock}
          iconBg="bg-emerald-100 dark:bg-emerald-900/30"
          iconFg="text-emerald-600 dark:text-emerald-300"
          hint={`${prazos.filter((p) => p.tipo === "audiencia").length} de audiência`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.7fr_1fr] items-start">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-bold">Últimas movimentações</CardTitle>
            <button
              type="button"
              className="text-xs font-semibold text-violet-700 dark:text-violet-300 hover:underline"
              onClick={() => setLocation("/processos")}
            >
              abrir a central →
            </button>
          </CardHeader>
          <CardContent className="pt-0">
            {data.ultimasMovimentacoes.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma movimentação ainda — os monitoramentos avisam aqui.
              </p>
            ) : (
              <div className="divide-y">
                {data.ultimasMovimentacoes.map((m) => (
                  <div key={m.id} className="flex items-center gap-2.5 py-2 text-sm">
                    <Badge
                      variant="outline"
                      className={`text-[9px] font-bold shrink-0 ${
                        m.relevancia === "relevante"
                          ? "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10"
                          : "border-transparent bg-muted text-muted-foreground"
                      }`}
                    >
                      {m.relevancia === "relevante" ? "RELEVANTE" : "ROTINA"}
                    </Badge>
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{m.cliente}</span>
                      <span className="text-muted-foreground"> — {m.titulo}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {tempoRelativo(m.dataEvento)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-bold">Prazos desta semana</CardTitle>
            <button
              type="button"
              className="text-xs font-semibold text-violet-700 dark:text-violet-300 hover:underline"
              onClick={() => setLocation("/prazos")}
            >
              ver todos →
            </button>
          </CardHeader>
          <CardContent className="pt-0">
            {prazos.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Semana sem prazos. 🎉</p>
            ) : (
              <div className="divide-y">
                {prazos.map((p) => {
                  const d = new Date(p.dataInicio);
                  return (
                    <div key={p.id} className="flex items-center gap-2.5 py-2 text-sm">
                      <span className="w-12 shrink-0 text-[10px] font-bold uppercase text-muted-foreground tabular-nums">
                        {DIAS_SEMANA[d.getDay()]} {d.getDate()}
                      </span>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          p.tipo === "audiencia"
                            ? "bg-violet-500"
                            : p.prioridade === "alta" || p.prioridade === "critica"
                              ? "bg-rose-500"
                              : "bg-amber-500"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium leading-tight">{p.titulo}</span>
                        {(p.contatoNome || p.responsavelNome) && (
                          <span className="block truncate text-[11px] text-muted-foreground leading-tight">
                            {p.contatoNome ?? p.responsavelNome}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
