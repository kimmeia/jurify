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

export default function Ponto() {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [ajustando, setAjustando] = useState<{ colaboradorId: number; jornada: Jornada } | null>(null);
  const [lancando, setLancando] = useState<{ colaboradorId: number; nome: string } | null>(null);

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
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setLancando({ colaboradorId: p.colaboradorId, nome: p.nome })}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ocorrência
                </Button>
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
    </div>
  );
}
