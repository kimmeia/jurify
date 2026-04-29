/**
 * Aba "Campos personalizados" em Configurações — CRUD do catálogo de
 * campos extras do cadastro de cliente (ex: "Número OAB", "Data
 * audiência"). Os valores ficam em `contatos.camposPersonalizados`
 * (JSON) e a definição aqui.
 *
 * Disponíveis no SmartFlow como `{{cliente.campos.<chave>}}`.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Sparkles, Plus, Pencil, Trash2, Loader2, AlertTriangle, X, GripVertical } from "lucide-react";
import { toast } from "sonner";

type TipoCampo = "texto" | "numero" | "data" | "textarea" | "select" | "boolean";

interface Campo {
  id: number;
  chave: string;
  label: string;
  tipo: TipoCampo;
  opcoes: string[] | null;
  ajuda: string | null;
  obrigatorio: boolean;
  ordem: number;
}

const TIPOS_LABEL: Record<TipoCampo, string> = {
  texto: "Texto curto",
  numero: "Número",
  data: "Data",
  textarea: "Texto longo",
  select: "Lista (seleção)",
  boolean: "Sim/Não",
};

/** Gera slug camelCase a partir do label.
 *  "Número da OAB" → "numeroDaOab" */
function gerarChave(label: string): string {
  const limpo = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .toLowerCase();
  const partes = limpo.split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  return partes
    .map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join("");
}

export function CamposClienteTab({ canEdit }: { canEdit: boolean }) {
  const utils = (trpc as any).useUtils();
  const { data: campos, isLoading } = (trpc as any).camposCliente.listar.useQuery();

  const [criandoOpen, setCriandoOpen] = useState(false);
  const [editando, setEditando] = useState<Campo | null>(null);
  const [excluindo, setExcluindo] = useState<Campo | null>(null);

  const criar = (trpc as any).camposCliente.criar.useMutation({
    onSuccess: () => {
      utils.camposCliente.listar.invalidate();
      utils.smartflow?.catalogoVariaveis?.invalidate?.();
      setCriandoOpen(false);
      toast.success("Campo criado");
    },
    onError: (err: any) => toast.error(err.message || "Falha ao criar campo"),
  });

  const editar = (trpc as any).camposCliente.editar.useMutation({
    onSuccess: () => {
      utils.camposCliente.listar.invalidate();
      utils.smartflow?.catalogoVariaveis?.invalidate?.();
      setEditando(null);
      toast.success("Campo atualizado");
    },
    onError: (err: any) => toast.error(err.message || "Falha ao editar campo"),
  });

  const excluir = (trpc as any).camposCliente.excluir.useMutation({
    onSuccess: (r: any) => {
      utils.camposCliente.listar.invalidate();
      utils.smartflow?.catalogoVariaveis?.invalidate?.();
      setExcluindo(null);
      toast.success(
        r?.removidos > 0
          ? `Campo excluído — removido de ${r.removidos} cliente(s)`
          : "Campo excluído",
      );
    },
    onError: (err: any) => toast.error(err.message || "Falha ao excluir campo"),
  });

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Campos personalizados
          </CardTitle>
          <CardDescription>
            Capture informações específicas do seu escritório no cadastro do cliente. Disponíveis no SmartFlow como <code className="text-[10px]">{`{{cliente.campos.chave}}`}</code>.
          </CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setCriandoOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Novo campo
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-sm text-muted-foreground">Carregando...</div>
        ) : !campos || campos.length === 0 ? (
          <div className="text-center py-12">
            <Sparkles className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-2">Nenhum campo configurado ainda</p>
            <p className="text-xs text-muted-foreground/70 mb-4 max-w-md mx-auto">
              Exemplos: &ldquo;Número OAB&rdquo;, &ldquo;Data da audiência&rdquo;, &ldquo;Tipo de processo&rdquo;, &ldquo;Vara&rdquo;... Os campos aparecem no cadastro de cliente e ficam disponíveis no SmartFlow.
            </p>
            {canEdit && (
              <Button size="sm" onClick={() => setCriandoOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Criar primeiro campo
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {campos.map((c: Campo) => (
              <div
                key={c.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{c.label}</span>
                    {c.obrigatorio && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                        obrigatório
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
                      {TIPOS_LABEL[c.tipo]}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    {`{{cliente.campos.${c.chave}}}`}
                  </div>
                  {c.ajuda && (
                    <div className="text-[11px] text-muted-foreground/80 mt-0.5 italic">
                      {c.ajuda}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setEditando(c)}
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => setExcluindo(c)}
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

      {/* Dialog: Criar */}
      {criandoOpen && (
        <CampoFormDialog
          onClose={() => setCriandoOpen(false)}
          title="Novo campo personalizado"
          loading={criar.isPending}
          onSubmit={(d) => criar.mutate(d)}
          chavesEmUso={(campos || []).map((c: Campo) => c.chave)}
        />
      )}

      {/* Dialog: Editar */}
      {editando && (
        <CampoFormDialog
          onClose={() => setEditando(null)}
          title={`Editar "${editando.label}"`}
          loading={editar.isPending}
          inicial={editando}
          onSubmit={(d) => editar.mutate({ id: editando.id, ...d })}
          chavesEmUso={(campos || []).filter((c: Campo) => c.id !== editando.id).map((c: Campo) => c.chave)}
        />
      )}

      {/* Dialog: Excluir */}
      {excluindo && (
        <Dialog open={true} onOpenChange={(o) => !o && setExcluindo(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Excluir campo &ldquo;{excluindo.label}&rdquo;?
              </DialogTitle>
              <DialogDescription>
                O campo será removido do catálogo, dos cadastros de cliente que o tenham preenchido,
                e qualquer fluxo SmartFlow que use <code className="text-[10px] font-mono">{`{{cliente.campos.${excluindo.chave}}}`}</code> vai
                resolver pra string vazia.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setExcluindo(null)} disabled={excluir.isPending}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => excluir.mutate({ id: excluindo.id })}
                disabled={excluir.isPending}
              >
                {excluir.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ─── Form (criar / editar) ─────────────────────────────────────────────────

interface FormData {
  chave: string;
  label: string;
  tipo: TipoCampo;
  opcoes?: string[];
  ajuda?: string;
  obrigatorio: boolean;
}

function CampoFormDialog({
  onClose,
  title,
  loading,
  inicial,
  onSubmit,
  chavesEmUso,
}: {
  onClose: () => void;
  title: string;
  loading: boolean;
  inicial?: Campo;
  onSubmit: (d: FormData) => void;
  chavesEmUso: string[];
}) {
  const [label, setLabel] = useState(inicial?.label || "");
  const [chave, setChave] = useState(inicial?.chave || "");
  const [chaveTouched, setChaveTouched] = useState(!!inicial);
  const [tipo, setTipo] = useState<TipoCampo>(inicial?.tipo || "texto");
  const [ajuda, setAjuda] = useState(inicial?.ajuda || "");
  const [obrigatorio, setObrigatorio] = useState(inicial?.obrigatorio || false);
  const [opcoes, setOpcoes] = useState<string[]>(inicial?.opcoes || []);
  const [novaOpcao, setNovaOpcao] = useState("");

  // Auto-gera chave a partir do label enquanto não editou manualmente
  function handleLabelChange(v: string) {
    setLabel(v);
    if (!chaveTouched) {
      setChave(gerarChave(v));
    }
  }

  const conflitoChave = useMemo(
    () => !!chave && chavesEmUso.some((c) => c.toLowerCase() === chave.toLowerCase()),
    [chave, chavesEmUso],
  );

  function adicionarOpcao() {
    const o = novaOpcao.trim();
    if (!o) return;
    if (opcoes.includes(o)) {
      toast.error("Opção já existe");
      return;
    }
    setOpcoes([...opcoes, o]);
    setNovaOpcao("");
  }

  function removerOpcao(idx: number) {
    setOpcoes(opcoes.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    if (!label.trim()) {
      toast.error("Informe o nome do campo");
      return;
    }
    if (!chave.trim()) {
      toast.error("Informe a chave");
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(chave)) {
      toast.error("Chave deve começar com letra e conter só letras, números e _");
      return;
    }
    if (conflitoChave) {
      toast.error("Já existe um campo com essa chave");
      return;
    }
    if (tipo === "select" && opcoes.length === 0) {
      toast.error("Adicione pelo menos uma opção pra Lista");
      return;
    }
    onSubmit({
      chave,
      label,
      tipo,
      opcoes: tipo === "select" ? opcoes : undefined,
      ajuda: ajuda || undefined,
      obrigatorio,
    });
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Nome do campo</Label>
            <Input
              value={label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="Ex: Número OAB, Data da audiência..."
              maxLength={64}
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs">
              Chave (usada nas variáveis)
            </Label>
            <Input
              value={chave}
              onChange={(e) => {
                setChave(e.target.value);
                setChaveTouched(true);
              }}
              placeholder="numeroOab"
              maxLength={48}
              className={conflitoChave ? "border-destructive" : "font-mono text-xs"}
            />
            <p className={`text-[10px] mt-1 ${conflitoChave ? "text-destructive" : "text-muted-foreground"}`}>
              {conflitoChave
                ? "Chave já em uso por outro campo"
                : `No SmartFlow: {{cliente.campos.${chave || "chave"}}}`}
            </p>
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoCampo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIPOS_LABEL) as TipoCampo[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPOS_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {tipo === "select" && (
            <div>
              <Label className="text-xs">Opções da lista</Label>
              <div className="flex gap-1.5 mb-2">
                <Input
                  value={novaOpcao}
                  onChange={(e) => setNovaOpcao(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      adicionarOpcao();
                    }
                  }}
                  placeholder="Ex: Trabalhista"
                  maxLength={64}
                  className="h-8 text-xs"
                />
                <Button type="button" size="sm" onClick={adicionarOpcao} className="h-8">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {opcoes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {opcoes.map((o, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary"
                    >
                      {o}
                      <button
                        type="button"
                        onClick={() => removerOpcao(idx)}
                        className="hover:bg-foreground/10 rounded-full p-0.5"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <Label className="text-xs">Texto de ajuda (opcional)</Label>
            <Textarea
              value={ajuda}
              onChange={(e) => setAjuda(e.target.value)}
              rows={2}
              maxLength={200}
              placeholder="Aparece como hint abaixo do campo no formulário"
              className="text-xs"
            />
          </div>
          <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
            <div>
              <Label className="text-xs cursor-pointer" htmlFor="obrigatorio-switch">
                Campo obrigatório
              </Label>
              <p className="text-[10px] text-muted-foreground">
                Bloqueia salvar cliente sem este preenchido
              </p>
            </div>
            <Switch
              id="obrigatorio-switch"
              checked={obrigatorio}
              onCheckedChange={setObrigatorio}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !label.trim() || !chave.trim() || conflitoChave}>
            {loading && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
