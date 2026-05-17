/**
 * Card "Agendamento de Comissões" — vive em Configurações → Financeiro.
 *
 * Configura quando o cron deve rodar pra fechar comissões do mês anterior.
 * Antes vivia como sub-aba do módulo Comissões; movido pra Configurações
 * porque é configuração do negócio (não operação diária).
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CalendarClock,
  CheckCircle2,
  History,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

export function AgendamentoComissaoCard() {
  const utils = trpc.useUtils();
  const { data: config } = (trpc as any).comissoesAgenda.obter.useQuery(undefined, {
    retry: false,
  });
  const { data: log } = (trpc as any).comissoesAgenda.listarLog.useQuery(
    { limit: 20 },
    { retry: false },
  );

  const [ativo, setAtivo] = useState(true);
  const [diaDoMes, setDiaDoMes] = useState(1);
  const [horaLocal, setHoraLocal] = useState("18:00");
  const [carregouConfig, setCarregouConfig] = useState(false);

  // Hidrata estado quando a config chega da query — apenas 1x, pra não
  // atropelar edições posteriores do usuário (ex: ele troca o dia mas
  // ainda não clicou Salvar; um refetch faria os states voltarem).
  useEffect(() => {
    if (config && !carregouConfig) {
      setAtivo(config.ativo);
      setDiaDoMes(config.diaDoMes);
      setHoraLocal(config.horaLocal);
      setCarregouConfig(true);
    }
  }, [config, carregouConfig]);

  const salvar = (trpc as any).comissoesAgenda.salvar.useMutation({
    onSuccess: () => {
      toast.success("Agendamento salvo");
      utils.comissoesAgenda.obter.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  function handleSalvar() {
    if (diaDoMes < 1 || diaDoMes > 31) {
      toast.error("Dia do mês deve ser entre 1 e 31");
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horaLocal)) {
      toast.error("Hora deve estar no formato HH:MM (24h)");
      return;
    }
    salvar.mutate({ ativo, diaDoMes, horaLocal });
  }

  // Calcula próxima execução (UI puramente informativa)
  const proximaExecucao = (() => {
    if (!ativo) return null;
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = agora.getMonth();
    const [hh, mm] = horaLocal.split(":").map(Number);
    const tentativaEsteMes = new Date(ano, mes, diaDoMes, hh, mm);
    if (tentativaEsteMes > agora) return tentativaEsteMes;
    return new Date(ano, mes + 1, diaDoMes, hh, mm);
  })();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Lançamento automático de comissões
          </CardTitle>
          <CardDescription>
            O sistema fecha as comissões do <strong>mês anterior completo</strong> automaticamente
            no dia e hora configurados. Cobranças são identificadas pela data de pagamento (Asaas)
            — não há risco de duplicação.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
            <div>
              <Label className="text-sm font-medium cursor-pointer" htmlFor="ag-ativo">
                Ativar lançamento automático
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Quando desligado, comissões só são fechadas manualmente.
              </p>
            </div>
            <input
              id="ag-ativo"
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
              className="h-5 w-9 accent-violet-600 cursor-pointer"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Dia do mês</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={diaDoMes}
                onChange={(e) => setDiaDoMes(parseInt(e.target.value) || 1)}
                disabled={!ativo}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Se o mês não tem o dia (ex: 31 em fevereiro), roda no último dia.
              </p>
            </div>
            <div>
              <Label className="text-xs">Hora local</Label>
              <Input
                type="time"
                value={horaLocal}
                onChange={(e) => setHoraLocal(e.target.value)}
                disabled={!ativo}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                No fuso horário do escritório (configurável em Configurações).
              </p>
            </div>
          </div>

          {proximaExecucao && (
            <div className="rounded-md border border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-900 p-3">
              <p className="text-xs text-violet-900 dark:text-violet-200">
                <strong>Próximo lançamento:</strong>{" "}
                {proximaExecucao.toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}{" "}
                às {horaLocal}
              </p>
              <p className="text-[10px] text-violet-700 dark:text-violet-400 mt-1">
                Vai fechar o mês anterior completo (1 ao último dia).
              </p>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button onClick={handleSalvar} disabled={salvar.isPending}>
              {salvar.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            Últimas execuções
          </CardTitle>
          <CardDescription>
            Histórico das 20 execuções mais recentes do cron — sucesso, falhas e quando rodou.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!log || log.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma execução ainda. O cron começa quando você ativar e a hora configurada chegar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Período</TableHead>
                  <TableHead className="text-xs">Atendente</TableHead>
                  <TableHead className="text-xs">Iniciado</TableHead>
                  <TableHead className="text-xs">Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">
                      {row.status === "concluido" && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Concluído
                        </span>
                      )}
                      {row.status === "falhou" && (
                        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                          <XCircle className="h-3.5 w-3.5" /> Falhou
                        </span>
                      )}
                      {row.status === "em_andamento" && (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Em andamento
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {row.periodoInicio} a {row.periodoFim}
                    </TableCell>
                    <TableCell className="text-xs">#{row.atendenteId}</TableCell>
                    <TableCell className="text-xs">
                      {row.iniciadoEm
                        ? new Date(row.iniciadoEm).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-red-600 max-w-[300px] truncate">
                      {row.mensagemErro || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
