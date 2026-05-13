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

export function FinanceiroTab({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="space-y-4">
      <RegraComissaoCard canEdit={canEdit} />
      <CategoriasCobrancaCard canEdit={canEdit} />
      <CategoriasDespesaCard canEdit={canEdit} />
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
