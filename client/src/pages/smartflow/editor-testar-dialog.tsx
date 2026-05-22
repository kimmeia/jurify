import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { GatilhoSmartflow } from "@shared/smartflow-types";

/**
 * Modal de teste rápido — executa o cenário com um contexto custom sem sair
 * do editor. Chama `smartflow.executar` (mesma procedure do "Executar agora"
 * da lista). Mostra resultado inline: status, passos rodados, mensagens
 * geradas e erro (se houver).
 *
 * O contexto inicial é montado a partir de um template específico do
 * gatilho — assim o usuário não precisa adivinhar nomes de variáveis.
 */
export function EditorTestarDialog({
  open,
  onOpenChange,
  cenarioId,
  gatilho,
  dirty,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cenarioId: number | null;
  gatilho: GatilhoSmartflow;
  /** True quando há alterações não salvas — o teste roda o que está no banco, não o que está no editor. */
  dirty: boolean;
}) {
  const [contextoJson, setContextoJson] = useState(() => exemploContexto(gatilho));
  const [resultado, setResultado] = useState<{
    sucesso: boolean;
    erro?: string;
    respostas?: string[];
    execId?: number;
  } | null>(null);

  const executarMut = (trpc as any).smartflow.executar.useMutation({
    onSuccess: (r: any) => {
      setResultado({
        sucesso: !!r.success,
        erro: r.erro,
        respostas: r.respostas,
        execId: r.execId,
      });
      if (r.success) toast.success("Execução de teste concluída!");
      else toast.error(r.erro || "Falha na execução de teste");
    },
    onError: (e: any) => {
      setResultado({ sucesso: false, erro: e.message });
      toast.error(e.message);
    },
  });

  const handleExecutar = () => {
    if (!cenarioId) return;
    let contextoInicial: Record<string, unknown> = {};
    if (contextoJson.trim()) {
      try {
        contextoInicial = JSON.parse(contextoJson);
        if (typeof contextoInicial !== "object" || contextoInicial == null) {
          throw new Error("JSON precisa ser um objeto");
        }
      } catch (err: any) {
        toast.error(`JSON inválido: ${err.message}`);
        return;
      }
    }
    setResultado(null);
    executarMut.mutate({ cenarioId, contextoInicial });
  };

  const limparResultado = () => {
    setResultado(null);
    setContextoJson(exemploContexto(gatilho));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-emerald-600" />
            Testar cenário
          </DialogTitle>
          <DialogDescription>
            Roda o cenário com um contexto de teste personalizado. Útil pra
            simular um pagamento, uma mensagem, etc., sem esperar o gatilho real.
          </DialogDescription>
        </DialogHeader>

        {dirty && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong>Atenção:</strong> você tem alterações não salvas. O teste
              vai rodar a versão <strong>salva no banco</strong>, não a que
              está no editor agora. Salve antes pra testar suas mudanças.
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold">
                Contexto inicial (JSON)
              </label>
              <button
                type="button"
                onClick={() => setContextoJson(exemploContexto(gatilho))}
                className="text-[10px] text-violet-600 hover:underline flex items-center gap-1"
              >
                <Sparkles className="h-3 w-3" /> Carregar exemplo do gatilho
              </button>
            </div>
            <Textarea
              value={contextoJson}
              onChange={(e) => setContextoJson(e.target.value)}
              className="font-mono text-[11px] min-h-[160px]"
              placeholder='{ "mensagem": "Quero agendar", "nomeCliente": "João" }'
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Os campos que você colocar aqui vão pro contexto inicial da execução.
              Variáveis disponíveis variam por gatilho — comece pelo exemplo.
            </p>
          </div>

          {resultado && (
            <div
              className={`rounded-lg border p-3 ${
                resultado.sucesso
                  ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                  : "border-red-300 bg-red-50 dark:bg-red-950/30"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {resultado.sucesso ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600" />
                )}
                <span
                  className={`text-sm font-semibold ${
                    resultado.sucesso
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-red-700 dark:text-red-300"
                  }`}
                >
                  {resultado.sucesso ? "Execução concluída" : "Falhou"}
                </span>
                {resultado.execId && (
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    Exec #{resultado.execId}
                  </Badge>
                )}
              </div>
              {resultado.erro && (
                <p className="text-xs text-red-700 dark:text-red-300 mb-2">
                  {resultado.erro}
                </p>
              )}
              {resultado.respostas && resultado.respostas.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                    Respostas geradas ({resultado.respostas.length})
                  </p>
                  <div className="space-y-1">
                    {resultado.respostas.map((r, i) => (
                      <div
                        key={i}
                        className="text-xs bg-card border rounded px-2 py-1.5 whitespace-pre-wrap"
                      >
                        {r}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {resultado.sucesso && (!resultado.respostas || resultado.respostas.length === 0) && (
                <p className="text-[11px] text-muted-foreground italic">
                  Cenário rodou sem gerar respostas (passos sem retorno textual).
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          {resultado && (
            <Button variant="outline" size="sm" onClick={limparResultado}>
              Nova execução
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            size="sm"
            onClick={handleExecutar}
            disabled={executarMut.isPending || !cenarioId}
            className="bg-gradient-to-br from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          >
            {executarMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1.5" />
            )}
            Executar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Gera um contexto de exemplo realista por gatilho — ajuda o usuário a saber
 * que variáveis o cenário espera receber sem precisar consultar docs.
 */
function exemploContexto(gatilho: GatilhoSmartflow): string {
  const exemplos: Record<GatilhoSmartflow, Record<string, unknown>> = {
    whatsapp_mensagem: {
      mensagem: "Olá, gostaria de agendar uma consulta",
      nomeCliente: "João Silva",
      telefoneCliente: "(11) 99999-0000",
    },
    mensagem_canal: {
      mensagem: "Olá, gostaria de agendar uma consulta",
      nomeCliente: "João Silva",
      telefoneCliente: "(11) 99999-0000",
      canalTipo: "whatsapp_qr",
    },
    novo_lead: {
      contatoId: 42,
      nomeCliente: "Maria Souza",
      telefoneCliente: "(11) 98888-1111",
      emailCliente: "maria@example.com",
      origemLead: "site",
    },
    pagamento_recebido: {
      pagamentoId: "pay_TESTE_123",
      pagamentoValor: 150000,
      pagamentoDescricao: "Honorários iniciais",
      pagamentoTipo: "PIX",
      nomeCliente: "João Silva",
      contatoId: 42,
      primeiraCobrancaDoCliente: true,
      percentualPago: 50,
    },
    pagamento_vencido: {
      pagamentoId: "pay_TESTE_456",
      pagamentoValor: 80000,
      pagamentoDescricao: "Mensalidade abril",
      vencimento: "2026-04-01",
      diasAtraso: 5,
      nomeCliente: "João Silva",
      contatoId: 42,
    },
    pagamento_proximo_vencimento: {
      pagamentoId: "pay_TESTE_789",
      pagamentoValor: 80000,
      pagamentoDescricao: "Mensalidade maio",
      vencimento: "2026-05-25",
      diasAteVencer: 3,
      nomeCliente: "João Silva",
      contatoId: 42,
    },
    agendamento_criado: {
      agendamentoId: "booking_TESTE_123",
      horarioEscolhido: "2026-06-01T14:00:00",
      nomeCliente: "Maria Souza",
      emailCliente: "maria@example.com",
    },
    agendamento_cancelado: {
      agendamentoId: "booking_TESTE_123",
      horarioEscolhido: "2026-06-01T14:00:00",
      nomeCliente: "Maria Souza",
      motivoCancelamento: "Conflito de agenda",
    },
    agendamento_remarcado: {
      agendamentoId: "booking_TESTE_123",
      horarioEscolhido: "2026-06-08T14:00:00",
      horarioAnterior: "2026-06-01T14:00:00",
      nomeCliente: "Maria Souza",
    },
    agendamento_lembrete: {
      agendamentoId: "booking_TESTE_123",
      horarioEscolhido: "2026-06-01T14:00:00",
      nomeCliente: "Maria Souza",
      emailCliente: "maria@example.com",
    },
    manual: {},
  };
  return JSON.stringify(exemplos[gatilho] ?? {}, null, 2);
}
