/**
 * Definição dos planos do Jurify SaaS.
 *
 * Planos são gateway-agnóstico: nem Stripe nem Asaas conhecem este arquivo
 * diretamente. Ao criar uma assinatura, mapeamos o `id` do plano para o
 * preço/ciclo correspondente no gateway.
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
  /** Pagamento avulso (one-time) em vez de assinatura recorrente */
  isOneTime?: boolean;
  /** Número de cálculos permitidos por mês (0 = ilimitado) */
  creditsPerMonth: number;
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
    priceMonthly: 4900,
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
    priceMonthly: 9900,
    priceYearly: 95000,
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
    priceMonthly: 19900,
    priceYearly: 190000,
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
    priceMonthly: 49900,
    priceYearly: 479000,
    currency: "brl",
    creditsPerMonth: 999999,
  },
];

export function getPlanById(id: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.id === id);
}
