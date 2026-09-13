import { Fragment } from "react";

/**
 * Texto do manual com os rótulos de tela («Cofre», «Nova credencial») em
 * destaque. A convenção das aspas angulares é a mesma que o teste usa pra
 * conferir que o rótulo existe na tela — aqui ela só vira visual.
 */
export function TextoComRotulos({ texto, className = "" }: { texto: string; className?: string }) {
  const partes = texto.split(/«([^»]+)»/g);
  return (
    <span className={className}>
      {partes.map((p, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className="inline-block rounded-md border border-border bg-muted px-1.5 py-px text-apoio font-semibold text-foreground align-baseline"
          >
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  );
}
