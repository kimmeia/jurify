/**
 * De onde vêm os leads.
 *
 * Duas decisões de desenho que não são estéticas.
 *
 * A coluna da direita conta QUANTOS FECHARAM, não uma taxa. Ela já mostrou
 * "40%" ao lado de um KPI "Taxa de conversão: 4%" na mesma tela, com um
 * rodapé explicando que os dois não batem — e rodapé não conserta
 * contradição, só documenta. Os dois números respondem perguntas diferentes:
 * aqui é uma COORTE (dos leads que entraram no período, quantos já fecharam),
 * lá é FLUXO (quantos contratos fecharam no período, tenham entrado quando
 * tiverem). Como jamais vão convergir, a saída é a coluna não se chamar
 * conversão nem exibir percentual: "19 de 48" o leitor confere somando, e a
 * eficiência relativa ele compara sozinho.
 *
 * E a faixa de procedência embaixo não é rodapé: o estado vem do DDD do
 * telefone, não do cadastro. Um painel inteiro construído sobre dedução não
 * pode ser lido como fato — a faixa mostra quanto do total tem DDD
 * reconhecível, e a ressalva ao lado diz o que o DDD realmente significa.
 */

import { Database, Info, TriangleAlert } from "lucide-react";
import type { LeadsPorEstado } from "@shared/leads-uf";
import { CENTROS_UF, PATHS_UF, VIEWBOX_BRASIL } from "./mapa-brasil";

/**
 * Rampa sequencial por volume. Faixa FIXA, não relativa ao maior do período:
 * senão o mesmo número de leads muda de cor quando o mês muda, e comparar
 * dois meses passa a depender do mês.
 *
 * Em hex, e não em classe do Tailwind, porque quem pinta é atributo de SVG.
 */
const FAIXAS: Array<{ ate: number; preenche: string; texto: string }> = [
  { ate: 0, preenche: "var(--muted)", texto: "var(--muted-foreground)" },
  { ate: 4, preenche: "#ede9fe", texto: "#6d28d9" },
  { ate: 9, preenche: "#ddd6fe", texto: "#5b21b6" },
  { ate: 19, preenche: "#c4b5fd", texto: "#4c1d95" },
  { ate: 49, preenche: "#a78bfa", texto: "#2e1065" },
  { ate: Infinity, preenche: "#7c3aed", texto: "#ffffff" },
];

function faixaDe(n: number) {
  return FAIXAS.find((f) => n <= f.ate) ?? FAIXAS[FAIXAS.length - 1]!;
}

const CORES_BARRA = [
  "bg-violet-200 dark:bg-violet-900",
  "bg-violet-300 dark:bg-violet-800",
  "bg-violet-400 dark:bg-violet-700",
  "bg-violet-600",
];

function corBarra(n: number): string {
  if (n > 49) return CORES_BARRA[3]!;
  if (n > 19) return CORES_BARRA[2]!;
  if (n > 9) return CORES_BARRA[1]!;
  return CORES_BARRA[0]!;
}

export function BlocoLeadsPorEstado({
  dados,
  selecionada,
  onSelecionar,
}: {
  dados: LeadsPorEstado;
  /** UF que está filtrando o resto do relatório. */
  selecionada?: string | null;
  onSelecionar?: (uf: string) => void;
}) {
  const total = dados.comEstado + dados.semEstado;
  if (total === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-6 text-center">
        <p className="text-xs text-muted-foreground">
          Nenhum lead criado no período — sem lead não há de onde ele veio.
        </p>
      </div>
    );
  }

  const porUf = new Map(dados.estados.map((e) => [e.uf, e]));
  const maior = dados.estados[0]?.leads ?? 0;
  const lider = dados.estados[0];
  const fatiaLider = lider && dados.comEstado > 0
    ? Math.round((lider.leads / dados.comEstado) * 100)
    : 0;
  const pct = (n: number) => (total > 0 ? (n * 100) / total : 0);

  return (
    <div className="rounded-xl border border-violet-200 bg-card dark:border-violet-900">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-violet-600" />
            <h3 className="text-sm font-semibold">De onde vêm os leads</h3>
          </div>
          <p className="mt-1 text-[13px] font-bold">
            {dados.comEstado.toLocaleString("pt-BR")}{" "}
            {dados.comEstado === 1 ? "lead" : "leads"} em {dados.estados.length}{" "}
            {dados.estados.length === 1 ? "estado" : "estados"}
            {dados.semEstado > 0 && (
              <span className="ml-1.5 text-[11.5px] font-medium text-muted-foreground">
                {dados.semEstado} sem estado identificável
              </span>
            )}
          </p>
          {lider && fatiaLider > 0 && (
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {lider.uf} concentra <b className="text-foreground">{fatiaLider}%</b> dos leads com
              estado identificado.
            </p>
          )}
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            <b className="text-foreground">{dados.ganhos.toLocaleString("pt-BR")}</b>{" "}
            {dados.ganhos === 1 ? "já fechou contrato" : "já fecharam contrato"} — é a soma da
            coluna ao lado mais os que não têm estado identificado.
          </p>
        </div>
        <span className="rounded-full border bg-muted/40 px-2.5 py-1 text-[10.5px] text-muted-foreground">
          {selecionada
            ? `Este bloco continua mostrando o período inteiro — é ele que aplica o filtro`
            : "Leads criados no período"}
        </span>
      </div>

      <div className="mt-3 grid gap-5 px-4 lg:grid-cols-[minmax(0,400px)_1fr]">
        <div>
          {/* Mapa geográfico de verdade. A ressalva honesta é que a ÁREA do
              estado não tem relação com o volume — o Amazonas ocupa um quinto
              do desenho com zero lead e o Distrito Federal quase some mesmo
              quando rende. Quem responde "quanto" é a lista ao lado; o mapa
              responde "onde no país", que é o que o contorno tem de útil. */}
          <svg
            viewBox={VIEWBOX_BRASIL}
            className="block h-auto w-full max-h-[360px]"
            role="img"
            aria-label="Leads por estado"
          >
            {Object.entries(PATHS_UF).map(([uf, d]) => {
              const n = porUf.get(uf)?.leads ?? 0;
              const ativa = selecionada === uf;
              const clicavel = n > 0 && !!onSelecionar;
              return (
                <path
                  key={uf}
                  d={d}
                  fill={faixaDe(n).preenche}
                  stroke={ativa ? "#5b21b6" : "var(--background)"}
                  strokeWidth={ativa ? 2.6 : 1.3}
                  className={clicavel ? "cursor-pointer" : ""}
                  onClick={clicavel ? () => onSelecionar!(uf) : undefined}
                >
                  <title>
                    {n > 0
                      ? `${uf}: ${n} ${n === 1 ? "lead" : "leads"}${onSelecionar ? " — clique pra filtrar" : ""}`
                      : `${uf}: nenhum lead no período`}
                  </title>
                </path>
              );
            })}
            {/* Só estado COM lead ganha rótulo: 27 siglas num mapa deste
                tamanho vira mancha de texto sobre o desenho. */}
            {dados.estados.map((e) => {
              const c = CENTROS_UF[e.uf];
              if (!c) return null;
              const cor = faixaDe(e.leads).texto;
              return (
                <g key={e.uf} className="pointer-events-none">
                  <text x={c[0]} y={c[1] - 2} fontSize={19} fontWeight={800} fill={cor} textAnchor="middle">
                    {e.uf}
                  </text>
                  <text x={c[0]} y={c[1] + 16} fontSize={17.5} fontWeight={700} fill={cor} textAnchor="middle">
                    {e.leads}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Leads
            </span>
            <div className="flex items-center gap-0.5">
              {FAIXAS.map((f) => (
                <span
                  key={f.ate}
                  className="h-2 w-5 rounded-[2px] border border-border"
                  style={{ background: f.preenche }}
                />
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">0 · 1–4 · 5–9 · 10–19 · 20–49 · 50+</span>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            A área do estado no mapa não tem relação com o volume — o Amazonas é enorme e pode
            estar zerado. Quem responde “quanto” é a lista ao lado.
          </p>
        </div>

        <div>
          <div className="grid grid-cols-[30px_1fr_44px_74px] items-center gap-2 border-b pb-1.5">
            {["UF", "Volume", "Leads", "Já fecharam"].map((h, i) => (
              <span
                key={h}
                className={`text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground ${
                  i >= 2 ? "text-right" : ""
                }`}
              >
                {h}
              </span>
            ))}
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {dados.estados.map((e) => (
              <button
                key={e.uf}
                type="button"
                disabled={!onSelecionar}
                onClick={onSelecionar ? () => onSelecionar(e.uf) : undefined}
                title={onSelecionar ? `Filtrar o relatório por ${e.uf}` : undefined}
                className={`grid w-full grid-cols-[30px_1fr_44px_74px] items-center gap-2 border-b border-border/40 py-[7px] text-left ${
                  onSelecionar ? "cursor-pointer hover:bg-muted/40" : ""
                } ${selecionada === e.uf ? "bg-violet-50 dark:bg-violet-950/40" : ""}`}
              >
                <span className="text-[11.5px] font-extrabold">{e.uf}</span>
                <span className="block h-2 overflow-hidden rounded-[2px] bg-muted">
                  <span
                    className={`block h-full rounded-r-[3px] ${corBarra(e.leads)}`}
                    style={{ width: `${maior > 0 ? Math.max((e.leads / maior) * 100, 2) : 0}%` }}
                  />
                </span>
                <span className="text-right text-[12px] font-bold tabular-nums">{e.leads}</span>
                <span
                  className="text-right text-[11px] tabular-nums text-muted-foreground"
                  title={
                    e.conversao !== null
                      ? `${e.ganhos} dos ${e.leads} leads de ${e.uf} já fecharam — ${e.conversao}%`
                      : `${e.ganhos} dos ${e.leads} leads de ${e.uf} já fecharam`
                  }
                >
                  <b className={e.ganhos > 0 ? "text-foreground" : ""}>{e.ganhos}</b> de {e.leads}
                </span>
              </button>
            ))}
          </div>

          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              “Já fecharam” conta, <b className="text-foreground">dos leads que entraram neste
              período</b>, quantos fecharam contrato até hoje — inclusive os que fecharam depois do
              fim do período. Por isso ele ainda pode subir: um lead de agosto que fechar em
              dezembro passa a contar em agosto. É pergunta diferente da do KPI “Taxa de conversão”
              lá em cima, que conta o que <b className="text-foreground">fechou dentro do
              período</b> — os dois nunca vão dar o mesmo número, e nenhum dos dois está errado.
            </span>
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-4 border-t px-4 py-3 lg:grid-cols-[1fr_minmax(0,420px)]">
        <div>
          <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
            Cobertura do dado
          </p>
          <div className="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded">
            {dados.comEstado > 0 && (
              <span className="bg-violet-500" style={{ width: `${pct(dados.comEstado)}%` }} />
            )}
            {dados.semEstado > 0 && (
              <span className="bg-muted" style={{ width: `${pct(dados.semEstado)}%` }} />
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Legenda cor="bg-violet-500" n={dados.comEstado} texto="com DDD reconhecido" />
            <Legenda cor="bg-muted border" n={dados.semEstado} texto="sem telefone ou DDD inválido" />
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-2 text-[10.5px] leading-relaxed dark:border-violet-900 dark:bg-violet-950/25">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
          <span>
            <b className="text-violet-700 dark:text-violet-300">
              O DDD diz onde a linha foi habilitada, não onde a pessoa mora hoje.
            </b>{" "}
            Quem mudou de estado e manteve o número aparece na origem antiga. O endereço do cadastro
            não entra nesta conta de propósito: só cliente qualificado tem endereço preenchido, e
            misturar os dois mediria clientes numa barra que diz leads.
          </span>
        </p>
      </div>
    </div>
  );
}

function Legenda({ cor, n, texto }: { cor: string; n: number; texto: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
      <span className={`h-2 w-2 shrink-0 rounded-[2px] ${cor}`} />
      <b className="tabular-nums text-foreground">{n.toLocaleString("pt-BR")}</b> {texto}
    </span>
  );
}
