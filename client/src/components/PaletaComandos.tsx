import { useState, useEffect, useMemo } from "react";
import type { ComponentType } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { trpc } from "@/lib/trpc";
import { useClientesVinculaveis } from "@/hooks/use-clientes-vinculaveis";
import { contratoLibera } from "@shared/modulos-contratacao";
import { User, FileSearch, ArrowRight } from "lucide-react";

export type TelaNavegavel = {
  id: string;
  rotulo: string;
  rota: string;
  icone: ComponentType<{ className?: string }>;
};

/** Acentos atrapalham busca digitada às pressas: "antonio" tem que achar "Antônio". */
function semAcento(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Busca global do app (⌘K / Ctrl+K).
 *
 * Não cria procedure nenhuma: reusa `clientes.listar` (via
 * `useClientesVinculaveis`, que já escolhe entre o módulo completo e a lista
 * essencial do pacote processual) e `processos.meusMonitoramentos`. As duas
 * já filtram por permissão do cargo no servidor, então o que a paleta mostra
 * é exatamente o que a pessoa veria entrando na tela.
 *
 * O filtro do cmdk fica DESLIGADO de propósito: a busca de clientes acontece
 * no servidor, que também casa por dígitos de telefone/CPF. Deixar o cmdk
 * filtrar por cima esconderia justamente esses acertos.
 */
export function PaletaComandos({
  aberta,
  onOpenChange,
  telas,
  onNavegar,
}: {
  aberta: boolean;
  onOpenChange: (v: boolean) => void;
  telas: TelaNavegavel[];
  onNavegar: (rota: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [buscaDeb, setBuscaDeb] = useState("");

  // Some com o texto ao fechar — reabrir com a busca anterior mostra
  // resultado velho antes de a pessoa digitar.
  useEffect(() => {
    if (!aberta) {
      setBusca("");
      setBuscaDeb("");
    }
  }, [aberta]);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const termo = buscaDeb.trim();
  const buscando = termo.length >= 2;

  const { data: modulosData } = trpc.subscription.modulosContratados.useQuery(undefined, {
    staleTime: 60_000,
    enabled: aberta,
  });
  const temProcessos = contratoLibera(modulosData?.modulos ?? null, ["processos"]);

  const clientes = useClientesVinculaveis({ busca: termo, enabled: aberta && buscando });

  // `meusMonitoramentos` não aceita busca — o filtro é aqui. A lista é
  // limitada pelo plano (dezenas, não milhares), então cabe no cliente.
  const { data: monitoramentos } = trpc.processos.meusMonitoramentos.useQuery(undefined, {
    enabled: aberta && temProcessos,
    staleTime: 60_000,
    retry: false,
  });

  const processosFiltrados = useMemo(() => {
    if (!buscando) return [];
    const q = semAcento(termo);
    const digitos = termo.replace(/\D/g, "");
    return ((monitoramentos as any[]) ?? [])
      .filter((m) => {
        const alvo = semAcento(
          [m.apelido, m.searchKey, m.partesRotulo, m.capa?.tribunal, m.capa?.orgaoJulgador]
            .filter(Boolean)
            .join(" "),
        );
        if (alvo.includes(q)) return true;
        return digitos.length >= 3 && String(m.searchKey ?? "").includes(digitos);
      })
      .slice(0, 5);
  }, [monitoramentos, termo, buscando]);

  const telasFiltradas = useMemo(() => {
    if (!termo) return telas.slice(0, 6);
    const q = semAcento(termo);
    return telas.filter((t) => semAcento(t.rotulo).includes(q)).slice(0, 6);
  }, [telas, termo]);

  const clientesVisiveis = useMemo(() => (buscando ? clientes.slice(0, 6) : []), [clientes, buscando]);

  const ir = (rota: string) => {
    onOpenChange(false);
    onNavegar(rota);
  };

  const temAlgo =
    clientesVisiveis.length > 0 || processosFiltrados.length > 0 || telasFiltradas.length > 0;

  return (
    <Dialog open={aberta} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Buscar no JuridFlow</DialogTitle>
        <DialogDescription>
          Busque clientes, processos e telas, ou navegue pelo sistema.
        </DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[620px]" showCloseButton={false}>
        <Command shouldFilter={false} className="bg-popover">
          <CommandInput
            placeholder="Buscar cliente, processo ou tela..."
            value={busca}
            onValueChange={setBusca}
          />
          <CommandList className="max-h-[380px]">
            {!temAlgo && (
              <CommandEmpty>
                {buscando
                  ? `Nada encontrado para “${termo}”.`
                  : "Digite pelo menos 2 letras para buscar clientes e processos."}
              </CommandEmpty>
            )}

            {clientesVisiveis.length > 0 && (
              <CommandGroup heading="Clientes">
                {clientesVisiveis.map((c: any) => (
                  <CommandItem
                    key={`cliente-${c.id}`}
                    value={`cliente-${c.id}`}
                    onSelect={() => ir(`/clientes?id=${c.id}`)}
                  >
                    <User className="text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[c.telefone, c.email, c.cpfCnpj].filter(Boolean).join(" · ") || "sem contato cadastrado"}
                      </p>
                    </div>
                    <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      abrir ficha
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {processosFiltrados.length > 0 && (
              <CommandGroup heading="Processos">
                {processosFiltrados.map((m: any) => (
                  <CommandItem
                    key={`proc-${m.id}`}
                    value={`proc-${m.id}`}
                    onSelect={() => ir("/processos")}
                  >
                    <FileSearch className="text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.apelido || m.searchKey}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[m.partesRotulo, m.capa?.tribunal].filter(Boolean).join(" · ") ||
                          (m.tipoMonitoramento === "novas_acoes" ? "monitoramento de novas ações" : "monitoramento de movimentações")}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {telasFiltradas.length > 0 && (
              <CommandGroup heading="Ir para">
                {telasFiltradas.map((t) => {
                  const Icone = t.icone;
                  return (
                    <CommandItem key={`tela-${t.id}`} value={`tela-${t.id}`} onSelect={() => ir(t.rota)}>
                      <Icone className="text-muted-foreground" />
                      <span className="text-sm">{t.rotulo}</span>
                      <ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground/60" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>

          <div className="flex items-center gap-4 border-t px-3 py-2 text-[10.5px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border bg-muted px-1 py-px font-mono text-[10px]">↑</kbd>
              <kbd className="rounded border bg-muted px-1 py-px font-mono text-[10px]">↓</kbd>
              navegar
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border bg-muted px-1 py-px font-mono text-[10px]">↵</kbd>
              abrir
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border bg-muted px-1 py-px font-mono text-[10px]">esc</kbd>
              fechar
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
