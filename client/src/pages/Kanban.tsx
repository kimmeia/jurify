/**
 * Kanban — Gestão visual de processos em produção.
 * Funis customizáveis com colunas e cards arrastáveis.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  LayoutGrid, Plus, Trash2, Loader2, GripVertical, Calendar,
  User, AlertTriangle, Clock, ChevronLeft, Edit, Scale,
  ExternalLink, ArrowRight, Tag, X, Settings, Upload, CheckCircle2,
  Archive, Search, Briefcase, MessageSquare, Paperclip, AlertCircle,
  Wallet,
} from "lucide-react";
import { PulseDot, gradientAvatar, gerarIniciais } from "./dashboards/common";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ResponsavelAvatar } from "./kanban/responsavel-avatar";
import { LancarCobrancaCardModal, type LancarCobrancaCardCtx } from "./kanban/lancar-cobranca-modal";
import { ComentariosSection } from "./kanban/comentarios-section";
import { FiltrosBar, type FiltrosKanban, FILTROS_VAZIOS } from "./kanban/filtros-bar";
import { ImportarTrelloDialog } from "./kanban/ImportarTrelloDialog";
import { TimelineCard } from "./kanban/timeline-card";

const PRIORIDADE_COR: Record<string, string> = {
  alta: "border-l-red-500 bg-red-50/30",
  media: "border-l-amber-500 bg-amber-50/20",
  baixa: "border-l-blue-500 bg-blue-50/20",
};
const PRIORIDADE_LABEL: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

export default function Kanban() {
  const [, setLocation] = useLocation();
  const [funilAtivo, setFunilAtivo] = useState<number | null>(null);
  const [novoFunilOpen, setNovoFunilOpen] = useState(false);
  const [importTrelloOpen, setImportTrelloOpen] = useState(false);
  // Modo compacto (cards menores) — salvo em localStorage por usuário.
  const [modoCompacto, setModoCompactoRaw] = useState<boolean>(() => {
    try { return localStorage.getItem("kanban:modoCompacto") === "1"; } catch { return false; }
  });
  const setModoCompacto = (v: boolean) => {
    setModoCompactoRaw(v);
    try { localStorage.setItem("kanban:modoCompacto", v ? "1" : "0"); } catch { /* localStorage indisponível, ignora */ }
  };
  const [mostrarArquivados, setMostrarArquivados] = useState(false);
  // Busca textual client-side. Filtra por título, nome do cliente OU tags
  // (case-insensitive). Tudo já vem enriquecido em obterFunil, então é
  // instantâneo sem precisar mexer no backend.
  const [buscaTexto, setBuscaTexto] = useState("");
  // Default: cada coluna mostra 5 cards. Usuário expande pra ver todos.
  const CARDS_INICIAIS = 5;
  const [colunasExpandidas, setColunasExpandidas] = useState<Set<number>>(new Set());
  const toggleExpandirColuna = (id: number) =>
    setColunasExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [cardAberto, setCardAberto] = useState<number | null>(null);
  const [novaTagOpen, setNovaTagOpen] = useState(false);
  const [novaTagNome, setNovaTagNome] = useState("");
  const [novaTagCor, setNovaTagCor] = useState("#6366f1");
  const [novoFunilNome, setNovoFunilNome] = useState("");
  const [novoCardOpen, setNovoCardOpen] = useState<number | null>(null); // colunaId
  const [novaColunaOpen, setNovaColunaOpen] = useState(false);
  const [novaColunaNome, setNovaColunaNome] = useState("");
  const [cardForm, setCardForm] = useState({ titulo: "", descricao: "", cnj: "", prioridade: "media", prazo: "", tags: "", urgente: false, responsavelId: "", valorEstimado: "" });
  const [buscaCliente, setBuscaCliente] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState<any>(null);

  const { data: equipeData } = (trpc as any).configuracoes.listarColaboradores.useQuery();
  const colaboradoresAtivos = (equipeData && "colaboradores" in equipeData ? equipeData.colaboradores : []).filter((c: any) => c.ativo);

  // Drag state — declarado antes das queries pra pausar polling durante drag
  // (evita race entre HTML5 DnD nativo e reconciliador do React, que
  // causava NotFoundError "insertBefore" em boards grandes).
  const [dragCardId, setDragCardId] = useState<number | null>(null);
  const [dragColunaId, setDragColunaId] = useState<number | null>(null);
  // Card sobre o qual o usuário está pairando o drag (pra mostrar indicador).
  const [dragOverCardId, setDragOverCardId] = useState<number | null>(null);

  const { data: funis, refetch: refetchFunis } = (trpc as any).kanban.listarFunis.useQuery();
  const [filtros, setFiltros] = useState<FiltrosKanban>(FILTROS_VAZIOS);
  const { data: funilData, refetch: refetchFunil } = (trpc as any).kanban.obterFunil.useQuery(
    { funilId: funilAtivo!, ...filtros, mostrarArquivados },
    {
      enabled: !!funilAtivo,
      // Polling 5s pra refletir movimentações de outros usuários em
      // quase-tempo-real. PAUSADO durante drag pra evitar refetch que
      // remonta DOM no meio do drag-and-drop (bug "insertBefore").
      refetchInterval: dragCardId || dragColunaId ? false : 5_000,
      refetchOnWindowFocus: !dragCardId && !dragColunaId,
    },
  );

  // Tags
  const { data: tags, refetch: refetchTags } = (trpc as any).kanban.listarTags.useQuery();
  const criarTagMut = (trpc as any).kanban.criarTag.useMutation({
    onSuccess: () => { toast.success("Tag criada!"); setNovaTagOpen(false); setNovaTagNome(""); refetchTags(); },
    onError: (e: any) => toast.error(e.message),
  });
  const deletarTagMut = (trpc as any).kanban.deletarTag.useMutation({
    onSuccess: () => refetchTags(),
  });

  // Detalhe card — polling 10s pra ver edições/comentários/movimentações
  // feitas por outros usuários enquanto o modal está aberto.
  const { data: cardDetalhe, refetch: refetchDetalhe } = (trpc as any).kanban.detalheCard.useQuery(
    { id: cardAberto! },
    {
      enabled: !!cardAberto,
      // Pausa polling durante drag pra evitar race com reconciliador React.
      refetchInterval: dragCardId || dragColunaId ? false : 10_000,
      refetchOnWindowFocus: !dragCardId && !dragColunaId,
    },
  );

  const criarFunilMut = (trpc as any).kanban.criarFunil.useMutation({
    onSuccess: (d: any) => { toast.success("Funil criado!"); setNovoFunilOpen(false); setNovoFunilNome(""); refetchFunis(); setFunilAtivo(d.id); },
    onError: (e: any) => toast.error(e.message),
  });
  const deletarFunilMut = (trpc as any).kanban.deletarFunil.useMutation({
    onSuccess: () => { toast.success("Funil removido"); setFunilAtivo(null); refetchFunis(); },
    onError: (e: any) => toast.error(e.message),
  });
  const criarColunaMut = (trpc as any).kanban.criarColuna.useMutation({
    onSuccess: () => { toast.success("Coluna criada!"); setNovaColunaOpen(false); setNovaColunaNome(""); refetchFunil(); },
    onError: (e: any) => toast.error(e.message),
  });
  const deletarColunaMut = (trpc as any).kanban.deletarColuna.useMutation({
    onSuccess: () => { refetchFunil(); },
    onError: (e: any) => toast.error(e.message),
  });
  const editarColunaMut = (trpc as any).kanban.editarColuna.useMutation({
    onSuccess: () => refetchFunil(),
  });
  const criarCardMut = (trpc as any).kanban.criarCard.useMutation({
    onSuccess: () => { toast.success("Card criado!"); setNovoCardOpen(null); setCardForm({ titulo: "", descricao: "", cnj: "", prioridade: "media", prazo: "", tags: "", urgente: false, responsavelId: "", valorEstimado: "" }); setClienteSelecionado(null); setBuscaCliente(""); refetchFunil(); },
    onError: (e: any) => toast.error(e.message),
  });
  const arquivarLoteMut = (trpc as any).kanban.arquivarCardsEmMassa.useMutation({
    onSuccess: (r: { arquivados: number }) => {
      toast.success(`${r.arquivados} card(s) arquivado(s)`);
      refetchFunil();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const arquivarCardMut = (trpc as any).kanban.arquivarCard.useMutation({
    onSuccess: () => {
      toast.success("Card arquivado");
      refetchFunil();
      refetchDetalhe();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const desarquivarCardMut = (trpc as any).kanban.desarquivarCard.useMutation({
    onSuccess: () => {
      toast.success("Card desarquivado");
      refetchFunil();
      refetchDetalhe();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const deletarCardMut = (trpc as any).kanban.deletarCard.useMutation({
    onSuccess: () => refetchFunil(),
    onError: (e: any) => toast.error(e.message),
  });
  const utilsTrpc = (trpc as any).useUtils?.() ?? (trpc as any).useContext?.();
  const moverCardMut = (trpc as any).kanban.moverCard.useMutation({
    // Optimistic update: move o card no cache LOCAL antes do server responder.
    // Sensação instantânea no drag-and-drop. Sem isso, board de 1k cards
    // tinha delay perceptível (refetch completo da query a cada drop).
    onMutate: async (vars: { cardId: number; colunaDestinoId: number; ordem?: number }) => {
      if (!funilAtivo || !utilsTrpc?.kanban?.obterFunil) return;
      const queryKey = { funilId: funilAtivo, ...filtros };
      await utilsTrpc.kanban.obterFunil.cancel(queryKey);
      const anterior = utilsTrpc.kanban.obterFunil.getData(queryKey);
      if (!anterior) return { anterior };

      let cardMovido: any = null;
      const novasColunas = (anterior.colunas || []).map((col: any) => {
        const sem = (col.cards || []).filter((c: any) => {
          if (c.id === vars.cardId) {
            cardMovido = { ...c, colunaId: vars.colunaDestinoId };
            return false;
          }
          return true;
        });
        return { ...col, cards: sem };
      });
      if (cardMovido) {
        const final = novasColunas.map((col: any) => {
          if (col.id === vars.colunaDestinoId) {
            return { ...col, cards: [...(col.cards || []), cardMovido] };
          }
          return col;
        });
        utilsTrpc.kanban.obterFunil.setData(queryKey, { ...anterior, colunas: final });
      }
      return { anterior };
    },
    onError: (_e: any, _vars: any, ctx: any) => {
      // Reverte cache se mutação falhou no server.
      if (ctx?.anterior && funilAtivo) {
        utilsTrpc?.kanban?.obterFunil?.setData({ funilId: funilAtivo, ...filtros }, ctx.anterior);
      }
    },
    onSettled: () => {
      // Sincroniza com o server pra garantir consistência (ordem real,
      // outros usuários, etc).
      refetchFunil();
    },
  });

  // ─── Modal "Lançar cobrança" ao mover card pra coluna Ganho ─────────────
  // Heurística da coluna "Ganho": nome contém "ganho" ou "concluí" (case
  // insensitive). User não precisa configurar nada — basta nomear a coluna
  // final como "Concluído", "Ganho", "Fechado/Ganho" etc.
  const [modalCobranca, setModalCobranca] = useState<LancarCobrancaCardCtx | null>(null);
  const { data: statusAsaas } = (trpc as any).asaas?.status?.useQuery?.(undefined, { retry: false }) || { data: null };
  const { data: minhasPermsKanban } = (trpc as any).permissoes?.minhasPermissoes?.useQuery?.(
    undefined, { retry: false, refetchOnWindowFocus: false },
  ) || { data: null };
  const podeCriarCobranca = !!(minhasPermsKanban?.permissoes?.financeiro?.criar);

  const ehColunaGanho = (nome: string | undefined) => {
    if (!nome) return false;
    const n = nome.toLowerCase();
    return n.includes("ganho") || n.includes("concluí") || n.includes("conclui");
  };

  // Busca clientes pra vincular ao card
  const { data: clientesBusca } = (trpc as any).clientes?.listar?.useQuery?.(
    { busca: buscaCliente || undefined, limite: 10 },
    { enabled: !!buscaCliente },
  ) || { data: undefined };

  // Editar card
  const editarCardMut = (trpc as any).kanban.editarCard.useMutation({
    onSuccess: () => { toast.success("Card atualizado!"); refetchFunil(); refetchDetalhe(); },
    onError: (e: any) => toast.error(e.message),
  });

  const listaFunis = funis || [];
  const colunasBase = funilData?.colunas || [];
  // Aplica busca textual client-side: titulo / clienteNome / tags.
  // Mantém a ESTRUTURA de colunas (não esconde a coluna se vazia após filtro;
  // só mostra os cards que casam). Quando busca está vazia, retorna idêntico.
  const colunas = useMemo(() => {
    const q = buscaTexto.trim().toLowerCase();
    if (!q) return colunasBase;
    return colunasBase.map((col: any) => ({
      ...col,
      cards: (col.cards || []).filter((c: any) => {
        const titulo = (c.titulo || "").toLowerCase();
        const cliente = (c.clienteNome || "").toLowerCase();
        const tags = (c.tags || "").toLowerCase();
        return titulo.includes(q) || cliente.includes(q) || tags.includes(q);
      }),
    }));
  }, [colunasBase, buscaTexto]);
  const totalCardsBase = colunasBase.reduce(
    (acc: number, col: any) => acc + (col.cards?.length || 0),
    0,
  );
  const totalCardsFiltrados = colunas.reduce(
    (acc: number, col: any) => acc + (col.cards?.length || 0),
    0,
  );

  const reordenarColunasMut = (trpc as any).kanban.reordenarColunas.useMutation({
    onSuccess: () => refetchFunil(),
    onError: (e: any) => toast.error(e.message),
  });

  // Reordena cards dentro de uma coluna (drag dropado sobre outro card).
  // Faz UPDATE em massa da ordem nova; usa optimistic update no cache local.
  const reordenarCardsMut = (trpc as any).kanban.reordenarCardsEmColuna.useMutation({
    onMutate: async (vars: { colunaId: number; idsOrdenados: number[] }) => {
      if (!funilAtivo || !utilsTrpc?.kanban?.obterFunil) return;
      const queryKey = { funilId: funilAtivo, ...filtros, mostrarArquivados };
      await utilsTrpc.kanban.obterFunil.cancel(queryKey);
      const anterior = utilsTrpc.kanban.obterFunil.getData(queryKey);
      if (!anterior) return { anterior };

      const novasColunas = (anterior.colunas || []).map((col: any) => {
        if (col.id !== vars.colunaId) return col;
        const porId = new Map<number, any>();
        for (const c of (col.cards || [])) porId.set(c.id, c);
        const reordenados = vars.idsOrdenados
          .map((id) => porId.get(id))
          .filter(Boolean);
        return { ...col, cards: reordenados };
      });
      utilsTrpc.kanban.obterFunil.setData(queryKey, { ...anterior, colunas: novasColunas });
      return { anterior };
    },
    onError: (_e: any, _vars: any, ctx: any) => {
      if (ctx?.anterior && funilAtivo) {
        utilsTrpc?.kanban?.obterFunil?.setData(
          { funilId: funilAtivo, ...filtros, mostrarArquivados },
          ctx.anterior,
        );
      }
    },
    onSettled: () => refetchFunil(),
  });

  // Drop sobre um card específico = colocar o arrastado ANTES desse card.
  // Funciona tanto pra reorder na mesma coluna quanto pra mover entre colunas
  // colocando em posição específica.
  const handleDropOnCard = (cardAlvoId: number, colunaAlvoId: number) => {
    if (!dragCardId || dragCardId === cardAlvoId) {
      setDragOverCardId(null);
      return;
    }
    const cardIdLocal = dragCardId;
    setDragCardId(null);
    setDragOverCardId(null);

    // Acha a coluna origem (de onde o card está saindo) e a alvo.
    const colunaAlvo = colunas.find((c: any) => c.id === colunaAlvoId);
    if (!colunaAlvo) return;
    const colunaOrigem = colunas.find((c: any) =>
      (c.cards || []).some((k: any) => k.id === cardIdLocal),
    );

    // Constrói nova ordem da coluna alvo: remove o card-arrastado se já
    // estava lá (mesma coluna) e insere antes do card-alvo.
    const cardsAlvo = (colunaAlvo.cards || []).filter((c: any) => c.id !== cardIdLocal);
    const idxAlvo = cardsAlvo.findIndex((c: any) => c.id === cardAlvoId);
    const novosIds: number[] = [];
    for (let i = 0; i < cardsAlvo.length; i++) {
      if (i === idxAlvo) novosIds.push(cardIdLocal);
      novosIds.push(cardsAlvo[i].id);
    }
    // Se idxAlvo for -1 (segurança), insere no fim.
    if (idxAlvo === -1) novosIds.push(cardIdLocal);

    // Se mudou de coluna, precisamos mover ANTES de reordenar.
    if (colunaOrigem && colunaOrigem.id !== colunaAlvoId) {
      moverCardMut.mutate(
        { cardId: cardIdLocal, colunaDestinoId: colunaAlvoId },
        {
          onSettled: () => {
            reordenarCardsMut.mutate({ colunaId: colunaAlvoId, idsOrdenados: novosIds });
          },
        },
      );
    } else {
      reordenarCardsMut.mutate({ colunaId: colunaAlvoId, idsOrdenados: novosIds });
    }
  };

  const handleColunaDropOnTarget = (alvoColunaId: number) => {
    if (!dragColunaId || dragColunaId === alvoColunaId) {
      setDragColunaId(null);
      return;
    }
    const idsAtuais: number[] = colunas.map((c: any) => c.id);
    const idxFonte = idsAtuais.indexOf(dragColunaId);
    const idxAlvo = idsAtuais.indexOf(alvoColunaId);
    if (idxFonte === -1 || idxAlvo === -1) {
      setDragColunaId(null);
      return;
    }
    const novaOrdem = [...idsAtuais];
    novaOrdem.splice(idxFonte, 1);
    novaOrdem.splice(idxAlvo, 0, dragColunaId);
    setDragColunaId(null);
    reordenarColunasMut.mutate({ funilId: funilAtivo, idsOrdenados: novaOrdem });
  };

  const handleDrop = (colunaDestinoId: number) => {
    if (!dragCardId || !colunaDestinoId) return;
    const cardIdLocal = dragCardId;
    setDragCardId(null);

    moverCardMut.mutate(
      { cardId: cardIdLocal, colunaDestinoId },
      {
        onSuccess: () => {
          // Localiza coluna destino + card pra decidir se abre modal
          const colDest = colunas.find((c: any) => c.id === colunaDestinoId);
          if (!ehColunaGanho(colDest?.nome)) return;
          if (!podeCriarCobranca) return;

          let cardAlvo: any = null;
          for (const c of colunas) {
            const found = (c.cards || []).find((k: any) => k.id === cardIdLocal);
            if (found) { cardAlvo = found; break; }
          }
          if (!cardAlvo) return;
          // Já tem cobrança vinculada (Asaas ou manual): não reabre modal
          if (cardAlvo.asaasPaymentId) return;

          setModalCobranca({
            cardId: cardAlvo.id,
            cardTitulo: cardAlvo.titulo,
            clienteId: cardAlvo.clienteId ?? null,
            clienteNome: cardAlvo.clienteNome ?? null,
            processoId: cardAlvo.processoId ?? null,
            valorEstimado: cardAlvo.valorEstimado != null ? parseFloat(cardAlvo.valorEstimado) : null,
            asaasConectado: !!statusAsaas?.conectado,
          });
        },
      },
    );
  };

  // ─── SELETOR DE FUNIL ──────────────────────────────────────────────────
  if (!funilAtivo) {
    // Agregados pro hero — soma das stats individuais dos funis
    const totaisEscritorio = listaFunis.reduce(
      (acc: any, f: any) => ({
        emProducao: acc.emProducao + (f.emProducao ?? 0),
        concluidos: acc.concluidos + (f.concluidos ?? 0),
        atrasados: acc.atrasados + (f.atrasados ?? 0),
      }),
      { emProducao: 0, concluidos: 0, atrasados: 0 },
    );
    const totalFunisAtivos = listaFunis.filter(
      (f: any) => (f.emProducao ?? 0) + (f.concluidos ?? 0) > 0,
    ).length;

    return (
      <div className="rounded-2xl bg-gradient-to-br from-slate-50/40 via-white to-indigo-50/20 p-6 space-y-5 max-w-7xl mx-auto">
        {/* ═══════════ HERO ═══════════ */}
        <div className="rounded-2xl bg-gradient-to-br from-indigo-700 via-blue-700 to-cyan-700 p-7 text-white relative overflow-hidden shadow-lg">
          <LayoutGrid className="absolute -right-10 -bottom-12 w-56 h-56 opacity-10" strokeWidth={1.2} />
          <div className="relative">
            <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <PulseDot />
                  <p className="text-xs font-medium text-white/85 uppercase tracking-wider">Kanban</p>
                </div>
                <p className="text-xs text-white/70">Gestão visual de processos em produção</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setImportTrelloOpen(true)}
                  className="text-white/85 hover:text-white hover:bg-white/15 border border-white/20 h-8 text-xs"
                >
                  <Upload className="h-3.5 w-3.5 mr-1" /> Importar do Trello
                </Button>
                <Button
                  size="sm"
                  onClick={() => setNovoFunilOpen(true)}
                  className="bg-white text-slate-900 hover:bg-slate-100 font-semibold shadow-sm h-8"
                >
                  <Plus className="h-4 w-4 mr-1" /> Novo funil
                </Button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
              <div className="lg:col-span-6">
                <p className="text-sm font-medium text-white/85 mb-1">Funis ativos</p>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                    {totalFunisAtivos}
                  </span>
                  {totaisEscritorio.emProducao > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-white/15 text-white border border-white/20">
                      {totaisEscritorio.emProducao} cards em produção
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/65 mt-2 tabular-nums">
                  <b className="text-white">{totaisEscritorio.concluidos}</b> concluídos
                  {totaisEscritorio.atrasados > 0 && (
                    <>
                      {" · "}
                      <span className="text-amber-200 font-medium">
                        {totaisEscritorio.atrasados} atrasado{totaisEscritorio.atrasados !== 1 ? "s" : ""}
                      </span>
                    </>
                  )}
                </p>
              </div>

              {listaFunis.length > 0 && (
                <div className="lg:col-span-6">
                  <p className="text-[10px] text-white/65 uppercase tracking-wider mb-2">Atenção</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                      <p className="text-xs text-white/70 mb-1">Atrasados</p>
                      <p className="text-2xl font-bold tabular-nums leading-none text-rose-200">
                        {totaisEscritorio.atrasados}
                      </p>
                    </div>
                    <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                      <p className="text-xs text-white/70 mb-1">Funis vazios</p>
                      <p className="text-2xl font-bold tabular-nums leading-none text-slate-200">
                        {listaFunis.length - totalFunisAtivos}
                      </p>
                    </div>
                    <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                      <p className="text-xs text-white/70 mb-1">Total funis</p>
                      <p className="text-2xl font-bold tabular-nums leading-none text-white">
                        {listaFunis.length}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══════════ LISTA ═══════════ */}
        {listaFunis.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-16 text-center">
              <LayoutGrid className="h-12 w-12 text-muted-foreground/20 mb-4" />
              <h3 className="text-lg font-semibold">Nenhum funil criado</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Crie seu primeiro funil para organizar os processos do escritório.
              </p>
              <Button className="mt-4" onClick={() => setNovoFunilOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Criar funil
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {listaFunis.map((f: any) => (
              <FunilCard key={f.id} funil={f} onAbrir={() => setFunilAtivo(f.id)} />
            ))}
            <button
              onClick={() => setNovoFunilOpen(true)}
              className="rounded-2xl border-2 border-dashed border-slate-300 hover:border-slate-400 hover:bg-slate-50 transition-all p-5 flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-slate-700 min-h-[220px]"
            >
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                <Plus className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold">Criar novo funil</p>
              <p className="text-xs text-slate-400">Personalize colunas, cores e tags</p>
            </button>
          </div>
        )}

        {/* Dialog novo funil */}
        <Dialog open={novoFunilOpen} onOpenChange={setNovoFunilOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Novo funil</DialogTitle>
              <DialogDescription>Crie um quadro kanban para organizar processos.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Nome *</Label>
                <Input
                  value={novoFunilNome}
                  onChange={(e) => setNovoFunilNome(e.target.value)}
                  placeholder="Ex: Processos Cíveis"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setNovoFunilOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => criarFunilMut.mutate({ nome: novoFunilNome, comColunasPadrao: true })}
                disabled={!novoFunilNome || criarFunilMut.isPending}
              >
                {criarFunilMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ImportarTrelloDialog
          open={importTrelloOpen}
          onOpenChange={setImportTrelloOpen}
          onSuccess={(funilId) => {
            refetchFunis();
            refetchTags();
            setFunilAtivo(funilId);
          }}
        />
      </div>
    );
  }

  // ─── BOARD DO FUNIL ──────────────────────────────────────────────────────
  // Stats em tempo real baseadas nas colunas carregadas (atualiza com polling)
  const totalCardsAtivos = colunas.reduce((acc: number, c: any) => acc + (c.cards?.length || 0), 0);
  const totalAtrasados = colunas.reduce(
    (acc: number, c: any) => acc + (c.cards?.filter((k: any) => k.atrasado).length || 0),
    0,
  );
  const totalEmProducao = colunas.reduce(
    (acc: number, c: any) => acc + (c.tipo !== "conclusao" ? c.cards?.length || 0 : 0),
    0,
  );
  const totalConcluidos = colunas.reduce(
    (acc: number, c: any) => acc + (c.tipo === "conclusao" ? c.cards?.length || 0 : 0),
    0,
  );

  const funilNome = funilData?.funil?.nome || "Carregando…";
  const funilCor = funilData?.funil?.cor || "#6366f1";

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-50/40 via-white to-indigo-50/20 p-6 space-y-5">
      {/* Botão voltar externo ao hero */}
      <button
        onClick={() => setFunilAtivo(null)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Voltar para funis
      </button>

      {/* ═══════════ HERO COMPACTO ═══════════ */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-700 via-blue-700 to-cyan-700 p-6 text-white relative overflow-hidden shadow-lg">
        <div className="relative">
          <div className="flex items-start gap-5 mb-4 flex-wrap">
            <div
              className="w-14 h-14 rounded-2xl text-white flex items-center justify-center text-xl font-bold shrink-0 shadow-lg ring-4 ring-white/20"
              style={{ background: `linear-gradient(135deg, ${funilCor} 0%, #6366f1 100%)` }}
            >
              {funilNome[0]?.toUpperCase() || "K"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h2 className="text-xl font-bold tracking-tight">{funilNome}</h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/15 text-white border border-white/20">
                  {colunas.length} coluna{colunas.length !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="text-xs text-white/65">
                Funil ativo · Atualizado em tempo real
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNovaTagOpen(true)}
                className="text-white/85 hover:text-white hover:bg-white/15 border border-white/20 h-8 text-xs"
              >
                <Tag className="h-3.5 w-3.5 mr-1" /> Tags
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNovaColunaOpen(true)}
                className="text-white/85 hover:text-white hover:bg-white/15 border border-white/20 h-8 text-xs"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Coluna
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-200 hover:text-white hover:bg-rose-500/30 border border-white/20 h-8 w-8 p-0"
                onClick={() => {
                  if (confirm("Excluir funil e todos os cards?"))
                    deletarFunilMut.mutate({ id: funilAtivo });
                }}
                title="Excluir funil"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* 4 KPIs do funil */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-white/10 rounded-lg px-3 py-2.5 border border-white/15">
              <p className="text-[10px] text-white/65 uppercase tracking-wider mb-1">Total cards</p>
              <p className="text-2xl font-bold tabular-nums leading-none">{totalCardsAtivos}</p>
            </div>
            <div className="bg-white/10 rounded-lg px-3 py-2.5 border border-white/15">
              <p className="text-[10px] text-white/65 uppercase tracking-wider mb-1">Em produção</p>
              <p className="text-2xl font-bold tabular-nums leading-none text-blue-200">
                {totalEmProducao}
              </p>
            </div>
            <div className="bg-white/10 rounded-lg px-3 py-2.5 border border-white/15">
              <p className="text-[10px] text-white/65 uppercase tracking-wider mb-1">⚠ Atrasados</p>
              <p
                className={`text-2xl font-bold tabular-nums leading-none ${totalAtrasados > 0 ? "text-rose-200" : ""}`}
              >
                {totalAtrasados}
              </p>
            </div>
            <div className="bg-white/10 rounded-lg px-3 py-2.5 border border-white/15">
              <p className="text-[10px] text-white/65 uppercase tracking-wider mb-1">Concluídos</p>
              <p className="text-2xl font-bold tabular-nums leading-none text-emerald-200">
                {totalConcluidos}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ FILTROS + BUSCA ═══════════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              value={buscaTexto}
              onChange={(e) => setBuscaTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setBuscaTexto("");
              }}
              placeholder="Buscar por título, cliente, tag..."
              className="pl-10 pr-9 h-10 bg-white"
            />
            {buscaTexto && (
              <button
                onClick={() => setBuscaTexto("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title="Limpar busca"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle Normal/Compacto */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-white overflow-hidden">
              <button
                onClick={() => setModoCompacto(false)}
                className={`px-3 py-1.5 text-xs font-medium ${!modoCompacto ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
              >
                Normal
              </button>
              <button
                onClick={() => setModoCompacto(true)}
                className={`px-3 py-1.5 text-xs font-medium ${modoCompacto ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
              >
                Compacto
              </button>
            </div>

            {/* Mostrar arquivados */}
            <button
              onClick={() => setMostrarArquivados(!mostrarArquivados)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                mostrarArquivados
                  ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                  : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
              title={mostrarArquivados ? "Esconder arquivados" : "Mostrar arquivados"}
            >
              <Archive className="h-3 w-3" />
              {mostrarArquivados ? "Mostrando arquivados" : "Arquivados"}
            </button>
          </div>

          {buscaTexto.trim() && (
            <span className="text-[11px] text-muted-foreground">
              <b className="text-foreground tabular-nums">{totalCardsFiltrados}</b>
              {" de "}
              <b className="tabular-nums">{totalCardsBase}</b> card(s)
            </span>
          )}
        </div>

        <FiltrosBar filtros={filtros} setFiltros={setFiltros} />
      </div>

      {/* Colunas — altura máx 70vh com scroll INTERNO; header sticky no topo da coluna */}
      <div className="flex gap-4 overflow-x-auto pb-4 px-2">
        {colunas.map((col: any) => (
          <div
            key={col.id}
            className={`flex-shrink-0 ${modoCompacto ? "w-60" : "w-72"} bg-muted/30 rounded-xl p-3 space-y-2 flex flex-col ${dragColunaId === col.id ? "opacity-50" : ""}`}
            style={{ maxHeight: "calc(100vh - 240px)" }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              // Drop entre tipos: se está arrastando coluna, reordena;
              // senão, é drop de card → move card pra cá.
              if (dragColunaId) handleColunaDropOnTarget(col.id);
              else handleDrop(col.id);
            }}
          >
            {/* Header coluna — draggable pra reordenar colunas; sticky no topo da coluna scrollada */}
            <div
              className="flex items-center justify-between cursor-move sticky top-0 bg-muted/30 backdrop-blur z-10 -mx-3 -mt-3 px-3 pt-3 pb-2 rounded-t-xl"
              draggable
              onDragStart={() => setDragColunaId(col.id)}
              onDragEnd={() => setDragColunaId(null)}
              title="Arraste pra reordenar coluna"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: col.cor || "#6b7280" }} />
                <input
                  className="text-xs font-semibold uppercase tracking-wide bg-transparent border-none outline-none min-w-0 flex-1 hover:bg-muted/50 focus:bg-white focus:ring-1 focus:ring-primary rounded px-1 -mx-1"
                  defaultValue={col.nome}
                  onBlur={(e) => {
                    const novo = e.target.value.trim();
                    if (novo && novo !== col.nome) editarColunaMut.mutate({ id: col.id, nome: novo });
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
                <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">{col.cards?.length || 0}</Badge>
                {col.tipo === "conclusao" && (
                  <Badge
                    className="text-[9px] h-4 px-1 bg-emerald-100 text-emerald-700 border-emerald-200 shrink-0 dark:bg-emerald-950/30 dark:text-emerald-300"
                    title="Cards nesta coluna são considerados concluídos"
                  >
                    ✓ conclusão
                  </Badge>
                )}
              </div>
              <div className="flex gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 w-6 p-0 ${col.tipo === "conclusao" ? "text-emerald-600" : "text-muted-foreground hover:text-emerald-600"}`}
                  title={col.tipo === "conclusao" ? "Desmarcar como conclusão" : "Marcar como coluna de conclusão"}
                  onClick={() =>
                    editarColunaMut.mutate({
                      id: col.id,
                      tipo: col.tipo === "conclusao" ? "normal" : "conclusao",
                    })
                  }
                >
                  <CheckCircle2 className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setNovoCardOpen(col.id)}>
                  <Plus className="h-3 w-3" />
                </Button>
                {col.tipo === "conclusao" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-6 w-6 p-0 ${(col.cards?.length ?? 0) > 0 ? "text-amber-600 hover:text-amber-700" : "text-muted-foreground/50"}`}
                    title={
                      (col.cards?.length ?? 0) > 0
                        ? `Arquivar todos os ${col.cards.length} cards desta coluna`
                        : "Sem cards pra arquivar"
                    }
                    disabled={(col.cards?.length ?? 0) === 0 || arquivarLoteMut.isPending}
                    onClick={() => {
                      const total = col.cards?.length ?? 0;
                      if (total === 0) return;
                      if (confirm(`Arquivar todos os ${total} card(s) de "${col.nome}"? Eles somem do quadro mas continuam consultáveis em "Mostrar arquivados".`)) {
                        arquivarLoteMut.mutate({ ids: col.cards.map((c: any) => c.id) });
                      }
                    }}
                  >
                    <Archive className="h-3 w-3" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => { if (confirm(`Excluir coluna "${col.nome}" e seus cards?`)) deletarColunaMut.mutate({ id: col.id }); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Cards: limita aos primeiros CARDS_INICIAIS por coluna até user clicar em "ver mais". */}
            {(() => {
              const todos = (col.cards || []);
              const expandida = colunasExpandidas.has(col.id);
              const cardsVisiveis = expandida ? todos : todos.slice(0, CARDS_INICIAIS);
              const restantes = todos.length - cardsVisiveis.length;
              return (
                <>
                  <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
                    {cardsVisiveis.map((card: any) => {
              const tagsList = tags || [];
              const cardTags = card.tags ? card.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
              const isAtrasado = card.atrasado || (card.prazo && new Date(card.prazo) < new Date());

              return (
                <div
                  key={card.id}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    setDragCardId(card.id);
                  }}
                  onDragEnd={() => {
                    setDragCardId(null);
                    setDragOverCardId(null);
                  }}
                  onDragOver={(e) => {
                    // Marca esse card como drop target. Setter do React faz
                    // bail-out se mesmo valor, então OK chamar sempre. Sem
                    // onDragLeave pra evitar flicker null↔id sobre filhos
                    // (badges/spans) que forçaria rerender massivo.
                    if (dragCardId && dragCardId !== card.id) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragOverCardId !== card.id) setDragOverCardId(card.id);
                    }
                  }}
                  onDrop={(e) => {
                    if (!dragCardId || dragCardId === card.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    handleDropOnCard(card.id, col.id);
                  }}
                  onClick={() => setCardAberto(card.id)}
                  className={`group relative bg-white rounded-xl border shadow-sm hover:shadow-md cursor-pointer active:cursor-grabbing transition-all ${
                    modoCompacto ? "px-2.5 py-2" : "p-3"
                  } ${
                    isAtrasado
                      ? "border-rose-300 bg-gradient-to-r from-rose-50/60 to-white"
                      : col.tipo === "conclusao" && !card.asaasPaymentId
                        ? "border-emerald-300 bg-gradient-to-br from-emerald-50/60 to-white"
                        : "border-slate-200 hover:border-slate-400"
                  } ${
                    dragOverCardId === card.id && dragCardId && dragCardId !== card.id
                      ? "ring-2 ring-primary ring-offset-1"
                      : ""
                  }`}
                  title={modoCompacto ? card.titulo : undefined}
                >
                  {modoCompacto ? (
                    <div className="flex items-center gap-1.5">
                      <PrioDot prioridade={card.prioridade} />
                      <p className="text-xs font-semibold leading-tight truncate flex-1">
                        {card.titulo}
                      </p>
                      {(card as any).responsavelNome && (
                        <AvatarResp nome={(card as any).responsavelNome} />
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2 mb-2">
                        <PrioDot
                          prioridade={card.prioridade}
                          title={`Prioridade ${PRIORIDADE_LABEL[card.prioridade] || "?"}`}
                          mt
                        />
                        <p className="text-sm font-semibold leading-snug flex-1 break-words">
                          {card.titulo}
                        </p>
                        {(card as any).responsavelNome && (
                          <AvatarResp nome={(card as any).responsavelNome} />
                        )}
                      </div>

                      {/* Cliente */}
                      {card.clienteNome && (
                        <div className="flex items-center gap-1.5 mb-2 text-[11px] text-slate-700">
                          <Briefcase className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-medium truncate">{card.clienteNome}</span>
                        </div>
                      )}
                      {(card as any).acaoApelido && (
                        <div className="flex items-center gap-1.5 mb-2 text-[10px] text-blue-700">
                          <Scale className="w-3 h-3 text-blue-500 shrink-0" />
                          <span className="font-medium truncate">{(card as any).acaoApelido}</span>
                        </div>
                      )}
                      {card.cnj && !(card as any).acaoApelido && (
                        <p className="text-[10px] font-mono text-slate-500 mb-2 truncate">{card.cnj}</p>
                      )}

                      {/* Tags outline */}
                      {cardTags.length > 0 && (
                        <div className="flex items-center gap-1 mb-2 flex-wrap">
                          {cardTags.slice(0, 3).map((tagNome: string, i: number) => {
                            const tagObj = tagsList.find((t: any) => t.nome === tagNome);
                            const cor = tagObj?.cor || "#6b7280";
                            return (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-white"
                                style={{ color: cor, borderColor: cor }}
                              >
                                <span className="inline-block w-1 h-1 rounded-full" style={{ background: cor }} />
                                {tagNome}
                              </span>
                            );
                          })}
                          {cardTags.length > 3 && (
                            <span className="text-[9px] text-slate-400 font-medium">
                              +{cardTags.length - 3}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Rodapé: prazo/status + tempo na coluna */}
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        {isAtrasado ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">
                            ⚠ Atrasado
                          </span>
                        ) : col.tipo === "conclusao" && !card.asaasPaymentId ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                            <Wallet className="w-2.5 h-2.5" /> Lançar cobrança
                          </span>
                        ) : col.tipo === "conclusao" && card.asaasPaymentId ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Cobrança lançada
                          </span>
                        ) : card.prazo ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">
                            <Calendar className="w-2.5 h-2.5" />
                            {new Date(card.prazo).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "short",
                            })}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Sem prazo</span>
                        )}
                        <TempoColuna updatedAt={card.updatedAt} createdAt={card.createdAt} />
                      </div>
                    </>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1 right-1 h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-destructive hover:bg-rose-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletarCardMut.mutate({ id: card.id });
                    }}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                </div>
              );
            })}
                    {restantes > 0 && (
                      <button
                        onClick={() => toggleExpandirColuna(col.id)}
                        className="w-full py-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-dashed rounded-md hover:border-solid transition-colors"
                      >
                        Ver mais {restantes} {restantes === 1 ? "card" : "cards"} →
                      </button>
                    )}
                    {expandida && todos.length > CARDS_INICIAIS && (
                      <button
                        onClick={() => toggleExpandirColuna(col.id)}
                        className="w-full py-1.5 text-[11px] text-muted-foreground hover:text-foreground rounded-md transition-colors"
                      >
                        ← Recolher
                      </button>
                    )}
                  </div>
                </>
              );
            })()}

            {/* Botão add card no fundo */}
            <button
              onClick={() => setNovoCardOpen(col.id)}
              className="w-full py-2 text-xs text-muted-foreground hover:text-foreground border border-dashed rounded-lg hover:border-solid transition-colors shrink-0"
            >
              <Plus className="h-3 w-3 inline mr-1" />Adicionar card
            </button>
          </div>
        ))}
      </div>

      {/* Dialog nova coluna */}
      <Dialog open={novaColunaOpen} onOpenChange={setNovaColunaOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Nova coluna</DialogTitle></DialogHeader>
          <div><Label className="text-xs">Nome *</Label><Input value={novaColunaNome} onChange={(e) => setNovaColunaNome(e.target.value)} placeholder="Ex: Em revisão" /></div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovaColunaOpen(false)}>Cancelar</Button>
            <Button onClick={() => criarColunaMut.mutate({ funilId: funilAtivo, nome: novaColunaNome })} disabled={!novaColunaNome || criarColunaMut.isPending}>
              {criarColunaMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog novo card */}
      <Dialog open={!!novoCardOpen} onOpenChange={(v) => { if (!v) { setNovoCardOpen(null); setClienteSelecionado(null); setBuscaCliente(""); } }}>
        <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Novo card</DialogTitle><DialogDescription>Adicione um processo ou caso ao quadro.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Título *</Label><Input value={cardForm.titulo} onChange={(e) => setCardForm({ ...cardForm, titulo: e.target.value })} placeholder="Ex: Ação trabalhista João Silva" /></div>
            <div><Label className="text-xs">Número CNJ (opcional)</Label><Input value={cardForm.cnj} onChange={(e) => setCardForm({ ...cardForm, cnj: e.target.value })} placeholder="0000000-00.0000.0.00.0000" className="font-mono" /></div>

            {/* Cliente */}
            <div>
              <Label className="text-xs">Cliente</Label>
              {clienteSelecionado ? (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200/50 mt-1">
                  <User className="h-4 w-4 text-emerald-600" />
                  <div className="flex-1"><p className="text-xs font-medium">{clienteSelecionado.nome}</p>{clienteSelecionado.cpfCnpj && <p className="text-[9px] text-muted-foreground">{clienteSelecionado.cpfCnpj}</p>}</div>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => { setClienteSelecionado(null); setBuscaCliente(""); }}>Trocar</Button>
                </div>
              ) : (
                <div className="mt-1">
                  <Input placeholder="Buscar cliente por nome, CPF..." value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} />
                  {buscaCliente && (clientesBusca?.clientes || []).length > 0 && (
                    <div className="border rounded-lg mt-1 max-h-32 overflow-y-auto divide-y">
                      {(clientesBusca.clientes || []).map((c: any) => (
                        <button key={c.id} onClick={() => { setClienteSelecionado(c); setBuscaCliente(""); }} className="w-full flex items-center gap-2 p-2 hover:bg-muted/50 text-left text-xs">
                          <User className="h-3 w-3 text-violet-500" /><span className="font-medium">{c.nome}</span>{c.cpfCnpj && <span className="text-[9px] text-muted-foreground">{c.cpfCnpj}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Responsável */}
            <div>
              <Label className="text-xs">Responsável</Label>
              <Select
                value={cardForm.responsavelId || "_criador"}
                onValueChange={(v) => setCardForm({ ...cardForm, responsavelId: v === "_criador" ? "" : v })}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_criador">Eu mesmo (padrão)</SelectItem>
                  {colaboradoresAtivos.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.userName ?? "—"} ({c.cargo})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Recebe notificação quando o card é criado.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Prazo (opcional)</Label><Input type="date" value={cardForm.prazo} onChange={(e) => setCardForm({ ...cardForm, prazo: e.target.value })} /></div>
              <div>
                <Label className="text-xs">Tags</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {(tags || []).map((t: any) => {
                    const selecionada = cardForm.tags.split(",").map((s: string) => s.trim()).includes(t.nome);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          const atuais = cardForm.tags.split(",").map((s: string) => s.trim()).filter(Boolean);
                          const novas = selecionada ? atuais.filter((n: string) => n !== t.nome) : [...atuais, t.nome];
                          setCardForm({ ...cardForm, tags: novas.join(", ") });
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-all ${selecionada ? "text-white ring-2 ring-offset-1" : "opacity-50 hover:opacity-80"}`}
                        style={{ background: t.cor }}
                      >
                        {t.nome}
                      </button>
                    );
                  })}
                  {(!tags || tags.length === 0) && <p className="text-[10px] text-muted-foreground">Nenhuma tag criada. Use o botão "Tags" no board.</p>}
                </div>
              </div>
            </div>

            {/* Urgente toggle */}
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-red-50/50 transition-colors">
              <input type="checkbox" checked={cardForm.urgente} onChange={(e) => setCardForm({ ...cardForm, urgente: e.target.checked, prioridade: e.target.checked ? "alta" : "media" })} className="accent-red-500 h-4 w-4" />
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3"><span className={`${cardForm.urgente ? "animate-ping" : ""} absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75`} /><span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" /></span>
                <div><p className="text-xs font-medium">Marcar como urgente</p><p className="text-[10px] text-muted-foreground">Indicador vermelho pulsante no card</p></div>
              </div>
            </label>

            <div>
              <Label className="text-xs">Valor estimado (R$, opcional)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={cardForm.valorEstimado}
                onChange={(e) => setCardForm({ ...cardForm, valorEstimado: e.target.value })}
                placeholder="Ex: 3500,00"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Quando mover pra coluna "Concluído/Ganho", o sistema oferece lançar cobrança com este valor.
              </p>
            </div>

            <div><Label className="text-xs">Descrição</Label><Textarea value={cardForm.descricao} onChange={(e) => setCardForm({ ...cardForm, descricao: e.target.value })} rows={2} placeholder="Detalhes do caso..." /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoCardOpen(null)}>Cancelar</Button>
            <Button onClick={() => criarCardMut.mutate({
              colunaId: novoCardOpen!,
              titulo: cardForm.titulo,
              prioridade: cardForm.urgente ? "alta" : "media",
              prazo: cardForm.prazo || undefined,
              tags: cardForm.tags || undefined,
              descricao: cardForm.descricao || undefined,
              cnj: cardForm.cnj || undefined,
              clienteId: clienteSelecionado?.id,
              responsavelId: cardForm.responsavelId ? Number(cardForm.responsavelId) : undefined,
              valorEstimado: cardForm.valorEstimado ? parseFloat(cardForm.valorEstimado) : undefined,
            })} disabled={!cardForm.titulo || criarCardMut.isPending}>
              {criarCardMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Dialog gerenciar tags */}
      <Dialog open={novaTagOpen} onOpenChange={setNovaTagOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Tag className="h-5 w-5 text-indigo-600" /> Gerenciar Tags</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input value={novaTagNome} onChange={(e) => setNovaTagNome(e.target.value)} placeholder="Nome da tag" className="flex-1" />
              <input type="color" value={novaTagCor} onChange={(e) => setNovaTagCor(e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
              <Button size="sm" onClick={() => criarTagMut.mutate({ nome: novaTagNome, cor: novaTagCor })} disabled={!novaTagNome || criarTagMut.isPending}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {(tags || []).map((t: any) => (
                <div key={t.id} className="flex items-center gap-2 py-1">
                  <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ background: t.cor }}>{t.nome}</span>
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive" onClick={() => deletarTagMut.mutate({ id: t.id })}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {(!tags || tags.length === 0) && <p className="text-xs text-muted-foreground text-center py-2">Nenhuma tag criada.</p>}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Painel lateral: detalhe + edição do card */}
      {cardAberto && cardDetalhe && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setCardAberto(null)}>
          <div className="absolute inset-0 bg-black/20" />
          <div className="relative w-full max-w-md bg-card border-l shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {cardDetalhe.prioridade === "alta" && (
                    <span className="relative flex h-3 w-3 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                    </span>
                  )}
                  <h3 className="text-lg font-bold">{cardDetalhe.titulo}</h3>
                  {cardDetalhe.atrasado && <Badge className="bg-red-500/15 text-red-700 border-red-500/30 text-[10px]">Atrasado</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  {cardDetalhe.arquivado ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => desarquivarCardMut.mutate({ id: cardDetalhe.id })}
                      disabled={desarquivarCardMut.isPending}
                      title="Voltar pro quadro"
                    >
                      Desarquivar
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => arquivarCardMut.mutate({ id: cardDetalhe.id })}
                      disabled={arquivarCardMut.isPending}
                      title="Esconde do quadro sem perder dados"
                    >
                      Arquivar
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setCardAberto(null)}><X className="h-4 w-4" /></Button>
                </div>
              </div>
              {cardDetalhe.arquivado && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  📦 Este card está arquivado — não aparece no quadro até desarquivar.
                </div>
              )}

              {/* Edição inline */}
              <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
                <p className="text-[10px] font-semibold text-muted-foreground">EDITAR</p>
                <div><Label className="text-[10px]">Título</Label><Input defaultValue={cardDetalhe.titulo} onBlur={(e) => { if (e.target.value !== cardDetalhe.titulo) editarCardMut.mutate({ id: cardDetalhe.id, titulo: e.target.value }); }} /></div>
                <div><Label className="text-[10px]">CNJ</Label><Input defaultValue={cardDetalhe.cnj || ""} className="font-mono" onBlur={(e) => editarCardMut.mutate({ id: cardDetalhe.id, cnj: e.target.value || undefined })} /></div>
                <div>
                  <Label className="text-[10px]">Valor estimado (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={cardDetalhe.valorEstimado != null ? cardDetalhe.valorEstimado : ""}
                    onBlur={(e) => {
                      const v = e.target.value;
                      editarCardMut.mutate({ id: cardDetalhe.id, valorEstimado: v ? parseFloat(v) : null });
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-[10px]">Prazo</Label><Input type="date" defaultValue={cardDetalhe.prazo ? new Date(cardDetalhe.prazo).toISOString().split("T")[0] : ""} onChange={(e) => editarCardMut.mutate({ id: cardDetalhe.id, prazo: e.target.value || undefined })} /></div>
                  <div>
                    <Label className="text-[10px]">Tags</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(tags || []).map((t: any) => {
                        const atuais = (cardDetalhe.tags || "").split(",").map((s: string) => s.trim()).filter(Boolean);
                        const sel = atuais.includes(t.nome);
                        return (
                          <button key={t.id} type="button" onClick={() => {
                            const novas = sel ? atuais.filter((n: string) => n !== t.nome) : [...atuais, t.nome];
                            editarCardMut.mutate({ id: cardDetalhe.id, tags: novas.join(", ") || undefined });
                          }} className={`text-[9px] px-2 py-0.5 rounded-full font-medium transition-all ${sel ? "text-white ring-2 ring-offset-1" : "opacity-40 hover:opacity-70"}`} style={{ background: t.cor }}>
                            {t.nome}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div><Label className="text-[10px]">Descrição</Label><Textarea defaultValue={cardDetalhe.descricao || ""} rows={2} onBlur={(e) => editarCardMut.mutate({ id: cardDetalhe.id, descricao: e.target.value || undefined })} /></div>

                {/* Toggle urgente */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={cardDetalhe.prioridade === "alta"} onChange={(e) => editarCardMut.mutate({ id: cardDetalhe.id, prioridade: e.target.checked ? "alta" : "media" })} className="accent-red-500 h-4 w-4" />
                  <span className="relative flex h-2.5 w-2.5"><span className={`${cardDetalhe.prioridade === "alta" ? "animate-ping" : ""} absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75`} /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" /></span>
                  <span className="text-xs font-medium">Urgente</span>
                </label>

                {/* Trocar responsável: troca quem fica com o card daqui pra
                    frente. Atendente que não tinha esse card antes passa
                    a ver; quem perdeu deixa de ver no próximo refresh. */}
                <div>
                  <Label className="text-[10px]">Responsável</Label>
                  <Select
                    value={(cardDetalhe as any).responsavelId ? String((cardDetalhe as any).responsavelId) : "_nenhum"}
                    onValueChange={(v) => editarCardMut.mutate({
                      id: cardDetalhe.id,
                      responsavelId: v === "_nenhum" ? null : Number(v),
                    })}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_nenhum">Sem responsável</SelectItem>
                      {colaboradoresAtivos.map((c: any) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.userName ?? "—"} ({c.cargo})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Tags visuais */}
              {cardDetalhe.tags && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {cardDetalhe.tags.split(",").map((t: string, i: number) => {
                    const tagObj = (tags || []).find((tg: any) => tg.nome === t.trim());
                    return <span key={i} className="text-[9px] px-2 py-0.5 rounded-full text-white font-medium" style={{ background: tagObj?.cor || "#6b7280" }}>{t.trim()}</span>;
                  })}
                </div>
              )}

              {/* Cliente vinculado */}
              <div className="rounded-lg border p-3">
                <p className="text-[10px] font-semibold text-muted-foreground mb-2">CLIENTE</p>
                {cardDetalhe.clienteNome ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{cardDetalhe.clienteNome}</p>
                      {cardDetalhe.clienteCpfCnpj && <p className="text-[10px] text-muted-foreground font-mono">{cardDetalhe.clienteCpfCnpj}</p>}
                    </div>
                    <Button size="sm" className="h-8 text-xs bg-violet-600 hover:bg-violet-700 text-white" onClick={() => { setCardAberto(null); setFunilAtivo(null); setLocation(`/clientes?id=${cardDetalhe.clienteId}`); }}>
                      <ExternalLink className="h-3 w-3 mr-1" /> Ver cadastro do cliente
                    </Button>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Nenhum cliente vinculado.</p>
                    <Input placeholder="Buscar cliente..." value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} className="text-xs" />
                    {buscaCliente && (clientesBusca?.clientes || []).length > 0 && (
                      <div className="border rounded mt-1 max-h-32 overflow-y-auto divide-y">
                        {(clientesBusca.clientes).map((c: any) => (
                          <button
                            key={c.id}
                            onClick={() => { editarCardMut.mutate({ id: cardDetalhe.id, clienteId: c.id }); setBuscaCliente(""); }}
                            disabled={editarCardMut.isPending}
                            className="w-full flex items-center gap-2 p-2 hover:bg-muted/50 text-left text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <User className="h-3 w-3 text-violet-500" /><span>{c.nome}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Comentários — autor distinto do responsável do card */}
              <ComentariosSection cardId={cardDetalhe.id} comentarios={cardDetalhe.comentarios || []} onChange={refetchDetalhe} />

              {/* Timeline completa (movimentações + responsáveis + comentários + conclusão) */}
              <TimelineCard cardId={cardDetalhe.id} prazo={cardDetalhe.prazo} />

              <div className="text-[10px] text-muted-foreground pt-2 border-t">
                Criado em {new Date(cardDetalhe.createdAt).toLocaleDateString("pt-BR")}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal pós-Ganho: oferece lançar cobrança ao mover card pra coluna final */}
      <LancarCobrancaCardModal
        open={modalCobranca != null}
        onOpenChange={(o) => { if (!o) setModalCobranca(null); }}
        ctx={modalCobranca}
        onConcluido={() => { setModalCobranca(null); refetchFunil(); }}
      />
    </div>
  );
}

// ─── Sub-componentes do redesign ───────────────────────────────────────────

/** Card de funil na tela seletora — com mini-stats agregadas. */
function FunilCard({ funil, onAbrir }: { funil: any; onAbrir: () => void }) {
  const cor = funil.cor || "#6366f1";
  const totalCards = funil.totalCards ?? 0;
  const concluidos = funil.concluidos ?? 0;
  const emProducao = funil.emProducao ?? 0;
  const atrasados = funil.atrasados ?? 0;
  const totalParaProgresso = emProducao + concluidos;
  const progresso = totalParaProgresso > 0 ? (concluidos / totalParaProgresso) * 100 : 0;

  const status =
    atrasados > 0
      ? { label: `⚠ ${atrasados} atraso${atrasados !== 1 ? "s" : ""}`, cls: "bg-rose-50 text-rose-700" }
      : totalCards === 0
        ? { label: "Vazio", cls: "bg-slate-100 text-slate-500" }
        : { label: "Ativo", cls: "bg-emerald-50 text-emerald-700" };

  return (
    <button
      onClick={onAbrir}
      className={`relative overflow-hidden bg-white rounded-2xl border border-slate-200 text-left transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-slate-300 ${
        totalCards === 0 ? "opacity-80" : ""
      }`}
    >
      {/* Faixa colorida no topo */}
      <div
        className="h-1.5 w-full"
        style={{ background: `linear-gradient(90deg, ${cor} 0%, #6366f1 100%)` }}
      />
      <div className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-11 h-11 rounded-xl text-white flex items-center justify-center font-bold shadow-sm"
            style={{ background: `linear-gradient(135deg, ${cor} 0%, #6366f1 100%)` }}
          >
            {funil.nome[0]?.toUpperCase() || "K"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{funil.nome}</p>
            <p className="text-[11px] text-slate-500 truncate">
              {funil.totalColunas ?? 0} coluna{funil.totalColunas !== 1 ? "s" : ""}
              {funil.descricao ? ` · ${funil.descricao}` : ""}
            </p>
          </div>
          <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${status.cls}`}>
            {status.label}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-lg p-2 bg-slate-50">
            <p className="text-xl font-bold tracking-tight tabular-nums leading-none text-indigo-600">
              {emProducao}
            </p>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider mt-1">Em produção</p>
          </div>
          <div className="rounded-lg p-2 bg-slate-50">
            <p className="text-xl font-bold tracking-tight tabular-nums leading-none text-emerald-600">
              {concluidos}
            </p>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider mt-1">Concluídos</p>
          </div>
          <div className={`rounded-lg p-2 ${atrasados > 0 ? "bg-rose-50 ring-1 ring-rose-200" : "bg-slate-50"}`}>
            <p className="text-xl font-bold tracking-tight tabular-nums leading-none text-rose-600">
              {atrasados}
            </p>
            <p className={`text-[9px] uppercase tracking-wider mt-1 ${atrasados > 0 ? "text-rose-700 font-semibold" : "text-slate-500"}`}>
              Atrasados
            </p>
          </div>
        </div>

        {totalParaProgresso > 0 && (
          <>
            <div className="mb-1 flex justify-between text-[10px] text-slate-500">
              <span>Progresso geral</span>
              <span className="font-semibold text-slate-700">{progresso.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progresso}%`,
                  background: `linear-gradient(90deg, ${cor} 0%, #6366f1 100%)`,
                }}
              />
            </div>
          </>
        )}
      </div>
    </button>
  );
}

/** Dot de prioridade pequeno com halo pulsante na "alta". */
function PrioDot({
  prioridade,
  title,
  mt,
}: {
  prioridade: string;
  title?: string;
  mt?: boolean;
}) {
  const cls =
    prioridade === "alta"
      ? "bg-rose-500 shadow-[0_0_0_3px_rgb(244_63_94_/_0.15)]"
      : prioridade === "media"
        ? "bg-amber-500"
        : "bg-slate-400";
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${cls} ${mt ? "mt-1.5" : ""}`}
      title={title}
    />
  );
}

/** Avatar do responsável (26px com ring branco). */
function AvatarResp({ nome }: { nome: string }) {
  return (
    <span
      className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-[0_0_0_2px_white] shrink-0 bg-gradient-to-br ${gradientAvatar(nome)}`}
      title={nome}
    >
      {gerarIniciais(nome)}
    </span>
  );
}

/** Tempo na coluna (proxy via updatedAt). Vira laranja quando > 7d. */
function TempoColuna({
  updatedAt,
  createdAt,
}: {
  updatedAt: string | Date | null;
  createdAt: string | Date | null;
}) {
  const ref = updatedAt || createdAt;
  if (!ref) return null;
  const dias = Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24));
  if (dias < 1) return <span className="ml-auto text-[10px] text-slate-400">hoje</span>;
  if (dias === 1) return <span className="ml-auto text-[10px] text-slate-400">há 1d</span>;
  const quente = dias > 7;
  const texto = dias < 7 ? `há ${dias}d` : dias < 30 ? `há ${Math.floor(dias / 7)}sem` : `há ${Math.floor(dias / 30)}mês`;
  return (
    <span
      className={`ml-auto text-[10px] tabular-nums ${
        quente ? "text-orange-600 font-semibold" : "text-slate-400"
      }`}
      title={`Última atividade ${new Date(ref).toLocaleString("pt-BR")}`}
    >
      {texto}
    </span>
  );
}
