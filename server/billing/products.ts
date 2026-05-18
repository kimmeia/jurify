/**
 * @deprecated Use `planos-repo.ts` em código novo.
 *
 * Este arquivo mantinha o catálogo de planos hardcoded (PLANS). A fonte de
 * verdade migrou pra tabela `planos` (migration 0108). PLANS aqui agora é
 * apenas um fallback estático que reflete os mesmos slugs/preços do seed.
 *
 * Mantido por enquanto pra não quebrar callers em `server/db.ts`,
 * `server/routers/admin.ts` e `server/billing/escritorio-creditos.ts`.
 * Esses callers serão migrados em PR futuro pra usar `planos-repo`.
 */

export interface PlanDefinition {
  id: string;
  name: string;
  description: string;
  features: string[];
  /** Preço mensal em centavos (BRL) */
  priceMonthly: number;
  /** Preço anual em centavos (BRL) */
  priceYearly: number;
  currency: string;
  popular?: boolean;
  /**
   * Limite de cálculos jurídicos/mês. Usado pelo sistema de créditos.
   * Use 999999 para ilimitado.
   */
  creditsPerMonth: number;
}

/**
 * @deprecated Fallback estático. Em runtime, prefira `getPlansResolved()` ou
 * `getAllPlanos()` que leem da tabela `planos`.
 *
 * Os valores aqui devem espelhar o seed da migration 0108 — se você editar
 * preço/feature no admin, isso aqui fica desatualizado mas não impacta
 * (o admin é quem reflete na LP e no app).
 */
export const PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    description: "Para conhecer a plataforma",
    features: [
      "1 usuário",
      "Até 10 clientes",
      "3 créditos de cálculos por mês",
      "Modelos de contrato básicos",
      "Suporte por email",
    ],
    priceMonthly: 0,
    priceYearly: 0,
    currency: "brl",
    creditsPerMonth: 3,
  },
  {
    id: "basico",
    name: "Básico",
    description: "Para advogado autônomo ou dupla",
    features: [
      "1 colaborador",
      "Até 100 clientes ativos",
      "Cálculos jurídicos completos",
      "Financeiro com Asaas",
      "Modelos de contrato",
      "Suporte por chat",
    ],
    priceMonthly: 9700,
    priceYearly: 97000,
    currency: "brl",
    creditsPerMonth: 100,
  },
  {
    id: "intermediario",
    name: "Intermediário",
    description: "Para escritório pequeno",
    features: [
      "Até 5 colaboradores",
      "Clientes ilimitados",
      "Tudo do Básico, mais:",
      "Atendimento WhatsApp + Instagram",
      "Comissões automáticas",
      "1 conexão WhatsApp",
      "SmartFlow básico",
    ],
    priceMonthly: 24700,
    priceYearly: 247000,
    currency: "brl",
    popular: true,
    creditsPerMonth: 500,
  },
  {
    id: "completo",
    name: "Completo",
    description: "Para escritório com equipe",
    features: [
      "Colaboradores ilimitados",
      "Tudo do Intermediário, mais:",
      "Múltiplas conexões WhatsApp",
      "Agentes IA personalizados",
      "Monitoramento de processos ilimitado",
      "Suporte prioritário",
      "Onboarding dedicado",
    ],
    priceMonthly: 49700,
    priceYearly: 497000,
    currency: "brl",
    creditsPerMonth: 999999,
  },
];

/**
 * @deprecated Use `getPlanByIdResolved()` de `products-resolver.ts` ou
 * `getPlanoBySlug()` de `planos-repo.ts`.
 */
export function getPlanById(id: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.id === id);
}
