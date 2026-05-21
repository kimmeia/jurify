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
  Scale, Radar, Copy, Link2, MoreVertical, X, RotateCcw, Trello, Pencil,
  MapPin, AlertTriangle, Briefcase, UserPlus,
} from "lucide-react";
import { PulseDot, gradientAvatar, gerarIniciais } from "./dashboards/common";
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
import { VincularBeneficiarioDialog } from "./financeiro/VincularBeneficiarioDialog";
import { GerarContratoDialog } from "@/components/GerarContratoDialog";
import {
  EditarForm, AnotacoesTab, ArquivosTab, AssinaturasTab, TarefasClienteTab,
  NovoClienteDialog, RegistrarFechamentoDialog,
} from "./clientes/detail-tabs";
import { parseValorBR } from "@shared/valor-br";
import { useLocation } from "wouter";

/**
 * Botão "Monitorar processos" — cria/remove um monitoramento de NOVAS
 * AÇÕES pro CPF/CNPJ do cliente. É TOGGLE: se já estiver monitorando,
 * clicar remove o monitoramento (e interrompe a cobrança mensal
 * recorrente). O motor de busca é próprio (scrapers PJe TJCE / ESAJ
 * TJCE via credenciais do cofre) — a nomenclatura "Judit" antiga foi
 * removida da UI mas alguns nomes técnicos no schema (statusJudit,
 * juditErro) permanecem por compatibilidade com dados históricos.
 */
function MonitorarProcessosButton({ cpfCnpj, nome }: { cpfCnpj: string; nome: string }) {
  const clean = cpfCnpj.replace(/\D/g, "");
  // Early return ANTES de qualquer hook (rules of hooks). CPF (11) ou
  // CNPJ (14) — fora disso = cadastro malformado, backend rejeitaria com
  // erro genérico depois do user pagar 35 créditos.
  if (clean.length !== 11 && clean.length !== 14) {
    return null;
  }
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
          description: `Mas falhou ao avisar o motor: ${r.juditErro}. A cobrança mensal foi interrompida.`,
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
  // RFC 4180: cerca todo campo com aspas duplas e escapa aspas internas
  // dobrando-as. Antes só nome/tags eram cercados; telefone/email/cpf/origem
  // ficavam crus — vírgula em campo livre (raro mas possível) quebrava o CSV.
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const headers = ["Nome", "Telefone", "Email", "CPF/CNPJ", "Origem", "Tags", "Criado em"];
  const rows = clientes.map((c) => [
    esc(c.nome),
    esc(c.telefone),
    esc(c.email),
    esc(c.cpfCnpj),
    esc(c.origem),
    esc(c.tags),
    esc(new Date(c.createdAt).toLocaleDateString("pt-BR")),
  ]);
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  // Revogar s\u00edncronamente ap\u00f3s click() race com o download em Safari/Firefox
  // (mesmo padr\u00e3o do baixarPastaZip e do exportarDuplicatasPdf). setTimeout
  // afasta a revoga\u00e7\u00e3o pro pr\u00f3ximo tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─── Segmentação (chips) ─────────────────────────────────────────────────────

type Segmento =
  | "todos"
  | "vip"
  | "inativo"
  | "novos"
  | "com_email"
  | "com_telefone"
  | "aguardando_docs"
  | "com_debito";

/** Backend agora filtra todos os segmentos no servidor (incluindo
 *  com_debito via subquery em asaas_cobrancas). Esta função mantém
 *  fallback client-side defensivo caso o backend devolva mais que
 *  o esperado pra algum segmento — não deveria acontecer. */
function aplicarSegmento(
  clientes: any[],
  seg: Segmento,
  resumoFin?: Record<number, { vencido?: number }> | null,
): any[] {
  if (seg === "todos") return clientes;
  if (seg === "com_email") return clientes.filter((c) => !!c.email);
  if (seg === "com_telefone") return clientes.filter((c) => !!c.telefone);
  if (seg === "aguardando_docs") return clientes.filter((c) => !!c.documentacaoPendente);
  if (seg === "com_debito") {
    // Backend já filtrou. Se resumoFin disponível, refina; senão devolve
    // a lista do servidor (que já tá filtrada por SQL).
    if (!resumoFin) return clientes;
    return clientes.filter((c) => Number(resumoFin[c.id]?.vencido ?? 0) > 0);
  }
  if (seg === "novos") {
    const seteDias = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return clientes.filter((c) => new Date(c.createdAt).getTime() >= seteDias);
  }
  if (seg === "inativo") {
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

/** Heurística "inativo há quantos dias" — usado nas pills do row. */
function diasInativo(c: any): number | null {
  const ref = c.ultimaConversaAt || c.createdAt;
  if (!ref) return null;
  const dias = Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24));
  return dias >= 30 ? dias : null;
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
    // Se veio com ?id=X na URL, abre direto no detalhe.
    // Guard contra NaN: ?id=abc → Number("abc") = NaN. Sem o guard, a
    // query clientes.detalhe disparava com id: NaN e fazia round-trip
    // desnecessário no servidor (que rejeita por zod).
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("id");
    if (!idParam) return null;
    const n = Number(idParam);
    return Number.isInteger(n) && n > 0 ? n : null;
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

  // Sincroniza URL com selId/segmento — sem isso, F5 / back do browser
  // perde o estado (volta sempre pra lista geral). replaceState não
  // empilha entradas no histórico (back ainda volta pra página anterior
  // ao Clientes, não entre seleções internas).
  useEffect(() => {
    const params = new URLSearchParams();
    if (selId) params.set("id", String(selId));
    if (segmento === "aguardando_docs") params.set("aguardandoDocs", "1");
    const search = params.toString();
    const url = `${window.location.pathname}${search ? "?" + search : ""}`;
    window.history.replaceState({}, "", url);
  }, [selId, segmento]);

  const { data: stats } = trpc.clientes.estatisticas.useQuery();
  // Todos os segmentos (incluindo com_debito) filtram no servidor — antes
  // o com_debito filtrava client-side em cima dos 50 da página, resultando
  // em lista vazia quando os inadimplentes estavam em outras páginas.
  const { data, refetch } = trpc.clientes.listar.useQuery({
    busca: buscaDebounced || undefined,
    pagina,
    limite: 50,
    segmento,
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

  // Resumo financeiro batch — carrega ANTES da filtragem pra suportar
  // segmento "com_debito" (filtro client-side em cima do resumo).
  // Antes batch dependia de clientesFiltrados (ciclo); agora usa base crua.
  const idsBase = useMemo(
    () => (data?.clientes || []).map((c: any) => c.id),
    [data],
  );
  const { data: asaasStatusList } = (trpc as any).asaas?.status?.useQuery?.(undefined, { retry: false }) || { data: null };
  const { data: resumoFinanceiroBatch } = (trpc as any).asaas?.resumoPorContatos?.useQuery?.(
    { contatoIds: idsBase },
    {
      enabled: !!asaasStatusList?.conectado && idsBase.length > 0,
      retry: false,
      staleTime: 5 * 60_000,
    },
  ) || { data: null };

  // Filtragem: para segmentos server-side é idempotente (backend já filtrou).
  // Para "com_debito", filtra em cima do resumoFinanceiroBatch.
  const clientesFiltrados = useMemo(() => {
    const base = data?.clientes || [];
    return aplicarSegmento(base, segmento, resumoFinanceiroBatch ?? null);
  }, [data, segmento, resumoFinanceiroBatch]);

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

  // Total de inadimplentes do ESCRITÓRIO inteiro — vem do procedure
  // estatisticas (COUNT DISTINCT contatos com cobrança vencida).
  // Antes calculávamos client-side só com os 50 da página atual,
  // resultando em contagem falsa pra escritórios com mais clientes.
  const clientesComDebito: number = (stats as any)?.inadimplentes ?? 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {selId ? (
        <ClienteDetalhe id={selId} onVoltar={() => setSelId(null)} onUpdate={refetch} />
      ) : (
        <div className="rounded-2xl bg-gradient-to-br from-slate-50/40 via-white to-violet-50/20 p-6 space-y-5">
          {/* ═══════════ HERO ═══════════ */}
          <div className="rounded-2xl bg-gradient-to-br from-violet-700 via-purple-700 to-indigo-800 p-7 text-white relative overflow-hidden shadow-lg">
            <Users className="absolute -right-10 -bottom-12 w-56 h-56 opacity-10" strokeWidth={1.2} />
            <div className="relative">
              <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <PulseDot />
                    <p className="text-xs font-medium text-white/85 uppercase tracking-wider">
                      Clientes
                    </p>
                  </div>
                  <p className="text-xs text-white/70">
                    Cadastro · histórico · documentos · financeiro
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => exportarDuplicatasMut.mutate()}
                    disabled={exportarDuplicatasMut.isPending}
                    className="text-white/85 hover:text-white hover:bg-white/15 border border-white/20 h-8 text-xs"
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    {exportarDuplicatasMut.isPending ? "Gerando..." : "Duplicatas (PDF)"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setShowNovo(true)}
                    className="bg-white text-slate-900 hover:bg-slate-100 font-semibold shadow-sm h-8"
                  >
                    <Plus className="h-4 w-4 mr-1" /> Novo cliente
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
                <div className="lg:col-span-6">
                  <p className="text-sm font-medium text-white/85 mb-1">Total de clientes</p>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                      {stats?.total ?? "—"}
                    </span>
                    {stats?.novosHoje ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-400/25 text-emerald-50 border border-emerald-300/30">
                        <Plus className="w-3 h-3" />
                        {stats.novosHoje} hoje
                      </span>
                    ) : null}
                  </div>
                  {stats && (
                    <p className="text-xs text-white/65 mt-2 tabular-nums">
                      <b className="text-white">{stats.comTelefone}</b> com telefone ·{" "}
                      <b className="text-white">{stats.comEmail}</b> com e-mail
                    </p>
                  )}
                </div>

                {/* Mini stats à direita */}
                <div className="lg:col-span-6">
                  <p className="text-[10px] text-white/65 uppercase tracking-wider mb-2">Atenção</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                      <p className="text-xs text-white/70 mb-1">Aguardando docs</p>
                      <p className="text-2xl font-bold tabular-nums leading-none text-amber-200">
                        {stats?.aguardandoDocumentacao ?? 0}
                      </p>
                    </div>
                    <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                      <p className="text-xs text-white/70 mb-1">Com débito</p>
                      <p className="text-2xl font-bold tabular-nums leading-none text-rose-200">
                        {clientesComDebito || "—"}
                      </p>
                    </div>
                    <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                      <p className="text-xs text-white/70 mb-1">Sem telefone</p>
                      <p className="text-2xl font-bold tabular-nums leading-none text-slate-200">
                        {stats ? stats.total - stats.comTelefone : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════ BUSCA + CHIPS ═══════════ */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[260px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Buscar por nome, telefone, e-mail ou CPF..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-10 h-10 bg-white"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <ChipSegmento ativo={segmento === "todos"} onClick={() => setSegmento("todos")}>
                Todos
                <CountPill ativo={segmento === "todos"}>{stats?.total ?? "—"}</CountPill>
              </ChipSegmento>
              {(stats?.aguardandoDocumentacao ?? 0) > 0 && (
                <ChipSegmento
                  ativo={segmento === "aguardando_docs"}
                  onClick={() => setSegmento("aguardando_docs")}
                  destaque="amber"
                >
                  ⚠ Aguardando docs
                  <CountPill ativo={segmento === "aguardando_docs"} tom="amber">
                    {stats?.aguardandoDocumentacao}
                  </CountPill>
                </ChipSegmento>
              )}
              {clientesComDebito > 0 && (
                <ChipSegmento
                  ativo={segmento === "com_debito"}
                  onClick={() => setSegmento("com_debito")}
                  destaque="rose"
                >
                  ⚠ Com débito
                  <CountPill ativo={segmento === "com_debito"} tom="rose">
                    {clientesComDebito}
                  </CountPill>
                </ChipSegmento>
              )}
              <ChipSegmento ativo={segmento === "vip"} onClick={() => setSegmento("vip")}>
                <Star className="h-3 w-3 text-amber-500" />
                VIP
              </ChipSegmento>
              <ChipSegmento ativo={segmento === "novos"} onClick={() => setSegmento("novos")}>
                Novos (7d)
              </ChipSegmento>
              <ChipSegmento ativo={segmento === "inativo"} onClick={() => setSegmento("inativo")}>
                Inativos (30d+)
              </ChipSegmento>
            </div>
          </div>

          {/* ═══════════ BULK ACTION BAR ═══════════ */}
          {selecionados.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900">
              <CheckSquare className="h-4 w-4" />
              <span className="text-sm font-semibold">
                {selecionados.size} cliente{selecionados.size !== 1 ? "s" : ""} selecionado{selecionados.size !== 1 ? "s" : ""}
              </span>
              <div className="flex-1" />
              <Button size="sm" variant="outline" className="bg-white hover:bg-indigo-100 border-indigo-200 h-8 text-xs" onClick={handleExport}>
                <Download className="h-3 w-3 mr-1" /> Exportar CSV
              </Button>
              {selecionadosComTelefone > 0 && (
                <Button size="sm" variant="outline" className="bg-white hover:bg-indigo-100 border-indigo-200 h-8 text-xs" onClick={handleBulkInbox}>
                  <MessageCircle className="h-3 w-3 mr-1 text-emerald-600" /> Inbox
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelecionados(new Set())}
                className="text-indigo-700 hover:text-indigo-900 hover:bg-indigo-100 h-8 text-xs"
              >
                Limpar
              </Button>
            </div>
          )}

          {/* ═══════════ LISTA ═══════════ */}
          {!clientesFiltrados.length ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Users className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {segmento !== "todos"
                    ? `Nenhum cliente neste filtro.`
                    : "Nenhum cliente encontrado."}
                </p>
                {segmento === "todos" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setShowNovo(true)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Cadastrar
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3 text-xs"
                    onClick={() => {
                      setBusca("");
                      setSegmento("todos");
                    }}
                  >
                    Limpar filtros
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-[24px_48px_1fr_180px_140px_100px_40px] gap-[14px] items-center px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                <Checkbox
                  checked={
                    selecionados.size > 0 &&
                    selecionados.size === clientesFiltrados.length
                  }
                  onCheckedChange={toggleTodos}
                />
                <div></div>
                <div>
                  Nome
                  <span className="text-slate-400 normal-case font-normal">
                    {" "}· {clientesFiltrados.length} cliente{clientesFiltrados.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="text-right">Financeiro</div>
                <div className="text-right">Última interação</div>
                <div className="text-right">Origem</div>
                <div></div>
              </div>

              {/* Rows */}
              {clientesFiltrados.map((c: any) => (
                <LinhaCliente
                  key={c.id}
                  cliente={c}
                  selecionado={selecionados.has(c.id)}
                  resumoFin={resumoFinanceiroBatch?.[c.id] ?? null}
                  podeExcluir={podeExcluirCliente}
                  onToggle={() => toggleSelecionado(c.id)}
                  onAbrir={() => setSelId(c.id)}
                  onExcluir={() => setExcluirAlvo({ id: c.id, nome: c.nome })}
                />
              ))}

              {/* Paginação */}
              {totalPaginas > 1 && (
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <span>
                    Mostrando <b>{clientesFiltrados.length}</b> de{" "}
                    <b>{stats?.total ?? "—"}</b> clientes
                  </span>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={pagina <= 1}
                      onClick={() => setPagina((p) => p - 1)}
                    >
                      ‹
                    </Button>
                    <span className="px-2.5 py-1 rounded bg-slate-900 text-white text-xs flex items-center">
                      {pagina}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={pagina >= totalPaginas}
                      onClick={() => setPagina((p) => p + 1)}
                    >
                      ›
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
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

// ─── Sub-componentes da lista ────────────────────────────────────────────────

function ChipSegmento({
  ativo,
  onClick,
  children,
  destaque,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  destaque?: "amber" | "rose";
}) {
  const base =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all";
  if (ativo) {
    return (
      <button onClick={onClick} className={`${base} bg-slate-900 text-white border-slate-900`}>
        {children}
      </button>
    );
  }
  if (destaque === "amber") {
    return (
      <button
        onClick={onClick}
        className={`${base} bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100`}
      >
        {children}
      </button>
    );
  }
  if (destaque === "rose") {
    return (
      <button
        onClick={onClick}
        className={`${base} bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100`}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`${base} bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900`}
    >
      {children}
    </button>
  );
}

function CountPill({
  children,
  ativo,
  tom,
}: {
  children: React.ReactNode;
  ativo: boolean;
  tom?: "amber" | "rose";
}) {
  if (ativo)
    return <span className="bg-white/20 px-1.5 rounded-full text-[10px] tabular-nums">{children}</span>;
  if (tom === "amber")
    return (
      <span className="bg-amber-100 text-amber-700 px-1.5 rounded-full text-[10px] tabular-nums">
        {children}
      </span>
    );
  if (tom === "rose")
    return (
      <span className="bg-rose-100 text-rose-700 px-1.5 rounded-full text-[10px] tabular-nums">
        {children}
      </span>
    );
  return (
    <span className="bg-slate-100 text-slate-600 px-1.5 rounded-full text-[10px] tabular-nums">
      {children}
    </span>
  );
}

function LinhaCliente({
  cliente: c,
  selecionado,
  resumoFin,
  podeExcluir,
  onToggle,
  onAbrir,
  onExcluir,
}: {
  cliente: any;
  selecionado: boolean;
  resumoFin: any;
  podeExcluir: boolean;
  onToggle: () => void;
  onAbrir: () => void;
  onExcluir: () => void;
}) {
  const isVip = (c.tags || "").toLowerCase().includes("vip");
  const inativoDias = diasInativo(c);
  const vencido = Number(resumoFin?.vencido ?? 0);
  const recebido = Number(resumoFin?.recebido ?? 0);
  const pendente = Number(resumoFin?.pendente ?? 0);

  return (
    <div
      className="grid grid-cols-[24px_48px_1fr_180px_140px_100px_40px] gap-[14px] items-center px-4 py-3 border-t border-slate-100 hover:bg-slate-50/70 cursor-pointer transition-colors group"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-stop-row-click]")) return;
        onAbrir();
      }}
    >
      <div data-stop-row-click onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selecionado} onCheckedChange={onToggle} />
      </div>
      <div
        className={`w-10 h-10 rounded-full bg-gradient-to-br ${gradientAvatar(c.nome || "?")} text-white flex items-center justify-center font-semibold text-[13px] tracking-tight shadow-sm`}
      >
        {gerarIniciais(c.nome || "?")}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <p className={`text-sm font-semibold truncate ${inativoDias != null ? "text-slate-600" : ""}`}>
            {c.nome}
          </p>
          {isVip && <Star className="h-3.5 w-3.5 text-amber-500 shrink-0 fill-amber-500" />}
          {c.documentacaoPendente && (
            <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
              ⚠ Aguardando docs
            </span>
          )}
          {vencido > 0 && (
            <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 tabular-nums">
              ⚠ {fmtBRLShort(vencido)} vencido
            </span>
          )}
          {inativoDias != null && (
            <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
              Inativo {inativoDias}d
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
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
          {!c.telefone && !c.email && c.cpfCnpj && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" /> {c.cpfCnpj}
            </span>
          )}
        </div>
      </div>

      {/* Financeiro com cor semântica */}
      <div className="text-right">
        {vencido > 0 ? (
          <>
            <p className="text-sm font-semibold text-rose-600 tabular-nums">{fmtBRLShort(vencido)}</p>
            <p className="text-[10px] text-rose-500">vencido</p>
          </>
        ) : pendente > 0 ? (
          <>
            <p className="text-sm font-semibold text-amber-600 tabular-nums">{fmtBRLShort(pendente)}</p>
            <p className="text-[10px] text-amber-500">pendente</p>
          </>
        ) : recebido > 0 ? (
          <>
            <p className="text-sm font-semibold text-emerald-600 tabular-nums">{fmtBRLShort(recebido)}</p>
            <p className="text-[10px] text-muted-foreground">recebido</p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-400">—</p>
            <p className="text-[10px] text-slate-400">sem cobrança</p>
          </>
        )}
      </div>

      <div className="text-right text-xs">
        <p className="text-slate-700">{timeAgo(c.ultimaConversaAt || c.createdAt)}</p>
        <p className="text-[10px] text-slate-400">
          {c.ultimaConversaAt ? "conversa" : "cadastro"}
        </p>
      </div>

      <div className="text-right">
        <Badge variant="outline" className="text-[10px] font-normal">{c.origem}</Badge>
      </div>

      {/* Menu de ações no hover */}
      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Ver/Editar cliente"
          onClick={(e) => {
            e.stopPropagation();
            onAbrir();
          }}
        >
          <PenLine className="h-3.5 w-3.5" />
        </Button>
        {podeExcluir && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-rose-50 hover:text-rose-600"
            title="Excluir"
            onClick={(e) => {
              e.stopPropagation();
              onExcluir();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function fmtBRLShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
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
        <Dialog open={criarOpen} onOpenChange={(o) => {
          setCriarOpen(o);
          if (!o) {
            // Reset form ao fechar — sem isso, reabrir mostrava
            // titulo/funil/coluna da tentativa anterior.
            setTitulo("");
            setFunilSelecionado("");
            setColunaSelecionada("");
          }
        }}>
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

function FinanceiroClienteTab({
  contatoId,
  contatoNome,
}: {
  contatoId: number;
  contatoNome: string;
}) {
  const { data, isLoading, refetch } = (trpc as any).asaas.listarCobrancas.useQuery({
    contatoId,
    limit: 100,
  });
  const items: any[] = data?.items || [];
  const [vincularBenefOpen, setVincularBenefOpen] = useState(false);
  const utils = trpc.useUtils();

  const desvincularBenefMut = (trpc as any).asaas.desvincularPagamentoBeneficiario.useMutation({
    onSuccess: () => {
      toast.success("Vínculo de beneficiário removido", {
        description: "A cobrança voltou a contar para o contato pagador original.",
      });
      refetch();
      utils.asaas.resumoContato.invalidate();
      utils.asaas.resumoPorContatos.invalidate();
      utils.asaas.kpis.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

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
      <>
        <Card>
          <CardContent className="py-12 text-center">
            <DollarSign className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">Nenhuma cobrança vinculada</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Cobranças deste cliente no Asaas aparecerão aqui automaticamente.
              Se ele pagou no nome de outra pessoa, use o botão abaixo pra
              vincular sem precisar lançar manual.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={() => setVincularBenefOpen(true)}
            >
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
              Vincular pagamento de terceiro
            </Button>
          </CardContent>
        </Card>
        <VincularBeneficiarioDialog
          open={vincularBenefOpen}
          onOpenChange={setVincularBenefOpen}
          contatoBeneficiarioId={contatoId}
          contatoBeneficiarioNome={contatoNome}
          onSuccess={refetch}
        />
      </>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header com ação "Vincular pagamento de terceiro" */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium">Cobranças deste cliente</p>
          <p className="text-[10px] text-muted-foreground">
            Inclui pagamentos no nome de terceiros vinculados a este cliente.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setVincularBenefOpen(true)}
          title="Caso o cliente pagou no Asaas no nome de outra pessoa (esposa, sócio...) e você quer atribuir ao caixa deste cliente sem duplicar"
        >
          <Link2 className="h-3.5 w-3.5 mr-1.5" />
          Vincular pagamento de terceiro
        </Button>
      </div>

      <VincularBeneficiarioDialog
        open={vincularBenefOpen}
        onOpenChange={setVincularBenefOpen}
        contatoBeneficiarioId={contatoId}
        contatoBeneficiarioNome={contatoNome}
        onSuccess={refetch}
      />

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
                      {/* Indicador de beneficiário lógico:
                          - Vendo do Carlos: cobrança veio do CPF da esposa → "Pago por terceiro"
                          - Vendo da esposa: cobrança foi atribuída ao Carlos → "Atribuída a outro" */}
                      {c.contatoBeneficiarioId === contatoId && c.contatoId !== contatoId && (
                        <Badge
                          variant="outline"
                          className="text-[9px] h-4 px-1 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800"
                          title="Esta cobrança foi paga no nome de outra pessoa e vinculada como pagamento deste cliente"
                        >
                          pago por terceiro
                        </Badge>
                      )}
                      {c.contatoBeneficiarioId !== null && c.contatoBeneficiarioId !== contatoId && (
                        <Badge
                          variant="outline"
                          className="text-[9px] h-4 px-1 bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800"
                          title="Esta cobrança foi atribuída a outro cliente (beneficiário lógico) — não conta no caixa deste contato"
                        >
                          atribuída a outro
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
                          {/* Desvincular beneficiário: só aparece quando há vínculo lógico.
                              Reverte pra cobrança contar pro contato pagador original. */}
                          {c.contatoBeneficiarioId !== null && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide">
                                Beneficiário
                              </DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() =>
                                  desvincularBenefMut.mutate({ cobrancaId: c.id })
                                }
                                disabled={desvincularBenefMut.isPending}
                                className="gap-2"
                                title="Desfaz o vínculo: cobrança volta a contar pro pagador original"
                              >
                                <X className="h-3.5 w-3.5" />
                                Desvincular pagamento de terceiro
                              </DropdownMenuItem>
                            </>
                          )}
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

  const utilsTrpc = trpc.useUtils();
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
      // Invalida o detalhe do cliente — ele exibe contagem de processos
      // no header. Sem isso, o número ficava stale até F5.
      utilsTrpc.clientes.detalhe.invalidate({ id: contatoId });
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });
  const atualizarProcessoMut = (trpc as any).clienteProcessos.atualizar.useMutation({
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });
  const desvincularMut = (trpc as any).clienteProcessos.desvincular.useMutation({
    onSuccess: () => {
      toast.success("Processo desvinculado");
      refetch();
      // Mesma invalidação do vincular — contagem no header refresca.
      utilsTrpc.clientes.detalhe.invalidate({ id: contatoId });
    },
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
      <Dialog open={novoOpen} onOpenChange={(o) => {
        setNovoOpen(o);
        if (!o) {
          // Reset form ao fechar (Cancel, Esc, click-outside). Sem isso,
          // reabrir o dialog mostrava o CNJ/apelido/polo da tentativa
          // anterior — fluxo "ah me enganei, vou cadastrar outro" virava
          // bagunça.
          setNovoCnj("");
          setNovoApelido("");
          setNovoPolo("");
          setNovoModo("judicial");
          setNovoMonitorar(false);
        }
      }}>
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

// ─── Editar Lead (valor / etapa / excluir) ──────────────────────────────────
// Cobre o caso "errei o valor do lançamento" + "esse lead nem deveria existir".
// Backend: crm.atualizarLead (já existia) + crm.excluirLead.
// Etapas do funil são as mesmas do schema (drizzle enum) — labels traduzidas
// pra português aqui pra UX.
const LEAD_ETAPAS = [
  { value: "novo", label: "Novo" },
  { value: "qualificado", label: "Qualificado" },
  { value: "proposta", label: "Proposta" },
  { value: "negociacao", label: "Negociação" },
  { value: "fechado_ganho", label: "Fechado (ganho)" },
  { value: "fechado_perdido", label: "Fechado (perdido)" },
] as const;

function EditarLeadDialog({
  lead,
  open,
  onOpenChange,
  onUpdated,
}: {
  lead: { id: number; etapaFunil: string; valorEstimado: string | null; origemLead?: string | null };
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpdated: () => void;
}) {
  // Estado local — só inicializa quando o dialog abre (key dispara remount).
  const [etapa, setEtapa] = useState(lead.etapaFunil);
  const [valor, setValor] = useState(lead.valorEstimado || "");
  const [origem, setOrigem] = useState<string>(lead.origemLead || "");
  const [confirmExcluir, setConfirmExcluir] = useState(false);

  // Carrega origens cadastradas no escritório — mesma fonte do
  // RegistrarFechamentoDialog. Inclui inativas pra preservar o valor
  // atual do lead caso a origem tenha sido desativada (senão o select
  // limparia silenciosamente).
  const { data: origensDisponiveis } = (trpc as any).origensLead?.listar?.useQuery?.(
    { incluirInativas: true },
    { retry: false },
  ) ?? { data: [] };

  const atualizarMut = (trpc as any).crm.atualizarLead.useMutation({
    onSuccess: () => {
      toast.success("Lead atualizado");
      onOpenChange(false);
      onUpdated();
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao atualizar"),
  });
  const excluirMut = (trpc as any).crm.excluirLead.useMutation({
    onSuccess: () => {
      toast.success("Lead excluído");
      setConfirmExcluir(false);
      onOpenChange(false);
      onUpdated();
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao excluir"),
  });

  const valorNormalizado = valor.trim() ? parseValorBR(valor) : null;
  const valorMudou = (lead.valorEstimado || "") !== valor;
  const etapaMudou = lead.etapaFunil !== etapa;
  const origemAtual = lead.origemLead || "";
  const origemMudou = origemAtual !== origem;
  const algoMudou = valorMudou || etapaMudou || origemMudou;

  // Se a origem atual não está na lista (foi desativada ou texto livre
  // legado), mostra mesmo assim pra não sumir do select silenciosamente.
  const origensLista: { id: number | string; nome: string; ativo?: boolean }[] = origensDisponiveis ?? [];
  const origemAtualAusente = origemAtual && !origensLista.some((o) => o.nome === origemAtual);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar negociação</DialogTitle>
            <DialogDescription>
              Ajuste valor ou etapa. Para fechamentos retroativos que não
              deveriam existir, use Excluir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Etapa do funil</Label>
              <select
                value={etapa}
                onChange={(e) => setEtapa(e.target.value)}
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                disabled={atualizarMut.isPending}
              >
                {LEAD_ETAPAS.map((e) => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Valor (R$)</Label>
              <Input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                disabled={atualizarMut.isPending}
              />
              {valor.trim() && valorNormalizado != null && (
                <p className="text-[10px] text-muted-foreground">
                  Será gravado como{" "}
                  <span className="font-mono">
                    {new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(valorNormalizado)}
                  </span>
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Origem</Label>
              <select
                value={origem}
                onChange={(e) => setOrigem(e.target.value)}
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                disabled={atualizarMut.isPending}
              >
                <option value="">— Sem origem —</option>
                {origemAtualAusente && (
                  <option value={origemAtual}>{origemAtual} (desativada)</option>
                )}
                {origensLista.map((o) => (
                  <option key={String(o.id)} value={o.nome}>
                    {o.nome}{o.ativo === false ? " (inativa)" : ""}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                Gerencie as opções em Configurações → Origens de lead.
              </p>
            </div>
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 sm:mr-auto"
              onClick={() => setConfirmExcluir(true)}
              disabled={atualizarMut.isPending || excluirMut.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Excluir
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={atualizarMut.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                // Normaliza valor BR antes de enviar pro backend (que armazena
                // como string formato US "1500.00" pra somar via CAST DECIMAL).
                const valorParaSalvar =
                  valor.trim() === ""
                    ? undefined // backend ignora quando undefined; pra "limpar" valor seria preciso flag separada
                    : valorNormalizado != null
                      ? valorNormalizado.toFixed(2)
                      : undefined;
                atualizarMut.mutate({
                  id: lead.id,
                  etapaFunil: etapaMudou ? etapa : undefined,
                  valorEstimado: valorMudou ? valorParaSalvar : undefined,
                  // null limpa a origem; string seta. Só envia se mudou.
                  origemLead: origemMudou ? (origem.trim() ? origem.trim() : null) : undefined,
                });
              }}
              disabled={!algoMudou || atualizarMut.isPending}
            >
              {atualizarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmExcluir} onOpenChange={setConfirmExcluir}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta negociação?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead será apagado permanentemente. Se o lead estava em
              <strong> fechado_ganho</strong>, a conversão some do Relatório
              Comercial. Use quando o lançamento foi um engano.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => excluirMut.mutate({ id: lead.id })}
              disabled={excluirMut.isPending}
            >
              {excluirMut.isPending ? "Excluindo..." : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  const [mesclarOpen, setMesclarOpen] = useState(false);
  const mesclarMut = trpc.crm.unificarContatos.useMutation({
    onSuccess: () => {
      toast.success("Clientes mesclados", {
        description: "Cobranças, conversas e processos foram transferidos.",
      });
      setMesclarOpen(false);
      onVoltar();
      onUpdate();
    },
    onError: (err: any) =>
      toast.error("Erro ao mesclar", { description: err.message }),
  });
  // Editor de lead na aba Histórico — abre quando user clica no lápis do card.
  // null = fechado. Quando o lead muda (mutation), o key={alvo.id} no Dialog
  // garante remount com valores frescos.
  const [editarLeadAlvo, setEditarLeadAlvo] = useState<any | null>(null);

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

      {/* Botão "Voltar" externo ao hero pra ficar discreto */}
      <button
        onClick={onVoltar}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Voltar para lista
      </button>

      {/* ═══════════ HERO DO CLIENTE ═══════════ */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-700 via-purple-700 to-indigo-800 p-7 text-white relative overflow-hidden shadow-lg">
        <Users className="absolute -right-10 -bottom-12 w-56 h-56 opacity-10" strokeWidth={1.2} />
        <div className="relative">
          <div className="flex items-start gap-5 mb-5 flex-wrap">
            {/* Avatar grande */}
            <div
              className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${gradientAvatar(cliente.nome || "?")} text-white flex items-center justify-center text-2xl font-bold shrink-0 shadow-lg ring-4 ring-white/20 tracking-tight`}
            >
              {gerarIniciais(cliente.nome || "?")}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <h2 className="text-2xl font-bold tracking-tight">{cliente.nome}</h2>
                {isVip && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-400/25 text-amber-50 border border-amber-300/30">
                    <Star className="w-3 h-3 fill-current" /> VIP
                  </span>
                )}
                {cliente.documentacaoPendente && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-400/25 text-amber-50 border border-amber-300/30">
                    <AlertTriangle className="w-3 h-3" /> Docs pendentes
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-white/75 flex-wrap">
                {cliente.telefone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" />
                    {cliente.telefone}
                  </span>
                )}
                {(cliente as any).telefonesSecundarios?.length > 0 && (
                  <span className="text-white/60">
                    +{(cliente as any).telefonesSecundarios.length} tel
                  </span>
                )}
                {cliente.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />
                    {cliente.email}
                  </span>
                )}
                {cliente.cpfCnpj && (
                  <span className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    {cliente.cpfCnpj}
                  </span>
                )}
                {(cliente as any).cidade && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {(cliente as any).cidade}
                    {(cliente as any).uf ? `, ${(cliente as any).uf}` : ""}
                  </span>
                )}
              </div>
            </div>

            {/* Ações */}
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
              {cliente.telefone && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocation(`/atendimento?contatoId=${id}`)}
                  className="text-white/85 hover:text-white hover:bg-white/15 border border-white/20 h-8 text-xs"
                >
                  <MessageCircle className="w-3.5 h-3.5 mr-1" />
                  Inbox
                </Button>
              )}
              {cliente.cpfCnpj && (
                <MonitorarProcessosButton
                  cpfCnpj={cliente.cpfCnpj}
                  nome={cliente.nome || cliente.cpfCnpj}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setGerarContratoOpen(true)}
                className="text-white/85 hover:text-white hover:bg-white/15 border border-white/20 h-8 text-xs"
              >
                <FileText className="w-3.5 h-3.5 mr-1" />
                Gerar contrato
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFechamentoOpen(true)}
                title="Marca conversão (fechado_ganho)"
                className="text-white/85 hover:text-white hover:bg-white/15 border border-white/20 h-8 text-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                Fechamento
              </Button>
              {podeExcluirCliente && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-violet-200 hover:text-white hover:bg-violet-500/30 border border-white/20 h-8 text-xs"
                  onClick={() => setMesclarOpen(true)}
                  title="Mesclar com outro cliente (caso de pagador secundário, ex: esposa)"
                >
                  <UserPlus className="w-3.5 h-3.5 mr-1" />
                  Mesclar
                </Button>
              )}
              {podeExcluirCliente && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose-200 hover:text-white hover:bg-rose-500/30 border border-white/20 h-8 w-8 p-0"
                  onClick={() => setExcluirConfirmAlvo(true)}
                  title="Excluir cliente"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Mini KPIs do cliente */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KPIClienteHero
              label="Recebido"
              value={fmtBRLShort(Number((cliente as any).asaasResumo?.recebido ?? 0))}
              tone="emerald"
            />
            <KPIClienteHero
              label="A receber"
              value={fmtBRLShort(Number((cliente as any).asaasResumo?.pendente ?? 0))}
              tone={Number((cliente as any).asaasResumo?.pendente ?? 0) > 0 ? "amber" : "neutral"}
            />
            <KPIClienteHero
              label="Vencido"
              value={fmtBRLShort(Number((cliente as any).asaasResumo?.vencido ?? 0))}
              tone={Number((cliente as any).asaasResumo?.vencido ?? 0) > 0 ? "rose" : "neutral"}
            />
            <KPIClienteHero
              label="Cadastrado em"
              value={fmtData(cliente.createdAt as any) || "—"}
              tone="neutral"
              small
            />
          </div>

          {/* Botão financeiro popover (mantém pra manter UX existente) */}
          <div className="mt-3 flex justify-end">
            <FinanceiroPopover contatoId={id} />
          </div>
        </div>
      </div>

      <MesclarClienteDialog
        open={mesclarOpen}
        onOpenChange={setMesclarOpen}
        clienteAtual={cliente}
        onConfirmar={(principalId) =>
          mesclarMut.mutate({ principalId, duplicadoId: id })
        }
        isPending={mesclarMut.isPending}
      />

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

      {/* 6 abas consolidadas — pill style igual Dashboard */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="bg-slate-50/80 backdrop-blur-sm border border-slate-200 rounded-xl p-1.5 inline-flex">
          <TabsList className="bg-transparent gap-1 p-0 h-auto">
            <TabsTrigger
              value="visao-geral"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <User className="h-3.5 w-3.5" /> Visão Geral
            </TabsTrigger>
            <TabsTrigger
              value="processos"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <Scale className="h-3.5 w-3.5" /> Processos
            </TabsTrigger>
            <TabsTrigger
              value="kanban"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <Trello className="h-3.5 w-3.5" /> Kanban
            </TabsTrigger>
            <TabsTrigger
              value="financeiro"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <DollarSign className="h-3.5 w-3.5" /> Financeiro
            </TabsTrigger>
            <TabsTrigger
              value="historico"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <MessageCircle className="h-3.5 w-3.5" /> Histórico
            </TabsTrigger>
            <TabsTrigger
              value="documentos"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <FileText className="h-3.5 w-3.5" /> Documentos
            </TabsTrigger>
          </TabsList>
        </div>

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
          <FinanceiroClienteTab key={id} contatoId={id} contatoNome={cliente.nome} />
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
                      className="flex items-center gap-3 px-3 py-2 rounded-lg border group"
                    >
                      <TrendingUp className="h-4 w-4 text-violet-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">
                          {LEAD_ETAPAS.find((e) => e.value === l.etapaFunil)?.label || l.etapaFunil}
                          {l.origemLead && (
                            <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                              · {l.origemLead}
                            </span>
                          )}
                        </p>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Editar negociação"
                        onClick={() => setEditarLeadAlvo(l)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
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

      {editarLeadAlvo && (
        <EditarLeadDialog
          key={editarLeadAlvo.id}
          lead={editarLeadAlvo}
          open={!!editarLeadAlvo}
          onOpenChange={(o) => { if (!o) setEditarLeadAlvo(null); }}
          onUpdated={() => {
            refetchLeads();
            // detalhe.totalLeads no header também pode mudar (após excluir)
            utilsTrpc.clientes.detalhe.invalidate({ id });
          }}
        />
      )}

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

// ─── Mini-KPI pro hero do detalhe do cliente ────────────────────────────────

function KPIClienteHero({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "rose" | "neutral";
  small?: boolean;
}) {
  const numColor =
    tone === "emerald"
      ? "text-emerald-200"
      : tone === "amber"
        ? "text-amber-200"
        : tone === "rose"
          ? "text-rose-200"
          : "text-white";
  return (
    <div className="bg-white/10 rounded-lg px-3 py-2.5 border border-white/15">
      <p className="text-[10px] text-white/65 uppercase tracking-wider mb-1">{label}</p>
      <p
        className={`${small ? "text-sm" : "text-xl"} font-bold tabular-nums leading-none ${numColor}`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Dialog "Mesclar com outro cliente". Caso clássico: a esposa do Carlos
 * pagou as cobranças e o webhook criou contato pra ela; queremos transferir
 * tudo pro Carlos e remover o contato espúrio.
 *
 * Operação destrutiva — usa AlertDialog com confirmação forte. `unificarContatos`
 * migra cobranças, asaas_clientes, conversas, leads, processos, tarefas,
 * anotações, arquivos, assinaturas e smartflow. Telefones/emails/CPF
 * complementares do duplicado também são copiados pro principal.
 *
 * NOTA: hard delete do contato duplicado é definitivo. Pra suportar
 * rollback no futuro, precisaria de migration adicionando `ativo` em
 * `contatos` e filtro nas queries (não está no escopo deste PR).
 */
function MesclarClienteDialog({
  open,
  onOpenChange,
  clienteAtual,
  onConfirmar,
  isPending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clienteAtual: { id: number; nome: string };
  onConfirmar: (principalId: number) => void;
  isPending: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<{ id: number; nome: string } | null>(
    null,
  );
  const [confirmacao, setConfirmacao] = useState(false);
  const { data: contatos = [] } = (trpc as any).crm?.listarContatos?.useQuery?.(
    { busca: busca || undefined },
    { staleTime: 30_000, enabled: open },
  ) ?? { data: [] };

  const candidatos = (contatos as any[]).filter((c) => c.id !== clienteAtual.id);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-violet-600" />
            Mesclar com outro cliente
          </AlertDialogTitle>
          <AlertDialogDescription>
            Vai mover <b>todas</b> as cobranças, conversas, processos e
            histórico de <b>{clienteAtual.nome}</b> pro cliente selecionado.
            Depois,&nbsp;<b className="text-rose-600">{clienteAtual.nome}</b>
            &nbsp;será <b>excluído</b> deste CRM (operação definitiva).
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!confirmacao ? (
          <div className="space-y-3 py-2">
            <Label className="text-xs">Cliente principal (vai receber os dados)</Label>
            <Input
              placeholder="Buscar por nome ou CPF..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="h-9"
            />
            <div className="max-h-56 overflow-y-auto border rounded">
              {candidatos.length === 0 && busca.length > 0 && (
                <div className="p-3 text-xs text-muted-foreground text-center">
                  Nenhum cliente encontrado
                </div>
              )}
              {candidatos.slice(0, 20).map((c: any) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => setSelecionado({ id: c.id, nome: c.nome })}
                  className={
                    "w-full text-left p-2 text-xs hover:bg-accent border-b last:border-b-0 " +
                    (selecionado?.id === c.id ? "bg-violet-50" : "")
                  }
                >
                  <div className="font-medium">{c.nome}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {c.cpfCnpj || c.telefone || "sem CPF/telefone"}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border-2 border-rose-300 bg-rose-50 p-3 text-xs space-y-2">
            <p className="font-semibold text-rose-900 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              Confirmação final
            </p>
            <p className="text-rose-800">
              Vai mover dados de <b>{clienteAtual.nome}</b> pra{" "}
              <b>{selecionado?.nome}</b> e <b>excluir</b>{" "}
              <b>{clienteAtual.nome}</b> deste CRM. Não há como desfazer.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          {!confirmacao ? (
            <Button
              variant="default"
              disabled={!selecionado}
              onClick={() => setConfirmacao(true)}
            >
              Continuar
            </Button>
          ) : (
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              disabled={isPending || !selecionado}
              onClick={(e) => {
                e.preventDefault();
                if (selecionado) onConfirmar(selecionado.id);
              }}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              Confirmar mesclagem
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

