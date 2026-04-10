/**
 * Admin — Judit Processos (tempo real)
 *
 * Dashboard completo: KPIs, créditos por escritório, transações,
 * monitoramentos, credenciais, alertas de saldo baixo.
 * Atualiza automaticamente a cada 30s.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Coins, AlertTriangle, Radar, KeyRound, TrendingUp, TrendingDown,
  ShoppingCart, History, Eye, Pause, CheckCircle2, Clock, XCircle,
  RefreshCw, ArrowDown, ArrowUp, Activity, Shield,
} from "lucide-react";

const REFRESH = 30000; // 30s tempo real

function formatNum(n: number) {
  return n.toLocaleString("pt-BR");
}

export default function AdminJudit() {
  const [tab, setTab] = useState("visao-geral");

  const { data: kpis, isLoading: loadingKpis } = (trpc as any).adminJudit.kpis.useQuery(undefined, { refetchInterval: REFRESH });
  const { data: creditos } = (trpc as any).adminJudit.creditosPorEscritorio.useQuery(undefined, { refetchInterval: REFRESH });
  const { data: alertas } = (trpc as any).adminJudit.alertasSaldoBaixo.useQuery(undefined, { refetchInterval: REFRESH });
  const { data: transacoes } = (trpc as any).adminJudit.transacoes.useQuery({ limite: 50 }, { refetchInterval: REFRESH });
  const { data: monitoramentos } = (trpc as any).adminJudit.monitoramentos.useQuery({ limite: 50 }, { refetchInterval: REFRESH });
  const { data: credenciais } = (trpc as any).adminJudit.credenciais.useQuery(undefined, { refetchInterval: REFRESH });

  if (loadingKpis) {
    return (
      <div className="space-y-4 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  const k = kpis || { creditos: {}, monitoramentos: {}, ultimas24h: {}, credenciais: {} };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Judit Processos</h1>
          <p className="text-sm text-muted-foreground">Créditos, monitoramentos e credenciais — tempo real (30s)</p>
        </div>
        <Badge variant="outline" className="text-xs gap-1">
          <Activity className="h-3 w-3 text-emerald-500 animate-pulse" /> Ao vivo
        </Badge>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <Coins className="h-8 w-8 text-indigo-500" />
              <div>
                <p className="text-2xl font-bold">{formatNum(k.creditos.saldoTotal)}</p>
                <p className="text-[10px] text-muted-foreground">Saldo total (todos)</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-0.5"><ArrowUp className="h-3 w-3 text-emerald-500" />{formatNum(k.creditos.totalComprado)} comprados</span>
              <span className="flex items-center gap-0.5"><ArrowDown className="h-3 w-3 text-red-500" />{formatNum(k.creditos.totalConsumido)} consumidos</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <Radar className="h-8 w-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{formatNum(k.monitoramentos.ativos)}</p>
                <p className="text-[10px] text-muted-foreground">Monitoramentos ativos</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              <span><Pause className="h-3 w-3 inline text-amber-500" /> {k.monitoramentos.pausados} pausados</span>
              <span>Total: {formatNum(k.monitoramentos.total)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <History className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{formatNum(k.ultimas24h.creditosConsumidos)}</p>
                <p className="text-[10px] text-muted-foreground">Consumo 24h</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              <span>{k.ultimas24h.transacoes} transações</span>
              <span>+{formatNum(k.ultimas24h.creditosComprados)} comprados</span>
            </div>
          </CardContent>
        </Card>

        <Card className={k.creditos.escritoriosSaldoBaixo > 0 ? "border-red-300 bg-red-50/30" : ""}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className={`h-8 w-8 ${k.creditos.escritoriosSaldoBaixo > 0 ? "text-red-500" : "text-gray-400"}`} />
              <div>
                <p className="text-2xl font-bold">{k.creditos.escritoriosSaldoBaixo}</p>
                <p className="text-[10px] text-muted-foreground">Saldo baixo (&lt;10)</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              <span><KeyRound className="h-3 w-3 inline" /> {k.credenciais.ativas} cred. ativas</span>
              <span>{k.credenciais.erro} com erro</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alertas saldo baixo */}
      {alertas && alertas.length > 0 && (
        <Card className="border-red-300 bg-red-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" /> Escritórios com saldo baixo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {alertas.map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-dashed last:border-0">
                  <span className="font-medium">{a.escritorioNome || `Escritório #${a.escritorioId}`}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{formatNum(a.totalConsumido)} consumidos</span>
                    <Badge variant="destructive" className="text-[10px]">{a.saldo} créditos</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-4 h-9">
          <TabsTrigger value="visao-geral" className="text-xs">Créditos</TabsTrigger>
          <TabsTrigger value="transacoes" className="text-xs">Transações</TabsTrigger>
          <TabsTrigger value="monitoramentos" className="text-xs">Monitoramentos</TabsTrigger>
          <TabsTrigger value="credenciais" className="text-xs">Credenciais</TabsTrigger>
        </TabsList>

        {/* Créditos por escritório */}
        <TabsContent value="visao-geral" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Créditos por escritório</CardTitle>
            </CardHeader>
            <CardContent>
              {!creditos || creditos.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Nenhum escritório com créditos.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2">Escritório</th>
                        <th className="text-right py-2 px-2">Saldo</th>
                        <th className="text-right py-2 px-2">Comprado</th>
                        <th className="text-right py-2 px-2">Consumido</th>
                        <th className="text-right py-2 px-2">Uso %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditos.map((c: any) => {
                        const uso = c.totalComprado > 0 ? Math.round((c.totalConsumido / c.totalComprado) * 100) : 0;
                        return (
                          <tr key={c.id} className="border-b hover:bg-muted/30">
                            <td className="py-2 px-2 font-medium">{c.escritorioNome || `#${c.escritorioId}`}</td>
                            <td className={`py-2 px-2 text-right font-mono font-bold ${c.saldo < 10 ? "text-red-600" : ""}`}>{formatNum(c.saldo)}</td>
                            <td className="py-2 px-2 text-right font-mono text-emerald-600">{formatNum(c.totalComprado)}</td>
                            <td className="py-2 px-2 text-right font-mono text-red-600">{formatNum(c.totalConsumido)}</td>
                            <td className="py-2 px-2 text-right">
                              <div className="w-16 h-1.5 bg-gray-200 rounded-full ml-auto">
                                <div className={`h-full rounded-full ${uso > 80 ? "bg-red-500" : uso > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(uso, 100)}%` }} />
                              </div>
                              <span className="text-[9px] text-muted-foreground">{uso}%</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transações */}
        <TabsContent value="transacoes" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Últimas transações de crédito</CardTitle>
            </CardHeader>
            <CardContent>
              {!transacoes || transacoes.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Nenhuma transação.</p>
              ) : (
                <div className="space-y-1 max-h-[500px] overflow-y-auto">
                  {transacoes.map((tx: any) => (
                    <div key={tx.id} className="flex items-center gap-3 text-xs py-2 border-b border-dashed last:border-0">
                      <Badge variant="outline" className={`text-[9px] w-16 justify-center ${
                        tx.tipo === "compra" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                        tx.tipo === "consumo" ? "bg-red-50 text-red-700 border-red-200" :
                        tx.tipo === "bonus" ? "bg-blue-50 text-blue-700 border-blue-200" :
                        "bg-amber-50 text-amber-700 border-amber-200"
                      }`}>
                        {tx.tipo}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{tx.operacao}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{tx.detalhes} — {tx.escritorioNome || `Esc #${tx.escritorioId}`}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-mono font-bold ${tx.tipo === "compra" || tx.tipo === "bonus" ? "text-emerald-600" : "text-red-600"}`}>
                          {tx.tipo === "compra" || tx.tipo === "bonus" ? "+" : "-"}{tx.quantidade}
                        </p>
                        <p className="text-[9px] text-muted-foreground">{tx.saldoAnterior} → {tx.saldoDepois}</p>
                      </div>
                      <span className="text-[9px] text-muted-foreground shrink-0 w-14 text-right">
                        {new Date(tx.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Monitoramentos */}
        <TabsContent value="monitoramentos" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Monitoramentos (todos os escritórios)</CardTitle>
            </CardHeader>
            <CardContent>
              {!monitoramentos || monitoramentos.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Nenhum monitoramento.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2">Chave</th>
                        <th className="text-left py-2 px-2">Tipo</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-right py-2 px-2">Atualizações</th>
                        <th className="text-right py-2 px-2">Última cobrança</th>
                        <th className="text-right py-2 px-2">Atualizado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monitoramentos.map((m: any) => (
                        <tr key={m.id} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-2 font-mono">{m.apelido || m.searchKey}</td>
                          <td className="py-2 px-2">
                            <Badge variant="outline" className="text-[9px]">{m.tipoMonitoramento || m.searchType}</Badge>
                          </td>
                          <td className="py-2 px-2">
                            <Badge variant="outline" className={`text-[9px] ${
                              m.statusJudit === "updated" || m.statusJudit === "created" ? "bg-emerald-50 text-emerald-700" :
                              m.statusJudit === "paused" ? "bg-amber-50 text-amber-700" :
                              m.statusJudit === "deleted" ? "bg-red-50 text-red-700" : ""
                            }`}>
                              {m.statusJudit}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-right font-mono">{m.totalAtualizacoes}</td>
                          <td className="py-2 px-2 text-right text-[10px] text-muted-foreground">
                            {m.ultimaCobrancaMensal ? new Date(m.ultimaCobrancaMensal).toLocaleDateString("pt-BR") : "—"}
                          </td>
                          <td className="py-2 px-2 text-right text-[10px] text-muted-foreground">
                            {new Date(m.updatedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Credenciais */}
        <TabsContent value="credenciais" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Credenciais do cofre (todos os escritórios)</CardTitle>
            </CardHeader>
            <CardContent>
              {!credenciais || credenciais.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Nenhuma credencial cadastrada.</p>
              ) : (
                <div className="space-y-2">
                  {credenciais.map((c: any) => (
                    <div key={c.id} className="flex items-center gap-3 text-xs py-2 border-b border-dashed last:border-0">
                      <KeyRound className="h-4 w-4 text-violet-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{c.customerKey}</p>
                        <p className="text-[10px] text-muted-foreground">{c.systemName} — {c.username} — {c.escritorioNome || `Esc #${c.escritorioId}`}</p>
                      </div>
                      <Badge variant="outline" className={`text-[9px] ${
                        c.status === "ativa" ? "bg-emerald-50 text-emerald-700" :
                        c.status === "validando" ? "bg-blue-50 text-blue-700" :
                        c.status === "erro" ? "bg-red-50 text-red-700" :
                        "bg-gray-50 text-gray-700"
                      }`}>
                        {c.status}
                      </Badge>
                      {c.mensagemErro && <span className="text-[9px] text-red-600 max-w-48 truncate">{c.mensagemErro}</span>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
