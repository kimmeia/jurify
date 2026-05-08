/**
 * Adapter PJe TJCE 1º grau — caminho de PRODUÇÃO.
 *
 * Hoje: wrapper fino sobre o `PjeTjceScraper` em
 * `scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts`.
 * Mantemos o spike intocado pra continuar testando isoladamente.
 *
 * Sprint 1 (07-08/05/2026): adapter validado em staging com:
 *   - Login PDPJ-cloud (Keycloak SSO + 2FA TOTP)
 *   - Sessão criptografada 90min em `cofre_sessoes`
 *   - Click → nova aba → URL detalhe (?id=X&ca=Y)
 *   - Capa: classe, órgão, valor, partes (5 partes incluindo advogados)
 *   - 15 movs limpas (sem duplicatas, sem JS embutido)
 *   - dataDistribuicao via fallback (mov "Distribuído por sorteio")
 *
 * Sprint 2+: extrair `PjeTjceScraper` direto pra cá quando o spike
 * for desligado. Por ora reutilizamos via import.
 */

import { PjeTjceScraper } from "../../../scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce";
import type { ResultadoScraper } from "../../../scripts/spike-motor-proprio/lib/types-spike";

/**
 * Consulta processo TJCE 1º grau via motor próprio.
 *
 * Caller já validou que:
 *   1. CNJ é TJCE (via parseCnjTribunal)
 *   2. Cliente tem credencial TJCE ativa no cofre
 *   3. Sessão recuperada/renovada do cofre
 *
 * @param cnj CNJ no formato com ou sem máscara
 * @param storageStateJson Storage state do Playwright (cookies da sessão)
 * @returns ResultadoScraper — bridge converte pra JuditLawsuit
 */
export async function consultarTjce(
  cnj: string,
  storageStateJson: string,
): Promise<ResultadoScraper> {
  // PjeTjceScraper exige credencial no constructor pra fluxo de login,
  // mas `consultarPorCnj` usa só `storageStateJson` (sessão pré-criada).
  // Passamos credencial dummy — não é usada nesse fluxo.
  const scraper = new PjeTjceScraper({
    username: "(via-sessao)",
    password: "(via-sessao)",
    totpSecret: null,
  });
  return scraper.consultarPorCnj(cnj, storageStateJson);
}

export { PjeTjceScraper };
