import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertCircle, Eye, Coins, ShieldCheck, User, Calculator, CreditCard, Clock,
  Loader2, Search, Lock, Unlock, LogIn, FileText, Trash2, MessageSquarePlus,
  AlertTriangle, RotateCcw,
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

function BloqueadoBadge({ bloqueado }: { bloqueado: boolean }) {
  if (!bloqueado) return null;
  return (
    <Badge variant="destructive" className="text-[10px]">
      <Lock className="h-2.5 w-2.5 mr-1" /> Bloqueado
    </Badge>
  );
}

const CATEGORIA_LABELS: Record<string, string> = {
  geral: "Geral",
  financeiro: "Financeiro",
  suporte: "Suporte",
  comercial: "Comercial",
  alerta: "Alerta",
};

const CATEGORIA_CORES: Record<string, string> = {
  geral: "bg-slate-500/15 text-slate-700",
  financeiro: "bg-emerald-500/15 text-emerald-700",
  suporte: "bg-blue-500/15 text-blue-700",
  comercial: "bg-violet-500/15 text-violet-700",
  alerta: "bg-red-500/15 text-red-700",
};

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
  const [novaNota, setNovaNota] = useState("");
  const [categoriaNota, setCategoriaNota] = useState<string>("geral");
  const [motivoBloqueio, setMotivoBloqueio] = useState("");
  const [bloquearOpen, setBloquearOpen] = useState(false);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.admin.clienteDetalhes.useQuery(
    { userId: userId! },
    { enabled: !!userId && open, retry: false }
  );

  const { data: notas, refetch: refetchNotas } = trpc.admin.listarNotasCliente.useQuery(
    { userId: userId! },
    { enabled: !!userId && open, retry: false },
  );

  const concederMut = trpc.admin.concederCreditos.useMutation({
    onSuccess: (res) => {
      toast.success(res.mensagem);
      setCreditosQtd("");
      onRefresh();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const bloquearMut = trpc.admin.bloquearUsuario.useMutation({
    onSuccess: () => {
      toast.success("Usuário bloqueado");
      setBloquearOpen(false);
      setMotivoBloqueio("");
      utils.admin.clienteDetalhes.invalidate({ userId: userId! });
      onRefresh();
    },
    onError: (err) => toast.error("Erro ao bloquear", { description: err.message }),
  });

  const excluirMut = trpc.admin.excluirUsuario.useMutation({
    onSuccess: (data) => {
      toast.success(data.mensagem);
      onOpenChange(false);
      onRefresh();
    },
    onError: (err) => toast.error("Erro ao excluir", { description: err.message }),
  });

  const desbloquearMut = trpc.admin.desbloquearUsuario.useMutation({
    onSuccess: () => {
      toast.success("Usuário desbloqueado");
      utils.admin.clienteDetalhes.invalidate({ userId: userId! });
      onRefresh();
    },
    onError: (err) => toast.error("Erro ao desbloquear", { description: err.message }),
  });

  const impersonateMut = trpc.admin.impersonarUsuario.useMutation({
    onSuccess: (res) => {
      toast.success(res.mensagem);
      // Aguarda o cookie ser persistido, limpa QUALQUER cache do React
      // Query (pra forçar refetch do auth.me no próximo page load) e faz
      // hard reload. Vai pra raiz "/" — Home.tsx cuida do roteamento
      // correto baseado na subscription do usuário impersonado.
      setTimeout(() => {
        // Limpa localStorage de auth cache pra garantir que auth.me
        // busque fresco
        try {
          localStorage.removeItem("manus-runtime-user-info");
        } catch {
          /* ignore */
        }
        window.location.href = "/";
      }, 600);
    },
    onError: (err) => {
      console.error("[impersonarUsuario] erro:", err);
      toast.error("Falha ao entrar como cliente", {
        description: err.message || "Erro desconhecido",
        duration: 10000,
      });
    },
  });

  const resetSenhaMut = trpc.admin.resetarSenhaUsuario.useMutation({
    onSuccess: (res) => {
      toast.success("Senha resetada", {
        description: `Senha temporária: ${res.senhaTemp}`,
        duration: 30000,
        action: {
          label: "Copiar",
          onClick: () => navigator.clipboard.writeText(res.senhaTemp),
        },
      });
    },
    onError: (err) => toast.error("Falha ao resetar senha", { description: err.message }),
  });

  const criarNotaMut = trpc.admin.criarNotaCliente.useMutation({
    onSuccess: () => {
      toast.success("Nota adicionada");
      setNovaNota("");
      setCategoriaNota("geral");
      refetchNotas();
    },
    onError: (err) => toast.error("Erro ao salvar nota", { description: err.message }),
  });

  const deletarNotaMut = trpc.admin.deletarNotaCliente.useMutation({
    onSuccess: () => {
      toast.success("Nota deletada");
      refetchNotas();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  if (!userId) return null;

  const user = data?.user as any;
  const credits = data?.credits;
  const sub = data?.subscription;
  const stats = data?.stats;
  const calculos = data?.calculos;
  const isBloqueado = !!user?.bloqueado;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle>{user?.name || "Cliente"}</DialogTitle>
            <BloqueadoBadge bloqueado={isBloqueado} />
          </div>
          <DialogDescription>{user?.email || ""}</DialogDescription>
          {isBloqueado && user?.motivoBloqueio && (
            <div className="mt-2 flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/30 p-2 text-xs text-red-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <strong>Bloqueado:</strong> {user.motivoBloqueio}
                {user.bloqueadoEm && (
                  <span className="text-red-600/70 ml-1">
                    ({new Date(user.bloqueadoEm).toLocaleDateString("pt-BR")})
                  </span>
                )}
              </div>
            </div>
          )}
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : data ? (
          <Tabs defaultValue="detalhes" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
              <TabsTrigger value="notas">
                Notas {notas && notas.length > 0 ? `(${notas.length})` : ""}
              </TabsTrigger>
              <TabsTrigger value="acoes">Ações</TabsTrigger>
            </TabsList>

            {/* TAB 1: DETALHES (conteúdo original) */}
            <TabsContent value="detalhes" className="space-y-5 py-3">
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
            </TabsContent>

            {/* TAB 2: NOTAS INTERNAS */}
            <TabsContent value="notas" className="space-y-3 py-3">
              {/* Form para criar nova nota */}
              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
                  Nova nota interna
                </div>
                <Textarea
                  placeholder="Ex: Cliente ligou reclamando do bug X em 12/03"
                  value={novaNota}
                  onChange={(e) => setNovaNota(e.target.value)}
                  rows={3}
                  className="text-sm"
                />
                <div className="flex items-center gap-2">
                  <Select value={categoriaNota} onValueChange={setCategoriaNota}>
                    <SelectTrigger className="w-40 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="geral">Geral</SelectItem>
                      <SelectItem value="financeiro">Financeiro</SelectItem>
                      <SelectItem value="suporte">Suporte</SelectItem>
                      <SelectItem value="comercial">Comercial</SelectItem>
                      <SelectItem value="alerta">Alerta</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!novaNota.trim()) { toast.error("Escreva o conteúdo"); return; }
                      criarNotaMut.mutate({
                        userId: userId!,
                        conteudo: novaNota.trim(),
                        categoria: categoriaNota as any,
                      });
                    }}
                    disabled={criarNotaMut.isPending || !novaNota.trim()}
                  >
                    {criarNotaMut.isPending && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                    Adicionar
                  </Button>
                </div>
              </div>

              {/* Lista de notas existentes */}
              {notas && notas.length > 0 ? (
                <div className="space-y-2">
                  {notas.map((nota: any) => (
                    <div key={nota.id} className="border rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${CATEGORIA_CORES[nota.categoria]}`}>
                            {CATEGORIA_LABELS[nota.categoria]}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {nota.autorNome} · {new Date(nota.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (confirm("Deletar esta nota?")) {
                              deletarNotaMut.mutate({ notaId: nota.id });
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{nota.conteudo}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  Nenhuma nota interna ainda.
                </div>
              )}
            </TabsContent>

            {/* TAB 3: AÇÕES (impersonate, bloquear) */}
            <TabsContent value="acoes" className="space-y-3 py-3">
              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <LogIn className="h-4 w-4 text-blue-600" />
                  Entrar como este cliente
                </div>
                <p className="text-xs text-muted-foreground">
                  Cria uma sessão temporária (1h) onde você vê o sistema exatamente
                  como o cliente. Toda ação fica auditada em seu nome.
                  <br />
                  <strong>Não funciona para outros admins.</strong>
                </p>
                <Button
                  size="sm"
                  variant="default"
                  className="w-full"
                  disabled={user?.role === "admin" || impersonateMut.isPending}
                  onClick={() => impersonateMut.mutate({ userId: userId! })}
                >
                  {impersonateMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <LogIn className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Entrar como {user?.name?.split(" ")[0] || "cliente"}
                </Button>
              </div>

              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <RotateCcw className="h-4 w-4 text-amber-600" />
                  Resetar senha
                </div>
                <p className="text-xs text-muted-foreground">
                  Gera uma senha temporária aleatória de 12 caracteres. O cliente
                  recebe a senha pelo admin (não automático). Só funciona para
                  contas com senha (não-Google).
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={resetSenhaMut.isPending}
                  onClick={() => {
                    if (confirm(`Resetar a senha de ${user?.name || user?.email}?`)) {
                      resetSenhaMut.mutate({ userId: userId! });
                    }
                  }}
                >
                  {resetSenhaMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Resetar senha
                </Button>
              </div>

              <div className="border rounded-lg p-4 space-y-2 border-destructive/30">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  {isBloqueado ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  {isBloqueado ? "Desbloquear conta" : "Bloquear conta"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {isBloqueado
                    ? "Restaura o acesso do usuário ao sistema."
                    : "Impede que o usuário faça login. Use para violação de termos, fraude ou suspeita de uso indevido."}
                </p>
                {isBloqueado ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-emerald-600/50 text-emerald-700"
                    disabled={desbloquearMut.isPending}
                    onClick={() => desbloquearMut.mutate({ userId: userId! })}
                  >
                    {desbloquearMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    <Unlock className="h-3.5 w-3.5 mr-1.5" />
                    Desbloquear
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="w-full"
                    onClick={() => setBloquearOpen(true)}
                  >
                    <Lock className="h-3.5 w-3.5 mr-1.5" />
                    Bloquear conta
                  </Button>
                )}

                {/* Excluir conta */}
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full mt-2"
                  onClick={() => {
                    if (confirm("ATENÇÃO: Excluir permanentemente este usuário e todos os dados? Esta ação NÃO pode ser desfeita.")) {
                      excluirMut.mutate({ userId: userId! });
                    }
                  }}
                  disabled={excluirMut?.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  {excluirMut?.isPending ? "Excluindo..." : "Excluir conta permanentemente"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>

      {/* Dialog de confirmação de bloqueio */}
      <AlertDialog open={bloquearOpen} onOpenChange={setBloquearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear conta?</AlertDialogTitle>
            <AlertDialogDescription>
              O usuário <strong>{user?.name || user?.email}</strong> não conseguirá
              mais fazer login. Informe o motivo (ficará registrado).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Ex: Suspeita de fraude no cadastro"
            value={motivoBloqueio}
            onChange={(e) => setMotivoBloqueio(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!motivoBloqueio.trim() || bloquearMut.isPending}
              onClick={() => {
                if (motivoBloqueio.trim().length < 3) { toast.error("Motivo muito curto"); return; }
                bloquearMut.mutate({ userId: userId!, motivo: motivoBloqueio.trim() });
              }}
            >
              {bloquearMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Bloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
