/**
 * ClienteCombobox — seletor de cliente com busca server-side.
 *
 * Usado nos dialogs de Nova Cobrança e Nova Assinatura. Substitui o <Select>
 * anterior que carregava todos os clientes de uma vez (inviável com 1000+ clientes).
 *
 * Busca debounced via trpc.asaas.listarClientesVinculados({ busca }).
 */

import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronDown, Loader2, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Cliente = {
  contatoId: number;
  contatoNome: string;
  cpfCnpj: string;
};

type ClienteComboboxProps = {
  value: string; // contatoId as string (compatível com form existente)
  onChange: (contatoId: string, cliente: Cliente | null) => void;
  placeholder?: string;
  disabled?: boolean;
};

function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function ClienteCombobox({
  value,
  onChange,
  placeholder = "Selecione um cliente",
  disabled,
}: ClienteComboboxProps) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebounced(busca, 300);

  // Cache local do cliente atualmente selecionado — permite manter o label
  // correto no trigger mesmo quando a busca muda e ele sai da lista.
  const [selecionado, setSelecionado] = useState<Cliente | null>(null);

  const { data: clientes, isFetching } = trpc.asaas.listarClientesVinculados.useQuery(
    { busca: buscaDebounced || undefined },
    { retry: false, keepPreviousData: true } as any,
  );

  // Se o pai muda o value externamente (ex: reset), limpa o cache local.
  useEffect(() => {
    if (!value) {
      setSelecionado(null);
      return;
    }
    if (selecionado && String(selecionado.contatoId) === value) return;
    // Tentar achar no resultado atual
    const achado = clientes?.find((c: any) => String(c.contatoId) === value);
    if (achado) setSelecionado(achado as Cliente);
  }, [value, clientes, selecionado]);

  const label = selecionado
    ? `${selecionado.contatoNome}${selecionado.cpfCnpj ? ` (${selecionado.cpfCnpj})` : ""}`
    : placeholder;

  const itens = useMemo(() => (clientes as Cliente[] | undefined) || [], [clientes]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between mt-1 font-normal",
            !selecionado && "text-muted-foreground",
          )}
        >
          <span className="truncate flex items-center gap-2">
            <User className="h-3.5 w-3.5 shrink-0 opacity-60" />
            {label}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width] min-w-[300px]"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar por nome ou CPF/CNPJ..."
            value={busca}
            onValueChange={setBusca}
          />
          <CommandList>
            {isFetching && (
              <div className="flex items-center gap-2 py-3 px-4 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Buscando…
              </div>
            )}
            {!isFetching && itens.length === 0 && (
              <CommandEmpty>
                {buscaDebounced
                  ? "Nenhum cliente encontrado."
                  : "Nenhum cliente vinculado."}
              </CommandEmpty>
            )}
            {itens.length > 0 && (
              <CommandGroup>
                {itens.map((c) => (
                  <CommandItem
                    key={c.contatoId}
                    value={String(c.contatoId)}
                    onSelect={() => {
                      setSelecionado(c);
                      onChange(String(c.contatoId), c);
                      setOpen(false);
                      setBusca("");
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="truncate text-sm">{c.contatoNome}</span>
                      {c.cpfCnpj && (
                        <span className="truncate text-[10px] text-muted-foreground font-mono">
                          {c.cpfCnpj}
                        </span>
                      )}
                    </div>
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        String(c.contatoId) === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
