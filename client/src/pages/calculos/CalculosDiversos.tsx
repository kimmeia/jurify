import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Calculator, ArrowRightLeft, TrendingUp, Clock, Percent,
  Loader2, Info, AlertTriangle, CheckCircle, Copy, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatPercent(value: number, decimals = 4): string {
  return `${value.toFixed(decimals)}%`;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    toast.success("Copiado para a área de transferência");
  });
}

const PERIODO_LABELS: Record<string, string> = {
  diaria: "Diária",
  mensal: "Mensal",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

const AREA_LABELS: Record<string, string> = {
  civil: "Direito Civil",
  trabalhista: "Direito Trabalhista",
  tributario: "Direito Tributário",
  consumidor: "Direito do Consumidor",
  penal: "Direito Penal",
};

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 1: CONVERSÃO DE TAXAS
// ═══════════════════════════════════════════════════════════════════════════════

function ConversaoTaxasTab() {
  const [taxaOriginal, setTaxaOriginal] = useState("");
  const [periodoOrigem, setPeriodoOrigem] = useState("mensal");
  const [periodoDestino, setPeriodoDestino] = useState("anual");
  const [tipoOrigem, setTipoOrigem] = useState("efetiva");
  const [tipoDestino, setTipoDestino] = useState("efetiva");
  const [baseDias, setBaseDias] = useState("corridos");
  const [capitalizacao, setCapitalizacao] = useState("mensal");
  const [resultado, setResultado] = useState<any>(null);

  // Taxa Real (Fisher)
  const [taxaNominalFisher, setTaxaNominalFisher] = useState("");
  const [inflacaoFisher, setInflacaoFisher] = useState("");
  const [resultadoFisher, setResultadoFisher] = useState<any>(null);

  const converterMutation = trpc.calculosDiversos.converterTaxa.useMutation({
    onSuccess: (data) => {
      setResultado(data);
      toast.success("Taxa convertida com sucesso");
    },
    onError: (err) => toast.error(err.message),
  });

  const fisherMutation = trpc.calculosDiversos.taxaReal.useMutation({
    onSuccess: (data) => {
      setResultadoFisher(data);
      toast.success("Taxa real calculada");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleConverter = () => {
    const taxa = parseFloat(taxaOriginal);
    if (isNaN(taxa) || taxa < 0) {
      toast.error("Informe uma taxa válida");
      return;
    }
    converterMutation.mutate({
      taxaOriginal: taxa,
      periodoOrigem: periodoOrigem as any,
      periodoDestino: periodoDestino as any,
      tipoOrigem: tipoOrigem as any,
      tipoDestino: tipoDestino as any,
      baseDias: baseDias as any,
      capitalizacaoNominal: (tipoOrigem === "nominal" || tipoDestino === "nominal") ? capitalizacao as any : undefined,
    });
  };

  const handleFisher = () => {
    const tn = parseFloat(taxaNominalFisher);
    const inf = parseFloat(inflacaoFisher);
    if (isNaN(tn) || isNaN(inf)) {
      toast.error("Informe taxas válidas");
      return;
    }
    fisherMutation.mutate({ taxaNominal: tn, inflacao: inf });
  };

  const showCapitalizacao = tipoOrigem === "nominal" || tipoDestino === "nominal";

  return (
    <div className="space-y-6">
      {/* Conversão de Taxas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Conversão de Taxas de Juros
          </CardTitle>
          <CardDescription>
            Converta taxas entre períodos (mensal, anual, etc.) e tipos (efetiva, nominal).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Taxa de entrada */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Taxa Original (%)</Label>
              <Input
                type="number"
                step="0.0001"
                placeholder="Ex: 1.5"
                value={taxaOriginal}
                onChange={(e) => setTaxaOriginal(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo Origem</Label>
              <Select value={tipoOrigem} onValueChange={setTipoOrigem}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="efetiva">Efetiva</SelectItem>
                  <SelectItem value="nominal">Nominal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Período Origem</Label>
              <Select value={periodoOrigem} onValueChange={setPeriodoOrigem}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PERIODO_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <div className="bg-muted rounded-full p-2">
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          {/* Destino */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Base de Dias</Label>
              <Select value={baseDias} onValueChange={setBaseDias}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="corridos">365 dias corridos</SelectItem>
                  <SelectItem value="uteis">252 dias úteis</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo Destino</Label>
              <Select value={tipoDestino} onValueChange={setTipoDestino}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="efetiva">Efetiva</SelectItem>
                  <SelectItem value="nominal">Nominal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Período Destino</Label>
              <Select value={periodoDestino} onValueChange={setPeriodoDestino}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PERIODO_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Capitalização (se nominal) */}
          {showCapitalizacao && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Período de Capitalização</Label>
                <Select value={capitalizacao} onValueChange={setCapitalizacao}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PERIODO_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <Button onClick={handleConverter} disabled={converterMutation.isPending} className="w-full">
            {converterMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Calculando...</>
            ) : (
              <><Calculator className="h-4 w-4 mr-2" /> Converter Taxa</>
            )}
          </Button>

          {/* Resultado */}
          {resultado && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-primary">Resultado da Conversão</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(formatPercent(resultado.taxaConvertida, 6))}
                >
                  <Copy className="h-4 w-4 mr-1" /> Copiar
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-background rounded-md p-3 border">
                  <p className="text-xs text-muted-foreground">Taxa Original</p>
                  <p className="text-xl font-bold">{formatPercent(resultado.taxaOriginal, 4)}</p>
                  <p className="text-xs text-muted-foreground">
                    {resultado.tipoOrigem === "efetiva" ? "Efetiva" : "Nominal"} {PERIODO_LABELS[resultado.periodoOrigem]}
                  </p>
                </div>
                <div className="bg-background rounded-md p-3 border border-primary/30">
                  <p className="text-xs text-muted-foreground">Taxa Convertida</p>
                  <p className="text-xl font-bold text-primary">{formatPercent(resultado.taxaConvertida, 6)}</p>
                  <p className="text-xs text-muted-foreground">
                    {resultado.tipoDestino === "efetiva" ? "Efetiva" : "Nominal"} {PERIODO_LABELS[resultado.periodoDestino]}
                  </p>
                </div>
              </div>
              <div className="bg-background rounded-md p-3 border">
                <p className="text-xs text-muted-foreground mb-1">Detalhamento</p>
                <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">{resultado.detalhamento}</pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Taxa Real (Fisher) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Percent className="h-5 w-5 text-primary" />
            Taxa Real (Equação de Fisher)
          </CardTitle>
          <CardDescription>
            Desconte a inflação de uma taxa nominal para obter o ganho real.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Taxa Nominal (% a.a.)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="Ex: 13.75"
                value={taxaNominalFisher}
                onChange={(e) => setTaxaNominalFisher(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Inflação (% a.a.)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="Ex: 4.62"
                value={inflacaoFisher}
                onChange={(e) => setInflacaoFisher(e.target.value)}
              />
            </div>
          </div>

          <Button onClick={handleFisher} disabled={fisherMutation.isPending} variant="outline" className="w-full">
            {fisherMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Calculando...</>
            ) : (
              <><Calculator className="h-4 w-4 mr-2" /> Calcular Taxa Real</>
            )}
          </Button>

          {resultadoFisher && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-5 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-background rounded-md p-3 border">
                  <p className="text-xs text-muted-foreground">Taxa Nominal</p>
                  <p className="text-lg font-bold">{formatPercent(resultadoFisher.taxaNominal, 2)} a.a.</p>
                </div>
                <div className="bg-background rounded-md p-3 border">
                  <p className="text-xs text-muted-foreground">Inflação</p>
                  <p className="text-lg font-bold">{formatPercent(resultadoFisher.inflacao, 2)} a.a.</p>
                </div>
                <div className="bg-background rounded-md p-3 border border-primary/30">
                  <p className="text-xs text-muted-foreground">Taxa Real</p>
                  <p className={`text-lg font-bold ${resultadoFisher.taxaReal >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatPercent(resultadoFisher.taxaReal, 4)} a.a.
                  </p>
                </div>
              </div>
              <div className="bg-background rounded-md p-3 border">
                <p className="text-xs text-muted-foreground mb-1">Fórmula</p>
                <code className="text-xs font-mono">{resultadoFisher.formulaAplicada}</code>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 2: JUROS SIMPLES E COMPOSTOS
// ═══════════════════════════════════════════════════════════════════════════════

function JurosTab() {
  const [capital, setCapital] = useState("");
  const [taxa, setTaxa] = useState("");
  const [periodoTaxa, setPeriodoTaxa] = useState("mensal");
  const [prazo, setPrazo] = useState("");
  const [periodoPrazo, setPeriodoPrazo] = useState("mensal");
  const [tipo, setTipo] = useState<"simples" | "composto">("composto");
  const [resultado, setResultado] = useState<any>(null);

  const mutation = trpc.calculosDiversos.calcularJuros.useMutation({
    onSuccess: (data) => {
      setResultado(data);
      toast.success("Juros calculados com sucesso");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCalcular = () => {
    const c = parseFloat(capital);
    const t = parseFloat(taxa);
    const p = parseFloat(prazo);
    if (isNaN(c) || c <= 0) { toast.error("Informe um capital válido"); return; }
    if (isNaN(t) || t < 0) { toast.error("Informe uma taxa válida"); return; }
    if (isNaN(p) || p < 1) { toast.error("Informe um prazo válido"); return; }
    mutation.mutate({
      capital: c,
      taxa: t,
      periodoTaxa: periodoTaxa as any,
      prazo: p,
      periodoPrazo: periodoPrazo as any,
      tipo,
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="h-5 w-5 text-primary" />
            Calculadora de Juros
          </CardTitle>
          <CardDescription>
            Calcule juros simples ou compostos com evolução período a período.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Tipo de juros */}
          <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
            <Label className="text-sm font-medium">Tipo de Juros:</Label>
            <div className="flex gap-2">
              <Button
                variant={tipo === "simples" ? "default" : "outline"}
                size="sm"
                onClick={() => setTipo("simples")}
              >
                Simples
              </Button>
              <Button
                variant={tipo === "composto" ? "default" : "outline"}
                size="sm"
                onClick={() => setTipo("composto")}
              >
                Composto
              </Button>
            </div>
          </div>

          {/* Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Capital Inicial (R$)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="Ex: 10000"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Taxa de Juros (%)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Ex: 1.5"
                  value={taxa}
                  onChange={(e) => setTaxa(e.target.value)}
                  className="flex-1"
                />
                <Select value={periodoTaxa} onValueChange={setPeriodoTaxa}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PERIODO_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Prazo</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="1"
                  placeholder="Ex: 12"
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value)}
                  className="flex-1"
                />
                <Select value={periodoPrazo} onValueChange={setPeriodoPrazo}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PERIODO_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Button onClick={handleCalcular} disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Calculando...</>
            ) : (
              <><Calculator className="h-4 w-4 mr-2" /> Calcular Juros</>
            )}
          </Button>

          {/* Resultado */}
          {resultado && (
            <div className="space-y-4">
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-5 space-y-3">
                <h4 className="font-semibold text-primary flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Resultado — Juros {resultado.tipo === "simples" ? "Simples" : "Compostos"}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-background rounded-md p-3 border">
                    <p className="text-xs text-muted-foreground">Capital</p>
                    <p className="text-lg font-bold">{formatBRL(resultado.capital)}</p>
                  </div>
                  <div className="bg-background rounded-md p-3 border">
                    <p className="text-xs text-muted-foreground">Juros</p>
                    <p className="text-lg font-bold text-amber-600">{formatBRL(resultado.juros)}</p>
                  </div>
                  <div className="bg-background rounded-md p-3 border border-primary/30">
                    <p className="text-xs text-muted-foreground">Montante Final</p>
                    <p className="text-lg font-bold text-primary">{formatBRL(resultado.montante)}</p>
                  </div>
                </div>
                <div className="bg-background rounded-md p-3 border">
                  <p className="text-xs text-muted-foreground mb-1">Fórmula</p>
                  <code className="text-xs font-mono">{resultado.formulaAplicada}</code>
                </div>
              </div>

              {/* Tabela de evolução */}
              {resultado.evolucaoMensal && resultado.evolucaoMensal.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Evolução Período a Período</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-[400px]">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            <th className="text-left p-2 font-medium">Período</th>
                            <th className="text-right p-2 font-medium">Saldo Inicial</th>
                            <th className="text-right p-2 font-medium">Juros</th>
                            <th className="text-right p-2 font-medium">Saldo Final</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultado.evolucaoMensal.map((ev: any) => (
                            <tr key={ev.periodo} className="border-t">
                              <td className="p-2">{ev.periodo}</td>
                              <td className="text-right p-2">{formatBRL(ev.saldoInicial)}</td>
                              <td className="text-right p-2 text-amber-600">{formatBRL(ev.juros)}</td>
                              <td className="text-right p-2 font-medium">{formatBRL(ev.saldoFinal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 3: ATUALIZAÇÃO MONETÁRIA
// ═══════════════════════════════════════════════════════════════════════════════

function AtualizacaoMonetariaTab() {
  const [valorOriginal, setValorOriginal] = useState("");
  const [dataInicial, setDataInicial] = useState("");
  const [dataFinal, setDataFinal] = useState("");
  const [indice, setIndice] = useState("IPCA");
  const [aplicarJurosMora, setAplicarJurosMora] = useState(false);
  const [taxaJurosMora, setTaxaJurosMora] = useState("12");
  const [aplicarMulta, setAplicarMulta] = useState(false);
  const [percentualMulta, setPercentualMulta] = useState("2");
  const [resultado, setResultado] = useState<any>(null);

  const mutation = trpc.calculosDiversos.atualizarMonetariamente.useMutation({
    onSuccess: (data) => {
      setResultado(data);
      toast.success("Atualização monetária calculada com sucesso");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCalcular = () => {
    const valor = parseFloat(valorOriginal);
    if (isNaN(valor) || valor <= 0) { toast.error("Informe um valor válido"); return; }
    if (!dataInicial) { toast.error("Informe a data inicial"); return; }
    if (!dataFinal) { toast.error("Informe a data final"); return; }

    // Converter YYYY-MM para MM/YYYY
    const di = dataInicial.length === 7 ? `${dataInicial.split("-")[1]}/${dataInicial.split("-")[0]}` : dataInicial;
    const df = dataFinal.length === 7 ? `${dataFinal.split("-")[1]}/${dataFinal.split("-")[0]}` : dataFinal;

    mutation.mutate({
      valorOriginal: valor,
      dataInicial: di,
      dataFinal: df,
      indice: indice as any,
      aplicarJurosMora,
      taxaJurosMoraAnual: parseFloat(taxaJurosMora) || 12,
      aplicarMulta,
      percentualMulta: parseFloat(percentualMulta) || 2,
    });
  };

  const INDICES = [
    { id: "IPCA", nome: "IPCA (IBGE)", desc: "Índice oficial de inflação" },
    { id: "IGPM", nome: "IGP-M (FGV)", desc: "Reajuste de aluguéis" },
    { id: "INPC", nome: "INPC (IBGE)", desc: "Correção trabalhista" },
    { id: "IPCAE", nome: "IPCA-E (IBGE)", desc: "Correção judicial (precatórios)" },
    { id: "SELIC", nome: "Taxa SELIC", desc: "Juros de mora tributário" },
    { id: "TR", nome: "Taxa Referencial", desc: "Correção FGTS e poupança" },
    { id: "CDI", nome: "CDI", desc: "Referência de investimentos" },
    { id: "POUPANCA", nome: "Poupança", desc: "Rendimento da caderneta" },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="h-5 w-5 text-primary" />
            Atualização Monetária
          </CardTitle>
          <CardDescription>
            Corrija valores por índices oficiais do Banco Central do Brasil (dados em tempo real via API SGS/BCB).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Valor e datas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Valor Original (R$)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="Ex: 10000"
                value={valorOriginal}
                onChange={(e) => setValorOriginal(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Data Inicial (mês/ano)</Label>
              <Input
                type="month"
                value={dataInicial}
                onChange={(e) => setDataInicial(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Data Final (mês/ano)</Label>
              <Input
                type="month"
                value={dataFinal}
                onChange={(e) => setDataFinal(e.target.value)}
              />
            </div>
          </div>

          {/* Seleção de índice */}
          <div className="space-y-2">
            <Label>Índice de Correção</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {INDICES.map((idx) => (
                <button
                  key={idx.id}
                  onClick={() => setIndice(idx.id)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    indice === idx.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  <p className="text-sm font-medium">{idx.nome}</p>
                  <p className="text-xs text-muted-foreground">{idx.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Juros de mora e multa */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3 p-4 rounded-lg border">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Juros de Mora</Label>
                <Switch checked={aplicarJurosMora} onCheckedChange={setAplicarJurosMora} />
              </div>
              {aplicarJurosMora && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Taxa anual (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={taxaJurosMora}
                    onChange={(e) => setTaxaJurosMora(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Padrão: 12% a.a. (1% a.m.) — Art. 406, CC c/c Art. 161, §1º, CTN
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-3 p-4 rounded-lg border">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Multa Moratória</Label>
                <Switch checked={aplicarMulta} onCheckedChange={setAplicarMulta} />
              </div>
              {aplicarMulta && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Percentual (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={percentualMulta}
                    onChange={(e) => setPercentualMulta(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Padrão: 2% — Art. 52, §1º, CDC
                  </p>
                </div>
              )}
            </div>
          </div>

          <Button onClick={handleCalcular} disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Buscando índices e calculando...</>
            ) : (
              <><Calculator className="h-4 w-4 mr-2" /> Calcular Atualização</>
            )}
          </Button>

          {/* Resultado */}
          {resultado && (
            <div className="space-y-4">
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-5 space-y-4">
                <h4 className="font-semibold text-primary flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Resultado da Atualização Monetária
                </h4>

                {/* Cards de resumo */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-background rounded-md p-3 border">
                    <p className="text-xs text-muted-foreground">Valor Original</p>
                    <p className="text-lg font-bold">{formatBRL(resultado.valorOriginal)}</p>
                  </div>
                  <div className="bg-background rounded-md p-3 border">
                    <p className="text-xs text-muted-foreground">Correção Monetária</p>
                    <p className="text-lg font-bold text-amber-600">{formatBRL(resultado.correcaoMonetaria)}</p>
                    <p className="text-xs text-muted-foreground">{formatPercent(resultado.variacaoPercentual, 2)}</p>
                  </div>
                  <div className="bg-background rounded-md p-3 border">
                    <p className="text-xs text-muted-foreground">Valor Corrigido</p>
                    <p className="text-lg font-bold">{formatBRL(resultado.valorCorrigido)}</p>
                  </div>
                  {resultado.jurosMora > 0 && (
                    <div className="bg-background rounded-md p-3 border">
                      <p className="text-xs text-muted-foreground">Juros de Mora</p>
                      <p className="text-lg font-bold text-orange-600">{formatBRL(resultado.jurosMora)}</p>
                    </div>
                  )}
                  {resultado.multa > 0 && (
                    <div className="bg-background rounded-md p-3 border">
                      <p className="text-xs text-muted-foreground">Multa</p>
                      <p className="text-lg font-bold text-red-600">{formatBRL(resultado.multa)}</p>
                    </div>
                  )}
                  <div className="bg-background rounded-md p-3 border border-primary/30">
                    <p className="text-xs text-muted-foreground">Valor Total</p>
                    <p className="text-xl font-bold text-primary">{formatBRL(resultado.valorTotal)}</p>
                  </div>
                </div>

                {/* Info adicional */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-background rounded-md p-3 border">
                    <p className="text-xs text-muted-foreground">Fator de Correção</p>
                    <p className="font-mono font-medium">{resultado.fatorCorrecao.toFixed(8)}</p>
                  </div>
                  <div className="bg-background rounded-md p-3 border">
                    <p className="text-xs text-muted-foreground">Meses de Correção</p>
                    <p className="font-medium">{resultado.indices.length} meses</p>
                  </div>
                </div>
              </div>

              {/* Tabela de índices */}
              {resultado.indices && resultado.indices.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Variação Mensal do Índice</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-[400px]">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            <th className="text-left p-2 font-medium">Mês/Ano</th>
                            <th className="text-right p-2 font-medium">Variação (%)</th>
                            <th className="text-right p-2 font-medium">Fator Acumulado</th>
                            <th className="text-right p-2 font-medium">Valor Acumulado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultado.indices.map((idx: any, i: number) => (
                            <tr key={i} className="border-t">
                              <td className="p-2">{idx.data}</td>
                              <td className={`text-right p-2 ${idx.variacao >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {idx.variacao >= 0 ? "+" : ""}{idx.variacao.toFixed(4)}%
                              </td>
                              <td className="text-right p-2 font-mono">{idx.fatorAcumulado.toFixed(8)}</td>
                              <td className="text-right p-2 font-medium">
                                {formatBRL(resultado.valorOriginal * idx.fatorAcumulado)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 4: PRAZOS PRESCRICIONAIS
// ═══════════════════════════════════════════════════════════════════════════════

function PrazosTab() {
  const [area, setArea] = useState("civil");
  const [tipoAcao, setTipoAcao] = useState("");
  const [dataFatoGerador, setDataFatoGerador] = useState("");
  const [suspensoes, setSuspensoes] = useState<{ inicio: string; fim: string }[]>([]);
  const [resultado, setResultado] = useState<any>(null);

  const { data: prazos } = trpc.calculosDiversos.listarPrazos.useQuery({ area: area as any });

  const mutation = trpc.calculosDiversos.calcularPrescricao.useMutation({
    onSuccess: (data) => {
      setResultado(data);
      toast.success("Prazo prescricional calculado");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCalcular = () => {
    if (!tipoAcao) { toast.error("Selecione o tipo de ação"); return; }
    if (!dataFatoGerador) { toast.error("Informe a data do fato gerador"); return; }
    mutation.mutate({
      area: area as any,
      tipoAcao,
      dataFatoGerador,
      suspensoes: suspensoes.filter(s => s.inicio && s.fim),
    });
  };

  const addSuspensao = () => {
    setSuspensoes([...suspensoes, { inicio: "", fim: "" }]);
  };

  const removeSuspensao = (index: number) => {
    setSuspensoes(suspensoes.filter((_, i) => i !== index));
  };

  const updateSuspensao = (index: number, field: "inicio" | "fim", value: string) => {
    const updated = [...suspensoes];
    updated[index][field] = value;
    setSuspensoes(updated);
  };

  // Reset tipoAcao when area changes
  const handleAreaChange = (newArea: string) => {
    setArea(newArea);
    setTipoAcao("");
    setResultado(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-primary" />
            Calculadora de Prazo Prescricional
          </CardTitle>
          <CardDescription>
            Verifique se uma pretensão está prescrita, considerando suspensões e interrupções.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Área do direito */}
          <div className="space-y-2">
            <Label>Área do Direito</Label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {Object.entries(AREA_LABELS).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => handleAreaChange(k)}
                  className={`p-3 rounded-lg border text-sm transition-colors ${
                    area === k
                      ? "border-primary bg-primary/5 ring-1 ring-primary font-medium"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Tipo de ação */}
          <div className="space-y-2">
            <Label>Tipo de Pretensão</Label>
            <Select value={tipoAcao} onValueChange={setTipoAcao}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o tipo de pretensão..." />
              </SelectTrigger>
              <SelectContent>
                {prazos?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{p.prazoAnos === 0 ? "Decad." : `${p.prazoAnos}a`}</Badge>
                      {p.descricao}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tipoAcao && prazos && (
              <p className="text-xs text-muted-foreground">
                {prazos.find(p => p.id === tipoAcao)?.fundamentacao}
                {prazos.find(p => p.id === tipoAcao)?.observacao && (
                  <> — {prazos.find(p => p.id === tipoAcao)?.observacao}</>
                )}
              </p>
            )}
          </div>

          {/* Data do fato gerador */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data do Fato Gerador</Label>
              <Input
                type="date"
                value={dataFatoGerador}
                onChange={(e) => setDataFatoGerador(e.target.value)}
              />
            </div>
          </div>

          {/* Suspensões */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Suspensões / Interrupções</Label>
              <Button variant="outline" size="sm" onClick={addSuspensao}>
                + Adicionar Suspensão
              </Button>
            </div>
            {suspensoes.map((s, i) => (
              <div key={i} className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Início</Label>
                    <Input
                      type="date"
                      value={s.inicio}
                      onChange={(e) => updateSuspensao(i, "inicio", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fim</Label>
                    <Input
                      type="date"
                      value={s.fim}
                      onChange={(e) => updateSuspensao(i, "fim", e.target.value)}
                    />
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeSuspensao(i)} className="text-red-500 hover:text-red-700">
                  ✕
                </Button>
              </div>
            ))}
            {suspensoes.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma suspensão adicionada.</p>
            )}
          </div>

          <Button onClick={handleCalcular} disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Calculando...</>
            ) : (
              <><Calculator className="h-4 w-4 mr-2" /> Verificar Prescrição</>
            )}
          </Button>

          {/* Resultado */}
          {resultado && (
            <div className={`rounded-lg p-5 space-y-4 border ${
              resultado.prescrito
                ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                : "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
            }`}>
              <div className="flex items-center gap-3">
                {resultado.prescrito ? (
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                ) : (
                  <CheckCircle className="h-6 w-6 text-green-600" />
                )}
                <div>
                  <h4 className={`font-bold text-lg ${resultado.prescrito ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                    {resultado.prescrito ? "PRESCRITO" : "NÃO PRESCRITO"}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {resultado.prescrito
                      ? `Prescreveu há ${Math.abs(resultado.diasRestantes)} dias`
                      : `Faltam ${resultado.diasRestantes} dias para prescrever`
                    }
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-background rounded-md p-3 border">
                  <p className="text-xs text-muted-foreground">Data do Fato</p>
                  <p className="font-medium">{new Date(resultado.dataFatoGerador + "T00:00:00").toLocaleDateString("pt-BR")}</p>
                </div>
                <div className="bg-background rounded-md p-3 border">
                  <p className="text-xs text-muted-foreground">Prazo</p>
                  <p className="font-medium">{resultado.prazo.prazoAnos} ano(s)</p>
                </div>
                <div className="bg-background rounded-md p-3 border">
                  <p className="text-xs text-muted-foreground">Data de Prescrição</p>
                  <p className="font-medium">{new Date(resultado.dataPrescricao + "T00:00:00").toLocaleDateString("pt-BR")}</p>
                </div>
              </div>

              {resultado.suspensoes.length > 0 && (
                <div className="bg-background rounded-md p-3 border">
                  <p className="text-xs text-muted-foreground mb-2">Suspensões Consideradas</p>
                  {resultado.suspensoes.map((s: any, i: number) => (
                    <p key={i} className="text-sm">
                      {new Date(s.inicio + "T00:00:00").toLocaleDateString("pt-BR")} a {new Date(s.fim + "T00:00:00").toLocaleDateString("pt-BR")} ({s.dias} dias)
                    </p>
                  ))}
                  <p className="text-sm font-medium mt-1">Total suspenso: {resultado.totalDiasSuspensos} dias</p>
                </div>
              )}

              <div className="bg-background rounded-md p-3 border">
                <p className="text-xs text-muted-foreground mb-1">Fundamentação</p>
                <p className="text-sm font-medium">{resultado.prazo.fundamentacao}</p>
                <p className="text-sm text-muted-foreground mt-1">{resultado.prazo.descricao}</p>
                {resultado.prazo.observacao && (
                  <p className="text-xs text-muted-foreground mt-1 italic">{resultado.prazo.observacao}</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function CalculosDiversos() {
  return (
    <div className="container max-w-5xl py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <div className="bg-teal-100 dark:bg-teal-900/30 p-2 rounded-lg">
            <Calculator className="h-6 w-6 text-teal-600" />
          </div>
          Cálculos Diversos
        </h1>
        <p className="text-muted-foreground mt-1">
          Ferramentas de cálculo para o dia a dia do advogado — conversão de taxas, juros, atualização monetária e prazos prescricionais.
        </p>
        <Badge variant="outline" className="mt-2 text-green-600 border-green-300">
          <CheckCircle className="h-3 w-3 mr-1" /> Gratuito — não consome créditos
        </Badge>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="conversao" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="conversao" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <ArrowRightLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Conversão de</span> Taxas
          </TabsTrigger>
          <TabsTrigger value="juros" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Percent className="h-4 w-4" />
            Juros
          </TabsTrigger>
          <TabsTrigger value="atualizacao" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">Atualização</span> Monetária
          </TabsTrigger>
          <TabsTrigger value="prazos" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Clock className="h-4 w-4" />
            Prazos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversao">
          <ConversaoTaxasTab />
        </TabsContent>
        <TabsContent value="juros">
          <JurosTab />
        </TabsContent>
        <TabsContent value="atualizacao">
          <AtualizacaoMonetariaTab />
        </TabsContent>
        <TabsContent value="prazos">
          <PrazosTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
