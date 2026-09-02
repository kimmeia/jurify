/**
 * Logo da marca JuridFlow — "J." (J + ponto violeta), no espírito do "D."
 * do Devular. Wordmark vetorial via fonte Poppins (--font-display). Com
 * `wordmark`, mostra "JuridFlow" ao lado (Jurid neutro + Flow violeta).
 *
 * `tom="sidebar"` existe porque o menu é escuro mesmo no tema claro: ali o
 * `text-foreground` (tinta escura) sumiria no fundo, e o violeta precisa de
 * um tom mais claro pra continuar legível.
 */
export function MarcaJ({
  size = 24,
  wordmark = false,
  className = "",
  tom = "conteudo",
}: {
  size?: number;
  wordmark?: boolean;
  className?: string;
  tom?: "conteudo" | "sidebar";
}) {
  const corTexto = tom === "sidebar" ? "text-sidebar-foreground" : "text-foreground";
  const corAcento = tom === "sidebar" ? "text-info" : "text-info-fg";
  return (
    <span className={"flex items-center gap-2 select-none leading-none " + className}>
      <span
        className={`font-display font-extrabold leading-none ${corTexto}`}
        style={{ fontSize: size }}
        aria-hidden
      >
        J<span className={corAcento}>.</span>
      </span>
      {wordmark && (
        <span
          className="font-display font-extrabold tracking-tight leading-none"
          style={{ fontSize: Math.round(size * 0.62) }}
        >
          <span className={corTexto}>Jurid</span>
          <span className={corAcento}>Flow</span>
        </span>
      )}
    </span>
  );
}
