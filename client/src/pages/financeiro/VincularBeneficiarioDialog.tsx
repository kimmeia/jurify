/**
 * Dialog "Vincular pagamento de terceiro".
 *
 * Caso resolvido: Carlos é cliente, mas a R$ 10k caiu no Asaas no CPF
 * da esposa. Antes, o operador era forçado a lançar manual no Carlos →
 * duplicava o caixa. Agora, ele abre este dialog na ficha do Carlos,
 * encontra a cobrança da esposa, e clica "Vincular ao Carlos".
 *
 * A cobrança Asaas continua no CPF da esposa (auditoria fiscal correta).
 * KPI/resumo do Carlos/comissão usam `contatoBeneficiarioId` em vez do
 * pagador. Reversível via `desvincularPagamentoBeneficiario`.
 */
import { useState, useMemo } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  CheckCircle2,
  Link2,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "./helpers";

export function VincularBeneficiarioDialog({
  open,
  onOpenChange,
  contatoBeneficiarioId,
  contatoBeneficiarioNome,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** ID do cliente que vai virar dono lógico da cobrança (ex: Carlos). */
  contatoBeneficiarioId: number;
  /** Nome do cliente alvo — mostrado no título e na confirmação. */
  contatoBeneficiarioNome: string;
  onSuccess: () => void;
}) {
  const utils = trpc.useUtils();
  const [busca, setBusca] = useState("");
  const [selecionada, setSelecionada] = useState<number | null>(null);
  const [reatribuirAtendente, setReatribuirAtendente] = useState(true);

  // Lista cobranças PAGAS de OUTROS contatos que ainda não têm beneficiário.
  // Usa `enabled: open` pra não disparar antes do dialog abrir.
  const { data: candidatos = [], isLoading } = (trpc as any).asaas
    .listarCobrancasParaVincularBeneficiario.useQuery(
      { contatoBeneficiarioId, busca: busca.trim() || undefined, limit: 30 },
      { enabled: open, retry: false },
    );

  const vincularMut = (trpc as any).asaas.vincularPagamentoBeneficiario.useMutation({
    onSuccess: (r: { atendenteReatribuido: number | null }) => {
      toast.success("Pagamento vinculado", {
        description: r.atendenteReatribuido
          ? "Atendente também foi reatribuído pro responsável do cliente."
          : "A cobrança continua no pagador original (auditoria), mas conta no caixa do cliente.",
      });
      // Invalida tudo que mostra resumo financeiro do cliente
      utils.asaas.resumoContato.invalidate();
      utils.asaas.resumoPorContatos.invalidate();
      utils.asaas.listarCobrancas.invalidate();
      utils.asaas.kpis.invalidate();
      onSuccess();
      onOpenChange(false);
      setSelecionada(null);
      setBusca("");
    },
    onError: (err: any) =>
      toast.error("Erro ao vincular", { description: err.message }),
  });

  const cobrancaEscolhida = useMemo(
    () => candidatos.find((c: any) => c.id === selecionada) ?? null,
    [candidatos, selecionada],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Vincular pagamento de terceiro a {contatoBeneficiarioNome}
          </DialogTitle>
          <DialogDescription>
            Use quando um pagamento entrou no Asaas no nome de outra pessoa
            (cônjuge, familiar, sócio) mas é dívida deste cliente. A cobrança
            mantém o nome do pagador (auditoria), mas conta no caixa deste
            cliente. Não precisa lançar manual — evita duplicar.
          </DialogDescription>
        </DialogHeader>

        {/* Busca por descrição ou nome do pagador */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome do pagador ou descrição..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto rounded border">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : candidatos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">
                Nenhum pagamento elegível encontrado
              </p>
              <p className="text-xs text-muted-foreground max-w-md">
                Mostra cobranças <b>pagas</b> de <b>outros clientes</b> que
                ainda não foram atribuídas a ninguém. Tente um termo de busca
                diferente, ou registre o pagamento por uma cobrança manual
                neste cliente.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead className="text-xs">Pagador no Asaas</TableHead>
                  <TableHead className="text-xs">Descrição</TableHead>
                  <TableHead className="text-xs">Pago em</TableHead>
                  <TableHead className="text-xs text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidatos.map((c: any) => {
                  const ehEscolhida = selecionada === c.id;
                  return (
                    <TableRow
                      key={c.id}
                      data-state={ehEscolhida ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => setSelecionada(c.id)}
                    >
                      <TableCell className="px-2">
                        <input
                          type="radio"
                          checked={ehEscolhida}
                          onChange={() => setSelecionada(c.id)}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {c.contatoNomePagador ?? (
                          <span className="text-muted-foreground italic">
                            sem contato vinculado
                          </span>
                        )}
                        {c.origem === "manual" && (
                          <span className="ml-1.5 text-[9px] text-amber-700">
                            (manual)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs max-w-[240px] truncate">
                        {c.descricao || "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {c.dataPagamento
                          ? c.dataPagamento.split("-").reverse().join("/")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-medium">
                        {formatBRL(parseFloat(c.valor))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Opção de reatribuir atendente */}
        {cobrancaEscolhida && (
          <div className="rounded border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-medium">
              <CheckCircle2 className="h-3.5 w-3.5 inline mr-1.5 text-emerald-600" />
              Selecionado: {formatBRL(parseFloat(cobrancaEscolhida.valor))} de{" "}
              {cobrancaEscolhida.contatoNomePagador ?? "sem contato"}
            </p>
            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={reatribuirAtendente}
                onChange={(e) => setReatribuirAtendente(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              <span>
                Atribuir a comissão ao responsável de{" "}
                <b>{contatoBeneficiarioNome}</b> (recomendado)
              </span>
            </label>
            <p className="text-[10px] text-muted-foreground ml-5">
              Se desmarcar, a comissão fica com quem cuida do contato pagador
              original.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={selecionada === null || vincularMut.isPending}
            onClick={() =>
              vincularMut.mutate({
                cobrancaId: selecionada!,
                contatoBeneficiarioId,
                reatribuirAtendente,
              })
            }
          >
            {vincularMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
