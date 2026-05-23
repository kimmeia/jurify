import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  DollarSign,
  Loader2,
  MessageCircleHeart,
  Plus,
  Sparkles,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  TEMPLATES_SMARTFLOW,
  camposWizardDoTemplate,
  type CampoWizard,
  type TemplateSmartflow,
} from "@shared/smartflow-templates";
import { VariableInput, VariableTrigger } from "@/components/VariableInput";
import { useSmartFlowVariaveis } from "@/hooks/useSmartFlowVariaveis";

const ICONES: Record<string, LucideIcon> = {
  "message-circle-heart": MessageCircleHeart,
  "user-plus": UserPlus,
  "dollar-sign": DollarSign,
  "alert-triangle": AlertTriangle,
  "calendar-clock": CalendarClock,
  sparkles: Sparkles,
};

/** Chave única de um campo wizard, pra indexar o estado de valores. */
function chaveCampo(c: CampoWizard): string {
  return `${c.alvo}:${c.clienteId ?? ""}:${c.chave}`;
}

/**
 * Modal de criação de cenário. Duas etapas:
 *   1. Galeria — escolhe um template pronto ou "criar do zero".
 *   2. Personalizar — ajusta nome + mensagens + parâmetros antes de criar
 *      (só aparece se o template tiver campos personalizáveis).
 */
export function GaleriaTemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const utils = (trpc as any).useUtils?.() || (trpc as any).useContext?.();

  const [etapa, setEtapa] = useState<"galeria" | "personalizar">("galeria");
  const [template, setTemplate] = useState<TemplateSmartflow | null>(null);
  const [nome, setNome] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({});

  const reset = () => {
    setEtapa("galeria");
    setTemplate(null);
    setNome("");
    setValores({});
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const criarMut = (trpc as any).smartflow.criarDeTemplate.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Cenário "${r.nome}" criado! Revise e ative quando estiver pronto.`);
      utils?.smartflow?.listar?.invalidate();
      reset();
      onOpenChange(false);
      if (r?.id) navigate(`/smartflow/${r.id}/editar`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const escolherTemplate = (tpl: TemplateSmartflow) => {
    const campos = camposWizardDoTemplate(tpl);
    if (campos.length === 0) {
      // Nada a personalizar — cria direto.
      criarMut.mutate({ templateId: tpl.id });
      return;
    }
    // Pré-preenche os valores com os defaults do template.
    const init: Record<string, string> = {};
    for (const c of campos) init[chaveCampo(c)] = String(c.valorAtual);
    setTemplate(tpl);
    setNome(tpl.nome);
    setValores(init);
    setEtapa("personalizar");
  };

  const criarComPersonalizacao = () => {
    if (!template) return;
    const campos = camposWizardDoTemplate(template);
    const configGatilho: Record<string, unknown> = {};
    const passosConfig: Record<string, Record<string, unknown>> = {};

    for (const c of campos) {
      const valor = valores[chaveCampo(c)] ?? String(c.valorAtual);
      const valorTipado: unknown = c.tipo === "numero" ? Number(valor) || 0 : valor;
      if (c.alvo === "gatilho") {
        configGatilho[c.chave] = valorTipado;
      } else if (c.clienteId) {
        passosConfig[c.clienteId] = { ...(passosConfig[c.clienteId] || {}), [c.chave]: valorTipado };
      }
    }

    criarMut.mutate({
      templateId: template.id,
      nome: nome.trim() || template.nome,
      configGatilho: Object.keys(configGatilho).length > 0 ? configGatilho : undefined,
      passosConfig: Object.keys(passosConfig).length > 0 ? passosConfig : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        {etapa === "galeria" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-violet-600" />
                Como você quer começar?
              </DialogTitle>
              <DialogDescription>
                Escolha um fluxo pronto pra ajustar, ou comece do zero. Os templates
                nascem desativados — você revisa e ativa quando quiser.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
              {TEMPLATES_SMARTFLOW.map((tpl) => {
                const Icon = ICONES[tpl.icone] ?? Sparkles;
                return (
                  <button
                    key={tpl.id}
                    onClick={() => escolherTemplate(tpl)}
                    disabled={criarMut.isPending}
                    className="text-left rounded-xl border-2 border-slate-200 dark:border-slate-800 p-4 hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-md transition-all disabled:opacity-50 relative"
                  >
                    {tpl.badge && (
                      <span
                        className={`absolute top-2.5 right-2.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          tpl.badge === "popular"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        }`}
                      >
                        {tpl.badge === "popular" ? "popular" : "novo"}
                      </span>
                    )}
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${tpl.gradiente} flex items-center justify-center mb-2 shadow-sm`}>
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <p className="text-sm font-bold mb-1 pr-12">{tpl.nome}</p>
                    <p className="text-xs text-muted-foreground leading-snug">{tpl.descricao}</p>
                  </button>
                );
              })}

              <button
                onClick={() => {
                  handleOpenChange(false);
                  navigate("/smartflow/novo");
                }}
                disabled={criarMut.isPending}
                className="text-left rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 p-4 hover:border-slate-500 hover:shadow-md transition-all disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center mb-2 shadow-sm">
                  <Plus className="h-5 w-5 text-white" />
                </div>
                <p className="text-sm font-bold mb-1">Criar do zero</p>
                <p className="text-xs text-muted-foreground leading-snug">
                  Pra quem já tem a ideia clara e quer montar o fluxo passo a passo.
                </p>
              </button>
            </div>

            {criarMut.isPending && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Criando cenário...
              </div>
            )}
          </>
        ) : (
          template && (
            <WizardPersonalizar
              template={template}
              nome={nome}
              setNome={setNome}
              valores={valores}
              setValores={setValores}
              pending={criarMut.isPending}
              onVoltar={() => setEtapa("galeria")}
              onCriar={criarComPersonalizacao}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Etapa 2 — formulário de personalização com os campos editáveis do template.
 * Mensagens usam VariableInput (com botão "Inserir" pra variáveis); números
 * e horários usam inputs simples.
 */
function WizardPersonalizar({
  template,
  nome,
  setNome,
  valores,
  setValores,
  pending,
  onVoltar,
  onCriar,
}: {
  template: TemplateSmartflow;
  nome: string;
  setNome: (n: string) => void;
  valores: Record<string, string>;
  setValores: (v: Record<string, string>) => void;
  pending: boolean;
  onVoltar: () => void;
  onCriar: () => void;
}) {
  const campos = camposWizardDoTemplate(template);
  const variaveis = useSmartFlowVariaveis(template.gatilho);
  const Icon = ICONES[template.icone] ?? Sparkles;

  const setValor = (chave: string, valor: string) => {
    setValores({ ...valores, [chave]: valor });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${template.gradiente} flex items-center justify-center`}>
            <Icon className="h-4 w-4 text-white" />
          </div>
          Personalizar: {template.nome}
        </DialogTitle>
        <DialogDescription>
          Ajuste os textos e parâmetros principais. Você pode mudar tudo depois no editor.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 mt-1">
        <div>
          <Label className="text-xs font-semibold">Nome do cenário</Label>
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={template.nome}
            className="mt-1"
          />
        </div>

        {campos.map((c) => {
          const k = chaveCampo(c);
          const valor = valores[k] ?? String(c.valorAtual);
          if (c.tipo === "mensagem") {
            return (
              <div key={k}>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs font-semibold">{c.label}</Label>
                  <VariableTrigger
                    inputId={`wiz-${k}`}
                    variaveis={variaveis}
                    onInsert={(path) => setValor(k, `${valor}${valor ? " " : ""}{{${path}}}`)}
                  />
                </div>
                <VariableInput
                  id={`wiz-${k}`}
                  as="textarea"
                  rows={3}
                  highlight
                  preview
                  value={valor}
                  onChange={(v) => setValor(k, v)}
                  variaveis={variaveis}
                  placeholder="Escreva a mensagem..."
                />
                {c.ajuda && <p className="text-[10px] text-muted-foreground mt-1">{c.ajuda}</p>}
              </div>
            );
          }
          return (
            <div key={k}>
              <Label className="text-xs font-semibold">{c.label}</Label>
              <Input
                type={c.tipo === "numero" ? "number" : c.tipo === "hora" ? "time" : "text"}
                value={valor}
                onChange={(e) => setValor(k, e.target.value)}
                className="mt-1 max-w-[180px]"
              />
              {c.ajuda && <p className="text-[10px] text-muted-foreground mt-1">{c.ajuda}</p>}
            </div>
          );
        })}

        {template.dica && (
          <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-2.5 text-[11px] text-blue-900 dark:text-blue-200 flex items-start gap-1.5">
            <Sparkles className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{template.dica}</span>
          </div>
        )}
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onVoltar} disabled={pending}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Voltar
        </Button>
        <Button
          size="sm"
          onClick={onCriar}
          disabled={pending}
          className="bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
          Criar cenário
        </Button>
      </DialogFooter>
    </>
  );
}
