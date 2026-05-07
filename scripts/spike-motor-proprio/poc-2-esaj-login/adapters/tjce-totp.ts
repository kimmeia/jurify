/**
 * Wrapper isolado pra geração de TOTP — facilita mock em testes
 * unitários sem precisar bagunçar o adapter principal.
 */

import { authenticator } from "otplib";

export function gerarCodigoTotp(secret: string): string {
  const secretLimpo = secret.replace(/\s+/g, "").toUpperCase();
  return authenticator.generate(secretLimpo);
}
