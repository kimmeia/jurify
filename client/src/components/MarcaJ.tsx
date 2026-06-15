/**
 * Logo da marca JuridFlow — "J." (J + ponto violeta), no espírito do "D."
 * do Devular. Wordmark vetorial via fonte Poppins (--font-display); o "J"
 * usa text-foreground, então se adapta a tema claro/escuro. Com `wordmark`,
 * mostra "JuridFlow" ao lado (Jurid neutro + Flow violeta, identidade do
 * produto). Centraliza a definição da logo num único lugar.
 */
export function MarcaJ({
  size = 24,
  wordmark = false,
  className = "",
}: {
  size?: number;
  wordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={"flex items-center gap-2 select-none leading-none " + className}>
      <span
        className="font-display font-extrabold leading-none text-foreground"
        style={{ fontSize: size }}
        aria-hidden
      >
        J<span className="text-violet-600">.</span>
      </span>
      {wordmark && (
        <span
          className="font-display font-extrabold tracking-tight leading-none"
          style={{ fontSize: Math.round(size * 0.62) }}
        >
          <span className="text-foreground">Jurid</span>
          <span className="text-violet-600">Flow</span>
        </span>
      )}
    </span>
  );
}
