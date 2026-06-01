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
  MessageSquare, Search, Store, Users, User as UserIcon, RefreshCw, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { AgenteCard, type AgenteCardData } from "./agentes/agente-card";
import { AgentesHero } from "./agentes/agentes-hero";
import type { AgenteVariavel } from "@shared/agente-variaveis-types";
import { chavesFaltantes, type SugestaoCampo, type TipoCampoCaptura } from "@shared/prompt-campos-detector";

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
  camposCaptura: AgenteVariavel[];
  ativo: boolean;
  openaiApiKey: string;
}

const MODULO_ICONS: Record<string, string> = {
  atendimento: "💬",
  analiseProcessual: "⚖️",
  resumos: "📋",
  documentos: "📜",
  pesquisa: "🔍",
  calculos: "🧮",
};

const MODULO_LABELS_CURTOS: Record<string, string> = {
  atendimento: "Atendimento",
  analiseProcessual: "Processos",
  resumos: "Resumos",
  documentos: "Documentos",
  pesquisa: "Pesquisa",
  calculos: "Cálculos",
};

const TEMPLATES_QUICK = [
  {
    id: "trabalhista",
    icon: "⚖️",
    label: "Trabalhista",
    area: "Direito Trabalhista",
    descricao: "Especialista em CLT, súmulas TST e jurisprudência trabalhista.",
    prompt: "Você é um advogado especialista em Direito do Trabalho com 20 anos de experiência. Domina CLT (Lei 13.467/2017), súmulas TST e jurisprudência. Cite o dispositivo legal e súmula TST relevante em cada resposta. NUNCA prometa resultado (vedação Art. 30 II OAB). Adapte a linguagem ao perfil: cliente leigo (português claro) ou colega (técnico).",
    modulos: ["atendimento", "analiseProcessual"],
  },
  {
    id: "atendimento",
    icon: "💬",
    label: "Atendimento",
    area: "Geral / Recepção",
    descricao: "Compõe respostas WhatsApp empáticas e claras para clientes.",
    prompt: "Você é um atendente jurídico empático e profissional. Responda dúvidas com clareza, sem juridiquês. Use 1 emoji discreto quando ajudar a transmitir empatia. Encaminhe questões complexas para um advogado. NUNCA prometa resultado nem compita por preço.",
    modulos: ["atendimento"],
  },
  {
    id: "analista",
    icon: "🔍",
    label: "Analista",
    area: "Análise Processual",
    descricao: "Lê movimentações + extrai status, prazos e teses adversárias.",
    prompt: "Você é um analista jurídico experiente. Ao receber atos processuais, extraia: (1) status atual do processo, (2) próximos prazos, (3) teses adversárias identificadas, (4) riscos. Seja objetivo, em bullets.",
    modulos: ["analiseProcessual", "resumos"],
  },
  {
    id: "geral",
    icon: "📋",
    label: "Geral",
    area: "",
    descricao: "Assistente jurídico generalista para o escritório.",
    prompt: "Você é um assistente jurídico especializado, educado e preciso. Use os documentos de treinamento como fonte principal. Se a pergunta estiver fora do seu escopo, admita com transparência e sugira falar com um advogado.",
    modulos: ["atendimento"],
  },
];

/** Catálogo de modelos (cards comparativos). Filtrado conforme provedor configurado. */
const MODELOS_DISPONIVEIS = [
  {
    id: "gpt-4o-mini",
    provider: "openai" as const,
    nome: "GPT-4o Mini",
    tier: "Econômico",
    feat: "Rápido · FAQ e respostas curtas",
    custo: "R$ 0,06",
    custoDesc: "/1k convs",
  },
  {
    id: "gpt-4o",
    provider: "openai" as const,
    nome: "GPT-4o",
    tier: "Balanceado",
    feat: "Bom equilíbrio · uso geral",
    custo: "R$ 0,90",
    custoDesc: "/1k convs",
  },
  {
    id: "gpt-4.1",
    provider: "openai" as const,
    nome: "GPT-4.1",
    tier: "Avançado",
    feat: "Contexto longo · precisão",
    custo: "R$ 0,80",
    custoDesc: "/1k convs",
  },
  {
    id: "gpt-5",
    provider: "openai" as const,
    nome: "GPT-5",
    tier: "Raciocínio",
    feat: "Nova geração · uso geral",
    custo: "R$ 1,10",
    custoDesc: "/1k convs",
  },
  {
    id: "gpt-5.1",
    provider: "openai" as const,
    nome: "GPT-5.1",
    tier: "Raciocínio",
    feat: "Aprimorado · casos complexos",
    custo: "R$ 1,30",
    custoDesc: "/1k convs",
  },
  {
    id: "gpt-5.2",
    provider: "openai" as const,
    nome: "GPT-5.2",
    tier: "Raciocínio",
    feat: "Mais preciso e consistente",
    custo: "R$ 1,50",
    custoDesc: "/1k convs",
  },
  {
    id: "gpt-5.5",
    provider: "openai" as const,
    nome: "GPT-5.5",
    tier: "Topo de linha",
    feat: "Flagship · máxima capacidade",
    custo: "R$ 1,90",
    custoDesc: "/1k convs",
  },
  {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic" as const,
    nome: "Claude Haiku 4.5",
    tier: "Econômico",
    feat: "Rápido · contexto jurídico",
    custo: "R$ 0,10",
    custoDesc: "/1k convs",
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic" as const,
    nome: "Claude Sonnet 4.6",
    tier: "Balanceado · recomendado",
    feat: "Casos complexos · 1M de contexto",
    custo: "R$ 0,36",
    custoDesc: "/1k convs",
  },
  {
    id: "claude-opus-4-7",
    provider: "anthropic" as const,
    nome: "Claude Opus 4.7",
    tier: "Topo de linha",
    feat: "Máxima capacidade · raciocínio jurídico",
    custo: "R$ 1,50",
    custoDesc: "/1k convs",
  },
];

/** Helper: descrição amigável de temperatura. */
function describeTemperatura(t: number): string {
  if (t <= 0.3) return "Preciso";
  if (t <= 0.7) return "Equilibrado";
  if (t <= 1.2) return "Criativo";
  return "Muito criativo";
}
/** Helper: tradução de tokens em palavras (~75% dos tokens são palavras). */
function tokensEmPalavras(t: number): string {
  const p = Math.round(t * 0.75);
  if (p < 50) return `~${p} palavras`;
  if (p < 200) return `~${p} palavras · curto`;
  if (p < 600) return `~${p} palavras · médio`;
  return `~${p} palavras · longo`;
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
  camposCaptura: [],
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
        camposCaptura: existing.camposCaptura ?? [],
        ativo: existing.ativo,
        openaiApiKey: "", // nunca popula (key criptografada — user precisa digitar de novo se quiser trocar)
      });
    }
  }, [open, agenteId, existing, chatgptConfigurado, claudeConfigurado]);

  // Lista de campos personalizados disponíveis para captura
  const { data: camposCliente } = trpc.camposCliente.listar.useQuery(undefined, { staleTime: 60_000 });
  const camposDisponiveis = camposCliente || [];

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

  // Salva o agente — `extraCaptura` é apendado em camposCaptura (usado quando
  // o modal de análise acabou de criar campos novos e precisa linká-los já).
  const doSave = (extraCaptura: AgenteVariavel[] = []) => {
    const camposCapturaFinal = [
      ...form.camposCaptura.filter((v) => v.atributo.trim() || v.campoChave.trim()),
      ...extraCaptura,
    ];
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
        camposCaptura: camposCapturaFinal,
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
        camposCaptura: camposCapturaFinal,
      });
    }
  };

  // ── Análise [chave] no prompt → cria campos personalizados que faltam ──
  // O usuário escreve [valor_financiado] no prompt; antes de salvar (ou via
  // botão explícito), detectamos as chaves que não existem no catálogo e
  // abrimos um modal pra revisar (label/tipo) e criar tudo de uma vez,
  // já linkando em camposCaptura.
  const [analiseOpen, setAnaliseOpen] = useState(false);
  const [sugestoes, setSugestoes] = useState<SugestaoCampo[]>([]);
  const [criandoCampos, setCriandoCampos] = useState(false);
  // Quando true, o "Criar" do modal também aciona doSave após criar (fluxo
  // disparado pelo botão Salvar). Quando false, só cria (botão Analisar manual).
  const [salvarAposCriar, setSalvarAposCriar] = useState(false);
  const utilsTrpc = (trpc as any).useUtils();
  const criarCampoMut = trpc.camposCliente.criar.useMutation();

  const handleSave = () => {
    if (!form.nome.trim() || form.nome.length < 2) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (!form.prompt.trim() || form.prompt.length < 10) {
      toast.error("Prompt muito curto");
      return;
    }
    const faltantes = chavesFaltantes(form.prompt, camposDisponiveis);
    if (faltantes.length > 0) {
      setSugestoes(faltantes);
      setSalvarAposCriar(true);
      setAnaliseOpen(true);
      return;
    }
    doSave();
  };

  const analisarManual = () => {
    const faltantes = chavesFaltantes(form.prompt, camposDisponiveis);
    if (faltantes.length === 0) {
      toast.success("Todos os campos do prompt já existem no cadastro.");
      return;
    }
    setSugestoes(faltantes);
    setSalvarAposCriar(false);
    setAnaliseOpen(true);
  };

  const atualizarSugestao = (i: number, patch: Partial<SugestaoCampo>) =>
    setSugestoes((arr) => arr.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const criarTodosDoModal = async () => {
    setCriandoCampos(true);
    const criados: AgenteVariavel[] = [];
    const erros: string[] = [];
    for (const s of sugestoes) {
      try {
        await criarCampoMut.mutateAsync({
          chave: s.chave,
          label: s.label.trim() || s.chave,
          tipo: s.tipo,
          opcoes: s.tipo === "select" ? s.opcoes : undefined,
        });
        criados.push({ atributo: s.chave, descricao: "", campoChave: s.chave });
      } catch (err: any) {
        erros.push(`${s.chave}: ${err.message}`);
      }
    }
    setCriandoCampos(false);
    if (criados.length > 0) {
      try { await utilsTrpc?.camposCliente?.listar?.invalidate?.(); } catch { /* não-fatal */ }
      setForm((f) => ({ ...f, camposCaptura: [...f.camposCaptura, ...criados] }));
      toast.success(`${criados.length} campo(s) criado(s) e linkado(s) no agente.`);
    }
    if (erros.length > 0) {
      toast.error(`Falha em ${erros.length} campo(s): ${erros.join("; ")}`);
    }
    setAnaliseOpen(false);
    if (salvarAposCriar && erros.length === 0) {
      // Passa os criados explicitamente — form.camposCaptura ainda não
      // refletiu no próximo render (setForm é assíncrono), então doSave
      // mergeia direto pra mandar tudo num save só.
      doSave(criados);
    }
  };

  const aplicarTemplate = (t: typeof TEMPLATES_QUICK[number]) => {
    setForm((f) => ({
      ...f,
      nome: t.label === "Geral" ? f.nome : t.label,
      areaConhecimento: t.area,
      descricao: t.descricao,
      prompt: t.prompt,
      modulosPermitidos: t.modulos,
    }));
  };

  const adicionarVariavel = () => {
    setForm((f) => ({
      ...f,
      camposCaptura: [...f.camposCaptura, { atributo: "", descricao: "", campoChave: "" }],
    }));
  };

  const removerVariavel = (idx: number) => {
    setForm((f) => ({
      ...f,
      camposCaptura: f.camposCaptura.filter((_, i) => i !== idx),
    }));
  };

  const atualizarVariavel = (idx: number, patch: Partial<AgenteVariavel>) => {
    setForm((f) => ({
      ...f,
      camposCaptura: f.camposCaptura.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    }));
  };

  const toggleModulo = (id: string) => {
    setForm((f) => ({
      ...f,
      modulosPermitidos: f.modulosPermitidos.includes(id)
        ? f.modulosPermitidos.filter((m) => m !== id)
        : [...f.modulosPermitidos, id],
    }));
  };

  const temperaturaNum = parseFloat(form.temperatura) || 0.7;
  const modeloRaciocinio = /^(gpt-[5-9]|o[1-9])/i.test(form.modelo || "");
  // Modelos disponíveis baseados em quais provedores estão conectados
  const modelosDisponiveis = MODELOS_DISPONIVEIS.filter((m) =>
    m.provider === "openai" ? chatgptConfigurado
      : m.provider === "anthropic" ? claudeConfigurado
        : false,
  );

  // Set de atributos duplicados (case-insensitive) — usado pra mostrar
  // feedback inline e desabilitar Salvar enquanto não resolve.
  const atributosDuplicados = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of form.camposCaptura) {
      const k = (v.atributo || "").trim().toLowerCase();
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, n]) => n > 1).map(([k]) => k));
  }, [form.camposCaptura]);

  const temDuplicata = atributosDuplicados.size > 0;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* Header simples */}
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            {agenteId ? "Editar agente" : "Criar novo agente"}
          </DialogTitle>
          <DialogDescription className="text-xs ml-9 -mt-0.5">
            Configure um assistente especializado para o escritório
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">

          {/* Templates rápidos (só ao criar novo) */}
          {!agenteId && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Começar de um template</p>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES_QUICK.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => aplicarTemplate(t)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card text-xs hover:border-violet-300 hover:bg-violet-50/40 dark:hover:bg-violet-950/20 transition"
                  >
                    <span className="text-sm">{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Identidade */}
          <div className="space-y-2.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Identidade</p>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label className="text-xs">Nome <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="Ex: Especialista Trabalhista"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  className="h-8 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Área</Label>
                <Select
                  value={form.areaConhecimento || undefined}
                  onValueChange={(v) => setForm({ ...form, areaConhecimento: v })}
                >
                  <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {AREAS.map((a) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Descrição curta</Label>
              <Input
                placeholder="Resumo de 1 linha do papel deste agente"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                className="h-8 text-sm mt-1"
                maxLength={512}
              />
            </div>
          </div>

          {/* Modelo — cards comparativos */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Modelo (cérebro do agente)</p>
            {algumIAConfigurado ? (
              <>
                <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-3">
                  {modelosDisponiveis.map((m) => {
                    const active = form.modelo === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setForm({ ...form, modelo: m.id })}
                        className={
                          "relative text-left rounded-lg border-2 px-2.5 py-2 transition " +
                          (active
                            ? "border-violet-500 bg-violet-50/40 dark:bg-violet-950/30"
                            : "border-border bg-card hover:border-violet-300")
                        }
                      >
                        {active && (
                          <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center">✓</span>
                        )}
                        <p className="text-xs font-bold leading-tight">{m.nome}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{m.tier}</p>
                        <p className="text-[10px] text-muted-foreground mt-1.5 leading-tight">{m.feat}</p>
                        <p className="text-[11px] font-bold mt-1.5">
                          {m.custo}
                          <span className="text-[9px] text-muted-foreground font-normal ml-0.5">{m.custoDesc}</span>
                        </p>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1 mt-1.5">
                  <CheckCircle2 className="h-3 w-3" />
                  {ambosConfigurados ? "OpenAI e Anthropic configurados" : chatgptConfigurado ? "OpenAI configurada · Integrações → ChatGPT" : "Anthropic configurada · Integrações → Claude"}
                </p>
              </>
            ) : (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3 text-xs text-amber-900 dark:text-amber-200">
                <p className="font-semibold">Nenhuma IA configurada</p>
                <p className="mt-0.5">Vá em <strong>Configurações → Integrações</strong> e cadastre a API Key do ChatGPT ou Claude antes de criar agentes.</p>
              </div>
            )}
          </div>

          {/* Prompt + Sugerir */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Prompt de sistema <span className="text-red-500">*</span></p>
              <button
                type="button"
                onClick={() => {
                  // Auto-gera prompt baseado em área
                  const t = TEMPLATES_QUICK.find(
                    (tp) => tp.area.toLowerCase().includes((form.areaConhecimento || "").toLowerCase().split(" ").pop() || ""),
                  );
                  if (t) {
                    setForm((f) => ({ ...f, prompt: t.prompt }));
                    toast.success("Prompt sugerido aplicado!");
                  } else {
                    toast.info("Selecione uma área de conhecimento primeiro");
                  }
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 text-[10px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950/50"
              >
                <Sparkles className="h-2.5 w-2.5" /> Sugerir
              </button>
            </div>
            <Textarea
              rows={8}
              placeholder="Defina a personalidade e instruções do agente..."
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              className="text-sm"
              maxLength={32000}
            />
            <p className="text-[10px] text-muted-foreground text-right mt-1">{form.prompt.length.toLocaleString("pt-BR")} / 32.000</p>
          </div>

          {/* Tom (slider) + Tamanho (tokens) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs">Tom da resposta</Label>
                <span className="text-[10px] font-bold text-violet-700 dark:text-violet-300">
                  {temperaturaNum.toFixed(1)} · {describeTemperatura(temperaturaNum)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={temperaturaNum}
                onChange={(e) => setForm({ ...form, temperatura: e.target.value })}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-violet-600"
                style={{ background: "linear-gradient(90deg, #3b82f6, #8b5cf6 50%, #ef4444)" }}
              />
              <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                <span>Preciso</span>
                <span>Criativo</span>
              </div>
              {modeloRaciocinio && (
                <p className="text-[9px] text-muted-foreground mt-1 italic">
                  GPT-5 responde no tom padrão — este controle não se aplica.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Tamanho da resposta</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="number"
                  value={form.maxTokens}
                  onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })}
                  min={100}
                  max={4000}
                  step={100}
                  className="h-8 text-sm flex-1"
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{tokensEmPalavras(form.maxTokens)}</p>
            </div>
          </div>

          {/* Módulos */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Onde usar (módulos)</p>
            <div className="grid grid-cols-3 gap-1.5">
              {MODULOS.map((m) => {
                const active = form.modulosPermitidos.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleModulo(m.id)}
                    className={
                      "flex items-center gap-1.5 px-2 py-1.5 rounded-lg border-2 text-xs transition " +
                      (active
                        ? "border-violet-500 bg-violet-50/40 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 font-semibold"
                        : "border-border bg-card hover:border-violet-300")
                    }
                    title={m.label}
                  >
                    <span className="text-sm">{MODULO_ICONS[m.id] || "·"}</span>
                    <span className="truncate">{MODULO_LABELS_CURTOS[m.id] || m.id}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 🎯 Variáveis a capturar — atributo + descrição + campo destino */}
          {camposDisponiveis.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  🎯 Variáveis a capturar da conversa
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={analisarManual}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30 text-[10px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/50"
                    title="Detecta [chaves] no prompt que ainda não existem e oferece criar de uma vez"
                  >
                    <Sparkles className="h-2.5 w-2.5" /> Analisar prompt
                  </button>
                  <button
                    type="button"
                    onClick={adicionarVariavel}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 text-[10px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950/50"
                  >
                    <Plus className="h-2.5 w-2.5" /> Adicionar variável
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
                A IA extrai cada variável da conversa e salva no campo personalizado mapeado.
                A <strong>descrição</strong> orienta a IA (ex: formato, restrições, sinônimos aceitos).
              </p>

              {form.camposCaptura.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center">
                  <p className="text-[11px] text-muted-foreground italic">
                    Nenhuma variável configurada. Clique em <strong>Adicionar variável</strong> pra começar.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {form.camposCaptura.map((v, idx) => {
                    const campoDef = camposDisponiveis.find((c: any) => c.chave === v.campoChave);
                    const atributoInvalido =
                      v.atributo && !/^[a-z][a-z0-9_]*$/i.test(v.atributo);
                    const atributoDuplicado =
                      v.atributo.trim().length > 0 &&
                      atributosDuplicados.has(v.atributo.trim().toLowerCase());
                    const inputAlerta = atributoInvalido || atributoDuplicado;
                    return (
                      <div
                        key={idx}
                        className={
                          "rounded-lg border bg-card/50 p-2.5 space-y-2 relative " +
                          (atributoDuplicado
                            ? "border-amber-400 bg-amber-50/30 dark:bg-amber-950/10"
                            : "border-border")
                        }
                      >
                        <button
                          type="button"
                          onClick={() => removerVariavel(idx)}
                          className="absolute top-1.5 right-1.5 text-muted-foreground hover:text-destructive"
                          aria-label="Remover variável"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px]">Atributo (nome técnico)</Label>
                            <Input
                              placeholder="ex: data_consulta"
                              value={v.atributo}
                              onChange={(e) => atualizarVariavel(idx, { atributo: e.target.value })}
                              className={
                                "h-7 text-xs mt-0.5 " +
                                (inputAlerta ? "border-amber-400" : "")
                              }
                              maxLength={48}
                            />
                            {atributoDuplicado ? (
                              <p className="text-[9px] text-amber-700 dark:text-amber-400 mt-0.5 font-medium">
                                ⚠ Outra variável já usa esse atributo
                              </p>
                            ) : atributoInvalido ? (
                              <p className="text-[9px] text-amber-600 mt-0.5">
                                Use letras, números e underscore. Comece com letra.
                              </p>
                            ) : null}
                          </div>
                          <div>
                            <Label className="text-[10px]">Campo de destino</Label>
                            <Select
                              value={v.campoChave || undefined}
                              onValueChange={(novo) => {
                                const def = camposDisponiveis.find((c: any) => c.chave === novo);
                                atualizarVariavel(idx, {
                                  campoChave: novo,
                                  atributo: v.atributo || (def?.chave ?? novo),
                                });
                              }}
                            >
                              <SelectTrigger className="h-7 text-xs mt-0.5">
                                <SelectValue placeholder="Selecione..." />
                              </SelectTrigger>
                              <SelectContent>
                                {camposDisponiveis.map((c: any) => (
                                  <SelectItem key={c.chave} value={c.chave}>
                                    {c.label} <span className="text-muted-foreground">· {c.tipo}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {campoDef && (
                              <p className="text-[9px] text-muted-foreground mt-0.5">
                                Salva em <code>{campoDef.chave}</code> ({campoDef.tipo})
                              </p>
                            )}
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px]">
                            Descrição para a IA <span className="text-muted-foreground/70">(opcional)</span>
                          </Label>
                          <Textarea
                            placeholder="Ex: Data que o cliente prefere para a consulta. Aceitar datas relativas como 'amanhã' ou 'sexta'."
                            value={v.descricao}
                            onChange={(e) => atualizarVariavel(idx, { descricao: e.target.value })}
                            rows={2}
                            className="text-xs mt-0.5"
                            maxLength={300}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {camposDisponiveis.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 space-y-2">
              <p className="text-[11px] text-muted-foreground italic">
                💡 Crie campos personalizados em <strong>Configurações → Campos do cliente</strong> — ou deixe que eu detecte do seu prompt:
              </p>
              <button
                type="button"
                onClick={analisarManual}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30 text-[11px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/50"
                title="Detecta [chaves] no prompt e oferece criar de uma vez"
              >
                <Sparkles className="h-3 w-3" /> Analisar prompt e criar campos
              </button>
            </div>
          )}

          {/* Toggle ativar */}
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-xs font-medium">Ativar imediatamente</p>
              <p className="text-[10px] text-muted-foreground">Só agentes ativos aparecem para os módulos</p>
            </div>
            <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-5 py-3 border-t bg-muted/30 gap-1 flex items-center justify-between sm:justify-between">
          {temDuplicata && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1 mr-auto">
              ⚠ Resolva os atributos duplicados antes de salvar
            </p>
          )}
          <div className="flex gap-1 ml-auto">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-8 text-xs">
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                criarMut.isPending ||
                atualizarMut.isPending ||
                !algumIAConfigurado ||
                temDuplicata
              }
              className="h-8 text-xs bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
            >
              {(criarMut.isPending || atualizarMut.isPending) && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {!(criarMut.isPending || atualizarMut.isPending) && <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              {agenteId ? "Salvar" : "Criar agente"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Modal de análise de [chave] no prompt — cria campos personalizados que faltam */}
    <Dialog open={analiseOpen} onOpenChange={setAnaliseOpen}>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-sky-500" />
            Criar os campos que o seu prompt usa
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-1">
            <span className="block text-[12px] leading-relaxed">
              Encontrei <strong>{sugestoes.length}</strong> anotação(ões) no seu prompt no formato <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded border">[chave]</code> que ainda não existem no cadastro do cliente.
            </span>
            <span className="block text-[12px] leading-relaxed text-foreground/80 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 rounded p-2">
              <strong className="text-sky-700 dark:text-sky-300">O que vai acontecer:</strong> ao confirmar, cada chave vira um <strong>campo personalizado</strong> no cadastro do cliente E é linkada nas <strong>"variáveis a capturar"</strong> do agente. Aí a IA passa a extrair esses valores da conversa <em>sozinha</em> e salvá-los na ficha de cada cliente.
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Resumo rápido por tipo */}
        <div className="px-5 py-2.5 border-b bg-muted/30 flex items-center gap-2 flex-wrap text-[11px]">
          <span className="font-semibold text-muted-foreground uppercase tracking-wide">Resumo:</span>
          {(["texto","numero","data","textarea","select","boolean"] as TipoCampoCaptura[]).map((t) => {
            const n = sugestoes.filter((s) => s.tipo === t).length;
            if (n === 0) return null;
            const rotulos: Record<TipoCampoCaptura, string> = {
              texto: "📝 texto", numero: "🔢 número", data: "📅 data",
              textarea: "📄 texto longo", select: "📋 seleção", boolean: "✅ sim/não",
            };
            return (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-card">
                <strong>{n}</strong> {rotulos[t]}
              </span>
            );
          })}
        </div>

        <div className="px-5 py-4 space-y-2.5">
          {sugestoes.map((s, i) => {
            const tipoExemplo: Record<TipoCampoCaptura, string> = {
              texto: "qualquer texto curto (ex: nome do produto)",
              numero: "número — valor em R$, quantidade, etc.",
              data: "data (ex: 25/12/2025)",
              textarea: "texto longo / parágrafos",
              select: "uma das opções de uma lista fixa que você define abaixo",
              boolean: "verdadeiro ou falso (Sim/Não)",
            };
            return (
              <div key={s.chave} className="rounded-lg border bg-card p-3 space-y-2.5">
                {/* Linha 1: chave + tipo */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">No prompt:</span>
                    <code className="text-xs font-mono bg-muted/60 px-2 py-1 rounded border truncate" title={s.chave}>[{s.chave}]</code>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-muted-foreground">tipo:</span>
                    <Select
                      value={s.tipo}
                      onValueChange={(v) => atualizarSugestao(i, {
                        tipo: v as TipoCampoCaptura,
                        opcoes: v === "select" ? (s.opcoes && s.opcoes.length > 0 ? s.opcoes : ["SIM", "NAO"]) : undefined,
                      })}
                    >
                      <SelectTrigger className="h-8 text-xs w-[170px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="texto">📝 Texto</SelectItem>
                        <SelectItem value="numero">🔢 Número</SelectItem>
                        <SelectItem value="data">📅 Data</SelectItem>
                        <SelectItem value="textarea">📄 Texto longo</SelectItem>
                        <SelectItem value="select">📋 Seleção (lista)</SelectItem>
                        <SelectItem value="boolean">✅ Sim/Não</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground -mt-1.5 leading-relaxed">↳ {tipoExemplo[s.tipo]}</p>

                {/* Rótulo */}
                <div>
                  <Label className="text-[10px] text-muted-foreground">Rótulo (como aparece pra você no cadastro do cliente)</Label>
                  <Input
                    className="h-8 text-sm mt-0.5"
                    value={s.label}
                    onChange={(e) => atualizarSugestao(i, { label: e.target.value })}
                    placeholder="Ex: Valor financiado"
                  />
                </div>

                {/* Opções (só pra select) */}
                {s.tipo === "select" && (
                  <div className="ml-2 pl-3 border-l-2 border-sky-300 dark:border-sky-700">
                    <Label className="text-[10px] text-muted-foreground">Opções da lista (a IA escolhe UMA)</Label>
                    <Input
                      className="h-8 text-sm mt-0.5"
                      value={(s.opcoes || []).join(", ")}
                      onChange={(e) => atualizarSugestao(i, { opcoes: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })}
                      placeholder="Separadas por vírgula — ex: SIM, NAO"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">A IA vai escolher exatamente uma destas opções pela conversa.</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter className="px-5 py-3 border-t bg-muted/30 gap-2">
          <Button variant="ghost" onClick={() => setAnaliseOpen(false)} disabled={criandoCampos}>
            Cancelar
          </Button>
          <Button onClick={criarTodosDoModal} disabled={criandoCampos || sugestoes.length === 0} className="bg-gradient-to-br from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700">
            {criandoCampos
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Criando…</>
              : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Criar {sugestoes.length} campos e linkar{salvarAposCriar ? " (e salvar agente)" : ""}</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
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
    onSuccess: (res) => {
      if (res.textoExtraido) {
        toast.success("Arquivo enviado e texto extraído");
      } else {
        toast.warning("Arquivo enviado, mas texto não foi extraído", {
          description: res.avisoExtracao || "Você pode tentar reprocessar depois.",
        });
      }
      refetch();
    },
    onError: (err) => toast.error("Erro no upload", { description: err.message }),
  });

  const reprocessarMut = trpc.agentesIa.reprocessarDocumento.useMutation({
    onSuccess: (res) => {
      if (res.textoExtraido) {
        toast.success(`Texto reextraído (${res.tamanhoConteudo} caracteres)`);
      } else {
        toast.warning("Não foi possível extrair texto", {
          description: res.aviso || "Tipo de arquivo não suporta extração automática.",
        });
      }
      refetch();
    },
    onError: (err) => toast.error("Erro ao reprocessar", { description: err.message }),
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
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
                {agente.documentos.map((d: any) => {
                  const ehArquivo = d.tipo === "arquivo";
                  const semConteudo = ehArquivo && !d.temConteudoExtraido;
                  return (
                    <div
                      key={d.id}
                      className={
                        "flex items-center gap-2 border rounded-md p-2 text-xs " +
                        (semConteudo ? "border-amber-300 bg-amber-50/30 dark:bg-amber-950/10" : "")
                      }
                    >
                      {ehArquivo ? (
                        <FileIcon className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                      ) : d.tipo === "link" ? (
                        <Link2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-violet-600 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium truncate">{d.nome}</p>
                          {ehArquivo && (
                            d.temConteudoExtraido ? (
                              <span
                                title={`Texto extraído (${d.tamanhoConteudo} caracteres)`}
                                className="text-[9px] px-1 py-0 rounded bg-emerald-100 text-emerald-700 font-semibold inline-flex items-center gap-0.5 shrink-0"
                              >
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                texto OK
                              </span>
                            ) : (
                              <span
                                title="Sem texto extraído — a IA não vai ver o conteúdo deste arquivo. Clique em reprocessar."
                                className="text-[9px] px-1 py-0 rounded bg-amber-100 text-amber-700 font-semibold inline-flex items-center gap-0.5 shrink-0"
                              >
                                <AlertTriangle className="h-2.5 w-2.5" />
                                sem texto
                              </span>
                            )
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {ehArquivo && d.tamanho
                            ? `${(d.tamanho / 1024).toFixed(1)} KB · ${d.mimeType}`
                            : d.tipo === "link"
                            ? d.url
                            : "Texto colado"}
                        </p>
                      </div>
                      {ehArquivo && (
                        <button
                          onClick={() => reprocessarMut.mutate({ id: d.id })}
                          disabled={reprocessarMut.isPending}
                          title="Reextrair texto do arquivo"
                          className="text-muted-foreground hover:text-violet-600 disabled:opacity-50"
                        >
                          {reprocessarMut.isPending && reprocessarMut.variables?.id === d.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <RefreshCw className="h-3 w-3" />}
                        </button>
                      )}
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
                  );
                })}
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
      {tab === "templates" && (templates?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900/40 px-4 py-2.5 flex items-start gap-2.5">
          <Store className="h-4 w-4 text-amber-700 dark:text-amber-300 mt-0.5 shrink-0" />
          <div className="text-xs">
            <p className="font-semibold text-amber-900 dark:text-amber-200">Catálogo do JuridFlow</p>
            <p className="text-amber-800/80 dark:text-amber-300/80 mt-0.5">
              Agentes pré-construídos pela equipe JuridFlow. Clique em <strong>Clonar p/ escritório</strong> para customizar com seus documentos e prompts.
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
            {tab === "templates" && !busca && areaFiltro === "todas" && (
              <p className="text-xs text-center max-w-md mb-2">
                A equipe JuridFlow ainda não publicou templates prontos. Você pode criar seu próprio agente do zero na aba <strong>Meus agentes</strong>.
              </p>
            )}
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
