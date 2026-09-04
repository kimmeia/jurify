import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Check, GripVertical, Loader2, Lock, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { toast } from "sonner";
import type { PlanoEditavel } from "./financeiro/PlanosSection";

const ROTA_LISTA = "/admin/financeiro?aba=planos";

function formatBRL(centavos: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

function centavosDe(texto: string): number | null {
  if (!texto.trim()) return null;
  const v = Math.round(parseFloat(texto.replace(/\./g, "").replace(",", ".")) * 100);
  return isNaN(v) ? null : v;
}

interface ModuloApp {
  id: string;
  nome: string;
  descricao: string;
  obrigatorio: boolean;
}

/**
 * Prévia do cartão como a página de preços renderiza (mesmos textos e
 * variantes do Pricing.tsx). É a razão do editor ser tela cheia: o admin
 * vê o efeito de cada campo sem publicar nada.
 */
function PreviaCartaoLP({
  nome,
  fraseCartao,
  sobConsulta,
  demonstracao,
  popular,
  precoMensalCentavos,
  trialDias,
  features,
}: {
  nome: string;
  fraseCartao: string;
  sobConsulta: boolean;
  demonstracao: boolean;
  popular: boolean;
  precoMensalCentavos: number | null;
  trialDias: number;
  features: string[];
}) {
  const gratis = (precoMensalCentavos ?? 0) === 0;
  return (
    <div className="rounded-2xl bg-[radial-gradient(120%_120%_at_30%_0%,#1b1240_0%,#0b0d1d_60%)] p-5">
      <div className={`relative rounded-2xl border p-5 text-white ${popular ? "border-info/30 bg-info/15" : "border-white/10 bg-white/[0.04]"}`}>
        {popular && (
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-info px-2.5 py-0.5 text-[10px] font-bold">
            ✨ Mais popular
          </span>
        )}
        <p className="text-xl font-bold">{nome || "Nome do plano"}</p>
        <p className="mt-1 min-h-[18px] text-[12px] text-info/60">{fraseCartao}</p>

        {sobConsulta ? (
          <>
            <p className="mt-3 text-[24px] font-extrabold tracking-tight">Sob consulta</p>
            <p className="mt-1 text-[11px] text-info/55">
              {demonstracao ? "apresentamos numa demonstração ao vivo" : "preço fechado na conversa, do seu tamanho"}
            </p>
            <div className="my-4 flex flex-col gap-2">
              <span className="flex h-9 items-center justify-center rounded-lg bg-info text-xs font-bold">
                {demonstracao ? "💬 Agendar demonstração" : `Testar grátis ${trialDias || 14} dias`}
              </span>
              <span className="flex h-9 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-xs font-semibold">
                {demonstracao ? `Testar grátis ${trialDias || 14} dias` : "💬 Falar com a gente"}
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-[28px] font-extrabold tracking-tight">
              {gratis ? "Grátis" : formatBRL(precoMensalCentavos ?? 0)}
              {!gratis && <span className="text-sm font-normal text-info/55">/mês</span>}
            </p>
            <p className="mt-1 min-h-[16px] text-[11px] font-semibold text-info">
              {trialDias > 0 ? `Teste ${trialDias} dias grátis` : ""}
            </p>
            <div className="my-4">
              <span className="flex h-9 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-xs font-semibold">
                {gratis ? "Criar conta grátis" : "Começar grátis"}
              </span>
            </div>
          </>
        )}

        <ul className="space-y-2 text-[12px] text-info/80">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CampoNumero({
  label,
  valor,
  setValor,
  placeholder,
  hint,
}: {
  label: string;
  valor: string;
  setValor: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={valor} onChange={(e) => setValor(e.target.value)} type="number" min={0} placeholder={placeholder} className="h-9" />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function AdminPlanoEditor({ slug }: { slug: string }) {
  const { loading, user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: planos, isLoading, refetch } = (trpc as any).admin.listarPlanosEditaveis.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });
  const { data: modulosApp } = (trpc as any).admin.listarModulosApp.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });
  const { data: catalogo } = (trpc as any).admin.listarCatalogoModulos.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });

  const plano: PlanoEditavel | null = (planos ?? []).find((p: PlanoEditavel) => p.slug === slug) ?? null;

  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [publicoAlvo, setPublicoAlvo] = useState("");
  const [precoMensalReais, setPrecoMensalReais] = useState("");
  const [precoAnualReais, setPrecoAnualReais] = useState("");
  const [trialDias, setTrialDias] = useState("0");
  const [maxUsuarios, setMaxUsuarios] = useState("1");
  const [maxArmazenamentoMb, setMaxArmazenamentoMb] = useState("100");
  const [maxClientes, setMaxClientes] = useState("");
  const [maxConexoesWhatsapp, setMaxConexoesWhatsapp] = useState("0");
  const [maxAgentesIa, setMaxAgentesIa] = useState("0");
  const [maxMonitoramentos, setMaxMonitoramentos] = useState("");
  const [maxMonitoramentosCpf, setMaxMonitoramentosCpf] = useState("");
  const [precoSobConsulta, setPrecoSobConsulta] = useState(false);
  const [ctaDemonstracao, setCtaDemonstracao] = useState(false);
  const [creditosCalculos, setCreditosCalculos] = useState("0");
  const [jurisiaMensagens, setJurisiaMensagens] = useState("0");
  const [atendentesInclusos, setAtendentesInclusos] = useState("");
  const [precoAtendenteAdicional, setPrecoAtendenteAdicional] = useState("");
  const [modulosLiberados, setModulosLiberados] = useState<string[]>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [novaFeature, setNovaFeature] = useState("");
  const [popular, setPopular] = useState(false);
  const [hidratado, setHidratado] = useState(false);
  const [featArrastando, setFeatArrastando] = useState<number | null>(null);

  useEffect(() => {
    if (plano && !hidratado) {
      setNome(plano.nome);
      setDescricao(plano.descricao ?? "");
      setPublicoAlvo(plano.publicoAlvo ?? "");
      setPrecoMensalReais((plano.precoMensalCentavos / 100).toFixed(2).replace(".", ","));
      setPrecoAnualReais(plano.precoAnualCentavos != null ? (plano.precoAnualCentavos / 100).toFixed(2).replace(".", ",") : "");
      setTrialDias(String(plano.trialDias));
      setMaxUsuarios(String(plano.maxUsuarios));
      setMaxArmazenamentoMb(String(plano.maxArmazenamentoMb));
      setMaxClientes(plano.maxClientes != null ? String(plano.maxClientes) : "");
      setMaxConexoesWhatsapp(String(plano.maxConexoesWhatsapp));
      setMaxAgentesIa(String(plano.maxAgentesIa));
      setMaxMonitoramentos(plano.maxMonitoramentosProcessos != null ? String(plano.maxMonitoramentosProcessos) : "");
      setMaxMonitoramentosCpf(plano.maxMonitoramentosCpf != null ? String(plano.maxMonitoramentosCpf) : "");
      setPrecoSobConsulta(!!plano.precoSobConsulta);
      setCtaDemonstracao(!!plano.ctaDemonstracao);
      setCreditosCalculos(String(plano.creditosCalculosMes));
      setJurisiaMensagens(String(plano.jurisiaMensagensMes ?? 0));
      setAtendentesInclusos(plano.atendentesInclusos != null ? String(plano.atendentesInclusos) : "");
      setPrecoAtendenteAdicional(
        plano.precoAtendenteAdicionalCentavos > 0
          ? (plano.precoAtendenteAdicionalCentavos / 100).toFixed(2).replace(".", ",")
          : "",
      );
      setModulosLiberados([...plano.modulosLiberados]);
      setFeatures([...plano.features]);
      setPopular(plano.popular);
      setHidratado(true);
    }
  }, [plano, hidratado]);

  const editarMut = (trpc as any).admin.editarPlano.useMutation({
    onSuccess: () => {
      toast.success("Plano salvo — site e app já refletem");
      refetch();
      setLocation(ROTA_LISTA);
    },
    onError: (err: any) => toast.error("Erro ao salvar", { description: err.message }),
  });
  const deletarMut = (trpc as any).admin.deletarPlano.useMutation({
    onSuccess: () => {
      toast.success("Plano deletado");
      setLocation(ROTA_LISTA);
    },
    onError: (err: any) => toast.error("Erro ao deletar", { description: err.message }),
  });

  // Gate de admin (o editor não usa o AdminLayout — tela cheia de propósito),
  // depois de TODOS os hooks pra não variar a contagem entre renders.
  if (loading) {
    return <div className="p-8"><Skeleton className="h-40 w-full max-w-3xl mx-auto" /></div>;
  }
  if (!user) return <Redirect to="/" />;
  if (user.role !== "admin") return <Redirect to="/dashboard" />;

  if (!isLoading && !plano) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8">
        <p className="text-muted-foreground">Plano "{slug}" não encontrado.</p>
        <Button variant="outline" onClick={() => setLocation(ROTA_LISTA)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar pra lista
        </Button>
      </div>
    );
  }

  const handleSave = () => {
    if (!plano) return;
    const mensal = centavosDe(precoMensalReais);
    if (mensal == null || mensal < 0) { toast.error("Preço mensal inválido"); return; }
    const anual = precoAnualReais.trim() ? centavosDe(precoAnualReais) : null;
    const adicional = precoAtendenteAdicional.trim() ? centavosDe(precoAtendenteAdicional) : 0;
    if (adicional == null || adicional < 0) { toast.error("Preço do atendente adicional inválido"); return; }

    editarMut.mutate({
      slug: plano.slug,
      nome,
      descricao: descricao.trim() || null,
      publicoAlvo: publicoAlvo.trim() || null,
      precoMensalCentavos: mensal,
      precoAnualCentavos: anual,
      trialDias: parseInt(trialDias, 10) || 0,
      maxUsuarios: parseInt(maxUsuarios, 10) || 1,
      maxArmazenamentoMb: parseInt(maxArmazenamentoMb, 10) || 0,
      maxClientes: maxClientes.trim() ? parseInt(maxClientes, 10) : null,
      maxConexoesWhatsapp: parseInt(maxConexoesWhatsapp, 10) || 0,
      maxAgentesIa: parseInt(maxAgentesIa, 10) || 0,
      maxMonitoramentosProcessos: maxMonitoramentos.trim() ? parseInt(maxMonitoramentos, 10) : null,
      maxMonitoramentosCpf: maxMonitoramentosCpf.trim() ? parseInt(maxMonitoramentosCpf, 10) : null,
      precoSobConsulta,
      ctaDemonstracao,
      creditosCalculosMes: parseInt(creditosCalculos, 10) || 0,
      jurisiaMensagensMes: parseInt(jurisiaMensagens, 10) || 0,
      atendentesInclusos: atendentesInclusos.trim() ? parseInt(atendentesInclusos, 10) : null,
      precoAtendenteAdicionalCentavos: adicional,
      modulosLiberados,
      features,
      popular,
    });
  };

  const moverFeature = (de: number, para: number) => {
    if (de === para || de < 0 || para < 0 || de >= features.length || para >= features.length) return;
    const novas = [...features];
    const [item] = novas.splice(de, 1);
    novas.splice(para, 0, item);
    setFeatures(novas);
  };

  const fraseCartao = publicoAlvo.trim() || descricao.trim();
  const somaCesta = (catalogo ?? [])
    .filter((c: any) => modulosLiberados.includes(c.id))
    .reduce((s: number, c: any) => s + c.precoMensalCentavos, 0);
  const precoPacote = centavosDe(precoMensalReais) ?? 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Barra fixa: voltar / título / salvar */}
      <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => setLocation(ROTA_LISTA)}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Voltar
          </Button>
          <div className="min-w-0">
            <p className="font-semibold leading-tight truncate">
              Editar plano · {plano?.nome ?? slug}
            </p>
            <p className="text-[11px] text-muted-foreground">nada muda no site antes de você salvar</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setLocation(ROTA_LISTA)}>Cancelar</Button>
            <Button size="sm" onClick={handleSave} disabled={editarMut.isPending || !plano}>
              {editarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar alterações
            </Button>
          </div>
        </div>
      </div>

      {isLoading || !plano ? (
        <div className="mx-auto max-w-[1500px] p-6">
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <div className="mx-auto grid max-w-[1500px] gap-4 p-6 lg:grid-cols-[1fr_1.15fr_0.95fr]">
          {/* ── Coluna 1: Geral + Preço + Assentos ── */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Geral</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome do plano</Label>
                  <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Código interno</Label>
                  <div className="flex h-9 items-center justify-between rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                    <code className="text-xs">{plano.slug}</code>
                    <span className="flex items-center gap-1 text-[10px] font-semibold">
                      <Lock className="h-3 w-3" /> não muda depois de criado
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Frase do cartão (site)</Label>
                  <Input value={publicoAlvo} onChange={(e) => setPublicoAlvo(e.target.value)} maxLength={255}
                    placeholder="Pra quem advoga sozinho e quer dormir tranquilo." className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Descrição interna</Label>
                  <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={255}
                    placeholder="Usada no site se a frase do cartão ficar vazia" className="h-9" />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label className="text-xs">Mais popular</Label>
                    <p className="text-[10px] text-muted-foreground">Selo ✨ e destaque visual no cartão</p>
                  </div>
                  <Switch checked={popular} onCheckedChange={setPopular} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Preço</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${precoSobConsulta ? "border-info/30 bg-info-bg/60 dark:bg-info/30" : ""}`}>
                  <div>
                    <Label className="text-xs">Sob consulta</Label>
                    <p className="text-[10px] text-muted-foreground">
                      O site esconde o preço e mostra "Falar com a gente" — você fecha o valor na conversa.
                      O teste grátis continua funcionando.
                    </p>
                  </div>
                  <Switch checked={precoSobConsulta} onCheckedChange={setPrecoSobConsulta} />
                </div>
                <div className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${ctaDemonstracao ? "border-info/30 bg-info-bg/60 dark:bg-info/30" : ""}`}>
                  <div>
                    <Label className="text-xs">Vender por demonstração</Label>
                    <p className="text-[10px] text-muted-foreground">O botão principal do cartão vira "Agendar demonstração".</p>
                  </div>
                  <Switch checked={ctaDemonstracao} onCheckedChange={setCtaDemonstracao} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Preço mensal (R$)</Label>
                    <Input value={precoMensalReais} onChange={(e) => setPrecoMensalReais(e.target.value)}
                      inputMode="decimal" placeholder="97,00" className="h-9"
                      disabled={precoSobConsulta} />
                    {precoSobConsulta && (
                      <p className="text-[10px] text-muted-foreground">escondido do site enquanto "sob consulta" estiver ligado</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Preço anual (R$)</Label>
                    <Input value={precoAnualReais} onChange={(e) => setPrecoAnualReais(e.target.value)}
                      inputMode="decimal" placeholder="opcional" className="h-9" disabled={precoSobConsulta} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <CampoNumero label="Teste grátis (dias)" valor={trialDias} setValor={setTrialDias} hint="0 = sem teste" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Assentos de atendente</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <CampoNumero label="Inclusos no plano" valor={atendentesInclusos} setValor={setAtendentesInclusos}
                  placeholder="vazio = não cobra" hint="Colaboradores ativos contam. Vazio = sem cobrança por assento." />
                <div className="space-y-1.5">
                  <Label className="text-xs">Adicional (R$/mês)</Label>
                  <Input value={precoAtendenteAdicional} onChange={(e) => setPrecoAtendenteAdicional(e.target.value)}
                    inputMode="decimal" placeholder="25,00" className="h-9" />
                  <p className="text-[10px] text-muted-foreground">Por atendente além dos inclusos.</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Coluna 2: Limites + Módulos + Destaques ── */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Limites</CardTitle>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">vazio = sem limite</span>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <CampoNumero label="Usuários" valor={maxUsuarios} setValor={setMaxUsuarios} />
                <CampoNumero label="Armazenamento (MB)" valor={maxArmazenamentoMb} setValor={setMaxArmazenamentoMb} />
                <CampoNumero label="Clientes ativos" valor={maxClientes} setValor={setMaxClientes} placeholder="vazio = ∞" />
                <CampoNumero label="Processos vigiados" valor={maxMonitoramentos} setValor={setMaxMonitoramentos} placeholder="vazio = ∞" />
                <CampoNumero label="CPFs/CNPJs vigiados" valor={maxMonitoramentosCpf} setValor={setMaxMonitoramentosCpf} placeholder="vazio = ∞" />
                <CampoNumero label="Conexões WhatsApp" valor={maxConexoesWhatsapp} setValor={setMaxConexoesWhatsapp} />
                <CampoNumero label="Agentes IA" valor={maxAgentesIa} setValor={setMaxAgentesIa} />
                <CampoNumero label="Créditos cálculo/mês" valor={creditosCalculos} setValor={setCreditosCalculos} />
                <CampoNumero label="JurisIA msgs/mês" valor={jurisiaMensagens} setValor={setJurisiaMensagens} hint="0 desliga o módulo" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Módulos inclusos</CardTitle>
                {somaCesta > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    soma avulsa: <strong className="text-foreground">{formatBRL(somaCesta)}/mês</strong>
                    {precoPacote > 0 && precoPacote < somaCesta && !precoSobConsulta && (
                      <span className="text-success-fg"> · combo −{Math.round((1 - precoPacote / somaCesta) * 100)}%</span>
                    )}
                  </span>
                )}
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {(modulosApp ?? []).map((mod: ModuloApp) => {
                  const ligado = mod.obrigatorio || modulosLiberados.includes(mod.id);
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      disabled={mod.obrigatorio}
                      title={mod.descricao}
                      onClick={() => {
                        if (mod.obrigatorio) return;
                        setModulosLiberados(ligado
                          ? modulosLiberados.filter((x) => x !== mod.id)
                          : [...modulosLiberados.filter((x) => x !== mod.id), mod.id]);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        mod.obrigatorio
                          ? "border-dashed text-muted-foreground"
                          : ligado
                            ? "border-info/30 bg-info-bg font-semibold text-info-fg"
                            : "text-muted-foreground hover:border-info/30"
                      }`}
                    >
                      {ligado && <Check className="h-3 w-3" />}
                      {mod.nome}
                      {mod.obrigatorio && <span className="text-[9px]">· sempre</span>}
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Destaques do cartão</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {features.map((f, i) => (
                  <div
                    key={`${i}-${f}`}
                    className="flex items-center gap-2 rounded-md border border-transparent px-1 py-1 text-sm hover:border-border"
                    draggable
                    onDragStart={() => setFeatArrastando(i)}
                    onDragEnd={() => setFeatArrastando(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (featArrastando != null) moverFeature(featArrastando, i); setFeatArrastando(null); }}
                  >
                    <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/50" />
                    <span className="flex-1 truncate">{f}</span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => setFeatures(features.filter((_, idx) => idx !== i))}>
                      <X className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <Input value={novaFeature} onChange={(e) => setNovaFeature(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && novaFeature.trim()) {
                        setFeatures([...features, novaFeature.trim()]);
                        setNovaFeature("");
                      }
                    }}
                    placeholder="Ex: Vigia 50 processos" className="h-9 text-sm" />
                  <Button size="sm" variant="outline" className="h-9" onClick={() => {
                    if (novaFeature.trim()) {
                      setFeatures([...features, novaFeature.trim()]);
                      setNovaFeature("");
                    }
                  }}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Coluna 3: prévia ao vivo ── */}
          <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Prévia ao vivo · cartão na página de preços
            </p>
            <PreviaCartaoLP
              nome={nome}
              fraseCartao={fraseCartao}
              sobConsulta={precoSobConsulta}
              demonstracao={ctaDemonstracao}
              popular={popular}
              precoMensalCentavos={centavosDe(precoMensalReais)}
              trialDias={parseInt(trialDias, 10) || 0}
              features={features}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A prévia muda na hora: desligou "Sob consulta", o preço aparece no lugar; mexeu num
              destaque, o cartão reflete. O que você vê aqui é <strong>exatamente</strong> o que o
              visitante vê no site depois de salvar.
            </p>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">
                {plano.oculto ? (
                  <>Este plano está <Badge variant="outline" className="text-[10px]">fora da vitrine</Badge></>
                ) : (
                  <>Este plano está <Badge variant="outline" className="text-[10px] border-info/30 text-info-fg dark:text-info">na vitrine</Badge></>
                )}
                <p className="mt-1">Mostrar/esconder é na lista de planos.</p>
              </div>
              {!plano.slugProtegido && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="text-xs text-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Deletar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Deletar plano "{plano.nome}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação não pode ser desfeita. Não funciona se houver assinantes ativos.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => deletarMut.mutate({ slug: plano.slug })}
                      >
                        Deletar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
