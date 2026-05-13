/**
 * Módulo Clientes — lista com segmentação/bulk + detalhe com 3 abas consolidadas.
 *
 * Mudanças em relação à versão anterior:
 *  • 7 abas no detalhe → 3 (Visão Geral, Histórico, Documentos)
 *  • Segmentação por chips (VIP, Inativo, Com débito, Com processo...)
 *  • Status financeiro inline na lista (badge colorida)
 *  • Bulk actions: selecionar vários, exportar CSV, enviar WhatsApp em massa
 *  • Sub-componentes extraídos para ./clientes/detail-tabs.tsx
 */

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Users, Plus, Search, Phone, Mail, Trash2, Loader2, ArrowLeft, User,
  MessageCircle, TrendingUp, FileText, StickyNote, CheckSquare, PenLine,
  Download, Filter, DollarSign, Star, Calendar, Send, Siren, CheckCircle2,
  Scale, Radar, Copy, Link2, MoreVertical, X, RotateCcw, Trello,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { FinanceiroBadge, FinanceiroPopover, VincularAsaasBlock } from "@/components/FinanceiroBadge";
import { GerarContratoDialog } from "@/components/GerarContratoDialog";
import {
  EditarForm, AnotacoesTab, ArquivosTab, AssinaturasTab, TarefasClienteTab,
  NovoClienteDialog, RegistrarFechamentoDialog,
} from "./clientes/detail-tabs";
import { parseValorBR } from "@shared/valor-br";
import { useLocation } from "wouter";

/**
 * Botão "Monitorar na Judit" — cria/remove um monitoramento de NOVAS AÇÕES
 * pro CPF/CNPJ do cliente. É TOGGLE: se já estiver monitorando, clicar
 * remove o monitoramento (e interrompe a cobrança mensal recorrente).
 */
function MonitorarJuditButton({ cpfCnpj, nome }: { cpfCnpj: string; nome: string }) {
  const clean = cpfCnpj.replace(/\D/g, "");
  const tipo: "cpf" | "cnpj" = clean.length === 14 ? "cnpj" : "cpf";
  const [, setLocation] = useLocation();
  const [confirmCriarOpen, setConfirmCriarOpen] = useState(false);
  const [confirmPararOpen, setConfirmPararOpen] = useState(false);

  // Verifica se já existe monitoramento ativo
  const { data: monsData, refetch: refetchMons } =
    (trpc.processos.meusMonitoramentos.useQuery as any)(
      { busca: clean, tipoMonitoramento: "novas_acoes" },
      { retry: false },
    );
  const monAtivo = (monsData || []).find(
    (m: any) =>
      m.searchKey === clean &&
      m.tipoMonitoramento === "novas_acoes" &&
      m.statusJudit !== "deleted",
  );

  const criarMut = (trpc.processos as any).criarMonitoramentoNovasAcoes.useMutation({
    onSuccess: () => {
      toast.success(`Monitoramento criado para ${nome}!`, {
        description: "Vamos avisar quando novas ações forem distribuídas.",
        action: {
          label: "Ver em Processos",
          onClick: () => setLocation("/processos"),
        },
      });
      setConfirmCriarOpen(false);
      refetchMons();
    },
    onError: (e: any) => toast.error("Erro ao criar monitoramento", { description: e.message }),
  });

  const deletarMut = trpc.processos.deletarMonitoramento.useMutation({
    onSuccess: (r: any) => {
      if (r?.juditErro) {
        toast.warning("Monitoramento removido localmente", {
          description: `Mas falhou na Judit: ${r.juditErro}. A cobrança mensal foi interrompida.`,
        });
      } else {
        toast.success(`Monitoramento de ${nome} removido`, {
          description: "A cobrança mensal foi interrompida.",
        });
      }
      setConfirmPararOpen(false);
      refetchMons();
    },
    onError: (e: any) => toast.error("Erro ao remover", { description: e.message }),
  });

  if (monAtivo) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          disabled={deletarMut.isPending}
          onClick={() => setConfirmPararOpen(true)}
          className="border-emerald-500/30 text-emerald-700 hover:bg-red-50 hover:border-red-500/30 hover:text-red-700 group"
        >
          {deletarMut.isPending ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 mr-1 group-hover:hidden" />
              <Trash2 className="h-4 w-4 mr-1 hidden group-hover:block" />
            </>
          )}
          <span className="group-hover:hidden">Monitorado</span>
          <span className="hidden group-hover:inline">Parar</span>
        </Button>
        <AlertDialog open={confirmPararOpen} onOpenChange={setConfirmPararOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Parar de monitorar {nome}?</AlertDialogTitle>
              <AlertDialogDescription>
                Você deixará de ser avisado sobre novas ações distribuídas contra
                este cliente, e a <strong>cobrança mensal recorrente</strong> será
                interrompida imediatamente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletarMut.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  deletarMut.mutate({ id: monAtivo.id });
                }}
                disabled={deletarMut.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deletarMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : null}
                Parar monitoramento
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setConfirmCriarOpen(true)}
        disabled={criarMut.isPending}
        className="border-red-500/30 text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
      >
        {criarMut.isPending ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <Siren className="h-4 w-4 mr-1" />
        )}
        Monitorar
      </Button>
      <AlertDialog open={confirmCriarOpen} onOpenChange={setConfirmCriarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Criar monitoramento para {nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Você será avisado <strong>imediatamente</strong> quando alguém processar
              este cliente — antes mesmo da citação chegar.
              <br />
              <br />
              <span className="text-foreground font-medium">Cobrança: 35 créditos/mês</span>
              {" "}— renovada automaticamente, podendo ser cancelada a qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={criarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                criarMut.mutate({
                  tipo,
                  valor: clean,
                  apelido: nome,
                });
              }}
              disabled={criarMut.isPending}
            >
              {criarMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Siren className="h-4 w-4 mr-1" />
              )}
              Criar monitoramento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(n: string) {
  return n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

/**
 * Valida formato CNJ (compacto ou formatado). Aceita:
 *  - 20 dígitos seguidos: "12345678920248060001"
 *  - Formato canônico: "1234567-89.2024.8.06.0001"
 * Sem checagem de DV — backend faz isso. Aqui só barra entrada óbvia
 * (ex: "aaaaaaaaaaaaaaa") antes de mandar pro servidor.
 */
function cnjFormatoValido(cnj: string): boolean {
  const compacto = cnj.replace(/\D/g, "");
  return compacto.length === 20;
}

function timeAgo(d: string) {
  if (!d) return "";
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function exportClientesCSV(clientes: any[]) {
  const headers = ["Nome", "Telefone", "Email", "CPF/CNPJ", "Origem", "Tags", "Criado em"];
  const rows = clientes.map((c) => [
    `"${(c.nome || "").replace(/"/g, '""')}"`,
    c.telefone || "",
    c.email || "",
    c.cpfCnpj || "",
    c.origem || "",
    `"${(c.tags || "").replace(/"/g, '""')}"`,
    new Date(c.createdAt).toLocaleDateString("pt-BR"),
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Segmentação (chips) ─────────────────────────────────────────────────────

type Segmento = "todos" | "vip" | "inativo" | "novos" | "com_email" | "com_telefone" | "aguardando_docs";

const SEGMENTOS: { id: Segmento; label: string; icon: any; color: string }[] = [
  { id: "todos", label: "Todos", icon: Users, color: "text-muted-foreground" },
  { id: "aguardando_docs", label: "Aguardando docs", icon: FileText, color: "text-orange-600" },
  { id: "vip", label: "VIP", icon: Star, color: "text-amber-600" },
  { id: "novos", label: "Novos (7d)", icon: Plus, color: "text-emerald-600" },
  { id: "inativo", label: "Inativos (30d+)", icon: Calendar, color: "text-gray-500" },
  { id: "com_email", label: "Com e-mail", icon: Mail, color: "text-blue-600" },
  { id: "com_telefone", label: "Com telefone", icon: Phone, color: "text-violet-600" },
];

function aplicarSegmento(clientes: any[], seg: Segmento): any[] {
  if (seg === "todos") return clientes;
  if (seg === "com_email") return clientes.filter((c) => !!c.email);
  if (seg === "com_telefone") return clientes.filter((c) => !!c.telefone);
  if (seg === "aguardando_docs") return clientes.filter((c) => !!c.documentacaoPendente);
  if (seg === "novos") {
    const seteDias = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return clientes.filter((c) => new Date(c.createdAt).getTime() >= seteDias);
  }
  if (seg === "inativo") {
    // "Inativo" = sem conversa nos últimos 30d. updatedAt era a referência
    // antiga mas webhooks (sync Asaas, tags) tocam a coluna, deixando o
    // filtro sempre vazio. ultimaConversaAt vem do backend (MAX por contato);
    // quando null (nunca conversou), usa createdAt — cliente cadastrado há
    // 30+d sem interação também é inativo.
    const trintaDias = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return clientes.filter((c) => {
      const ref = c.ultimaConversaAt || c.createdAt;
      return new Date(ref).getTime() < trintaDias;
    });
  }
  if (seg === "vip") {
    return clientes.filter((c) => (c.tags || "").toLowerCase().includes("vip"));
  }
  return clientes;
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function Clientes() {
  const [, setLocation] = useLocation();
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  const [segmento, setSegmento] = useState<Segmento>(() => {
    // Dashboard linka pra `/clientes?aguardandoDocs=1` quando clica
    // no card "Aguardando documentação" — abre filtrado direto.
    const params = new URLSearchParams(window.location.search);
    if (params.get("aguardandoDocs") === "1") return "aguardando_docs";
    return "todos";
  });
  const [pagina, setPagina] = useState(1);
  const [selId, setSelId] = useState<number | null>(() => {
    // Se veio com ?id=X na URL, abre direto no detalhe
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("id");
    return idParam ? Number(idParam) : null;
  });
  const [showNovo, setShowNovo] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());

  // Botão "Duplicatas (PDF)" — gera relatório de clientes com mesmo CPF/CNPJ.
  // Só dono/gestor consegue (procedure faz gate). Atendente vê erro toast.
  const exportarDuplicatasMut = (trpc as any).clientes.exportarDuplicatasPdf.useMutation({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => {
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: r.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 0);
      toast.success("Relatório de duplicatas baixado");
    },
    onError: (err: any) => toast.error("Não foi possível gerar relatório", { description: err.message }),
  });

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaDebounced(busca);
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  // Limpa seleção quando o conjunto visível muda — segmento, busca ou
  // página. Sem isso, IDs selecionados em "VIP" ficavam no Set ao trocar
  // pra "Inativos" → bulk action exportava mix ou nada (IDs invisíveis).
  useEffect(() => {
    setSelecionados(new Set());
  }, [segmento, buscaDebounced, pagina]);

  const { data: stats } = trpc.clientes.estatisticas.useQuery();
  const { data, refetch } = trpc.clientes.listar.useQuery({
    busca: buscaDebounced || undefined,
    pagina,
    limite: 50,
    // Filtra no servidor pra não perder clientes além do limite 50.
    // O aplicarSegmento no client roda em cima dessa lista (no-op aqui).
    aguardandoDocumentacao: segmento === "aguardando_docs" ? true : undefined,
  });

  // Permissões pra mostrar/esconder ícone de excluir na row.
  // Default: se não carregou ainda, esconde (defesa em profundidade).
  const { data: minhasPerms } = (trpc as any).permissoes?.minhasPermissoes?.useQuery?.(
    undefined,
    { retry: false, refetchOnWindowFocus: false },
  ) || { data: null };
  const podeExcluirCliente = !!(minhasPerms?.permissoes?.clientes?.excluir);

  // Mutation de excluir + estado pra dialog de confirmação.
  const [excluirAlvo, setExcluirAlvo] = useState<{ id: number; nome: string } | null>(null);
  const excluirMut = (trpc as any).clientes.excluir.useMutation({
    onSuccess: () => {
      toast.success("Cliente excluído");
      setExcluirAlvo(null);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const clientesFiltrados = useMemo(() => {
    const base = data?.clientes || [];
    return aplicarSegmento(base, segmento);
  }, [data, segmento]);

  const totalPaginas = (data as any)?.totalPaginas || 1;

  const toggleSelecionado = (id: number) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTodos = () => {
    if (selecionados.size === clientesFiltrados.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(clientesFiltrados.map((c: any) => c.id)));
    }
  };

  const handleExport = () => {
    const lista = selecionados.size > 0
      ? clientesFiltrados.filter((c: any) => selecionados.has(c.id))
      : clientesFiltrados;
    exportClientesCSV(lista);
    toast.success(`${lista.length} cliente(s) exportado(s)`);
  };

  const handleBulkInbox = () => {
    const lista = clientesFiltrados.filter((c: any) => selecionados.has(c.id) && c.telefone);
    if (lista.length === 0) {
      toast.error("Nenhum selecionado com telefone");
      return;
    }
    if (lista.length > 1) {
      toast.error("Selecione apenas 1 cliente", {
        description: "O inbox abre uma conversa por vez. Para enviar em massa, use templates no módulo Atendimento.",
      });
      return;
    }
    setLocation(`/atendimento?contatoId=${lista[0].id}`);
  };

  const selecionadosComTelefone = useMemo(
    () => clientesFiltrados.filter((c: any) => selecionados.has(c.id) && c.telefone).length,
    [clientesFiltrados, selecionados],
  );

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/40 dark:to-purple-900/40">
          <Users className="h-6 w-6 text-violet-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro, histórico e documentos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportarDuplicatasMut.mutate()}
            disabled={exportarDuplicatasMut.isPending}
            title="Baixa um PDF com clientes que compartilham o mesmo CPF/CNPJ"
          >
            {exportarDuplicatasMut.isPending ? "Gerando..." : "Duplicatas (PDF)"}
          </Button>
          <Button size="sm" onClick={() => setShowNovo(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Novo Cliente
          </Button>
        </div>
      </div>

      {/* Stats — só na lista; no detalhe os 5 cards do cliente já bastam */}
      {!selId && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { v: stats.total, l: "Total", c: "" },
            { v: stats.novosHoje, l: "Novos hoje", c: "text-emerald-600" },
            { v: stats.comTelefone, l: "Com telefone", c: "text-blue-600" },
            { v: stats.comEmail, l: "Com email", c: "text-violet-600" },
          ].map((k, i) => (
            <div key={i} className="rounded-lg border bg-card px-3 py-2 text-center">
              <p className={`text-lg font-bold leading-tight ${k.c}`}>{k.v}</p>
              <p className="text-[10px] text-muted-foreground">{k.l}</p>
            </div>
          ))}
        </div>
      )}

      {selId ? (
        <ClienteDetalhe id={selId} onVoltar={() => setSelId(null)} onUpdate={refetch} />
      ) : (
        <>
          {/* Busca + Segmentação */}
          <Card>
            <CardHeader className="pb-3 space-y-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, telefone, email ou CPF..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="h-9 pl-9"
                />
              </div>

              {/* Chips de segmentação */}
              <div className="flex items-center gap-2 flex-wrap">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                {SEGMENTOS.map((s) => {
                  const Icon = s.icon;
                  const active = segmento === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSegmento(s.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/80 text-muted-foreground"
                      }`}
                    >
                      <Icon className={`h-3 w-3 ${active ? "" : s.color}`} />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </CardHeader>

            <CardContent>
              {/* Bulk actions bar */}
              {selecionados.size > 0 && (
                <div className="flex items-center gap-3 p-3 mb-3 rounded-lg bg-blue-50 border border-blue-200">
                  <span className="text-sm font-medium text-blue-900">
                    {selecionados.size} cliente(s) selecionado(s)
                  </span>
                  <div className="flex-1" />
                  <Button size="sm" variant="outline" onClick={handleExport}>
                    <Download className="h-3.5 w-3.5 mr-1" /> Exportar
                  </Button>
                  {selecionadosComTelefone > 0 && (
                    <Button size="sm" variant="outline" onClick={handleBulkInbox}>
                      <MessageCircle className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Inbox
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelecionados(new Set())}
                  >
                    Limpar
                  </Button>
                </div>
              )}

              {/* Lista */}
              {!clientesFiltrados.length ? (
                <div className="text-center py-16">
                  <Users className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {segmento !== "todos"
                      ? `Nenhum cliente no segmento "${SEGMENTOS.find((s) => s.id === segmento)?.label}".`
                      : "Nenhum cliente encontrado."}
                  </p>
                  {segmento === "todos" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => setShowNovo(true)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Cadastrar
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Header com select all */}
                  <div className="flex items-center gap-3 px-3 py-2 border-b text-xs text-muted-foreground">
                    <Checkbox
                      checked={
                        selecionados.size > 0 &&
                        selecionados.size === clientesFiltrados.length
                      }
                      onCheckedChange={toggleTodos}
                    />
                    <span className="flex-1">
                      Nome ({clientesFiltrados.length})
                    </span>
                    <span className="w-32 text-right">Financeiro</span>
                    <span className="w-16 text-right">Origem</span>
                    <span className="w-12 text-right">Cadastrado</span>
                  </div>

                  {clientesFiltrados.map((c: any) => (
                    <div
                      key={c.id}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/40 transition-colors text-left group cursor-pointer"
                      onClick={(e) => {
                        // Linha inteira clicável — abre detalhe. Cliques em
                        // controles internos (checkbox, botões) chamam
                        // stopPropagation pra não interferir.
                        if ((e.target as HTMLElement).closest("[data-stop-row-click]")) return;
                        setSelId(c.id);
                      }}
                    >
                      <div data-stop-row-click onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selecionados.has(c.id)}
                          onCheckedChange={() => toggleSelecionado(c.id)}
                        />
                      </div>
                      <div className="flex-1 flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-200 to-purple-100 flex items-center justify-center text-xs font-bold text-violet-700 shrink-0">
                          {initials(c.nome || "?")}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{c.nome}</p>
                            {(c.tags || "").toLowerCase().includes("vip") && (
                              <Star className="h-3 w-3 text-amber-500 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {c.telefone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" /> {c.telefone}
                              </span>
                            )}
                            {c.email && (
                              <span className="flex items-center gap-1 truncate">
                                <Mail className="h-3 w-3" /> {c.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="w-32 text-right">
                        <FinanceiroBadge contatoId={c.id} />
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0 w-16 justify-center">
                        {c.origem}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground shrink-0 w-12 text-right">
                        {timeAgo(c.createdAt)}
                      </span>
                      {/* Ações que aparecem só no hover */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Ver/Editar cliente"
                          onClick={(e) => { e.stopPropagation(); setSelId(c.id); }}
                        >
                          <PenLine className="h-3.5 w-3.5" />
                        </Button>
                        {podeExcluirCliente && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-red-500/10 hover:text-red-600"
                            title="Excluir cliente"
                            onClick={(e) => { e.stopPropagation(); setExcluirAlvo({ id: c.id, nome: c.nome }); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Paginação */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => p - 1)}
              >
                Anterior
              </Button>
              <span className="text-xs text-muted-foreground">
                Página {pagina} de {totalPaginas}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={pagina >= totalPaginas}
                onClick={() => setPagina((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          )}
        </>
      )}

      <NovoClienteDialog open={showNovo} onOpenChange={setShowNovo} onSuccess={() => refetch()} />

      {/* Confirmação de exclusão de cliente.
          Backend faz cascade: deleta conversas, leads, tarefas, anotações,
          arquivos, assinaturas e cobranças Asaas vinculadas. */}
      <AlertDialog open={!!excluirAlvo} onOpenChange={(o) => !o && setExcluirAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove <strong>{excluirAlvo?.nome}</strong> e todos os dados vinculados:
              conversas, leads, tarefas, anotações, arquivos, assinaturas e cobranças.
              Não há como desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => excluirAlvo && excluirMut.mutate({ id: excluirAlvo.id })}
              disabled={excluirMut.isPending}
            >
              {excluirMut.isPending ? "Excluindo..." : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Financeiro do Cliente — cobranças Asaas ────────────────────────────────

const STATUS_COBRANCA_LABEL: Record<string, { label: string; cor: string }> = {
  PENDING: { label: "Pendente", cor: "bg-amber-100 text-amber-700 border-amber-200" },
  RECEIVED: { label: "Recebido", cor: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  CONFIRMED: { label: "Confirmado", cor: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  OVERDUE: { label: "Vencido", cor: "bg-red-100 text-red-700 border-red-200" },
  REFUNDED: { label: "Estornado", cor: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  CANCELED: { label: "Cancelado", cor: "bg-zinc-100 text-zinc-700 border-zinc-200" },
};

function fmtMoeda(centavosOuDecimal: number | string | null | undefined): string {
  if (centavosOuDecimal == null) return "—";
  const n = typeof centavosOuDecimal === "string" ? parseFloat(centavosOuDecimal) : centavosOuDecimal;
  if (!Number.isFinite(n)) return "—";
  // Asaas armazena em decimal "1234.56" — assumimos reais já formatados.
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function fmtData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return iso;
  }
}

function KanbanClienteTab({ contatoId }: { contatoId: number }) {
  const [, setLocation] = useLocation();
  const [criarOpen, setCriarOpen] = useState(false);
  const [funilSelecionado, setFunilSelecionado] = useState<string>("");
  const [colunaSelecionada, setColunaSelecionada] = useState<string>("");
  const [titulo, setTitulo] = useState("");

  const { data, refetch } = (trpc as any).kanban.listarCardsPorCliente.useQuery({ clienteId: contatoId });
  const { data: funis } = (trpc as any).kanban.listarFunis.useQuery();
  const { data: funilDetalhe } = (trpc as any).kanban.obterFunil.useQuery(
    { funilId: funilSelecionado ? Number(funilSelecionado) : undefined },
    { enabled: !!funilSelecionado },
  );

  const criarMut = (trpc as any).kanban.criarCard.useMutation({
    onSuccess: () => {
      toast.success("Card criado");
      setCriarOpen(false);
      setTitulo("");
      setColunaSelecionada("");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cards: any[] = data?.cards || [];
  const colunas: any[] = funilDetalhe?.colunas || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Cards do Kanban</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cards.length === 0 ? "Nenhum card vinculado" : `${cards.length} card(s) vinculado(s)`}
          </p>
        </div>
        <Button size="sm" onClick={() => setCriarOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Criar card manual
        </Button>
      </CardHeader>
      <CardContent>
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Este cliente ainda não está em nenhum funil do Kanban.
          </p>
        ) : (
          <div className="space-y-2">
            {cards.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 border rounded-lg p-2.5 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-2 w-2 rounded-full shrink-0" style={{ background: c.colunaCor || "#6b7280" }} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.titulo}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {c.funilNome} · {c.colunaNome}
                      {c.prazo && ` · prazo ${new Date(c.prazo).toLocaleDateString("pt-BR")}`}
                      {c.atrasado && <span className="ml-1 text-red-600 font-medium">(atrasado)</span>}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLocation(`/kanban?card=${c.id}&funil=${c.funilId}`)}
                  title="Abrir no Kanban"
                >
                  Abrir
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Dialog: criar card manual */}
        <Dialog open={criarOpen} onOpenChange={setCriarOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Criar card no Kanban</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Funil</Label>
                <Select value={funilSelecionado} onValueChange={(v) => { setFunilSelecionado(v); setColunaSelecionada(""); }}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha o funil" /></SelectTrigger>
                  <SelectContent>
                    {(funis || []).map((f: any) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Coluna</Label>
                <Select value={colunaSelecionada} onValueChange={setColunaSelecionada} disabled={!funilSelecionado}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder={funilSelecionado ? "Escolha a coluna" : "Escolha um funil primeiro"} /></SelectTrigger>
                  <SelectContent>
                    {colunas.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Título do card</Label>
                <Input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="ex: Contrato pendente"
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCriarOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => criarMut.mutate({
                  colunaId: Number(colunaSelecionada),
                  titulo: titulo.trim(),
                  clienteId: contatoId,
                })}
                disabled={criarMut.isPending || !colunaSelecionada || !titulo.trim()}
              >
                {criarMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Criar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function FinanceiroClienteTab({ contatoId }: { contatoId: number }) {
  const { data, isLoading, refetch } = (trpc as any).asaas.listarCobrancas.useQuery({
    contatoId,
    limit: 100,
  });
  const items: any[] = data?.items || [];

  // Cobranças PIX antigas podem não ter pixQrCodePayload no banco
  // (criadas antes do fix). Endpoint busca on-demand e cacheia.
  const obterPixMut = (trpc as any).asaas.obterPixQrCode.useMutation({
    onSuccess: (r: { payload: string }) => {
      navigator.clipboard.writeText(r.payload);
      toast.success("Código Pix copiado");
      refetch();
    },
    onError: (err: any) => toast.error("Erro ao buscar Pix", { description: err.message }),
  });

  // Toggle do flag comissionável (override por cobrança).
  const atualizarComissionavelMut = (trpc as any).asaas.atualizarComissionavel.useMutation({
    onSuccess: (r: { valor: boolean | null }) => {
      const txt = r.valor === true ? "comissionável"
        : r.valor === false ? "não comissionável"
        : "padrão da categoria";
      toast.success(`Cobrança marcada como ${txt}`);
      refetch();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  // Marcar cobrança manual como recebida.
  const marcarPagaMut = (trpc as any).asaas.marcarCobrancaPaga.useMutation({
    onSuccess: () => {
      toast.success("Cobrança marcada como recebida");
      refetch();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  function copiarLink(url: string) {
    navigator.clipboard.writeText(url);
    toast.success("Link copiado");
  }

  function copiarPix(c: any) {
    if (c.pixQrCodePayload) {
      navigator.clipboard.writeText(c.pixQrCodePayload);
      toast.success("Código Pix copiado");
      return;
    }
    // Fallback: fetch on-demand do Asaas (e cacheia no banco).
    obterPixMut.mutate({ id: c.id });
  }

  // Agregados — calcula direto no client porque a lista cabe em memória.
  const totais = useMemo(() => {
    let pago = 0;
    let pendente = 0;
    let vencido = 0;
    for (const c of items) {
      const v = parseFloat(c.valor) || 0;
      if (c.status === "RECEIVED" || c.status === "CONFIRMED") pago += v;
      else if (c.status === "OVERDUE") vencido += v;
      else if (c.status === "PENDING") pendente += v;
    }
    return { pago, pendente, vencido };
  }, [items]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <DollarSign className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Nenhuma cobrança vinculada</p>
          <p className="text-xs text-muted-foreground mt-1">
            Cobranças deste cliente no Asaas aparecerão aqui automaticamente.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Totais agregados */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border bg-card px-3 py-2 text-center">
          <p className="text-base font-bold leading-tight text-emerald-600">{fmtMoeda(totais.pago)}</p>
          <p className="text-[10px] text-muted-foreground">Pago</p>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2 text-center">
          <p className="text-base font-bold leading-tight text-amber-600">{fmtMoeda(totais.pendente)}</p>
          <p className="text-[10px] text-muted-foreground">Pendente</p>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2 text-center">
          <p className="text-base font-bold leading-tight text-red-600">{fmtMoeda(totais.vencido)}</p>
          <p className="text-[10px] text-muted-foreground">Vencido</p>
        </div>
      </div>

      {/* Lista de cobranças */}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {items.map((c) => {
              const meta = STATUS_COBRANCA_LABEL[c.status] || { label: c.status, cor: "bg-zinc-100 text-zinc-700 border-zinc-200" };
              return (
                <div key={c.id} className="px-4 py-3 flex items-center gap-3 hover:bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{c.descricao || "Cobrança"}</p>
                      <Badge variant="outline" className={`text-[9px] ${meta.cor}`}>{meta.label}</Badge>
                      {c.origem === "manual" && (
                        <Badge className="text-[9px] h-4 px-1 border-0 bg-warning-bg text-warning-fg">
                          manual
                        </Badge>
                      )}
                      {c.formaPagamento && (
                        <Badge variant="secondary" className="text-[9px] font-normal">
                          {c.formaPagamento === "PIX" ? "Pix"
                            : c.formaPagamento === "BOLETO" ? "Boleto"
                            : c.formaPagamento === "CREDIT_CARD" ? "Cartão"
                            : c.formaPagamento === "DINHEIRO" ? "Dinheiro"
                            : c.formaPagamento === "TRANSFERENCIA" ? "Transferência"
                            : c.formaPagamento === "OUTRO" ? "Outro"
                            : c.formaPagamento}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                      <span>Vence {fmtData(c.vencimento)}</span>
                      {c.dataPagamento && <span>Pago {fmtData(c.dataPagamento)}</span>}
                      {c.tipo && <span className="uppercase">{c.tipo}</span>}
                    </div>
                    {/* Ações: copiar link + copiar pix + marcar paga (manual).
                        Apenas pra cobranças em aberto (não faz sentido pra já
                        recebida). */}
                    {c.status !== "RECEIVED" && c.status !== "CONFIRMED" && (
                      <div className="flex items-center gap-1.5 mt-2">
                        {c.origem === "manual" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2 text-emerald-600 hover:text-emerald-700"
                            onClick={() => marcarPagaMut.mutate({ id: c.id })}
                            disabled={marcarPagaMut.isPending}
                            title="Marcar como recebida (cobrança manual)"
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Marcar paga
                          </Button>
                        )}
                        {c.invoiceUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            onClick={() => copiarLink(c.invoiceUrl)}
                            title="Copiar link de pagamento"
                          >
                            <Link2 className="h-3 w-3 mr-1" /> Link
                          </Button>
                        )}
                        {c.origem !== "manual" && (c.formaPagamento === "PIX" || c.formaPagamento === "UNDEFINED") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            onClick={() => copiarPix(c)}
                            disabled={obterPixMut.isPending}
                            title={c.formaPagamento === "UNDEFINED"
                              ? "Cliente escolhe — copiar código Pix do checkout"
                              : "Copiar código Pix"}
                          >
                            {obterPixMut.isPending ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Copy className="h-3 w-3 mr-1" />
                            )}
                            Pix
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                    <p className="text-sm font-semibold">{fmtMoeda(c.valor)}</p>
                    {/* Indicador do override de comissão (quando setado) */}
                    {c.comissionavelOverride === true && (
                      <Badge className="text-[9px] h-4 px-1 border-0 bg-success-bg text-success-fg">
                        comissionável
                      </Badge>
                    )}
                    {c.comissionavelOverride === false && (
                      <Badge className="text-[9px] h-4 px-1 border-0 bg-neutral-bg text-neutral-fg">
                        não comissionável
                      </Badge>
                    )}
                    <div className="flex items-center gap-2">
                      {c.asaasPaymentId && c.origem !== "manual" && (
                        <a
                          href={`https://www.asaas.com/payment/${c.asaasPaymentId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-violet-600 hover:underline"
                        >
                          Abrir no Asaas
                        </a>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground"
                            title="Mais ações"
                            disabled={atualizarComissionavelMut.isPending}
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="text-xs">
                          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide">
                            Comissão
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() =>
                              atualizarComissionavelMut.mutate({ id: c.id, valor: true })
                            }
                            className="gap-2"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                            Marcar comissionável
                            {c.comissionavelOverride === true && (
                              <span className="ml-auto text-[10px] text-muted-foreground">atual</span>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              atualizarComissionavelMut.mutate({ id: c.id, valor: false })
                            }
                            className="gap-2"
                          >
                            <X className="h-3.5 w-3.5 text-neutral-fg" />
                            Marcar NÃO comissionável
                            {c.comissionavelOverride === false && (
                              <span className="ml-auto text-[10px] text-muted-foreground">atual</span>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              atualizarComissionavelMut.mutate({ id: c.id, valor: null })
                            }
                            className="gap-2"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Voltar pro padrão
                            {c.comissionavelOverride === null && (
                              <span className="ml-auto text-[10px] text-muted-foreground">atual</span>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Processos do Cliente ────────────────────────────────────────────────────

const TIPO_PROCESSO_META: Record<string, { label: string; cor: string }> = {
  extrajudicial: { label: "Extrajudicial", cor: "bg-sky-100 text-sky-700 border-sky-200" },
  litigioso: { label: "Litigioso", cor: "bg-violet-100 text-violet-700 border-violet-200" },
};

function ProcessoCard({
  processo,
  expandido,
  onToggle,
  onDesvincular,
  onAdicionarCnj,
}: {
  processo: any;
  expandido: boolean;
  onToggle: () => void;
  onDesvincular: () => void;
  onAdicionarCnj?: () => void;
}) {
  const p = processo;
  const tipo = p.tipo || "litigioso";
  const tipoMeta = TIPO_PROCESSO_META[tipo] || TIPO_PROCESSO_META.litigioso;

  // Anotações são carregadas SOB DEMANDA quando o card é expandido —
  // evita N queries ao listar todos os processos do cliente.
  const { data: anotacoes, refetch: refetchAnotacoes } =
    (trpc as any).clienteProcessos.listarAnotacoes.useQuery(
      { processoId: p.id },
      { enabled: expandido, retry: false },
    );
  const [novaAnot, setNovaAnot] = useState("");
  const criarAnot = (trpc as any).clienteProcessos.criarAnotacao.useMutation({
    onSuccess: () => {
      setNovaAnot("");
      refetchAnotacoes();
      toast.success("Anotação adicionada");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const excluirAnot = (trpc as any).clienteProcessos.excluirAnotacao.useMutation({
    onSuccess: () => refetchAnotacoes(),
    onError: (e: any) => toast.error(e.message),
  });
  const [excluirAnotAlvo, setExcluirAnotAlvo] = useState<number | null>(null);

  return (
    <Card className="hover:shadow-sm transition-all">
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggle}
            className="h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0 hover:bg-indigo-500/20 transition-colors"
            title={expandido ? "Recolher" : "Expandir anotações"}
          >
            <Scale className="h-4 w-4 text-indigo-500" />
          </button>
          <div className="flex-1 min-w-0 cursor-pointer" onClick={onToggle}>
            <div className="flex items-center gap-2 flex-wrap">
              {p.numeroCnj ? (
                <p className="text-sm font-mono font-medium">{p.numeroCnj}</p>
              ) : (
                <p className="text-sm font-medium">{p.apelido || `Processo #${p.id}`}</p>
              )}
              <Badge variant="outline" className={`text-[9px] ${tipoMeta.cor}`}>
                {tipoMeta.label}
              </Badge>
              {p.polo && (
                <Badge variant="outline" className="text-[9px]">
                  {p.polo === "ativo" ? "Polo Ativo" : p.polo === "passivo" ? "Polo Passivo" : "Interessado"}
                </Badge>
              )}
              {p.monitoramentoId && (
                <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[9px]">
                  <Radar className="h-2.5 w-2.5 mr-0.5" /> Monitorado
                </Badge>
              )}
              {/* Judicial sem CNJ ainda — aguardando protocolo */}
              {!p.numeroCnj && (p.tipo === "litigioso" || !p.tipo) && (
                <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[9px]">
                  Aguardando CNJ
                </Badge>
              )}
            </div>
            {/* Apelido só aparece como subtítulo se há CNJ (senão já é o título). */}
            {p.apelido && p.numeroCnj && <p className="text-xs text-muted-foreground">{p.apelido}</p>}
            {p.tribunal && <p className="text-[10px] text-muted-foreground">{p.tribunal}</p>}
          </div>
          {/* Adicionar CNJ depois do protocolo (só pra judicial sem CNJ) */}
          {!p.numeroCnj && (p.tipo === "litigioso" || !p.tipo) && onAdicionarCnj && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] px-2"
              title="Adicionar CNJ após protocolo"
              onClick={(e) => { e.stopPropagation(); onAdicionarCnj(); }}
            >
              + CNJ
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive"
            title="Desvincular"
            onClick={onDesvincular}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Accordion de anotações — abre clicando no ícone ou no texto.
            Só carrega anotações quando expandido (lazy). */}
        {expandido && (
          <div className="mt-3 pt-3 border-t space-y-2">
            <div className="flex items-center gap-2">
              <StickyNote className="h-3.5 w-3.5 text-amber-600" />
              <p className="text-xs font-semibold">Anotações de andamento</p>
            </div>

            {/* Form pra nova anotação */}
            <div className="flex gap-2">
              <Textarea
                value={novaAnot}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNovaAnot(e.target.value)}
                placeholder="Ex: Audiência marcada pra 12/05; despacho recebido; parte contrária respondeu..."
                rows={2}
                maxLength={2000}
                className="text-xs resize-none"
              />
              <Button
                size="sm"
                onClick={() => novaAnot.trim() && criarAnot.mutate({ processoId: p.id, conteudo: novaAnot.trim() })}
                disabled={!novaAnot.trim() || criarAnot.isPending}
                className="self-start"
              >
                {criarAnot.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </div>

            {/* Lista de anotações */}
            {anotacoes && anotacoes.length > 0 ? (
              <div className="space-y-1.5">
                {anotacoes.map((a: any) => (
                  <div key={a.id} className="rounded-md bg-amber-50/40 dark:bg-amber-950/10 border border-amber-200/40 dark:border-amber-900/30 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs whitespace-pre-wrap flex-1">{a.conteudo}</p>
                      <button
                        type="button"
                        onClick={() => setExcluirAnotAlvo(a.id)}
                        className="text-[10px] text-muted-foreground hover:text-destructive"
                      >
                        ×
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {a.autorNome} · {new Date(a.createdAt).toLocaleString("pt-BR", {
                        day: "2-digit", month: "2-digit", year: "2-digit",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground italic text-center py-2">
                Nenhuma anotação ainda. Use o campo acima pra registrar andamentos.
              </p>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog open={excluirAnotAlvo != null} onOpenChange={(o) => !o && setExcluirAnotAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir anotação?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta anotação será removida permanentemente. Não há como desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (excluirAnotAlvo != null) {
                  excluirAnot.mutate({ id: excluirAnotAlvo });
                  setExcluirAnotAlvo(null);
                }
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ProcessosClienteTab({ contatoId }: { contatoId: number }) {
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoCnj, setNovoCnj] = useState("");
  const [novoApelido, setNovoApelido] = useState("");
  const [novoPolo, setNovoPolo] = useState<string>("");
  // 3 modos de cadastro:
  //  - "judicial"            → tipo=litigioso + CNJ obrigatório
  //  - "judicial_aguardando" → tipo=litigioso + CNJ vazio (a obter depois)
  //  - "extrajudicial"       → tipo=extrajudicial + sem CNJ
  const [novoModo, setNovoModo] = useState<"judicial" | "judicial_aguardando" | "extrajudicial">("judicial");
  // Dialog pra adicionar CNJ depois do protocolo (processo já existente).
  const [adicionarCnjOpen, setAdicionarCnjOpen] = useState<{ id: number; apelido: string | null } | null>(null);
  const [cnjAdicionado, setCnjAdicionado] = useState("");
  const [novoMonitorar, setNovoMonitorar] = useState(false);
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());

  function toggleExpandido(processoId: number) {
    setExpandidos((prev) => {
      const novo = new Set(prev);
      if (novo.has(processoId)) novo.delete(processoId);
      else novo.add(processoId);
      return novo;
    });
  }

  const { data: processos, refetch } = (trpc as any).clienteProcessos.listar.useQuery({ contatoId });
  const vincularMut = (trpc as any).clienteProcessos.vincular.useMutation({
    onSuccess: (_r: any, vars: any) => {
      // Como o backend hoje não cria monitoramento automaticamente
      // (cron próprio em desenvolvimento), oferecemos botão pra abrir
      // a tela de criação de monitoramento com CNJ pré-preenchido. Sem
      // isso o user achava que tinha monitorado mas não tinha.
      const cnjVinculado = vars?.numeroCnj;
      if (vars?.monitorar && cnjVinculado) {
        toast.success("Processo vinculado", {
          description: "Pra criar monitoramento, abra o módulo Processos.",
          action: {
            label: "Abrir Processos",
            onClick: () => {
              window.location.href = `/processos?cnj=${encodeURIComponent(cnjVinculado)}&abrirMonitor=1`;
            },
          },
          duration: 12000,
        });
      } else {
        toast.success("Processo vinculado!");
      }
      setNovoOpen(false);
      setNovoCnj("");
      setNovoApelido("");
      setNovoPolo("");
      setNovoModo("judicial");
      setNovoMonitorar(false);
      refetch();
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });
  const atualizarProcessoMut = (trpc as any).clienteProcessos.atualizar.useMutation({
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });
  const desvincularMut = (trpc as any).clienteProcessos.desvincular.useMutation({
    onSuccess: () => { toast.success("Processo desvinculado"); refetch(); },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });
  const [desvincularAlvo, setDesvincularAlvo] = useState<{ id: number; apelido: string | null; numeroCnj: string | null } | null>(null);

  const lista = processos || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2">
            <Scale className="h-4 w-4 text-indigo-500" />
            Processos ({lista.length})
          </p>
          <p className="text-xs text-muted-foreground">Processos nos quais o escritório representa este cliente</p>
        </div>
        <Button size="sm" onClick={() => setNovoOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Vincular processo
        </Button>
      </div>

      {lista.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Scale className="h-10 w-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm font-medium">Nenhum processo vinculado</p>
            <p className="text-xs text-muted-foreground mt-1">
              Vincule processos para acompanhar os casos deste cliente.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {lista.map((p: any) => (
            <ProcessoCard
              key={p.id}
              processo={p}
              expandido={expandidos.has(p.id)}
              onToggle={() => toggleExpandido(p.id)}
              onAdicionarCnj={() => setAdicionarCnjOpen({ id: p.id, apelido: p.apelido })}
              onDesvincular={() => setDesvincularAlvo({ id: p.id, apelido: p.apelido, numeroCnj: p.numeroCnj })}
            />
          ))}
        </div>
      )}

      {/* Dialog vincular processo */}
      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular processo</DialogTitle>
            <DialogDescription>
              Vincule um processo judicial (com CNJ) ou um caso extrajudicial
              (contrato, consultoria, processo administrativo).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* Modo escolhido primeiro — controla os campos seguintes */}
            <div>
              <Label>Tipo de processo</Label>
              <Select value={novoModo} onValueChange={(v) => setNovoModo(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="judicial">Judicial — já tenho o CNJ</SelectItem>
                  <SelectItem value="judicial_aguardando">Judicial — aguardando protocolo (CNJ a obter)</SelectItem>
                  <SelectItem value="extrajudicial">Extrajudicial (contrato, consultoria, administrativo)</SelectItem>
                </SelectContent>
              </Select>
              {novoModo === "judicial_aguardando" && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Use quando o cliente te contratou pra ajuizar mas o processo ainda não foi protocolado.
                  Depois do protocolo, você adiciona o CNJ direto no card do processo.
                </p>
              )}
            </div>

            {novoModo === "judicial" ? (
              <div>
                <Label>Número CNJ *</Label>
                <Input
                  placeholder="0000000-00.0000.0.00.0000"
                  value={novoCnj}
                  onChange={(e) => setNovoCnj(e.target.value)}
                  className="font-mono"
                />
              </div>
            ) : novoModo === "extrajudicial" ? (
              <div>
                <Label>Número de referência (opcional)</Label>
                <Input
                  placeholder="Ex: protocolo administrativo, número do contrato..."
                  value={novoCnj}
                  onChange={(e) => setNovoCnj(e.target.value)}
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Caso seu processo tenha algum número identificador (não-CNJ), pode incluir aqui.
                </p>
              </div>
            ) : null /* judicial_aguardando: sem campo de CNJ — será preenchido depois */}

            <div>
              <Label>
                {novoModo === "judicial" ? "Descrição (opcional)" : "Descrição *"}
              </Label>
              <Input
                placeholder="Ex: Divórcio, Ação cobrança, Contrato consultoria..."
                value={novoApelido}
                onChange={(e) => setNovoApelido(e.target.value)}
              />
              {novoModo !== "judicial" && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Sem CNJ, a descrição é o que identifica esse processo nas listas e cobranças vinculadas.
                </p>
              )}
            </div>

            <div>
              <Label>Polo do cliente</Label>
              <Select value={novoPolo} onValueChange={setNovoPolo}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Polo Ativo (autor)</SelectItem>
                  <SelectItem value="passivo">Polo Passivo (réu)</SelectItem>
                  <SelectItem value="interessado">Interessado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {novoModo === "judicial" && (
              <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={novoMonitorar}
                  onChange={(e) => setNovoMonitorar(e.target.checked)}
                  className="accent-primary"
                />
                <div>
                  <p className="text-xs font-medium">Quero monitorar este processo</p>
                  <p className="text-[10px] text-muted-foreground">
                    Após vincular, abriremos a tela de monitoramento (módulo Processos) com este CNJ
                    pré-preenchido pra você escolher a credencial e confirmar (5 créditos/mês).
                  </p>
                </div>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                // judicial_aguardando: tipo='litigioso' + CNJ vazio. Backend
                // mantém o tipo escolhido (não força extrajudicial). Vai pra
                // lista como "aguardando CNJ"; user adiciona depois.
                const enviarCnj = cnjFormatoValido(novoCnj) ? novoCnj.trim() : undefined;
                const tipoFinal: "extrajudicial" | "litigioso" =
                  novoModo === "extrajudicial" ? "extrajudicial" : "litigioso";
                vincularMut.mutate({
                  contatoId,
                  numeroCnj: enviarCnj,
                  apelido: novoApelido || undefined,
                  polo: novoPolo || undefined,
                  tipo: tipoFinal,
                  monitorar: novoModo === "judicial" ? novoMonitorar : false,
                });
              }}
              disabled={
                vincularMut.isPending ||
                (novoModo === "judicial"
                  ? !cnjFormatoValido(novoCnj)
                  : !novoApelido.trim())
              }
            >
              {vincularMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog pra adicionar CNJ depois do protocolo. */}
      <Dialog
        open={adicionarCnjOpen != null}
        onOpenChange={(o) => { if (!o) { setAdicionarCnjOpen(null); setCnjAdicionado(""); } }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar CNJ ao processo</DialogTitle>
            <DialogDescription>
              {adicionarCnjOpen?.apelido
                ? `Processo "${adicionarCnjOpen.apelido}" — informe o CNJ recebido após o protocolo.`
                : "Informe o CNJ recebido após o protocolo."}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Número CNJ *</Label>
            <Input
              placeholder="0000000-00.0000.0.00.0000"
              value={cnjAdicionado}
              onChange={(e) => setCnjAdicionado(e.target.value)}
              className="font-mono mt-1"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdicionarCnjOpen(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!adicionarCnjOpen) return;
                atualizarProcessoMut.mutate(
                  { id: adicionarCnjOpen.id, numeroCnj: cnjAdicionado.trim() },
                  {
                    onSuccess: () => {
                      toast.success("CNJ adicionado!");
                      setAdicionarCnjOpen(null);
                      setCnjAdicionado("");
                      refetch();
                    },
                  },
                );
              }}
              disabled={
                atualizarProcessoMut.isPending ||
                !cnjFormatoValido(cnjAdicionado)
              }
            >
              {atualizarProcessoMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!desvincularAlvo} onOpenChange={(o) => !o && setDesvincularAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular processo?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove o vínculo de <strong>{desvincularAlvo?.apelido || desvincularAlvo?.numeroCnj || "este processo"}</strong> com o cliente.
              Anotações no processo também serão perdidas. Cobranças vinculadas permanecem.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (desvincularAlvo) {
                  desvincularMut.mutate({ id: desvincularAlvo.id });
                  setDesvincularAlvo(null);
                }
              }}
              disabled={desvincularMut.isPending}
            >
              {desvincularMut.isPending ? "Desvinculando..." : "Desvincular"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Atendente do Lead (trocar inline) ──────────────────────────────────────
// Resolve casos onde o lead foi gravado com responsavelId errado (ex: cliente
// cadastrado sem responsável → lead fica com o operador logado, não com quem
// fechou a venda). Sem isso, relatório comercial do atendente real fica zerado.
function LeadAtendenteInline({
  leadId,
  responsavelAtualId,
  responsavelAtualNome,
  onUpdated,
}: {
  leadId: number;
  responsavelAtualId: number | null;
  responsavelAtualNome: string | null;
  onUpdated: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState<string>(
    responsavelAtualId ? String(responsavelAtualId) : "",
  );
  const { data: equipeData } = (trpc as any).configuracoes?.listarColaboradores?.useQuery?.(
    undefined,
    { retry: false, enabled: editando },
  ) || { data: null };
  const colabs: any[] = equipeData?.colaboradores || [];

  const mut = (trpc as any).crm.atualizarLead.useMutation({
    onSuccess: () => {
      toast.success("Atendente do lead atualizado");
      setEditando(false);
      onUpdated();
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao atualizar atendente"),
  });

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        title="Trocar atendente responsável"
      >
        {responsavelAtualNome ? `por ${responsavelAtualNome}` : "sem atendente — atribuir"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <select
        className="text-[10px] border rounded px-1 py-0.5 bg-background"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        disabled={mut.isPending}
      >
        <option value="">— selecione —</option>
        {colabs.map((c: any) => (
          <option key={c.id} value={String(c.id)}>
            {c.userName || c.userEmail || `Colaborador #${c.id}`}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        className="h-6 px-2 text-[10px]"
        disabled={mut.isPending || !valor}
        onClick={() => mut.mutate({ id: leadId, responsavelId: Number(valor) })}
      >
        Salvar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[10px]"
        disabled={mut.isPending}
        onClick={() => { setEditando(false); setValor(responsavelAtualId ? String(responsavelAtualId) : ""); }}
      >
        Cancelar
      </Button>
    </div>
  );
}

// ─── Detalhe do Cliente ─────────────────────────────────────────────────────

function ClienteDetalhe({
  id,
  onVoltar,
  onUpdate,
}: {
  id: number;
  onVoltar: () => void;
  onUpdate: () => void;
}) {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState("visao-geral");
  const [gerarContratoOpen, setGerarContratoOpen] = useState(false);
  const [fechamentoOpen, setFechamentoOpen] = useState(false);
  const utilsTrpc = trpc.useUtils();
  const { data: cliente, refetch } = trpc.clientes.detalhe.useQuery({ id });
  const { data: anotacoes, refetch: rN } = trpc.clientes.listarAnotacoes.useQuery({ contatoId: id });
  const { data: arquivos, refetch: rA } = trpc.clientes.listarArquivos.useQuery({ contatoId: id });
  const { data: convsData } = trpc.clientes.listarConversas.useQuery({ contatoId: id });
  const { data: leadsData, refetch: refetchLeads } = trpc.clientes.listarLeads.useQuery({ contatoId: id });
  const fechamentosExistentes = ((leadsData as any[]) || [])
    .filter((l) => l.etapaFunil === "fechado_ganho")
    .map((l) => ({
      valorEstimado: l.valorEstimado ?? null,
      createdAt: l.createdAt ?? "",
    }));
  const { data: assinaturas, refetch: rAs } =
    (trpc as any).assinaturas.listarPorCliente.useQuery({ contatoId: id });
  const excluirMut = trpc.clientes.excluir.useMutation({
    onSuccess: () => {
      toast.success("Cliente excluído.");
      onVoltar();
      onUpdate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [excluirConfirmAlvo, setExcluirConfirmAlvo] = useState(false);

  // Permissões pra esconder botão de excluir quando o user não pode.
  // Sem isso, atendente vê o botão e backend rejeita — UX/backend mismatch.
  const { data: minhasPerms } = (trpc as any).permissoes?.minhasPermissoes?.useQuery?.(
    undefined,
    { retry: false, refetchOnWindowFocus: false },
  ) || { data: null };
  const podeExcluirCliente = !!(minhasPerms?.permissoes?.clientes?.excluir);

  if (!cliente) {
    return (
      <div className="text-center py-12">
        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
      </div>
    );
  }

  const isVip = (cliente.tags || "").toLowerCase().includes("vip");

  return (
    <div className="space-y-4">
      {/* Banner laranja quando documentação pendente — visível em todas
          as abas pra atendente lembrar de cobrar. Some quando admin
          marca como recebida (no form Editar). */}
      {cliente.documentacaoPendente && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-900 px-4 py-3 flex items-start gap-3">
          <FileText className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-orange-900 dark:text-orange-100">
              Documentação pendente
            </p>
            {cliente.documentacaoObservacoes && (
              <p className="text-xs text-orange-800/80 dark:text-orange-200/80 mt-0.5 whitespace-pre-wrap">
                {cliente.documentacaoObservacoes}
              </p>
            )}
            <p className="text-[11px] text-orange-700/70 dark:text-orange-300/70 mt-1">
              Após receber e arquivar, desmarque em &ldquo;Visão Geral &gt; Documentação pendente&rdquo;.
            </p>
          </div>
        </div>
      )}

      {/* Header do cliente */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onVoltar}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-200 to-purple-100 flex items-center justify-center text-sm font-bold text-violet-700">
          {initials(cliente.nome || "?")}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">{cliente.nome}</h2>
            {isVip && <Star className="h-4 w-4 text-amber-500" />}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {cliente.telefone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" /> {cliente.telefone}
              </span>
            )}
            {(cliente as any).telefonesSecundarios?.length > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground">
                +{(cliente as any).telefonesSecundarios.length} tel
              </span>
            )}
            {cliente.email && (
              <span className="flex items-center gap-1">
                <Mail className="h-3 w-3" /> {cliente.email}
              </span>
            )}
            {cliente.cpfCnpj && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" /> {cliente.cpfCnpj}
              </span>
            )}
          </div>
        </div>
        {cliente.telefone && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation(`/atendimento?contatoId=${id}`)}
          >
            <MessageCircle className="h-4 w-4 mr-1 text-emerald-600" />
            Inbox
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setGerarContratoOpen(true)}
        >
          <FileText className="h-4 w-4 mr-1 text-info" />
          Gerar contrato
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFechamentoOpen(true)}
          title="Marca conversão (fechado_ganho) — usa quando esqueceu de marcar 'já fechou' no cadastro ou quando o cliente fechou outro contrato"
        >
          <CheckCircle2 className="h-4 w-4 mr-1 text-emerald-600" />
          Registrar fechamento
        </Button>
        {cliente.cpfCnpj && (
          <MonitorarJuditButton
            cpfCnpj={cliente.cpfCnpj}
            nome={cliente.nome}
          />
        )}
        <FinanceiroPopover contatoId={id} />
        {podeExcluirCliente && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setExcluirConfirmAlvo(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <AlertDialog open={excluirConfirmAlvo} onOpenChange={setExcluirConfirmAlvo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove <strong>{cliente.nome}</strong> e todos os dados vinculados:
              conversas, leads, tarefas, anotações, arquivos, assinaturas e cobranças Asaas.
              Não há como desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                excluirMut.mutate({ id });
                setExcluirConfirmAlvo(false);
              }}
              disabled={excluirMut.isPending}
            >
              {excluirMut.isPending ? "Excluindo..." : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 6 abas consolidadas */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-6 h-9">
          <TabsTrigger value="visao-geral" className="text-xs gap-1">
            <User className="h-3 w-3" /> Visão Geral
          </TabsTrigger>
          <TabsTrigger value="processos" className="text-xs gap-1">
            <Scale className="h-3 w-3" /> Processos
          </TabsTrigger>
          <TabsTrigger value="kanban" className="text-xs gap-1">
            <Trello className="h-3 w-3" /> Kanban
          </TabsTrigger>
          <TabsTrigger value="financeiro" className="text-xs gap-1">
            <DollarSign className="h-3 w-3" /> Financeiro
          </TabsTrigger>
          <TabsTrigger value="historico" className="text-xs gap-1">
            <MessageCircle className="h-3 w-3" /> Histórico
          </TabsTrigger>
          <TabsTrigger value="documentos" className="text-xs gap-1">
            <FileText className="h-3 w-3" /> Documentos
          </TabsTrigger>
        </TabsList>

        {/* Aba 1: Visão Geral (dados + tarefas) */}
        <TabsContent value="visao-geral" className="mt-4 space-y-4">
          {/* key={cliente.id} força remount ao trocar de cliente — os useState
              do EditarForm são inicializados via `cliente.X` e não re-sincronizam
              quando a prop muda; sem o key, salvar com cliente B persistiria
              nome/CPF/qualificação do cliente A (corrupção silenciosa). */}
          <EditarForm key={cliente.id} cliente={cliente} onSuccess={() => { refetch(); onUpdate(); }} />
          <TarefasClienteTab key={id} contatoId={id} />
        </TabsContent>

        {/* Aba 2: Processos */}
        <TabsContent value="processos" className="mt-4 space-y-4">
          <ProcessosClienteTab key={id} contatoId={id} />
        </TabsContent>

        {/* Aba 3: Kanban — cards onde este cliente está sendo trabalhado */}
        <TabsContent value="kanban" className="mt-4 space-y-4">
          {/* key={id} força remount ao trocar de cliente — o form interno
              (titulo, funilSelecionado, etc) é inicializado com useState
              e não se reseta quando contatoId muda. Sem o key, criar card
              do cliente A → fechar dialog sem submeter → trocar pra B →
              abrir dialog atribuiria os campos do A ao card do B. */}
          <KanbanClienteTab key={id} contatoId={id} />
        </TabsContent>

        {/* Aba 4: Financeiro — bloco de vínculo + cobranças do Asaas + badge */}
        <TabsContent value="financeiro" className="mt-4 space-y-4">
          <VincularAsaasBlock key={id} contatoId={id} cpfCnpj={cliente.cpfCnpj} />
          <FinanceiroBadge contatoId={id} />
          <FinanceiroClienteTab key={id} contatoId={id} />
        </TabsContent>

        {/* Aba 3: Histórico (conversas + leads + notas + timeline) */}
        <TabsContent value="historico" className="mt-4 space-y-4">
          {/* Conversas */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-blue-500" />
                Conversas
              </p>
              {!(convsData || []).length ? (
                <p className="text-xs text-muted-foreground py-2">Nenhuma conversa.</p>
              ) : (
                <div className="space-y-2">
                  {(convsData || []).map((c: any) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg border"
                    >
                      <MessageCircle className="h-4 w-4 text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{c.assunto || "Conversa"}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.ultimaMensagemPreview}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[9px]">
                        {c.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(c.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Leads */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-violet-500" />
                Negociações (Leads)
              </p>
              {!(leadsData || []).length ? (
                <p className="text-xs text-muted-foreground py-2">Nenhum lead.</p>
              ) : (
                <div className="space-y-2">
                  {(leadsData || []).map((l: any) => (
                    <div
                      key={l.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg border"
                    >
                      <TrendingUp className="h-4 w-4 text-violet-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{l.etapaFunil}</p>
                        <LeadAtendenteInline
                          leadId={l.id}
                          responsavelAtualId={l.responsavelId ?? null}
                          responsavelAtualNome={l.responsavelNome ?? null}
                          onUpdated={() => refetchLeads()}
                        />
                      </div>
                      {l.valorEstimado && (
                        <span className="text-sm font-medium text-emerald-600 whitespace-nowrap">
                          <DollarSign className="h-3 w-3 inline mr-0.5" />
                          {fmtMoeda(parseValorBR(l.valorEstimado))}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {timeAgo(l.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Anotações */}
          <AnotacoesTab contatoId={id} anotacoes={anotacoes || []} onRefresh={rN} />
        </TabsContent>

        {/* Aba 3: Documentos (arquivos + assinaturas) */}
        <TabsContent value="documentos" className="mt-4 space-y-4">
          <ArquivosTab contatoId={id} arquivos={arquivos || []} onRefresh={rA} />
          <AssinaturasTab
            contatoId={id}
            cliente={cliente}
            assinaturas={assinaturas || []}
            onRefresh={rAs}
          />
        </TabsContent>
      </Tabs>

      <GerarContratoDialog
        contatoId={id}
        contatoNome={cliente.nome}
        open={gerarContratoOpen}
        onOpenChange={setGerarContratoOpen}
      />

      <RegistrarFechamentoDialog
        open={fechamentoOpen}
        onOpenChange={setFechamentoOpen}
        contatoId={id}
        responsavelClienteId={cliente?.responsavelId ?? null}
        fechamentosExistentes={fechamentosExistentes}
        onSuccess={() => {
          utilsTrpc.clientes.listarLeads.invalidate({ contatoId: id });
          utilsTrpc.clientes.detalhe.invalidate({ id });
        }}
      />
    </div>
  );
}
