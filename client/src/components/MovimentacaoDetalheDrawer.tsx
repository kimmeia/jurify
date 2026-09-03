/**
 * Painel de detalhe de uma movimentação.
 *
 * A ordem da tela responde às perguntas na ordem em que o advogado as faz:
 * tenho prazo? o que o juiz decidiu? o que ele escreveu exatamente? o que
 * veio antes? — e só então as ações. A versão anterior mostrava o rótulo do
 * PJe num box cinza e nada mais, o que respondia só "esse processo mexeu".
 *
 * Quando o documento não pôde ser lido (sigilo, PDF escaneado, tribunal que
 * não expõe), a tela DIZ isso. Resumo vazio disfarçado de resumo é pior que
 * assumir a falha: o advogado deixa de abrir os autos confiando em algo que
 * não existe.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { dataCalendarioISO, diaSemanaCalendario, formatarDataCalendario } from "@shared/data-calendario";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ExternalLink,
  FileText,
  Loader2,
  CalendarClock,
  CheckSquare,
  Archive,
  Sparkles,
  AlertTriangle,
  Check,
  Lock,
  ChevronDown,
  ChevronUp,
  Download,
  Minus,
  X,
} from "lucide-react";

interface Props {
  eventoId: number | null;
  onClose: () => void;
}

const DESFECHO_META: Record<string, { label: string; emoji: string; cls: string }> = {
  favoravel: { label: "Favorável", emoji: "🟢", cls: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50" },
  desfavoravel: { label: "Desfavorável", emoji: "🔴", cls: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50" },
  parcial: { label: "Parcialmente favorável", emoji: "🟡", cls: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50" },
  neutro: { label: "Sem mérito", emoji: "⚪", cls: "bg-muted text-muted-foreground border-border" },
};

const ATO_LABEL: Record<string, string> = {
  decisao: "⚖️ Decisão",
  sentenca: "⚖️ Sentença",
  acordao: "⚖️ Acórdão",
  despacho: "📄 Despacho",
  intimacao: "📬 Intimação",
  audiencia: "📅 Audiência",
  expediente: "📎 Expediente",
  outro: "📄 Ato processual",
};

/** Por que não há teor, em linguagem que diz o que fazer a seguir. */
const TEOR_FALHA: Record<
  string,
  { titulo: string; detalhe: string; podeBaixar: boolean; podeAnalisar: boolean }
> = {
  sem_documento: {
    // Só vale quando o rótulo TAMBÉM não traz número de peça. Quando traz, o
    // texto é substituído abaixo — afirmar "não anexou peça nenhuma" com o
    // número da peça escrito no próprio rótulo é dizer o oposto do que se vê.
    titulo: "Esta movimentação não tem documento",
    detalhe:
      "É um movimento de expediente — o tribunal não anexou peça nenhuma. O rótulo abaixo é tudo o que existe.",
    podeBaixar: false,
    podeAnalisar: false,
  },
  indisponivel: {
    titulo: "O documento não pôde ser aberto",
    detalhe:
      "Em geral é segredo de justiça ou peça sigilosa. Só consultando os autos diretamente no tribunal.",
    podeBaixar: false,
    podeAnalisar: false,
  },
  erro: {
    titulo: "Falhou ao baixar o documento",
    detalhe: "Pode ser instabilidade do tribunal ou PDF escaneado (sem texto). Vale tentar de novo.",
    podeBaixar: true,
    podeAnalisar: true,
  },
  pendente: {
    titulo: "Documento ainda não baixado",
    detalhe:
      "O monitoramento abre no máximo 3 documentos por consulta pra não sobrecarregar o tribunal. Este ficou na fila.",
    podeBaixar: true,
    podeAnalisar: false,
  },
};

const POLO_LABEL: Record<string, string> = { ativo: "Autor", passivo: "Réu", terceiro: "Terceiro" };

const STATUS_PEDIDO_META = {
  deferido: { label: "Deferido", cls: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50", icone: Check },
  parcial: { label: "Parcial", cls: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50", icone: Minus },
  negado: { label: "Negado", cls: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50", icone: X },
  prejudicado: { label: "Prejudicado", cls: "bg-muted text-muted-foreground border-border", icone: Minus },
} as const;

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function dataBR(d: Date | string) {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function diaSemana(d: Date | string) {
  return diaSemanaCalendario(d);
}

export default function MovimentacaoDetalheDrawer({ eventoId, onClose }: Props) {
  const [, setLocation] = useLocation();
  const [criarPrazoOpen, setCriarPrazoOpen] = useState(false);
  const [criarTarefaOpen, setCriarTarefaOpen] = useState(false);
  const [teorExpandido, setTeorExpandido] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading, error, refetch } = trpc.movimentacoes.detalhe.useQuery(
    { eventoId: eventoId ?? 0 },
    { enabled: eventoId !== null && eventoId > 0, retry: false },
  );

  const analisarMut = trpc.movimentacoes.analisar.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        toast.success("Movimentação analisada", {
          description: r.prazoCriado ? "Um prazo foi sugerido a partir do documento." : undefined,
        });
        refetch();
        utils.movimentacoes.central.invalidate();
      } else {
        toast.error("Não deu para analisar", { description: r.motivo });
      }
    },
    onError: (e) => toast.error("Falha ao analisar", { description: e.message }),
  });

  const baixarMut = trpc.movimentacoes.baixarTeor.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        toast.success("Documento baixado", {
          description: r.analisado ? "Já analisado — veja o resumo acima." : undefined,
        });
        refetch();
        utils.movimentacoes.central.invalidate();
      } else {
        toast.error("Não deu para baixar", { description: r.motivo });
        // Recarrega também no fracasso: o motivo fica gravado no evento, e sem
        // isto a tela fica idêntica depois do clique. O toast some em segundos
        // e a impressão que sobra é a de que o botão não fez nada.
        refetch();
      }
    },
    onError: (e) => toast.error("Falha ao baixar", { description: e.message }),
  });

  const marcarMut = trpc.movimentacoes.marcarLidas.useMutation({
    onSuccess: () => {
      utils.movimentacoes.central.invalidate();
      onClose();
    },
  });

  const open = eventoId !== null;
  const prazo = data?.prazo;
  const prazoAberto = prazo && prazo.status === "pendente";
  const falhaTeorBase = data && data.teorStatus !== "ok" ? TEOR_FALHA[data.teorStatus] : null;
  /**
   * O rótulo do PJe escreve o número e o tipo da peça ("… 226277277 -
   * Despacho"). Quando ele traz isso, o documento EXISTE — a ausência de link
   * é limite nosso de captura, não fato do tribunal. Dizer "não anexou peça
   * nenhuma" nesse caso é afirmar o contrário do que está escrito na tela.
   */
  const pecaIdentificada = data?.documentoId
    ? `${data.documentoTipo ?? "Documento"} nº ${data.documentoId}`
    : null;
  const falhaTeor =
    falhaTeorBase && pecaIdentificada
      ? {
          ...falhaTeorBase,
          titulo: `${data!.documentoTipo ?? "Documento"} identificado, ainda não lido`,
          detalhe: `O tribunal publicou este movimento com a peça ${pecaIdentificada}. Ela existe — só não foi aberta ainda.`,
          podeBaixar: true,
        }
      : falhaTeorBase;
  // Só soma o que o juiz de fato concedeu — pedido negado com valor no texto
  // entraria como se fosse dinheiro a receber.
  const totalDeferido = (data?.itens ?? []).reduce(
    (acc, i) => acc + (i.status === "deferido" || i.status === "parcial" ? (i.valor ?? 0) : 0),
    0,
  );

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0">
        {/* Faixa de urgência: a primeira pergunta é sempre "tenho prazo?" */}
        {prazoAberto && prazo.data && (
          <div className="bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-800/50 px-5 py-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-rose-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-rose-900 dark:text-rose-200">
                {prazo.tipo === "audiencia" ? "Você tem audiência marcada" : "Você tem prazo neste processo"}
              </p>
              <p className="text-xs text-rose-700 dark:text-rose-300 font-medium">
                {prazo.dias ? `${prazo.dias} dias ${prazo.uteis ? "úteis" : "corridos"} · ` : ""}
                {prazo.tipo === "audiencia" ? "em" : "vence"} {diaSemana(prazo.data)}, {formatarDataCalendario(prazo.data)}
              </p>
            </div>
            {typeof prazo.diasUteisRestantes === "number" && (
              <div className="ml-auto text-right shrink-0">
                <p className="text-xl font-bold text-rose-600 dark:text-rose-400 leading-none">
                  {Math.abs(prazo.diasUteisRestantes)}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                  {prazo.diasUteisRestantes < 0 ? "dias vencido" : "dias úteis"}
                </p>
              </div>
            )}
          </div>
        )}

        <SheetHeader className="px-5 pt-4 pb-0">
          <SheetTitle className="sr-only">Detalhe da movimentação</SheetTitle>
          <SheetDescription className="sr-only">
            O que o tribunal publicou neste processo.
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="px-5 py-6 space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : error?.data?.code === "NOT_FOUND" ? (
          <div className="px-5 py-10 flex flex-col items-center gap-2 text-center">
            <Archive className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium">Movimentação arquivada</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Esta movimentação foi limpa do histórico. O título e a data continuam no inbox de
              notificações.
            </p>
          </div>
        ) : error ? (
          <div className="px-5 py-6 text-sm text-destructive">
            Não foi possível carregar: {error.message}
          </div>
        ) : data ? (
          <div className="px-5 pb-6 space-y-5">
            <div>
              <h2 className="text-lg font-bold leading-snug tracking-tight">{data.titulo}</h2>

              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {data.ato && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/50">
                    {ATO_LABEL[data.ato] ?? ATO_LABEL.outro}
                  </span>
                )}
                {data.desfecho && DESFECHO_META[data.desfecho] && (
                  <span
                    className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${DESFECHO_META[data.desfecho].cls}`}
                  >
                    {DESFECHO_META[data.desfecho].emoji} {DESFECHO_META[data.desfecho].label}
                  </span>
                )}
                {data.providencia?.exigida && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50">
                    ⏰ Exige providência sua
                  </span>
                )}
                {data.relevancia === "rotina" && !data.providencia?.exigida && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-muted text-muted-foreground border-border">
                    📄 Rotina
                  </span>
                )}
            {/* Fonte do que está escrito acima. Sem o documento, o título saiu
                do rótulo do tribunal — e isso precisa estar visível antes de
                qualquer conteúdo, não depois. */}
            {data.teor ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200 border-violet-300">
                <FileText className="h-3 w-3" />
                Lido no documento
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border-amber-300">
                <Lock className="h-3 w-3" />
                Só o rótulo do tribunal
              </span>
            )}
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-3 pb-3 border-b text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {data.partesRotulo || data.cliente || data.searchKey || "(sem apelido)"}
                </span>
                {data.clientePolo && POLO_LABEL[data.clientePolo] && (
                  <span className="rounded-full bg-muted text-muted-foreground px-1.5 py-px text-[10px] font-bold">
                    nosso cliente: {POLO_LABEL[data.clientePolo]}
                  </span>
                )}
                <span className="text-muted-foreground/50">•</span>
                <span className="font-mono font-medium text-muted-foreground">{data.cnj || "—"}</span>
                {data.tribunal && (
                  <>
                    <span className="text-muted-foreground/50">•</span>
                    <Badge variant="outline" className="text-[9px] uppercase h-4 px-1.5">
                      {data.tribunal}
                    </Badge>
                  </>
                )}
                <span className="text-muted-foreground/50">•</span>
                <span>
                  Intimação em <span className="font-semibold text-foreground">{dataBR(data.dataEvento)}</span>
                </span>
              </div>
            </div>

            {/* Sem o documento, buscar o teor É o assunto do painel — não um
                botão no rodapé de um resumo que não sabe de nada. */}
            {!data.teor && (
              <section className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3.5">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
                  <Lock className="h-4 w-4 shrink-0" />
                  {falhaTeor?.titulo ?? "Documento indisponível"}
                </p>
                <p className="text-[12.5px] text-amber-800 dark:text-amber-200 mt-1 leading-snug">
                  {falhaTeor?.detalhe}
                  {data.teorErro ? ` (${data.teorErro})` : ""}
                  {pecaIdentificada
                    ? " Até abrir, o que temos é o rótulo publicado pelo tribunal:"
                    : " Sem o documento, a única coisa que sabemos é o rótulo publicado pelo tribunal:"}
                </p>
                <div className="mt-2.5 rounded-lg border border-amber-200 dark:border-amber-800/50 bg-card px-3 py-2">
                  <p className="text-[9.5px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Rótulo publicado pelo tribunal
                  </p>
                  <p className="text-[12.5px] text-foreground/90 mt-0.5">{data.rotulo}</p>
                  {pecaIdentificada && (
                    <p className="text-[11.5px] font-semibold text-amber-900 dark:text-amber-200 mt-1.5 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      {pecaIdentificada}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {falhaTeor?.podeBaixar && (data.teorUrl || data.documentoId) && (
                    <>
                      <Button
                        size="sm"
                        className="bg-amber-600 hover:bg-amber-700 text-white"
                        disabled={baixarMut.isPending}
                        onClick={() => baixarMut.mutate({ eventoId: data.id })}
                      >
                        {baixarMut.isPending ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4 mr-1.5" />
                        )}
                        Buscar o documento agora
                      </Button>
                      <span className="text-[11px] text-amber-800 dark:text-amber-200">o resumo sai junto</span>
                    </>
                  )}
                  <div className="flex-1" />
                  {data.teorUrl && (
                    <a
                      href={data.teorUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11.5px] font-bold text-amber-800 dark:text-amber-200 underline underline-offset-2"
                    >
                      Abrir no tribunal ↗
                    </a>
                  )}
                </div>
                {falhaTeor?.podeAnalisar && (
                  <button
                    type="button"
                    className="mt-2 text-[11px] text-amber-800/80 dark:text-amber-200 underline underline-offset-2 disabled:opacity-50"
                    disabled={analisarMut.isPending}
                    onClick={() => analisarMut.mutate({ eventoId: data.id })}
                  >
                    Analisar só pelo rótulo (resultado pobre)
                  </button>
                )}
              </section>
            )}

            {/* O que foi decidido, pedido a pedido.
                "Procedente em parte" sozinho não diz nada — o que o advogado
                precisa é o que caiu, o que passou e quanto. */}
            {data.itens.length > 0 && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2 mb-2">
                  O que foi decidido, pedido a pedido
                  <span className="bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800/50 rounded-full px-1.5 py-px text-[8.5px]">
                    RESUMO IA
                  </span>
                </p>
                <div className="rounded-lg border divide-y overflow-hidden">
                  {data.itens.map((item, i) => {
                    const meta = STATUS_PEDIDO_META[item.status];
                    const Icone = meta.icone;
                    return (
                      <div key={i} className="flex items-start gap-3 px-3 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold shrink-0 mt-px ${meta.cls}`}
                        >
                          <Icone className="h-3 w-3" />
                          {meta.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold leading-snug">{item.pedido}</p>
                          {item.razao && (
                            <p className="text-[11.5px] text-muted-foreground leading-snug mt-px">{item.razao}</p>
                          )}
                        </div>
                        <span
                          className={`text-[13px] font-bold tabular-nums shrink-0 ${
                            item.valor != null ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground/40"
                          }`}
                        >
                          {item.valor != null ? formatBRL(item.valor) : "—"}
                        </span>
                      </div>
                    );
                  })}
                  {totalDeferido > 0 && (
                    <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/40">
                      <span className="text-[12.5px] font-bold flex-1">Resultado da decisão</span>
                      <span className="text-[15px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                        {formatBRL(totalDeferido)}
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* O que o juiz decidiu — só quando há o que dizer. Sem o
                documento este bloco não aparece: o painel não promete
                resumo do que não leu. */}
            {data.pontos.length > 0 ? (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2 mb-2">
                  O que o juiz decidiu
                  <span className="bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800/50 rounded-full px-1.5 py-px text-[8.5px]">
                    RESUMO IA
                  </span>
                </p>
                <ul className="space-y-1.5">
                  {data.pontos.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed">
                      <span className="h-1.5 w-1.5 rounded-full bg-violet-600 shrink-0 mt-[7px]" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : data.teor ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full border-violet-200 dark:border-violet-800/50 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                disabled={analisarMut.isPending}
                onClick={() => analisarMut.mutate({ eventoId: data.id })}
              >
                {analisarMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                )}
                Analisar com IA
              </Button>
            ) : null}

            {/* Exatamente o que ele escreveu */}
            {data.teor && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                  Exatamente o que ele escreveu
                </p>

                <div className="rounded-lg border overflow-hidden">
                  <div className="bg-muted/40 border-b px-3 py-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                    <FileText className="h-3 w-3" />
                    <span className="truncate">{data.teorNome || "Documento do processo"}</span>
                    {data.teorUrl && (
                      <a
                        href={data.teorUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto text-violet-700 dark:text-violet-300 font-bold hover:underline shrink-0"
                      >
                        Abrir no tribunal ↗
                      </a>
                    )}
                  </div>
                  <div
                    className={`px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-foreground/90 ${
                      teorExpandido ? "" : "max-h-56 overflow-hidden relative"
                    }`}
                  >
                    <TeorComGrifo teor={data.teor} trecho={data.trechoGrifado} />
                    {!teorExpandido && (
                      <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-background to-transparent" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTeorExpandido((v) => !v)}
                    className="w-full border-t py-1.5 text-[11px] font-bold text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30 flex items-center justify-center gap-1"
                  >
                    {teorExpandido ? (
                      <>
                        Recolher <ChevronUp className="h-3 w-3" />
                      </>
                    ) : (
                      <>
                        Ver íntegra <ChevronDown className="h-3 w-3" />
                      </>
                    )}
                  </button>
                  </div>
              </section>
            )}

            {/* Prazo com a conta aberta */}
            {prazoAberto && prazo.data && (
              <section className="rounded-xl border-2 border-rose-200 dark:border-rose-800/50 bg-rose-50/40 dark:bg-rose-950/30 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                      {prazo.tipo === "audiencia" ? "Audiência designada" : "Prazo detectado no documento"}
                    </p>
                    <p className="text-base font-bold mt-0.5">
                      {prazo.tipo === "audiencia" ? "Em" : "Vence"} {formatarDataCalendario(prazo.data)} · {diaSemana(prazo.data)}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5">{prazo.titulo}</p>
                  </div>
                  <Button size="sm" className="bg-rose-600 hover:bg-rose-700 shrink-0" onClick={() => setCriarPrazoOpen(true)}>
                    <CalendarClock className="h-3.5 w-3.5 mr-1.5" />
                    Criar na agenda
                  </Button>
                </div>
                {prazo.motivo && (
                  <p className="mt-2.5 pt-2 border-t border-dashed border-rose-200 dark:border-rose-800/50 text-[11px] text-muted-foreground leading-snug">
                    {prazo.motivo}
                  </p>
                )}
              </section>
            )}

            {/* Contexto do processo */}
            {data.anteriores.length > 0 && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                  O que veio antes neste processo
                </p>
                <div className="rounded-lg border divide-y">
                  {data.anteriores.map((a) => (
                    <div key={a.id} className="flex items-start gap-2.5 px-3 py-2">
                      <span className="text-[10.5px] font-bold text-muted-foreground tabular-nums w-10 shrink-0 pt-px">
                        {format(new Date(a.dataEvento), "dd/MM")}
                      </span>
                      <span className="flex-1 text-[12px] text-foreground/90 leading-snug">{a.titulo}</span>
                      <span
                        className={`text-[9.5px] font-bold rounded-full px-2 py-0.5 shrink-0 ${
                          a.relevancia === "rotina"
                            ? "bg-muted text-muted-foreground"
                            : "bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300"
                        }`}
                      >
                        {a.relevancia === "rotina" ? "Rotina" : "Relevante"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Ações */}
            <section className="flex flex-wrap items-center gap-2 pt-1 border-t pt-3">
              {!prazoAberto && (
                <Button size="sm" variant="outline" onClick={() => setCriarPrazoOpen(true)}>
                  <CalendarClock className="h-3.5 w-3.5 mr-1.5" />
                  Criar prazo
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setCriarTarefaOpen(true)}>
                <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                Criar tarefa
              </Button>
              {!data.lido && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
                  disabled={marcarMut.isPending}
                  onClick={() => marcarMut.mutate({ eventoIds: [data.id] })}
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Já resolvi
                </Button>
              )}
              {data.monitoramentoId && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setLocation("/processos?tab=movimentacoes");
                    onClose();
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Monitoramento
                </Button>
              )}
            </section>

            <p className="text-[10px] text-muted-foreground leading-snug">
              Coletado de {(data.fonte ?? "").toUpperCase()} em {dataBR(data.coletadoEm)}. Resumo e prazo
              gerados por IA a partir do documento — confira a íntegra antes de peticionar.
            </p>
          </div>
        ) : null}
      </SheetContent>

      {data && (
        <>
          <CriarPrazoDialog
            open={criarPrazoOpen}
            onClose={() => setCriarPrazoOpen(false)}
            evento={data}
            onSuccess={() => {
              setCriarPrazoOpen(false);
              onClose();
            }}
          />
          <CriarTarefaDialog
            open={criarTarefaOpen}
            onClose={() => setCriarTarefaOpen(false)}
            evento={data}
            onSuccess={() => {
              setCriarTarefaOpen(false);
              onClose();
            }}
          />
        </>
      )}
    </Sheet>
  );
}

/**
 * Grifa dentro do teor o trecho que fundamenta o prazo. O servidor só manda
 * `trecho` quando ele existe literalmente no documento, então aqui um
 * `indexOf` basta — e se não achar, mostra o teor limpo em vez de arriscar
 * um destaque no lugar errado.
 */
function TeorComGrifo({ teor, trecho }: { teor: string; trecho: string | null }) {
  if (!trecho) return <>{teor}</>;
  const i = teor.indexOf(trecho);
  if (i < 0) return <>{teor}</>;
  return (
    <>
      {teor.slice(0, i)}
      <mark className="bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 font-semibold rounded px-0.5">{trecho}</mark>
      {teor.slice(i + trecho.length)}
    </>
  );
}

type EventoDialog = {
  id: number;
  cnj: string | null;
  cliente: string | null;
  searchKey: string | null;
  dataEvento: Date | string;
  rotulo: string;
  titulo: string;
  teor: string | null;
  prazo: {
    titulo: string;
    data: Date | string | null;
    dias: number | null;
    uteis: boolean;
    motivo: string | null;
  } | null;
};

interface DialogProps {
  open: boolean;
  onClose: () => void;
  evento: EventoDialog;
  onSuccess: () => void;
}

function nomeCliente(e: EventoDialog) {
  return e.cliente || e.searchKey || "cliente";
}

/** Fallback quando não há prazo calculado: hoje + 5 dias, só pra abrir o
 *  formulário com algo. A data boa vem do `prazo`, calculada no servidor com
 *  as regras do CPC. */
function dataFallback(): string {
  return format(new Date(Date.now() + 5 * 86_400_000), "yyyy-MM-dd");
}

/**
 * Quem pode ficar com o prazo/tarefa.
 *
 * Mesma régua da Agenda: passar trabalho pra outra pessoa exige "ver todos"
 * em agenda. Quem não tem cria pra si, e o seletor não aparece.
 */
function useEquipe() {
  const { data } = (trpc.agenda as any).listarColaboradores?.useQuery?.(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  }) ?? { data: undefined };
  const { data: perms } = (trpc as any).permissoes?.minhasPermissoes?.useQuery?.(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  }) ?? { data: null };
  const colaboradores = (data || []) as Array<{ id: number; nome: string; cargo: string | null; souEu?: boolean }>;
  return {
    colaboradores,
    eu: colaboradores.find((c) => c.souEu) ?? null,
    podeAtribuirOutro: perms?.cargo === "Dono" || !!perms?.permissoes?.agenda?.verTodos,
  };
}

/** O par de datas: hoje como início, o prazo calculado como fatal. */
function hojeISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function CampoResponsavel({
  valor,
  onChange,
}: {
  valor: number | null;
  onChange: (id: number) => void;
}) {
  const { colaboradores, eu, podeAtribuirOutro } = useEquipe();
  const escolhido = colaboradores.find((c) => c.id === valor) ?? eu;

  if (!podeAtribuirOutro) {
    return (
      <div className="space-y-1.5">
        <Label>Responsável</Label>
        <div className="h-9 px-3 rounded-md border bg-muted/40 flex items-center text-sm text-muted-foreground">
          {escolhido?.nome ?? "Você"}
          <span className="ml-auto text-[10.5px]">atribuir a um colega é do gestor</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label>Responsável</Label>
      <Select
        value={String(escolhido?.id ?? "")}
        onValueChange={(v) => onChange(Number(v))}
      >
        <SelectTrigger>
          <SelectValue placeholder="Escolher…" />
        </SelectTrigger>
        <SelectContent>
          {colaboradores.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.nome}
              {c.souEu ? " (você)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CriarPrazoDialog({ open, onClose, evento, onSuccess }: DialogProps) {
  const [titulo, setTitulo] = useState(
    evento.prazo?.titulo
      ? `${nomeCliente(evento)}: ${evento.prazo.titulo}`
      : `${nomeCliente(evento)}: ${evento.titulo.slice(0, 80)}`,
  );
  const [descricao, setDescricao] = useState(evento.teor?.slice(0, 4000) || evento.rotulo);
  const [responsavelId, setResponsavelId] = useState<number | null>(null);
  const [dataInicial, setDataInicial] = useState(hojeISO());
  const [dataFatal, setDataFatal] = useState(
    evento.prazo?.data ? dataCalendarioISO(evento.prazo.data) : dataFallback(),
  );
  const [prioridade, setPrioridade] = useState<"baixa" | "normal" | "alta" | "critica">(
    evento.prazo ? "alta" : "normal",
  );

  const criarMut = trpc.agendamento.criar.useMutation({
    onSuccess: () => {
      toast.success("Prazo criado na agenda");
      onSuccess();
    },
    onError: (e) => toast.error("Falha ao criar prazo", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar prazo a partir da movimentação</DialogTitle>
          <DialogDescription>
            CNJ: <span className="font-mono">{evento.cnj || "—"}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="prazo-titulo">Título</Label>
            <Input id="prazo-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prazo-desc">Descrição</Label>
            <Textarea
              id="prazo-desc"
              rows={4}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Vem preenchida com o texto do documento. Editável.
            </p>
          </div>

          <CampoResponsavel valor={responsavelId} onChange={setResponsavelId} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="prazo-inicial">Data inicial</Label>
              <Input
                id="prazo-inicial"
                type="date"
                value={dataInicial}
                onChange={(e) => setDataInicial(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prazo-fatal" className="flex items-center gap-1.5">
                Data fatal
                <span className="text-[9px] font-bold tracking-wider text-rose-600 dark:text-rose-400">NÃO SE MOVE</span>
              </Label>
              <Input
                id="prazo-fatal"
                type="date"
                className="border-rose-300 focus-visible:ring-rose-300"
                value={dataFatal}
                onChange={(e) => setDataFatal(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="prazo-prio">Prioridade</Label>
              <Select value={prioridade} onValueChange={(v) => setPrioridade(v as typeof prioridade)}>
                <SelectTrigger id="prazo-prio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="critica">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div />
          </div>
          {evento.prazo?.motivo ? (
            <p className="text-[11px] text-muted-foreground leading-snug">
              <span className="font-semibold text-foreground">Como chegamos nesta data:</span>{" "}
              {evento.prazo.motivo}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Sem prazo detectado no documento — a data acima é um chute de 5 dias. Ajuste.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={criarMut.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              criarMut.mutate({
                tipo: "prazo_processual",
                titulo,
                descricao: descricao || undefined,
                // O prazo passa a aparecer na agenda a partir da data inicial e
                // carrega a fatal em `dataFim` — antes só existia uma data e
                // ela ia pros dois papéis.
                dataInicio: `${dataInicial}T09:00:00`,
                dataFim: `${dataFatal}T23:59:59`,
                diaInteiro: true,
                prioridade,
                responsavelId: responsavelId ?? undefined,
              })
            }
            disabled={criarMut.isPending || !titulo.trim() || !dataFatal}
          >
            {criarMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Criar prazo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CriarTarefaDialog({ open, onClose, evento, onSuccess }: DialogProps) {
  const [titulo, setTitulo] = useState(`${nomeCliente(evento)}: ${evento.titulo.slice(0, 80)}`);
  const [descricao, setDescricao] = useState(evento.teor?.slice(0, 4000) || evento.rotulo);
  const [responsavelId, setResponsavelId] = useState<number | null>(null);
  const [dataInicial, setDataInicial] = useState(hojeISO());
  const [dataFatal, setDataFatal] = useState(
    evento.prazo?.data ? dataCalendarioISO(evento.prazo.data) : dataFallback(),
  );
  const [prioridade, setPrioridade] = useState<"baixa" | "normal" | "alta" | "urgente">("normal");

  const criarMut = trpc.tarefas.criar.useMutation({
    onSuccess: () => {
      toast.success("Tarefa criada");
      onSuccess();
    },
    onError: (e) => toast.error("Falha ao criar tarefa", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar tarefa a partir da movimentação</DialogTitle>
          <DialogDescription>
            CNJ: <span className="font-mono">{evento.cnj || "—"}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tarefa-titulo">Título</Label>
            <Input id="tarefa-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tarefa-desc">Descrição</Label>
            <Textarea
              id="tarefa-desc"
              rows={4}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <CampoResponsavel valor={responsavelId} onChange={setResponsavelId} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tarefa-inicial">Data inicial</Label>
              <Input
                id="tarefa-inicial"
                type="date"
                value={dataInicial}
                onChange={(e) => setDataInicial(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tarefa-fatal" className="flex items-center gap-1.5">
                Data fatal
                <span className="text-[9px] font-bold tracking-wider text-rose-600 dark:text-rose-400">NÃO SE MOVE</span>
              </Label>
              <Input
                id="tarefa-fatal"
                type="date"
                className="border-rose-300 focus-visible:ring-rose-300"
                value={dataFatal}
                onChange={(e) => setDataFatal(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tarefa-prio">Prioridade</Label>
              <Select value={prioridade} onValueChange={(v) => setPrioridade(v as typeof prioridade)}>
                <SelectTrigger id="tarefa-prio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={criarMut.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              criarMut.mutate({
                titulo,
                descricao: descricao || undefined,
                dataInicial: dataInicial ? `${dataInicial}T00:00:00` : undefined,
                dataVencimento: dataFatal ? `${dataFatal}T23:59:59` : undefined,
                prioridade,
                responsavelId: responsavelId ?? undefined,
              })
            }
            disabled={criarMut.isPending || !titulo.trim()}
          >
            {criarMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Criar tarefa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
