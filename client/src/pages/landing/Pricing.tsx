/**
 * Pricing — 3 planos (Básico, Intermediário, Completo).
 *
 * Valores são placeholder ("XX/mês") até o time confirmar tabela
 * atualizada. Botões mandam pro signup com o plano pré-selecionado
 * (na PR atual só abre o dialog genérico — refinar depois).
 *
 * Os 3 planos espelham o enum `planoAtendimento` em `escritorios`
 * (basico | intermediario | completo) já existente no backend.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles } from "lucide-react";

interface Props {
  onCta: (modo: "login" | "signup") => void;
}

const planos = [
  {
    id: "basico",
    nome: "Básico",
    publico: "Advogado autônomo ou dupla",
    preco: "R$ 97",
    periodo: "/mês",
    destaque: false,
    features: [
      "1 colaborador",
      "Até 100 clientes ativos",
      "Cálculos jurídicos completos",
      "Financeiro com Asaas",
      "Modelos de contrato",
      "Suporte por chat",
    ],
  },
  {
    id: "intermediario",
    nome: "Intermediário",
    publico: "Escritório pequeno (3-10 advogados)",
    preco: "R$ 247",
    periodo: "/mês",
    destaque: true,
    features: [
      "Até 5 colaboradores",
      "Clientes ilimitados",
      "Tudo do Básico, mais:",
      "Atendimento WhatsApp + Instagram",
      "Comissões automáticas",
      "1 conexão WhatsApp",
      "SmartFlow básico",
    ],
  },
  {
    id: "completo",
    nome: "Completo",
    publico: "Escritório com equipe (10+)",
    preco: "R$ 497",
    periodo: "/mês",
    destaque: false,
    features: [
      "Colaboradores ilimitados",
      "Tudo do Intermediário, mais:",
      "Múltiplas conexões WhatsApp",
      "Agentes IA personalizados",
      "Monitoramento de processos ilimitado",
      "Suporte prioritário",
      "Onboarding dedicado",
    ],
  },
];

export function Pricing({ onCta }: Props) {
  return (
    <section id="pricing" className="max-w-6xl mx-auto px-4 py-20 lg:py-28">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <p className="text-sm font-semibold text-primary uppercase tracking-wide mb-3">
          Planos
        </p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          Comece grátis. Cancele quando quiser.
        </h2>
        <p className="text-muted-foreground mt-4 text-lg">
          7 dias de teste gratuito em todos os planos. Sem cartão de crédito
          pra começar.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {planos.map((p) => (
          <div
            key={p.id}
            className={`rounded-2xl border p-7 flex flex-col ${
              p.destaque
                ? "border-primary shadow-xl bg-card relative"
                : "bg-card"
            }`}
          >
            {p.destaque && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground border-0">
                <Sparkles className="h-3 w-3 mr-1" />
                Mais popular
              </Badge>
            )}

            <h3 className="text-2xl font-bold">{p.nome}</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-6">{p.publico}</p>

            <div className="flex items-baseline gap-1 mb-6">
              <span className="text-4xl font-bold tracking-tight">{p.preco}</span>
              <span className="text-muted-foreground">{p.periodo}</span>
            </div>

            <Button
              className="w-full mb-6"
              size="lg"
              variant={p.destaque ? "default" : "outline"}
              onClick={() => onCta("signup")}
            >
              Começar grátis
            </Button>

            <ul className="space-y-2.5 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground mt-8">
        Valores em reais. Pagamento via Pix, boleto ou cartão (Asaas). NF-e
        emitida automaticamente.
      </p>
    </section>
  );
}
