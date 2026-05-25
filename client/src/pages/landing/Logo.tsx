/**
 * Wordmark do JuridFlow — "Jurid" em peso forte + "Flow" em violeta.
 *
 * Recriado em código (fonte Poppins via index.html) pra escalar nítido e
 * adaptar a fundo claro/escuro sem depender de arquivo de imagem.
 */

interface LogoProps {
  /** "dark" pinta "Jurid" em branco (pra fundo escuro). Default: claro. */
  variant?: "light" | "dark";
  className?: string;
}

export function Logo({ variant = "light", className = "text-2xl" }: LogoProps) {
  return (
    <span
      className={`font-display font-extrabold tracking-tight leading-none select-none ${className}`}
    >
      <span className={variant === "dark" ? "text-white" : "text-[#0b0b17]"}>Jurid</span>
      <span className="font-semibold text-violet-600">Flow</span>
    </span>
  );
}
