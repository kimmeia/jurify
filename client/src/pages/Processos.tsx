import { useState, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import type { SistemaCofre } from "@shared/cofre-credenciais-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Scale, Search, Loader2, Coins, Plus, Pause, Play, Trash2, AlertTriangle, Clock, Users, Gavel, Radar, CheckCircle2, ChevronDown, ChevronUp, User, Bell, KeyRound, Lock, Eye, EyeOff, ShieldAlert, Siren, FileText, MapPin, CircleDollarSign, RefreshCcw, Sparkles, ShieldCheck, Copy, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { marked } from "marked";
import {
  SearchHistorySidebar,
  KeywordAlertsButton,
  useSearchHistory,
  useKeywordAlerts,
  checkKeywords,
} from "./processos/search-history";
import { ImportarAdvboxDialog } from "./processos/ImportarAdvboxDialog";
import { JurisIaPainel } from "./processos/JurisIaPainel";
import { Upload } from "lucide-react";
import LeitorQr from "@/components/LeitorQr";
import GradeTribunais from "@/components/GradeTribunais";

/** Sistema do cofre que vale em qualquer PJe. Espelha SISTEMA_PJE_NACIONAL do servidor. */
const SISTEMA_NACIONAL = "pje_*";

function formatBRL(v: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v); }

/** Detecta erro de "sessão expirou" / "credencial caiu" nas mensagens do
 *  backend. Quando rola, o badge "ativa" do cofre fica stale na UI até
 *  refresh manual — caller deve invalidar a query do cofre. */
function ehErroSessaoCofre(e: { message?: string } | null | undefined): boolean {
  const msg = e?.message || "";
  return /sess[aã]o.*expir|Cofre.*Validar|credencial.*expir|credencial.*ca[ií]/i.test(msg);
}

/** Hash determinístico → paleta de gradient pra avatar do cliente. Mesmo
 *  nome sempre gera a mesma cor (consistência entre módulos). */
const PALETA_GRADIENT = [
  "from-indigo-500 to-violet-600",
  "from-pink-500 to-rose-600",
  "from-amber-500 to-orange-600",
  "from-emerald-500 to-teal-600",
  "from-cyan-500 to-blue-600",
  "from-fuchsia-500 to-purple-600",
  "from-rose-500 to-red-600",
  "from-sky-500 to-indigo-600",
  "from-lime-500 to-emerald-600",
];
function gradientAvatar(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETA_GRADIENT[Math.abs(h) % PALETA_GRADIENT.length];
}
function gerarIniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
function tempoRelativoBR(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(typeof iso === "string" ? iso : iso.toISOString()).getTime();
  const horas = Math.floor(ms / (1000 * 60 * 60));
  if (horas < 1) return "agora há pouco";
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "há 1 dia";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
}
const TIPO_LABELS: Record<string, string> = { lawsuit_cnj: "CNJ", cpf: "CPF", cnpj: "CNPJ", name: "Nome" };
// "ativo" / "pausado" / "erro" são os 3 valores do enum atual em motor_monitoramentos.
// Legado Judit (created/updating/updated/paused) mantido pra cards antigos.
const STATUS_MON: Record<string, { label: string; cor: string }> = {
  ativo: { label: "Ativo", cor: "bg-emerald-100 text-emerald-700" },
  erro: { label: "Erro", cor: "bg-red-100 text-red-700" },
  pausado: { label: "Pausado", cor: "bg-amber-100 text-amber-700" },
  created: { label: "Ativo", cor: "bg-emerald-100 text-emerald-700" },
  updating: { label: "Atualizando", cor: "bg-blue-100 text-blue-700" },
  updated: { label: "Atualizado", cor: "bg-emerald-100 text-emerald-700" },
  paused: { label: "Pausado", cor: "bg-amber-100 text-amber-700" },
};
/**
 * Indicador de saúde do monitoramento baseado na última atualização.
 * - vermelho pulsante: ultimoErro presente (sessão expirada, captcha, etc)
 * - verde pulsante: atualizado nas últimas 48h (OK)
 * - amarelo: sem atualização entre 48h e 7 dias (atenção)
 * - vermelho: sem atualização há mais de 7 dias (provável falha)
 * - cinza: pausado ou recém-criado sem dados ainda
 */
function MonitorHealthDot({
  statusJudit,
  updatedAt,
  createdAt,
  ultimoErro,
}: {
  statusJudit: string;
  updatedAt?: string | null;
  createdAt?: string | null;
  ultimoErro?: string | null;
}) {
  if (statusJudit === "paused") {
    return (
      <span className="relative flex h-3 w-3 shrink-0" title="Monitoramento pausado">
        <span className="h-3 w-3 rounded-full bg-gray-400" />
      </span>
    );
  }

  // Erro registrado na última consulta — prioriza sobre tempo desde update
  if (ultimoErro) {
    return (
      <span
        className="relative flex h-3 w-3 shrink-0"
        title={`ALERTA — última consulta falhou: ${ultimoErro}`}
      >
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
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

  // Sem ultimoErro: vermelho NUNCA aparece por tempo decorrido. Cron de
  // monitoramento marca `ultimoErro` quando falha de fato — usar isso é
  // mais honesto que assumir falha por silêncio (pode ser só que o cron
  // não rodou ainda pra esse monitor). Amarelo segue como "atenção"
  // para >7 dias sem update.
  if (horasDesdeUpdate <= 168) { // 7 dias
    return (
      <span className="relative flex h-3 w-3 shrink-0" title={`Atenção — sem atualização há ${Math.round(horasDesdeUpdate / 24)} dias`}>
        <span className="animate-pulse h-3 w-3 rounded-full bg-amber-500" />
      </span>
    );
  }

  return (
    <span className="relative flex h-3 w-3 shrink-0" title={`Sem atualização há ${Math.round(horasDesdeUpdate / 24)} dias — cron pode ter pulado, mas sem erro registrado`}>
      <span className="h-3 w-3 rounded-full bg-amber-500/70" />
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CARD DE PROCESSO (resultado expandivel)
// ═══════════════════════════════════════════════════════════════════════════════

function ProcessoCard({
  processo,
  onMonitorar,
  detalhe,
  onCarregarDetalhes,
  carregandoDetalhes,
}: {
  processo: any;
  onMonitorar?: (cnj: string) => void;
  /** Dados enriquecidos vindos de `consultarCNJSincrono` (mescla com `processo.response_data`). */
  detalhe?: any;
  /** Handler que carrega detalhes pra esse CNJ (custa 1 cred). Quando definido, mostra botão se card vazio. */
  onCarregarDetalhes?: (cnj: string) => void;
  carregandoDetalhes?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const { items: alerts } = useKeywordAlerts();
  // `detalhe` (vindo de busca sob demanda) tem precedência sobre `response_data`
  // (vindo da listagem CPF/CNPJ que retorna só CNJs).
  const d = detalhe || processo.response_data || processo;
  const ativos = (d.parties || []).filter((p: any) => p.side === "Active").slice(0, 5);
  const passivos = (d.parties || []).filter((p: any) => p.side === "Passive").slice(0, 5);
  const movs = (d.steps || []).slice(0, 10);
  const advs: any[] = [];
  (d.parties || []).forEach((p: any) => { (p.lawyers || []).forEach((l: any) => { if (advs.length < 5) advs.push(l); }); });

  // Heurística "card sem dados": chegou só CNJ + tribunal (caso CPF/CNPJ).
  // Detecta pela ausência de classificações, partes E movimentações —
  // qualquer um destes presente significa que a capa veio.
  const cardVazio =
    !detalhe &&
    (!d.classifications || d.classifications.length === 0) &&
    (!d.parties || d.parties.length === 0) &&
    (!d.steps || d.steps.length === 0);

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
            {cardVazio && onCarregarDetalhes && d.code && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px]"
                disabled={carregandoDetalhes}
                onClick={() => onCarregarDetalhes(d.code)}
              >
                {carregandoDetalhes
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <Search className="h-3 w-3 mr-1" />}
                {carregandoDetalhes ? "Carregando…" : "Carregar detalhes"}
              </Button>
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
  // Detalhes enriquecidos por CNJ. Cards de busca por CPF/CNPJ chegam só
  // com `code`+`tribunal_acronym`. Quando user clica "Carregar detalhes",
  // o resultado de `consultarCNJSincrono` cai aqui e o ProcessoCard usa.
  const [detalhesPorCnj, setDetalhesPorCnj] = useState<Record<string, any>>({});
  const [carregandoCnj, setCarregandoCnj] = useState<string | null>(null);
  const history = useSearchHistory();

  const carregarDetalhesMut = trpc.processos.consultarCNJSincrono.useMutation({
    onSuccess: (d: any, vars: { cnj: string }) => {
      if (d?.lawsuit) {
        setDetalhesPorCnj((prev) => ({ ...prev, [vars.cnj]: d.lawsuit }));
        toast.success("Detalhes carregados (1 cred)");
      }
      setCarregandoCnj(null);
    },
    onError: (e: any) => {
      toast.error("Falha ao carregar detalhes", { description: e.message });
      setCarregandoCnj(null);
    },
  });

  const carregarDetalhes = (cnj: string) => {
    if (carregandoCnj) return;
    setCarregandoCnj(cnj);
    const credId = credencialId ? Number(credencialId) : undefined;
    carregarDetalhesMut.mutate({ cnj, credencialId: credId });
  };

  // Credenciais do cofre para segredo de justiça
  // listarParaSelecao em vez de listarMinhas: dropdown precisa funcionar
  // pra qualquer colaborador (não só admin do cofre). View retornada já
  // é mascarada — usuário comum vê apelido + usernameMascarado, sem
  // expor senha/secret.
  const { data: credenciais } = trpc.cofreCredenciais.listarParaSelecao.useQuery(undefined, { retry: false }) ?? { data: undefined };
  const credsDisponiveis = (credenciais || []).filter((c: any) => c.status === "ativa" || c.status === "validando");

  const consultarCNJ = trpc.processos.consultarCNJ.useMutation({
    onSuccess: (d: any) => { setRequestId(d.requestId); setPolling(true); setTentativas(0); },
    onError: (e: any) => {
      setBuscando(false);
      // Erros do motor próprio (PRECONDITION_FAILED) trazem mensagem
      // instrutiva com link → aba Cofre em /processos. Mostra como
      // toast com action.
      const isCredencialAusente = /credencial OAB|cadastre/i.test(e.message);
      const isSessaoExpirada = /sess[aã]o.*expirou|Validar pra renovar/i.test(e.message);
      if (isCredencialAusente || isSessaoExpirada) {
        toast.error(isCredencialAusente ? "Cadastre credencial" : "Sessão expirou", {
          description: e.message.replace(/→.*$/, "").trim(),
          action: {
            label: "Abrir Cofre",
            onClick: () => {
              window.location.href = "/processos?tab=cofre";
            },
          },
          duration: 10000,
        });
      } else {
        toast.error(e.message);
      }
    },
  });
  const consultarDoc = trpc.processos.consultarDocumento.useMutation({ onSuccess: (d: any) => { setRequestId(d.requestId); setPolling(true); setTentativas(0); }, onError: (e: any) => { setBuscando(false); toast.error(e.message); } });
  // Buscar clientes do escritório para verificar se partes do processo são clientes
  const { data: clientesData } = trpc.clientes.listar.useQuery({ limite: 100 });
  const todosClientes = clientesData?.clientes || [];

  const monitorarMut = trpc.processos.criarMonitoramento.useMutation({
    onSuccess: (d: any) => toast.success(`Processo adicionado às Movimentações (${d?.custoCred ?? 2} cred/mês)`),
    onError: (e: any) => toast.error("Erro ao monitorar", { description: e.message }),
  });

  const vincularMut = trpc.clienteProcessos.vincular.useMutation({
    onSuccess: (r: any) => {
      toast.success(r.monitorando ? "Processo vinculado ao cliente e monitoramento criado!" : "Processo vinculado ao cliente!");
      setVincularDialog(null);
    },
    onError: (e: any) => toast.error("Erro ao vincular", { description: e.message }),
  });

  /** Ao clicar "Monitorar" num ProcessoCard: cria monitoramento E verifica se partes são clientes */
  const handleMonitorar = (cnj: string, processo?: any) => {
    // Resolve credencial: usa a selecionada no dropdown se houver,
    // senão pega a 1ª ativa do cofre. credencialId é obrigatório no
    // backend (Zod) — sem fallback, click em "Monitorar" depois de
    // consulta pública dava erro Zod opaco no toast.
    const credSelecionada = credencialId ? Number(credencialId) : null;
    const credAuto = credsDisponiveis[0]?.id ?? null;
    const credId = credSelecionada ?? credAuto;

    if (!credId) {
      toast.error("Sem credencial OAB ativa", {
        description: "Cadastre/valide uma credencial em Cofre antes de monitorar.",
        duration: 8000,
      });
      return;
    }

    // 1. Criar monitoramento
    monitorarMut.mutate({ numeroCnj: cnj, credencialId: credId });

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
        description: "O scraper não conseguiu completar. Tente novamente; se persistir, valide a credencial na aba Cofre.",
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
    if (tipo === "lawsuit_cnj") consultarCNJ.mutate({ cnj: valor.trim(), credencialId: credId });
    else consultarDoc.mutate({ tipo: tipo as "cpf" | "cnpj", valor: valor.trim(), credencialId: credId });
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
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_0_rgb(0,0,0,0.04)] space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shrink-0">
            <Search className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">Consultar processo</p>
            <p className="text-[11px] text-slate-500">CNJ direto, ou busca por CPF/CNPJ em +90 tribunais.</p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Select value={tipo} onValueChange={(v) => { setTipo(v); setResultados(null); }}>
            <SelectTrigger className="w-28 shrink-0 h-10 rounded-lg"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lawsuit_cnj">CNJ</SelectItem>
              <SelectItem value="cpf">CPF</SelectItem>
              <SelectItem value="cnpj">CNPJ</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={placeholders[tipo]}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleBuscar(); }}
              className="pl-9 h-10 rounded-lg border-slate-200 focus-visible:ring-indigo-400"
            />
          </div>
          <Button
            onClick={handleBuscar}
            disabled={buscando || !valor.trim()}
            className="h-10 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-sm"
          >
            {buscando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            Buscar
          </Button>
          <KeywordAlertsButton />
        </div>

        {/* Seletor de credencial para segredo de justiça */}
        <div className="flex items-center gap-2">
          {credsDisponiveis.length > 0 ? (
            <div className="flex items-center gap-2 flex-1 flex-wrap">
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-violet-50 border border-violet-200">
                <Lock className="h-3 w-3 text-violet-600" />
                <span className="text-[10px] font-medium text-violet-700">Cofre</span>
              </div>
              <select
                value={credencialId}
                onChange={(e) => setCredencialId(e.target.value)}
                className="flex h-8 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs flex-1 max-w-xs focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
              >
                <option value="">Sem credencial (processos públicos)</option>
                {credsDisponiveis.map((c: any) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.apelido} ({c.usernameMascarado}) {c.status === "validando" ? "— validando" : ""}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-slate-400">Selecione pra ver segredo de justiça</span>
            </div>
          ) : (
            <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              Cadastre uma credencial OAB no Cofre para acessar processos em segredo de justiça.
            </p>
          )}
        </div>

        <div>
          {tipo === "lawsuit_cnj" ? (
            <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200/70">
              <Coins className="h-3 w-3 text-emerald-600" />
              <p className="text-[11px] text-emerald-800">
                Custo: <strong>1 crédito</strong> — consulta direta por número do processo.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 border border-amber-200/70 p-2.5 text-[11px] text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-semibold">Busca por {TIPO_LABELS[tipo]} — custo variável</p>
                  <p className="mt-0.5 text-[10.5px] opacity-90">
                    <strong>3 créditos base</strong> + <strong>1 crédito por lote de 10 processos</strong> encontrados (sem teto).
                    Ex: 30 processos = 6 créditos. Sem resultados? Só os 3 base.
                  </p>
                  <p className="mt-0.5 text-[10px] opacity-75">Pode levar até 2 minutos.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status da busca */}
      {buscando && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-indigo-50 via-blue-50 to-indigo-50 border border-indigo-200/60 shadow-sm">
          <div className="relative flex h-9 w-9 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-30" />
            <div className="relative h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center">
              <Loader2 className="h-4 w-4 text-white animate-spin" />
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-indigo-900">Consultando tribunais…</p>
            <p className="text-xs text-indigo-700/80">
              {tipo !== "lawsuit_cnj"
                ? `Buscando em todos os tribunais por ${TIPO_LABELS[tipo]}. Pode levar até 2 minutos.`
                : "Resultado em até 9 segundos."}
              {tentativas > 5 && ` (${tentativas * 3}s)`}
            </p>
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
                    <Button size="sm" variant="outline" onClick={() => (window.location.href = "/processos?tab=cofre")}>
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
            // Busca por CPF/CNPJ chega só com `code`+`tribunal_acronym`.
            // Detectamos olhando se a maioria está vazia.
            const ehListaCpf = processos.length > 0 && processos.every(
              (p: any) => !p.response_data?.classifications?.length && !p.response_data?.steps?.length,
            );
            return (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium">{processos.length} processo(s) encontrado(s)</p>
                  {ehListaCpf && (
                    <p className="text-[10px] text-muted-foreground">
                      Clique em <span className="font-semibold">Carregar detalhes</span> em cada card pra ver capa, partes e movimentações (1 cred cada).
                    </p>
                  )}
                </div>
                {processos.map((item: any, i: number) => {
                  const cnj = item.response_data?.code;
                  return (
                    <ProcessoCard
                      key={item.response_id || i}
                      processo={item}
                      onMonitorar={(c) => handleMonitorar(c, item)}
                      detalhe={cnj ? detalhesPorCnj[cnj] : undefined}
                      onCarregarDetalhes={cnj ? carregarDetalhes : undefined}
                      carregandoDetalhes={carregandoCnj === cnj}
                    />
                  );
                })}
              </>
            );
          })()}
        </div>
      ) : resultados && !buscando ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center">
          <Scale className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Nenhum processo encontrado.</p>
        </div>
      ) : !buscando && !resultados ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-slate-50 to-indigo-50/30 py-14 text-center space-y-2">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 flex items-center justify-center mx-auto mb-1">
            <Scale className="h-7 w-7 text-indigo-500/70" />
          </div>
          <p className="font-semibold text-slate-700">Consulte processos judiciais</p>
          <p className="text-sm text-slate-500">Busque por CNJ, CPF ou CNPJ em +90 tribunais do Brasil.</p>
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
                    <p className="text-sm font-medium truncate" title={c.nome}>{c.nome}</p>
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

/**
 * Renderiza o resumo IA — markdown estruturado em 4 seções
 * (situação, análise, ações, mensagem ao cliente).
 *
 * A última seção (💬 Mensagem pronta pro cliente) é destacada e ganha
 * botão "Copiar mensagem" — o user pode mandar direto pro WhatsApp.
 */
function ResumoIABloco({ texto }: { texto: string }) {
  // Tenta isolar a seção "💬 Mensagem pronta pro cliente" pra render
  // diferenciado + botão copiar. Regex matches o cabeçalho e captura
  // tudo até próximo H3 ou fim do texto.
  const matchMsg = texto.match(/###\s*💬[^\n]*Mensagem[^\n]*\n([\s\S]*?)(?=\n###|\n##|$)/i);
  const mensagemCliente = matchMsg?.[1]?.trim() ?? null;
  const resto = mensagemCliente
    ? texto.slice(0, matchMsg!.index!).trim()
    : texto;

  const copiarMensagem = async () => {
    if (!mensagemCliente) return;
    // Remove markdown básico (negrito, itálico) antes de copiar
    const limpo = mensagemCliente
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/^>\s*/gm, "")
      .trim();
    try {
      await navigator.clipboard.writeText(limpo);
      toast.success("Mensagem copiada — cole no WhatsApp do cliente");
    } catch {
      toast.error("Falha ao copiar — copie manualmente");
    }
  };

  return (
    <div className="rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200/50 p-3 space-y-3">
      <p className="text-[10px] font-semibold text-violet-600 flex items-center gap-1">
        <FileText className="h-3 w-3" /> ANÁLISE ESTRATÉGICA IA
      </p>
      <div
        className="prose prose-sm dark:prose-invert max-w-none text-xs text-violet-900 dark:text-violet-100
          prose-headings:text-violet-700 dark:prose-headings:text-violet-200 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1.5
          prose-h3:text-sm prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5
          prose-strong:text-violet-900 dark:prose-strong:text-violet-100"
        dangerouslySetInnerHTML={{ __html: marked.parse(resto, { async: false }) as string }}
      />
      {mensagemCliente && (
        <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
              💬 MENSAGEM PRONTA PRO CLIENTE
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] border-emerald-300"
              onClick={copiarMensagem}
            >
              <Copy className="h-3 w-3 mr-1" />
              Copiar
            </Button>
          </div>
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-xs text-emerald-900 dark:text-emerald-100 prose-p:my-1"
            dangerouslySetInnerHTML={{ __html: marked.parse(mensagemCliente, { async: false }) as string }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Parseia `partesJson` do monitor pra array de partes. Retorna [] se
 * vazio/inválido. Tolerante a JSON malformado (não joga).
 */
function parsePartes(partesJson: string | null | undefined): Array<{
  nome: string;
  polo?: string;
  tipo?: string;
  documento?: string | null;
}> {
  if (!partesJson) return [];
  try {
    const parsed = JSON.parse(partesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Extrai o melhor identificador visual pra exibir como título do card.
 * Prioridade: apelido > primeira parte do polo passivo > primeira parte
 * ativo > primeira parte qualquer > CNJ/searchKey (fallback).
 *
 * Polo passivo é geralmente o adversário do escritório (o cliente é o
 * autor na maioria dos casos), então mostrar o nome do réu ajuda a
 * identificar rapidamente "qual processo é esse". Se for inverso
 * (cliente é réu), o user pode usar o `apelido` pra customizar.
 */
/**
 * Nome do caso na lista: "Fulano × Banco Tal" quando a capa já foi coletada.
 * O rótulo vem pronto do servidor, pelo mesmo caminho da central de
 * movimentações — as duas telas precisam chamar o processo pelo mesmo nome.
 */
function nomeDoCasoMon(mon: any): string {
  return mon.partesRotulo || identificadorPrincipal(mon);
}

function haQuantoTempoMon(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime();
  const horas = Math.floor(ms / 3_600_000);
  if (horas < 1) return "agora há pouco";
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
}

function identificadorPrincipal(mon: any): string {
  if (mon.apelido && mon.apelido.trim()) return mon.apelido.trim();
  const partes = parsePartes(mon.partesJson);
  if (partes.length > 0) {
    const passivo = partes.find((p) => p.polo === "passivo");
    const ativo = partes.find((p) => p.polo === "ativo");
    const escolhida = passivo ?? ativo ?? partes[0];
    if (escolhida?.nome) return escolhida.nome;
  }
  return mon.searchKey;
}

// Selos de classificação da movimentação (resumo IA classificado).
const DESFECHO_MOV: Record<string, { label: string; emoji: string; cls: string; dot: string }> = {
  favoravel: { label: "Favorável", emoji: "🟢", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  desfavoravel: { label: "Desfavorável", emoji: "🔴", cls: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" },
  parcial: { label: "Parcial", emoji: "🟡", cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  neutro: { label: "Sem mérito", emoji: "⚪", cls: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
};

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
  const [confirmResumoOpen, setConfirmResumoOpen] = useState(false);
  // Suporta formato local DB (statusJudit/searchKey) e Judit API (status/search.search_key)
  const status = mon.statusJudit || mon.status || "created";
  const searchKey = mon.searchKey || mon.search?.search_key || "-";

  const [processoCompleto, setProcessoCompleto] = useState<any>(null);
  const utils = trpc.useUtils();

  const resumoMut = trpc.processos.resumoIA.useMutation({
    onSuccess: (data: any) => {
      setResumoIA(data.resumo);
      // O resumo IA agora retorna o processo completo junto
      if (data.processo) setProcessoCompleto(data.processo);
      // fonte === "judit_ia" é label legado retornado pelo backend
      // (estágios antigos da pipeline). Mostra como "análise IA" igual
      // ao caso "ia" — usuário só precisa saber que veio de IA.
      const fonteLabel = data.fonte === "judit_ia" || data.fonte === "ia" ? " — análise IA" : "";
      toast.success(`Resumo gerado (1 crédito)${fonteLabel}`);
      setConfirmResumoOpen(false);
    },
    onError: (e: any) => {
      toast.error("Erro no resumo IA", { description: e.message });
      setConfirmResumoOpen(false);
    },
  });

  // Lock síncrono pra impedir double-click cobrar 2 créditos. mutation.isPending
  // só vira true no próximo render — entre o 1º click e o re-render, um 2º click
  // passaria pelo disabled e dispararia 2ª request. Lock baseado em ref bloqueia
  // imediatamente.
  const buscarLockRef = useRef(false);
  const buscarCompletoMut = trpc.processos.buscarProcessoCompleto.useMutation({
    onSuccess: (data: any) => {
      if (data.encontrado && data.processo) {
        setProcessoCompleto(data.processo);
        const totalMovs = typeof data.totalMovs === "number" ? data.totalMovs : null;
        if (totalMovs === 0) {
          toast.success("Processo encontrado, sem movimentações no tribunal (1 crédito)", {
            description: "O tribunal retornou 0 movimentações. O processo pode estar sem trâmite recente ou em segredo de justiça.",
            duration: 8000,
          });
        } else if (totalMovs !== null) {
          toast.success(`${totalMovs} movimentação(ões) carregada(s) e salva(s) (1 crédito)`);
        } else {
          toast.success("Histórico completo carregado e salvo (1 crédito)");
        }
        // Refetch historico local pra que o dado persistido apareça
        if (mon.id) refetchHist();
      } else {
        toast.error(data.mensagem || "Processo não encontrado");
        if (ehErroSessaoCofre({ message: data.mensagem })) {
          utils.cofreCredenciais.listarMinhas.invalidate();
          utils.cofreCredenciais.listarParaSelecao?.invalidate?.();
        }
      }
    },
    onError: (e: any) => {
      toast.error("Erro ao buscar", { description: e.message });
      if (ehErroSessaoCofre(e)) {
        utils.cofreCredenciais.listarMinhas.invalidate();
        utils.cofreCredenciais.listarParaSelecao?.invalidate?.();
      }
    },
    onSettled: () => {
      buscarLockRef.current = false;
    },
  });

  function clickHistorico() {
    if (buscarLockRef.current) return;
    buscarLockRef.current = true;
    buscarCompletoMut.mutate({ monitoramentoId: mon.id });
  }

  const searchType = mon.searchType || mon.search?.search_type || "";
  const st = STATUS_MON[status] || { label: status, cor: "" };

  // Busca o histórico de movimentações quando o card abre (local DB — atualizações do webhook)
  // `as any`: o retorno de historicoMonitoramento é uma união com formatos
  // diferentes (early-returns sem capa/partes vs. retorno completo), e o
  // merge de capa/partes abaixo depende desses campos. Tipar exige
  // harmonizar o contrato no servidor + a tipagem da capa — fica pra um
  // passo separado, verificável na UI.
  const { data: historico, isLoading: loadingHist, refetch: refetchHist } = (trpc.processos as any).historicoMonitoramento.useQuery(
    { monitoramentoId: mon.id, page: 1, pageSize: 50 },
    { enabled: aberto && !!mon.id, retry: false },
  );

  // "Criar prazo" na timeline: aprova o prazo sugerido → vira agendamento.
  const criarPrazoMut = (trpc as any).prazosSugeridos.aprovar.useMutation({
    onSuccess: () => { toast.success("Prazo criado na Agenda ✅"); refetchHist(); },
    onError: (e: any) => toast.error("Falha ao criar prazo", { description: e.message }),
  });

  // Classifica em lote as movimentações antigas (sem selo) deste processo.
  const reclassificarMut = (trpc as any).processos.reclassificarMovimentacoes.useMutation({
    onSuccess: (r: any) => {
      if (r?.tentados > 0 && r?.classificados === 0) {
        toast.error("IA indisponível", { description: "Verifique a chave de IA nas configurações." });
      } else if (r?.classificados > 0) {
        toast.success(`${r.classificados} movimentação(ões) classificada(s) ✨`);
        refetchHist();
      } else {
        toast.info("Todas as movimentações já estavam classificadas");
      }
    },
    onError: (e: any) => toast.error("Falha ao classificar", { description: e.message }),
  });

  // Extrai dados do processo com fallback em cascata pras steps —
  // diferentes fontes preenchem em momentos diferentes:
  //
  //   - processoCompleto: setado IMEDIATAMENTE após buscar Histórico.
  //     Tem steps populados pelo backend (adaptarParaJuditShape).
  //   - historico.items: vem do banco após refetchHist. Pode estar
  //     vazio se o cron ainda não rodou ou INSERT falhou silenciosamente.
  //   - historico.capa.steps: backup adicional caso items esteja vazio
  //     (capa adaptada inclui steps quando movs foram passadas).
  //
  // Prioridade final pras steps: usa o primeiro não-vazio. Garante que
  // um caminho falho (ex: items vazio) não esconde dados que outros
  // caminhos têm. Pré-#217 a UX usava só state — voltei a priorizá-lo
  // e adicionei o fallback em cascata pra robustez.
  const respostas = historico?.items || [];
  const ultimaResposta = respostas.find((r: any) => r.responseType === "lawsuit");
  const stepsFromHist = respostas
    .filter((r: any) => r.responseType === "step")
    .map((r: any) => r.responseData);
  const stepsFromState = processoCompleto?.steps ?? [];
  const stepsFromCapa = historico?.capa?.steps ?? [];
  const stepsFinal = stepsFromHist.length > 0
    ? stepsFromHist
    : stepsFromState.length > 0
      ? stepsFromState
      : stepsFromCapa;

  let processoData: any = null;
  if (historico?.capa) {
    processoData = {
      ...historico.capa,
      parties: historico.partes ?? historico.capa.parties ?? processoCompleto?.parties ?? [],
      steps: stepsFinal,
    };
  } else if (processoCompleto) {
    processoData = processoCompleto;
  } else if (ultimaResposta?.responseData) {
    // Fallback legado (Judit): dados do webhook
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

  // ─── Capa cacheada pelo cron (capa_json / partes_json) ──────────────────
  // Sem custo: o cron já populou esses fields a cada sync. Frontend mostra
  // título do processo (classe + assunto) e partes no card colapsado.
  // Shape: { classe, assuntos: string[], orgaoJulgador, valorCausaCentavos,
  //   dataDistribuicao, partes: [{nome, polo: "ativo"|"passivo"}], ... }
  const capa = mon.capa;
  const partesCacheadas: any[] = Array.isArray(mon.partes) ? mon.partes : [];
  const polosAtivosNomes: string[] = partesCacheadas
    .filter((p: any) => String(p?.polo || "").toLowerCase() === "ativo")
    .map((p: any) => p?.nome)
    .filter(Boolean);
  const polosPassivosNomes: string[] = partesCacheadas
    .filter((p: any) => String(p?.polo || "").toLowerCase() === "passivo")
    .map((p: any) => p?.nome)
    .filter(Boolean);
  const classeProcesso = capa?.classe ?? null;
  const assuntoPrincipal = Array.isArray(capa?.assuntos) && capa.assuntos.length > 0 ? capa.assuntos[0] : null;
  const orgaoJulgador = capa?.orgaoJulgador ?? null;
  const valorCausaCentavos = typeof capa?.valorCausaCentavos === "number" ? capa.valorCausaCentavos : null;
  const valorCausaBRL = valorCausaCentavos != null && valorCausaCentavos > 0
    ? formatBRL(valorCausaCentavos / 100)
    : null;
  const temCapa = !!(classeProcesso || assuntoPrincipal || polosAtivosNomes.length > 0 || polosPassivosNomes.length > 0 || valorCausaBRL || orgaoJulgador);
  // Aguardando 1ª sync = monitor de CNJ sem capa AINDA (sem erro)
  const aguardandoCapa = searchType === "lawsuit_cnj" && !temCapa && !mon.ultimoErro;

  // Cor de borda lateral baseada no status — espelha o health-dot
  const temErro = !!mon.ultimoErro || status === "erro";
  const pausado = status === "paused" || status === "pausado";
  const corLateral = temErro
    ? mon.diagnostico?.severidade === "aviso"
      ? "border-l-amber-500"
      : "border-l-rose-500"
    : pausado
      ? "border-l-slate-400"
      : "border-l-emerald-500";

  // Estilo do avatar/ícone — pausado vira cinza, erro vira gradient rose
  // A borda lateral, o ponto de saúde e o texto do motivo já dizem que está
  // quebrado; pintar o avatar também deixava quatro vermelhos na mesma linha.
  const avatarStyle = temErro || pausado ? "bg-muted" : "bg-gradient-to-br from-indigo-500 to-violet-600";
  const avatarIconColor = temErro || pausado ? "text-muted-foreground" : "text-white";

  // Tempo relativo "há X" pra última atualização
  const tempoRelativo = (() => {
    const ref = mon.updatedAt || mon.createdAt;
    if (!ref) return null;
    const ms = Date.now() - new Date(typeof ref === "string" ? ref : (ref as Date).toISOString()).getTime();
    const horas = Math.floor(ms / (1000 * 60 * 60));
    if (horas < 1) return "agora há pouco";
    if (horas < 24) return `há ${horas}h`;
    const dias = Math.floor(horas / 24);
    if (dias === 1) return "há 1 dia";
    if (dias < 30) return `há ${dias} dias`;
    const meses = Math.floor(dias / 30);
    return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
  })();

  // Card "erro" tem bg sutil rose
  const cardBg = pausado ? "bg-muted/30" : "bg-card";

  return (
    <>
    <div className={`rounded-xl ${cardBg} border border-slate-200 border-l-[3px] ${corLateral} shadow-[0_1px_2px_0_rgb(0,0,0,0.04)] hover:shadow-[0_4px_12px_-2px_rgb(0,0,0,0.06)] transition-all ${pausado ? "opacity-75" : ""}`}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setAberto(!aberto)}>
          <div className={`h-11 w-11 rounded-xl ${avatarStyle} flex items-center justify-center shrink-0 shadow-sm`}>
            {searchType === "lawsuit_cnj" ? <Scale className={`h-5 w-5 ${avatarIconColor}`} /> : <Users className={`h-5 w-5 ${avatarIconColor}`} />}
          </div>
          <div className="flex-1 min-w-0">
            {/* Linha em ritmo fixo, no padrão da central de movimentações:
                quem é o caso, o que está acontecendo, desde quando. O detalhe
                (classe, valor, vara, polos) continua no card expandido. */}
            <div className="flex items-center gap-2">
              <MonitorHealthDot
                statusJudit={status}
                updatedAt={mon.updatedAt ? (typeof mon.updatedAt === "string" ? mon.updatedAt : (mon.updatedAt as Date).toISOString()) : null}
                createdAt={mon.createdAt ? (typeof mon.createdAt === "string" ? mon.createdAt : (mon.createdAt as Date).toISOString()) : null}
                ultimoErro={mon.ultimoErro}
              />
              <p className="text-[13px] font-bold truncate" title={nomeDoCasoMon(mon)}>
                {nomeDoCasoMon(mon)}
              </p>
              {pausado && (
                <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-[0.04em] bg-muted text-muted-foreground">
                  Pausado
                </span>
              )}
              {mon.subiu2grau && (
                <span
                  className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-[0.04em] bg-amber-50 text-amber-700"
                  title={mon.indicios2grau ? `Indícios de 2º grau: ${mon.indicios2grau}` : "As movimentações sugerem que o processo subiu pro 2º grau (recurso)."}
                >
                  2º grau?
                </span>
              )}
            </div>

            <p className="text-[10.5px] font-mono text-muted-foreground mt-0.5 truncate">
              {mon.searchKey}
              {mon.tribunal ? ` · ${mon.tribunal}` : ""}
            </p>

            {/* O que está acontecendo: o motivo da parada, ou a última coisa
                que o tribunal publicou. Antes aqui vinha a mensagem crua da
                exceção entre aspas. */}
            <div className="flex items-center gap-2 mt-1.5 min-w-0">
              {mon.diagnostico ? (
                <span
                  className={`text-[12px] truncate ${
                    mon.diagnostico.severidade === "alerta"
                      ? "text-rose-700 dark:text-rose-300"
                      : "text-amber-700 dark:text-amber-300"
                  }`}
                  title={mon.ultimoErro || undefined}
                >
                  {mon.diagnostico.motivo}
                </span>
              ) : mon.ultimaMovimentacao ? (
                <span className="text-[12px] text-muted-foreground truncate" title={mon.ultimaMovimentacao.titulo}>
                  {mon.ultimaMovimentacao.titulo}
                </span>
              ) : aguardandoCapa ? (
                <span className="text-[12px] text-muted-foreground italic truncate">
                  Aguardando a primeira sincronização com o tribunal…
                </span>
              ) : (
                <span className="text-[12px] text-muted-foreground truncate">
                  Sem movimentação registrada ainda
                </span>
              )}
            </div>
          </div>

          <div className="shrink-0 text-right mr-1">
            <p className="text-[11.5px] font-semibold text-foreground/70">
              {mon.diagnostico
                ? tempoRelativo ?? "—"
                : mon.ultimaMovimentacao
                  ? haQuantoTempoMon(mon.ultimaMovimentacao.dataEvento)
                  : tempoRelativo ?? "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {mon.diagnostico ? "parado" : "última mov."}
            </p>
          </div>

          {/* Cinco controles coloridos por linha × centenas de linhas era o
              que mais poluía a lista. Ficam num menu; o que sobra é abrir. */}
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {searchType === "lawsuit_cnj" && (
                  <>
                    <DropdownMenuItem disabled={buscarCompletoMut.isPending} onClick={clickHistorico}>
                      <Search className="h-3.5 w-3.5 mr-2" />
                      Buscar histórico
                      <span className="ml-auto text-[10px] text-muted-foreground">1 crédito</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={resumoMut.isPending} onClick={() => setConfirmResumoOpen(true)}>
                      <FileText className="h-3.5 w-3.5 mr-2" />
                      Resumo IA
                      <span className="ml-auto text-[10px] text-muted-foreground">1 crédito</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {(status === "created" || status === "updated" || status === "updating") && (
                  <DropdownMenuItem onClick={onPausar}>
                    <Pause className="h-3.5 w-3.5 mr-2" />
                    Pausar monitoramento
                  </DropdownMenuItem>
                )}
                {status === "paused" && (
                  <DropdownMenuItem onClick={onReativar}>
                    <Play className="h-3.5 w-3.5 mr-2" />
                    Reativar
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDeletar}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); setAberto(!aberto); }}>
              {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {aberto && (
          <div className="mt-3 pt-3 border-t space-y-4">
            {/* Resumo IA */}
            {resumoIA && <ResumoIABloco texto={resumoIA} />}

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
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <p className="text-[10px] font-semibold text-muted-foreground">
                        MOVIMENTAÇÕES ({steps.length})
                      </p>
                      {steps.some((s: any) => s.eventoId && !s.resumoIa) && (
                        <button
                          className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1 disabled:opacity-60"
                          disabled={reclassificarMut.isPending}
                          onClick={() => reclassificarMut.mutate({ monitoramentoId: mon.id })}
                          title="Gera resumo + selos (desfecho/relevância) das movimentações que ainda não têm."
                        >
                          {reclassificarMut.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
                          Classificar com IA
                        </button>
                      )}
                    </div>
                    <div className="relative space-y-3 max-h-96 overflow-y-auto pl-4">
                      <div className="absolute left-1 top-1 bottom-1 w-px bg-indigo-200 dark:bg-indigo-900" />
                      {steps.map((s: any, i: number) => {
                        const dm = s.desfecho ? DESFECHO_MOV[s.desfecho] : null;
                        const rotina = s.relevancia === "rotina";
                        const prazo = s.prazoSugerido;
                        return (
                        <div key={i} className="relative">
                          <div className={`absolute -left-3 top-1.5 h-2 w-2 rounded-full ring-2 ring-background ${dm ? dm.dot : rotina ? "bg-slate-300" : "bg-indigo-400"}`} />
                          <div className="text-xs">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {s.step_date && (
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  {new Date(s.step_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                                </span>
                              )}
                              {dm && <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${dm.cls}`}>{dm.emoji} {dm.label}</span>}
                              {(s.relevancia === "rotina" || s.relevancia === "relevante") && (
                                rotina
                                  ? <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium border bg-slate-100 text-slate-500 border-slate-200">📄 Rotina</span>
                                  : <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium border bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300">⭐ Relevante</span>
                              )}
                              {prazo && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold border bg-orange-100 text-orange-700 border-orange-300">⏰ Requer prazo</span>}
                            </div>
                            {s.resumoIa
                              ? <p className="text-[11.5px] leading-snug mt-1 font-medium text-foreground">{s.resumoIa}</p>
                              : <p className="text-[11px] leading-tight mt-0.5">{s.content}</p>}
                            {s.resumoIa && <p className="text-[10px] leading-tight mt-0.5 text-muted-foreground line-clamp-2">{s.content}</p>}
                            {prazo && (
                              <div className="mt-1.5 rounded-md bg-orange-50 border border-orange-200 px-2 py-1.5 flex items-center justify-between gap-2 flex-wrap dark:bg-orange-950/20 dark:border-orange-900">
                                <span className="text-[10px] text-orange-800 dark:text-orange-300">⏰ <b>{prazo.titulo}</b> — {prazo.prazoDias} dias{prazo.prazoUteis ? " úteis" : ""}{prazo.dataSugerida ? ` · vence ${new Date(prazo.dataSugerida).toLocaleDateString("pt-BR")}` : ""}</span>
                                <Button size="sm" className="h-6 text-[10px] rounded-md bg-orange-600 hover:bg-orange-700 text-white px-2 shrink-0" disabled={criarPrazoMut.isPending} onClick={() => criarPrazoMut.mutate({ id: prazo.id })}>
                                  {criarPrazoMut.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "＋ Criar prazo"}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                ) : processoData ? (
                  // Capa veio (do DB ou da consulta), mas sem movs:
                  // tribunal retornou processo "vazio" — pode ser
                  // segredo de justiça ou processo recém-distribuído.
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Tribunal não retornou movimentações pra este processo.
                    <br />
                    <span className="text-[10px]">Pode estar em segredo de justiça ou sem trâmite recente.</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Sem movimentações registradas ainda.
                  </p>
                )}
              </>
            )}

            {/* Perguntar vem depois da timeline de propósito: a IA responde
                sobre o que está acima, e a ordem deixa isso óbvio. */}
            <div className="mt-4">
              <JurisIaPainel monitoramentoId={mon.id} />
            </div>
          </div>
        )}
      </div>
    </div>

    <AlertDialog open={confirmResumoOpen} onOpenChange={setConfirmResumoOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Gerar resumo IA?</AlertDialogTitle>
          <AlertDialogDescription>
            A IA analisará a capa e as movimentações deste processo e gerará um resumo
            estruturado. <strong>Esta operação custa 1 crédito</strong> e é debitada
            imediatamente do saldo do escritório.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={resumoMut.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              resumoMut.mutate({ cnj: searchKey, monitoramentoId: mon.id });
            }}
            disabled={resumoMut.isPending}
          >
            {resumoMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
            Gerar resumo (1 crédito)
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA: MONITORAR CLIENTES
// ═══════════════════════════════════════════════════════════════════════════════

function MonitorarTab({ onIrAoCofre }: { onIrAoCofre?: () => void }) {
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoValor, setNovoValor] = useState("");
  const [novoCredencialId, setNovoCredencialId] = useState<string>("");
  const [deletarTarget, setDeletarTarget] = useState<{ id: number; nome: string } | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "ativo" | "pausado" | "erro">("todos");
  const [buscaTexto, setBuscaTexto] = useState("");
  const [importarAdvboxOpen, setImportarAdvboxOpen] = useState(false);
  const utils = trpc.useUtils();

  // Estado pra "Atualizar todos" — drawer com lista + progress. ID da
  // operação fica no state pra suportar "user fecha drawer e reabre"
  // sem perder progresso (operação roda server-side independente).
  const [atualOperacaoId, setAtualOperacaoId] = useState<string | null>(null);
  const [atualDrawerOpen, setAtualDrawerOpen] = useState(false);

  // Suporte a deep-link de Clientes.tsx: ?abrirMonitor=1&cnj=...
  // abre o modal já preenchido com o CNJ vindo do vínculo de processo
  // do cliente, evitando re-digitação. Limpa os params após consumir
  // pra modal não reabrir em refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("abrirMonitor") === "1") {
      const cnj = sp.get("cnj");
      if (cnj) setNovoValor(cnj);
      setNovoOpen(true);
      sp.delete("abrirMonitor");
      sp.delete("cnj");
      const novoUrl = sp.toString()
        ? `${window.location.pathname}?${sp.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, "", novoUrl);
    }
  }, []);

  const { data: mons, refetch, isLoading } = trpc.processos.meusMonitoramentos.useQuery(
    { tipoMonitoramento: "movimentacoes" },
    { retry: false },
  );
  const listaMons = mons || [];

  // Staging/dev: botão pra semear um processo de teste com movimentações já
  // classificadas (desfecho/relevância/prazo) — pro dono ver o resumo novo.
  const { data: ambTeste } = (trpc.processos as any).ambienteTeste?.useQuery?.(undefined, { retry: false }) ?? { data: undefined };
  const seedTesteMut = (trpc.processos as any).seedMovimentacoesTeste.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Processo de teste criado (${r?.total ?? 4} movimentações)`, {
        description: "Abra o card '🧪 Processo de teste' abaixo e expanda pra ver os selos.",
        duration: 9000,
      });
      refetch();
    },
    onError: (e: any) => toast.error("Falha no seed de teste", { description: e.message }),
  });

  // Credenciais do cofre
  const { data: credenciais } = trpc.cofreCredenciais.listarParaSelecao.useQuery(undefined, { retry: false }) ?? { data: undefined };
  const credsAtivas = (credenciais || []).filter((c: any) => c.status === "ativa" || c.status === "validando");

  const criarMut = trpc.processos.criarMonitoramento.useMutation({
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
    onSuccess: () => {
      toast.success("Monitoramento removido");
      setDeletarTarget(null);
      refetch();
    },
    onError: (e: any) => toast.error("Erro ao remover", { description: e.message }),
  });

  const semCredenciais = !credsAtivas || credsAtivas.length === 0;

  // "Atualizar todos" — mutation + polling do progresso
  const atualizarTodosMut = trpc.processos.atualizarTodosMonitoramentos.useMutation({
    onSuccess: (d: any) => {
      setAtualOperacaoId(d.operacaoId);
      setAtualDrawerOpen(true);
      toast.success(`Atualizando ${d.total} monitoramento(s)…`);
    },
    onError: (e: any) => {
      const msg = e?.message ?? "";
      if (/nenhum monitoramento/i.test(msg)) {
        toast.info("Nenhum monitoramento pra atualizar no momento.");
      } else {
        toast.error("Falha ao iniciar atualização", { description: msg });
      }
    },
  });

  const { data: progresso } = trpc.processos.progressoAtualizacao.useQuery(
    { operacaoId: atualOperacaoId ?? "" },
    {
      enabled: !!atualOperacaoId,
      // Refetch a cada 2s enquanto rodando. Quando 'concluido', backend
      // continua devolvendo até TTL expirar — refetchInterval=false desliga
      // o poll, mas o data ainda fica disponível.
      refetchInterval: (q: any) => {
        const d = q?.state?.data;
        if (!d || d.status === "rodando") return 2000;
        return false;
      },
      retry: false,
    },
  );

  // Quando uma operação termina, recarrega a lista de monitoramentos
  // (alguns podem ter ultimoErro/movs novas etc — refresh do badge).
  useEffect(() => {
    if (progresso?.status === "concluido") {
      refetch();
      // Se algum monitor caiu por sessão expirada, atualiza badge do cofre
      // pra refletir o "expirada" que o backend já gravou no DB.
      const teveErroSessao = (progresso.monitores || []).some((m: any) =>
        m.status === "erro" && ehErroSessaoCofre({ message: m.erro }),
      );
      if (teveErroSessao) {
        utils.cofreCredenciais.listarMinhas.invalidate();
        utils.cofreCredenciais.listarParaSelecao?.invalidate?.();
      }
    }
  }, [progresso?.status, refetch, utils, progresso]);

  // Retomar operações em andamento quando user volta pra página.
  // operacoesPendentes lê o runner em memória do servidor.
  const { data: pendentes } = trpc.processos.operacoesPendentes.useQuery(undefined, {
    enabled: !atualOperacaoId,
    retry: false,
  });
  useEffect(() => {
    if (!atualOperacaoId && pendentes && pendentes.length > 0) {
      // Pega a mais recente pra retomar exibição
      setAtualOperacaoId(pendentes[0].operacaoId);
      setAtualDrawerOpen(true);
    }
  }, [pendentes, atualOperacaoId]);

  // SSE: invalida queries quando nova movimentação/ação detectada em tempo
  // real. Listener vai pro window event dispatchado pelo useNotificacoes.
  useEffect(() => {
    const onNotif = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (!detail) return;
      // Eventos relevantes pra MonitorarTab
      if (detail.tipo === "movimentacao_processo" || detail.tipo === "nova_acao") {
        refetch();
      }
    };
    window.addEventListener("jurify:notif", onNotif);
    return () => window.removeEventListener("jurify:notif", onNotif);
  }, [refetch]);

  const totalAtualizaveis = listaMons.filter((m: any) => m.status === "ativo").length;
  // 418 cards vermelhos iguais não são 418 problemas: quase sempre são UM
  // problema repetido. Agrupar por causa vira uma frase e um botão.
  const diagnostico = useMemo(() => {
    const mapa = new Map<string, { causa: any; total: number }>();
    for (const m of listaMons as any[]) {
      if (!m.diagnostico) continue;
      const atual = mapa.get(m.diagnostico.causa);
      if (atual) atual.total++;
      else mapa.set(m.diagnostico.causa, { causa: m.diagnostico, total: 1 });
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total);
  }, [listaMons]);
  const principal = diagnostico[0] ?? null;
  const secundarios = diagnostico.slice(1);
  const totalSecundarios = secundarios.reduce((acc, g) => acc + g.total, 0);

  const contaPorStatus = {
    todos: listaMons.length,
    ativo: listaMons.filter((m: any) => (m.statusJudit || m.status) === "ativo" || (m.statusJudit || m.status) === "created" || (m.statusJudit || m.status) === "updated").length,
    pausado: listaMons.filter((m: any) => (m.statusJudit || m.status) === "pausado" || (m.statusJudit || m.status) === "paused").length,
    erro: listaMons.filter((m: any) => (m.statusJudit || m.status) === "erro" || !!m.ultimoErro).length,
  };
  // Normaliza string pra busca: trim, lowercase, remove acentos e
  // não-alfanuméricos. Faz CPF "123.456.789-00" bater com "12345678900".
  const normalizarBusca = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]/g, "");
  const buscaNormalizada = normalizarBusca(buscaTexto);
  const listaMonsFiltrada = listaMons
    .filter((m: any) => {
      if (filtroStatus === "todos") return true;
      const st = m.statusJudit || m.status;
      if (filtroStatus === "ativo") return st === "ativo" || st === "created" || st === "updated";
      if (filtroStatus === "pausado") return st === "pausado" || st === "paused";
      if (filtroStatus === "erro") return st === "erro" || !!m.ultimoErro;
      return true;
    })
    .filter((m: any) => {
      if (!buscaNormalizada) return true;
      // Busca em: apelido, CNJ/searchKey, nome de qualquer parte
      // (autor, réu, terceiros), e documento (CPF/CNPJ) das partes.
      // normalizarBusca remove pontuação, então "123.456.789-00" bate
      // com "12345678900" e "Silva, João" bate com "silvajoao".
      const partes = parsePartes(m.partesJson);
      const camposPartes = partes.flatMap((p) => [p.nome, p.documento].filter(Boolean));
      const campos = [m.apelido, m.searchKey, m.cnj, ...camposPartes]
        .filter(Boolean)
        .map((c: any) => normalizarBusca(String(c)));
      return campos.some((c: string) => c.includes(buscaNormalizada));
    });

  return (
    <div className="space-y-4">
      {/* Uma barra só. Antes isto era um card com ícone em degradê repetindo
          "monitoramento" logo abaixo do título da página — três blocos de
          cabeçalho empilhados antes de aparecer qualquer processo. */}
      <div className="rounded-xl border bg-card p-2.5 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente, CPF ou número do processo…"
            value={buscaTexto}
            onChange={(e) => setBuscaTexto(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {listaMons.length > 0 && (
          <div className="flex gap-1 bg-muted p-[3px] rounded-[10px]">
            {[
              { id: "todos", label: "Todos", count: contaPorStatus.todos },
              { id: "erro", label: "Parados", count: contaPorStatus.erro },
              { id: "ativo", label: "Monitorando", count: contaPorStatus.ativo },
              { id: "pausado", label: "Pausados", count: contaPorStatus.pausado },
            ].map((abaF) => {
              const ativa = filtroStatus === abaF.id;
              return (
                <button
                  key={abaF.id}
                  type="button"
                  onClick={() => setFiltroStatus(abaF.id as "todos" | "ativo" | "pausado" | "erro")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    ativa ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {abaF.label}
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-extrabold tabular-nums ${
                      ativa ? "bg-primary text-primary-foreground" : "bg-border text-muted-foreground"
                    }`}
                  >
                    {abaF.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {ambTeste?.ehTeste && (
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800"
              disabled={seedTesteMut.isPending}
              onClick={() => seedTesteMut.mutate()}
              title="Cria um processo de teste com movimentações classificadas (só staging/dev)."
            >
              {seedTesteMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <span className="mr-1.5">🧪</span>}
              Gerar teste
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={atualizarTodosMut.isPending || progresso?.status === "rodando"}
            onClick={() => atualizarTodosMut.mutate({ monitoramentoIds: listaMons.map((m: any) => m.id) })}
            title="Reconsulta todos os monitoramentos, inclusive os parados. Sem custo de créditos."
          >
            {atualizarTodosMut.isPending || progresso?.status === "rodando" ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Atualizar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportarAdvboxOpen(true)}
            title="Importa em massa processos do export XLSX da Advbox."
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Importar
          </Button>
          <Button size="sm" onClick={() => setNovoOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Novo
          </Button>
        </div>
      </div>

      <ImportarAdvboxDialog
        open={importarAdvboxOpen}
        onOpenChange={setImportarAdvboxOpen}
        onSuccess={() => refetch()}
      />

      {principal && (
        <div className="rounded-xl border bg-card border-l-[3px] border-l-rose-500 p-4 flex items-start gap-3.5 flex-wrap">
          <div
            className={`h-9 w-9 rounded-[10px] flex items-center justify-center shrink-0 ${
              principal.causa.severidade === "alerta"
                ? "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400"
                : "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400"
            }`}
          >
            <KeyRound className="h-[18px] w-[18px]" />
          </div>
          <div className="flex-1 min-w-[320px]">
            <p className="text-[15px] font-bold">
              {principal.causa.titulo.replace("{n}", String(principal.total))}
            </p>
            <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed max-w-3xl">
              {principal.causa.explicacao}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {principal.causa.acao && principal.causa.destino === "cofre" && onIrAoCofre && (
              <Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={onIrAoCofre}>
                <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                {principal.causa.acao}
              </Button>
            )}
            {/* Fecha o ciclo: revalidar a credencial religa os monitoramentos,
                mas os dados só chegam na próxima varredura — daqui o dono
                força a releitura na hora. */}
            <Button
              size="sm"
              variant="outline"
              disabled={atualizarTodosMut.isPending || progresso?.status === "rodando"}
              onClick={() => atualizarTodosMut.mutate({ monitoramentoIds: listaMons.map((m: any) => m.id) })}
            >
              {atualizarTodosMut.isPending || progresso?.status === "rodando" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Verificar agora
            </Button>
            <Button size="sm" variant="outline" onClick={() => setFiltroStatus("erro")}>
              Ver os {principal.total}
            </Button>
          </div>
        </div>
      )}

      {secundarios.length > 0 && (
        <div className="rounded-xl border bg-card border-l-[3px] border-l-amber-500 px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-[12.5px] text-muted-foreground min-w-0">
            <b className="font-bold text-foreground">{totalSecundarios}</b>{" "}
            {totalSecundarios === 1 ? "processo para" : "processos param"} por{" "}
            {secundarios.length === 1 ? "outro motivo" : "outros motivos"}:{" "}
            {secundarios.map((g, i) => (
              <span key={g.causa.causa}>
                {i > 0 && " · "}
                <b className="font-bold text-foreground">{g.total}</b> {g.causa.motivo}
              </span>
            ))}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto shrink-0"
            onClick={() => setFiltroStatus("erro")}
          >
            Ver {totalSecundarios === 1 ? "o" : "os"} {totalSecundarios}
          </Button>
        </div>
      )}

      {/* Drawer de progresso da atualização em lote */}
      <Dialog open={atualDrawerOpen} onOpenChange={setAtualDrawerOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {progresso?.status === "concluido"
                ? "Atualização concluída"
                : "Atualizando monitoramentos…"}
            </DialogTitle>
            <DialogDescription>
              {progresso
                ? `${progresso.processados}/${progresso.total} processados — ${progresso.ok} ok, ${progresso.erro} erro${progresso.detectadasTotal > 0 ? `, ${progresso.detectadasTotal} novidade(s)` : ""}`
                : "Preparando…"}
            </DialogDescription>
          </DialogHeader>
          {progresso && (
            <>
              <Progress
                value={progresso.total > 0 ? (progresso.processados / progresso.total) * 100 : 0}
                className="h-2"
              />
              <div className="space-y-1 max-h-[50vh] overflow-y-auto mt-3">
                {progresso.monitores.map((m: any) => (
                  <div key={m.monitoramentoId} className="flex items-center gap-2 text-xs py-1.5 border-b border-dashed last:border-0">
                    <div className="w-6 shrink-0 text-center">
                      {m.status === "pendente" && <span className="text-muted-foreground">⏳</span>}
                      {m.status === "rodando" && <Loader2 className="h-3 w-3 animate-spin text-blue-500 inline" />}
                      {m.status === "ok" && <span className="text-emerald-600">✓</span>}
                      {m.status === "erro" && <span className="text-red-600">✗</span>}
                    </div>
                    <span className="flex-1 truncate">{m.apelido || `Monitor ${m.monitoramentoId}`}</span>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {m.tipo === "novas_acoes" ? "Novas ações" : "Movs"}
                    </Badge>
                    {m.status === "ok" && m.baseline && (
                      <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 text-[9px] shrink-0">Baseline</Badge>
                    )}
                    {m.status === "ok" && !m.baseline && (m.detectadas ?? 0) > 0 && (
                      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[9px] shrink-0">+{m.detectadas} novo(s)</Badge>
                    )}
                    {m.status === "ok" && !m.baseline && (m.detectadas ?? 0) === 0 && (
                      <span className="text-[9px] text-muted-foreground shrink-0">Sem novidades</span>
                    )}
                    {m.status === "erro" && (
                      <span
                        className="text-[9px] text-red-600 shrink-0 max-w-[180px] truncate"
                        title={m.erro}
                      >
                        {m.erro}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <DialogFooter>
            <Button
              variant={progresso?.status === "concluido" ? "default" : "outline"}
              onClick={() => {
                setAtualDrawerOpen(false);
                if (progresso?.status === "concluido") setAtualOperacaoId(null);
              }}
            >
              {progresso?.status === "concluido" ? "Fechar" : "Continuar em segundo plano"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {semCredenciais && (
        <div className="rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50/60 border border-blue-200/60 p-3.5 flex items-start gap-3 shadow-[0_1px_2px_0_rgb(0,0,0,0.03)]">
          <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
            <Lock className="h-4 w-4 text-blue-600" />
          </div>
          <p className="text-xs text-blue-900/90 leading-relaxed">
            Processos públicos podem ser monitorados sem credencial.
            Para processos em <strong>segredo de justiça</strong>, cadastre uma credencial OAB no <strong>Cofre</strong>.
          </p>
        </div>
      )}

      {isLoading ? <Skeleton className="h-20 w-full" /> : listaMonsFiltrada.length > 0 ? (
        <div className="space-y-2">
          {listaMonsFiltrada.map((m: any) => (
            <MonitoramentoCard
              key={m.id}
              mon={m}
              onPausar={() => pausarMut.mutate({ id: m.id })}
              onReativar={() => reativarMut.mutate({ id: m.id })}
              onDeletar={() => setDeletarTarget({ id: m.id, nome: m.apelido || m.searchKey || "monitoramento" })}
            />
          ))}
        </div>
      ) : listaMons.length > 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-10 text-center space-y-2">
          <Radar className="h-7 w-7 text-slate-300 mx-auto" />
          <p className="text-sm font-medium text-slate-600">Nenhum monitoramento com este filtro</p>
          <p className="text-xs text-slate-400">Tente outra aba de filtro acima.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-slate-50 to-indigo-50/30 py-14 text-center space-y-2">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 flex items-center justify-center mx-auto mb-1">
            <Radar className="h-7 w-7 text-indigo-500/70" />
          </div>
          <p className="font-semibold text-slate-700">Nenhum monitoramento ativo</p>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {semCredenciais
              ? "Cadastre uma credencial OAB no Cofre para começar."
              : "Adicione um número de processo (CNJ) para acompanhar movimentações."}
          </p>
        </div>
      )}

      {/* O saldo aparecia em destaque sem dizer o que o consome, e não havia
          nada na tela dizendo com que frequência o robô roda. */}
      {listaMons.length > 0 && (
        <div className="rounded-xl border bg-card px-4 py-2.5 flex items-center gap-2.5 flex-wrap text-[12px] text-muted-foreground">
          <RefreshCcw className="h-3.5 w-3.5 shrink-0" />
          <span>
            O robô varre os tribunais <b className="font-bold text-foreground">duas vezes por dia</b>, sem
            consumir créditos.
          </span>
          <span className="h-3.5 w-px bg-border" />
          <span>
            Crédito é gasto só na <b className="font-bold text-foreground">consulta avulsa</b>, no{" "}
            <b className="font-bold text-foreground">histórico completo</b> e no{" "}
            <b className="font-bold text-foreground">resumo IA</b> de um processo.
          </span>
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
                        {c.apelido} ({c.usernameMascarado})
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
                  advogados habilitados acessem dados processuais. Custo: 2 créditos/mês.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                // credencialId é obrigatório no backend; sem ele a mutation
                // falharia na validação zod. Guarda + botão desabilitado
                // evitam o clique inválido (antes o `as any` escondia isso).
                if (!novoCredencialId) return;
                criarMut.mutate({
                  numeroCnj: novoValor.trim(),
                  credencialId: Number(novoCredencialId),
                });
              }}
              disabled={!novoValor.trim() || !novoCredencialId || criarMut.isPending}
            >
              {criarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Radar className="h-4 w-4 mr-2" />}
              Monitorar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletarTarget} onOpenChange={(open) => !open && setDeletarTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover monitoramento?</AlertDialogTitle>
            <AlertDialogDescription>
              Você deixará de receber movimentações de <strong>{deletarTarget?.nome}</strong> e
              a <strong>cobrança mensal será interrompida</strong> imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deletarTarget) deletarMut.mutate({ id: deletarTarget.id });
              }}
              disabled={deletarMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletarMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cabeçalho do módulo.
 *
 * Era um banner roxo em degradê que comemorava "419 monitorados" enquanto
 * 418 deles estavam quebrados. O número que manda passou a ser pastilha, no
 * mesmo padrão da Agenda e da central de movimentações.
 */
function CabecalhoProcessos({ saldo }: { saldo: number }) {
  const { data: monsData } = trpc.processos.meusMonitoramentos.useQuery(
    { tipoMonitoramento: "movimentacoes" },
    { retry: false, refetchOnWindowFocus: false },
  );
  const { data: novasAcoesData } = trpc.processos.listarNovasAcoes.useQuery(
    { apenasNaoLidas: true, limite: 1 },
    { retry: false, refetchInterval: 60000 },
  );

  const mons = monsData || [];
  const totalMons = mons.length;
  const parados = mons.filter((m: any) => !!m.diagnostico).length;
  const totalNovas = novasAcoesData?.totalNaoLidas ?? 0;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[27px] font-bold tracking-tight leading-none">Processos</h1>
        <p className="text-[13.5px] text-muted-foreground mt-1.5">
          O robô entra nos tribunais todo dia e avisa o que mudou nos seus processos
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <PastilhaProc valor={totalMons} rotulo={totalMons === 1 ? "monitorado" : "monitorados"} />
          {parados > 0 && (
            <PastilhaProc valor={parados} rotulo={parados === 1 ? "parado" : "parados"} tom="alerta" />
          )}
          {totalNovas > 0 && (
            <PastilhaProc
              valor={totalNovas}
              rotulo={totalNovas === 1 ? "nova ação" : "novas ações"}
            />
          )}
        </div>
      </div>
      <div className="inline-flex items-center gap-2 rounded-[10px] border bg-card px-3 py-1.5 shrink-0">
        <Coins className="h-4 w-4 text-amber-500" />
        <span className="text-[13px] font-bold tabular-nums">{saldo}</span>
        <span className="text-[11.5px] text-muted-foreground">créditos</span>
      </div>
    </div>
  );
}

function PastilhaProc({
  valor,
  rotulo,
  tom = "neutro",
}: {
  valor: number;
  rotulo: string;
  tom?: "neutro" | "alerta";
}) {
  return (
    <div
      className={`rounded-[10px] border px-3 py-1.5 flex items-baseline gap-1.5 ${
        tom === "alerta"
          ? "bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-900"
          : "bg-card border-border"
      }`}
    >
      <b
        className={`text-[15px] font-bold tabular-nums ${
          tom === "alerta" ? "text-rose-600 dark:text-rose-400" : ""
        }`}
      >
        {valor}
      </b>
      <span
        className={`text-[11.5px] ${
          tom === "alerta" ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground"
        }`}
      >
        {rotulo}
      </span>
    </div>
  );
}

export default function Processos() {
  // Lê ?tab= da URL pra suportar deep-links (ex: vínculo de processo do
  // cliente redireciona pra /processos?tab=movimentacoes&cnj=...&abrirMonitor=1).
  const tabInicial = (() => {
    if (typeof window === "undefined") return "consultar";
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "movimentacoes" || t === "novas-acoes" || t === "alertas" || t === "cofre"
      ? t
      : "consultar";
  })();
  const [tab, setTab] = useState(tabInicial);
  const utils = trpc.useUtils();
  // Compatibilidade com link antigo `?abrirMonitor=1` sem `?tab=`: força
  // ir pra movimentacoes pra que o MonitorarTab abra o modal.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("abrirMonitor") === "1" && tab === "consultar") setTab("movimentacoes");
  }, [tab]);
  const { data: saldoData } = trpc.processos.saldo.useQuery(undefined, { retry: false });
  const saldo = saldoData?.saldo ?? 0;

  // SSE global de credencial: quando o backend detecta que uma credencial
  // caiu (motor-proprio ou cron-revalidar) emite `credencial_erro`. Sem
  // este listener, o badge "ativa" no cofre + dropdown de credenciais
  // ficava com cache stale até o user recarregar a página. Listener
  // mora aqui (top-level) porque cobre todas as abas — inclusive a
  // Cofre, MonitorarTab e NovasAcoesTab que mostram status. Após
  // invalidate, o cron-revalidar pode emitir `credencial_recuperada` —
  // mesma invalidação fecha o loop pro user.
  useEffect(() => {
    const onNotif = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (!detail) return;
      if (detail.tipo === "credencial_erro" || detail.tipo === "credencial_recuperada") {
        utils.cofreCredenciais.listarMinhas?.invalidate?.();
        utils.cofreCredenciais.listarParaSelecao?.invalidate?.();
      }
    };
    window.addEventListener("jurify:notif", onNotif);
    return () => window.removeEventListener("jurify:notif", onNotif);
  }, [utils]);

  // Cofre é restrito a admin do módulo (verTodos em processos = dono/gestor).
  // Atendente/SDR/estagiário não veem a aba nem as credenciais.
  const { data: minhasPerms } = trpc.permissoes?.minhasPermissoes?.useQuery?.(
    undefined,
    { retry: false, refetchOnWindowFocus: false },
  ) || { data: null };
  const podeCofre =
    minhasPerms?.cargo === "Dono" ||
    !!minhasPerms?.permissoes?.processos?.verTodos;

  return (
    <div className="space-y-5">
      <CabecalhoProcessos saldo={saldo} />

      {saldo < 5 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200/70 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-sm text-amber-800">Saldo baixo. Para comprar mais créditos, entre em contato com o suporte.</span>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="!bg-muted !border-0 !rounded-[10px] !p-[3px] !h-auto !inline-flex !w-auto gap-1 flex-wrap">
          <TabsTrigger
            value="consultar"
            className="gap-1.5 text-xs py-1.5 px-3 !rounded-lg !text-muted-foreground data-[state=active]:!bg-card data-[state=active]:!text-foreground data-[state=active]:!shadow-sm font-semibold"
          >
            <Search className="h-3.5 w-3.5" />Consultar
          </TabsTrigger>
          <TabsTrigger
            value="movimentacoes"
            className="gap-1.5 text-xs py-1.5 px-3 !rounded-lg !text-muted-foreground data-[state=active]:!bg-card data-[state=active]:!text-foreground data-[state=active]:!shadow-sm font-semibold"
          >
            <Radar className="h-3.5 w-3.5" />Monitoramento
            <MonitoramentosCount />
          </TabsTrigger>
          <TabsTrigger
            value="novas-acoes"
            className="gap-1.5 text-xs py-1.5 px-3 !rounded-lg !text-muted-foreground data-[state=active]:!bg-card data-[state=active]:!text-foreground data-[state=active]:!shadow-sm font-semibold"
          >
            <Siren className="h-3.5 w-3.5" />Novas Ações
            <NovasAcoesBadge />
          </TabsTrigger>
          <TabsTrigger
            value="alertas"
            className="gap-1.5 text-xs py-1.5 px-3 !rounded-lg !text-muted-foreground data-[state=active]:!bg-card data-[state=active]:!text-foreground data-[state=active]:!shadow-sm font-semibold"
          >
            <Bell className="h-3.5 w-3.5" />Alertas
            <AlertasBadge />
          </TabsTrigger>
          {podeCofre && (
            <TabsTrigger
              value="cofre"
              className="gap-1.5 text-xs py-1.5 px-3 !rounded-lg !text-muted-foreground data-[state=active]:!bg-card data-[state=active]:!text-foreground data-[state=active]:!shadow-sm font-semibold"
            >
              <KeyRound className="h-3.5 w-3.5" />Cofre
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="consultar" className="mt-5"><ConsultarTab /></TabsContent>
        <TabsContent value="movimentacoes" className="mt-5">
          <MonitorarTab onIrAoCofre={podeCofre ? () => setTab("cofre") : undefined} />
        </TabsContent>
        <TabsContent value="novas-acoes" className="mt-5"><NovasAcoesTab /></TabsContent>
        <TabsContent value="alertas" className="mt-5"><AlertasTab /></TabsContent>
        {podeCofre && <TabsContent value="cofre" className="mt-5"><CofreTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BADGE DE NOVAS AÇÕES NÃO LIDAS
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: ALERTAS — Prazos sugeridos detectados em movimentações
// ═══════════════════════════════════════════════════════════════════════════════

function AlertasTab() {
  const [aprovarTarget, setAprovarTarget] = useState<any | null>(null);
  const [ajusteTitulo, setAjusteTitulo] = useState("");
  const [ajusteData, setAjusteData] = useState("");
  const utils = trpc.useUtils();

  const { data: sugestoes, refetch, isLoading } = trpc.prazosSugeridos?.listar?.useQuery?.(
    { status: "pendente", limite: 100 },
    { retry: false, refetchInterval: 30000 },
  ) ?? { data: undefined, refetch: () => {}, isLoading: false };

  const aprovarMut = trpc.prazosSugeridos?.aprovar?.useMutation?.({
    onSuccess: () => {
      toast.success("Prazo criado na agenda!");
      setAprovarTarget(null);
      refetch();
      try { utils.prazosSugeridos?.contador?.invalidate?.(); } catch { /* ignore */ }
    },
    onError: (e: any) => toast.error("Erro ao criar prazo", { description: e.message }),
  });

  const descartarMut = trpc.prazosSugeridos?.descartar?.useMutation?.({
    onSuccess: () => {
      toast.success("Sugestão descartada");
      refetch();
      try { utils.prazosSugeridos?.contador?.invalidate?.(); } catch { /* ignore */ }
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });

  const abrirAprovar = (sug: any) => {
    setAprovarTarget(sug);
    setAjusteTitulo(sug.titulo);
    const dataLocal = sug.dataSugerida
      ? new Date(sug.dataSugerida).toISOString().slice(0, 16)
      : new Date().toISOString().slice(0, 16);
    setAjusteData(dataLocal);
  };

  const confirmarAprovar = () => {
    if (!aprovarTarget) return;
    aprovarMut.mutate({
      id: aprovarTarget.id,
      ajustes: {
        titulo: ajusteTitulo,
        dataInicio: new Date(ajusteData).toISOString(),
      },
    });
  };

  const lista = sugestoes ?? [];

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 via-orange-50/40 to-yellow-50/30 p-5 shadow-[0_1px_2px_0_rgb(0,0,0,0.04)]">
        <div className="absolute -top-6 -right-6 h-32 w-32 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shrink-0 shadow-sm">
            <Bell className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm tracking-tight">Alertas detectados nas movimentações</p>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-bold uppercase tracking-wider">
                <Sparkles className="h-2.5 w-2.5" />
                IA
              </span>
            </div>
            <p className="text-[11px] text-amber-900/75 mt-1 max-w-2xl leading-relaxed">
              Sistema detecta automaticamente <strong>audiências, intimações, réplica, contestação e recursos</strong>.
              Aprove pra criar agendamento direto na agenda — ou descarte se for falso positivo.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-slate-50 to-amber-50/30 py-14 text-center space-y-2">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 flex items-center justify-center mx-auto mb-1">
            <Bell className="h-7 w-7 text-amber-500/70" />
          </div>
          <p className="font-semibold text-slate-700">Nenhum alerta pendente</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Quando o cron detectar prazos ou audiências em movimentações dos seus processos monitorados,
            vão aparecer aqui pra você aprovar ou descartar com 1 click.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map((sug: any) => {
            const isAudiencia = sug.tipo === "audiencia";
            const isUrgente = sug.prazoDias != null && sug.prazoDias <= 5;
            // Pala lateral (borda esquerda) + cores baseadas no tipo
            const palette = isAudiencia
              ? {
                  borda: "border-l-violet-500 border border-violet-200/60",
                  iconBg: "bg-gradient-to-br from-violet-500 to-purple-500",
                  badgeBg: "bg-violet-500/15 text-violet-700 border-violet-500/30",
                  tipoLabel: "Audiência",
                  Icon: Gavel,
                }
              : isUrgente
                ? {
                    borda: "border-l-rose-500 border border-rose-200/60",
                    iconBg: "bg-gradient-to-br from-rose-500 to-red-500",
                    badgeBg: "bg-rose-500/15 text-rose-700 border-rose-500/30",
                    tipoLabel: "Prazo urgente",
                    Icon: AlertTriangle,
                  }
                : {
                    borda: "border-l-amber-500 border border-amber-200/60",
                    iconBg: "bg-gradient-to-br from-amber-500 to-orange-500",
                    badgeBg: "bg-amber-500/15 text-amber-700 border-amber-500/30",
                    tipoLabel: "Prazo",
                    Icon: Clock,
                  };
            const Icon = palette.Icon;
            return (
              <div
                key={sug.id}
                className={`rounded-xl bg-white p-4 border-l-[3px] ${palette.borda} shadow-[0_1px_2px_0_rgb(0,0,0,0.04)] hover:shadow-[0_4px_12px_-2px_rgb(0,0,0,0.06)] transition-all`}
              >
                <div className="flex items-start gap-3">
                  <div className={`h-9 w-9 rounded-lg ${palette.iconBg} flex items-center justify-center shrink-0 shadow-sm`}>
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold tracking-tight">{sug.titulo}</p>
                      <Badge className={`${palette.badgeBg} text-[9px]`}>{palette.tipoLabel}</Badge>
                      {sug.tribunal && <Badge variant="outline" className="text-[9px]">{sug.tribunal}</Badge>}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      <span className="font-medium text-slate-700">{sug.apelidoProcesso}</span>
                      {sug.cnj && <span className="font-mono"> · {sug.cnj}</span>}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
                      {sug.dataSugerida && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200/60 text-blue-700 font-medium tabular-nums">
                          <Clock className="h-3 w-3" />
                          {new Date(sug.dataSugerida).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                      )}
                      {sug.prazoDias != null && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          isUrgente
                            ? "bg-rose-50 border-rose-200 text-rose-700"
                            : "bg-slate-50 border-slate-200 text-slate-600"
                        }`}>
                          {sug.prazoDias} {sug.prazoDias === 1 ? "dia" : "dias"}{sug.prazoUteis ? " úteis" : ""}
                        </span>
                      )}
                    </div>
                    {sug.motivo && (
                      <p className="text-[10px] text-slate-500 mt-1.5 italic">"{sug.motivo}"</p>
                    )}
                    {sug.trechoOrigem && (
                      <details className="mt-1.5 group">
                        <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-700 inline-flex items-center gap-1 list-none">
                          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                          Ver trecho original
                        </summary>
                        <p className="text-[10px] text-slate-600 mt-1.5 bg-slate-50 border border-slate-200/70 rounded-lg p-2.5 leading-relaxed">
                          {sug.trechoOrigem}
                        </p>
                      </details>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      className="h-7 text-[10px] rounded-lg bg-gradient-to-br from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-sm"
                      onClick={() => abrirAprovar(sug)}
                      disabled={aprovarMut.isPending || descartarMut.isPending}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px] rounded-lg border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      onClick={() => descartarMut.mutate({ id: sug.id })}
                      disabled={aprovarMut.isPending || descartarMut.isPending}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Descartar
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de aprovação com ajustes */}
      <Dialog open={!!aprovarTarget} onOpenChange={(open) => !open && setAprovarTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar prazo na agenda</DialogTitle>
            <DialogDescription>
              Confirme os dados antes de criar o agendamento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="alerta-titulo">Título</Label>
              <Input
                id="alerta-titulo"
                value={ajusteTitulo}
                onChange={(e) => setAjusteTitulo(e.target.value)}
                maxLength={255}
              />
            </div>
            <div>
              <Label htmlFor="alerta-data">Data e hora</Label>
              <Input
                id="alerta-data"
                type="datetime-local"
                value={ajusteData}
                onChange={(e) => setAjusteData(e.target.value)}
              />
            </div>
            {aprovarTarget?.motivo && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Detectado:</span> {aprovarTarget.motivo}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAprovarTarget(null)}>Cancelar</Button>
            <Button onClick={confirmarAprovar} disabled={aprovarMut.isPending}>
              {aprovarMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
              Criar agendamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MonitoramentosCount() {
  const { data } = trpc.processos.meusMonitoramentos.useQuery(
    { tipoMonitoramento: "movimentacoes" },
    { retry: false, refetchOnWindowFocus: false },
  );
  const mons = data || [];
  if (mons.length === 0) return null;
  // Quando há processo parado, o badge mostra QUANTOS pararam, em vermelho.
  // Mostrar o total ali dizia "419 monitorados" enquanto 418 estavam mudos.
  const parados = mons.filter((m: any) => !!m.diagnostico).length;
  return (
    <span
      className={`ml-1 text-[10px] px-1.5 rounded-full tabular-nums font-semibold ${
        parados > 0
          ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
          : "bg-indigo-100 text-indigo-700"
      }`}
      title={parados > 0 ? `${parados} de ${mons.length} pararam de atualizar` : undefined}
    >
      {parados > 0 ? parados : mons.length}
    </span>
  );
}

function NovasAcoesBadge() {
  const { data } = trpc.processos.listarNovasAcoes.useQuery(
    { apenasNaoLidas: true, limite: 1 },
    { retry: false, refetchInterval: 60000 },
  );
  const count = data?.totalNaoLidas ?? 0;
  if (count === 0) return null;
  return (
    <span className="ml-1 text-[10px] bg-rose-100 text-rose-700 px-1.5 rounded-full tabular-nums font-semibold animate-pulse">
      {count}
    </span>
  );
}

function AlertasBadge() {
  const { data } = trpc.prazosSugeridos?.contador?.useQuery?.(undefined, {
    retry: false,
    refetchInterval: 60000,
  }) ?? { data: undefined };
  const count = data?.pendentes ?? 0;
  if (count === 0) return null;
  return (
    <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 rounded-full tabular-nums font-semibold animate-pulse">
      {count}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: NOVAS AÇÕES
// ═══════════════════════════════════════════════════════════════════════════════

const RESOLUCAO_META: Record<string, { label: string; emoji: string; badge: string; borda: string; verbo: string }> = {
  monitorando: { label: "Monitorando", emoji: "🟢", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", borda: "border-l-emerald-500", verbo: "Resolvido" },
  lida: { label: "Ciente", emoji: "✔", badge: "bg-slate-100 text-slate-600 border-slate-200", borda: "border-l-slate-300", verbo: "Marcada" },
  falso: { label: "Falso positivo", emoji: "⊘", badge: "bg-rose-50 text-rose-600 border-rose-200", borda: "border-l-rose-300", verbo: "Descartado" },
};

function NovasAcoesTab() {
  // Default `true`: a aba mostra só ações com `lido=false` (não-silenciadas).
  // Eventos silenciados (baseline da primeira execução, polo ativo, ajuizado
  // antes do cadastro do cliente) ficam acessíveis pelo toggle no header.
  // Sem este default, processos antigos da baseline apareciam confundindo
  // o user como se fossem detecções recentes.
  const [filtro, setFiltro] = useState<"pendentes" | "resolvidas" | "todas">("pendentes");
  const [novoOpen, setNovoOpen] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState<any>(null);
  const [credencialId, setCredencialId] = useState<string>("");
  const [deletarMonTarget, setDeletarMonTarget] = useState<{ id: number; nome: string } | null>(null);
  const [atualOperacaoId, setAtualOperacaoId] = useState<string | null>(null);
  const [atualDrawerOpen, setAtualDrawerOpen] = useState(false);
  const [buscaTexto, setBuscaTexto] = useState("");
  // Detalhes enriquecidos por nova ação (on-demand via consultarCNJSincrono — 1 cred/cnj).
  // Cards chegam só com cnj+tribunal+data; partes/assunto/valor não são persistidos.
  const [detalhesPorAcaoId, setDetalhesPorAcaoId] = useState<Record<number, any>>({});
  const [carregandoAcaoId, setCarregandoAcaoId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data: credenciais } = trpc.cofreCredenciais.listarParaSelecao.useQuery(undefined, { retry: false }) ?? { data: undefined };
  const credsAtivas = (credenciais || []).filter((c: any) => c.status === "ativa");

  const LIMITE_PAGINA = 25;
  const [cursor, setCursor] = useState(0);
  const [acoesAcumuladas, setAcoesAcumuladas] = useState<any[]>([]);

  const { data, refetch, isLoading, isFetching } = trpc.processos.listarNovasAcoes.useQuery(
    { filtro, limite: LIMITE_PAGINA, cursor },
    { retry: false },
  );

  // Reseta paginação quando o filtro muda — caso contrário cursor antigo
  // continuaria valendo num conjunto de dados diferente.
  useEffect(() => {
    setCursor(0);
    setAcoesAcumuladas([]);
  }, [filtro]);

  // Acumula páginas: cursor=0 substitui (página inicial / refetch),
  // cursor>0 anexa (carregar mais).
  useEffect(() => {
    if (!data?.acoes) return;
    setAcoesAcumuladas((prev) => (cursor === 0 ? data.acoes : [...prev, ...data.acoes]));
  }, [data, cursor]);

  // Helper pra reset após mutações que alteram a lista.
  // Mantém UX previsível: volta pro topo com dados frescos.
  const recarregarDoTopo = () => {
    if (cursor === 0) {
      refetch();
    } else {
      setCursor(0);
    }
  };

  // Busca clientes cadastrados para seleção
  const { data: clientesData } = trpc.clientes.listar.useQuery(
    { busca: buscaCliente || undefined, limite: 20 },
    { enabled: novoOpen },
  );
  const clientes = (clientesData?.clientes || []).filter((c: any) => c.cpfCnpj);

  const criarMut = trpc.processos.criarMonitoramentoNovasAcoes.useMutation({
    onSuccess: () => {
      toast.success("Monitoramento criado!");
      setNovoOpen(false);
      setBuscaCliente("");
      setClienteSelecionado(null);
      recarregarDoTopo();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Resolve um card (monitorando/lida/falso): sai da lista atual na hora
  // (optimistic) — o card deixa as Pendentes. onError reverte via refetch.
  const resolverMut = trpc.processos.resolverNovaAcao.useMutation({
    onMutate: ({ id }: { id: number }) => {
      setAcoesAcumuladas((prev) => prev.filter((a) => a.id !== id));
    },
    onError: (e: any) => {
      toast.error("Não foi possível resolver o card", { description: e.message });
      recarregarDoTopo();
    },
  });

  // Reabre um card resolvido — volta pra Pendentes; sai da lista de Resolvidas.
  const reabrirMut = trpc.processos.reabrirNovaAcao.useMutation({
    onMutate: ({ id }: { id: number }) => {
      setAcoesAcumuladas((prev) => prev.filter((a) => a.id !== id));
    },
    onSuccess: () => toast.success("Card reaberto — voltou pras Pendentes"),
    onError: (e: any) => {
      toast.error("Erro ao reabrir", { description: e.message });
      recarregarDoTopo();
    },
  });

  const monitorarMut = trpc.processos.criarMonitoramento.useMutation({
    onSuccess: (d: any) => {
      toast.success(`Processo agora monitorado (${d?.custoCred ?? 2} cred/mês)`, {
        description: "As próximas movimentações vão aparecer na aba Movimentações.",
        duration: 6000,
      });
    },
    onError: (e: any) => {
      toast.error("Falha ao monitorar", { description: e.message });
      if (ehErroSessaoCofre(e)) {
        utils.cofreCredenciais.listarMinhas.invalidate();
        utils.cofreCredenciais.listarParaSelecao?.invalidate?.();
      }
    },
  });

  // `as any`: passamos `acaoId` extra no input do mutate só pra recuperá-lo
  // em onSuccess (vars.acaoId) e casar o resultado com a ação certa — não é
  // campo do input da procedure. Tipar exigiria mover o onSuccess pra opção
  // por-chamada; mantido como cast documentado.
  const carregarDetalhesMut = (trpc.processos as any).consultarCNJSincrono.useMutation({
    onSuccess: (d: any, vars: { cnj: string; acaoId: number }) => {
      if (d?.lawsuit) {
        setDetalhesPorAcaoId((prev) => ({ ...prev, [vars.acaoId]: d.lawsuit }));
        toast.success("Detalhes carregados (1 cred)");
      } else {
        toast.warning("Tribunal não retornou detalhes pra esse CNJ");
      }
      setCarregandoAcaoId(null);
    },
    onError: (e: any) => {
      toast.error("Falha ao carregar detalhes", { description: e.message });
      setCarregandoAcaoId(null);
      if (ehErroSessaoCofre(e)) {
        utils.cofreCredenciais.listarMinhas.invalidate();
        utils.cofreCredenciais.listarParaSelecao?.invalidate?.();
      }
    },
  });

  const carregarDetalhes = (acaoId: number, cnj: string, credIdMon?: number | null) => {
    if (carregandoAcaoId !== null) return;
    setCarregandoAcaoId(acaoId);
    carregarDetalhesMut.mutate({ cnj, credencialId: credIdMon ?? undefined, acaoId });
  };

  /** Pega credencialId do monitoramento parent (do cliente). Cada nova ação
   *  está vinculada a um monitoramento de novas-ações, que tem credencialId
   *  pra acessar segredo de justiça. */
  const credencialIdDoMonitor = (monitoramentoIdParent: number | undefined): number | undefined => {
    if (!monitoramentoIdParent) return undefined;
    const mon = (data?.monitoramentos || []).find((m: any) => m.id === monitoramentoIdParent);
    return mon?.credencialId ?? undefined;
  };

  const handleMonitorarAcao = async (a: any) => {
    const credId = credencialIdDoMonitor(a.monitoramentoId);
    if (!credId) {
      toast.error("Sem credencial OAB associada", {
        description: "Cadastre/valide uma credencial no Cofre antes de monitorar.",
        duration: 8000,
      });
      return;
    }
    try {
      await monitorarMut.mutateAsync({ numeroCnj: a.cnj, credencialId: credId });
      // Monitorar É o desfecho: resolve o card e tira das Pendentes num clique.
      resolverMut.mutate({ id: a.id, resolucao: "monitorando" });
    } catch {
      // toast de erro já disparado por monitorarMut.onError; card permanece.
    }
  };

  const handleFalsoAcao = (id: number) => {
    // Reversível agora (soft): vai pras Resolvidas como "falso", sem confirm.
    resolverMut.mutate({ id, resolucao: "falso" });
  };

  const atualizarAgoraMut = trpc.processos.atualizarNovasAcoesAgora.useMutation({
    onSuccess: (r: any) => {
      if (!r.ok) {
        toast.error("Falha na busca", { description: r.mensagem ?? "Erro desconhecido", duration: 8000 });
        if (ehErroSessaoCofre({ message: r.mensagem })) {
          utils.cofreCredenciais.listarMinhas.invalidate();
          utils.cofreCredenciais.listarParaSelecao?.invalidate?.();
        }
        return;
      }
      if (r.baseline) {
        toast.success(`Baseline registrado: ${r.cnjsTotal} processo(s) já existentes (${(r.latenciaMs / 1000).toFixed(1)}s)`, {
          description: "Próximas execuções avisarão apenas dos NOVOS.",
          duration: 8000,
        });
      } else if (r.cnjsNovos > 0) {
        toast.success(`${r.cnjsNovos} nova(s) ação(ões) detectada(s)!`);
      } else {
        toast.info(`Nenhuma ação nova (${r.cnjsTotal} processos já conhecidos)`);
      }
      recarregarDoTopo();
    },
    onError: (e: any) => {
      toast.error("Erro ao atualizar", { description: e.message });
      if (ehErroSessaoCofre(e)) {
        utils.cofreCredenciais.listarMinhas.invalidate();
        utils.cofreCredenciais.listarParaSelecao?.invalidate?.();
      }
    },
  });

  const deletarMonMut = trpc.processos.deletarMonitoramento.useMutation({
    onSuccess: () => {
      toast.success("Monitoramento removido", { description: "A cobrança mensal foi interrompida." });
      setDeletarMonTarget(null);
      recarregarDoTopo();
    },
    onError: (e: any) => toast.error("Erro ao remover", { description: e.message }),
  });

  const atualizarTodosMut = trpc.processos.atualizarTodosMonitoramentos.useMutation({
    onSuccess: (d: any) => {
      setAtualOperacaoId(d.operacaoId);
      setAtualDrawerOpen(true);
      toast.success(`Atualizando ${d.total} monitoramento(s) de novas ações…`);
    },
    onError: (e: any) => {
      const msg = e?.message ?? "";
      if (/nenhum monitoramento/i.test(msg)) {
        toast.info("Nenhum monitoramento pra atualizar no momento.");
      } else {
        toast.error("Falha ao iniciar atualização", { description: msg });
      }
    },
  });

  const { data: progresso } = trpc.processos.progressoAtualizacao.useQuery(
    { operacaoId: atualOperacaoId ?? "" },
    {
      enabled: !!atualOperacaoId,
      refetchInterval: (q: any) => {
        const d = q?.state?.data;
        if (!d || d.status === "rodando") return 2000;
        return false;
      },
      retry: false,
    },
  );

  useEffect(() => {
    if (progresso?.status === "concluido") {
      recarregarDoTopo();
    }
  }, [progresso?.status]);

  const acoesRaw = acoesAcumuladas;
  const monitoramentosRaw = data?.monitoramentos || [];
  const hasMore = data?.hasMore ?? false;
  const idsNovasAcoes = monitoramentosRaw.map((m: any) => m.id);
  const totalAtualizaveisNovas = monitoramentosRaw.filter((m: any) => m.statusJudit === "ativo" || m.status === "ativo" || m.statusJudit === "created" || m.statusJudit === "updated").length;

  // Normalização Unicode-segura (acentos + pontuação) — mesma lógica do
  // MonitorarTab. CPF "123.456.789-00" bate com "12345678900".
  const normalizar = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]/g, "");
  const buscaNormalizada = normalizar(buscaTexto);
  const monitoramentos = !buscaNormalizada
    ? monitoramentosRaw
    : monitoramentosRaw.filter((m: any) => {
        const campos = [m.apelido, m.searchKey].filter(Boolean).map((c: string) => normalizar(String(c)));
        return campos.some((c: string) => c.includes(buscaNormalizada));
      });
  const acoes = !buscaNormalizada
    ? acoesRaw
    : acoesRaw.filter((a: any) => {
        const campos = [a.cnj, a.clienteApelido, a.clienteSearchKey, a.tribunal]
          .filter(Boolean)
          .map((c: string) => normalizar(String(c)));
        return campos.some((c: string) => c.includes(buscaNormalizada));
      });

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-rose-200/60 bg-gradient-to-br from-rose-50 via-orange-50/50 to-amber-50/30 p-5 shadow-[0_1px_2px_0_rgb(0,0,0,0.04)]">
        <div className="absolute -top-6 -right-6 h-32 w-32 rounded-full bg-rose-200/40 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center shrink-0 shadow-sm">
              <Siren className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm tracking-tight">Alerta de novas ações contra clientes</p>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold uppercase tracking-wider">
                  <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
                  Em tempo real
                </span>
              </div>
              <p className="text-[11px] text-rose-900/75 mt-1 max-w-2xl leading-relaxed">
                Selecione clientes cadastrados e seja avisado <strong>imediatamente</strong> quando uma nova ação for distribuída contra eles —
                antes mesmo da citação. Funciona pra busca e apreensão, reclamações trabalhistas, execuções, etc.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-9 rounded-lg border-rose-200 bg-white hover:bg-rose-50 hover:border-rose-300 text-rose-700"
              disabled={atualizarTodosMut.isPending || progresso?.status === "rodando"}
              onClick={() => atualizarTodosMut.mutate({ monitoramentoIds: idsNovasAcoes })}
              title="Atualiza todos os monitoramentos de novas ações em paralelo. Sem custo de créditos."
            >
              {atualizarTodosMut.isPending || progresso?.status === "rodando" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5 mr-1" />
              )}
              Atualizar todos
            </Button>
            <Button
              size="sm"
              className="h-9 rounded-lg bg-gradient-to-br from-rose-600 to-orange-600 hover:from-rose-700 hover:to-orange-700 shadow-sm"
              onClick={() => setNovoOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />Novo monitoramento
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={atualDrawerOpen} onOpenChange={setAtualDrawerOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {progresso?.status === "concluido"
                ? "Atualização concluída"
                : "Atualizando monitoramentos…"}
            </DialogTitle>
            <DialogDescription>
              {progresso
                ? `${progresso.processados}/${progresso.total} processados — ${progresso.ok} ok, ${progresso.erro} erro${progresso.detectadasTotal > 0 ? `, ${progresso.detectadasTotal} novidade(s)` : ""}`
                : "Preparando…"}
            </DialogDescription>
          </DialogHeader>
          {progresso && (
            <>
              <Progress
                value={progresso.total > 0 ? (progresso.processados / progresso.total) * 100 : 0}
                className="h-2"
              />
              <div className="space-y-1 max-h-[50vh] overflow-y-auto mt-3">
                {progresso.monitores.map((m: any) => (
                  <div key={m.monitoramentoId} className="flex items-center gap-2 text-xs py-1.5 border-b border-dashed last:border-0">
                    <div className="w-6 shrink-0 text-center">
                      {m.status === "pendente" && <span className="text-muted-foreground">⏳</span>}
                      {m.status === "rodando" && <Loader2 className="h-3 w-3 animate-spin text-blue-500 inline" />}
                      {m.status === "ok" && <span className="text-emerald-600">✓</span>}
                      {m.status === "erro" && <span className="text-red-600">✗</span>}
                    </div>
                    <span className="flex-1 truncate">{m.apelido || `Monitor ${m.monitoramentoId}`}</span>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {m.tipo === "novas_acoes" ? "Novas ações" : "Movs"}
                    </Badge>
                    {m.status === "ok" && m.baseline && (
                      <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 text-[9px] shrink-0">Baseline</Badge>
                    )}
                    {m.status === "ok" && !m.baseline && (m.detectadas ?? 0) > 0 && (
                      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[9px] shrink-0">+{m.detectadas} novo(s)</Badge>
                    )}
                    {m.status === "ok" && !m.baseline && (m.detectadas ?? 0) === 0 && (
                      <span className="text-[9px] text-muted-foreground shrink-0">Sem novidades</span>
                    )}
                    {m.status === "erro" && (
                      <span className="text-[9px] text-red-600 shrink-0 max-w-[180px] truncate" title={m.erro}>
                        {m.erro}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <DialogFooter>
            <Button
              variant={progresso?.status === "concluido" ? "default" : "outline"}
              onClick={() => {
                setAtualDrawerOpen(false);
                if (progresso?.status === "concluido") setAtualOperacaoId(null);
              }}
            >
              {progresso?.status === "concluido" ? "Fechar" : "Continuar em segundo plano"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cards dos clientes sendo monitorados (contexto) */}
      {monitoramentosRaw.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-[0_1px_2px_0_rgb(0,0,0,0.04)]">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Users className="h-3.5 w-3.5 text-white" />
              </div>
              <div>
                <p className="text-xs font-bold tracking-tight text-slate-900">
                  Monitorando {monitoramentosRaw.length} {monitoramentosRaw.length === 1 ? "cliente" : "clientes"}
                </p>
                <p className="text-[10px] text-slate-500">
                  {monitoramentosRaw.filter((m: any) => (m.statusJudit || m.status) === "ativo").length} ativos · {monitoramentosRaw.filter((m: any) => !!m.ultimoErro).length} com erro
                </p>
              </div>
            </div>
            <p className="text-[10px] text-slate-400">
              {monitoramentos.length !== monitoramentosRaw.length && (
                <>Mostrando <b className="text-slate-700">{monitoramentos.length}</b> de {monitoramentosRaw.length}</>
              )}
            </p>
          </div>

          {/* Grid de cards — mais altos com info enriquecida */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {monitoramentos.length === 0 ? (
              <p className="col-span-full text-center text-[11px] text-slate-400 italic py-4">
                Nenhum cliente bate com a busca acima.
              </p>
            ) : (
              monitoramentos.map((m: any) => {
                const status = m.statusJudit || m.status;
                const temErro = !!m.ultimoErro;
                const pausado = status === "paused" || status === "pausado";
                const nome = m.apelido || m.searchKey || "Cliente";
                const corteBorda = temErro
                  ? "border-l-rose-500"
                  : pausado
                    ? "border-l-slate-400"
                    : "border-l-emerald-500";
                return (
                  <div
                    key={m.id}
                    className={`group relative rounded-xl bg-white border border-slate-200 border-l-[3px] ${corteBorda} hover:shadow-[0_4px_12px_-2px_rgb(0,0,0,0.06)] transition-all overflow-hidden`}
                  >
                    <div className="p-3">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold text-white shrink-0 shadow-sm bg-gradient-to-br ${gradientAvatar(nome)}`}
                        >
                          {gerarIniciais(nome)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <MonitorHealthDot
                              statusJudit={status}
                              updatedAt={m.updatedAt}
                              createdAt={m.createdAt}
                              ultimoErro={m.ultimoErro}
                            />
                            <p className="text-xs font-bold tracking-tight truncate" title={nome}>
                              {nome}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span className="inline-flex items-center px-1.5 py-0 rounded-full bg-slate-100 text-slate-600 text-[9px] font-mono font-semibold">
                              {(m.searchType || "").toUpperCase()}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono truncate">{m.searchKey}</span>
                          </div>
                          {(m.totalNovasAcoes ?? 0) > 0 && (
                            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[9.5px] font-bold mt-1.5">
                              <Siren className="h-2.5 w-2.5" />
                              {m.totalNovasAcoes} {m.totalNovasAcoes === 1 ? "ação nova" : "ações novas"}
                            </div>
                          )}
                          {temErro && (
                            <p className="text-[9.5px] text-rose-600 mt-1 truncate" title={m.ultimoErro}>
                              ⚠ {m.ultimoErro}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-slate-100">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] rounded-md text-indigo-600 hover:bg-indigo-50 px-2"
                          title="Atualizar agora — força consulta imediata (sem custo extra)"
                          onClick={() => atualizarAgoraMut.mutate({ monitoramentoId: m.id })}
                          disabled={atualizarAgoraMut.isPending}
                        >
                          {atualizarAgoraMut.isPending && atualizarAgoraMut.variables?.monitoramentoId === m.id
                            ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            : <RefreshCcw className="h-3 w-3 mr-1" />}
                          Atualizar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] rounded-md text-rose-600 hover:bg-rose-50 px-2"
                          title="Remover monitoramento"
                          onClick={() => setDeletarMonTarget({ id: m.id, nome: m.apelido || m.searchKey || "cliente" })}
                          disabled={deletarMonMut.isPending}
                        >
                          {deletarMonMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />}
                          Remover
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Buscar por nome, CPF, CNPJ ou CNJ…"
            value={buscaTexto}
            onChange={(e) => setBuscaTexto(e.target.value)}
            className="pl-8 h-8 rounded-lg border-slate-200 bg-white text-xs focus-visible:ring-rose-400"
          />
          {buscaTexto && (
            <button
              type="button"
              onClick={() => setBuscaTexto("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              title="Limpar"
            >
              ✕
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 shrink-0 hidden sm:block">
          {acoes.length}
          {hasMore && !buscaNormalizada ? "+" : ""}{" "}
          {acoes.length === 1 ? "card" : "cards"}
        </p>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs shrink-0">
          {([
            ["pendentes", "Pendentes"],
            ["resolvidas", "Resolvidas"],
            ["todas", "Todas"],
          ] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setFiltro(val)}
              className={`px-2.5 py-1.5 rounded-md font-medium transition-colors inline-flex items-center gap-1 ${filtro === val ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700"}`}
            >
              {label}
              {val === "pendentes" && (data?.totalNaoLidas ?? 0) > 0 && (
                <span className={`px-1.5 rounded-full text-[10px] tabular-nums ${filtro === val ? "bg-white/25" : "bg-rose-100 text-rose-600"}`}>{data?.totalNaoLidas}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Mostra skeleton tambem em isFetching+lista vazia pra cobrir o gap
          entre setCursor(0)/setAcoesAcumuladas([]) e o resultado da nova
          query — sem isso, o user veria empty-state piscando entre filtros. */}
      {isLoading || (isFetching && acoes.length === 0) ? (
        <Skeleton className="h-32 w-full" />
      ) : acoes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Siren className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium">
              {filtro === "pendentes" ? "Nada pendente — tudo resolvido! 🎉"
                : filtro === "resolvidas" ? "Nenhum card resolvido ainda"
                : "Nenhuma nova ação detectada"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              {filtro === "pendentes"
                ? "Novas ações contra seus clientes monitorados aparecem aqui pra você dar um desfecho."
                : filtro === "resolvidas"
                ? "Cards que você monitorar, marcar como ciente ou descartar aparecem aqui."
                : "Quando houver novos processos contra seus clientes monitorados, eles aparecerão aqui."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {acoes.map((a: any) => {
            const detalhes = detalhesPorAcaoId[a.id];
            const carregando = carregandoAcaoId === a.id;
            const ativos = (detalhes?.parties || []).filter((p: any) => p.side === "Active").slice(0, 3);
            const passivos = (detalhes?.parties || []).filter((p: any) => p.side === "Passive").slice(0, 3);
            const advogados = (detalhes?.parties || [])
              .flatMap((p: any) => (p.lawyers || []).map((l: any) => l.name))
              .slice(0, 3);
            const assunto = detalhes?.classifications?.[0]?.name || detalhes?.subjects?.[0]?.name;
            const valor = detalhes?.amount;
            const corte = detalhes?.courts?.[0]?.name;
            const clienteNome = a.clienteApelido || a.clienteSearchKey || "Cliente";
            const seed = clienteNome + (a.id || "");
            const iniciais = gerarIniciais(clienteNome);
            const resolvido = a.resolucao && a.resolucao !== "pendente";
            const rMeta = resolvido ? RESOLUCAO_META[a.resolucao as string] : null;
            const corteBorda = resolvido
              ? (rMeta?.borda ?? "border-l-slate-300")
              : (!a.lido ? "border-l-rose-500" : "border-l-transparent");
            const tempoRel = tempoRelativoBR(a.dataDistribuicao || a.createdAt);

            return (
              <div
                key={a.id}
                className={`rounded-xl bg-white border border-slate-200 border-l-[3px] ${corteBorda} ${!a.lido ? "shadow-[0_2px_8px_-2px_rgb(244,63,94,0.15)] bg-gradient-to-r from-rose-50/30 to-white" : "shadow-[0_1px_2px_0_rgb(0,0,0,0.04)]"} hover:shadow-[0_4px_12px_-2px_rgb(0,0,0,0.08)] transition-all ${resolverMut.isPending ? "pointer-events-none opacity-70" : ""}`}
              >
                <div className="px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    {/* Avatar gradient com iniciais do cliente */}
                    <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${gradientAvatar(seed)} flex items-center justify-center shrink-0 shadow-sm`}>
                      <span className="text-white font-bold text-sm tracking-tight">{iniciais}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Header: nome do cliente em destaque */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold tracking-tight truncate" title={clienteNome}>
                          {clienteNome}
                        </p>
                        {!resolvido && !a.lido && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold uppercase tracking-wider animate-pulse">
                            <Siren className="h-2.5 w-2.5" />
                            Novo
                          </span>
                        )}
                        {resolvido && rMeta && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${rMeta.badge}`}>
                            {rMeta.emoji} {rMeta.label}
                          </span>
                        )}
                        {a.clienteSearchType && a.clienteSearchKey && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[9px] font-mono">
                            {a.clienteSearchType.toUpperCase()} {a.clienteSearchKey}
                          </span>
                        )}
                      </div>
                      {resolvido && (
                        <p className="text-[10.5px] text-slate-500 mt-1">
                          {rMeta?.verbo} por <b className="text-slate-700">{a.resolvidoPorNome || "—"}</b>
                          {a.resolvidoEm && <> · {tempoRelativoBR(a.resolvidoEm)}</>}
                          {a.resolucao === "monitorando" && <> · agora aparece em <b className="text-slate-700">Movimentações</b></>}
                        </p>
                      )}

                      {/* Detectado há X / em Y tribunal */}
                      <div className="flex items-center gap-2 text-[10.5px] text-slate-500 mt-1 flex-wrap">
                        {tempoRel && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Detectado <b className="font-semibold text-slate-700">{tempoRel}</b>
                          </span>
                        )}
                        {a.tribunal && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold text-[9.5px]">
                              {a.tribunal.toUpperCase()}
                            </span>
                          </>
                        )}
                        {detalhes?.instance && (
                          <span className="text-slate-500">{detalhes.instance}ª inst.</span>
                        )}
                      </div>

                      {/* Box do processo */}
                      <div className="mt-3 rounded-lg bg-slate-50/70 border border-slate-200/70 p-3 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold font-mono text-slate-900">{a.cnj}</p>
                          {valor != null && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9.5px] font-semibold tabular-nums">
                              <CircleDollarSign className="h-2.5 w-2.5" />
                              {formatBRL(valor)}
                            </span>
                          )}
                          {detalhes?.distribution_date && (
                            <span className="text-[10px] text-slate-500">
                              Dist. {new Date(detalhes.distribution_date).toLocaleDateString("pt-BR")}
                            </span>
                          )}
                        </div>
                        {assunto && (
                          <p className="text-xs text-slate-700 leading-snug">{assunto}</p>
                        )}
                        {corte && (
                          <p className="text-[10.5px] text-slate-500 flex items-center gap-1">
                            <MapPin className="h-2.5 w-2.5" />
                            {corte}
                          </p>
                        )}
                        {detalhes && (ativos.length > 0 || passivos.length > 0) && (
                          <div className="grid grid-cols-2 gap-3 pt-2 mt-1 border-t border-slate-200/70">
                            {ativos.length > 0 && (
                              <div>
                                <p className="text-[9px] font-bold text-blue-700 mb-1 tracking-wider">POLO ATIVO</p>
                                {ativos.map((p: any, i: number) => (
                                  <p key={i} className="text-[11px] text-slate-700 truncate" title={p.name}>{p.name}</p>
                                ))}
                              </div>
                            )}
                            {passivos.length > 0 && (
                              <div>
                                <p className="text-[9px] font-bold text-rose-700 mb-1 tracking-wider">POLO PASSIVO</p>
                                {passivos.map((p: any, i: number) => (
                                  <p key={i} className="text-[11px] text-slate-700 truncate" title={p.name}>{p.name}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {advogados.length > 0 && (
                          <div className="pt-1.5 mt-1 border-t border-slate-200/70">
                            <p className="text-[9px] font-bold text-violet-700 mb-0.5 tracking-wider">ADVOGADOS</p>
                            <p className="text-[10.5px] text-slate-600 truncate">{advogados.join(" · ")}</p>
                          </div>
                        )}
                        {/* Timeline de movimentações (quando detalhes carregados) */}
                        {detalhes?.steps && detalhes.steps.length > 0 && (
                          <div className="pt-2 mt-1 border-t border-slate-200/70">
                            <p className="text-[9px] font-bold text-indigo-700 mb-1.5 tracking-wider">
                              MOVIMENTAÇÕES ({detalhes.steps.length})
                            </p>
                            <div className="relative space-y-2 max-h-52 overflow-y-auto pl-3">
                              <div className="absolute left-1 top-1 bottom-1 w-px bg-indigo-200" />
                              {detalhes.steps.slice(0, 10).map((s: any, i: number) => (
                                <div key={i} className="relative">
                                  <div className="absolute -left-[9px] top-1 h-1.5 w-1.5 rounded-full bg-indigo-400 ring-2 ring-white" />
                                  <div className="text-[10.5px] pl-2">
                                    {s.step_date && (
                                      <span className="text-[9.5px] text-slate-400 font-mono">
                                        {new Date(s.step_date).toLocaleDateString("pt-BR")}
                                      </span>
                                    )}
                                    <p className="text-slate-700 leading-snug">{s.content}</p>
                                  </div>
                                </div>
                              ))}
                              {detalhes.steps.length > 10 && (
                                <p className="text-[9.5px] text-slate-400 italic pl-2 mt-1">
                                  +{detalhes.steps.length - 10} movimentações mais antigas
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                        {!detalhes && (
                          <div className="pt-2 mt-1 border-t border-slate-200/70 flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-[10.5px] text-slate-500 italic">
                              Partes, advogados, assunto, valor e movimentações não carregados ainda.
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10.5px] rounded-lg border-indigo-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-indigo-700"
                              disabled={carregando || carregandoAcaoId !== null}
                              onClick={() => carregarDetalhes(a.id, a.cnj, credencialIdDoMonitor(a.monitoramentoId))}
                            >
                              {carregando ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
                              Carregar detalhes <span className="ml-1 text-[9.5px] text-indigo-500">1 cred</span>
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Ações — empilhadas à direita */}
                    <div className="flex flex-col gap-1 shrink-0">
                      {resolvido ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10.5px] rounded-lg text-slate-600"
                          title="Reabrir — volta pras Pendentes"
                          disabled={reabrirMut.isPending}
                          onClick={() => reabrirMut.mutate({ id: a.id })}
                        >
                          <RefreshCcw className="h-3 w-3 mr-1" />
                          Reabrir
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            className="h-7 text-[10.5px] rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-sm"
                            title="Monitorar movimentações deste processo (2 cred/mês) — resolve o card"
                            disabled={monitorarMut.isPending || resolverMut.isPending}
                            onClick={() => handleMonitorarAcao(a)}
                          >
                            {monitorarMut.isPending && monitorarMut.variables?.numeroCnj === a.cnj
                              ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              : <Radar className="h-3 w-3 mr-1" />}
                            Monitorar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[10.5px] rounded-lg text-slate-600 hover:bg-slate-100"
                            title="Ciente — você viu, mas não precisa monitorar agora"
                            disabled={resolverMut.isPending}
                            onClick={() => resolverMut.mutate({ id: a.id, resolucao: "lida" })}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Ciente
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[10.5px] rounded-lg text-rose-600 hover:bg-rose-50"
                            title="Falso positivo (reversível — vai pras Resolvidas)"
                            disabled={resolverMut.isPending}
                            onClick={() => handleFalsoAcao(a.id)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Falso
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isFetching}
                onClick={() => setCursor((c) => c + LIMITE_PAGINA)}
              >
                {isFetching ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                Carregar mais
              </Button>
            </div>
          )}
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
                      <p className="text-sm font-medium truncate" title={c.nome}>{c.nome}</p>
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
                      {c.apelido || c.usernameMascarado} ({c.sistema})
                    </option>
                  ))}
                </select>
                {credsAtivas.length === 0 && (
                  <p className="text-[10px] text-orange-600 mt-1">
                    Sem credenciais ativas. Cadastre uma na aba "Cofre de Credenciais" primeiro.
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
                  tipo,
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

      <AlertDialog open={!!deletarMonTarget} onOpenChange={(open) => !open && setDeletarMonTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Parar de monitorar {deletarMonTarget?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Você deixará de ser avisado sobre novas ações distribuídas contra
              este cliente, e a <strong>cobrança mensal recorrente</strong> será
              interrompida imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletarMonMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deletarMonTarget) deletarMonMut.mutate({ id: deletarMonTarget.id });
              }}
              disabled={deletarMonMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletarMonMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Parar monitoramento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: COFRE DE CREDENCIAIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A grade de estados de uma credencial nacional.
 *
 * Componente próprio porque cada credencial busca a sua — e porque testar um
 * estado é um login real, que demora dezenas de segundos e não pode bloquear
 * a lista inteira.
 */
function GradeDaCredencial({ credencialId }: { credencialId: number }) {
  const q = (trpc.cofreCredenciais as any).tribunaisDaCredencial?.useQuery({ id: credencialId }) ?? {
    data: undefined,
  };
  const [testando, setTestando] = useState<string | null>(null);

  const validar = (trpc.cofreCredenciais as any).validarMinha?.useMutation({
    onSuccess: (r: any) => {
      setTestando(null);
      q.refetch?.();
      if (r?.ok) toast.success(`${String(r.tribunal ?? "").toUpperCase()}: login funcionou`);
      else toast.error(`${String(r?.tribunal ?? "").toUpperCase()}: ${r?.mensagem ?? "login falhou"}`);
    },
    onError: (e: any) => {
      setTestando(null);
      toast.error(e.message);
    },
  }) ?? { mutate: () => {} };

  if (!q.data) return null;
  return (
    <GradeTribunais
      tribunais={q.data.tribunais}
      testando={testando}
      onTestar={(tribunal) => {
        setTestando(tribunal);
        validar.mutate({ id: credencialId, tribunal });
      }}
    />
  );
}

function CofreTab() {
  const { data: credenciais, refetch, isLoading } = trpc.cofreCredenciais.listarMinhas.useQuery();
  const { data: sistemas } = trpc.cofreCredenciais.listarMinhasSistemasSuportados?.useQuery() ?? { data: undefined };
  const estadosPje = ((sistemas ?? []) as any[]).filter((s) => !s.nacional);
  const nacionalDisponivel = ((sistemas ?? []) as any[]).some((s) => s.nacional);

  const [novoOpen, setNovoOpen] = useState(false);
  const [modo2fa, setModo2fa] = useState<"codigo" | "qr">("codigo");
  const [qrLido, setQrLido] = useState<{ secret: string; emissor: string | null; conta: string | null } | null>(null);
  const [form, setForm] = useState({
    apelido: "",
    sistema: "pje_tjce",
    username: "",
    password: "",
    totpSecret: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [show2fa, setShow2fa] = useState(false);
  const [removerTarget, setRemoverTarget] = useState<{ id: number; apelido: string } | null>(null);
  // Secret que o robô teve que criar porque o tribunal exigiu 2FA na hora do
  // login. Só existe nesta resposta — o cofre não devolve depois.
  const [secretNovo, setSecretNovo] = useState<string | null>(null);

  // Quantos processos monitorados dependem da credencial que está prestes a
  // sair, e quem pode assumir. Sem isto a remoção era um clique cego.
  // staleTime 0: o padrão do app é 60s, e servir um impacto de um minuto
  // atrás faria o diálogo prometer um destino que já não existe.
  const impacto = (trpc.cofreCredenciais as any).impactoRemocao?.useQuery(
    { id: removerTarget?.id ?? 0 },
    { enabled: !!removerTarget, staleTime: 0, refetchOnMount: "always" },
  ) ?? { data: undefined };
  const orfaos = (trpc.cofreCredenciais as any).vinculosOrfaos?.useQuery() ?? { data: undefined };
  // Reapontar move centenas de processos de uma vez. Executar isso no
  // `onChange` de um <select> seria a mesma classe de acidente que apaga uma
  // coluna inteira num clique: a escolha e a execução têm que ser dois atos.
  const [repontarAlvo, setRepontarAlvo] = useState<
    { de: number | null; para: number; total: number; destino: string } | null
  >(null);

  const repontarMut = (trpc.cofreCredenciais as any).repontarMonitoramentos?.useMutation({
    onSuccess: (r: any) => {
      toast.success(`${r.movidos} processo(s) agora usam "${r.destino}"`);
      orfaos.refetch?.();
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  }) ?? { mutate: () => {}, isPending: false };

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
      setForm({ apelido: "", sistema: "pje_tjce", username: "", password: "", totpSecret: "" });
      // O QR lido some junto com o formulário: deixá-lo pendurado faria o
      // próximo cadastro abrir já mostrando o código de outra credencial.
      setQrLido(null);
      setModo2fa("codigo");
      refetch();
    },
    onError: (e: any) => toast.error("Erro ao cadastrar", { description: e.message }),
  });

  const removerMut = trpc.cofreCredenciais.removerMinha.useMutation({
    onSuccess: (r: any) => {
      // O que aconteceu com os processos é a parte que importa da remoção —
      // dizer só "credencial removida" escondia exatamente o efeito colateral
      // que deixou 420 processos parados sem explicação.
      toast.success("Credencial removida", {
        description: r?.repontados
          ? `${r.repontados} processo(s) passaram para "${r.destino}".`
          : r?.pausados
            ? `${r.pausados} processo(s) foram pausados — cadastre outra credencial e reaponte.`
            : undefined,
      });
      setRemoverTarget(null);
      orfaos.refetch?.();
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Re-valida credencial fazendo login real no tribunal — usado quando
  // status fica preso em "validando" ou pra confirmar manualmente que o
  // login ainda funciona (senha pode ter mudado, conta pode ter caído).
  const validarMut = trpc.cofreCredenciais.validarMinha?.useMutation({
    onSuccess: (data: any) => {
      // Antes de qualquer toast: se o tribunal obrigou a configurar 2FA, este
      // é o único instante em que o segredo da conta do advogado existe fora
      // do banco. Toast some sozinho; isto não pode sumir sozinho.
      if (data?.totpSecretNovo) setSecretNovo(data.totpSecretNovo);
      if (data?.status === "ativa") {
        toast.success("Credencial válida!", { description: data.mensagem || "Login confirmado." });
      } else if (data?.status === "erro") {
        toast.error("Credencial inválida", { description: data.mensagem || "Login falhou." });
      } else {
        toast.info("Validação em andamento", { description: data?.mensagem });
      }
      refetch();
    },
    onError: (e: any) => toast.error("Erro ao validar", { description: e.message }),
  }) ?? { mutate: () => {}, isPending: false };

  const creds = credenciais || [];

  const listaOrfaos: any[] = orfaos.data ?? [];

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-violet-200/60 bg-gradient-to-br from-violet-50 via-purple-50/50 to-fuchsia-50/30 p-5 shadow-[0_1px_2px_0_rgb(0,0,0,0.04)]">
        <div className="absolute -top-6 -right-6 h-32 w-32 rounded-full bg-violet-200/40 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center shrink-0 shadow-sm">
              <KeyRound className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 max-w-2xl">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-sm tracking-tight">Cofre de Credenciais de Advogado</p>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[9px] font-bold uppercase tracking-wider">
                  <ShieldCheck className="h-2.5 w-2.5" />
                  AES-256
                </span>
              </div>
              <p className="text-[11px] text-violet-900/75 mt-1 leading-relaxed">
                Cadastre o login OAB de um advogado pra acessar processos em <strong>segredo de justiça</strong>.
                As senhas ficam criptografadas e <strong>nunca</strong> são expostas após o cadastro — se precisar trocar, delete e cadastre nova.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="h-9 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-sm shrink-0"
            onClick={() => setNovoOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />Nova credencial
          </Button>
        </div>
      </div>

      {/* Processo monitorado guarda o ID da credencial. Quando ela é removida
          ou cai, o vínculo continua apontando pra ela e o robô para — e até
          aqui nenhuma tela mostrava esse vínculo, então o motivo da parada
          ficava invisível. */}
      {listaOrfaos.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                Processos apontando para credencial que não pode atender
              </p>
              <p className="text-[11px] text-amber-900/80 leading-relaxed mt-0.5">
                Eles continuam parados até serem reapontados para uma credencial ativa. Reapontar
                não altera nada no processo — só troca qual login o robô usa.
              </p>
            </div>
          </div>

          {listaOrfaos.map((o: any) => (
            <div
              key={String(o.credencialId)}
              className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-white border border-amber-200/70 p-3"
            >
              <div className="min-w-0 text-xs">
                <p className="font-medium truncate">
                  {o.total} processo(s) do {String(o.tribunal).toUpperCase()} →{" "}
                  {o.apelido ? `"${o.apelido}"` : "sem credencial"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {o.acao === "revalidar"
                    ? `credencial ${o.status} — costuma voltar sozinha; tente "Validar" antes de mover`
                    : o.status === "removida"
                      ? "credencial removida do cofre"
                      : "vínculo desfeito — escolha quem assume"}
                </p>
              </div>
              {/* Duas pendências diferentes. Credencial caída volta sozinha no
                  relogin, e oferecer "mover centenas de processos" ali empurra
                  o dono pro conserto mais caro. Só quem perdeu o vínculo de
                  verdade ganha o seletor. */}
              {o.acao === "reapontar" && (
                <div className="flex items-center gap-2">
                  <select
                    className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
                    defaultValue=""
                    onChange={(e) => {
                      const para = Number(e.target.value);
                      const destino = (o.destinos ?? []).find((c: any) => c.id === para);
                      e.currentTarget.value = "";
                      if (!para || !destino) return;
                      setRepontarAlvo({
                        de: o.credencialId,
                        para,
                        total: o.total,
                        destino: destino.apelido,
                      });
                    }}
                    disabled={repontarMut.isPending || (o.destinos ?? []).length === 0}
                  >
                    <option value="" disabled>
                      {(o.destinos ?? []).length === 0
                        ? `nenhuma credencial ativa do ${String(o.tribunal).toUpperCase()}`
                        : "reapontar para…"}
                    </option>
                    {(o.destinos ?? []).map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.apelido}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : creds.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-slate-50 to-violet-50/30 py-14 text-center space-y-2">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/10 flex items-center justify-center mx-auto mb-1">
            <Lock className="h-7 w-7 text-violet-500/70" />
          </div>
          <p className="font-semibold text-slate-700">Nenhuma credencial cadastrada</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Sem credenciais, você só consegue monitorar processos públicos. Pra acessar
            processos em segredo de justiça, cadastre o login de um advogado.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {creds.map((c: any) => {
            const statusInfo = c.status === "ativa"
              ? { dot: "bg-emerald-500", ring: "ring-emerald-500/20", label: "Ativa", labelColor: "bg-emerald-50 text-emerald-700 border-emerald-200", animated: true }
              : c.status === "erro"
                ? { dot: "bg-rose-500", ring: "ring-rose-500/20", label: "Erro", labelColor: "bg-rose-50 text-rose-700 border-rose-200", animated: false }
                : c.status === "expirada"
                  ? { dot: "bg-orange-500", ring: "ring-orange-500/20", label: "Expirada", labelColor: "bg-orange-50 text-orange-700 border-orange-200", animated: false }
                  : c.status === "validando"
                    ? { dot: "bg-blue-500", ring: "ring-blue-500/20", label: "Validando", labelColor: "bg-blue-50 text-blue-700 border-blue-200", animated: true }
                    : { dot: "bg-slate-400", ring: "ring-slate-400/20", label: c.status, labelColor: "bg-slate-100 text-slate-700 border-slate-200", animated: false };
            return (
              <div
                key={c.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_0_rgb(0,0,0,0.04)] hover:shadow-[0_4px_12px_-2px_rgb(0,0,0,0.06)] transition-all"
              >
                <div className="flex items-start gap-2.5">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shrink-0 shadow-sm">
                    <KeyRound className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold tracking-tight truncate" title={c.apelido || c.usernameMascarado}>
                      {c.apelido || c.usernameMascarado}
                    </p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium truncate" title={(c.sistema || c.systemName || "").toUpperCase()}>
                      {(c.sistema || c.systemName || "").toUpperCase()}
                    </p>
                  </div>
                  <div className="relative flex shrink-0">
                    {statusInfo.animated && (
                      <span className={`absolute inset-0 rounded-full ${statusInfo.dot} animate-ping opacity-30`} />
                    )}
                    <span className={`relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold border ${statusInfo.labelColor}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dot}`} />
                      {statusInfo.label}
                    </span>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <User className="h-3 w-3 text-slate-400" />
                    <span className="font-mono truncate" title={c.usernameMascarado}>{c.usernameMascarado}</span>
                  </div>
                  {(c.tem2fa || c.has2fa) && (
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200/70 text-violet-700 text-[10px] font-medium">
                      <ShieldAlert className="h-3 w-3" />
                      2FA ativado
                    </div>
                  )}
                  {/* Dois relógios, dois nomes. O card mostrava só o último
                      SUCESSO sob o rótulo "última validação" — credencial que
                      falhou hoje exibia a data do último acerto, semanas
                      atrás, logo acima da mensagem de erro. Parecia que tinha
                      validado bem naquele dia. */}
                  {c.ultimoLoginSucessoEm && (
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      <span>Último acesso com sucesso: {new Date(c.ultimoLoginSucessoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                    </div>
                  )}
                  {c.ultimoLoginTentativaEm && c.ultimoLoginTentativaEm !== c.ultimoLoginSucessoEm && (
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <RefreshCcw className="h-3 w-3 text-slate-400" />
                      <span>Última tentativa: {new Date(c.ultimoLoginTentativaEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                    </div>
                  )}
                  {c.sistema === SISTEMA_NACIONAL && (
                    <div className="pt-2 mt-1 border-t">
                      <GradeDaCredencial credencialId={c.id} />
                    </div>
                  )}
                  {(c.ultimoErro || c.mensagemErro) && (
                    <div className={`text-[10px] rounded-lg p-2 ${
                      c.status === "erro" || c.status === "expirada"
                        ? "bg-rose-50 border border-rose-200/60 text-rose-700"
                        : "bg-blue-50 border border-blue-200/60 text-blue-700"
                    }`}>
                      {c.ultimoErro || c.mensagemErro}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 pt-3 mt-3 border-t border-slate-100">
                  <Button
                    size="sm"
                    variant={c.status === "ativa" ? "outline" : "default"}
                    className={`h-7 text-xs rounded-lg ${
                      c.status === "ativa"
                        ? "border-slate-200 hover:border-slate-300"
                        : "flex-1 bg-gradient-to-br from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-sm animate-pulse"
                    }`}
                    onClick={() => validarMut.mutate({ id: c.id })}
                    disabled={validarMut.isPending}
                  >
                    <RefreshCcw className={`h-3 w-3 mr-1 ${validarMut.isPending ? "animate-spin" : ""}`} />
                    {c.status === "ativa" ? "Validar" : "Validar agora"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 ml-auto rounded-lg"
                    onClick={() => setRemoverTarget({ id: c.id, apelido: c.apelido || c.usernameMascarado || "credencial" })}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />Remover
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog de cadastro */}
      {/* Fechar sem cadastrar também limpa o QR: o código lido é de uma conta
          específica, e reaproveitá-lo no cadastro seguinte gravaria o 2FA de
          um advogado no login de outro. */}
      <Dialog
        open={novoOpen}
        onOpenChange={(v) => {
          setNovoOpen(v);
          if (!v) {
            setQrLido(null);
            setModo2fa("codigo");
          }
        }}
      >
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
                placeholder="Ex: Dr. João Silva - TJCE"
                value={form.apelido}
                onChange={(e) => setForm({ ...form, apelido: e.target.value })}
              />
            </div>
            {/* O login do PDPJ é nacional: o mesmo CPF/OAB entra em qualquer
                PJe. Sem essa escolha, monitorar processo de outro estado
                exigia cadastrar a mesma pessoa de novo — e a mesma senha
                acabava guardada uma vez por tribunal. */}
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2 dark:border-violet-900 dark:bg-violet-950/20">
              <Label>Onde essa credencial vale</Label>
              {[
                {
                  id: "um",
                  titulo: "Só um tribunal",
                  desc: "Um cadastro por estado.",
                },
                {
                  id: "todos",
                  titulo: `Todos os PJe${nacionalDisponivel ? ` — ${estadosPje.length} estados` : ""}`,
                  desc: "Mesmo login do PDPJ em qualquer tribunal com PJe. Um cadastro só.",
                },
              ].map((o) => {
                const ativo = (o.id === "todos") === (form.sistema === SISTEMA_NACIONAL);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        sistema: o.id === "todos" ? SISTEMA_NACIONAL : (estadosPje[0]?.id ?? "pje_tjce"),
                      })
                    }
                    className={`w-full text-left rounded-lg border p-2.5 transition ${
                      ativo ? "border-violet-300 bg-background shadow-sm" : "border-transparent"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`h-3.5 w-3.5 rounded-full border-2 mt-0.5 shrink-0 ${
                          ativo ? "border-violet-600 bg-violet-600 ring-2 ring-inset ring-background" : "border-slate-300"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className={`text-xs font-semibold ${ativo ? "text-violet-700 dark:text-violet-300" : ""}`}>
                          {o.titulo}
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{o.desc}</p>
                      </div>
                    </div>
                  </button>
                );
              })}

              {form.sistema !== SISTEMA_NACIONAL && (
                <Select value={form.sistema} onValueChange={(v) => setForm({ ...form, sistema: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {estadosPje.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Verificação em duas etapas (2FA)</Label>
                {/* Duas portas para o MESMO campo. O modo de digitar continua
                    inteiro: o print do QR falha com frequência (recorte
                    cortado, foto do monitor), e sem a saída manual a pessoa
                    fica sem caminho. */}
                <div className="inline-flex gap-0.5 bg-muted p-0.5 rounded-lg">
                  {(["codigo", "qr"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModo2fa(m)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition ${
                        modo2fa === m ? "bg-background shadow-sm text-violet-700" : "text-muted-foreground"
                      }`}
                    >
                      {m === "codigo" ? "Colar o código" : "Ler do print do QR"}
                    </button>
                  ))}
                </div>
              </div>

              {modo2fa === "codigo" ? (
                <>
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
                </>
              ) : (
                <LeitorQr
                  onLido={(r) => {
                    setForm((f) => ({ ...f, totpSecret: r.secret }));
                    setQrLido(r);
                  }}
                  lido={qrLido}
                  aoLimpar={() => {
                    setQrLido(null);
                    setForm((f) => ({ ...f, totpSecret: "" }));
                  }}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => cadastrarMut.mutate({ ...form, sistema: form.sistema as SistemaCofre })}
              disabled={
                !form.apelido || !form.sistema || !form.username || !form.password ||
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

      <AlertDialog open={!!removerTarget} onOpenChange={(open) => !open && setRemoverTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover credencial "{removerTarget?.apelido}"?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {impacto.data == null ? (
                "Conferindo quais processos dependem dela…"
              ) : impacto.data.monitoramentos === 0 ? (
                "Nenhum processo monitorado depende desta credencial."
              ) : impacto.data.destinoSugerido ? (
                <>
                  <strong>{impacto.data.monitoramentos} processo(s) monitorado(s)</strong> usam esta
                  credencial.{" "}
                  {impacto.data.vaoMudar > 0 && (
                    <>
                      {impacto.data.vaoMudar} passam para{" "}
                      <strong>{impacto.data.destinoSugerido.apelido}</strong> e continuam rodando.
                    </>
                  )}{" "}
                  {impacto.data.vaoPausar > 0 && (
                    <>
                      Os outros <strong>{impacto.data.vaoPausar}</strong> vão ser pausados — são de
                      outro tribunal, que essa credencial não atende.
                    </>
                  )}
                </>
              ) : (
                <>
                  <strong>{impacto.data.monitoramentos} processo(s) monitorado(s)</strong> dependem
                  dela, e não há outra credencial ativa de {impacto.data.sistema} para assumir.
                  Todos vão ser <strong>pausados</strong> até você cadastrar outra e reapontá-los.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removerMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={removerMut.isPending || impacto.isLoading}
              onClick={(e) => {
                e.preventDefault();
                if (removerTarget) {
                  removerMut.mutate({
                    id: removerTarget.id,
                    // Só confirma se o impacto REALMENTE apareceu na tela.
                    // Mandar `true` fixo anulava a trava do servidor: o
                    // clique viraria consentimento a um número que a pessoa
                    // pode nunca ter visto (query ainda carregando, ou falha).
                    confirmarPausarMonitoramentos: impacto.data != null,
                  });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removerMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* O tribunal exigiu configurar 2FA e o robô configurou pra conseguir
          entrar. Daqui pra frente o PJe vai pedir ESTE código também quando o
          advogado logar pelo navegador — e este é o único momento em que dá
          pra ver o segredo. Fechar sem copiar deixa a conta dele acessível
          só pelo robô. */}
      <AlertDialog open={!!repontarAlvo} onOpenChange={(open) => !open && setRepontarAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reapontar {repontarAlvo?.total} processo(s) para "{repontarAlvo?.destino}"?
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              Só muda qual login o robô usa para consultar esses processos. Nada é alterado no
              processo em si, e nenhuma movimentação já registrada se perde. Os que estavam parados
              por causa da credencial voltam a rodar na próxima varredura.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={repontarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!repontarAlvo) return;
                repontarMut.mutate({ de: repontarAlvo.de, para: repontarAlvo.para });
                setRepontarAlvo(null);
              }}
              disabled={repontarMut.isPending}
            >
              {repontarMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Reapontar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!secretNovo} onOpenChange={(open) => !open && setSecretNovo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>O tribunal exigiu configurar a verificação em duas etapas</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              Pra conseguir entrar, o robô configurou o 2FA desta conta no PJe. A partir
              de agora o portal vai pedir um código de 6 dígitos também quando você logar
              pelo navegador — e só quem tem a chave abaixo consegue gerar esse código.
              <strong> Cadastre ela no seu app autenticador antes de fechar:</strong> ela
              não aparece de novo em lugar nenhum.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="font-mono text-sm tracking-wider break-all select-all">{secretNovo}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Google Authenticator, Authy ou 1Password → adicionar conta → inserir chave manualmente.
          </p>

          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (secretNovo) navigator.clipboard?.writeText(secretNovo);
                toast.success("Chave copiada");
              }}
            >
              <Copy className="h-4 w-4 mr-1" />
              Copiar chave
            </Button>
            <AlertDialogAction onClick={() => setSecretNovo(null)}>
              Já cadastrei no meu app
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
