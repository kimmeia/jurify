/**
 * JurisIA (beta) — pesquisa jurisprudencial no acervo público.
 *
 * A tela tem uma hierarquia deliberada: a ESTATÍSTICA vem primeiro e o texto da
 * IA vem depois. É o inverso de um chat comum, e é de propósito — o número é
 * contado em SQL sobre o recorte inteiro, o texto é leitura de uma amostra. Quem
 * decide se pega a causa decide pelo número; o texto explica o que ele significa.
 *
 * Por isso também a resposta nunca traz percentual escrito: o servidor recusa o
 * turno se o modelo tentar medir o acervo (`contemNumeroInventado`). O único
 * número na tela é o do banco.
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Ancora } from "@/components/AncoraFonte";
import { toast } from "sonner";
import {
  Clock,
  Database,
  Gavel,
  Loader2,
  Plus,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  rotuloCurtoResultado,
  rotuloResultado,
  type EstatisticaRecorte,
  type FonteRecorte,
  type PesquisaGravada,
} from "@shared/jurisia-recorte";
import { formatarDuracao, type PerfilRecorte } from "@shared/jurisia-perfil";
import type { ResultadoProcesso } from "@shared/datajud-desfecho";

/** Slot de cor por resultado. Fixo: a cor segue o resultado, nunca o tamanho
 *  da fatia — senão filtrar um tribunal repinta o painel inteiro. */
const COR: Record<ResultadoProcesso, string> = {
  procedente: "var(--viz-1)",
  parcial: "var(--viz-2)",
  improcedente: "var(--viz-3)",
  acordo: "var(--viz-4)",
  extinto_sem_merito: "var(--viz-5)",
};

function Tile({ n, rotulo }: { n: number; rotulo: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-2.5 py-2">
      <p className="text-[19px] font-extrabold leading-none">{n.toLocaleString("pt-BR")}</p>
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{rotulo}</p>
    </div>
  );
}

function Barras({ e }: { e: EstatisticaRecorte }) {
  return (
    <div className="mt-3 space-y-1.5">
      {e.fatias.map((f) => (
        <div
          key={f.resultado}
          className="grid grid-cols-[128px_1fr_auto] items-center gap-2"
          title={`${rotuloResultado(f.resultado)}: ${f.quantidade} de ${e.comResultado} processos decididos`}
        >
          <span
            className={`truncate text-[11px] ${f.quantidade === 0 ? "text-muted-foreground/60" : "text-foreground/80"}`}
          >
            {rotuloCurtoResultado(f.resultado)}
          </span>
          <div
            className="h-2 w-full overflow-hidden rounded-[2px]"
            style={{ background: "var(--viz-trilho)" }}
          >
            {f.quantidade > 0 && (
              <div
                className="h-full rounded-r-[4px]"
                style={{ background: COR[f.resultado], width: `${f.percentual}%`, minWidth: "3px" }}
              />
            )}
          </div>
          {/* Duas colunas de largura fixa: com um span só, "8%" e "41%"
              encostam à direita em posições diferentes e a coluna serrilha. */}
          <span
            className={`flex text-[11px] tabular-nums ${f.quantidade === 0 ? "text-muted-foreground/60" : "text-foreground/80"}`}
          >
            <span className="w-9 text-right font-bold">{f.percentual}%</span>
            <span className="w-12 text-right text-muted-foreground">({f.quantidade})</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Perfil: quanto demora e como corre.
 *
 * Os marcadores são proporções INDEPENDENTES (um processo pode ter liminar e
 * recurso), não pedaços de um todo — por isso barras separadas numa cor só, e
 * nunca empilhadas. Cinco matizes aqui sugeririam partição que não existe; o
 * rótulo já carrega a identidade de cada linha.
 */
function PainelPerfil({ p }: { p: PerfilRecorte }) {
  const temTempo = p.medianaDias !== null;
  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          Como esses processos correm
        </p>
      </div>

      {temTempo ? (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[15px] font-extrabold">{formatarDuracao(p.medianaDias)}</span>
          {/* "de X a Y", não "entre X e Y": o Y já costuma ter um "e" dentro
              ("2 anos e 8 meses") e a frase fica ambígua. E é metade dos
              casos, não a maioria — p25–p75 é exatamente o miolo. */}
          <span className="text-[11px] text-muted-foreground">
            até a sentença (caso do meio) · metade dos casos leva de{" "}
            {formatarDuracao(p.p25Dias)} a {formatarDuracao(p.p75Dias)}
          </span>
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Sem data de ajuizamento suficiente pra medir o tempo destes processos.
        </p>
      )}

      <div className="mt-2.5 space-y-1.5">
        {p.marcadores.map((m) => (
          <div
            key={m.chave}
            className="grid grid-cols-[128px_1fr_auto] items-center gap-2"
            title={`${m.rotulo}: ${m.quantidade} de ${p.amostra} processos da amostra`}
          >
            <span className="truncate text-[11px] text-foreground/80">{m.rotulo}</span>
            <div
              className="h-2 w-full overflow-hidden rounded-[2px]"
              style={{ background: "var(--viz-trilho)" }}
            >
              {m.quantidade > 0 && (
                <div
                  className="h-full rounded-r-[4px]"
                  style={{ background: "var(--viz-1)", width: `${m.percentual}%`, minWidth: "3px" }}
                />
              )}
            </div>
            <span className="flex text-[11px] tabular-nums text-foreground/80">
              <span className="w-9 text-right font-bold">{m.percentual}%</span>
              <span className="w-12 text-right text-muted-foreground">({m.quantidade})</span>
            </span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        Sobre os {p.amostra.toLocaleString("pt-BR")} processos decididos mais recentes
        {p.amostra >= p.limiteAmostra ? ` (teto de ${p.limiteAmostra.toLocaleString("pt-BR")})` : ""}.
      </p>
    </div>
  );
}

function PainelRecorte({
  e,
  perfil,
  filtro,
}: {
  e: EstatisticaRecorte;
  perfil: PerfilRecorte | null;
  filtro: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        <Scale className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          Recorte do acervo
        </p>
      </div>
      <p className="mt-0.5 text-[12.5px] font-semibold">{filtro || "sem recorte"}</p>

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <Tile n={e.total} rotulo="no recorte" />
        <Tile n={e.comResultado} rotulo="já decididos" />
        <Tile n={e.emAndamento} rotulo="em andamento" />
      </div>

      {e.comResultado > 0 ? (
        <>
          <Barras e={e} />
          <p className="mt-2 text-[10px] text-muted-foreground">
            Percentuais sobre os processos já decididos. Contagem do banco, não da IA.
          </p>
        </>
      ) : (
        <p className="mt-2.5 text-[11.5px] text-muted-foreground">
          Nenhum processo deste recorte chegou ao fim ainda — não há desfecho a distribuir.
        </p>
      )}

      {e.comResultado > 0 && e.amostraPequena && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          Amostra pequena — com esse número de casos decididos o percentual ainda é anedota, não
          tendência.
        </p>
      )}

      {perfil && perfil.amostra > 0 && <PainelPerfil p={perfil} />}
    </div>
  );
}

function Resposta({ r }: { r: PesquisaGravada }) {
  const ordem = new Map<number, number>();
  r.fontesUsadas.forEach((id, i) => ordem.set(id, i + 1));

  return (
    <div className="space-y-2.5">
      <PainelRecorte e={r.estatistica} perfil={r.perfil ?? null} filtro={r.descricaoFiltro} />

      {!r.achou ? (
        <div className="rounded-xl rounded-bl-sm border border-amber-300 bg-amber-50 px-3.5 py-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="mb-1 flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-amber-700 dark:text-amber-400">
            <TriangleAlert className="h-3.5 w-3.5" />
            Sem base no acervo
          </p>
          <p className="text-[12.5px] leading-relaxed text-amber-900 dark:text-amber-200">
            {r.conclusao ?? "O acervo não tem processos que respondam isso."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl rounded-bl-sm border bg-muted/30 px-3.5 py-3">
          {r.afirmacoes.map((a, i) => (
            <p key={i} className={`text-[12.5px] leading-relaxed ${i > 0 ? "mt-2" : ""}`}>
              {a.texto}
              {a.fontes.map((id) => (
                <Ancora key={id} n={ordem.get(id) ?? 0} />
              ))}
            </p>
          ))}

          {r.conclusao && (
            <p className="mt-2.5 border-l-2 border-violet-300 pl-2.5 text-[12.5px] leading-relaxed text-foreground/90">
              {r.conclusao}
            </p>
          )}

          {r.fontesDetalhe.length > 0 && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-900 dark:text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                {r.fontesDetalhe.length === 1
                  ? "1 processo sustenta esta resposta"
                  : `${r.fontesDetalhe.length} processos sustentam esta resposta`}
              </p>
              <ul className="mt-1.5 space-y-1">
                {r.fontesDetalhe.map((f: FonteRecorte) => (
                  <li
                    key={f.id}
                    className="flex gap-2 text-[11px] text-emerald-900/90 dark:text-emerald-200/90"
                  >
                    <span className="shrink-0 font-extrabold">{ordem.get(f.id)}</span>
                    <span className="shrink-0 tabular-nums opacity-70">{f.data}</span>
                    <span className="min-w-0 truncate">{f.rotulo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function JurisIa() {
  const [conversaId, setConversaId] = useState<number | null>(null);
  const [pergunta, setPergunta] = useState("");
  const fimRef = useRef<HTMLDivElement | null>(null);

  const utils = trpc.useUtils();
  const { data: estado } = trpc.jurisia.estado.useQuery();
  const { data: acervo } = trpc.jurisia.acervo.useQuery();
  const { data: pesquisas } = trpc.jurisia.pesquisas.useQuery();
  const { data, isLoading } = trpc.jurisia.pesquisa.useQuery({ conversaId });

  const pesquisarMut = trpc.jurisia.pesquisar.useMutation({
    onSuccess: (r) => {
      setConversaId(r.conversaId);
      utils.jurisia.pesquisa.invalidate();
      utils.jurisia.pesquisas.invalidate();
      utils.jurisia.estado.invalidate();
      if (!r.ok) {
        toast.warning("A resposta não passou na checagem", {
          description:
            "O modelo tentou afirmar algo sem processo que sustentasse, ou inventou estatística. Nada foi mostrado.",
        });
      }
    },
    onError: (e) => toast.error("JurisIA indisponível", { description: e.message }),
  });

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data?.mensagens.length, pesquisarMut.isPending]);

  const cota = estado?.cota;
  const mensagens = data?.mensagens ?? [];

  const enviar = () => {
    const q = pergunta.trim();
    if (q.length < 3 || pesquisarMut.isPending) return;
    setPergunta("");
    pesquisarMut.mutate({ conversaId, pergunta: q });
  };

  if (cota?.semPlano) {
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-card px-4 py-10 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-violet-500" />
        <p className="mt-2 text-sm font-bold">JurisIA não está no seu plano</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pesquisa jurisprudencial sobre o acervo público: como um tipo de ação costuma terminar
          num tribunal, com os processos que sustentam a resposta.
        </p>
      </div>
    );
  }

  // Sugestão construída em cima do que foi COLETADO. Oferecer "TJSP" com o
  // acervo só do Ceará seria ensinar o advogado a fazer a pergunta que falha.
  const tribunalTopo = acervo?.tribunais[0]?.tribunal;
  const sugestoes = tribunalTopo
    ? [
      `Como o ${tribunalTopo} costuma decidir revisão de contrato bancário?`,
      `Ação de indenização por dano moral no ${tribunalTopo} termina como?`,
      `Execução de título extrajudicial no ${tribunalTopo}: qual o desfecho mais comum?`,
    ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Gavel className="h-5 w-5 text-violet-600" />
        <h1 className="text-lg font-extrabold">Pesquisa jurisprudencial</h1>
        <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          beta
        </span>
        {acervo && (
          <span className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[10.5px] text-muted-foreground">
            <Database className="h-3 w-3" />
            {acervo.processos.toLocaleString("pt-BR")} processos ·{" "}
            {acervo.tribunais.length} tribunal(is)
          </span>
        )}
        {cota && (
          <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">
            {cota.usadas} de {cota.limite} mensagens no mês
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-1.5">
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-1.5"
            onClick={() => setConversaId(null)}
          >
            <Plus className="h-3.5 w-3.5" />
            Nova pesquisa
          </Button>
          {(pesquisas ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setConversaId(p.id)}
              className={`block w-full truncate rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] ${
                p.id === conversaId ? "border-violet-300 bg-violet-50 dark:bg-violet-950/40" : "bg-card hover:bg-muted/50"
              }`}
            >
              {p.titulo ?? "Pesquisa"}
            </button>
          ))}
        </aside>

        <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
          <div className="min-h-[320px] space-y-3.5 overflow-y-auto px-4 py-3.5">
            {isLoading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : mensagens.length === 0 ? (
              <div className="py-6 text-center">
                <Search className="mx-auto h-5 w-5 text-muted-foreground" />
                {acervo && acervo.processos === 0 ? (
                  <p className="mx-auto mt-2 max-w-md text-[12.5px] text-muted-foreground">
                    O acervo ainda está vazio. Rode uma varredura em Admin → JurisIA para coletar
                    os processos de um tribunal — sem base coletada não há o que pesquisar.
                  </p>
                ) : (
                  <>
                    <p className="mx-auto mt-2 max-w-md text-[12.5px] text-muted-foreground">
                      Pergunte como um tipo de ação costuma terminar. A distribuição vem do banco;
                      a leitura vem com os processos que a sustentam.
                    </p>
                    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                      {sugestoes.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setPergunta(s)}
                          className="rounded-full border bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground hover:bg-muted/50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              mensagens.map((m) => {
                if (m.papel === "usuario") {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <p className="max-w-[80%] rounded-xl rounded-br-sm bg-violet-600 px-3.5 py-2.5 text-[12.5px] leading-snug text-white">
                        {m.conteudo}
                      </p>
                    </div>
                  );
                }
                if (m.recusa || !m.resposta) {
                  return (
                    <div
                      key={m.id}
                      className="rounded-xl rounded-bl-sm border border-dashed px-3.5 py-3"
                    >
                      <p className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Resposta descartada pela checagem
                      </p>
                      <p className="mt-1 text-[11.5px] text-muted-foreground">
                        Nada foi afirmado sem processo que sustentasse, e nenhum número saiu da IA.
                        Pergunte de outro jeito.
                      </p>
                    </div>
                  );
                }
                return <Resposta key={m.id} r={m.resposta as PesquisaGravada} />;
              })
            )}

            {pesquisarMut.isPending && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Contando o recorte no acervo…
              </div>
            )}
            <div ref={fimRef} />
          </div>

          <div className="border-t px-4 py-3">
            <div className="flex items-center gap-2">
              <Input
                value={pergunta}
                onChange={(ev) => setPergunta(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" && !ev.shiftKey) {
                    ev.preventDefault();
                    enviar();
                  }
                }}
                placeholder="Ex.: como o TJCE decide revisão de contrato bancário?"
                className="h-9"
                disabled={!cota?.pode || pesquisarMut.isPending}
              />
              <Button
                size="sm"
                className="h-9 shrink-0"
                disabled={!cota?.pode || pergunta.trim().length < 3 || pesquisarMut.isPending}
                onClick={enviar}
              >
                {pesquisarMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {cota && !cota.pode
                ? `Você usou as ${cota.limite} mensagens deste mês.`
                : "Beta — acervo público do CNJ (DataJud). Confira as fontes antes de peticionar."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
