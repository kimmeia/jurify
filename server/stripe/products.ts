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
  /** Pagamento avulso (one-time) em vez de assinatura recorrente */
  isOneTime?: boolean;
  creditsPerMonth: number; // Número de cálculos permitidos por mês
}

export const PLANS: PlanDefinition[] = [
  {
    id: "avulso",
    name: "Cálculo Avulso",
    description: "Pague por cálculo, sem mensalidade",
    features: [
      "1 cálculo por compra",
      "Acesso imediato ao parecer técnico",
      "Sem compromisso",
      "Suporte por e-mail",
    ],
    priceMonthly: 4900,  // R$ 49,00 (avulso — usado como preço único)
    priceYearly: 4900,
    currency: "brl",
    isOneTime: true,
    creditsPerMonth: 1,
  },
  {
    id: "essencial",
    name: "Essencial",
    description: "Para profissionais autônomos",
    features: [
      "Cálculos Bancários e Diversos",
      "Até 50 cálculos por mês",
      "Pareceres técnicos em PDF",
      "Suporte por e-mail",
    ],
    priceMonthly: 9900,  // R$ 99,00
    priceYearly: 95000,  // R$ 950,00 (economia de ~20%)
    currency: "brl",
    creditsPerMonth: 50,
  },
  {
    id: "profissional",
    name: "Profissional",
    description: "Para escritórios em crescimento",
    features: [
      "Todos os módulos de cálculo",
      "Até 200 cálculos por mês",
      "Pareceres técnicos em PDF",
      "Suporte prioritário",
      "Atualizações automáticas de índices",
    ],
    priceMonthly: 19900,  // R$ 199,00
    priceYearly: 190000,  // R$ 1.900,00 (economia de ~20%)
    currency: "brl",
    popular: true,
    creditsPerMonth: 200,
  },
  {
    id: "ilimitado",
    name: "Ilimitado",
    description: "Para grandes escritórios e equipes",
    features: [
      "Todos os módulos de cálculo",
      "Cálculos ilimitados",
      "Relatórios personalizados",
      "API de integração",
      "Suporte dedicado",
      "Multi-usuários",
    ],
    priceMonthly: 49900,  // R$ 499,00
    priceYearly: 479000,  // R$ 4.790,00 (economia de ~20%)
    currency: "brl",
    creditsPerMonth: 999999,
  },
];

export function getPlanById(id: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.id === id);
}
