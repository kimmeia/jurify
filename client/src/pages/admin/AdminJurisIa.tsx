/**
 * Painel do robô de ingestão do DataJud.
 *
 * A varredura é disparada à mão de propósito nesta fase: a primeira coisa que
 * se quer saber de um robô novo é o que ele traz na primeira página, não
 * descobrir de madrugada que ele rodou sozinho a noite inteira contra uma API
 * pública.
 */

import { Fragment, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, FlaskConical, Play, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { naturezaDoGrau } from "@shared/jurisia-grau";
import JurisIaAssinantes from "./JurisIaAssinantes";

const STATUS: Record<string, { label: string; cls: string }> = {
  fila: { label: "na fila", cls: "text-slate-500 bg-slate-500/10 border-slate-500/20" },
  rodando: { label: "rodando", cls: "text-violet-600 bg-violet-500/10 border-violet-500/20" },
  completo: { label: "completo", cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
  erro: { label: "erro", cls: "text-red-600 bg-red-500/10 border-red-500/20" },
};

const nf = new Intl.NumberFormat("pt-BR");

const VEREDITO: Record<string, { rotulo: string; cls: string }> = {
  "responde-json": { rotulo: "JSON", cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
  "responde-html": { rotulo: "HTML", cls: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
  bloqueado: { rotulo: "bloqueado", cls: "text-red-600 bg-red-500/10 border-red-500/20" },
  vazio: { rotulo: "vazio", cls: "text-slate-500 bg-slate-500/10 border-slate-500/20" },
  erro: { rotulo: "erro", cls: "text-red-600 bg-red-500/10 border-red-500/20" },
};

const STATUS_TAREFA: Record<string, { label: string; cls: string }> = {
  fila: { label: "na fila", cls: "text-slate-500 bg-slate-500/10 border-slate-500/20" },
  rodando: { label: "rodando", cls: "text-violet-600 bg-violet-500/10 border-violet-500/20" },
  concluida: { label: "concluída", cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
  cancelada: { label: "cancelada", cls: "text-slate-500 bg-slate-500/10 border-slate-500/20" },
  erro: { label: "erro", cls: "text-red-600 bg-red-500/10 border-red-500/20" },
};

/**
 * "Quero N processos hoje" — e o robô persegue.
 *
 * Substitui o clique repetido em Varrer. O worker avança um pedaço a cada dois
 * minutos e grava; reiniciar o servidor custa um ciclo, não a meta inteira.
 */
function FilaIngestao({ tribunais }: { tribunais: Array<{ sigla: string; nome: string }> }) {
  const [meta, setMeta] = useState("5000");
  const [tribunal, setTribunal] = useState("");
  const utils = trpc.useUtils();

  // Enquanto há tarefa viva a tela se atualiza sozinha: um progresso que só
  // anda com F5 faz o operador achar que travou e criar outra tarefa.
  const { data: tarefas } = trpc.admin.jurisiaTarefas.useQuery(undefined, {
    refetchInterval: (q) =>
      (q.state.data ?? []).some((t: any) => t.status === "fila" || t.status === "rodando")
        ? 15_000
        : false,
  });

  const criar = trpc.admin.jurisiaCriarTarefa.useMutation({
    onSuccess: () => {
      utils.admin.jurisiaTarefas.invalidate();
      toast.success("Tarefa criada", {
        description: "O robô começa no próximo ciclo, em até 2 minutos.",
      });
    },
    onError: (e) => toast.error("Não deu pra criar", { description: e.message }),
  });

  const cancelar = trpc.admin.jurisiaCancelarTarefa.useMutation({
    onSuccess: () => {
      utils.admin.jurisiaTarefas.invalidate();
      toast.success("Tarefa cancelada");
    },
    onError: (e) => toast.error(e.message),
  });

  const lista = tarefas ?? [];
  const viva = lista.find((t: any) => t.status === "fila" || t.status === "rodando");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Fila de ingestão</CardTitle>
        <CardDescription>
          Diga quantos processos quer e saia da tela. O robô avança de pouco em pouco, a cada 2
          minutos, e continua de onde parou se o servidor reiniciar. Sem tribunal escolhido, ele
          ataca sempre o mais atrasado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
              Quantos processos
            </label>
            <Input
              value={meta}
              onChange={(e) => setMeta(e.target.value)}
              type="number"
              min={100}
              max={200000}
              step={100}
              className="h-9 w-32"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
              Tribunal
            </label>
            <select
              value={tribunal}
              onChange={(e) => setTribunal(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Todos — o mais atrasado primeiro</option>
              {tribunais.map((t) => (
                <option key={t.sigla} value={t.sigla}>
                  {t.sigla} — {t.nome}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            className="h-9"
            disabled={criar.isPending || !!viva}
            onClick={() =>
              criar.mutate({
                tribunal: tribunal || null,
                metaProcessos: Math.max(100, Number(meta) || 0),
              })
            }
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Criar tarefa
          </Button>
          {viva && (
            <span className="text-xs text-muted-foreground">
              Já existe uma tarefa em andamento — cancele antes de criar outra.
            </span>
          )}
        </div>

        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa ainda.</p>
        ) : (
          <div className="space-y-2">
            {lista.slice(0, 6).map((t: any) => {
              const st = STATUS_TAREFA[t.status] ?? STATUS_TAREFA.fila;
              const pct = Math.min(
                100,
                Math.round((t.processos * 100) / Math.max(1, t.metaProcessos)),
              );
              return (
                <div key={t.id} className="rounded-lg border px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.cls}`}
                    >
                      {st.label}
                    </span>
                    <span className="text-[13px] font-semibold">
                      {t.tribunal ?? "Todos os tribunais"}
                    </span>
                    {/* Novos e gravações são números diferentes: o robô relê
                        processo conhecido pra atualizar movimento, e é o de
                        novos que a meta persegue. */}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {nf.format(t.processos)} de {nf.format(t.metaProcessos)} novos ·{" "}
                      {t.paginas} página(s)
                      {t.gravacoes > t.processos && (
                        <> · {nf.format(t.gravacoes)} gravações</>
                      )}
                    </span>
                    {(t.status === "fila" || t.status === "rodando") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-7 text-xs"
                        disabled={cancelar.isPending}
                        onClick={() => cancelar.mutate({ id: t.id })}
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-violet-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {/* O erro não mata a tarefa: um tribunal fora do ar é motivo
                      pra tentar outro no próximo ciclo, não pra desistir. */}
                  {t.ultimoErro && (
                    <p className="mt-1.5 text-[11px] text-red-600">{t.ultimoErro}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Recomeçar a ingestão do zero.
 *
 * Fica no fim da página de propósito — é a última coisa que se procura, e
 * ninguém topa com ela por acidente ao rolar atrás de outra coisa.
 *
 * A contagem aparece ANTES de confirmar porque "apagar o acervo" é abstrato e
 * "apagar 4.000 processos e 61.000 movimentos" é concreto. E a palavra digitada
 * não é teatro: o diálogo protege do clique errado, o texto protege do clique
 * confiante em cima do botão errado.
 */
function ZerarIngestao() {
  const [palavra, setPalavra] = useState("");
  const utils = trpc.useUtils();
  const { data: c } = trpc.admin.jurisiaContagemIngestao.useQuery();

  const zerar = trpc.admin.jurisiaZerarIngestao.useMutation({
    onSuccess: (r) => {
      setPalavra("");
      utils.admin.jurisiaVarreduras.invalidate();
      utils.admin.jurisiaNatureza.invalidate();
      utils.admin.jurisiaContagemIngestao.invalidate();
      toast.success("Acervo zerado", {
        description: `${nf.format(r.processos)} processo(s) e ${nf.format(r.movimentos)} movimento(s) apagados. A varredura recomeça do início.`,
      });
    },
    onError: (e) => toast.error("Não deu pra zerar", { description: e.message }),
  });

  const vazio = !c || c.processos + c.movimentos + c.tribunaisComEstado === 0;

  return (
    <Card className="border-red-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-red-600">
          <TriangleAlert className="h-4 w-4" />
          Recomeçar a ingestão do zero
        </CardTitle>
        <CardDescription>
          Apaga o acervo, os movimentos e os cursores dos tribunais. As pesquisas dos clientes e o
          consumo de cota <b>não são tocados</b> — apagar aquilo não faz a ingestão recomeçar, só
          destrói histórico e o número que sustenta a cobrança.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {c && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xl font-bold tabular-nums">{nf.format(c.processos)}</p>
              <p className="text-[11px] text-muted-foreground">processos</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{nf.format(c.movimentos)}</p>
              <p className="text-[11px] text-muted-foreground">movimentos</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{nf.format(c.tribunaisComEstado)}</p>
              <p className="text-[11px] text-muted-foreground">tribunais com cursor</p>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Na maioria dos casos zerar é desnecessário: o acervo tem índice único no CNJ e a
          gravação é upsert, então re-varrer já reescreve cada linha com os classificadores
          atuais. Zerar serve pra garantia de base limpa — processo que saiu do índice do CNJ
          nunca seria reescrito e ficaria para sempre.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={palavra}
            onChange={(e) => setPalavra(e.target.value.toUpperCase())}
            placeholder="digite ZERAR"
            className="h-9 w-40"
            disabled={vazio}
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={palavra !== "ZERAR" || zerar.isPending || vazio}
              >
                {zerar.isPending ? "Apagando…" : "Zerar acervo"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Apagar o acervo inteiro?</AlertDialogTitle>
                <AlertDialogDescription>
                  {c && (
                    <>
                      Vão embora {nf.format(c.processos)} processo(s) e{" "}
                      {nf.format(c.movimentos)} movimento(s), e os {nf.format(c.tribunaisComEstado)}{" "}
                      cursores voltam ao início.{" "}
                    </>
                  )}
                  Isso não tem desfazer — a base é reconstruída varrendo o DataJud de novo. As
                  pesquisas dos clientes e o consumo de cota continuam intactos.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => zerar.mutate({ confirmacao: "ZERAR" })}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  Apagar e recomeçar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {vazio && (
            <span className="text-xs text-muted-foreground">O acervo já está vazio.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Sondagem das fontes públicas.
 *
 * Existe porque a pergunta "o STJ responde?" só tem resposta útil quando é
 * feita da rede que o coletor vai usar. A amostra do corpo fica visível de
 * propósito: é dela que sai o formato real dos campos.
 */
function PainelSondagem() {
  const [termo, setTermo] = useState("dano moral");
  const [aberto, setAberto] = useState<number | null>(null);

  const sondar = trpc.admin.sondarFontesJuris.useMutation({
    onSuccess: (s) => {
      const json = s.resultados.filter((r) => r.veredito === "responde-json").length;
      toast.success(`${json} de ${s.resultados.length} responderam JSON`, {
        description: s.comEmenta.length
          ? `Com ementa aparente: ${s.comEmenta.join(", ")}`
          : "Nenhuma fonte trouxe ementa no payload.",
      });
    },
    onError: (e) => toast.error("Sondagem falhou", { description: e.message }),
  });

  const s = sondar.data;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Sondagem de fontes públicas</CardTitle>
          <CardDescription>
            Bate uma vez em cada fonte (STF, STJ, DJEN, LexML, DataJud) e conta o que voltou.
            Roda daqui, do servidor — que é a rede que o coletor vai usar.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="termo de busca"
            className="h-8 w-44"
          />
          <Button
            size="sm"
            onClick={() => sondar.mutate({ termo })}
            disabled={sondar.isPending}
          >
            <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
            {sondar.isPending ? "Sondando…" : "Sondar"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {sondar.isPending && (
          <p className="text-sm text-muted-foreground">
            Uma requisição por fonte, com pausa entre elas — leva cerca de 20 segundos.
          </p>
        )}

        {!sondar.isPending && !s && (
          <p className="text-sm text-muted-foreground">
            Nunca sondado. É o que decide se o coletor dos superiores é um cliente HTTP simples
            ou um projeto de scraping.
          </p>
        )}

        {s && (
          <div className="space-y-3">
            {s.bloqueioDeRede && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
                Quase tudo voltou 403 curto, de domínios diferentes. Isso é padrão de proxy
                bloqueando a saída deste servidor — não dos tribunais recusando.
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fonte</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="text-right">Tempo</TableHead>
                  <TableHead>Resposta</TableHead>
                  <TableHead>Ementa</TableHead>
                  <TableHead>Diagnóstico</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.resultados.map((r, i) => {
                  const v = VEREDITO[r.veredito] ?? VEREDITO.erro;
                  return (
                    <Fragment key={i}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setAberto(aberto === i ? null : i)}
                      >
                        <TableCell>
                          <p className="text-[13px] font-semibold">
                            {r.fonte} · {r.nome}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{r.pergunta}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.status ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.ms}ms
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${v.cls}`}
                          >
                            {v.rotulo}
                          </span>
                        </TableCell>
                        <TableCell>
                          {r.temEmenta === null ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : r.temEmenta ? (
                            <span className="text-xs font-semibold text-emerald-600">sim</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">não</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.retryNavegador === "passou" && (
                            <span className="text-xs font-semibold text-amber-600">
                              é o cabeçalho
                            </span>
                          )}
                          {r.retryNavegador === "persistiu" && (
                            <span className="text-xs font-semibold text-red-600">é o IP</span>
                          )}
                          {r.causa && (
                            <span className="text-xs font-semibold text-red-600">{r.causa}</span>
                          )}
                          {!r.retryNavegador && !r.causa && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {aberto === i && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/40">
                            {r.erro && (
                              <p className="mb-2 text-xs text-red-600">erro: {r.erro}</p>
                            )}
                            {r.forma && (
                              <p className="mb-2 text-xs">
                                <span className="font-semibold">forma:</span> {r.forma}
                              </p>
                            )}
                            {r.datajud && (
                              <div className="mb-2 rounded-lg border bg-background p-3 text-xs">
                                <p className="mb-1.5 font-semibold">Primeiro processo do índice</p>
                                <p>
                                  grau:{" "}
                                  <span
                                    className={
                                      r.datajud.grau
                                        ? "font-bold text-violet-600"
                                        : "text-muted-foreground"
                                    }
                                  >
                                    {r.datajud.grau ?? "(não veio)"}
                                  </span>{" "}
                                  · classe: {r.datajud.classe ?? "—"} · órgão:{" "}
                                  {r.datajud.orgao ?? "—"}
                                </p>
                                <p className="mt-1">
                                  {r.datajud.movimentos} movimento(s)
                                  {r.datajud.primeirosMovimentos.length > 0 && (
                                    <> — {r.datajud.primeirosMovimentos.join(" · ")}</>
                                  )}
                                </p>
                                <p className="mt-1 text-muted-foreground">
                                  campos: {r.datajud.campos.join(", ")}
                                </p>
                              </div>
                            )}
                            {r.vocabulario && (
                              <div className="mb-2 rounded-lg border bg-background p-3">
                                <p className="mb-2 text-xs font-semibold">
                                  Movimentos que existem de fato ({r.vocabulario.length})
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {r.vocabulario.map((m) => (
                                    <span
                                      key={m.nome}
                                      className="rounded-full border bg-muted/60 px-2 py-0.5 text-[11px]"
                                    >
                                      {m.nome}{" "}
                                      <span className="tabular-nums text-muted-foreground">
                                        {nf.format(m.quantidade)}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <pre className="max-h-72 overflow-auto rounded-lg border bg-background p-3 text-[11px] leading-relaxed">
                              {r.amostra || "(corpo vazio)"}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>

            <p className="text-[11px] text-muted-foreground">
              Clique numa linha pra ver o começo do corpo cru — é dele que sai o formato real
              dos campos. Copie o das que responderam JSON.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A composição do acervo por instância.
 *
 * O contador de processos diz que o robô trabalhou; este painel diz se o que
 * ele trouxe é vendável. Acervo grande e 100% de 1º grau é um produto que
 * promete jurisprudência e entrega estatística de vara.
 */
function PainelNatureza({
  dados,
}: {
  dados: {
    natureza: { jurisprudencia: number; estatistica: number; indefinido: number };
    graus: Array<{ grau: string | null; quantidade: number }>;
    classificacao?: {
      total: number;
      comDesfecho: number;
      comRecurso: number;
      semNada: number;
      porRecurso: Array<{ resultado: string; quantidade: number }>;
    };
  };
}) {
  const { jurisprudencia, estatistica, indefinido } = dados.natureza;
  const total = jurisprudencia + estatistica + indefinido;
  if (total === 0) return null;
  const pct = (q: number) => Math.round((q * 100) / total);
  const c = dados.classificacao;
  const pctDe = (q: number, base: number) => (base > 0 ? Math.round((q * 100) / base) : 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Composição por instância</CardTitle>
        <CardDescription>
          Só decisão de órgão colegiado é jurisprudência. Sentença de 1º grau prevê a vara, mas não
          fundamenta petição — e é isso que o cliente vê marcado na resposta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          {jurisprudencia > 0 && (
            <div className="bg-violet-500" style={{ width: `${pct(jurisprudencia)}%` }} />
          )}
          {estatistica > 0 && (
            <div className="bg-slate-400" style={{ width: `${pct(estatistica)}%` }} />
          )}
          {indefinido > 0 && (
            <div className="bg-muted-foreground/30" style={{ width: `${pct(indefinido)}%` }} />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xl font-bold tabular-nums text-violet-600">
              {nf.format(jurisprudencia)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              acórdãos ({pct(jurisprudencia)}%) — jurisprudência
            </p>
          </div>
          <div>
            <p className="text-xl font-bold tabular-nums">{nf.format(estatistica)}</p>
            <p className="text-[11px] text-muted-foreground">
              sentenças de 1º grau ({pct(estatistica)}%)
            </p>
          </div>
          <div>
            <p className="text-xl font-bold tabular-nums text-muted-foreground">
              {nf.format(indefinido)}
            </p>
            <p className="text-[11px] text-muted-foreground">sem grau reconhecido ({pct(indefinido)}%)</p>
          </div>
        </div>

        {jurisprudencia === 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
            O acervo não tem uma única decisão colegiada. Colete um alias de 2º grau antes de
            liberar o módulo para novos clientes.
          </p>
        )}

        {indefinido > 0 && (
          <div className="text-[11px] text-muted-foreground">
            <span className="font-semibold">Graus sem classificação:</span>{" "}
            {dados.graus
              .filter((g) => naturezaDoGrau(g.grau) === null)
              .slice(0, 8)
              .map((g) => `${g.grau ?? "(vazio)"} (${nf.format(g.quantidade)})`)
              .join(" · ")}
          </div>
        )}

        {/* A varredura pode gravar mil linhas com desfecho nulo em todas, e o
            contador de progresso continuaria dizendo "mil no acervo",
            satisfeito. Este bloco é o que denuncia isso — sem ele, calibragem
            quebrada só apareceria quando um cliente pesquisasse e recebesse
            um gráfico vazio. */}
        {c && c.total > 0 && (
          <div className="border-t pt-3">
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
              Quanto do acervo tem desfecho
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-lg font-bold tabular-nums">{nf.format(c.comDesfecho)}</p>
                <p className="text-[11px] text-muted-foreground">
                  desfecho de 1º grau ({pctDe(c.comDesfecho, c.total)}%)
                </p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums text-violet-600">
                  {nf.format(c.comRecurso)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  desfecho de recurso ({pctDe(c.comRecurso, c.total)}%)
                </p>
              </div>
              <div>
                <p
                  className={`text-lg font-bold tabular-nums ${
                    c.semNada > c.total / 2 ? "text-amber-600" : "text-muted-foreground"
                  }`}
                >
                  {nf.format(c.semNada)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  sem nenhum dos dois ({pctDe(c.semNada, c.total)}%)
                </p>
              </div>
            </div>

            {c.porRecurso.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {c.porRecurso.map((f) => (
                  <span
                    key={f.resultado}
                    className="rounded border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200"
                  >
                    {f.resultado.replace(/_/g, " ")}{" "}
                    <b className="tabular-nums">{nf.format(f.quantidade)}</b>
                  </span>
                ))}
              </div>
            )}

            {c.semNada > c.total / 2 && (
              <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
                Mais da metade do acervo entrou sem desfecho. Rode a Amostra no tribunal que mais
                pesa e veja em "último movimento dos não classificados" qual nome a regra não
                cobre.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminJurisIa() {
  const [paginas, setPaginas] = useState("5");
  const [rodando, setRodando] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.admin.jurisiaVarreduras.useQuery();
  const { data: natureza } = trpc.admin.jurisiaNatureza.useQuery();

  const varrer = trpc.admin.jurisiaVarrer.useMutation({
    onSuccess: (r) => {
      utils.admin.jurisiaVarreduras.invalidate();
      utils.admin.jurisiaNatureza.invalidate();
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
  const totalGravacoes = linhas.reduce((s, l) => s + l.gravacoes, 0);
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

      <PainelSondagem />

      {natureza && <PainelNatureza dados={natureza} />}

      <JurisIaAssinantes />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
              No acervo
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{nf.format(totalProcessos)}</p>
            {/* Linhas distintas — é este o número que o cliente vê na tela dele.
                O contador da varredura conta gravações, e upsert reconta. */}
            <p className="text-[11px] text-muted-foreground">
              processos distintos
              {totalGravacoes > totalProcessos && (
                <> · {nf.format(totalGravacoes)} gravações</>
              )}
            </p>
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

      <FilaIngestao tribunais={linhas.map((l) => ({ sigla: l.sigla, nome: l.nome }))} />

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
                  <TableHead className="text-right">No acervo</TableHead>
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
                        {/* A data ao lado não é enfeite: erro sem data se lê
                            como problema de agora. Um 400 de semanas atrás,
                            de código que já foi corrigido, me fez concluir
                            que o bug tinha voltado. */}
                        {l.ultimoErro && (
                          <div className="mt-0.5 flex items-start gap-1 text-[11px] text-red-600">
                            <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                            <p className="min-w-0">
                              {l.ultimaExecucao && (
                                <span className="mr-1 font-semibold">
                                  {new Date(l.ultimaExecucao).toLocaleDateString("pt-BR")}:
                                </span>
                              )}
                              {l.ultimoErro}
                            </p>
                          </div>
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

      <ZerarIngestao />
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
  const rec = dados.porRecurso ?? {};
  const recursos = Object.values(rec).reduce((s: number, n) => s + Number(n), 0) as number;

  return (
    <Card className="border-violet-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-violet-600" />
          Amostra — nada foi gravado
        </CardTitle>
        <CardDescription>
          {nf.format(dados.lidos)} lidos
          {dados.total != null && (
            <>
              {" "}de {nf.format(dados.total)}
              {/* O ES para de contar em 10.000 e avisa em `relation`.
                  Mostrar "~10.000" fazia um tribunal de milhões parecer
                  quase varrido. */}
              {dados.totalEhMinimo ? "+" : ""} no índice
            </>
          )} ·{" "}
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

        {/* Instância superior não fala "procedência". Se este bloco vier
            zerado num tribunal de recurso, a varredura ingeriria acórdão sem
            desfecho nenhum — é a conferência que vale antes de varrer. */}
        {recursos > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
              Desfecho do recurso ({nf.format(recursos)} de {nf.format(dados.aceitos)})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(rec)
                .filter(([, v]) => Number(v) > 0)
                .map(([k, v]) => (
                  <span
                    key={k}
                    className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200"
                  >
                    {k.replace(/_/g, " ")}{" "}
                    <b className="tabular-nums">{nf.format(Number(v))}</b>
                  </span>
                ))}
            </div>
          </div>
        )}

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
