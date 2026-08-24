/**
 * Ações do relatório: exportar PDF, enviar por e-mail agora e programar
 * envio recorrente. Um bloco só pros três, porque as três operam sobre o
 * mesmo par (relatório, filtros) e antes cada aba montava o seu.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Clock, FileText, Loader2, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { baixarBlob, base64ToBlob } from "../financeiro/helpers";
import { useRelatorios } from "./casca";

export type RelatorioId = "atendimento" | "comercial" | "producao" | "agenda" | "financeiro";

/** Procedure de export de cada relatório. Financeiro tem gerador próprio. */
const PROC_PDF: Record<RelatorioId, { ns: "relatorios" | "financeiro"; nome: string }> = {
  atendimento: { ns: "relatorios", nome: "exportarAtendimentoPdf" },
  comercial: { ns: "relatorios", nome: "exportarComercialPdf" },
  producao: { ns: "relatorios", nome: "exportarProducaoPdf" },
  agenda: { ns: "relatorios", nome: "exportarAgendaPdf" },
  financeiro: { ns: "financeiro", nome: "exportarDrePdf" },
};

const NOME_RELATORIO: Record<RelatorioId, string> = {
  atendimento: "Atendimento",
  comercial: "Comercial",
  producao: "Produção",
  agenda: "Agenda",
  financeiro: "Financeiro",
};

const DIAS_SEMANA = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado",
];

export function AcoesRelatorio({
  relatorio,
  filtros,
  pronto,
  extras,
}: {
  relatorio: RelatorioId;
  /** Filtros da tela — vão pro PDF e ficam gravados no agendamento. */
  filtros: Record<string, unknown>;
  /** Falso enquanto os dados não chegaram: exportar vazio não ajuda ninguém. */
  pronto: boolean;
  /** Botões específicos do relatório (ex: CSV, diagnóstico). */
  extras?: React.ReactNode;
}) {
  const { periodo, slotAcoes } = useRelatorios();
  const [emailAberto, setEmailAberto] = useState(false);
  const [programarAberto, setProgramarAberto] = useState(false);

  const proc = PROC_PDF[relatorio];
  const pdfMut = (trpc as any)[proc.ns]?.[proc.nome]?.useMutation?.({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => {
      baixarBlob(base64ToBlob(r.base64, r.mimeType), r.filename, r.mimeType);
      toast.success("PDF baixado");
    },
    onError: (err: any) => toast.error("Erro ao exportar PDF", { description: err.message }),
  });

  const filtrosComPeriodo = { dataInicio: periodo.inicio, dataFim: periodo.fim, ...filtros };

  const botoes = (
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {extras}
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => setProgramarAberto(true)}
        >
          <Clock className="h-3.5 w-3.5 mr-1.5" />
          Programar envio
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={!pronto}
          onClick={() => setEmailAberto(true)}
        >
          <Mail className="h-3.5 w-3.5 mr-1.5" />
          Enviar por e-mail
        </Button>
        <Button
          size="sm"
          className="h-8"
          disabled={!pronto || pdfMut?.isPending}
          onClick={() => pdfMut?.mutate?.(filtrosComPeriodo)}
        >
          {pdfMut?.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <FileText className="h-3.5 w-3.5 mr-1.5" />
          )}
          Exportar PDF
        </Button>
      </div>
  );

  return (
    <>
      {/* Na linha das abas quando o slot existe (pedido do dono: uma linha a
          menos na tela); sozinho no lugar antigo quando não existe. */}
      {slotAcoes ? createPortal(botoes, slotAcoes) : botoes}

      <DialogEnviarAgora
        aberto={emailAberto}
        onFechar={() => setEmailAberto(false)}
        relatorio={relatorio}
        filtros={filtrosComPeriodo}
      />
      <DialogProgramar
        aberto={programarAberto}
        onFechar={() => setProgramarAberto(false)}
        relatorio={relatorio}
        filtros={filtros}
      />
    </>
  );
}

function DialogEnviarAgora({
  aberto,
  onFechar,
  relatorio,
  filtros,
}: {
  aberto: boolean;
  onFechar: () => void;
  relatorio: RelatorioId;
  filtros: Record<string, unknown>;
}) {
  const [destinatarios, setDestinatarios] = useState("");
  const { user } = useAuth();

  const enviar = (trpc as any).relatorios?.enviarPorEmail?.useMutation?.({
    onSuccess: (r: { enviados: number; total: number; falhas: string[]; ignorados: string[] }) => {
      if (r.falhas.length > 0) {
        toast.warning(`Enviado para ${r.enviados} de ${r.total}`, {
          description: r.falhas[0],
        });
      } else {
        toast.success(
          r.enviados === 1 ? "Relatório enviado" : `Relatório enviado para ${r.enviados} destinatários`,
        );
      }
      if (r.ignorados.length > 0) {
        toast.warning("Endereços ignorados", { description: r.ignorados.join(", ") });
      }
      onFechar();
      setDestinatarios("");
    },
    onError: (err: any) => toast.error("Não foi possível enviar", { description: err.message }),
  });

  const meuEmail = user?.email || undefined;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Enviar relatório de {NOME_RELATORIO[relatorio]}</DialogTitle>
          <DialogDescription>
            O PDF vai em anexo e o corpo do e-mail traz os números principais.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs">Destinatários</Label>
          <Input
            placeholder="socio@escritorio.com.br, financeiro@escritorio.com.br"
            value={destinatarios}
            onChange={(e) => setDestinatarios(e.target.value)}
            className="text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Separe por vírgula para enviar a mais de uma pessoa.
            {meuEmail && (
              <>
                {" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() =>
                    setDestinatarios((d) => (d.includes(meuEmail) ? d : d ? `${d}, ${meuEmail}` : meuEmail))
                  }
                >
                  Usar o meu ({meuEmail})
                </button>
              </>
            )}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button
            disabled={!destinatarios.trim() || enviar?.isPending}
            onClick={() => enviar?.mutate?.({ relatorio, filtros, destinatarios })}
          >
            {enviar?.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Enviar agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogProgramar({
  aberto,
  onFechar,
  relatorio,
  filtros,
}: {
  aberto: boolean;
  onFechar: () => void;
  relatorio: RelatorioId;
  filtros: Record<string, unknown>;
}) {
  const utils = trpc.useUtils();
  const [frequencia, setFrequencia] = useState<"diaria" | "semanal" | "mensal">("semanal");
  const [diaSemana, setDiaSemana] = useState(1);
  const [diaMes, setDiaMes] = useState(1);
  const [hora, setHora] = useState(8);
  const [janelaDias, setJanelaDias] = useState(30);
  const [destinatarios, setDestinatarios] = useState("");
  const [removendo, setRemovendo] = useState<number | null>(null);

  const listaQ = (trpc as any).relatorios?.listarProgramados?.useQuery?.(undefined, {
    retry: false,
    enabled: aberto,
  });
  const agendamentos = ((listaQ?.data || []) as any[]).filter((p) => p.relatorio === relatorio);

  const invalidar = () => (utils as any).relatorios?.listarProgramados?.invalidate?.();

  const salvar = (trpc as any).relatorios?.salvarProgramado?.useMutation?.({
    onSuccess: (r: { ignorados: string[] }) => {
      toast.success("Envio programado");
      if (r.ignorados.length > 0) {
        toast.warning("Endereços ignorados", { description: r.ignorados.join(", ") });
      }
      setDestinatarios("");
      invalidar();
    },
    onError: (err: any) => toast.error("Não foi possível programar", { description: err.message }),
  });
  const remover = (trpc as any).relatorios?.removerProgramado?.useMutation?.({
    onSuccess: () => {
      toast.success("Envio cancelado");
      setRemovendo(null);
      invalidar();
    },
    onError: (err: any) => toast.error("Não foi possível cancelar", { description: err.message }),
  });

  const resumo = (p: any) => {
    const quando =
      p.frequencia === "diaria"
        ? "todo dia"
        : p.frequencia === "semanal"
          ? `toda ${DIAS_SEMANA[p.diaSemana]}`
          : `todo dia ${p.diaMes}`;
    return `${quando} às ${String(p.hora).padStart(2, "0")}:00 · últimos ${p.janelaDias} dias`;
  };

  return (
    <>
      <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Programar envio · {NOME_RELATORIO[relatorio]}</DialogTitle>
            <DialogDescription>
              O relatório sai sozinho no horário do escritório, com os filtros que
              estão aplicados agora.
            </DialogDescription>
          </DialogHeader>

          {agendamentos.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Envios ativos</Label>
              {agendamentos.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{resumo(p)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {p.destinatarios.join(", ")}
                    </p>
                    {p.ultimoStatus && p.ultimoStatus !== "enviado" && (
                      <p className="truncate text-[11px] text-rose-600 dark:text-rose-400">
                        Último envio falhou: {p.ultimoErro || "erro desconhecido"}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={p.ativo}
                    onCheckedChange={(v) =>
                      salvar?.mutate?.({
                        id: p.id,
                        relatorio,
                        frequencia: p.frequencia,
                        diaSemana: p.diaSemana,
                        diaMes: p.diaMes,
                        hora: p.hora,
                        janelaDias: p.janelaDias,
                        filtros: p.filtros,
                        destinatarios: p.destinatarios.join(","),
                        ativo: v,
                      })
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setRemovendo(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3 border-t pt-3">
            <Label className="text-xs">Novo envio</Label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Frequência</Label>
                <select
                  value={frequencia}
                  onChange={(e) => setFrequencia(e.target.value as any)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="diaria">Todo dia</option>
                  <option value="semanal">Toda semana</option>
                  <option value="mensal">Todo mês</option>
                </select>
              </div>

              {frequencia === "semanal" && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Dia da semana</Label>
                  <select
                    value={diaSemana}
                    onChange={(e) => setDiaSemana(Number(e.target.value))}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {DIAS_SEMANA.map((d, i) => (
                      <option key={d} value={i}>{d}</option>
                    ))}
                  </select>
                </div>
              )}

              {frequencia === "mensal" && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Dia do mês</Label>
                  <select
                    value={diaMes}
                    onChange={(e) => setDiaMes(Number(e.target.value))}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>dia {d}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Horário</Label>
                <select
                  value={hora}
                  onChange={(e) => setHora(Number(e.target.value))}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Período coberto</Label>
                <select
                  value={janelaDias}
                  onChange={(e) => setJanelaDias(Number(e.target.value))}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value={7}>últimos 7 dias</option>
                  <option value={30}>últimos 30 dias</option>
                  <option value={90}>últimos 90 dias</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Destinatários</Label>
              <Input
                placeholder="socio@escritorio.com.br, financeiro@escritorio.com.br"
                value={destinatarios}
                onChange={(e) => setDestinatarios(e.target.value)}
                className="text-sm"
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              O período de cada envio é contado a partir do dia do disparo — o
              intervalo escolhido na tela vale só pro que você está vendo agora.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onFechar}>Fechar</Button>
            <Button
              disabled={!destinatarios.trim() || salvar?.isPending}
              onClick={() =>
                salvar?.mutate?.({
                  relatorio,
                  frequencia,
                  diaSemana,
                  diaMes,
                  hora,
                  janelaDias,
                  filtros,
                  destinatarios,
                  ativo: true,
                })
              }
            >
              {salvar?.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Programar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removendo !== null} onOpenChange={(v) => !v && setRemovendo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar este envio programado?</AlertDialogTitle>
            <AlertDialogDescription>
              O relatório deixa de ser enviado automaticamente. Você continua
              podendo exportar e enviar manualmente quando quiser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removendo !== null && remover?.mutate?.({ id: removendo })}
            >
              Cancelar envio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
