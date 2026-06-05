/**
 * Aba Templates de Mensagem em Configurações.
 *
 * Cada template é um "ativo do escritório" — só dono/gestor cria/edita/
 * exclui. Todos os atendentes consomem via popover do botão ⚡ no chat
 * (Atendimento.tsx) e via atalho `/nome` no composer.
 *
 * Suporta variáveis `{{nome}}`, `{{telefone}}`, `{{email}}`, `{{atendente}}`,
 * `{{escritorio}}` que são interpoladas com dados do contato/usuário no
 * momento de escolher o template. Mídia (PDF/imagem) é opcional — quando
 * presente, vai junto com o texto na próxima mensagem enviada.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MessageSquare, Plus, Pencil, Trash2, Loader2, Image as ImageIcon, FileText, Paperclip, Upload, X,
} from "lucide-react";
import { toast } from "sonner";

type Categoria = "saudacao" | "cobranca" | "agendamento" | "juridico" | "encerramento" | "outro";
type MidiaTipo = "imagem" | "video" | "audio" | "documento";

const CATEGORIA_LABEL: Record<Categoria, string> = {
  saudacao: "Saudação",
  cobranca: "Cobrança",
  agendamento: "Agendamento",
  juridico: "Jurídico",
  encerramento: "Encerramento",
  outro: "Outro",
};
const CATEGORIA_COR: Record<Categoria, string> = {
  saudacao: "bg-blue-100 text-blue-700",
  cobranca: "bg-amber-100 text-amber-700",
  agendamento: "bg-violet-100 text-violet-700",
  juridico: "bg-indigo-100 text-indigo-700",
  encerramento: "bg-emerald-100 text-emerald-700",
  outro: "bg-slate-100 text-slate-600",
};

const VARIAVEIS_DISPONIVEIS: Array<{ key: string; descricao: string; exemplo: string }> = [
  { key: "nome", descricao: "Nome do contato atual", exemplo: "Marcos Silva" },
  { key: "telefone", descricao: "Telefone do contato", exemplo: "(11) 99999-1234" },
  { key: "email", descricao: "Email do contato", exemplo: "marcos@exemplo.com" },
  { key: "atendente", descricao: "Nome do atendente logado", exemplo: "Rafael Rocha" },
  { key: "escritorio", descricao: "Nome do escritório", exemplo: "Boyadjian Advocacia" },
];

export function TemplatesTab() {
  const utils = trpc.useUtils();
  const { data: lista, isLoading } = (trpc as any).templates.listar.useQuery(undefined, { retry: false });
  const [editando, setEditando] = useState<any | null>(null);
  const [criando, setCriando] = useState(false);
  const [excluindo, setExcluindo] = useState<any | null>(null);

  const excluirMut = (trpc as any).templates.excluir.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success("Template removido");
      setExcluindo(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const templates = (lista || []) as any[];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-violet-600" />
              Templates de mensagem
            </CardTitle>
            <CardDescription>
              Respostas prontas pro chat de atendimento. Suporta variáveis <code className="text-xs">{`{{nome}}`}</code>, mídia anexada e atalhos como <code className="text-xs">/oi</code>.
            </CardDescription>
          </div>
          <Button onClick={() => setCriando(true)}>
            <Plus className="h-4 w-4 mr-2" /> Novo template
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : templates.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p>Nenhum template cadastrado.</p>
            <p className="text-xs mt-1">Crie o primeiro pra acelerar respostas do time.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-medium text-sm">{t.titulo}</h4>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CATEGORIA_COR[t.categoria as Categoria] || CATEGORIA_COR.outro}`}>
                      {CATEGORIA_LABEL[t.categoria as Categoria] || t.categoria}
                    </span>
                    {t.atalho && (
                      <span className="font-mono text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
                        /{t.atalho}
                      </span>
                    )}
                    {t.midiaTipo && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                        {t.midiaTipo === "imagem" ? <ImageIcon className="h-2.5 w-2.5" /> :
                         t.midiaTipo === "documento" ? <FileText className="h-2.5 w-2.5" /> :
                         <Paperclip className="h-2.5 w-2.5" />}
                        {t.midiaTipo}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{t.conteudo}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditando(t)} title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setExcluindo(t)} title="Excluir">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <TemplateDialog
        open={criando || !!editando}
        editando={editando}
        onClose={() => { setCriando(false); setEditando(null); }}
        onSaved={() => { utils.invalidate(); setCriando(false); setEditando(null); }}
      />

      <AlertDialog open={!!excluindo} onOpenChange={(o) => !o && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              O template <strong>"{excluindo?.titulo}"</strong> será removido permanentemente. Atendentes não vão mais conseguir usá-lo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => excluindo && excluirMut.mutate({ id: excluindo.id })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function TemplateDialog({
  open, editando, onClose, onSaved,
}: {
  open: boolean;
  editando: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("outro");
  const [atalho, setAtalho] = useState("");
  const [midiaUrl, setMidiaUrl] = useState<string | null>(null);
  const [midiaTipo, setMidiaTipo] = useState<MidiaTipo | null>(null);

  // Hidrata estado ao abrir (criar = limpa, editar = preenche). useEffect
  // dispara sempre que o `editando` referência muda — clicar em outro
  // template existente re-popula sem precisar fechar/abrir.
  useEffect(() => {
    if (!open) return;
    setTitulo(editando?.titulo ?? "");
    setConteudo(editando?.conteudo ?? "");
    setCategoria((editando?.categoria as Categoria) ?? "outro");
    setAtalho(editando?.atalho ?? "");
    setMidiaUrl(editando?.midiaUrl ?? null);
    setMidiaTipo((editando?.midiaTipo as MidiaTipo) ?? null);
  }, [open, editando]);

  const criarMut = (trpc as any).templates.criar.useMutation({
    onSuccess: () => { toast.success("Template criado"); onSaved(); resetar(); },
    onError: (e: any) => toast.error(e.message),
  });
  const atualizarMut = (trpc as any).templates.atualizar.useMutation({
    onSuccess: () => { toast.success("Template atualizado"); onSaved(); resetar(); },
    onError: (e: any) => toast.error(e.message),
  });
  const uploadMut = (trpc as any).upload.enviar.useMutation({
    onError: (e: any) => toast.error(e.message),
  });

  const resetar = () => {
    setTitulo(""); setConteudo(""); setCategoria("outro"); setAtalho("");
    setMidiaUrl(null); setMidiaTipo(null);
  };

  const inferirTipo = (mime: string, nome: string): MidiaTipo => {
    if (mime.startsWith("image/")) return "imagem";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "documento";
  };

  const onUpload = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = String(reader.result || "").split(",")[1] || "";
      const r = await uploadMut.mutateAsync({
        nome: file.name,
        tipo: file.type || "application/octet-stream",
        base64,
        tamanho: file.size,
      });
      if (r?.url) {
        setMidiaUrl(r.url);
        setMidiaTipo(inferirTipo(file.type || "", file.name));
        toast.success("Arquivo anexado");
      }
    };
    reader.readAsDataURL(file);
  };

  const submeter = () => {
    if (!titulo.trim() || !conteudo.trim()) {
      toast.error("Preencha título e conteúdo");
      return;
    }
    const payload = {
      titulo: titulo.trim(),
      conteudo: conteudo.trim(),
      categoria,
      atalho: atalho.trim() || undefined,
      midiaUrl: midiaUrl || undefined,
      midiaTipo: midiaTipo || undefined,
    };
    if (editando) {
      atualizarMut.mutate({ id: editando.id, ...payload });
    } else {
      criarMut.mutate(payload);
    }
  };

  const isPending = criarMut.isPending || atualizarMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { resetar(); onClose(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar template" : "Novo template"}</DialogTitle>
          <DialogDescription>
            Use <code className="text-xs">{`{{nome}}`}</code>, <code className="text-xs">{`{{telefone}}`}</code> etc. — substituem com dados do contato no chat.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex: Boas-vindas"
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={categoria} onValueChange={(v) => setCategoria(v as Categoria)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORIA_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Conteúdo *</Label>
              <span className="text-[10px] text-muted-foreground">{conteudo.length}/2000</span>
            </div>
            <Textarea
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
              placeholder="Olá {{nome}}, tudo bem? Sou {{atendente}} do {{escritorio}}…"
              maxLength={2000}
              rows={5}
              className="font-mono text-xs"
            />
            <div className="rounded-md border border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-900 p-2 text-[11px]">
              <p className="font-semibold mb-1 text-violet-900 dark:text-violet-200">Variáveis disponíveis (clique pra inserir):</p>
              <div className="flex flex-wrap gap-1">
                {VARIAVEIS_DISPONIVEIS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setConteudo((c) => c + `{{${v.key}}}`)}
                    title={`${v.descricao} (ex: ${v.exemplo})`}
                    className="font-mono text-[10px] bg-white dark:bg-slate-900 border border-violet-300 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded hover:bg-violet-100 dark:hover:bg-violet-900 transition-colors"
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Atalho (opcional)</Label>
              <div className="flex items-center gap-1">
                <span className="font-mono text-sm text-muted-foreground">/</span>
                <Input
                  value={atalho}
                  onChange={(e) => setAtalho(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                  placeholder="oi"
                  maxLength={20}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">Digite no chat pra autocompletar.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Anexar mídia (opcional)</Label>
              {midiaUrl ? (
                <div className="flex items-center gap-2 p-2 border rounded-md bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
                  {midiaTipo === "imagem" ? <ImageIcon className="h-4 w-4 text-emerald-700 shrink-0" /> :
                   midiaTipo === "documento" ? <FileText className="h-4 w-4 text-emerald-700 shrink-0" /> :
                   <Paperclip className="h-4 w-4 text-emerald-700 shrink-0" />}
                  <span className="text-xs flex-1 truncate text-emerald-900 dark:text-emerald-200">{midiaUrl.split("/").pop()}</span>
                  <button
                    type="button"
                    onClick={() => { setMidiaUrl(null); setMidiaTipo(null); }}
                    className="text-emerald-700 hover:text-emerald-900"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 p-2 border-2 border-dashed rounded-md cursor-pointer hover:bg-muted/30 transition-colors">
                  {uploadMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Escolher arquivo</span>
                    </>
                  )}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUpload(f);
                    }}
                  />
                </label>
              )}
              <p className="text-[10px] text-muted-foreground">Imagem, PDF, etc — vai junto da mensagem.</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { resetar(); onClose(); }}>Cancelar</Button>
          <Button onClick={submeter} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {editando ? "Salvar alterações" : "Criar template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
