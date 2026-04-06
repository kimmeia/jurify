/**
 * Stripe product/plan definitions.
 * Prices are created dynamically via Stripe API on first use.
 * This file serves as the single source of truth for plan metadata.
 */

export interface PlanDefinition {
  id: string;
  name: string;
  description: string;
  features: string[];
  priceMonthly: number; // in cents (BRL)
  priceYearly: number;  // in cents (BRL)
  currency: string;
  popular?: boolean;
  creditsPerMonth: number; // Número de cálculos permitidos por mês
}

export const PLANS: PlanDefinition[] = [
  {
    id: "basic",
    name: "Básico",
    description: "Ideal para profissionais autônomos",
    features: [
      "Cálculos Bancários",
      "Cálculos Diversos",
      "Até 50 cálculos/mês",
      "Suporte por e-mail",
    ],
    priceMonthly: 9900,  // R$ 99,00
    priceYearly: 95000,  // R$ 950,00 (economia de ~20%)
    currency: "brl",
    creditsPerMonth: 50,
  },
  {
    id: "professional",
    name: "Profissional",
    description: "Para escritórios e equipes",
    features: [
      "Todos os módulos de cálculo",
      "Cálculos ilimitados",
      "Relatórios em PDF",
      "Suporte prioritário",
      "Atualizações automáticas de índices",
    ],
    priceMonthly: 19900,  // R$ 199,00
    priceYearly: 190000,  // R$ 1.900,00 (economia de ~20%)
    currency: "brl",
    popular: true,
    creditsPerMonth: 999999, // Ilimitado
  },
  {
    id: "enterprise",
    name: "Empresarial",
    description: "Para grandes escritórios e empresas",
    features: [
      "Todos os módulos de cálculo",
      "Cálculos ilimitados",
      "Relatórios personalizados",
      "API de integração",
      "Suporte dedicado 24/7",
      "Multi-usuários",
      "Treinamento incluso",
    ],
    priceMonthly: 49900,  // R$ 499,00
    priceYearly: 479000,  // R$ 4.790,00 (economia de ~20%)
    currency: "brl",
    creditsPerMonth: 999999, // Ilimitado
  },
];

export function getPlanById(id: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.id === id);
}
