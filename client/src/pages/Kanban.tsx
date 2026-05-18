/**
 * Kanban — Gestão visual de processos em produção.
 * Funis customizáveis com colunas e cards arrastáveis.
 */

import { useState } from "react";
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
  Archive,
} from "lucide-react";
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

  const { data: funis, refetch: refetchFunis } = (trpc as any).kanban.listarFunis.useQuery();
  const [filtros, setFiltros] = useState<FiltrosKanban>(FILTROS_VAZIOS);
  const { data: funilData, refetch: refetchFunil } = (trpc as any).kanban.obterFunil.useQuery(
    { funilId: funilAtivo!, ...filtros, mostrarArquivados },
    {
      enabled: !!funilAtivo,
      // Polling 5s pra refletir movimentações de outros usuários em
      // quase-tempo-real (atendente A move card → gestor vê em até 5s).
      // Reduzido de 15s pro time multi-usuário não precisar dar F5.
      refetchInterval: 5_000,
      refetchOnWindowFocus: true,
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
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
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
  const colunas = funilData?.colunas || [];

  // Drag state — cards e colunas usam estados separados pra não interferir.
  const [dragCardId, setDragCardId] = useState<number | null>(null);
  const [dragColunaId, setDragColunaId] = useState<number | null>(null);

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

  // Card sobre o qual o usuário está pairando o drag (pra mostrar indicador).
  const [dragOverCardId, setDragOverCardId] = useState<number | null>(null);

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
    return (
      <div className="space-y-5 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-100 to-blue-100 dark:from-indigo-900/40 dark:to-blue-900/40">
            <LayoutGrid className="h-6 w-6 text-indigo-600" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">Kanban</h1>
            <p className="text-sm text-muted-foreground">Gestão visual de processos em produção</p>
          </div>
          <Button variant="outline" onClick={() => setImportTrelloOpen(true)}>
            <Upload className="h-4 w-4 mr-1.5" /> Importar do Trello
          </Button>
          <Button onClick={() => setNovoFunilOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Novo funil</Button>
        </div>

        {listaFunis.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-16 text-center">
              <LayoutGrid className="h-12 w-12 text-muted-foreground/20 mb-4" />
              <h3 className="text-lg font-semibold">Nenhum funil criado</h3>
              <p className="text-sm text-muted-foreground mt-1">Crie seu primeiro funil para organizar os processos do escritório.</p>
              <Button className="mt-4" onClick={() => setNovoFunilOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Criar funil</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listaFunis.map((f: any) => (
              <Card key={f.id} className="cursor-pointer hover:shadow-md transition-all" onClick={() => setFunilAtivo(f.id)}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: f.cor || "#6366f1" }}>
                      {f.nome[0]}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">{f.nome}</p>
                      {f.descricao && <p className="text-xs text-muted-foreground truncate">{f.descricao}</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
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
              <div><Label className="text-xs">Nome *</Label><Input value={novoFunilNome} onChange={(e) => setNovoFunilNome(e.target.value)} placeholder="Ex: Processos Cíveis" /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setNovoFunilOpen(false)}>Cancelar</Button>
              <Button onClick={() => criarFunilMut.mutate({ nome: novoFunilNome, comColunasPadrao: true })} disabled={!novoFunilNome || criarFunilMut.isPending}>
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
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 px-2">
        <Button variant="ghost" size="sm" onClick={() => setFunilAtivo(null)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Funis
        </Button>
        <h2 className="text-lg font-bold flex-1">{funilData?.funil?.nome || "Carregando..."}</h2>
        <Button size="sm" variant="outline" onClick={() => setNovaTagOpen(true)}>
          <Tag className="h-3.5 w-3.5 mr-1" /> Tags
        </Button>
        <Button size="sm" variant="outline" onClick={() => setNovaColunaOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Coluna
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm("Excluir funil e todos os cards?")) deletarFunilMut.mutate({ id: funilAtivo }); }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <FiltrosBar filtros={filtros} setFiltros={setFiltros} />

      {/* Toggle modo compacto + mostrar arquivados */}
      <div className="flex items-center gap-3 text-xs px-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Cards:</span>
          <div className="inline-flex rounded-md border bg-background">
            <button
              onClick={() => setModoCompacto(false)}
              className={`px-2.5 py-1 text-xs rounded-l-md ${!modoCompacto ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
            >
              Normal
            </button>
            <button
              onClick={() => setModoCompacto(true)}
              className={`px-2.5 py-1 text-xs rounded-r-md border-l ${modoCompacto ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
            >
              Compacto
            </button>
          </div>
        </div>
        <button
          onClick={() => setMostrarArquivados(!mostrarArquivados)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors ${
            mostrarArquivados
              ? "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
              : "bg-background text-muted-foreground border-border hover:bg-muted"
          }`}
          title={mostrarArquivados ? "Voltar a esconder arquivados" : "Mostrar cards arquivados"}
        >
          <Archive className="h-3.5 w-3.5" />
          {mostrarArquivados ? "Mostrando arquivados" : "Mostrar arquivados"}
        </button>
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
                    // Marca esse card como "drop target" se há outro card sendo arrastado.
                    if (dragCardId && dragCardId !== card.id) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverCardId(card.id);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverCardId === card.id) setDragOverCardId(null);
                  }}
                  onDrop={(e) => {
                    if (!dragCardId || dragCardId === card.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    handleDropOnCard(card.id, col.id);
                  }}
                  onClick={() => setCardAberto(card.id)}
                  className={`group rounded-lg border border-l-4 bg-card shadow-sm hover:shadow-md cursor-pointer active:cursor-grabbing transition-all ${
                    modoCompacto ? "px-2 py-1.5" : "p-3"
                  } ${PRIORIDADE_COR[card.prioridade] || ""} ${
                    dragOverCardId === card.id && dragCardId && dragCardId !== card.id
                      ? "ring-2 ring-primary ring-offset-1"
                      : ""
                  }`}
                  title={modoCompacto ? card.titulo : undefined}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      {card.prioridade === "alta" && (
                        <span className="relative flex h-2.5 w-2.5 shrink-0" title="Prioridade alta">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                        </span>
                      )}
                      {isAtrasado && !card.prioridade?.includes("alta") && (
                        <span className="relative flex h-2.5 w-2.5 shrink-0" title="Atrasado!">
                          <span className="animate-pulse h-2.5 w-2.5 rounded-full bg-amber-500" />
                        </span>
                      )}
                      <p className="text-xs font-semibold leading-tight">{card.titulo}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-destructive"
                      onClick={(e) => { e.stopPropagation(); deletarCardMut.mutate({ id: card.id }); }}>
                      <Trash2 className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                  {!modoCompacto && card.cnj && <p className="text-[10px] font-mono text-muted-foreground mt-1">{card.cnj}</p>}
                  {!modoCompacto && (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {card.clienteNome && (
                      <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground"><User className="h-2.5 w-2.5" />{card.clienteNome}</span>
                    )}
                    {(card as any).responsavelNome && (
                      <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
                        <ResponsavelAvatar nome={(card as any).responsavelNome} tamanho="sm" />
                        {(card as any).responsavelNome}
                      </span>
                    )}
                    {(card as any).acaoApelido && (
                      <span className="rounded border border-blue-200 bg-blue-50 px-1 py-0 text-[9px] text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300" title="Ação vinculada">
                        {(card as any).acaoApelido}
                      </span>
                    )}
                    {card.prazo && (
                      <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${isAtrasado ? "bg-red-100 text-red-700 font-bold" : "bg-blue-50 text-blue-700 font-medium"}`}>
                        <Clock className="h-3 w-3" />
                        {new Date(card.prazo).toLocaleDateString("pt-BR")}
                        {isAtrasado && " — ATRASADO"}
                      </span>
                    )}
                    {cardTags.map((tagNome: string, i: number) => {
                      const tagObj = tagsList.find((t: any) => t.nome === tagNome);
                      return (
                        <span key={i} className="text-[8px] px-1.5 py-0.5 rounded-full text-white font-medium" style={{ background: tagObj?.cor || "#6b7280" }}>
                          {tagNome}
                        </span>
                      );
                    })}
                  </div>
                  )}
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
                          <button key={c.id} onClick={() => { editarCardMut.mutate({ id: cardDetalhe.id, clienteId: c.id }); setBuscaCliente(""); }} className="w-full flex items-center gap-2 p-2 hover:bg-muted/50 text-left text-xs">
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
