import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, Clock, AlertTriangle, XCircle, Sparkles, Hourglass, Ban,
} from "lucide-react";
import type { StatusVisual } from "@/lib/subscription-status";

interface Props {
  status: StatusVisual;
  className?: string;
}

/**
 * Badge unificado de status de plano. Cores e ícones por tipo:
 *   - ativo:      verde + ✓
 *   - trial:      azul + clock (com dias restantes)
 *   - vencido:    vermelho + ⚠ (com dias de atraso)
 *   - cancelado:  cinza + ban
 *   - cortesia:   roxo + sparkles
 *   - incompleto: amarelo + hourglass
 *   - sem_plano:  outline neutro
 */
export function StatusPlanoBadge({ status, className }: Props) {
  switch (status.tipo) {
    case "ativo":
      return (
        <Badge className={`bg-success/15 text-success-fg border-success/30 ${className ?? ""}`}>
          <CheckCircle2 className="h-3 w-3 mr-1" /> Ativo
        </Badge>
      );
    case "trial":
      return (
        <Badge className={`bg-info/15 text-info-fg border-info/30 ${className ?? ""}`}>
          <Clock className="h-3 w-3 mr-1" />
          Trial — {status.diasRestantes}d restante{status.diasRestantes === 1 ? "" : "s"}
        </Badge>
      );
    case "vencido":
      return (
        <Badge variant="destructive" className={className}>
          <AlertTriangle className="h-3 w-3 mr-1" />
          Vencido ({status.diasAtraso}d)
        </Badge>
      );
    case "cancelado":
      return (
        <Badge variant="outline" className={`text-muted-foreground ${className ?? ""}`}>
          <Ban className="h-3 w-3 mr-1" /> Cancelado
        </Badge>
      );
    case "cortesia":
      return (
        <Badge className={`bg-info/15 text-info-fg border-info/30 ${className ?? ""}`}>
          <Sparkles className="h-3 w-3 mr-1" /> Cortesia
        </Badge>
      );
    case "incompleto":
      return (
        <Badge className={`bg-warning/15 text-warning-fg border-warning/30 ${className ?? ""}`}>
          <Hourglass className="h-3 w-3 mr-1" /> Aguardando pagamento
        </Badge>
      );
    case "sem_plano":
    default:
      return (
        <Badge variant="outline" className={className}>
          <XCircle className="h-3 w-3 mr-1" /> Sem plano
        </Badge>
      );
  }
}
