/**
 * RH · Equipe — a visão do gestor.
 *
 * Uma LINHA por pessoa, não um card por pessoa. A diferença não é estética:
 * com sete pessoas, um card com a tabela de dias inteira dentro vira uma
 * página de rolagem em que ninguém compara ninguém — e comparar é justamente
 * o que essa tela serve. A linha responde as três perguntas do dia a dia
 * (está trabalhando? cumpriu as horas? foi avaliada?) e o resto fica na ficha,
 * a um clique.
 *
 * O painel AGORA existe pelo mesmo motivo do espelho: ele lê o ponto de hoje,
 * não uma presença declarada. Quem entrou e não saiu está trabalhando; quem
 * marcou pausa e não voltou está no almoço. É dedução, e a tela diz isso.
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, Clock, Coffee, Plus, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { formatarDuracao, type Jornada } from "@shared/ponto";
import { ROTULO_TIPO, type OcorrenciaGravada } from "@shared/ocorrencias";
import { NOTA_MAX, situacaoDoCiclo, type AvaliacaoGravada } from "@shared/avaliacao";
import {
  cicloPorExtenso,
  competenciaAtual,
  DialogAvaliar,
  DialogOcorrencia,
  diaCurto,
  hojeLocalISO,
  hora,
  PainelAvaliacao,
  PainelOcorrencias,
  ROTULO_CICLO,
  Tabela,
  textoDaNota,
  Total,
  type JornadaComparada,
} from "./ponto/pecas";

interface PessoaDaEquipe {
  colaboradorId: number;
  nome: string;
  cargo?: string | null;
  removido: boolean;
  jornadas: JornadaComparada[];
  ocorrencias: OcorrenciaGravada[];
  avaliacoes: AvaliacaoGravada[];
  total: {
    minutos: number;
    diasFechados: number;
    diasPendentes: number;
    previstoMin: number;
    saldoMin: number;
    diasAtrasados: number;
    faltas: { total: number; abonadas: number; descontadas: number; aguardando: number };
  };
}

type EstadoAgora = "trabalhando" | "almoco" | "encerrou" | "ausente" | "fora";

const ROTULO_AGORA: Record<EstadoAgora, { texto: string; ponto: string; cor: string }> = {
  trabalhando: { texto: "Trabalhando", ponto: "bg-success", cor: "text-success-fg" },
  almoco: { texto: "Em almoço", ponto: "bg-warning", cor: "text-warning-fg" },
  encerrou: { texto: "Encerrou", ponto: "bg-muted-foreground/50", cor: "text-muted-foreground" },
  ausente: { texto: "Ausência lançada", ponto: "bg-info", cor: "text-info-fg" },
  fora: { texto: "Sem registro hoje", ponto: "bg-muted-foreground/50", cor: "text-muted-foreground" },
};

/**
 * Onde a pessoa está agora, deduzido do ponto de hoje.
 *
 * A ordem importa: ausência lançada ganha de tudo, porque um dia com atestado
 * aprovado não deve aparecer como "sem registro" e virar cobrança.
 */
function estadoAgora(j: JornadaComparada | undefined): EstadoAgora {
  if (!j) return "fora";
  if (j.falta) return "ausente";
  if (j.pausaAberta) return "almoco";
  if (j.entrada && !j.saida) return "trabalhando";
  if (j.saida) return "encerrou";
  return "fora";
}

function Avatar({ nome, indice }: { nome: string; indice: number }) {
  const cores = ["bg-info", "bg-info", "bg-warning", "bg-success", "bg-danger"];
  const iniciais = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${cores[indice % cores.length]}`}
    >
      {iniciais || "?"}
    </span>
  );
}

/** A barra de horas do mês: realizado sobre previsto. */
function BarraJornada({ feito, previsto }: { feito: number; previsto: number }) {
  const pct = previsto > 0 ? Math.min((feito / previsto) * 100, 100) : 0;
  const faltando = previsto > 0 && feito < previsto;
  return (
    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span
        className={`block h-full rounded-full ${faltando ? "bg-warning" : "bg-info"}`}
        style={{ width: `${previsto > 0 ? pct : 0}%` }}
      />
    </span>
  );
}

function LinhaPessoa({
  p,
  indice,
  competencia,
  aoAbrir,
  aoLancar,
  aoAvaliar,
}: {
  p: PessoaDaEquipe;
  indice: number;
  competencia: string;
  aoAbrir: () => void;
  aoLancar: () => void;
  aoAvaliar: () => void;
}) {
  const hoje = hojeLocalISO();
  const doDia = p.jornadas.find((j) => j.dia === hoje);
  const agora = ROTULO_AGORA[estadoAgora(doDia)];
  const ultima = p.avaliacoes[0];
  const sit = situacaoDoCiclo(ultima?.ciclo, competencia);
  const selo = ROTULO_CICLO[sit];

  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2.5 last:border-b-0 hover:bg-muted/40">
      <button type="button" onClick={aoAbrir} className="flex items-center gap-2.5 text-left">
        <Avatar nome={p.nome} indice={indice} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold">
            {p.nome}
            {p.removido && (
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-muted-foreground">
                removido
              </span>
            )}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {p.cargo || "sem cargo definido"}
          </span>
        </span>
      </button>

      <div>
        <span className={`flex items-center gap-1.5 text-[12px] font-semibold ${agora.cor}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${agora.ponto}`} />
          {agora.texto}
        </span>
        <span className="block text-[10.5px] text-muted-foreground">
          {doDia?.entrada ? `entrou ${hora(doDia.entrada)}` : "—"}
        </span>
      </div>

      <div>
        <span className="flex items-baseline gap-1.5">
          <b className="text-[13px] tabular-nums">{formatarDuracao(p.total.minutos)}</b>
          <span className="text-[10.5px] text-muted-foreground">
            / {formatarDuracao(p.total.previstoMin)}
          </span>
          {p.total.previstoMin > 0 && p.total.diasFechados > 0 && (
            <span
              className={`ml-auto text-[11px] font-bold tabular-nums ${p.total.saldoMin >= 0 ? "text-success-fg" : "text-danger-fg"}`}
            >
              {p.total.saldoMin >= 0 ? "+" : "−"}
              {formatarDuracao(Math.abs(p.total.saldoMin))}
            </span>
          )}
        </span>
        <BarraJornada feito={p.total.minutos} previsto={p.total.previstoMin} />
        {(p.total.faltas.total > 0 || p.total.diasAtrasados > 0) && (
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            {p.total.faltas.total > 0 && (
              <>
                {p.total.faltas.total} {p.total.faltas.total === 1 ? "falta" : "faltas"}
                {p.total.faltas.descontadas > 0 && ` (${p.total.faltas.descontadas} desconta)`}
              </>
            )}
            {p.total.faltas.total > 0 && p.total.diasAtrasados > 0 && " · "}
            {p.total.diasAtrasados > 0 && `${p.total.diasAtrasados} atraso${p.total.diasAtrasados > 1 ? "s" : ""}`}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`flex h-9 w-11 shrink-0 flex-col items-center justify-center rounded-lg border ${
            ultima?.media != null ? "" : "text-muted-foreground"
          }`}
        >
          <b className={`text-[13px] leading-none tabular-nums ${ultima?.media != null ? textoDaNota(ultima.media) : ""}`}>
            {ultima?.media != null ? ultima.media.toFixed(1).replace(".", ",") : "—"}
          </b>
          <span className="text-[7.5px] font-bold uppercase tracking-wide text-muted-foreground">
            de {NOTA_MAX}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] text-muted-foreground">
            {ultima ? cicloPorExtenso(ultima.ciclo) : "nunca avaliada"}
          </span>
          {selo.texto && (
            <span className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ${selo.classe}`}>
              {selo.texto}
            </span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-8 px-2" title="Lançar ocorrência" onClick={aoLancar}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 px-2" title="Avaliar" onClick={aoAvaliar}>
          <ShieldCheck className="h-3.5 w-3.5" />
        </Button>
        <button type="button" onClick={aoAbrir} className="text-muted-foreground hover:text-info-fg" title="Abrir ficha">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Quem está onde agora — lido do ponto de hoje, não de presença declarada. */
function PainelAgora({ pessoas }: { pessoas: PessoaDaEquipe[] }) {
  const hoje = hojeLocalISO();
  const linhas = pessoas
    .filter((p) => !p.removido)
    .map((p) => {
      const j = p.jornadas.find((x) => x.dia === hoje);
      return { nome: p.nome, estado: estadoAgora(j), j };
    });

  const conta = (e: EstadoAgora) => linhas.filter((l) => l.estado === e).length;
  const ordem: EstadoAgora[] = ["trabalhando", "almoco", "ausente", "encerrou", "fora"];
  const visiveis = [...linhas].sort((a, b) => ordem.indexOf(a.estado) - ordem.indexOf(b.estado));

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-3.5 py-2.5">
        <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          Agora · {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}
        </p>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {(["trabalhando", "almoco", "fora"] as const).map((e) => (
            <div key={e} className="rounded-lg border px-2 py-1.5 text-center">
              <b className="block text-[17px] leading-none tabular-nums">{conta(e)}</b>
              <span className="text-[9.5px] text-muted-foreground">
                {e === "trabalhando" ? "trabalhando" : e === "almoco" ? "em almoço" : "fora"}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="max-h-[260px] overflow-y-auto px-3.5 py-2">
        {visiveis.map((l) => {
          const r = ROTULO_AGORA[l.estado];
          return (
            <div key={l.nome} className="flex items-center gap-2 py-1">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.ponto}`} />
              <span className="flex-1 truncate text-[12px]">{l.nome}</span>
              <span className="text-[10.5px] tabular-nums text-muted-foreground">
                {l.estado === "trabalhando" && l.j?.minutos != null
                  ? formatarDuracao(l.j.minutos)
                  : l.estado === "almoco"
                    ? "almoço"
                    : l.estado === "ausente"
                      ? "ausente"
                      : l.estado === "encerrou"
                        ? hora(l.j?.saida ?? null)
                        : "—"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="border-t px-3.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
        Deduzido do acesso ao sistema: quem entrou e não saiu aparece trabalhando. Não substitui
        registro eletrônico de ponto homologado — é instrumento de gestão interna.
      </p>
    </div>
  );
}

/** As últimas ocorrências do escritório inteiro, em ordem de acontecimento. */
function FeedConduta({
  pessoas,
  aoAbrir,
}: {
  pessoas: PessoaDaEquipe[];
  aoAbrir: (colaboradorId: number) => void;
}) {
  const registros = useMemo(() => {
    const todos = pessoas.flatMap((p) =>
      p.ocorrencias
        .filter((o) => o.tipo !== "falta")
        .map((o) => ({ ...o, nome: p.nome, colaboradorId: p.colaboradorId })),
    );
    return todos.sort((a, b) => b.dia.localeCompare(a.dia)).slice(0, 6);
  }, [pessoas]);

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-2.5">
        <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          Conduta e feedback · últimos registros
        </p>
      </div>
      {registros.length === 0 ? (
        <p className="px-4 py-5 text-center text-[11.5px] text-muted-foreground">
          Nenhum elogio, advertência ou observação registrado no período.
        </p>
      ) : (
        <div className="divide-y">
          {registros.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => aoAbrir(r.colaboradorId)}
              className="grid w-full grid-cols-[62px_150px_1fr] items-start gap-3 px-4 py-2 text-left hover:bg-muted/40"
            >
              <span className="text-[10.5px] capitalize text-muted-foreground">{diaCurto(r.dia)}</span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold">{r.nome}</span>
                <span className="block text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  {ROTULO_TIPO[r.tipo]}
                </span>
              </span>
              <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                {r.descricao || "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A própria folha, pra quem não gerencia equipe. */
function MeuPonto({ competencia }: { competencia: string }) {
  const utils = trpc.useUtils();
  const meu = trpc.rh.meuEspelho.useQuery({ competencia });

  return (
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
          acontece, o horário mostrado é o da última atividade, marcado como deduzido.
        </p>
      </div>
      {meu.isLoading ? (
        <Skeleton className="m-3 h-32" />
      ) : (
        <>
          <Tabela jornadas={(meu.data?.jornadas ?? []) as JornadaComparada[]} />
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
  );
}

export default function Ponto() {
  const [, navegar] = useLocation();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [lancando, setLancando] = useState<{ colaboradorId: number; nome: string } | null>(null);
  const [avaliando, setAvaliando] = useState<{ colaboradorId: number; nome: string } | null>(null);

  // Ponto tem módulo próprio na matriz de cargos e, por padrão, só o Dono o
  // tem. Quem não recebeu não entra — nem pelo menu, nem digitando a URL. O
  // gate real está no servidor; aqui a página evita cair num "meu ponto" que
  // fazia o módulo parecer disponível pra todo mundo.
  const { data: minhasPerms, isLoading: permsCarregando } =
    trpc.permissoes?.minhasPermissoes?.useQuery?.(undefined, {
      retry: false,
      refetchOnWindowFocus: false,
    }) || { data: null, isLoading: false };
  const podeVerPonto =
    minhasPerms?.cargo === "Dono" ||
    !!minhasPerms?.permissoes?.ponto?.verTodos ||
    !!minhasPerms?.permissoes?.ponto?.verProprios;

  const utils = trpc.useUtils();
  const meu = trpc.rh.meuEspelho.useQuery({ competencia }, { enabled: podeVerPonto });
  const equipe = trpc.rh.espelhoEquipe.useQuery(
    { competencia },
    { retry: false, enabled: podeVerPonto },
  );

  const pausaMut = trpc.rh.registrarPausa.useMutation({
    onSuccess: () => {
      utils.rh.meuEspelho.invalidate();
      utils.rh.espelhoEquipe.invalidate();
      toast.success("Pausa registrada");
    },
    onError: (e) => toast.error("Não deu pra registrar", { description: e.message }),
  });

  const hoje = hojeLocalISO();
  const jornadaHoje = meu.data?.jornadas.find((j: Jornada) => j.dia === hoje);
  const pausaAberta = !!jornadaHoje?.pausaAberta;

  const pessoas = (equipe.data?.pessoas ?? []) as PessoaDaEquipe[];
  // Ordenado pelo saldo do mês: quem está mais no vermelho aparece primeiro,
  // que é a linha sobre a qual o gestor precisa decidir alguma coisa.
  const ordenadas = useMemo(
    () => [...pessoas].sort((a, b) => a.total.saldoMin - b.total.saldoMin),
    [pessoas],
  );

  const invalidar = () => {
    utils.rh.espelhoEquipe.invalidate();
    utils.rh.meuEspelho.invalidate();
  };

  // Saída antecipada DEPOIS de todos os hooks: a contagem não pode mudar
  // entre renders, senão o React derruba a tela.
  if (!podeVerPonto) {
    return (
      <div className="max-w-lg mx-auto mt-16 rounded-2xl border bg-card p-6 text-center">
        <Clock className="h-8 w-8 text-muted-foreground/50 mx-auto" />
        <h1 className="text-base font-bold mt-3">Ponto não está no seu acesso</h1>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          {permsCarregando
            ? "Conferindo suas permissões…"
            : "Este módulo mostra a jornada, as faltas e as avaliações da equipe. Quem libera é o dono, em Configurações → Cargos."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Clock className="h-5 w-5 text-info-fg" />
        <h1 className="text-lg font-extrabold">
          RH{" "}
          <span className="font-medium text-muted-foreground">
            · {equipe.data ? "equipe" : "meu ponto"}
          </span>
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

      {equipe.isLoading && <Skeleton className="h-64" />}

      {equipe.data ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <div className="space-y-3">
            <div className="rounded-xl border bg-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-bold">Equipe</h2>
                  <span className="text-[11px] text-muted-foreground">
                    {ordenadas.length} {ordenadas.length === 1 ? "pessoa" : "pessoas"}
                  </span>
                </div>
                <span className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                  ordenado pelo saldo do mês
                </span>
              </div>

              <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] gap-3 border-b px-4 pb-1.5 pt-2">
                {["Pessoa", "Hoje", "Jornada do mês", "Avaliação", ""].map((h, i) => (
                  <span
                    key={h || i}
                    className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground"
                  >
                    {h}
                  </span>
                ))}
              </div>

              {ordenadas.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11.5px] text-muted-foreground">
                  Nenhum colaborador com registro nesta competência.
                </p>
              ) : (
                ordenadas.map((p, i) => (
                  <LinhaPessoa
                    key={p.colaboradorId}
                    p={p}
                    indice={i}
                    competencia={competencia}
                    aoAbrir={() => navegar(`/ponto/${p.colaboradorId}?c=${competencia}`)}
                    aoLancar={() => setLancando({ colaboradorId: p.colaboradorId, nome: p.nome })}
                    aoAvaliar={() => setAvaliando({ colaboradorId: p.colaboradorId, nome: p.nome })}
                  />
                ))
              )}
            </div>

            <FeedConduta pessoas={pessoas} aoAbrir={(id) => navegar(`/ponto/${id}?c=${competencia}`)} />
          </div>

          <PainelAgora pessoas={pessoas} />
        </div>
      ) : (
        !equipe.isLoading && <MeuPonto competencia={competencia} />
      )}

      <DialogOcorrencia
        aberto={!!lancando}
        onFechar={() => setLancando(null)}
        colaboradorId={lancando?.colaboradorId ?? null}
        nome={lancando?.nome ?? ""}
        diaInicial={hoje}
        aoSalvar={invalidar}
      />

      <DialogAvaliar
        aberto={!!avaliando}
        onFechar={() => setAvaliando(null)}
        colaboradorId={avaliando?.colaboradorId ?? null}
        nome={avaliando?.nome ?? ""}
        aoSalvar={invalidar}
      />
    </div>
  );
}
