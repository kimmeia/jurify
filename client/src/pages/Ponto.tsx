/**
 * Ponto digital — o espelho do mês.
 *
 * A coluna que carrega o módulo é a de ORIGEM. Uma saída batida e uma saída
 * deduzida da última atividade valem coisas diferentes, e o espelho que
 * mostra as duas iguais é o espelho que alguém assina sem saber o que está
 * assinando. Aqui a deduzida vem com o horário em itálico e um selo — o
 * gestor vê num relance quais dias precisam de olho.
 *
 * O total do mês soma só os dias fechados, e os pendentes aparecem contados à
 * parte. Somar o que não se sabe daria um número que ninguém consegue
 * conferir contra a tabela logo abaixo.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Clock, Coffee, Pencil, TriangleAlert, Users } from "lucide-react";
import { toast } from "sonner";
import { formatarDuracao, type Jornada, type StatusDia } from "@shared/ponto";

/** O que o servidor devolve: a jornada calculada + a comparação com o contrato. */
type JornadaComparada = Jornada & {
  previstoMin: number;
  saldoMin: number | null;
  atrasoMin: number;
  atrasado: boolean;
};

const ROTULO_STATUS: Record<StatusDia, { texto: string; classe: string }> = {
  fechado: { texto: "", classe: "" },
  em_andamento: {
    texto: "trabalhando agora",
    classe: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  sem_saida: {
    texto: "sem saída",
    classe: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  revisar: {
    texto: "revisar",
    classe: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  inconsistente: {
    texto: "inconsistente",
    classe: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
  sem_registro: { texto: "", classe: "" },
};

function hora(v: string | Date | null): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function diaCurto(dia: string): string {
  const d = new Date(`${dia}T12:00:00.000Z`);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", weekday: "short" });
}

function competenciaAtual(): string {
  return new Date().toISOString().slice(0, 7);
}

function LinhaJornada({
  j,
  aoAjustar,
}: {
  j: JornadaComparada;
  aoAjustar?: (j: Jornada) => void;
}) {
  const marca = ROTULO_STATUS[j.status];
  const deduzida = j.saidaOrigem === "atividade";

  return (
    <tr className="border-b last:border-b-0">
      <td className="py-2 pl-3 text-[12px] capitalize">{diaCurto(j.dia)}</td>
      <td className="py-2 text-center text-[12px] tabular-nums">
        {hora(j.entrada)}
        {j.atrasado && (
          <span
            className="ml-1 rounded bg-amber-100 px-1 py-px text-[9px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
            title={`${j.atrasoMin} minutos além do horário contratado`}
          >
            +{j.atrasoMin}min
          </span>
        )}
      </td>
      <td
        className={`py-2 text-center text-[12px] tabular-nums ${deduzida ? "italic text-muted-foreground" : ""}`}
        title={deduzida ? "Saída não registrada — considerada a última atividade no sistema" : undefined}
      >
        {hora(j.saida)}
        {deduzida && (
          <span className="ml-1 rounded bg-muted px-1 py-px text-[9px] font-bold uppercase not-italic">
            deduzida
          </span>
        )}
      </td>
      <td className="py-2 text-center text-[12px] tabular-nums text-muted-foreground">
        {j.minutosPausa > 0 ? formatarDuracao(j.minutosPausa) : "—"}
      </td>
      <td className="py-2 text-center text-[12px] font-bold tabular-nums">
        {formatarDuracao(j.minutos)}
        {j.saldoMin != null && j.saldoMin !== 0 && (
          <span
            className={`ml-1 text-[10px] font-semibold ${
              j.saldoMin > 0 ? "text-emerald-600" : "text-rose-600"
            }`}
            title={`Previsto ${formatarDuracao(j.previstoMin)}`}
          >
            {j.saldoMin > 0 ? "+" : "−"}
            {formatarDuracao(Math.abs(j.saldoMin))}
          </span>
        )}
      </td>
      <td className="py-2 pr-2 text-right">
        {marca.texto && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${marca.classe}`}>
            {marca.texto}
          </span>
        )}
      </td>
      {aoAjustar && (
        <td className="py-2 pr-3 text-right">
          <button
            type="button"
            onClick={() => aoAjustar(j)}
            className="text-muted-foreground hover:text-violet-600"
            title="Corrigir este dia"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </td>
      )}
    </tr>
  );
}

function Tabela({
  jornadas,
  aoAjustar,
}: {
  jornadas: JornadaComparada[];
  aoAjustar?: (j: Jornada) => void;
}) {
  const comRegistro = jornadas.filter((j) => j.status !== "sem_registro");
  if (comRegistro.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        Nenhum dia registrado nesta competência.
      </p>
    );
  }
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b">
          {["Dia", "Entrada", "Saída", "Pausa", "Total", ""].map((h, i) => (
            <th
              key={h || i}
              className={`pb-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground ${
                i === 0 ? "pl-3 text-left" : i >= 5 ? "pr-3 text-right" : "text-center"
              }`}
            >
              {h}
            </th>
          ))}
          {aoAjustar && <th className="pb-1.5" />}
        </tr>
      </thead>
      <tbody>
        {comRegistro.map((j) => (
          <LinhaJornada key={j.dia} j={j} aoAjustar={aoAjustar} />
        ))}
      </tbody>
    </table>
  );
}

function Avisos({ jornadas }: { jornadas: Jornada[] }) {
  const dias = jornadas.filter((j) => j.avisos.length > 0);
  if (dias.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
      {dias.slice(0, 5).map((j) => (
        <p
          key={j.dia}
          className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200"
        >
          <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
          <span>
            <b className="capitalize">{diaCurto(j.dia)}</b> — {j.avisos[0]}
          </span>
        </p>
      ))}
      {dias.length > 5 && (
        <p className="text-[10.5px] text-amber-900/70 dark:text-amber-200/70">
          + {dias.length - 5} outros dias com observação.
        </p>
      )}
    </div>
  );
}

function Total({
  t,
}: {
  t: {
    minutos: number;
    diasFechados: number;
    diasPendentes: number;
    previstoMin: number;
    saldoMin: number;
    diasAtrasados: number;
  };
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-[20px] font-extrabold tabular-nums">{formatarDuracao(t.minutos)}</span>
      <span className="text-[11.5px] text-muted-foreground">
        em {t.diasFechados} {t.diasFechados === 1 ? "dia fechado" : "dias fechados"}
      </span>
      {/* Sem dia fechado não há saldo apurado, e o "+0min" verde que aparecia
          aqui lia como "está em dia" antes de o primeiro dia sequer terminar. */}
      {t.diasFechados > 0 && t.previstoMin > 0 && (
        <span
          className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold tabular-nums ${
            t.saldoMin >= 0
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
          }`}
          title="Realizado menos previsto, só nos dias já fechados"
        >
          {t.saldoMin >= 0 ? "+" : "−"}
          {formatarDuracao(Math.abs(t.saldoMin))}
        </span>
      )}
      {t.diasAtrasados > 0 && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t.diasAtrasados} {t.diasAtrasados === 1 ? "atraso" : "atrasos"}
        </span>
      )}
      {t.diasPendentes > 0 && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t.diasPendentes} {t.diasPendentes === 1 ? "dia pendente" : "dias pendentes"} — fora do total
        </span>
      )}
    </div>
  );
}

function DialogAjuste({
  aberto,
  onFechar,
  colaboradorId,
  jornada,
  aoSalvar,
}: {
  aberto: boolean;
  onFechar: () => void;
  colaboradorId: number | null;
  jornada: Jornada | null;
  aoSalvar: () => void;
}) {
  const [entrada, setEntrada] = useState("");
  const [saida, setSaida] = useState("");
  const [pausaInicio, setPausaInicio] = useState("");
  const [pausaFim, setPausaFim] = useState("");
  const [observacao, setObservacao] = useState("");

  const mut = trpc.rh.ajustarDia.useMutation({
    onSuccess: () => {
      toast.success("Ponto ajustado");
      aoSalvar();
      onFechar();
    },
    onError: (e) => toast.error("Não deu pra ajustar", { description: e.message }),
  });

  // O formulário nasce vazio a cada abertura: campo omitido mantém o que
  // estava, e pré-preencher faria o gestor reescrever sem querer marcações que
  // não pretendia tocar.
  const abrir = (v: boolean) => {
    if (!v) onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={abrir}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corrigir {jornada ? diaCurto(jornada.dia) : "o dia"}</DialogTitle>
          <DialogDescription>
            Campo em branco fica como está. Para apagar uma marcação, deixe o campo com o valor
            vazio e salve — o dia passa a constar sem ela.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {[
            { rot: "Entrada", v: entrada, set: setEntrada },
            { rot: "Saída", v: saida, set: setSaida },
            { rot: "Início da pausa", v: pausaInicio, set: setPausaInicio },
            { rot: "Fim da pausa", v: pausaFim, set: setPausaFim },
          ].map((c) => (
            <div key={c.rot}>
              <Label className="text-xs">{c.rot}</Label>
              <Input
                type="time"
                className="mt-1"
                value={c.v}
                onChange={(e) => c.set(e.target.value)}
              />
            </div>
          ))}
        </div>

        <div>
          <Label className="text-xs">Motivo do ajuste</Label>
          <Input
            className="mt-1"
            placeholder="Ex.: esqueceu de bater a saída"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            Fica gravado com seu nome e a data. Ponto ajustado sem motivo registrado não serve de
            prova pra nenhum dos dois lados.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={mut.isPending || observacao.trim().length < 3 || !colaboradorId || !jornada}
            onClick={() =>
              colaboradorId && jornada && mut.mutate({
                colaboradorId,
                dia: jornada.dia,
                observacao: observacao.trim(),
                ...(entrada ? { entrada } : {}),
                ...(saida ? { saida } : {}),
                ...(pausaInicio ? { pausaInicio } : {}),
                ...(pausaFim ? { pausaFim } : {}),
              })
            }
          >
            Salvar ajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Ponto() {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [ajustando, setAjustando] = useState<{ colaboradorId: number; jornada: Jornada } | null>(null);

  const utils = trpc.useUtils();
  const meu = trpc.rh.meuEspelho.useQuery({ competencia });
  const equipe = trpc.rh.espelhoEquipe.useQuery({ competencia }, { retry: false });

  const pausaMut = trpc.rh.registrarPausa.useMutation({
    onSuccess: () => {
      utils.rh.meuEspelho.invalidate();
      toast.success("Pausa registrada");
    },
    onError: (e) => toast.error("Não deu pra registrar", { description: e.message }),
  });

  const hoje = new Date().toISOString().slice(0, 10);
  const jornadaHoje = meu.data?.jornadas.find((j) => j.dia === hoje);
  const pausaAberta = !!jornadaHoje && jornadaHoje.minutosPausa === 0
    && jornadaHoje.avisos.some((a) => a.includes("não encerrada"));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Clock className="h-5 w-5 text-violet-600" />
        <h1 className="text-lg font-extrabold">
          Ponto <span className="font-medium text-muted-foreground">· espelho do mês</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Input
            type="month"
            className="h-9 w-[150px]"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value || competenciaAtual())}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            disabled={pausaMut.isPending}
            onClick={() => pausaMut.mutate({ lado: pausaAberta ? "fim" : "inicio" })}
          >
            <Coffee className="h-3.5 w-3.5" />
            {pausaAberta ? "Voltei do almoço" : "Sair pro almoço"}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Meu ponto
            </p>
            {meu.data ? <Total t={meu.data.total} /> : <Skeleton className="mt-1 h-6 w-40" />}
          </div>
          <p className="max-w-sm text-[10.5px] leading-relaxed text-muted-foreground">
            A entrada é o primeiro acesso do dia. A saída é o clique em “sair”; quando ele não
            acontece, o horário mostrado é o da última atividade no sistema, marcado como deduzido.
          </p>
        </div>
        {meu.isLoading ? (
          <Skeleton className="m-3 h-32" />
        ) : (
          <>
            <Tabela jornadas={meu.data?.jornadas ?? []} />
            <div className="px-3 pb-3">
              <Avisos jornadas={meu.data?.jornadas ?? []} />
            </div>
          </>
        )}
      </div>

      {equipe.data && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-bold">Equipe</h2>
          </div>
          {equipe.data.pessoas.map((p) => (
            <div key={p.colaboradorId} className="rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                <div>
                  <p className="text-[13px] font-bold">
                    {p.nome}
                    {p.removido && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        removido
                      </span>
                    )}
                  </p>
                  <Total t={p.total} />
                </div>
              </div>
              <Tabela
                jornadas={p.jornadas}
                aoAjustar={(j) => setAjustando({ colaboradorId: p.colaboradorId, jornada: j })}
              />
              <div className="px-3 pb-3">
                <Avisos jornadas={p.jornadas} />
              </div>
            </div>
          ))}
        </div>
      )}

      <DialogAjuste
        aberto={!!ajustando}
        onFechar={() => setAjustando(null)}
        colaboradorId={ajustando?.colaboradorId ?? null}
        jornada={ajustando?.jornada ?? null}
        aoSalvar={() => {
          utils.rh.espelhoEquipe.invalidate();
          utils.rh.meuEspelho.invalidate();
        }}
      />
    </div>
  );
}
