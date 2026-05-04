/**
 * MultiSelectFilter — filtro com múltipla seleção via popover + checkbox.
 *
 * Substitui Selects single-value quando o user precisa marcar várias
 * opções (ex: status "Pendente + Vencido"). Mantém UI compacta:
 * trigger mostra contador "(2)" ou "todas" quando vazio.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  /** Texto do trigger quando nenhum item está selecionado. */
  placeholder: string;
  options: MultiSelectOption[];
  /** Valores selecionados. Vazio = "todos" (sem filtro). */
  value: string[];
  onChange: (values: string[]) => void;
  className?: string;
  showFilterIcon?: boolean;
}

export function MultiSelectFilter({
  placeholder,
  options,
  value,
  onChange,
  className,
  showFilterIcon = false,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);

  const toggle = (val: string) => {
    onChange(value.includes(val) ? value.filter((v) => v !== val) : [...value, val]);
  };

  const label =
    value.length === 0
      ? placeholder
      : value.length === 1
      ? options.find((o) => o.value === value[0])?.label || value[0]
      : `${placeholder} (${value.length})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-9 justify-between text-xs font-normal", className)}
        >
          <span className="flex items-center gap-1 truncate">
            {showFilterIcon && <Filter className="h-3 w-3" />}
            {label}
          </span>
          <ChevronDown className="h-3 w-3 ml-1 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1">
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 hover:bg-accent rounded"
            >
              Limpar seleção
            </button>
          )}
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 px-2 py-1.5 hover:bg-accent rounded cursor-pointer text-xs"
            >
              <Checkbox
                checked={value.includes(opt.value)}
                onCheckedChange={() => toggle(opt.value)}
              />
              <span className="flex-1">{opt.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
