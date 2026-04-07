import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Scale, Search, Loader2, Coins, Plus, Pause, Play, Trash2, AlertTriangle, Clock, Users, Gavel, ShoppingCart, History, Radar, CheckCircle2, ChevronDown, ChevronUp, User, Bell } from "lucide-react";
import { toast } from "sonner";
import {
  SearchHistorySidebar,
  KeywordAlertsButton,
  useSearchHistory,
  useKeywordAlerts,
  checkKeywords,
} from "./processos/search-history";

function formatBRL(v: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v); }
const TIPO_LABELS: Record<string, string> = { lawsuit_cnj: "CNJ", cpf: "CPF", cnpj: "CNPJ", oab: "OAB", name: "Nome" };
const STATUS_MON: Record<string, { label: string; cor: string }> = { created: { label: "Ativo", cor: "bg-emerald-100 text-emerald-700" }, updating: { label: "Atualizando", cor: "bg-blue-100 text-blue-700" }, updated: { label: "Atualizado", cor: "bg-emerald-100 text-emerald-700" }, paused: { label: "Pausado", cor: "bg-amber-100 text-amber-700" } };
const CUSTO_LABELS: Record<string, string> = { consulta_cnj: "Consulta por CNJ", consulta_historica: "Consulta CPF/CNPJ/OAB/Nome", consulta_sintetica: "Consulta sintetica", monitorar_processo: "Monitorar processo", monitorar_pessoa: "Monitorar pessoa/empresa", resumo_ia: "Resumo IA", anexos: "Baixar anexos" };

// ═══════════════════════════════════════════════════════════════════════════════
// CARD DE PROCESSO (resultado expandivel)
// ═══════════════════════════════════════════════════════════════════════════════

function ProcessoCard({ processo, onMonitorar }: { processo: any; onMonitorar?: (cnj: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const { items: alerts } = useKeywordAlerts();
  const d = processo.response_data || processo;
  const ativos = (d.parties || []).filter((p: any) => p.side === "Active").slice(0, 5);
  const passivos = (d.parties || []).filter((p: any) => p.side === "Passive").slice(0, 5);
  const movs = (d.steps || []).slice(0, 10);
  const advs: any[] = [];
  (d.parties || []).forEach((p: any) => { (p.lawyers || []).forEach((l: any) => { if (advs.length < 5) advs.push(l); }); });

  // Contar movimentações que acionam algum alerta
  const movsComAlerta = (d.steps || []).filter((m: any) => checkKeywords(m.content || "", alerts).length > 0).length;

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0"><Scale className="h-5 w-5 text-indigo-500" /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold font-mono">{d.code || "-"}</p>
              {d.tribunal_acronym && <Badge variant="outline" className="text-[9px]">{d.tribunal_acronym}</Badge>}
              {d.instance && <Badge variant="outline" className="text-[9px]">{d.instance}a inst.</Badge>}
            </div>
            {d.classifications?.[0] && <p className="text-xs text-muted-foreground mt-0.5">{d.classifications[0].name}</p>}
            {d.courts?.[0] && <p className="text-[10px] text-muted-foreground">{d.courts[0].name}</p>}
            <div className="flex items-center gap-3 mt-0.5">
              {d.distribution_date && <span className="text-[10px] text-muted-foreground">Dist: {new Date(d.distribution_date).toLocaleDateString("pt-BR")}</span>}
              {d.amount && <span className="text-xs font-medium text-emerald-600">{formatBRL(d.amount)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {movsComAlerta > 0 && (
              <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/25 text-[9px] gap-1">
                <Bell className="h-2.5 w-2.5" />
                {movsComAlerta}
              </Badge>
            )}
            {onMonitorar && d.code && <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => onMonitorar(d.code)}><Radar className="h-3 w-3 mr-1" />Monitorar</Button>}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setAberto(!aberto)}>{aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
          </div>
        </div>

        {aberto && (
          <div className="mt-3 pt-3 border-t space-y-4">
            {d.subjects?.length > 0 && (<div><p className="text-[10px] font-semibold text-muted-foreground mb-1">ASSUNTOS</p><div className="flex flex-wrap gap-1">{d.subjects.map((s: any, i: number) => (<Badge key={i} variant="outline" className="text-[9px]">{s.name}</Badge>))}</div></div>)}

            <div className="grid grid-cols-2 gap-4">
              {ativos.length > 0 && (<div><p className="text-[10px] font-semibold text-blue-600 mb-1">POLO ATIVO</p>{ativos.map((p: any, i: number) => (<div key={i} className="flex items-center gap-1.5 text-xs py-0.5"><User className="h-3 w-3 text-blue-500 shrink-0" /><span className="truncate">{p.name}</span></div>))}</div>)}
              {passivos.length > 0 && (<div><p className="text-[10px] font-semibold text-red-600 mb-1">POLO PASSIVO</p>{passivos.map((p: any, i: number) => (<div key={i} className="flex items-center gap-1.5 text-xs py-0.5"><User className="h-3 w-3 text-red-500 shrink-0" /><span className="truncate">{p.name}</span></div>))}</div>)}
            </div>

            {advs.length > 0 && (<div><p className="text-[10px] font-semibold text-violet-600 mb-1">ADVOGADOS</p>{advs.map((l: any, i: number) => (<div key={i} className="flex items-center gap-1.5 text-xs py-0.5"><Gavel className="h-3 w-3 text-violet-500 shrink-0" /><span>{l.name}</span>{l.main_document && <span className="text-[9px] text-muted-foreground font-mono">{l.main_document}</span>}</div>))}</div>)}

            {movs.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground mb-2">
                  MOVIMENTAÇÕES ({d.steps?.length || 0} total)
                </p>
                {/* Timeline visual */}
                <div className="relative space-y-2 max-h-64 overflow-y-auto pl-4">
                  <div className="absolute left-1 top-1 bottom-1 w-px bg-indigo-200" />
                  {movs.map((m: any, i: number) => {
                    const matches = checkKeywords(m.content || "", alerts);
                    const hasAlert = matches.length > 0;
                    return (
                      <div key={i} className="relative">
                        <div
                          className={`absolute -left-3 top-1.5 h-2 w-2 rounded-full ring-2 ring-background ${
                            hasAlert ? "bg-blue-500 animate-pulse" : "bg-indigo-400"
                          }`}
                        />
                        <div
                          className={`text-xs pl-2 py-1 ${hasAlert ? "bg-blue-50 rounded pr-2" : ""}`}
                        >
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[9px] text-muted-foreground font-mono">
                              {m.step_date ? new Date(m.step_date).toLocaleDateString("pt-BR") : ""}
                            </span>
                            {hasAlert && (
                              <Badge className="bg-blue-500/20 text-blue-700 border-0 text-[8px] px-1 py-0">
                                <Bell className="h-2 w-2 mr-0.5" />
                                {matches[0]}
                              </Badge>
                            )}
                          </div>
                          <p className="leading-snug">{m.content}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA: CONSULTAR PROCESSOS
// ═══════════════════════════════════════════════════════════════════════════════

function ConsultarTab() {
  const [tipo, setTipo] = useState("lawsuit_cnj");
  const [valor, setValor] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [polling, setPolling] = useState(false);
  const [resultados, setResultados] = useState<any>(null);
  const [tentativas, setTentativas] = useState(0);
  const history = useSearchHistory();

  const consultarCNJ = trpc.juditProcessos.consultarCNJ.useMutation({ onSuccess: (d) => { setRequestId(d.requestId); setPolling(true); setTentativas(0); }, onError: (e) => { setBuscando(false); toast.error(e.message); } });
  const consultarDoc = trpc.juditProcessos.consultarDocumento.useMutation({ onSuccess: (d) => { setRequestId(d.requestId); setPolling(true); setTentativas(0); }, onError: (e) => { setBuscando(false); toast.error(e.message); } });
  const monitorarMut = trpc.juditProcessos.monitorarProcesso.useMutation({ onSuccess: () => toast.success("Monitoramento criado (5 creditos)"), onError: (e) => toast.error(e.message) });

  const { data: statusData } = trpc.juditProcessos.statusConsulta.useQuery({ requestId }, { enabled: !!requestId && polling, refetchInterval: polling ? 3000 : false });
  const { data: resData, refetch: refetchRes } = trpc.juditProcessos.resultados.useQuery({ requestId }, { enabled: !!requestId && statusData?.status === "completed", retry: false });

  useEffect(() => {
    if (statusData?.status === "completed") { setPolling(false); setBuscando(false); }
    if (polling) setTentativas(t => t + 1);
  }, [statusData?.status, polling]);

  useEffect(() => { if (resData) setResultados(resData); }, [resData]);

  // Timeout apos 40 tentativas (~2 min)
  useEffect(() => { if (tentativas > 40 && polling) { setPolling(false); setBuscando(false); toast.error("Busca demorou demais. Tente novamente."); } }, [tentativas]);

  const handleBuscar = () => {
    if (!valor.trim()) return;
    setBuscando(true); setResultados(null); setRequestId(""); setTentativas(0);
    history.add(tipo, valor.trim());
    if (tipo === "lawsuit_cnj") consultarCNJ.mutate({ cnj: valor.trim() });
    else consultarDoc.mutate({ tipo: tipo as any, valor: valor.trim() });
  };

  const handleSelectHistorico = (t: string, v: string) => {
    setTipo(t);
    setValor(v);
    setResultados(null);
  };

  const placeholders: Record<string, string> = { lawsuit_cnj: "0000000-00.0000.0.00.0000", cpf: "000.000.000-00", cnpj: "00.000.000/0000-00", oab: "SP123456", name: "Nome da parte" };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
      <div className="space-y-4 min-w-0">
      {/* Barra de busca */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-2">
            <Select value={tipo} onValueChange={(v) => { setTipo(v); setResultados(null); }}>
              <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lawsuit_cnj">CNJ</SelectItem>
                <SelectItem value="cpf">CPF</SelectItem>
                <SelectItem value="cnpj">CNPJ</SelectItem>
                <SelectItem value="oab">OAB</SelectItem>
                <SelectItem value="name">Nome</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={placeholders[tipo]} value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleBuscar(); }} className="pl-9" />
            </div>
            <Button onClick={handleBuscar} disabled={buscando || !valor.trim()}>
              {buscando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              Buscar
            </Button>
            <KeywordAlertsButton />
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
            <span>Custo: <strong>{tipo === "lawsuit_cnj" ? "1" : "5"} credito(s)</strong></span>
            {tipo !== "lawsuit_cnj" && <span className="text-amber-600">Buscas por {TIPO_LABELS[tipo]} podem levar ate 2 minutos</span>}
          </div>
        </CardContent>
      </Card>

      {/* Status da busca */}
      {buscando && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
          <Loader2 className="h-5 w-5 text-blue-500 animate-spin shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-700">Consultando tribunais...</p>
            <p className="text-xs text-blue-600">{tipo !== "lawsuit_cnj" ? `Buscando em todos os tribunais por ${TIPO_LABELS[tipo]}. Pode levar ate 2 minutos.` : "Resultado em ate 9 segundos."} {tentativas > 5 && `(${tentativas * 3}s)`}</p>
          </div>
        </div>
      )}

      {/* Resultados */}
      {resultados && resultados.page_data && resultados.page_data.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">{resultados.all_count || resultados.page_data.length} processo(s) encontrado(s)</p>
          {resultados.page_data.map((item: any, i: number) => (
            <ProcessoCard key={item.response_id || i} processo={item} onMonitorar={(cnj) => monitorarMut.mutate({ cnj })} />
          ))}
        </div>
      ) : resultados && !buscando ? (
        <div className="text-center py-12"><Scale className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" /><p className="text-sm text-muted-foreground">Nenhum processo encontrado.</p></div>
      ) : !buscando && !resultados ? (
        <div className="text-center py-12 space-y-2">
          <Scale className="h-10 w-10 text-muted-foreground/20 mx-auto" />
          <p className="font-medium">Consulte processos judiciais</p>
          <p className="text-sm text-muted-foreground">Busque por CNJ, CPF, CNPJ, OAB ou nome em +90 tribunais do Brasil.</p>
        </div>
      ) : null}
      </div>

      {/* Sidebar: histórico + favoritos */}
      <div className="hidden lg:block">
        <SearchHistorySidebar onSelect={handleSelectHistorico} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA: MONITORAR CLIENTES
// ═══════════════════════════════════════════════════════════════════════════════

function MonitorarTab() {
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoTipo, setNovoTipo] = useState("cpf");
  const [novoValor, setNovoValor] = useState("");
  const [novoNome, setNovoNome] = useState("");

  const { data, refetch, isLoading } = trpc.juditProcessos.listarMonitoramentos.useQuery(undefined, { retry: false });
  const pausarMut = trpc.juditProcessos.pausarMonitoramento.useMutation({ onSuccess: () => { toast.success("Pausado"); refetch(); } });
  const reativarMut = trpc.juditProcessos.reativarMonitoramento.useMutation({ onSuccess: () => { toast.success("Reativado"); refetch(); } });
  const deletarMut = trpc.juditProcessos.deletarMonitoramento.useMutation({ onSuccess: () => { toast.success("Removido"); refetch(); } });
  const monProcesso = trpc.juditProcessos.monitorarProcesso.useMutation({ onSuccess: () => { toast.success("Monitoramento criado"); setNovoOpen(false); setNovoValor(""); setNovoNome(""); refetch(); }, onError: (e) => toast.error(e.message) });
  const monPessoa = trpc.juditProcessos.monitorarPessoa.useMutation({ onSuccess: () => { toast.success("Monitoramento criado"); setNovoOpen(false); setNovoValor(""); setNovoNome(""); refetch(); }, onError: (e) => toast.error(e.message) });

  const handleCriar = () => {
    if (novoTipo === "lawsuit_cnj") monProcesso.mutate({ cnj: novoValor });
    else monPessoa.mutate({ tipo: novoTipo as any, valor: novoValor });
  };

  const mons = data?.monitoramentos || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Monitoramento de clientes e processos</p>
              <p className="text-xs text-muted-foreground mt-0.5">Receba alertas quando houver novas acoes judiciais contra seus clientes ou movimentacoes em processos.</p>
            </div>
            <Button size="sm" onClick={() => setNovoOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />Novo</Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? <Skeleton className="h-20 w-full" /> : mons.length > 0 ? (
        <div className="space-y-2">
          {mons.map((m: any) => {
            const st = STATUS_MON[m.status] || { label: m.status, cor: "" };
            return (
              <Card key={m.tracking_id}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                      {m.search?.search_type === "lawsuit_cnj" ? <Scale className="h-4 w-4 text-indigo-500" /> : <Users className="h-4 w-4 text-indigo-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-mono font-medium truncate">{m.search?.search_key || "-"}</p>
                        <Badge variant="outline" className="text-[9px] shrink-0">{TIPO_LABELS[m.search?.search_type] || m.search?.search_type}</Badge>
                        <Badge variant="outline" className={`text-[9px] shrink-0 ${st.cor}`}>{st.label}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                        <span>Atualiza a cada {m.recurrence} dia(s)</span>
                        <span>{m.tracked_items_count || 0} processo(s)</span>
                        <span>{m.tracked_items_steps_count || 0} movimentacao(oes)</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(m.status === "created" || m.status === "updated") && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-amber-600" title="Pausar" onClick={() => pausarMut.mutate({ trackingId: m.tracking_id })}><Pause className="h-3.5 w-3.5" /></Button>}
                      {m.status === "paused" && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600" title="Reativar" onClick={() => reativarMut.mutate({ trackingId: m.tracking_id })}><Play className="h-3.5 w-3.5" /></Button>}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Excluir" onClick={() => { if (confirm("Remover monitoramento?")) deletarMut.mutate({ trackingId: m.tracking_id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 space-y-2">
          <Radar className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">Nenhum monitoramento ativo.</p>
          <p className="text-xs text-muted-foreground">Adicione CPFs ou CNPJs dos seus clientes para detectar novas acoes judiciais automaticamente.</p>
        </div>
      )}

      {/* Dialog novo monitoramento */}
      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo monitoramento</DialogTitle>
            <DialogDescription>Monitore clientes ou processos. Voce sera notificado sobre novas acoes e movimentacoes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div><Label className="text-xs">O que monitorar?</Label>
              <Select value={novoTipo} onValueChange={setNovoTipo}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="cpf">Cliente (CPF) — 50 cred/mes</SelectItem>
                <SelectItem value="cnpj">Empresa (CNPJ) — 50 cred/mes</SelectItem>
                <SelectItem value="oab">Advogado (OAB) — 50 cred/mes</SelectItem>
                <SelectItem value="lawsuit_cnj">Processo (CNJ) — 5 cred/mes</SelectItem>
                <SelectItem value="name">Nome — 50 cred/mes</SelectItem>
              </SelectContent></Select>
            </div>
            <div><Label className="text-xs">{novoTipo === "lawsuit_cnj" ? "Numero do processo (CNJ)" : novoTipo === "cpf" ? "CPF do cliente" : novoTipo === "cnpj" ? "CNPJ da empresa" : novoTipo === "oab" ? "Numero da OAB" : "Nome completo"}</Label>
              <Input value={novoValor} onChange={(e) => setNovoValor(e.target.value)} className="mt-1" placeholder={novoTipo === "cpf" ? "000.000.000-00" : novoTipo === "cnpj" ? "00.000.000/0000-00" : novoTipo === "lawsuit_cnj" ? "0000000-00.0000.0.00.0000" : ""} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button onClick={handleCriar} disabled={(monProcesso.isPending || monPessoa.isPending) || !novoValor.trim()}>
              {(monProcesso.isPending || monPessoa.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Radar className="h-4 w-4 mr-2" />}
              Monitorar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA: CREDITOS
// ═══════════════════════════════════════════════════════════════════════════════

function CreditosTab() {
  const { data: saldoData, refetch } = trpc.juditProcessos.saldo.useQuery(undefined, { retry: false });
  const { data: txs } = trpc.juditProcessos.transacoes.useQuery({ limit: 30 }, { retry: false });
  const comprarMut = trpc.juditProcessos.adicionarCreditos.useMutation({ onSuccess: (d) => { toast.success(`+${d.adicionados} creditos adicionados!`); refetch(); }, onError: (e) => toast.error(e.message) });

  const saldo = saldoData?.saldo ?? 0;
  const pacotes = saldoData?.pacotes || [];
  const custos = saldoData?.custos || {};

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center gap-3"><Coins className="h-6 w-6 text-indigo-500" /><div><p className="text-2xl font-bold">{saldo}</p><p className="text-xs text-muted-foreground">Saldo atual</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center gap-3"><ShoppingCart className="h-6 w-6 text-emerald-500" /><div><p className="text-2xl font-bold text-emerald-600">{saldoData?.totalComprado ?? 0}</p><p className="text-xs text-muted-foreground">Total comprado</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center gap-3"><History className="h-6 w-6 text-amber-500" /><div><p className="text-2xl font-bold text-amber-600">{saldoData?.totalConsumido ?? 0}</p><p className="text-xs text-muted-foreground">Total consumido</p></div></div></CardContent></Card>
      </div>

      <div><h3 className="text-sm font-semibold mb-3">Comprar creditos</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          {pacotes.map((p: any) => (
            <Card key={p.id} className={`cursor-pointer hover:shadow-md transition-all ${p.popular ? "border-indigo-300 ring-1 ring-indigo-200" : ""}`}>
              <CardContent className="pt-4 pb-4 text-center">
                {p.popular && <Badge className="bg-indigo-500 text-white text-[9px] mb-2">Popular</Badge>}
                <p className="text-2xl font-bold">{p.creditos}</p>
                <p className="text-xs text-muted-foreground mb-1">creditos</p>
                <p className="text-sm font-semibold text-indigo-600">{formatBRL(p.preco)}</p>
                <p className="text-[10px] text-muted-foreground mb-2">{formatBRL(p.preco / p.creditos)}/credito</p>
                <Button size="sm" className="w-full text-xs" variant={p.popular ? "default" : "outline"} onClick={() => comprarMut.mutate({ pacoteId: p.id })} disabled={comprarMut.isPending}>Comprar</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Tabela de custos</CardTitle></CardHeader><CardContent><div className="space-y-1.5">{Object.entries(custos).map(([op, custo]) => (<div key={op} className="flex justify-between text-xs py-1 border-b border-dashed last:border-0"><span>{CUSTO_LABELS[op] || op}</span><span className="font-mono font-medium">{String(custo)} cred.</span></div>))}</div></CardContent></Card>

      {txs && txs.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Historico recente</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {txs.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between text-xs py-1.5 border-b border-dashed last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={t.tipo === "consumo" ? "text-red-500 font-medium" : "text-emerald-500 font-medium"}>{t.tipo === "consumo" ? "-" : "+"}{t.quantidade}</span>
                    <span className="text-muted-foreground truncate max-w-[200px]">{t.detalhes || t.operacao}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{t.createdAt ? new Date(t.createdAt).toLocaleDateString("pt-BR") : ""}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function Processos() {
  const [tab, setTab] = useState("consultar");
  const { data: saldoData } = trpc.juditProcessos.saldo.useQuery(undefined, { retry: false });
  const saldo = saldoData?.saldo ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Processos</h1>
          <p className="text-muted-foreground mt-1">Consulte, monitore e acompanhe processos judiciais.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200"><Coins className="h-4 w-4 text-indigo-500" /><span className="text-sm font-bold text-indigo-700">{saldo}</span><span className="text-[10px] text-indigo-500">cred.</span></div>
          <Button variant="outline" size="sm" onClick={() => setTab("creditos")}><ShoppingCart className="h-3.5 w-3.5 mr-1" />Comprar</Button>
        </div>
      </div>

      {saldo < 5 && (<div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5"><AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" /><span className="text-sm text-amber-700">Saldo baixo. Compre creditos para consultar e monitorar processos.</span><Button size="sm" variant="outline" className="ml-auto text-xs" onClick={() => setTab("creditos")}>Comprar</Button></div>)}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="consultar" className="gap-1.5"><Search className="h-3.5 w-3.5" />Consultar</TabsTrigger>
          <TabsTrigger value="monitorar" className="gap-1.5"><Radar className="h-3.5 w-3.5" />Monitorar clientes</TabsTrigger>
          <TabsTrigger value="creditos" className="gap-1.5"><Coins className="h-3.5 w-3.5" />Creditos ({saldo})</TabsTrigger>
        </TabsList>

        <TabsContent value="consultar" className="mt-4"><ConsultarTab /></TabsContent>
        <TabsContent value="monitorar" className="mt-4"><MonitorarTab /></TabsContent>
        <TabsContent value="creditos" className="mt-4"><CreditosTab /></TabsContent>
      </Tabs>
    </div>
  );
}
