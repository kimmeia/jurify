import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot, Plus, Edit, Trash2, Upload, Link2, FileText, FileIcon, Loader2,
  Send, Sparkles, AlertTriangle, CheckCircle2, ExternalLink, BrainCircuit, Play,
} from "lucide-react";
import { toast } from "sonner";

const MODULOS = [
  { id: "atendimento", label: "Atendimento (Chatbot WhatsApp/Chat)" },
  { id: "resumos", label: "Resumos automáticos de conversas" },
  { id: "calculos", label: "Cálculos jurídicos (assistência)" },
  { id: "processos", label: "Análise de processos" },
  { id: "documentos", label: "Geração de documentos" },
];

const AREAS = [
  "Direito Trabalhista",
  "Direito Civil",
  "Direito Tributário",
  "Direito Previdenciário",
  "Direito Bancário",
  "Direito Imobiliário",
  "Direito Empresarial",
  "Direito do Consumidor",
  "Geral / Recepção",
  "FAQ do Escritório",
];

interface AgenteForm {
  nome: string;
  descricao: string;
  areaConhecimento: string;
  modelo: string;
  prompt: string;
  temperatura: string;
  maxTokens: number;
  modulosPermitidos: string[];
  ativo: boolean;
}

const DEFAULT_FORM: AgenteForm = {
  nome: "",
  descricao: "",
  areaConhecimento: "",
  modelo: "gpt-4o-mini",
  prompt: "Você é um assistente jurídico educado e profissional. Responda de forma clara, concisa e precisa, baseado nos documentos de treinamento fornecidos. Se uma pergunta estiver fora do seu escopo ou conhecimento, admita com transparência e sugira que o cliente fale com um advogado da equipe.",
  temperatura: "0.70",
  maxTokens: 800,
  modulosPermitidos: ["atendimento"],
  ativo: true,
};

// ═════════════════════════════════════════════════════════════════════════════
// DIALOG: CRIAR / EDITAR AGENTE
// ═════════════════════════════════════════════════════════════════════════════

function AgenteFormDialog({
  agenteId,
  open,
  onOpenChange,
  onSaved,
}: {
  agenteId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AgenteForm>(DEFAULT_FORM);

  const { data: existing } = trpc.adminAgentesIa.obter.useQuery(
    { id: agenteId! },
    { enabled: !!agenteId && open },
  );

  // Popula o form quando abre: sem agenteId = DEFAULT_FORM,
  // com agenteId = espera a query carregar e copia os campos.
  useEffect(() => {
    if (!open) return;
    if (!agenteId) {
      setForm(DEFAULT_FORM);
      return;
    }
    if (existing) {
      setForm({
        nome: existing.nome,
        descricao: existing.descricao ?? "",
        areaConhecimento: existing.areaConhecimento ?? "",
        modelo: existing.modelo,
        prompt: existing.prompt,
        temperatura: existing.temperatura,
        maxTokens: existing.maxTokens,
        modulosPermitidos: existing.modulosPermitidos ?? [],
        ativo: existing.ativo,
      });
    }
  }, [open, agenteId, existing]);

  const criarMut = trpc.adminAgentesIa.criar.useMutation({
    onSuccess: () => {
      toast.success("Agente criado!");
      setForm(DEFAULT_FORM);
      onSaved();
      onOpenChange(false);
    },
    onError: (err) => toast.error("Erro ao criar", { description: err.message }),
  });

  const atualizarMut = trpc.adminAgentesIa.atualizar.useMutation({
    onSuccess: () => {
      toast.success("Agente atualizado!");
      onSaved();
      onOpenChange(false);
    },
    onError: (err) => toast.error("Erro ao atualizar", { description: err.message }),
  });

  const handleSave = () => {
    if (!form.nome.trim() || form.nome.length < 2) {
      toast.error("Nome do agente é obrigatório");
      return;
    }
    if (!form.prompt.trim() || form.prompt.length < 10) {
      toast.error("Prompt muito curto");
      return;
    }

    if (agenteId) {
      atualizarMut.mutate({
        id: agenteId,
        nome: form.nome,
        descricao: form.descricao || null,
        areaConhecimento: form.areaConhecimento || null,
        modelo: form.modelo as any,
        prompt: form.prompt,
        temperatura: form.temperatura,
        maxTokens: form.maxTokens,
        modulosPermitidos: form.modulosPermitidos,
        ativo: form.ativo,
      });
    } else {
      criarMut.mutate({
        nome: form.nome,
        descricao: form.descricao || undefined,
        areaConhecimento: form.areaConhecimento || undefined,
        modelo: form.modelo as any,
        prompt: form.prompt,
        temperatura: form.temperatura,
        maxTokens: form.maxTokens,
        modulosPermitidos: form.modulosPermitidos,
        ativo: form.ativo,
      });
    }
  };

  const toggleModulo = (id: string) => {
    setForm((f) => ({
      ...f,
      modulosPermitidos: f.modulosPermitidos.includes(id)
        ? f.modulosPermitidos.filter((m) => m !== id)
        : [...f.modulosPermitidos, id],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{agenteId ? "Editar Agente" : "Novo Agente de IA"}</DialogTitle>
          <DialogDescription>
            Configure um agente que será usado pelos módulos do Jurify (Atendimento, Resumos, etc).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input
                placeholder="Ex: Recepcionista Trabalhista"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Área de conhecimento</Label>
              <Select
                value={form.areaConhecimento}
                onValueChange={(v) => setForm({ ...form, areaConhecimento: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {AREAS.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input
              placeholder="Resumo curto sobre o papel deste agente"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              maxLength={512}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Prompt de sistema *</Label>
            <Textarea
              rows={6}
              placeholder="Defina a 'personalidade' e as instruções do agente..."
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground">
              {form.prompt.length} / 8000 caracteres
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Modelo</Label>
              <Select
                value={form.modelo}
                onValueChange={(v) => setForm({ ...form, modelo: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o-mini">gpt-4o-mini (barato)</SelectItem>
                  <SelectItem value="gpt-4o">gpt-4o (avançado)</SelectItem>
                  <SelectItem value="gpt-4-turbo">gpt-4-turbo</SelectItem>
                  <SelectItem value="gpt-3.5-turbo">gpt-3.5-turbo (legado)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Temperatura (0-2)</Label>
              <Input
                value={form.temperatura}
                onChange={(e) => setForm({ ...form, temperatura: e.target.value })}
                placeholder="0.70"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Max tokens</Label>
              <Input
                type="number"
                value={form.maxTokens}
                onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })}
                min={50}
                max={4000}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Módulos onde este agente pode ser usado</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {MODULOS.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 text-xs p-2 rounded border cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={form.modulosPermitidos.includes(m.id)}
                    onChange={() => toggleModulo(m.id)}
                    className="accent-primary"
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Ativo</Label>
              <p className="text-[11px] text-muted-foreground">
                Só agentes ativos aparecem para os módulos
              </p>
            </div>
            <Switch
              checked={form.ativo}
              onCheckedChange={(v) => setForm({ ...form, ativo: v })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleSave}
            disabled={criarMut.isPending || atualizarMut.isPending}
          >
            {(criarMut.isPending || atualizarMut.isPending) && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            {agenteId ? "Salvar alterações" : "Criar agente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// DIALOG: TREINAMENTO (Documentos + Links + Texto + Teste)
// ═════════════════════════════════════════════════════════════════════════════

function TreinamentoDialog({
  agenteId,
  open,
  onOpenChange,
}: {
  agenteId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [tab, setTab] = useState("documentos");
  const [linkNome, setLinkNome] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [textoNome, setTextoNome] = useState("");
  const [textoConteudo, setTextoConteudo] = useState("");
  const [testeQuestion, setTesteQuestion] = useState("");
  const [testeResposta, setTesteResposta] = useState<string | null>(null);
  const [tokensUsados, setTokensUsados] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: agente, refetch } = trpc.adminAgentesIa.obter.useQuery(
    { id: agenteId! },
    { enabled: !!agenteId && open },
  );

  const uploadMut = trpc.adminAgentesIa.uploadArquivo.useMutation({
    onSuccess: () => {
      toast.success("Arquivo enviado");
      refetch();
    },
    onError: (err) => toast.error("Erro no upload", { description: err.message }),
  });

  const linkMut = trpc.adminAgentesIa.adicionarLink.useMutation({
    onSuccess: () => {
      toast.success("Link adicionado");
      setLinkNome("");
      setLinkUrl("");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const textoMut = trpc.adminAgentesIa.adicionarTexto.useMutation({
    onSuccess: () => {
      toast.success("Texto adicionado");
      setTextoNome("");
      setTextoConteudo("");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const deletarDocMut = trpc.adminAgentesIa.deletarDocumento.useMutation({
    onSuccess: () => {
      toast.success("Removido");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const testarMut = trpc.adminAgentesIa.testar.useMutation({
    onSuccess: (r) => {
      setTesteResposta(r.resposta);
      setTokensUsados(r.tokensUsados);
    },
    onError: (err) => toast.error("Erro ao testar", { description: err.message }),
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !agenteId) return;

    if (file.size > 15 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 15MB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      uploadMut.mutate({
        agenteId,
        nome: file.name,
        tipo: file.type || "application/octet-stream",
        base64,
      });
    };
    reader.readAsDataURL(file);

    // Reset input pra permitir upload do mesmo arquivo de novo
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!agenteId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-violet-600" />
            Treinamento: {agente?.nome || "..."}
          </DialogTitle>
          <DialogDescription>
            Adicione documentos, links e textos. O agente usa esse conhecimento
            quando responder perguntas nos módulos.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="documentos" className="text-xs">
              <FileIcon className="h-3 w-3 mr-1" /> Docs ({agente?.documentos?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="link" className="text-xs">
              <Link2 className="h-3 w-3 mr-1" /> Link
            </TabsTrigger>
            <TabsTrigger value="texto" className="text-xs">
              <FileText className="h-3 w-3 mr-1" /> Texto
            </TabsTrigger>
            <TabsTrigger value="testar" className="text-xs">
              <Play className="h-3 w-3 mr-1" /> Testar
            </TabsTrigger>
          </TabsList>

          {/* ─── Documentos ─── */}
          <TabsContent value="documentos" className="space-y-3 py-3">
            <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
              <Label className="text-xs">Enviar arquivo</Label>
              <p className="text-[11px] text-muted-foreground">
                PDF, DOCX, TXT, MD, CSV, JSON — até 15MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/json"
                onChange={handleFileUpload}
                className="text-xs file:mr-2 file:py-1 file:px-3 file:rounded file:border file:border-input file:bg-background file:text-xs file:cursor-pointer w-full"
              />
              {uploadMut.isPending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Enviando...
                </div>
              )}
            </div>

            {/* Lista de documentos */}
            {agente?.documentos && agente.documentos.length > 0 ? (
              <div className="space-y-1.5">
                {agente.documentos.map((d: any) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 border rounded-md p-2 text-xs"
                  >
                    {d.tipo === "arquivo" ? (
                      <FileIcon className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    ) : d.tipo === "link" ? (
                      <Link2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-violet-600 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{d.nome}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {d.tipo === "arquivo" && d.tamanho
                          ? `${(d.tamanho / 1024).toFixed(1)} KB · ${d.mimeType}`
                          : d.tipo === "link"
                          ? d.url
                          : d.conteudo?.slice(0, 60) + "..."}
                      </p>
                    </div>
                    {d.tipo === "arquivo" && d.url && (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {d.tipo === "link" && d.url && (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <button
                      onClick={() => {
                        if (confirm(`Remover "${d.nome}"?`)) {
                          deletarDocMut.mutate({ id: d.id });
                        }
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground text-xs">
                <FileIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Nenhum documento ainda
              </div>
            )}
          </TabsContent>

          {/* ─── Link ─── */}
          <TabsContent value="link" className="space-y-3 py-3">
            <div className="border rounded-lg p-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Nome do link</Label>
                <Input
                  placeholder="Ex: Código Civil Brasileiro"
                  value={linkNome}
                  onChange={(e) => setLinkNome(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>URL *</Label>
                <Input
                  placeholder="https://..."
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  type="url"
                />
              </div>
              <Button
                onClick={() => {
                  if (!linkUrl.trim() || !linkNome.trim()) {
                    toast.error("Preencha nome e URL");
                    return;
                  }
                  linkMut.mutate({
                    agenteId,
                    nome: linkNome,
                    url: linkUrl,
                  });
                }}
                disabled={linkMut.isPending || !linkUrl || !linkNome}
                className="w-full"
              >
                {linkMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Link2 className="h-4 w-4 mr-2" />
                Adicionar link
              </Button>
            </div>
          </TabsContent>

          {/* ─── Texto ─── */}
          <TabsContent value="texto" className="space-y-3 py-3">
            <div className="border rounded-lg p-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input
                  placeholder="Ex: FAQ Escritório"
                  value={textoNome}
                  onChange={(e) => setTextoNome(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Conteúdo *</Label>
                <Textarea
                  rows={10}
                  placeholder="Cole aqui texto que o agente deve conhecer..."
                  value={textoConteudo}
                  onChange={(e) => setTextoConteudo(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  {textoConteudo.length} / 50000 caracteres
                </p>
              </div>
              <Button
                onClick={() => {
                  if (!textoConteudo.trim() || !textoNome.trim()) {
                    toast.error("Preencha título e conteúdo");
                    return;
                  }
                  textoMut.mutate({
                    agenteId,
                    nome: textoNome,
                    conteudo: textoConteudo,
                  });
                }}
                disabled={textoMut.isPending || !textoConteudo || !textoNome}
                className="w-full"
              >
                {textoMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <FileText className="h-4 w-4 mr-2" />
                Adicionar texto
              </Button>
            </div>
          </TabsContent>

          {/* ─── Testar ─── */}
          <TabsContent value="testar" className="space-y-3 py-3">
            <div className="border rounded-lg p-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Pergunta de teste</Label>
                <Textarea
                  rows={3}
                  placeholder="Ex: Como calcular férias proporcionais?"
                  value={testeQuestion}
                  onChange={(e) => setTesteQuestion(e.target.value)}
                />
              </div>
              <Button
                onClick={() => {
                  if (!testeQuestion.trim()) {
                    toast.error("Digite uma pergunta");
                    return;
                  }
                  setTesteResposta(null);
                  testarMut.mutate({
                    agenteId,
                    pergunta: testeQuestion,
                  });
                }}
                disabled={testarMut.isPending || !testeQuestion}
                className="w-full"
              >
                {testarMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Enviar pergunta ao agente
              </Button>
            </div>

            {testeResposta && (
              <div className="border rounded-lg p-4 bg-violet-500/5 border-violet-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-violet-700">
                    <Sparkles className="h-3.5 w-3.5" />
                    Resposta do agente
                  </Label>
                  <Badge variant="outline" className="text-[10px]">
                    {tokensUsados} tokens
                  </Badge>
                </div>
                <p className="text-sm whitespace-pre-wrap">{testeResposta}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════

export default function AdminAgentesIA() {
  const { data: status } = trpc.adminAgentesIa.status.useQuery();
  const { data: agentes, isLoading, refetch } = trpc.adminAgentesIa.listar.useQuery();

  const [novoOpen, setNovoOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [treinandoId, setTreinandoId] = useState<number | null>(null);

  const toggleAtivoMut = trpc.adminAgentesIa.toggleAtivo.useMutation({
    onSuccess: () => {
      toast.success("Atualizado");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const deletarMut = trpc.adminAgentesIa.deletar.useMutation({
    onSuccess: () => {
      toast.success("Agente deletado");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/40 dark:to-purple-900/40">
            <BrainCircuit className="h-6 w-6 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Agentes de IA</h1>
            <p className="text-muted-foreground mt-1">
              Crie agentes treináveis que serão usados pelos módulos do Jurify (Atendimento, Resumos, etc).
            </p>
          </div>
        </div>
        <Button onClick={() => { setEditandoId(null); setNovoOpen(true); }}>
          <Plus className="h-4 w-4 mr-1.5" />
          Novo agente
        </Button>
      </div>

      {/* Aviso se OpenAI não estiver configurado */}
      {status && !status.openaiConfigurado && (
        <Card className="border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-foreground">OpenAI não configurado</p>
              <p className="text-sm text-muted-foreground mt-1">
                Você pode criar agentes, mas eles só funcionarão quando você configurar
                a API key do OpenAI em{" "}
                <a href="/admin/integrations" className="underline text-foreground">
                  /admin/integrations
                </a>
                .
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {status && status.openaiConfigurado && (
        <Card className="border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10">
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <p className="text-sm text-muted-foreground">
              OpenAI conectado — agentes podem ser testados e usados.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Lista de agentes */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : !agentes || agentes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Bot className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium text-foreground mb-2">Nenhum agente criado ainda</p>
            <p className="text-sm text-center max-w-md mb-4">
              Crie agentes especializados que serão usados pelos módulos do Jurify
              pra responder clientes, resumir conversas, analisar processos e muito mais.
            </p>
            <Button onClick={() => { setEditandoId(null); setNovoOpen(true); }}>
              <Plus className="h-4 w-4 mr-1.5" />
              Criar primeiro agente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agentes.map((a: any) => (
            <Card
              key={a.id}
              className={`transition-all ${a.ativo ? "" : "opacity-60"}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shrink-0">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">{a.nome}</CardTitle>
                      <p className="text-[10px] text-muted-foreground">
                        {a.modelo}
                        {a.areaConhecimento && ` · ${a.areaConhecimento}`}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={a.ativo}
                    onCheckedChange={(v) => toggleAtivoMut.mutate({ id: a.id, ativo: v })}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {a.descricao && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{a.descricao}</p>
                )}

                <div className="flex flex-wrap gap-1">
                  {(a.modulosPermitidos || []).slice(0, 3).map((m: string) => (
                    <span
                      key={m}
                      className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700"
                    >
                      {m}
                    </span>
                  ))}
                  {(a.modulosPermitidos || []).length > 3 && (
                    <span className="text-[9px] text-muted-foreground">
                      +{a.modulosPermitidos.length - 3}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <FileIcon className="h-3 w-3" />
                  <span>
                    {a.totalDocumentos} {a.totalDocumentos === 1 ? "documento" : "documentos"}
                  </span>
                </div>

                <div className="flex items-center gap-1 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-[10px] h-7"
                    onClick={() => { setTreinandoId(a.id); }}
                  >
                    <BrainCircuit className="h-3 w-3 mr-1" />
                    Treinar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[10px] h-7 px-2"
                    onClick={() => { setEditandoId(a.id); setNovoOpen(true); }}
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[10px] h-7 px-2 text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Deletar agente "${a.nome}"? Todos os documentos também serão removidos.`)) {
                        deletarMut.mutate({ id: a.id });
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AgenteFormDialog
        key={editandoId || "new"}
        agenteId={editandoId}
        open={novoOpen}
        onOpenChange={(o) => {
          setNovoOpen(o);
          if (!o) setEditandoId(null);
        }}
        onSaved={refetch}
      />

      <TreinamentoDialog
        key={`train-${treinandoId}`}
        agenteId={treinandoId}
        open={!!treinandoId}
        onOpenChange={(o) => { if (!o) setTreinandoId(null); }}
      />
    </div>
  );
}
