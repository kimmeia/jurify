/**
 * AdminRoboAuditor — painel do robô que varre o banco atrás de
 * inconsistência.
 *
 * Fase 1, shadow mode: toda regra só relata. A tela mostra o que a
 * correção FARIA, sem nenhum caminho pra executá-la — não existe procedure
 * de correção no backend, então não há botão a esconder aqui.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Play,
  ShieldAlert,
  Table2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

type Severidade = "critico" | "alto" | "medio" | "baixo";

const SEVERIDADE_LABEL: Record<Severidade, string> = {
  critico: "Crítico",
  alto: "Alto",
  medio: "Médio",
  baixo: "Baixo",
};

const SEVERIDADE_COR: Record<Severidade, string> = {
  critico: "text-red-600 bg-red-500/10 border-red-500/20",
  alto: "text-amber-600 bg-amber-500/10 border-amber-500/20",
  medio: "text-cyan-600 bg-cyan-500/10 border-cyan-500/20",
  baixo: "text-slate-500 bg-slate-500/10 border-slate-500/20",
};

const SEVERIDADE_PONTO: Record<Severidade, string> = {
  critico: "bg-red-500",
  alto: "bg-amber-500",
  medio: "bg-cyan-500",
  baixo: "bg-slate-300",
};

const NIVEL_TEXTO: Record<string, string> = {
  A: "Nível A — recálculo de valor derivado",
  B: "Nível B — correção exige decisão humana",
  C: "Nível C — nunca automático",
};

const DOMINIO_LABEL: Record<string, string> = {
  financeiro: "Financeiro",
  comissoes: "Comissões",
  multi_tenant: "Multi-tenant",
  motor: "Motor próprio",
  smartflow: "SmartFlow",
  kanban: "Kanban",
  permissoes: "Permissões",
  observabilidade: "Observabilidade",
};

export default function AdminRoboAuditor() {
  const regrasQuery = trpc.adminRoboAuditor.listarRegras.useQuery();
  const historicoQuery = trpc.adminRoboAuditor.historico.useQuery({ limite: 8 });
  const varrer = trpc.adminRoboAuditor.varrer.useMutation({
    onError: (e) => toast.error(e.message),
    onSuccess: () => historicoQuery.refetch(),
  });
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const resultado = varrer.data;
  const achados = useMemo(() => resultado?.achados ?? [], [resultado]);

  const achadoAtivo = useMemo(() => {
    if (achados.length === 0) return null;
    return achados.find((a) => a.regra.id === selecionado) ?? achados[0];
  }, [achados, selecionado]);

  const regras = regrasQuery.data?.regras ?? [];
  const resumo = resultado?.resumo;
  const varreduras = historicoQuery.data?.varreduras ?? [];
  const ultimaAutomatica = varreduras.find((v) => v.origem === "cron") ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Robô auditor</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            {regras.length > 0 ? `${regras.length} invariantes` : "Invariantes"} vigiando o banco.
            Cada uma é uma afirmação que precisa valer sempre — o robô devolve as linhas que a violam.
          </p>
        </div>
        <Button onClick={() => varrer.mutate({})} disabled={varrer.isPending}>
          <Play className="h-4 w-4 mr-2" />
          {varrer.isPending ? "Varrendo…" : "Rodar varredura"}
        </Button>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3">
        <Eye className="h-4 w-4 text-violet-600 mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Shadow mode.</span> Todas as regras estão em
          observação: o robô só relata. A correção fica descrita em cada achado, mas não existe
          caminho para executá-la — nem para as regras de nível A.
        </div>
      </div>

      <UltimaAutomatica varredura={ultimaAutomatica} carregando={historicoQuery.isLoading} />

      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile titulo="Regras executadas" valor={resumo.regrasExecutadas} />
          <Tile
            titulo="Invariantes violadas"
            valor={resumo.achados}
            cor={resumo.achados > 0 ? "text-amber-600" : "text-emerald-600"}
          />
          <Tile titulo="Linhas afetadas" valor={resumo.linhasAfetadas} />
          <Tile
            titulo="Regras com erro"
            valor={resumo.regrasComErro}
            cor={resumo.regrasComErro > 0 ? "text-red-600" : undefined}
          />
        </div>
      )}

      {varrer.isPending ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : resultado ? (
        <div className="grid lg:grid-cols-[380px_1fr] gap-4 items-start">
          <Card>
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <span className="font-semibold text-sm">Resultado da varredura</span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {resultado.latenciaMs} ms
                </span>
              </div>
              <ul>
                {achados.map((a) => {
                  const ativo = achadoAtivo?.regra.id === a.regra.id;
                  return (
                    <li key={a.regra.id}>
                      <button
                        type="button"
                        onClick={() => setSelecionado(a.regra.id)}
                        className={cn(
                          "w-full text-left px-4 py-3 border-b flex items-start gap-3 transition-colors",
                          ativo ? "bg-violet-500/5" : "hover:bg-muted/50",
                        )}
                      >
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full mt-1.5 shrink-0",
                            a.ok
                              ? "bg-emerald-500"
                              : SEVERIDADE_PONTO[a.regra.severidade as Severidade],
                          )}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium leading-snug">
                            {a.regra.titulo}
                          </span>
                          <span className="block text-xs text-muted-foreground mt-0.5">
                            {a.regra.id} · {a.regra.tabela}
                          </span>
                        </span>
                        <EstadoBadge ok={a.ok} erro={!!a.erro} total={a.total} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {achadoAtivo && <Detalhe achado={achadoAtivo} />}
        </div>
      ) : (
        <CatalogoInicial regras={regras} carregando={regrasQuery.isLoading} />
      )}
    </div>
  );
}

interface Varredura {
  runId: string;
  origem: "cron" | "manual";
  iniciadoEm: string;
  latenciaMs: number;
  regrasExecutadas: number;
  achados: number;
  linhasAfetadas: number;
  regrasComErro: number;
}

function tempoDecorrido(iso: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.round(horas / 24)} d`;
}

/**
 * A varredura do cron é o que responde "o robô está de pé?". Sem esta
 * faixa, painel de erros vazio era ambíguo: podia ser banco saudável ou
 * alerta que nunca saiu do processo.
 */
function UltimaAutomatica({
  varredura,
  carregando,
}: {
  varredura: Varredura | null;
  carregando: boolean;
}) {
  if (carregando) return <Skeleton className="h-12 w-full" />;

  if (!varredura) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <Clock className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Nenhuma varredura automática registrada.</span>{" "}
          O robô roda 2 min após a partida do servidor e de hora em hora. Se isso persistir depois de
          um deploy, o agendamento não está rodando.
        </div>
      </div>
    );
  }

  const limpo = varredura.achados === 0 && varredura.regrasComErro === 0;

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 flex-wrap">
      <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm">
        <span className="font-medium">Última varredura automática</span>{" "}
        <span className="text-muted-foreground">{tempoDecorrido(varredura.iniciadoEm)}</span>
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-sm text-muted-foreground">
        {varredura.regrasExecutadas} regras em {varredura.latenciaMs} ms
      </span>
      {limpo ? (
        <Badge variant="outline" className="text-emerald-600 bg-emerald-500/10 border-emerald-500/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Sem achados
        </Badge>
      ) : (
        <>
          <Badge variant="outline" className="text-amber-600 bg-amber-500/10 border-amber-500/20">
            {varredura.achados} {varredura.achados === 1 ? "invariante violada" : "invariantes violadas"} ·{" "}
            {varredura.linhasAfetadas} linhas
          </Badge>
          {varredura.regrasComErro > 0 && (
            <Badge variant="outline" className="text-red-600 bg-red-500/10 border-red-500/20">
              <XCircle className="h-3 w-3 mr-1" />
              {varredura.regrasComErro} regra(s) falhando
            </Badge>
          )}
        </>
      )}
      <span className="text-xs text-muted-foreground ml-auto font-mono">{varredura.runId}</span>
    </div>
  );
}

function Tile({ titulo, valor, cor }: { titulo: string; valor: number; cor?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={cn("text-2xl font-semibold", cor)}>{valor}</div>
        <div className="text-xs text-muted-foreground mt-1">{titulo}</div>
      </CardContent>
    </Card>
  );
}

function EstadoBadge({ ok, erro, total }: { ok: boolean; erro: boolean; total: number }) {
  if (erro) {
    return (
      <Badge variant="outline" className="text-red-600 bg-red-500/10 border-red-500/20 shrink-0">
        <XCircle className="h-3 w-3 mr-1" />
        Falhou
      </Badge>
    );
  }
  if (ok) {
    return (
      <Badge
        variant="outline"
        className="text-emerald-600 bg-emerald-500/10 border-emerald-500/20 shrink-0"
      >
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Limpo
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-amber-600 bg-amber-500/10 border-amber-500/20 shrink-0">
      {total} {total === 1 ? "linha" : "linhas"}
    </Badge>
  );
}

type Achado = NonNullable<
  ReturnType<typeof trpc.adminRoboAuditor.varrer.useMutation>["data"]
>["achados"][number];

function Detalhe({ achado }: { achado: Achado }) {
  const { regra, linhas, erro, ok, truncado } = achado;
  const severidade = regra.severidade as Severidade;
  const colunas = linhas.length > 0 ? Object.keys(linhas[0].valores) : [];

  return (
    <Card>
      <CardContent className="p-5 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Badge variant="outline" className={cn("mb-2", SEVERIDADE_COR[severidade])}>
              <AlertTriangle className="h-3 w-3 mr-1" />
              {SEVERIDADE_LABEL[severidade]}
            </Badge>
            <h2 className="text-lg font-semibold tracking-tight">{regra.titulo}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Regra <code className="font-medium">{regra.id}</code> · domínio{" "}
              {DOMINIO_LABEL[regra.dominio] ?? regra.dominio} · tabela{" "}
              <code className="font-medium">{regra.tabela}</code>
            </p>
          </div>
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-right">
            <div className="text-xs font-semibold text-violet-700 dark:text-violet-300">
              {NIVEL_TEXTO[regra.nivel] ?? regra.nivel}
            </div>
            {regra.shadow && (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Em shadow mode — só relata
              </div>
            )}
          </div>
        </div>

        <Secao titulo="A invariante afirma">
          <p className="text-sm text-muted-foreground leading-relaxed">{regra.invariante}</p>
        </Secao>

        <Secao titulo="Correção prevista (não executada)">
          <p className="text-sm text-muted-foreground leading-relaxed">{regra.correcaoPrevista}</p>
        </Secao>

        {erro ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-red-600">
              <ShieldAlert className="h-4 w-4" />A regra falhou ao executar
            </div>
            <p className="text-xs text-muted-foreground mt-2 font-mono break-all">{erro}</p>
            <p className="text-xs text-muted-foreground mt-2">
              Enquanto a regra falha, essa invariante não está sendo vigiada — o resultado não é
              “limpo”, é desconhecido.
            </p>
          </div>
        ) : ok ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Nenhuma linha viola essa invariante.
          </div>
        ) : (
          <Secao titulo={`Linhas em violação (${linhas.length}${truncado ? "+" : ""})`}>
            {truncado && (
              <p className="text-xs text-amber-600 mb-2">
                A consulta bateu no limite de linhas. Volume alto costuma ser bug de código, não dado
                sujo pontual.
              </p>
            )}
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="text-left font-medium text-[11px] uppercase tracking-wide text-muted-foreground px-3 py-2">
                      Linha
                    </th>
                    {colunas.map((c) => (
                      <th
                        key={c}
                        className="text-left font-medium text-[11px] uppercase tracking-wide text-muted-foreground px-3 py-2 whitespace-nowrap"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={`${l.alvoId}-${l.descricao}`} className="border-b last:border-0">
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">#{l.alvoId}</div>
                        <div className="text-xs text-muted-foreground">{l.descricao}</div>
                        {l.escritorioId !== null && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            escritório {l.escritorioId}
                          </div>
                        )}
                      </td>
                      {colunas.map((c) => (
                        <td
                          key={c}
                          className="px-3 py-2 align-top whitespace-nowrap text-muted-foreground"
                        >
                          {formatarValor(l.valores[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Secao>
        )}
      </CardContent>
    </Card>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
        {titulo}
      </div>
      {children}
    </div>
  );
}

function formatarValor(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function CatalogoInicial({
  regras,
  carregando,
}: {
  regras: Array<{
    id: string;
    titulo: string;
    severidade: string;
    tabela: string;
    nivel: string;
    invariante: string;
  }>;
  carregando: boolean;
}) {
  if (carregando) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Table2 className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Invariantes cadastradas</span>
          <span className="text-xs text-muted-foreground ml-auto">
            Rode a varredura para ver o estado atual do banco
          </span>
        </div>
        <ul>
          {regras.map((r) => (
            <li key={r.id} className="px-4 py-3 border-b last:border-0 flex items-start gap-3">
              <span
                className={cn(
                  "h-2 w-2 rounded-full mt-1.5 shrink-0",
                  SEVERIDADE_PONTO[r.severidade as Severidade],
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{r.titulo}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {r.id} · {r.tabela} · {NIVEL_TEXTO[r.nivel] ?? r.nivel}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
