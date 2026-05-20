import { useState, useRef, useEffect, useMemo } from "react";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot, Plus, Edit, Trash2, Link2, FileText, FileIcon, Loader2,
  Send, Sparkles, ExternalLink, BrainCircuit, Play, KeyRound, CheckCircle2,
  MessageSquare, Search, Store, Users, User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AgenteCard, type AgenteCardData } from "./agentes/agente-card";
import { AgentesHero } from "./agentes/agentes-hero";

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
      // Se o escritório só tem Claude configurado, default vai pra modelo
      // Claude — senão o user cria o agente com gpt-4o-mini e a IA falha
      // por falta de key OpenAI ao testar.
      const modeloPadrao = !chatgptConfigurado && claudeConfigurado
        ? "claude-haiku-4-5-20251001"
        : DEFAULT_FORM.modelo;
      setForm({ ...DEFAULT_FORM, modelo: modeloPadrao });
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
  }, [open, agenteId, existing, chatgptConfigurado, claudeConfigurado]);

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
  const [docParaExcluir, setDocParaExcluir] = useState<{ id: number; nome: string } | null>(null);

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

    if (file.size > 2 * 1024 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 2GB)");
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
                PDF, DOCX, TXT, MD, CSV, JSON — até 2GB
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
                      onClick={() => setDocParaExcluir({ id: d.id, nome: d.nome })}
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

      <AlertDialog
        open={docParaExcluir !== null}
        onOpenChange={(o) => { if (!o) setDocParaExcluir(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover documento?</AlertDialogTitle>
            <AlertDialogDescription>
              O documento <strong>{docParaExcluir?.nome}</strong> será removido
              do treinamento deste agente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletarDocMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletarDocMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (docParaExcluir) {
                  deletarDocMut.mutate(
                    { id: docParaExcluir.id },
                    { onSuccess: () => setDocParaExcluir(null) },
                  );
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletarDocMut.isPending ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════

export default function AgentesIA() {
  const { data: agentes, isLoading, refetch } = trpc.agentesIa.listar.useQuery();
  const { data: templates, isLoading: templatesLoading } = trpc.agentesIa.listarTemplates.useQuery();
  const { data: me } = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 });

  const [tab, setTab] = useState<"templates" | "escritorio" | "meus">("templates");
  const [busca, setBusca] = useState("");
  const [areaFiltro, setAreaFiltro] = useState<string>("todas");
  const [formOpen, setFormOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [treinandoId, setTreinandoId] = useState<number | null>(null);
  const [excluirAlvo, setExcluirAlvo] = useState<AgenteCardData | null>(null);

  const toggleAtivoMut = trpc.agentesIa.toggleAtivo.useMutation({
    onSuccess: () => { toast.success("Atualizado"); refetch(); },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const excluirMut = trpc.agentesIa.excluir.useMutation({
    onSuccess: () => { toast.success("Agente removido"); setExcluirAlvo(null); refetch(); },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const clonarMut = trpc.agentesIa.clonarTemplate.useMutation({
    onSuccess: (data) => {
      toast.success("Template clonado!", {
        description: data.totalDocsClonados > 0
          ? `${data.totalDocsClonados} docs de treinamento copiados. Você pode editar e treinar.`
          : "Pode editar e adicionar documentos próprios.",
      });
      refetch();
      setTab("escritorio");
    },
    onError: (err) => toast.error("Erro ao clonar", { description: err.message }),
  });

  // Áreas dos agentes (para o filtro)
  const todasAreas = useMemo(() => {
    const set = new Set<string>();
    (templates || []).forEach((t: any) => { if (t.areaConhecimento) set.add(t.areaConhecimento); });
    (agentes || []).forEach((a: any) => { if (a.areaConhecimento) set.add(a.areaConhecimento); });
    return Array.from(set).sort();
  }, [templates, agentes]);

  // Filtra por busca + área
  const filtrar = <T extends { nome: string; areaConhecimento?: string | null; descricao?: string | null }>(lista: T[]) => {
    const q = busca.trim().toLowerCase();
    return lista.filter((a) => {
      if (areaFiltro !== "todas" && a.areaConhecimento !== areaFiltro) return false;
      if (!q) return true;
      return (
        a.nome.toLowerCase().includes(q)
        || (a.descricao || "").toLowerCase().includes(q)
        || (a.areaConhecimento || "").toLowerCase().includes(q)
      );
    });
  };

  // Separa agentes do escritório em "do escritório (criado por outros)" e "meus (criado por mim)"
  const meuUserId = (me as any)?.id;
  const agentesEscritorio = (agentes || []).filter((a: any) => a.criadoPor !== meuUserId);
  const agentesMeus = (agentes || []).filter((a: any) => a.criadoPor === meuUserId);

  // Adapta para AgenteCardData
  const toCardData = (a: any, origem: "escritorio" | "pessoal" | "template"): AgenteCardData => ({
    id: a.id,
    nome: a.nome,
    descricao: a.descricao,
    areaConhecimento: a.areaConhecimento,
    modelo: a.modelo,
    modulosPermitidos: a.modulosPermitidos || [],
    totalDocumentos: a.totalDocumentos || 0,
    ativo: a.ativo,
    temApiKey: a.temApiKey,
    origem,
  });

  const templatesFiltrados = filtrar(templates || []).map((t: any) => toCardData(t, "template"));
  const escritorioFiltrados = filtrar(agentesEscritorio).map((a: any) => toCardData(a, "escritorio"));
  const meusFiltrados = filtrar(agentesMeus).map((a: any) => toCardData(a, "pessoal"));

  // Heurística leve de badges para templates (top 2 por nome = popular, recente = novo)
  templatesFiltrados.forEach((t, i) => {
    if (i === 0) t.badge = "popular";
    else if (i === 1) t.badge = "verificado";
    else if (i === 2) t.badge = "novo";
  });

  const listaAtual = tab === "templates" ? templatesFiltrados : tab === "escritorio" ? escritorioFiltrados : meusFiltrados;
  const isLoadingAtual = tab === "templates" ? templatesLoading : isLoading;
  const totalAgentes = (agentes || []).length;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <AgentesHero onNovo={() => { setEditandoId(null); setFormOpen(true); }} />

      {/* Tabs Templates · Escritório · Meus */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex bg-muted/50 rounded-xl p-1 gap-0.5">
          <TabButton
            active={tab === "templates"}
            onClick={() => setTab("templates")}
            icon={<Store className="h-3.5 w-3.5" />}
            label="Templates"
            count={templates?.length ?? 0}
          />
          <TabButton
            active={tab === "escritorio"}
            onClick={() => setTab("escritorio")}
            icon={<Users className="h-3.5 w-3.5" />}
            label="Escritório"
            count={agentesEscritorio.length}
          />
          <TabButton
            active={tab === "meus"}
            onClick={() => setTab("meus")}
            icon={<UserIcon className="h-3.5 w-3.5" />}
            label="Meus"
            count={agentesMeus.length}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar agente, área, descrição…"
              className="h-9 pl-8 pr-3 text-xs w-56"
            />
          </div>
          {todasAreas.length > 0 && (
            <Select value={areaFiltro} onValueChange={setAreaFiltro}>
              <SelectTrigger className="h-9 text-xs w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as áreas</SelectItem>
                {todasAreas.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Banner contextual da aba atual */}
      {tab === "templates" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900/40 px-4 py-2.5 flex items-start gap-2.5">
          <Store className="h-4 w-4 text-amber-700 dark:text-amber-300 mt-0.5 shrink-0" />
          <div className="text-xs">
            <p className="font-semibold text-amber-900 dark:text-amber-200">Catálogo da Jurify</p>
            <p className="text-amber-800/80 dark:text-amber-300/80 mt-0.5">
              Agentes pré-construídos pela equipe Jurify. Clique em <strong>Clonar p/ escritório</strong> para customizar com seus documentos e prompts.
            </p>
          </div>
        </div>
      )}
      {tab === "meus" && totalAgentes === 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/50 dark:bg-violet-950/20 dark:border-violet-900/40 px-4 py-2.5 flex items-start gap-2.5">
          <Sparkles className="h-4 w-4 text-violet-700 dark:text-violet-300 mt-0.5 shrink-0" />
          <div className="text-xs">
            <p className="font-semibold">Comece com um template</p>
            <p className="text-muted-foreground mt-0.5">
              A forma mais rápida é clonar um template pronto na aba Templates e ajustar o prompt + documentos.
            </p>
          </div>
        </div>
      )}

      {/* Grid de cards */}
      {isLoadingAtual ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : listaAtual.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Bot className="h-14 w-14 mb-4 opacity-30" />
            <p className="text-lg font-semibold text-foreground mb-2">
              {busca || areaFiltro !== "todas"
                ? "Nada encontrado com esse filtro"
                : tab === "templates"
                  ? "Sem templates disponíveis no momento"
                  : tab === "escritorio"
                    ? "Nenhum agente compartilhado pelo escritório"
                    : "Você ainda não criou um agente"}
            </p>
            {tab === "meus" && !busca && (
              <Button
                onClick={() => { setEditandoId(null); setFormOpen(true); }}
                className="bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 mt-2"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Criar primeiro agente
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {listaAtual.map((agente) => (
            <AgenteCard
              key={`${agente.origem}-${agente.id}`}
              agente={agente}
              onClone={(id) => clonarMut.mutate({ templateId: id })}
              onEditar={(id) => { setEditandoId(id); setFormOpen(true); }}
              onTreinar={(id) => setTreinandoId(id)}
              onExcluir={(a) => setExcluirAlvo(a)}
              onToggleAtivo={(id, ativo) => toggleAtivoMut.mutate({ id, ativo })}
            />
          ))}
        </div>
      )}

      <AgenteFormDialog
        key={editandoId || "new"}
        agenteId={editandoId}
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditandoId(null); }}
        onSaved={refetch}
      />

      <TreinamentoDialog
        key={`train-${treinandoId}`}
        agenteId={treinandoId}
        open={!!treinandoId}
        onOpenChange={(o) => { if (!o) setTreinandoId(null); }}
      />

      <AlertDialog open={!!excluirAlvo} onOpenChange={(o) => !o && setExcluirAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agente "{excluirAlvo?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá o agente e <strong>todos os documentos de treinamento</strong>.
              Conversas anteriores também serão arquivadas. Não é possível desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (excluirAlvo) excluirMut.mutate({ id: excluirAlvo.id }); }}
              disabled={excluirMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluirMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TabButton({
  active, onClick, icon, label, count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 transition " +
        (active
          ? "bg-background text-violet-700 dark:text-violet-300 font-semibold shadow-sm ring-1 ring-violet-300/30"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {icon}
      {label}
      <span className={"text-[10px] font-bold px-1.5 py-0.5 rounded-full " + (active ? "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" : "bg-muted text-muted-foreground")}>
        {count}
      </span>
    </button>
  );
}
