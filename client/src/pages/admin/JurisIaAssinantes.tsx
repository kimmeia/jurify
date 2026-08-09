/**
 * Quem tem o JurisIA liberado — e o botão que libera.
 *
 * O módulo é vendido à parte, e até aqui a única alavanca era a cota do plano,
 * que atinge todos os clientes daquela faixa de uma vez. Sem esta tela não
 * existe cortesia, piloto, nem contrato avulso: existe "muda o plano de todo
 * mundo ou não vende".
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KeyRound, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { diasParaVencer, type StatusAddon } from "@shared/addon-jurisia";

const nf = new Intl.NumberFormat("pt-BR");

const SELO: Record<StatusAddon, { label: string; cls: string }> = {
  ativo: { label: "ativo", cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
  suspenso: { label: "suspenso", cls: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
  cancelado: { label: "cancelado", cls: "text-slate-500 bg-slate-500/10 border-slate-500/20" },
};

const dataCurta = (d: Date | string | null) => {
  if (!d) return "—";
  const iso = typeof d === "string" ? d : d.toISOString();
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : "—";
};

/** `expiraEm` do formulário é 'YYYY-MM-DD'; o banco guarda instante. */
const paraIso = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(`${v}T23:59:59.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

interface Rascunho {
  escritorioId: string;
  status: StatusAddon;
  limiteMensal: string;
  expiraEm: string;
  precoCentavos: string;
  observacao: string;
}

const VAZIO: Rascunho = {
  escritorioId: "",
  status: "ativo",
  limiteMensal: "900",
  expiraEm: "",
  precoCentavos: "",
  observacao: "",
};

export default function JurisIaAssinantes() {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<Rascunho>(VAZIO);
  const [editando, setEditando] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.admin.listarAddons.useQuery({ produto: "jurisia" });

  const salvar = trpc.admin.salvarAddon.useMutation({
    onSuccess: () => {
      utils.admin.listarAddons.invalidate();
      setAberto(false);
      toast.success("JurisIA liberado", {
        description: "O escritório já vê o módulo no menu, sem precisar sair e entrar.",
      });
    },
    onError: (e) => toast.error("Não deu pra salvar", { description: e.message }),
  });

  const abrirNovo = () => {
    setRascunho(VAZIO);
    setEditando(false);
    setAberto(true);
  };

  const abrirEdicao = (linha: NonNullable<typeof data>[number]) => {
    setRascunho({
      escritorioId: String(linha.escritorioId),
      status: linha.status as StatusAddon,
      limiteMensal: String(linha.limiteMensal),
      expiraEm: linha.expiraEm ? new Date(linha.expiraEm).toISOString().slice(0, 10) : "",
      precoCentavos: linha.precoCentavos ? String(linha.precoCentavos / 100) : "",
      observacao: linha.observacao ?? "",
    });
    setEditando(true);
    setAberto(true);
  };

  const confirmar = () => {
    const escritorioId = parseInt(rascunho.escritorioId, 10);
    if (!Number.isInteger(escritorioId) || escritorioId <= 0) {
      toast.error("Informe o ID do escritório.");
      return;
    }
    const limite = parseInt(rascunho.limiteMensal, 10);
    if (!Number.isInteger(limite) || limite < 0) {
      toast.error("Limite mensal inválido.");
      return;
    }
    const reais = parseFloat(rascunho.precoCentavos.replace(",", "."));
    salvar.mutate({
      escritorioId,
      produto: "jurisia",
      status: rascunho.status,
      limiteMensal: limite,
      inicioEm: null,
      expiraEm: paraIso(rascunho.expiraEm),
      precoCentavos: Number.isFinite(reais) ? Math.round(reais * 100) : 0,
      observacao: rascunho.observacao.trim() || null,
    });
  };

  const linhas = data ?? [];
  const agora = new Date();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-violet-600" />
            Escritórios com JurisIA
          </CardTitle>
          <CardDescription>
            Contratado à parte. Liberar aqui não mexe no plano — serve pra contrato avulso,
            cortesia e piloto.
          </CardDescription>
        </div>
        <Button size="sm" onClick={abrirNovo} className="shrink-0 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Liberar escritório
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : linhas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum escritório com o add-on. Quem tem plano com JurisIA incluso continua vendo o
            módulo normalmente — esta lista é só dos contratos avulsos.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Escritório</TableHead>
                <TableHead className="text-right">Mensagens/mês</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ação</TableHead>
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
                      <p className="text-[11px] text-muted-foreground">
                        #{l.escritorioId}
                        {l.observacao ? ` · ${l.observacao}` : ""}
                      </p>
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
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{dataCurta(l.expiraEm)}</span>
                      {/* Vencimento perto é o que o operador precisa ver antes
                          do cliente ligar reclamando que perdeu o acesso. */}
                      {dias !== null && dias <= 15 && (
                        <span className="ml-1.5 text-[11px] font-bold text-amber-600">
                          {dias}d
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${selo.cls}`}
                      >
                        {selo.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => abrirEdicao(l)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar contrato" : "Liberar JurisIA"}</DialogTitle>
            <DialogDescription>
              O escritório passa a ver o módulo no menu na próxima navegação.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="esc">ID do escritório</Label>
              <Input
                id="esc"
                inputMode="numeric"
                value={rascunho.escritorioId}
                disabled={editando}
                onChange={(e) => setRascunho({ ...rascunho, escritorioId: e.target.value })}
                placeholder="ex.: 42"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lim">Mensagens/mês</Label>
                <Input
                  id="lim"
                  inputMode="numeric"
                  value={rascunho.limiteMensal}
                  onChange={(e) => setRascunho({ ...rascunho, limiteMensal: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="preco">Preço mensal (R$)</Label>
                <Input
                  id="preco"
                  inputMode="decimal"
                  value={rascunho.precoCentavos}
                  onChange={(e) => setRascunho({ ...rascunho, precoCentavos: e.target.value })}
                  placeholder="0 = cortesia"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="venc">Vence em</Label>
                <Input
                  id="venc"
                  type="date"
                  value={rascunho.expiraEm}
                  onChange={(e) => setRascunho({ ...rascunho, expiraEm: e.target.value })}
                />
                <p className="text-[10.5px] text-muted-foreground">Vazio = não vence.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={rascunho.status}
                  onValueChange={(v) => setRascunho({ ...rascunho, status: v as StatusAddon })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="suspenso">Suspenso</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="obs">Observação</Label>
              <Input
                id="obs"
                value={rascunho.observacao}
                onChange={(e) => setRascunho({ ...rascunho, observacao: e.target.value })}
                placeholder="ex.: piloto 30 dias, fechado por contrato"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
