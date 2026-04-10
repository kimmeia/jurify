import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Bot, Plus, Edit, Trash2, Link2, FileText, FileIcon, Loader2,
  Send, Sparkles, ExternalLink, BrainCircuit, Play, KeyRound, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

// ─── Catálogo de módulos e áreas ───────────────────────────────────────────

const MODULOS = [
  { id: "atendimento", label: "Atendimento (chatbot WhatsApp)" },
  { id: "analiseProcessual", label: "Análise Processual" },
  { id: "resumos", label: "Resumos de conversas" },
  { id: "documentos", label: "Geração de documentos" },
  { id: "pesquisa", label: "Pesquisa jurisprudencial" },
  { id: "calculos", label: "Assistência em cálculos" },
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
  "Direito de Família",
  "Direito Penal",
  "Análise Processual",
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
  openaiApiKey: string;
}

const DEFAULT_FORM: AgenteForm = {
  nome: "",
  descricao: "",
  areaConhecimento: "",
  modelo: "gpt-4o-mini",
  prompt:
    "Você é um assistente jurídico especializado, educado e preciso. Use os documentos de treinamento fornecidos como fonte principal de informação. Se a pergunta estiver fora do seu escopo, admita com transparência e sugira falar com um advogado.",
  temperatura: "0.70",
  maxTokens: 800,
  modulosPermitidos: ["atendimento"],
  ativo: true,
  openaiApiKey: "",
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

  // Detectar quais IAs estão configuradas
  const { data: canaisData } = trpc.configuracoes.listarCanais.useQuery();
  const canaisIA = canaisData?.canais || [];
  const chatgptConfigurado = canaisIA.some(
    (c: any) => (c.tipo === "chatgpt" || (c.tipo === "whatsapp_api" && (c.nome || "").includes("ChatGPT"))) && c.status === "conectado",
  );
  const claudeConfigurado = canaisIA.some(
    (c: any) => (c.tipo === "claude" || (c.nome || "").includes("Claude")) && c.status === "conectado",
  );
  const algumIAConfigurado = chatgptConfigurado || claudeConfigurado;
  const ambosConfigurados = chatgptConfigurado && claudeConfigurado;

  const { data: existing } = trpc.agentesIa.obter.useQuery(
    { id: agenteId! },
    { enabled: !!agenteId && open },
  );

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
        temperatura: existing.temperatura ?? "0.70",
        maxTokens: existing.maxTokens,
        modulosPermitidos: existing.modulosPermitidos ?? [],
        ativo: existing.ativo,
        openaiApiKey: "", // nunca popula (key criptografada — user precisa digitar de novo se quiser trocar)
      });
    }
  }, [open, agenteId, existing]);

  const criarMut = trpc.agentesIa.criar.useMutation({
    onSuccess: () => {
      toast.success("Agente criado!");
      setForm(DEFAULT_FORM);
      onSaved();
      onOpenChange(false);
    },
    onError: (err) => toast.error("Erro ao criar", { description: err.message }),
  });

  const atualizarMut = trpc.agentesIa.atualizar.useMutation({
    onSuccess: () => {
      toast.success("Agente atualizado!");
      onSaved();
      onOpenChange(false);
    },
    onError: (err) => toast.error("Erro ao atualizar", { description: err.message }),
  });

  const handleSave = () => {
    if (!form.nome.trim() || form.nome.length < 2) {
      toast.error("Nome é obrigatório");
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
        descricao: form.descricao,
        areaConhecimento: form.areaConhecimento,
        modelo: form.modelo,
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
        modelo: form.modelo,
        prompt: form.prompt,
        temperatura: form.temperatura,
        maxTokens: form.maxTokens,
        modulosPermitidos: form.modulosPermitidos,
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
            Configure um agente especializado para tarefas do escritório.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input
                placeholder="Ex: Analisador Processual"
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
              placeholder="Defina a 'personalidade' e instruções do agente..."
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
              <Select value={form.modelo} onValueChange={(v) => setForm({ ...form, modelo: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {chatgptConfigurado && (
                    <>
                      <SelectItem value="gpt-4o-mini">GPT-4o Mini (OpenAI — barato)</SelectItem>
                      <SelectItem value="gpt-4o">GPT-4o (OpenAI — avançado)</SelectItem>
                    </>
                  )}
                  {claudeConfigurado && (
                    <>
                      <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4 (Anthropic — avançado)</SelectItem>
                      <SelectItem value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Anthropic — rápido)</SelectItem>
                    </>
                  )}
                  {!chatgptConfigurado && !claudeConfigurado && (
                    <SelectItem value="gpt-4o-mini" disabled>Nenhuma IA configurada</SelectItem>
                  )}
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
                min={100}
                max={4000}
              />
            </div>
          </div>

          {algumIAConfigurado ? (
            <div className="flex items-center gap-2 p-2.5 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 text-xs text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                {ambosConfigurados ? "ChatGPT e Claude configurados — escolha o modelo acima" :
                 chatgptConfigurado ? "API Key OpenAI configurada em Integrações → ChatGPT" :
                 "API Key Claude configurada em Integrações → Claude"}
              </span>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 p-3 text-xs text-amber-900 dark:text-amber-200">
              <p className="font-semibold">Nenhuma IA configurada</p>
              <p className="mt-0.5">
                Vá em <strong>Configurações → Integrações</strong> e cadastre a API Key do
                <strong> ChatGPT (OpenAI)</strong> ou <strong>Claude (Anthropic)</strong> antes de criar agentes.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Módulos onde este agente será usado</Label>
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
            <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={criarMut.isPending || atualizarMut.isPending || !algumIAConfigurado}>
            {(criarMut.isPending || atualizarMut.isPending) && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            {agenteId ? "Salvar" : "Criar agente"}
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

  const { data: agente, refetch } = trpc.agentesIa.obter.useQuery(
    { id: agenteId! },
    { enabled: !!agenteId && open },
  );

  const uploadMut = trpc.agentesIa.uploadArquivo.useMutation({
    onSuccess: () => {
      toast.success("Arquivo enviado");
      refetch();
    },
    onError: (err) => toast.error("Erro no upload", { description: err.message }),
  });

  const linkMut = trpc.agentesIa.adicionarLink.useMutation({
    onSuccess: () => {
      toast.success("Link adicionado");
      setLinkNome("");
      setLinkUrl("");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const textoMut = trpc.agentesIa.adicionarTexto.useMutation({
    onSuccess: () => {
      toast.success("Texto adicionado");
      setTextoNome("");
      setTextoConteudo("");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const deletarDocMut = trpc.agentesIa.deletarDocumento.useMutation({
    onSuccess: () => {
      toast.success("Removido");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const testarMut = trpc.agentesIa.testar.useMutation({
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
            Adicione conhecimento que o agente usará para responder perguntas nos módulos do sistema.
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
                    {(d.tipo === "arquivo" || d.tipo === "link") && d.url && (
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

          <TabsContent value="link" className="space-y-3 py-3">
            <div className="border rounded-lg p-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Nome do link</Label>
                <Input
                  placeholder="Ex: Jurisprudência STF - Horas Extras"
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
                  linkMut.mutate({ agenteId, nome: linkNome, url: linkUrl });
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

          <TabsContent value="texto" className="space-y-3 py-3">
            <div className="border rounded-lg p-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input
                  placeholder="Ex: Procedimento interno de análise processual"
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
                  textoMut.mutate({ agenteId, nome: textoNome, conteudo: textoConteudo });
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

          <TabsContent value="testar" className="space-y-3 py-3">
            <div className="border rounded-lg p-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Pergunta de teste</Label>
                <Textarea
                  rows={3}
                  placeholder="Ex: Analise o processo 0001234-56.2024.5.02.0001 e identifique riscos trabalhistas"
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
                  testarMut.mutate({ agenteId, pergunta: testeQuestion });
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

export default function AgentesIA() {
  const { data: agentes, isLoading, refetch } = trpc.agentesIa.listar.useQuery();

  const [formOpen, setFormOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [treinandoId, setTreinandoId] = useState<number | null>(null);

  const toggleAtivoMut = trpc.agentesIa.toggleAtivo.useMutation({
    onSuccess: () => {
      toast.success("Atualizado");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const excluirMut = trpc.agentesIa.excluir.useMutation({
    onSuccess: () => {
      toast.success("Agente removido");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/40 dark:to-purple-900/40">
            <BrainCircuit className="h-6 w-6 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Agentes de IA</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Crie assistentes especializados treináveis para análise processual, atendimento,
              pesquisa e muito mais.
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setEditandoId(null);
            setFormOpen(true);
          }}
          className="bg-violet-600 hover:bg-violet-700"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Novo agente
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : !agentes || agentes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Bot className="h-14 w-14 mb-4 opacity-30" />
            <p className="text-lg font-semibold text-foreground mb-2">
              Nenhum agente criado ainda
            </p>
            <p className="text-sm text-center max-w-md mb-4">
              Agentes de IA ajudam com análise processual automática, respostas no chatbot
              de atendimento, resumos de conversas, pesquisa jurisprudencial e muito mais.
              Crie o primeiro pra começar.
            </p>
            <Button
              onClick={() => {
                setEditandoId(null);
                setFormOpen(true);
              }}
              className="bg-violet-600 hover:bg-violet-700"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Criar primeiro agente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agentes.map((a) => (
            <Card key={a.id} className={`transition-all ${a.ativo ? "" : "opacity-60"}`}>
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

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <FileIcon className="h-3 w-3" />
                    <span>
                      {a.totalDocumentos} {a.totalDocumentos === 1 ? "doc" : "docs"}
                    </span>
                  </div>
                  {a.temApiKey && (
                    <div className="flex items-center gap-1 text-emerald-600">
                      <KeyRound className="h-3 w-3" />
                      <span>Key própria</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-[10px] h-7"
                    onClick={() => setTreinandoId(a.id)}
                  >
                    <BrainCircuit className="h-3 w-3 mr-1" />
                    Treinar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[10px] h-7 px-2"
                    onClick={() => {
                      setEditandoId(a.id);
                      setFormOpen(true);
                    }}
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[10px] h-7 px-2 text-destructive hover:text-destructive"
                    onClick={() => {
                      if (
                        confirm(
                          `Deletar agente "${a.nome}"? Todos os documentos de treinamento também serão removidos.`,
                        )
                      ) {
                        excluirMut.mutate({ id: a.id });
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
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setEditandoId(null);
        }}
        onSaved={refetch}
      />

      <TreinamentoDialog
        key={`train-${treinandoId}`}
        agenteId={treinandoId}
        open={!!treinandoId}
        onOpenChange={(o) => {
          if (!o) setTreinandoId(null);
        }}
      />
    </div>
  );
}
