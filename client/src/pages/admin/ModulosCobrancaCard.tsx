/**
 * Cobrança por módulo de UM escritório, dentro da ficha dele — a seção
 * "Por escritório: exceções e add-ons" do mockup aprovado da modularização.
 *
 * Mostra a fatura COMPOSTA (pacote + avulsos + atendentes adicionais −
 * desconto) lado a lado com o que o Asaas cobra hoje: divergência entre os
 * dois é exatamente o que o operador precisa enxergar antes de clicar em
 * "aplicar". O valor aplicado nasce no servidor — o preview daqui nunca
 * viaja pra cobrança.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Package, Pencil, Percent, Plus, Users, X } from "lucide-react";
import { toast } from "sonner";

const fmtBRL = (centavos: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);

const dataBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : null);

/** Input date devolve 'YYYY-MM-DD'; a validade vale até o fim daquele dia. */
const paraIso = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(`${v}T23:59:59.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const reaisParaCentavos = (v: string): number | null => {
  const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
};

export default function ModulosCobrancaCard({ escritorioId }: { escritorioId: number }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.admin.cobrancaDoEscritorio.useQuery({ escritorioId });
  const { data: catalogo } = trpc.admin.listarCatalogoModulos.useQuery();

  const [avulsoOpen, setAvulsoOpen] = useState(false);
  const [avulsoModulo, setAvulsoModulo] = useState("");
  const [avulsoPreco, setAvulsoPreco] = useState("");
  const [avulsoValidade, setAvulsoValidade] = useState("");
  const [avulsoObs, setAvulsoObs] = useState("");

  const [descontoOpen, setDescontoOpen] = useState(false);
  const [descontoTipo, setDescontoTipo] = useState<"percentual" | "fixo" | "nenhum">("nenhum");
  const [descontoValor, setDescontoValor] = useState("");
  const [descontoValidade, setDescontoValidade] = useState("");
  const [descontoObs, setDescontoObs] = useState("");

  const [aplicarOpen, setAplicarOpen] = useState(false);
  const [atualizarPendentes, setAtualizarPendentes] = useState(false);
  const [cancelandoModulo, setCancelandoModulo] = useState<{ modulo: string; nome: string; preco: number } | null>(null);

  const invalidar = () => utils.admin.cobrancaDoEscritorio.invalidate({ escritorioId });

  const salvarAvulso = trpc.admin.salvarModuloAvulso.useMutation({
    onSuccess: () => {
      invalidar();
      setAvulsoOpen(false);
      setCancelandoModulo(null);
      toast.success("Módulos avulsos atualizados");
    },
    onError: (err) => toast.error("Erro ao salvar módulo avulso", { description: err.message }),
  });

  const salvarDesconto = trpc.admin.salvarDescontoEscritorio.useMutation({
    onSuccess: () => {
      invalidar();
      setDescontoOpen(false);
      toast.success("Desconto atualizado");
    },
    onError: (err) => toast.error("Erro ao salvar desconto", { description: err.message }),
  });

  const aplicarValor = trpc.admin.aplicarValorAssinatura.useMutation({
    onSuccess: (res) => {
      invalidar();
      setAplicarOpen(false);
      toast.success(`Assinatura atualizada para ${fmtBRL(res.totalCentavos)}/mês`);
    },
    onError: (err) => toast.error("Erro ao aplicar na assinatura", { description: err.message }),
  });

  if (isLoading || !data) {
    return (
      <div className="border rounded-lg p-4">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { fatura, avulsos, assinatura } = data;
  const avulsosVigentes = avulsos.filter((a) => a.vigente);
  const jaCobertos = new Set([...fatura.modulosDoPlano, ...avulsosVigentes.map((a) => a.modulo)]);
  const opcoesAvulso = (catalogo ?? []).filter((m) => !jaCobertos.has(m.id));

  const valorAsaas = assinatura?.valorCentavos ?? null;
  const divergente = valorAsaas != null && valorAsaas !== fatura.totalCentavos;

  const abrirDialogAvulso = () => {
    setAvulsoModulo("");
    setAvulsoPreco("");
    setAvulsoValidade("");
    setAvulsoObs("");
    setAvulsoOpen(true);
  };

  const abrirDialogDesconto = () => {
    if (fatura.desconto) {
      setDescontoTipo(fatura.desconto.tipo);
      setDescontoValor(
        fatura.desconto.tipo === "percentual"
          ? String(fatura.desconto.valor)
          : (fatura.desconto.valor / 100).toFixed(2).replace(".", ","),
      );
      setDescontoValidade(fatura.desconto.validoAte ? fatura.desconto.validoAte.slice(0, 10) : "");
      setDescontoObs(fatura.desconto.observacao ?? "");
    } else {
      setDescontoTipo("nenhum");
      setDescontoValor("");
      setDescontoValidade("");
      setDescontoObs("");
    }
    setDescontoOpen(true);
  };

  const submeterAvulso = () => {
    if (!avulsoModulo) { toast.error("Escolha o módulo"); return; }
    const preco = reaisParaCentavos(avulsoPreco);
    if (preco == null) { toast.error("Preço inválido"); return; }
    salvarAvulso.mutate({
      escritorioId,
      modulo: avulsoModulo,
      status: "ativo",
      precoCentavos: preco,
      expiraEm: paraIso(avulsoValidade),
      observacao: avulsoObs.trim() || null,
    });
  };

  const submeterDesconto = () => {
    if (descontoTipo === "nenhum") {
      salvarDesconto.mutate({ escritorioId, tipo: null, valor: 0, validoAte: null, observacao: null });
      return;
    }
    const valor = descontoTipo === "percentual"
      ? parseInt(descontoValor, 10)
      : reaisParaCentavos(descontoValor);
    if (valor == null || Number.isNaN(valor) || valor <= 0) { toast.error("Valor de desconto inválido"); return; }
    if (descontoTipo === "percentual" && valor > 100) { toast.error("Percentual máximo é 100%"); return; }
    salvarDesconto.mutate({
      escritorioId,
      tipo: descontoTipo,
      valor,
      validoAte: paraIso(descontoValidade),
      observacao: descontoObs.trim() || null,
    });
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Package className="h-4 w-4 text-muted-foreground" /> Módulos &amp; cobrança
          {fatura.planoNome && <Badge variant="outline" className="text-[10px]">{fatura.planoNome}</Badge>}
          {fatura.cortesia && (
            <Badge variant="outline" className="text-[10px] border-success/30 text-success-fg">cortesia</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={abrirDialogAvulso}>
            <Plus className="h-3 w-3 mr-1" /> Módulo avulso
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={abrirDialogDesconto}>
            <Percent className="h-3 w-3 mr-1" /> Desconto
          </Button>
        </div>
      </div>

      {!fatura.planoSlug ? (
        <p className="text-xs text-muted-foreground">Sem plano ativo — a fatura por módulo só é calculada com assinatura.</p>
      ) : (
        <>
          {/* Composição da fatura */}
          <div className="rounded-lg bg-muted/40 p-3 space-y-1">
            {fatura.itens.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{item.rotulo}</span>
                <span className="tabular-nums">{fmtBRL(item.centavos)}</span>
              </div>
            ))}
            {fatura.descontoCentavos > 0 && fatura.desconto && (
              <div className="flex items-center justify-between text-xs text-warning-fg">
                <span>
                  Desconto{" "}
                  {fatura.desconto.tipo === "percentual" ? `${fatura.desconto.valor}%` : "fixo"}
                  {fatura.desconto.validoAte ? ` (até ${dataBR(fatura.desconto.validoAte)})` : ""}
                </span>
                <span className="tabular-nums">− {fmtBRL(fatura.descontoCentavos)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm font-bold border-t pt-1.5 mt-1.5">
              <span>Total mensal</span>
              <span className="tabular-nums">{fmtBRL(fatura.totalCentavos)}</span>
            </div>
            {fatura.descontoExpirado && (
              <p className="text-[11px] text-warning-fg">
                O desconto deste escritório venceu{fatura.desconto?.validoAte ? ` em ${dataBR(fatura.desconto.validoAte)}` : ""} e deixou de ser aplicado.
              </p>
            )}
          </div>

          {/* Asaas: cobrado hoje × calculado */}
          {fatura.cortesia ? (
            <p className="text-[11px] text-muted-foreground">Assinatura de cortesia — nada é cobrado.</p>
          ) : !assinatura ? (
            <p className="text-[11px] text-muted-foreground">
              Sem assinatura Asaas vinculada — use "Ativar assinatura paga" (bloco Assinatura acima)
              pra fechar o valor negociado.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
              <span className={divergente ? "text-warning-fg font-medium" : "text-muted-foreground"}>
                Cobrado hoje no Asaas: {valorAsaas != null ? fmtBRL(valorAsaas) : "—"}
                {divergente && " · difere do calculado"}
              </span>
              <Button
                size="sm"
                variant={divergente ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => { setAtualizarPendentes(false); setAplicarOpen(true); }}
              >
                Aplicar {fmtBRL(fatura.totalCentavos)} na assinatura
              </Button>
            </div>
          )}

          {/* Atendentes */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {fatura.atendentesInclusos == null ? (
              <span>{fatura.atendentesAtivos} colaboradores ativos · plano sem cobrança por assento</span>
            ) : (
              <span>
                {fatura.atendentesAtivos} de {fatura.atendentesInclusos} atendentes inclusos
                {fatura.atendentesAdicionais > 0 &&
                  ` · ${fatura.atendentesAdicionais} adicional${fatura.atendentesAdicionais > 1 ? "is" : ""} a ${fmtBRL(fatura.precoAtendenteAdicionalCentavos)}/mês`}
              </span>
            )}
          </div>
        </>
      )}

      {/* Módulos avulsos */}
      {avulsos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {avulsos.map((a) => (
            <Badge
              key={a.modulo}
              variant="outline"
              className={`text-[10px] gap-1 ${
                a.vigente
                  ? "border-success/30 text-success-fg bg-success/10"
                  : "text-muted-foreground"
              }`}
            >
              {a.nome} · {fmtBRL(a.precoCentavos)}/mês
              {a.expiraEm && ` · até ${dataBR(a.expiraEm)}`}
              {!a.vigente && ` (${a.status})`}
              {a.vigente && (
                <button
                  type="button"
                  className="ml-0.5 hover:text-danger-fg"
                  onClick={() => setCancelandoModulo({ modulo: a.modulo, nome: a.nome, preco: a.precoCentavos })}
                  aria-label={`Cancelar ${a.nome}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {/* Dialog: conceder módulo avulso */}
      <Dialog open={avulsoOpen} onOpenChange={setAvulsoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Liberar módulo avulso</DialogTitle>
            <DialogDescription>
              Fora do pacote do plano, cobrado à parte. O preço fica congelado nesta concessão.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Módulo</Label>
              <Select
                value={avulsoModulo}
                onValueChange={(v) => {
                  setAvulsoModulo(v);
                  const doCatalogo = (catalogo ?? []).find((m) => m.id === v);
                  if (doCatalogo && doCatalogo.precoMensalCentavos > 0) {
                    setAvulsoPreco((doCatalogo.precoMensalCentavos / 100).toFixed(2).replace(".", ","));
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Escolha o módulo" /></SelectTrigger>
                <SelectContent>
                  {opcoesAvulso.length === 0 ? (
                    <SelectItem value="__vazio" disabled>Plano já cobre todos os módulos</SelectItem>
                  ) : (
                    opcoesAvulso.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.nome}{m.precoMensalCentavos > 0 ? ` — ${fmtBRL(m.precoMensalCentavos)}/mês` : " — sem preço no catálogo"}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Preço mensal (R$)</Label>
                <Input value={avulsoPreco} onChange={(e) => setAvulsoPreco(e.target.value)} inputMode="decimal" placeholder="50,00" />
              </div>
              <div className="space-y-1.5">
                <Label>Válido até (opcional)</Label>
                <Input type="date" value={avulsoValidade} onChange={(e) => setAvulsoValidade(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Input value={avulsoObs} onChange={(e) => setAvulsoObs(e.target.value)} maxLength={500} placeholder="Negociado com o cliente em..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAvulsoOpen(false)}>Cancelar</Button>
            <Button onClick={submeterAvulso} disabled={salvarAvulso.isPending || !avulsoModulo}>
              {salvarAvulso.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Liberar módulo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: desconto do escritório */}
      <Dialog open={descontoOpen} onOpenChange={setDescontoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Desconto do escritório</DialogTitle>
            <DialogDescription>
              Aplica na fatura inteira: pacote + avulsos + atendentes adicionais.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={descontoTipo} onValueChange={(v) => setDescontoTipo(v as typeof descontoTipo)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Sem desconto</SelectItem>
                  <SelectItem value="percentual">Percentual (%)</SelectItem>
                  <SelectItem value="fixo">Valor fixo (R$)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {descontoTipo !== "nenhum" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{descontoTipo === "percentual" ? "Percentual (%)" : "Valor (R$)"}</Label>
                    <Input
                      value={descontoValor}
                      onChange={(e) => setDescontoValor(e.target.value)}
                      inputMode="decimal"
                      placeholder={descontoTipo === "percentual" ? "20" : "100,00"}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Válido até (opcional)</Label>
                    <Input type="date" value={descontoValidade} onChange={(e) => setDescontoValidade(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Observação (opcional)</Label>
                  <Input value={descontoObs} onChange={(e) => setDescontoObs(e.target.value)} maxLength={255} placeholder="Motivo do desconto" />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDescontoOpen(false)}>Cancelar</Button>
            <Button onClick={submeterDesconto} disabled={salvarDesconto.isPending}>
              {salvarDesconto.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar: aplicar valor na assinatura Asaas */}
      <AlertDialog open={aplicarOpen} onOpenChange={setAplicarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar {fmtBRL(fatura.totalCentavos)}/mês na assinatura?</AlertDialogTitle>
            <AlertDialogDescription>
              O valor da assinatura Asaas deste escritório passa a ser o total calculado
              (recalculado no servidor no momento de aplicar). As próximas cobranças saem com o novo valor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <div>
              <Label>Atualizar cobranças pendentes</Label>
              <p className="text-xs text-muted-foreground">Também muda faturas já geradas e ainda não pagas.</p>
            </div>
            <Switch checked={atualizarPendentes} onCheckedChange={setAtualizarPendentes} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={aplicarValor.isPending}
              onClick={() => aplicarValor.mutate({ escritorioId, atualizarPendentes })}
            >
              {aplicarValor.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar: cancelar módulo avulso */}
      <AlertDialog open={cancelandoModulo != null} onOpenChange={(o) => { if (!o) setCancelandoModulo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar "{cancelandoModulo?.nome}" deste escritório?</AlertDialogTitle>
            <AlertDialogDescription>
              O módulo sai do menu e o servidor volta a recusar as chamadas dele em até 30 segundos.
              A linha da fatura some — lembre de aplicar o novo valor na assinatura.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={salvarAvulso.isPending}
              onClick={() => {
                if (!cancelandoModulo) return;
                salvarAvulso.mutate({
                  escritorioId,
                  modulo: cancelandoModulo.modulo,
                  status: "cancelado",
                  precoCentavos: cancelandoModulo.preco,
                  expiraEm: null,
                  observacao: null,
                });
              }}
            >
              Cancelar módulo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
