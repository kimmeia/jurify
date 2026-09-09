/**
 * Tab Financeiro de Configurações — regra de comissão e categorias.
 * Renderizada dentro de `<TabsContent value="financeiro">` em Configuracoes.tsx.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DollarSign,
  Loader2,
  Plus,
  Save,
  Tag,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { AgendamentoComissaoCard } from "./agendamento-comissao";

export function FinanceiroTab({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="space-y-4">
      <RegraComissaoCard canEdit={canEdit} />
      <ComissaoGestaoCard canEdit={canEdit} />
      <AgendamentoComissaoCard />
      <CategoriasCobrancaCard canEdit={canEdit} />
      <CategoriasDespesaCard canEdit={canEdit} />
    </div>
  );
}

// ─── Comissão de gestão ──────────────────────────────────────────────────────

/**
 * Quem ganha percentual sobre o recebido de TODOS os clientes fechados a
 * partir de uma data, sem depender de ter vendido. Fica ao lado da regra de
 * venda de propósito: são duas comissões que incidem sobre a mesma cobrança,
 * e ver as duas juntas evita a leitura de que uma substitui a outra.
 */
function ComissaoGestaoCard({ canEdit }: { canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data: gestores, isLoading } = trpc.comissoes.listarGestao.useQuery(undefined, {
    retry: false,
  });
  const { data: equipeData } = trpc.configuracoes.listarColaboradores.useQuery();
  const colaboradores =
    equipeData && "colaboradores" in equipeData ? equipeData.colaboradores : [];

  const [novoColaborador, setNovoColaborador] = useState("");
  const [novaAliquota, setNovaAliquota] = useState("");
  const [novoCorte, setNovoCorte] = useState("");

  const salvar = trpc.comissoes.salvarGestao.useMutation({
    onSuccess: () => {
      utils.comissoes.listarGestao.invalidate();
      setNovoColaborador("");
      setNovaAliquota("");
      setNovoCorte("");
      toast.success("Comissão de gestão salva");
    },
    onError: (err) => toast.error("Erro ao salvar", { description: err.message }),
  });

  const jaConfigurados = new Set((gestores ?? []).map((g) => g.colaboradorId));
  const disponiveis = colaboradores.filter((c) => !jaConfigurados.has(c.id));

  function adicionar() {
    const aliq = parseFloat(novaAliquota.replace(",", "."));
    if (!novoColaborador) {
      toast.error("Escolha o colaborador");
      return;
    }
    if (!Number.isFinite(aliq) || aliq < 0 || aliq > 100) {
      toast.error("Percentual inválido", { description: "Use um número entre 0 e 100." });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(novoCorte)) {
      toast.error("Informe a data de corte");
      return;
    }
    salvar.mutate({
      colaboradorId: Number(novoColaborador),
      aliquotaPercent: aliq,
      dataCorte: novoCorte,
      ativo: true,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4" />
          Comissão de gestão
        </CardTitle>
        <CardDescription>
          Quem está aqui ganha um percentual sobre <strong>tudo que for recebido</strong> de
          clientes que fecharam contrato a partir da data de corte, independente de quem
          vendeu. A comissão de venda do atendente continua valendo: as duas incidem sobre a
          mesma cobrança, cada uma com o seu controle de duplicidade.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (gestores ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum gestor configurado. Enquanto estiver vazio, a aba Gestão em
            Financeiro → Comissões fica sem opções.
          </p>
        ) : (
          <div className="space-y-2">
            {(gestores ?? []).map((g) => (
              <LinhaGestor key={g.colaboradorId} gestor={g} canEdit={canEdit} />
            ))}
          </div>
        )}

        {canEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end border-t pt-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Colaborador</Label>
              <Select value={novoColaborador} onValueChange={setNovoColaborador}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {disponiveis.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Todos já configurados.
                    </div>
                  ) : (
                    disponiveis.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.userName ?? c.userEmail ?? `#${c.id}`} ({c.cargo})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Percentual (%)</Label>
              <Input
                value={novaAliquota}
                onChange={(e) => setNovaAliquota(e.target.value)}
                placeholder="2,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Vale a partir de</Label>
              <Input
                type="date"
                value={novoCorte}
                onChange={(e) => setNovoCorte(e.target.value)}
              />
            </div>
            <div className="sm:col-span-4">
              <Button size="sm" onClick={adicionar} disabled={salvar.isPending}>
                {salvar.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5 mr-2" />
                )}
                Adicionar gestor
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinhaGestor({
  gestor,
  canEdit,
}: {
  gestor: {
    colaboradorId: number;
    nome: string | null;
    cargo: string;
    aliquotaPercent: number;
    dataCorte: string;
    ativo: boolean;
    modo: Modo;
    baseFaixa: BaseFaixa;
    valorMinimo: number;
    faixas: Array<{ limiteAte: number | null; aliquotaPercent: number }>;
  };
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [aliquota, setAliquota] = useState(String(gestor.aliquotaPercent));
  const [corte, setCorte] = useState(gestor.dataCorte);
  const [modo, setModo] = useState<Modo>(gestor.modo);
  const [baseFaixa, setBaseFaixa] = useState<BaseFaixa>(gestor.baseFaixa);
  const [valorMinimo, setValorMinimo] = useState(String(gestor.valorMinimo));
  const [faixas, setFaixas] = useState<FaixaUI[]>(
    gestor.faixas.map((f) => ({
      limiteAteText: f.limiteAte === null ? "" : String(f.limiteAte),
      aliquotaText: String(f.aliquotaPercent),
    })),
  );

  useEffect(() => {
    setAliquota(String(gestor.aliquotaPercent));
    setCorte(gestor.dataCorte);
    setModo(gestor.modo);
    setBaseFaixa(gestor.baseFaixa);
    setValorMinimo(String(gestor.valorMinimo));
    setFaixas(
      gestor.faixas.map((f) => ({
        limiteAteText: f.limiteAte === null ? "" : String(f.limiteAte),
        aliquotaText: String(f.aliquotaPercent),
      })),
    );
  }, [gestor]);

  const salvar = trpc.comissoes.salvarGestao.useMutation({
    onSuccess: () => {
      utils.comissoes.listarGestao.invalidate();
      toast.success("Comissão de gestão atualizada");
    },
    onError: (err) => toast.error("Erro ao salvar", { description: err.message }),
  });

  function aplicar(ativo: boolean) {
    const aliq = parseFloat(aliquota.replace(",", "."));
    if (!Number.isFinite(aliq) || aliq < 0 || aliq > 100) {
      toast.error("Percentual inválido", { description: "Use um número entre 0 e 100." });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(corte)) {
      toast.error("Data de corte inválida");
      return;
    }
    const minimo = parseFloat(valorMinimo.replace(",", ".")) || 0;
    if (minimo < 0) {
      toast.error("Valor mínimo inválido");
      return;
    }

    const faixasParsed: Array<{ limiteAte: number | null; aliquotaPercent: number }> = [];
    if (modo === "faixas") {
      if (faixas.length === 0) {
        toast.error("Adicione pelo menos uma faixa", {
          description: "Modo por faixas exige cadastrar a tabela.",
        });
        return;
      }
      for (let i = 0; i < faixas.length; i++) {
        const f = faixas[i];
        const pct = parseFloat(f.aliquotaText.replace(",", "."));
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          toast.error(`Faixa ${i + 1}: percentual inválido`);
          return;
        }
        const semTeto = f.limiteAteText.trim() === "";
        if (semTeto && i !== faixas.length - 1) {
          toast.error(`Faixa ${i + 1}: só a última pode ficar sem teto`);
          return;
        }
        const limite = semTeto ? null : parseFloat(f.limiteAteText.replace(",", "."));
        if (limite !== null && (!Number.isFinite(limite) || limite < 0)) {
          toast.error(`Faixa ${i + 1}: teto inválido`);
          return;
        }
        faixasParsed.push({ limiteAte: limite, aliquotaPercent: pct });
      }
    }

    salvar.mutate({
      colaboradorId: gestor.colaboradorId,
      aliquotaPercent: aliq,
      dataCorte: corte,
      ativo,
      modo,
      baseFaixa,
      valorMinimo: minimo,
      faixas: faixasParsed,
    });
  }

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
        <div className="sm:col-span-2">
          <p className="text-sm font-medium">{gestor.nome ?? "—"}</p>
          <p className="text-[11px] text-muted-foreground">{gestor.cargo}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Cálculo</Label>
          <Select value={modo} onValueChange={(v) => setModo(v as Modo)} disabled={!canEdit}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">Percentual fixo</SelectItem>
              <SelectItem value="faixas">Faixas progressivas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Vale a partir de</Label>
          <Input
            type="date"
            value={corte}
            onChange={(e) => setCorte(e.target.value)}
            disabled={!canEdit}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={gestor.ativo}
            onCheckedChange={(v) => aplicar(v)}
            disabled={!canEdit || salvar.isPending}
          />
          <span className="text-[11px] text-muted-foreground">
            {gestor.ativo ? "Ativo" : "Desligado"}
          </span>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-8"
              onClick={() => aplicar(gestor.ativo)}
              disabled={salvar.isPending}
            >
              <Save className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {modo === "flat" ? (
          <div className="space-y-1">
            <Label className="text-[11px]">Percentual (%)</Label>
            <Input
              value={aliquota}
              onChange={(e) => setAliquota(e.target.value)}
              disabled={!canEdit}
              className="h-8 text-xs"
            />
          </div>
        ) : (
          <div className="space-y-1">
            <Label className="text-[11px]">A faixa é escolhida pelo…</Label>
            <Select
              value={baseFaixa}
              onValueChange={(v) => setBaseFaixa(v as BaseFaixa)}
              disabled={!canEdit}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="comissionavel">Recebido comissionável</SelectItem>
                <SelectItem value="bruto">Recebido bruto</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-[11px]">Valor mínimo da cobrança (R$)</Label>
          <Input
            value={valorMinimo}
            onChange={(e) => setValorMinimo(e.target.value)}
            disabled={!canEdit}
            className="h-8 text-xs"
            placeholder="0,00"
          />
        </div>
      </div>

      {modo === "faixas" && (
        <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
          <p className="text-[11px] text-muted-foreground">
            A faixa cujo teto cobre o total recebido define a alíquota aplicada sobre{" "}
            <strong>toda</strong> a base — é cumulativo, igual ao da comissão de venda.
            Deixe o teto da última em branco para "sem teto".
          </p>
          {faixas.map((f, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-[10px]">Até (R$)</Label>
                <Input
                  value={f.limiteAteText}
                  onChange={(e) =>
                    setFaixas(faixas.map((x, j) =>
                      j === i ? { ...x, limiteAteText: e.target.value } : x))
                  }
                  disabled={!canEdit}
                  className="h-8 text-xs"
                  placeholder={i === faixas.length - 1 ? "sem teto" : "10000"}
                />
              </div>
              <div className="w-24 space-y-1">
                <Label className="text-[10px]">Alíquota (%)</Label>
                <Input
                  value={f.aliquotaText}
                  onChange={(e) =>
                    setFaixas(faixas.map((x, j) =>
                      j === i ? { ...x, aliquotaText: e.target.value } : x))
                  }
                  disabled={!canEdit}
                  className="h-8 text-xs"
                />
              </div>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  onClick={() => setFaixas(faixas.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </div>
          ))}
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setFaixas([...faixas, { limiteAteText: "", aliquotaText: "" }])}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Adicionar faixa
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Regra global de comissão ────────────────────────────────────────────────

type Modo = "flat" | "faixas";
type BaseFaixa = "bruto" | "comissionavel";

interface FaixaUI {
  /** Vazio = "sem teto" (NULL). */
  limiteAteText: string;
  aliquotaText: string;
}

function RegraComissaoCard({ canEdit }: { canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data: regra, isLoading } = trpc.financeiro.obterRegraComissao.useQuery();
  const [modo, setModo] = useState<Modo>("flat");
  const [aliquota, setAliquota] = useState("");
  const [valorMinimo, setValorMinimo] = useState("");
  const [baseFaixa, setBaseFaixa] = useState<BaseFaixa>("comissionavel");
  const [diaVencimento, setDiaVencimento] = useState("5");
  const [faixas, setFaixas] = useState<FaixaUI[]>([]);

  useEffect(() => {
    if (regra) {
      setModo((regra.modo ?? "flat") as Modo);
      setAliquota(String(regra.aliquotaPercent ?? "0"));
      setValorMinimo(String(regra.valorMinimoCobranca ?? "0"));
      setBaseFaixa((regra.baseFaixa ?? "comissionavel") as BaseFaixa);
      setDiaVencimento(String((regra as any).diaVencimentoDespesa ?? 5));
      setFaixas(
        (regra.faixas ?? []).map((f) => ({
          limiteAteText: f.limiteAte === null ? "" : String(f.limiteAte),
          aliquotaText: String(f.aliquotaPercent),
        })),
      );
    }
  }, [regra]);

  const salvarMut = trpc.financeiro.salvarRegraComissao.useMutation({
    onSuccess: () => {
      toast.success("Regra de comissão salva");
      utils.financeiro.obterRegraComissao.invalidate();
    },
    onError: (err) => toast.error("Erro ao salvar", { description: err.message }),
  });

  function adicionarFaixa() {
    setFaixas([...faixas, { limiteAteText: "", aliquotaText: "" }]);
  }

  function removerFaixa(idx: number) {
    setFaixas(faixas.filter((_, i) => i !== idx));
  }

  function atualizarFaixa(idx: number, campo: keyof FaixaUI, valor: string) {
    setFaixas(faixas.map((f, i) => (i === idx ? { ...f, [campo]: valor } : f)));
  }

  function salvar() {
    const aliq = parseFloat(aliquota.replace(",", "."));
    const min = parseFloat(valorMinimo.replace(",", "."));
    const dia = parseInt(diaVencimento, 10);
    if (isNaN(aliq) || aliq < 0 || aliq > 100) {
      toast.error("Alíquota inválida", { description: "Use um valor entre 0 e 100." });
      return;
    }
    if (isNaN(min) || min < 0) {
      toast.error("Valor mínimo inválido");
      return;
    }
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      toast.error("Dia de vencimento inválido", {
        description: "Use um dia do mês entre 1 e 31.",
      });
      return;
    }

    let faixasParsed: Array<{ limiteAte: number | null; aliquotaPercent: number }> = [];
    if (modo === "faixas") {
      if (faixas.length === 0) {
        toast.error("Adicione pelo menos uma faixa", {
          description: "Modo 'faixas' exige cadastrar a tabela.",
        });
        return;
      }
      for (let i = 0; i < faixas.length; i++) {
        const f = faixas[i];
        const limTrim = f.limiteAteText.trim();
        const aliqFaixa = parseFloat(f.aliquotaText.replace(",", "."));
        if (isNaN(aliqFaixa) || aliqFaixa < 0 || aliqFaixa > 100) {
          toast.error(`Faixa ${i + 1}: alíquota inválida`);
          return;
        }
        let lim: number | null;
        if (limTrim === "") {
          lim = null;
          if (i !== faixas.length - 1) {
            toast.error(`Faixa ${i + 1}: só a última pode ser "sem teto"`);
            return;
          }
        } else {
          lim = parseFloat(limTrim.replace(",", "."));
          if (isNaN(lim) || lim < 0) {
            toast.error(`Faixa ${i + 1}: limite inválido`);
            return;
          }
        }
        faixasParsed.push({ limiteAte: lim, aliquotaPercent: aliqFaixa });
      }
      // Coerência crescente.
      let anterior = -1;
      for (let i = 0; i < faixasParsed.length; i++) {
        const lim = faixasParsed[i].limiteAte;
        if (lim !== null) {
          if (lim <= anterior) {
            toast.error("Limites devem ser crescentes", {
              description: `Faixa ${i + 1} (R$ ${lim}) não é maior que a anterior.`,
            });
            return;
          }
          anterior = lim;
        }
      }
    }

    salvarMut.mutate({
      modo,
      aliquotaPercent: aliq,
      valorMinimoCobranca: min,
      baseFaixa,
      diaVencimentoDespesa: dia,
      faixas: faixasParsed,
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="h-4 w-4" /> Comissão dos atendentes
        </CardTitle>
        <CardDescription>
          Use <strong>faixa única</strong> para uma alíquota global; ou{" "}
          <strong>faixas progressivas</strong> para incentivar quem fatura mais —
          a faixa atingida pelo total recebido define a alíquota aplicada
          sobre toda a base (modelo cumulativo).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Linha 1: modo + valor mínimo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Modo</Label>
                <Select
                  value={modo}
                  onValueChange={(v) => setModo(v as Modo)}
                  disabled={!canEdit}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">Faixa única (alíquota fixa)</SelectItem>
                    <SelectItem value="faixas">Faixas progressivas (cumulativo)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor mínimo da cobrança (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={!canEdit}
                  value={valorMinimo}
                  onChange={(e) => setValorMinimo(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Cobranças abaixo deste valor nunca contam, em qualquer modo.
                </p>
              </div>
            </div>

            {/* Dia de vencimento da despesa de comissão */}
            <div className="space-y-1.5 max-w-xs">
              <Label className="text-xs">
                Dia de vencimento da despesa (1-31)
              </Label>
              <Input
                type="number"
                min="1"
                max="31"
                step="1"
                disabled={!canEdit}
                value={diaVencimento}
                onChange={(e) => setDiaVencimento(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Após fechar comissão, a despesa automática de pagamento vence
                neste dia do mês seguinte. Se o mês não tem o dia escolhido
                (ex: 31 em fevereiro), usa o último dia disponível.
              </p>
            </div>

            {/* Modo flat: 1 alíquota */}
            {modo === "flat" && (
              <div className="space-y-1.5 max-w-xs">
                <Label className="text-xs">Alíquota (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  disabled={!canEdit}
                  value={aliquota}
                  onChange={(e) => setAliquota(e.target.value)}
                />
              </div>
            )}

            {/* Modo faixas: tabela editável + base */}
            {modo === "faixas" && (
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-1.5 max-w-md">
                  <Label className="text-xs">Base que define a faixa</Label>
                  <Select
                    value={baseFaixa}
                    onValueChange={(v) => setBaseFaixa(v as BaseFaixa)}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comissionavel">
                        Recebido comissionável (após filtros)
                      </SelectItem>
                      <SelectItem value="bruto">
                        Recebido bruto (tudo que entrou)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    A alíquota da faixa atingida sempre incide sobre o
                    comissionável; o que muda é como a faixa é classificada.
                  </p>
                </div>

                <div>
                  <Label className="text-xs mb-2 block">Faixas (cumulativo)</Label>
                  <div className="space-y-2">
                    {faixas.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">
                        Nenhuma faixa cadastrada. Clique em "Adicionar faixa" para
                        começar.
                      </p>
                    )}
                    {faixas.map((f, idx) => {
                      const isUltima = idx === faixas.length - 1;
                      const limAnterior =
                        idx > 0
                          ? faixas[idx - 1].limiteAteText.trim() === ""
                            ? "—"
                            : `R$ ${faixas[idx - 1].limiteAteText}`
                          : "R$ 0";
                      return (
                        <div
                          key={idx}
                          className="grid grid-cols-12 gap-2 items-center"
                        >
                          <div className="col-span-1 text-xs text-muted-foreground text-center">
                            {idx + 1}
                          </div>
                          <div className="col-span-4 text-xs text-muted-foreground">
                            de {limAnterior} até
                          </div>
                          <div className="col-span-3">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder={isUltima ? "Vazio = sem teto" : "Ex: 20000"}
                              disabled={!canEdit}
                              value={f.limiteAteText}
                              onChange={(e) =>
                                atualizarFaixa(idx, "limiteAteText", e.target.value)
                              }
                            />
                          </div>
                          <div className="col-span-3 flex items-center gap-1">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              placeholder="%"
                              disabled={!canEdit}
                              value={f.aliquotaText}
                              onChange={(e) =>
                                atualizarFaixa(idx, "aliquotaText", e.target.value)
                              }
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                          <div className="col-span-1">
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => removerFaixa(idx)}
                                title="Remover faixa"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={adicionarFaixa}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar faixa
                    </Button>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-3">
                    Exemplo: 4% até R$ 20.000, 5% até R$ 30.000, 6% sem teto.
                    Quem fechou R$ 25.000 ganha 5% × R$ 25.000 = R$ 1.250.
                  </p>
                </div>

                {/* Preview visual das faixas */}
                {faixas.filter((f) => f.aliquotaText.trim() !== "").length > 0 && (
                  <div className="border-t pt-3 mt-3">
                    <Label className="text-xs mb-2 block">📊 Preview das faixas</Label>
                    <div className="space-y-2">
                      {faixas
                        .filter((f) => f.aliquotaText.trim() !== "")
                        .map((f, idx, arr) => {
                          const aliquota = parseFloat(f.aliquotaText) || 0;
                          const limiteAte = f.limiteAteText.trim() === "" ? null : parseFloat(f.limiteAteText) || 0;
                          const limiteAnt = idx > 0 ? parseFloat(arr[idx - 1].limiteAteText) || 0 : 0;
                          const cores = [
                            { bg: "bg-success-bg border-success/30", num: "bg-success", text: "text-success-fg", label: "Faixa básica" },
                            { bg: "bg-warning-bg border-warning/30", num: "bg-warning", text: "text-warning-fg", label: "Faixa intermediária" },
                            { bg: "bg-info-bg border-info/30", num: "bg-info", text: "text-info-fg", label: "Faixa premium" },
                            { bg: "bg-info-bg border-info/30", num: "bg-info", text: "text-info-fg", label: "Faixa elite" },
                          ];
                          const c = cores[Math.min(idx, cores.length - 1)];
                          const rangeStr = limiteAte === null
                            ? `Acima de R$ ${limiteAnt.toLocaleString("pt-BR")}`
                            : limiteAnt === 0
                              ? `Até R$ ${limiteAte.toLocaleString("pt-BR")}`
                              : `R$ ${limiteAnt.toLocaleString("pt-BR")} — R$ ${limiteAte.toLocaleString("pt-BR")}`;
                          return (
                            <div key={idx} className={`flex items-center gap-3 p-3 rounded-lg border ${c.bg}`}>
                              <span className={`w-9 h-9 rounded-full ${c.num} text-white font-bold flex items-center justify-center shrink-0`}>{idx + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11.5px] font-bold">{rangeStr}</p>
                                <p className="text-[10px] text-muted-foreground">{c.label}</p>
                              </div>
                              <div className="text-right">
                                <p className={`text-lg font-extrabold tabular-nums ${c.text}`}>{aliquota}%</p>
                                <p className="text-[9.5px] text-muted-foreground">comissão</p>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                onClick={salvar}
                disabled={!canEdit || salvarMut.isPending}
              >
                {salvarMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Salvar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Categorias de cobrança ──────────────────────────────────────────────────

function CategoriasCobrancaCard({ canEdit }: { canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.financeiro.listarCategoriasCobranca.useQuery();
  const [novoNome, setNovoNome] = useState("");
  const [novoComissionavel, setNovoComissionavel] = useState(true);

  const criarMut = trpc.financeiro.criarCategoriaCobranca.useMutation({
    onSuccess: () => {
      utils.financeiro.listarCategoriasCobranca.invalidate();
      setNovoNome("");
      setNovoComissionavel(true);
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const atualizarMut = trpc.financeiro.atualizarCategoriaCobranca.useMutation({
    onSuccess: () => utils.financeiro.listarCategoriasCobranca.invalidate(),
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const criar = () => {
    const nome = novoNome.trim();
    if (!nome) return;
    criarMut.mutate({ nome, comissionavel: novoComissionavel });
  };

  const ativas = (data ?? []).filter((c) => c.ativo);
  const arquivadas = (data ?? []).filter((c) => !c.ativo);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Tag className="h-4 w-4" /> Categorias de cobrança
        </CardTitle>
        <CardDescription>
          Marque quais categorias entram no cálculo de comissão. Cobranças sem
          categoria são consideradas comissionáveis por padrão.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {ativas.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-3 py-2 border-b last:border-b-0"
              >
                <span className="flex-1 text-sm">{cat.nome}</span>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">
                    Comissionável
                  </Label>
                  <Switch
                    checked={cat.comissionavel}
                    disabled={!canEdit || atualizarMut.isPending}
                    onCheckedChange={(v) =>
                      atualizarMut.mutate({ id: cat.id, comissionavel: v })
                    }
                  />
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    title="Arquivar"
                    onClick={() =>
                      atualizarMut.mutate({ id: cat.id, ativo: false })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}

            {ativas.length === 0 && (
              <p className="text-xs text-muted-foreground py-3 text-center">
                Nenhuma categoria ativa.
              </p>
            )}

            {canEdit && (
              <div className="flex items-end gap-2 pt-3 border-t">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">Nova categoria</Label>
                  <Input
                    placeholder="Ex: Acordo extrajudicial"
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 pb-1">
                  <Label className="text-xs text-muted-foreground">
                    Comissionável
                  </Label>
                  <Switch
                    checked={novoComissionavel}
                    onCheckedChange={setNovoComissionavel}
                  />
                </div>
                <Button onClick={criar} disabled={criarMut.isPending || !novoNome.trim()}>
                  {criarMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Adicionar
                </Button>
              </div>
            )}

            {arquivadas.length > 0 && (
              <details className="pt-3 border-t mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  {arquivadas.length} arquivada{arquivadas.length > 1 ? "s" : ""}
                </summary>
                <div className="mt-2 space-y-1">
                  {arquivadas.map((cat) => (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between py-1 text-xs text-muted-foreground"
                    >
                      <span>{cat.nome}</span>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() =>
                            atualizarMut.mutate({ id: cat.id, ativo: true })
                          }
                        >
                          Restaurar
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Categorias de despesa ───────────────────────────────────────────────────

function CategoriasDespesaCard({ canEdit }: { canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.financeiro.listarCategoriasDespesa.useQuery();
  const [novoNome, setNovoNome] = useState("");

  const criarMut = trpc.financeiro.criarCategoriaDespesa.useMutation({
    onSuccess: () => {
      utils.financeiro.listarCategoriasDespesa.invalidate();
      setNovoNome("");
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const atualizarMut = trpc.financeiro.atualizarCategoriaDespesa.useMutation({
    onSuccess: () => utils.financeiro.listarCategoriasDespesa.invalidate(),
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const ativas = (data ?? []).filter((c) => c.ativo);
  const arquivadas = (data ?? []).filter((c) => !c.ativo);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" /> Categorias de despesa
        </CardTitle>
        <CardDescription>
          Tipos de gasto operacional do escritório (aluguel, salários, tributos,
          marketing). Usadas em Contas a Pagar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {ativas.map((cat) => (
                <div
                  key={cat.id}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs bg-secondary rounded-md"
                >
                  <span>{cat.nome}</span>
                  {canEdit && (
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        atualizarMut.mutate({ id: cat.id, ativo: false })
                      }
                      title="Arquivar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {ativas.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma categoria ativa.
                </p>
              )}
            </div>

            {canEdit && (
              <div className="flex items-end gap-2 pt-3 border-t">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">Nova categoria</Label>
                  <Input
                    placeholder="Ex: Curso/treinamento"
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() => {
                    const nome = novoNome.trim();
                    if (nome) criarMut.mutate({ nome });
                  }}
                  disabled={criarMut.isPending || !novoNome.trim()}
                >
                  {criarMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Adicionar
                </Button>
              </div>
            )}

            {arquivadas.length > 0 && (
              <details className="pt-3 border-t mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  {arquivadas.length} arquivada{arquivadas.length > 1 ? "s" : ""}
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {arquivadas.map((cat) => (
                    <button
                      key={cat.id}
                      className="px-2.5 py-1 text-xs border rounded-md text-muted-foreground hover:bg-accent"
                      onClick={() =>
                        canEdit && atualizarMut.mutate({ id: cat.id, ativo: true })
                      }
                      disabled={!canEdit}
                    >
                      {cat.nome} ↺
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
