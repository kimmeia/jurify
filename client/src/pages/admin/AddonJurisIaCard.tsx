/**
 * O JurisIA de um cliente, dentro da ficha dele.
 *
 * Mora aqui e não numa lista solta porque liberar módulo pago é conversa sobre
 * UM cliente: você já está olhando o plano, a cortesia e o histórico dele. A
 * primeira versão pedia o ID do escritório digitado à mão — o que é pedir pro
 * operador procurar um número que a tela já tem na frente.
 *
 * Mostra o acesso RESOLVIDO, não só o add-on: quando o plano do cliente já
 * inclui o módulo, criar um avulso é redundante, e a tela precisa dizer isso
 * antes de alguém cobrar duas vezes pela mesma coisa.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Gavel, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { diasParaVencer, type StatusAddon } from "@shared/addon-jurisia";

const nf = new Intl.NumberFormat("pt-BR");

const SELO: Record<StatusAddon, { label: string; cls: string }> = {
  ativo: { label: "ativo", cls: "border-emerald-500/40 text-emerald-700 bg-emerald-500/10" },
  suspenso: { label: "suspenso", cls: "border-amber-500/40 text-amber-700 bg-amber-500/10" },
  cancelado: { label: "cancelado", cls: "border-slate-300 text-slate-600 bg-slate-500/10" },
};

const dataBR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

/** O input date devolve 'YYYY-MM-DD'; o contrato vale até o fim daquele dia. */
const paraIso = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(`${v}T23:59:59.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export default function AddonJurisIaCard({ escritorioId }: { escritorioId: number }) {
  const [editando, setEditando] = useState(false);
  const [status, setStatus] = useState<StatusAddon>("ativo");
  const [limite, setLimite] = useState("900");
  const [expira, setExpira] = useState("");
  const [preco, setPreco] = useState("");
  const [obs, setObs] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.admin.addonDoEscritorio.useQuery({
    escritorioId,
    produto: "jurisia",
  });

  // Só preenche o formulário na transição pra edição — sem isso, o refetch
  // sobrescreve o que o operador está digitando.
  useEffect(() => {
    if (!editando || !data?.addon) return;
    setStatus(data.addon.status);
    setLimite(String(data.addon.limiteMensal));
    setExpira(data.addon.expiraEm ? data.addon.expiraEm.slice(0, 10) : "");
    setPreco(data.addon.precoCentavos ? String(data.addon.precoCentavos / 100) : "");
    setObs(data.addon.observacao ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando]);

  const salvar = trpc.admin.salvarAddon.useMutation({
    onSuccess: () => {
      utils.admin.addonDoEscritorio.invalidate({ escritorioId, produto: "jurisia" });
      utils.admin.listarAddons.invalidate();
      setEditando(false);
      toast.success("JurisIA atualizado para este cliente");
    },
    onError: (e) => toast.error("Não deu pra salvar", { description: e.message }),
  });

  const confirmar = () => {
    const lim = parseInt(limite, 10);
    if (!Number.isInteger(lim) || lim < 0) {
      toast.error("Limite mensal inválido.");
      return;
    }
    const reais = parseFloat(preco.replace(",", "."));
    salvar.mutate({
      escritorioId,
      produto: "jurisia",
      status,
      limiteMensal: lim,
      inicioEm: null,
      expiraEm: paraIso(expira),
      precoCentavos: Number.isFinite(reais) ? Math.round(reais * 100) : 0,
      observacao: obs.trim() || null,
    });
  };

  if (isLoading) return <Skeleton className="h-28 w-full rounded-lg" />;

  const addon = data?.addon ?? null;
  const acesso = data?.acesso;
  const dias = diasParaVencer(addon?.expiraEm ?? null, new Date());
  const soPeloPlano = acesso?.origem === "plano";

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Gavel className="h-4 w-4 text-violet-600" /> JurisIA
          <span className="text-[11px] font-normal text-muted-foreground">contratado à parte</span>
        </div>
        {acesso?.liberado ? (
          <Badge className="text-[10px] bg-violet-600 hover:bg-violet-600">
            liberado · {nf.format(acesso.limite)}/mês
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">não liberado</Badge>
        )}
      </div>

      {!editando ? (
        <>
          {soPeloPlano && (
            // Sem este aviso, alguém cria um avulso de R$ X pra um cliente que
            // já paga o módulo dentro do plano.
            <p className="text-[12px] text-muted-foreground mb-3">
              O plano <strong className="capitalize">{data?.planSlug}</strong> deste cliente já
              inclui o JurisIA. Um contrato avulso aqui só faria sentido pra dar um limite maior.
            </p>
          )}

          {addon ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Mensagens/mês</p>
                <p className="font-semibold mt-0.5 tabular-nums">{nf.format(addon.limiteMensal)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Preço</p>
                <p className="font-semibold mt-0.5 tabular-nums">
                  {addon.precoCentavos > 0
                    ? (addon.precoCentavos / 100).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })
                    : "cortesia"}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Vence</p>
                <p className="font-semibold mt-0.5">
                  {dataBR(addon.expiraEm)}
                  {dias !== null && dias <= 15 && (
                    <span className="ml-1.5 text-[11px] font-bold text-amber-600">{dias}d</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Contrato</p>
                <Badge variant="outline" className={`text-[10px] mt-0.5 ${SELO[addon.status].cls}`}>
                  {SELO[addon.status].label}
                </Badge>
              </div>
              {addon.observacao && (
                <p className="col-span-2 sm:col-span-4 text-[12px] text-muted-foreground">
                  {addon.observacao}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {soPeloPlano
                ? "Sem contrato avulso — o acesso vem do plano."
                : "Este cliente não contratou o JurisIA."}
            </p>
          )}

          <div className="flex items-center gap-2 mt-4 pt-3 border-t">
            <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
              {addon ? (
                <><Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar contrato</>
              ) : (
                <><Plus className="h-3.5 w-3.5 mr-1.5" /> Liberar JurisIA</>
              )}
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="jl">Mensagens/mês</Label>
              <Input id="jl" inputMode="numeric" value={limite} onChange={(e) => setLimite(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jp">Preço mensal (R$)</Label>
              <Input
                id="jp"
                inputMode="decimal"
                value={preco}
                onChange={(e) => setPreco(e.target.value)}
                placeholder="vazio = cortesia"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="jv">Vence em</Label>
              <Input id="jv" type="date" value={expira} onChange={(e) => setExpira(e.target.value)} />
              <p className="text-[10.5px] text-muted-foreground">Vazio = não vence.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Contrato</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusAddon)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="suspenso">Suspenso</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="jo">Observação</Label>
            <Input
              id="jo"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="ex.: piloto 30 dias, fechado por contrato"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={confirmar} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>
              <X className="h-3.5 w-3.5 mr-1.5" /> Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
