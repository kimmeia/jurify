import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MessageCircle, Scale, DollarSign, Calendar, FileSignature, Loader2 } from "lucide-react";

// "Ligações" foi removido: o Twilio (router-twilio.ts) hoje só dispara/lê
// status da chamada — não persiste histórico no banco. Sem tabela própria,
// o filtro ficava eternamente vazio e induzia o atendente a procurar dado
// que nunca chegava. Quando o histórico de ligações for persistido (tabela
// `ligacoes_twilio` + emissão no router-atendimento-ia.linhaTempoUnificada),
// devolva o filtro pra cá.
const FILTROS = [
  { v: "todos", l: "Todos", icon: null, cor: "text-violet-700" },
  { v: "mensagem", l: "WhatsApp", icon: MessageCircle, cor: "text-emerald-700" },
  { v: "ato", l: "Processos", icon: Scale, cor: "text-blue-700" },
  { v: "pagamento", l: "Financeiro", icon: DollarSign, cor: "text-emerald-700" },
  { v: "agenda", l: "Agenda", icon: Calendar, cor: "text-amber-700" },
  { v: "documento", l: "Documentos", icon: FileSignature, cor: "text-fuchsia-700" },
] as const;

function tipoCfg(tipo: string) {
  switch (tipo) {
    case "mensagem":
      return { icon: MessageCircle, bg: "bg-emerald-50", border: "border-emerald-200", iconBg: "bg-emerald-100", text: "text-emerald-700" };
    case "ato":
      return { icon: Scale, bg: "bg-blue-50", border: "border-blue-200", iconBg: "bg-blue-100", text: "text-blue-700" };
    case "pagamento":
      return { icon: DollarSign, bg: "bg-emerald-50", border: "border-emerald-300", iconBg: "bg-emerald-100", text: "text-emerald-700" };
    case "agenda":
      return { icon: Calendar, bg: "bg-amber-50", border: "border-amber-200", iconBg: "bg-amber-100", text: "text-amber-700" };
    case "documento":
      return { icon: FileSignature, bg: "bg-fuchsia-50", border: "border-fuchsia-200", iconBg: "bg-fuchsia-100", text: "text-fuchsia-700" };
    default:
      return { icon: MessageCircle, bg: "bg-muted/30", border: "border-border", iconBg: "bg-muted", text: "text-foreground" };
  }
}

function dataLabel(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86400000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, hoje)) return "Hoje";
  if (sameDay(d, ontem)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Linha do Tempo Unificada — toda a vida jurídica do cliente em uma
 * única timeline cronológica, com filtros por canal/tipo.
 *
 * Inédito no nicho jurídico: outros SaaS têm WhatsApp aqui, processos
 * ali, financeiro acolá. Este é o único que junta TUDO numa visão só.
 */
export function LinhaTempoUnificada({
  open,
  onOpenChange,
  contatoId,
  contatoNome,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contatoId: number;
  contatoNome: string;
}) {
  const [filtro, setFiltro] = useState<string>("todos");
  const { data, isLoading } = trpc.atendimentoIa.linhaTempoUnificada.useQuery(
    { contatoId, limite: 80 },
    { enabled: open, staleTime: 60_000 },
  );

  const eventos = data?.eventos || [];
  const filtrados = filtro === "todos" ? eventos : eventos.filter((e) => e.tipo === filtro);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b bg-gradient-to-r from-indigo-50/60 to-violet-50/60">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center">
              <Scale className="h-4 w-4 text-white" />
            </div>
            <span>Linha do Tempo · {contatoNome}</span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Vida jurídica completa: WhatsApp + atos processuais + financeiro + agenda + documentos
          </p>

          <div className="flex items-center gap-1 mt-3 -mb-1 overflow-x-auto pb-1">
            {FILTROS.map((f) => {
              const Icon = f.icon;
              const ativo = filtro === f.v;
              const n =
                f.v === "todos"
                  ? data?.counts.total
                  : f.v === "mensagem"
                    ? data?.counts.mensagens
                    : f.v === "ato"
                      ? data?.counts.atos
                      : f.v === "pagamento"
                        ? data?.counts.pagamentos
                        : f.v === "agenda"
                          ? data?.counts.agenda
                          : f.v === "documento"
                            ? data?.counts.documentos
                            : 0;
              return (
                <button
                  key={f.v}
                  onClick={() => setFiltro(f.v)}
                  className={
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors shrink-0 " +
                    (ativo
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white text-foreground hover:bg-muted border-border")
                  }
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  <span>{f.l}</span>
                  {typeof n === "number" && (
                    <span className={"text-[10px] " + (ativo ? "opacity-80" : "text-muted-foreground")}>
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              <p className="text-xs text-muted-foreground mt-2">Reunindo eventos…</p>
            </div>
          ) : filtrados.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              Nenhum evento encontrado{filtro !== "todos" ? " com esse filtro" : ""}.
            </p>
          ) : (
            <div className="relative pl-6">
              {/* Linha vertical */}
              <div className="absolute left-[10px] top-2 bottom-2 w-px bg-gradient-to-b from-transparent via-border to-transparent" />

              <div className="space-y-3">
                {filtrados.map((e, i) => {
                  const cfg = tipoCfg(e.tipo);
                  const Icon = cfg.icon;
                  const mostraData = i === 0 || dataLabel(filtrados[i - 1].data) !== dataLabel(e.data);
                  return (
                    <div key={e.id} className="relative">
                      {mostraData && (
                        <div className="absolute -left-6 -top-1">
                          <span className="text-[10px] font-bold text-muted-foreground bg-background px-1">
                            {dataLabel(e.data)}
                          </span>
                        </div>
                      )}
                      <div className="absolute -left-[16px] top-3 w-2 h-2 rounded-full bg-violet-500 ring-4 ring-violet-100" />
                      <div className={"rounded-xl border " + cfg.border + " " + cfg.bg + " px-3 py-2.5 flex items-start gap-3"}>
                        <div className={"w-7 h-7 rounded-lg " + cfg.iconBg + " flex items-center justify-center flex-shrink-0"}>
                          <Icon className={"h-3.5 w-3.5 " + cfg.text} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={"text-[10px] font-bold " + cfg.text + " uppercase tracking-wide truncate"}>
                              {e.titulo}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(e.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {e.canal && (
                              <span className="text-[9px] px-1 rounded bg-white/70 text-muted-foreground">
                                {e.canal}
                              </span>
                            )}
                          </div>
                          {e.resumo && (
                            <p className="text-xs text-foreground/90 leading-snug break-words">{e.resumo}</p>
                          )}
                          {e.meta?.cnj && (
                            <p className="text-[10px] font-mono text-muted-foreground mt-1">
                              CNJ {e.meta.cnj}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
