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

function RegraComissaoCard({ canEdit }: { canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data: regra, isLoading } = trpc.financeiro.obterRegraComissao.useQuery();
  const [aliquota, setAliquota] = useState("");
  const [valorMinimo, setValorMinimo] = useState("");

  useEffect(() => {
    if (regra) {
      setAliquota(String(regra.aliquotaPercent ?? "0"));
      setValorMinimo(String(regra.valorMinimoCobranca ?? "0"));
    }
  }, [regra]);

  const salvarMut = trpc.financeiro.salvarRegraComissao.useMutation({
    onSuccess: () => {
      toast.success("Regra de comissão salva");
      utils.financeiro.obterRegraComissao.invalidate();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const salvar = () => {
    const aliq = parseFloat(aliquota.replace(",", "."));
    const min = parseFloat(valorMinimo.replace(",", "."));
    if (isNaN(aliq) || aliq < 0 || aliq > 100) {
      toast.error("Alíquota inválida", { description: "Use um valor entre 0 e 100." });
      return;
    }
    if (isNaN(min) || min < 0) {
      toast.error("Valor mínimo inválido");
      return;
    }
    salvarMut.mutate({ aliquotaPercent: aliq, valorMinimoCobranca: min });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="h-4 w-4" /> Comissão dos atendentes
        </CardTitle>
        <CardDescription>
          Alíquota única aplicada sobre cobranças pagas. O valor mínimo exclui
          micro-cobranças (mensalidades, reembolsos pequenos) do cálculo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1.5">
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
            </div>
            <Button
              onClick={salvar}
              disabled={!canEdit || salvarMut.isPending}
              className="sm:w-auto"
            >
              {salvarMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Salvar
            </Button>
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
