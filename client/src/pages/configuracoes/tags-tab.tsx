/**
 * Aba Tags em Configurações — CRUD do catálogo de tags do escritório.
 *
 * Tags são single-source: a mesma tag aparece no Kanban (cards), no
 * cadastro de cliente e no SmartFlow. Editar aqui (renomear, mudar cor,
 * excluir) propaga em cascata pra todas as ocorrências via backend.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tag as TagIcon, Plus, Pencil, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const CORES_PRESET = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6b7280", // gray
];

interface Tag {
  id: number;
  nome: string;
  cor: string;
}

export function TagsTab({ canEdit }: { canEdit: boolean }) {
  const utils = (trpc as any).useUtils();
  const { data: tags, isLoading } = (trpc as any).kanban.listarTags.useQuery();

  const [criandoOpen, setCriandoOpen] = useState(false);
  const [editando, setEditando] = useState<Tag | null>(null);
  const [excluindo, setExcluindo] = useState<Tag | null>(null);

  const criar = (trpc as any).kanban.criarTag.useMutation({
    onSuccess: () => {
      utils.kanban.listarTags.invalidate();
      setCriandoOpen(false);
      toast.success("Tag criada");
    },
    onError: (err: any) => toast.error(err.message || "Falha ao criar tag"),
  });

  const editar = (trpc as any).kanban.editarTag.useMutation({
    onSuccess: () => {
      utils.kanban.listarTags.invalidate();
      utils.clientes?.listar?.invalidate?.();
      setEditando(null);
      toast.success("Tag atualizada");
    },
    onError: (err: any) => toast.error(err.message || "Falha ao editar tag"),
  });

  const deletar = (trpc as any).kanban.deletarTag.useMutation({
    onSuccess: (r: any) => {
      utils.kanban.listarTags.invalidate();
      utils.clientes?.listar?.invalidate?.();
      setExcluindo(null);
      const total = (r?.removidos?.contatos || 0) + (r?.removidos?.cards || 0);
      toast.success(total > 0 ? `Tag excluída — removida de ${total} registro(s)` : "Tag excluída");
    },
    onError: (err: any) => toast.error(err.message || "Falha ao excluir tag"),
  });

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <TagIcon className="h-4 w-4" /> Tags do Escritório
          </CardTitle>
          <CardDescription>
            Categorize clientes e cards. As tags aparecem no Kanban, cadastro de cliente e SmartFlow.
          </CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setCriandoOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Nova tag
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-sm text-muted-foreground">Carregando...</div>
        ) : !tags || tags.length === 0 ? (
          <div className="text-center py-12">
            <TagIcon className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-2">Nenhuma tag configurada ainda</p>
            <p className="text-xs text-muted-foreground/70 mb-4">
              Tags ajudam a categorizar clientes (VIP, Trabalhista, Empresarial...) e ficam disponíveis em todo o sistema.
            </p>
            {canEdit && (
              <Button size="sm" onClick={() => setCriandoOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Criar primeira tag
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tags.map((t: Tag) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 p-2 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
              >
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium text-white"
                  style={{ background: t.cor }}
                >
                  {t.nome}
                </span>
                {canEdit && (
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setEditando(t)}
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => setExcluindo(t)}
                      title="Excluir"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Dialog: Criar — re-monta a cada abertura pra resetar o form */}
      {criandoOpen && (
        <TagFormDialog
          open={true}
          onClose={() => setCriandoOpen(false)}
          title="Nova tag"
          initialNome=""
          initialCor={CORES_PRESET[0]}
          loading={criar.isPending}
          onSubmit={(nome, cor) => criar.mutate({ nome, cor })}
        />
      )}

      {/* Dialog: Editar */}
      {editando && (
        <TagFormDialog
          open={true}
          onClose={() => setEditando(null)}
          title={`Editar "${editando.nome}"`}
          initialNome={editando.nome}
          initialCor={editando.cor}
          loading={editar.isPending}
          onSubmit={(nome, cor) =>
            editar.mutate({
              id: editando.id,
              nome: nome !== editando.nome ? nome : undefined,
              cor: cor !== editando.cor ? cor : undefined,
            })
          }
          aviso="Renomear vai atualizar a tag em todos os clientes e cards onde ela aparece."
        />
      )}

      {/* Dialog: Excluir */}
      {excluindo && (
        <ExcluirTagDialog
          tag={excluindo}
          onClose={() => setExcluindo(null)}
          onConfirm={() => deletar.mutate({ id: excluindo.id })}
          loading={deletar.isPending}
        />
      )}
    </Card>
  );
}

// ─── Form Dialog (criar / editar) ───────────────────────────────────────────

function TagFormDialog({
  open,
  onClose,
  title,
  initialNome,
  initialCor,
  loading,
  onSubmit,
  aviso,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  initialNome: string;
  initialCor: string;
  loading: boolean;
  onSubmit: (nome: string, cor: string) => void;
  aviso?: string;
}) {
  const [nome, setNome] = useState(initialNome);
  const [cor, setCor] = useState(initialCor);

  function handleSubmit() {
    const n = nome.trim();
    if (!n) {
      toast.error("Informe o nome da tag");
      return;
    }
    if (n.length > 32) {
      toast.error("Nome muito longo (máx 32 caracteres)");
      return;
    }
    onSubmit(n, cor);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {aviso && <DialogDescription>{aviso}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: VIP, Trabalhista, Empresarial..."
              maxLength={32}
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Cor</Label>
            <div className="flex flex-wrap gap-1.5">
              {CORES_PRESET.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  className={`h-7 w-7 rounded-full transition-all ${
                    cor === c ? "ring-2 ring-offset-2 ring-foreground scale-110" : "hover:scale-105"
                  }`}
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Preview</Label>
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium text-white"
              style={{ background: cor }}
            >
              {nome.trim() || "Tag"}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !nome.trim()}>
            {loading && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Excluir Dialog (com aviso de uso) ──────────────────────────────────────

function ExcluirTagDialog({
  tag,
  onClose,
  onConfirm,
  loading,
}: {
  tag: Tag;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  const { data: uso, isLoading: loadingUso } = (trpc as any).kanban.usoTag.useQuery({ id: tag.id });
  const totalUso = (uso?.contatos || 0) + (uso?.cards || 0);

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Excluir tag &ldquo;{tag.nome}&rdquo;?
          </DialogTitle>
          <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {loadingUso ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando uso...
            </div>
          ) : totalUso === 0 ? (
            <p className="text-sm text-muted-foreground">Esta tag não está em uso. Pode excluir tranquilo.</p>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 space-y-1.5">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                A tag está em uso em {totalUso} registro{totalUso > 1 ? "s" : ""}:
              </p>
              <ul className="text-xs text-amber-800 dark:text-amber-300 list-disc list-inside space-y-0.5">
                {uso.contatos > 0 && (
                  <li>
                    {uso.contatos} cliente{uso.contatos > 1 ? "s" : ""}
                  </li>
                )}
                {uso.cards > 0 && (
                  <li>
                    {uso.cards} card{uso.cards > 1 ? "s" : ""} no Kanban
                  </li>
                )}
              </ul>
              <p className="text-xs text-amber-800 dark:text-amber-300 pt-1">
                Ao excluir, a tag será <strong>removida automaticamente</strong> de todos esses registros.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading || loadingUso}>
            {loading && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            {totalUso > 0 ? "Excluir mesmo assim" : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
