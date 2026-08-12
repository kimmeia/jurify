/**
 * Rota /agente-juridico — casca da página em volta do redator.
 *
 * O conteúdo mora em `juridico/redator-peca` porque o mesmo componente é
 * usado no modo "Redigir peça" do JurisIA.
 */
import { RedatorPeca } from "./juridico/redator-peca";

export default function AgenteJuridico() {
  return <RedatorPeca />;
}
