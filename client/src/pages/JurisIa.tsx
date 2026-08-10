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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  BarChart3,
  Clock,
  Database,
  Gavel,
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
  Plus,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { ComposicaoAcervo } from "@shared/jurisia-acervo";
import type { Comparacao } from "@shared/jurisia-estrategia";
import type { ComposicaoNatureza } from "@shared/jurisia-grau";
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

/**
 * Quanto do número já é definitivo.
 *
 * Sem isto, uma sentença procedente com apelação pendente conta como
 * "procedente" e pode virar improcedente no ano seguinte — o painel estaria
 * certo hoje e mentiroso depois, sem nada avisando.
 *
 * `transitados` ausente é "não medi", não zero. Pesquisa gravada antes desta
 * conta não tem o número, e afirmar "nenhum transitou" sobre o que não foi
 * medido é pior que ficar calado.
 */
function Transito({ e }: { e: EstatisticaRecorte }) {
  if (e.transitados === undefined || e.comResultado === 0) return null;

  const pct = Math.round((e.transitados * 100) / e.comResultado);
  const provisorios = e.comResultado - e.transitados;

  return (
    <div className="mt-2 flex items-baseline gap-1.5 text-[11px]">
      <span className="font-bold tabular-nums text-foreground">{pct}%</span>
      <span className="text-muted-foreground">
        já transitou em julgado
        {provisorios > 0 && (
          <> · {provisorios.toLocaleString("pt-BR")} ainda pode mudar em recurso</>
        )}
      </span>
    </div>
  );
}

/**
 * Quanto do recorte é acórdão e quanto é sentença.
 *
 * Vem antes das barras de propósito: "isto é jurisprudência?" é uma pergunta
 * anterior a "quanto deu procedente". Sem esta linha o painel apresenta
 * sentença de vara com a mesma cara de entendimento de tribunal.
 */
function PainelNatureza({ n, aviso }: { n: ComposicaoNatureza; aviso: string | null }) {
  const total = n.jurisprudencia + n.estatistica + n.indefinido;
  if (total === 0) return null;
  const fatia = (q: number) => `${Math.round((q * 100) / total)}%`;

  return (
    <div className="mt-2.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {n.jurisprudencia > 0 && (
          <div className="bg-violet-500" style={{ width: fatia(n.jurisprudencia) }} />
        )}
        {n.estatistica > 0 && (
          <div className="bg-slate-400" style={{ width: fatia(n.estatistica) }} />
        )}
        {n.indefinido > 0 && (
          <div className="bg-muted-foreground/30" style={{ width: fatia(n.indefinido) }} />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
        {n.jurisprudencia > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
            <strong className="tabular-nums text-foreground">
              {n.jurisprudencia.toLocaleString("pt-BR")}
            </strong>{" "}
            acórdão — jurisprudência
          </span>
        )}
        {n.estatistica > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            <strong className="tabular-nums text-foreground">
              {n.estatistica.toLocaleString("pt-BR")}
            </strong>{" "}
            sentença de 1º grau
          </span>
        )}
        {n.indefinido > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            <strong className="tabular-nums text-foreground">
              {n.indefinido.toLocaleString("pt-BR")}
            </strong>{" "}
            sem grau informado
          </span>
        )}
      </div>
      {aviso && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          {aviso}
        </p>
      )}
    </div>
  );
}

function PainelRecorte({
  e,
  perfil,
  filtro,
  natureza,
  avisoNatureza,
}: {
  e: EstatisticaRecorte;
  perfil: PerfilRecorte | null;
  filtro: string;
  natureza?: ComposicaoNatureza;
  avisoNatureza?: string | null;
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

      {natureza && <PainelNatureza n={natureza} aviso={avisoNatureza ?? null} />}

      {e.comResultado > 0 ? (
        <>
          <Barras e={e} />
          <p className="mt-2 text-[10px] text-muted-foreground">
            Percentuais sobre os processos já decididos. Contagem do banco, não da IA.
          </p>
          <Transito e={e} />
        </>
      ) : (
        // "Nenhum chegou ao fim" só é verdade quando HÁ processos. Com o
        // recorte vazio a frase mentia, e ainda aparecia junto do bloco "sem
        // base no acervo" — duas mensagens contando histórias diferentes sobre
        // o mesmo zero.
        <p className="mt-2.5 text-[11.5px] text-muted-foreground">
          Nenhum destes {e.total.toLocaleString("pt-BR")} processos chegou ao fim ainda — não há
          desfecho a distribuir.
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

/**
 * Os três modos do assistente.
 *
 * Só Pesquisar responde hoje. Os outros dois aparecem marcados como "em breve"
 * em vez de sumirem: o advogado precisa saber que existem — mas mostrar aba
 * viva que não faz nada foi exatamente o defeito que o módulo já teve no menu.
 */
export type Modo = "pesquisar" | "estrategia" | "peca";

const MODOS = [
  { id: "pesquisar", rotulo: "Pesquisar", icone: Search, pronto: true },
  { id: "estrategia", rotulo: "Estratégia", icone: BarChart3, pronto: true },
  { id: "peca", rotulo: "Redigir peça", icone: Pencil, pronto: false },
] as const;

function SeletorModo({ modo, onModo }: { modo: Modo; onModo: (m: Modo) => void }) {
  return (
    <div className="mb-2.5 inline-flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
      {MODOS.map((m) => {
        const Icone = m.icone;
        const ativo = m.id === modo;
        return (
          <button
            key={m.id}
            type="button"
            disabled={!m.pronto}
            onClick={() => m.pronto && onModo(m.id as Modo)}
            title={m.pronto ? undefined : "Chegando — pesquisa e estratégia já funcionam."}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold ${
              !m.pronto
                ? "cursor-not-allowed text-muted-foreground/60"
                : ativo
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icone className="h-3.5 w-3.5" />
            {m.rotulo}
            {!m.pronto && (
              <span className="rounded-full border px-1.5 text-[8.5px] font-extrabold uppercase tracking-[0.06em]">
                em breve
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * O escritório contra o tribunal.
 *
 * As duas colunas só podem existir lado a lado porque o histórico do escritório
 * é reclassificado com o MESMO classificador do acervo — o `desfecho` gravado
 * nos eventos é relativo ao polo e não compara com "procedente".
 */
function PainelComparacao({ c }: { c: Comparacao }) {
  if (c.escritorioTotal === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card px-3.5 py-3">
        <p className="text-[11.5px] text-muted-foreground">
          Seu escritório ainda não tem caso desse tipo cadastrado — então a comparação é só com o
          tribunal. Conforme você monitorar processos assim, esta parte ganha corpo.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          O tribunal e o seu escritório
        </p>
      </div>

      <div className="mt-2.5 space-y-2">
        {c.linhas
          .filter((l) => l.acervoQtd > 0 || l.escritorioQtd > 0)
          .map((l) => (
            <div key={l.resultado} className="grid grid-cols-[128px_1fr] items-center gap-2">
              <span className="truncate text-[11px] text-foreground/80">
                {rotuloCurtoResultado(l.resultado)}
              </span>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 flex-1 overflow-hidden rounded-[2px]"
                    style={{ background: "var(--viz-trilho)" }}
                  >
                    <div
                      className="h-full rounded-r-[4px]"
                      style={{ background: "var(--viz-3)", width: `${l.acervoPct}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-[10.5px] tabular-nums text-muted-foreground">
                    tribunal <b className="text-foreground/80">{l.acervoPct}%</b>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 flex-1 overflow-hidden rounded-[2px]"
                    style={{ background: "var(--viz-trilho)" }}
                  >
                    <div
                      className="h-full rounded-r-[4px]"
                      style={{ background: "var(--acento, #7c3aed)", width: `${l.escritorioPct}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-[10.5px] tabular-nums text-muted-foreground">
                    você <b className="text-violet-700 dark:text-violet-300">{l.escritorioPct}%</b>
                  </span>
                </div>
              </div>
            </div>
          ))}
      </div>

      {c.amostraPequena ? (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          Você tem {c.escritorioDecididos} caso(s) decidido(s) desse tipo. É pouco para afirmar que
          seu resultado difere do tribunal — o número está aqui como pista, não como prova.
        </p>
      ) : c.destaque ? (
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-foreground/90">
          Em <b>{rotuloCurtoResultado(c.destaque.resultado).toLowerCase()}</b>, seu escritório fica{" "}
          {c.destaque.diferencaPp > 0 ? "acima" : "abaixo"} do tribunal — sobre{" "}
          {c.escritorioDecididos} caso(s) seus e {c.acervoDecididos} do acervo.
        </p>
      ) : (
        <p className="mt-2.5 text-[11.5px] text-muted-foreground">
          Seu resultado acompanha o do tribunal, sem diferença relevante.
        </p>
      )}
    </div>
  );
}

/**
 * De onde a resposta saiu.
 *
 * O painel mostra a MATÉRIA-PRIMA, não repete a estatística que já está na
 * conversa: o que foi coletado, qual recorte a última pergunta usou, e quantos
 * processos sustentam o texto. É o que separa "IA que chuta" de "IA que leu".
 */
function PainelContexto({
  acervo,
  ultima,
}: {
  acervo?: ComposicaoAcervo;
  ultima: PesquisaGravada | null;
}) {
  return (
    <aside className="hidden flex-col gap-2.5 rounded-xl border bg-card p-3.5 xl:flex">
      <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
        O que a IA está usando
      </p>

      <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2.5 dark:border-violet-900 dark:bg-violet-950/20">
        <div className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 shrink-0 text-violet-600" />
          <p className="flex-1 text-[11.5px] font-bold">Acervo público</p>
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-px text-[9px] font-extrabold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
            {(acervo?.total ?? 0).toLocaleString("pt-BR")}
          </span>
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
          {acervo && acervo.tribunais.length > 0
            ? `${acervo.tribunais.map((t) => t.tribunal).join(", ")} · desfecho e tempo contados no banco.`
            : "Nenhum tribunal coletado ainda."}
        </p>
      </div>

      {ultima ? (
        <>
          <div className="rounded-lg border px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="flex-1 text-[11.5px] font-bold">Recorte da última pergunta</p>
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
              {ultima.descricaoFiltro || "sem recorte"} ·{" "}
              <b className="text-foreground/80">
                {ultima.estatistica.total.toLocaleString("pt-BR")}
              </b>{" "}
              processos.
            </p>
          </div>

          {ultima.fontesDetalhe.length > 0 && (
            <div className="rounded-lg border px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <p className="flex-1 text-[11.5px] font-bold">Processos citados</p>
                <span className="text-[11px] font-bold tabular-nums">
                  {ultima.fontesDetalhe.length}
                </span>
              </div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                Cada frase da resposta aponta para um deles. Sem processo, a frase não passa.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-dashed px-3 py-2.5">
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Faça uma pergunta e aqui aparece o recorte que ela usou e os processos que sustentam a
            resposta.
          </p>
        </div>
      )}

      <p className="mt-auto border-t pt-2.5 text-[10px] leading-relaxed text-muted-foreground">
        O acervo é público e igual para todos os escritórios. Nada dos seus processos entra nele.
      </p>
    </aside>
  );
}

/**
 * Uma pesquisa na lista lateral, com renomear e excluir.
 *
 * O título nasce da primeira pergunta cortada, e duas perguntas parecidas
 * viram dois itens quase iguais na lista. Sem renomear, a lista envelhece mal;
 * sem excluir, toda busca que deu errado fica lá pra sempre.
 */
function LinhaPesquisa({
  titulo,
  ativa,
  onAbrir,
  onRenomear,
  onExcluir,
  excluindo,
}: {
  id: number;
  titulo: string;
  ativa: boolean;
  onAbrir: () => void;
  onRenomear: (titulo: string) => void;
  onExcluir: () => void;
  excluindo: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(titulo);

  if (editando) {
    return (
      <Input
        autoFocus
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => setEditando(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const t = rascunho.trim();
            if (t) onRenomear(t);
            setEditando(false);
          }
          if (e.key === "Escape") {
            setRascunho(titulo);
            setEditando(false);
          }
        }}
        className="h-8 text-[11.5px]"
      />
    );
  }

  return (
    <div
      className={`group flex items-center gap-1 rounded-lg border px-2.5 py-1.5 ${
        ativa ? "border-violet-300 bg-violet-50 dark:bg-violet-950/40" : "bg-card hover:bg-muted/50"
      }`}
    >
      <button
        type="button"
        onClick={onAbrir}
        className="min-w-0 flex-1 truncate text-left text-[11.5px]"
      >
        {titulo}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="shrink-0 text-muted-foreground/50 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onSelect={() => {
              setRascunho(titulo);
              setEditando(true);
            }}
          >
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Renomear
          </DropdownMenuItem>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={(e) => e.preventDefault()}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Excluir
              </DropdownMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir “{titulo}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  As perguntas e as respostas desta pesquisa somem. As mensagens já usadas do mês
                  não voltam.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={excluindo}
                  onClick={onExcluir}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * O recorte deu zero.
 *
 * Antes eram dois blocos contando histórias diferentes sobre o mesmo zero, e
 * nenhum dizia o que fazer. Aqui é um só, e ele mostra o que EXISTE — que é a
 * única informação capaz de transformar a busca falha em busca boa.
 */
function SemBase({
  r,
  acervo,
  aoEscolherTipo,
}: {
  r: PesquisaGravada;
  acervo?: ComposicaoAcervo;
  aoEscolherTipo: (nome: string) => void;
}) {
  const topo = (acervo?.classes ?? []).slice(0, 4);
  return (
    <div className="rounded-xl rounded-bl-sm border border-amber-300 bg-amber-50 px-4 py-3.5 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="flex items-center gap-2 text-[13.5px] font-bold text-amber-900 dark:text-amber-200">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        {r.descricaoFiltro
          ? `Nada no acervo para ${r.descricaoFiltro}`
          : "Não consegui montar um recorte com essa pergunta"}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-amber-900/90 dark:text-amber-200/90">
        {r.conclusao ?? "O acervo não tem processos que respondam isso."}
      </p>

      {topo.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-white/70 px-3 py-2.5 dark:border-amber-900 dark:bg-black/20">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-amber-700 dark:text-amber-400">
            O que já está coletado
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topo.map((c) => (
              <button
                key={c.nome}
                type="button"
                onClick={() => aoEscolherTipo(c.nome)}
                className="rounded-full border bg-card px-2.5 py-1 text-[11.5px] text-foreground/80 hover:bg-muted/60"
              >
                {c.nome}{" "}
                <span className="font-bold tabular-nums">{c.quantidade.toLocaleString("pt-BR")}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-400">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        Esta busca não consumiu nenhuma mensagem do seu mês.
      </p>
    </div>
  );
}

function Resposta({
  r,
  acervo,
  aoEscolherTipo,
}: {
  r: PesquisaGravada;
  acervo?: ComposicaoAcervo;
  aoEscolherTipo: (nome: string) => void;
}) {
  const ordem = new Map<number, number>();
  r.fontesUsadas.forEach((id, i) => ordem.set(id, i + 1));

  // Recorte vazio: um bloco só. O painel de zeros ao lado de "não achei" era
  // ruído em cima de má notícia.
  if (r.estatistica.total === 0) {
    return <SemBase r={r} acervo={acervo} aoEscolherTipo={aoEscolherTipo} />;
  }

  return (
    <div className="space-y-2.5">
      <PainelRecorte
        e={r.estatistica}
        perfil={r.perfil ?? null}
        filtro={r.descricaoFiltro}
        natureza={r.natureza}
        avisoNatureza={r.avisoNatureza}
      />
      {r.comparacao && <PainelComparacao c={r.comparacao} />}

      {!r.achou ? (
        <div className="rounded-xl rounded-bl-sm border border-amber-300 bg-amber-50 px-3.5 py-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="mb-1 flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-amber-700 dark:text-amber-400">
            <TriangleAlert className="h-3.5 w-3.5" />
            Não respondi com o que há aqui
          </p>
          <p className="text-[12.5px] leading-relaxed text-amber-900 dark:text-amber-200">
            {r.conclusao ?? "Os processos deste recorte não respondem essa pergunta."}
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
                    {f.natureza && (
                      <span
                        className={`shrink-0 rounded px-1 text-[9.5px] font-bold uppercase tracking-wide ${
                          f.natureza === "jurisprudencia"
                            ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                            : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {f.natureza === "jurisprudencia" ? "acórdão" : "1º grau"}
                      </span>
                    )}
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
  const [modo, setModo] = useState<Modo>("pesquisar");
  const fimRef = useRef<HTMLDivElement | null>(null);

  const utils = trpc.useUtils();
  const { data: estado } = trpc.jurisia.estado.useQuery();
  const { data: acervo } = trpc.jurisia.acervo.useQuery();
  const { data: pesquisas } = trpc.jurisia.pesquisas.useQuery();
  const { data, isLoading } = trpc.jurisia.pesquisa.useQuery({ conversaId });

  const renomearMut = trpc.jurisia.renomearPesquisa.useMutation({
    onSuccess: () => utils.jurisia.pesquisas.invalidate(),
    onError: (e) => toast.error("Não deu pra renomear", { description: e.message }),
  });

  const excluirMut = trpc.jurisia.excluirPesquisa.useMutation({
    onSuccess: (_r, vars) => {
      utils.jurisia.pesquisas.invalidate();
      // A conversa aberta deixou de existir; sem isto a tela consulta um id
      // morto e mostra "não encontrada".
      if (vars.conversaId === conversaId) setConversaId(null);
      toast.success("Pesquisa excluída");
    },
    onError: (e) => toast.error("Não deu pra excluir", { description: e.message }),
  });

  const pesquisarMut = trpc.jurisia.pesquisar.useMutation({
    onSuccess: (r) => {
      setConversaId(r.conversaId);
      utils.jurisia.pesquisa.invalidate();
      utils.jurisia.pesquisas.invalidate();
      utils.jurisia.estado.invalidate();
      if (r.semBase) {
        toast.info("Nada no acervo para essa busca", {
          description: "Não consumiu mensagem — escolha um dos tipos que já foram coletados.",
        });
      } else if (!r.ok) {
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

  // A última resposta com conteúdo — é dela que o painel da direita fala.
  // Percorre de trás pra frente porque a conversa cresce pra baixo.
  const ultimaResposta = (() => {
    for (let i = mensagens.length - 1; i >= 0; i--) {
      const m = mensagens[i];
      if (m.papel === "assistente" && m.resposta) return m.resposta as PesquisaGravada;
    }
    return null;
  })();

  const enviar = () => {
    const q = pergunta.trim();
    if (q.length < 3 || pesquisarMut.isPending) return;
    setPergunta("");
    pesquisarMut.mutate({ conversaId, pergunta: q, modo: modo === "peca" ? "pesquisar" : modo });
  };

  // Três bloqueios que parecem um só e não são. "Renove" pra quem nunca
  // comprou soa como cobrança de dívida inexistente; "contrate" pra quem
  // deixou vencer apaga o histórico do cliente.
  const acesso = estado?.acesso;
  if (acesso && !acesso.liberado) {
    const texto = acesso.motivo === "expirado"
      ? {
        titulo: "O contrato do JurisIA venceu",
        corpo: "Suas pesquisas continuam salvas. Renovando, você volta de onde parou.",
      }
      : acesso.motivo === "suspenso"
        ? {
          titulo: "JurisIA suspenso",
          corpo: "O módulo está suspenso para o seu escritório. Fale com o suporte para reativar.",
        }
        : {
          titulo: "JurisIA é contratado à parte",
          corpo:
            "Pesquisa jurisprudencial sobre o acervo público: como um tipo de ação costuma terminar num tribunal, com os processos que sustentam a resposta.",
        };
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-card px-4 py-10 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-violet-500" />
        <p className="mt-2 text-sm font-bold">{texto.titulo}</p>
        <p className="mt-1 text-xs text-muted-foreground">{texto.corpo}</p>
      </div>
    );
  }

  // Sugestão feita a partir do que foi COLETADO, não de palpite. Oferecer
  // "revisão de contrato bancário" num acervo só de execução fiscal é ensinar
  // o advogado a fazer exatamente a pergunta que falha.
  const tribunalTopo = acervo?.tribunais[0]?.tribunal;
  const sugestoes = tribunalTopo
    ? (acervo?.classes ?? [])
      .slice(0, 3)
      .map((c) => `${c.nome} no ${tribunalTopo}: como costuma terminar?`)
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Gavel className="h-5 w-5 text-violet-600" />
        <h1 className="text-lg font-extrabold">
          JurisIA <span className="font-medium text-muted-foreground">· assistente jurídico</span>
        </h1>
        <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          beta
        </span>
        {acervo && acervo.total > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[10.5px] text-muted-foreground">
            <Database className="h-3 w-3" />
            {acervo.total.toLocaleString("pt-BR")} processos ·{" "}
            {acervo.tribunais.length === 1
              ? acervo.tribunais[0].tribunal
              : `${acervo.tribunais.length} tribunais`}
          </span>
        )}
        {cota && (
          <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">
            Você usou {cota.usadas} de {cota.limite} mensagens do mês
          </span>
        )}
      </div>

      {/* A correção central: o advogado vê o que existe ANTES de perguntar.
          Sem esta barra o módulo é adivinhação — digita, erra, e nunca
          descobre que o acervo só tem execução fiscal. */}
      {acervo && acervo.classes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-3.5 py-2.5">
          <div className="shrink-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Você pode pesquisar
            </p>
            <p className="text-[12.5px] font-bold">
              {acervo.total.toLocaleString("pt-BR")} processos
              {acervo.tribunais.length === 1 ? ` do ${acervo.tribunais[0].tribunal}` : ""}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {acervo.classes.map((c) => (
              <button
                key={c.nome}
                type="button"
                onClick={() =>
                  setPergunta(`${c.nome} no ${tribunalTopo ?? ""}: como costuma terminar?`.trim())
                }
                className="rounded-full border bg-card px-2.5 py-1 text-[11.5px] text-foreground/80 hover:bg-muted/60"
              >
                {c.nome}{" "}
                <span className="font-bold tabular-nums">{c.quantidade.toLocaleString("pt-BR")}</span>
              </button>
            ))}
            {acervo.classesRestantes > 0 && (
              <span className="rounded-full border border-dashed px-2.5 py-1 text-[11.5px] text-muted-foreground">
                + {acervo.classesRestantes} tipos
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[210px_1fr] xl:grid-cols-[210px_1fr_300px]">
        <aside className="space-y-1.5">
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-1.5"
            onClick={() => setConversaId(null)}
          >
            <Plus className="h-3.5 w-3.5" />
            Novo trabalho
          </Button>
          {(pesquisas ?? []).map((p) => (
            <LinhaPesquisa
              key={p.id}
              id={p.id}
              titulo={p.titulo ?? "Pesquisa"}
              ativa={p.id === conversaId}
              onAbrir={() => setConversaId(p.id)}
              onRenomear={(titulo) => renomearMut.mutate({ conversaId: p.id, titulo })}
              onExcluir={() => excluirMut.mutate({ conversaId: p.id })}
              excluindo={excluirMut.isPending}
            />
          ))}
        </aside>

        <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
          <div className="min-h-[320px] space-y-3.5 overflow-y-auto px-4 py-3.5">
            {isLoading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : mensagens.length === 0 ? (
              <div className="py-6 text-center">
                <Search className="mx-auto h-5 w-5 text-muted-foreground" />
                {acervo && acervo.total === 0 ? (
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
                return (
                  <Resposta
                    key={m.id}
                    r={m.resposta as PesquisaGravada}
                    acervo={acervo}
                    aoEscolherTipo={(nome) =>
                      setPergunta(`${nome} no ${tribunalTopo ?? ""}: como costuma terminar?`.trim())
                    }
                  />
                );
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
            <SeletorModo modo={modo} onModo={setModo} />
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
                placeholder={
                  modo === "estrategia"
                    ? "Ex.: vale a pena pegar uma busca e apreensão no TJCE?"
                    : "Ex.: como o TJCE decide revisão de contrato bancário?"
                }
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

        <PainelContexto acervo={acervo} ultima={ultimaResposta} />
      </div>
    </div>
  );
}
