import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Users, Plus, Search, Phone, Mail, FileText, MessageCircle, TrendingUp, StickyNote, Loader2, Trash2, ArrowLeft, User, PenLine, Send, ExternalLink, Clock, Upload, Image, CheckSquare, Check, Calendar } from "lucide-react";
import { toast } from "sonner";
import { FinanceiroBadge, FinanceiroPopover } from "@/components/FinanceiroBadge";

function initials(n: string) { return n.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase(); }
function timeAgo(d: string) { if (!d) return ""; const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000); if (m < 1) return "agora"; if (m < 60) return m + "min"; const h = Math.floor(m / 60); if (h < 24) return h + "h"; return Math.floor(h / 24) + "d"; }

export default function Clientes() {
  const [busca, setBusca] = useState(""); const [buscaDebounced, setBuscaDebounced] = useState("");
  const [pagina, setPagina] = useState(1);
  const [selId, setSelId] = useState<number | null>(null); const [showNovo, setShowNovo] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setBuscaDebounced(busca); setPagina(1); }, 300); return () => clearTimeout(t); }, [busca]);
  const { data: stats } = trpc.clientes.estatisticas.useQuery();
  const { data, refetch } = trpc.clientes.listar.useQuery({ busca: buscaDebounced || undefined, pagina, limite: 50 });
  const clientes = data?.clientes || [];
  const totalPaginas = (data as any)?.totalPaginas || 1;
  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/40 dark:to-purple-900/40"><Users className="h-6 w-6 text-violet-600" /></div>
        <div className="flex-1"><h1 className="text-2xl font-bold tracking-tight">Clientes</h1><p className="text-sm text-muted-foreground">Cadastro, arquivos e anotações</p></div>
        <Button size="sm" onClick={() => setShowNovo(true)}><Plus className="h-4 w-4 mr-1.5" /> Novo Cliente</Button>
      </div>
      {stats && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{[{ v: stats.total, l: "Total", c: "" }, { v: stats.novosHoje, l: "Novos hoje", c: "text-emerald-600" }, { v: stats.comTelefone, l: "Com telefone", c: "text-blue-600" }, { v: stats.comEmail, l: "Com email", c: "text-violet-600" }].map((k, i) => (<div key={i} className="rounded-lg border bg-card px-3 py-2 text-center"><p className={"text-lg font-bold leading-tight " + k.c}>{k.v}</p><p className="text-[10px] text-muted-foreground">{k.l}</p></div>))}</div>}
      {selId ? <ClienteDetalhe id={selId} onVoltar={() => setSelId(null)} onUpdate={refetch} /> : (<>
        <Card><CardHeader className="pb-3"><div className="flex-1 relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Buscar por nome, telefone, email ou CPF..." value={busca} onChange={e => setBusca(e.target.value)} className="h-9 pl-9" /></div></CardHeader>
          <CardContent>{!clientes.length ? <div className="text-center py-16"><Users className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" /><p className="text-sm text-muted-foreground">Nenhum cliente encontrado.</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setShowNovo(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Cadastrar</Button></div> : <div className="space-y-1">{clientes.map((c: any) => (
            <button key={c.id} className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/40 transition-colors text-left" onClick={() => setSelId(c.id)}>
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-200 to-purple-100 flex items-center justify-center text-xs font-bold text-violet-700 shrink-0">{initials(c.nome || "?")}</div>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{c.nome}</p><div className="flex items-center gap-3 text-xs text-muted-foreground">{c.telefone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {c.telefone}</span>}{c.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {c.email}</span>}</div></div>
              <Badge variant="outline" className="text-[10px] shrink-0">{c.origem}</Badge><span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(c.createdAt)}</span>
            </button>))}</div>}</CardContent></Card>
        {totalPaginas > 1 && <div className="flex items-center justify-center gap-2 pt-2"><Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}>Anterior</Button><span className="text-xs text-muted-foreground">Página {pagina} de {totalPaginas}</span><Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagina >= totalPaginas} onClick={() => setPagina(p => p + 1)}>Próxima</Button></div>}
      </>)}
      <NovoClienteDialog open={showNovo} onOpenChange={setShowNovo} onSuccess={() => refetch()} />
    </div>
  );
}

function ClienteDetalhe({ id, onVoltar, onUpdate }: { id: number; onVoltar: () => void; onUpdate: () => void }) {
  const [tab, setTab] = useState("info");
  const { data: cliente, refetch } = trpc.clientes.detalhe.useQuery({ id });
  const { data: anotacoes, refetch: rN } = trpc.clientes.listarAnotacoes.useQuery({ contatoId: id });
  const { data: arquivos, refetch: rA } = trpc.clientes.listarArquivos.useQuery({ contatoId: id });
  const { data: convsData } = trpc.clientes.listarConversas.useQuery({ contatoId: id });
  const { data: leadsData } = trpc.clientes.listarLeads.useQuery({ contatoId: id });
  const { data: assinaturas, refetch: rAs } = (trpc as any).assinaturas.listarPorCliente.useQuery({ contatoId: id });
  const excluirMut = trpc.clientes.excluir.useMutation({ onSuccess: () => { toast.success("Cliente excluído."); onVoltar(); onUpdate(); }, onError: (e: any) => toast.error(e.message) });
  if (!cliente) return <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;
  const totalAssinaturas = (assinaturas || []).length;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onVoltar}><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-200 to-purple-100 flex items-center justify-center text-sm font-bold text-violet-700">{initials(cliente.nome || "?")}</div>
        <div className="flex-1"><h2 className="text-lg font-bold">{cliente.nome}</h2><div className="flex items-center gap-3 text-xs text-muted-foreground">{cliente.telefone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {cliente.telefone}</span>}{cliente.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {cliente.email}</span>}{cliente.cpfCnpj && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {cliente.cpfCnpj}</span>}<FinanceiroBadge contatoId={id} /></div></div>
        <FinanceiroPopover contatoId={id} />
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { if (confirm("Excluir cliente e dados associados?")) excluirMut.mutate({ id }); }}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-5 gap-2">{[{ v: cliente.totalConversas, l: "Conversas", c: "text-blue-600", t: "conversas" }, { v: cliente.totalLeads, l: "Leads", c: "text-violet-600", t: "leads" }, { v: cliente.totalArquivos, l: "Arquivos", c: "text-amber-600", t: "arquivos" }, { v: cliente.totalAnotacoes, l: "Anotações", c: "text-emerald-600", t: "anotacoes" }, { v: totalAssinaturas, l: "Assinaturas", c: "text-rose-600", t: "assinaturas" }].map((k, i) => (<div key={i} className="rounded-lg border bg-card px-3 py-2 text-center cursor-pointer hover:bg-muted/40" onClick={() => setTab(k.t)}><p className={"text-lg font-bold " + k.c}>{k.v}</p><p className="text-[10px] text-muted-foreground">{k.l}</p></div>))}</div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-7 h-9"><TabsTrigger value="info" className="text-xs gap-1"><User className="h-3 w-3" /> Dados</TabsTrigger><TabsTrigger value="anotacoes" className="text-xs gap-1"><StickyNote className="h-3 w-3" /> Notas</TabsTrigger><TabsTrigger value="arquivos" className="text-xs gap-1"><FileText className="h-3 w-3" /> Arquivos</TabsTrigger><TabsTrigger value="tarefas" className="text-xs gap-1"><CheckSquare className="h-3 w-3" /> Tarefas</TabsTrigger><TabsTrigger value="conversas" className="text-xs gap-1"><MessageCircle className="h-3 w-3" /> Conversas</TabsTrigger><TabsTrigger value="leads" className="text-xs gap-1"><TrendingUp className="h-3 w-3" /> Leads</TabsTrigger><TabsTrigger value="assinaturas" className="text-xs gap-1"><PenLine className="h-3 w-3" /> Assinar</TabsTrigger></TabsList>
        <TabsContent value="info" className="mt-4"><EditarForm cliente={cliente} onSuccess={() => { refetch(); onUpdate(); }} /></TabsContent>
        <TabsContent value="anotacoes" className="mt-4"><AnotacoesTab contatoId={id} anotacoes={anotacoes || []} onRefresh={rN} /></TabsContent>
        <TabsContent value="arquivos" className="mt-4"><ArquivosTab contatoId={id} arquivos={arquivos || []} onRefresh={rA} /></TabsContent>
        <TabsContent value="tarefas" className="mt-4"><TarefasClienteTab contatoId={id} /></TabsContent>
        <TabsContent value="conversas" className="mt-4"><Card><CardContent className="pt-4">{!(convsData || []).length ? <p className="text-sm text-muted-foreground text-center py-8">Nenhuma conversa.</p> : <div className="space-y-2">{(convsData || []).map((c: any) => (<div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border"><MessageCircle className="h-4 w-4 text-blue-500 shrink-0" /><div className="flex-1 min-w-0"><p className="text-sm truncate">{c.assunto || "Conversa"}</p><p className="text-xs text-muted-foreground truncate">{c.ultimaMensagemPreview}</p></div><Badge variant="outline" className="text-[9px]">{c.status}</Badge><span className="text-[10px] text-muted-foreground">{timeAgo(c.createdAt)}</span></div>))}</div>}</CardContent></Card></TabsContent>
        <TabsContent value="leads" className="mt-4"><Card><CardContent className="pt-4">{!(leadsData || []).length ? <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead.</p> : <div className="space-y-2">{(leadsData || []).map((l: any) => (<div key={l.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border"><TrendingUp className="h-4 w-4 text-violet-500 shrink-0" /><div className="flex-1"><p className="text-sm">{l.etapaFunil}</p></div>{l.valorEstimado && <span className="text-sm font-medium text-emerald-600">R$ {l.valorEstimado}</span>}<span className="text-[10px] text-muted-foreground">{timeAgo(l.createdAt)}</span></div>))}</div>}</CardContent></Card></TabsContent>
        <TabsContent value="assinaturas" className="mt-4"><AssinaturasTab contatoId={id} cliente={cliente} assinaturas={assinaturas || []} onRefresh={rAs} /></TabsContent>
      </Tabs>
    </div>
  );
}

function EditarForm({ cliente, onSuccess }: { cliente: any; onSuccess: () => void }) {
  const [nome, setNome] = useState(cliente.nome || ""); const [tel, setTel] = useState(cliente.telefone || ""); const [email, setEmail] = useState(cliente.email || ""); const [cpf, setCpf] = useState(cliente.cpfCnpj || ""); const [obs, setObs] = useState(cliente.observacoes || ""); const [tags, setTags] = useState(cliente.tags || "");
  const mut = trpc.clientes.atualizar.useMutation({ onSuccess: () => { toast.success("Atualizado!"); onSuccess(); }, onError: (e: any) => toast.error(e.message) });
  return (<Card><CardContent className="pt-4 space-y-4"><div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label className="text-xs">Nome *</Label><Input value={nome} onChange={e => setNome(e.target.value)} /></div><div className="space-y-1.5"><Label className="text-xs">CPF/CNPJ</Label><Input value={cpf} onChange={e => setCpf(e.target.value)} /></div></div><div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label className="text-xs">Telefone</Label><Input value={tel} onChange={e => setTel(e.target.value)} /></div><div className="space-y-1.5"><Label className="text-xs">Email</Label><Input value={email} onChange={e => setEmail(e.target.value)} /></div></div><div className="space-y-1.5"><Label className="text-xs">Tags</Label><Input value={tags} onChange={e => setTags(e.target.value)} placeholder="VIP, Trabalhista" /></div><div className="space-y-1.5"><Label className="text-xs">Observações</Label><Textarea value={obs} onChange={e => setObs(e.target.value)} rows={3} /></div><Button size="sm" onClick={() => mut.mutate({ id: cliente.id, nome, telefone: tel, email, cpfCnpj: cpf, observacoes: obs, tags })} disabled={!nome || mut.isPending}>{mut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Salvar</Button></CardContent></Card>);
}

function AnotacoesTab({ contatoId, anotacoes, onRefresh }: { contatoId: number; anotacoes: any[]; onRefresh: () => void }) {
  const [titulo, setTitulo] = useState(""); const [conteudo, setConteudo] = useState("");
  const criar = trpc.clientes.criarAnotacao.useMutation({ onSuccess: () => { setTitulo(""); setConteudo(""); onRefresh(); toast.success("Salvo!"); } });
  const excluir = trpc.clientes.excluirAnotacao.useMutation({ onSuccess: () => { onRefresh(); } });
  return (<Card><CardContent className="pt-4 space-y-4"><div className="space-y-2 p-3 rounded-lg border bg-muted/20"><Input placeholder="Título (opcional)" value={titulo} onChange={e => setTitulo(e.target.value)} className="h-8 text-sm" /><Textarea placeholder="Escreva..." value={conteudo} onChange={e => setConteudo(e.target.value)} rows={2} /><Button size="sm" onClick={() => criar.mutate({ contatoId, titulo: titulo || undefined, conteudo })} disabled={!conteudo || criar.isPending}><Plus className="h-3 w-3 mr-1" /> Adicionar</Button></div>{!anotacoes.length ? <p className="text-sm text-muted-foreground text-center py-4">Nenhuma anotação.</p> : <div className="space-y-2">{anotacoes.map((n: any) => (<div key={n.id} className="flex gap-3 p-3 rounded-lg border"><StickyNote className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" /><div className="flex-1 min-w-0">{n.titulo && <p className="text-sm font-medium">{n.titulo}</p>}<p className="text-sm text-muted-foreground whitespace-pre-wrap">{n.conteudo}</p><p className="text-[10px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleDateString("pt-BR")}</p></div><Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive shrink-0" onClick={() => excluir.mutate({ id: n.id })}><Trash2 className="h-3 w-3" /></Button></div>))}</div>}</CardContent></Card>);
}

function ArquivosTab({ contatoId, arquivos, onRefresh }: { contatoId: number; arquivos: any[]; onRefresh: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState(""); const [nome, setNome] = useState("");
  const [modo, setModo] = useState<"upload" | "url">("upload");

  const uploadMut = (trpc as any).upload.enviar.useMutation();
  const salvar = trpc.clientes.salvarArquivo.useMutation({ onSuccess: () => { setUrl(""); setNome(""); onRefresh(); toast.success("Salvo!"); } });
  const excluir = trpc.clientes.excluirArquivo.useMutation({ onSuccess: () => onRefresh() });

  const handleFiles = async (files: FileList | File[]) => {
    setUploading(true);
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} é muito grande (max 10MB)`); continue; }
      try {
        const base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(new Error("Erro ao ler arquivo")); r.readAsDataURL(file); });
        const result = await uploadMut.mutateAsync({ nome: file.name, tipo: file.type, base64, tamanho: file.size });
        await salvar.mutateAsync({ contatoId, nome: result.nome || file.name, tipo: result.tipo, tamanho: result.tamanho, url: result.url });
      } catch (e: any) { toast.error(e.message || `Erro ao enviar ${file.name}`); }
    }
    setUploading(false);
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const formatSize = (bytes: number) => { if (!bytes) return ""; if (bytes < 1024) return `${bytes}B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`; return `${(bytes / 1024 / 1024).toFixed(1)}MB`; };
  const isImage = (tipo: string) => tipo?.startsWith("image/");

  return (<Card><CardContent className="pt-4 space-y-4">
    {/* Tabs upload/url */}
    <div className="flex gap-2 mb-2">
      <Button size="sm" variant={modo === "upload" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setModo("upload")}><Upload className="h-3 w-3 mr-1" /> Upload</Button>
      <Button size="sm" variant={modo === "url" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setModo("url")}><ExternalLink className="h-3 w-3 mr-1" /> URL</Button>
    </div>

    {modo === "upload" ? (
      <div
        className={`p-6 rounded-lg border-2 border-dashed text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-primary/40"}`}
        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
        onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = ".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"; inp.onchange = (e) => { const f = (e.target as HTMLInputElement).files; if (f) handleFiles(f); }; inp.click(); }}
      >
        {uploading ? <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" /> : <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />}
        <p className="text-sm font-medium">{uploading ? "Enviando..." : "Arraste arquivos aqui"}</p>
        <p className="text-[10px] text-muted-foreground mt-1">ou clique para selecionar · PDF, imagens, docs · Máx 10MB</p>
      </div>
    ) : (
      <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
        <div className="grid grid-cols-2 gap-2"><Input placeholder="Nome" value={nome} onChange={e => setNome(e.target.value)} className="h-8 text-sm" /><Input placeholder="URL do arquivo" value={url} onChange={e => setUrl(e.target.value)} className="h-8 text-sm" /></div>
        <Button size="sm" onClick={() => salvar.mutate({ contatoId, nome: nome || "Arquivo", url })} disabled={!url || salvar.isPending}><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
      </div>
    )}

    {!arquivos.length ? <p className="text-sm text-muted-foreground text-center py-4">Nenhum arquivo.</p> : <div className="space-y-2">{arquivos.map((a: any) => (
      <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/20 transition-colors">
        {isImage(a.tipo) ? <div className="h-10 w-10 rounded-lg overflow-hidden bg-muted shrink-0"><img src={a.url} alt={a.nome} className="h-full w-full object-cover" onError={(e) => { (e.target as any).style.display = "none"; }} /></div> : <FileText className="h-4 w-4 text-blue-500 shrink-0" />}
        <div className="flex-1 min-w-0">
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-600 hover:underline truncate block">{a.nome}</a>
          <p className="text-[10px] text-muted-foreground">{a.tipo || "Documento"} {a.tamanho ? `· ${formatSize(a.tamanho)}` : ""} · {new Date(a.createdAt).toLocaleDateString("pt-BR")}</p>
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive shrink-0" onClick={() => excluir.mutate({ id: a.id })}><Trash2 className="h-3 w-3" /></Button>
      </div>
    ))}</div>}
  </CardContent></Card>);
}

function NovoClienteDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void }) {
  const [nome, setNome] = useState(""); const [tel, setTel] = useState(""); const [email, setEmail] = useState(""); const [cpf, setCpf] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const criar = trpc.clientes.criar.useMutation({ onSuccess: () => { toast.success("Cadastrado!"); onOpenChange(false); setNome(""); setTel(""); setEmail(""); setCpf(""); setErros({}); onSuccess(); }, onError: (e: any) => toast.error(e.message) });

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
  </div><DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => { if (validar()) criar.mutate({ nome, telefone: tel || undefined, email: email || undefined, cpfCnpj: cpf || undefined }); }} disabled={!nome || criar.isPending}>{criar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Cadastrar</Button></DialogFooter></DialogContent></Dialog>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aba Assinaturas Digitais — enviar documentos para assinatura
// ═══════════════════════════════════════════════════════════════════════════════

const STATUS_ASSINATURA_LABELS: Record<string, string> = { pendente: "Pendente", enviado: "Enviado", visualizado: "Visualizado", assinado: "Assinado", recusado: "Recusado", expirado: "Expirado" };
const STATUS_ASSINATURA_CORES: Record<string, string> = { pendente: "text-gray-600 bg-gray-100", enviado: "text-blue-600 bg-blue-100", visualizado: "text-amber-600 bg-amber-100", assinado: "text-emerald-600 bg-emerald-100", recusado: "text-red-600 bg-red-100", expirado: "text-gray-500 bg-gray-100" };

function AssinaturasTab({ contatoId, cliente, assinaturas, onRefresh }: { contatoId: number; cliente: any; assinaturas: any[]; onRefresh: () => void }) {
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

function TarefasClienteTab({ contatoId }: { contatoId: number }) {
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
