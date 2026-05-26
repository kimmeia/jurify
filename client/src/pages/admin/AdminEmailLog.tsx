/**
 * AdminEmailLog — auditoria de envios de email via Resend (bug #6).
 *
 * Mostra histórico de TODOS os envios (sucesso/falha), com filtro e
 * detalhe pra debugar. Permite reenviar manualmente os que falharam —
 * útil quando o problema era reversível (domínio não verificado, quota).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertCircle, ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Mail, RotateCcw, Search,
} from "lucide-react";
import { KPICard } from "../dashboards/common";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const TIPO_LABEL: Record<string, string> = {
  boas_vindas: "Boas-vindas",
  redefinir_senha: "Redefinir senha",
  convite_colaborador: "Convite",
  outro: "Outro",
};

export default function AdminEmailLog() {
  const [statusFiltro, setStatusFiltro] = useState<"all" | "sucesso" | "falha">("all");
  const [tipoFiltro, setTipoFiltro] = useState<"all" | string>("all");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const limite = 50;

  const filtros = {
    status: statusFiltro === "all" ? undefined : statusFiltro,
    tipo: tipoFiltro === "all" ? undefined : tipoFiltro,
    destinatario: busca || undefined,
    limite,
    offset: (pagina - 1) * limite,
  };

  const { data, isLoading, refetch } = trpc.adminEmailLog.listar.useQuery(filtros, {
    refetchOnWindowFocus: true,
  });

  const { data: resumo } = trpc.adminEmailLog.resumo.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });

  const reenviarMut = trpc.adminEmailLog.reenviar.useMutation({
    onSuccess: (r: { sucesso: boolean; erro?: string }) => {
      if (r.sucesso) toast.success("Email reenviado com sucesso");
      else toast.error("Reenvio falhou", { description: r.erro });
      refetch();
    },
    onError: (e: any) => toast.error("Erro ao reenviar", { description: e.message }),
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const totalPaginas = Math.ceil(total / limite);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Log de Emails</h1>
        <p className="text-muted-foreground mt-1">
          Histórico de envios via Resend. Use pra auditar falhas e reenviar manualmente.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KPICard label="Enviados (24h)" value={resumo?.sucesso24h ?? "—"} icon={CheckCircle2} iconBg="bg-emerald-500/10" iconFg="text-emerald-600" valueColor="text-emerald-600" />
        <KPICard label="Falhas (24h)" value={resumo?.falha24h ?? "—"} icon={XCircle} iconBg="bg-rose-500/10" iconFg="text-rose-600" valueColor="text-rose-600" />
        <KPICard label="Total (24h)" value={resumo?.total24h ?? "—"} icon={Mail} iconBg="bg-slate-500/10" iconFg="text-slate-600" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar destinatário…"
                value={busca}
                onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
                className="pl-9"
              />
            </div>
            <Select value={statusFiltro} onValueChange={(v: any) => { setStatusFiltro(v); setPagina(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="sucesso">Sucesso</SelectItem>
                <SelectItem value="falha">Falha</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tipoFiltro} onValueChange={(v: any) => { setTipoFiltro(v); setPagina(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos tipos</SelectItem>
                <SelectItem value="boas_vindas">Boas-vindas</SelectItem>
                <SelectItem value="redefinir_senha">Redefinir senha</SelectItem>
                <SelectItem value="convite_colaborador">Convite</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}

          {!isLoading && itens.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              Nenhum envio encontrado com esses filtros.
            </div>
          )}

          {!isLoading && itens.map((item: any) => (
            <div
              key={item.id}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
            >
              {item.status === "sucesso" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {TIPO_LABEL[item.tipo] ?? item.tipo}
                  </Badge>
                  <span className="font-medium truncate">{item.destinatario}</span>
                  {item.tentativas > 1 && (
                    <Badge variant="secondary" className="text-xs">
                      {item.tentativas}ª tentativa
                    </Badge>
                  )}
                </div>
                <div className="text-sm text-muted-foreground truncate mt-0.5">
                  {item.assunto}
                </div>
                {item.erro && (
                  <div className="text-xs text-red-600 mt-1 truncate" title={item.erro}>
                    {item.erro}
                  </div>
                )}
              </div>

              <div className="text-xs text-muted-foreground shrink-0">
                {formatDistanceToNow(new Date(item.createdAt), { locale: ptBR, addSuffix: true })}
              </div>

              {item.status === "falha" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reenviarMut.mutate({ id: item.id })}
                  disabled={reenviarMut.isPending}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Reenviar
                </Button>
              )}
            </div>
          ))}

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between pt-4">
              <div className="text-sm text-muted-foreground">
                Página {pagina} de {totalPaginas} • {total} {total === 1 ? "registro" : "registros"}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagina <= 1}
                  onClick={() => setPagina(p => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagina >= totalPaginas}
                  onClick={() => setPagina(p => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
