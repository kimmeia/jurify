/**
 * Roadmap público — clientes mandam ideias de melhoria e votam.
 *
 * Etapa 3/4 do checklist pré-lançamento. Auth: qualquer user logado.
 * Admin (role=admin) ganha um Select pra trocar status do item.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Lightbulb, ThumbsUp, Plus, Search, ChevronLeft, ChevronRight, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const CATEGORIA_META: Record<string, { label: string; cor: string }> = {
  feature: { label: "Funcionalidade", cor: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  bug: { label: "Bug", cor: "bg-red-500/10 text-red-700 dark:text-red-300" },
  melhoria: { label: "Melhoria", cor: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
};

const STATUS_META: Record<string, { label: string; cor: string }> = {
  novo: { label: "Novo", cor: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  em_analise: { label: "Em análise", cor: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  planejado: { label: "Planejado", cor: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  em_desenvolvimento: { label: "Em desenvolvimento", cor: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  lancado: { label: "Lançado", cor: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  recusado: { label: "Recusado", cor: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" },
};

const STATUS_VALORES = ["novo", "em_analise", "planejado", "em_desenvolvimento", "lancado", "recusado"] as const;

export default function Roadmap() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [status, setStatus] = useState<"todos" | typeof STATUS_VALORES[number]>("todos");
  const [categoria, setCategoria] = useState<"todos" | "feature" | "bug" | "melhoria">("todos");
  const [ordenacao, setOrdenacao] = useState<"votos" | "recente">("votos");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novaDescricao, setNovaDescricao] = useState("");
  const [novaCategoria, setNovaCategoria] = useState<"feature" | "bug" | "melhoria">("melhoria");

  const limite = 20;
  const { data, isLoading, refetch } = (trpc as any).roadmap.listar.useQuery({
    status, categoria, ordenacao, busca: busca || undefined, limite, pagina,
  });

  const criarMut = (trpc as any).roadmap.criar.useMutation({
    onSuccess: () => {
      toast.success("Sugestão enviada! Obrigado por contribuir.");
      setNovoOpen(false);
      setNovoTitulo("");
      setNovaDescricao("");
      setNovaCategoria("melhoria");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const votarMut = (trpc as any).roadmap.votar.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarStatusMut = (trpc as any).roadmap.atualizarStatus.useMutation({
    onSuccess: () => { toast.success("Status atualizado"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const itens = data?.itens ?? [];
  const totalPaginas = data?.totalPaginas ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-amber-500" />
            Roadmap
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Sugira melhorias e vote nas ideias de outros usuários. Os itens mais
            votados sobem na fila.
          </p>
        </div>
        <Button onClick={() => setNovoOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Sugerir melhoria
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3">
            <Select value={status} onValueChange={(v) => { setStatus(v as any); setPagina(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {STATUS_VALORES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoria} onValueChange={(v) => { setCategoria(v as any); setPagina(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as categorias</SelectItem>
                <SelectItem value="feature">Funcionalidade</SelectItem>
                <SelectItem value="melhoria">Melhoria</SelectItem>
                <SelectItem value="bug">Bug</SelectItem>
              </SelectContent>
            </Select>
            <Select value={ordenacao} onValueChange={(v) => { setOrdenacao(v as any); setPagina(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="votos">Mais votados</SelectItem>
                <SelectItem value="recente">Mais recentes</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={busca}
                onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
                className="pl-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : itens.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Lightbulb className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              {busca || status !== "todos" || categoria !== "todos"
                ? "Nada encontrado nos filtros atuais."
                : "Nenhuma sugestão ainda. Seja o primeiro!"}
            </p>
            <Button onClick={() => setNovoOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Sugerir melhoria
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {itens.map((item: any) => (
            <Card key={item.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-3">
                <div className="flex gap-4">
                  {/* Botão votar */}
                  <button
                    onClick={() => votarMut.mutate({ itemId: item.id })}
                    disabled={votarMut.isPending}
                    className={`flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg border transition-all min-w-[60px] ${
                      item.jaVotou
                        ? "bg-amber-500/10 border-amber-400 text-amber-700 dark:text-amber-300"
                        : "hover:bg-muted/50 border-border text-muted-foreground"
                    }`}
                    title={item.jaVotou ? "Cancelar voto" : "Votar"}
                  >
                    <ThumbsUp className="h-4 w-4" />
                    <span className="text-sm font-bold">{item.contagemVotos}</span>
                  </button>

                  {/* Conteúdo */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <Badge variant="secondary" className={`text-[10px] ${CATEGORIA_META[item.categoria]?.cor}`}>
                        {CATEGORIA_META[item.categoria]?.label || item.categoria}
                      </Badge>
                      <Badge variant="secondary" className={`text-[10px] ${STATUS_META[item.status]?.cor}`}>
                        {STATUS_META[item.status]?.label || item.status}
                      </Badge>
                    </div>
                    <p className="font-medium text-sm mt-2">{item.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
                      {item.descricao}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                      <span>por <b>{item.autorNome}</b></span>
                      <span>•</span>
                      <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ptBR })}</span>
                    </div>

                    {/* Admin: trocar status */}
                    {isAdmin && (
                      <div className="mt-3">
                        <Select
                          value={item.status}
                          onValueChange={(v) => atualizarStatusMut.mutate({ id: item.id, status: v })}
                        >
                          <SelectTrigger className="h-7 w-[200px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_VALORES.map((s) => (
                              <SelectItem key={s} value={s} className="text-xs">
                                {STATUS_META[s].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Paginação */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={pagina === 1}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {pagina} de {totalPaginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPagina((p) => p + 1)}
            disabled={pagina >= totalPaginas}
          >
            Próxima <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Dialog nova sugestão */}
      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Sugerir melhoria</DialogTitle>
            <DialogDescription>
              Descreva uma ideia de funcionalidade, melhoria ou bug. Outros usuários
              podem votar — as ideias mais votadas viram prioridade.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={novaCategoria} onValueChange={(v) => setNovaCategoria(v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="feature">Funcionalidade nova</SelectItem>
                  <SelectItem value="melhoria">Melhoria de algo existente</SelectItem>
                  <SelectItem value="bug">Algo que está quebrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Título *</Label>
              <Input
                value={novoTitulo}
                onChange={(e) => setNovoTitulo(e.target.value)}
                placeholder="Ex: Permitir importar contatos por planilha"
                maxLength={255}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Descrição *</Label>
              <Textarea
                value={novaDescricao}
                onChange={(e) => setNovaDescricao(e.target.value)}
                placeholder="O quê? Por quê? Cenário concreto?"
                rows={4}
                maxLength={2000}
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {novaDescricao.length}/2000 caracteres (mínimo 10)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => criarMut.mutate({ titulo: novoTitulo, descricao: novaDescricao, categoria: novaCategoria })}
              disabled={criarMut.isPending || novoTitulo.trim().length < 3 || novaDescricao.trim().length < 10}
            >
              {criarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
