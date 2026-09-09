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
 */
import { Button } from "@/components/ui/button";
import { Loader2, Play, RefreshCcw, Square } from "lucide-react";
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
    caixa: "border-success/30 bg-success-bg/70 dark:bg-success/20",
    texto: "text-success-fg",
    ponto: "bg-success",
  },
  erro: {
    caixa: "border-danger/30 bg-danger-bg/70 dark:bg-danger/20",
    texto: "text-danger-fg",
    ponto: "bg-danger",
  },
  nao_testado: {
    caixa: "border-border",
    texto: "text-muted-foreground",
    ponto: "bg-muted-foreground/50",
  },
} as const;

function chave(t: string, g: number) {
  return `${t}:${g}`;
}

export default function GradeTribunais({ tribunais, testando, onTestar, lote }: Props) {
  const conta = (s: TribunalDaCredencial["status"]) =>
    tribunais.filter((t) => !t.semCobertura && t.status === s).length;
  const semCobertura = tribunais.filter((t) => t.semCobertura).length;

  // Agrupa por estado preservando a ordem que o servidor mandou.
  const estados: string[] = [];
  for (const t of tribunais) if (!estados.includes(t.tribunal)) estados.push(t.tribunal);

  return (
    <div>
      {lote && (
        <div className="mb-3">
          <div className="flex items-center gap-2.5">
            <Button
              size="sm"
              variant={lote.rodando ? "outline" : "default"}
              onClick={lote.rodando ? lote.onParar : lote.onIniciar}
            >
              {lote.rodando ? (
                <><Square className="h-3.5 w-3.5 mr-1.5" />Parar</>
              ) : (
                <><Play className="h-3.5 w-3.5 mr-1.5" />Testar tudo</>
              )}
            </Button>
            <span className="text-[11.5px] text-muted-foreground">
              {lote.rodando
                ? `${lote.feitos} de ${lote.total}${lote.atual ? ` · ${lote.atual}` : ""}`
                : `${lote.total} combinações de estado e grau — cada login leva dezenas de segundos`}
            </span>
          </div>
          {lote.rodando && (
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mt-2">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${lote.total > 0 ? (lote.feitos / lote.total) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {estados.map((estado) => {
          const graus = tribunais.filter((t) => t.tribunal === estado);
          const erro = graus.find((g) => g.status === "erro" && g.ultimoErro);
          return (
            <div key={estado} className="rounded-lg border p-2.5">
              <div className="text-[11.5px] font-bold tracking-wide mb-1.5">
                {estado.toUpperCase()}
              </div>

              {graus.map((g) => {
                const e = ESTILO[g.status];
                const k = chave(g.tribunal, g.grau);
                return (
                  <div
                    key={k}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 mb-1 last:mb-0 ${
                      g.semCobertura ? "border-dashed border-border" : e.caixa
                    }`}
                  >
                    <span className="text-[10px] font-semibold text-muted-foreground w-11 shrink-0">
                      {g.grau}º grau
                    </span>
                    {g.semCobertura ? (
                      <span className="text-[10px] text-muted-foreground italic truncate">
                        endereço não mapeado
                      </span>
                    ) : (
                      <>
                        <span className={`text-[10px] flex items-center gap-1.5 ${e.texto}`}>
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${e.ponto}`} />
                          {g.status === "ativa"
                            ? g.processos > 0
                              ? `validado · ${g.processos} processos`
                              : "validado"
                            : g.status === "erro"
                              ? "login falhou"
                              : "não testado"}
                        </span>
                        <button
                          type="button"
                          onClick={() => onTestar(g.tribunal, g.grau)}
                          disabled={testando != null}
                          className="ml-auto text-muted-foreground disabled:opacity-40"
                          title={`Testar login no ${g.tribunal.toUpperCase()} ${g.grau}º grau`}
                        >
                          {testando === k ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCcw className="h-3 w-3" />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}

              {erro?.ultimoErro && (() => {
                const r = resumirErroCofre(erro.ultimoErro);
                if (!r) return null;
                return (
                  <div className="mt-1.5 text-[10px] leading-snug text-danger-fg bg-danger-bg/70 border border-dashed border-danger/30 rounded px-2 py-1.5">
                    <p className="font-medium">{r.resumo}</p>
                    {r.acao && (
                      <p className="text-[9.5px] text-danger-fg/80 mt-0.5">
                        {r.acao}
                      </p>
                    )}
                    {/* O texto cru continua acessível: é ele que diz o realm, os
                        campos achados na página e a URL exata — o que resolve o
                        caso quando o resumo não basta. */}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[9.5px] text-muted-foreground select-none">
                        detalhe técnico
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[9px] leading-snug text-muted-foreground">
                        {erro.ultimoErro}
                      </pre>
                    </details>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 pt-2.5 border-t text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {conta("ativa")} validados com login real
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-danger" />
          {conta("erro")} falharam
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
          {conta("nao_testado")} nunca usados
        </span>
        {semCobertura > 0 && (
          <span className="text-[10.5px] italic">{semCobertura} sem endereço mapeado</span>
        )}
      </div>

      {conta("nao_testado") > 0 && (
        <p className="text-[10.5px] text-muted-foreground mt-2 leading-relaxed">
          <strong className="text-foreground">“Não testado” é honesto, não é promessa.</strong>{" "}
          Esses portais têm o endereço derivado do padrão do TJCE e nunca foram usados com login
          real. Cada um só fica verde depois de um login que funcionou de verdade — o botão de
          atualizar testa um, e “Testar tudo” roda a fila inteira.
        </p>
      )}
    </div>
  );
}
