/**
 * Quando o tribunal obriga a configurar 2FA no meio do login.
 *
 * O Keycloak do PDPJ empurra a tela CONFIGURE_TOTP quando a conta ainda não
 * tem segundo fator. O robô configura pra conseguir entrar — e nesse instante
 * ele passa a ser o único dono da chave da conta PJe de um advogado. Estes
 * testes prendem as duas coisas que fazem isso ser aceitável: capturar a
 * chave de um lugar determinístico, e mostrá-la pra pessoa antes de guardar.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const scraper = ler("scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts");
const router = ler("server/escritorio/router-cofre-credenciais.ts");
const tela = ler("client/src/pages/Processos.tsx");

describe("capturar a chave", () => {
  it("lê o campo escondido do formulário antes de qualquer navegação", () => {
    // É o único lugar onde a chave está nos dois modos da tela (QR e manual),
    // independente de tema e idioma. Varrer <kbd>/<code> era adivinhação: a
    // tela do TJCE não tem nenhum dos dois.
    expect(scraper).toContain("input[name='totpSecret'], input#totpSecret");
    const posHidden = scraper.indexOf("input[name='totpSecret']");
    const posGoto = scraper.indexOf("alvo.searchParams.set(\"mode\", \"manual\")");
    expect(posHidden).toBeGreaterThan(0);
    expect(posHidden).toBeLessThan(posGoto);
  });

  it("troca o mode na query em vez de concatenar", () => {
    // A URL da tela já chega com `mode=qr`. Grudar `&mode=manual` no fim
    // deixa dois `mode` na mesma query, o Keycloak lê o primeiro e continua
    // em QR — a tentativa parecia ter funcionado sem mudar nada.
    expect(scraper).toContain('alvo.searchParams.set("mode", "manual")');
    expect(scraper).not.toContain("${urlAtual}${sep}mode=manual");
  });

  it("o diagnóstico de falha diz o que tem no formulário", () => {
    // "4 inputs" não permite diagnosticar nada. Nome, tipo e tamanho do valor
    // dizem na hora se o campo existe e veio vazio.
    expect(scraper).toContain("nomesInputs");
  });
});

describe("a chave não pode ficar só com o robô", () => {
  it("a validação devolve o secret novo quando teve que configurar", () => {
    expect(router).toContain("totpSecretNovo: resultado.totpSecretConfigurado ?? null");
  });

  it("a tela mostra a chave, e não só um aviso pedindo pra cadastrá-la", () => {
    // O erro que isto previne: guardar a chave criptografada, mandar a pessoa
    // "adicionar no app autenticador" e nunca mostrar qual é. O advogado
    // ficaria sem conseguir logar no PJe pelo próprio navegador.
    expect(tela).toContain("data?.totpSecretNovo");
    expect(tela).toContain("{secretNovo}");
    expect(tela).toContain("Copiar chave");
  });

  it("é diálogo, não toast", () => {
    // Toast some sozinho em segundos. Chave que não aparece de novo não pode
    // depender de a pessoa estar olhando pra tela naquele momento.
    const i = tela.indexOf("O tribunal exigiu configurar a verificação em duas etapas");
    expect(i).toBeGreaterThan(0);
    expect(tela.slice(Math.max(0, i - 600), i)).toContain("AlertDialog open={!!secretNovo}");
  });
});
