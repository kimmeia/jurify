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
  ExternalLink, ArrowRight, Tag, X, Settings,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

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
  const [cardAberto, setCardAberto] = useState<number | null>(null);
  const [novaTagOpen, setNovaTagOpen] = useState(false);
  const [novaTagNome, setNovaTagNome] = useState("");
  const [novaTagCor, setNovaTagCor] = useState("#6366f1");
  const [novoFunilNome, setNovoFunilNome] = useState("");
  const [novoCardOpen, setNovoCardOpen] = useState<number | null>(null); // colunaId
  const [novaColunaOpen, setNovaColunaOpen] = useState(false);
  const [novaColunaNome, setNovaColunaNome] = useState("");
  const [cardForm, setCardForm] = useState({ titulo: "", descricao: "", cnj: "", prioridade: "media", prazo: "", tags: "", urgente: false });
  const [buscaCliente, setBuscaCliente] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState<any>(null);

  const { data: funis, refetch: refetchFunis } = (trpc as any).kanban.listarFunis.useQuery();
  const { data: funilData, refetch: refetchFunil } = (trpc as any).kanban.obterFunil.useQuery(
    { funilId: funilAtivo! },
    { enabled: !!funilAtivo },
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

  // Detalhe card
  const { data: cardDetalhe, refetch: refetchDetalhe } = (trpc as any).kanban.detalheCard.useQuery(
    { id: cardAberto! },
    { enabled: !!cardAberto },
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
  const criarCardMut = (trpc as any).kanban.criarCard.useMutation({
    onSuccess: () => { toast.success("Card criado!"); setNovoCardOpen(null); setCardForm({ titulo: "", descricao: "", cnj: "", prioridade: "media", prazo: "", tags: "", urgente: false }); setClienteSelecionado(null); setBuscaCliente(""); refetchFunil(); },
    onError: (e: any) => toast.error(e.message),
  });
  const deletarCardMut = (trpc as any).kanban.deletarCard.useMutation({
    onSuccess: () => refetchFunil(),
    onError: (e: any) => toast.error(e.message),
  });
  const moverCardMut = (trpc as any).kanban.moverCard.useMutation({
    onSuccess: () => refetchFunil(),
  });

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

  // Drag state simples
  const [dragCardId, setDragCardId] = useState<number | null>(null);

  const handleDrop = (colunaDestinoId: number) => {
    if (dragCardId && colunaDestinoId) {
      moverCardMut.mutate({ cardId: dragCardId, colunaDestinoId });
      setDragCardId(null);
    }
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

      {/* Colunas */}
      <div className="flex gap-4 overflow-x-auto pb-4 px-2" style={{ minHeight: "70vh" }}>
        {colunas.map((col: any) => (
          <div
            key={col.id}
            className="flex-shrink-0 w-72 bg-muted/30 rounded-xl p-3 space-y-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(col.id)}
          >
            {/* Header coluna */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ background: col.cor || "#6b7280" }} />
                <p className="text-xs font-semibold uppercase tracking-wide">{col.nome}</p>
                <Badge variant="outline" className="text-[9px] h-4 px-1">{col.cards?.length || 0}</Badge>
              </div>
              <div className="flex gap-0.5">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setNovoCardOpen(col.id)}>
                  <Plus className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => { if (confirm(`Excluir coluna "${col.nome}" e seus cards?`)) deletarColunaMut.mutate({ id: col.id }); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Cards */}
            {(col.cards || []).map((card: any) => {
              const tagsList = tags || [];
              const cardTags = card.tags ? card.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
              const isAtrasado = card.atrasado || (card.prazo && new Date(card.prazo) < new Date());

              return (
                <div
                  key={card.id}
                  draggable
                  onDragStart={() => setDragCardId(card.id)}
                  onDragEnd={() => setDragCardId(null)}
                  onClick={() => setCardAberto(card.id)}
                  className={`group rounded-lg border border-l-4 p-3 bg-card shadow-sm hover:shadow-md cursor-pointer active:cursor-grabbing transition-all ${PRIORIDADE_COR[card.prioridade] || ""}`}
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
                  {card.cnj && <p className="text-[10px] font-mono text-muted-foreground mt-1">{card.cnj}</p>}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {card.clienteNome && (
                      <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground"><User className="h-2.5 w-2.5" />{card.clienteNome}</span>
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
                </div>
              );
            })}

            {/* Botão add card no fundo */}
            <button
              onClick={() => setNovoCardOpen(col.id)}
              className="w-full py-2 text-xs text-muted-foreground hover:text-foreground border border-dashed rounded-lg hover:border-solid transition-colors"
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
                <Button variant="ghost" size="sm" onClick={() => setCardAberto(null)}><X className="h-4 w-4" /></Button>
              </div>

              {/* Edição inline */}
              <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
                <p className="text-[10px] font-semibold text-muted-foreground">EDITAR</p>
                <div><Label className="text-[10px]">Título</Label><Input defaultValue={cardDetalhe.titulo} onBlur={(e) => { if (e.target.value !== cardDetalhe.titulo) editarCardMut.mutate({ id: cardDetalhe.id, titulo: e.target.value }); }} /></div>
                <div><Label className="text-[10px]">CNJ</Label><Input defaultValue={cardDetalhe.cnj || ""} className="font-mono" onBlur={(e) => editarCardMut.mutate({ id: cardDetalhe.id, cnj: e.target.value || undefined })} /></div>
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

              {/* Histórico de movimentações */}
              {cardDetalhe.movimentacoes?.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground mb-2">HISTÓRICO</p>
                  <div className="space-y-2">
                    {cardDetalhe.movimentacoes.map((m: any) => (
                      <div key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ArrowRight className="h-3 w-3 shrink-0" />
                        <span>{m.colunaOrigemNome} → {m.colunaDestinoNome}</span>
                        <span className="text-[9px] ml-auto">{new Date(m.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[10px] text-muted-foreground pt-2 border-t">
                Criado em {new Date(cardDetalhe.createdAt).toLocaleDateString("pt-BR")}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
