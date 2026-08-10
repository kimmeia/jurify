/**
 * Dashboard COMERCIAL — pra setor tipo='comercial' (SDR, atendente, gestor).
 *
 * Mede três coisas conforme o briefing do produto: contratos fechados, contratos
 * pagos e % da meta. Valores em R$ NÃO aparecem — o % usa `faturado/metaPeriodo`
 * por baixo dos panos, mas o número absoluto fica fora da tela.
 *
 * A meta ganhou um marcador de ritmo. Sem ele, "78% da meta" é ambíguo: no dia
 * 5 é excelente e no dia 28 é problema, e o anel de progresso que vivia aqui
 * desenhava a mesma figura nos dois casos.
 */

import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight, Handshake, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AcaoCard,
  BarraMeta,
  BlocoPrincipal,
  FaixaAcoes,
  LinhaNumero,
  LinhaRanking,
  ListaCard,
  PainelTopo,
  Selo,
  SubNumero,
  SubNumeros,
  formatDataCurta,
  formatPercent,
  percentualDecorrido,
} from "./common";

/** Abaixo disto o colaborador entra na faixa de ação do topo. Menos de 40% da
 *  meta com o mês correndo não se recupera sozinho — vira conversa. */
const PISO_ATENCAO = 40;

export default function DashboardComercial() {
  const [, nav] = useLocation();
  const { data, isLoading } = (trpc as any).dashboard.comercial.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) return <Esqueleto />;
  if (!data) return <Aviso texto="Sem permissão para ver o painel comercial." />;
  if (!data.temSetor && data.modo === "individual") {
    return (
      <Aviso texto='Você não está atribuído a nenhum setor comercial. Peça ao administrador para vincular você a um setor do tipo "Comercial".' />
    );
  }

  const meu = data.meu;
  const ranking: any[] = data.ranking ?? [];
  const isGestor = data.modo === "gestor";

  const totais = isGestor
    ? ranking.reduce(
        (acc: any, c: any) => ({
          faturado: acc.faturado + c.faturado,
          contratosFechados: acc.contratosFechados + c.contratosFechados,
          contratosPagos: acc.contratosPagos + c.contratosPagos,
          metaPeriodo: acc.metaPeriodo + (c.metaPeriodo ?? 0),
        }),
        { faturado: 0, contratosFechados: 0, contratosPagos: 0, metaPeriodo: 0 },
      )
    : null;

  const progressoTime =
    totais && totais.metaPeriodo > 0
      ? +((totais.faturado / totais.metaPeriodo) * 100).toFixed(1)
      : null;
  const progresso = isGestor ? progressoTime : (meu?.progressoMeta ?? null);
  const fechados = isGestor ? totais!.contratosFechados : (meu?.contratosFechados ?? 0);
  const pagos = isGestor ? totais!.contratosPagos : (meu?.contratosPagos ?? 0);
  const semPagamento = Math.max(0, fechados - pagos);
  const conversao = fechados > 0 ? +((pagos / fechados) * 100).toFixed(1) : null;
  const temMeta = isGestor ? (totais!.metaPeriodo ?? 0) > 0 : (meu?.metaPeriodo ?? 0) > 0;

  const ritmo = percentualDecorrido(data.periodo?.dataInicio, data.periodo?.dataFim);
  const noRitmo = progresso != null && ritmo != null && progresso >= ritmo;

  const ordenado = [...ranking].sort((a, b) => {
    const pa = a.progressoMeta ?? -1;
    const pb = b.progressoMeta ?? -1;
    if (pa === pb) return b.contratosPagos - a.contratosPagos;
    return pb - pa;
  });
  const comMeta = ordenado.filter((c) => (c.metaPeriodo ?? 0) > 0);
  const semMeta = ordenado.filter((c) => (c.metaPeriodo ?? 0) <= 0);
  const bateram = comMeta.filter((c) => (c.progressoMeta ?? 0) >= 100).length;
  const emAtencao = comMeta.filter((c) => (c.progressoMeta ?? 0) < PISO_ATENCAO).length;
  const noCaminho = comMeta.length - bateram - emAtencao;

  return (
    <div className="space-y-3.5">
      <PainelTopo
        titulo="Painel Comercial"
        subtitulo={
          <span className="tabular-nums">
            {isGestor ? "Visão gestor" : "Visão individual"} ·{" "}
            {formatDataCurta(data.periodo?.dataInicio)} a {formatDataCurta(data.periodo?.dataFim)}
          </span>
        }
        acao={
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => nav("/relatorios")}>
            Ver relatórios
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        }
      />

      {isGestor && (emAtencao > 0 || semMeta.length > 0 || semPagamento > 0) && (
        <FaixaAcoes>
          {emAtencao > 0 && (
            <AcaoCard
              icone={AlertTriangle}
              valor={emAtencao}
              label={`abaixo de ${PISO_ATENCAO}% da meta`}
              critico
              onClick={() => nav("/configuracoes?tab=equipe")}
            />
          )}
          {semMeta.length > 0 && (
            <AcaoCard
              icone={Target}
              valor={semMeta.length}
              label={semMeta.length === 1 ? "colaborador sem meta definida" : "colaboradores sem meta definida"}
              onClick={() => nav("/configuracoes?tab=equipe")}
            />
          )}
          {semPagamento > 0 && (
            <AcaoCard
              icone={Handshake}
              valor={semPagamento}
              label="contratos fechados sem pagamento"
              onClick={() => nav("/financeiro")}
            />
          )}
        </FaixaAcoes>
      )}

      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BlocoPrincipal
            rotulo={isGestor ? "Progresso da meta do time" : "Progresso da sua meta"}
            valor={
              temMeta && progresso != null ? (
                <>
                  {progresso.toFixed(1)}
                  <span className="text-[22px]">%</span>
                </>
              ) : (
                <span className="text-[22px]">Sem meta definida</span>
              )
            }
            badge={
              temMeta && ritmo != null ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${
                    noRitmo
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                  }`}
                >
                  {noRitmo ? "Acima do ritmo do mês" : "Abaixo do ritmo do mês"}
                </span>
              ) : undefined
            }
            grafico={
              temMeta ? (
                <BarraMeta
                  percentual={progresso ?? 0}
                  referencia={ritmo}
                  legendaReferencia={
                    ritmo != null
                      ? `ritmo esperado a esta altura do mês: ${Math.round(ritmo)}%`
                      : "meta do período"
                  }
                  legendaDireita={
                    <>
                      <b className="text-foreground">{formatPercent(progresso)}</b>{" "}
                      {isGestor ? "da meta do time" : "da sua meta"}
                    </>
                  }
                />
              ) : (
                <p className="px-4 pb-4 pt-3 text-[11.5px] text-muted-foreground">
                  Sem meta cadastrada para o período. Defina em Configurações → Equipe para
                  acompanhar o progresso aqui.
                </p>
              )
            }
          >
            <SubNumeros>
              <SubNumero
                label="Contratos fechados"
                valor={fechados}
                hint={semPagamento > 0 ? `${semPagamento} ainda sem pagamento` : undefined}
              />
              <SubNumero label="Contratos pagos" valor={pagos} hint="no período" />
              <SubNumero
                label="Conversão"
                valor={formatPercent(conversao, 1)}
                hint="pagos sobre fechados"
              />
            </SubNumeros>
          </BlocoPrincipal>
        </div>

        {isGestor && (
          <div className="relative min-h-0">
            <div className="lg:absolute lg:inset-0">
              <ListaCard
                titulo="Como está o time"
                subtitulo={`${ranking.length} ${ranking.length === 1 ? "pessoa" : "pessoas"} no setor comercial`}
                esticar
                rodape={
                  <>
                    <span>Ordenado por % da meta</span>
                    <span>Atualiza a cada minuto</span>
                  </>
                }
              >
                <LinhaNumero label="Bateram a meta" valor={bateram} hint="100% ou mais" />
                <LinhaNumero
                  label="No caminho"
                  valor={noCaminho}
                  hint={`entre ${PISO_ATENCAO}% e 99%`}
                />
                <LinhaNumero
                  label="Precisam de atenção"
                  valor={emAtencao + semMeta.length}
                  hint={`abaixo de ${PISO_ATENCAO}% ou sem meta`}
                  ruim={emAtencao + semMeta.length > 0}
                />
              </ListaCard>
            </div>
          </div>
        )}

        {isGestor && ranking.length > 0 && (
          <div className="lg:col-span-3">
            <ListaCard
              titulo="Ranking do time comercial"
              subtitulo="Só quem é do setor Comercial aparece aqui"
              acaoLabel="Ver equipe"
              onAcao={() => nav("/configuracoes?tab=equipe")}
              rodape={
                <>
                  <span>
                    {ranking.length} {ranking.length === 1 ? "colaborador" : "colaboradores"} ·{" "}
                    {fechados} fechados · {pagos} pagos
                  </span>
                  {emAtencao > 0 && (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      {emAtencao} abaixo de {PISO_ATENCAO}%
                    </span>
                  )}
                </>
              }
            >
              {ordenado.map((c: any, i: number) => {
                const temMetaLinha = (c.metaPeriodo ?? 0) > 0;
                const pct = temMetaLinha ? (c.progressoMeta ?? 0) : null;
                return (
                  <LinhaRanking
                    key={c.atendenteId}
                    posicao={i + 1}
                    nome={c.nome}
                    indice={i}
                    detalhe={`${c.contratosFechados} fechados · ${c.contratosPagos} pagos`}
                    percentual={pct}
                    ruim={pct != null && pct < PISO_ATENCAO}
                    selo={
                      !temMetaLinha ? (
                        <Selo tom="neutro">sem meta</Selo>
                      ) : pct != null && pct >= 100 ? (
                        <Selo tom="ok">{i === 0 ? "top" : "meta"}</Selo>
                      ) : pct != null && pct < PISO_ATENCAO ? (
                        <Selo tom="ruim">atenção</Selo>
                      ) : undefined
                    }
                  />
                );
              })}
            </ListaCard>
          </div>
        )}
      </div>
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="rounded-md border bg-card px-4 py-6">
      <p className="text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-3.5">
      <div className="h-14 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-[62px] animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="h-56 animate-pulse rounded-md bg-muted lg:col-span-2" />
        <div className="h-56 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}
