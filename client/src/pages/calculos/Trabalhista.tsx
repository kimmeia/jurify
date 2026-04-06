import { useState } from "react";
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
import { Streamdown } from "streamdown";
import {
  Briefcase, Calculator, FileText, Loader2, Plus, Trash2, Clock, Download, Hash,
} from "lucide-react";
import { toast } from "sonner";
import type { TipoRescisao, TipoContrato } from "../../../../shared/trabalhista-types";
import { TIPO_RESCISAO_LABELS, TIPO_CONTRATO_LABELS } from "../../../../shared/trabalhista-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

// ─── Formulário de Rescisão ───────────────────────────────────────────────────

interface RescisaoForm {
  dataAdmissao: string;
  dataDesligamento: string;
  salarioBruto: string;
  tipoRescisao: TipoRescisao;
  tipoContrato: TipoContrato;
  avisoPrevioTrabalhado: boolean;
  avisoPrevioIndenizado: boolean;
  feriasVencidas: boolean;
  periodosFeriasVencidas: string;
  mediaHorasExtras: string;
  mediaComissoes: string;
  saldoFGTS: string;
  adiantamentos: string;
}

const defaultRescisaoForm: RescisaoForm = {
  dataAdmissao: "",
  dataDesligamento: "",
  salarioBruto: "",
  tipoRescisao: "sem_justa_causa",
  tipoContrato: "indeterminado",
  avisoPrevioTrabalhado: false,
  avisoPrevioIndenizado: true,
  feriasVencidas: false,
  periodosFeriasVencidas: "1",
  mediaHorasExtras: "",
  mediaComissoes: "",
  saldoFGTS: "",
  adiantamentos: "",
};

// ─── Formulário de Horas Extras ───────────────────────────────────────────────

interface PeriodoHEForm {
  mesAno: string;
  horasExtras50: string;
  horasExtras100: string;
  horasNoturnas: string;
  salarioBase: string;
}

interface HorasExtrasForm {
  salarioBruto: string;
  cargaHorariaMensal: string;
  incluirAdicionalNoturno: boolean;
  periodos: PeriodoHEForm[];
}

const defaultPeriodoHE: PeriodoHEForm = {
  mesAno: "",
  horasExtras50: "",
  horasExtras100: "0",
  horasNoturnas: "0",
  salarioBase: "",
};

const defaultHorasExtrasForm: HorasExtrasForm = {
  salarioBruto: "",
  cargaHorariaMensal: "220",
  incluirAdicionalNoturno: false,
  periodos: [{ ...defaultPeriodoHE }],
};

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function Trabalhista() {
  const [activeTab, setActiveTab] = useState("rescisao");
  const [rescisaoForm, setRescisaoForm] = useState<RescisaoForm>(defaultRescisaoForm);
  const [heForm, setHEForm] = useState<HorasExtrasForm>(defaultHorasExtrasForm);
  const [resultadoRescisao, setResultadoRescisao] = useState<any>(null);
  const [resultadoHE, setResultadoHE] = useState<any>(null);
  const [isPdfLoadingRescisao, setIsPdfLoadingRescisao] = useState(false);
  const [isPdfLoadingHE, setIsPdfLoadingHE] = useState(false);

  const calcRescisao = trpc.trabalhista.calcularRescisao.useMutation({
    onSuccess: (data) => {
      setResultadoRescisao(data);
      toast.success("Cálculo de rescisão realizado com sucesso!");
    },
    onError: (err) => toast.error(err.message),
  });

  const calcHE = trpc.trabalhista.calcularHorasExtras.useMutation({
    onSuccess: (data) => {
      setResultadoHE(data);
      toast.success("Cálculo de horas extras realizado com sucesso!");
    },
    onError: (err) => toast.error(err.message),
  });

  // ─── Handlers Rescisão ────────────────────────────────────────────────────

  function handleCalcRescisao() {
    if (!rescisaoForm.dataAdmissao || !rescisaoForm.dataDesligamento || !rescisaoForm.salarioBruto) {
      toast.error("Preencha os campos obrigatórios: datas e salário bruto.");
      return;
    }
    calcRescisao.mutate({
      dataAdmissao: rescisaoForm.dataAdmissao,
      dataDesligamento: rescisaoForm.dataDesligamento,
      salarioBruto: parseFloat(rescisaoForm.salarioBruto) || 0,
      tipoRescisao: rescisaoForm.tipoRescisao,
      tipoContrato: rescisaoForm.tipoContrato,
      avisoPrevioTrabalhado: rescisaoForm.avisoPrevioTrabalhado,
      avisoPrevioIndenizado: rescisaoForm.avisoPrevioIndenizado,
      feriasVencidas: rescisaoForm.feriasVencidas,
      periodosFeriasVencidas: parseInt(rescisaoForm.periodosFeriasVencidas) || 1,
      mediaHorasExtras: parseFloat(rescisaoForm.mediaHorasExtras) || undefined,
      mediaComissoes: parseFloat(rescisaoForm.mediaComissoes) || undefined,
      saldoFGTS: rescisaoForm.saldoFGTS.trim() !== "" ? parseFloat(rescisaoForm.saldoFGTS) : undefined,
      adiantamentos: parseFloat(rescisaoForm.adiantamentos) || undefined,
    });
  }

  // ─── Handlers Horas Extras ────────────────────────────────────────────────

  function addPeriodo() {
    setHEForm((f) => ({ ...f, periodos: [...f.periodos, { ...defaultPeriodoHE }] }));
  }

  function removePeriodo(index: number) {
    setHEForm((f) => ({ ...f, periodos: f.periodos.filter((_, i) => i !== index) }));
  }

  function updatePeriodo(index: number, field: keyof PeriodoHEForm, value: string) {
    setHEForm((f) => ({
      ...f,
      periodos: f.periodos.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    }));
  }

  function handleCalcHE() {
    if (!heForm.salarioBruto || heForm.periodos.length === 0) {
      toast.error("Preencha o salário bruto e adicione pelo menos um período.");
      return;
    }
    const validPeriodos = heForm.periodos.filter(p => p.mesAno);
    if (validPeriodos.length === 0) {
      toast.error("Preencha o mês/ano de pelo menos um período.");
      return;
    }
    calcHE.mutate({
      salarioBruto: parseFloat(heForm.salarioBruto) || 0,
      cargaHorariaMensal: parseInt(heForm.cargaHorariaMensal) || 220,
      incluirAdicionalNoturno: heForm.incluirAdicionalNoturno,
      periodos: validPeriodos.map((p) => ({
        mesAno: p.mesAno,
        horasExtras50: parseFloat(p.horasExtras50) || 0,
        horasExtras100: parseFloat(p.horasExtras100) || 0,
        horasNoturnas: parseFloat(p.horasNoturnas) || 0,
        salarioBase: parseFloat(p.salarioBase) || undefined,
      })),
    });
  }

  // ─── Export PDF ───────────────────────────────────────────────────────────

  async function exportPDF(markdown: string, protocolo?: string, setLoading?: (v: boolean) => void) {
    setLoading?.(true);
    try {
      toast.info("Gerando PDF...", { description: "Aguarde enquanto o parecer é preparado." });
      const response = await fetch("/api/export/parecer-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parecerMarkdown: markdown, protocolo }),
      });
      if (!response.ok) throw new Error("Erro ao gerar PDF");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = protocolo ? `parecer-${protocolo}.pdf` : `parecer-trabalhista-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF gerado com sucesso!", { description: `Ficheiro: ${a.download}` });
    } catch {
      toast.error("Erro ao gerar PDF", { description: "Verifique a sua ligação e tente novamente." });
    } finally {
      setLoading?.(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-amber-100 rounded-lg dark:bg-amber-900/30">
          <Briefcase className="h-6 w-6 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Cálculos Trabalhistas</h1>
          <p className="text-muted-foreground text-sm">Rescisão contratual e horas extras com fundamentação na CLT</p>
        </div>
      </div>

      {/* Tabs: Rescisão / Horas Extras */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="rescisao" className="flex items-center gap-2">
            <Briefcase className="h-4 w-4" /> Rescisão Contratual
          </TabsTrigger>
          <TabsTrigger value="horas-extras" className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Horas Extras
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════ TAB: RESCISÃO ═══════════════════════ */}
        <TabsContent value="rescisao" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Dados do Contrato</CardTitle>
              <CardDescription>Preencha os dados do contrato de trabalho para calcular as verbas rescisórias</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Tipo de Rescisão e Contrato */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de Rescisão *</Label>
                  <Select value={rescisaoForm.tipoRescisao} onValueChange={(v) => setRescisaoForm((f) => ({ ...f, tipoRescisao: v as TipoRescisao }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TIPO_RESCISAO_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tipo de Contrato *</Label>
                  <Select value={rescisaoForm.tipoContrato} onValueChange={(v) => setRescisaoForm((f) => ({ ...f, tipoContrato: v as TipoContrato }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TIPO_CONTRATO_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Datas e Salário */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Data de Admissão *</Label>
                  <Input type="date" value={rescisaoForm.dataAdmissao} onChange={(e) => setRescisaoForm((f) => ({ ...f, dataAdmissao: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Data de Desligamento *</Label>
                  <Input type="date" value={rescisaoForm.dataDesligamento} onChange={(e) => setRescisaoForm((f) => ({ ...f, dataDesligamento: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Salário Bruto (R$) *</Label>
                  <Input type="number" step="0.01" placeholder="3500.00" value={rescisaoForm.salarioBruto} onChange={(e) => setRescisaoForm((f) => ({ ...f, salarioBruto: e.target.value }))} />
                </div>
              </div>

              {/* Aviso Prévio */}
              <div className="flex flex-wrap gap-6">
                <div className="flex items-center gap-2">
                  <Switch checked={rescisaoForm.avisoPrevioIndenizado} onCheckedChange={(v) => setRescisaoForm((f) => ({ ...f, avisoPrevioIndenizado: v, avisoPrevioTrabalhado: !v }))} />
                  <Label>Aviso Prévio Indenizado</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={rescisaoForm.feriasVencidas} onCheckedChange={(v) => setRescisaoForm((f) => ({ ...f, feriasVencidas: v }))} />
                  <Label>Possui Férias Vencidas</Label>
                </div>
                {rescisaoForm.feriasVencidas && (
                  <div className="space-y-1">
                    <Label className="text-xs">Períodos Vencidos</Label>
                    <Select value={rescisaoForm.periodosFeriasVencidas} onValueChange={(v) => setRescisaoForm((f) => ({ ...f, periodosFeriasVencidas: v }))}>
                      <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="2">2</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Adicionais */}
              <Separator />
              <p className="text-sm font-medium text-muted-foreground">Campos Adicionais (opcional)</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Horas Extras (R$)</Label>
                  <Input type="number" step="0.01" placeholder="0.00" value={rescisaoForm.mediaHorasExtras} onChange={(e) => setRescisaoForm((f) => ({ ...f, mediaHorasExtras: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Comissões (R$)</Label>
                  <Input type="number" step="0.01" placeholder="0.00" value={rescisaoForm.mediaComissoes} onChange={(e) => setRescisaoForm((f) => ({ ...f, mediaComissoes: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Saldo FGTS (R$)</Label>
                  <Input type="number" step="0.01" placeholder="Estimado se vazio" value={rescisaoForm.saldoFGTS} onChange={(e) => setRescisaoForm((f) => ({ ...f, saldoFGTS: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Adiantamentos (R$)</Label>
                  <Input type="number" step="0.01" placeholder="0.00" value={rescisaoForm.adiantamentos} onChange={(e) => setRescisaoForm((f) => ({ ...f, adiantamentos: e.target.value }))} />
                </div>
              </div>

              <Button onClick={handleCalcRescisao} disabled={calcRescisao.isPending} className="w-full">
                {calcRescisao.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculando...</> : <><Calculator className="h-4 w-4 mr-2" /> Calcular Rescisão</>}
              </Button>
            </CardContent>
          </Card>

          {/* ─── Resultado Rescisão ──────────────────────────────────────── */}
          {resultadoRescisao && (
            <div className="space-y-6">
              <Separator />
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2"><FileText className="h-5 w-5" /> Resultado da Rescisão</h2>
                {resultadoRescisao.protocoloCalculo && (
                  <Badge variant="outline" className="text-xs flex items-center gap-1"><Hash className="h-3 w-3" /> {resultadoRescisao.protocoloCalculo}</Badge>
                )}
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Valor Líquido</p>
                    <p className="text-2xl font-bold text-green-700">{formatBRL(resultadoRescisao.valorLiquido)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Total FGTS + Multa</p>
                    <p className="text-2xl font-bold">{formatBRL(resultadoRescisao.totalFGTS)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Total Proventos</p>
                    <p className="text-lg font-semibold">{formatBRL(resultadoRescisao.totalProventos)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Total Descontos</p>
                    <p className="text-lg font-semibold text-red-600">{formatBRL(resultadoRescisao.totalDescontos)}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Tabs: Verbas / FGTS / Parecer */}
              <Tabs defaultValue="verbas">
                <TabsList>
                  <TabsTrigger value="verbas">Verbas</TabsTrigger>
                  <TabsTrigger value="fgts">FGTS</TabsTrigger>
                  <TabsTrigger value="parecer">Parecer</TabsTrigger>
                </TabsList>

                <TabsContent value="verbas">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="space-y-4">
                        <h3 className="font-semibold text-green-700">Proventos</h3>
                        <div className="space-y-2">
                          {resultadoRescisao.verbas.filter((v: any) => v.tipo === "provento").map((v: any, i: number) => (
                            <div key={i} className="flex justify-between items-center py-2 border-b last:border-0">
                              <div>
                                <p className="text-sm font-medium">{v.descricao}</p>
                                <p className="text-xs text-muted-foreground">{v.fundamentoLegal}</p>
                              </div>
                              <p className="font-semibold text-green-700">{formatBRL(v.valor)}</p>
                            </div>
                          ))}
                        </div>

                        <Separator />

                        <h3 className="font-semibold text-red-600">Descontos</h3>
                        <div className="space-y-2">
                          {resultadoRescisao.verbas.filter((v: any) => v.tipo === "desconto").map((v: any, i: number) => (
                            <div key={i} className="flex justify-between items-center py-2 border-b last:border-0">
                              <div>
                                <p className="text-sm font-medium">{v.descricao}</p>
                                <p className="text-xs text-muted-foreground">{v.fundamentoLegal}</p>
                              </div>
                              <p className="font-semibold text-red-600">- {formatBRL(v.valor)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="fgts">
                  <Card>
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex justify-between py-2 border-b">
                        <span>Saldo FGTS ({resultadoRescisao.fgtsInformado ? "informado" : "estimado"})</span>
                        <span className="font-semibold">{formatBRL(resultadoRescisao.saldoFGTSEstimado)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span>Multa Rescisória FGTS</span>
                        <span className="font-semibold">{formatBRL(resultadoRescisao.multaFGTS)}</span>
                      </div>
                      <div className="flex justify-between py-2 font-bold text-lg">
                        <span>Total FGTS</span>
                        <span>{formatBRL(resultadoRescisao.totalFGTS)}</span>
                      </div>
                      {resultadoRescisao.diasAvisoPrevio > 0 && (
                        <>
                          <Separator />
                          <div className="flex justify-between py-2">
                            <span>Aviso Prévio ({resultadoRescisao.diasAvisoPrevio} dias)</span>
                            <span className="font-semibold">{formatBRL(resultadoRescisao.valorAvisoPrevio)}</span>
                          </div>
                        </>
                      )}
                      <Separator />
                      <div className="text-sm text-muted-foreground">
                        Tempo de serviço: {resultadoRescisao.tempoServico.anos} ano(s), {resultadoRescisao.tempoServico.meses} mês(es) e {resultadoRescisao.tempoServico.dias} dia(s)
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="parecer">
                  <Card>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-base">Parecer Técnico</CardTitle>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPdfLoadingRescisao}
                        onClick={() => exportPDF(resultadoRescisao.parecerTecnico, resultadoRescisao.protocoloCalculo, setIsPdfLoadingRescisao)}
                        className="flex items-center gap-2"
                      >
                        {isPdfLoadingRescisao
                          ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando...</>
                          : <><Download className="h-4 w-4" /> Exportar PDF</>}
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[600px] pr-4">
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <Streamdown>{resultadoRescisao.parecerTecnico}</Streamdown>
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </TabsContent>

        {/* ═══════════════════════ TAB: HORAS EXTRAS ═══════════════════════ */}
        <TabsContent value="horas-extras" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Dados Base</CardTitle>
              <CardDescription>Informe o salário e a carga horária para calcular as horas extras</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Salário Bruto (R$) *</Label>
                  <Input type="number" step="0.01" placeholder="3500.00" value={heForm.salarioBruto} onChange={(e) => setHEForm((f) => ({ ...f, salarioBruto: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Carga Horária Mensal</Label>
                  <Select value={heForm.cargaHorariaMensal} onValueChange={(v) => setHEForm((f) => ({ ...f, cargaHorariaMensal: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="220">220h (padrão CLT)</SelectItem>
                      <SelectItem value="180">180h</SelectItem>
                      <SelectItem value="200">200h</SelectItem>
                      <SelectItem value="150">150h</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch checked={heForm.incluirAdicionalNoturno} onCheckedChange={(v) => setHEForm((f) => ({ ...f, incluirAdicionalNoturno: v }))} />
                  <Label>Incluir Adicional Noturno</Label>
                </div>
              </div>

              {/* Períodos */}
              <Separator />
              <div className="flex items-center justify-between">
                <p className="font-medium">Períodos de Horas Extras</p>
                <Button variant="outline" size="sm" onClick={addPeriodo} className="flex items-center gap-1">
                  <Plus className="h-4 w-4" /> Adicionar Período
                </Button>
              </div>

              <div className="space-y-4">
                {heForm.periodos.map((p, i) => (
                  <div key={i} className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end p-3 border rounded-lg bg-muted/30">
                    <div className="space-y-1">
                      <Label className="text-xs">Mês/Ano *</Label>
                      <Input type="month" value={p.mesAno} onChange={(e) => updatePeriodo(i, "mesAno", e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">HE 50% (horas)</Label>
                      <Input type="number" step="0.5" placeholder="0" value={p.horasExtras50} onChange={(e) => updatePeriodo(i, "horasExtras50", e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">HE 100% (horas)</Label>
                      <Input type="number" step="0.5" placeholder="0" value={p.horasExtras100} onChange={(e) => updatePeriodo(i, "horasExtras100", e.target.value)} />
                    </div>
                    {heForm.incluirAdicionalNoturno && (
                      <div className="space-y-1">
                        <Label className="text-xs">H. Noturnas</Label>
                        <Input type="number" step="0.5" placeholder="0" value={p.horasNoturnas} onChange={(e) => updatePeriodo(i, "horasNoturnas", e.target.value)} />
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">Salário Base (R$)</Label>
                      <Input type="number" step="0.01" placeholder="Mesmo" value={p.salarioBase} onChange={(e) => updatePeriodo(i, "salarioBase", e.target.value)} />
                    </div>
                    <div>
                      {heForm.periodos.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removePeriodo(i)} className="text-red-500 hover:text-red-700">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <Button onClick={handleCalcHE} disabled={calcHE.isPending} className="w-full">
                {calcHE.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculando...</> : <><Calculator className="h-4 w-4 mr-2" /> Calcular Horas Extras</>}
              </Button>
            </CardContent>
          </Card>

          {/* ─── Resultado Horas Extras ──────────────────────────────────── */}
          {resultadoHE && (
            <div className="space-y-6">
              <Separator />
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2"><FileText className="h-5 w-5" /> Resultado Horas Extras</h2>
                {resultadoHE.protocoloCalculo && (
                  <Badge variant="outline" className="text-xs flex items-center gap-1"><Hash className="h-3 w-3" /> {resultadoHE.protocoloCalculo}</Badge>
                )}
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Total com Reflexos</p>
                    <p className="text-2xl font-bold text-blue-700">{formatBRL(resultadoHE.totalComReflexos)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Total Horas Extras</p>
                    <p className="text-lg font-semibold">{formatBRL(resultadoHE.totalGeral)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Total Reflexos</p>
                    <p className="text-lg font-semibold">{formatBRL(resultadoHE.reflexos.totalReflexos)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Valor Hora Normal</p>
                    <p className="text-lg font-semibold">{formatBRL(resultadoHE.valorHoraNormal)}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Tabs: Detalhamento / Reflexos / Parecer */}
              <Tabs defaultValue="detalhamento">
                <TabsList>
                  <TabsTrigger value="detalhamento">Detalhamento</TabsTrigger>
                  <TabsTrigger value="reflexos">Reflexos</TabsTrigger>
                  <TabsTrigger value="parecer-he">Parecer</TabsTrigger>
                </TabsList>

                <TabsContent value="detalhamento">
                  <Card>
                    <CardContent className="pt-4">
                      <ScrollArea className="w-full">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left">
                              <th className="py-2 px-2">Mês/Ano</th>
                              <th className="py-2 px-2 text-right">HE 50%</th>
                              <th className="py-2 px-2 text-right">Valor 50%</th>
                              <th className="py-2 px-2 text-right">HE 100%</th>
                              <th className="py-2 px-2 text-right">Valor 100%</th>
                              <th className="py-2 px-2 text-right">Adic. Not.</th>
                              <th className="py-2 px-2 text-right font-semibold">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {resultadoHE.detalhamentoPeriodos.map((p: any, i: number) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-2 px-2">{p.mesAno}</td>
                                <td className="py-2 px-2 text-right">{p.horasExtras50}h</td>
                                <td className="py-2 px-2 text-right">{formatBRL(p.valorExtras50)}</td>
                                <td className="py-2 px-2 text-right">{p.horasExtras100}h</td>
                                <td className="py-2 px-2 text-right">{formatBRL(p.valorExtras100)}</td>
                                <td className="py-2 px-2 text-right">{formatBRL(p.valorAdicionalNoturno)}</td>
                                <td className="py-2 px-2 text-right font-semibold">{formatBRL(p.totalPeriodo)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="reflexos">
                  <Card>
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex justify-between py-2 border-b">
                        <span>Reflexo em Férias + 1/3</span>
                        <span className="font-semibold">{formatBRL(resultadoHE.reflexos.reflexoFerias)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span>Reflexo em 13º Salário</span>
                        <span className="font-semibold">{formatBRL(resultadoHE.reflexos.reflexo13Salario)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span>Reflexo em FGTS (8%)</span>
                        <span className="font-semibold">{formatBRL(resultadoHE.reflexos.reflexoFGTS)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span>DSR (Descanso Semanal Remunerado)</span>
                        <span className="font-semibold">{formatBRL(resultadoHE.reflexos.reflexoDSR)}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between py-2 font-bold text-lg">
                        <span>Total Reflexos</span>
                        <span>{formatBRL(resultadoHE.reflexos.totalReflexos)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="parecer-he">
                  <Card>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-base">Parecer Técnico</CardTitle>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPdfLoadingHE}
                        onClick={() => exportPDF(resultadoHE.parecerTecnico, resultadoHE.protocoloCalculo, setIsPdfLoadingHE)}
                        className="flex items-center gap-2"
                      >
                        {isPdfLoadingHE
                          ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando...</>
                          : <><Download className="h-4 w-4" /> Exportar PDF</>}
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[600px] pr-4">
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <Streamdown>{resultadoHE.parecerTecnico}</Streamdown>
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
