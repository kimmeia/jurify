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
  AlertTriangle, RotateCcw, Users as UsersIcon, Gift, ArrowLeft, Crown, ChevronRight, Mail,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Badge de tipo de usuário no painel admin.
 *
 * 3 estados:
 *   - admin: staff JuridFlow (azul)
 *   - cliente: dono de escritório pagante (cinza)
 *   - colaborador: membro de escritório de outro user (verde)
 *     mostra tooltip com escritório vinculado e cargo
 *
 * Aceita formato antigo (só `role`) pra compat retroativa enquanto
 * o backend é deployed. Quando `tipoUsuario` não vem, cai no shape antigo.
 */
function RoleBadge({
  role,
  tipoUsuario,
  escritorioVinculado,
  cargoColaborador,
}: {
  role: string;
  tipoUsuario?: "admin" | "cliente" | "colaborador";
  escritorioVinculado?: string | null;
  cargoColaborador?: string | null;
}) {
  // Fallback compat: sem tipoUsuario, usa só role
  const tipo = tipoUsuario ?? (role === "admin" ? "admin" : "cliente");

  if (tipo === "admin") {
    return <Badge variant="default"><ShieldCheck className="h-3 w-3 mr-1" />Admin</Badge>;
  }

  if (tipo === "colaborador") {
    const tooltipMsg = escritorioVinculado
      ? `${escritorioVinculado}${cargoColaborador ? ` — ${cargoColaborador}` : ""}`
      : "Colaborador de escritório";
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/15 cursor-help">
              <UsersIcon className="h-3 w-3 mr-1" />Colaborador
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{tooltipMsg}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return <Badge variant="secondary"><User className="h-3 w-3 mr-1" />Cliente</Badge>;
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

function fmtBRLAdmin(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CADASTRO DO CLIENTE (página inteira, estilo CRM do dono)
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
  const [excluirOpen, setExcluirOpen] = useState(false);
  const [motivoExclusao, setMotivoExclusao] = useState("");
  const [forcarExcluir, setForcarExcluir] = useState(false);
  const [retirarConfirm, setRetirarConfirm] = useState<{ qtd: number; motivo?: string } | null>(null);
  const [cortesiaOpen, setCortesiaOpen] = useState(false);
  const [motivoCortesia, setMotivoCortesia] = useState("");
  const [expiraEmCortesia, setExpiraEmCortesia] = useState("");
  const [removerCortesiaOpen, setRemoverCortesiaOpen] = useState(false);
  const [motivoRemocaoCortesia, setMotivoRemocaoCortesia] = useState("");

  // Pilha de navegação: permite abrir o cadastro de um colaborador a partir
  // do cadastro do dono (aba Equipe) e voltar. O topo da pilha é o cliente
  // atualmente exibido; todas as queries/mutations operam sobre ele.
  const [navStack, setNavStack] = useState<number[]>([]);
  useEffect(() => {
    if (open && userId != null) setNavStack([userId]);
  }, [open, userId]);
  const current = navStack.length > 0 ? navStack[navStack.length - 1] : userId;
  const ehSubView = navStack.length > 1;

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.admin.clienteDetalhes.useQuery(
    { userId: current! },
    { enabled: !!current && open, retry: false }
  );

  const { data: notas, refetch: refetchNotas } = trpc.admin.listarNotasCliente.useQuery(
    { userId: current! },
    { enabled: !!current && open, retry: false },
  );

  const concederMut = trpc.admin.concederCreditos.useMutation({
    onSuccess: (res) => {
      toast.success(res.mensagem);
      setCreditosQtd("");
      utils.admin.clienteDetalhes.invalidate({ userId: current! });
      onRefresh();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const retirarMut = trpc.admin.retirarCreditos.useMutation({
    onSuccess: (res) => {
      toast.success(res.mensagem);
      setCreditosQtd("");
      utils.admin.clienteDetalhes.invalidate({ userId: current! });
      onRefresh();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const bloquearMut = trpc.admin.bloquearUsuario.useMutation({
    onSuccess: () => {
      toast.success("Usuário bloqueado");
      setBloquearOpen(false);
      setMotivoBloqueio("");
      utils.admin.clienteDetalhes.invalidate({ userId: current! });
      onRefresh();
    },
    onError: (err) => toast.error("Erro ao bloquear", { description: err.message }),
  });

  const excluirMut = trpc.admin.excluirUsuario.useMutation({
    onSuccess: (data) => {
      toast.success(data.mensagem);
      setExcluirOpen(false);
      setMotivoExclusao("");
      setForcarExcluir(false);
      onOpenChange(false);
      onRefresh();
    },
    onError: (err) => {
      // Se o servidor pediu pra "forçar mesmo com escritório", oferecemos
      // o toggle no diálogo em vez de fechar.
      toast.error("Erro ao excluir", { description: err.message });
    },
  });

  const desbloquearMut = trpc.admin.desbloquearUsuario.useMutation({
    onSuccess: () => {
      toast.success("Usuário desbloqueado");
      utils.admin.clienteDetalhes.invalidate({ userId: current! });
      onRefresh();
    },
    onError: (err) => toast.error("Erro ao desbloquear", { description: err.message }),
  });

  const impersonateMut = trpc.admin.impersonarUsuario.useMutation({
    onSuccess: (res) => {
      toast.success(res.mensagem);
      // O servidor seta o cookie de sessão como parte da MESMA response
      // dessa mutation — quando o handler `onSuccess` roda, o navegador
      // já comitou o Set-Cookie no jar. Não precisa de setTimeout.
      //
      // Hard reload pra raiz: descarta cache do React Query e força
      // refetch do `auth.me` com a nova sessão. Home.tsx decide pra onde
      // rotear baseado no role/subscription do user impersonado.
      window.location.href = "/";
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

  const marcarCortesiaUserMut = trpc.admin.marcarCortesiaUser.useMutation({
    onSuccess: (res) => {
      toast.success(res.mensagem);
      setCortesiaOpen(false);
      setMotivoCortesia("");
      setExpiraEmCortesia("");
      utils.admin.clienteDetalhes.invalidate({ userId: current! });
      onRefresh();
    },
    onError: (err) => toast.error("Falha ao ativar cortesia", { description: err.message }),
  });

  const removerCortesiaUserMut = trpc.admin.removerCortesiaUser.useMutation({
    onSuccess: () => {
      toast.success("Cortesia removida");
      setRemoverCortesiaOpen(false);
      setMotivoRemocaoCortesia("");
      utils.admin.clienteDetalhes.invalidate({ userId: current! });
      onRefresh();
    },
    onError: (err) => toast.error("Falha ao remover cortesia", { description: err.message }),
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

  // ─── Assinatura: histórico, cancelar, trocar plano ───
  const [cancelarOpen, setCancelarOpen] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [trocarOpen, setTrocarOpen] = useState(false);
  const [planoSelecionado, setPlanoSelecionado] = useState<string | null>(null);

  const { data: cobrancasData } = trpc.admin.cobrancasDoCliente.useQuery(
    { userId: current! },
    { enabled: !!current && open, retry: false },
  );
  const { data: planosAtuais } = trpc.admin.planosAtuais.useQuery(undefined, { retry: false });

  const cancelarSubMut = trpc.admin.cancelarAssinaturaAdmin.useMutation({
    onSuccess: (res) => {
      toast.success(res.mensagem);
      setCancelarOpen(false);
      setMotivoCancelamento("");
      utils.admin.clienteDetalhes.invalidate({ userId: current! });
      onRefresh();
    },
    onError: (err) => toast.error("Erro ao cancelar", { description: err.message }),
  });

  const trocarPlanoMut = trpc.admin.trocarPlanoAdmin.useMutation({
    onSuccess: (res) => {
      toast.success(res.mensagem);
      setTrocarOpen(false);
      setPlanoSelecionado(null);
      utils.admin.clienteDetalhes.invalidate({ userId: current! });
      onRefresh();
    },
    onError: (err) => toast.error("Erro ao trocar plano", { description: err.message }),
  });

  if (!userId) return null;

  const user = data?.user as any;
  const credits = data?.credits;
  const sub = data?.subscription;
  const stats = data?.stats;
  const calculos = data?.calculos;
  const isBloqueado = !!user?.bloqueado;

  const temEquipe = !!(data?.colaboradores && data.colaboradores.length > 0);
  const iniciais = (user?.name || user?.email || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((p: string) => p.charAt(0))
    .join("")
    .toUpperCase() || "?";

  return (
    <div className="space-y-4">
      {/* Voltar — para o escritório (se vendo um colaborador) ou para a lista */}
      <button
        onClick={() => (ehSubView ? setNavStack((s) => s.slice(0, -1)) : onOpenChange(false))}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {ehSubView ? "Voltar para o escritório" : "Voltar para clientes"}
      </button>

      {isLoading ? (
        <Skeleton className="h-52 w-full rounded-2xl" />
      ) : data ? (
        <>
          {/* ═══════════ HERO ═══════════ */}
          <div className="rounded-2xl bg-gradient-to-br from-violet-700 via-purple-700 to-indigo-800 p-7 text-white relative overflow-hidden shadow-lg">
            <UsersIcon className="absolute -right-10 -bottom-12 w-56 h-56 opacity-10" strokeWidth={1.2} />
            <div className="relative">
              <div className="flex items-start gap-5 mb-5 flex-wrap">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-2xl font-bold shrink-0 shadow-lg ring-4 ring-white/20 tracking-tight">
                  {iniciais}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <h2 className="text-2xl font-bold tracking-tight">{user?.name || "Cliente"}</h2>
                    {data.isDonoEscritorio && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/20 text-white border border-white/25">
                        <Crown className="w-3 h-3" /> Dono
                      </span>
                    )}
                    {sub ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-400/25 text-emerald-50 border border-emerald-300/30">
                        Assinatura {sub.status}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/15 text-white border border-white/20">
                        Sem assinatura
                      </span>
                    )}
                    {isBloqueado && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-400/30 text-rose-50 border border-rose-300/40">
                        <Lock className="w-3 h-3" /> Bloqueado
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-white/75 flex-wrap">
                    {user?.email && (
                      <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{user.email}</span>
                    )}
                    {data.isDonoEscritorio && (
                      <span className="flex items-center gap-1.5"><UsersIcon className="w-3.5 h-3.5" />{data.colabsCount} colaborador{data.colabsCount === 1 ? "" : "es"}</span>
                    )}
                    {user?.createdAt && (
                      <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />Desde {new Date(user.createdAt).toLocaleDateString("pt-BR")}</span>
                    )}
                  </div>
                </div>
                {/* Ações rápidas */}
                <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                  <Button
                    variant="ghost" size="sm"
                    disabled={user?.role === "admin" || impersonateMut.isPending}
                    onClick={() => impersonateMut.mutate({ userId: current! })}
                    className="text-white bg-white/10 hover:bg-white/20 border border-white/25 backdrop-blur-sm shadow-sm h-8 text-xs"
                  >
                    {impersonateMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <LogIn className="w-3.5 h-3.5 mr-1" />}
                    Impersonar
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    disabled={resetSenhaMut.isPending}
                    onClick={() => resetSenhaMut.mutate({ userId: current! })}
                    className="text-white bg-white/10 hover:bg-white/20 border border-white/25 backdrop-blur-sm shadow-sm h-8 text-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" /> Resetar senha
                  </Button>
                  {isBloqueado ? (
                    <Button
                      variant="ghost" size="sm"
                      disabled={desbloquearMut.isPending}
                      onClick={() => desbloquearMut.mutate({ userId: current! })}
                      className="text-emerald-50 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-300/35 backdrop-blur-sm shadow-sm h-8 text-xs"
                    >
                      <Unlock className="w-3.5 h-3.5 mr-1" /> Desbloquear
                    </Button>
                  ) : (
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => setBloquearOpen(true)}
                      className="text-rose-100 bg-rose-500/15 hover:bg-rose-500/30 border border-rose-300/35 backdrop-blur-sm shadow-sm h-8 text-xs"
                    >
                      <Lock className="w-3.5 h-3.5 mr-1" /> Bloquear
                    </Button>
                  )}
                </div>
              </div>

              {/* Mini KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl bg-white/10 border border-white/15 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-white/65">Plano</p>
                  <p className="text-base font-bold mt-0.5 capitalize">{sub?.planId || "—"}</p>
                </div>
                <div className="rounded-xl bg-white/10 border border-white/15 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-white/65">Créditos</p>
                  <p className="text-base font-bold tabular-nums mt-0.5">{(credits as any)?.saldo ?? ((credits?.creditsTotal ?? 0) - (credits?.creditsUsed ?? 0))}</p>
                </div>
                <div className="rounded-xl bg-white/10 border border-white/15 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-white/65">Cálculos</p>
                  <p className="text-base font-bold tabular-nums mt-0.5">{stats?.totalCalculos ?? 0}</p>
                </div>
                <div className="rounded-xl bg-white/10 border border-white/15 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-white/65">Último acesso</p>
                  <p className="text-sm font-semibold mt-1">{user?.lastSignedIn ? new Date(user.lastSignedIn).toLocaleDateString("pt-BR") : "—"}</p>
                </div>
              </div>
            </div>
          </div>

          {isBloqueado && user?.motivoBloqueio && (
            <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <strong>Bloqueado:</strong> {user.motivoBloqueio}
                {user.bloqueadoEm && (
                  <span className="text-red-600/70 ml-1">({new Date(user.bloqueadoEm).toLocaleDateString("pt-BR")})</span>
                )}
              </div>
            </div>
          )}

          <Tabs defaultValue="detalhes" className="w-full">
            <div className="bg-slate-50/80 backdrop-blur-sm border border-slate-200 rounded-xl p-1.5 inline-flex">
              <TabsList className="bg-transparent gap-1 p-0 h-auto flex-wrap">
                <TabsTrigger value="detalhes" className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg">
                  <User className="h-3.5 w-3.5" /> Detalhes
                </TabsTrigger>
                {temEquipe && (
                  <TabsTrigger value="equipe" className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg">
                    <UsersIcon className="h-3.5 w-3.5" /> Equipe ({data.colaboradores!.length})
                  </TabsTrigger>
                )}
                <TabsTrigger value="assinatura" className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg">
                  <CreditCard className="h-3.5 w-3.5" /> Assinatura
                </TabsTrigger>
                <TabsTrigger value="notas" className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg">
                  <MessageSquarePlus className="h-3.5 w-3.5" /> Notas {notas && notas.length > 0 ? `(${notas.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="acoes" className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg">
                  <ShieldCheck className="h-3.5 w-3.5" /> Ações
                </TabsTrigger>
              </TabsList>
            </div>

            {/* TAB: ASSINATURA */}
            <TabsContent value="assinatura" className="space-y-4 py-3">
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <CreditCard className="h-4 w-4 text-muted-foreground" /> Assinatura atual
                  </div>
                  {sub ? (
                    <Badge variant={sub.status === "active" ? "default" : "outline"} className="text-[10px]">{sub.status}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">Sem plano</Badge>
                  )}
                </div>
                {sub ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Plano</p>
                        <p className="font-semibold capitalize mt-0.5">{sub.planId || "—"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Válida até</p>
                        <p className="font-semibold mt-0.5">{sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString("pt-BR") : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Cortesia</p>
                        <p className="font-semibold mt-0.5">{sub.cortesia ? "Sim" : "Não"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => { setPlanoSelecionado(sub.planId || null); setTrocarOpen(true); }}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Trocar plano
                      </Button>
                      {!sub.cortesia && (
                        <Button size="sm" variant="outline" className="border-emerald-500/50 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-500/10" onClick={() => setCortesiaOpen(true)}>
                          <Gift className="h-3.5 w-3.5 mr-1.5" /> Marcar cortesia
                        </Button>
                      )}
                      {sub.status !== "canceled" && (
                        <Button size="sm" variant="outline" className="border-rose-500/50 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10" onClick={() => setCancelarOpen(true)}>
                          <AlertCircle className="h-3.5 w-3.5 mr-1.5" /> Cancelar assinatura
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">Cliente sem assinatura ativa.</p>
                    <Button size="sm" variant="outline" className="border-emerald-500/50 text-emerald-700" onClick={() => setCortesiaOpen(true)}>
                      <Gift className="h-3.5 w-3.5 mr-1.5" /> Marcar cortesia
                    </Button>
                  </div>
                )}
              </div>

              {/* Histórico de cobranças (Asaas) */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <CreditCard className="h-4 w-4 text-muted-foreground" /> Histórico de cobranças
                </div>
                {!cobrancasData ? (
                  <Skeleton className="h-16 w-full" />
                ) : !cobrancasData.configurado ? (
                  <p className="text-xs text-muted-foreground">
                    {cobrancasData.motivo === "sem_customer"
                      ? "Cliente ainda não tem cadastro de cobrança no Asaas."
                      : "Histórico indisponível (Asaas não configurado)."}
                  </p>
                ) : (
                  <>
                    {cobrancasData.resumo && (
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-emerald-500/10 p-2"><p className="text-[10px] text-emerald-700 uppercase">Pago</p><p className="text-sm font-bold text-emerald-700 tabular-nums">{fmtBRLAdmin(cobrancasData.resumo.pago)}</p></div>
                        <div className="rounded-lg bg-amber-500/10 p-2"><p className="text-[10px] text-amber-700 uppercase">Pendente</p><p className="text-sm font-bold text-amber-700 tabular-nums">{fmtBRLAdmin(cobrancasData.resumo.pendente)}</p></div>
                        <div className="rounded-lg bg-rose-500/10 p-2"><p className="text-[10px] text-rose-700 uppercase">Vencido</p><p className="text-sm font-bold text-rose-700 tabular-nums">{fmtBRLAdmin(cobrancasData.resumo.vencido)}</p></div>
                      </div>
                    )}
                    {cobrancasData.cobrancas.length > 0 ? (
                      <div className="space-y-1.5">
                        {cobrancasData.cobrancas.map((c) => (
                          <div key={c.id} className="flex items-center justify-between text-xs border-b pb-1.5 last:border-0">
                            <div className="min-w-0">
                              <p className="truncate">{c.descricao || "Cobrança"}</p>
                              <p className="text-muted-foreground">venc. {new Date(c.vencimento + "T12:00:00").toLocaleDateString("pt-BR")}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="tabular-nums font-medium">{fmtBRLAdmin(c.valor)}</span>
                              <Badge variant="outline" className="text-[9px]">{c.status}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Nenhuma cobrança encontrada.</p>
                    )}
                  </>
                )}
              </div>
            </TabsContent>

            {/* TAB: EQUIPE — colaboradores do escritório (clicáveis) */}
            {data.colaboradores && data.colaboradores.length > 0 && (
              <TabsContent value="equipe" className="space-y-2 py-3">
                <p className="text-xs text-muted-foreground">
                  Colaboradores vinculados a este escritório. A assinatura/cortesia
                  do dono cobre toda a equipe. Clique para abrir o cadastro individual.
                </p>
                <div className="space-y-1.5">
                  {data.colaboradores.map((c: any) => (
                    <button
                      key={c.userId}
                      onClick={() => {
                        if (c.userId !== current) setNavStack((s) => [...s, c.userId]);
                      }}
                      disabled={c.userId === current}
                      className="w-full flex items-center gap-3 rounded-lg border p-2.5 text-left hover:bg-accent/50 transition-colors disabled:opacity-60 disabled:cursor-default"
                    >
                      <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center text-xs font-semibold shrink-0">
                        {(c.name || c.email || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium truncate">{c.name || "—"}</p>
                          {c.ehDono && (
                            <Badge className="bg-indigo-500/15 text-indigo-700 border-indigo-500/25 text-[9px] px-1">
                              <Crown className="h-2 w-2 mr-0.5" /> Dono
                            </Badge>
                          )}
                          {!c.ativo && (
                            <Badge variant="outline" className="text-[9px] px-1">Inativo</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.cargo} · {c.email || "—"}
                        </p>
                      </div>
                      {c.userId !== current && (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </TabsContent>
            )}

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

              {/* Créditos */}
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Coins className="h-4 w-4 text-muted-foreground" />
                  Créditos
                  {(data as any)?.creditsSource === "escritorio" && (
                    <Badge variant="outline" className="text-[9px] ml-auto">Escritório</Badge>
                  )}
                  {(data as any)?.creditsSource === "legacy" && (
                    <Badge variant="outline" className="text-[9px] ml-auto bg-amber-50 text-amber-700 border-amber-200">Legacy</Badge>
                  )}
                </div>
                {credits ? (
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Disponíveis:</span>
                      <span className="font-bold text-emerald-600">
                        {(credits as any).saldo ?? ((credits.creditsTotal ?? 0) - (credits.creditsUsed ?? 0))}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Usados:</span>
                      <span>{(credits as any).totalConsumido ?? credits.creditsUsed ?? 0}</span>
                    </div>
                    {(credits as any).cotaMensal !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cota mensal:</span>
                        <span>{(credits as any).cotaMensal}</span>
                      </div>
                    )}
                    {(credits as any).totalComprado !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total comprado:</span>
                        <span>{(credits as any).totalComprado}</span>
                      </div>
                    )}
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
                    className="w-20 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const qtd = parseInt(creditosQtd);
                      if (!qtd || qtd < 1) { toast.error("Quantidade inválida"); return; }
                      concederMut.mutate({ userId: current!, quantidade: qtd });
                    }}
                    disabled={concederMut.isPending || retirarMut.isPending}
                    className="flex-1"
                  >
                    {concederMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Coins className="h-3 w-3 mr-1" />}
                    Conceder
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const qtd = parseInt(creditosQtd);
                      if (!qtd || qtd < 1) { toast.error("Quantidade inválida"); return; }
                      const saldoAtual = (credits as any)?.saldo ?? ((credits?.creditsTotal ?? 0) - (credits?.creditsUsed ?? 0));
                      if (qtd > saldoAtual) {
                        toast.error("Quantidade maior que saldo", { description: `Saldo atual: ${saldoAtual}` });
                        return;
                      }
                      setRetirarConfirm({ qtd });
                    }}
                    disabled={concederMut.isPending || retirarMut.isPending || (data as any)?.creditsSource !== "escritorio"}
                    className="flex-1 text-destructive hover:text-destructive"
                    title={(data as any)?.creditsSource !== "escritorio" ? "Disponível só pra users com escritório" : ""}
                  >
                    {retirarMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Coins className="h-3 w-3 mr-1" />}
                    Retirar
                  </Button>
                </div>
                {(data as any)?.creditsSource === "escritorio" && (() => {
                  const saldoAtual = (credits as any)?.saldo ?? 0;
                  if (saldoAtual <= 0) return null;
                  return (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => setRetirarConfirm({ qtd: saldoAtual, motivo: "Zerado pelo admin" })}
                      disabled={retirarMut.isPending}
                    >
                      {retirarMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                      Zerar saldo ({saldoAtual} cred)
                    </Button>
                  );
                })()}
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
                        userId: current!,
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
              <div className={`border rounded-lg p-4 space-y-2 ${sub?.cortesia ? "border-emerald-500/40 bg-emerald-500/5" : ""}`}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Gift className={`h-4 w-4 ${sub?.cortesia ? "text-emerald-600" : "text-emerald-700"}`} />
                  {sub?.cortesia ? "Cortesia ativa" : "Marcar como cortesia"}
                </div>
                {sub?.cortesia ? (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {sub.cortesiaMotivo && (
                      <p><strong>Motivo:</strong> {sub.cortesiaMotivo}</p>
                    )}
                    {sub.cortesiaExpiraEm ? (
                      <p><strong>Expira em:</strong> {new Date(sub.cortesiaExpiraEm).toLocaleDateString("pt-BR")}</p>
                    ) : (
                      <p className="italic">Sem data de expiração.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Libera acesso ao JuridFlow sem cobrança via Asaas. Útil pra cliente piloto
                    ou isenção pontual. {!sub && (
                      <span className="block mt-1">
                        Cliente ainda não tem assinatura — vou criar uma virtual marcada como cortesia.
                      </span>
                    )}
                  </p>
                )}
                {sub?.cortesia ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-amber-500/50 text-amber-700 hover:text-amber-800 hover:bg-amber-500/10"
                    onClick={() => setRemoverCortesiaOpen(true)}
                  >
                    <Gift className="h-3.5 w-3.5 mr-1.5" />
                    Remover cortesia
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-emerald-500/50 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-500/10"
                    onClick={() => setCortesiaOpen(true)}
                  >
                    <Gift className="h-3.5 w-3.5 mr-1.5" />
                    Marcar como cortesia
                  </Button>
                )}
              </div>

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
                  onClick={() => impersonateMut.mutate({ userId: current! })}
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
                      resetSenhaMut.mutate({ userId: current! });
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
                    onClick={() => desbloquearMut.mutate({ userId: current! })}
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
                  onClick={() => setExcluirOpen(true)}
                  disabled={excluirMut?.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Excluir conta permanentemente
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <div className="text-center py-12 text-sm text-muted-foreground">Cliente não encontrado.</div>
      )}

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
                bloquearMut.mutate({ userId: current!, motivo: motivoBloqueio.trim() });
              }}
            >
              {bloquearMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Bloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={retirarConfirm !== null} onOpenChange={(o) => { if (!o) setRetirarConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {retirarConfirm?.motivo === "Zerado pelo admin"
                ? `Zerar saldo (${retirarConfirm?.qtd} créditos)?`
                : `Retirar ${retirarConfirm?.qtd} créditos do escritório?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Essa operação é registrada na auditoria. Use apenas pra correção
              manual de saldo (ex: reembolso, ajuste pós-suporte) ou pra resetar
              testes em produção.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retirarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={retirarMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!retirarConfirm || !userId) return;
                retirarMut.mutate({
                  userId,
                  quantidade: retirarConfirm.qtd,
                  motivo: retirarConfirm.motivo,
                });
                setRetirarConfirm(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {retirarMut.isPending ? "Retirando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={excluirOpen} onOpenChange={(o) => { if (!o) { setExcluirOpen(false); setMotivoExclusao(""); setForcarExcluir(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Excluir <strong>{user?.name || user?.email}</strong> permanentemente?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação <strong>NÃO PODE ser desfeita</strong>. O usuário e todos
              os seus vínculos como colaborador serão removidos. Se for dono de
              escritório com colaboradores ativos, a exclusão será bloqueada pelo
              servidor — use a opção de forçar apenas se realmente quiser destruir
              o escritório inteiro.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">Motivo (obrigatório, ≥5 chars) *</label>
              <Textarea
                value={motivoExclusao}
                onChange={(e) => setMotivoExclusao(e.target.value)}
                placeholder="Ex: usuário pediu exclusão LGPD via ticket #1234..."
                className="mt-1 text-sm"
                rows={3}
              />
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={forcarExcluir}
                onChange={(e) => setForcarExcluir(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Forçar mesmo se for dono de escritório</strong> — destruirá
                escritórios e dados de colaboradores subordinados. Por padrão
                BLOQUEADO. Use só se tem certeza absoluta.
              </span>
            </label>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={excluirMut.isPending || motivoExclusao.trim().length < 5}
              onClick={(e) => {
                e.preventDefault();
                if (!userId || motivoExclusao.trim().length < 5) return;
                excluirMut.mutate({
                  userId,
                  motivo: motivoExclusao.trim(),
                  forcarMesmoComEscritorio: forcarExcluir,
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluirMut.isPending ? "Excluindo..." : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cortesiaOpen} onOpenChange={(o) => { if (!o) { setCortesiaOpen(false); setMotivoCortesia(""); setExpiraEmCortesia(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar cortesia para {user?.name || user?.email}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Libera acesso sem mexer no Asaas.</p>
                {!sub && (
                  <p className="text-amber-700">
                    Cliente não tem assinatura — uma será criada virtualmente, marcada como cortesia.
                  </p>
                )}
                {data?.isDonoEscritorio && (data?.colabsCount ?? 0) > 1 && (
                  <p className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 text-emerald-800 p-2 text-xs">
                    <b>Afeta o escritório inteiro:</b> este user é o dono. Cortesia aqui libera acesso pra todos os <b>{data.colabsCount} colaboradores</b> do escritório.
                  </p>
                )}
                {!data?.isDonoEscritorio && data?.donoDoEscritorio && (
                  <p className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 text-amber-800 p-2 text-xs">
                    <b>Cortesia individual:</b> este user é colaborador. Vai liberar acesso só pra ele. Pra liberar o escritório todo, ative a cortesia no dono <b>{data.donoDoEscritorio.name || data.donoDoEscritorio.email}</b>.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="Motivo (auditável). Ex: 'Cliente piloto março-abril'"
              value={motivoCortesia}
              onChange={(e) => setMotivoCortesia(e.target.value)}
              rows={2}
            />
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Expira em (opcional — vazio = sem prazo)
              </label>
              <Input
                type="date"
                value={expiraEmCortesia}
                onChange={(e) => setExpiraEmCortesia(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={motivoCortesia.trim().length < 3 || marcarCortesiaUserMut.isPending}
              onClick={() => {
                const expira = expiraEmCortesia
                  ? new Date(expiraEmCortesia + "T23:59:59").getTime()
                  : undefined;
                marcarCortesiaUserMut.mutate({
                  userId: current!,
                  motivo: motivoCortesia.trim(),
                  expiraEm: expira,
                });
              }}
            >
              {marcarCortesiaUserMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Ativar cortesia
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removerCortesiaOpen} onOpenChange={(o) => { if (!o) { setRemoverCortesiaOpen(false); setMotivoRemocaoCortesia(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cortesia?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{user?.name || user?.email}</strong> vai voltar a depender do
              status real da assinatura. Se a sub for canceled/past_due, o cliente
              perde acesso ao JuridFlow imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Motivo da remoção (auditável)"
            value={motivoRemocaoCortesia}
            onChange={(e) => setMotivoRemocaoCortesia(e.target.value)}
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={motivoRemocaoCortesia.trim().length < 3 || removerCortesiaUserMut.isPending}
              onClick={() => {
                removerCortesiaUserMut.mutate({
                  userId: current!,
                  motivo: motivoRemocaoCortesia.trim(),
                });
              }}
            >
              {removerCortesiaUserMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Remover cortesia
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancelar assinatura (admin) */}
      <AlertDialog open={cancelarOpen} onOpenChange={(o) => { if (!o) { setCancelarOpen(false); setMotivoCancelamento(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar assinatura?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancela no Asaas e marca como <strong>cancelada</strong>. O escritório perde
              o acesso ao fim do período. Ação auditada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Motivo do cancelamento (ex: cliente solicitou por e-mail)"
            value={motivoCancelamento}
            onChange={(e) => setMotivoCancelamento(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelarSubMut.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelarSubMut.isPending || motivoCancelamento.trim().length < 3 || !sub?.id}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault();
                if (!sub?.id) return;
                cancelarSubMut.mutate({ subscriptionId: sub.id, motivo: motivoCancelamento.trim() });
              }}
            >
              {cancelarSubMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Cancelar assinatura
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Trocar plano (admin) */}
      <Dialog open={trocarOpen} onOpenChange={(o) => { if (!o) { setTrocarOpen(false); setPlanoSelecionado(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Trocar plano</DialogTitle>
            <DialogDescription>
              Cancela a assinatura atual no Asaas e cria uma nova com o plano escolhido.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            {(planosAtuais ?? []).map((p) => {
              const ativo = planoSelecionado === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setPlanoSelecionado(p.id)}
                  className={`w-full flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${ativo ? "border-primary bg-primary/5" : "hover:bg-accent/50"}`}
                >
                  <span className="text-sm font-medium">
                    {p.name}
                    {sub?.planId === p.id && <span className="text-[10px] text-muted-foreground ml-1">(atual)</span>}
                  </span>
                  <span className="text-sm font-medium tabular-nums text-muted-foreground">{fmtBRLAdmin(p.priceMonthly / 100)}/mês</span>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTrocarOpen(false); setPlanoSelecionado(null); }} disabled={trocarPlanoMut.isPending}>Cancelar</Button>
            <Button
              disabled={trocarPlanoMut.isPending || !planoSelecionado || planoSelecionado === sub?.planId}
              onClick={() => { if (planoSelecionado) trocarPlanoMut.mutate({ userId: current!, newPlanId: planoSelecionado, interval: "monthly" }); }}
            >
              {trocarPlanoMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Trocar plano
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function AdminClients() {
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  // Default = "cliente" (donos/assinantes). Colaboradores não aparecem como
  // linhas soltas — ficam dentro do cadastro do dono (aba Equipe).
  const [tipo, setTipo] = useState<"todos" | "admin" | "cliente" | "colaborador">("cliente");
  const [pagina, setPagina] = useState(0);
  const [detalheUserId, setDetalheUserId] = useState<number | null>(null);
  const [detalheOpen, setDetalheOpen] = useState(false);
  const LIMITE = 50;

  // Debounce busca pra não disparar query a cada tecla (evita N+1 requests
  // em conexões lentas; também evita rebuild do count() no servidor).
  useEffect(() => {
    const t = setTimeout(() => { setBuscaDebounced(busca); setPagina(0); }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const { data, isLoading, refetch } = trpc.admin.allUsers.useQuery(
    {
      limit: LIMITE,
      offset: pagina * LIMITE,
      busca: buscaDebounced || undefined,
      tipo,
    },
    { retry: false },
  );

  const allUsers = data?.itens ?? [];
  const total = data?.total ?? 0;
  const totalPaginas = Math.ceil(total / LIMITE);

  // Migração one-shot userCredits (legacy) → escritorio_creditos. Idempotente.
  const migrarLegacyMut = trpc.admin.migrarCreditosLegacy.useMutation({
    onSuccess: (res) => {
      toast.success("Migração concluída", {
        description: `${res.migrados} escritório(s) migrados, ${res.totalCreditos} créditos transferidos. ${res.pulados} pulados (já migrados ou sem saldo).`,
        duration: 10000,
      });
      refetch();
    },
    onError: (err) => toast.error("Erro na migração", { description: err.message }),
  });

  const [migrarLegacyAberto, setMigrarLegacyAberto] = useState(false);

  // Cadastro do cliente ocupa a tela inteira (estilo CRM do dono) — substitui
  // a lista enquanto aberto, em vez de abrir um dialog por cima.
  if (detalheOpen && detalheUserId) {
    return (
      <ClienteDetalheDialog
        userId={detalheUserId}
        open
        onOpenChange={(o) => { if (!o) { setDetalheOpen(false); setDetalheUserId(null); } }}
        onRefresh={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Clientes</h1>
        <p className="text-muted-foreground mt-1">Donos/assinantes da plataforma. Os colaboradores de cada escritório ficam dentro do cadastro do dono (aba Equipe).</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base">Todos os clientes</CardTitle>
              <CardDescription>
                {total.toLocaleString("pt-BR")} utilizadores
                {tipo !== "todos" || buscaDebounced ? " (filtrado)" : ""}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMigrarLegacyAberto(true)}
                disabled={migrarLegacyMut.isPending}
                className="text-xs"
              >
                {migrarLegacyMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                Migrar legacy
              </Button>
              <select
                value={tipo}
                onChange={(e) => { setTipo(e.target.value as any); setPagina(0); }}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="todos">Todos</option>
                <option value="admin">Admins</option>
                <option value="cliente">Clientes (donos)</option>
                <option value="colaborador">Colaboradores</option>
              </select>
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
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : allUsers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead>Assinatura</TableHead>
                  <TableHead>Equipe</TableHead>
                  <TableHead>Registado em</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allUsers.map((u) => (
                  <TableRow
                    key={u.id}
                    className="cursor-pointer"
                    onClick={() => { setDetalheUserId(u.id); setDetalheOpen(true); }}
                  >
                    <TableCell className="font-medium">{u.name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{u.email || "—"}</TableCell>
                    <TableCell>
                      <RoleBadge
                        role={u.role}
                        tipoUsuario={u.tipoUsuario}
                        escritorioVinculado={u.escritorioVinculado}
                        cargoColaborador={u.cargoColaborador}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <SubBadge active={u.hasActiveSubscription} />
                        {u.planId && (
                          <span className="text-xs text-muted-foreground capitalize">{u.planId}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.tipoUsuario === "cliente" ? (
                        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                          <UsersIcon className="h-3.5 w-3.5" /> {u.colaboradoresCount ?? 0}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
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

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <div className="text-sm text-muted-foreground">
                Página {pagina + 1} de {totalPaginas} • {total.toLocaleString("pt-BR")} {total === 1 ? "registro" : "registros"}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagina === 0}
                  onClick={() => setPagina((p) => Math.max(p - 1, 0))}
                >
                  Anterior
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagina + 1 >= totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={migrarLegacyAberto} onOpenChange={setMigrarLegacyAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Migrar saldo userCredits (legacy)?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai transferir saldo de <code>userCredits</code> (modelo antigo)
              para <code>escritorio_creditos</code>. <strong>Idempotente</strong> —
              pode rodar várias vezes sem duplicar saldo. Deve rodar 1× em produção
              após o deploy do novo modelo de créditos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={migrarLegacyMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={migrarLegacyMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                migrarLegacyMut.mutate();
                setMigrarLegacyAberto(false);
              }}
            >
              {migrarLegacyMut.isPending ? "Migrando..." : "Migrar agora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
