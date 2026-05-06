/**
 * MotorProprioTeste — UI de teste manual do motor próprio de monitoramento.
 *
 * Acessível apenas em ambiente staging (gate no backend). Permite ao admin
 * testar consultas PJe contra tribunais reais (TRT-2, TRT-15) e validar
 * latência, qualidade da extração e robustez dos adapters durante o Spike.
 *
 * Fluxo:
 *   1. Seleciona tribunal no dropdown
 *   2. Cola CNJ (com ou sem máscara)
 *   3. Clica "Consultar" → backend chama adapter Playwright
 *   4. Resultado aparece com capa, partes, movimentações, latência
 *   5. Em caso de erro, mostra categoria + mensagem técnica
 *
 * Não persiste consultas — é só ferramenta de validação. Quando virar
 * Sprint 1, a página oficial mora em `/processos` e usa worker dedicado.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gavel,
  Loader2,
  Scale,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

const CATEGORIAS_ERRO_LABELS: Record<string, { label: string; descricao: string; cor: string }> = {
  cnj_nao_encontrado: {
    label: "CNJ não encontrado",
    descricao: "O tribunal respondeu mas o processo não foi localizado. Verifique se o CNJ está correto e pertence a este tribunal.",
    cor: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  },
  captcha_bloqueio: {
    label: "Captcha bloqueou",
    descricao: "Tribunal exigiu captcha que não foi resolvido. Em produção precisaremos de solver (2Captcha) ou sessão persistida.",
    cor: "bg-red-500/10 text-red-700 border-red-500/30",
  },
  timeout: {
    label: "Timeout",
    descricao: "Tribunal não respondeu no tempo esperado (25s). Pode ser pico de uso ou indisponibilidade momentânea.",
    cor: "bg-orange-500/10 text-orange-700 border-orange-500/30",
  },
  parse_falhou: {
    label: "Extração falhou",
    descricao: "Página carregou mas não conseguimos identificar os campos do processo. Possível mudança de HTML do tribunal — selectors precisam de ajuste.",
    cor: "bg-purple-500/10 text-purple-700 border-purple-500/30",
  },
  tribunal_indisponivel: {
    label: "Tribunal indisponível",
    descricao: "Erro de rede ou HTTP 5xx. Tribunal pode estar fora do ar.",
    cor: "bg-red-500/10 text-red-700 border-red-500/30",
  },
  outro: {
    label: "Erro inesperado",
    descricao: "Falha não categorizada. Veja a mensagem técnica abaixo e logs no Sentry.",
    cor: "bg-slate-500/10 text-slate-700 border-slate-500/30",
  },
};

function formatBRL(centavos: number | null | undefined): string {
  if (centavos == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function MotorProprioTeste() {
  const [tribunal, setTribunal] = useState<string>("trt2");
  const [cnj, setCnj] = useState("");
  const [resultado, setResultado] = useState<any>(null);

  const ambienteQuery = (trpc as any).motorProprioTeste.ambienteSuportaTeste.useQuery();
  const tribunaisQuery = (trpc as any).motorProprioTeste.tribunaisDisponiveis.useQuery();

  const consultarMut = (trpc as any).motorProprioTeste.testarCnj.useMutation({
    onSuccess: (data: any) => {
      setResultado(data);
      if (data.ok) {
        toast.success(`Consulta concluída em ${data.latenciaMs}ms`);
      } else {
        toast.error(`Falha: ${CATEGORIAS_ERRO_LABELS[data.categoriaErro || "outro"]?.label || "erro desconhecido"}`);
      }
    },
    onError: (err: any) => {
      toast.error(err.message);
      setResultado(null);
    },
  });

  const ambiente = ambienteQuery.data?.ambiente || "carregando...";
  const suportaTeste = ambienteQuery.data?.suportaTeste ?? false;

  const handleConsultar = () => {
    if (!cnj.trim()) {
      toast.error("Cole um CNJ pra consultar");
      return;
    }
    setResultado(null);
    consultarMut.mutate({ cnj: cnj.trim(), tribunal });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Scale className="h-6 w-6 text-blue-600" />
          Motor Próprio — Teste manual (Spike)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Valida adapters PJe contra tribunais reais. Resultado mostra capa, partes e movimentações
          extraídas + latência. Página disponível apenas em ambiente staging.
        </p>
      </div>

      <Alert className={suportaTeste ? "border-emerald-500/30 bg-emerald-50/30" : "border-red-500/30 bg-red-50/30"}>
        {suportaTeste ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-red-600" />
        )}
        <AlertTitle>
          Ambiente: <span className="font-mono">{ambiente}</span>
        </AlertTitle>
        <AlertDescription>
          {suportaTeste
            ? "Este ambiente permite consultas reais. As raspagens vão acessar o site público do tribunal."
            : "Este endpoint só funciona em staging. Em production retornará FORBIDDEN — o motor próprio ainda não foi promovido."}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova consulta</CardTitle>
          <CardDescription>
            Cole um CNJ válido (formato com máscara: 0001234-56.2024.5.02.0001).
            A consulta leva tipicamente 5-15 segundos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[200px_1fr_auto] items-end">
            <div className="space-y-2">
              <Label htmlFor="tribunal">Tribunal</Label>
              <Select value={tribunal} onValueChange={setTribunal}>
                <SelectTrigger id="tribunal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(tribunaisQuery.data ?? []).map((t: any) => (
                    <SelectItem key={t.codigo} value={t.codigo}>
                      <span className="font-mono uppercase">{t.codigo}</span>
                      <span className="ml-2 text-muted-foreground text-xs">{t.nome}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cnj">Número do processo (CNJ)</Label>
              <Input
                id="cnj"
                placeholder="0001234-56.2024.5.02.0001"
                value={cnj}
                onChange={(e) => setCnj(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !consultarMut.isPending) handleConsultar();
                }}
                className="font-mono"
              />
            </div>
            <Button
              onClick={handleConsultar}
              disabled={!suportaTeste || consultarMut.isPending || !cnj.trim()}
              className="min-w-[140px]"
            >
              {consultarMut.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Consultando…
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Consultar
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {consultarMut.isPending && <SkeletonResultado />}

      {resultado && !consultarMut.isPending && (
        <ResultadoCard resultado={resultado} />
      )}
    </div>
  );
}

function SkeletonResultado() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </CardContent>
    </Card>
  );
}

function ResultadoCard({ resultado }: { resultado: any }) {
  if (!resultado.ok) {
    const cat = CATEGORIAS_ERRO_LABELS[resultado.categoriaErro || "outro"];
    return (
      <Card className={`border ${cat.cor}`}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <XCircle className="h-5 w-5" />
            {cat.label}
          </CardTitle>
          <CardDescription>{cat.descricao}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span><strong>Tribunal:</strong> {resultado.tribunal.toUpperCase()}</span>
            <span><strong>CNJ:</strong> <span className="font-mono">{resultado.cnj}</span></span>
            <span><strong>Latência:</strong> {resultado.latenciaMs}ms</span>
          </div>
          {resultado.mensagemErro && (
            <div className="bg-background/50 border rounded p-3 font-mono text-xs whitespace-pre-wrap break-all">
              {resultado.mensagemErro}
            </div>
          )}
          {resultado.screenshotPath && (
            <p className="text-xs text-muted-foreground">
              Screenshot capturado em: <code>{resultado.screenshotPath}</code>
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const capa = resultado.capa;
  return (
    <div className="space-y-4">
      <Card className="border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-500/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Consulta concluída com sucesso
          </CardTitle>
          <CardDescription className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {resultado.latenciaMs}ms
            </span>
            <span>
              <strong>{resultado.movimentacoes.length}</strong> movimentações extraídas
            </span>
            <span>
              <strong>{capa?.partes?.length ?? 0}</strong> partes
            </span>
          </CardDescription>
        </CardHeader>
      </Card>

      {capa && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gavel className="h-4 w-4" />
              Capa do processo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 md:grid-cols-2 text-sm">
              <CapaItem label="CNJ" value={<span className="font-mono">{capa.cnj}</span>} />
              <CapaItem label="Classe" value={capa.classe} />
              <CapaItem label="Órgão Julgador" value={capa.orgaoJulgador} />
              <CapaItem label="UF" value={capa.uf} />
              <CapaItem label="Valor da Causa" value={formatBRL(capa.valorCausaCentavos)} />
              <CapaItem label="Distribuído em" value={formatDataHora(capa.dataDistribuicao)} />
              {capa.assuntos?.length > 0 && (
                <div className="md:col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Assuntos</dt>
                  <dd className="flex flex-wrap gap-1">
                    {capa.assuntos.map((a: string, i: number) => (
                      <Badge key={i} variant="secondary">{a}</Badge>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      {capa?.partes?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Partes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {capa.partes.map((parte: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-sm border-b pb-2 last:border-b-0">
                <Badge
                  variant="outline"
                  className={
                    parte.polo === "ativo"
                      ? "border-blue-500/40 text-blue-700"
                      : parte.polo === "passivo"
                      ? "border-purple-500/40 text-purple-700"
                      : ""
                  }
                >
                  {parte.polo}
                </Badge>
                <div className="flex-1">
                  <div className="font-medium">{parte.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {parte.tipo === "juridica" ? "Pessoa jurídica" : parte.tipo === "fisica" ? "Pessoa física" : "—"}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {resultado.movimentacoes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Movimentações ({resultado.movimentacoes.length})</CardTitle>
            <CardDescription>Em ordem cronológica decrescente (mais recente primeiro)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {resultado.movimentacoes.map((m: any, i: number) => (
                <div key={i} className="border-l-2 border-blue-500/40 pl-3 py-1">
                  <div className="text-xs text-muted-foreground font-mono">
                    {formatDataHora(m.data)}
                  </div>
                  <div className="text-sm mt-0.5">{m.texto}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CapaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  );
}
