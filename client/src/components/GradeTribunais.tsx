/**
 * Estado por estado de uma credencial do PDPJ.
 *
 * O login é nacional, mas cada PJe é um portal diferente — e dos que o motor
 * conhece, só o TJCE foi validado com login real. Os outros têm a URL
 * derivada do padrão e podem exigir ajuste, como o TJDF já exigiu.
 *
 * Daí a grade existir em vez de um selo "funciona em 12 estados": "não
 * testado" é a informação principal, não um detalhe. Prometer os doze e
 * descobrir na hora do prazo qual não responde seria pior que não oferecer.
 */
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCcw } from "lucide-react";

export interface TribunalDaCredencial {
  tribunal: string;
  status: "nao_testado" | "ativa" | "erro";
  ultimoErro: string | null;
  ultimoSucessoEm: string | null;
  processos: number;
}

interface Props {
  tribunais: TribunalDaCredencial[];
  testando: string | null;
  onTestar: (tribunal: string) => void;
}

const ESTILO = {
  ativa: {
    caixa: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/20",
    nome: "text-emerald-900 dark:text-emerald-300",
    texto: "text-emerald-700 dark:text-emerald-400",
    ponto: "bg-emerald-500",
  },
  erro: {
    caixa: "border-rose-200 bg-rose-50/70 dark:border-rose-900/50 dark:bg-rose-950/20",
    nome: "text-rose-800 dark:text-rose-300",
    texto: "text-rose-700 dark:text-rose-400",
    ponto: "bg-rose-500",
  },
  nao_testado: {
    caixa: "border-slate-200 dark:border-slate-800",
    nome: "",
    texto: "text-muted-foreground",
    ponto: "bg-slate-300",
  },
} as const;

export default function GradeTribunais({ tribunais, testando, onTestar }: Props) {
  const conta = (s: TribunalDaCredencial["status"]) => tribunais.filter((t) => t.status === s).length;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
        {tribunais.map((t) => {
          const e = ESTILO[t.status];
          return (
            <div key={t.tribunal} className={`rounded-lg border p-2 ${e.caixa}`}>
              <div className="flex items-center justify-between gap-1">
                <span className={`text-[11.5px] font-bold tracking-wide ${e.nome}`}>
                  {t.tribunal.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={() => onTestar(t.tribunal)}
                  disabled={testando != null}
                  className="text-muted-foreground disabled:opacity-40"
                  title={`Testar login no ${t.tribunal.toUpperCase()}`}
                >
                  {testando === t.tribunal ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3 w-3" />
                  )}
                </button>
              </div>
              <div className={`text-[10px] mt-0.5 flex items-center gap-1.5 ${e.texto}`}>
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${e.ponto}`} />
                <span className="truncate" title={t.ultimoErro ?? undefined}>
                  {t.status === "ativa"
                    ? t.processos > 0
                      ? `validado · ${t.processos} processos`
                      : "validado"
                    : t.status === "erro"
                      ? "login falhou"
                      : "não testado"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 pt-2.5 border-t text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {conta("ativa")} validados com login real
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          {conta("erro")} falharam
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          {conta("nao_testado")} nunca usados
        </span>
      </div>

      {conta("nao_testado") > 0 && (
        <p className="text-[10.5px] text-muted-foreground mt-2 leading-relaxed">
          <strong className="text-foreground">“Não testado” é honesto, não é promessa.</strong>{" "}
          Esses estados têm o endereço derivado do padrão do TJCE e nunca foram usados com login
          real. Cada um só fica verde depois de um login que funcionou de verdade — o botão de
          atualizar testa na hora.
        </p>
      )}
    </div>
  );
}
