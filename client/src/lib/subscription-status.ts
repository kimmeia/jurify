/**
 * Helper de resolução visual de status de plano (Fase 5 do roadmap de Planos).
 *
 * Converte o shape bruto de `subscription.current` em um discriminated union
 * que a UI consome diretamente. Substitui as 4-5 implementações ad-hoc
 * (badges em AdminDashboard, AdminSubscriptions, etc) por uma única fonte
 * de verdade.
 */

export type StatusVisual =
  | { tipo: "ativo"; proximaCobranca: Date | null }
  | { tipo: "trial"; diasRestantes: number; expiraEm: Date }
  | { tipo: "vencido"; diasAtraso: number }
  | { tipo: "cancelado"; canceladoEm: Date | null }
  | { tipo: "cortesia"; motivo: string | null; expiraEm: Date | null }
  | { tipo: "incompleto" }
  | { tipo: "sem_plano" };

interface SubscriptionShape {
  status?: string | null;
  currentPeriodEnd?: number | null;
  cortesia?: boolean | null;
  cortesiaMotivo?: string | null;
  cortesiaExpiraEm?: number | null;
  trialExpiraEm?: number | null;
  diasRestantesTrial?: number | null;
  updatedAt?: Date | string | null;
}

export function resolverStatusVisual(sub: SubscriptionShape | null | undefined): StatusVisual {
  if (!sub) return { tipo: "sem_plano" };

  // Cortesia tem prioridade
  if (sub.cortesia) {
    return {
      tipo: "cortesia",
      motivo: sub.cortesiaMotivo ?? null,
      expiraEm: sub.cortesiaExpiraEm ? new Date(sub.cortesiaExpiraEm) : null,
    };
  }

  switch (sub.status) {
    case "active":
      return {
        tipo: "ativo",
        proximaCobranca: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
      };
    case "trialing": {
      const diasRestantes = sub.diasRestantesTrial ?? 0;
      const expiraEm = sub.trialExpiraEm ? new Date(sub.trialExpiraEm) : new Date();
      return { tipo: "trial", diasRestantes, expiraEm };
    }
    case "past_due": {
      const venc = sub.currentPeriodEnd ?? Date.now();
      const diasAtraso = Math.max(0, Math.floor((Date.now() - venc) / (24 * 60 * 60 * 1000)));
      return { tipo: "vencido", diasAtraso };
    }
    case "canceled":
    case "incomplete_expired":
      return {
        tipo: "cancelado",
        canceladoEm: sub.updatedAt ? new Date(sub.updatedAt) : null,
      };
    case "incomplete":
    case "paused":
    case "unpaid":
      return { tipo: "incompleto" };
    default:
      return { tipo: "sem_plano" };
  }
}
