import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ParecerEditor } from "@/components/calculos/ParecerEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Landmark, Calculator, AlertTriangle, CheckCircle, FileText, Loader2,
  ChevronDown, ChevronUp, ChevronLeft, Info, CreditCard, ShieldAlert,
  Scale, Receipt, Hash, Download, ArrowRight, CircleDollarSign,
  Car, Wallet, Banknote, Building2, PiggyBank, ChevronsRight,
  HelpCircle, XCircle, Percent, User, Briefcase, Shield, HeartPulse,
  Check, CircleCheckBig, Copy,
} from "lucide-react";
import { PulseDot } from "../dashboards/common";
import { toast } from "sonner";
import type {
  ResultadoFinanciamento, LinhaFinanciamento, ModalidadeCredito,
  SistemaAmortizacao, CriterioRecalculo, TipoPessoa, TipoVinculoConsignado,
} from "../../../../shared/financiamento-types";
import { MODALIDADE_LABELS } from "../../../../shared/financiamento-types";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatPercent(value: number, decimals = 4): string {
  return `${value.toFixed(decimals)}%`;
}

// ─── Modalidades com ícones ────────────────────────────────────────────────────

const MODALIDADES = [
  { id: "credito_pessoal" as ModalidadeCredito, label: "Crédito Pessoal", desc: "Empréstimo sem garantia para uso livre", icon: Wallet, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800", ring: "ring-blue-500" },
  { id: "consignado" as ModalidadeCredito, label: "Consignado", desc: "Desconto direto na folha de pagamento", icon: Banknote, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", ring: "ring-emerald-500" },
  { id: "financiamento_veiculo" as ModalidadeCredito, label: "Financiamento de Veículo", desc: "Financiamento com garantia do veículo", icon: Car, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800", ring: "ring-amber-500" },

  { id: "cartao_credito" as ModalidadeCredito, label: "Cartão de Crédito", desc: "Parcelamento ou rotativo do cartão", icon: CreditCard, color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/30", border: "border-rose-200 dark:border-rose-800", ring: "ring-rose-500" },
  { id: "cheque_especial" as ModalidadeCredito, label: "Cheque Especial", desc: "Limite pré-aprovado na conta corrente", icon: Building2, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200 dark:border-orange-800", ring: "ring-orange-500" },
  { id: "capital_giro" as ModalidadeCredito, label: "Capital de Giro", desc: "Crédito para empresas e negócios", icon: PiggyBank, color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950/30", border: "border-teal-200 dark:border-teal-800", ring: "ring-teal-500" },
];

// ─── Form Types ────────────────────────────────────────────────────────────────

interface FormData {
  valorFinanciado: string; taxaJurosMensal: string; taxaJurosAnual: string;
  quantidadeParcelas: string; valorParcela: string; dataContrato: string;
  dataPrimeiroVencimento: string; parcelasJaPagas: string;
  sistemaAmortizacao: SistemaAmortizacao; modalidadeCredito: ModalidadeCredito;
  tipoPessoa: "fisica" | "juridica";
  tipoVinculoConsignado: TipoVinculoConsignado;
  tac: string; tacFinanciada: boolean; tec: string; tecFinanciada: boolean;
  iof: string; iofFinanciado: boolean; seguro: string; seguroFinanciado: boolean;
  seguroLivreEscolha: boolean; avaliacaoBem: string; avaliacaoBemFinanciada: boolean;
  registroContrato: string; registroContratoFinanciado: boolean;
  comissaoPermanencia: string; multaMora: string; jurosMora: string;
  taxaRecalculo: CriterioRecalculo; taxaManual: string;
  anatocismoExpressoPactuado: boolean;
  // Regulamento próprio da categoria (militar, magistrado, servidor estadual, etc)
  temTetoPersonalizado: boolean;
  tetoPersonalizadoMensal: string;
  tetoPersonalizadoFundamento: string;
}

const initialForm: FormData = {
  valorFinanciado: "", taxaJurosMensal: "", taxaJurosAnual: "",
  quantidadeParcelas: "", valorParcela: "", dataContrato: "",
  dataPrimeiroVencimento: "", parcelasJaPagas: "",
  sistemaAmortizacao: "PRICE", modalidadeCredito: "credito_pessoal",
  tipoPessoa: "fisica",
  tipoVinculoConsignado: "clt",
  tac: "", tacFinanciada: false, tec: "", tecFinanciada: false,
  iof: "", iofFinanciado: false, seguro: "", seguroFinanciado: false,
  seguroLivreEscolha: false, avaliacaoBem: "", avaliacaoBemFinanciada: false,
  registroContrato: "", registroContratoFinanciado: false,
  comissaoPermanencia: "", multaMora: "", jurosMora: "",
  taxaRecalculo: "media_bacen", taxaManual: "",
  anatocismoExpressoPactuado: false,
  temTetoPersonalizado: false,
  tetoPersonalizadoMensal: "",
  tetoPersonalizadoFundamento: "",
};

// ─── Small Components ──────────────────────────────────────────────────────────

function Dica({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <HelpCircle className="h-3 w-3 shrink-0" />{children}
    </span>
  );
}

function TarifaField({ label, id, value, financiada, onValueChange, onFinanciadaChange }: {
  label: string; id: string; value: string; financiada: boolean;
  onValueChange: (v: string) => void; onFinanciadaChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label} (R$)</Label>
      <Input id={id} type="number" step="0.01" placeholder="0,00" value={value} onChange={(e) => onValueChange(e.target.value)} />
      <div className="flex items-center gap-2 mt-1">
        <Checkbox id={`${id}-fin`} checked={financiada} onCheckedChange={(v) => onFinanciadaChange(v === true)} disabled={!value || parseFloat(value) <= 0} />
        <Label htmlFor={`${id}-fin`} className="text-xs text-muted-foreground cursor-pointer">Incluída no financiamento</Label>
      </div>
    </div>
  );
}

function DemonstrativoTable({ linhas, title, desc }: { linhas: LinhaFinanciamento[]; title: string; desc: string }) {
  const [expanded, setExpanded] = useState(false);
  const displayLinhas = expanded ? linhas : linhas.slice(0, 6);
  const totalPago = linhas.reduce((s, l) => s + l.valorParcela, 0);
  const totalJuros = linhas.reduce((s, l) => s + l.juros, 0);

  return (
    <div className="space-y-3">
      {title && (
        <div>
          <h4 className="font-semibold text-sm">{title}</h4>
          {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="rounded-lg bg-muted/50 p-3 text-center">
          <p className="text-xs text-muted-foreground">Parcela</p>
          <p className="text-sm font-bold">{linhas.length > 0 ? formatBRL(linhas[0].valorParcela) : "—"}</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-center">
          <p className="text-xs text-muted-foreground">Total pago</p>
          <p className="text-sm font-bold">{formatBRL(totalPago)}</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-center">
          <p className="text-xs text-muted-foreground">Total em juros</p>
          <p className="text-sm font-bold">{formatBRL(totalJuros)}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/60">
              <th className="p-2 text-left font-medium">#</th>
              <th className="p-2 text-left font-medium">Vencimento</th>
              <th className="p-2 text-right font-medium">Saldo</th>
              <th className="p-2 text-right font-medium">Juros</th>
              <th className="p-2 text-right font-medium">Amortização</th>
              <th className="p-2 text-right font-medium">Parcela</th>
              <th className="p-2 text-right font-medium">Saldo Restante</th>
            </tr>
          </thead>
          <tbody>
            {displayLinhas.map((l) => (
              <tr key={l.parcela} className="border-t border-muted/30 hover:bg-muted/20">
                <td className="p-2 text-muted-foreground">{l.parcela}</td>
                <td className="p-2">{l.dataVencimento.split("-").reverse().join("/")}</td>
                <td className="p-2 text-right">{formatBRL(l.saldoDevedorAnterior)}</td>
                <td className="p-2 text-right text-red-600">{formatBRL(l.juros)}</td>
                <td className="p-2 text-right text-emerald-600">{formatBRL(l.amortizacao)}</td>
                <td className="p-2 text-right font-semibold">{formatBRL(l.valorParcela)}</td>
                <td className="p-2 text-right">{formatBRL(l.saldoDevedorAtual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linhas.length > 6 && (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setExpanded(!expanded)}>
          {expanded ? (<><ChevronUp className="h-4 w-4 mr-1" /> Mostrar menos</>) : (<><ChevronDown className="h-4 w-4 mr-1" /> Ver todas as {linhas.length} parcelas</>)}
        </Button>
      )}
    </div>
  );
}

function StepBar({ current }: { current: number }) {
  const steps = ["Modalidade", "Dados do contrato", "Resultado"];
  return (
    <div className="flex items-center justify-end gap-3 text-xs flex-wrap">
      {steps.map((nome, i) => {
        const num = i + 1;
        const concluido = num < current;
        const ativo = num === current;
        return (
          <div key={nome} className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className={`w-6 h-6 rounded-full font-bold flex items-center justify-center text-[11px] ${
                concluido ? "bg-emerald-600 text-white"
                : ativo ? "bg-blue-600 text-white"
                : "bg-slate-200 text-slate-600"
              }`}>
                {concluido ? <Check className="w-3 h-3" /> : num}
              </div>
              <span className={ativo ? "font-medium text-slate-900" : "text-slate-500"}>{nome}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-8 h-px ${concluido ? "bg-emerald-300" : "bg-slate-300"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Hero do submódulo Bancário — sempre visível no topo do wizard
function BancarioHero({ titulo, descricao, passoAtual, totalPassos }: {
  titulo?: string; descricao?: string; passoAtual?: number; totalPassos?: number;
}) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-blue-700 via-indigo-700 to-violet-800 p-6 text-white relative overflow-hidden shadow-lg">
      <Landmark className="absolute -right-6 -bottom-8 w-40 h-40 opacity-10" strokeWidth={1.2} />
      <div className="relative">
        {passoAtual && totalPassos ? (
          <div className="flex items-center gap-2 mb-2">
            <PulseDot />
            <p className="text-xs font-medium text-white/85 uppercase tracking-wider">
              Passo {passoAtual} de {totalPassos}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-1">
            <PulseDot />
            <p className="text-xs font-medium text-white/85 uppercase tracking-wider">Revisão bancária</p>
          </div>
        )}
        {titulo && <h2 className="text-2xl font-bold mb-1">{titulo}</h2>}
        {descricao && <p className="text-sm text-white/80">{descricao}</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function Bancario() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(initialForm);
  const [resultado, setResultado] = useState<ResultadoFinanciamento | null>(null);
  const [taxaMediaInfo, setTaxaMediaInfo] = useState<{ taxaMensal: number; taxaAnual: number; dataReferencia: string; fonte: string } | null>(null);
  const [showCustosExtras, setShowCustosExtras] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);

  const calcularMutation = trpc.financiamento.calcular.useMutation({
    onSuccess: (data) => {
      setResultado(data.resultado);
      setTaxaMediaInfo(data.taxaMediaBACEN);
      setStep(3);
      toast.success("Cálculo realizado com sucesso!");
    },
    onError: (error) => toast.error(`Erro: ${error.message}`),
  });

  const updateField = (field: keyof FormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const selectedModalidade = MODALIDADES.find(m => m.id === form.modalidadeCredito);

  const taxaAnualCalculada = useMemo(() => {
    const mensal = parseFloat(form.taxaJurosMensal);
    if (mensal > 0) return ((Math.pow(1 + mensal / 100, 12) - 1) * 100).toFixed(2);
    return "";
  }, [form.taxaJurosMensal]);

  const handleSubmit = () => {
    if (!form.valorFinanciado || !form.taxaJurosMensal || !form.quantidadeParcelas || !form.dataContrato || !form.dataPrimeiroVencimento) {
      toast.error("Preencha todos os campos obrigatórios marcados com *");
      return;
    }
    calcularMutation.mutate({
      valorFinanciado: parseFloat(form.valorFinanciado),
      taxaJurosMensal: parseFloat(form.taxaJurosMensal),
      taxaJurosAnual: form.taxaJurosAnual ? parseFloat(form.taxaJurosAnual) : 0,
      quantidadeParcelas: parseInt(form.quantidadeParcelas),
      valorParcela: form.valorParcela ? parseFloat(form.valorParcela) : undefined,
      dataContrato: form.dataContrato,
      dataPrimeiroVencimento: form.dataPrimeiroVencimento,
      parcelasJaPagas: form.parcelasJaPagas ? parseInt(form.parcelasJaPagas) : undefined,
      sistemaAmortizacao: form.sistemaAmortizacao,
      modalidadeCredito: form.modalidadeCredito,
      tipoPessoa: form.modalidadeCredito === "financiamento_veiculo" ? form.tipoPessoa : undefined,
      tipoVinculoConsignado: form.modalidadeCredito === "consignado" ? form.tipoVinculoConsignado : undefined,
      tarifas: showCustosExtras ? {
        tac: form.tac ? parseFloat(form.tac) : undefined, tacFinanciada: form.tacFinanciada,
        tec: form.tec ? parseFloat(form.tec) : undefined, tecFinanciada: form.tecFinanciada,
        iof: form.iof ? parseFloat(form.iof) : undefined, iofFinanciado: form.iofFinanciado,
        seguro: form.seguro ? parseFloat(form.seguro) : undefined, seguroFinanciado: form.seguroFinanciado, seguroLivreEscolha: form.seguroLivreEscolha,
        avaliacaoBem: form.avaliacaoBem ? parseFloat(form.avaliacaoBem) : undefined, avaliacaoBemFinanciada: form.avaliacaoBemFinanciada,
        registroContrato: form.registroContrato ? parseFloat(form.registroContrato) : undefined, registroContratoFinanciado: form.registroContratoFinanciado,
      } : undefined,
      comissaoPermanencia: showCustosExtras && form.comissaoPermanencia ? parseFloat(form.comissaoPermanencia) : undefined,
      multaMora: showCustosExtras && form.multaMora ? parseFloat(form.multaMora) : undefined,
      jurosMora: showCustosExtras && form.jurosMora ? parseFloat(form.jurosMora) : undefined,
      taxaRecalculo: form.taxaRecalculo,
      taxaManual: form.taxaRecalculo === "manual" && form.taxaManual ? parseFloat(form.taxaManual) : undefined,
      anatocismoExpressoPactuado: form.anatocismoExpressoPactuado,
      tetoPersonalizado:
        form.modalidadeCredito === "consignado"
          && form.temTetoPersonalizado
          && form.tetoPersonalizadoMensal
          && form.tetoPersonalizadoFundamento.trim().length >= 10
          ? {
              tetoMensal: parseFloat(form.tetoPersonalizadoMensal),
              fundamento: form.tetoPersonalizadoFundamento.trim(),
            }
          : undefined,
    });
  };

  async function exportPDF() {
    if (!resultado) return;
    setIsPdfLoading(true);
    try {
      toast.info("Gerando PDF...");
      const res = await fetch("/api/export/parecer-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parecerMarkdown: resultado.parecerTecnico, protocolo: resultado.protocoloCalculo }) });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = resultado.protocoloCalculo ? `parecer-tecnico-${resultado.protocoloCalculo}.pdf` : `parecer-tecnico.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF gerado com sucesso!");
    } catch { toast.error("Erro ao gerar PDF."); } finally { setIsPdfLoading(false); }
  }

  async function exportDemonstrativoPDF(linhas: LinhaFinanciamento[], titulo: string, subtitulo: string) {
    if (!resultado || linhas.length === 0) return;
    setIsPdfLoading(true);
    try {
      toast.info(`Gerando PDF — ${titulo}...`);
      const totalPago = linhas.reduce((s, l) => s + l.valorParcela, 0);
      const totalJuros = linhas.reduce((s, l) => s + l.juros, 0);

      let md = `# ${titulo}\n\n`;
      md += `**Protocolo:** ${resultado.protocoloCalculo}\n`;
      md += `**Data:** ${new Date().toLocaleDateString("pt-BR")}\n\n`;
      md += `${subtitulo}\n\n`;
      md += `| Resumo | Valor |\n|--------|-------|\n`;
      md += `| Parcela inicial | R$ ${linhas[0].valorParcela.toFixed(2)} |\n`;
      md += `| Total pago | R$ ${totalPago.toFixed(2)} |\n`;
      md += `| Total em juros | R$ ${totalJuros.toFixed(2)} |\n`;
      md += `| Quantidade de parcelas | ${linhas.length} |\n\n`;
      md += `---\n\n## Demonstrativo Completo\n\n`;
      md += `| # | Vencimento | Saldo Anterior | Juros | Amortização | Parcela | Saldo Restante |\n`;
      md += `|---|------------|----------------|-------|-------------|---------|----------------|\n`;
      for (const l of linhas) {
        md += `| ${l.parcela} | ${l.dataVencimento.split("-").reverse().join("/")} | R$ ${l.saldoDevedorAnterior.toFixed(2)} | R$ ${l.juros.toFixed(2)} | R$ ${l.amortizacao.toFixed(2)} | R$ ${l.valorParcela.toFixed(2)} | R$ ${l.saldoDevedorAtual.toFixed(2)} |\n`;
      }

      const res = await fetch("/api/export/parecer-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parecerMarkdown: md, protocolo: resultado.protocoloCalculo }) });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
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
    let c = 0;
    if (analise.taxaAbusiva) c++;
    if (analise.violaTetoLegal) c++; // conta separadamente do abusiva STJ
    if (analise.jurosAcumuladosExcedemPrincipal) c++;
    if (!analise.verificacaoTaxas.taxasEquivalentes && !analise.verificacaoTaxas.anualAutoCalculada) c++;
    if (analise.anatocismoDetectado && !analise.anatocismoExpressoPactuado && !analise.anatocismoPactuadoPorSumula541) c++;
    if (analise.tarifasIlegais.length > 0) c++;
    if (analise.verificacaoEncargosMora.irregularidades.length > 0) c++;
    return c;
  }, [analise]);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1 — ESCOLHA DA MODALIDADE
  // ═══════════════════════════════════════════════════════════════════════════

  if (step === 1) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl bg-gradient-to-br from-slate-50/40 via-white to-blue-50/20 p-6 space-y-5">
          <StepBar current={1} />

          <BancarioHero
            titulo="Qual a modalidade do contrato?"
            descricao="Cada modalidade tem uma taxa média BACEN diferente e tetos legais específicos. Escolha o que está no contrato do seu cliente."
            passoAtual={1}
            totalPassos={3}
          />

          {/* Grid de cards visuais */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {MODALIDADES.map((mod) => {
              const selected = form.modalidadeCredito === mod.id;
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => {
                    updateField("modalidadeCredito", mod.id);
                    if (mod.id !== "financiamento_veiculo") updateField("tipoPessoa", "fisica");
                    if (mod.id !== "consignado") updateField("tipoVinculoConsignado", "clt");
                  }}
                  className={`text-left bg-white rounded-xl p-5 transition-all ${
                    selected
                      ? "border-2 border-blue-500 ring-2 ring-blue-100 shadow-md"
                      : "border border-slate-200 hover:border-blue-400 hover:shadow-md"
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2 ${mod.bg} rounded-lg`}>
                      <mod.icon className={`w-5 h-5 ${mod.color}`} />
                    </div>
                    {mod.id === "credito_pessoal" && (
                      <span className="text-[10px] uppercase font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                        Mais comum
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-slate-900 mb-1">{mod.label}</p>
                  <p className="text-xs text-slate-500">{mod.desc}</p>
                </button>
              );
            })}
          </div>

        {/* Seleção PF/PJ — aparece apenas para Financiamento de Veículo */}
        {form.modalidadeCredito === "financiamento_veiculo" && (
          <div>
            <h2 className="text-lg font-semibold mb-1">Tipo de pessoa</h2>
            <p className="text-sm text-muted-foreground mb-4">O financiamento foi contratado por pessoa física ou jurídica?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { id: "fisica" as TipoPessoa, label: "Pessoa Física", desc: "CPF — financiamento pessoal", icon: User, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800", ring: "ring-blue-500" },
                { id: "juridica" as TipoPessoa, label: "Pessoa Jurídica", desc: "CNPJ — financiamento empresarial", icon: Building2, color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950/30", border: "border-teal-200 dark:border-teal-800", ring: "ring-teal-500" },
              ]).map((tp) => {
                const selected = form.tipoPessoa === tp.id;
                return (
                  <Card key={tp.id} className={`cursor-pointer transition-all hover:shadow-md ${selected ? `${tp.border} ${tp.bg} ring-2 ${tp.ring} shadow-md` : "hover:border-muted-foreground/20"}`} onClick={() => updateField("tipoPessoa", tp.id)}>
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-start gap-3">
                        <div className={`h-10 w-10 rounded-lg ${tp.bg} flex items-center justify-center shrink-0`}>
                          <tp.icon className={`h-5 w-5 ${tp.color}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm">{tp.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{tp.desc}</p>
                        </div>
                        {selected && <CheckCircle className={`h-5 w-5 ${tp.color} shrink-0 ml-auto`} />}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Seleção de Vínculo — aparece apenas para Consignado */}
        {form.modalidadeCredito === "consignado" && (
          <div>
            <h2 className="text-lg font-semibold mb-1">Tipo de vínculo</h2>
            <p className="text-sm text-muted-foreground mb-4">Qual o vínculo do tomador do crédito consignado?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {([
                { id: "clt" as TipoVinculoConsignado, label: "CLT", desc: "Trabalhador com carteira assinada", icon: Briefcase, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800", ring: "ring-blue-500" },
                { id: "servidor_publico" as TipoVinculoConsignado, label: "Servidor Público", desc: "Servidor federal, estadual ou municipal", icon: Building2, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", ring: "ring-emerald-500" },
                { id: "militar" as TipoVinculoConsignado, label: "Militar", desc: "Forças Armadas e forças auxiliares", icon: Shield, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800", ring: "ring-amber-500" },
                { id: "inss" as TipoVinculoConsignado, label: "INSS", desc: "Aposentado ou pensionista do INSS", icon: HeartPulse, color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/30", border: "border-rose-200 dark:border-rose-800", ring: "ring-rose-500" },
              ]).map((vc) => {
                const selected = form.tipoVinculoConsignado === vc.id;
                return (
                  <Card key={vc.id} className={`cursor-pointer transition-all hover:shadow-md ${selected ? `${vc.border} ${vc.bg} ring-2 ${vc.ring} shadow-md` : "hover:border-muted-foreground/20"}`} onClick={() => updateField("tipoVinculoConsignado", vc.id)}>
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-start gap-3">
                        <div className={`h-10 w-10 rounded-lg ${vc.bg} flex items-center justify-center shrink-0`}>
                          <vc.icon className={`h-5 w-5 ${vc.color}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm">{vc.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{vc.desc}</p>
                        </div>
                        {selected && <CheckCircle className={`h-5 w-5 ${vc.color} shrink-0 ml-auto`} />}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Regulamento próprio da categoria — opcional, prevalece sobre regra geral */}
        {form.modalidadeCredito === "consignado" && (
          <Card className="border-dashed">
            <CardContent className="pt-5">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  id="temTetoPersonalizado"
                  checked={form.temTetoPersonalizado}
                  onCheckedChange={(v) => updateField("temTetoPersonalizado", v === true)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold">A categoria profissional tem regulamento próprio?</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Marque se o cliente é militar, magistrado, servidor estadual/municipal, empregado de
                    estatal com ACT específico ou outra categoria com norma própria. O teto informado
                    prevalecerá sobre a regra geral (1,5× BACEN).
                  </p>
                </div>
              </label>

              {form.temTetoPersonalizado && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tetoPersonalizadoMensal">Teto mensal (% a.m.) *</Label>
                    <Input
                      id="tetoPersonalizadoMensal"
                      type="number"
                      step="0.0001"
                      placeholder="Ex: 2.05"
                      value={form.tetoPersonalizadoMensal}
                      onChange={(e) => updateField("tetoPersonalizadoMensal", e.target.value)}
                    />
                    <Dica>Limite máximo permitido pela norma da categoria</Dica>
                  </div>
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label htmlFor="tetoPersonalizadoFundamento">Fundamento legal *</Label>
                    <Input
                      id="tetoPersonalizadoFundamento"
                      type="text"
                      placeholder="Ex: Portaria Normativa MD 1234/2024 — consignado militar"
                      value={form.tetoPersonalizadoFundamento}
                      onChange={(e) => updateField("tetoPersonalizadoFundamento", e.target.value)}
                    />
                    <Dica>Norma que estabelece o teto (lei, portaria, resolução, ACT)</Dica>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

          <div className="flex items-center justify-end border-t border-slate-200 pt-4">
            <Button size="lg" onClick={() => setStep(2)} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 shadow-sm">
              Continuar com {selectedModalidade?.label}{form.modalidadeCredito === "financiamento_veiculo" ? ` (${form.tipoPessoa === "fisica" ? "PF" : "PJ"})` : ""}{form.modalidadeCredito === "consignado" ? ` — ${form.tipoVinculoConsignado === "clt" ? "CLT" : form.tipoVinculoConsignado === "servidor_publico" ? "Servidor Público" : form.tipoVinculoConsignado === "inss" ? "INSS" : "Militar"}` : ""} <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2 — DADOS DO CONTRATO
  // ═══════════════════════════════════════════════════════════════════════════

  if (step === 2) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl bg-gradient-to-br from-slate-50/40 via-white to-blue-50/20 p-6 space-y-5">
          <StepBar current={2} />
          <BancarioHero
            titulo={`Dados do contrato — ${selectedModalidade?.label}`}
            descricao="Preencha os dados que constam no contrato. Os campos com asterisco (*) são obrigatórios."
            passoAtual={2}
            totalPassos={3}
          />

        {/* Informações Principais */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-muted-foreground" /> Informações Principais</CardTitle>
            <CardDescription>Os dados básicos que constam no seu contrato</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="valorFinanciado">Valor financiado (R$) *</Label>
                <Input id="valorFinanciado" type="number" step="0.01" placeholder="Ex: 50000" value={form.valorFinanciado} onChange={(e) => updateField("valorFinanciado", e.target.value)} />
                <Dica>Valor total do empréstimo que consta no contrato</Dica>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quantidadeParcelas">Quantidade de parcelas *</Label>
                <Input id="quantidadeParcelas" type="number" placeholder="Ex: 48" value={form.quantidadeParcelas} onChange={(e) => updateField("quantidadeParcelas", e.target.value)} />
                <Dica>Número total de prestações do contrato</Dica>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="taxaJurosMensal">Taxa mensal (% a.m.) *</Label>
                <Input id="taxaJurosMensal" type="number" step="0.0001" placeholder="Ex: 1.99" value={form.taxaJurosMensal} onChange={(e) => updateField("taxaJurosMensal", e.target.value)} />
                <Dica>Juros mensais que constam no contrato</Dica>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="taxaJurosAnual">Taxa anual do contrato (% a.a.)</Label>
                <Input id="taxaJurosAnual" type="number" step="0.01" placeholder={taxaAnualCalculada ? `Equivalente: ${taxaAnualCalculada}%` : "Para verificação"} value={form.taxaJurosAnual} onChange={(e) => updateField("taxaJurosAnual", e.target.value)} />
                <Dica>
                  {!form.taxaJurosAnual && taxaAnualCalculada
                    ? "Informe a do contrato para verificar se bate com a mensal"
                    : form.taxaJurosAnual && taxaAnualCalculada
                    ? Math.abs(parseFloat(form.taxaJurosAnual) - parseFloat(taxaAnualCalculada)) < 0.05
                      ? "✓ Taxas equivalentes — capitalização mensal regular"
                      : parseFloat(form.taxaJurosAnual) > parseFloat(taxaAnualCalculada)
                      ? "✗ Anual maior que a equivalente — possível capitalização diária"
                      : "✗ Taxas não equivalentes — divergência detectada"
                    : "Preencha para verificar equivalência"}
                </Dica>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="valorParcela">Valor da parcela (R$)</Label>
                <Input id="valorParcela" type="number" step="0.01" placeholder="Para verificação" value={form.valorParcela} onChange={(e) => updateField("valorParcela", e.target.value)} />
                <Dica>Informe para verificar se o banco calculou corretamente</Dica>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="dataContrato">Data do contrato *</Label>
                <Input id="dataContrato" type="date" value={form.dataContrato} onChange={(e) => updateField("dataContrato", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dataPrimeiroVencimento">Primeiro vencimento *</Label>
                <Input id="dataPrimeiroVencimento" type="date" value={form.dataPrimeiroVencimento} onChange={(e) => updateField("dataPrimeiroVencimento", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="parcelasJaPagas">Parcelas já pagas</Label>
                <Input id="parcelasJaPagas" type="number" min="0" placeholder="0" value={form.parcelasJaPagas} onChange={(e) => updateField("parcelasJaPagas", e.target.value)} />
                <Dica>Quantas parcelas você já pagou até agora</Dica>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.anatocismoExpressoPactuado} onCheckedChange={(v) => updateField("anatocismoExpressoPactuado", v)} />
              <div>
                <Label className="text-sm">Juros sobre juros no contrato</Label>
                <p className="text-xs text-muted-foreground">Marque se o contrato prevê capitalização composta</p>
              </div>
            </div>

            {form.sistemaAmortizacao !== "PRICE" ? (
              <div className="space-y-1.5">
                <Label>Sistema de amortização</Label>
                <Select value={form.sistemaAmortizacao} onValueChange={(v) => updateField("sistemaAmortizacao", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRICE">Tabela Price (parcelas fixas)</SelectItem>
                    <SelectItem value="SAC">SAC (parcelas decrescentes)</SelectItem>
                    <SelectItem value="SACRE">SACRE (parcelas crescentes)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                onClick={() => updateField("sistemaAmortizacao", "SAC")}
              >
                Contrato é SAC ou SACRE? Clique para trocar
              </button>
            )}
          </CardContent>
        </Card>

        {/* Custos Extras do Contrato — toggle único */}
        <Card>
          <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowCustosExtras(!showCustosExtras)}>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  Custos extras do contrato
                  <Badge variant="outline" className="text-xs font-normal">Opcional</Badge>
                </CardTitle>
                <CardDescription>
                  Tarifas (TAC, TEC, IOF, seguro) e encargos de atraso — só preencha se constam no contrato
                </CardDescription>
              </div>
              {showCustosExtras ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
            </div>
          </CardHeader>
          {showCustosExtras && (
            <CardContent className="space-y-6">
              {/* Tarifas */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <h4 className="font-semibold text-sm">Tarifas e custos acessórios</h4>
                </div>
                <div className="p-3 rounded-lg bg-blue-50/70 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900">
                  <p className="text-xs text-blue-800 dark:text-blue-300 flex items-start gap-1.5">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Tarifas como TAC e TEC cobradas <strong>após abril/2008</strong> são consideradas ilegais pelo STJ.
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <TarifaField label="TAC" id="tac" value={form.tac} financiada={form.tacFinanciada} onValueChange={(v) => updateField("tac", v)} onFinanciadaChange={(v) => updateField("tacFinanciada", v)} />
                  <TarifaField label="TEC" id="tec" value={form.tec} financiada={form.tecFinanciada} onValueChange={(v) => updateField("tec", v)} onFinanciadaChange={(v) => updateField("tecFinanciada", v)} />
                  <TarifaField label="IOF" id="iof" value={form.iof} financiada={form.iofFinanciado} onValueChange={(v) => updateField("iof", v)} onFinanciadaChange={(v) => updateField("iofFinanciado", v)} />
                  <div className="space-y-1.5">
                    <Label htmlFor="seguro">Seguro (R$)</Label>
                    <Input id="seguro" type="number" step="0.01" placeholder="0,00" value={form.seguro} onChange={(e) => updateField("seguro", e.target.value)} />
                    <div className="flex items-center gap-2 mt-1">
                      <Checkbox id="seguro-fin" checked={form.seguroFinanciado} onCheckedChange={(v) => updateField("seguroFinanciado", v === true)} disabled={!form.seguro || parseFloat(form.seguro) <= 0} />
                      <Label htmlFor="seguro-fin" className="text-xs text-muted-foreground cursor-pointer">Incluída no financiamento</Label>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Checkbox id="seguro-livre" checked={form.seguroLivreEscolha} onCheckedChange={(v) => updateField("seguroLivreEscolha", v === true)} disabled={!form.seguro || parseFloat(form.seguro) <= 0} />
                      <Label htmlFor="seguro-livre" className="text-xs text-muted-foreground cursor-pointer">Pude escolher a seguradora</Label>
                    </div>
                  </div>
                  <TarifaField label="Avaliação do Bem" id="avaliacaoBem" value={form.avaliacaoBem} financiada={form.avaliacaoBemFinanciada} onValueChange={(v) => updateField("avaliacaoBem", v)} onFinanciadaChange={(v) => updateField("avaliacaoBemFinanciada", v)} />
                  <TarifaField label="Registro" id="registroContrato" value={form.registroContrato} financiada={form.registroContratoFinanciado} onValueChange={(v) => updateField("registroContrato", v)} onFinanciadaChange={(v) => updateField("registroContratoFinanciado", v)} />
                </div>
              </div>

              <Separator />

              {/* Encargos de mora */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                  <h4 className="font-semibold text-sm">Encargos de atraso</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="multaMora">Multa por atraso (%)</Label>
                    <Input id="multaMora" type="number" step="0.01" placeholder="2.00" value={form.multaMora} onChange={(e) => updateField("multaMora", e.target.value)} />
                    <Dica>O limite legal é de 2%</Dica>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="jurosMora">Juros de mora (% a.m.)</Label>
                    <Input id="jurosMora" type="number" step="0.01" placeholder="1.00" value={form.jurosMora} onChange={(e) => updateField("jurosMora", e.target.value)} />
                    <Dica>O limite legal é de 1% ao mês</Dica>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="comissaoPermanencia">Comissão de permanência (% a.m.)</Label>
                    <Input id="comissaoPermanencia" type="number" step="0.01" placeholder="0.00" value={form.comissaoPermanencia} onChange={(e) => updateField("comissaoPermanencia", e.target.value)} />
                    <Dica>Não pode ser cobrada junto com multa e juros</Dica>
                  </div>
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Recálculo */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4 text-muted-foreground" /> Como recalcular?</CardTitle>
            <CardDescription>Se a taxa for abusiva, qual critério deve ser usado</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Critério de recálculo</Label>
                <Select value={form.taxaRecalculo} onValueChange={(v) => updateField("taxaRecalculo", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="media_bacen">Taxa média do Banco Central (recomendado)</SelectItem>
                    <SelectItem value="teto_stj">Teto do STJ (1,5× a média)</SelectItem>
                    <SelectItem value="manual">Informar taxa manualmente</SelectItem>
                  </SelectContent>
                </Select>
                <Dica>A taxa média do BACEN é o critério mais aceito pela Justiça</Dica>
              </div>
              {form.taxaRecalculo === "manual" && (
                <div className="space-y-1.5">
                  <Label htmlFor="taxaManual">Taxa manual (% a.m.)</Label>
                  <Input id="taxaManual" type="number" step="0.0001" placeholder="1.50" value={form.taxaManual} onChange={(e) => updateField("taxaManual", e.target.value)} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Calcular */}
        <div className="flex items-center justify-between border-t border-slate-200 pt-4">
          <Button variant="ghost" onClick={() => setStep(1)} className="text-sm">
            <ChevronLeft className="h-4 w-4 mr-1" /> Voltar para modalidade
          </Button>
          <div className="text-right space-y-1">
            <Button size="lg" onClick={handleSubmit} disabled={calcularMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 shadow-sm">
              {calcularMutation.isPending ? (
                <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Analisando...</>
              ) : (
                <><Calculator className="h-5 w-5 mr-2" /> Analisar contrato</>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground">Consome 1 crédito do seu plano</p>
          </div>
        </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3 — RESULTADO
  // ═══════════════════════════════════════════════════════════════════════════

  if (step === 3 && resultado) {
    const temProblema = (resumo?.diferencaTotal ?? 0) > 0;

    return (
      <div className="space-y-6">
        <div className={`rounded-2xl p-6 space-y-5 ${
          temProblema
            ? "bg-gradient-to-br from-slate-50/40 via-white to-rose-50/20"
            : "bg-gradient-to-br from-slate-50/40 via-white to-emerald-50/20"
        }`}>
          <StepBar current={3} />

          {/* Hero gradient — vermelho se abusivo, verde se regular */}
          <div className={`rounded-2xl p-7 text-white relative overflow-hidden shadow-lg ${
            temProblema
              ? "bg-gradient-to-br from-rose-600 via-red-600 to-orange-700"
              : "bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800"
          }`}>
            {temProblema
              ? <AlertTriangle className="absolute -right-8 -bottom-10 w-48 h-48 opacity-10" strokeWidth={1.2} />
              : <CircleCheckBig className="absolute -right-8 -bottom-10 w-48 h-48 opacity-10" strokeWidth={1.2} />}
            <div className="relative">
              <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <PulseDot />
                    <p className="text-xs font-medium text-white/85 uppercase tracking-wider">
                      {temProblema ? "⚠ Potenciais irregularidades encontradas" : "✓ Contrato regular"}
                    </p>
                  </div>
                  <p className="text-xs text-white/70">
                    Protocolo {resultado.protocoloCalculo} · {selectedModalidade?.label}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="ghost" onClick={exportPDF} disabled={isPdfLoading}
                    className="text-white/85 hover:text-white hover:bg-white/15 border border-white/20 h-8 text-xs">
                    {isPdfLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />} PDF
                  </Button>
                  <Button size="sm" onClick={() => { setStep(1); setResultado(null); }}
                    className="bg-white text-slate-900 hover:bg-slate-100 font-semibold shadow-sm h-8">
                    <Copy className="h-3.5 w-3.5 mr-1" /> Nova análise
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
                <div className="lg:col-span-6">
                  <p className="text-sm font-medium text-white/85 mb-1">
                    {temProblema ? "Valor pago a mais (recálculo)" : "Diferença vs. cálculo justo"}
                  </p>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                      {resumo ? formatBRL(resumo.diferencaTotal) : "—"}
                    </span>
                    {temProblema && resumo && resumo.repeticaoIndebito > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-400/25 text-amber-100 border border-amber-300/30">
                        + {formatBRL(resumo.repeticaoIndebito)} em repetição de indébito (2×)
                      </span>
                    )}
                  </div>
                  {analise && (
                    <p className="text-xs text-white/65 mt-2 tabular-nums">
                      Taxa contratada {formatPercent(analise.taxaContratadaMensal)} a.m. ·
                      média BACEN {formatPercent(analise.taxaMediaBACEN_mensal)} a.m.
                      {analise.percentualAcimaDaMedia > 0 ? ` (${formatPercent(analise.percentualAcimaDaMedia, 1)} acima)` : ""}
                    </p>
                  )}
                </div>
                <div className="lg:col-span-6">
                  <p className="text-[10px] text-white/65 uppercase tracking-wider mb-2">Resumo</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                      <p className="text-xs text-white/70 mb-1">Total contrato</p>
                      <p className="text-sm font-bold tabular-nums leading-none">{resumo ? formatBRL(resumo.totalPagoOriginal) : "—"}</p>
                    </div>
                    <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                      <p className="text-xs text-white/70 mb-1">Total justo</p>
                      <p className="text-sm font-bold tabular-nums leading-none text-emerald-200">{resumo ? formatBRL(resumo.totalPagoRecalculado) : "—"}</p>
                    </div>
                    <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                      <p className="text-xs text-white/70 mb-1">Irregularidades</p>
                      <p className="text-sm font-bold tabular-nums leading-none">{irregularidadesCount}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        {/* Parcelas Já Pagas */}
        {dadosParcPagas && dadosParcPagas.parcelasPagas > 0 && (
          <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-blue-600" /> Suas parcelas já pagas</CardTitle>
              <CardDescription>Recálculo considerando o que você já pagou</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div><p className="text-muted-foreground text-xs">Parcelas pagas</p><p className="font-semibold text-lg">{dadosParcPagas.parcelasPagas}</p></div>
                <div><p className="text-muted-foreground text-xs">Você pagou</p><p className="font-semibold">{formatBRL(dadosParcPagas.valorPagoTotal)}</p></div>
                <div><p className="text-muted-foreground text-xs">Deveria ter pago</p><p className="font-semibold">{formatBRL(dadosParcPagas.valorDevidoGauss)}</p></div>
                <div><p className="text-muted-foreground text-xs">Pagou a mais</p><p className="font-bold text-red-600 text-lg">{formatBRL(dadosParcPagas.valorPagoAMais)}</p></div>
              </div>
              <Separator className="my-4" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div><p className="text-muted-foreground text-xs">Sua dívida real</p><p className="font-bold text-lg">{formatBRL(dadosParcPagas.saldoDevedorAtualizado)}</p></div>
                <div><p className="text-muted-foreground text-xs">Parcelas restantes</p><p className="font-semibold text-lg">{dadosParcPagas.parcelasRestantes}</p></div>
                <div><p className="text-muted-foreground text-xs">Nova parcela justa</p><p className="font-bold text-emerald-600 text-lg">{formatBRL(dadosParcPagas.parcelaFinalRecalculada)}</p></div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Repetição Indébito */}
        {resumo && resumo.repeticaoIndebito > 0 && temProblema && (
          <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="pt-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold flex items-center gap-2"><Scale className="h-4 w-4 text-amber-600" /> Você pode receber em dobro</p>
                <p className="text-xs text-muted-foreground mt-1">Pelo Código de Defesa do Consumidor (art. 42), valores indevidos podem ser restituídos em dobro</p>
              </div>
              <p className="text-2xl font-bold text-amber-700 shrink-0 ml-4">{formatBRL(resumo.repeticaoIndebito)}</p>
            </CardContent>
          </Card>
        )}

        {/* BACEN Info */}
        {taxaMediaInfo && (
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center shrink-0"><Landmark className="h-4 w-4 text-blue-600" /></div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Taxa média de mercado (Banco Central)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Para "{selectedModalidade?.label}", a taxa média é de <strong>{formatPercent(taxaMediaInfo.taxaMensal)} ao mês</strong> ({formatPercent(taxaMediaInfo.taxaAnual, 2)} ao ano).
                    {analise?.taxaAbusiva ? " A taxa do seu contrato está acima do limite aceito pela Justiça." : " A taxa do seu contrato está dentro da faixa de mercado."}
                  </p>
                </div>
                <Badge variant={taxaMediaInfo.fonte === "bacen" ? "default" : "secondary"} className="text-xs shrink-0">{taxaMediaInfo.fonte === "bacen" ? "BACEN" : taxaMediaInfo.fonte === "cache" ? "Cache" : "Estimativa"}</Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs Detalhamento */}
        <Tabs defaultValue="analise" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="analise" className="text-xs sm:text-sm">Análise</TabsTrigger>
            <TabsTrigger value="parecer" className="text-xs sm:text-sm">Parecer</TabsTrigger>
            <TabsTrigger value="comparativo" className="text-xs sm:text-sm">Comparativo</TabsTrigger>
            <TabsTrigger value="demonstrativo" className="text-xs sm:text-sm">Demonstrativos</TabsTrigger>
          </TabsList>

          {/* Análise */}
          <TabsContent value="analise" className="space-y-4">
            {analise && (<>
              {/* Taxa */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">{analise.taxaAbusiva ? <XCircle className="h-4 w-4 text-red-500" /> : <CheckCircle className="h-4 w-4 text-emerald-500" />} Taxa de Juros</CardTitle>
                  <CardDescription>{analise.violaTetoLegal ? "A taxa do seu contrato viola o teto legal estabelecido por lei" : analise.jurosAcumuladosExcedemPrincipal ? "Os juros acumulados excedem o limite legal de 100% da dívida" : analise.taxaAbusiva ? "A taxa do seu contrato ultrapassa o limite considerado justo" : "A taxa está dentro dos parâmetros de mercado"}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">Seu contrato</p>
                      <p className="font-bold text-lg">{formatPercent(analise.taxaContratadaMensal)} <span className="text-xs font-normal">a.m.</span></p>
                      <p className="text-xs text-muted-foreground">{formatPercent(analise.taxaContratadaAnual, 2)} a.a.</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">Média do mercado</p>
                      <p className="font-bold text-lg">{formatPercent(analise.taxaMediaBACEN_mensal)} <span className="text-xs font-normal">a.m.</span></p>
                      <p className="text-xs text-muted-foreground">{formatPercent(analise.taxaMediaBACEN_anual, 2)} a.a.</p>
                    </div>
                    {analise.tetoLegal_mensal ? (
                      <div className={`rounded-lg p-3 ${analise.violaTetoLegal ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800" : "bg-muted/50"}`}>
                        <p className="text-xs text-muted-foreground">Teto Legal</p>
                        <p className="font-bold text-lg">{formatPercent(analise.tetoLegal_mensal, 2)} <span className="text-xs font-normal">a.m.</span></p>
                        <p className="text-xs text-muted-foreground">Limite por lei</p>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-muted/50 p-3">
                        <p className="text-xs text-muted-foreground">Limite da Justiça</p>
                        <p className="font-bold text-lg">{formatPercent(analise.tetoSTJ_mensal)} <span className="text-xs font-normal">a.m.</span></p>
                        <p className="text-xs text-muted-foreground">1,5× a média (STJ)</p>
                      </div>
                    )}
                    <div className="rounded-lg p-3 flex items-center justify-center">
                      <Badge variant={analise.taxaAbusiva ? "outline" : "default"} className={`text-sm px-3 py-1 ${analise.taxaAbusiva ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}`}>
                        {analise.violaTetoLegal ? "Potencial Ilegalidade" : analise.jurosAcumuladosExcedemPrincipal ? "Potencial Ilegalidade (>100%)" : analise.taxaAbusiva ? `Potencialmente Abusiva (+${formatPercent(analise.percentualAcimaDaMedia, 1)})` : "Regular"}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* CET */}
              {analise.cet && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2"><Percent className="h-4 w-4 text-muted-foreground" /> Custo Efetivo Total (CET)</CardTitle>
                    <CardDescription>O custo real do financiamento, incluindo todas as taxas e tarifas</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                      <div className="rounded-lg bg-muted/50 p-3 text-center"><p className="text-xs text-muted-foreground">CET Mensal</p><p className="font-bold">{formatPercent(analise.cet.cetMensal)}</p></div>
                      <div className="rounded-lg bg-muted/50 p-3 text-center"><p className="text-xs text-muted-foreground">CET Anual</p><p className="font-bold">{formatPercent(analise.cet.cetAnual, 2)}</p></div>
                      <div className="rounded-lg bg-muted/50 p-3 text-center"><p className="text-xs text-muted-foreground">Taxa Nominal</p><p className="font-bold">{formatPercent(analise.cet.taxaNominalAnual, 2)}</p></div>
                      <div className="rounded-lg bg-muted/50 p-3 text-center"><p className="text-xs text-muted-foreground">Diferença</p><p className="font-bold text-amber-600">+{formatPercent(analise.cet.diferencaCET_vs_Nominal, 2)}</p></div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">O CET é o custo total real. É maior que a taxa do contrato porque inclui todas as tarifas e encargos.</p>
                  </CardContent>
                </Card>
              )}

              {/* Anatocismo */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    {analise.anatocismoDetectado && !analise.anatocismoExpressoPactuado && !analise.anatocismoPactuadoPorSumula541 ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <CheckCircle className="h-4 w-4 text-emerald-500" />}
                    Juros sobre Juros (Anatocismo)
                  </CardTitle>
                  <CardDescription>{analise.anatocismoDetectado ? "Detectamos cobrança de juros compostos no seu contrato" : "Não detectamos cobrança de juros sobre juros"}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  <div className="flex justify-between items-center py-2 border-b"><span className="text-muted-foreground">Juros sobre juros detectado</span><Badge variant={analise.anatocismoDetectado ? "outline" : "secondary"} className={analise.anatocismoDetectado ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}>{analise.anatocismoDetectado ? "Detectado" : "Não"}</Badge></div>
                  {analise.anatocismoDetectado && (<>
                    <div className="flex justify-between items-center py-2 border-b"><span className="text-muted-foreground">Contrato posterior a 2000</span><Badge variant="secondary">{analise.anatocismoPermitido ? "Sim" : "Não"}</Badge></div>
                    <div className="flex justify-between items-center py-2 border-b"><span className="text-muted-foreground">Previsto no contrato</span><Badge variant="secondary">{analise.anatocismoExpressoPactuado ? "Sim" : "Não"}</Badge></div>
                    {analise.anatocismoPactuadoPorSumula541 && <div className="flex justify-between items-center py-2 border-b"><span className="text-muted-foreground">Autorizado pela Súmula 541</span><Badge variant="default">Autorizado</Badge></div>}
                  </>)}
                </CardContent>
              </Card>

              {/* Divergência Taxas */}
              {!analise.verificacaoTaxas.taxasEquivalentes && !analise.verificacaoTaxas.anualAutoCalculada && (
                <Card className="border-amber-200">
                  <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Taxas não conferem</CardTitle></CardHeader>
                  <CardContent className="text-sm"><p className="text-muted-foreground">{analise.verificacaoTaxas.capitalizacaoDetalhes}</p>{analise.verificacaoTaxas.capitalizacaoDiaria && <Badge variant="outline" className="mt-2 border-amber-500 text-amber-700 dark:text-amber-400">Possível cobrança de juros diários</Badge>}</CardContent>
                </Card>
              )}

              {/* Tarifas Ilegais */}
              {analise.tarifasIlegais.length > 0 && (
                <Card className="border-red-200">
                  <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><XCircle className="h-4 w-4 text-red-500" /> Tarifas Ilegais</CardTitle><CardDescription>Estas tarifas não deveriam ter sido cobradas</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    {analise.tarifasIlegais.map((t, i) => (
                      <div key={i} className="flex items-start justify-between p-3 rounded-lg bg-red-50/50 dark:bg-red-950/20 border border-red-100 dark:border-red-900">
                        <div><p className="font-medium text-sm">{t.descricao}</p><p className="text-xs text-muted-foreground mt-0.5">{t.fundamento}</p></div>
                        <span className="font-bold text-red-600 shrink-0 ml-3">{formatBRL(t.valor)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Mora Abusivos */}
              {analise.verificacaoEncargosMora.irregularidades.length > 0 && (
                <Card className="border-red-200">
                  <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-red-500" /> Encargos de Atraso Abusivos</CardTitle></CardHeader>
                  <CardContent className="text-sm space-y-2">
                    {analise.verificacaoEncargosMora.irregularidades.map((irr, i) => (
                      <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-red-50/50 dark:bg-red-950/20 border border-red-100 dark:border-red-900"><AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" /><p>{irr}</p></div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>)}
          </TabsContent>

          {/* Demonstrativos */}
          <TabsContent value="demonstrativo" className="space-y-4">
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div><CardTitle className="text-base">Demonstrativo do Contrato Original</CardTitle><CardDescription>Como o banco calculou suas parcelas (juros compostos — Tabela Price/SAC)</CardDescription></div>
                <Button variant="outline" size="sm" disabled={isPdfLoading} onClick={() => exportDemonstrativoPDF(resultado.demonstrativoOriginal, "Demonstrativo Original (Price)", "Cálculo pelo método original do contrato (juros compostos sobre saldo devedor).")} className="flex items-center gap-2">
                  {isPdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="h-4 w-4" /> PDF</>}
                </Button>
              </CardHeader>
              <CardContent><DemonstrativoTable linhas={resultado.demonstrativoOriginal} title="" desc="" /></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div><CardTitle className="text-base">Demonstrativo Recalculado (Método Gauss)</CardTitle><CardDescription>Como deveria ser calculado com juros simples — parcelas mais justas</CardDescription></div>
                <Button variant="outline" size="sm" disabled={isPdfLoading} onClick={() => exportDemonstrativoPDF(resultado.demonstrativoRecalculado, "Demonstrativo Recalculado (Gauss)", "Recálculo pelo Método Gauss (juros simples com parcelas fixas, sem anatocismo).")} className="flex items-center gap-2">
                  {isPdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="h-4 w-4" /> PDF</>}
                </Button>
              </CardHeader>
              <CardContent><DemonstrativoTable linhas={resultado.demonstrativoRecalculado} title="" desc="" /></CardContent>
            </Card>
          </TabsContent>

          {/* Comparativo */}
          <TabsContent value="comparativo" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div><CardTitle className="text-base">Comparativo: Contrato Atual × Recálculo Justo</CardTitle><CardDescription>Veja lado a lado quanto você paga e quanto deveria pagar</CardDescription></div>
                  <Button variant="outline" size="sm" disabled={isPdfLoading} onClick={exportPDF} className="flex items-center gap-2">
                    {isPdfLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando...</> : <><Download className="h-4 w-4" /> PDF</>}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {resumo && (<>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-muted/60"><th className="p-3 text-left font-medium">Item</th><th className="p-3 text-right font-medium">Contrato Atual</th><th className="p-3 text-right font-medium">Valor Justo</th><th className="p-3 text-right font-medium">Diferença</th></tr></thead>
                      <tbody>
                        {resumo.valorFinanciadoLiquido < resumo.valorFinanciadoOriginal && <tr className="border-t bg-amber-50/30 dark:bg-amber-950/10"><td className="p-3">Valor financiado</td><td className="p-3 text-right">{formatBRL(resumo.valorFinanciadoOriginal)}</td><td className="p-3 text-right">{formatBRL(resumo.valorFinanciadoLiquido)}</td><td className="p-3 text-right font-bold text-amber-600">{formatBRL(resumo.tarifasFinanciadas)}</td></tr>}
                        <tr className="border-t"><td className="p-3">Total de todas as parcelas</td><td className="p-3 text-right">{formatBRL(resumo.totalPagoOriginal)}</td><td className="p-3 text-right text-emerald-700 font-medium">{formatBRL(resumo.totalPagoRecalculado)}</td><td className="p-3 text-right font-bold text-red-600">{formatBRL(resumo.diferencaTotal)}</td></tr>
                        <tr className="border-t"><td className="p-3">Total pago em juros</td><td className="p-3 text-right">{formatBRL(resumo.totalJurosOriginal)}</td><td className="p-3 text-right text-emerald-700 font-medium">{formatBRL(resumo.totalJurosRecalculado)}</td><td className="p-3 text-right font-bold text-red-600">{formatBRL(resumo.diferencaJuros)}</td></tr>
                        {resumo.tarifasIlegais > 0 && <tr className="border-t"><td className="p-3">Tarifas ilegais</td><td className="p-3 text-right">{formatBRL(resumo.tarifasIlegais)}</td><td className="p-3 text-right">—</td><td className="p-3 text-right font-bold text-red-600">{formatBRL(resumo.tarifasIlegais)}</td></tr>}
                        {resumo.encargosAbusivos > 0 && <tr className="border-t"><td className="p-3">Encargos abusivos</td><td className="p-3 text-right">{formatBRL(resumo.encargosAbusivos)}</td><td className="p-3 text-right">—</td><td className="p-3 text-right font-bold text-red-600">{formatBRL(resumo.encargosAbusivos)}</td></tr>}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/60 font-bold border-t-2"><td className="p-3">Total pago a mais</td><td className="p-3" colSpan={2}></td><td className="p-3 text-right text-red-600 text-lg">{formatBRL(resumo.diferencaTotal)}</td></tr>
                        {resumo.repeticaoIndebito > 0 && temProblema && <tr className="bg-amber-50/50 dark:bg-amber-950/10 font-bold"><td className="p-3">Restituição em dobro (CDC art. 42)</td><td className="p-3" colSpan={2}></td><td className="p-3 text-right text-amber-700 text-lg">{formatBRL(resumo.repeticaoIndebito)}</td></tr>}
                      </tfoot>
                    </table>
                  </div>
                  <div className="mt-4 p-4 rounded-lg bg-muted/30 space-y-1.5">
                    <p className="text-sm"><strong>Como recalculamos:</strong> {resultado.criterioRecalculo}</p>
                    <p className="text-sm"><strong>Taxa aplicada:</strong> {formatPercent(resultado.taxaRecalculoAplicada)} ao mês</p>
                    <p className="text-xs text-muted-foreground mt-2">O Método Gauss usa juros simples (sem juros sobre juros), gerando parcelas mais justas. É o método mais aceito pela Justiça como alternativa à Tabela Price.</p>
                  </div>
                </>)}
              </CardContent>
            </Card>

            {/* 4 Cenários */}
            {resultado.comparativo4Cenarios && resultado.comparativo4Cenarios.length > 0 && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Simulação em 4 Cenários</CardTitle><CardDescription>Comparação entre taxas (contrato vs BACEN) e métodos (capitalizado vs juros simples)</CardDescription></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-muted/60"><th className="p-3 text-left font-medium">Cenário</th><th className="p-3 text-right font-medium">Taxa a.m.</th><th className="p-3 text-right font-medium">Parcela</th><th className="p-3 text-right font-medium">Total pago</th><th className="p-3 text-center font-medium">Método</th></tr></thead>
                      <tbody>
                        {resultado.comparativo4Cenarios.map((c, i) => (
                          <tr key={i} className={`border-t ${i === 3 ? "bg-emerald-50/50 dark:bg-emerald-950/10 font-medium" : ""}`}>
                            <td className="p-3">{c.descricao}</td>
                            <td className="p-3 text-right">{formatPercent(c.taxaMensal)}</td>
                            <td className="p-3 text-right">{formatBRL(c.valorParcela)}</td>
                            <td className="p-3 text-right font-semibold">{formatBRL(c.totalPago)}</td>
                            <td className="p-3 text-center"><Badge variant={c.capitalizado ? "outline" : "default"} className="text-xs">{c.capitalizado ? "Composto" : "Simples"}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">O cenário mais favorável ao consumidor é o que combina taxa média BACEN + juros simples (Método Gauss), destacado em verde.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Parecer */}
          <TabsContent value="parecer">
            <ParecerEditor
              parecerOriginal={resultado.parecerTecnico}
              protocolo={resultado.protocoloCalculo}
              filenamePrefix="parecer-tecnico"
            />
          </TabsContent>
        </Tabs>
        </div>
      </div>
    );
  }

  return null;
}
