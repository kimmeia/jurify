/**
 * JurisIA (beta) — uma conversa só.
 *
 * Havia três abas — Pesquisar, Estratégia, Redigir peça — e o advogado tinha
 * que saber qual delas responderia ANTES de perguntar. Escolher errado não
 * dava resposta pior: dava recusa. Agora quem escolhe é o servidor, e ele
 * consulta tudo que couber para a pergunta: acervo público, autos do cliente,
 * documentos anexados, base de fontes da casa.
 *
 * A hierarquia visual continua invertida em relação a um chat comum, e é de
 * propósito: o NÚMERO do acervo é contado em SQL sobre o recorte inteiro e
 * aparece em painel próprio; o texto da IA é leitura de uma amostra e é
 * proibido de reescrever o número. O único número do acervo na tela é o do
 * banco.
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Ancora } from "@/components/AncoraFonte";
import { ComAncoras, LegendaAncoras } from "@/components/juridico/AncorasResposta";
import { ConfigurarAgente } from "@/components/juridico/ConfigurarAgente";
import { SeletorCaso, type CasoEscolhido } from "@/components/juridico/SeletorCaso";
import { base64ToBlob, baixarBlob } from "@/pages/financeiro/helpers";
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
  ChevronDown,
  Clock,
  Database,
  Download,
  FileText,
  Gavel,
  Layers,
  Library,
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
  Plus,
  Scale,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { ehConversaUna, type ConversaUnaGravada, type ProvaGravada } from "@shared/jurisia-una";
import type { ComposicaoAcervo } from "@shared/jurisia-acervo";
import type { Comparacao } from "@shared/jurisia-estrategia";
import type { ComposicaoNatureza } from "@shared/jurisia-grau";
import {
  rotuloCurtoResultado,
  rotuloResultado,
  type EstatisticaRecorte,
  type EstatisticaRecursal,
  type FonteRecorte,
  type PesquisaGravada,
} from "@shared/jurisia-recorte";
import { rotuloRecurso } from "@shared/datajud-recurso";
import { frasearTendencia, type Tendencia } from "@shared/jurisia-tendencia";
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
          <div className="bg-info" style={{ width: fatia(n.jurisprudencia) }} />
        )}
        {n.estatistica > 0 && (
          <div className="bg-muted-foreground/50" style={{ width: fatia(n.estatistica) }} />
        )}
        {n.indefinido > 0 && (
          <div className="bg-muted-foreground/30" style={{ width: fatia(n.indefinido) }} />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
        {n.jurisprudencia > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-info" />
            <strong className="tabular-nums text-foreground">
              {n.jurisprudencia.toLocaleString("pt-BR")}
            </strong>{" "}
            acórdão — jurisprudência
          </span>
        )}
        {n.estatistica > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
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
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning-bg px-2.5 py-1.5 text-[11px] text-warning-fg">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          {aviso}
        </p>
      )}
    </div>
  );
}

/**
 * O segundo eixo: como o RECURSO terminou.
 *
 * Uma matiz só, ao contrário das barras de mérito. Não é economia: as cinco
 * cores de lá são slots validados para daltonismo em pares adjacentes, e o
 * eixo recursal tem seis saídas — inventar a sexta invalidaria a checagem.
 * Como as linhas são separadas e rotuladas, quem carrega a identidade é o
 * rótulo, e a cor única ainda marca à primeira vista que este painel fala
 * outra língua.
 */
function BarrasRecurso({ r }: { r: EstatisticaRecursal }) {
  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-1.5">
        <Gavel className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          Como o recurso terminou
        </p>
      </div>
      <div className="mt-2 space-y-1.5">
        {r.fatias.map((f) => (
          <div
            key={f.resultado}
            className="grid grid-cols-[128px_1fr_auto] items-center gap-2"
            title={`${rotuloRecurso(f.resultado)}: ${f.quantidade} de ${r.comResultado} recursos julgados`}
          >
            <span
              className={`truncate text-[11px] ${f.quantidade === 0 ? "text-muted-foreground/60" : "text-foreground/80"}`}
            >
              {rotuloRecurso(f.resultado)}
            </span>
            <div
              className="h-2 w-full overflow-hidden rounded-[2px]"
              style={{ background: "var(--viz-trilho)" }}
            >
              {f.quantidade > 0 && (
                <div
                  className="h-full rounded-r-[4px]"
                  style={{ background: "var(--viz-2)", width: `${f.percentual}%`, minWidth: "3px" }}
                />
              )}
            </div>
            <span
              className={`flex text-[11px] tabular-nums ${f.quantidade === 0 ? "text-muted-foreground/60" : "text-foreground/80"}`}
            >
              <span className="w-9 text-right font-bold">{f.percentual}%</span>
              <span className="w-12 text-right text-muted-foreground">({f.quantidade})</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Percentuais sobre os {r.comResultado.toLocaleString("pt-BR")} recursos já julgados.
        “Provido” é o recurso acolhido — não é o mesmo que o pedido ser procedente.
      </p>
    </div>
  );
}

/**
 * O que o recorte decide HOJE.
 *
 * A estatística de cima soma o acervo inteiro, e num tribunal isso mistura o
 * que ele fazia há dez anos com o que faz agora. Quando o entendimento vira, a
 * média histórica aponta para o lado que perdeu — por isso a janela recente
 * ganha destaque próprio, e a virada ganha cor.
 */
function PainelTendencia({ t }: { t: Tendencia }) {
  const frase = frasearTendencia(t);
  if (!frase || !t.dominanteRecente) return null;

  const destaque = t.virou
    ? "border-warning/30 bg-warning-bg dark:bg-warning/30"
    : "border-transparent bg-muted/40";

  return (
    <div className={`mt-3 rounded-lg border px-2.5 py-2 ${destaque}`}>
      <div className="flex items-center gap-1.5">
        {t.virou ? (
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning-fg" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          Entendimento dos últimos {t.meses} meses
        </p>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[14px] font-extrabold">{t.dominanteRecente.rotulo}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {t.dominanteRecente.percentual}% de {t.recentes.toLocaleString("pt-BR")} decididos na
          janela
        </span>
        {t.massivo && (
          <span className="rounded bg-info-bg px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-info-fg dark:text-info">
            massivo
          </span>
        )}
      </div>

      <p className="mt-1 text-[11.5px] leading-relaxed text-foreground/85">{frase}</p>

      {t.dominanteAnterior && t.deltaPp !== null && (
        <p className="mt-1 text-[10.5px] text-muted-foreground">
          Antes da janela: <strong>{t.dominanteAnterior.rotulo}</strong> dominava (
          {t.anteriores.toLocaleString("pt-BR")} decididos) · “{t.dominanteRecente.rotulo}”{" "}
          {t.deltaPp >= 0 ? "ganhou" : "perdeu"} {Math.abs(t.deltaPp)} pontos.
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
  tendencia,
}: {
  e: EstatisticaRecorte;
  perfil: PerfilRecorte | null;
  filtro: string;
  natureza?: ComposicaoNatureza;
  avisoNatureza?: string | null;
  tendencia?: Tendencia | null;
}) {
  const recursal = e.recursal;
  const decididos = e.decididos ?? e.comResultado;
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
        <Tile n={decididos} rotulo="já decididos" />
        <Tile n={e.emAndamento} rotulo="em andamento" />
      </div>

      {natureza && <PainelNatureza n={natureza} aviso={avisoNatureza ?? null} />}

      {e.comResultado > 0 && (
        <>
          <Barras e={e} />
          <p className="mt-2 text-[10px] text-muted-foreground">
            Percentuais sobre os processos já decididos. Contagem do banco, não da IA.
          </p>
          <Transito e={e} />
        </>
      )}

      {recursal && recursal.comResultado > 0 && <BarrasRecurso r={recursal} />}

      {decididos === 0 && (
        // "Nenhum chegou ao fim" só é verdade quando HÁ processos. Com o
        // recorte vazio a frase mentia, e ainda aparecia junto do bloco "sem
        // base no acervo" — duas mensagens contando histórias diferentes sobre
        // o mesmo zero.
        <p className="mt-2.5 text-[11.5px] text-muted-foreground">
          Nenhum destes {e.total.toLocaleString("pt-BR")} processos chegou ao fim ainda — não há
          desfecho a distribuir.
        </p>
      )}

      {tendencia && <PainelTendencia t={tendencia} />}

      {decididos > 0 && e.amostraPequena && (recursal?.amostraPequena ?? true) && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning-bg px-2.5 py-1.5 text-[11px] text-warning-fg">
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
 * O que a IA consultou neste turno.
 *
 * Um chip por fonte que ela conseguiu abrir, com a contagem. Serve pra separar
 * "não encontrei nos documentos" de "não li documento nenhum" — duas frases
 * parecidas cuja diferença decide se o advogado reenvía o arquivo ou muda a
 * pergunta. Fonte que não entrou não vira chip vazio: some.
 */
function ChipsConsulta({ c }: { c: ConversaUnaGravada["consulta"] }) {
  const chips: Array<{ chave: string; icone: typeof FileText; texto: string; realce?: boolean }> = [];
  if (c.documentosLidos > 0) {
    chips.push({
      chave: "docs",
      icone: FileText,
      texto:
        c.documentosTotal > c.documentosLidos
          ? `leu ${c.documentosLidos} de ${c.documentosTotal} documentos`
          : `leu ${c.documentosLidos} documento${c.documentosLidos > 1 ? "s" : ""}`,
    });
  }
  if (c.movimentacoes > 0) {
    chips.push({ chave: "mov", icone: Layers, texto: `${c.movimentacoes} movimentações dos autos` });
  }
  if (c.acervo > 0) {
    chips.push({
      chave: "acervo",
      icone: Database,
      texto: `mediu ${c.acervo.toLocaleString("pt-BR")} casos no acervo`,
      realce: true,
    });
  }
  if (c.fontesEscritorio > 0) {
    chips.push({
      chave: "fontes",
      icone: ShieldCheck,
      texto: `${c.fontesEscritorio} fontes do escritório`,
    });
  }
  if (chips.length === 0) return null;

  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {chips.map((ch) => {
        const Icone = ch.icone;
        return (
          <span
            key={ch.chave}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] ${
              ch.realce
                ? "border-info/30 bg-info-bg text-info-fg"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Icone className="h-3 w-3 shrink-0" />
            {ch.texto}
          </span>
        );
      })}
    </div>
  );
}

/**
 * A prova do acervo, abaixo da resposta.
 *
 * O número vive AQUI e não no texto: veio de contagem em SQL sobre o recorte
 * inteiro, e o modelo tem ordem de não reescrevê-lo. Mesma hierarquia da
 * pesquisa antiga — estatística primeiro, leitura depois.
 */
function PainelProva({ p }: { p: ProvaGravada }) {
  return (
    <div className="mt-2 rounded-xl border border-info/30 bg-info-bg/60 p-3 dark:border-info/30">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-info-fg">
          Como este tribunal vem decidindo
        </p>
        <p className="text-[10.5px] text-info-fg/80">
          {p.descricaoFiltro || p.rotulo}
        </p>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {p.comResultado.toLocaleString("pt-BR")} processos decididos ·{" "}
        {p.jurisprudencia.toLocaleString("pt-BR")} em segunda instância
      </p>
      <div className="mt-2 space-y-1">
        {p.fatias
          .filter((f) => f.quantidade > 0)
          .map((f) => (
            <div key={f.resultado} className="grid grid-cols-[118px_1fr_auto] items-center gap-2">
              <span className="truncate text-[11px] text-foreground/80">{f.rotulo}</span>
              <span
                className="h-2 overflow-hidden rounded-[2px]"
                style={{ background: "var(--viz-trilho)" }}
              >
                <span
                  className="block h-full rounded-r-[4px]"
                  style={{
                    background: COR[f.resultado as ResultadoProcesso] ?? "var(--viz-1)",
                    width: `${f.percentual}%`,
                    minWidth: "3px",
                  }}
                />
              </span>
              <span className="flex text-[11px] tabular-nums">
                <span className="w-9 text-right font-bold">{f.percentual}%</span>
                <span className="w-12 text-right text-muted-foreground">({f.quantidade})</span>
              </span>
            </div>
          ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        {p.amostraPequena
          ? "Amostra pequena — com esse número de casos decididos isto é indício, não tese firmada."
          : "Contado no banco sobre o recorte inteiro. É estatística do tribunal, não precedente citável."}
      </p>
    </div>
  );
}

/**
 * Uma resposta da conversa única.
 *
 * Texto livre, porque a mesma pergunta pode pedir análise, prazo ou minuta de
 * dez páginas — e forçar tudo em JSON com afirmação e fonte foi o que fazia o
 * redator viver noutra tela. O lastro não sumiu, mudou de lugar: as âncoras
 * marcam a origem frase a frase, os chips dizem o que foi lido, e o número do
 * acervo continua vindo do banco, em painel próprio.
 */
function RespostaUna({
  r,
  aoExportar,
  exportando,
}: {
  r: ConversaUnaGravada;
  aoExportar: (texto: string) => void;
  exportando: boolean;
}) {
  return (
    <div className="flex max-w-3xl gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-info text-info-on">
        <Scale className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <ChipsConsulta c={r.consulta} />

        {/* Checagem que falhou vira aviso visível, não descarte silencioso: a
            resposta traz análise e minuta juntas, e jogar tudo fora por uma
            frase perderia o trabalho inteiro sem dizer o porquê. */}
        {r.avisos.map((a) => (
          <p
            key={a}
            className="mb-1.5 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning-bg px-2.5 py-1.5 text-[11px] text-warning-fg"
          >
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            {a}
          </p>
        ))}

        <div className="whitespace-pre-wrap rounded-2xl bg-muted px-3.5 py-2.5 text-[12.5px] leading-relaxed">
          <ComAncoras texto={r.texto} />
        </div>
        <LegendaAncoras texto={r.texto} />

        {r.naoLidos.length > 0 && (
          <div className="mt-1.5 rounded-lg border border-dashed px-2.5 py-1.5">
            <p className="text-[10.5px] font-bold text-muted-foreground">
              Documentos que ela não conseguiu ler
            </p>
            {r.naoLidos.map((n) => (
              <p key={n} className="text-[10.5px] leading-snug text-muted-foreground">
                · {n}
              </p>
            ))}
          </div>
        )}

        {r.prova && <PainelProva p={r.prova} />}
        {r.prova?.comparacao && <div className="mt-2"><PainelComparacao c={r.prova.comparacao} /></div>}

        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-info-fg"
          onClick={() => aoExportar(r.texto)}
          disabled={exportando}
        >
          <Download className="h-3 w-3" /> Exportar como DOCX
        </button>
      </div>
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
                    você <b className="text-info-fg">{l.escritorioPct}%</b>
                  </span>
                </div>
              </div>
            </div>
          ))}
      </div>

      {c.amostraPequena ? (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning-bg px-2.5 py-1.5 text-[11px] text-warning-fg">
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

      <div className="rounded-lg border border-info/30 bg-info-bg/40 px-3 py-2.5 dark:border-info/30">
        <div className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 shrink-0 text-info-fg" />
          <p className="flex-1 text-[11.5px] font-bold">Acervo público</p>
          <span className="rounded-full border border-success/30 bg-success-bg px-1.5 py-px text-[9px] font-extrabold text-success-fg">
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
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success-fg" />
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
            O que cada resposta consultou aparece nos selos acima dela, e o recorte medido no painel
            logo abaixo do texto.
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
        ativa ? "border-info/30 bg-info-bg" : "bg-card hover:bg-muted/50"
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
    <div className="rounded-xl rounded-bl-sm border border-warning/30 bg-warning-bg px-4 py-3.5 dark:border-warning/30">
      <p className="flex items-center gap-2 text-[13.5px] font-bold text-warning-fg">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        {r.descricaoFiltro
          ? `Nada no acervo para ${r.descricaoFiltro}`
          : "Não consegui montar um recorte com essa pergunta"}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-warning-fg/90">
        {r.conclusao ?? "O acervo não tem processos que respondam isso."}
      </p>

      {topo.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-white/70 px-3 py-2.5 dark:border-warning/30 dark:bg-black/20">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-warning-fg">
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

      <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-success-fg">
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
        tendencia={r.tendencia ?? null}
      />
      {r.comparacao && <PainelComparacao c={r.comparacao} />}

      {!r.achou ? (
        <div className="rounded-xl rounded-bl-sm border border-warning/30 bg-warning-bg px-3.5 py-3 dark:border-warning/30">
          <p className="mb-1 flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-warning-fg">
            <TriangleAlert className="h-3.5 w-3.5" />
            Não respondi com o que há aqui
          </p>
          <p className="text-[12.5px] leading-relaxed text-warning-fg">
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
            <p className="mt-2.5 border-l-2 border-info/30 pl-2.5 text-[12.5px] leading-relaxed text-foreground/90">
              {r.conclusao}
            </p>
          )}

          {r.fontesDetalhe.length > 0 && (
            <details className="group mt-3 rounded-lg border border-success/30 bg-success-bg px-3 py-2 dark:border-success/30">
              {/* Fechada por padrão: quarenta linhas de CNJ abertas empurram a
                  resposta pra fora da tela, e quem quer conferir a fonte clica
                  na âncora do parágrafo. O selo continua visível — é ele que
                  diz que a resposta tem lastro. */}
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-bold text-success-fg">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                {r.fontesDetalhe.length === 1
                  ? "1 processo sustenta esta resposta"
                  : `${r.fontesDetalhe.length} processos sustentam esta resposta`}
                <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
                <span className="font-medium opacity-70 group-open:hidden">ver</span>
              </summary>
              <ul className="mt-1.5 space-y-1">
                {r.fontesDetalhe.map((f: FonteRecorte) => (
                  <li
                    key={f.id}
                    className="flex gap-2 text-[11px] text-success-fg/90"
                  >
                    <span className="shrink-0 font-extrabold">{ordem.get(f.id)}</span>
                    <span className="shrink-0 tabular-nums opacity-70">{f.data}</span>
                    {f.natureza && (
                      <span
                        className={`shrink-0 rounded px-1 text-[9.5px] font-bold uppercase tracking-wide ${
                          f.natureza === "jurisprudencia"
                            ? "bg-info-bg text-info-fg dark:text-info"
                            : "bg-muted text-muted-foreground dark:text-muted-foreground/70"
                        }`}
                      >
                        {f.natureza === "jurisprudencia" ? "acórdão" : "1º grau"}
                      </span>
                    )}
                    <span className="min-w-0 truncate">{f.rotulo}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default function JurisIa() {
  const [conversaId, setConversaId] = useState<number | null>(null);
  const [pergunta, setPergunta] = useState("");
  const [caso, setCaso] = useState<CasoEscolhido | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
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
      toast.success("Conversa excluída");
    },
    onError: (e) => toast.error("Não deu pra excluir", { description: e.message }),
  });

  const conversarMut = trpc.jurisia.conversar.useMutation({
    onSuccess: (r) => {
      setConversaId(r.conversaId);
      utils.jurisia.pesquisa.invalidate();
      utils.jurisia.pesquisas.invalidate();
      utils.jurisia.estado.invalidate();
      if (r.erro) toast.error("A IA não respondeu", { description: r.erro });
    },
    onError: (e) => toast.error("JurisIA indisponível", { description: e.message }),
  });

  const exportarMut = (trpc as any).juridico.exportarPecaDocx.useMutation({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => {
      baixarBlob(base64ToBlob(r.base64, r.mimeType), r.filename, r.mimeType);
      toast.success("DOCX exportado");
    },
    onError: (e: { message: string }) => toast.error("Não deu pra exportar", { description: e.message }),
  });

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data?.mensagens.length, conversarMut.isPending]);

  // O caso vem gravado na conversa: reabrir "Francisco Arnoldo — usucapião" e
  // continuar perguntando sem os autos que ela usava responderia outra coisa
  // com a mesma cara. Só sincroniza quando o id muda de fato — senão apagaria a
  // escolha que o advogado acabou de fazer no meio da conversa.
  const contatoGravado = data?.contatoId ?? null;
  const processoGravado = data?.processoId ?? null;
  useEffect(() => {
    if (conversaId == null) return;
    if (contatoGravado == null) return;
    setCaso((atual) =>
      atual?.contatoId === contatoGravado
        ? atual
        : { contatoId: contatoGravado, nome: "Carregando…", processoId: processoGravado },
    );
  }, [conversaId, contatoGravado, processoGravado]);

  const cota = estado?.cota;
  const mensagens = data?.mensagens ?? [];

  // A última resposta ESTRUTURADA — é dela que o painel lateral antigo fala.
  // As conversas novas contam a própria história nos chips de cada turno.
  const ultimaResposta = (() => {
    for (let i = mensagens.length - 1; i >= 0; i--) {
      const m = mensagens[i];
      if (m.papel === "assistente" && m.resposta && !ehConversaUna(m.resposta)) {
        return m.resposta as PesquisaGravada;
      }
    }
    return null;
  })();

  const enviar = (texto?: string) => {
    const q = (texto ?? pergunta).trim();
    if (q.length < 3 || conversarMut.isPending) return;
    setPergunta("");
    conversarMut.mutate({
      conversaId,
      pergunta: q,
      contatoId: caso?.contatoId ?? null,
      processoId: caso?.processoId ?? null,
    });
  };

  const novaConversa = () => {
    setConversaId(null);
    setPergunta("");
    setCaso(null);
  };

  // Três bloqueios que parecem um só e não são. "Renove" pra quem nunca
  // comprou soa como cobrança de dívida inexistente; "contrate" pra quem
  // deixou vencer apaga o histórico do cliente.
  const acesso = estado?.acesso;
  if (acesso && !acesso.liberado) {
    const texto = acesso.motivo === "expirado"
      ? {
        titulo: "O contrato do JurisIA venceu",
        corpo: "Suas conversas continuam salvas. Renovando, você volta de onde parou.",
      }
      : acesso.motivo === "suspenso"
        ? {
          titulo: "JurisIA suspenso",
          corpo: "O módulo está suspenso para o seu escritório. Fale com o suporte para reativar.",
        }
        : {
          titulo: "JurisIA é contratado à parte",
          corpo:
            "Um assistente só: ele lê o processo e os documentos do cliente, mede como o tribunal decide casos como aquele no acervo público, e redige a peça no timbre do escritório.",
        };
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-card px-4 py-10 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-info" />
        <p className="mt-2 text-sm font-bold">{texto.titulo}</p>
        <p className="mt-1 text-xs text-muted-foreground">{texto.corpo}</p>
      </div>
    );
  }

  // Sugestão feita a partir do que foi COLETADO, não de palpite. Oferecer
  // "revisão de contrato bancário" num acervo só de execução fiscal é ensinar
  // o advogado a fazer exatamente a pergunta que falha.
  const tribunalTopo = acervo?.tribunais[0]?.tribunal;
  const sugestoes = caso
    ? ["Analise a estratégia deste caso.", "Qual recurso é cabível agora?", "Redija a peça cabível."]
    : (acervo?.classes ?? [])
      .slice(0, 3)
      .map((c) => `${c.nome}${tribunalTopo ? ` no ${tribunalTopo}` : ""}: como costuma terminar?`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Gavel className="h-5 w-5 text-info-fg" />
        <h1 className="text-lg font-extrabold">
          JurisIA <span className="font-medium text-muted-foreground">· assistente jurídico</span>
        </h1>
        <span className="rounded-full border border-warning/30 bg-warning-bg px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-warning-fg">
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
        <div className="ml-auto flex items-center gap-2">
          {cota && (
            <span className="text-[10.5px] tabular-nums text-muted-foreground">
              {cota.usadas} de {cota.limite} mensagens do mês
            </span>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setConfigOpen(true)}>
            <Library className="h-3.5 w-3.5" />
            Configurar
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[210px_1fr] xl:grid-cols-[210px_1fr_300px]">
        <aside className="space-y-1.5">
          <Button size="sm" variant="outline" className="w-full justify-start gap-1.5" onClick={novaConversa}>
            <Plus className="h-3.5 w-3.5" />
            Novo trabalho
          </Button>
          {(pesquisas ?? []).map((p) => (
            <LinhaPesquisa
              key={p.id}
              id={p.id}
              titulo={p.titulo ?? "Conversa"}
              ativa={p.id === conversaId}
              onAbrir={() => setConversaId(p.id)}
              onRenomear={(titulo) => renomearMut.mutate({ conversaId: p.id, titulo })}
              onExcluir={() => excluirMut.mutate({ conversaId: p.id })}
              excluindo={excluirMut.isPending}
            />
          ))}
        </aside>

        <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
          <div className="min-h-[420px] space-y-3.5 overflow-y-auto px-4 py-3.5">
            {isLoading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : mensagens.length === 0 ? (
              <div className="mx-auto mt-8 max-w-xl text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-info text-info-on">
                  <Scale className="h-6 w-6" />
                </div>
                <p className="text-[13.5px] font-semibold">Como posso ajudar?</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  Uma conversa só. Ela lê o processo e os documentos do cliente, mede como o tribunal
                  decide casos como esse e redige a peça — você não escolhe o modo, só pergunta.
                </p>
                {acervo && acervo.total === 0 && (
                  <p className="mx-auto mt-2 max-w-md text-[11.5px] text-muted-foreground">
                    O acervo público ainda está vazio: rode uma varredura em Admin → JurisIA pra ela
                    também medir como o tribunal decide.
                  </p>
                )}
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {sugestoes.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => enviar(s)}
                      className="rounded-full bg-muted px-3 py-1.5 text-[11.5px] text-muted-foreground hover:bg-muted/70"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              mensagens.map((m) => {
                if (m.papel === "usuario") {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <p className="max-w-[80%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-info px-3.5 py-2.5 text-[12.5px] leading-snug text-info-on">
                        {m.conteudo}
                      </p>
                    </div>
                  );
                }
                if (ehConversaUna(m.resposta)) {
                  return (
                    <RespostaUna
                      key={m.id}
                      r={m.resposta}
                      aoExportar={(texto) => exportarMut.mutate({ texto, nomeArquivo: "peca" })}
                      exportando={exportarMut.isPending}
                    />
                  );
                }
                if (m.recusa || !m.resposta) {
                  return (
                    <div key={m.id} className="rounded-xl rounded-bl-sm border border-dashed px-3.5 py-3">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {m.recusa ? "Este turno não produziu resposta" : "Resposta descartada pela checagem"}
                      </p>
                      <p className="mt-1 text-[11.5px] text-muted-foreground">
                        {m.recusa || "Nada foi afirmado sem fonte que sustentasse. Pergunte de outro jeito."}
                      </p>
                    </div>
                  );
                }
                // Pesquisas estruturadas gravadas antes da fusão: continuam
                // sendo mostradas como foram respondidas. Histórico do cliente
                // não muda de forma porque o produto mudou.
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

            {conversarMut.isPending && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Lendo o caso e medindo o acervo…
              </div>
            )}
            <div ref={fimRef} />
          </div>

          <div className="border-t px-4 py-3">
            <div className="flex items-end gap-2 rounded-2xl border px-3 py-2">
              <Textarea
                rows={1}
                value={pergunta}
                onChange={(ev) => setPergunta(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" && !ev.shiftKey) {
                    ev.preventDefault();
                    enviar();
                  }
                }}
                placeholder="Pergunte, peça a peça, ou refine (ex.: “deixa mais enxuto”)…"
                className="max-h-32 min-h-[24px] flex-1 resize-none border-0 p-0 text-[12.5px] shadow-none focus-visible:ring-0"
                disabled={!cota?.pode || conversarMut.isPending}
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl bg-info"
                disabled={!cota?.pode || pergunta.trim().length < 3 || conversarMut.isPending}
                onClick={() => enviar()}
              >
                {conversarMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              {cota && !cota.pode
                ? `Você usou as ${cota.limite} mensagens deste mês.`
                : "Minuta gerada por IA — revisão e assinatura do advogado obrigatórias antes de protocolar."}
            </p>
          </div>
        </div>

        <aside className="hidden flex-col gap-2.5 xl:flex">
          <SeletorCaso caso={caso} onCaso={setCaso} />
          <PainelContexto acervo={acervo} ultima={ultimaResposta} />
        </aside>
      </div>

      <ConfigurarAgente open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
