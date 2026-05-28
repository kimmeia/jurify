/**
 * Wizard "Resolver duplicatas" — limpa o legado de pagamentos duplicados.
 *
 * Caso típico: operador via web lançou manual quando o pagamento já tinha
 * vindo via Asaas no nome de terceiro (esposa). Caixa inflado, comissão
 * duplicada. Esta UI lista cada par suspeito (mesmo valor, datas próximas,
 * pelo menos um manual/órfão) e oferece 3 ações por par:
 *
 *  1. **Auto-fix** (recomendado quando lado Asaas + lado manual existem)
 *     — vincula a Asaas como beneficiária do contato da manual e remove
 *     a manual. Preserva o pagamento real (Asaas) com o histórico do
 *     contato certo (Carlos).
 *  2. **Manter A / Remover B** — exclui o lado escolhido sem vincular.
 *     Útil quando o par não é Carlos+esposa, mas sim "lancei manual 2x
 *     por engano" — quer só apagar uma.
 *  3. **Manter B / Remover A** — espelho.
 *
 * Cobranças em fechamento de comissão aparecem com badge bloqueando ação
 * (precisa excluir o fechamento primeiro).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Loader2,
  Trash2,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatBRL } from "./helpers";

type LadoCob = {
  id: number;
  valor: number;
  origem: "asaas" | "manual";
  contatoId: number | null;
  contatoNome: string | null;
  dataPagamento: string | null;
  status: string;
  descricao: string | null;
  asaasPaymentId: string | null;
  formaPagamento: string | null;
  emFechamento: boolean;
};

type Par = { a: LadoCob; b: LadoCob };

export function ResolverDuplicidadesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const { data: pares = [], isLoading, refetch } = (trpc as any).asaas
    .listarParesSuspeitos.useQuery(undefined, {
      enabled: open,
      retry: false,
      refetchOnWindowFocus: false,
    });

  const resolverMut = (trpc as any).asaas.resolverDuplicataPar.useMutation({
    onSuccess: (r: { vinculouBeneficiario: boolean }) => {
      toast.success("Duplicata resolvida", {
        description: r.vinculouBeneficiario
          ? "Pagamento original mantido (auditoria correta) e atribuído ao cliente."
          : "Cobrança duplicada removida.",
      });
      refetch();
      utils.asaas.resumoContato.invalidate();
      utils.asaas.resumoPorContatos.invalidate();
      utils.asaas.kpis.invalidate();
      utils.asaas.listarCobrancas.invalidate();
    },
    onError: (err: any) =>
      toast.error("Não foi possível resolver", { description: err.message }),
  });

  const valorTotalEmDuplicata = pares.reduce(
    (acc: number, p: Par) => acc + p.a.valor,
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-violet-600" />
            Resolver duplicatas no caixa
          </DialogTitle>
          <DialogDescription>
            Cada par mostra duas cobranças pagas com mesmo valor e datas
            próximas, onde pelo menos uma é manual ou órfã. Escolha como
            resolver — auto-fix é a opção recomendada pro caso "pagou no nome
            de terceiro".
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : pares.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <div className="text-center">
              <p className="text-base font-semibold">Nenhuma duplicata pendente</p>
              <p className="text-xs text-muted-foreground mt-1">
                Os pares já resolvidos via "vincular pagamento de terceiro"
                somem desta lista automaticamente.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs dark:bg-amber-950/30 dark:border-amber-900">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">
                  {pares.length} par{pares.length > 1 ? "es" : ""} suspeito
                  {pares.length > 1 ? "s" : ""} encontrado
                  {pares.length > 1 ? "s" : ""} — possível inflação de{" "}
                  <b>{formatBRL(valorTotalEmDuplicata)}</b> no caixa
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {pares.map((par: Par, i: number) => (
                <ParCard
                  key={`${par.a.id}-${par.b.id}`}
                  par={par}
                  index={i + 1}
                  onResolverAutoFix={(manterId, removerId) =>
                    resolverMut.mutate({
                      manterCobrancaId: manterId,
                      removerCobrancaId: removerId,
                      vincularBeneficiario: true,
                    })
                  }
                  onResolverSemVincular={(manterId, removerId) =>
                    resolverMut.mutate({
                      manterCobrancaId: manterId,
                      removerCobrancaId: removerId,
                      vincularBeneficiario: false,
                    })
                  }
                  pending={resolverMut.isPending}
                />
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ParCard({
  par,
  index,
  onResolverAutoFix,
  onResolverSemVincular,
  pending,
}: {
  par: Par;
  index: number;
  onResolverAutoFix: (manterId: number, removerId: number) => void;
  onResolverSemVincular: (manterId: number, removerId: number) => void;
  pending: boolean;
}) {
  // Decide qual lado é o candidato natural a "manter" (Asaas tem precedência
  // — é o pagamento real). Se ambos manuais ou ambos Asaas, opera assim mesmo.
  const aEhAsaas = par.a.origem === "asaas";
  const bEhAsaas = par.b.origem === "asaas";
  const ladoAsaasUnico =
    (aEhAsaas && !bEhAsaas) ? par.a
    : (bEhAsaas && !aEhAsaas) ? par.b
    : null;
  const ladoManualUnico =
    (par.a.origem === "manual" && par.b.origem !== "manual") ? par.a
    : (par.b.origem === "manual" && par.a.origem !== "manual") ? par.b
    : null;

  const podeAutoFix =
    ladoAsaasUnico !== null &&
    ladoManualUnico !== null &&
    !ladoAsaasUnico.emFechamento &&
    !ladoManualUnico.emFechamento &&
    ladoManualUnico.contatoId !== null;

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">
          Par #{index} · {formatBRL(par.a.valor)}
        </p>
        {podeAutoFix && (
          <Button
            size="sm"
            className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white"
            disabled={pending}
            onClick={() =>
              onResolverAutoFix(ladoAsaasUnico!.id, ladoManualUnico!.id)
            }
            title="Recomendado: mantém o pagamento Asaas (auditoria) e atribui ao cliente da manual; remove a manual duplicada"
          >
            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
            Auto-fix
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <LadoCard
          lado={par.a}
          label="Cobrança A"
          onRemover={() => onResolverSemVincular(par.b.id, par.a.id)}
          podeRemover={
            !par.a.emFechamento &&
            (par.a.origem === "manual" || par.a.status === "PENDING")
          }
          pending={pending}
        />
        <LadoCard
          lado={par.b}
          label="Cobrança B"
          onRemover={() => onResolverSemVincular(par.a.id, par.b.id)}
          podeRemover={
            !par.b.emFechamento &&
            (par.b.origem === "manual" || par.b.status === "PENDING")
          }
          pending={pending}
        />
      </div>
    </div>
  );
}

function LadoCard({
  lado,
  label,
  onRemover,
  podeRemover,
  pending,
}: {
  lado: LadoCob;
  label: string;
  onRemover: () => void;
  podeRemover: boolean;
  pending: boolean;
}) {
  return (
    <div
      className={`rounded border p-2.5 text-xs space-y-1 ${
        lado.origem === "manual"
          ? "bg-amber-50/30 border-amber-200 dark:bg-amber-950/10 dark:border-amber-900"
          : "bg-emerald-50/30 border-emerald-200 dark:bg-emerald-950/10 dark:border-emerald-900"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          {label} · #{lado.id}
        </span>
        <Badge
          variant="outline"
          className={`text-[9px] ${
            lado.origem === "manual"
              ? "border-amber-400 text-amber-700"
              : "border-emerald-400 text-emerald-700"
          }`}
        >
          {lado.origem}
        </Badge>
      </div>
      <p className="font-medium truncate">
        {lado.contatoNome ?? (
          <span className="italic text-muted-foreground">sem contato</span>
        )}
      </p>
      <p className="text-[11px] text-muted-foreground truncate">
        {lado.descricao || "—"}
      </p>
      <p className="text-[10px] text-muted-foreground">
        Pago em{" "}
        {lado.dataPagamento
          ? lado.dataPagamento.split("-").reverse().join("/")
          : "—"}
        {lado.formaPagamento && ` · ${lado.formaPagamento}`}
      </p>
      {lado.emFechamento ? (
        <div className="flex items-center gap-1 text-[10px] text-violet-700 dark:text-violet-300 mt-1.5">
          <Lock className="h-3 w-3" />
          em fechamento de comissão — exclua o fechamento antes de remover
        </div>
      ) : podeRemover ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-full mt-1 text-[10px] text-destructive hover:bg-destructive/10"
          disabled={pending}
          onClick={onRemover}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Manter outra · remover esta
        </Button>
      ) : (
        <p className="text-[10px] text-muted-foreground italic mt-1">
          Asaas não-pendente — cancele no painel do Asaas
        </p>
      )}
    </div>
  );
}
