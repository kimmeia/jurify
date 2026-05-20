import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Streamdown } from "streamdown";
import { PulseDot } from "../dashboards/common";
import {
  ShieldCheck, Calculator, AlertTriangle, CheckCircle, FileText, Loader2,
  Clock, User, DollarSign, ArrowLeft, ArrowRight, Plus, Trash2, Check,
  CalendarClock, Award, Receipt, Briefcase, CircleCheckBig, Copy,
} from "lucide-react";
import { toast } from "sonner";
import type {
  ResultadoSimulacao, ResultadoRegra, ResultadoRMI, ResultadoGPS,
  PeriodoContribuicao, TipoAtividade, CategoriaVinculo,
} from "../../../../shared/previdenciario-types";
import { REGRA_LABELS, TIPO_ATIVIDADE_LABELS } from "../../../../shared/previdenciario-types";

function formatBRL(v: number): string { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v); }
function fmtMeses(m: number): string { const a = Math.floor(m / 12); const r = m % 12; return r > 0 ? `${a}a ${r}m` : `${a}a`; }
function uuid(): string { return Math.random().toString(36).substring(2, 10); }

const FERRAMENTAS = [
  { id: "simulador" as const, icon: CalendarClock, label: "Quando posso me aposentar?", desc: "Simula todas as regras (comum, especial, rural, professor)", color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/30", border: "border-rose-200 dark:border-rose-800" },
  { id: "rmi" as const, icon: DollarSign, label: "Quanto vou receber?", desc: "Calcula o valor do benefício (RMI)", color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30", border: "border-violet-200 dark:border-violet-800" },
  { id: "gps" as const, icon: Receipt, label: "GPS em Atraso", desc: "Juros e multa de contribuições atrasadas", color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800" },
];

function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center justify-end gap-3 text-xs flex-wrap">
      {steps.map((nome, i) => {
        const num = i + 1; const concluido = num < current; const ativo = num === current;
        return (
          <div key={nome} className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className={`w-6 h-6 rounded-full font-bold flex items-center justify-center text-[11px] ${
                concluido ? "bg-emerald-600 text-white"
                : ativo ? "bg-violet-700 text-white"
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

// Hero do submódulo Previdenciário — violet/purple
function PrevHero({ titulo, descricao, passoAtual, totalPassos }: {
  titulo?: string; descricao?: string; passoAtual?: number; totalPassos?: number;
}) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-violet-700 via-purple-700 to-indigo-800 p-6 text-white relative overflow-hidden shadow-lg">
      <ShieldCheck className="absolute -right-6 -bottom-8 w-40 h-40 opacity-10" strokeWidth={1.2} />
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
            <p className="text-xs font-medium text-white/85 uppercase tracking-wider">Previdenciário</p>
          </div>
        )}
        {titulo && <h2 className="text-2xl font-bold mb-1">{titulo}</h2>}
        {descricao && <p className="text-sm text-white/80">{descricao}</p>}
      </div>
    </div>
  );
}

// ─── Principal ──────────────────────────────────────────────────────────────

export default function Previdenciario() {
  const [ferramenta, setFerramenta] = useState<"simulador" | "rmi" | "gps" | null>(null);
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="rounded-2xl bg-gradient-to-br from-slate-50/40 via-white to-violet-50/20 p-6 space-y-5">
        {!ferramenta && (
          <>
            <PrevHero
              titulo="Cálculos previdenciários"
              descricao="Aposentadoria, benefícios e contribuições — EC 103/2019 + 10 regras de transição"
            />
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-3">
                O que você precisa calcular?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {FERRAMENTAS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFerramenta(f.id)}
                    className="group text-left bg-white rounded-xl p-5 border border-slate-200 hover:border-violet-400 hover:shadow-lg transition-all"
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`p-2.5 ${f.bg} rounded-lg`}>
                        <f.icon className={`h-5 w-5 ${f.color}`} />
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-violet-600 group-hover:translate-x-1 transition-all ml-auto" />
                    </div>
                    <p className="font-semibold text-slate-900 mb-1 text-sm">{f.label}</p>
                    <p className="text-xs text-slate-500">{f.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {ferramenta === "simulador" && <Simulador onVoltar={() => setFerramenta(null)} />}
        {ferramenta === "rmi" && <CalculoRMI onVoltar={() => setFerramenta(null)} />}
        {ferramenta === "gps" && <CalculoGPS onVoltar={() => setFerramenta(null)} />}
      </div>
    </div>
  );
}

// ─── SIMULADOR (com períodos) ───────────────────────────────────────────────

function Simulador({ onVoltar }: { onVoltar: () => void }) {
  const [step, setStep] = useState(1);
  const [sexo, setSexo] = useState<"M" | "F">("M");
  const [dataNasc, setDataNasc] = useState("");
  const [periodos, setPeriodos] = useState<PeriodoContribuicao[]>([
    { id: uuid(), dataInicio: "", dataFim: "", tipoAtividade: "URBANA_COMUM", categoriaVinculo: "CLT", descricao: "", aindaAtivo: false },
  ]);
  const [continuaContribuindo, setContinuaContribuindo] = useState(true);
  const [resultado, setResultado] = useState<ResultadoSimulacao | null>(null);

  const mutation = trpc.previdenciario.simular.useMutation({
    onSuccess: (data) => { setResultado(data); setStep(3); toast.success("Simulação realizada! (1 crédito)"); },
    onError: (err) => toast.error(err.message),
  });

  const addPeriodo = () => setPeriodos(prev => [...prev, { id: uuid(), dataInicio: "", dataFim: "", tipoAtividade: "URBANA_COMUM", categoriaVinculo: "CLT", descricao: "", aindaAtivo: false }]);
  const removePeriodo = (id: string) => setPeriodos(prev => prev.filter(p => p.id !== id));
  const updatePeriodo = (id: string, field: keyof PeriodoContribuicao, value: any) => {
    setPeriodos(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleSimular = () => {
    const validos = periodos.filter(p => p.dataInicio && (p.aindaAtivo || p.dataFim));
    if (!dataNasc || validos.length === 0) { toast.error("Preencha a data de nascimento e ao menos um período."); return; }
    mutation.mutate({ sexo, dataNascimento: dataNasc, periodos: validos, continuaContribuindo });
  };

  const stepLabels = ["Dados pessoais", "Períodos", "Resultado"];
  const heroTitulo = step === 1 ? "Dados pessoais"
    : step === 2 ? "Períodos de contribuição"
    : "Resultado da simulação";
  const heroDescricao = step === 1 ? "Informe sexo e data de nascimento. Esses dados definem qual regra de aposentadoria se aplica."
    : step === 2 ? "Cadastre cada vínculo (CLT, autônomo, especial, rural). O tempo total é calculado automaticamente — períodos sobrepostos contam só uma vez."
    : "";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onVoltar} className="text-slate-500"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar para ferramentas</Button>
        {step !== 3 && <StepIndicator steps={stepLabels} current={step} />}
      </div>
      {step !== 3 && (
        <PrevHero titulo={heroTitulo} descricao={heroDescricao} passoAtual={step} totalPassos={3} />
      )}

      {/* STEP 1: Dados pessoais */}
      {step === 1 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-5 w-5 text-rose-600" /> Dados Pessoais</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label className="mb-2 block">Sexo *</Label>
              <div className="grid grid-cols-2 gap-3">
                {([["F", "Feminino", "62 anos (permanente)"], ["M", "Masculino", "65 anos (permanente)"]] as const).map(([v, l, d]) => (
                  <button key={v} onClick={() => setSexo(v)} className={`p-3 rounded-lg border-2 text-left ${sexo === v ? "border-rose-500 bg-rose-50 dark:bg-rose-950/20 ring-1 ring-rose-500" : "border-border hover:border-rose-300"}`}>
                    <p className="font-semibold text-sm">{l}</p><p className="text-xs text-muted-foreground">{d}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Data de Nascimento *</Label>
              <Input type="date" value={dataNasc} onChange={e => setDataNasc(e.target.value)} />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div><p className="text-sm font-medium">Pretende continuar contribuindo</p><p className="text-xs text-muted-foreground">Projeta quando você atingirá os requisitos</p></div>
              <Switch checked={continuaContribuindo} onCheckedChange={setContinuaContribuindo} />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => { if (!dataNasc) { toast.error("Informe a data de nascimento."); return; } setStep(2); }}>Próximo <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 2: Períodos de contribuição (+ cálculo direto, sem step de confirmação) */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5 text-rose-600" /> Períodos de Contribuição</CardTitle>
            <CardDescription>Cadastre cada vínculo. O tempo total é calculado automaticamente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left text-xs font-medium">Início *</th>
                    <th className="p-2 text-left text-xs font-medium">Fim</th>
                    <th className="p-2 text-left text-xs font-medium">Atual?</th>
                    <th className="p-2 text-left text-xs font-medium">Atividade *</th>
                    <th className="p-2 text-left text-xs font-medium">Vínculo</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {periodos.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="p-1.5">
                        <Input className="h-8" type="date" value={p.dataInicio} onChange={e => updatePeriodo(p.id, "dataInicio", e.target.value)} />
                      </td>
                      <td className="p-1.5">
                        <Input className="h-8" type="date" value={p.dataFim} disabled={p.aindaAtivo} onChange={e => updatePeriodo(p.id, "dataFim", e.target.value)} />
                      </td>
                      <td className="p-1.5">
                        <Switch checked={!!p.aindaAtivo} onCheckedChange={v => updatePeriodo(p.id, "aindaAtivo", v)} />
                      </td>
                      <td className="p-1.5">
                        <Select value={p.tipoAtividade} onValueChange={v => updatePeriodo(p.id, "tipoAtividade", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(TIPO_ATIVIDADE_LABELS).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1.5">
                        <Select value={p.categoriaVinculo} onValueChange={v => updatePeriodo(p.id, "categoriaVinculo", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CLT">CLT</SelectItem>
                            <SelectItem value="CONTRIBUINTE_INDIVIDUAL">Autônomo</SelectItem>
                            <SelectItem value="FACULTATIVO">Facultativo</SelectItem>
                            <SelectItem value="MEI">MEI</SelectItem>
                            <SelectItem value="EMPREGADO_DOMESTICO">Doméstico</SelectItem>
                            <SelectItem value="AVULSO">Avulso</SelectItem>
                            <SelectItem value="SEGURADO_ESPECIAL">Segurado Especial</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1.5 text-right">
                        {periodos.length > 1 && (
                          <Button variant="ghost" size="sm" onClick={() => removePeriodo(p.id)} className="h-8 w-8 p-0 text-muted-foreground hover:text-red-700">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button variant="outline" onClick={addPeriodo} className="w-full"><Plus className="h-4 w-4 mr-1" /> Adicionar período</Button>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button
                onClick={() => {
                  const validos = periodos.filter(p => p.dataInicio && (p.aindaAtivo || p.dataFim));
                  if (validos.length === 0) { toast.error("Cadastre ao menos um período com datas preenchidas."); return; }
                  handleSimular();
                }}
                disabled={mutation.isPending}
                className="bg-rose-600 hover:bg-rose-700 text-white"
              >
                {mutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Simulando...</>
                ) : (
                  <><Calculator className="h-4 w-4 mr-2" /> Simular Aposentadoria</>
                )}
              </Button>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Cada simulação consome 1 crédito do seu plano
            </p>
          </CardContent>
        </Card>
      )}

      {/* STEP 3: Resultado (antes era step 4) */}
      {step === 3 && resultado && <ResultadoSimulador resultado={resultado} onNovo={() => { setStep(1); setResultado(null); }} onVoltar={onVoltar} />}
    </div>
  );
}

// ─── Resultado da simulação ─────────────────────────────────────────────────

function ResultadoSimulador({ resultado, onNovo, onVoltar }: { resultado: ResultadoSimulacao; onNovo: () => void; onVoltar: () => void }) {
  const tc = resultado.resumoTC;
  const elegivelAgora = !!resultado.melhorRegra;
  return (
    <div className="space-y-5">
      {/* Hero gradient — verde se já pode aposentar, violet se ainda falta */}
      <div className={`rounded-2xl p-7 text-white relative overflow-hidden shadow-lg ${
        elegivelAgora
          ? "bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800"
          : "bg-gradient-to-br from-violet-700 via-purple-700 to-indigo-800"
      }`}>
        {elegivelAgora
          ? <Award className="absolute -right-8 -bottom-10 w-48 h-48 opacity-10" strokeWidth={1.2} />
          : <Clock className="absolute -right-8 -bottom-10 w-48 h-48 opacity-10" strokeWidth={1.2} />}
        <div className="relative">
          <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <PulseDot />
                <p className="text-xs font-medium text-white/85 uppercase tracking-wider">
                  {elegivelAgora ? "✓ Aposentadoria possível agora" : "Simulação previdenciária"}
                </p>
              </div>
              <p className="text-xs text-white/70">
                Protocolo {resultado.protocoloCalculo} · Calculado em {new Date(resultado.dataCalculo).toLocaleDateString("pt-BR")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onNovo}
                className="bg-white text-slate-900 hover:bg-slate-100 font-semibold shadow-sm h-8">
                <Copy className="h-3.5 w-3.5 mr-1" /> Nova simulação
              </Button>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
            <div className="lg:col-span-7">
              <p className="text-sm font-medium text-white/85 mb-1">
                {elegivelAgora ? "Melhor regra de aposentadoria" : "Regra mais próxima"}
              </p>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-3xl font-extrabold tracking-tight leading-none">
                  {elegivelAgora
                    ? resultado.melhorRegra!.nomeRegra
                    : resultado.regrasMaisProximas[0]?.nomeRegra ?? "—"}
                </span>
              </div>
              <p className="text-xs text-white/65 mt-2">
                {elegivelAgora
                  ? `Coeficiente ${(resultado.melhorRegra!.coeficiente * 100).toFixed(0)}% da média`
                  : resultado.regrasMaisProximas[0]
                    ? `Falta ${fmtMeses(resultado.regrasMaisProximas[0].mesesRestantes)} para se aposentar`
                    : "Dados insuficientes"}
              </p>
            </div>
            <div className="lg:col-span-5">
              <p className="text-[10px] text-white/65 uppercase tracking-wider mb-2">Tempo de contribuição</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                  <p className="text-xs text-white/70 mb-1">Total (bruto)</p>
                  <p className="text-lg font-bold tabular-nums leading-none">{fmtMeses(tc.totalMesesBruto)}</p>
                </div>
                <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                  <p className="text-xs text-white/70 mb-1">Com conversão</p>
                  <p className="text-lg font-bold tabular-nums leading-none text-emerald-200">{fmtMeses(tc.totalMesesConvertido)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TC resumo */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Tempo de Contribuição Calculado</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {tc.totalMesesComum > 0 && <div className="p-2 bg-muted/40 rounded text-center"><p className="text-[10px] text-muted-foreground">Comum</p><p className="text-sm font-bold">{fmtMeses(tc.totalMesesComum)}</p></div>}
            {tc.totalMesesProfessor > 0 && <div className="p-2 bg-blue-50 dark:bg-blue-950/20 rounded text-center"><p className="text-[10px] text-muted-foreground">Professor</p><p className="text-sm font-bold">{fmtMeses(tc.totalMesesProfessor)}</p></div>}
            {tc.totalMesesEspecial25 > 0 && <div className="p-2 bg-amber-50 dark:bg-amber-950/20 rounded text-center"><p className="text-[10px] text-muted-foreground">Especial 25a</p><p className="text-sm font-bold">{fmtMeses(tc.totalMesesEspecial25)}</p></div>}
            {tc.totalMesesEspecial20 > 0 && <div className="p-2 bg-orange-50 dark:bg-orange-950/20 rounded text-center"><p className="text-[10px] text-muted-foreground">Especial 20a</p><p className="text-sm font-bold">{fmtMeses(tc.totalMesesEspecial20)}</p></div>}
            {tc.totalMesesEspecial15 > 0 && <div className="p-2 bg-red-50 dark:bg-red-950/20 rounded text-center"><p className="text-[10px] text-muted-foreground">Especial 15a</p><p className="text-sm font-bold">{fmtMeses(tc.totalMesesEspecial15)}</p></div>}
            {tc.totalMesesRural > 0 && <div className="p-2 bg-green-50 dark:bg-green-950/20 rounded text-center"><p className="text-[10px] text-muted-foreground">Rural</p><p className="text-sm font-bold">{fmtMeses(tc.totalMesesRural)}</p></div>}
            <div className="p-2 bg-muted/60 rounded text-center"><p className="text-[10px] text-muted-foreground">Bruto</p><p className="text-sm font-bold">{fmtMeses(tc.totalMesesBruto)}</p></div>
            {tc.totalMesesConvertido !== tc.totalMesesBruto && <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded text-center"><p className="text-[10px] text-muted-foreground">Com conversão</p><p className="text-sm font-bold text-emerald-600">{fmtMeses(tc.totalMesesConvertido)}</p></div>}
          </div>
          {tc.conversoes.length > 0 && (
            <div className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-950/10 rounded-lg text-xs space-y-1">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">Conversão especial → comum (até 13/11/2019):</p>
              {tc.conversoes.map((c, i) => <p key={i}>{c.periodo}: {c.mesesOriginais}m × {c.fatorConversao} = <strong>{c.mesesConvertidos}m</strong></p>)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Regras */}
      <Tabs defaultValue="regras">
        <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="regras">Regras</TabsTrigger><TabsTrigger value="parecer">Parecer</TabsTrigger></TabsList>
        <TabsContent value="regras">
          <div className="space-y-3">
            {resultado.regras.filter(r => r.elegivel).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-2"><CheckCircle className="h-4 w-4" /> Regras que você já atende</p>
                {resultado.regras.filter(r => r.elegivel).map(r => <RegraCard key={r.regra + r.nomeRegra} regra={r} isMelhor={resultado.melhorRegra?.regra === r.regra && resultado.melhorRegra?.nomeRegra === r.nomeRegra} />)}
              </div>
            )}
            {resultado.regras.filter(r => !r.elegivel && r.mesesRestantes > 0).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground flex items-center gap-2"><Clock className="h-4 w-4" /> Faltam requisitos</p>
                {resultado.regras.filter(r => !r.elegivel && r.mesesRestantes > 0).sort((a, b) => a.mesesRestantes - b.mesesRestantes).map(r => <RegraCard key={r.regra + r.nomeRegra} regra={r} isMelhor={false} />)}
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="parecer">
          <Card><CardContent className="pt-6"><ScrollArea className="h-[500px] pr-4"><div className="prose prose-sm dark:prose-invert max-w-none"><Streamdown>{resultado.parecerTecnico}</Streamdown></div></ScrollArea></CardContent></Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-center gap-3">
        <Button variant="outline" onClick={onNovo}>Nova Simulação</Button>
        <Button variant="ghost" onClick={onVoltar}>Voltar às opções</Button>
      </div>
    </div>
  );
}

function RegraCard({ regra, isMelhor }: { regra: ResultadoRegra; isMelhor: boolean }) {
  return (
    <div className={`p-4 rounded-lg border space-y-3 ${regra.elegivel ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10" : ""} ${isMelhor ? "ring-2 ring-emerald-500 shadow-sm" : ""}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">{isMelhor && <Badge className="bg-emerald-600 text-white text-xs">Melhor</Badge>}<h4 className="font-semibold text-sm">{regra.nomeRegra}</h4></div>
        <Badge variant={regra.elegivel ? "default" : "outline"} className={regra.elegivel ? "bg-emerald-600" : ""}>{regra.elegivel ? "✓ Elegível" : `${fmtMeses(regra.mesesRestantes)}`}</Badge>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {regra.idadeMinimaExigida != null && <div className="p-2 rounded bg-muted/40 text-center"><p className="text-[10px] text-muted-foreground uppercase">Idade</p><p className="text-sm font-bold">{regra.idadeAtual} <span className="text-muted-foreground font-normal">/ {regra.idadeMinimaExigida}</span></p></div>}
        {regra.pontosExigidos != null && <div className="p-2 rounded bg-muted/40 text-center"><p className="text-[10px] text-muted-foreground uppercase">Pontos</p><p className="text-sm font-bold">{regra.pontosAtuais} <span className="text-muted-foreground font-normal">/ {regra.pontosExigidos}</span></p></div>}
        <div className="p-2 rounded bg-muted/40 text-center"><p className="text-[10px] text-muted-foreground uppercase">TC</p><p className="text-sm font-bold">{fmtMeses(regra.tcAtualMeses)} <span className="text-muted-foreground font-normal">/ {fmtMeses(regra.tcMinimoExigidoMeses)}</span></p></div>
        <div className="p-2 rounded bg-muted/40 text-center"><p className="text-[10px] text-muted-foreground uppercase">Benefício</p><p className="text-sm font-bold">{(regra.coeficiente * 100).toFixed(0)}%</p></div>
      </div>
      {regra.pedagioMeses != null && regra.pedagioMeses > 0 && <p className="text-xs text-muted-foreground">Pedágio: {fmtMeses(regra.pedagioMeses)}</p>}
      {regra.dataPrevistaAposentadoria && !regra.elegivel && <p className="text-xs text-muted-foreground">Previsão: <strong>{regra.dataPrevistaAposentadoria.split("-").reverse().join("/")}</strong></p>}
    </div>
  );
}

// ─── RMI ─────────────────────────────────────────────────────────────────────

function CalculoRMI({ onVoltar }: { onVoltar: () => void }) {
  const [sexo, setSexo] = useState<"M" | "F">("M");
  const [dataNasc, setDataNasc] = useState(""); const [dataApos, setDataApos] = useState("");
  const [tcMeses, setTcMeses] = useState(""); const [regra, setRegra] = useState("PERMANENTE");
  const [salarios, setSalarios] = useState<string[]>(["", "", ""]);
  const [resultado, setResultado] = useState<ResultadoRMI | null>(null);
  const mutation = trpc.previdenciario.calcularRMI.useMutation({ onSuccess: d => { setResultado(d); toast.success("RMI calculada! (1 crédito)"); }, onError: e => toast.error(e.message) });
  const addS = () => setSalarios(p => [...p, ""]); const rmS = (i: number) => setSalarios(p => p.filter((_, x) => x !== i)); const upS = (i: number, v: string) => setSalarios(p => p.map((s, x) => x === i ? v : s));
  const calc = () => { if (!dataNasc || !dataApos || !tcMeses) { toast.error("Preencha campos."); return; } const sl = salarios.map(s => parseFloat(s || "0")).filter(v => v > 0); if (!sl.length) { toast.error("Informe salários."); return; } mutation.mutate({ sexo, dataNascimento: dataNasc, dataAposentadoria: dataApos, tempoContribuicaoMeses: parseInt(tcMeses), salariosContribuicao: sl, regraAplicavel: regra as any, aplicarFatorPrevidenciario: regra === "PEDAGIO_50" }); };

  if (resultado) return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onVoltar} className="text-muted-foreground"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
      <Card className="border-emerald-200 dark:border-emerald-800"><CardContent className="pt-6 text-center space-y-2"><p className="text-sm text-muted-foreground">Renda Mensal Inicial estimada</p><p className="text-4xl font-bold text-emerald-600">{formatBRL(resultado.rmiLimitada)}</p><p className="text-sm text-muted-foreground">{resultado.detalhesCoeficiente}</p></CardContent></Card>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">Média</p><p className="text-sm font-bold">{formatBRL(resultado.mediaSalarios)}</p></Card>
        <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">Salários</p><p className="text-sm font-bold">{resultado.quantidadeSalarios}</p></Card>
        <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">Coef.</p><p className="text-sm font-bold">{(resultado.coeficiente * 100).toFixed(0)}%</p></Card>
        <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">Teto</p><p className="text-sm font-bold">{formatBRL(resultado.tetoINSS)}</p></Card>
      </div>
      {resultado.fatorPrevidenciario && <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg text-sm"><strong>Fator Previdenciário:</strong> {resultado.fatorPrevidenciario}</div>}
      <p className="text-xs text-muted-foreground">{resultado.fundamentacao}</p>
      <div className="flex justify-center gap-3"><Button variant="outline" onClick={() => setResultado(null)}>Novo</Button><Button variant="ghost" onClick={onVoltar}>Voltar</Button></div>
    </div>
  );

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onVoltar} className="text-slate-500"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar para ferramentas</Button>
      <PrevHero titulo="Cálculo de RMI" descricao="Renda Mensal Inicial — calcula o valor do benefício a partir da média dos salários de contribuição." />
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Sexo *</Label><Select value={sexo} onValueChange={v => setSexo(v as any)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="F">Feminino</SelectItem><SelectItem value="M">Masculino</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Regra *</Label><Select value={regra} onValueChange={setRegra}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(REGRA_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5"><Label>Nascimento *</Label><Input type="date" value={dataNasc} onChange={e => setDataNasc(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Data Aposentadoria *</Label><Input type="date" value={dataApos} onChange={e => setDataApos(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>TC total (meses) *</Label><Input type="number" value={tcMeses} onChange={e => setTcMeses(e.target.value)} placeholder="360" /></div>
          </div>
          <Separator />
          <div className="space-y-2"><div className="flex justify-between"><Label>Salários (R$) *</Label><Button variant="outline" size="sm" onClick={addS}><Plus className="h-4 w-4 mr-1" /> Add</Button></div>
            <div className="grid grid-cols-3 gap-2">{salarios.map((s, i) => <div key={i} className="flex gap-1"><Input type="number" step="0.01" placeholder={`Sal ${i + 1}`} value={s} onChange={e => upS(i, e.target.value)} />{salarios.length > 1 && <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => rmS(i)}><Trash2 className="h-3.5 w-3.5" /></Button>}</div>)}</div>
          </div>
          <Button onClick={calc} disabled={mutation.isPending} className="w-full bg-violet-600 hover:bg-violet-700 text-white">{mutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculando...</> : <><Calculator className="h-4 w-4 mr-2" /> Calcular</>}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── GPS ─────────────────────────────────────────────────────────────────────

function CalculoGPS({ onVoltar }: { onVoltar: () => void }) {
  const [cat, setCat] = useState("CONTRIBUINTE_INDIVIDUAL"); const [plano, setPlano] = useState("NORMAL"); const [sal, setSal] = useState("");
  const [jaInsc, setJaInsc] = useState(true); const [primDia, setPrimDia] = useState(true); const [comps, setComps] = useState<string[]>([""]);
  const [resultado, setResultado] = useState<ResultadoGPS | null>(null);
  const mutation = trpc.previdenciario.calcularGPS.useMutation({ onSuccess: d => { setResultado(d); toast.success("GPS calculada! (1 crédito)"); }, onError: e => toast.error(e.message) });
  const addC = () => setComps(p => [...p, ""]); const rmC = (i: number) => setComps(p => p.filter((_, x) => x !== i)); const upC = (i: number, v: string) => setComps(p => p.map((s, x) => x === i ? v : s));
  const calc = () => { if (!sal) { toast.error("Informe salário."); return; } const cs = comps.filter(c => c.length === 7); if (!cs.length) { toast.error("Informe ao menos 1 mês."); return; } mutation.mutate({ categoria: cat as any, plano: plano as any, salarioContribuicao: parseFloat(sal), competenciasAtrasadas: cs, jaInscritoNoINSS: jaInsc, primeiraContribuicaoEmDia: primDia }); };

  if (resultado) return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onVoltar} className="text-muted-foreground"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
      <Card className="border-amber-200 dark:border-amber-800"><CardContent className="pt-6 text-center space-y-2"><p className="text-sm text-muted-foreground">Total a pagar</p><p className="text-4xl font-bold text-amber-600">{formatBRL(resultado.totalAPagar)}</p><div className="flex justify-center gap-4 text-xs text-muted-foreground"><span>Original: {formatBRL(resultado.totalOriginal)}</span><span>Juros: {formatBRL(resultado.totalJuros)}</span><span>Multa: {formatBRL(resultado.totalMulta)}</span></div></CardContent></Card>
      {resultado.alertas.length > 0 && <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 space-y-1">{resultado.alertas.map((a, i) => <p key={i} className="text-sm flex items-start gap-2"><AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />{a}</p>)}</div>}
      <Card><CardContent className="pt-4"><ScrollArea className="w-full"><table className="w-full text-xs border-collapse min-w-[650px]"><thead><tr className="bg-muted/30"><th className="py-2 px-2 text-left border-b">Mês</th><th className="py-2 px-2 text-right border-b">Original</th><th className="py-2 px-2 text-right border-b">Dias</th><th className="py-2 px-2 text-right border-b">Juros</th><th className="py-2 px-2 text-right border-b">Multa</th><th className="py-2 px-2 text-right border-b font-bold">Total</th><th className="py-2 px-2 text-center border-b">Carência</th></tr></thead><tbody>{resultado.linhas.map(l => <tr key={l.competencia} className="border-b"><td className="py-1.5 px-2">{l.competencia}</td><td className="py-1.5 px-2 text-right">{formatBRL(l.valorOriginal)}</td><td className="py-1.5 px-2 text-right">{l.diasAtraso}</td><td className="py-1.5 px-2 text-right">{formatBRL(l.jurosSELIC)}</td><td className="py-1.5 px-2 text-right">{formatBRL(l.multa)}</td><td className="py-1.5 px-2 text-right font-bold">{formatBRL(l.valorTotal)}</td><td className="py-1.5 px-2 text-center">{l.contaParaCarencia ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500 mx-auto" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mx-auto" />}</td></tr>)}</tbody></table></ScrollArea></CardContent></Card>
      <p className="text-xs text-muted-foreground">{resultado.fundamentacao}</p>
      <div className="flex justify-center gap-3"><Button variant="outline" onClick={() => setResultado(null)}>Novo</Button><Button variant="ghost" onClick={onVoltar}>Voltar</Button></div>
    </div>
  );

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onVoltar} className="text-slate-500"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar para ferramentas</Button>
      <PrevHero titulo="GPS em atraso" descricao="Calcule juros e multa para regularizar contribuições previdenciárias atrasadas (Lei 8.212/91)." />
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Categoria *</Label><Select value={cat} onValueChange={setCat}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CONTRIBUINTE_INDIVIDUAL">Autônomo</SelectItem><SelectItem value="FACULTATIVO">Facultativo</SelectItem><SelectItem value="MEI">MEI</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Plano *</Label><Select value={plano} onValueChange={setPlano}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NORMAL">Normal (20%)</SelectItem><SelectItem value="SIMPLIFICADO">Simplificado (11%)</SelectItem><SelectItem value="MEI">MEI (5%)</SelectItem><SelectItem value="BAIXA_RENDA">Baixa Renda (5%)</SelectItem></SelectContent></Select></div>
          </div>
          <div className="space-y-1.5"><Label>Salário de Contribuição (R$) *</Label><Input type="number" step="0.01" placeholder="1621.00" value={sal} onChange={e => setSal(e.target.value)} /><p className="text-xs text-muted-foreground">Mín: R$ 1.621 | Máx: R$ 8.475,55</p></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30"><div><p className="text-sm font-medium">Inscrito no INSS</p></div><Switch checked={jaInsc} onCheckedChange={setJaInsc} /></div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30"><div><p className="text-sm font-medium">1ª contribuição em dia</p></div><Switch checked={primDia} onCheckedChange={setPrimDia} /></div>
          </div>
          <Separator />
          <div className="space-y-2"><div className="flex justify-between"><Label>Meses atrasados *</Label><Button variant="outline" size="sm" onClick={addC}><Plus className="h-4 w-4 mr-1" /> Mês</Button></div><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{comps.map((c, i) => <div key={i} className="flex gap-1"><Input type="month" value={c} onChange={e => upC(i, e.target.value)} />{comps.length > 1 && <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => rmC(i)}><Trash2 className="h-3.5 w-3.5" /></Button>}</div>)}</div></div>
          <Button onClick={calc} disabled={mutation.isPending} className="w-full bg-amber-600 hover:bg-amber-700 text-white">{mutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculando...</> : <><Calculator className="h-4 w-4 mr-2" /> Calcular GPS</>}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
