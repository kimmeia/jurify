/**
 * Painel do robô de ingestão do DataJud.
 *
 * A varredura é disparada à mão de propósito nesta fase: a primeira coisa que
 * se quer saber de um robô novo é o que ele traz na primeira página, não
 * descobrir de madrugada que ele rodou sozinho a noite inteira contra uma API
 * pública.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, FlaskConical, Play, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

const STATUS: Record<string, { label: string; cls: string }> = {
  fila: { label: "na fila", cls: "text-slate-500 bg-slate-500/10 border-slate-500/20" },
  rodando: { label: "rodando", cls: "text-violet-600 bg-violet-500/10 border-violet-500/20" },
  completo: { label: "completo", cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
  erro: { label: "erro", cls: "text-red-600 bg-red-500/10 border-red-500/20" },
};

const nf = new Intl.NumberFormat("pt-BR");

export default function AdminJurisIa() {
  const [paginas, setPaginas] = useState("5");
  const [rodando, setRodando] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.admin.jurisiaVarreduras.useQuery();

  const varrer = trpc.admin.jurisiaVarrer.useMutation({
    onSuccess: (r) => {
      utils.admin.jurisiaVarreduras.invalidate();
      if (r.erro) {
        toast.error(`${r.tribunal} parou`, { description: r.erro });
        return;
      }
      toast.success(
        `${r.tribunal}: ${nf.format(r.processos)} processo(s) em ${r.paginas} página(s)`,
        {
          description: r.completo
            ? "Tribunal completo."
            : `${nf.format(r.sigilosos)} sigiloso(s) fora. Rode de novo pra continuar.`,
        },
      );
    },
    onError: (e) => toast.error("Varredura falhou", { description: e.message }),
    onSettled: () => setRodando(null),
  });

  const amostra = trpc.admin.jurisiaAmostra.useMutation({
    onError: (e) => toast.error("Amostra falhou", { description: e.message }),
  });

  const reiniciar = trpc.admin.jurisiaReiniciarTribunal.useMutation({
    onSuccess: () => {
      utils.admin.jurisiaVarreduras.invalidate();
      toast.success("Cursor zerado — o tribunal recomeça do início.");
    },
    onError: (e) => toast.error(e.message),
  });

  const linhas = data ?? [];
  const totalProcessos = linhas.reduce((s, l) => s + l.processos, 0);
  const totalSigilosos = linhas.reduce((s, l) => s + l.sigilosos, 0);
  const emAndamento = linhas.filter((l) => l.temCursor && l.status !== "completo").length;
  const completos = linhas.filter((l) => l.status === "completo").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Bot className="h-6 w-6 text-violet-600" />
          JurisIA — robô de ingestão
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Varredura do acervo público do CNJ (DataJud). Não usa a credencial OAB do escritório —
          o monitoramento de processos não corre risco.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
              No banco
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{nf.format(totalProcessos)}</p>
            <p className="text-[11px] text-muted-foreground">processos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
              Em andamento
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{emAndamento}</p>
            <p className="text-[11px] text-muted-foreground">tribunais com cursor</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
              Completos
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{completos}</p>
            <p className="text-[11px] text-muted-foreground">de {linhas.length} tribunais</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              Sigilosos barrados
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{nf.format(totalSigilosos)}</p>
            <p className="text-[11px] text-muted-foreground">não entraram no acervo</p>
          </CardContent>
        </Card>
      </div>

      {amostra.data && <ResultadoAmostra dados={amostra.data} />}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Tribunais</CardTitle>
            <CardDescription>
              Cada execução para no teto de páginas e grava o cursor — rodar de novo continua de
              onde parou.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="text-xs text-muted-foreground">Páginas por execução</label>
            <Input
              value={paginas}
              onChange={(e) => setPaginas(e.target.value)}
              type="number"
              min={1}
              max={200}
              className="h-8 w-20"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tribunal</TableHead>
                  <TableHead>Justiça</TableHead>
                  <TableHead className="text-right">Processos</TableHead>
                  <TableHead className="text-right">Sigilosos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => {
                  const st = STATUS[l.status] ?? STATUS.fila;
                  const ocupado = varrer.isPending && rodando === l.sigla;
                  return (
                    <TableRow key={l.sigla}>
                      <TableCell>
                        <p className="text-sm font-bold">{l.sigla}</p>
                        <p className="text-[11px] text-muted-foreground">{l.nome}</p>
                        {l.ultimoErro && (
                          <p className="mt-0.5 flex items-start gap-1 text-[11px] text-red-600">
                            <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                            {l.ultimoErro}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.justica}</TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                        {nf.format(l.processos)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {nf.format(l.sigilosos)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.cls}`}
                        >
                          {st.label}
                        </span>
                        {l.temCursor && l.status !== "completo" && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            retoma do cursor
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {l.temCursor && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Zerar o cursor e recomeçar do início"
                              disabled={reiniciar.isPending}
                              onClick={() => reiniciar.mutate({ tribunal: l.sigla })}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Ler uma página sem gravar nada"
                            disabled={amostra.isPending}
                            onClick={() => amostra.mutate({ alias: l.alias, tamanho: 50 })}
                          >
                            <FlaskConical className="mr-1 h-3.5 w-3.5" />
                            Amostra
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={varrer.isPending}
                            onClick={() => {
                              setRodando(l.sigla);
                              varrer.mutate({
                                tribunal: l.sigla,
                                alias: l.alias,
                                maxPaginas: Math.min(Math.max(parseInt(paginas, 10) || 5, 1), 200),
                              });
                            }}
                          >
                            <Play className="mr-1 h-3.5 w-3.5" />
                            {ocupado ? "Varrendo…" : "Varrer"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * O que a amostra devolveu.
 *
 * A lista de "não classificados" é o motivo deste bloco existir: são os nomes
 * do último movimento dos processos que ficaram sem resultado. Se a sentença
 * deste tribunal se chama algo que as regras não cobrem, ela aparece aqui — e
 * é assim que a classificação é calibrada com dado real em vez de palpite.
 */
function ResultadoAmostra({ dados }: { dados: any }) {
  const r = dados.porResultado ?? {};
  const classificados = Object.values(r).reduce((s: number, n) => s + Number(n), 0) as number;

  return (
    <Card className="border-violet-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-violet-600" />
          Amostra — nada foi gravado
        </CardTitle>
        <CardDescription>
          {nf.format(dados.lidos)} lidos
          {dados.total != null && <> de ~{nf.format(dados.total)} no índice</>} ·{" "}
          {nf.format(dados.aceitos)} aceitos · {nf.format(dados.sigilosos)} sigilosos ·{" "}
          {nf.format(dados.invalidos)} inválidos
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
            Desfecho ({nf.format(classificados)} de {nf.format(dados.aceitos)} classificados)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(r).map(([k, v]) => (
              <span key={k} className="rounded border bg-muted/50 px-2 py-1 text-xs">
                {k.replace(/_/g, " ")}{" "}
                <b className="tabular-nums">{nf.format(Number(v))}</b>
              </span>
            ))}
            <span className="rounded border bg-muted/50 px-2 py-1 text-xs">
              sem resultado <b className="tabular-nums">{nf.format(dados.semResultado)}</b>
            </span>
          </div>
        </div>

        {dados.naoClassificados?.length > 0 && (
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
              Último movimento dos não classificados
            </p>
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              Se a sentença deste tribunal aparece aqui, é sinal de que a regra precisa cobrir
              esse nome.
            </p>
            <div className="space-y-0.5">
              {dados.naoClassificados.map((n: any) => (
                <div key={n.nome} className="flex gap-2 text-xs">
                  <span className="w-8 shrink-0 text-right font-bold tabular-nums text-muted-foreground">
                    {n.vezes}
                  </span>
                  <span className="min-w-0 flex-1">{n.nome}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {dados.exemplos?.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
              Exemplos
            </p>
            <div className="space-y-1">
              {dados.exemplos.map((e: any) => (
                <div key={e.cnj} className="rounded border px-2 py-1.5 text-[11px]">
                  <p className="font-mono text-[10px] text-muted-foreground">{e.cnj}</p>
                  <p className="font-semibold">{e.classe ?? "— sem classe —"}</p>
                  <p className="text-muted-foreground">
                    {e.assunto ?? "— sem assunto —"} · {e.orgao ?? "— sem órgão —"} ·{" "}
                    {e.movimentos} movimento(s)
                    {e.resultado && (
                      <> · <b className="text-emerald-600">{e.resultado.replace(/_/g, " ")}</b> ({e.movimentoDecisivo})</>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
