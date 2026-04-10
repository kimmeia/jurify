/**
 * Métricas — KPIs de produção do escritório.
 * Visão Comercial (vendas) + Operacional (jurídico).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3, TrendingUp, Users, DollarSign, AlertTriangle,
  CheckCircle2, Clock, Target, Percent, MessageCircle,
  LayoutGrid, ArrowDown, ArrowUp,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";

const CORES_PIE = ["#6366f1", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function Metricas() {
  const [tab, setTab] = useState("comercial");
  const [dias, setDias] = useState("30");

  const { data: comercial, isLoading: loadCom } = (trpc as any).metricas.comercial.useQuery(
    { dias: Number(dias) },
    { refetchInterval: 60000 },
  );
  const { data: operacional, isLoading: loadOp } = (trpc as any).metricas.operacional.useQuery(
    { dias: Number(dias) },
    { refetchInterval: 60000 },
  );

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/40 dark:to-indigo-900/40">
          <BarChart3 className="h-6 w-6 text-blue-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Métricas</h1>
          <p className="text-sm text-muted-foreground">Indicadores de produção comercial e operacional</p>
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
        <TabsList className="grid w-full grid-cols-2 h-9">
          <TabsTrigger value="comercial" className="text-xs gap-1"><TrendingUp className="h-3 w-3" /> Comercial</TabsTrigger>
          <TabsTrigger value="operacional" className="text-xs gap-1"><LayoutGrid className="h-3 w-3" /> Operacional</TabsTrigger>
        </TabsList>

        {/* ─── COMERCIAL ─────────────────────────────────────────────────── */}
        <TabsContent value="comercial" className="mt-4">
          {loadCom ? (
            <div className="grid grid-cols-4 gap-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
          ) : comercial ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <MessageCircle className="h-8 w-8 text-blue-500" />
                      <div>
                        <p className="text-2xl font-bold">{comercial.conversasAtendidas}</p>
                        <p className="text-[10px] text-muted-foreground">Conversas atendidas</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <Users className="h-8 w-8 text-violet-500" />
                      <div>
                        <p className="text-2xl font-bold">{comercial.leadsAtendidos}</p>
                        <p className="text-[10px] text-muted-foreground">Leads no período</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                      <div>
                        <p className="text-2xl font-bold text-emerald-600">{comercial.leadsGanhos}</p>
                        <p className="text-[10px] text-muted-foreground">Contratos fechados</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <Target className="h-8 w-8 text-indigo-500" />
                      <div>
                        <p className="text-2xl font-bold text-indigo-600">{comercial.taxaConversao}%</p>
                        <p className="text-[10px] text-muted-foreground">Taxa de conversão</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <DollarSign className="h-8 w-8 text-emerald-500" />
                      <div>
                        <p className="text-xl font-bold text-emerald-600">{formatBRL(comercial.valorGanho)}</p>
                        <p className="text-[10px] text-muted-foreground">Receita estimada (leads ganhos)</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-8 w-8 text-red-500" />
                      <div>
                        <p className="text-xl font-bold text-red-600">{comercial.leadsPerdidos}</p>
                        <p className="text-[10px] text-muted-foreground">Leads perdidos</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Funil visual */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Funil de vendas</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { etapa: "Conversas", valor: comercial.conversasAtendidas },
                        { etapa: "Leads", valor: comercial.leadsAtendidos },
                        { etapa: "Fechados", valor: comercial.leadsGanhos },
                        { etapa: "Perdidos", valor: comercial.leadsPerdidos },
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="etapa" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="valor" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>

        {/* ─── OPERACIONAL ───────────────────────────────────────────────── */}
        <TabsContent value="operacional" className="mt-4">
          {loadOp ? (
            <div className="grid grid-cols-4 gap-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
          ) : operacional ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <LayoutGrid className="h-8 w-8 text-indigo-500" />
                      <div>
                        <p className="text-2xl font-bold">{operacional.cardsTotal}</p>
                        <p className="text-[10px] text-muted-foreground">Processos no período</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                      <div>
                        <p className="text-2xl font-bold text-emerald-600">{operacional.cardsDentroPrazo}</p>
                        <p className="text-[10px] text-muted-foreground">Dentro do prazo</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className={operacional.cardsAtrasados > 0 ? "border-red-300" : ""}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className={`h-8 w-8 ${operacional.cardsAtrasados > 0 ? "text-red-500" : "text-gray-400"}`} />
                      <div>
                        <p className={`text-2xl font-bold ${operacional.cardsAtrasados > 0 ? "text-red-600" : ""}`}>{operacional.cardsAtrasados}</p>
                        <p className="text-[10px] text-muted-foreground">Atrasados</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <Percent className="h-8 w-8 text-blue-500" />
                      <div>
                        <p className="text-2xl font-bold text-blue-600">{operacional.taxaDentroPrazo}%</p>
                        <p className="text-[10px] text-muted-foreground">Taxa dentro do prazo</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Distribuição por coluna */}
              {operacional.cardsPorColuna?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Distribuição por etapa</CardTitle></CardHeader>
                  <CardContent>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={operacional.cardsPorColuna}>
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
                    <ArrowUp className="h-6 w-6 text-blue-500" />
                    <div>
                      <p className="text-lg font-bold">{operacional.movimentacoes}</p>
                      <p className="text-[10px] text-muted-foreground">Movimentações de cards no período (entradas, andamentos, conclusões)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
