/**
 * AdminManutencao — operações de dados que rodam uma vez só.
 *
 * A reconstrução do histórico de atendimentos precisava de terminal no
 * servidor, que o dono não tem. Aqui ela vira botão, com simulação antes:
 * ninguém deveria ter que apertar "aplicar" sem ver o tamanho do estrago
 * primeiro.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CheckCircle2, History, Loader2, Play, Search, Users } from "lucide-react";
import { toast } from "sonner";

interface Resultado {
  aplicado: boolean;
  conversasAnalisadas: number;
  episodiosCriados: number;
  conversasComMaisDeUm: number;
  conversasVazias: number;
  restantes: number;
  completo: boolean;
}

function Numero({ valor, rotulo, destaque }: { valor: number; rotulo: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${destaque ? "border-violet-500/30 bg-violet-500/5" : "border-slate-200 dark:border-slate-800"}`}>
      <p className={`text-xl font-semibold tabular-nums ${destaque ? "text-violet-600 dark:text-violet-400" : ""}`}>
        {valor.toLocaleString("pt-BR")}
      </p>
      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{rotulo}</p>
    </div>
  );
}

export default function AdminManutencao() {
  const utils = trpc.useUtils();
  const status = trpc.adminManutencao.statusEpisodios.useQuery();
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const aoFalhar = (err: { message: string }) => toast.error(`Falhou: ${err.message}`);

  const simular = trpc.adminManutencao.simularEpisodios.useMutation({
    onSuccess: (r) => {
      setResultado(r);
      toast.success("Simulação concluída — nada foi gravado.");
    },
    onError: aoFalhar,
  });

  const aplicar = trpc.adminManutencao.reconstruirEpisodios.useMutation({
    onSuccess: (r) => {
      setResultado(r);
      utils.adminManutencao.statusEpisodios.invalidate();
      toast.success(
        r.completo
          ? `Pronto: ${r.episodiosCriados.toLocaleString("pt-BR")} atendimentos reconstruídos.`
          : `${r.episodiosCriados.toLocaleString("pt-BR")} criados. Ainda faltam ${r.restantes.toLocaleString("pt-BR")} conversas — clique de novo.`,
      );
    },
    onError: aoFalhar,
  });

  const rodando = simular.isPending || aplicar.isPending;
  const s = status.data;
  const feito = s ? s.totalConversas - s.conversasSemEpisodio : 0;
  const pct = s && s.totalConversas > 0 ? Math.round((feito / s.totalConversas) * 100) : 0;
  const pendente = (s?.conversasSemEpisodio ?? 0) > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Reconstruir o histórico de atendimentos
          </CardTitle>
          <CardDescription className="leading-relaxed">
            No WhatsApp a conversa com uma pessoa é uma só, criada no primeiro contato e
            reaproveitada pra sempre. Quem falou com um SDR em março e voltou em agosto pra
            falar de outro assunto continuava contando como março, no nome de quem pegou a
            conversa por último. Isto separa os dois: cada atendimento passa a ter data e dono
            próprios. <strong>Só mexe no passado</strong> — dos novos o sistema já cuida sozinho.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {status.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {feito.toLocaleString("pt-BR")} de {(s?.totalConversas ?? 0).toLocaleString("pt-BR")} conversas já reconstruídas
                </span>
                <span className="font-medium tabular-nums">{pct}%</span>
              </div>
              <Progress value={pct} className="h-2" />
              {!pendente && (s?.totalConversas ?? 0) > 0 && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 pt-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Histórico completo: {(s?.episodios ?? 0).toLocaleString("pt-BR")} atendimentos registrados.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => simular.mutate()} disabled={rodando || !pendente}>
              {simular.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Simular (não grava nada)
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={rodando || !pendente}>
                  {aplicar.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Reconstruir agora
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reconstruir o histórico?</AlertDialogTitle>
                  <AlertDialogDescription className="leading-relaxed">
                    Cria os registros de atendimento a partir das mensagens que já existem.
                    Nenhuma conversa, mensagem ou cliente é alterado ou apagado — só são
                    criados os registros que faltavam. Pode ser interrompido e retomado sem
                    duplicar nada.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => aplicar.mutate()}>
                    Reconstruir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {rodando && (
            <p className="text-xs text-muted-foreground">
              Percorrendo as mensagens… pode levar alguns minutos. Não feche a página.
            </p>
          )}

          {resultado && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3 dark:border-slate-800">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {resultado.aplicado ? "Resultado" : "Simulação — nada foi gravado"}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Numero valor={resultado.conversasAnalisadas} rotulo="conversas analisadas" />
                <Numero
                  valor={resultado.episodiosCriados}
                  rotulo={resultado.aplicado ? "atendimentos criados" : "atendimentos que seriam criados"}
                />
                <Numero
                  valor={resultado.conversasComMaisDeUm}
                  rotulo="conversas com mais de um atendimento"
                  destaque
                />
                <Numero valor={resultado.conversasVazias} rotulo="sem mensagem, ignoradas" />
              </div>

              {resultado.conversasComMaisDeUm > 0 && (
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Users className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-500" />
                  <span>
                    Essas {resultado.conversasComMaisDeUm.toLocaleString("pt-BR")} são clientes que
                    voltaram depois de um tempo. Cada volta era um atendimento que sumia da
                    contagem — e é o que passa a aparecer no relatório.
                  </span>
                </p>
              )}

              {!resultado.completo && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Parou em {resultado.restantes.toLocaleString("pt-BR")} conversas restantes pra não
                  travar a página. {resultado.aplicado ? "Clique em “Reconstruir agora” de novo pra continuar de onde parou." : "A simulação cobriu só o começo."}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
