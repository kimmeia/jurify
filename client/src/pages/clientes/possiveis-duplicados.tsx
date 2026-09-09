/**
 * Faxina do que já duplicou: fichas do escritório agrupadas pelo telefone,
 * com "Mesclar" por linha ou em lote. A regra de quem sobrevive é a mesma da
 * unificação automática (ficha com CPF; em empate, a mais antiga), e cada
 * mesclagem fica desfazível por 7 dias na conversa do cliente.
 *
 * Só aparece pra quem pode excluir clientes — a permissão do "Mesclar" que
 * já existe na ficha — e nada roda sozinho aqui: é quem clica que manda.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { mascararTelefoneBR } from "@shared/telefone";

type Ficha = {
  id: number;
  nome: string;
  origem: string;
  estagio: string;
  temCpf: boolean;
  createdAt: string | null;
  conversas: number;
  cobrancas: number;
  processos: number;
};

type Grupo = {
  chave: string;
  telefone: string | null;
  sobrevivente: Ficha;
  mescladas: Ficha[];
};

const ORIGEM: Record<string, string> = {
  whatsapp: "WhatsApp",
  manual: "Clientes",
  asaas: "Asaas",
  site: "Site",
  instagram: "Instagram",
  facebook: "Facebook",
  telefone: "Telefone",
};

function plural(n: number, um: string, varios: string): string | null {
  return n > 0 ? `${n} ${n === 1 ? um : varios}` : null;
}

function descreve(f: Ficha): string {
  const quando = f.createdAt ? new Date(f.createdAt).toLocaleDateString("pt-BR") : "";
  return [
    f.temCpf ? "CPF" : "sem CPF",
    plural(f.conversas, "conversa", "conversas"),
    plural(f.cobrancas, "cobrança", "cobranças"),
    plural(f.processos, "processo", "processos"),
    `${ORIGEM[f.origem] ?? f.origem}${quando ? ` ${quando}` : ""}`,
  ].filter(Boolean).join(" · ");
}

export function PossiveisDuplicadosButton({ onMesclado }: { onMesclado: () => void }) {
  const [open, setOpen] = useState(false);
  const { data, refetch } = (trpc as any).clientes.possiveisDuplicadosTelefone.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  const mesclar = (trpc as any).clientes.mesclarDuplicados.useMutation({
    onSuccess: (r: { feitos: number[]; falhas: Array<{ duplicadoId: number; erro: string }> }) => {
      const n = r.feitos.length;
      toast.success(n === 1 ? "Cadastros mesclados" : `${n} cadastros mesclados`, {
        description: r.falhas.length > 0
          ? `${r.falhas.length} não deu: ${r.falhas[0].erro}`
          : "Dá pra desfazer por 7 dias, na conversa do cliente.",
      });
      refetch();
      onMesclado();
    },
    onError: (e: any) => toast.error("Não deu pra mesclar", { description: e.message }),
  });

  const grupos: Grupo[] = data?.podeVer ? (data.grupos ?? []) : [];
  if (grupos.length === 0) return null;
  const todosPares = grupos.flatMap((g) =>
    g.mescladas.map((m) => ({ principalId: g.sobrevivente.id, duplicadoId: m.id })),
  );

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="text-foreground hover:bg-muted border border-border h-8 text-xs"
        title="Fichas diferentes com o mesmo telefone"
      >
        <Users className="h-3.5 w-3.5 mr-1" />
        Possíveis duplicados ({grupos.length})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Possíveis duplicados</DialogTitle>
            <DialogDescription>
              Fichas com o mesmo telefone. Sobrevive a que tem CPF (em empate, a mais antiga); a outra
              entra nela com conversas, cobranças, processos e histórico, e o número dela vira telefone
              secundário. Dá pra desfazer por 7 dias.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{grupos.length} {grupos.length === 1 ? "número" : "números"}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={mesclar.isPending}
              onClick={() => mesclar.mutate({ pares: todosPares.slice(0, 50) })}
            >
              Mesclar todos
            </Button>
          </div>
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[1.1fr_1.1fr_auto_auto] gap-3 px-3 py-1.5 bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              <span>Vai sobreviver</span>
              <span>Vai ser mesclada</span>
              <span>Mesmo telefone</span>
              <span />
            </div>
            {grupos.map((g) => (
              <div key={g.chave} className="grid grid-cols-[1.1fr_1.1fr_auto_auto] gap-3 items-center px-3 py-2 border-t text-xs">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{g.sobrevivente.nome}</p>
                  <p className="text-[10px] text-muted-foreground">{descreve(g.sobrevivente)}</p>
                </div>
                <div className="min-w-0 space-y-1">
                  {g.mescladas.map((m) => (
                    <div key={m.id}>
                      <p className="font-semibold truncate">{m.nome}</p>
                      <p className="text-[10px] text-muted-foreground">{descreve(m)}</p>
                    </div>
                  ))}
                </div>
                <div className="tabular-nums whitespace-nowrap">{mascararTelefoneBR(g.telefone)}</div>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={mesclar.isPending}
                  onClick={() => mesclar.mutate({
                    pares: g.mescladas.map((m) => ({ principalId: g.sobrevivente.id, duplicadoId: m.id })),
                  })}
                >
                  {mesclar.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                  Mesclar
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
