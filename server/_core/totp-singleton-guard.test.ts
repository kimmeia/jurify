/**
 * Teste de regressão pro bug de contaminação do singleton `authenticator`
 * do otplib detectado em 08/05/2026.
 *
 * Bug original: `gerarCodigosVizinhos` em
 * scripts/spike-motor-proprio/poc-2-esaj-login/adapters/tjce-totp.ts fazia
 *
 *   const optsOriginal = { ...authenticator.options };
 *   authenticator.options = { ...optsOriginal, epoch: X };
 *   ...
 *   authenticator.options = optsOriginal;  // "restaurar"
 *
 * O setter de `authenticator.options` faz MERGE em `_options`, não REPLACE.
 * E o getter mergeia defaults+options, onde defaults inclui `epoch: Date.now()`.
 * Então `optsOriginal.epoch` carrega o `Date.now()` capturado no momento
 * da chamada — e o "restaurar" PERSISTE esse epoch antigo em `_options`.
 *
 * Resultado: como `authenticator` é singleton de processo, qualquer
 * `authenticator.generate(secret)` subsequente em qualquer caller (cron
 * de revalidação, validação manual concorrente) usa o epoch travado no
 * passado → códigos da janela errada → Keycloak rejeita.
 *
 * Estes testes garantem que NUNCA mais escondamos um bug assim.
 */

import { describe, it, expect } from "vitest";
import { authenticator } from "otplib";

const SECRET_BASE32 = "JBSWY3DPEHPK3PXP";

describe("singleton otplib authenticator — guarda contra contaminação global", () => {
  it("clone() permite epoch custom sem afetar o singleton", () => {
    const epochAntigo = Date.now() - 60_000; // 60s atrás
    const inst = authenticator.clone();
    inst.options = { epoch: epochAntigo };

    const codigoAntigo = inst.generate(SECRET_BASE32);
    const codigoAtual = authenticator.generate(SECRET_BASE32);

    // Os códigos devem ser diferentes — confirma que clone respeita epoch custom.
    expect(codigoAntigo).not.toBe(codigoAtual);

    // E após mexer no clone, o singleton continua dando código da janela ATUAL.
    // Se o clone vazasse pro singleton (bug antigo), `generate2` daria código
    // da janela ANTIGA = `codigoAntigo`.
    const generate2 = authenticator.generate(SECRET_BASE32);
    expect(generate2).toBe(codigoAtual);
  });

  it("repetidas chamadas em sequência não derivam epoch", () => {
    // Pré-condição: authenticator gera código atual.
    const c1 = authenticator.generate(SECRET_BASE32);

    // Cinco clones com epochs distintos — simula gerarCodigosVizinhos.
    const agoraMs = Date.now();
    const stepMs = 30_000;
    [-2, -1, 0, 1, 2].forEach((delta) => {
      const inst = authenticator.clone();
      inst.options = { epoch: agoraMs + delta * stepMs };
      inst.generate(SECRET_BASE32); // intencional ignorar resultado
    });

    // Após manipular clones, singleton ainda gera código da janela atual.
    const c2 = authenticator.generate(SECRET_BASE32);
    expect(c2).toBe(c1);
  });

});
