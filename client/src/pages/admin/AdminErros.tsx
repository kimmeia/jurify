/**
 * AdminErros — módulo de monitoramento de erros do painel admin.
 *
 * Lê issues do Sentry via API REST (sem sair do app). Configuração mora
 * em /admin/integrations card "Sentry". Sem config = estado vazio com
 * CTA pra configurar.
 */

import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertCircle, AlertTriangle, ChevronLeft, ChevronRight, CheckCircle2,
  ExternalLink, Search, Bug, Settings,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const NIVEL_COR: Record<string, string> = {
  fatal: "text-red-600 bg-red-500/10",
  error: "text-red-600 bg-red-500/10",
  warning: "text-amber-600 bg-amber-500/10",
  info: "text-sky-600 bg-sky-500/10",
  debug: "text-slate-500 bg-slate-500/10",
};

const STATUS_LABEL: Record<string, string> = {
  unresolved: "Aberto",
  resolved: "Resolvido",
  ignored: "Ignorado",
};

export default function AdminErros() {
  const [status, setStatus] = useState<"unresolved" | "resolved" | "ignored" | "all">("unresolved");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const limite = 25;

  const { data, isLoading, refetch } = (trpc as any).adminErros.listar.useQuery({
    status, busca: busca || undefined, limite, pagina,
  }, { refetchOnWindowFocus: true });

  const resolverMut = (trpc as any).adminErros.resolver.useMutation({
    onSuccess: () => { toast.success("Issue marcada como resolvida"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const issues = data?.issues ?? [];
  const configurado = data?.configurado ?? true;
  const motivo = data?.motivo;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bug className="h-6 w-6 text-purple-600" />
          Erros
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Issues capturadas pelo Sentry no frontend e no backend.
        </p>
      </div>

      {!configurado && (
        <Card className="border-amber-500/30 bg-amber-50/30 dark:bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Sentry não configurado
            </CardTitle>
            <CardDescription>
              Configure o Sentry em Integrações pra começar a ver os erros aqui.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/integrations">
              <Button>
                <Settings className="h-4 w-4 mr-2" />
                Ir pra Integrações
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {configurado && (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap gap-3">
                <Select value={status} onValueChange={(v) => { setStatus(v as any); setPagina(1); }}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unresolved">Apenas abertos</SelectItem>
                    <SelectItem value="resolved">Resolvidos</SelectItem>
                    <SelectItem value="ignored">Ignorados</SelectItem>
                    <SelectItem value="all">Todos</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por título..."
                    value={busca}
                    onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
                    className="pl-9"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : issues.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {motivo === "timeout" ? "Sentry demorou mais de 10s pra responder. Tente novamente."
                    : motivo?.startsWith("sentry_http_") ? `Sentry retornou ${motivo.replace("sentry_http_", "HTTP ")}.`
                    : motivo === "erro_rede" ? "Erro de rede ao consultar Sentry."
                    : "Nenhum erro encontrado nos filtros atuais. Bom sinal."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {issues.map((issue: any) => (
                <Card key={issue.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 rounded-md ${NIVEL_COR[issue.nivel] || NIVEL_COR.error} mt-0.5`}>
                        <AlertCircle className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{issue.titulo}</p>
                            {issue.local && (
                              <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{issue.local}</p>
                            )}
                          </div>
                          <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                            {issue.shortId}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                          <span><b>{issue.ocorrencias}</b> ocorrência{issue.ocorrencias === 1 ? "" : "s"}</span>
                          <span><b>{issue.usuariosAfetados}</b> usuário{issue.usuariosAfetados === 1 ? "" : "s"}</span>
                          <span>Última: {formatDistanceToNow(new Date(issue.ultimoVisto), { addSuffix: true, locale: ptBR })}</span>
                          <Badge variant="secondary" className="text-[10px]">{STATUS_LABEL[issue.status] || issue.status}</Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                          <a href={issue.link} target="_blank" rel="noreferrer">
                            <Button variant="outline" size="sm" className="h-7 text-xs">
                              <ExternalLink className="h-3 w-3 mr-1.5" />
                              Abrir no Sentry
                            </Button>
                          </a>
                          {issue.status === "unresolved" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => resolverMut.mutate({ issueId: issue.id })}
                              disabled={resolverMut.isPending}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1.5" />
                              Marcar resolvido
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {issues.length >= limite && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={pagina === 1}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
              </Button>
              <span className="text-sm text-muted-foreground">Página {pagina}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPagina((p) => p + 1)}
                disabled={issues.length < limite}
              >
                Próxima <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
