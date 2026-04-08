import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ScrollText, ShieldAlert, User, Building2, FileText, ChevronLeft, ChevronRight,
  Lock, Unlock, LogIn, RotateCcw, Coins, AlertTriangle,
} from "lucide-react";
import { useState } from "react";

const ACAO_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  "user.bloquear": { label: "Bloqueou usuário", icon: Lock, color: "text-red-600 bg-red-500/10" },
  "user.desbloquear": { label: "Desbloqueou usuário", icon: Unlock, color: "text-emerald-600 bg-emerald-500/10" },
  "user.impersonar": { label: "Entrou como usuário", icon: LogIn, color: "text-blue-600 bg-blue-500/10" },
  "user.resetSenha": { label: "Resetou senha", icon: RotateCcw, color: "text-amber-600 bg-amber-500/10" },
  "user.updateRole": { label: "Mudou role", icon: ShieldAlert, color: "text-violet-600 bg-violet-500/10" },
  "user.concederCreditos": { label: "Concedeu créditos", icon: Coins, color: "text-emerald-600 bg-emerald-500/10" },
  "escritorio.suspender": { label: "Suspendeu escritório", icon: AlertTriangle, color: "text-red-600 bg-red-500/10" },
  "escritorio.reativar": { label: "Reativou escritório", icon: Building2, color: "text-emerald-600 bg-emerald-500/10" },
};

function AcaoBadge({ acao }: { acao: string }) {
  const config = ACAO_LABELS[acao] || { label: acao, icon: FileText, color: "text-slate-600 bg-slate-500/10" };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${config.color}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

const PAGE_SIZE = 50;

export default function AdminAuditoria() {
  const [acao, setAcao] = useState<string>("all");
  const [alvoTipo, setAlvoTipo] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data: stats } = trpc.admin.estatisticasAuditoria.useQuery();
  const { data, isLoading } = trpc.admin.listarAuditoria.useQuery({
    acao: acao !== "all" ? acao : undefined,
    alvoTipo: alvoTipo !== "all" ? alvoTipo : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-100 to-yellow-100 dark:from-amber-900/40 dark:to-yellow-900/40">
          <ScrollText className="h-6 w-6 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Auditoria</h1>
          <p className="text-muted-foreground mt-1">
            Histórico completo de ações administrativas. Imutável e rastreável.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Eventos nos últimos 7 dias</p>
            <p className="text-3xl font-bold mt-1">{stats?.totalUltimos7Dias ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-2">Top 3 ações</p>
            {stats?.topAcoes && stats.topAcoes.length > 0 ? (
              <div className="space-y-1">
                {stats.topAcoes.slice(0, 3).map((a) => (
                  <div key={a.acao} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate">
                      {ACAO_LABELS[a.acao]?.label || a.acao}
                    </span>
                    <span className="font-bold">{a.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sem dados</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-2">Top 3 administradores</p>
            {stats?.topAtores && stats.topAtores.length > 0 ? (
              <div className="space-y-1">
                {stats.topAtores.slice(0, 3).map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate">{a.name}</span>
                    <span className="font-bold">{a.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sem dados</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filtros + Tabela */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base">Histórico de eventos</CardTitle>
              <CardDescription>
                {total} {total === 1 ? "evento registrado" : "eventos registrados"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={acao} onValueChange={(v) => { setAcao(v); setPage(0); }}>
                <SelectTrigger className="w-[200px] text-sm">
                  <SelectValue placeholder="Filtrar por ação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as ações</SelectItem>
                  {Object.entries(ACAO_LABELS).map(([key, val]) => (
                    <SelectItem key={key} value={key}>{val.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={alvoTipo} onValueChange={(v) => { setAlvoTipo(v); setPage(0); }}>
                <SelectTrigger className="w-[160px] text-sm">
                  <SelectValue placeholder="Tipo de alvo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="user">Usuário</SelectItem>
                  <SelectItem value="escritorio">Escritório</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <ScrollText className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">Nenhum evento registrado.</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Quem</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Alvo</TableHead>
                    <TableHead>Detalhes</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString("pt-BR", {
                          day: "2-digit", month: "2-digit", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3 text-muted-foreground" />
                          {log.actorName || "?"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <AcaoBadge acao={log.acao} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.alvoNome ? (
                          <div className="flex items-center gap-1.5">
                            {log.alvoTipo === "escritorio" ? (
                              <Building2 className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <User className="h-3 w-3 text-muted-foreground" />
                            )}
                            <span className="truncate max-w-[180px]">{log.alvoNome}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                        {log.detalhes ? (
                          typeof log.detalhes === "object" ? (
                            <code className="text-[10px] truncate block">
                              {Object.entries(log.detalhes).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                            </code>
                          ) : (
                            <span className="truncate block">{String(log.detalhes)}</span>
                          )
                        ) : (
                          <span>—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {log.ip || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Paginação */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <p className="text-xs text-muted-foreground">
                    Página {page + 1} de {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Próxima
                      <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
