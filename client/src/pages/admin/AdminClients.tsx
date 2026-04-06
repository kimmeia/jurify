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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle, Eye, Coins, ShieldCheck, User, Calculator, CreditCard, Clock,
  Loader2, Search,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function RoleBadge({ role }: { role: string }) {
  return role === "admin"
    ? <Badge variant="default"><ShieldCheck className="h-3 w-3 mr-1" />Admin</Badge>
    : <Badge variant="secondary"><User className="h-3 w-3 mr-1" />Cliente</Badge>;
}

function SubBadge({ active }: { active: boolean }) {
  return active
    ? <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25 hover:bg-emerald-500/15 text-[10px]">Ativa</Badge>
    : <Badge variant="outline" className="text-[10px]">Sem plano</Badge>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIALOG: DETALHES DO CLIENTE
// ═══════════════════════════════════════════════════════════════════════════════

function ClienteDetalheDialog({
  userId,
  open,
  onOpenChange,
  onRefresh,
}: {
  userId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRefresh: () => void;
}) {
  const [creditosQtd, setCreditosQtd] = useState("");

  const { data, isLoading } = trpc.admin.clienteDetalhes.useQuery(
    { userId: userId! },
    { enabled: !!userId && open, retry: false }
  );

  const concederMut = trpc.admin.concederCreditos.useMutation({
    onSuccess: (res) => {
      toast.success(res.mensagem);
      setCreditosQtd("");
      onRefresh();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const roleMut = trpc.admin.updateUserRole.useMutation({
    onSuccess: () => {
      toast.success("Role atualizado");
      onRefresh();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  if (!userId) return null;

  const user = data?.user;
  const credits = data?.credits;
  const sub = data?.subscription;
  const stats = data?.stats;
  const calculos = data?.calculos;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{user?.name || "Cliente"}</DialogTitle>
          <DialogDescription>{user?.email || ""}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : data ? (
          <div className="space-y-5 py-2">
            {/* Info básica */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">ID:</span>{" "}
                <span className="font-mono">{user?.id}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Role:</span>{" "}
                <RoleBadge role={user?.role || "user"} />
              </div>
              <div>
                <span className="text-muted-foreground">Registrado:</span>{" "}
                <span>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString("pt-BR") : "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Último acesso:</span>{" "}
                <span>{user?.lastSignedIn ? new Date(user.lastSignedIn).toLocaleDateString("pt-BR") : "—"}</span>
              </div>
            </div>

            {/* Assinatura */}
            <div className="border rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                Assinatura
              </div>
              {sub ? (
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Plano:</span>
                    <span>{sub.planId || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant={sub.status === "active" ? "default" : "outline"} className="text-[10px]">{sub.status}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Válida até:</span>
                    <span>{sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd * 1000).toLocaleDateString("pt-BR") : "—"}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sem assinatura ativa</p>
              )}
            </div>

            {/* Créditos */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Coins className="h-4 w-4 text-muted-foreground" />
                Créditos
              </div>
              {credits ? (
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Disponíveis:</span>
                    <span className="font-bold text-emerald-600">
                      {(credits.creditsTotal ?? 0) - (credits.creditsUsed ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Usados:</span>
                    <span>{credits.creditsUsed ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total:</span>
                    <span>{credits.creditsTotal ?? 0}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sem créditos</p>
              )}

              <div className="flex gap-2 pt-1">
                <Input
                  type="number"
                  min={1}
                  placeholder="Qtd"
                  value={creditosQtd}
                  onChange={(e) => setCreditosQtd(e.target.value)}
                  className="w-24 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const qtd = parseInt(creditosQtd);
                    if (!qtd || qtd < 1) { toast.error("Quantidade inválida"); return; }
                    concederMut.mutate({ userId: userId!, quantidade: qtd });
                  }}
                  disabled={concederMut.isPending}
                >
                  {concederMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Coins className="h-3 w-3 mr-1" />}
                  Conceder
                </Button>
              </div>
            </div>

            {/* Estatísticas */}
            {stats && (
              <div className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Calculator className="h-4 w-4 text-muted-foreground" />
                  Uso
                </div>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total cálculos:</span>
                    <span>{stats.totalCalculos ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pareceres:</span>
                    <span>{stats.totalPareceres ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Módulos usados:</span>
                    <span>{stats.porTipo ? Object.keys(stats.porTipo).length : 0}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Últimos cálculos */}
            {calculos && calculos.length > 0 && (
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Últimos cálculos
                </div>
                <div className="space-y-1.5">
                  {calculos.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px] px-1">{c.tipo}</Badge>
                        <span className="truncate max-w-[180px]">{c.titulo}</span>
                      </div>
                      <span className="text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function AdminClients() {
  const { data: allUsers, isLoading, refetch } = trpc.admin.allUsers.useQuery(undefined, { retry: false });
  const [busca, setBusca] = useState("");
  const [detalheUserId, setDetalheUserId] = useState<number | null>(null);
  const [detalheOpen, setDetalheOpen] = useState(false);

  const filtrados = allUsers?.filter((u) => {
    if (!busca.trim()) return true;
    const b = busca.toLowerCase();
    return (
      (u.name || "").toLowerCase().includes(b) ||
      (u.email || "").toLowerCase().includes(b)
    );
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Clientes</h1>
        <p className="text-muted-foreground mt-1">Gerencie todos os utilizadores registados na plataforma.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Todos os clientes</CardTitle>
              <CardDescription>{filtrados?.length ?? 0} utilizadores registados</CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou email..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filtrados && filtrados.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead>Assinatura</TableHead>
                  <TableHead>Registado em</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{u.email || "—"}</TableCell>
                    <TableCell><RoleBadge role={u.role} /></TableCell>
                    <TableCell><SubBadge active={u.hasActiveSubscription} /></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(u.createdAt).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(u.lastSignedIn).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={() => { setDetalheUserId(u.id); setDetalheOpen(true); }}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        Detalhes
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">{busca ? "Nenhum resultado para a busca." : "Nenhum cliente encontrado."}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <ClienteDetalheDialog
        userId={detalheUserId}
        open={detalheOpen}
        onOpenChange={setDetalheOpen}
        onRefresh={() => refetch()}
      />
    </div>
  );
}
