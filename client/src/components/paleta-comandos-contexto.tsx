import { createContext, useContext } from "react";

/**
 * Quem abre a paleta de comandos (⌘K) mora no AppLayout, que é quem guarda o
 * estado dela. Este contexto existe para uma TELA conseguir abrir a mesma
 * paleta — sem isso, a busca do cabeçalho teria que duplicar a paleta inteira
 * ou simular um atalho de teclado.
 *
 * `null` quando a tela está fora do AppLayout (login, assinatura): nesse caso
 * quem chama simplesmente não desenha o botão.
 */
export const AbrirPaletaContexto = createContext<(() => void) | null>(null);

export function useAbrirPaleta() {
  return useContext(AbrirPaletaContexto);
}
