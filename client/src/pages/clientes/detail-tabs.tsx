/**
 * Sub-componentes do módulo Clientes.
 * Abas de detalhes: Editar, Anotações, Arquivos, Assinaturas Digitais, Tarefas.
 * Dialog: NovoClienteDialog.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Loader2, Plus, Trash2, Upload, FileText, ExternalLink, PenLine, Send,
  Clock, StickyNote, CheckSquare, Check, Calendar, Download, Folder,
  ChevronRight, MoreVertical, FolderPlus, Pencil, ArrowLeft,
} from "lucide-react";
import JSZip from "jszip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export function EditarForm({ cliente, onSuccess }: { cliente: any; onSuccess: () => void }) {
  const [nome, setNome] = useState(cliente.nome || "");
  const [tel, setTel] = useState(cliente.telefone || "");
  const [email, setEmail] = useState(cliente.email || "");
  const [cpf, setCpf] = useState(cliente.cpfCnpj || "");
  const [obs, setObs] = useState(cliente.observacoes || "");
  const [tags, setTags] = useState(cliente.tags || "");
  const [docPendente, setDocPendente] = useState(!!cliente.documentacaoPendente);
  const [docObs, setDocObs] = useState(cliente.documentacaoObservacoes || "");
  // responsavelId pode ser null (sem responsável) ou number; UI usa string
  const [responsavelId, setResponsavelId] = useState<string>(
    cliente.responsavelId ? String(cliente.responsavelId) : "",
  );

  // Lista de colaboradores ativos pra mostrar no dropdown.
  // Backend só permite reatribuir pra dono/gestor; pra outros, a query
  // retorna array vazio (sem permissão de listar equipe) e o campo
  // mostra só info read-only.
  const { data: equipeData } = (trpc as any).configuracoes?.listarColaboradores?.useQuery?.(
    undefined,
    { retry: false },
  ) || { data: null };
  const colaboradores: any[] = equipeData?.colaboradores || [];
  const podeReatribuir = colaboradores.length > 0;

  // Nome do responsável atual pra exibir mesmo quando não pode reatribuir
  const responsavelAtualNome = (() => {
    if (!cliente.responsavelId) return null;
    const c = colaboradores.find((x) => x.id === cliente.responsavelId);
    return c?.userName || c?.userEmail || `Colaborador #${cliente.responsavelId}`;
  })();

  const mut = trpc.clientes.atualizar.useMutation({
    onSuccess: (data: any) => {
      const reconc = data?.reconciliadas ?? 0;
      if (reconc > 0) {
        toast.success("Atualizado!", {
          description: `${reconc} cobrança(s) deste cliente foram atribuídas ao atendente.`,
        });
      } else {
        toast.success("Atualizado!");
      }
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs">Nome *</Label><Input value={nome} onChange={e => setNome(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">CPF/CNPJ</Label><Input value={cpf} onChange={e => setCpf(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs">Telefone</Label><Input value={tel} onChange={e => setTel(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Email</Label><Input value={email} onChange={e => setEmail(e.target.value)} /></div>
        </div>

        {/* Responsável pelo atendimento */}
        <div className="space-y-1.5">
          <Label className="text-xs">Responsável pelo atendimento</Label>
          {podeReatribuir ? (
            <select
              value={responsavelId}
              onChange={(e) => setResponsavelId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border bg-background"
            >
              <option value="">— Sem responsável definido —</option>
              {colaboradores.filter((c) => c.ativo).map((c) => (
                <option key={c.id} value={c.id}>{c.userName || c.userEmail}</option>
              ))}
            </select>
          ) : (
            <div className="h-9 px-3 flex items-center text-sm rounded-md border bg-muted/30 text-muted-foreground">
              {responsavelAtualNome || "Sem responsável definido"}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Quando o cliente entrar em contato (WhatsApp etc.), a conversa cai no responsável definido aqui. Esta também é a pessoa que recebe a comissão pelas cobranças deste cliente — ao alterar, cobranças órfãs são propagadas automaticamente.
          </p>
        </div>

        <div className="space-y-1.5"><Label className="text-xs">Tags</Label><Input value={tags} onChange={e => setTags(e.target.value)} placeholder="VIP, Trabalhista" /></div>
        <div className="space-y-1.5"><Label className="text-xs">Observações</Label><Textarea value={obs} onChange={e => setObs(e.target.value)} rows={3} /></div>

        {/* Documentação pendente — toggle + observações livres.
            Quando marcado, cliente entra na contagem do dashboard e na
            lista filtrada "Aguardando documentação". */}
        <div className="space-y-2 pt-2 border-t">
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={docPendente}
              onChange={(e) => setDocPendente(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-violet-600 cursor-pointer"
            />
            <div>
              <span className="text-sm font-medium">Documentação pendente</span>
              <p className="text-[10px] text-muted-foreground">
                Cliente ainda precisa enviar documentos. Aparece em destaque no Dashboard.
              </p>
            </div>
          </label>
          {docPendente && (
            <Textarea
              placeholder="O que está pendente? Ex: RG, comprovante de residência, procuração assinada..."
              value={docObs}
              onChange={(e) => setDocObs(e.target.value)}
              maxLength={1000}
              rows={2}
            />
          )}
        </div>

        <Button size="sm" onClick={() => mut.mutate({
          id: cliente.id,
          nome, telefone: tel, email, cpfCnpj: cpf,
          observacoes: obs, tags,
          documentacaoPendente: docPendente,
          documentacaoObservacoes: docPendente ? (docObs || null) : null,
          // Só envia responsavelId se podeReatribuir (UX de leitura
          // pra atendentes não tenta enviar campo). Empty string vira null
          // (sem responsável) — backend ignora se não tem verTodos.
          ...(podeReatribuir
            ? { responsavelId: responsavelId ? Number(responsavelId) : null }
            : {}),
        })} disabled={!nome || mut.isPending}>
          {mut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Salvar
        </Button>
      </CardContent>
    </Card>
  );
}

export function AnotacoesTab({ contatoId, anotacoes, onRefresh }: { contatoId: number; anotacoes: any[]; onRefresh: () => void }) {
  const [titulo, setTitulo] = useState(""); const [conteudo, setConteudo] = useState("");
  const criar = trpc.clientes.criarAnotacao.useMutation({ onSuccess: () => { setTitulo(""); setConteudo(""); onRefresh(); toast.success("Salvo!"); } });
  const excluir = trpc.clientes.excluirAnotacao.useMutation({ onSuccess: () => { onRefresh(); } });
  return (<Card><CardContent className="pt-4 space-y-4"><div className="space-y-2 p-3 rounded-lg border bg-muted/20"><Input placeholder="Título (opcional)" value={titulo} onChange={e => setTitulo(e.target.value)} className="h-8 text-sm" /><Textarea placeholder="Escreva..." value={conteudo} onChange={e => setConteudo(e.target.value)} rows={2} /><Button size="sm" onClick={() => criar.mutate({ contatoId, titulo: titulo || undefined, conteudo })} disabled={!conteudo || criar.isPending}><Plus className="h-3 w-3 mr-1" /> Adicionar</Button></div>{!anotacoes.length ? <p className="text-sm text-muted-foreground text-center py-4">Nenhuma anotação.</p> : <div className="space-y-2">{anotacoes.map((n: any) => (<div key={n.id} className="flex gap-3 p-3 rounded-lg border"><StickyNote className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" /><div className="flex-1 min-w-0">{n.titulo && <p className="text-sm font-medium">{n.titulo}</p>}<p className="text-sm text-muted-foreground whitespace-pre-wrap">{n.conteudo}</p><p className="text-[10px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleDateString("pt-BR")}</p></div><Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive shrink-0" onClick={() => excluir.mutate({ id: n.id })}><Trash2 className="h-3 w-3" /></Button></div>))}</div>}</CardContent></Card>);
}

type Breadcrumb = Array<{ id: number | null; nome: string }>;

/**
 * Aba Documentos — pastas aninhadas (N níveis) + arquivos.
 *
 * O componente é auto-suficiente: busca pastas/arquivos do nível atual,
 * mantém breadcrumb local, suporta criar/renomear/excluir pastas, upload
 * e URL (herda a `pastaId` atual), mover arquivo para outra pasta, e
 * baixar uma pasta inteira como ZIP (estrutura recursiva preservada via
 * `listarConteudoRecursivo`).
 */
export function ArquivosTab({ contatoId }: { contatoId: number; arquivos?: any[]; onRefresh?: () => void }) {
  const utils = trpc.useUtils();
  const [breadcrumb, setBreadcrumb] = useState<Breadcrumb>([{ id: null, nome: "Documentos" }]);
  const pastaAtualId = breadcrumb[breadcrumb.length - 1].id;

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const [nome, setNome] = useState("");
  const [modo, setModo] = useState<"upload" | "url">("upload");
  const [novaPastaNome, setNovaPastaNome] = useState("");
  const [criandoPasta, setCriandoPasta] = useState(false);
  const [renomeando, setRenomeando] = useState<{ id: number; nome: string } | null>(null);
  const [zipEmProgresso, setZipEmProgresso] = useState<number | null>(null);

  const { data: pastas = [] } = trpc.clientes.listarPastas.useQuery({ contatoId, parentId: pastaAtualId });
  const { data: arquivos = [] } = trpc.clientes.listarArquivos.useQuery({ contatoId, pastaId: pastaAtualId });
  // Lista todas as pastas pra usar no menu "Mover para...".
  const { data: todasPastas = [] } = trpc.clientes.listarPastas.useQuery({ contatoId });

  const invalidar = () => {
    utils.clientes.listarPastas.invalidate({ contatoId });
    utils.clientes.listarPastas.invalidate({ contatoId, parentId: pastaAtualId });
    utils.clientes.listarArquivos.invalidate({ contatoId });
    utils.clientes.listarArquivos.invalidate({ contatoId, pastaId: pastaAtualId });
  };

  const uploadMut = (trpc as any).upload.enviar.useMutation();
  const salvar = trpc.clientes.salvarArquivo.useMutation({
    onSuccess: () => { setUrl(""); setNome(""); invalidar(); toast.success("Salvo!"); },
  });
  const excluirArq = trpc.clientes.excluirArquivo.useMutation({ onSuccess: () => invalidar() });
  const moverArq = trpc.clientes.moverArquivo.useMutation({
    onSuccess: () => { invalidar(); toast.success("Arquivo movido"); },
    onError: (e) => toast.error("Erro ao mover", { description: e.message }),
  });
  const criarPastaMut = trpc.clientes.criarPasta.useMutation({
    onSuccess: () => { setCriandoPasta(false); setNovaPastaNome(""); invalidar(); toast.success("Pasta criada"); },
    onError: (e) => toast.error("Erro", { description: e.message }),
  });
  const renomearMut = trpc.clientes.renomearPasta.useMutation({
    onSuccess: () => { setRenomeando(null); invalidar(); toast.success("Pasta renomeada"); },
    onError: (e) => toast.error("Erro", { description: e.message }),
  });
  const excluirPastaMut = trpc.clientes.excluirPasta.useMutation({
    onSuccess: (r) => { invalidar(); toast.success("Pasta excluída", { description: `${r.pastasExcluidas} pasta(s) e ${r.arquivosExcluidos} arquivo(s) removidos.` }); },
    onError: (e) => toast.error("Erro", { description: e.message }),
  });

  const handleFiles = async (files: FileList | File[]) => {
    setUploading(true);
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} é muito grande (max 10MB)`); continue; }
      try {
        const base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(new Error("Erro ao ler arquivo")); r.readAsDataURL(file); });
        const result = await uploadMut.mutateAsync({ nome: file.name, tipo: file.type, base64, tamanho: file.size });
        await salvar.mutateAsync({ contatoId, pastaId: pastaAtualId, nome: result.nome || file.name, tipo: result.tipo, tamanho: result.tamanho, url: result.url });
      } catch (e: any) { toast.error(e.message || `Erro ao enviar ${file.name}`); }
    }
    setUploading(false);
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const formatSize = (bytes: number) => { if (!bytes) return ""; if (bytes < 1024) return `${bytes}B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`; return `${(bytes / 1024 / 1024).toFixed(1)}MB`; };
  const isImage = (tipo: string) => tipo?.startsWith("image/");

  const entrarNaPasta = (id: number, nomePasta: string) => {
    setBreadcrumb([...breadcrumb, { id, nome: nomePasta }]);
  };
  const navegarPara = (index: number) => {
    setBreadcrumb(breadcrumb.slice(0, index + 1));
  };

  // Download de pasta como ZIP: baixa o JSON do conteúdo recursivo e,
  // pra cada arquivo, faz fetch → blob → add no JSZip com o pathRelativo.
  const baixarPastaZip = async (pastaId: number, nomePasta: string) => {
    setZipEmProgresso(pastaId);
    try {
      const conteudo = await utils.clientes.listarConteudoRecursivo.fetch({ pastaId });
      if (!conteudo.arquivos.length) {
        toast.info("Pasta vazia", { description: "Nenhum arquivo para baixar." });
        return;
      }
      const zip = new JSZip();
      let sucessos = 0;
      let falhas = 0;
      for (const a of conteudo.arquivos) {
        try {
          const resp = await fetch(a.url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          zip.file(a.pathRelativo, blob);
          sucessos++;
        } catch (err: any) {
          falhas++;
          // eslint-disable-next-line no-console
          console.warn(`Falha ao baixar ${a.nome}: ${err?.message}`);
        }
      }
      if (sucessos === 0) {
        toast.error("Não foi possível baixar a pasta", { description: "Todos os arquivos falharam." });
        return;
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${nomePasta}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
      if (falhas > 0) toast.warning(`ZIP baixado com ${falhas} falha(s)`, { description: `${sucessos}/${sucessos + falhas} arquivos.` });
      else toast.success("ZIP baixado", { description: `${sucessos} arquivo(s).` });
    } catch (e: any) {
      toast.error("Erro ao gerar ZIP", { description: e?.message });
    } finally {
      setZipEmProgresso(null);
    }
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        {/* Breadcrumb + ações principais */}
        <div className="flex items-center gap-2 flex-wrap">
          {breadcrumb.length > 1 && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => navegarPara(breadcrumb.length - 2)} title="Voltar">
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          )}
          <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap flex-1 min-w-0">
            {breadcrumb.map((b, i) => (
              <span key={`${b.id ?? "root"}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
                <button
                  className={`truncate max-w-[160px] ${i === breadcrumb.length - 1 ? "text-foreground font-medium" : "hover:text-foreground"}`}
                  onClick={() => navegarPara(i)}
                >
                  {b.nome}
                </button>
              </span>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCriandoPasta(true)}>
            <FolderPlus className="h-3 w-3 mr-1" /> Nova pasta
          </Button>
          <Button size="sm" variant={modo === "upload" ? "default" : "outline"} className="h-7 text-xs" onClick={() => {
            setModo("upload");
            const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = ".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"; inp.onchange = (e) => { const f = (e.target as HTMLInputElement).files; if (f) handleFiles(f); }; inp.click();
          }}>
            <Upload className="h-3 w-3 mr-1" /> Upload
          </Button>
          <Button size="sm" variant={modo === "url" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setModo("url")}>
            <ExternalLink className="h-3 w-3 mr-1" /> URL
          </Button>
        </div>

        {/* Form: nova pasta */}
        {criandoPasta && (
          <div className="flex gap-2 p-3 rounded-lg border bg-muted/20">
            <Input
              placeholder="Nome da pasta"
              value={novaPastaNome}
              onChange={(e) => setNovaPastaNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && novaPastaNome.trim()) criarPastaMut.mutate({ contatoId, nome: novaPastaNome, parentId: pastaAtualId }); }}
              className="h-8 text-sm"
              autoFocus
            />
            <Button size="sm" className="h-8" disabled={!novaPastaNome.trim() || criarPastaMut.isPending}
              onClick={() => criarPastaMut.mutate({ contatoId, nome: novaPastaNome, parentId: pastaAtualId })}>
              Criar
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => { setCriandoPasta(false); setNovaPastaNome(""); }}>
              Cancelar
            </Button>
          </div>
        )}

        {/* Área de URL (só quando modo=url) */}
        {modo === "url" && !criandoPasta && (
          <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Nome" value={nome} onChange={e => setNome(e.target.value)} className="h-8 text-sm" />
              <Input placeholder="URL do arquivo" value={url} onChange={e => setUrl(e.target.value)} className="h-8 text-sm" />
            </div>
            <Button size="sm" onClick={() => salvar.mutate({ contatoId, pastaId: pastaAtualId, nome: nome || "Arquivo", url })} disabled={!url || salvar.isPending}>
              <Plus className="h-3 w-3 mr-1" /> Adicionar
            </Button>
          </div>
        )}

        {/* Dropzone (sempre visível pra facilitar drag-and-drop direto na pasta atual) */}
        <div
          className={`p-4 rounded-lg border-2 border-dashed text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-primary/40"}`}
          onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
          onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = ".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"; inp.onchange = (e) => { const f = (e.target as HTMLInputElement).files; if (f) handleFiles(f); }; inp.click(); }}
        >
          {uploading ? <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-1" /> : <Upload className="h-6 w-6 text-muted-foreground/40 mx-auto mb-1" />}
          <p className="text-xs font-medium">{uploading ? "Enviando..." : "Arraste arquivos aqui"}</p>
          <p className="text-[10px] text-muted-foreground">PDF, imagens, docs · Máx 10MB</p>
        </div>

        {/* Pastas */}
        {pastas.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Pastas</p>
            {pastas.map((p: any) => {
              const r = renomeando;
              const estaRenomeando = r !== null && r.id === p.id;
              return (
              <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/20 transition-colors group">
                {estaRenomeando && r ? (
                  <>
                    <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                    <Input
                      value={r.nome}
                      onChange={(e) => setRenomeando({ id: p.id, nome: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter" && r.nome.trim()) renomearMut.mutate({ id: p.id, nome: r.nome }); if (e.key === "Escape") setRenomeando(null); }}
                      className="h-7 text-sm flex-1"
                      autoFocus
                    />
                    <Button size="sm" className="h-7" disabled={!r.nome.trim() || renomearMut.isPending}
                      onClick={() => renomearMut.mutate({ id: p.id, nome: r.nome })}>
                      OK
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setRenomeando(null)}>
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <>
                    <button className="flex items-center gap-2 flex-1 min-w-0" onClick={() => entrarNaPasta(p.id, p.nome)}>
                      <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="text-sm font-medium truncate">{p.nome}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {p.totalSubpastas > 0 ? `${p.totalSubpastas} pasta(s) · ` : ""}{p.totalArquivos} arquivo(s)
                      </span>
                    </button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600" title="Baixar pasta (ZIP)"
                      disabled={zipEmProgresso === p.id}
                      onClick={() => baixarPastaZip(p.id, p.nome)}>
                      {zipEmProgresso === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setRenomeando({ id: p.id, nome: p.nome })}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            if (confirm(`Excluir a pasta "${p.nome}" e tudo dentro dela (incluindo subpastas)?\n\nEsta ação é definitiva e não pode ser desfeita.`)) {
                              excluirPastaMut.mutate({ id: p.id });
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir pasta
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
              );
            })}
          </div>
        )}

        {/* Arquivos */}
        {arquivos.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Arquivos</p>
            {arquivos.map((a: any) => (
              <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/20 transition-colors">
                {isImage(a.tipo)
                  ? <div className="h-10 w-10 rounded-lg overflow-hidden bg-muted shrink-0"><img src={a.url} alt={a.nome} className="h-full w-full object-cover" onError={(e) => { (e.target as any).style.display = "none"; }} /></div>
                  : <FileText className="h-4 w-4 text-blue-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-600 hover:underline truncate block">{a.nome}</a>
                  <p className="text-[10px] text-muted-foreground">{a.tipo || "Documento"} {a.tamanho ? `· ${formatSize(a.tamanho)}` : ""} · {new Date(a.createdAt).toLocaleDateString("pt-BR")}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-blue-600 shrink-0" title="Baixar" onClick={() => {
                  const link = document.createElement("a"); link.href = a.url; link.download = a.nome || "arquivo"; link.target = "_blank"; link.click();
                }}>
                  <Download className="h-3 w-3" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0">
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                    <DropdownMenuItem onClick={() => moverArq.mutate({ id: a.id, pastaId: null })} disabled={a.pastaId == null}>
                      Mover para raiz
                    </DropdownMenuItem>
                    {todasPastas.length > 0 && <DropdownMenuSeparator />}
                    {todasPastas.filter((p: any) => p.id !== a.pastaId).map((p: any) => (
                      <DropdownMenuItem key={p.id} onClick={() => moverArq.mutate({ id: a.id, pastaId: p.id })}>
                        <Folder className="h-3.5 w-3.5 mr-2 text-amber-500" /> {p.nome}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => excluirArq.mutate({ id: a.id })}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir arquivo
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}

        {pastas.length === 0 && arquivos.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhuma pasta ou arquivo aqui.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function NovoClienteDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void }) {
  const [nome, setNome] = useState(""); const [tel, setTel] = useState(""); const [email, setEmail] = useState(""); const [cpf, setCpf] = useState("");
  const [responsavelId, setResponsavelId] = useState<string>("");
  const [docPendente, setDocPendente] = useState(false);
  const [docObs, setDocObs] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});

  // Lista de colaboradores ATIVOS — usado pra escolher responsável.
  // Só dono/gestor (verTodos) consegue atribuir a outro; pra atendentes
  // o backend ignora esse campo e usa o próprio id.
  const { data: equipeData } = (trpc as any).configuracoes?.listarColaboradores?.useQuery?.(
    undefined,
    { retry: false, enabled: open },
  ) || { data: null };
  const colaboradores: any[] = equipeData?.colaboradores || [];

  const criar = trpc.clientes.criar.useMutation({ onSuccess: () => { toast.success("Cadastrado!"); onOpenChange(false); setNome(""); setTel(""); setEmail(""); setCpf(""); setResponsavelId(""); setDocPendente(false); setDocObs(""); setErros({}); onSuccess(); }, onError: (e: any) => toast.error(e.message) });

  const validar = () => {
    const e: Record<string, string> = {};
    if (!nome || nome.trim().length < 2) e.nome = "Nome obrigatório (mín. 2 caracteres)";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Email inválido";
    if (tel) { const t = tel.replace(/\D/g, ""); if (t.length < 10 || t.length > 13) e.tel = "Telefone inválido"; }
    if (cpf) { const c = cpf.replace(/\D/g, ""); if (c.length !== 11 && c.length !== 14) e.cpf = "CPF (11 dígitos) ou CNPJ (14 dígitos)"; }
    setErros(e);
    return Object.keys(e).length === 0;
  };

  const formatCpfCnpj = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 14);
    if (d.length <= 11) { if (d.length <= 3) return d; if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`; if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`; return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`; }
    if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`; return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  };

  const formatTel = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d; if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`; return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  };

  return (<Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Novo Cliente</DialogTitle></DialogHeader><div className="space-y-3 py-2">
    <div className="space-y-1.5"><Label>Nome *</Label><Input placeholder="Nome completo" value={nome} onChange={e => setNome(e.target.value)} className={erros.nome ? "border-red-400" : ""} />{erros.nome && <p className="text-[10px] text-red-500">{erros.nome}</p>}</div>
    <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Telefone</Label><Input placeholder="(85) 99999-0000" value={tel} onChange={e => setTel(formatTel(e.target.value))} className={erros.tel ? "border-red-400" : ""} />{erros.tel && <p className="text-[10px] text-red-500">{erros.tel}</p>}</div><div className="space-y-1.5"><Label>Email</Label><Input placeholder="email@exemplo.com" value={email} onChange={e => setEmail(e.target.value)} className={erros.email ? "border-red-400" : ""} />{erros.email && <p className="text-[10px] text-red-500">{erros.email}</p>}</div></div>
    <div className="space-y-1.5"><Label>CPF/CNPJ</Label><Input placeholder="000.000.000-00" value={cpf} onChange={e => setCpf(formatCpfCnpj(e.target.value))} className={erros.cpf ? "border-red-400" : ""} />{erros.cpf && <p className="text-[10px] text-red-500">{erros.cpf}</p>}</div>
    {colaboradores.length > 1 && (
      <div className="space-y-1.5">
        <Label>Responsável pelo atendimento</Label>
        <select
          value={responsavelId}
          onChange={(e) => setResponsavelId(e.target.value)}
          className="w-full h-9 px-3 text-sm rounded-md border bg-background"
        >
          <option value="">— eu mesmo (padrão) —</option>
          {colaboradores.filter((c) => c.ativo).map((c) => (
            <option key={c.id} value={c.id}>{c.userName || c.userEmail}</option>
          ))}
        </select>
        <p className="text-[10px] text-muted-foreground">
          Quando o cliente entrar em contato novamente, será automaticamente direcionado para este atendente.
        </p>
      </div>
    )}
    {/* Documentação pendente — flag pra rastrear cliente que assinou
        contrato mas ainda não enviou todos os documentos. SmartFlow
        pode disparar cobrança automática usando essa flag. */}
    <div className="space-y-2 pt-2 border-t">
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={docPendente}
          onChange={(e) => setDocPendente(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-violet-600 cursor-pointer"
        />
        <div>
          <span className="text-sm font-medium">Documentação pendente</span>
          <p className="text-[10px] text-muted-foreground">
            Marque se o cliente ainda precisa enviar documentos (RG, CPF, procuração, etc).
            Aparece em destaque no Dashboard.
          </p>
        </div>
      </label>
      {docPendente && (
        <textarea
          placeholder="O que está pendente? Ex: RG, comprovante de residência, procuração assinada..."
          value={docObs}
          onChange={(e) => setDocObs(e.target.value)}
          maxLength={1000}
          rows={2}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
        />
      )}
    </div>
  </div><DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => { if (validar()) criar.mutate({ nome, telefone: tel || undefined, email: email || undefined, cpfCnpj: cpf || undefined, responsavelId: responsavelId ? Number(responsavelId) : undefined, documentacaoPendente: docPendente, documentacaoObservacoes: docPendente && docObs.trim() ? docObs.trim() : undefined }); }} disabled={!nome || criar.isPending}>{criar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Cadastrar</Button></DialogFooter></DialogContent></Dialog>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aba Assinaturas Digitais — enviar documentos para assinatura
// ═══════════════════════════════════════════════════════════════════════════════

const STATUS_ASSINATURA_LABELS: Record<string, string> = { pendente: "Pendente", enviado: "Enviado", visualizado: "Visualizado", assinado: "Assinado", recusado: "Recusado", expirado: "Expirado" };
const STATUS_ASSINATURA_CORES: Record<string, string> = { pendente: "text-gray-600 bg-gray-100", enviado: "text-blue-600 bg-blue-100", visualizado: "text-amber-600 bg-amber-100", assinado: "text-emerald-600 bg-emerald-100", recusado: "text-red-600 bg-red-100", expirado: "text-gray-500 bg-gray-100" };

export function AssinaturasTab({ contatoId, cliente, assinaturas, onRefresh }: { contatoId: number; cliente: any; assinaturas: any[]; onRefresh: () => void }) {
  const [showNovo, setShowNovo] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [diasExp, setDiasExp] = useState(30);
  const [linkCopiado, setLinkCopiado] = useState<string | null>(null);

  const criarMut = (trpc as any).assinaturas.criar.useMutation({
    onSuccess: (res: any) => { setShowNovo(false); setTitulo(""); setDescricao(""); setDocUrl(""); onRefresh(); toast.success("Documento criado! Copie o link para enviar."); setLinkCopiado(window.location.origin + res.linkAssinatura); },
    onError: (e: any) => toast.error(e.message),
  });
  const enviarMut = (trpc as any).assinaturas.marcarEnviado.useMutation({ onSuccess: () => { onRefresh(); toast.success("Marcado como enviado!"); } });
  const cancelarMut = (trpc as any).assinaturas.cancelar.useMutation({ onSuccess: () => { onRefresh(); toast.success("Cancelado."); } });
  const excluirMut = (trpc as any).assinaturas.excluir.useMutation({ onSuccess: () => { onRefresh(); } });

  const copiarLink = (token: string) => {
    const link = `${window.location.origin}/assinar/${token}`;
    navigator.clipboard.writeText(link);
    toast.success("Link copiado!");
  };

  const enviarWhatsApp = (token: string) => {
    const link = `${window.location.origin}/assinar/${token}`;
    const tel = (cliente.telefone || "").replace(/\D/g, "");
    const msg = encodeURIComponent(`Olá ${cliente.nome}! Segue o documento para assinatura digital:\n\n${link}\n\nPor favor, revise e assine o documento.`);
    window.open(`https://wa.me/${tel}?text=${msg}`, "_blank");
    enviarMut.mutate({ id: assinaturas.find((a: any) => a.tokenAssinatura === token)?.id });
  };

  return (
    <Card><CardContent className="pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <div><p className="text-sm font-semibold">Assinaturas Digitais</p><p className="text-[10px] text-muted-foreground">Envie documentos para assinatura eletrônica</p></div>
        <Button size="sm" onClick={() => setShowNovo(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Novo Documento</Button>
      </div>

      {linkCopiado && (
        <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 space-y-2">
          <p className="text-xs font-medium text-emerald-700">Link de assinatura criado:</p>
          <div className="flex gap-2"><Input value={linkCopiado} readOnly className="h-8 text-xs bg-white" /><Button size="sm" variant="outline" className="h-8" onClick={() => { navigator.clipboard.writeText(linkCopiado); toast.success("Copiado!"); }}>Copiar</Button></div>
          <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={() => setLinkCopiado(null)}>Fechar</Button>
        </div>
      )}

      {showNovo && (
        <div className="p-4 rounded-lg border bg-muted/20 space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Título do Documento *</Label><Input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Contrato de Honorários" className="h-8 text-sm" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Descrição</Label><Input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Breve descrição..." className="h-8 text-sm" /></div>
          <div className="space-y-1.5"><Label className="text-xs">URL do Documento (PDF/Google Docs) *</Label><Input value={docUrl} onChange={e => setDocUrl(e.target.value)} placeholder="https://docs.google.com/... ou link do PDF" className="h-8 text-sm" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Dias para expirar</Label><Input type="number" value={diasExp} onChange={e => setDiasExp(Number(e.target.value))} min={1} max={90} className="h-8 text-sm w-24" /></div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => criarMut.mutate({ contatoId, titulo, descricao: descricao || undefined, documentoUrl: docUrl, diasExpiracao: diasExp })} disabled={!titulo || !docUrl || criarMut.isPending}>
              {criarMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <PenLine className="h-3.5 w-3.5 mr-1" />} Criar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNovo(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {!assinaturas.length ? (
        <div className="text-center py-8"><PenLine className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" /><p className="text-sm text-muted-foreground">Nenhum documento para assinatura.</p></div>
      ) : (
        <div className="space-y-2">
          {assinaturas.map((a: any) => (
            <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/20 transition-colors">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-rose-100 to-pink-100 flex items-center justify-center shrink-0"><PenLine className="h-4 w-4 text-rose-600" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{a.titulo}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {a.enviadoAt && <span className="flex items-center gap-0.5"><Send className="h-2.5 w-2.5" /> Enviado {new Date(a.enviadoAt).toLocaleDateString("pt-BR")}</span>}
                  {a.assinadoAt && <span className="flex items-center gap-0.5"><PenLine className="h-2.5 w-2.5" /> Assinado {new Date(a.assinadoAt).toLocaleDateString("pt-BR")}</span>}
                  {a.expiracaoAt && !a.assinadoAt && <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" /> Expira {new Date(a.expiracaoAt).toLocaleDateString("pt-BR")}</span>}
                </div>
              </div>
              <Badge className={`text-[9px] px-1.5 py-0 ${STATUS_ASSINATURA_CORES[a.status] || ""}`}>{STATUS_ASSINATURA_LABELS[a.status]}</Badge>
              <div className="flex gap-1 shrink-0">
                {a.documentoUrl && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Ver documento" onClick={() => window.open(a.documentoUrl, "_blank")}><ExternalLink className="h-3 w-3" /></Button>}
                {a.tokenAssinatura && a.status !== "assinado" && a.status !== "expirado" && (<>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600" title="Copiar link" onClick={() => copiarLink(a.tokenAssinatura)}><FileText className="h-3 w-3" /></Button>
                  {cliente.telefone && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600" title="Enviar WhatsApp" onClick={() => enviarWhatsApp(a.tokenAssinatura)}><Send className="h-3 w-3" /></Button>}
                </>)}
                {a.status !== "assinado" && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => { if (confirm("Excluir?")) excluirMut.mutate({ id: a.id }); }}><Trash2 className="h-3 w-3" /></Button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </CardContent></Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aba Tarefas do Cliente
// ═══════════════════════════════════════════════════════════════════════════════

const PRIOR_DOT: Record<string, string> = { urgente: "bg-red-500", alta: "bg-orange-400", normal: "bg-blue-400", baixa: "bg-gray-300" };
const ST_COR: Record<string, string> = { pendente: "bg-amber-100 text-amber-700", em_andamento: "bg-blue-100 text-blue-700", concluida: "bg-emerald-100 text-emerald-700", cancelada: "bg-gray-100 text-gray-500" };
const ST_LBL: Record<string, string> = { pendente: "Pendente", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada" };

export function TarefasClienteTab({ contatoId }: { contatoId: number }) {
  const [titulo, setTitulo] = useState(""); const [showNova, setShowNova] = useState(false);
  const [prioridade, setPrioridade] = useState("normal"); const [dataVenc, setDataVenc] = useState("");
  const { data: tarefas, refetch } = (trpc as any).tarefas.listar.useQuery({ contatoId });
  const criar = (trpc as any).tarefas.criar.useMutation({ onSuccess: () => { refetch(); setTitulo(""); setShowNova(false); toast.success("Tarefa criada!"); }, onError: (e: any) => toast.error(e.message) });
  const atualizar = (trpc as any).tarefas.atualizar.useMutation({ onSuccess: () => refetch() });
  const excluir = (trpc as any).tarefas.excluir.useMutation({ onSuccess: () => refetch() });

  const lista = tarefas || [];

  return (<Card><CardContent className="pt-4 space-y-4">
    <div className="flex items-center justify-between">
      <div><p className="text-sm font-semibold">Tarefas</p><p className="text-[10px] text-muted-foreground">{lista.filter((t: any) => t.status === "pendente" || t.status === "em_andamento").length} pendentes</p></div>
      <Button size="sm" onClick={() => setShowNova(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Nova</Button>
    </div>

    {showNova && <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
      <Input placeholder="Título da tarefa" value={titulo} onChange={e => setTitulo(e.target.value)} className="h-8 text-sm" />
      <div className="flex gap-2">
        <select className="h-8 rounded-md border bg-background px-2 text-xs flex-1" value={prioridade} onChange={e => setPrioridade(e.target.value)}>
          <option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
        </select>
        <Input type="date" value={dataVenc} onChange={e => setDataVenc(e.target.value)} className="h-8 text-xs flex-1" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7" onClick={() => criar.mutate({ titulo, contatoId, prioridade, dataVencimento: dataVenc ? new Date(dataVenc + "T23:59:59").toISOString() : undefined })} disabled={!titulo || criar.isPending}>
          {criar.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null} Criar
        </Button>
        <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowNova(false)}>Cancelar</Button>
      </div>
    </div>}

    {!lista.length ? <div className="text-center py-6"><CheckSquare className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" /><p className="text-sm text-muted-foreground">Nenhuma tarefa.</p></div> : (
      <div className="space-y-1.5">{lista.map((t: any) => (
        <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/20 group">
          <button className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${t.status === "concluida" ? "bg-emerald-500 border-emerald-500 text-white" : "border-muted-foreground/30 hover:border-emerald-400"}`}
            onClick={() => atualizar.mutate({ id: t.id, status: t.status === "concluida" ? "pendente" : "concluida" })}>
            {t.status === "concluida" && <Check className="h-2.5 w-2.5" />}
          </button>
          <div className={`w-0.5 h-5 rounded-full ${PRIOR_DOT[t.prioridade] || "bg-gray-300"}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-medium truncate ${t.status === "concluida" ? "line-through text-muted-foreground" : ""}`}>{t.titulo}</p>
            {t.dataVencimento && <p className={`text-[9px] flex items-center gap-0.5 ${t.vencida ? "text-red-500" : "text-muted-foreground"}`}><Calendar className="h-2 w-2" />{new Date(t.dataVencimento).toLocaleDateString("pt-BR")}</p>}
          </div>
          <Badge className={`text-[8px] px-1 py-0 ${ST_COR[t.status] || ""}`}>{ST_LBL[t.status]}</Badge>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive opacity-0 group-hover:opacity-100" onClick={() => excluir.mutate({ id: t.id })}><Trash2 className="h-2.5 w-2.5" /></Button>
        </div>
      ))}</div>
    )}
  </CardContent></Card>);
}
