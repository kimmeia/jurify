/**
 * AdminTribunais — auditoria de compatibilidade dos tribunais com o motor
 * próprio de scraping.
 *
 * Dispara, sob demanda, um GET não-autenticado na porta de entrada de cada
 * tribunal e reporta: se redireciona pro PDPJ-cloud SSO (= a credencial do
 * TJCE 1g já serve), a tecnologia (PJe/E-SAJ/...) e a versão provável do
 * PJe, com estimativa de reuso do adapter TJCE atual.
 *
 * Roda de fato em staging/produção (rede de saída liberada); o sandbox de
 * dev tem allowlist de hosts e devolve 403 em todos.
 */
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Radar, Play, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

const REUSO_COR: Record<string, string> = {
  BAIXO: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
  MÉDIO: "text-amber-600 bg-amber-500/10 border-amber-500/20",
  ALTO: "text-red-600 bg-red-500/10 border-red-500/20",
  "N/A": "text-slate-500 bg-slate-500/10 border-slate-500/20",
  INDETERMINADO: "text-slate-500 bg-slate-500/10 border-slate-500/20",
};

export default function AdminTribunais() {
  const auditar = trpc.adminTribunais.auditar.useMutation({
    onError: (e) => toast.error(e.message),
  });

  const data = auditar.data;
  const resumo = data?.resumo;
  const resultados = data?.resultados ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tribunais</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Varredura não-invasiva (sem credencial) da porta de entrada de cada
            tribunal: identifica quais usam o PDPJ-cloud SSO, a tecnologia e a
            versão provável do PJe, estimando o reuso do adapter TJCE atual.
          </p>
        </div>
        <Button onClick={() => auditar.mutate({})} disabled={auditar.isPending}>
          <Play className="h-4 w-4 mr-2" />
          {auditar.isPending ? "Auditando…" : "Rodar auditoria"}
        </Button>
      </div>

      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ResumoCard titulo="Tribunais auditados" valor={resumo.total} />
          <ResumoCard titulo="Usam PDPJ-cloud" valor={resumo.pdpjCloud} cor="text-emerald-600" />
          <ResumoCard titulo="Reuso BAIXO (PJe 1.x)" valor={resumo.reusoBaixo} cor="text-emerald-600" />
          <ResumoCard titulo="Falhas técnicas" valor={resumo.comErro} cor={resumo.comErro > 0 ? "text-red-600" : undefined} />
        </div>
      )}

      {auditar.isPending ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : resultados.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nenhuma auditoria executada ainda</CardTitle>
            <CardDescription>
              Clique em “Rodar auditoria”. Em ambiente de desenvolvimento os
              tribunais retornam 403 (allowlist do sandbox) — rode em staging
              ou produção pra resultado real.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tribunal</TableHead>
                  <TableHead className="w-[70px]">HTTP</TableHead>
                  <TableHead>Tecnologia</TableHead>
                  <TableHead>Versão provável</TableHead>
                  <TableHead className="w-[110px]">PDPJ-cloud</TableHead>
                  <TableHead className="w-[120px]">Reuso TJCE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultados.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium text-sm">{r.label}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate max-w-[280px]">
                        {r.urlFinal ?? r.urlInicial}
                      </div>
                      {r.erro && (
                        <div className="text-xs text-red-600 mt-0.5">{r.erro}</div>
                      )}
                      {r.observacoes
                        .filter((o) => !o.startsWith("Redirect:"))
                        .map((o, i) => (
                          <div key={i} className="text-xs text-muted-foreground mt-0.5">{o}</div>
                        ))}
                    </TableCell>
                    <TableCell>
                      <span className={`font-mono text-sm ${r.httpStatus && r.httpStatus >= 400 ? "text-red-600" : ""}`}>
                        {r.httpStatus ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{r.tecnologia}</TableCell>
                    <TableCell className="text-sm">{r.versaoProvavel}</TableCell>
                    <TableCell>
                      {r.usaPdpjCloud ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Sim
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                          <XCircle className="h-3.5 w-3.5" /> Não
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={REUSO_COR[r.reuso] ?? REUSO_COR.INDETERMINADO}>
                        {r.reuso}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data?.executadoEm && (
              <p className="text-xs text-muted-foreground mt-4">
                Executado em {new Date(data.executadoEm).toLocaleString("pt-BR")}
                {resumo ? ` · ${resumo.duracaoMs}ms` : ""}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResumoCard({ titulo, valor, cor }: { titulo: string; valor: number; cor?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{titulo}</div>
        <div className={`text-2xl font-bold mt-1 ${cor ?? ""}`}>{valor}</div>
      </CardContent>
    </Card>
  );
}
