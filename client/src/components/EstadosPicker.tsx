/**
 * Grade "Onde vigiar" do monitoramento por CPF/CNPJ — aprovada no mockup de
 * 20/08. A sede (TJCE) fica sempre marcada: o monitoramento nasceu pra ela e
 * desmarcá-la transformaria o botão num "não vigiar nada" silencioso.
 */
import { TRIBUNAIS_PJE, TRIBUNAL_SEDE } from "@shared/tribunais-pje";

export function EstadosPicker({
  selecionados,
  onChange,
}: {
  selecionados: string[];
  onChange: (tribunais: string[]) => void;
}) {
  const todosMarcados = selecionados.length === TRIBUNAIS_PJE.length;

  const alternar = (codigo: string) => {
    if (codigo === TRIBUNAL_SEDE) return;
    onChange(
      selecionados.includes(codigo)
        ? selecionados.filter((t) => t !== codigo)
        : [...selecionados, codigo],
    );
  };

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Onde vigiar
        </span>
        <button
          type="button"
          className="text-[11px] font-semibold text-info-fg hover:underline"
          onClick={() =>
            onChange(todosMarcados ? [TRIBUNAL_SEDE] : TRIBUNAIS_PJE.map((t) => t.codigo))
          }
        >
          {todosMarcados ? "Só a sede (CE)" : `Selecionar todos os ${TRIBUNAIS_PJE.length}`}
        </button>
      </div>
      <div className="grid grid-cols-6 gap-2 mt-2">
        {TRIBUNAIS_PJE.map((t) => {
          const sede = t.codigo === TRIBUNAL_SEDE;
          const on = sede || selecionados.includes(t.codigo);
          return (
            <button
              key={t.codigo}
              type="button"
              aria-pressed={on}
              onClick={() => alternar(t.codigo)}
              className={`relative rounded-[10px] border-[1.5px] px-2 py-2 text-center transition-colors ${
                on
                  ? "border-info/30 bg-info-bg dark:bg-info/40"
                  : "border-border bg-card hover:bg-muted/50"
              } ${sede ? "cursor-default" : ""}`}
            >
              {sede && (
                <span className="absolute -top-[7px] right-1.5 rounded bg-info px-1 text-[7.5px] font-extrabold tracking-wide text-info-on">
                  SEDE
                </span>
              )}
              <span
                className={`block text-[13px] font-extrabold ${on ? "text-info-fg" : ""}`}
              >
                {t.uf}
              </span>
              <span
                className={`block text-[9px] mt-0.5 ${on ? "text-info-fg" : "text-muted-foreground"}`}
              >
                {t.sigla}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
