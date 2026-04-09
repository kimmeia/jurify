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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, Plus, Search, Phone, Mail, Trash2, Loader2, ArrowLeft, User,
  MessageCircle, TrendingUp, FileText, StickyNote, CheckSquare, PenLine,
  Download, Filter, DollarSign, Star, Calendar, Send, Siren, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { FinanceiroBadge, FinanceiroPopover } from "@/components/FinanceiroBadge";
import {
  EditarForm, AnotacoesTab, ArquivosTab, AssinaturasTab, TarefasClienteTab,
  NovoClienteDialog,
} from "./clientes/detail-tabs";
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

  // Verifica se já existe monitoramento ativo
  const { data: monsData, refetch: refetchMons } =
    trpc.juditUsuario.meusMonitoramentos.useQuery(
      { busca: clean, tipoMonitoramento: "novas_acoes" },
      { retry: false },
    );
  const monAtivo = (monsData || []).find(
    (m: any) =>
      m.searchKey === clean &&
      m.tipoMonitoramento === "novas_acoes" &&
      m.statusJudit !== "deleted",
  );

  const criarMut = trpc.juditUsuario.criarMonitoramentoNovasAcoes.useMutation({
    onSuccess: () => {
      toast.success(`Monitoramento criado para ${nome}!`, {
        description: "Vamos avisar quando novas ações forem distribuídas.",
        action: {
          label: "Ver em Processos",
          onClick: () => setLocation("/processos"),
        },
      });
      refetchMons();
    },
    onError: (e: any) => toast.error("Erro ao criar monitoramento", { description: e.message }),
  });

  const deletarMut = trpc.juditUsuario.deletar.useMutation({
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
      refetchMons();
    },
    onError: (e: any) => toast.error("Erro ao remover", { description: e.message }),
  });

  if (monAtivo) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={deletarMut.isPending}
        onClick={() => {
          if (
            confirm(
              `Parar de monitorar ${nome}?\n\nVocê deixará de ser avisado sobre novas ações e a cobrança mensal recorrente será interrompida.`,
            )
          ) {
            deletarMut.mutate({ id: monAtivo.id });
          }
        }}
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
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        if (confirm(`Criar monitoramento de novas ações para ${nome}?\n\nVocê será avisado quando alguém processar este cliente. Cobrança: 35 créditos/mês.`)) {
          criarMut.mutate({
            tipo,
            valor: clean,
            apelido: nome,
          });
        }
      }}
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
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(n: string) {
  return n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
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

type Segmento = "todos" | "vip" | "inativo" | "novos" | "com_email" | "com_telefone";

const SEGMENTOS: { id: Segmento; label: string; icon: any; color: string }[] = [
  { id: "todos", label: "Todos", icon: Users, color: "text-muted-foreground" },
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
  if (seg === "novos") {
    const seteDias = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return clientes.filter((c) => new Date(c.createdAt).getTime() >= seteDias);
  }
  if (seg === "inativo") {
    const trintaDias = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return clientes.filter((c) => new Date(c.updatedAt || c.createdAt).getTime() < trintaDias);
  }
  if (seg === "vip") {
    return clientes.filter((c) => (c.tags || "").toLowerCase().includes("vip"));
  }
  return clientes;
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function Clientes() {
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  const [segmento, setSegmento] = useState<Segmento>("todos");
  const [pagina, setPagina] = useState(1);
  const [selId, setSelId] = useState<number | null>(null);
  const [showNovo, setShowNovo] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaDebounced(busca);
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const { data: stats } = trpc.clientes.estatisticas.useQuery();
  const { data, refetch } = trpc.clientes.listar.useQuery({
    busca: buscaDebounced || undefined,
    pagina,
    limite: 50,
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

  const handleBulkWhatsApp = () => {
    const lista = clientesFiltrados.filter((c: any) => selecionados.has(c.id) && c.telefone);
    if (lista.length === 0) {
      toast.error("Nenhum selecionado com telefone");
      return;
    }
    if (lista.length > 5) {
      if (!confirm(`Abrir ${lista.length} conversas WhatsApp?`)) return;
    }
    for (const c of lista) {
      const tel = (c.telefone || "").replace(/\D/g, "");
      window.open(`https://wa.me/${tel}`, "_blank");
    }
  };

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
        <Button size="sm" onClick={() => setShowNovo(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Novo Cliente
        </Button>
      </div>

      {/* Stats */}
      {stats && (
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
                  <Button size="sm" variant="outline" onClick={handleBulkWhatsApp}>
                    <MessageCircle className="h-3.5 w-3.5 mr-1 text-emerald-600" /> WhatsApp
                  </Button>
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
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/40 transition-colors text-left group"
                    >
                      <Checkbox
                        checked={selecionados.has(c.id)}
                        onCheckedChange={() => toggleSelecionado(c.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        className="flex-1 flex items-center gap-3 min-w-0"
                        onClick={() => setSelId(c.id)}
                      >
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
                      </button>
                      <div className="w-32 text-right">
                        <FinanceiroBadge contatoId={c.id} />
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0 w-16 justify-center">
                        {c.origem}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground shrink-0 w-12 text-right">
                        {timeAgo(c.createdAt)}
                      </span>
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
    </div>
  );
}

// ─── Detalhe: 3 abas consolidadas ────────────────────────────────────────────

function ClienteDetalhe({
  id,
  onVoltar,
  onUpdate,
}: {
  id: number;
  onVoltar: () => void;
  onUpdate: () => void;
}) {
  const [tab, setTab] = useState("visao-geral");
  const { data: cliente, refetch } = trpc.clientes.detalhe.useQuery({ id });
  const { data: anotacoes, refetch: rN } = trpc.clientes.listarAnotacoes.useQuery({ contatoId: id });
  const { data: arquivos, refetch: rA } = trpc.clientes.listarArquivos.useQuery({ contatoId: id });
  const { data: convsData } = trpc.clientes.listarConversas.useQuery({ contatoId: id });
  const { data: leadsData } = trpc.clientes.listarLeads.useQuery({ contatoId: id });
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

  if (!cliente) {
    return (
      <div className="text-center py-12">
        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
      </div>
    );
  }

  const totalAssinaturas = (assinaturas || []).length;
  const isVip = (cliente.tags || "").toLowerCase().includes("vip");

  return (
    <div className="space-y-4">
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
            <FinanceiroBadge contatoId={id} />
          </div>
        </div>
        {cliente.telefone && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const tel = (cliente.telefone || "").replace(/\D/g, "");
              window.open(`https://wa.me/${tel}`, "_blank");
            }}
          >
            <Send className="h-4 w-4 mr-1 text-emerald-600" />
            WhatsApp
          </Button>
        )}
        {cliente.cpfCnpj && (
          <MonitorarJuditButton
            cpfCnpj={cliente.cpfCnpj}
            nome={cliente.nome}
          />
        )}
        <FinanceiroPopover contatoId={id} />
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => {
            if (confirm("Excluir cliente e dados associados?"))
              excluirMut.mutate({ id });
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Stats resumo */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { v: cliente.totalConversas, l: "Conversas", c: "text-blue-600" },
          { v: cliente.totalLeads, l: "Leads", c: "text-violet-600" },
          { v: cliente.totalArquivos, l: "Arquivos", c: "text-amber-600" },
          { v: cliente.totalAnotacoes, l: "Anotações", c: "text-emerald-600" },
          { v: totalAssinaturas, l: "Assinaturas", c: "text-rose-600" },
        ].map((k, i) => (
          <div
            key={i}
            className="rounded-lg border bg-card px-3 py-2 text-center"
          >
            <p className={`text-lg font-bold ${k.c}`}>{k.v}</p>
            <p className="text-[10px] text-muted-foreground">{k.l}</p>
          </div>
        ))}
      </div>

      {/* 3 abas consolidadas */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3 h-9">
          <TabsTrigger value="visao-geral" className="text-xs gap-1">
            <User className="h-3 w-3" /> Visão Geral
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
          <EditarForm cliente={cliente} onSuccess={() => { refetch(); onUpdate(); }} />
          <TarefasClienteTab contatoId={id} />
        </TabsContent>

        {/* Aba 2: Histórico (conversas + leads + notas + timeline) */}
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
                      <div className="flex-1">
                        <p className="text-sm">{l.etapaFunil}</p>
                      </div>
                      {l.valorEstimado && (
                        <span className="text-sm font-medium text-emerald-600">
                          <DollarSign className="h-3 w-3 inline mr-0.5" />
                          {l.valorEstimado}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
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
    </div>
  );
}
