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

import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Check,
  Clock,
  Coffee,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  ShieldCheck,
  TriangleAlert,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { formatarDuracao, type Jornada, type StatusDia } from "@shared/ponto";
import {
  exigeMotivo,
  MOTIVOS_FALTA,
  ROTULO_MOTIVO,
  ROTULO_TIPO,
  TIPOS_OCORRENCIA,
  type ContagemFaltas,
  type MotivoFalta,
  type OcorrenciaGravada,
  type SituacaoFalta,
  type TipoOcorrencia,
} from "@shared/ocorrencias";
import {
  CRITERIOS,
  deltaDeNota,
  mediaDasNotas,
  NOTA_MAX,
  situacaoDaAcao,
  situacaoDoCiclo,
  type AvaliacaoGravada,
  type CriterioId,
  type Notas,
  type SituacaoCiclo,
} from "@shared/avaliacao";

const ROTULO_CICLO: Record<SituacaoCiclo, { texto: string; classe: string }> = {
  em_dia: { texto: "", classe: "" },
  vence_agora: {
    texto: "avaliar neste mês",
    classe: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  vencida: {
    texto: "vencida",
    classe: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
  nunca: {
    texto: "nunca avaliada",
    classe: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
};

/** Cor da nota. A régua é a mesma dos três blocos pra não ensinar duas leituras. */
function corDaNota(n: number): string {
  if (n < 2) return "bg-rose-500";
  if (n < 3) return "bg-orange-500";
  if (n < 4) return "bg-amber-500";
  return "bg-emerald-500";
}

function textoDaNota(n: number): string {
  if (n < 2) return "text-rose-600";
  if (n < 3) return "text-orange-600";
  if (n < 4) return "text-amber-600";
  return "text-emerald-600";
}

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function cicloPorExtenso(ciclo: string): string {
  const d = new Date(`${ciclo}-01T12:00:00.000Z`);
  return Number.isNaN(d.getTime())
    ? ciclo
    : d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

/** O que o servidor devolve: a jornada calculada + a comparação com o contrato. */
type JornadaComparada = Jornada & {
  previstoMin: number;
  saldoMin: number | null;
  atrasoMin: number;
  atrasado: boolean;
  ocorrencias: OcorrenciaGravada[];
  falta: SituacaoFalta | null;
};

const CLASSE_SITUACAO: Record<SituacaoFalta, string> = {
  abonada: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  descontada: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  aguardando: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
};

const ROTULO_SITUACAO: Record<SituacaoFalta, string> = {
  abonada: "abonada",
  descontada: "desconta",
  aguardando: "aguardando atestado",
};

const CLASSE_TIPO: Record<TipoOcorrencia, string> = {
  falta: "bg-muted text-foreground",
  advertencia: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  elogio: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  observacao: "bg-muted text-muted-foreground",
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

/** Hoje no fuso de quem olha. `toISOString()` daria o dia UTC, e depois das 21h
 *  em Fortaleza isso já é amanhã. */
function hojeLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
        <span className="flex flex-wrap items-center justify-end gap-1">
          {j.ocorrencias.map((o) => (
            <span
              key={o.id}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CLASSE_TIPO[o.tipo]}`}
              title={o.descricao || undefined}
            >
              {ROTULO_TIPO[o.tipo]}
              {o.motivo ? ` · ${ROTULO_MOTIVO[o.motivo]}` : ""}
            </span>
          ))}
          {j.falta && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CLASSE_SITUACAO[j.falta]}`}
            >
              {ROTULO_SITUACAO[j.falta]}
            </span>
          )}
          {marca.texto && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${marca.classe}`}>
              {marca.texto}
            </span>
          )}
        </span>
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
  // Dia sem ponto mas COM ocorrência fica: a falta lançada num dia que ninguém
  // logou é exatamente a linha que veio explicar o branco.
  const comRegistro = jornadas.filter(
    (j) => j.status !== "sem_registro" || j.ocorrencias.length > 0,
  );
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
    faltas: ContagemFaltas;
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
      {t.faltas.total > 0 && (
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold tabular-nums"
          title={`${t.faltas.descontadas} descontando · ${t.faltas.abonadas} abonadas · ${t.faltas.aguardando} aguardando atestado`}
        >
          {t.faltas.total} {t.faltas.total === 1 ? "falta" : "faltas"}
          {t.faltas.abonadas > 0 && ` (${t.faltas.abonadas} abonada${t.faltas.abonadas === 1 ? "" : "s"})`}
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

/**
 * Lançamento de ocorrência. Só o gestor chega aqui.
 *
 * Falta pede motivo e conduta pede descrição, e o botão fica travado até a
 * exigência ser cumprida — deixar salvar e devolver erro do servidor seria
 * fazer a pessoa preencher duas vezes.
 */
function DialogOcorrencia({
  aberto,
  onFechar,
  colaboradorId,
  nome,
  diaInicial,
  aoSalvar,
}: {
  aberto: boolean;
  onFechar: () => void;
  colaboradorId: number | null;
  nome: string;
  diaInicial: string | null;
  aoSalvar: () => void;
}) {
  const [dia, setDia] = useState(hojeLocalISO());
  const [tipo, setTipo] = useState<TipoOcorrencia>("falta");
  const [motivo, setMotivo] = useState<MotivoFalta>("atestado");
  const [descricao, setDescricao] = useState("");

  const mut = trpc.rh.registrarOcorrencia.useMutation({
    onSuccess: () => {
      toast.success("Ocorrência registrada");
      setDescricao("");
      aoSalvar();
      onFechar();
    },
    onError: (e) => toast.error("Não deu pra registrar", { description: e.message }),
  });

  const precisaMotivo = exigeMotivo(tipo);
  const podeSalvar = !!colaboradorId && !!dia
    && (precisaMotivo || descricao.trim().length >= 3);

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) onFechar();
        else setDia(diaInicial || hojeLocalISO());
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar ocorrência{nome ? ` — ${nome}` : ""}</DialogTitle>
          <DialogDescription>
            Falta entra na apuração das horas; advertência, elogio e observação são memória do
            período e não mexem em hora nenhuma.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Dia</Label>
            <Input type="date" className="mt-1" value={dia} onChange={(e) => setDia(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoOcorrencia)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_OCORRENCIA.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ROTULO_TIPO[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {precisaMotivo && (
          <div>
            <Label className="text-xs">Motivo</Label>
            <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoFalta)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOTIVOS_FALTA.map((m) => (
                  <SelectItem key={m} value={m}>
                    {ROTULO_MOTIVO[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
              {motivo === "atestado"
                ? "Atestado não abona sozinho: o dia fica aguardando até você anexar o documento e aprovar."
                : motivo === "injustificada"
                  ? "Desconta a jornada prevista do dia no saldo do mês."
                  : "Abona o dia — a jornada prevista não é cobrada."}
            </p>
          </div>
        )}

        <div>
          <Label className="text-xs">
            {precisaMotivo ? "Observação (opcional)" : "O que aconteceu"}
          </Label>
          <Textarea
            className="mt-1 min-h-[70px]"
            placeholder={
              precisaMotivo ? "Ex.: avisou por WhatsApp às 7h" : "Ex.: fechou três contratos na semana"
            }
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={mut.isPending || !podeSalvar}
            onClick={() =>
              colaboradorId && mut.mutate({
                colaboradorId,
                dia,
                tipo,
                ...(precisaMotivo ? { motivo } : {}),
                ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
              })
            }
          >
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A lista de conduta e faltas do período.
 *
 * Anexar e aprovar aparecem só pro gestor — o colaborador lê a própria ficha,
 * que é o mínimo pra um registro que pesa no que ele recebe, mas não escreve
 * nela nem sobe o próprio atestado.
 */
function PainelOcorrencias({
  ocorrencias,
  gestor,
  aoMudar,
}: {
  ocorrencias: OcorrenciaGravada[];
  gestor: boolean;
  aoMudar: () => void;
}) {
  const [alvo, setAlvo] = useState<number | null>(null);
  const [excluindo, setExcluindo] = useState<OcorrenciaGravada | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = (trpc as any).upload.enviar.useMutation();
  const anexar = trpc.rh.anexarAtestado.useMutation({
    onSuccess: () => {
      toast.success("Atestado anexado — falta aprovar");
      aoMudar();
    },
    onError: (e) => toast.error("Não deu pra anexar", { description: e.message }),
  });
  const decidir = trpc.rh.decidirAtestado.useMutation({
    onSuccess: () => aoMudar(),
    onError: (e) => toast.error("Não deu pra decidir", { description: e.message }),
  });
  const excluir = trpc.rh.excluirOcorrencia.useMutation({
    onSuccess: () => {
      toast.success("Ocorrência removida");
      setExcluindo(null);
      aoMudar();
    },
    onError: (e) => toast.error("Não deu pra remover", { description: e.message }),
  });

  const enviarArquivo = async (file: File) => {
    if (!alvo) return;
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error("Erro ao ler arquivo"));
        r.readAsDataURL(file);
      });
      const r = await upload.mutateAsync({
        nome: file.name,
        tipo: file.type,
        base64,
        tamanho: file.size,
      });
      await anexar.mutateAsync({ ocorrenciaId: alvo, url: r.url, nome: r.nome || file.name });
    } catch (e: any) {
      toast.error(e?.message || "Erro ao enviar o atestado");
    } finally {
      setAlvo(null);
    }
  };

  if (ocorrencias.length === 0) return null;

  return (
    <div className="border-t px-3 py-2.5">
      <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
        Conduta e faltas
      </p>
      <div className="mt-1.5 space-y-1">
        {ocorrencias.map((o) => (
          <div
            key={o.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/40 px-2.5 py-1.5"
          >
            <span className="text-[11px] font-bold capitalize tabular-nums">{diaCurto(o.dia)}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CLASSE_TIPO[o.tipo]}`}
            >
              {ROTULO_TIPO[o.tipo]}
              {o.motivo ? ` · ${ROTULO_MOTIVO[o.motivo]}` : ""}
            </span>
            {o.descricao && (
              <span className="text-[11px] text-muted-foreground">{o.descricao}</span>
            )}

            {o.atestadoUrl && (
              <a
                href={o.atestadoUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[10.5px] font-semibold text-violet-600 hover:underline"
              >
                <FileText className="h-3 w-3" />
                {o.atestadoNome || "atestado"}
              </a>
            )}
            {o.aprovadoEm && (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                aprovado
              </span>
            )}

            {gestor && (
              <span className="ml-auto flex items-center gap-1.5">
                {o.motivo === "atestado" && (
                  <>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-violet-600"
                      disabled={upload.isPending || anexar.isPending}
                      onClick={() => {
                        setAlvo(o.id);
                        inputRef.current?.click();
                      }}
                    >
                      <Paperclip className="h-3 w-3" />
                      {o.atestadoUrl ? "trocar" : "anexar"}
                    </button>
                    <button
                      type="button"
                      className={`flex items-center gap-1 text-[10.5px] ${
                        o.aprovadoEm
                          ? "text-muted-foreground hover:text-rose-600"
                          : "text-muted-foreground hover:text-emerald-600"
                      }`}
                      disabled={decidir.isPending}
                      title={
                        o.atestadoUrl
                          ? undefined
                          : "Anexe o atestado antes de aprovar — a aprovação registra que alguém olhou o documento"
                      }
                      onClick={() =>
                        decidir.mutate({ ocorrenciaId: o.id, aprovar: !o.aprovadoEm })
                      }
                    >
                      <Check className="h-3 w-3" />
                      {o.aprovadoEm ? "desfazer" : "aprovar"}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-rose-600"
                  title="Remover"
                  onClick={() => setExcluindo(o)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void enviarArquivo(f);
        }}
      />

      <AlertDialog open={!!excluindo} onOpenChange={(v) => !v && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover esta ocorrência?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo && (
                <>
                  {ROTULO_TIPO[excluindo.tipo]} de {diaCurto(excluindo.dia)}. Se ela abonava ou
                  descontava um dia, o saldo do mês volta a contar sem ela.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => excluindo && excluir.mutate({ ocorrenciaId: excluindo.id })}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * O formulário da avaliação.
 *
 * A nota geral não é digitada: ela aparece calculada em cima, e muda enquanto
 * o gestor mexe nos critérios. Deixar digitar a média junto com os critérios
 * abriria a porta pros dois discordarem, e aí não dá pra saber qual dos dois é
 * a avaliação.
 */
function DialogAvaliar({
  aberto,
  onFechar,
  colaboradorId,
  nome,
  aoSalvar,
}: {
  aberto: boolean;
  onFechar: () => void;
  colaboradorId: number | null;
  nome: string;
  aoSalvar: () => void;
}) {
  const [notas, setNotas] = useState<Notas>({});
  const [comentario, setComentario] = useState("");
  const [acoes, setAcoes] = useState<Array<{ descricao: string; prazo: string }>>([]);

  const mut = trpc.rh.avaliar.useMutation({
    onSuccess: () => {
      toast.success("Avaliação registrada");
      setNotas({});
      setComentario("");
      setAcoes([]);
      aoSalvar();
      onFechar();
    },
    onError: (e) => toast.error("Não deu pra avaliar", { description: e.message }),
  });

  const media = mediaDasNotas(notas);
  const avaliados = CRITERIOS.filter((c) => typeof notas[c.id] === "number").length;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Avaliar {nome}</DialogTitle>
          <DialogDescription>
            Ciclo de {cicloPorExtenso(competenciaAtual())}. Critério sem nota fica de fora da
            média — não vira zero.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-baseline gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <span className={`text-[26px] font-extrabold tabular-nums ${media != null ? textoDaNota(media) : "text-muted-foreground"}`}>
            {media != null ? media.toFixed(1).replace(".", ",") : "—"}
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            de {NOTA_MAX},0 · média de {avaliados} {avaliados === 1 ? "critério" : "critérios"}
          </span>
        </div>

        <div className="space-y-3">
          {CRITERIOS.map((c) => {
            const v = notas[c.id];
            return (
              <div key={c.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <Label className="text-xs font-semibold">{c.rotulo}</Label>
                  <span className="flex items-center gap-2">
                    <span
                      className={`text-[13px] font-bold tabular-nums ${typeof v === "number" ? textoDaNota(v) : "text-muted-foreground"}`}
                    >
                      {typeof v === "number" ? v.toFixed(1).replace(".", ",") : "sem nota"}
                    </span>
                    {typeof v === "number" && (
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-rose-600"
                        onClick={() => setNotas((n) => {
                          const { [c.id]: _, ...resto } = n;
                          return resto;
                        })}
                      >
                        limpar
                      </button>
                    )}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={NOTA_MAX}
                  step={0.5}
                  value={typeof v === "number" ? v : 0}
                  onChange={(e) =>
                    setNotas((n) => ({ ...n, [c.id]: Number(e.target.value) as number }))
                  }
                  className="mt-1 w-full accent-violet-600"
                />
                <p className="text-[10.5px] leading-relaxed text-muted-foreground">{c.ajuda}</p>
              </div>
            );
          })}
        </div>

        <div>
          <Label className="text-xs">Comentário</Label>
          <Textarea
            className="mt-1 min-h-[70px]"
            placeholder="O que sustenta essas notas — é o que a pessoa vai ler."
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Plano combinado</Label>
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:underline"
              onClick={() => setAcoes((a) => [...a, { descricao: "", prazo: "" }])}
            >
              <Plus className="h-3 w-3" />
              adicionar
            </button>
          </div>
          {acoes.length === 0 && (
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              O que fica combinado pro próximo ciclo. Sem isso a avaliação vira só uma nota.
            </p>
          )}
          <div className="mt-1 space-y-1.5">
            {acoes.map((a, i) => (
              <div key={i} className="flex gap-1.5">
                <Input
                  className="h-8 flex-1"
                  placeholder="Ex.: avisar imprevisto no grupo até as 08h30"
                  value={a.descricao}
                  onChange={(e) =>
                    setAcoes((lista) =>
                      lista.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)),
                    )
                  }
                />
                <Input
                  type="date"
                  className="h-8 w-[135px]"
                  value={a.prazo}
                  onChange={(e) =>
                    setAcoes((lista) =>
                      lista.map((x, j) => (j === i ? { ...x, prazo: e.target.value } : x)),
                    )
                  }
                />
                <button
                  type="button"
                  className="text-muted-foreground hover:text-rose-600"
                  onClick={() => setAcoes((lista) => lista.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={mut.isPending || media == null || !colaboradorId}
            onClick={() =>
              colaboradorId && mut.mutate({
                colaboradorId,
                ciclo: competenciaAtual(),
                notas: notas as Record<string, number>,
                ...(comentario.trim() ? { comentario: comentario.trim() } : {}),
                acoes: acoes
                  .filter((a) => a.descricao.trim().length >= 3)
                  .map((a) => ({
                    descricao: a.descricao.trim(),
                    ...(a.prazo ? { prazo: a.prazo } : {}),
                  })),
              })
            }
          >
            Salvar avaliação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A última avaliação, o plano combinado e o histórico.
 *
 * O plano vem depois das notas de propósito: a nota diz onde a pessoa está, e
 * o plano é a única parte da conversa que muda alguma coisa até o próximo
 * ciclo. Avaliação que termina no número vira placar.
 */
function PainelAvaliacao({
  avaliacoes,
  gestor,
  aoMudar,
}: {
  avaliacoes: AvaliacaoGravada[];
  gestor: boolean;
  aoMudar: () => void;
}) {
  const [verHistorico, setVerHistorico] = useState(false);
  const [excluindo, setExcluindo] = useState<AvaliacaoGravada | null>(null);

  const decidir = trpc.rh.decidirAcao.useMutation({
    onSuccess: () => aoMudar(),
    onError: (e) => toast.error("Não deu pra atualizar", { description: e.message }),
  });
  const excluir = trpc.rh.excluirAvaliacao.useMutation({
    onSuccess: () => {
      toast.success("Avaliação removida");
      setExcluindo(null);
      aoMudar();
    },
    onError: (e) => toast.error("Não deu pra remover", { description: e.message }),
  });

  const ultima = avaliacoes[0];
  if (!ultima) return null;

  const anterior = avaliacoes[1];
  const delta = deltaDeNota(ultima.media, anterior?.media ?? null);
  const hoje = hojeLocalISO();

  return (
    <div className="border-t px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          Última avaliação · ciclo de {cicloPorExtenso(ultima.ciclo)}
        </p>
        {gestor && (
          <button
            type="button"
            className="text-[10.5px] text-muted-foreground hover:text-rose-600"
            onClick={() => setExcluindo(ultima)}
          >
            remover
          </button>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`text-[22px] font-extrabold tabular-nums ${ultima.media != null ? textoDaNota(ultima.media) : ""}`}
        >
          {ultima.media != null ? ultima.media.toFixed(1).replace(".", ",") : "—"}
        </span>
        <span className="text-[11px] text-muted-foreground">de {NOTA_MAX},0</span>
        {delta != null && delta !== 0 && (
          <span
            className={`text-[11px] font-bold tabular-nums ${delta > 0 ? "text-emerald-600" : "text-rose-600"}`}
            title={`Ciclo anterior: ${anterior?.media?.toFixed(1).replace(".", ",")}`}
          >
            {delta > 0 ? "+" : "−"}
            {Math.abs(delta).toFixed(1).replace(".", ",")}
          </span>
        )}
        <span className="text-[10.5px] text-muted-foreground">
          por {ultima.avaliadoPorNome || "—"} em {dataCurta(ultima.avaliadoEm)}
        </span>
      </div>

      <div className="mt-2 grid gap-x-5 gap-y-1 sm:grid-cols-2">
        {CRITERIOS.map((c) => {
          const n = ultima.notas[c.id as CriterioId];
          return (
            <div key={c.id} className="flex items-center gap-2">
              <span className="w-[130px] shrink-0 text-[11px]">{c.rotulo}</span>
              <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                {typeof n === "number" && (
                  <span
                    className={`block h-full rounded-full ${corDaNota(n)}`}
                    style={{ width: `${(n / NOTA_MAX) * 100}%` }}
                  />
                )}
              </span>
              <span className="w-[26px] text-right text-[11px] font-bold tabular-nums">
                {typeof n === "number" ? n.toFixed(1).replace(".", ",") : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {ultima.comentario && (
        <p className="mt-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] leading-relaxed">
          {ultima.comentario}
        </p>
      )}

      {ultima.acoes.length > 0 && (
        <div className="mt-2">
          <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
            Plano combinado
          </p>
          <div className="mt-1 space-y-1">
            {ultima.acoes.map((a) => {
              const s = situacaoDaAcao(a, hoje);
              return (
                <div key={a.id} className="flex items-start gap-2">
                  <button
                    type="button"
                    disabled={!gestor || decidir.isPending}
                    onClick={() => decidir.mutate({ acaoId: a.id, concluir: !a.concluidoEm })}
                    className={`mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                      s === "concluida"
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-muted-foreground/40"
                    } ${gestor ? "cursor-pointer" : "cursor-default"}`}
                    title={gestor ? "Marcar como cumprida" : undefined}
                  >
                    {s === "concluida" && <Check className="h-2.5 w-2.5" />}
                  </button>
                  <span
                    className={`text-[11px] leading-relaxed ${s === "concluida" ? "text-muted-foreground line-through" : ""}`}
                  >
                    {a.descricao}
                    {a.prazo && (
                      <span
                        className={`ml-1.5 text-[10px] font-semibold ${s === "atrasada" ? "text-rose-600" : "text-muted-foreground"}`}
                      >
                        {s === "atrasada" ? "venceu" : "até"} {a.prazo.split("-").reverse().join("/")}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {avaliacoes.length > 1 && (
        <div className="mt-2">
          <button
            type="button"
            className="text-[10.5px] font-semibold text-violet-600 hover:underline"
            onClick={() => setVerHistorico((v) => !v)}
          >
            {verHistorico ? "esconder" : `ver histórico (${avaliacoes.length - 1})`}
          </button>
          {verHistorico && (
            <div className="mt-1 space-y-0.5">
              {avaliacoes.slice(1).map((a, i) => {
                const d = deltaDeNota(a.media, avaliacoes[i + 2]?.media ?? null);
                return (
                  <div key={a.id} className="flex items-baseline gap-2 text-[11px]">
                    <span className="w-[120px] capitalize text-muted-foreground">
                      {cicloPorExtenso(a.ciclo)}
                    </span>
                    <span
                      className={`font-bold tabular-nums ${a.media != null ? textoDaNota(a.media) : ""}`}
                    >
                      {a.media != null ? a.media.toFixed(1).replace(".", ",") : "—"}
                    </span>
                    {d != null && d !== 0 && (
                      <span
                        className={`text-[10px] font-semibold tabular-nums ${d > 0 ? "text-emerald-600" : "text-rose-600"}`}
                      >
                        {d > 0 ? "+" : "−"}
                        {Math.abs(d).toFixed(1).replace(".", ",")}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      por {a.avaliadoPorNome || "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!excluindo} onOpenChange={(v) => !v && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover esta avaliação?</AlertDialogTitle>
            <AlertDialogDescription>
              O plano combinado dela vai junto, e a pessoa volta a aparecer como pendente de
              avaliação no ciclo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => excluindo && excluir.mutate({ avaliacaoId: excluindo.id })}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Ponto() {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [ajustando, setAjustando] = useState<{ colaboradorId: number; jornada: Jornada } | null>(null);
  const [lancando, setLancando] = useState<{ colaboradorId: number; nome: string } | null>(null);
  const [avaliando, setAvaliando] = useState<{ colaboradorId: number; nome: string } | null>(null);

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

  const hoje = hojeLocalISO();
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
            <PainelOcorrencias
              ocorrencias={meu.data?.ocorrencias ?? []}
              gestor={false}
              aoMudar={() => utils.rh.meuEspelho.invalidate()}
            />
            <PainelAvaliacao
              avaliacoes={meu.data?.avaliacoes ?? []}
              gestor={false}
              aoMudar={() => utils.rh.meuEspelho.invalidate()}
            />
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
                <div className="flex items-center gap-2">
                  {(() => {
                    const s = situacaoDoCiclo(p.avaliacoes[0]?.ciclo, competencia);
                    const r = ROTULO_CICLO[s];
                    return r.texto ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.classe}`}
                        title="A avaliação se repete a cada 3 meses"
                      >
                        {r.texto}
                      </span>
                    ) : null;
                  })()}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setLancando({ colaboradorId: p.colaboradorId, nome: p.nome })}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Ocorrência
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setAvaliando({ colaboradorId: p.colaboradorId, nome: p.nome })}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Avaliar
                  </Button>
                </div>
              </div>
              <Tabela
                jornadas={p.jornadas}
                aoAjustar={(j) => setAjustando({ colaboradorId: p.colaboradorId, jornada: j })}
              />
              <div className="px-3 pb-3">
                <Avisos jornadas={p.jornadas} />
              </div>
              <PainelOcorrencias
                ocorrencias={p.ocorrencias}
                gestor
                aoMudar={() => {
                  utils.rh.espelhoEquipe.invalidate();
                  utils.rh.meuEspelho.invalidate();
                }}
              />
              <PainelAvaliacao
                avaliacoes={p.avaliacoes}
                gestor
                aoMudar={() => {
                  utils.rh.espelhoEquipe.invalidate();
                  utils.rh.meuEspelho.invalidate();
                }}
              />
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

      <DialogOcorrencia
        aberto={!!lancando}
        onFechar={() => setLancando(null)}
        colaboradorId={lancando?.colaboradorId ?? null}
        nome={lancando?.nome ?? ""}
        diaInicial={hoje}
        aoSalvar={() => {
          utils.rh.espelhoEquipe.invalidate();
          utils.rh.meuEspelho.invalidate();
        }}
      />

      <DialogAvaliar
        aberto={!!avaliando}
        onFechar={() => setAvaliando(null)}
        colaboradorId={avaliando?.colaboradorId ?? null}
        nome={avaliando?.nome ?? ""}
        aoSalvar={() => {
          utils.rh.espelhoEquipe.invalidate();
          utils.rh.meuEspelho.invalidate();
        }}
      />
    </div>
  );
}
