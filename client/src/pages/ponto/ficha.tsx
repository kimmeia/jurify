/**
 * RH · Colaborador — a ficha de uma pessoa.
 *
 * O que a lista da equipe resume em uma linha, aqui abre inteiro: o espelho
 * dia a dia, as ausências com o efeito de cada motivo, a conduta registrada e
 * a avaliação do ciclo.
 *
 * Lê da MESMA procedure que a lista (`espelhoEquipe`) e filtra a pessoa em
 * memória, em vez de ter uma consulta própria. É de propósito: duas consultas
 * com filtros levemente diferentes acabariam mostrando um total na lista e
 * outro na ficha da mesma pessoa, e o dia em que divergissem ninguém saberia
 * qual acreditar. O custo é carregar a equipe inteira — dezenas de linhas.
 */

import { useMemo, useState } from "react";
import { Link, useRoute, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Clock } from "lucide-react";
import type { Jornada } from "@shared/ponto";
import { resumirJornada, normalizarJornada } from "@shared/jornada";
import type { OcorrenciaGravada } from "@shared/ocorrencias";
import type { AvaliacaoGravada } from "@shared/avaliacao";
import {
  Avisos,
  competenciaAtual,
  DialogAjuste,
  PainelAvaliacao,
  PainelOcorrencias,
  Tabela,
  Total,
  type JornadaComparada,
} from "./pecas";

interface PessoaDaEquipe {
  colaboradorId: number;
  nome: string;
  cargo?: string | null;
  jornadaSemanal?: string | null;
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

export default function FichaColaborador() {
  const [, params] = useRoute("/ponto/:id");
  const busca = useSearch();
  const competencia = new URLSearchParams(busca).get("c") || competenciaAtual();
  const id = Number(params?.id);
  const [ajustando, setAjustando] = useState<Jornada | null>(null);

  const utils = trpc.useUtils();
  const equipe = trpc.rh.espelhoEquipe.useQuery({ competencia }, { retry: false });

  const pessoa = useMemo(
    () => ((equipe.data?.pessoas ?? []) as PessoaDaEquipe[]).find((p) => p.colaboradorId === id),
    [equipe.data, id],
  );

  const invalidar = () => {
    utils.rh.espelhoEquipe.invalidate();
    utils.rh.meuEspelho.invalidate();
  };

  const jornadaResumo = pessoa
    ? resumirJornada(normalizarJornada(pessoa.jornadaSemanal ?? null))
    : "";

  return (
    <div className="space-y-3">
      <Link href="/ponto" className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-violet-600 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" />
        RH · Equipe
      </Link>

      {equipe.isLoading && <Skeleton className="h-64" />}

      {equipe.isError && (
        <div className="rounded-xl border bg-card px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            Só quem gerencia a equipe pode abrir a ficha de outra pessoa. O seu próprio ponto está
            em <Link href="/ponto" className="font-semibold text-violet-600 hover:underline">RH</Link>.
          </p>
        </div>
      )}

      {equipe.data && !pessoa && (
        <div className="rounded-xl border bg-card px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            Colaborador não encontrado nesta competência.
          </p>
        </div>
      )}

      {pessoa && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Clock className="h-5 w-5 text-violet-600" />
            <div>
              <h1 className="text-lg font-extrabold">
                {pessoa.nome}
                {pessoa.removido && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                    removido
                  </span>
                )}
              </h1>
              <p className="text-[11.5px] text-muted-foreground">
                {pessoa.cargo || "sem cargo definido"}
                {jornadaResumo && ` · ${jornadaResumo}`}
              </p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              <div className="rounded-xl border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                      Espelho de ponto · {competencia.split("-").reverse().join("/")}
                    </p>
                    <Total t={pessoa.total} />
                  </div>
                  {pessoa.total.faltas.total > 0 && (
                    <p className="text-[10.5px] text-muted-foreground">
                      {pessoa.total.faltas.total} {pessoa.total.faltas.total === 1 ? "falta" : "faltas"}
                      {pessoa.total.faltas.abonadas > 0 && ` · ${pessoa.total.faltas.abonadas} abonada${pessoa.total.faltas.abonadas > 1 ? "s" : ""}`}
                      {pessoa.total.faltas.descontadas > 0 && ` · ${pessoa.total.faltas.descontadas} descontando`}
                      {pessoa.total.faltas.aguardando > 0 && ` · ${pessoa.total.faltas.aguardando} aguardando atestado`}
                    </p>
                  )}
                </div>
                <Tabela jornadas={pessoa.jornadas} aoAjustar={(j) => setAjustando(j)} />
                <div className="px-3 pb-3">
                  <Avisos jornadas={pessoa.jornadas} />
                </div>
              </div>

              <div className="rounded-xl border bg-card">
                <PainelOcorrencias ocorrencias={pessoa.ocorrencias} gestor aoMudar={invalidar} />
              </div>
            </div>

            <div className="rounded-xl border bg-card">
              {pessoa.avaliacoes.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11.5px] text-muted-foreground">
                  Nunca avaliada. Use o botão de avaliar na lista da equipe.
                </p>
              ) : (
                <PainelAvaliacao avaliacoes={pessoa.avaliacoes} gestor aoMudar={invalidar} />
              )}
            </div>
          </div>
        </>
      )}

      <DialogAjuste
        aberto={!!ajustando}
        onFechar={() => setAjustando(null)}
        colaboradorId={pessoa?.colaboradorId ?? null}
        jornada={ajustando}
        aoSalvar={invalidar}
      />
    </div>
  );
}
