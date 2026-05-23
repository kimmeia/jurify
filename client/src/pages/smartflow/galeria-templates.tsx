import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
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
import { TEMPLATES_SMARTFLOW } from "@shared/smartflow-templates";

const ICONES: Record<string, LucideIcon> = {
  "message-circle-heart": MessageCircleHeart,
  "user-plus": UserPlus,
  "dollar-sign": DollarSign,
  "alert-triangle": AlertTriangle,
  "calendar-clock": CalendarClock,
  sparkles: Sparkles,
};

/**
 * Modal de galeria de templates — aberto ao clicar "Novo cenário". Mostra
 * os fluxos prontos + "criar do zero". Escolher um template cria o cenário
 * (inativo) e navega pro editor pra ajustar.
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

  const criarMut = (trpc as any).smartflow.criarDeTemplate.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Cenário "${r.nome}" criado! Ajuste e ative quando estiver pronto.`);
      utils?.smartflow?.listar?.invalidate();
      onOpenChange(false);
      if (r?.id) navigate(`/smartflow/${r.id}/editar`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const escolherTemplate = (templateId: string) => {
    if (criarMut.isPending) return;
    criarMut.mutate({ templateId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
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
                onClick={() => escolherTemplate(tpl.id)}
                disabled={criarMut.isPending}
                className="text-left rounded-xl border-2 border-slate-200 dark:border-slate-800 p-4 hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-md transition-all disabled:opacity-50 relative group"
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
                <div
                  className={`w-10 h-10 rounded-lg bg-gradient-to-br ${tpl.gradiente} flex items-center justify-center mb-2 shadow-sm`}
                >
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <p className="text-sm font-bold mb-1 pr-12">{tpl.nome}</p>
                <p className="text-xs text-muted-foreground leading-snug">{tpl.descricao}</p>
              </button>
            );
          })}

          {/* Criar do zero */}
          <button
            onClick={() => {
              onOpenChange(false);
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
      </DialogContent>
    </Dialog>
  );
}
