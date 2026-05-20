import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type EmBreveBadgeProps = {
  className?: string;
};

/**
 * Etiqueta "Em breve" — indica que o módulo está no menu mas ainda não
 * foi liberado oficialmente. Diferente de Beta (disponível mas em testes):
 * "Em breve" sinaliza pré-lançamento / preview pro cliente final.
 */
export function EmBreveBadge({ className }: EmBreveBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[9px] px-1 py-0 border-sky-300 text-sky-700 bg-sky-50 dark:bg-sky-950/20 dark:text-sky-300 dark:border-sky-800",
        className,
      )}
    >
      Em breve
    </Badge>
  );
}
