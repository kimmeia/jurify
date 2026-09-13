/**
 * Logo da marca JuridFlow — "J." (J + ponto violeta), no espírito do "D."
 * do Devular. Wordmark vetorial via fonte Poppins (--font-display). Com
 * `wordmark`, mostra "JuridFlow" ao lado (Jurid branco + Flow violeta).
 *
 * `tom="sidebar"` existe porque o menu é escuro mesmo no tema claro: ali o
 * `text-foreground` (tinta escura) sumiria no fundo. E é branco puro, não a
 * tinta do menu: na logo "Jurid" é branco, e com o cinza-azulado a marca
 * ficava desbotada ao lado dela. O violeta é o da logo clareado o mínimo
 * necessário — o tom exato dá 3:1 sobre o menu, abaixo do mínimo de leitura.
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
  const corTexto = tom === "sidebar" ? "text-white" : "text-foreground";
  const corAcento = tom === "sidebar" ? "text-marca-em-escuro" : "text-marca";
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
