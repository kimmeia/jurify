/**
 * Trabalhista — Wizard guiado de Rescisão + cálculo de Horas Extras.
 *
 * Padrão visual igual ao Hub /calculos: hero gradient amber/orange,
 * stepper visual, cards de cenário no Step 1, resultado com hero verde
 * e tabs organizados. Substitui o formulão denso de 20+ campos da
 * versão anterior.
 *
 * Wizard de Rescisão (4 passos):
 *   1. Cenário (cards visuais dos 6 tipos de rescisão)
 *   2. Dados básicos (admissão, desligamento, salário, tipo de contrato)
 *   3. Extras (HE, comissões, FGTS informado, adiantamentos, férias vencidas)
 *   4. Resultado (hero verde + tabs: Verbas / FGTS / Parecer)
 *
 * Horas Extras: tela única (não tem cenários distintos como rescisão),
 * mas com mesmo visual hero+card.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ParecerEditor } from "@/components/calculos/ParecerEditor";
import { PulseDot } from "../dashboards/common";
import {
  Briefcase, Calculator, FileText, Loader2, Plus, Trash2, Clock, Hash,
  UserX, Hand, Handshake, AlertOctagon, Gavel, CalendarX,
  ArrowLeft, ArrowRight, ChevronRight, Check, FileDown, Copy, CircleCheckBig,
  PlusCircle, MinusCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { TipoRescisao, TipoContrato } from "../../../../shared/trabalhista-types";
import { TIPO_RESCISAO_LABELS, TIPO_CONTRATO_LABELS } from "../../../../shared/trabalhista-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

// ─── Cenários (Step 1 da Rescisão) ────────────────────────────────────────────

interface Cenario {
  tipo: TipoRescisao;
  icone: React.ComponentType<{ className?: string }>;
  iconeBg: string;
  iconeFg: string;
  curto: string;
  descricao: string;
  direitos: string[];
  badge?: { texto: string; tom: "emerald" | "amber" | "rose" };
}

const CENARIOS: Cenario[] = [
  {
    tipo: "sem_justa_causa",
    icone: UserX,
    iconeBg: "bg-emerald-100", iconeFg: "text-emerald-600",
    curto: "Demissão sem justa causa",
    descricao: "Empregador dispensa o empregado sem motivo grave previsto na CLT.",
    direitos: ["Aviso prévio (30 + 3 dias/ano)", "13º proporcional", "Férias proporcionais + 1/3", "FGTS + multa 40%"],
    badge: { texto: "Mais comum", tom: "emerald" },
  },
  {
    tipo: "pedido_demissao",
    icone: Hand,
    iconeBg: "bg-slate-100", iconeFg: "text-slate-700",
    curto: "Pedido de demissão",
    descricao: "Empregado decide sair por iniciativa própria.",
    direitos: ["✗ Sem aviso indenizado", "✓ 13º proporcional", "✓ Férias proporcionais + 1/3", "✗ Sem multa FGTS"],
  },
  {
    tipo: "acordo_mutuo",
    icone: Handshake,
    iconeBg: "bg-slate-100", iconeFg: "text-slate-700",
    curto: "Acordo mútuo (Reforma)",
    descricao: "Empregador e empregado em acordo (art. 484-A CLT).",
    direitos: ["Aviso prévio 50%", "13º proporcional", "Férias proporcionais + 1/3", "FGTS + multa 20%"],
  },
  {
    tipo: "justa_causa",
    icone: AlertOctagon,
    iconeBg: "bg-rose-100", iconeFg: "text-rose-600",
    curto: "Demissão por justa causa",
    descricao: "Falta grave do empregado (art. 482 CLT).",
    direitos: ["Apenas saldo de salário", "Férias vencidas + 1/3", "✗ Sem 13º proporcional", "✗ Sem multa FGTS"],
  },
  {
    tipo: "rescisao_indireta",
    icone: Gavel,
    iconeBg: "bg-rose-100", iconeFg: "text-rose-600",
    curto: "Rescisão indireta",
    descricao: "Falta grave do empregador (art. 483 CLT) — \"justa causa do patrão\".",
    direitos: ["Mesmos direitos da demissão sem justa causa", "Requer ação judicial"],
  },
  {
    tipo: "termino_contrato",
    icone: CalendarX,
    iconeBg: "bg-slate-100", iconeFg: "text-slate-700",
    curto: "Término de contrato",
    descricao: "Contrato com prazo determinado chegou ao fim.",
    direitos: ["13º proporcional", "Férias proporcionais + 1/3", "✗ Sem aviso prévio", "✗ Sem multa FGTS"],
  },
];

// ─── Formulário ────────────────────────────────────────────────────────────────

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
  dataAdmissao: "", dataDesligamento: "", salarioBruto: "",
  tipoRescisao: "sem_justa_causa", tipoContrato: "indeterminado",
  avisoPrevioTrabalhado: false, avisoPrevioIndenizado: true,
  feriasVencidas: false, periodosFeriasVencidas: "1",
  mediaHorasExtras: "", mediaComissoes: "", saldoFGTS: "", adiantamentos: "",
};

interface PeriodoHEForm {
  mesAno: string; horasExtras50: string; horasExtras100: string;
  horasNoturnas: string; salarioBase: string;
}

interface HorasExtrasForm {
  salarioBruto: string; cargaHorariaMensal: string;
  incluirAdicionalNoturno: boolean; periodos: PeriodoHEForm[];
}

const defaultPeriodoHE: PeriodoHEForm = {
  mesAno: "", horasExtras50: "", horasExtras100: "0", horasNoturnas: "0", salarioBase: "",
};

const defaultHorasExtrasForm: HorasExtrasForm = {
  salarioBruto: "", cargaHorariaMensal: "220",
  incluirAdicionalNoturno: false, periodos: [{ ...defaultPeriodoHE }],
};

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function Trabalhista() {
  const [activeTab, setActiveTab] = useState<"rescisao" | "horas-extras">("rescisao");
  const [stepRescisao, setStepRescisao] = useState<1 | 2 | 3 | 4>(1);
  const [rescisaoForm, setRescisaoForm] = useState<RescisaoForm>(defaultRescisaoForm);
  const [heForm, setHEForm] = useState<HorasExtrasForm>(defaultHorasExtrasForm);
  const [resultadoRescisao, setResultadoRescisao] = useState<any>(null);
  const [resultadoHE, setResultadoHE] = useState<any>(null);
  const [revisorNome, setRevisorNome] = useState("");
  const [revisorOab, setRevisorOab] = useState("");

  const calcRescisao = trpc.trabalhista.calcularRescisao.useMutation({
    onSuccess: (data) => {
      setResultadoRescisao(data);
      setStepRescisao(4);
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

  const cenarioSelecionado = useMemo(
    () => CENARIOS.find((c) => c.tipo === rescisaoForm.tipoRescisao),
    [rescisaoForm.tipoRescisao],
  );

  function handleCalcRescisao() {
    if (!rescisaoForm.dataAdmissao || !rescisaoForm.dataDesligamento || !rescisaoForm.salarioBruto) {
      toast.error("Preencha datas e salário bruto antes de calcular.");
      setStepRescisao(2);
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

  function resetWizard() {
    setRescisaoForm(defaultRescisaoForm);
    setResultadoRescisao(null);
    setStepRescisao(1);
  }

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
    const validPeriodos = heForm.periodos.filter((p) => p.mesAno);
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

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="rounded-2xl bg-gradient-to-br from-slate-50/40 via-white to-amber-50/20 p-6 space-y-5">
        {/* HERO */}
        <div className="rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-rose-700 p-6 text-white relative overflow-hidden shadow-lg">
          <Briefcase className="absolute -right-8 -bottom-10 w-48 h-48 opacity-10" strokeWidth={1.2} />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <PulseDot />
              <p className="text-xs font-medium text-white/85 uppercase tracking-wider">Cálculos trabalhistas</p>
            </div>
            <p className="text-xs text-white/70">Rescisão · Horas extras · Fundamentação CLT + Súmulas TST</p>
          </div>
        </div>

        {/* TABS */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "rescisao" | "horas-extras")}>
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="rescisao" className="flex items-center gap-2">
              <Briefcase className="h-4 w-4" /> Rescisão
            </TabsTrigger>
            <TabsTrigger value="horas-extras" className="flex items-center gap-2">
              <Clock className="h-4 w-4" /> Horas extras
            </TabsTrigger>
          </TabsList>

          {/* ═══════════════════════ TAB RESCISÃO (wizard) ═══════════════════════ */}
          <TabsContent value="rescisao" className="space-y-5 mt-5">
            {/* Stepper */}
            <Stepper passos={["Cenário", "Dados básicos", "Extras", "Resultado"]} atual={stepRescisao} />

            {/* ─── STEP 1: Cenário ─── */}
            {stepRescisao === 1 && (
              <div className="space-y-5">
                <SubHero
                  titulo="Qual o tipo de rescisão?"
                  descricao="Cada tipo tem direitos e descontos diferentes. Escolha o que mais se aproxima do caso do seu cliente."
                  passoAtual={1}
                  totalPassos={4}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {CENARIOS.map((c) => {
                    const ativo = rescisaoForm.tipoRescisao === c.tipo;
                    const Icone = c.icone;
                    return (
                      <button
                        key={c.tipo}
                        type="button"
                        onClick={() => setRescisaoForm((f) => ({ ...f, tipoRescisao: c.tipo }))}
                        className={`text-left bg-white rounded-xl p-5 transition-all ${
                          ativo
                            ? "border-2 border-amber-500 ring-2 ring-amber-100 shadow-md"
                            : "border border-slate-200 hover:border-amber-400 hover:shadow-md"
                        }`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className={`p-2 ${c.iconeBg} rounded-lg`}>
                            <Icone className={`w-5 h-5 ${c.iconeFg}`} />
                          </div>
                          {c.badge && (
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                              c.badge.tom === "emerald" ? "bg-emerald-100 text-emerald-700"
                              : c.badge.tom === "amber" ? "bg-amber-100 text-amber-700"
                              : "bg-rose-100 text-rose-700"
                            }`}>
                              {c.badge.texto}
                            </span>
                          )}
                        </div>
                        <p className="font-semibold text-slate-900 mb-1">{c.curto}</p>
                        <p className="text-xs text-slate-500 mb-3">{c.descricao}</p>
                        <ul className="text-[11px] text-slate-600 space-y-0.5">
                          {c.direitos.map((d, i) => (
                            <li key={i}>{d.startsWith("✗") || d.startsWith("✓") ? d : `✓ ${d}`}</li>
                          ))}
                        </ul>
                      </button>
                    );
                  })}
                </div>
                <NavWizard
                  onVoltar={null}
                  proxima={`Continuar com "${cenarioSelecionado?.curto ?? ""}"`}
                  onProximo={() => setStepRescisao(2)}
                />
              </div>
            )}

            {/* ─── STEP 2: Dados básicos ─── */}
            {stepRescisao === 2 && (
              <div className="space-y-5">
                <SubHero
                  titulo="Dados básicos do contrato"
                  descricao="Datas e salário. Esses três campos são obrigatórios."
                  passoAtual={2}
                  totalPassos={4}
                />
                <Card>
                  <CardContent className="pt-6 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <Label>Data de admissão *</Label>
                        <Input type="date" value={rescisaoForm.dataAdmissao}
                          onChange={(e) => setRescisaoForm((f) => ({ ...f, dataAdmissao: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Data de desligamento *</Label>
                        <Input type="date" value={rescisaoForm.dataDesligamento}
                          onChange={(e) => setRescisaoForm((f) => ({ ...f, dataDesligamento: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Salário bruto (R$) *</Label>
                        <Input type="number" step="0.01" placeholder="3500,00" value={rescisaoForm.salarioBruto}
                          onChange={(e) => setRescisaoForm((f) => ({ ...f, salarioBruto: e.target.value }))} />
                      </div>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Tipo de contrato</Label>
                        <Select value={rescisaoForm.tipoContrato}
                          onValueChange={(v) => setRescisaoForm((f) => ({ ...f, tipoContrato: v as TipoContrato }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(TIPO_CONTRATO_LABELS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Tipo de rescisão (selecionado no passo 1)</Label>
                        <div className="h-9 px-3 flex items-center text-sm border border-slate-200 rounded-md bg-slate-50">
                          {TIPO_RESCISAO_LABELS[rescisaoForm.tipoRescisao]}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <NavWizard
                  voltar="Voltar para cenário" onVoltar={() => setStepRescisao(1)}
                  proxima="Continuar para extras" onProximo={() => setStepRescisao(3)}
                />
              </div>
            )}

            {/* ─── STEP 3: Extras ─── */}
            {stepRescisao === 3 && (
              <div className="space-y-5">
                <SubHero
                  titulo="Detalhes adicionais (opcional)"
                  descricao="Tudo aqui é opcional. Preencha só o que se aplica ao caso. Se não souber, pule."
                  passoAtual={3}
                  totalPassos={4}
                />
                <Card>
                  <CardContent className="pt-6 space-y-5">
                    <div>
                      <p className="text-sm font-semibold mb-3">Aviso prévio</p>
                      <div className="flex flex-wrap gap-6">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={rescisaoForm.avisoPrevioIndenizado}
                            onCheckedChange={(v) => setRescisaoForm((f) => ({ ...f, avisoPrevioIndenizado: v, avisoPrevioTrabalhado: !v }))}
                          />
                          <Label>Aviso prévio indenizado</Label>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <p className="text-sm font-semibold mb-3">Férias vencidas</p>
                      <div className="flex flex-wrap items-end gap-6">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={rescisaoForm.feriasVencidas}
                            onCheckedChange={(v) => setRescisaoForm((f) => ({ ...f, feriasVencidas: v }))}
                          />
                          <Label>Possui férias vencidas</Label>
                        </div>
                        {rescisaoForm.feriasVencidas && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Períodos vencidos</Label>
                            <Select value={rescisaoForm.periodosFeriasVencidas}
                              onValueChange={(v) => setRescisaoForm((f) => ({ ...f, periodosFeriasVencidas: v }))}>
                              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1">1</SelectItem>
                                <SelectItem value="2">2</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <p className="text-sm font-semibold mb-3">Valores médios mensais (R$)</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Horas extras (média)</Label>
                          <Input type="number" step="0.01" placeholder="0,00" value={rescisaoForm.mediaHorasExtras}
                            onChange={(e) => setRescisaoForm((f) => ({ ...f, mediaHorasExtras: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Comissões (média)</Label>
                          <Input type="number" step="0.01" placeholder="0,00" value={rescisaoForm.mediaComissoes}
                            onChange={(e) => setRescisaoForm((f) => ({ ...f, mediaComissoes: e.target.value }))} />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <p className="text-sm font-semibold mb-3">Outros valores (R$)</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Saldo FGTS informado</Label>
                          <Input type="number" step="0.01" placeholder="Deixe vazio para estimar" value={rescisaoForm.saldoFGTS}
                            onChange={(e) => setRescisaoForm((f) => ({ ...f, saldoFGTS: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Adiantamentos a descontar</Label>
                          <Input type="number" step="0.01" placeholder="0,00" value={rescisaoForm.adiantamentos}
                            onChange={(e) => setRescisaoForm((f) => ({ ...f, adiantamentos: e.target.value }))} />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <NavWizard
                  voltar="Voltar para dados" onVoltar={() => setStepRescisao(2)}
                  proxima={
                    calcRescisao.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculando...</>
                    ) : (
                      <><Calculator className="h-4 w-4 mr-2" /> Calcular rescisão</>
                    )
                  }
                  onProximo={handleCalcRescisao}
                  proximoDesabilitado={calcRescisao.isPending}
                />
              </div>
            )}

            {/* ─── STEP 4: Resultado ─── */}
            {stepRescisao === 4 && resultadoRescisao && (
              <ResultadoRescisao
                resultado={resultadoRescisao}
                cenario={cenarioSelecionado}
                revisorNome={revisorNome} onRevisorNomeChange={setRevisorNome}
                revisorOab={revisorOab} onRevisorOabChange={setRevisorOab}
                onNovo={resetWizard}
                onEditar={() => setStepRescisao(2)}
              />
            )}
          </TabsContent>

          {/* ═══════════════════════ TAB HORAS EXTRAS ═══════════════════════ */}
          <TabsContent value="horas-extras" className="space-y-5 mt-5">
            <SubHero
              titulo="Cálculo de horas extras"
              descricao="Informe o salário base e os períodos com horas extras. O sistema calcula HE 50%, 100%, adicional noturno, DSR e reflexos automaticamente."
            />
            <Card>
              <CardContent className="pt-6 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Salário bruto (R$) *</Label>
                    <Input type="number" step="0.01" placeholder="3500,00" value={heForm.salarioBruto}
                      onChange={(e) => setHEForm((f) => ({ ...f, salarioBruto: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Carga horária mensal</Label>
                    <Select value={heForm.cargaHorariaMensal}
                      onValueChange={(v) => setHEForm((f) => ({ ...f, cargaHorariaMensal: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="220">220h (padrão CLT)</SelectItem>
                        <SelectItem value="200">200h</SelectItem>
                        <SelectItem value="180">180h</SelectItem>
                        <SelectItem value="150">150h</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch checked={heForm.incluirAdicionalNoturno}
                    onCheckedChange={(v) => setHEForm((f) => ({ ...f, incluirAdicionalNoturno: v }))} />
                  <Label>Incluir adicional noturno</Label>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm">Períodos de horas extras</p>
                  <Button variant="outline" size="sm" onClick={addPeriodo}>
                    <Plus className="h-4 w-4 mr-1" /> Adicionar período
                  </Button>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="p-2 text-left font-medium text-xs">Mês/Ano *</th>
                        <th className="p-2 text-left font-medium text-xs">HE 50%</th>
                        <th className="p-2 text-left font-medium text-xs">HE 100%</th>
                        {heForm.incluirAdicionalNoturno && (
                          <th className="p-2 text-left font-medium text-xs">H. noturnas</th>
                        )}
                        <th className="p-2 text-left font-medium text-xs">Salário base</th>
                        <th className="p-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {heForm.periodos.map((p, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-1.5">
                            <Input className="h-8" type="month" value={p.mesAno}
                              onChange={(e) => updatePeriodo(i, "mesAno", e.target.value)} />
                          </td>
                          <td className="p-1.5">
                            <Input className="h-8" type="number" step="0.5" placeholder="0" value={p.horasExtras50}
                              onChange={(e) => updatePeriodo(i, "horasExtras50", e.target.value)} />
                          </td>
                          <td className="p-1.5">
                            <Input className="h-8" type="number" step="0.5" placeholder="0" value={p.horasExtras100}
                              onChange={(e) => updatePeriodo(i, "horasExtras100", e.target.value)} />
                          </td>
                          {heForm.incluirAdicionalNoturno && (
                            <td className="p-1.5">
                              <Input className="h-8" type="number" step="0.5" placeholder="0" value={p.horasNoturnas}
                                onChange={(e) => updatePeriodo(i, "horasNoturnas", e.target.value)} />
                            </td>
                          )}
                          <td className="p-1.5">
                            <Input className="h-8" type="number" step="0.01" placeholder="igual ao base" value={p.salarioBase}
                              onChange={(e) => updatePeriodo(i, "salarioBase", e.target.value)} />
                          </td>
                          <td className="p-1.5 text-right">
                            {heForm.periodos.length > 1 && (
                              <Button variant="ghost" size="sm" onClick={() => removePeriodo(i)} className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Button onClick={handleCalcHE} disabled={calcHE.isPending} className="w-full bg-amber-600 hover:bg-amber-700">
                  {calcHE.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculando...</>
                  ) : (
                    <><Calculator className="h-4 w-4 mr-2" /> Calcular horas extras</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {resultadoHE && (
              <ResultadoHorasExtras
                resultado={resultadoHE}
                revisorNome={revisorNome} onRevisorNomeChange={setRevisorNome}
                revisorOab={revisorOab} onRevisorOabChange={setRevisorOab}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function Stepper({ passos, atual }: { passos: string[]; atual: number }) {
  return (
    <div className="flex items-center justify-end gap-3 text-xs flex-wrap">
      {passos.map((nome, i) => {
        const num = i + 1;
        const concluido = num < atual;
        const ativo = num === atual;
        return (
          <div key={nome} className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className={`w-6 h-6 rounded-full font-bold flex items-center justify-center text-[11px] ${
                concluido ? "bg-emerald-600 text-white"
                : ativo ? "bg-amber-600 text-white"
                : "bg-slate-200 text-slate-600"
              }`}>
                {concluido ? <Check className="w-3 h-3" /> : num}
              </div>
              <span className={ativo ? "font-medium text-slate-900" : "text-slate-500"}>{nome}</span>
            </div>
            {i < passos.length - 1 && (
              <div className={`w-8 h-px ${concluido ? "bg-emerald-300" : "bg-slate-300"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SubHero({ titulo, descricao, passoAtual, totalPassos }: {
  titulo: string; descricao: string; passoAtual?: number; totalPassos?: number;
}) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-rose-700 p-6 text-white relative overflow-hidden shadow-lg">
      <Briefcase className="absolute -right-6 -bottom-8 w-40 h-40 opacity-10" strokeWidth={1.2} />
      <div className="relative">
        {passoAtual && totalPassos && (
          <div className="flex items-center gap-2 mb-2">
            <PulseDot />
            <p className="text-xs font-medium text-white/85 uppercase tracking-wider">
              Passo {passoAtual} de {totalPassos}
            </p>
          </div>
        )}
        <h2 className="text-2xl font-bold mb-1">{titulo}</h2>
        <p className="text-sm text-white/80">{descricao}</p>
      </div>
    </div>
  );
}

function NavWizard({
  voltar, onVoltar, proxima, onProximo, proximoDesabilitado,
}: {
  voltar?: string; onVoltar: null | (() => void);
  proxima: React.ReactNode; onProximo: () => void;
  proximoDesabilitado?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-t border-slate-200 pt-4">
      {onVoltar ? (
        <Button variant="ghost" onClick={onVoltar} className="text-sm">
          <ArrowLeft className="h-4 w-4 mr-1" /> {voltar}
        </Button>
      ) : (
        <span />
      )}
      <Button
        onClick={onProximo}
        disabled={proximoDesabilitado}
        className="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-6 py-2.5 shadow-sm"
      >
        {proxima}
        {typeof proxima === "string" && <ArrowRight className="h-4 w-4 ml-2" />}
      </Button>
    </div>
  );
}

// ─── Resultado da Rescisão ───────────────────────────────────────────────────

function ResultadoRescisao({
  resultado, cenario, revisorNome, onRevisorNomeChange, revisorOab, onRevisorOabChange,
  onNovo, onEditar,
}: {
  resultado: any; cenario: Cenario | undefined;
  revisorNome: string; onRevisorNomeChange: (s: string) => void;
  revisorOab: string; onRevisorOabChange: (s: string) => void;
  onNovo: () => void; onEditar: () => void;
}) {
  const proventos = resultado.verbas.filter((v: any) => v.tipo === "provento");
  const descontos = resultado.verbas.filter((v: any) => v.tipo === "desconto");

  return (
    <div className="space-y-5">
      {/* Hero verde de sucesso */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-7 text-white relative overflow-hidden shadow-lg">
        <CircleCheckBig className="absolute -right-8 -bottom-10 w-48 h-48 opacity-10" strokeWidth={1.2} />
        <div className="relative">
          <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <PulseDot />
                <p className="text-xs font-medium text-white/85 uppercase tracking-wider">Cálculo concluído</p>
              </div>
              <p className="text-xs text-white/70">
                Protocolo {resultado.protocoloCalculo} · {cenario?.curto}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="ghost" onClick={onEditar}
                className="text-white/85 hover:text-white hover:bg-white/15 border border-white/20 h-8 text-xs">
                Editar dados
              </Button>
              <Button size="sm" onClick={onNovo}
                className="bg-white text-slate-900 hover:bg-slate-100 font-semibold shadow-sm h-8">
                <Copy className="h-3.5 w-3.5 mr-1" /> Novo cálculo
              </Button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
            <div className="lg:col-span-6">
              <p className="text-sm font-medium text-white/85 mb-1">Valor líquido a receber</p>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                  {formatBRL(resultado.valorLiquido)}
                </span>
              </div>
              <p className="text-xs text-white/65 mt-2 tabular-nums">
                {resultado.tempoServico.anos} ano{resultado.tempoServico.anos !== 1 ? "s" : ""}
                {", "}{resultado.tempoServico.meses} {resultado.tempoServico.meses === 1 ? "mês" : "meses"}
                {" de serviço"}
                {resultado.diasAvisoPrevio > 0 ? ` · aviso prévio ${resultado.diasAvisoPrevio} dias` : ""}
              </p>
            </div>
            <div className="lg:col-span-6">
              <p className="text-[10px] text-white/65 uppercase tracking-wider mb-2">Composição</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                  <p className="text-xs text-white/70 mb-1">Proventos</p>
                  <p className="text-lg font-bold tabular-nums leading-none">{formatBRL(resultado.totalProventos)}</p>
                </div>
                <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                  <p className="text-xs text-white/70 mb-1">Descontos</p>
                  <p className="text-lg font-bold tabular-nums leading-none text-rose-200">
                    −{formatBRL(resultado.totalDescontos)}
                  </p>
                </div>
                <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                  <p className="text-xs text-white/70 mb-1">FGTS + multa</p>
                  <p className="text-lg font-bold tabular-nums leading-none text-amber-200">
                    {formatBRL(resultado.totalFGTS)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs de detalhe */}
      <Tabs defaultValue="verbas">
        <TabsList>
          <TabsTrigger value="verbas">Verbas detalhadas</TabsTrigger>
          <TabsTrigger value="fgts">FGTS</TabsTrigger>
          {resultado.parecerTecnico && <TabsTrigger value="parecer">Parecer técnico</TabsTrigger>}
        </TabsList>

        <TabsContent value="verbas" className="mt-4">
          <Card>
            <CardContent className="pt-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-emerald-700 mb-2 flex items-center gap-2">
                  <PlusCircle className="w-4 h-4" /> Proventos
                </h3>
                <div className="space-y-1">
                  {proventos.map((v: any, i: number) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                      <div>
                        <p className="text-sm font-medium">{v.descricao}</p>
                        <p className="text-xs text-slate-500">{v.fundamentoLegal}</p>
                      </div>
                      <p className="font-semibold tabular-nums text-emerald-700">{formatBRL(v.valor)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {descontos.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-semibold text-rose-700 mb-2 flex items-center gap-2">
                      <MinusCircle className="w-4 h-4" /> Descontos
                    </h3>
                    <div className="space-y-1">
                      {descontos.map((v: any, i: number) => (
                        <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                          <div>
                            <p className="text-sm font-medium">{v.descricao}</p>
                            <p className="text-xs text-slate-500">{v.fundamentoLegal}</p>
                            {v.detalhes && <p className="text-xs text-slate-400 mt-0.5">{v.detalhes}</p>}
                          </div>
                          <p className="font-semibold tabular-nums text-rose-700">− {formatBRL(v.valor)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fgts" className="mt-4">
          <Card>
            <CardContent className="pt-5 space-y-3">
              <div className="flex justify-between py-2 border-b">
                <span>Saldo FGTS ({resultado.fgtsInformado ? "informado" : "estimado"})</span>
                <span className="font-semibold tabular-nums">{formatBRL(resultado.saldoFGTSEstimado)}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span>Multa rescisória FGTS</span>
                <span className="font-semibold tabular-nums">{formatBRL(resultado.multaFGTS)}</span>
              </div>
              <div className="flex justify-between py-2 font-bold text-lg">
                <span>Total FGTS</span>
                <span className="tabular-nums">{formatBRL(resultado.totalFGTS)}</span>
              </div>
              {resultado.diasAvisoPrevio > 0 && (
                <>
                  <Separator />
                  <div className="flex justify-between py-2">
                    <span>Aviso prévio ({resultado.diasAvisoPrevio} dias)</span>
                    <span className="font-semibold tabular-nums">{formatBRL(resultado.valorAvisoPrevio)}</span>
                  </div>
                </>
              )}
              <Separator />
              <div className="text-sm text-slate-500">
                Tempo de serviço: {resultado.tempoServico.anos} ano(s),{" "}
                {resultado.tempoServico.meses} mês(es) e {resultado.tempoServico.dias} dia(s)
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {resultado.parecerTecnico && (
          <TabsContent value="parecer" className="mt-4">
            <ParecerEditor
              parecerOriginal={resultado.parecerTecnico}
              protocolo={resultado.protocoloCalculo}
              filenamePrefix="parecer-rescisao"
              revisadoPorNome={revisorNome}
              onRevisadoPorNomeChange={onRevisorNomeChange}
              revisadoPorOab={revisorOab}
              onRevisadoPorOabChange={onRevisorOabChange}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─── Resultado de Horas Extras ───────────────────────────────────────────────

function ResultadoHorasExtras({
  resultado, revisorNome, onRevisorNomeChange, revisorOab, onRevisorOabChange,
}: {
  resultado: any;
  revisorNome: string; onRevisorNomeChange: (s: string) => void;
  revisorOab: string; onRevisorOabChange: (s: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-7 text-white relative overflow-hidden shadow-lg">
        <CircleCheckBig className="absolute -right-8 -bottom-10 w-48 h-48 opacity-10" strokeWidth={1.2} />
        <div className="relative">
          <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <PulseDot />
                <p className="text-xs font-medium text-white/85 uppercase tracking-wider">Cálculo concluído</p>
              </div>
              <p className="text-xs text-white/70">Protocolo {resultado.protocoloCalculo}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
            <div className="lg:col-span-6">
              <p className="text-sm font-medium text-white/85 mb-1">Total com reflexos</p>
              <span className="text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                {formatBRL(resultado.totalComReflexos)}
              </span>
              <p className="text-xs text-white/65 mt-2 tabular-nums">
                Hora normal: {formatBRL(resultado.valorHoraNormal)} ·
                HE 50%: {formatBRL(resultado.valorHoraExtra50)} ·
                HE 100%: {formatBRL(resultado.valorHoraExtra100)}
              </p>
            </div>
            <div className="lg:col-span-6">
              <p className="text-[10px] text-white/65 uppercase tracking-wider mb-2">Composição</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                  <p className="text-xs text-white/70 mb-1">Horas extras</p>
                  <p className="text-lg font-bold tabular-nums leading-none">{formatBRL(resultado.totalGeral)}</p>
                </div>
                <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                  <p className="text-xs text-white/70 mb-1">Reflexos</p>
                  <p className="text-lg font-bold tabular-nums leading-none">{formatBRL(resultado.reflexos.totalReflexos)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="detalhamento">
        <TabsList>
          <TabsTrigger value="detalhamento">Detalhamento</TabsTrigger>
          <TabsTrigger value="reflexos">Reflexos</TabsTrigger>
          {resultado.parecerTecnico && <TabsTrigger value="parecer-he">Parecer</TabsTrigger>}
        </TabsList>

        <TabsContent value="detalhamento" className="mt-4">
          <Card>
            <CardContent className="pt-5">
              <ScrollArea className="w-full">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-2 font-medium text-xs text-slate-500">Mês/Ano</th>
                      <th className="p-2 font-medium text-xs text-slate-500">HE 50%</th>
                      <th className="p-2 font-medium text-xs text-slate-500">HE 100%</th>
                      <th className="p-2 font-medium text-xs text-slate-500">Adic. noturno</th>
                      <th className="p-2 font-medium text-xs text-slate-500 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.detalhamentoPeriodos.map((d: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-2 font-medium">{d.mesAno}</td>
                        <td className="p-2 tabular-nums">{formatBRL(d.valorExtras50)}</td>
                        <td className="p-2 tabular-nums">{formatBRL(d.valorExtras100)}</td>
                        <td className="p-2 tabular-nums">{formatBRL(d.valorAdicionalNoturno)}</td>
                        <td className="p-2 tabular-nums text-right font-semibold">{formatBRL(d.totalPeriodo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reflexos" className="mt-4">
          <Card>
            <CardContent className="pt-5 space-y-2">
              <div className="flex justify-between py-2 border-b"><span>Reflexo em férias + 1/3</span><span className="font-semibold tabular-nums">{formatBRL(resultado.reflexos.reflexoFerias)}</span></div>
              <div className="flex justify-between py-2 border-b"><span>Reflexo em 13º</span><span className="font-semibold tabular-nums">{formatBRL(resultado.reflexos.reflexo13Salario)}</span></div>
              <div className="flex justify-between py-2 border-b"><span>Reflexo em FGTS (8%)</span><span className="font-semibold tabular-nums">{formatBRL(resultado.reflexos.reflexoFGTS)}</span></div>
              <div className="flex justify-between py-2 border-b"><span>DSR sobre horas extras</span><span className="font-semibold tabular-nums">{formatBRL(resultado.reflexos.reflexoDSR)}</span></div>
              <div className="flex justify-between py-2 font-bold text-lg"><span>Total reflexos</span><span className="tabular-nums">{formatBRL(resultado.reflexos.totalReflexos)}</span></div>
            </CardContent>
          </Card>
        </TabsContent>

        {resultado.parecerTecnico && (
          <TabsContent value="parecer-he" className="mt-4">
            <ParecerEditor
              parecerOriginal={resultado.parecerTecnico}
              protocolo={resultado.protocoloCalculo}
              filenamePrefix="parecer-horas-extras"
              revisadoPorNome={revisorNome}
              onRevisadoPorNomeChange={onRevisorNomeChange}
              revisadoPorOab={revisorOab}
              onRevisadoPorOabChange={onRevisorOabChange}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
