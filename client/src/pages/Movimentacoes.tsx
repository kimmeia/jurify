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
import { useModulosContratados } from "@/components/ModuloGuard";
import { contratoLibera } from "@shared/modulos-contratacao";
import { Badge } from "@/components/ui/badge";
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
  ChevronRight,
  FileX,
  Send,
} from "lucide-react";
import MovimentacaoDetalheDrawer from "@/components/MovimentacaoDetalheDrawer";

type Grupo = "exigem_acao" | "relevante" | "rotina";

/**
 * Selos sem emoji: em 10px eles viram ruído, variam de desenho por
 * plataforma e ainda desalinham a linha de base do texto ao lado.
 */
const DESFECHO_SELO: Record<string, { label: string; cls: string }> = {
  favoravel: { label: "Favorável", cls: "bg-success-bg text-success-fg dark:text-success" },
  desfavoravel: { label: "Desfavorável", cls: "bg-danger-bg text-danger-fg dark:text-danger" },
  parcial: { label: "Parcial", cls: "bg-warning-bg text-warning-fg dark:text-warning" },
  neutro: { label: "Sem mérito", cls: "bg-muted text-muted-foreground" },
};

const ATO_SELO: Record<string, string> = {
  decisao: "Decisão",
  sentenca: "Sentença",
  acordao: "Acórdão",
  despacho: "Despacho",
  intimacao: "Intimação",
  audiencia: "Audiência",
  expediente: "Expediente",
  outro: "Ato",
};

/**
 * Eixo principal da tela: o que ainda falta resolver.
 *
 * A classificação (exige ação / relevante / rotina) responde outra pergunta —
 * *o que* a movimentação é — e já aparece como seção dentro da lista. Enquanto
 * as duas moraram na mesma barra de abas, a que continha o trabalho do dia
 * parecia só mais um filtro, e era preciso descobrir isso por tentativa.
 */
type Estado = "a_resolver" | "resolvidas" | "todas";

type Tipo = "todos" | Grupo;

const TIPOS: { valor: Tipo; label: string; chave?: Grupo }[] = [
  { valor: "todos", label: "Todos os tipos" },
  { valor: "exigem_acao", label: "Só as que exigem ação", chave: "exigem_acao" },
  { valor: "relevante", label: "Só as relevantes", chave: "relevante" },
  { valor: "rotina", label: "Só a rotina", chave: "rotina" },
];

/**
 * Período como segmentado com contagem, não select: o badge do menu conta 30
 * dias e a tela abria em 7 — o usuário via 99 no menu e "nada pendente" na
 * tela, cada um certo no seu período. Com o número em cada opção (e o
 * default igual ao do menu), a conta fecha à vista.
 */
const JANELAS = [
  { valor: 7, label: "Esta semana" },
  { valor: 30, label: "30 dias" },
  { valor: 90, label: "90 dias" },
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

export function MovimentacoesCentral() {
  const [busca, setBusca] = useState("");
  const [dias, setDias] = useState(30);
  const [estado, setEstado] = useState<Estado>("a_resolver");
  const [tipo, setTipo] = useState<Tipo>("todos");
  const [eventoAberto, setEventoAberto] = useState<number | null>(null);
  const [rotinaAberta, setRotinaAberta] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.movimentacoes.central.useQuery({
    busca: busca.trim() || undefined,
    dias,
    grupos: tipo === "todos" ? undefined : [tipo],
    estado,
  });
  // Mesma fonte do badge do menu — é o que faz "30 dias · 99" aqui e o 99
  // do menu serem por construção o mesmo número.
  const { data: contadorMenu } = trpc.movimentacoes.contador.useQuery();

  const invalidarContagens = () => {
    utils.movimentacoes.central.invalidate();
    utils.movimentacoes.contador.invalidate();
  };

  const marcarRotinaMut = trpc.movimentacoes.marcarRotinaLida.useMutation({
    onSuccess: () => {
      toast.success("Rotina marcada como lida");
      invalidarContagens();
    },
    onError: (e) => toast.error("Falha ao marcar", { description: e.message }),
  });

  const marcarMut = trpc.movimentacoes.marcarLidas.useMutation({
    onSuccess: invalidarContagens,
  });

  const itens = data?.itens ?? [];
  const contagem = data?.contagem ?? {
    exigem_acao: 0,
    relevante: 0,
    rotina: 0,
    aResolver: 0,
    resolvidas: 0,
  };

  const porGrupo = useMemo(
    () => ({
      exigem_acao: itens.filter((i) => i.grupo === "exigem_acao"),
      relevante: itens.filter((i) => i.grupo === "relevante"),
      rotina: itens.filter((i) => i.grupo === "rotina"),
    }),
    [itens],
  );

  const janela = dias === 1 ? "nas últimas 24h" : `nos últimos ${dias} dias`;

  // Lista vazia tem quatro causas distintas, e o "Nada por aqui" genérico
  // servia igual pras quatro — inclusive pro dia em que tudo foi resolvido,
  // que é o único caso em que a tela vazia é boa notícia.
  const vazio: MotivoVazio = busca
    ? "busca"
    : (data?.total ?? 0) === 0
      ? "periodo"
      : estado === "a_resolver"
        ? "tudo_resolvido"
        : "nada_resolvido";

  const contagemJanela: Record<number, number | undefined> = {
    7: contadorMenu?.naoLidasSemana,
    30: contadorMenu?.naoLidas,
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="rounded-xl border bg-card p-2.5 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cliente, CNJ ou trecho da decisão…"
            className="pl-9 h-9"
          />
        </div>

        <div className="flex items-center gap-1 rounded-[9px] bg-muted p-[3px]">
          {JANELAS.map((j) => {
            const n = contagemJanela[j.valor];
            const ativo = dias === j.valor;
            return (
              <button
                key={j.valor}
                type="button"
                onClick={() => setDias(j.valor)}
                className={`flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  ativo ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                {j.label}
                {typeof n === "number" && (
                  <span
                    className={`rounded-full px-1.5 py-px text-[9.5px] font-extrabold ${
                      ativo ? "bg-primary text-primary-foreground" : "bg-border text-muted-foreground"
                    }`}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* A classificação continua acessível, mas como filtro — que é o que
            ela sempre foi. Os números das opções vêm do período inteiro, senão
            escolher um tipo zeraria os outros. */}
        <Select value={tipo} onValueChange={(v) => setTipo(v as Tipo)}>
          <SelectTrigger className="h-9 w-[210px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS.map((t) => (
              <SelectItem key={t.valor} value={t.valor}>
                {t.label}
                {t.chave ? ` (${contagem[t.chave]})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* As resolvidas continuam a um clique, sem ocupar um cartão inteiro. */}
        <Button
          size="sm"
          variant={estado === "resolvidas" ? "secondary" : "ghost"}
          className="h-9"
          onClick={() => setEstado(estado === "resolvidas" ? "a_resolver" : "resolvidas")}
        >
          <Check className="h-3.5 w-3.5 mr-1.5" />
          Resolvidas{isLoading ? "" : ` (${contagem.resolvidas})`}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : itens.length === 0 ? (
        <Vazio motivo={vazio} janela={janela} total={data?.total ?? 0} />
      ) : (
        <div className="space-y-5">
          {porGrupo.exigem_acao.length > 0 && (
            <section>
              <CabecalhoGrupo
                titulo="Exigem ação"
                total={porGrupo.exigem_acao.length}
                tom="alerta"
                dica="resolvidas aqui, o dia está feito"
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

          {porGrupo.relevante.length > 0 && (
            <section>
              <CabecalhoGrupo
                titulo="Vale ler"
                total={porGrupo.relevante.length}
                dica="nada a fazer agora, mas você quer saber"
              />
              <div className="rounded-xl border bg-card divide-y overflow-hidden">
                {porGrupo.relevante.map((m) => (
                  <LinhaRelevante
                    key={m.id}
                    item={m}
                    onAbrir={() => setEventoAberto(m.id)}
                    onResolver={() => marcarMut.mutate({ eventoIds: [m.id] })}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Rotina fica numa barra discreta no rodapé: é o volume que polui a
              tela sem nunca ser o que a pessoa veio fazer aqui. */}
          {porGrupo.rotina.length > 0 && (
            <section className="space-y-2.5">
              <div className="rounded-xl border border-dashed bg-card px-4 py-2.5 flex items-center gap-3 flex-wrap">
                <Check className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <p className="text-[12.5px] text-muted-foreground min-w-0">
                  <b className="font-bold text-foreground">{porGrupo.rotina.length}</b>{" "}
                  {porGrupo.rotina.length === 1 ? "movimentação de rotina" : "movimentações de rotina"} (
                  {resumoRotina(porGrupo.rotina.map((r) => r.titulo))}) fora da lista.
                </p>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setRotinaAberta((v) => !v)}>
                    {rotinaAberta ? "Recolher" : "Ver todas"}
                    {rotinaAberta ? (
                      <ChevronUp className="h-3.5 w-3.5 ml-1.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                    )}
                  </Button>
                  {estado !== "resolvidas" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={marcarRotinaMut.isPending}
                      onClick={() => marcarRotinaMut.mutate({ dias })}
                    >
                      {marcarRotinaMut.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Marcar como resolvidas
                    </Button>
                  )}
                </div>
              </div>
              {rotinaAberta && (
                <div className="rounded-xl border bg-card divide-y overflow-hidden">
                  {porGrupo.rotina.map((m) => (
                    <LinhaRelevante
                      key={m.id}
                      item={m}
                      onAbrir={() => setEventoAberto(m.id)}
                      onResolver={() => marcarMut.mutate({ eventoIds: [m.id] })}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <MovimentacaoDetalheDrawer eventoId={eventoAberto} onClose={() => setEventoAberto(null)} />
    </div>
  );
}

export default MovimentacoesCentral;

const STATUS_ENVIO: Record<string, { label: string; cls: string }> = {
  enviado: { label: "Enviado", cls: "bg-success-bg text-success-fg border-success/30" },
  falha: { label: "Falhou", cls: "bg-danger-bg text-danger-fg border-danger/30" },
  sem_conteudo: { label: "Nada a enviar", cls: "bg-muted text-muted-foreground border-border" },
  nao_configurado: { label: "Não configurado", cls: "bg-warning-bg text-warning-fg border-warning/30" },
};

/**
 * Configuração do resumo diário.
 *
 * O bloco de últimos envios é a parte que importa: integração que falha
 * calada faz o painel dizer "ativo" enquanto ninguém recebe nada. Aqui o
 * status vem do que aconteceu de fato em cada canal.
 */
export function ConfigResumoDiario({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.resumoDiario.obter.useQuery(undefined, { enabled: open });
  // Sem o módulo Atendimento não há canal Meta — o campo ganha cadeado com
  // explicação em vez de aceitar um número que nunca vai receber nada.
  const modulosContratados = useModulosContratados();
  const temAtendimento = contratoLibera(modulosContratados, ["atendimento"]);

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

            {temAtendimento ? (
              <>
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
              </>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/40 p-3 opacity-80">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  Enviar por WhatsApp
                  <Badge variant="outline" className="text-[9px] text-muted-foreground">🔒 módulo Atendimento</Badge>
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                  Precisa de um canal WhatsApp conectado — disponível ao contratar o módulo
                  Atendimento. O resumo por e-mail funciona normalmente.
                </p>
              </div>
            )}

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

type MotivoVazio = "busca" | "periodo" | "tudo_resolvido" | "nada_resolvido";

function Vazio({ motivo, janela, total }: { motivo: MotivoVazio; janela: string; total: number }) {
  if (motivo === "tudo_resolvido") {
    return (
      <div className="rounded-xl border bg-card py-14 flex flex-col items-center gap-2 text-center">
        <span className="h-11 w-11 rounded-full bg-success-bg text-success-fg dark:text-success flex items-center justify-center">
          <Check className="h-6 w-6" />
        </span>
        <p className="text-sm font-bold">Nada pendente {janela}</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          {total === 1
            ? "A movimentação do período já foi resolvida."
            : `As ${total} movimentações do período já foram resolvidas.`}{" "}
          Elas continuam em <b className="text-foreground">Resolvidas</b> se você precisar voltar em
          alguma.
        </p>
      </div>
    );
  }

  const texto: Record<Exclude<MotivoVazio, "tudo_resolvido">, { titulo: string; corpo: string }> = {
    busca: {
      titulo: "Nada bate com essa busca",
      corpo: "Nenhuma movimentação corresponde ao texto buscado no período e no estado escolhidos.",
    },
    periodo: {
      titulo: "Nada por aqui",
      corpo: "Nenhuma movimentação nos processos monitorados neste período.",
    },
    nada_resolvido: {
      titulo: "Nada resolvido ainda",
      corpo: "Quando você marcar uma movimentação como resolvida, ela passa a aparecer aqui.",
    },
  };
  const t = texto[motivo];

  return (
    <div className="rounded-xl border bg-card py-16 flex flex-col items-center gap-2 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm font-medium">{t.titulo}</p>
      <p className="text-xs text-muted-foreground max-w-sm">{t.corpo}</p>
    </div>
  );
}

function CabecalhoGrupo({
  titulo,
  total,
  tom = "neutro",
  dica,
}: {
  titulo: string;
  total: number;
  tom?: "neutro" | "alerta";
  dica?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
        {titulo}
      </span>
      <span
        className={`text-[10.5px] font-extrabold rounded-full px-2 py-0.5 tabular-nums ${
          tom === "alerta" ? "bg-danger text-danger-on" : "bg-muted text-muted-foreground"
        }`}
      >
        {total}
      </span>
      {dica && (
        <span className="ml-auto text-[10.5px] text-muted-foreground/70 hidden sm:inline">{dica}</span>
      )}
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}

/**
 * Card do que exige ação.
 *
 * Antes ele tinha rosa, laranja, âmbar e verde disputando ao mesmo tempo —
 * com quatro alertas na tela, nenhum alerta. Agora só o prazo pinta de
 * vermelho, e só quando está mesmo apertado; o resto é neutro.
 */
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
  const selo = item.desfecho ? DESFECHO_SELO[item.desfecho] : undefined;

  return (
    <div className="rounded-xl border bg-card overflow-hidden flex">
      <div className="w-[3px] shrink-0 bg-danger" />
      <div className="flex-1 min-w-0 p-4 flex flex-col sm:flex-row items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onAbrir}
              className="text-[13.5px] font-bold text-left hover:underline"
            >
              {nomeDoCaso(item)}
            </button>
            <span className="text-[10.5px] font-mono text-muted-foreground">{item.cnj}</span>
            {item.tribunal && (
              <span className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-muted-foreground border rounded px-1.5 py-px">
                {item.tribunal}
              </span>
            )}
            {item.clientePolo && POLO_LABEL[item.clientePolo] && (
              <span className="text-[10px] font-bold text-muted-foreground">
                nosso cliente: {POLO_LABEL[item.clientePolo]}
              </span>
            )}
            <span className="ml-auto text-[11px] font-semibold text-muted-foreground shrink-0">
              {dataCurta(item.dataEvento)} · {haQuantoTempo(item.dataEvento)}
            </span>
          </div>

          <button type="button" onClick={onAbrir} className="block w-full text-left mt-1.5">
            <p className="text-[14.5px] font-semibold leading-snug">{item.titulo}</p>
          </button>

          {item.pontos.length > 0 && (
            <p className="text-[12.5px] text-muted-foreground mt-1 leading-snug line-clamp-2">
              {item.pontos.join(" ")}
            </p>
          )}

          {item.citacao && (
            <p className="mt-2 border-l-2 border-border pl-2.5 text-[11.5px] text-muted-foreground leading-snug line-clamp-2 italic">
              “{item.citacao}”
            </p>
          )}

          <div className="flex items-center gap-x-3 gap-y-2 mt-2.5 flex-wrap">
            {p?.data && (
              <span
                className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-bold inline-flex items-center gap-1.5 ${
                  urgente
                    ? "bg-danger-bg border-danger/30 text-danger-fg dark:border-danger/30"
                    : "bg-muted border-border text-foreground/80"
                }`}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {audiencia ? "Audiência" : "Vence"} {dataCurta(p.data)}
                {typeof restantes === "number" &&
                  ` · ${
                    restantes < 0
                      ? `venceu há ${Math.abs(restantes)} ${Math.abs(restantes) === 1 ? "dia" : "dias"}`
                      : `${restantes} ${restantes === 1 ? "dia útil" : "dias úteis"}`
                  }`}
              </span>
            )}
            {selo && (
              <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-bold ${selo.cls}`}>
                {selo.label}
              </span>
            )}
            {/* Nota, não alerta: é contexto sobre o que a IA conseguiu ler. */}
            {item.teorStatus !== "ok" && (
              <span className="text-[11.5px] text-muted-foreground inline-flex items-center gap-1.5">
                <FileX className="h-3.5 w-3.5" /> íntegra não disponível no tribunal
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex flex-row sm:flex-col gap-2 w-full sm:w-[152px]">
          <Button size="sm" className="flex-1 sm:w-full" onClick={onAbrir}>
            <CalendarClock className="h-3.5 w-3.5 mr-1.5" />
            {audiencia ? "Agendar" : "Criar prazo"}
          </Button>
          <Button size="sm" variant="outline" className="flex-1 sm:w-full" onClick={onAbrir}>
            Ver íntegra
          </Button>
          {!item.lido && (
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 sm:w-full text-muted-foreground hover:text-foreground"
              onClick={onMarcarLida}
            >
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Já resolvi
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Uma linha por movimentação relevante.
 *
 * Altura fixa é a decisão que muda a tela: o rótulo cru do tribunal às vezes
 * é uma parede de números de documento, e com `line-clamp-2` cada linha
 * ganhava uma altura diferente — a lista perdia o ritmo e virava sopa.
 */
function LinhaRelevante({
  item,
  onAbrir,
  onResolver,
}: {
  item: Item;
  onAbrir: () => void;
  onResolver: () => void;
}) {
  const selo = item.desfecho ? DESFECHO_SELO[item.desfecho] : undefined;
  return (
    // Div e não button: o "Resolvi" é um botão dentro da linha, e button
    // aninhado em button é HTML inválido — o navegador desfaz o aninhamento e
    // o clique passa a cair no lugar errado.
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      className="w-full h-[54px] flex items-center gap-3 pl-3 pr-2 text-left cursor-pointer hover:bg-muted/40 transition-colors"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${item.lido ? "bg-transparent" : "bg-primary"}`}
        title={item.lido ? undefined : "Não lida"}
      />
      <span className="w-[220px] shrink-0 min-w-0">
        <span className="block text-[12.5px] font-bold truncate" title={nomeDoCaso(item)}>
          {nomeDoCaso(item)}
        </span>
        <span className="block text-[10px] font-mono text-muted-foreground truncate">{item.cnj}</span>
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-2">
        {selo ? (
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.04em] ${selo.cls}`}>
            {selo.label}
          </span>
        ) : item.ato ? (
          <span className="shrink-0 rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.04em]">
            {ATO_SELO[item.ato] ?? ATO_SELO.outro}
          </span>
        ) : null}
        <span className="text-[12.5px] text-foreground/80 truncate" title={item.titulo}>
          {item.titulo}
        </span>
        {item.teorStatus === "indisponivel" && (
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </span>
      <span className="shrink-0 w-[74px] text-right">
        <span className="block text-[11.5px] font-semibold text-foreground/70">
          {dataCurta(item.dataEvento)}
        </span>
        <span className="block text-[10px] text-muted-foreground">{haQuantoTempo(item.dataEvento)}</span>
      </span>
      {/* Resolver sem abrir: a maioria destas linhas o advogado só precisa
          bater o olho e tirar da frente. */}
      {!item.lido && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onResolver();
          }}
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          Resolvi
        </Button>
      )}
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
    </div>
  );
}
