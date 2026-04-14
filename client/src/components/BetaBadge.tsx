import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BetaBadgeProps = {
  className?: string;
};

/**
 * Etiqueta "Beta" padronizada — indica que o módulo está em testes e pode
 * apresentar bugs ou mudanças de comportamento. Uso consistente no sidebar
 * e nos headers das páginas dos módulos.
 */
export function BetaBadge({ className }: BetaBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[9px] px-1 py-0 border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-950/20",
        className,
      )}
    >
      Beta
    </Badge>
  );
}
