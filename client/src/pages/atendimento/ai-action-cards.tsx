import { trpc } from "@/lib/trpc";
import { Sparkles, FileText, Calendar, Link2, Receipt, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

interface CobrancaItem {
  id: number;
  asaasPaymentId: string | null;
  valor: string;
  vencimento: string;
  status: string;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  pixQrCodePayload: string | null;
  descricao: string | null;
}

/**
 * AI Action Card — detecta intenção na última mensagem do cliente e
 * oferece workflow executável em 1 toque (gerar PIX, enviar link da
 * audiência, listar documentos, etc).
 *
 * Pattern: heurística rápida no servidor; nada de IA pra detecção (custa
 * caro + lento). IA fica reservada pro Brief Instantâneo.
 */
export function AIActionCards({
  conversaId,
  contatoNome,
  onEnviarMensagem,
}: {
  conversaId: number;
  contatoNome: string;
  onEnviarMensagem: (texto: string) => void;
}) {
  const { data } = trpc.atendimentoIa.detectarAcao.useQuery(
    { conversaId },
    { staleTime: 30_000, retry: false },
  );

  if (!data || !data.detectada) return null;

  if (data.tipo === "segunda_via_boleto") {
    return <SegundaViaBoletoCard cobrancas={data.cobrancas || []} contatoNome={contatoNome} onEnviar={onEnviarMensagem} />;
  }
  if (data.tipo === "audiencia_link") {
    return (
      <GenericActionCard
        icon={<Link2 className="h-4 w-4 text-info-fg" />}
        tipo="Link da audiência"
        descricao="Cliente está pedindo o link da videoconferência da audiência"
        acoes={[
          {
            label: "Compor mensagem com link",
            onClick: () =>
              onEnviarMensagem(
                `Olá ${contatoNome.split(" ")[0]}! Vou te enviar o link da videoconferência em instantes. Por favor, entre 10min antes do horário marcado. Qualquer dúvida me chama!`,
              ),
          },
        ]}
      />
    );
  }
  if (data.tipo === "agendar_reuniao") {
    return (
      <GenericActionCard
        icon={<Calendar className="h-4 w-4 text-info-fg" />}
        tipo="Agendar reunião"
        descricao="Cliente quer marcar uma reunião"
        acoes={[
          {
            label: "Sugerir horário",
            onClick: () =>
              onEnviarMensagem(
                `Olá ${contatoNome.split(" ")[0]}! Claro, posso te atender. Qual seria o melhor dia e horário pra você? Tenho disponibilidade essa semana de seg a sex.`,
              ),
          },
        ]}
      />
    );
  }
  if (data.tipo === "documento_pendente") {
    return (
      <GenericActionCard
        icon={<FileText className="h-4 w-4 text-warning-fg" />}
        tipo="Documentos necessários"
        descricao="Cliente pergunta quais documentos levar/enviar"
        acoes={[
          {
            label: "Compor lista padrão",
            onClick: () =>
              onEnviarMensagem(
                `Olá ${contatoNome.split(" ")[0]}! Para essa próxima etapa, você vai precisar de:\n\n• RG e CPF\n• Comprovante de residência atualizado (até 3 meses)\n• Documentos específicos do caso (envio em separado)\n\nQualquer dúvida me chama!`,
              ),
          },
        ]}
      />
    );
  }
  if (data.tipo === "risco_churn") {
    return (
      <div className="mx-4 mt-2 rounded-xl border-2 border-danger/30 bg-danger-bg p-3">
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-danger flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-black text-danger-fg uppercase tracking-wide">
                🚨 Alerta de churn detectado
              </span>
            </div>
            <p className="text-sm font-medium text-foreground leading-snug">
              Cliente demonstra sinais de insatisfação. Avalie escalar para gestor e abordar com cuidado.
            </p>
            <p className="text-xs text-danger-fg mt-1 italic">"{data.ultimaMensagem}"</p>
          </div>
        </div>
      </div>
    );
  }
  if (data.tipo === "status_processo") {
    return (
      <GenericActionCard
        icon={<FileText className="h-4 w-4 text-info-fg" />}
        tipo="Status do processo"
        descricao="Cliente pergunta sobre o andamento"
        acoes={[]}
        hint="Veja o painel lateral 'Processos' pra última movimentação e abra o módulo Processos pra detalhes."
      />
    );
  }
  return null;
}

function GenericActionCard({
  icon,
  tipo,
  descricao,
  acoes,
  hint,
}: {
  icon: React.ReactNode;
  tipo: string;
  descricao: string;
  acoes: Array<{ label: string; onClick: () => void }>;
  hint?: string;
}) {
  return (
    <div className="mx-4 mt-2 rounded-xl border-2 border-info/30 bg-gradient-to-br from-info-bg/60 via-white dark:via-muted to-info-bg/40 p-3 relative">
      <div className="absolute -top-1.5 left-3 px-1.5 py-0 rounded-full bg-info text-[9px] font-bold text-info-on uppercase tracking-wide flex items-center gap-1">
        <Sparkles className="h-2.5 w-2.5" />
        IA detectou
      </div>
      <div className="flex items-start gap-2.5 mt-0.5">
        <div className="w-7 h-7 rounded-lg bg-card border border-info/30 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{tipo}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{descricao}</p>
          {acoes.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2">
              {acoes.map((a, i) => (
                <Button
                  key={i}
                  size="sm"
                  className="h-7 text-[11px] bg-info"
                  onClick={a.onClick}
                >
                  ⚡ {a.label}
                </Button>
              ))}
            </div>
          )}
          {hint && <p className="text-[10px] text-info-fg mt-1.5 italic">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

function SegundaViaBoletoCard({
  cobrancas,
  contatoNome,
  onEnviar,
}: {
  cobrancas: CobrancaItem[];
  contatoNome: string;
  onEnviar: (texto: string) => void;
}) {
  if (!cobrancas.length) {
    return (
      <GenericActionCard
        icon={<Receipt className="h-4 w-4 text-success-fg" />}
        tipo="2ª via de boleto"
        descricao="Cliente pediu 2ª via, mas não encontrei cobranças pendentes."
        acoes={[]}
        hint="Verifique no módulo Financeiro se há cobrança manual ou em outro CPF."
      />
    );
  }

  const enviarPrimeira = () => {
    const c = cobrancas[0];
    const venc = c.vencimento ? new Date(c.vencimento + "T00:00:00").toLocaleDateString("pt-BR") : "—";
    const linhas: string[] = [];
    linhas.push(`Olá ${contatoNome.split(" ")[0]}! Segue a 2ª via do seu pagamento:`);
    linhas.push("");
    linhas.push(`💰 Valor: R$ ${c.valor}`);
    linhas.push(`📅 Vencimento: ${venc}`);
    if (c.descricao) linhas.push(`📝 ${c.descricao}`);
    if (c.invoiceUrl) {
      linhas.push("");
      linhas.push(`Link para pagamento: ${c.invoiceUrl}`);
    } else if (c.bankSlipUrl) {
      linhas.push("");
      linhas.push(`Boleto: ${c.bankSlipUrl}`);
    }
    if (c.pixQrCodePayload) {
      linhas.push("");
      linhas.push("PIX Copia e Cola:");
      linhas.push(c.pixQrCodePayload);
    }
    linhas.push("");
    linhas.push("Qualquer dúvida, estou aqui!");
    onEnviar(linhas.join("\n"));
    toast.success("Mensagem com a 2ª via composta no campo de envio.");
  };

  return (
    <div className="mx-4 mt-2 rounded-xl border-2 border-success/30 bg-gradient-to-br from-success-bg/60 via-white dark:via-muted to-success-bg/40 p-3 relative">
      <div className="absolute -top-1.5 left-3 px-1.5 py-0 rounded-full bg-success text-[9px] font-bold text-success-on uppercase tracking-wide flex items-center gap-1">
        <Sparkles className="h-2.5 w-2.5" />
        IA detectou · 1 toque resolve
      </div>
      <div className="flex items-start gap-2.5 mt-0.5">
        <div className="w-7 h-7 rounded-lg bg-card border border-success/30 flex items-center justify-center flex-shrink-0">
          <Receipt className="h-4 w-4 text-success-fg" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Pedido de 2ª via de boleto</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cobrancas.length} cobrança(s) pendente(s) encontrada(s)
          </p>

          <div className="mt-2 space-y-1">
            {cobrancas.slice(0, 3).map((c) => {
              const vencido = c.status === "OVERDUE";
              return (
                <div
                  key={c.id}
                  className={
                    "rounded-lg border px-2.5 py-1.5 text-xs flex items-center gap-2 " +
                    (vencido ? "border-danger/30 bg-danger-bg/60" : "border-success/30 bg-card")
                  }
                >
                  <span className={vencido ? "text-danger-fg font-bold" : "text-success-fg font-bold"}>
                    R$ {c.valor}
                  </span>
                  <span className="text-muted-foreground">
                    · venc {c.vencimento ? new Date(c.vencimento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
                  </span>
                  {vencido && (
                    <span className="text-[9px] px-1 py-0 rounded bg-danger-bg text-danger-fg font-bold">
                      vencida
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 mt-2.5">
            <Button
              size="sm"
              className="h-7 text-[11px] bg-success"
              onClick={enviarPrimeira}
            >
              <Send className="h-3 w-3 mr-1" />
              Compor mensagem com link/PIX
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
