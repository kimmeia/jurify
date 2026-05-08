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
import { Scale, Search, Loader2, Coins, Plus, Pause, Play, Trash2, AlertTriangle, Clock, Users, Gavel, ShoppingCart, History, Radar, CheckCircle2, ChevronDown, ChevronUp, User, Bell, KeyRound, Lock, Eye, EyeOff, ShieldAlert, Siren, FileText, MapPin, CircleDollarSign, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  SearchHistorySidebar,
  KeywordAlertsButton,
  useSearchHistory,
  useKeywordAlerts,
  checkKeywords,
} from "./processos/search-history";

function formatBRL(v: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v); }
const TIPO_LABELS: Record<string, string> = { lawsuit_cnj: "CNJ", cpf: "CPF", cnpj: "CNPJ", name: "Nome" };
const STATUS_MON: Record<string, { label: string; cor: string }> = { created: { label: "Ativo", cor: "bg-emerald-100 text-emerald-700" }, updating: { label: "Atualizando", cor: "bg-blue-100 text-blue-700" }, updated: { label: "Atualizado", cor: "bg-emerald-100 text-emerald-700" }, paused: { label: "Pausado", cor: "bg-amber-100 text-amber-700" } };
const CUSTO_LABELS: Record<string, string> = { consulta_cnj: "Consulta por CNJ", consulta_historica: "Consulta CPF/CNPJ/Nome", consulta_sintetica: "Consulta sintetica", monitorar_processo: "Monitorar processo", monitorar_pessoa: "Monitorar pessoa/empresa", resumo_ia: "Resumo IA", anexos: "Baixar anexos" };

/**
 * Indicador de saúde do monitoramento baseado na última atualização.
 * - verde pulsante: atualizado nas últimas 48h (OK)
 * - amarelo: sem atualização entre 48h e 7 dias (atenção)
 * - vermelho: sem atualização há mais de 7 dias (provável falha)
 * - cinza: pausado ou recém-criado sem dados ainda
 */
function MonitorHealthDot({ statusJudit, updatedAt, createdAt }: { statusJudit: string; updatedAt?: string | null; createdAt?: string | null }) {
  if (statusJudit === "paused") {
    return (
      <span className="relative flex h-3 w-3 shrink-0" title="Monitoramento pausado">
        <span className="h-3 w-3 rounded-full bg-gray-400" />
      </span>
    );
  }

  const ref = updatedAt || createdAt;
  if (!ref) {
    return (
      <span className="relative flex h-3 w-3 shrink-0" title="Aguardando primeira atualização">
        <span className="animate-pulse h-3 w-3 rounded-full bg-blue-400" />
      </span>
    );
  }

  const horasDesdeUpdate = (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60);

  if (horasDesdeUpdate <= 48) {
    return (
      <span className="relative flex h-3 w-3 shrink-0" title={`Monitoramento ativo — atualizado há ${Math.round(horasDesdeUpdate)}h`}>
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
      </span>
    );
  }

  if (horasDesdeUpdate <= 168) { // 7 dias
    return (
      <span className="relative flex h-3 w-3 shrink-0" title={`Atenção — sem atualização há ${Math.round(horasDesdeUpdate / 24)} dias`}>
        <span className="animate-pulse h-3 w-3 rounded-full bg-amber-500" />
      </span>
    );
  }

  return (
    <span className="relative flex h-3 w-3 shrink-0" title={`ALERTA — sem atualização há ${Math.round(horasDesdeUpdate / 24)} dias. Possível falha de conexão.`}>
      <span className="animate-pulse h-3 w-3 rounded-full bg-red-500" />
    </span>
  );
}

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
  const [credencialId, setCredencialId] = useState<string>("");
  const [vincularDialog, setVincularDialog] = useState<{ cnj: string; clientes: any[] } | null>(null);
  const history = useSearchHistory();

  // Credenciais do cofre para segredo de justiça
  const { data: credenciais } = trpc.cofreCredenciais.listarMinhas.useQuery(undefined, { retry: false }) ?? { data: undefined };
  const credsDisponiveis = (credenciais || []).filter((c: any) => c.status === "ativa" || c.status === "validando");

  const consultarCNJ = trpc.processos.consultarCNJ.useMutation({
    onSuccess: (d: any) => { setRequestId(d.requestId); setPolling(true); setTentativas(0); },
    onError: (e: any) => {
      setBuscando(false);
      // Erros do motor próprio (PRECONDITION_FAILED) trazem mensagem
      // instrutiva com link → /admin/cofre-credenciais. Mostra como
      // toast com action.
      const isCredencialAusente = /credencial OAB|cadastre/i.test(e.message);
      const isSessaoExpirada = /sess[aã]o.*expirou|Validar pra renovar/i.test(e.message);
      if (isCredencialAusente || isSessaoExpirada) {
        toast.error(isCredencialAusente ? "Cadastre credencial" : "Sessão expirou", {
          description: e.message.replace(/→.*$/, "").trim(),
          action: {
            label: "Abrir Cofre",
            onClick: () => {
              window.location.href = "/cofre-credenciais";
            },
          },
          duration: 10000,
        });
      } else {
        toast.error(e.message);
      }
    },
  });
  const consultarDoc = (trpc.processos as any).consultarDocumento.useMutation({ onSuccess: (d: any) => { setRequestId(d.requestId); setPolling(true); setTentativas(0); }, onError: (e: any) => { setBuscando(false); toast.error(e.message); } });
  // Buscar clientes do escritório para verificar se partes do processo são clientes
  const { data: clientesData } = trpc.clientes.listar.useQuery({ limite: 100 });
  const todosClientes = clientesData?.clientes || [];

  const monitorarMut = (trpc.processos.criarMonitoramento as any).useMutation({
    onSuccess: () => toast.success("Processo adicionado às Movimentações (5 cred/mês)"),
    onError: (e: any) => toast.error("Erro ao monitorar", { description: e.message }),
  });

  const vincularMut = (trpc as any).clienteProcessos.vincular.useMutation({
    onSuccess: (r: any) => {
      toast.success(r.monitorando ? "Processo vinculado ao cliente e monitoramento criado!" : "Processo vinculado ao cliente!");
      setVincularDialog(null);
    },
    onError: (e: any) => toast.error("Erro ao vincular", { description: e.message }),
  });

  /** Ao clicar "Monitorar" num ProcessoCard: cria monitoramento E verifica se partes são clientes */
  const handleMonitorar = (cnj: string, processo?: any) => {
    // 1. Criar monitoramento
    monitorarMut.mutate({ numeroCnj: cnj, credencialId: credencialId ? Number(credencialId) : undefined });

    // 2. Verificar se alguma parte do processo é cliente cadastrado
    if (processo && todosClientes.length > 0) {
      const d = processo.response_data || processo;
      const parteDocs = (d.parties || [])
        .map((p: any) => (p.main_document || "").replace(/\D/g, ""))
        .filter((doc: string) => doc.length >= 11);

      const clientesEncontrados = todosClientes.filter((c: any) => {
        const cpfClean = (c.cpfCnpj || "").replace(/\D/g, "");
        return cpfClean && parteDocs.includes(cpfClean);
      });

      if (clientesEncontrados.length > 0) {
        setVincularDialog({ cnj, clientes: clientesEncontrados });
      }
    }
  };

  const { data: statusData } = trpc.processos.statusConsulta.useQuery({ requestId }, { enabled: !!requestId && polling, refetchInterval: polling ? 3000 : false });

  // `resultados` virou mutation (tem efeito colateral: cobra créditos por
  // processo encontrado). Chamamos uma vez quando o status fica completed.
  const resultadosMut = trpc.processos.resultados.useMutation({
    onSuccess: (data: any) => {
      setResultados(data);
      if (data?.custoExtraCobrado && data.custoExtraCobrado > 0) {
        toast.success(
          `${data.totalProcessosEncontrados} processos encontrados. Cobrado: ${data.custoExtraCobrado} créditos adicionais.`,
        );
      } else if (data?.custoExtraErro) {
        toast.error(
          `Resultados parciais: créditos insuficientes pra cobrar o custo variável (${data.custoExtraNecessario}). Compre mais créditos pra ver tudo.`,
          { duration: 10000 },
        );
      }
    },
    onError: (e: any) => { toast.error("Erro ao buscar resultados: " + e.message); setBuscando(false); setPolling(false); },
  });

  useEffect(() => {
    if (statusData?.status === "completed") {
      setPolling(false);
      setBuscando(false);
      // Dispara busca dos resultados uma única vez
      if (requestId && !resultados) {
        resultadosMut.mutate({ requestId });
      }
    }
    // `status: "error"` é reservado pra exceções não tratadas no runner
    // (Playwright crash, timeout duro). Erros de domínio (credencial
    // faltando, captcha, tribunal off) chegam como "completed" com
    // `application_error` no resultado.
    if (statusData?.status === "error") {
      setPolling(false);
      setBuscando(false);
      toast.error("Falha inesperada no motor", {
        description: "O scraper não conseguiu completar. Tente novamente; se persistir, valide a credencial em /cofre-credenciais.",
        duration: 10000,
      });
    }
    if (polling) setTentativas(t => t + 1);
  }, [statusData?.status, polling, requestId]);

  // Timeout apos 40 tentativas (~2 min)
  useEffect(() => { if (tentativas > 40 && polling) { setPolling(false); setBuscando(false); toast.error("Busca demorou demais. Tente novamente."); } }, [tentativas]);

  const handleBuscar = () => {
    if (!valor.trim()) return;
    setBuscando(true); setResultados(null); setRequestId(""); setTentativas(0);
    history.add(tipo, valor.trim());
    const credId = credencialId ? Number(credencialId) : undefined;
    if (tipo === "lawsuit_cnj") (consultarCNJ.mutate as any)({ cnj: valor.trim(), credencialId: credId });
    else (consultarDoc.mutate as any)({ tipo: tipo as any, valor: valor.trim(), credencialId: credId });
  };

  const handleSelectHistorico = (t: string, v: string) => {
    setTipo(t);
    setValor(v);
    setResultados(null);
  };

  const placeholders: Record<string, string> = { lawsuit_cnj: "0000000-00.0000.0.00.0000", cpf: "000.000.000-00", cnpj: "00.000.000/0000-00" };

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

          {/* Seletor de credencial para segredo de justiça */}
          <div className="flex items-center gap-2 mt-2">
            {credsDisponiveis.length > 0 ? (
              <div className="flex items-center gap-2 flex-1">
                <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <select
                  value={credencialId}
                  onChange={(e) => setCredencialId(e.target.value)}
                  className="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm flex-1 max-w-xs"
                >
                  <option value="">Sem credencial (apenas processos públicos)</option>
                  {credsDisponiveis.map((c: any) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.customerKey} ({c.username}) {c.status === "validando" ? "— validando" : ""}
                    </option>
                  ))}
                </select>
                <span className="text-[9px] text-muted-foreground shrink-0">Selecione para ver processos em segredo de justiça</span>
              </div>
            ) : (
              <p className="text-[9px] text-muted-foreground flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Cadastre uma credencial OAB no Cofre para acessar processos em segredo de justiça.
              </p>
            )}
          </div>

          <div className="mt-2">
            {tipo === "lawsuit_cnj" ? (
              <p className="text-[10px] text-muted-foreground">
                Custo: <strong className="text-foreground">1 crédito</strong> — consulta direta por número do processo.
              </p>
            ) : (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 p-2 text-[11px] text-amber-900 dark:text-amber-100">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Busca por {TIPO_LABELS[tipo]} — custo variável</p>
                    <p className="mt-0.5 text-[10px] opacity-90">
                      Cobramos <strong>3 créditos base</strong> + <strong>1 crédito por lote de 10 processos</strong> encontrados (sem teto).
                      Ex: 30 processos = 3 base + 3 lotes = 6 créditos. Se não encontrar nada, só os 3 base.
                    </p>
                    <p className="mt-0.5 text-[10px] opacity-80">
                      Pode levar até 2 minutos.
                    </p>
                  </div>
                </div>
              </div>
            )}
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
          {(() => {
            // Detecta application_error (motor próprio falhou — credencial,
            // tribunal off, captcha, parser quebrou)
            const erros = resultados.page_data.filter(
              (item: any) => item.response_type === "application_error",
            );
            if (erros.length > 0) {
              const e = erros[0].response_data || {};
              const codigo = String(e.code || "outro");
              const isCredencial = /credencial|sess[aã]o|login/i.test(codigo) || /credencial|sess[aã]o|login/i.test(e.message || "");
              return (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
                  <p className="text-sm font-semibold text-red-900">Falha na consulta</p>
                  <p className="text-sm text-red-800">{e.message || "Erro desconhecido"}</p>
                  {isCredencial && (
                    <Button size="sm" variant="outline" onClick={() => (window.location.href = "/cofre-credenciais")}>
                      Abrir Cofre de Credenciais
                    </Button>
                  )}
                  <p className="text-xs text-red-700/70">Código: {codigo}</p>
                </div>
              );
            }
            // Filtra respostas com dados de processo (ignora application_info)
            const processos = resultados.page_data.filter(
              (item: any) =>
                (item.response_type === "lawsuit" || item.response_type === "lawsuits") &&
                item.response_data &&
                typeof item.response_data === "object" &&
                (item.response_data.code || item.response_data.name),
            );
            return (
              <>
                <p className="text-sm font-medium">{processos.length} processo(s) encontrado(s)</p>
                {processos.map((item: any, i: number) => (
                  <ProcessoCard key={item.response_id || i} processo={item} onMonitorar={(cnj) => handleMonitorar(cnj, item)} />
                ))}
              </>
            );
          })()}
        </div>
      ) : resultados && !buscando ? (
        <div className="text-center py-12"><Scale className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" /><p className="text-sm text-muted-foreground">Nenhum processo encontrado.</p></div>
      ) : !buscando && !resultados ? (
        <div className="text-center py-12 space-y-2">
          <Scale className="h-10 w-10 text-muted-foreground/20 mx-auto" />
          <p className="font-medium">Consulte processos judiciais</p>
          <p className="text-sm text-muted-foreground">Busque por CNJ, CPF ou CNPJ em +90 tribunais do Brasil.</p>
        </div>
      ) : null}
      </div>

      {/* Sidebar: histórico + favoritos */}
      <div className="hidden lg:block">
        <SearchHistorySidebar onSelect={handleSelectHistorico} />
      </div>

      {/* Dialog: vincular processo a cliente encontrado */}
      {vincularDialog && (
        <Dialog open={!!vincularDialog} onOpenChange={() => setVincularDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cliente encontrado no processo</DialogTitle>
              <DialogDescription>
                Identificamos que uma parte deste processo é um cliente cadastrado. Deseja vincular?
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {vincularDialog.clientes.map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50">
                  <div className="h-9 w-9 rounded-full bg-violet-100 flex items-center justify-center text-xs font-bold text-violet-700">
                    {(c.nome || "?")[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.nome}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{c.cpfCnpj}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={vincularMut.isPending}
                    onClick={() => vincularMut.mutate({
                      contatoId: c.id,
                      numeroCnj: vincularDialog.cnj,
                      monitorar: false,
                    })}
                  >
                    {vincularMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Vincular"}
                  </Button>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setVincularDialog(null)}>Pular</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CARD DE MONITORAMENTO (expansível — mostra timeline de movimentações)
// ═══════════════════════════════════════════════════════════════════════════════

function MonitoramentoCard({
  mon,
  onPausar,
  onReativar,
  onDeletar,
}: {
  mon: any;
  onPausar: () => void;
  onReativar: () => void;
  onDeletar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [resumoIA, setResumoIA] = useState<string | null>(null);
  // Suporta formato local DB (statusJudit/searchKey) e Judit API (status/search.search_key)
  const status = mon.statusJudit || mon.status || "created";
  const searchKey = mon.searchKey || mon.search?.search_key || "-";

  const [processoCompleto, setProcessoCompleto] = useState<any>(null);

  const resumoMut = (trpc.processos as any).resumoIA.useMutation({
    onSuccess: (data: any) => {
      setResumoIA(data.resumo);
      // O resumo IA agora retorna o processo completo junto
      if (data.processo) setProcessoCompleto(data.processo);
      const fonteLabel = data.fonte === "judit_ia" ? " — Judit IA" : data.fonte === "ia" ? " — análise IA" : "";
      toast.success(`Resumo gerado (1 crédito)${fonteLabel}`);
    },
    onError: (e: any) => toast.error("Erro no resumo IA", { description: e.message }),
  });

  const buscarCompletoMut = (trpc.processos as any).buscarProcessoCompleto.useMutation({
    onSuccess: (data: any) => {
      if (data.encontrado && data.processo) {
        setProcessoCompleto(data.processo);
        toast.success("Histórico completo carregado e salvo (1 crédito)");
        // Refetch historico local pra que o dado persistido apareça na próxima abertura
        if (mon.id) refetchHist();
      } else {
        toast.error(data.mensagem || "Processo não encontrado");
      }
    },
    onError: (e: any) => toast.error("Erro ao buscar", { description: e.message }),
  });

  const searchType = mon.searchType || mon.search?.search_type || "";
  const st = STATUS_MON[status] || { label: status, cor: "" };

  // Busca o histórico de movimentações quando o card abre (local DB — atualizações do webhook)
  const { data: historico, isLoading: loadingHist, refetch: refetchHist } = (trpc.processos as any).historicoMonitoramento.useQuery(
    { monitoramentoId: mon.id, page: 1, pageSize: 50 },
    { enabled: aberto && !!mon.id, retry: false },
  );

  // Extrai dados do processo: prioridade para busca completa, fallback para webhook local
  const respostas = historico?.items || [];
  const ultimaResposta = respostas.find((r: any) => r.responseType === "lawsuit");
  let processoData: any = null;
  // 1. Prioridade: processo completo buscado sob demanda (botão Histórico)
  if (processoCompleto) {
    processoData = processoCompleto;
  } else if (ultimaResposta?.responseData) {
    // 2. Fallback: dados do webhook (atualizações)
    try {
      processoData = typeof ultimaResposta.responseData === "string"
        ? JSON.parse(ultimaResposta.responseData)
        : ultimaResposta.responseData;
    } catch { /* ignore */ }
  }
  const steps: any[] = processoData?.steps || [];
  const partes: any[] = processoData?.parties || [];
  const ativos = partes.filter((p: any) => p.side === "Active").slice(0, 5);
  const passivos = partes.filter((p: any) => p.side === "Passive").slice(0, 5);

  return (
    <Card className="transition-all hover:shadow-sm">
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setAberto(!aberto)}>
          <MonitorHealthDot
            statusJudit={status}
            updatedAt={mon.updatedAt ? (typeof mon.updatedAt === "string" ? mon.updatedAt : (mon.updatedAt as Date).toISOString()) : null}
            createdAt={mon.createdAt ? (typeof mon.createdAt === "string" ? mon.createdAt : (mon.createdAt as Date).toISOString()) : null}
          />
          <div className="h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
            {searchType === "lawsuit_cnj" ? <Scale className="h-4 w-4 text-indigo-500" /> : <Users className="h-4 w-4 text-indigo-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-mono font-medium truncate">{mon.apelido || searchKey}</p>
              <Badge variant="outline" className="text-[9px] shrink-0">{TIPO_LABELS[searchType] || searchType}</Badge>
              <Badge variant="outline" className={`text-[9px] shrink-0 ${st.cor}`}>{st.label}</Badge>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
              <span className="font-mono">{searchKey}</span>
              <span>{mon.totalAtualizacoes || 0} atualização(ões)</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {searchType === "lawsuit_cnj" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[10px] text-indigo-600"
                  title="Atualizar processo agora — consulta tribunal (1 crédito)"
                  disabled={buscarCompletoMut.isPending}
                  onClick={() => buscarCompletoMut.mutate({ cnj: searchKey, credencialId: mon.credencialId || undefined, monitoramentoId: mon.id })}
                >
                  {buscarCompletoMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
                  Histórico
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[10px] text-violet-600"
                  title="Gerar resumo IA detalhado (1 crédito)"
                  disabled={resumoMut.isPending}
                  onClick={() => resumoMut.mutate({ cnj: searchKey })}
                >
                  {resumoMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileText className="h-3 w-3 mr-1" />}
                  Resumo IA
                </Button>
              </>
            )}
            {(status === "created" || status === "updated" || status === "updating") && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-amber-600" title="Pausar" onClick={onPausar}>
                <Pause className="h-3.5 w-3.5" />
              </Button>
            )}
            {status === "paused" && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600" title="Reativar" onClick={onReativar}>
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Excluir" onClick={onDeletar}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); setAberto(!aberto); }}>
              {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {aberto && (
          <div className="mt-3 pt-3 border-t space-y-4">
            {/* Resumo IA */}
            {resumoIA && (
              <div className="rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200/50 p-3">
                <p className="text-[10px] font-semibold text-violet-600 mb-1.5 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> RESUMO IA
                </p>
                <div className="text-xs leading-relaxed whitespace-pre-line text-violet-900 dark:text-violet-100">
                  {resumoIA}
                </div>
              </div>
            )}

            {loadingHist ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : !processoData ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>Ainda não há dados do processo.</p>
                <p className="text-[10px] mt-1">Clique em <strong>Histórico</strong> pra puxar agora (1 crédito) ou aguarde o próximo poll automático (até 6h).</p>
              </div>
            ) : (
              <>
                {/* Cabeçalho do processo */}
                <div className="flex items-center gap-2 flex-wrap">
                  {processoData.tribunal_acronym && (
                    <Badge variant="outline" className="text-[10px]">
                      <MapPin className="h-2.5 w-2.5 mr-0.5" />
                      {processoData.tribunal_acronym}
                    </Badge>
                  )}
                  {processoData.instance && (
                    <Badge variant="outline" className="text-[10px]">{processoData.instance}ª instância</Badge>
                  )}
                  {processoData.amount && (
                    <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[10px]">
                      <CircleDollarSign className="h-2.5 w-2.5 mr-0.5" />
                      {formatBRL(processoData.amount)}
                    </Badge>
                  )}
                </div>

                {processoData.classifications?.[0] && (
                  <p className="text-xs text-muted-foreground">{processoData.classifications[0].name}</p>
                )}

                {/* Partes */}
                {(ativos.length > 0 || passivos.length > 0) && (
                  <div className="grid grid-cols-2 gap-3">
                    {ativos.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-blue-600 mb-1">POLO ATIVO</p>
                        {ativos.map((p: any, i: number) => (
                          <p key={i} className="text-xs truncate">{p.name}</p>
                        ))}
                      </div>
                    )}
                    {passivos.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-red-600 mb-1">POLO PASSIVO</p>
                        {passivos.map((p: any, i: number) => (
                          <p key={i} className="text-xs truncate">{p.name}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Timeline de movimentações */}
                {steps.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground mb-2">
                      MOVIMENTAÇÕES ({steps.length})
                    </p>
                    <div className="relative space-y-3 max-h-96 overflow-y-auto pl-4">
                      <div className="absolute left-1 top-1 bottom-1 w-px bg-indigo-200 dark:bg-indigo-900" />
                      {steps.map((s: any, i: number) => (
                        <div key={i} className="relative">
                          <div className="absolute -left-3 top-1.5 h-2 w-2 rounded-full bg-indigo-400 ring-2 ring-background" />
                          <div className="text-xs">
                            {s.step_date && (
                              <span className="text-[10px] text-muted-foreground font-medium">
                                {new Date(s.step_date).toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                })}
                              </span>
                            )}
                            <p className="text-[11px] leading-tight mt-0.5">{s.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Sem movimentações registradas ainda.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA: MONITORAR CLIENTES
// ═══════════════════════════════════════════════════════════════════════════════

function MonitorarTab() {
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoValor, setNovoValor] = useState("");
  const [novoCredencialId, setNovoCredencialId] = useState<string>("");

  const { data: mons, refetch, isLoading } = trpc.processos.meusMonitoramentos.useQuery(
    { tipoMonitoramento: "movimentacoes" },
    { retry: false },
  );
  const listaMons = mons || [];

  // Credenciais do cofre
  const { data: credenciais } = trpc.cofreCredenciais.listarMinhas.useQuery(undefined, { retry: false }) ?? { data: undefined };
  const credsAtivas = (credenciais || []).filter((c: any) => c.status === "ativa" || c.status === "validando");

  const criarMut = (trpc.processos.criarMonitoramento as any).useMutation({
    onSuccess: () => {
      toast.success("Monitoramento de movimentações criado!");
      setNovoOpen(false);
      setNovoValor("");
      setNovoCredencialId("");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const pausarMut = trpc.processos.pausarMonitoramento.useMutation({ onSuccess: () => { toast.success("Pausado"); refetch(); } });
  const reativarMut = trpc.processos.reativarMonitoramento.useMutation({ onSuccess: () => { toast.success("Reativado"); refetch(); } });
  const deletarMut = trpc.processos.deletarMonitoramento.useMutation({
    onSuccess: (r: any) => {
      if (r?.juditErro) toast.warning("Removido localmente", { description: `Falha na Judit: ${r.juditErro}` });
      else toast.success("Monitoramento removido");
      refetch();
    },
    onError: (e: any) => toast.error("Erro ao remover", { description: e.message }),
  });

  const semCredenciais = !credsAtivas || credsAtivas.length === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Monitoramento de movimentações processuais</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Acompanhe despachos, sentenças e audiências de processos específicos.
                Requer credencial OAB cadastrada no Cofre.
              </p>
            </div>
            <Button size="sm" onClick={() => setNovoOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />Novo
            </Button>
          </div>
        </CardContent>
      </Card>

      {semCredenciais && (
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 p-3 flex items-start gap-3">
          <Lock className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800 dark:text-blue-300">
            Processos públicos podem ser monitorados sem credencial.
            Para processos em <strong>segredo de justiça</strong>, cadastre uma credencial OAB no <strong>Cofre</strong>.
          </p>
        </div>
      )}

      {isLoading ? <Skeleton className="h-20 w-full" /> : listaMons.length > 0 ? (
        <div className="space-y-2">
          {listaMons.map((m: any) => (
            <MonitoramentoCard
              key={m.id}
              mon={m}
              onPausar={() => pausarMut.mutate({ id: m.id })}
              onReativar={() => reativarMut.mutate({ id: m.id })}
              onDeletar={() => { if (confirm("Remover monitoramento?")) deletarMut.mutate({ id: m.id }); }}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 space-y-2">
          <Radar className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">Nenhum monitoramento de movimentações ativo.</p>
          <p className="text-xs text-muted-foreground">
            {semCredenciais
              ? "Cadastre uma credencial OAB no Cofre para começar."
              : "Adicione um número de processo (CNJ) para acompanhar movimentações."}
          </p>
        </div>
      )}

      {/* Dialog novo monitoramento — requer credencial OAB */}
      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Monitorar movimentações</DialogTitle>
            <DialogDescription>
              Informe o número do processo (CNJ) e selecione a credencial OAB para acompanhar movimentações.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label className="text-xs">Número do processo (CNJ) *</Label>
              <Input
                value={novoValor}
                onChange={(e) => setNovoValor(e.target.value)}
                className="mt-1"
                placeholder="0000000-00.0000.0.00.0000"
              />
            </div>
            <div>
              <Label className="text-xs">Credencial OAB *</Label>
              <Select value={novoCredencialId} onValueChange={setNovoCredencialId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a credencial" /></SelectTrigger>
                <SelectContent>
                  {credsAtivas.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      <span className="flex items-center gap-2">
                        <KeyRound className="h-3 w-3" />
                        {c.customerKey} ({c.username})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 p-3 text-xs flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-blue-900 dark:text-blue-200 space-y-1">
                <p className="font-semibold">Proteção de dados (LGPD)</p>
                <p>
                  O monitoramento de movimentações requer credencial OAB para garantir que apenas
                  advogados habilitados acessem dados processuais. Custo: 5 créditos/mês.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button
              onClick={() =>
                criarMut.mutate({
                  numeroCnj: novoValor.trim(),
                  credencialId: novoCredencialId ? Number(novoCredencialId) : undefined,
                })
              }
              disabled={!novoValor.trim() || criarMut.isPending}
            >
              {criarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Radar className="h-4 w-4 mr-2" />}
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
  const { data: saldoData, refetch } = trpc.processos.saldo.useQuery(undefined, { retry: false });
  const { data: txs } = (trpc.processos.transacoes.useQuery as any)({ limit: 30 }, { retry: false });
  const { data: pacotesData } = trpc.processos.pacotes.useQuery(undefined, { retry: false });
  const comprarMut = (trpc.processos.adicionarCreditos.useMutation as any)({ onSuccess: (d: any) => { toast.success(`+${d.adicionados} creditos adicionados!`); refetch(); }, onError: (e: any) => toast.error(e.message) });

  const saldo = saldoData?.saldo ?? 0;
  const pacotes = pacotesData?.pacotes ?? [];
  const custos = pacotesData?.custos ?? {};

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
                <Button size="sm" className="w-full text-xs" variant={p.popular ? "default" : "outline"} onClick={() => (comprarMut.mutate as any)({ pacoteId: p.id })} disabled={comprarMut.isPending}>Comprar</Button>
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
  const { data: saldoData } = trpc.processos.saldo.useQuery(undefined, { retry: false });
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
        <TabsList className="grid w-full grid-cols-4 h-auto">
          <TabsTrigger value="consultar" className="gap-1.5 text-xs py-2">
            <Search className="h-3.5 w-3.5" />Consultar
          </TabsTrigger>
          <TabsTrigger value="movimentacoes" className="gap-1.5 text-xs py-2">
            <Radar className="h-3.5 w-3.5" />Movimentações
          </TabsTrigger>
          <TabsTrigger value="novas-acoes" className="gap-1.5 text-xs py-2 relative">
            <Siren className="h-3.5 w-3.5" />Novas Ações
            <NovasAcoesBadge />
          </TabsTrigger>
          <TabsTrigger value="cofre" className="gap-1.5 text-xs py-2">
            <KeyRound className="h-3.5 w-3.5" />Cofre
          </TabsTrigger>
        </TabsList>

        <TabsContent value="consultar" className="mt-4"><ConsultarTab /></TabsContent>
        <TabsContent value="movimentacoes" className="mt-4"><MonitorarTab /></TabsContent>
        <TabsContent value="novas-acoes" className="mt-4"><NovasAcoesTab /></TabsContent>
        <TabsContent value="cofre" className="mt-4"><CofreTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BADGE DE NOVAS AÇÕES NÃO LIDAS
// ═══════════════════════════════════════════════════════════════════════════════

function NovasAcoesBadge() {
  const { data } = (trpc.processos as any).listarNovasAcoes.useQuery(
    { apenasNaoLidas: true, limite: 1 },
    { retry: false, refetchInterval: 60000 },
  );
  const count = data?.totalNaoLidas ?? 0;
  if (count === 0) return null;
  return (
    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
      {count > 9 ? "9+" : count}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: NOVAS AÇÕES
// ═══════════════════════════════════════════════════════════════════════════════

const AREA_CORES: Record<string, string> = {
  Trabalhista: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  Tributário: "bg-indigo-500/15 text-indigo-700 border-indigo-500/30",
  Previdenciário: "bg-sky-500/15 text-sky-700 border-sky-500/30",
  Consumidor: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  Bancário: "bg-violet-500/15 text-violet-700 border-violet-500/30",
  Família: "bg-pink-500/15 text-pink-700 border-pink-500/30",
  Civil: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  Penal: "bg-red-500/15 text-red-700 border-red-500/30",
  Empresarial: "bg-purple-500/15 text-purple-700 border-purple-500/30",
  Imobiliário: "bg-orange-500/15 text-orange-700 border-orange-500/30",
  Outros: "bg-slate-500/15 text-slate-700 border-slate-500/30",
};

function NovasAcoesTab() {
  const [apenasNaoLidas, setApenasNaoLidas] = useState(false);
  const [novoOpen, setNovoOpen] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState<any>(null);
  const [credencialId, setCredencialId] = useState<string>("");

  const { data: credenciais } = trpc.cofreCredenciais.listarMinhas.useQuery(undefined, { retry: false }) ?? { data: undefined };
  const credsAtivas = (credenciais || []).filter((c: any) => c.status === "ativa");

  const { data, refetch, isLoading } = (trpc.processos as any).listarNovasAcoes.useQuery(
    { apenasNaoLidas, limite: 100 },
    { retry: false },
  );

  // Busca clientes cadastrados para seleção
  const { data: clientesData } = trpc.clientes.listar.useQuery(
    { busca: buscaCliente || undefined, limite: 20 },
    { enabled: novoOpen },
  );
  const clientes = (clientesData?.clientes || []).filter((c: any) => c.cpfCnpj);

  const criarMut = (trpc.processos as any).criarMonitoramentoNovasAcoes.useMutation({
    onSuccess: () => {
      toast.success("Monitoramento criado!");
      setNovoOpen(false);
      setBuscaCliente("");
      setClienteSelecionado(null);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const marcarLidaMut = trpc.processos.marcarNovaAcaoLida.useMutation({
    onSuccess: () => refetch(),
  });

  const deletarMonMut = trpc.processos.deletarMonitoramento.useMutation({
    onSuccess: (r: any) => {
      if (r?.juditErro) {
        toast.warning("Removido localmente", { description: `Falha na Judit: ${r.juditErro}. A cobrança mensal foi interrompida.` });
      } else {
        toast.success("Monitoramento removido", { description: "A cobrança mensal foi interrompida." });
      }
      refetch();
    },
    onError: (e: any) => toast.error("Erro ao remover", { description: e.message }),
  });

  const acoes = data?.acoes || [];
  const monitoramentos = data?.monitoramentos || [];

  return (
    <div className="space-y-4">
      <Card className="border-red-500/20 bg-gradient-to-br from-red-50/40 to-orange-50/40 dark:from-red-950/10 dark:to-orange-950/10">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                <Siren className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-sm">Alerta de novas ações contra clientes</p>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
                  Selecione clientes cadastrados e seja avisado IMEDIATAMENTE quando
                  uma nova ação for distribuída contra eles — antes mesmo da citação chegar.
                  Funciona para ações de busca e apreensão, reclamações trabalhistas, execuções, etc.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={() => setNovoOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />Novo monitoramento
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cards dos clientes sendo monitorados (contexto) */}
      {monitoramentos.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            Monitorando {monitoramentos.length} {monitoramentos.length === 1 ? "cliente" : "clientes"}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {monitoramentos.map((m: any) => (
              <Card key={m.id} className="group hover:shadow-sm transition-all">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-2">
                    <MonitorHealthDot
                      statusJudit={m.statusJudit}
                      updatedAt={m.updatedAt}
                      createdAt={m.createdAt}
                    />
                    <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                      <User className="h-3.5 w-3.5 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">
                        {m.apelido || m.searchKey}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">
                        {(m.searchType || "").toUpperCase()}: {m.searchKey}
                      </p>
                    </div>
                    {m.totalNovasAcoes > 0 && (
                      <Badge className="bg-red-500/15 text-red-700 border-red-500/30 text-[9px] shrink-0">
                        {m.totalNovasAcoes}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      title="Remover monitoramento"
                      onClick={() => {
                        if (confirm(`Parar de monitorar ${m.apelido || m.searchKey}?\n\nA cobrança mensal será interrompida.`))
                          deletarMonMut.mutate({ id: m.id });
                      }}
                      disabled={deletarMonMut.isPending}
                    >
                      {deletarMonMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {acoes.length} {acoes.length === 1 ? "nova ação" : "novas ações"} detectada{acoes.length === 1 ? "" : "s"}
          {data?.totalNaoLidas ? ` (${data.totalNaoLidas} não lidas)` : ""}
        </p>
        <Button
          size="sm"
          variant={apenasNaoLidas ? "default" : "outline"}
          onClick={() => setApenasNaoLidas(!apenasNaoLidas)}
        >
          <Bell className="h-3 w-3 mr-1" />
          {apenasNaoLidas ? "Mostrando só não lidas" : "Filtrar não lidas"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : acoes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Siren className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium">Nenhuma nova ação detectada</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Quando houver novos processos contra seus clientes monitorados, eles aparecerão aqui.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {acoes.map((a: any) => {
            const areaColor = AREA_CORES[a.areaDireito || "Outros"] || AREA_CORES.Outros;
            return (
              <Card
                key={a.id}
                className={`cursor-pointer transition-all hover:shadow-md ${!a.lido ? "border-red-500/40 bg-red-50/30 dark:bg-red-950/10" : ""}`}
                onClick={() => { if (!a.lido) marcarLidaMut.mutate({ id: a.id }); }}
              >
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start gap-3">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${!a.lido ? "bg-red-500/15" : "bg-slate-500/10"}`}>
                      {!a.lido ? (
                        <Siren className="h-4 w-4 text-red-600 animate-pulse" />
                      ) : (
                        <Scale className="h-4 w-4 text-slate-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold font-mono">{a.cnj}</p>
                        {a.tribunal && <Badge variant="outline" className="text-[9px]">{a.tribunal}</Badge>}
                        {a.areaDireito && (
                          <Badge className={`${areaColor} text-[9px]`}>{a.areaDireito}</Badge>
                        )}
                        {!a.lido && (
                          <Badge className="bg-red-500 text-white text-[9px]">NOVO</Badge>
                        )}
                      </div>
                      {/* Contexto do cliente monitorado */}
                      {(a.clienteApelido || a.clienteSearchKey) && (
                        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-violet-700 dark:text-violet-400">
                          <User className="h-3 w-3" />
                          <span className="font-medium">Cliente monitorado:</span>
                          <span className="font-semibold truncate">
                            {a.clienteApelido || a.clienteSearchKey}
                          </span>
                          {a.clienteApelido && a.clienteSearchKey && (
                            <span className="font-mono text-muted-foreground">
                              ({(a.clienteSearchType || "").toUpperCase()}: {a.clienteSearchKey})
                            </span>
                          )}
                        </div>
                      )}
                      {a.classeProcesso && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{a.classeProcesso}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground flex-wrap">
                        {a.dataDistribuicao && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(a.dataDistribuicao).toLocaleDateString("pt-BR")}
                          </span>
                        )}
                        {a.valorCausa && (
                          <span className="flex items-center gap-1 text-emerald-600 font-medium">
                            <CircleDollarSign className="h-3 w-3" />
                            {formatBRL(a.valorCausa / 100)}
                          </span>
                        )}
                      </div>
                      {(a.poloAtivo?.length > 0 || a.poloPassivo?.length > 0) && (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          {a.poloAtivo?.length > 0 && (
                            <div>
                              <p className="text-[9px] font-semibold text-blue-600">POLO ATIVO</p>
                              {a.poloAtivo.slice(0, 2).map((p: any, i: number) => (
                                <p key={i} className="truncate text-[11px]">{p.name}</p>
                              ))}
                            </div>
                          )}
                          {a.poloPassivo?.length > 0 && (
                            <div>
                              <p className="text-[9px] font-semibold text-red-600">POLO PASSIVO</p>
                              {a.poloPassivo.slice(0, 2).map((p: any, i: number) => (
                                <p key={i} className="truncate text-[11px]">{p.name}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog de novo monitoramento — apenas para clientes cadastrados */}
      <Dialog open={novoOpen} onOpenChange={(v) => { setNovoOpen(v); if (!v) { setBuscaCliente(""); setClienteSelecionado(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Monitorar novas ações</DialogTitle>
            <DialogDescription>
              Selecione um cliente cadastrado para ser avisado quando uma nova ação for distribuída contra ele.
              Apenas clientes com CPF/CNPJ cadastrado podem ser monitorados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Buscar cliente *</Label>
              <Input
                placeholder="Buscar por nome, CPF ou CNPJ..."
                value={buscaCliente}
                onChange={(e) => { setBuscaCliente(e.target.value); setClienteSelecionado(null); }}
              />
            </div>

            {/* Lista de clientes encontrados */}
            {!clienteSelecionado && clientes.length > 0 && (
              <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                {clientes.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => { setClienteSelecionado(c); setBuscaCliente(c.nome); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 text-left transition-colors"
                  >
                    <div className="h-8 w-8 rounded-full bg-violet-100 flex items-center justify-center text-xs font-bold text-violet-700 shrink-0">
                      {(c.nome || "?")[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.nome}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{c.cpfCnpj}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!clienteSelecionado && buscaCliente && clientes.length === 0 && (
              <div className="text-center py-4 border rounded-lg">
                <Users className="h-6 w-6 text-muted-foreground/30 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Nenhum cliente com CPF/CNPJ encontrado.</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Cadastre o cliente primeiro em Clientes.</p>
              </div>
            )}

            {/* Cliente selecionado */}
            {clienteSelecionado && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{clienteSelecionado.nome}</p>
                  <p className="text-xs text-muted-foreground font-mono">{clienteSelecionado.cpfCnpj}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setClienteSelecionado(null); setBuscaCliente(""); }}>
                  Trocar
                </Button>
              </div>
            )}

            {/* Credencial pra busca PJe (necessária pra consultar lista) */}
            {clienteSelecionado && (
              <div>
                <Label>Credencial OAB *</Label>
                <select
                  className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm"
                  value={credencialId}
                  onChange={(e) => setCredencialId(e.target.value)}
                >
                  <option value="">Selecione a credencial pra consultar</option>
                  {credsAtivas.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.apelido || c.username} ({c.sistema})
                    </option>
                  ))}
                </select>
                {credsAtivas.length === 0 && (
                  <p className="text-[10px] text-orange-600 mt-1">
                    Sem credenciais ativas. Cadastre uma em /cofre-credenciais primeiro.
                  </p>
                )}
              </div>
            )}

            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 p-3 text-xs flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-blue-900 dark:text-blue-200 space-y-1">
                <p className="font-semibold">Proteção de dados (LGPD)</p>
                <p>
                  O monitoramento de novas ações é permitido apenas para clientes cadastrados
                  no seu escritório, garantindo que existe relação jurídica legítima para o
                  tratamento dos dados processuais. Custo: <strong>15 créditos/mês</strong>.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!clienteSelecionado || !credencialId) return;
                const clean = (clienteSelecionado.cpfCnpj || "").replace(/\D/g, "");
                const tipo = clean.length === 14 ? "cnpj" : "cpf";
                criarMut.mutate({
                  tipo: tipo as any,
                  valor: clean,
                  apelido: clienteSelecionado.nome,
                  credencialId: Number(credencialId),
                });
              }}
              disabled={!clienteSelecionado || !credencialId || criarMut.isPending}
            >
              {criarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar monitoramento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: COFRE DE CREDENCIAIS
// ═══════════════════════════════════════════════════════════════════════════════

function CofreTab() {
  const { data: credenciais, refetch, isLoading } = trpc.cofreCredenciais.listarMinhas.useQuery();
  const { data: sistemas } = (trpc.cofreCredenciais as any).listarMinhasSistemasSuportados?.useQuery() ?? { data: undefined };

  const [novoOpen, setNovoOpen] = useState(false);
  const [form, setForm] = useState({
    customerKey: "",
    systemName: "*",
    username: "",
    password: "",
    totpSecret: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [show2fa, setShow2fa] = useState(false);

  const cadastrarMut = trpc.cofreCredenciais.cadastrarMinha.useMutation({
    onSuccess: (data: any) => {
      if (data.status === "ativa") {
        toast.success("Credencial válida!", { description: data.mensagem, duration: 8000 });
      } else if (data.status === "erro") {
        toast.error("Credencial inválida", { description: data.mensagem, duration: 12000 });
      } else {
        toast.warning("Validação pendente", { description: data.mensagem, duration: 10000 });
      }
      setNovoOpen(false);
      setForm({ customerKey: "", systemName: "*", username: "", password: "", totpSecret: "" });
      refetch();
    },
    onError: (e: any) => toast.error("Erro ao cadastrar", { description: e.message }),
  });

  const removerMut = trpc.cofreCredenciais.removerMinha.useMutation({
    onSuccess: () => {
      toast.success("Credencial removida");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const creds = credenciais || [];

  return (
    <div className="space-y-4">
      <Card className="border-violet-500/20 bg-gradient-to-br from-violet-50/40 to-purple-50/40 dark:from-violet-950/10 dark:to-purple-950/10">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                <KeyRound className="h-5 w-5 text-violet-600" />
              </div>
              <div className="max-w-2xl">
                <p className="font-semibold text-sm">Cofre de Credenciais de Advogado</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cadastre o login OAB de um advogado do escritório pra acessar processos
                  em <strong>segredo de justiça</strong>. As senhas ficam criptografadas pela Judit e
                  NUNCA são expostas depois do cadastro — se precisar trocar, delete e cadastre
                  uma nova.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={() => setNovoOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />Nova credencial
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : creds.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Lock className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium">Nenhuma credencial cadastrada</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Sem credenciais, você só consegue monitorar processos públicos. Pra acessar
              processos em segredo de justiça, cadastre o login de um advogado.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {creds.map((c: any) => (
            <Card key={c.id}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-2">
                  <div className="h-9 w-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                    <KeyRound className="h-4 w-4 text-violet-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{c.customerKey}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {c.systemName === "*" ? "Todos os tribunais" : c.systemName.toUpperCase()}
                    </p>
                  </div>
                  <Badge
                    className={`text-[9px] ${
                      c.status === "ativa"
                        ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
                        : c.status === "erro"
                        ? "bg-red-500/15 text-red-700 border-red-500/30"
                        : c.status === "validando"
                        ? "bg-blue-500/15 text-blue-700 border-blue-500/30"
                        : "bg-amber-500/15 text-amber-700 border-amber-500/30"
                    }`}
                  >
                    {c.status === "validando" ? "⏳ Validando" : c.status === "ativa" ? "✓ Ativa" : c.status === "erro" ? "✗ Erro" : c.status}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <User className="h-3 w-3" />
                    <span className="font-mono truncate">{c.username}</span>
                  </div>
                  {c.has2fa && (
                    <div className="flex items-center gap-1.5 text-violet-600">
                      <ShieldAlert className="h-3 w-3" />
                      <span>2FA ativado</span>
                    </div>
                  )}
                  {c.mensagemErro && (
                    <p className={`text-[10px] ${c.status === "erro" ? "text-red-600" : "text-blue-600"}`}>{c.mensagemErro}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 pt-2 mt-2 border-t">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive ml-auto"
                    onClick={() => {
                      if (confirm(`Remover credencial "${c.customerKey}"? Monitoramentos que dependem dela vão parar de funcionar.`)) {
                        removerMut.mutate({ id: c.id });
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />Remover
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog de cadastro */}
      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cadastrar credencial</DialogTitle>
            <DialogDescription>
              Login de advogado do tribunal. A senha será criptografada imediatamente e
              <strong> não poderá ser recuperada</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Apelido da credencial *</Label>
              <Input
                placeholder="Ex: Dr. João Silva - TJSP"
                value={form.customerKey}
                onChange={(e) => setForm({ ...form, customerKey: e.target.value })}
              />
            </div>
            <div>
              <Label>Tribunal/Sistema *</Label>
              <Select value={form.systemName} onValueChange={(v) => setForm({ ...form, systemName: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(sistemas || []).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>CPF ou OAB *</Label>
              <Input
                placeholder="12345678900 ou SP123456"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div>
              <Label>Senha *</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            </div>
            <div>
              <Label>Secret do 2FA (opcional)</Label>
              <div className="relative">
                <Input
                  type={show2fa ? "text" : "password"}
                  placeholder="Se o tribunal exige autenticador"
                  value={form.totpSecret}
                  onChange={(e) => setForm({ ...form, totpSecret: e.target.value })}
                  className="pr-8 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShow2fa(!show2fa)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {show2fa ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Cole o secret base32 do app autenticador (Google Authenticator, etc). Opcional.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => (cadastrarMut.mutate as any)(form)}
              disabled={
                !form.customerKey || !form.systemName || !form.username || !form.password ||
                cadastrarMut.isPending
              }
            >
              {cadastrarMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Testando login no tribunal...
                </>
              ) : (
                "Cadastrar e testar login"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
