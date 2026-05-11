/**
 * Avatar circular pra responsável de card Kanban. Mostra iniciais (1-2
 * letras) sobre fundo colorido derivado do nome — assim cada pessoa
 * fica visualmente distinguível sem precisar memorizar cor por cor.
 *
 * Determinístico: o mesmo nome sempre gera a mesma cor.
 */

function hashNome(nome: string): number {
  let h = 0;
  for (let i = 0; i < nome.length; i++) {
    h = (h << 5) - h + nome.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * Devolve cor HSL determinística a partir do nome. Saturação e
 * luminosidade fixas mantêm contraste consistente com texto branco.
 */
export function corDoNome(nome: string): string {
  const h = hashNome(nome) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

/**
 * Extrai 1-2 letras iniciais. "João Silva" → "JS"; "Maria" → "M".
 * Ignora preposições curtas como "da", "de", "do".
 */
export function iniciais(nome: string): string {
  const ignorar = new Set(["da", "de", "do", "das", "dos", "e"]);
  const partes = nome
    .trim()
    .split(/\s+/)
    .filter((p) => !ignorar.has(p.toLowerCase()));
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0][0].toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function ResponsavelAvatar({
  nome,
  tamanho = "sm",
}: {
  nome: string;
  /** sm = 14px (card view); md = 24px (editor). */
  tamanho?: "sm" | "md";
}) {
  const dim = tamanho === "sm" ? "h-3.5 w-3.5 text-[8px]" : "h-6 w-6 text-[10px]";
  return (
    <span
      className={`rounded-full flex items-center justify-center font-semibold text-white shrink-0 ${dim}`}
      style={{ background: corDoNome(nome) }}
      title={`Responsável: ${nome}`}
    >
      {iniciais(nome)}
    </span>
  );
}
