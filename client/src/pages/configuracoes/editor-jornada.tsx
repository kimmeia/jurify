/**
 * A jornada contratada de um colaborador.
 *
 * Guarda horário, não só carga, porque o mesmo campo precisa responder duas
 * perguntas: "cumpriu as horas" e "chegou na hora". Pontualidade é critério da
 * avaliação de desempenho, e dois campos separados divergiriam no primeiro
 * mês.
 *
 * Sem jornada definida o ponto mostra as horas e não cobra nada — que é o
 * certo enquanto ninguém configurou. Por isso "sem jornada" é um estado de
 * primeira classe aqui, e não um formulário vazio esperando ser preenchido.
 */

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  jornadaPadrao,
  minutosDoExpediente,
  NOMES_DIA,
  resumirJornada,
  type DiaSemana,
  type JornadaSemanal,
} from "@shared/jornada";

const DIAS: DiaSemana[] = [1, 2, 3, 4, 5, 6, 0];

export function EditorJornada({
  valor,
  onChange,
}: {
  valor: JornadaSemanal | null;
  onChange: (j: JornadaSemanal | null) => void;
}) {
  const trocar = (dia: DiaSemana, campo: "inicio" | "fim" | "intervaloMin", v: string) => {
    const atual = valor?.[dia];
    if (!atual) return;
    onChange({
      ...valor,
      [dia]: {
        ...atual,
        [campo]: campo === "intervaloMin" ? Math.max(Number(v) || 0, 0) : v,
      },
    });
  };

  const alternar = (dia: DiaSemana) => {
    const copia = { ...(valor ?? {}) };
    if (copia[dia]) {
      delete copia[dia];
    } else {
      // Herda o horário de um dia já configurado — quem trabalha sábado
      // costuma começar na mesma hora, e redigitar 08:00 sete vezes é o tipo
      // de atrito que faz ninguém configurar.
      const modelo = Object.values(valor ?? {})[0] ?? { inicio: "08:00", fim: "18:00", intervaloMin: 60 };
      copia[dia] = { ...modelo };
    }
    onChange(Object.keys(copia).length > 0 ? copia : null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Jornada de trabalho</p>
        {valor ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-danger-fg"
            onClick={() => onChange(null)}
          >
            remover jornada
          </button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onChange(jornadaPadrao())}>
            Definir jornada
          </Button>
        )}
      </div>

      {!valor ? (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Sem jornada definida. O ponto continua registrando as horas dele, mas não vai dizer se
          sobraram ou faltaram, nem marcar atraso.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            {DIAS.map((dia) => {
              const e = valor[dia];
              return (
                <div key={dia} className="grid grid-cols-[76px_1fr_1fr_74px] items-center gap-2">
                  <button
                    type="button"
                    onClick={() => alternar(dia)}
                    className={`rounded-md px-2 py-1 text-left text-[11.5px] font-semibold ${
                      e
                        ? "bg-info-bg text-info-fg dark:text-info"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    title={e ? "Marcar como folga" : "Marcar como dia de trabalho"}
                  >
                    {NOMES_DIA[dia].slice(0, 3)}
                  </button>
                  {e ? (
                    <>
                      <Input
                        type="time"
                        className="h-8 text-[11.5px]"
                        value={e.inicio}
                        onChange={(ev) => trocar(dia, "inicio", ev.target.value)}
                      />
                      <Input
                        type="time"
                        className="h-8 text-[11.5px]"
                        value={e.fim}
                        onChange={(ev) => trocar(dia, "fim", ev.target.value)}
                      />
                      <Input
                        type="number"
                        min={0}
                        step={15}
                        className="h-8 text-[11.5px]"
                        value={e.intervaloMin}
                        onChange={(ev) => trocar(dia, "intervaloMin", ev.target.value)}
                        title="Minutos de intervalo (almoço)"
                      />
                    </>
                  ) : (
                    <span className="col-span-3 text-[11px] text-muted-foreground">folga</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
            <span>Início · fim · intervalo em minutos</span>
            <span className="font-semibold text-foreground">{resumirJornada(valor)}</span>
          </div>

          {DIAS.some((d) => valor[d] && minutosDoExpediente(valor[d]!) <= 0) && (
            <p className="rounded-lg border border-warning/30 bg-warning-bg px-2.5 py-1.5 text-[10.5px] text-warning-fg">
              Algum dia está com fim antes do início ou intervalo maior que o expediente — esse dia
              será descartado ao salvar.
            </p>
          )}
        </>
      )}
    </div>
  );
}
