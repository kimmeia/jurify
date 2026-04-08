import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Mail, ExternalLink, DollarSign, CheckCircle2 } from "lucide-react";

function formatBRL(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function diasAtraso(periodEnd: number | null): number {
  if (!periodEnd) return 0;
  const diff = Date.now() - periodEnd;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function AtrasoBadge({ dias }: { dias: number }) {
  if (dias === 0) {
    return <Badge variant="outline" className="text-[10px]">Vence hoje</Badge>;
  }
  if (dias <= 7) {
    return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px]">{dias}d atrasado</Badge>;
  }
  if (dias <= 30) {
    return <Badge className="bg-orange-500/15 text-orange-700 border-orange-500/30 text-[10px]">{dias}d atrasado</Badge>;
  }
  return <Badge variant="destructive" className="text-[10px]">{dias}d atrasado</Badge>;
}

export default function AdminInadimplentes() {
  const { data: inadimplentes, isLoading } = trpc.admin.listarInadimplentes.useQuery(undefined, {
    refetchInterval: 60000, // refresh a cada 1 min
  });

  const total = inadimplentes?.length ?? 0;
  const valorTotal = (inadimplentes ?? []).reduce(
    (sum, i) => sum + (i.valorMensal || 0),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-100 to-orange-100 dark:from-red-900/40 dark:to-orange-900/40">
          <AlertTriangle className="h-6 w-6 text-red-600" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Inadimplência</h1>
          <p className="text-muted-foreground mt-1">
            Assinaturas com pagamento em atraso (status <code className="text-xs">past_due</code>).
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-red-500/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total inadimplentes</p>
                <p className="text-3xl font-bold text-foreground mt-0.5">{total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">MRR em risco</p>
                <p className="text-3xl font-bold text-foreground mt-0.5">{formatBRL(valorTotal)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status atualizado</p>
                <p className="text-xs text-foreground mt-0.5">
                  Recebido em tempo real via webhook do Asaas
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clientes em atraso</CardTitle>
          <CardDescription>
            Ordenado por vencimento mais recente. Use os contatos pra cobrança manual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !inadimplentes || inadimplentes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <CheckCircle2 className="h-16 w-16 mb-4 text-emerald-500/40" />
              <p className="text-lg font-medium text-foreground">Nenhum inadimplente! 🎉</p>
              <p className="text-sm text-center mt-2 max-w-md">
                Todas as assinaturas estão em dia. Os webhooks do Asaas atualizam
                este status automaticamente.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Atraso</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inadimplentes.map((i) => {
                  const dias = diasAtraso(i.currentPeriodEnd);
                  const venc = i.currentPeriodEnd
                    ? new Date(i.currentPeriodEnd).toLocaleDateString("pt-BR")
                    : "—";
                  return (
                    <TableRow key={i.subId}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{i.userName || "—"}</p>
                          <p className="text-xs text-muted-foreground">{i.userEmail}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{i.planName || "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{formatBRL(i.valorMensal)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{venc}</TableCell>
                      <TableCell><AtrasoBadge dias={dias} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {i.userEmail && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              asChild
                            >
                              <a href={`mailto:${i.userEmail}?subject=Pagamento%20pendente%20Jurify`}>
                                <Mail className="h-3 w-3 mr-1" />
                                Email
                              </a>
                            </Button>
                          )}
                          {i.asaasSubscriptionId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              asChild
                            >
                              <a
                                href={`https://www.asaas.com/subscriptions/show/${i.asaasSubscriptionId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Asaas
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
