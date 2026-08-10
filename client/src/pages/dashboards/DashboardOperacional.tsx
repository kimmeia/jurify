/**
 * Dashboard OPERACIONAL — pra setor tipo='operacional'.
 *
 * A pergunta do setor é "estamos entregando no prazo?", e a resposta é uma taxa.
 * Taxa sozinha não diz se está bem: 86% parece alto até você saber que o piso
 * combinado é 90%. Por isso a barra carrega o piso como marcador.
 *
 * O ranking ordena por ATRASO, não por desempenho: quem tem tarefa vencida é
 * quem precisa de ação hoje, e deixá-lo no rodapé de uma lista ordenada por
 * mérito é esconder exatamente o que o gestor abriu a tela pra ver.
 */

import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight, CalendarDays, Users } from "lucide-react";
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
} from "./common";

/** Piso de entrega no prazo do setor: a referência que a barra desenha. Sem
 *  ela "86%" não diz se está bem ou mal — só diz 86%. */
const PISO_NO_PRAZO = 90;

/** A partir daqui a pessoa entra na faixa de ação do topo. Três tarefas
 *  vencidas deixou de ser esquecimento e virou acúmulo. */
const ATRASOS_CRITICOS = 3;

export default function DashboardOperacional() {
  const [, nav] = useLocation();
  const { data, isLoading } = (trpc as any).dashboard.operacional.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) return <Esqueleto />;
  if (!data) {
    return (
      <div className="rounded-md border bg-card px-4 py-6">
        <p className="text-sm text-muted-foreground">Sem permissão para ver o painel operacional.</p>
      </div>
    );
  }

  const isGestor = data.modo === "gestor";
  const base = isGestor ? (data.equipe ?? data.meu) : data.meu;
  const taxa: number | null = base?.taxaNoPrazo ?? null;

  const tarefas = base?.tarefas ?? { noPrazo: 0, atrasadas: 0, concluidasNoPrazo: 0, concluidasFora: 0 };
  const agenda = base?.agenda ?? { noPrazo: 0, atrasadas: 0, concluidas: 0 };
  const emAberto = tarefas.noPrazo + tarefas.atrasadas;
  const entregues = tarefas.concluidasNoPrazo + tarefas.concluidasFora;
  const percentFora = entregues > 0 ? +((tarefas.concluidasFora / entregues) * 100).toFixed(1) : null;

  const ranking: any[] = data.ranking ?? [];
  const acumulando = ranking.filter((c) => (c.tarefas?.atrasadas ?? 0) >= ATRASOS_CRITICOS).length;

  // Atraso primeiro; entre os que têm o mesmo número de atrasos, pior taxa antes.
  const ordenado = [...ranking].sort(
    (a, b) =>
      (b.tarefas?.atrasadas ?? 0) - (a.tarefas?.atrasadas ?? 0) ||
      (a.taxaNoPrazo ?? 0) - (b.taxaNoPrazo ?? 0),
  );

  return (
    <div className="space-y-3.5">
      <PainelTopo
        titulo="Painel Operacional"
        subtitulo={
          <span className="tabular-nums">
            {isGestor ? "Visão gestor" : "Visão individual"} ·{" "}
            {formatDataCurta(data.periodo?.dataInicio)} a {formatDataCurta(data.periodo?.dataFim)}
          </span>
        }
        acao={
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => nav("/tarefas")}>
            Ver tarefas
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        }
      />

      {(tarefas.atrasadas > 0 || agenda.atrasadas > 0 || acumulando > 0) && (
        <FaixaAcoes>
          {tarefas.atrasadas > 0 && (
            <AcaoCard
              icone={AlertTriangle}
              valor={tarefas.atrasadas}
              label={tarefas.atrasadas === 1 ? "tarefa atrasada" : "tarefas atrasadas"}
              critico
              onClick={() => nav("/tarefas")}
            />
          )}
          {agenda.atrasadas > 0 && (
            <AcaoCard
              icone={CalendarDays}
              valor={agenda.atrasadas}
              label={agenda.atrasadas === 1 ? "compromisso atrasado" : "compromissos atrasados"}
              onClick={() => nav("/agenda")}
            />
          )}
          {isGestor && acumulando > 0 && (
            <AcaoCard
              icone={Users}
              valor={acumulando}
              label={`${acumulando === 1 ? "pessoa" : "pessoas"} com ${ATRASOS_CRITICOS}+ atrasos`}
              onClick={() => nav("/tarefas")}
            />
          )}
        </FaixaAcoes>
      )}

      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BlocoPrincipal
            rotulo={isGestor ? "Entregue no prazo — setor operacional" : "Sua entrega no prazo"}
            valor={
              taxa != null ? (
                <>
                  {taxa.toFixed(1)}
                  <span className="text-[22px]">%</span>
                </>
              ) : (
                <span className="text-[22px]">Sem entregas no período</span>
              )
            }
            badge={
              tarefas.atrasadas > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11.5px] font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  <AlertTriangle className="h-3 w-3" />
                  {tarefas.atrasadas} em atraso agora
                </span>
              ) : taxa != null && taxa >= PISO_NO_PRAZO ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-bold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Nada em atraso
                </span>
              ) : undefined
            }
            grafico={
              taxa != null ? (
                <BarraMeta
                  percentual={taxa}
                  referencia={PISO_NO_PRAZO}
                  legendaReferencia={`piso aceitável do setor: ${PISO_NO_PRAZO}%`}
                  legendaDireita={
                    <>
                      <b className="text-foreground">{formatPercent(taxa)}</b> entregue no prazo
                    </>
                  }
                  cor={taxa >= PISO_NO_PRAZO ? undefined : "var(--viz-2)"}
                />
              ) : (
                <p className="px-4 pb-4 pt-3 text-[11.5px] text-muted-foreground">
                  Nenhuma tarefa concluída no período — a taxa aparece quando houver entrega.
                </p>
              )
            }
          >
            <SubNumeros>
              <SubNumero
                label="Em aberto"
                valor={emAberto}
                hint={`${tarefas.noPrazo} no prazo · ${tarefas.atrasadas} atrasadas`}
              />
              <SubNumero label="Entregues no prazo" valor={tarefas.concluidasNoPrazo} hint="no período" />
              <SubNumero
                label="Entregues fora do prazo"
                valor={tarefas.concluidasFora}
                ruim={tarefas.concluidasFora > 0}
                hint={percentFora != null ? `${formatPercent(percentFora)} das entregas` : undefined}
              />
            </SubNumeros>
          </BlocoPrincipal>
        </div>

        <div className="relative min-h-0">
          <div className="lg:absolute lg:inset-0">
            <ListaCard
              titulo={isGestor ? "Meu mês" : "Minha agenda"}
              subtitulo={isGestor ? "Você, dentro do setor" : "Compromissos do período"}
              esticar
              rodape={
                <>
                  <span>Compromissos no prazo: {data.meu?.agenda?.noPrazo ?? 0}</span>
                  {(data.meu?.agenda?.atrasadas ?? 0) > 0 && (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      {data.meu.agenda.atrasadas} atrasados
                    </span>
                  )}
                </>
              }
            >
              <LinhaNumero
                label="Minha taxa no prazo"
                valor={formatPercent(data.meu?.taxaNoPrazo ?? null)}
                hint={
                  isGestor && taxa != null ? `setor está em ${formatPercent(taxa)}` : "no período"
                }
              />
              <LinhaNumero
                label="Minhas tarefas em aberto"
                valor={(data.meu?.tarefas?.noPrazo ?? 0) + (data.meu?.tarefas?.atrasadas ?? 0)}
                hint={`${data.meu?.tarefas?.noPrazo ?? 0} dentro do prazo`}
              />
              <LinhaNumero
                label="Minhas atrasadas"
                valor={data.meu?.tarefas?.atrasadas ?? 0}
                hint="precisam de ação"
                ruim={(data.meu?.tarefas?.atrasadas ?? 0) > 0}
              />
            </ListaCard>
          </div>
        </div>

        {isGestor && ordenado.length > 0 && (
          <div className="lg:col-span-3">
            <ListaCard
              titulo="Ranking de produção"
              subtitulo="Quem tem atraso aparece primeiro — é o que precisa de ação"
              acaoLabel="Ver equipe"
              onAcao={() => nav("/configuracoes?tab=equipe")}
              rodape={
                <>
                  <span>
                    {ordenado.length} {ordenado.length === 1 ? "colaborador" : "colaboradores"} ·{" "}
                    {entregues} entregas no período
                  </span>
                  {tarefas.atrasadas > 0 && (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      {tarefas.atrasadas} atrasadas
                    </span>
                  )}
                </>
              }
            >
              {ordenado.map((c: any, i: number) => {
                const atrasos = c.tarefas?.atrasadas ?? 0;
                return (
                  <LinhaRanking
                    key={c.colaboradorId}
                    nome={c.nome}
                    indice={i}
                    detalhe={`${atrasos} atrasadas · ${c.tarefas?.noPrazo ?? 0} no prazo · ${c.tarefas?.concluidasNoPrazo ?? 0} entregues no prazo`}
                    percentual={c.taxaNoPrazo ?? null}
                    ruim={atrasos > 0}
                    selo={
                      atrasos >= ATRASOS_CRITICOS ? (
                        <Selo tom="ruim">{atrasos} atrasos</Selo>
                      ) : atrasos === 0 && (c.taxaNoPrazo ?? 0) >= PISO_NO_PRAZO ? (
                        <Selo tom="ok">top</Selo>
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
