/**
 * Página de modelos de contrato — CRUD de templates DOCX com
 * placeholders numerados ({{1}}, {{2}}...). Cada placeholder pode ser
 * uma "variável" (resolve automático: cliente.profissao etc.) ou
 * "manual" (operador preenche na hora de gerar).
 *
 * Componentes inline neste arquivo:
 *  - <ModelosContrato> — listagem
 *  - <UploadWizardDialog> — 3 passos: arquivo → mapeamento → confirma
 *  - <MappingEditorDialog> — editar mapeamento de modelo existente
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Variable,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import type { Placeholder } from "../../../shared/modelos-contrato-variaveis";

interface ModeloLista {
  id: number;
  nome: string;
  descricao: string | null;
  arquivoNome: string;
  tamanho: number | null;
  placeholders: Placeholder[];
  createdAt: string | Date;
}

export default function ModelosContrato() {
  const { data: meuEsc } = trpc.configuracoes.meuEscritorio.useQuery();
  const cargo = meuEsc?.colaborador.cargo;
  const isGestor = cargo === "dono" || cargo === "gestor";

  const utils = (trpc as any).useUtils();
  const { data: modelos, isLoading } = (trpc as any).modelosContrato.listar.useQuery();
  const excluir = (trpc as any).modelosContrato.excluir.useMutation({
    onSuccess: () => {
      utils.modelosContrato.listar.invalidate();
      toast.success("Modelo excluído");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [uploadOpen, setUploadOpen] = useState(false);
  const [editando, setEditando] = useState<ModeloLista | null>(null);
  const [excluindo, setExcluindo] = useState<ModeloLista | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-info" />
            Modelos de contrato
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Suba modelos .docx com placeholders <code className="text-[11px] mx-0.5 bg-muted px-1 rounded">{`{{1}}`}</code>,
            <code className="text-[11px] mx-0.5 bg-muted px-1 rounded">{`{{2}}`}</code>, ... e configure cada um como
            <b className="mx-1 text-foreground">variável</b> (preenche automático do cadastro do cliente)
            ou <b className="mx-1 text-foreground">manual</b> (você preenche na hora de gerar).
          </p>
        </div>
        {isGestor && (
          <Button onClick={() => setUploadOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo modelo
          </Button>
        )}
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Carregando...
          </CardContent>
        </Card>
      ) : !modelos || modelos.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground mb-2">Nenhum modelo cadastrado ainda</p>
            <p className="text-xs text-muted-foreground/70 mb-4 max-w-md mx-auto">
              Faça upload de um arquivo .docx contendo placeholders numerados e configure cada
              um como variável ou preenchimento manual.
            </p>
            {isGestor && (
              <Button onClick={() => setUploadOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Subir primeiro modelo
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {(modelos as ModeloLista[]).map((m) => {
            const totalVar = m.placeholders.filter((p) => p.tipo === "variavel").length;
            const totalManual = m.placeholders.filter((p) => p.tipo === "manual").length;
            return (
              <Card key={m.id} className="hover:shadow-sm hover:border-foreground/20 transition-all">
                <CardContent className="py-3 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-info-bg text-info-fg flex items-center justify-center flex-shrink-0">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{m.nome}</span>
                      <Badge variant="secondary" className="text-[10px] h-5 font-normal">
                        {m.placeholders.length} placeholder(s)
                      </Badge>
                      {totalVar > 0 && (
                        <Badge className="text-[10px] h-5 border-0 bg-info-bg text-info-fg">
                          <Variable className="h-2.5 w-2.5 mr-1" />
                          {totalVar} var
                        </Badge>
                      )}
                      {totalManual > 0 && (
                        <Badge className="text-[10px] h-5 border-0 bg-warning-bg text-warning-fg">
                          {totalManual} manual
                        </Badge>
                      )}
                    </div>
                    {m.descricao && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{m.descricao}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {m.arquivoNome}
                      {m.tamanho ? ` · ${(m.tamanho / 1024).toFixed(0)} KB` : ""}
                    </p>
                  </div>
                  {isGestor && (
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setEditando(m)} title="Editar mapeamento">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => setExcluindo(m)}
                        title="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {uploadOpen && (
        <UploadWizardDialog
          onClose={() => setUploadOpen(false)}
          onSuccess={() => {
            setUploadOpen(false);
            utils.modelosContrato.listar.invalidate();
          }}
        />
      )}

      {editando && (
        <MappingEditorDialog
          modelo={editando}
          onClose={() => setEditando(null)}
          onSuccess={() => {
            setEditando(null);
            utils.modelosContrato.listar.invalidate();
          }}
        />
      )}

      {excluindo && (
        <Dialog open onOpenChange={(o) => !o && setExcluindo(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-warning" />
                Excluir &ldquo;{excluindo.nome}&rdquo;?
              </DialogTitle>
              <DialogDescription>
                O arquivo e o mapeamento serão removidos. Contratos já gerados não são afetados (eles
                não ficam armazenados).
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setExcluindo(null)} disabled={excluir.isPending}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => excluir.mutate({ id: excluindo.id }, { onSettled: () => setExcluindo(null) })}
                disabled={excluir.isPending}
              >
                {excluir.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Upload wizard ───────────────────────────────────────────────────────

function UploadWizardDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [modeloId, setModeloId] = useState<number | null>(null);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);

  const upload = (trpc as any).modelosContrato.upload.useMutation({
    onSuccess: (r: { id: number; placeholdersDetectados: number[] }) => {
      setModeloId(r.id);
      // Inicializa todos como manual (operador customiza no step 2).
      setPlaceholders(
        r.placeholdersDetectados.map((n) => ({
          numero: n,
          tipo: "manual" as const,
          label: `Campo ${n}`,
        })),
      );
      if (r.placeholdersDetectados.length === 0) {
        toast.warning("Nenhum placeholder {{N}} encontrado — modelo só pode ser usado como anexo padrão");
      }
      setStep(2);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const salvarMapping = (trpc as any).modelosContrato.salvarMapping.useMutation({
    onSuccess: () => {
      toast.success("Modelo salvo");
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".docx")) {
      toast.error("Apenas arquivos .docx são aceitos");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx. 10MB)");
      return;
    }
    setArquivo(f);
    if (!nome) setNome(f.name.replace(/\.docx$/i, ""));
  }

  async function handleUpload() {
    if (!arquivo || !nome.trim()) return;
    const base64 = await fileToBase64(arquivo);
    upload.mutate({
      nome: nome.trim(),
      descricao: descricao.trim() || undefined,
      arquivoNome: arquivo.name,
      mimetype: arquivo.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      base64,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo modelo de contrato</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Suba o arquivo .docx contendo placeholders numerados."
              : "Configure o que cada placeholder vai puxar."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do modelo *</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Contrato de Honorários — Trabalhista"
                maxLength={150}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Descrição (opcional)</Label>
              <Textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Resumo do que este modelo cobre"
                rows={2}
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Arquivo .docx *</Label>
              <div className="flex items-center gap-2">
                <Input type="file" accept=".docx" onChange={handleFileChange} className="flex-1" />
              </div>
              {arquivo && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {arquivo.name} · {(arquivo.size / 1024).toFixed(0)} KB
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                Use placeholders numerados no estilo WhatsApp: <code className="bg-muted px-1 rounded">{`{{1}}`}</code>,
                <code className="bg-muted px-1 mx-0.5 rounded">{`{{2}}`}</code>, etc. No próximo passo
                você define o que cada um significa.
              </p>
            </div>
          </div>
        )}

        {step === 2 && modeloId && (
          <PlaceholdersMapper placeholders={placeholders} onChange={setPlaceholders} />
        )}

        <DialogFooter>
          {step === 2 && (
            <Button
              variant="ghost"
              onClick={() => setStep(1)}
              disabled={salvarMapping.isPending}
              className="mr-auto"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Voltar
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={upload.isPending || salvarMapping.isPending}>
            Cancelar
          </Button>
          {step === 1 && (
            <Button onClick={handleUpload} disabled={!arquivo || !nome.trim() || upload.isPending}>
              {upload.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Enviar e detectar placeholders
            </Button>
          )}
          {step === 2 && (
            <Button
              onClick={() => modeloId && salvarMapping.mutate({ id: modeloId, placeholders })}
              disabled={salvarMapping.isPending || !validarMapping(placeholders)}
            >
              {salvarMapping.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Salvar modelo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit mapping (modelo existente) ─────────────────────────────────────

function MappingEditorDialog({
  modelo,
  onClose,
  onSuccess,
}: {
  modelo: ModeloLista;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [nome, setNome] = useState(modelo.nome);
  const [descricao, setDescricao] = useState(modelo.descricao || "");
  const [placeholders, setPlaceholders] = useState<Placeholder[]>(modelo.placeholders);

  const salvar = (trpc as any).modelosContrato.salvarMapping.useMutation({
    onSuccess: () => {
      toast.success("Mapeamento atualizado");
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar &ldquo;{modelo.nome}&rdquo;</DialogTitle>
          <DialogDescription>
            Atualize o nome, descrição ou o mapeamento dos placeholders.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={150} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Descrição</Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
          <PlaceholdersMapper placeholders={placeholders} onChange={setPlaceholders} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              salvar.mutate({
                id: modelo.id,
                nome: nome.trim(),
                descricao: descricao.trim() || null,
                placeholders,
              })
            }
            disabled={salvar.isPending || !nome.trim() || !validarMapping(placeholders)}
          >
            {salvar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Placeholders mapper (compartilhado entre upload e edit) ─────────────

function PlaceholdersMapper({
  placeholders,
  onChange,
}: {
  placeholders: Placeholder[];
  onChange: (p: Placeholder[]) => void;
}) {
  const { data: catalogo } = (trpc as any).modelosContrato.catalogoVariaveis.useQuery();

  // Agrupa o catálogo por `grupo` pra renderizar SelectGroup.
  const catalogoAgrupado = useMemo(() => {
    if (!catalogo) return {} as Record<string, Array<{ path: string; label: string }>>;
    const acc: Record<string, Array<{ path: string; label: string }>> = {};
    for (const v of catalogo as Array<{ path: string; label: string; grupo: string }>) {
      if (!acc[v.grupo]) acc[v.grupo] = [];
      acc[v.grupo].push({ path: v.path, label: v.label });
    }
    return acc;
  }, [catalogo]);

  function atualizar(numero: number, patch: Partial<Placeholder>) {
    onChange(
      placeholders.map((p) => (p.numero === numero ? ({ ...p, ...patch } as Placeholder) : p)),
    );
  }

  if (placeholders.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        <Wand2 className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
        Nenhum placeholder <code className="text-[11px] bg-muted px-1 rounded">{`{{N}}`}</code> encontrado no documento.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Para cada placeholder detectado, escolha se vai puxar de uma <b>variável</b> (preenche
        automático do cadastro) ou se será <b>manual</b> (você preenche na hora de gerar o contrato).
      </p>
      <div className="space-y-2">
        {placeholders.map((p) => (
          <div key={p.numero} className="rounded-lg border p-3 space-y-2 bg-card">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className="font-mono text-xs h-6 px-2 bg-info-bg text-info-fg border-0">
                {`{{${p.numero}}}`}
              </Badge>
              <div className="inline-flex rounded-md border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() =>
                    atualizar(p.numero, { tipo: "variavel", variavel: "" } as Partial<Placeholder>)
                  }
                  className={`px-3 py-1 text-xs rounded ${
                    p.tipo === "variavel" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Variável
                </button>
                <button
                  type="button"
                  onClick={() =>
                    atualizar(p.numero, {
                      tipo: "manual",
                      label: `Campo ${p.numero}`,
                    } as Partial<Placeholder>)
                  }
                  className={`px-3 py-1 text-xs rounded ${
                    p.tipo === "manual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Manual
                </button>
              </div>
            </div>

            {p.tipo === "variavel" && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Variável que será usada</Label>
                <Select
                  value={p.variavel || ""}
                  onValueChange={(v) => atualizar(p.numero, { variavel: v } as Partial<Placeholder>)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Selecione uma variável..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(catalogoAgrupado).map(([grupo, items]) => (
                      <SelectGroup key={grupo}>
                        <SelectLabel className="text-[10px] uppercase tracking-wide">{grupo}</SelectLabel>
                        {items.map((it) => (
                          <SelectItem key={it.path} value={it.path}>
                            {it.label}
                            <span className="ml-2 text-[10px] text-muted-foreground font-mono">{it.path}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {p.tipo === "manual" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Pergunta ao gerar *</Label>
                  <Input
                    value={p.label}
                    onChange={(e) =>
                      atualizar(p.numero, { label: e.target.value } as Partial<Placeholder>)
                    }
                    maxLength={80}
                    placeholder="Ex: Valor da causa"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Dica (opcional)</Label>
                  <Input
                    value={p.dica || ""}
                    onChange={(e) =>
                      atualizar(p.numero, { dica: e.target.value } as Partial<Placeholder>)
                    }
                    maxLength={120}
                    placeholder="Ex: R$ 10.000,00"
                    className="h-9"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function validarMapping(placeholders: Placeholder[]): boolean {
  for (const p of placeholders) {
    if (p.tipo === "variavel" && !p.variavel) return false;
    if (p.tipo === "manual" && !p.label.trim()) return false;
  }
  return true;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove o prefixo "data:...;base64,"
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}
