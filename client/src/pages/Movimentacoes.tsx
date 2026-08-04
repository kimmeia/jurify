/**
 * Central de movimentações — a tela de resolver o dia.
 *
 * A ideia é substituir o hábito de abrir processo por processo: as que exigem
 * ação vêm com card cheio (resumo, citação literal do juiz e o prazo já
 * calculado), as relevantes viram uma linha, e a rotina fica recolhida num
 * bloco só. Quem separa os três grupos é o servidor — aqui só renderizamos.
 */
import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Search,
  Check,
  CalendarClock,
  AlertTriangle,
  Inbox,
  Loader2,
  ChevronDown,
  ChevronUp,
  Lock,
  ListFilter,
  Mail,
  Send,
} from "lucide-react";
import MovimentacaoDetalheDrawer from "@/components/MovimentacaoDetalheDrawer";

type Grupo = "exigem_acao" | "relevante" | "rotina";

const DESFECHO_SELO: Record<string, { label: string; cls: string }> = {
  favoravel: { label: "🟢 Favorável", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  desfavoravel: { label: "🔴 Desfavorável", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  parcial: { label: "🟡 Parcialmente favorável", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  neutro: { label: "⚪ Sem mérito", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

const ATO_SELO: Record<string, string> = {
  decisao: "⚖️ Decisão",
  sentenca: "⚖️ Sentença",
  acordao: "⚖️ Acórdão",
  despacho: "📄 Despacho",
  intimacao: "📬 Intimação",
  audiencia: "📅 Audiência",
  expediente: "📎 Expediente",
  outro: "📄 Ato",
};

const JANELAS = [
  { valor: 1, label: "Últimas 24h" },
  { valor: 7, label: "Últimos 7 dias" },
  { valor: 30, label: "Últimos 30 dias" },
  { valor: 90, label: "Últimos 90 dias" },
];

const POLO_LABEL: Record<string, string> = { ativo: "Autor", passivo: "Réu", terceiro: "Terceiro" };

/** Nome do caso: "Fulano × Banco Tal" quando a capa foi coletada; senão o
 *  que houver. Repetir o CNJ aqui não diz de quem é o processo. */
function nomeDoCaso(item: { partes: string | null; cliente: string }) {
  return item.partes || item.cliente;
}

function dataCurta(d: Date | string) {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function haQuantoTempo(d: Date | string) {
  const dias = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

export default function Movimentacoes() {
  const [busca, setBusca] = useState("");
  const [dias, setDias] = useState(7);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [somenteNaoLidas, setSomenteNaoLidas] = useState(false);
  const [eventoAberto, setEventoAberto] = useState<number | null>(null);
  const [rotinaAberta, setRotinaAberta] = useState(false);
  const [configAberta, setConfigAberta] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.movimentacoes.central.useQuery({
    busca: busca.trim() || undefined,
    dias,
    grupos: grupos ?? undefined,
    somenteNaoLidas: somenteNaoLidas || undefined,
  });

  const marcarRotinaMut = trpc.movimentacoes.marcarRotinaLida.useMutation({
    onSuccess: () => {
      toast.success("Rotina marcada como lida");
      utils.movimentacoes.central.invalidate();
    },
    onError: (e) => toast.error("Falha ao marcar", { description: e.message }),
  });

  const marcarMut = trpc.movimentacoes.marcarLidas.useMutation({
    onSuccess: () => utils.movimentacoes.central.invalidate(),
  });

  const itens = data?.itens ?? [];
  const contagem = data?.contagem ?? { exigem_acao: 0, relevante: 0, rotina: 0 };

  const porGrupo = useMemo(
    () => ({
      exigem_acao: itens.filter((i) => i.grupo === "exigem_acao"),
      relevante: itens.filter((i) => i.grupo === "relevante"),
      rotina: itens.filter((i) => i.grupo === "rotina"),
    }),
    [itens],
  );

  const vencendoHoje = porGrupo.exigem_acao.filter(
    (i) => i.prazo && typeof i.prazo.diasUteisRestantes === "number" && i.prazo.diasUteisRestantes <= 0,
  ).length;

  const alternarGrupo = (g: Grupo) => {
    setGrupos((atual) => {
      if (!atual) return [g];
      if (atual.length === 1 && atual[0] === g) return null;
      return [g];
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Movimentações</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading ? (
              "Carregando…"
            ) : (
              <>
                {data?.total ?? 0} nos últimos {dias === 1 ? "24h" : `${dias} dias`} ·{" "}
                <span className="font-bold text-rose-600">{contagem.exigem_acao} exigem ação sua</span>
                {vencendoHoje > 0 ? (
                  <span className="font-bold text-rose-600"> · {vencendoHoje} vence hoje ou já venceu</span>
                ) : (
                  " · nenhuma vence hoje"
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setConfigAberta(true)}>
          <Mail className="h-4 w-4 mr-1.5" />
          Resumo diário
        </Button>
        {contagem.rotina > 0 && (
          <Button
            size="sm"
            disabled={marcarRotinaMut.isPending}
            onClick={() => marcarRotinaMut.mutate({ dias })}
          >
            {marcarRotinaMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            Marcar rotina como lida
          </Button>
        )}
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-xl border bg-card p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cliente, CNJ ou trecho da decisão…"
            className="pl-9 h-9"
          />
        </div>

        <Select value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JANELAS.map((j) => (
              <SelectItem key={j.valor} value={String(j.valor)}>
                {j.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <Chip ativo={!grupos && !somenteNaoLidas} onClick={() => { setGrupos(null); setSomenteNaoLidas(false); }}>
            Tudo
          </Chip>
          <Chip ativo={grupos?.[0] === "exigem_acao"} onClick={() => alternarGrupo("exigem_acao")} cor="bg-rose-500">
            Exigem ação
          </Chip>
          <Chip ativo={grupos?.[0] === "relevante"} onClick={() => alternarGrupo("relevante")} cor="bg-violet-500">
            Relevantes
          </Chip>
          <Chip ativo={somenteNaoLidas} onClick={() => setSomenteNaoLidas((v) => !v)} cor="bg-slate-400">
            Não lidas
          </Chip>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : itens.length === 0 ? (
        <div className="rounded-xl border bg-card py-16 flex flex-col items-center gap-2 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium">Nada por aqui</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            {busca
              ? "Nenhuma movimentação bate com essa busca no período escolhido."
              : "Nenhuma movimentação nos processos monitorados neste período."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Exigem ação */}
          {porGrupo.exigem_acao.length > 0 && (
            <section>
              <CabecalhoGrupo
                titulo="Exigem ação sua"
                total={porGrupo.exigem_acao.length}
                cls="text-rose-700"
                clsBadge="bg-rose-100 text-rose-700"
              />
              <div className="space-y-2.5">
                {porGrupo.exigem_acao.map((m) => (
                  <CardAcao
                    key={m.id}
                    item={m}
                    onAbrir={() => setEventoAberto(m.id)}
                    onMarcarLida={() => marcarMut.mutate({ eventoIds: [m.id] })}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Relevantes */}
          {porGrupo.relevante.length > 0 && (
            <section>
              <CabecalhoGrupo
                titulo="Relevantes, sem prazo para você"
                total={porGrupo.relevante.length}
                cls="text-violet-700"
                clsBadge="bg-violet-100 text-violet-700"
              />
              <div className="rounded-xl border bg-card divide-y">
                {porGrupo.relevante.map((m) => (
                  <LinhaRelevante key={m.id} item={m} onAbrir={() => setEventoAberto(m.id)} />
                ))}
              </div>
            </section>
          )}

          {/* Rotina */}
          {porGrupo.rotina.length > 0 && (
            <section>
              <CabecalhoGrupo
                titulo="Rotina — nada exige ação"
                total={porGrupo.rotina.length}
                cls="text-muted-foreground"
                clsBadge="bg-muted text-muted-foreground"
              />
              <div className="rounded-xl border bg-card">
                <button
                  type="button"
                  onClick={() => setRotinaAberta((v) => !v)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/40"
                >
                  <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <ListFilter className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {porGrupo.rotina.length} movimentações de expediente
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {resumoRotina(porGrupo.rotina.map((r) => r.titulo))}
                    </p>
                  </div>
                  <span className="ml-auto text-xs font-semibold text-muted-foreground flex items-center gap-1 shrink-0">
                    {rotinaAberta ? "Recolher" : "Ver todas"}
                    {rotinaAberta ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </span>
                </button>
                {rotinaAberta && (
                  <div className="border-t divide-y">
                    {porGrupo.rotina.map((m) => (
                      <LinhaRelevante key={m.id} item={m} onAbrir={() => setEventoAberto(m.id)} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <MovimentacaoDetalheDrawer eventoId={eventoAberto} onClose={() => setEventoAberto(null)} />
      <ConfigResumoDiario open={configAberta} onClose={() => setConfigAberta(false)} />
    </div>
  );
}

const STATUS_ENVIO: Record<string, { label: string; cls: string }> = {
  enviado: { label: "Enviado", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  falha: { label: "Falhou", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  sem_conteudo: { label: "Nada a enviar", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  nao_configurado: { label: "Não configurado", cls: "bg-amber-50 text-amber-800 border-amber-200" },
};

/**
 * Configuração do resumo diário.
 *
 * O bloco de últimos envios é a parte que importa: integração que falha
 * calada faz o painel dizer "ativo" enquanto ninguém recebe nada. Aqui o
 * status vem do que aconteceu de fato em cada canal.
 */
function ConfigResumoDiario({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.resumoDiario.obter.useQuery(undefined, { enabled: open });

  const [ativo, setAtivo] = useState(false);
  const [hora, setHora] = useState("7");
  const [somenteUteis, setSomenteUteis] = useState(true);
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [template, setTemplate] = useState("");
  const [carregado, setCarregado] = useState(false);

  if (data && !carregado) {
    setAtivo(data.ativo);
    setHora(String(data.hora));
    setSomenteUteis(data.somenteUteis);
    setEmail(data.email ?? "");
    setWhatsapp(data.whatsapp ?? "");
    setTemplate(data.template ?? "");
    setCarregado(true);
  }

  const salvarMut = trpc.resumoDiario.salvar.useMutation({
    onSuccess: () => {
      toast.success("Resumo diário atualizado");
      utils.resumoDiario.obter.invalidate();
    },
    onError: (e) => toast.error("Falha ao salvar", { description: e.message }),
  });

  const enviarMut = trpc.resumoDiario.enviarAgora.useMutation({
    onSuccess: (r) => {
      const partes = [`e-mail: ${r.email}`, `WhatsApp: ${r.whatsapp}`];
      toast.success("Disparo executado", { description: partes.join(" · ") });
      utils.resumoDiario.obter.invalidate();
    },
    onError: (e) => toast.error("Falha ao disparar", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Resumo diário das movimentações</DialogTitle>
          <DialogDescription>
            Chega pronto, com o que o juiz decidiu e o prazo já calculado — sem precisar abrir o
            sistema.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-semibold">Enviar resumo diário</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Fuso do escritório: {data?.fusoHorario}
                </p>
              </div>
              <Switch checked={ativo} onCheckedChange={setAtivo} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Horário</Label>
                <Select value={hora} onValueChange={setHora}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, h) => (
                      <SelectItem key={h} value={String(h)}>
                        {String(h).padStart(2, "0")}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end pb-1.5 gap-2">
                <Switch id="uteis" checked={somenteUteis} onCheckedChange={setSomenteUteis} />
                <Label htmlFor="uteis" className="text-xs">
                  Só em dias úteis
                </Label>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">E-mail (vazio = e-mail do dono)</Label>
              <Input
                className="h-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@escritorio.adv.br"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">WhatsApp</Label>
                <Input
                  className="h-9"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="5585999999999"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Template aprovado na Meta</Label>
                <Input
                  className="h-9"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  placeholder="resumo_diario"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug -mt-1">
              O WhatsApp sai fora da janela de 24h, então a Meta só aceita template aprovado (HSM)
              com uma variável de texto no corpo. Sem template configurado, o resumo vai só por
              e-mail.
            </p>

            {data?.ultimosEnvios?.length ? (
              <div className="rounded-lg border">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground px-3 pt-2.5 pb-1.5">
                  Últimos envios
                </p>
                <div className="divide-y">
                  {data.ultimosEnvios.map((e, i) => (
                    <div key={i} className="px-3 py-2 flex items-center gap-2 text-[11.5px]">
                      <span className="font-semibold w-16 shrink-0 capitalize">{e.canal}</span>
                      <span className="text-muted-foreground w-20 shrink-0">{e.dataRef}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                          STATUS_ENVIO[e.status]?.cls ?? ""
                        }`}
                      >
                        {STATUS_ENVIO[e.status]?.label ?? e.status}
                      </span>
                      <span className="text-muted-foreground truncate">{e.erro ?? e.destino ?? ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={enviarMut.isPending}
            onClick={() => enviarMut.mutate()}
          >
            {enviarMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1.5" />
            )}
            Enviar agora (teste)
          </Button>
          <Button
            size="sm"
            disabled={salvarMut.isPending}
            onClick={() =>
              salvarMut.mutate({
                ativo,
                hora: Number(hora),
                somenteUteis,
                email: email.trim() || null,
                whatsapp: whatsapp.trim() || null,
                template: template.trim() || null,
              })
            }
          >
            {salvarMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Item = inferRouterOutputs<AppRouter>["movimentacoes"]["central"]["itens"][number];

/** Os 3 rótulos mais frequentes — dá a textura do que ficou de fora sem
 *  obrigar a expandir. */
function resumoRotina(titulos: string[]): string {
  const contagem = new Map<string, number>();
  for (const t of titulos) {
    const chave = t.split(/[.\-–—(]/)[0].trim().slice(0, 40);
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, n]) => `${k} (${n})`)
    .join(" · ");
}

function Chip({
  children,
  ativo,
  onClick,
  cor,
}: {
  children: React.ReactNode;
  ativo?: boolean;
  onClick: () => void;
  cor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
        ativo ? "bg-foreground text-background border-foreground" : "bg-background hover:bg-muted"
      }`}
    >
      {cor && <span className={`h-1.5 w-1.5 rounded-full ${cor}`} />}
      {children}
    </button>
  );
}

function CabecalhoGrupo({
  titulo,
  total,
  cls,
  clsBadge,
}: {
  titulo: string;
  total: number;
  cls: string;
  clsBadge: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className={`text-[11px] font-bold uppercase tracking-wide ${cls}`}>{titulo}</span>
      <span className={`text-[10px] font-extrabold rounded-full px-2 py-0.5 ${clsBadge}`}>{total}</span>
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}

function CardAcao({
  item,
  onAbrir,
  onMarcarLida,
}: {
  item: Item;
  onAbrir: () => void;
  onMarcarLida: () => void;
}) {
  const p = item.prazo;
  const audiencia = p?.tipo === "audiencia";
  const restantes = p?.diasUteisRestantes ?? null;
  const urgente = typeof restantes === "number" && restantes <= 2;

  return (
    <div className="rounded-xl border bg-card overflow-hidden flex">
      <div className={`w-1 shrink-0 ${audiencia ? "bg-orange-500" : "bg-rose-600"}`} />
      <div className="flex-1 p-3.5 min-w-0">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
          <span className="font-bold text-sm text-foreground">{nomeDoCaso(item)}</span>
          {item.clientePolo && POLO_LABEL[item.clientePolo] && (
            <span className="rounded-full bg-slate-100 text-slate-600 px-1.5 py-px text-[10px] font-bold">
              nosso cliente: {POLO_LABEL[item.clientePolo]}
            </span>
          )}
          <span className="text-slate-300">•</span>
          <span className="font-mono font-medium">{item.cnj}</span>
          {item.tribunal && (
            <>
              <span className="text-slate-300">•</span>
              <span className="uppercase">{item.tribunal}</span>
            </>
          )}
          <span className="ml-auto font-semibold shrink-0">
            {dataCurta(item.dataEvento)} · {haQuantoTempo(item.dataEvento)}
          </span>
        </div>

        <button type="button" onClick={onAbrir} className="text-left w-full">
          <h3 className="text-[15px] font-bold mt-1 leading-snug hover:underline">{item.titulo}</h3>
        </button>

        {item.pontos.length > 0 && (
          <p className="text-[13px] text-slate-600 mt-1 leading-snug line-clamp-2">
            {item.pontos.join(" ")}
          </p>
        )}

        {item.citacao && (
          <p className="mt-1.5 border-l-[3px] border-amber-300 bg-amber-50 rounded-r-md px-2.5 py-1.5 text-[11.5px] text-amber-900 leading-snug line-clamp-2">
            “{item.citacao}”
          </p>
        )}

        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {item.desfecho && DESFECHO_SELO[item.desfecho] && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${DESFECHO_SELO[item.desfecho].cls}`}
            >
              {DESFECHO_SELO[item.desfecho].label}
            </span>
          )}
          {p?.data && (
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold inline-flex items-center gap-1.5 ${
                urgente
                  ? "bg-rose-600 border-rose-600 text-white"
                  : audiencia
                    ? "bg-orange-50 border-orange-200 text-orange-700"
                    : "bg-rose-50 border-rose-200 text-rose-700"
              }`}
            >
              {audiencia ? "📌" : "⏰"} {audiencia ? "Audiência em" : "Vence"} {dataCurta(p.data)}
              {typeof restantes === "number" &&
                ` · ${restantes < 0 ? `${Math.abs(restantes)} dias vencido` : `${restantes} dias úteis`}`}
            </span>
          )}
          {item.teorStatus !== "ok" && (
            <span className="rounded-full border border-amber-200 bg-amber-50 text-amber-800 px-2 py-0.5 text-[10.5px] font-bold inline-flex items-center gap-1">
              <Lock className="h-3 w-3" /> Sem o documento
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <Button size="sm" variant="outline" className="h-7 text-[11.5px]" onClick={onAbrir}>
              Ver íntegra
            </Button>
            {!item.lido && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11.5px] border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                onClick={onMarcarLida}
              >
                <Check className="h-3 w-3 mr-1" />
                Já providenciei
              </Button>
            )}
            <Button
              size="sm"
              className={`h-7 text-[11.5px] ${audiencia ? "bg-orange-600 hover:bg-orange-700" : "bg-rose-600 hover:bg-rose-700"}`}
              onClick={onAbrir}
            >
              <CalendarClock className="h-3 w-3 mr-1" />
              {audiencia ? "Agendar" : "Criar prazo"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinhaRelevante({ item, onAbrir }: { item: Item; onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-muted/40"
    >
      <div className="w-56 shrink-0 min-w-0">
        <p className="text-[12.5px] font-bold truncate" title={nomeDoCaso(item)}>
          {nomeDoCaso(item)}
        </p>
        <p className="text-[10.5px] text-muted-foreground font-mono truncate">{item.cnj}</p>
      </div>
      <p className="flex-1 text-[12.5px] text-slate-700 leading-snug line-clamp-2 min-w-0">{item.titulo}</p>
      {item.teorStatus === "indisponivel" ? (
        <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-2 py-0.5 text-[10.5px] font-bold inline-flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Sem teor
        </span>
      ) : item.desfecho && DESFECHO_SELO[item.desfecho] ? (
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${DESFECHO_SELO[item.desfecho].cls}`}
        >
          {DESFECHO_SELO[item.desfecho].label}
        </span>
      ) : item.ato ? (
        <span className="shrink-0 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200 px-2 py-0.5 text-[10.5px] font-bold">
          {ATO_SELO[item.ato] ?? ATO_SELO.outro}
        </span>
      ) : null}
      <span className="shrink-0 w-10 text-right text-[11px] font-semibold text-muted-foreground">
        {dataCurta(item.dataEvento)}
      </span>
    </button>
  );
}
