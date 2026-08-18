/**
 * Painel do robô de jornada.
 *
 * O robô navega o app como usuário e relata o que só o navegador vê — tela
 * que não abre, exceção de JS, 5xx, spinner eterno. Ele já existia; o que
 * faltava era um jeito de rodar sem terminal, e um lugar onde o resultado
 * sobrevivesse ao console de quem executou.
 *
 * A varredura leva minutos, então o clique não espera: ele abre a execução e
 * a tela acompanha pelo histórico, que recarrega sozinho enquanto houver algo
 * rodando. Mostrar "aguarde" por cinco minutos sem sinal nenhum é como um
 * botão quebrado se parece.
 */

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Route as RouteIcon,
  ShieldCheck,
  Trash2,
} from "lucide-react";

function duracao(ms: number | null): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function quando(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function AdminRoboJornada() {
  const [rodandoLocal, setRodandoLocal] = useState(false);

  const catalogo = trpc.adminJornada.catalogo.useQuery();
  const historico = trpc.adminJornada.historico.useQuery(
    { limite: 10 },
    {
      // Enquanto houver execução de pé, a tela se atualiza sozinha. É o que
      // dá sinal de vida durante os minutos em que o robô está navegando.
      refetchInterval: (q) => (q.state.data?.emAndamento ? 5_000 : false),
    },
  );

  const rodar = trpc.adminJornada.rodar.useMutation({
    onSuccess: (r) => {
      toast.success("Varredura iniciada", {
        description: `Rodando contra ${r.baseUrl}. Leva alguns minutos — a lista abaixo se atualiza sozinha.`,
      });
      historico.refetch();
    },
    onError: (e) => toast.error("Não deu para iniciar", { description: e.message }),
    onSettled: () => setRodandoLocal(false),
  });

  const emAndamento = historico.data?.emAndamento || catalogo.data?.emAndamento || rodandoLocal;
  const varreduras = historico.data?.varreduras ?? [];

  // A linha nasce antes da execução terminar, com tudo zerado. Mostrar esses
  // zeros nos cartões diria "0 telas, escritório sobrou no banco" em vermelho
  // sobre uma varredura que mal começou — susto por nada. O último resultado
  // é a última linha que de fato terminou.
  const emVoo = varreduras.find((v) => v.status === "rodando");
  const ultima = varreduras.find((v) => v.status !== "rodando");
  const anteriores = varreduras.filter((v) => v !== emVoo && v !== ultima);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Robô de jornada</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Entra no sistema como usuário, percorre as telas e relata o que só o navegador vê.
          </p>
        </div>
        <Button
          onClick={() => {
            setRodandoLocal(true);
            rodar.mutate();
          }}
          disabled={emAndamento || rodar.isPending}
        >
          {emAndamento ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          {emAndamento ? "Rodando…" : "Rodar agora"}
        </Button>
      </div>

      {/* Onde ele entra e o que não toca — a pergunta que vem antes de
          qualquer resultado é "isso mexe nos meus dados?". */}
      <Card className="border-violet-200 bg-violet-50/40">
        <CardContent className="pt-5 flex gap-3">
          <ShieldCheck className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
          <div className="text-[13px] text-violet-900 leading-relaxed">
            <p>
              O robô cria um <b>escritório descartável</b>, entra nele e apaga tudo no fim. Ele é
              um usuário comum de um escritório que só tem ele dentro — a parede é a mesma que
              separa um escritório do outro no dia a dia.
            </p>
            <p className="mt-1.5">
              Não clica no que apaga, cobra ou manda mensagem (
              <b>{catalogo.data?.acoesProibidas.length ?? 0} padrões bloqueados</b>), não abre o
              painel admin, e e-mail para conta de teste é barrado antes de sair.
            </p>
            {catalogo.data?.baseUrl && (
              <p className="mt-1.5 text-[12px] text-violet-700">
                Aponta para <code className="font-semibold">{catalogo.data.baseUrl}</code>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {emVoo && (
        <Card className="border-violet-300 bg-violet-50/60">
          <CardContent className="pt-5 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-violet-600 shrink-0" />
            <p className="text-[13px] text-violet-900">
              Varredura em andamento desde <b>{quando(emVoo.iniciadoEm)}</b>. Os números abaixo são
              da execução anterior até esta terminar.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Resumo da última */}
      {historico.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !ultima ? (
        <Card>
          <CardContent className="py-10 text-center">
            <RouteIcon className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-semibold mt-3">O robô ainda não rodou por aqui</p>
            <p className="text-xs text-muted-foreground mt-1">
              Clique em “Rodar agora”. A primeira execução leva alguns minutos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Última execução
              </p>
              <p className="text-lg font-bold mt-1">{quando(ultima.iniciadoEm)}</p>
              <p className="text-[11px] text-muted-foreground">
                {ultima.origem === "cron" ? "automática" : "manual"} · {duracao(ultima.duracaoMs)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Telas percorridas
              </p>
              <p className="text-2xl font-bold mt-1 tabular-nums">{ultima.rotasVisitadas}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Telas com achado
              </p>
              <p
                className={`text-2xl font-bold mt-1 tabular-nums ${
                  ultima.rotasComAchado > 0 ? "text-rose-600" : "text-emerald-600"
                }`}
              >
                {ultima.rotasComAchado}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Escritório de teste
              </p>
              <p
                className={`text-sm font-bold mt-1 flex items-center gap-1.5 ${
                  ultima.escritorioLimpo ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {ultima.escritorioLimpo ? (
                  <>
                    <Trash2 className="h-4 w-4" /> apagado
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4" /> sobrou no banco
                  </>
                )}
              </p>
              {!ultima.escritorioLimpo && (
                <p className="text-[11px] text-rose-600 mt-0.5">
                  A regra ROB-01 do auditor também acusa.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Achados da última — o que interessa depois do resumo */}
      {ultima && ultima.rotasComProblema.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm font-bold mb-3">O que quebrou na última execução</p>
            <div className="space-y-2">
              {ultima.rotasComProblema.map((r) => (
                <div key={r.rota} className="rounded-lg border border-rose-200 bg-rose-50/60 p-3">
                  <code className="text-[12.5px] font-bold text-rose-900">{r.rota}</code>
                  <ul className="mt-1.5 space-y-1">
                    {r.problemas.map((p, i) => (
                      <li key={i} className="text-[11.5px] text-rose-800 leading-snug">
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tempo por tela — o que separa "verde" de "verde de verdade" */}
      {ultima && ultima.tempos.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm font-bold">Quanto cada tela levou</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">
              Uma varredura em que tudo passa instantaneamente e nenhuma tela mostra esqueleto não
              é um resultado sobre o app — é um resultado sobre o robô.
            </p>
            <div className="flex flex-wrap gap-3 mb-3 text-[11.5px]">
              <span className="rounded-md bg-muted px-2 py-1">
                <b>{ultima.tempos.filter((t) => t.viuEsqueleto).length}</b> de {ultima.tempos.length}{" "}
                mostraram esqueleto
              </span>
              <span className="rounded-md bg-muted px-2 py-1">
                <b>{ultima.tempos.filter((t) => t.montadoNoDCL).length}</b> já estavam montadas
                quando ele olhou
              </span>
              <span className="rounded-md bg-muted px-2 py-1">
                mais lenta: <b>{Math.max(...ultima.tempos.map((t) => t.ms))}ms</b>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="font-semibold pb-1.5">tela</th>
                    <th className="font-semibold pb-1.5 text-right tabular-nums">montar</th>
                    <th className="font-semibold pb-1.5 text-right tabular-nums">esqueleto</th>
                    <th className="font-semibold pb-1.5 text-right tabular-nums">total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ultima.tempos.map((t) => (
                    <tr key={t.rota}>
                      <td className="py-1">
                        <code>{t.rota}</code>
                      </td>
                      <td className="py-1 text-right tabular-nums text-muted-foreground">
                        {t.msMontagem}ms
                      </td>
                      <td className="py-1 text-right tabular-nums text-muted-foreground">
                        {t.viuEsqueleto ? `${t.msSpinner}ms` : "—"}
                      </td>
                      <td className="py-1 text-right tabular-nums font-semibold">{t.ms}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Conferências declaradas — o que o robô confere além de "abriu" */}
      {catalogo.data && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm font-bold">O que ele confere além de a tela abrir</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">
              Cria o dado, navega até ele e exige encontrar. Roda hoje pelo Playwright; entra
              nesta execução na próxima fatia.
            </p>
            <div className="space-y-2">
              {catalogo.data.conferencias.map((c) => (
                <div key={c.id} className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-[12.5px] font-semibold">{c.titulo}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{c.porque}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Histórico */}
      {anteriores.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm font-bold mb-3">Execuções anteriores</p>
            <div className="divide-y">
              {anteriores.map((v) => (
                <div key={v.runId} className="flex items-center gap-3 py-2">
                  {v.status === "rodando" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600 shrink-0" />
                  ) : v.status === "falhou" ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                  ) : v.rotasComAchado > 0 ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  )}
                  <span className="text-[12px] text-muted-foreground">{quando(v.iniciadoEm)}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {v.origem}
                  </Badge>
                  <span className="text-[11.5px]">
                    {v.rotasComAchado > 0
                      ? `${v.rotasComAchado} de ${v.rotasVisitadas} com achado`
                      : `${v.rotasVisitadas} telas, tudo limpo`}
                  </span>
                  {v.erro && (
                    <span className="text-[11px] text-rose-600 truncate max-w-[280px]" title={v.erro}>
                      {v.erro}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {duracao(v.duracaoMs)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
