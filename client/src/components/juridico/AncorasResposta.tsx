/**
 * As marcas de origem no texto da IA.
 *
 * A resposta do JurisIA mistura três coisas que o advogado confere de jeitos
 * diferentes: o que está nos autos, o que é lei ou precedente, e como o
 * tribunal vem decidindo. Sem marca, ele confere tudo com o mesmo esforço;
 * marcado, ele confere o que importa — [D] ele já conhece, [F] tem
 * identificador pra checar, [A] é número contado no banco.
 *
 * O modelo escreve `[D]`, `[F]` e `[A]` no corpo do texto. Se não virassem selo
 * aqui, o advogado leria colchetes soltos no meio da minuta — e a marca, que
 * existe pra reduzir conferência, viraria sujeira.
 */

/** Cor e significado de cada âncora — a mesma tríade em texto, legenda e prova. */
export const ANCORA: Record<string, { rotulo: string; classe: string }> = {
  D: {
    rotulo: "documento do caso",
    classe:
      "bg-muted text-foreground border-border dark:text-muted-foreground/70",
  },
  F: {
    rotulo: "fonte do escritório",
    classe:
      "bg-warning-bg text-warning-fg border-warning/30 dark:text-warning",
  },
  A: {
    rotulo: "acervo público",
    classe:
      "bg-info-bg text-info-fg border-info/30 dark:text-info",
  },
};

export function ComAncoras({ texto }: { texto: string }) {
  const partes = texto.split(/(\[[DFA]\])/g);
  return (
    <>
      {partes.map((p, i) => {
        const m = /^\[([DFA])\]$/.exec(p);
        if (!m) return <span key={i}>{p}</span>;
        const a = ANCORA[m[1]!]!;
        return (
          <span
            key={i}
            title={a.rotulo}
            className={`mx-0.5 inline-flex h-[15px] w-[15px] items-center justify-center rounded border align-[2px] text-[9px] font-extrabold ${a.classe}`}
          >
            {m[1]}
          </span>
        );
      })}
    </>
  );
}

/** Legenda com a contagem por origem. Só aparece quando há marca no texto. */
export function LegendaAncoras({ texto }: { texto: string }) {
  const contagem: Record<string, number> = { D: 0, F: 0, A: 0 };
  for (const m of texto.matchAll(/\[([DFA])\]/g)) contagem[m[1]!] = (contagem[m[1]!] ?? 0) + 1;
  const usadas = Object.entries(contagem).filter(([, n]) => n > 0);
  if (usadas.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {usadas.map(([k, n]) => (
        <span key={k} className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span
            className={`inline-flex h-[15px] w-[15px] items-center justify-center rounded border text-[9px] font-extrabold ${ANCORA[k]!.classe}`}
          >
            {k}
          </span>
          {ANCORA[k]!.rotulo} · {n}
        </span>
      ))}
    </div>
  );
}
