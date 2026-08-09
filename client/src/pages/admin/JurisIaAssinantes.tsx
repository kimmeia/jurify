/**
 * Quem tem o JurisIA liberado — só leitura.
 *
 * Liberar acontece na ficha do cliente (Admin → Clientes → Assinatura), que é
 * onde o operador já está olhando plano, cortesia e histórico. Aqui a pergunta
 * é outra e é do dono do produto: quantos clientes pagam, e quem está prestes
 * a vencer.
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KeyRound } from "lucide-react";
import { diasParaVencer, type StatusAddon } from "@shared/addon-jurisia";

const nf = new Intl.NumberFormat("pt-BR");

const SELO: Record<StatusAddon, { label: string; cls: string }> = {
  ativo: { label: "ativo", cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
  suspenso: { label: "suspenso", cls: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
  cancelado: { label: "cancelado", cls: "text-slate-500 bg-slate-500/10 border-slate-500/20" },
};

const dataBR = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : "não vence";

export default function JurisIaAssinantes() {
  const { data, isLoading } = trpc.admin.listarAddons.useQuery({ produto: "jurisia" });
  const linhas = data ?? [];
  const agora = new Date();

  const ativos = linhas.filter((l) => l.status === "ativo");
  const receita = ativos.reduce((s, l) => s + l.precoCentavos, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-violet-600" />
          Contratos avulsos do JurisIA
        </CardTitle>
        <CardDescription>
          Liberação é na ficha do cliente (Clientes → Assinatura). Quem tem o módulo dentro do
          plano não aparece aqui.
          {ativos.length > 0 && (
            <>
              {" "}
              <strong>{ativos.length}</strong> ativo(s)
              {receita > 0 && (
                <>
                  {" · "}
                  <strong>
                    {(receita / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </strong>
                  /mês
                </>
              )}
              .
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : linhas.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum contrato avulso ainda.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Escritório</TableHead>
                <TableHead className="text-right">Mensagens/mês</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Contrato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => {
                const dias = diasParaVencer(
                  l.expiraEm ? new Date(l.expiraEm).toISOString() : null,
                  agora,
                );
                const selo = SELO[l.status as StatusAddon] ?? SELO.cancelado;
                return (
                  <TableRow key={l.escritorioId}>
                    <TableCell>
                      <p className="text-sm font-medium">{l.escritorioNome}</p>
                      {l.observacao && (
                        <p className="text-[11px] text-muted-foreground">{l.observacao}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {nf.format(l.limiteMensal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.precoCentavos > 0
                        ? (l.precoCentavos / 100).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                        : "cortesia"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {dataBR(l.expiraEm)}
                      {/* Vencimento perto é o que o dono precisa ver antes de o
                          cliente ligar dizendo que perdeu o acesso. */}
                      {dias !== null && dias <= 15 && (
                        <span className="ml-1.5 text-[11px] font-bold text-amber-600">{dias}d</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${selo.cls}`}
                      >
                        {selo.label}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
