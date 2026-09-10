/**
 * Faxina do que já duplicou: fichas do escritório agrupadas pelo telefone,
 * com "Mesclar" por linha ou em lote. A regra de quem sobrevive é a mesma da
 * unificação automática (ficha com CPF; em empate, a mais antiga), e cada
 * mesclagem fica desfazível por 7 dias na conversa do cliente.
 *
 * Só aparece pra quem pode excluir clientes — a permissão do "Mesclar" que
 * já existe na ficha — e nada roda sozinho aqui: é quem clica que manda.
 *
 * Grupo com dois CPFs preenchidos e diferentes (decisão do dono, 09/09):
 * "Mesclar todos" pula, e o Mesclar da linha vira "Mesclar mesmo assim" com
 * confirmação — mesclar descarta o CPF da ficha absorvida, e pode ser um
 * casal com o mesmo telefone. A conferência completa fica na página
 * "Conferência de cadastros".
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  cpfsDiferentes: boolean;
};

const ORIGEM: Record<string, string> = {
  whatsapp: "WhatsApp",
  manual: "Cadastro manual",
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

function paresDoGrupo(g: Grupo, confirmarCpfDiferente = false) {
  return g.mescladas.map((m) => ({
    principalId: g.sobrevivente.id,
    duplicadoId: m.id,
    ...(confirmarCpfDiferente ? { confirmarCpfDiferente: true } : {}),
  }));
}

export function PossiveisDuplicadosButton({ onMesclado }: { onMesclado: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmar, setConfirmar] = useState<Grupo | null>(null);
  const { data, refetch } = (trpc as any).clientes.possiveisDuplicadosTelefone.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  const mesclar = (trpc as any).clientes.mesclarDuplicados.useMutation({
    onSuccess: (r: { feitos: number[]; falhas: Array<{ duplicadoId: number; erro: string }> }) => {
      const n = r.feitos.length;
      if (n > 0) {
        toast.success(n === 1 ? "Cadastros mesclados" : `${n} cadastros mesclados`, {
          description: r.falhas.length > 0
            ? `${r.falhas.length} não deu: ${r.falhas[0].erro}`
            : "Dá pra desfazer por 7 dias, na conversa do cliente.",
        });
      } else if (r.falhas.length > 0) {
        toast.error("Não deu pra mesclar", { description: r.falhas[0].erro });
      }
      refetch();
      onMesclado();
    },
    onError: (e: any) => toast.error("Não deu pra mesclar", { description: e.message }),
  });

  const grupos: Grupo[] = data?.podeVer ? (data.grupos ?? []) : [];
  if (grupos.length === 0) return null;
  // "Mesclar todos" pula quem tem CPFs diferentes — esses só com confirmação, linha a linha.
  const todosPares = grupos.filter((g) => !g.cpfsDiferentes).flatMap((g) => paresDoGrupo(g));
  const comCpfDiferente = grupos.filter((g) => g.cpfsDiferentes).length;

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
              secundário. Dá pra desfazer por 7 dias. Grupo com dois CPFs diferentes só mescla com
              confirmação — pode ser duas pessoas.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {grupos.length} {grupos.length === 1 ? "número" : "números"}
              {comCpfDiferente > 0 ? ` · "Mesclar todos" pula ${comCpfDiferente} com CPFs diferentes` : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={mesclar.isPending || todosPares.length === 0}
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
              <div key={g.chave} className={`grid grid-cols-[1.1fr_1.1fr_auto_auto] gap-3 items-center px-3 py-2 border-t text-xs ${g.cpfsDiferentes ? "bg-warning-bg/40" : ""}`}>
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
                <div className="tabular-nums whitespace-nowrap">
                  {mascararTelefoneBR(g.telefone)}
                  {g.cpfsDiferentes && (
                    <div className="mt-0.5 rounded-full bg-danger-bg px-1.5 py-px text-center text-[9px] font-bold text-danger-fg">CPFs diferentes</div>
                  )}
                </div>
                {g.cpfsDiferentes ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={mesclar.isPending} onClick={() => setConfirmar(g)}>
                    Mesclar mesmo assim
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={mesclar.isPending}
                    onClick={() => mesclar.mutate({ pares: paresDoGrupo(g) })}
                  >
                    {mesclar.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                    Mesclar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!confirmar} onOpenChange={(o) => { if (!o) setConfirmar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mesclar fichas com CPFs diferentes?</AlertDialogTitle>
            <AlertDialogDescription>
              O CPF/CNPJ de <b>{confirmar?.mescladas.map((m) => m.nome).join(", ")}</b> será descartado: a ficha
              sobrevivente ({confirmar?.sobrevivente.nome}) fica com o dela. Se forem duas pessoas com o mesmo
              telefone, marque "Não é duplicado" na Conferência de cadastros. Dá pra desfazer por 7 dias.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirmar) mesclar.mutate({ pares: paresDoGrupo(confirmar, true) }); setConfirmar(null); }}
            >
              Mesclar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
