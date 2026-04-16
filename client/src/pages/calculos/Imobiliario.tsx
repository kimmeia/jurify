import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ParecerEditor } from "@/components/calculos/ParecerEditor";
import {
  Building2, Calculator, AlertTriangle, CheckCircle, FileText, Loader2,
  ChevronDown, Info, Download, ArrowLeft, ArrowRight, Check,
  Home, Shield, DollarSign, TrendingUp, Calendar, Landmark, HardHat, Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import type {
  ResultadoImobiliario, LinhaImobiliario, SistemaAmortizacaoImob, IndexadorCorrecao,
  EnquadramentoImob, TipoCredor,
} from "../../../../shared/imobiliario-types";
import { INDEXADOR_LABELS } from "../../../../shared/imobiliario-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatPercent(value: number, decimals = 4): string {
  return `${value.toFixed(decimals)}%`;
}

// ─── Tabela de Demonstrativo Imobiliário ─────────────────────────────────────

function DemonstrativoImobTable({ linhas, title }: { linhas: LinhaImobiliario[]; title: string }) {
  const [expanded, setExpanded] = useState(false);
  const displayLinhas = expanded ? linhas : linhas.slice(0, 6);

  return (
    <div>
      {title && <h4 className="font-semibold text-sm mb-2">{title}</h4>}
      <ScrollArea className="w-full">
        <table className="w-full text-xs border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-muted/30">
              <th className="py-2 px-1.5 text-left font-medium border-b">#</th>
              <th className="py-2 px-1.5 text-left font-medium border-b">Vencimento</th>
              <th className="py-2 px-1.5 text-right font-medium border-b">Saldo Ant.</th>
              <th className="py-2 px-1.5 text-right font-medium border-b">Correção</th>
              <th className="py-2 px-1.5 text-right font-medium border-b">Juros</th>
              <th className="py-2 px-1.5 text-right font-medium border-b">Amort.</th>
              <th className="py-2 px-1.5 text-right font-medium border-b">MIP</th>
              <th className="py-2 px-1.5 text-right font-medium border-b">DFI</th>
              <th className="py-2 px-1.5 text-right font-medium border-b">Tx.Adm</th>
              <th className="py-2 px-1.5 text-right font-medium border-b">Prestação</th>
              <th className="py-2 px-1.5 text-right font-medium border-b">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {displayLinhas.map((l) => (
              <tr key={l.parcela} className="border-b last:border-0 hover:bg-muted/20">
                <td className="py-1.5 px-1.5">{l.parcela}</td>
                <td className="py-1.5 px-1.5">{l.dataVencimento.split("-").reverse().join("/")}</td>
                <td className="py-1.5 px-1.5 text-right">{formatBRL(l.saldoDevedorAnterior)}</td>
                <td className="py-1.5 px-1.5 text-right">{formatBRL(l.correcaoMonetaria)}</td>
                <td className="py-1.5 px-1.5 text-right">{formatBRL(l.juros)}</td>
                <td className="py-1.5 px-1.5 text-right">{formatBRL(l.amortizacao)}</td>
                <td className="py-1.5 px-1.5 text-right">{formatBRL(l.mip)}</td>
                <td className="py-1.5 px-1.5 text-right">{formatBRL(l.dfi)}</td>
                <td className="py-1.5 px-1.5 text-right">{formatBRL(l.taxaAdministracao)}</td>
                <td className="py-1.5 px-1.5 text-right font-medium">{formatBRL(l.prestacaoTotal)}</td>
                <td className="py-1.5 px-1.5 text-right">{formatBRL(l.saldoDevedorAtual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
      {linhas.length > 6 && (
        <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Mostrar menos" : `Ver todas as ${linhas.length} parcelas`}
        </Button>
      )}
    </div>
  );
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const isDone = stepNum < current;
        const isActive = stepNum === current;
        return (
          <div key={i} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                isDone ? "bg-emerald-500 text-white" : isActive ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
              }`}>
                {isDone ? <Check className="h-4 w-4" /> : stepNum}
              </div>
              <span className={`text-xs hidden sm:block ${isActive ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
            </div>
            {i < steps.length - 1 && <div className={`w-8 sm:w-12 h-0.5 mb-4 sm:mb-0 ${isDone ? "bg-emerald-500" : "bg-muted"}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Formulário ──────────────────────────────────────────────────────────────

interface FormData {
  valorImovel: string;
  valorFinanciado: string;
  taxaJurosAnual: string;
  prazoMeses: string;
  dataContrato: string;
  dataPrimeiroVencimento: string;
  sistemaAmortizacao: SistemaAmortizacaoImob;
  enquadramento: EnquadramentoImob | "";
  tipoCredor: TipoCredor;
  indexador: IndexadorCorrecao;
  taxaIndexadorAnual: string;
  indexadorAutoFetched: boolean;
  idadeComprador: string;
  taxaMIP: string;
  taxaDFI: string;
  seguroLivreEscolha: string;
  capitalizacaoExpressaPactuada: string;
  taxaAdministracao: string;
  parcelasJaPagas: string;
  taxaRecalculo: "media_bacen" | "manual";
  taxaManualAnual: string;
  indexadorRecalculo: IndexadorCorrecao | "";
  taxaIndexadorRecalculoAnual: string;
}

const initialForm: FormData = {
  valorImovel: "",
  valorFinanciado: "",
  taxaJurosAnual: "",
  prazoMeses: "360",
  dataContrato: "",
  dataPrimeiroVencimento: "",
  sistemaAmortizacao: "SAC",
  enquadramento: "",
  tipoCredor: "INSTITUICAO_SFN",
  indexador: "TR",
  taxaIndexadorAnual: "",
  indexadorAutoFetched: false,
  idadeComprador: "",
  taxaMIP: "",
  taxaDFI: "",
  seguroLivreEscolha: "sim",
  capitalizacaoExpressaPactuada: "nao",
  taxaAdministracao: "25",
  parcelasJaPagas: "",
  taxaRecalculo: "media_bacen",
  taxaManualAnual: "",
  indexadorRecalculo: "",
  taxaIndexadorRecalculoAnual: "",
};

const INDEXADORES = [
  { key: "TR" as IndexadorCorrecao, label: "TR (Taxa Referencial)", desc: "Mais comum, historicamente baixa" },
  { key: "IPCA" as IndexadorCorrecao, label: "IPCA", desc: "Índice oficial de inflação" },
  { key: "IGPM" as IndexadorCorrecao, label: "IGP-M", desc: "Índice Geral de Preços do Mercado" },
  { key: "IPC" as IndexadorCorrecao, label: "IPC (FIPE)", desc: "Índice de Preços ao Consumidor" },
  { key: "POUPANCA" as IndexadorCorrecao, label: "Poupança", desc: "TR + rendimento da poupança" },
  { key: "NENHUM" as IndexadorCorrecao, label: "Sem correção", desc: "Taxa pré-fixada" },
];

// ─── Componente Principal ────────────────────────────────────────────────────

export default function Imobiliario() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(initialForm);
  const [resultado, setResultado] = useState<ResultadoImobiliario | null>(null);
  const [taxaMediaInfo, setTaxaMediaInfo] = useState<{
    taxaMensal: number; taxaAnual: number; dataReferencia: string; fonte: string;
  } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [indexadorLoading, setIndexadorLoading] = useState(false);
  const [indexadorInfo, setIndexadorInfo] = useState<string>("");

  // tRPC utils for imperative queries
  const trpcUtils = trpc.useUtils();

  // Busca indexador via BACEN API
  const fetchIndexador = async (indexador: IndexadorCorrecao, silent = false) => {
    if (indexador === "NENHUM") {
      updateField("taxaIndexadorAnual", "0");
      setIndexadorInfo("Sem correção monetária");
      return;
    }
    setIndexadorLoading(true);
    setIndexadorInfo("");
    try {
      const result = await trpcUtils.imobiliario.buscarIndexador.fetch({ indexador });
      if (result && result.taxaAnual !== undefined) {
        updateField("taxaIndexadorAnual", result.taxaAnual.toFixed(4));
        updateField("indexadorAutoFetched", true as any);
        const isEstimativa = result.fonte.toLowerCase().includes("estimativa") || result.fonte.toLowerCase().includes("referência");
        setIndexadorInfo(`${result.fonte} — ${result.taxaMensal.toFixed(4)}% a.m. / ${result.taxaAnual.toFixed(4)}% a.a.`);
        if (!silent) {
          if (isEstimativa) {
            toast.info(`Taxa ${indexador} preenchida com valor de referência. Você pode ajustar manualmente.`);
          } else {
            toast.success(`Taxa ${indexador} atualizada via BACEN`);
          }
        }
      } else {
        setIndexadorInfo("Erro ao buscar taxa. Informe manualmente.");
        updateField("indexadorAutoFetched", false as any);
      }
    } catch {
      setIndexadorInfo("Erro ao buscar taxa. Informe manualmente.");
      updateField("indexadorAutoFetched", false as any);
    } finally {
      setIndexadorLoading(false);
    }
  };

  // Auto-fetch indexador quando entra no step 3 (dados do contrato) e taxa está vazia
  useEffect(() => {
    if (step === 3 && form.indexador !== "NENHUM" && !form.taxaIndexadorAnual && !indexadorLoading) {
      fetchIndexador(form.indexador, true);
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const calcularMutation = trpc.imobiliario.calcular.useMutation({
    onSuccess: (data) => {
      setResultado(data.resultado);
      setTaxaMediaInfo(data.taxaMediaBACEN);
      setStep(5);
      toast.success("Cálculo realizado com sucesso! (1 crédito descontado)");
    },
    onError: (error) => {
      toast.error(`Erro: ${error.message}`);
    },
  });

  const updateField = (field: keyof FormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const taxaMensalCalculada = useMemo(() => {
    if (form.taxaJurosAnual) {
      const anual = parseFloat(form.taxaJurosAnual);
      if (anual > 0) return ((Math.pow(1 + anual / 100, 1 / 12) - 1) * 100).toFixed(4);
    }
    return "";
  }, [form.taxaJurosAnual]);

  const handleSubmit = () => {
    if (!form.valorImovel || !form.valorFinanciado || !form.taxaJurosAnual || !form.prazoMeses || !form.dataContrato || !form.dataPrimeiroVencimento || !form.idadeComprador) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }

    const hoje = new Date().toISOString().slice(0, 10);
    if (form.dataContrato > hoje) {
      toast.error("Data do contrato não pode ser futura.");
      return;
    }
    if (form.dataPrimeiroVencimento < form.dataContrato) {
      toast.error("Data do primeiro vencimento não pode ser anterior à data do contrato.");
      return;
    }
    if (parseFloat(form.valorFinanciado) > parseFloat(form.valorImovel)) {
      toast.error("Valor financiado não pode ser superior ao valor do imóvel.");
      return;
    }

    const params: Record<string, unknown> = {
      valorImovel: parseFloat(form.valorImovel),
      valorFinanciado: parseFloat(form.valorFinanciado),
      taxaJurosAnual: parseFloat(form.taxaJurosAnual),
      prazoMeses: parseInt(form.prazoMeses),
      dataContrato: form.dataContrato,
      dataPrimeiroVencimento: form.dataPrimeiroVencimento,
      sistemaAmortizacao: form.sistemaAmortizacao,
      enquadramento: form.enquadramento || undefined,
      tipoCredor: form.tipoCredor,
      indexador: form.indexador,
      taxaIndexadorAnual: form.taxaIndexadorAnual ? parseFloat(form.taxaIndexadorAnual) : 0,
      idadeComprador: parseInt(form.idadeComprador),
      taxaMIP: form.taxaMIP ? parseFloat(form.taxaMIP) : undefined,
      taxaDFI: form.taxaDFI ? parseFloat(form.taxaDFI) : undefined,
      seguroLivreEscolha: form.seguroLivreEscolha === "sim",
      capitalizacaoExpressaPactuada: form.capitalizacaoExpressaPactuada === "sim",
      taxaAdministracao: form.taxaAdministracao ? parseFloat(form.taxaAdministracao) : undefined,
      parcelasJaPagas: form.parcelasJaPagas ? parseInt(form.parcelasJaPagas) : undefined,
      taxaRecalculo: form.taxaRecalculo,
      taxaManualAnual: form.taxaRecalculo === "manual" && form.taxaManualAnual ? parseFloat(form.taxaManualAnual) : undefined,
      indexadorRecalculo: form.indexadorRecalculo || undefined,
      taxaIndexadorRecalculoAnual: form.taxaIndexadorRecalculoAnual ? parseFloat(form.taxaIndexadorRecalculoAnual) : undefined,
    };

    calcularMutation.mutate(params as any);
  };

  async function exportDemonstrativoImobPDF(linhas: LinhaImobiliario[], titulo: string, subtitulo: string) {
    if (!resultado || linhas.length === 0) return;
    setIsPdfLoading(true);
    try {
      toast.info(`Gerando PDF — ${titulo}...`);
      const totalPrestacao = linhas.reduce((s, l) => s + l.prestacaoTotal, 0);
      const totalJuros = linhas.reduce((s, l) => s + l.juros, 0);
      const totalCorrecao = linhas.reduce((s, l) => s + l.correcaoMonetaria, 0);

      let md = `# ${titulo}\n\n`;
      md += `**Protocolo:** ${resultado.protocoloCalculo}\n`;
      md += `**Data:** ${new Date().toLocaleDateString("pt-BR")}\n\n`;
      md += `${subtitulo}\n\n`;
      md += `| Resumo | Valor |\n|--------|-------|\n`;
      md += `| Primeira prestação | R$ ${linhas[0].prestacaoTotal.toFixed(2)} |\n`;
      md += `| Total de prestações | R$ ${totalPrestacao.toFixed(2)} |\n`;
      md += `| Total de juros | R$ ${totalJuros.toFixed(2)} |\n`;
      md += `| Total de correção monetária | R$ ${totalCorrecao.toFixed(2)} |\n`;
      md += `| Quantidade de parcelas | ${linhas.length} |\n\n`;
      md += `---\n\n## Demonstrativo Completo\n\n`;
      md += `| # | Vencimento | Saldo Ant. | Correção | Juros | Amort. | MIP | DFI | Tx.Adm | Prestação | Saldo |\n`;
      md += `|---|------------|------------|----------|-------|--------|-----|-----|--------|-----------|-------|\n`;
      for (const l of linhas) {
        md += `| ${l.parcela} | ${l.dataVencimento.split("-").reverse().join("/")} | R$ ${l.saldoDevedorAnterior.toFixed(2)} | R$ ${l.correcaoMonetaria.toFixed(2)} | R$ ${l.juros.toFixed(2)} | R$ ${l.amortizacao.toFixed(2)} | R$ ${l.mip.toFixed(2)} | R$ ${l.dfi.toFixed(2)} | R$ ${l.taxaAdministracao.toFixed(2)} | R$ ${l.prestacaoTotal.toFixed(2)} | R$ ${l.saldoDevedorAtual.toFixed(2)} |\n`;
      }

      const response = await fetch("/api/export/parecer-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parecerMarkdown: md, protocolo: resultado.protocoloCalculo }),
      });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      a.download = `${slug}-${resultado.protocoloCalculo || "calc"}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF gerado!");
    } catch { toast.error("Erro ao gerar PDF."); } finally { setIsPdfLoading(false); }
  }

  const analise = resultado?.analiseAbusividade;
  const resumo = resultado?.resumo;
  const dadosParcPagas = resultado?.dadosParcelasPagas;

  const irregularidadesCount = useMemo(() => {
    if (!analise) return 0;
    return analise.irregularidades.length;
  }, [analise]);

  const stepLabels = ["Dados do Imóvel", "Enquadramento", "Contrato", "Confirmação", "Resultado"];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
          <Building2 className="h-6 w-6 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Revisão de Financiamento Imobiliário</h1>
          <p className="text-sm text-muted-foreground">
            Análise completa com MIP, DFI, correção monetária e parecer técnico
          </p>
        </div>
      </div>

      <StepIndicator steps={stepLabels} current={step} />

      {/* ─── STEP 1: Dados do Imóvel ──────────────────────────────────────── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5 text-emerald-600" />
              Dados do Imóvel e Financiamento
            </CardTitle>
            <CardDescription>Informe os dados básicos do imóvel e do financiamento</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="valorImovel">Valor do Imóvel (R$) *</Label>
                <Input id="valorImovel" type="number" step="0.01" placeholder="400.000,00"
                  value={form.valorImovel} onChange={(e) => updateField("valorImovel", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="valorFinanciado">Valor Financiado (R$) *</Label>
                <Input id="valorFinanciado" type="number" step="0.01" placeholder="300.000,00"
                  value={form.valorFinanciado} onChange={(e) => updateField("valorFinanciado", e.target.value)} />
              </div>
            </div>

            {form.valorImovel && form.valorFinanciado && parseFloat(form.valorFinanciado) <= parseFloat(form.valorImovel) && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg text-sm">
                <strong>Entrada:</strong> {formatBRL(parseFloat(form.valorImovel) - parseFloat(form.valorFinanciado))} ({((parseFloat(form.valorImovel) - parseFloat(form.valorFinanciado)) / parseFloat(form.valorImovel) * 100).toFixed(1)}%)
              </div>
            )}

            <Separator />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Sistema de Amortização *</Label>
                <Select value={form.sistemaAmortizacao} onValueChange={(v) => updateField("sistemaAmortizacao", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SAC">SAC — Amortização Constante</SelectItem>
                    <SelectItem value="PRICE">Tabela Price</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {form.sistemaAmortizacao === "SAC"
                    ? "Parcelas decrescentes, amortização constante"
                    : "PMT recalculado mensalmente com correção monetária"}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prazoMeses">Prazo (meses) *</Label>
                <Input id="prazoMeses" type="number" placeholder="360"
                  value={form.prazoMeses} onChange={(e) => updateField("prazoMeses", e.target.value)} />
                {form.prazoMeses && <p className="text-xs text-muted-foreground">{(parseInt(form.prazoMeses) / 12).toFixed(1)} anos</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="taxaJurosAnual">Taxa de Juros Anual (% a.a.) *</Label>
                <Input id="taxaJurosAnual" type="number" step="0.01" placeholder="9.00"
                  value={form.taxaJurosAnual} onChange={(e) => updateField("taxaJurosAnual", e.target.value)} />
                {taxaMensalCalculada && <p className="text-xs text-muted-foreground">Equivalente mensal: {taxaMensalCalculada}% a.m.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="idadeComprador">Idade do Comprador *</Label>
                <Input id="idadeComprador" type="number" min="18" max="80" placeholder="35"
                  value={form.idadeComprador} onChange={(e) => updateField("idadeComprador", e.target.value)} />
                <p className="text-xs text-muted-foreground">Utilizada para calcular o seguro MIP</p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => {
                if (!form.valorImovel || !form.valorFinanciado || !form.taxaJurosAnual || !form.prazoMeses || !form.idadeComprador) {
                  toast.error("Preencha todos os campos obrigatórios.");
                  return;
                }
                if (parseFloat(form.valorFinanciado) > parseFloat(form.valorImovel)) {
                  toast.error("Valor financiado não pode ser superior ao valor do imóvel.");
                  return;
                }
                setStep(2);
              }}>
                Próximo <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── STEP 2: Enquadramento e Tipo de Credor ────────────────────── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-emerald-600" />
              Enquadramento do Contrato
            </CardTitle>
            <CardDescription>Identifique o sistema e o tipo de credor do financiamento</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Auto-detecção */}
            {form.valorImovel && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-sm flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />
                <span>
                  Com imóvel de {formatBRL(parseFloat(form.valorImovel))}, o enquadramento sugerido é{" "}
                  <strong>{parseFloat(form.valorImovel) <= 2250000 ? "SFH" : "SFI"}</strong>.
                  {parseFloat(form.valorImovel) <= 2250000
                    ? " Teto SFH: R$ 2.250.000 (Resolução CMN 5.255/2025)."
                    : " Acima do teto SFH de R$ 2.250.000."}
                </span>
              </div>
            )}

            <div>
              <Label className="mb-3 block font-semibold">Sistema de Financiamento</Label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    (form.enquadramento || (form.valorImovel && parseFloat(form.valorImovel) <= 2250000 ? "SFH" : "SFI")) === "SFH"
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20 ring-1 ring-blue-500"
                      : "border-border hover:border-blue-300"
                  }`}
                  onClick={() => updateField("enquadramento", "SFH")}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                      <Home className="h-5 w-5 text-blue-600" />
                    </div>
                    <span className="font-bold text-lg">SFH</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Sistema Financeiro de Habitação. Teto de 12% a.a. (Lei 8.692/1993). Permite uso de FGTS.</p>
                </button>
                <button
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    (form.enquadramento || (form.valorImovel && parseFloat(form.valorImovel) <= 2250000 ? "SFH" : "SFI")) === "SFI"
                      ? "border-teal-500 bg-teal-50 dark:bg-teal-950/20 ring-1 ring-teal-500"
                      : "border-border hover:border-teal-300"
                  }`}
                  onClick={() => updateField("enquadramento", "SFI")}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900/30">
                      <Building2 className="h-5 w-5 text-teal-600" />
                    </div>
                    <span className="font-bold text-lg">SFI</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Sistema de Financiamento Imobiliário. Sem teto de taxa. Capitalização mensal vedada (REsp 2.086.650/MG).</p>
                </button>
              </div>
            </div>

            <Separator />

            <div>
              <Label className="mb-3 block font-semibold">Tipo de Credor</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    form.tipoCredor === "INSTITUICAO_SFN"
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20 ring-1 ring-blue-500"
                      : "border-border hover:border-blue-300"
                  }`}
                  onClick={() => updateField("tipoCredor", "INSTITUICAO_SFN")}>
                  <div className="flex items-center gap-2 mb-1">
                    <Landmark className="h-4 w-4 text-blue-600" />
                    <span className="font-semibold text-sm">Banco / Caixa</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Instituição do SFN (Caixa, Itaú, BB, Bradesco...)</p>
                </button>
                <button
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    form.tipoCredor === "ENTIDADE_SFI"
                      ? "border-teal-500 bg-teal-50 dark:bg-teal-950/20 ring-1 ring-teal-500"
                      : "border-border hover:border-teal-300"
                  }`}
                  onClick={() => updateField("tipoCredor", "ENTIDADE_SFI")}>
                  <div className="flex items-center gap-2 mb-1">
                    <Briefcase className="h-4 w-4 text-teal-600" />
                    <span className="font-semibold text-sm">Entidade SFI</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Securitizadoras, fundos (não integram o SFN)</p>
                </button>
                <button
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    form.tipoCredor === "INCORPORADORA"
                      ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20 ring-1 ring-amber-500"
                      : "border-border hover:border-amber-300"
                  }`}
                  onClick={() => updateField("tipoCredor", "INCORPORADORA")}>
                  <div className="flex items-center gap-2 mb-1">
                    <HardHat className="h-4 w-4 text-amber-600" />
                    <span className="font-semibold text-sm">Incorporadora</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Construtora, loteadora (financiamento direto)</p>
                </button>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Capitalização expressamente pactuada?</Label>
                <Select value={form.capitalizacaoExpressaPactuada} onValueChange={(v) => updateField("capitalizacaoExpressaPactuada", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim — consta no contrato</SelectItem>
                    <SelectItem value="nao">Não — não há cláusula expressa</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Necessária para Tabela Price ser legal (Súmula 539/STJ)</p>
              </div>
              <div className="space-y-1.5">
                <Label>Livre escolha de seguradora?</Label>
                <Select value={form.seguroLivreEscolha} onValueChange={(v) => updateField("seguroLivreEscolha", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim — pude escolher livremente</SelectItem>
                    <SelectItem value="nao">Não — imposta pelo banco</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Imposição = venda casada (Súmula 473/STJ)</p>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button onClick={() => setStep(3)}>
                Próximo <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── STEP 3: Dados do Contrato ────────────────────────────────────── */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-600" />
              Dados do Contrato
            </CardTitle>
            <CardDescription>Informe as datas, indexador e configurações do contrato</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="dataContrato">Data do Contrato *</Label>
                <Input id="dataContrato" type="date" value={form.dataContrato}
                  onChange={(e) => updateField("dataContrato", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dataPrimeiroVencimento">Primeiro Vencimento *</Label>
                <Input id="dataPrimeiroVencimento" type="date" value={form.dataPrimeiroVencimento}
                  onChange={(e) => updateField("dataPrimeiroVencimento", e.target.value)} />
              </div>
            </div>

            <Separator />

            <div>
              <Label className="mb-3 block">Indexador de Correção Monetária *</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {INDEXADORES.map((idx) => (
                  <button key={idx.key}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      form.indexador === idx.key
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20 ring-1 ring-emerald-500"
                        : "border-border hover:border-emerald-300"
                    }`}
                    onClick={() => { updateField("indexador", idx.key); fetchIndexador(idx.key); }}>
                    <p className="font-medium text-sm">{idx.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{idx.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {form.indexador !== "NENHUM" && (
              <div className="space-y-1.5">
                <Label htmlFor="taxaIndexadorAnual">Taxa do Indexador (% a.a.) *</Label>
                <div className="flex gap-2 items-center">
                  <Input id="taxaIndexadorAnual" type="number" step="0.01" placeholder="Buscando..."
                    value={form.taxaIndexadorAnual} onChange={(e) => { updateField("taxaIndexadorAnual", e.target.value); updateField("indexadorAutoFetched", false as any); }} />
                  <Button variant="outline" size="sm" disabled={indexadorLoading} onClick={() => fetchIndexador(form.indexador)}>
                    {indexadorLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar BACEN"}
                  </Button>
                </div>
                {indexadorInfo && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> {indexadorInfo}
                  </p>
                )}
                {!indexadorInfo && (
                  <p className="text-xs text-muted-foreground">
                    Clique em "Buscar BACEN" para obter a taxa atualizada automaticamente.
                    {form.indexador === "TR" && " TR histórica: 0% a 2% a.a."}
                    {form.indexador === "IPCA" && " IPCA: ~3.5% a 6% a.a."}
                    {form.indexador === "IGPM" && " IGP-M: altamente volátil"}
                    {form.indexador === "IPC" && " IPC-FIPE: ~3% a 5% a.a."}
                    {form.indexador === "POUPANCA" && " Poupança: TR + 0.5% a.m."}
                  </p>
                )}
              </div>
            )}

            <Separator />

            <div className="space-y-1.5">
              <Label htmlFor="parcelasJaPagas">Parcelas Já Pagas (opcional)</Label>
              <Input id="parcelasJaPagas" type="number" min="0" placeholder="0"
                value={form.parcelasJaPagas} onChange={(e) => updateField("parcelasJaPagas", e.target.value)} />
              <p className="text-xs text-muted-foreground">Se informado, calcula o valor pago a mais até o momento</p>
            </div>

            {/* Configurações Avançadas */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="flex items-center gap-2"><Info className="h-4 w-4" /> Configurações Avançadas</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="taxaMIP">Taxa MIP Mensal (%)</Label>
                    <Input id="taxaMIP" type="number" step="0.000001" placeholder="Auto (tabela)"
                      value={form.taxaMIP} onChange={(e) => updateField("taxaMIP", e.target.value)} />
                    <p className="text-xs text-muted-foreground">Se vazio, usa tabela por faixa etária</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="taxaDFI">Taxa DFI Mensal (%)</Label>
                    <Input id="taxaDFI" type="number" step="0.000001" placeholder="0.004684"
                      value={form.taxaDFI} onChange={(e) => updateField("taxaDFI", e.target.value)} />
                    <p className="text-xs text-muted-foreground">Se vazio, usa referência de mercado</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="taxaAdministracao">Taxa Admin. (R$/mês)</Label>
                    <Input id="taxaAdministracao" type="number" step="0.01" placeholder="25.00"
                      value={form.taxaAdministracao} onChange={(e) => updateField("taxaAdministracao", e.target.value)} />
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <Label>Critério de Recálculo</Label>
                  <Select value={form.taxaRecalculo} onValueChange={(v) => updateField("taxaRecalculo", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="media_bacen">Média BACEN (financiamento imobiliário)</SelectItem>
                      <SelectItem value="manual">Taxa manual</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.taxaRecalculo === "manual" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="taxaManualAnual">Taxa Substitutiva (% a.a.)</Label>
                      <Input id="taxaManualAnual" type="number" step="0.01" placeholder="7.00"
                        value={form.taxaManualAnual} onChange={(e) => updateField("taxaManualAnual", e.target.value)} />
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Label>Indexador do Recálculo (opcional)</Label>
                  <Select value={form.indexadorRecalculo || "mesmo"} onValueChange={(v) => updateField("indexadorRecalculo", v === "mesmo" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mesmo">Mesmo do contrato ({INDEXADOR_LABELS[form.indexador]})</SelectItem>
                      {INDEXADORES.map(idx => (
                        <SelectItem key={idx.key} value={idx.key}>{idx.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.indexadorRecalculo && form.indexadorRecalculo !== "NENHUM" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="taxaIndexadorRecalculoAnual">Taxa do Indexador Recálculo (% a.a.)</Label>
                      <Input id="taxaIndexadorRecalculoAnual" type="number" step="0.01" placeholder="1.50"
                        value={form.taxaIndexadorRecalculoAnual} onChange={(e) => updateField("taxaIndexadorRecalculoAnual", e.target.value)} />
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button onClick={() => {
                if (!form.dataContrato || !form.dataPrimeiroVencimento) {
                  toast.error("Preencha as datas obrigatórias.");
                  return;
                }
                if (form.indexador !== "NENHUM" && !form.taxaIndexadorAnual) {
                  toast.error("Informe a taxa do indexador ou clique em 'Buscar BACEN'.");
                  return;
                }
                setStep(4);
              }}>
                Próximo <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── STEP 4: Confirmação ──────────────────────────────────────────── */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-emerald-600" />
              Confirme os Dados
            </CardTitle>
            <CardDescription>Revise os dados antes de executar o cálculo (1 crédito será descontado)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                <h4 className="font-semibold text-sm flex items-center gap-2"><Home className="h-4 w-4" /> Imóvel</h4>
                <div className="text-sm space-y-1">
                  <p>Valor do Imóvel: <strong>{formatBRL(parseFloat(form.valorImovel))}</strong></p>
                  <p>Valor Financiado: <strong>{formatBRL(parseFloat(form.valorFinanciado))}</strong></p>
                  <p>Entrada: <strong>{formatBRL(parseFloat(form.valorImovel) - parseFloat(form.valorFinanciado))}</strong></p>
                </div>
              </div>
              <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                <h4 className="font-semibold text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Contrato</h4>
                <div className="text-sm space-y-1">
                  <p>Sistema: <strong>{form.sistemaAmortizacao}</strong></p>
                  <p>Taxa: <strong>{form.taxaJurosAnual}% a.a.</strong> ({taxaMensalCalculada}% a.m.)</p>
                  <p>Prazo: <strong>{form.prazoMeses} meses</strong> ({(parseInt(form.prazoMeses) / 12).toFixed(1)} anos)</p>
                  <p>Contrato: <strong>{form.dataContrato.split("-").reverse().join("/")}</strong></p>
                </div>
              </div>
              <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                <h4 className="font-semibold text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Correção</h4>
                <div className="text-sm space-y-1">
                  <p>Indexador: <strong>{INDEXADOR_LABELS[form.indexador]}</strong></p>
                  {form.indexador !== "NENHUM" && <p>Taxa: <strong>{form.taxaIndexadorAnual}% a.a.</strong></p>}
                </div>
              </div>
              <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                <h4 className="font-semibold text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Seguros</h4>
                <div className="text-sm space-y-1">
                  <p>Idade: <strong>{form.idadeComprador} anos</strong></p>
                  <p>MIP: <strong>{form.taxaMIP ? `${form.taxaMIP}%` : "Tabela automática"}</strong></p>
                  <p>DFI: <strong>{form.taxaDFI ? `${form.taxaDFI}%` : "Referência de mercado"}</strong></p>
                  <p>Tx. Admin: <strong>R$ {form.taxaAdministracao || "25,00"}/mês</strong></p>
                </div>
              </div>
            </div>

            {form.parcelasJaPagas && parseInt(form.parcelasJaPagas) > 0 && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg text-sm">
                <strong>Parcelas já pagas:</strong> {form.parcelasJaPagas} — será calculado o valor pago a mais
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button onClick={handleSubmit} disabled={calcularMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {calcularMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculando...</>
                ) : (
                  <><Calculator className="h-4 w-4 mr-2" /> Calcular Revisão</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── STEP 5: Resultado ────────────────────────────────────────────── */}
      {step === 5 && resultado && analise && resumo && (
        <div className="space-y-4">
          {/* Resumo rápido */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Diferença Total</p>
              <p className={`text-lg font-bold ${resumo.diferencaTotal > 0 ? "text-red-600" : "text-green-600"}`}>
                {formatBRL(resumo.diferencaTotal)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Repetição Indébito</p>
              <p className="text-lg font-bold text-amber-600">{formatBRL(resumo.repeticaoIndebito)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Irregularidades</p>
              <div className="flex items-center gap-2">
                <p className={`text-lg font-bold ${irregularidadesCount > 0 ? "text-red-600" : "text-green-600"}`}>
                  {irregularidadesCount}
                </p>
                {irregularidadesCount > 0
                  ? <AlertTriangle className="h-4 w-4 text-red-500" />
                  : <CheckCircle className="h-4 w-4 text-green-500" />}
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Protocolo</p>
              <p className="text-sm font-mono font-bold truncate">{resultado.protocoloCalculo}</p>
            </Card>
          </div>

          <Tabs defaultValue="analise">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="analise">Análise</TabsTrigger>
              <TabsTrigger value="demonstrativo">Demonstrativo</TabsTrigger>
              <TabsTrigger value="comparativo">Comparativo</TabsTrigger>
              <TabsTrigger value="parecer">Parecer</TabsTrigger>
            </TabsList>

            {/* Tab: Análise */}
            <TabsContent value="analise">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Análise de Abusividade</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Enquadramento */}
                  <div className="p-4 rounded-lg border bg-muted/20 space-y-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm">Enquadramento</h4>
                      <Badge variant="outline">{analise.enquadramento}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tipo de credor: {analise.tipoCredor === "INSTITUICAO_SFN" ? "Instituição do SFN" : analise.tipoCredor === "ENTIDADE_SFI" ? "Entidade SFI" : "Incorporadora/Loteadora"}
                    </p>
                  </div>

                  {/* Taxa de Juros */}
                  <div className={`p-4 rounded-lg border space-y-2 ${analise.taxaAbusiva ? "border-amber-300 dark:border-amber-800" : ""}`}>
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        <DollarSign className="h-4 w-4" /> Taxa de Juros
                      </h4>
                      <Badge variant={analise.taxaAbusiva ? "outline" : "secondary"} className={analise.taxaAbusiva ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}>
                        {analise.violaTetoSFH ? "Potencial Ilegalidade" : analise.taxaAbusiva ? "Potencialmente Abusiva" : "Regular"}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <p>Contratada: <strong>{formatPercent(analise.taxaContratadaAnual, 2)} a.a.</strong></p>
                      <p>Média BACEN: <strong>{formatPercent(analise.taxaMediaBACEN_anual, 2)} a.a.</strong></p>
                      <p>Mensal calculada: <strong>{formatPercent(analise.taxaContratadaMensal)} a.m.</strong></p>
                      <p>Diferença: <strong>{analise.percentualAcimaDaMedia > 0 ? "+" : ""}{formatPercent(analise.percentualAcimaDaMedia, 1)} da média</strong></p>
                    </div>
                    {analise.violaTetoSFH && (
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                        Teto SFH de {formatPercent(analise.tetoSFH_anual, 0)} a.a. (Lei 8.692/1993, art. 25) — Súmula 422/STJ afasta limitação pelo art. 6º da Lei 4.380/1964.
                      </p>
                    )}
                  </div>

                  {/* Capitalização */}
                  <div className={`p-4 rounded-lg border space-y-2 ${analise.capitalizacao.irregular ? "border-amber-300 dark:border-amber-800" : ""}`}>
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm">Capitalização de Juros</h4>
                      <Badge variant={analise.capitalizacao.irregular ? "outline" : "secondary"} className={analise.capitalizacao.irregular ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}>
                        {analise.capitalizacao.irregular ? "Potencialmente Irregular" : "Regular"}
                      </Badge>
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">Regime: {analise.capitalizacao.regime}</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-line">{analise.capitalizacao.detalhes}</p>
                    <p className="text-xs text-muted-foreground italic">Fundamentação: {analise.capitalizacao.fundamentacao}</p>
                  </div>

                  {/* Seguros */}
                  <div className="p-4 rounded-lg border space-y-2">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <Shield className="h-4 w-4" /> Seguros Obrigatórios
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span>MIP (Morte e Invalidez)</span>
                        <Badge variant={analise.mipAbusivo ? "outline" : "secondary"} className={analise.mipAbusivo ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}>
                          {analise.mipAbusivo ? "Potencialmente Abusivo" : "Regular"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{analise.mipDetalhes}</p>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <span>DFI (Danos Físicos)</span>
                        <Badge variant={analise.dfiAbusivo ? "outline" : "secondary"} className={analise.dfiAbusivo ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}>
                          {analise.dfiAbusivo ? "Potencialmente Abusivo" : "Regular"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{analise.dfiDetalhes}</p>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <span>Venda Casada de Seguro</span>
                        <Badge variant={analise.vendaCasadaSeguro ? "outline" : "secondary"} className={analise.vendaCasadaSeguro ? "border-red-500 text-red-700 dark:text-red-400" : ""}>
                          {analise.vendaCasadaSeguro ? "Venda Casada Detectada" : "Livre Escolha"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{analise.vendaCasadaDetalhes}</p>
                    </div>
                  </div>

                  {/* Taxa Admin e Indexador */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">Taxa de Administração</h4>
                        <Badge variant={analise.taxaAdminAbusiva ? "outline" : "secondary"} className={analise.taxaAdminAbusiva ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}>
                          {analise.taxaAdminAbusiva ? "Potencialmente Abusiva" : "Regular"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{analise.taxaAdminDetalhes}</p>
                    </div>
                    <div className="p-4 rounded-lg border space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">Indexador</h4>
                        <Badge variant={analise.indexadorIrregular ? "outline" : "secondary"} className={analise.indexadorIrregular ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}>
                          {analise.indexadorIrregular ? "Potencialmente Irregular" : "Regular"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{analise.indexadorDetalhes}</p>
                    </div>
                  </div>

                  {/* Irregularidades */}
                  {analise.irregularidades.length > 0 && (
                    <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 space-y-2">
                      <h4 className="font-semibold text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" /> Potenciais Irregularidades ({analise.irregularidades.length})
                      </h4>
                      <ul className="text-sm space-y-1">
                        {analise.irregularidades.map((irr, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-amber-500 mt-0.5">•</span>
                            <span>{irr}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground italic mt-2">
                        A confirmação de abusividade depende de análise judicial no caso concreto.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Demonstrativo */}
            <TabsContent value="demonstrativo" className="space-y-4">
              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div><CardTitle className="text-base">Demonstrativo Original (Contrato)</CardTitle><CardDescription>Evolução do saldo devedor conforme condições contratadas</CardDescription></div>
                  <Button variant="outline" size="sm" disabled={isPdfLoading} onClick={() => exportDemonstrativoImobPDF(resultado.demonstrativoOriginal, "Demonstrativo Original (Contrato)", "Cálculo pelo método original do contrato com correção monetária.")} className="flex items-center gap-2">
                    {isPdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="h-4 w-4" /> PDF</>}
                  </Button>
                </CardHeader>
                <CardContent>
                  <DemonstrativoImobTable linhas={resultado.demonstrativoOriginal} title="" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div><CardTitle className="text-base">Demonstrativo Recalculado</CardTitle><CardDescription>Evolução do saldo devedor com taxa e/ou indexador substitutivos</CardDescription></div>
                  <Button variant="outline" size="sm" disabled={isPdfLoading} onClick={() => exportDemonstrativoImobPDF(resultado.demonstrativoRecalculado, "Demonstrativo Recalculado", "Recálculo com taxa e indexador corrigidos.")} className="flex items-center gap-2">
                    {isPdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="h-4 w-4" /> PDF</>}
                  </Button>
                </CardHeader>
                <CardContent>
                  <DemonstrativoImobTable linhas={resultado.demonstrativoRecalculado} title="" />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Comparativo */}
            <TabsContent value="comparativo">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Resumo Comparativo</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="w-full">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="py-2 px-3 text-left font-medium border-b">Componente</th>
                          <th className="py-2 px-3 text-right font-medium border-b">Original</th>
                          <th className="py-2 px-3 text-right font-medium border-b">Recalculado</th>
                          <th className="py-2 px-3 text-right font-medium border-b">Diferença</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b"><td className="py-2 px-3">Total Pago</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalPagoOriginal)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalPagoRecalculado)}</td><td className="py-2 px-3 text-right font-medium text-red-600">{formatBRL(resumo.diferencaTotal)}</td></tr>
                        <tr className="border-b"><td className="py-2 px-3">Total Juros</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalJurosOriginal)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalJurosRecalculado)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.diferencaJuros)}</td></tr>
                        <tr className="border-b"><td className="py-2 px-3">Total Correção</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalCorrecaoOriginal)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalCorrecaoRecalculado)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.diferencaCorrecao)}</td></tr>
                        <tr className="border-b"><td className="py-2 px-3">Total MIP</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalMIPOriginal)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalMIPRecalculado)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalMIPOriginal - resumo.totalMIPRecalculado)}</td></tr>
                        <tr className="border-b"><td className="py-2 px-3">Total DFI</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalDFIOriginal)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalDFIRecalculado)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalDFIOriginal - resumo.totalDFIRecalculado)}</td></tr>
                        <tr className="border-b"><td className="py-2 px-3">Total Tx. Admin</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalTxAdminOriginal)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalTxAdminRecalculado)}</td><td className="py-2 px-3 text-right">{formatBRL(resumo.totalTxAdminOriginal - resumo.totalTxAdminRecalculado)}</td></tr>
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30 font-bold"><td className="py-2 px-3">Valor Pago a Mais</td><td className="py-2 px-3" colSpan={2}></td><td className="py-2 px-3 text-right text-red-600 text-lg">{formatBRL(resumo.diferencaTotal)}</td></tr>
                        {resumo.repeticaoIndebito > 0 && resumo.diferencaTotal > 0 && (
                          <tr className="bg-amber-50/30 dark:bg-amber-950/10 font-bold"><td className="py-2 px-3">Repetição em Dobro (CDC art. 42)</td><td className="py-2 px-3" colSpan={2}></td><td className="py-2 px-3 text-right text-amber-700 text-lg">{formatBRL(resumo.repeticaoIndebito)}</td></tr>
                        )}
                      </tfoot>
                    </table>
                  </ScrollArea>

                  {dadosParcPagas && (
                    <>
                      <Separator className="my-4" />
                      <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
                        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                          <Calendar className="h-4 w-4" /> Análise de Parcelas Pagas ({dadosParcPagas.parcelasPagas} parcelas)
                        </h4>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <p>Total pago (contrato): <strong>{formatBRL(dadosParcPagas.valorPagoTotal)}</strong></p>
                          <p>Total devido (recálculo): <strong>{formatBRL(dadosParcPagas.valorDevidoRecalculado)}</strong></p>
                          <p className="text-red-600 font-bold col-span-2">Valor pago a mais: {formatBRL(dadosParcPagas.valorPagoAMais)}</p>
                          <p>Saldo devedor (contrato): <strong>{formatBRL(dadosParcPagas.saldoDevedorAtualOriginal)}</strong></p>
                          <p>Saldo devedor (recálculo): <strong>{formatBRL(dadosParcPagas.saldoDevedorAtualRecalculado)}</strong></p>
                          <p>Parcelas restantes: <strong>{dadosParcPagas.parcelasRestantes}</strong></p>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="mt-4 p-3 bg-muted/30 rounded-lg text-sm">
                    <p><strong>Critério de recálculo:</strong> {resultado.criterioRecalculo}</p>
                    <p><strong>Taxa aplicada:</strong> {formatPercent(resultado.taxaRecalculoAplicada, 2)} a.a.</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Parecer Técnico */}
            <TabsContent value="parecer">
              <ParecerEditor
                parecerOriginal={resultado.parecerTecnico}
                protocolo={resultado.protocoloCalculo || undefined}
                filenamePrefix="parecer-imobiliario"
                habilitarCompartilhamento
              />
            </TabsContent>
          </Tabs>

          <div className="flex justify-center">
            <Button variant="outline" onClick={() => {
              setStep(1);
              setResultado(null);
              setTaxaMediaInfo(null);
              setForm(initialForm);
            }}>
              Novo Cálculo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
