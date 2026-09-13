/**
 * Estado por estado — e grau por grau — de uma credencial do PDPJ.
 *
 * O login é nacional, mas cada PJe é um portal diferente, e dentro de cada um
 * o 1º e o 2º grau também são portais separados: endereço diferente, sessão
 * diferente, às vezes cadastro diferente. Uma linha por combinação é o que
 * impede a tela de dizer "TJRJ validado" quando só o 1º grau foi conferido.
 *
 * Daí a grade existir em vez de um selo "funciona em 12 estados": "não
 * testado" é a informação principal, não um detalhe. Prometer os doze e
 * descobrir na hora do prazo qual não responde seria pior que não oferecer.
 *
 * DESENHO (13/09): a grade media 2.143px de altura porque cada estado era uma
 * caixa com DUAS caixas dentro (uma por grau), cada uma com rótulo, ponto,
 * texto e botão — 30 blocos empilhados num cartão de 335px de largura. Agora
 * cada estado é UMA linha: sigla à esquerda e dois selos de grau à direita, no
 * mesmo eixo. O que some é repetição de moldura, não informação: os dois graus,
 * os três estados possíveis, a contagem de processos, o botão de testar e o
 * texto cru do erro continuam todos aqui.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2, Play, RefreshCcw, Square } from "lucide-react";
import { resumirErroCofre } from "@shared/cofre-erros";

export interface TribunalDaCredencial {
  tribunal: string;
  grau: 1 | 2;
  /** 2º grau sem endereço mapeado: lacuna de cobertura, não falha de login. */
  semCobertura: boolean;
  status: "nao_testado" | "ativa" | "erro";
  ultimoErro: string | null;
  ultimoSucessoEm: string | null;
  processos: number;
}

interface Props {
  tribunais: TribunalDaCredencial[];
  /** Chave "tribunal:grau" em teste, ou null. */
  testando: string | null;
  onTestar: (tribunal: string, grau: 1 | 2) => void;
  /** Bateria: roda tudo em fila. Ausente = só teste avulso. */
  lote?: {
    rodando: boolean;
    feitos: number;
    total: number;
    atual: string | null;
    onIniciar: () => void;
    onParar: () => void;
  };
}

const ESTILO = {
  ativa: {
    selo: "border-success/40 bg-success-bg text-success-fg dark:bg-success/20",
    ponto: "bg-success",
    rotulo: "validado",
  },
  erro: {
    selo: "border-danger/40 bg-danger-bg text-danger-fg dark:bg-danger/20",
    ponto: "bg-danger",
    rotulo: "falhou",
  },
  nao_testado: {
    selo: "border-border bg-muted/40 text-muted-foreground",
    ponto: "bg-muted-foreground/50",
    rotulo: "não testado",
  },
} as const;

function chave(t: string, g: number) {
  return `${t}:${g}`;
}

/** Um grau: ponto + "1º" + estado, clicável pra testar de novo. */
function SeloGrau({
  g,
  testando,
  onTestar,
}: {
  g: TribunalDaCredencial;
  testando: string | null;
  onTestar: (tribunal: string, grau: 1 | 2) => void;
}) {
  const k = chave(g.tribunal, g.grau);
  const emTeste = testando === k;

  if (g.semCobertura) {
    return (
      /* "sem endereço" por extenso vazava 31px da coluna de 173px e invadia a
         vizinha. O texto inteiro fica no balão e na legenda do rodapé. */
      <span
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-micro italic text-muted-foreground"
        title={`${g.tribunal.toUpperCase()} ${g.grau}º grau: endereço não mapeado`}
      >
        {g.grau}º s/ portal
      </span>
    );
  }

  const e = ESTILO[g.status];
  const detalhe =
    g.status === "ativa" && g.processos > 0 ? ` · ${g.processos} processos` : "";

  return (
    <button
      type="button"
      onClick={() => onTestar(g.tribunal, g.grau)}
      disabled={testando != null}
      title={`${g.tribunal.toUpperCase()} ${g.grau}º grau: ${e.rotulo}${detalhe} — clique pra testar o login`}
      className={`group inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-micro font-semibold transition-opacity disabled:opacity-50 ${e.selo}`}
    >
      {emTeste ? (
        <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
      ) : (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.ponto}`} />
      )}
      {g.grau}º
      {g.status === "ativa" && g.processos > 0 && (
        <span className="font-normal tabular-nums opacity-80">{g.processos}</span>
      )}
      <RefreshCcw className="h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  );
}

export default function GradeTribunais({ tribunais, testando, onTestar, lote }: Props) {
  const conta = (s: TribunalDaCredencial["status"]) =>
    tribunais.filter((t) => !t.semCobertura && t.status === s).length;
  const semCobertura = tribunais.filter((t) => t.semCobertura).length;
  const [verErros, setVerErros] = useState(false);

  // Agrupa por estado preservando a ordem que o servidor mandou.
  const estados: string[] = [];
  for (const t of tribunais) if (!estados.includes(t.tribunal)) estados.push(t.tribunal);

  // Um resumo por estado que falhou. O texto do Keycloak é o mesmo nos seis —
  // repetir a caixa inteira embaixo de cada um era o que mais esticava a tela.
  const comErro = estados
    .map((estado) => {
      const g = tribunais.find(
        (t) => t.tribunal === estado && t.status === "erro" && t.ultimoErro,
      );
      return g ? { estado, erro: g.ultimoErro as string } : null;
    })
    .filter((x): x is { estado: string; erro: string } => x != null);

  return (
    <div>
      {lote && (
        <div className="mb-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={lote.rodando ? "outline" : "default"}
              onClick={lote.rodando ? lote.onParar : lote.onIniciar}
            >
              {lote.rodando ? (
                <><Square className="mr-1.5 h-3.5 w-3.5" />Parar</>
              ) : (
                <><Play className="mr-1.5 h-3.5 w-3.5" />Testar tudo</>
              )}
            </Button>
            {/* Os três números ao lado do botão: é o estado da credencial em
                uma linha, sem precisar varrer a grade com o olho. */}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-apoio text-muted-foreground">
              {lote.rodando ? (
                <>{lote.feitos} de {lote.total}{lote.atual ? ` · ${lote.atual}` : ""}</>
              ) : (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    <b className="font-semibold text-foreground tabular-nums">{conta("ativa")}</b> validados
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                    <b className="font-semibold text-foreground tabular-nums">{conta("erro")}</b> falharam
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                    <b className="font-semibold text-foreground tabular-nums">{conta("nao_testado")}</b> nunca usados
                  </span>
                  {semCobertura > 0 && (
                    <span className="italic">{semCobertura} sem portal mapeado</span>
                  )}
                </>
              )}
            </span>
          </div>
          {lote.rodando && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${lote.total > 0 ? (lote.feitos / lote.total) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Uma LINHA por estado: sigla à esquerda, os graus à direita no mesmo
          eixo. `min-w-0` em todo item porque a sigla não pode esticar a coluna
          (foi o que empurrou a tela de editar plano pra 2110px). */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(186px,1fr))] gap-x-3 gap-y-0.5 [&>*]:min-w-0">
        {estados.map((estado) => {
          const graus = tribunais.filter((t) => t.tribunal === estado);
          return (
            <div
              key={estado}
              className="flex items-center gap-2 border-b border-border/60 py-1.5 last:border-b-0"
            >
              <span className="shrink-0 text-apoio font-bold tracking-wide">
                {estado.toUpperCase()}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {graus.map((g) => (
                  <SeloGrau key={chave(g.tribunal, g.grau)} g={g} testando={testando} onTestar={onTestar} />
                ))}
              </span>
            </div>
          );
        })}
      </div>

      {comErro.length > 0 && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setVerErros((v) => !v)}
            className="flex items-center gap-1.5 text-apoio font-semibold text-danger-fg"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${verErros ? "" : "-rotate-90"}`}
            />
            Por que {comErro.length} {comErro.length === 1 ? "falhou" : "falharam"}
          </button>
          {verErros && (
            <div className="mt-1.5 space-y-1.5">
              {comErro.map(({ estado, erro }) => {
                const r = resumirErroCofre(erro);
                return (
                  <div
                    key={estado}
                    className="rounded-md border border-dashed border-danger/30 bg-danger-bg/60 px-2.5 py-1.5 text-apoio leading-snug text-danger-fg"
                  >
                    <p>
                      <b className="font-bold">{estado.toUpperCase()}</b>
                      {r?.resumo ? ` · ${r.resumo}` : ""}
                    </p>
                    {r?.acao && <p className="mt-0.5 text-micro text-danger-fg/80">{r.acao}</p>}
                    {/* O texto cru continua acessível: é ele que diz o realm, os
                        campos achados na página e a URL exata — o que resolve o
                        caso quando o resumo não basta. */}
                    <details className="mt-1">
                      <summary className="cursor-pointer select-none text-micro text-muted-foreground">
                        detalhe técnico
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-micro leading-snug text-muted-foreground">
                        {erro}
                      </pre>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {conta("nao_testado") > 0 && (
        <p className="mt-2 text-micro leading-relaxed text-muted-foreground">
          <strong className="text-foreground">“Não testado” é honesto, não é promessa.</strong>{" "}
          Esses portais nunca foram usados com login real — cada um só fica verde depois de um
          login que funcionou. Clique no selo do grau pra testar um; “Testar tudo” roda a fila.
        </p>
      )}
    </div>
  );
}
