/**
 * Definição dos planos do Jurify SaaS — gateway-agnóstico.
 *
 * Cada plano tem:
 *   - id          → chave usada em `subscriptions.planId` e em plan-limits.ts
 *   - name        → nome de exibição
 *   - features    → bullets na página /plans
 *   - priceMonthly/Yearly → centavos (BRL). Anual = 10x mensal (~17% off).
 *
 * Para alterar limites (clientes, processos, etc), editar `plan-limits.ts`.
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
   * Limite de cálculos jurídicos/mês (módulos de Cálculos).
   * Não é exibido na página de planos, mas é usado pelo sistema de
   * créditos para travar o uso. Use 999999 para ilimitado.
   */
  creditsPerMonth: number;
}

export const PLANS: PlanDefinition[] = [
  {
    id: "iniciante",
    name: "Iniciante",
    description: "Para advogados autônomos começando agora",
    features: [
      "Até 50 clientes",
      "2 colaboradores",
      "WhatsApp QR Code (Baileys)",
      "Pipeline de leads + CRM básico",
      "Cálculos jurídicos (todos os módulos)",
      "5 GB de armazenamento",
      "Suporte por e-mail",
    ],
    priceMonthly: 9900, // R$ 99,00/mês
    priceYearly: 99000, // R$ 990,00/ano (2 meses grátis)
    currency: "brl",
    creditsPerMonth: 100,
  },
  {
    id: "profissional",
    name: "Profissional",
    description: "Para escritórios em crescimento",
    features: [
      "Até 500 clientes",
      "5 colaboradores",
      "WhatsApp Cloud API + QR Code",
      "Monitoramento de processos (Judit.IO)",
      "Cobranças automáticas (Asaas)",
      "Agendamento integrado (Cal.com)",
      "Pareceres técnicos em PDF",
      "20 GB de armazenamento",
      "Suporte prioritário",
    ],
    priceMonthly: 19900, // R$ 199,00/mês
    priceYearly: 199000, // R$ 1.990,00/ano
    currency: "brl",
    popular: true,
    creditsPerMonth: 500,
  },
  {
    id: "escritorio",
    name: "Escritório",
    description: "Para escritórios estabelecidos e equipes maiores",
    features: [
      "Clientes ilimitados",
      "Colaboradores ilimitados",
      "Tudo do Profissional",
      "Agentes de IA (chatbot inteligente)",
      "Relatórios avançados e BI",
      "API de integração",
      "100 GB de armazenamento",
      "Suporte dedicado + onboarding",
    ],
    priceMonthly: 39900, // R$ 399,00/mês
    priceYearly: 399000, // R$ 3.990,00/ano
    currency: "brl",
    creditsPerMonth: 999999, // ilimitado
  },
];

export function getPlanById(id: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.id === id);
}
