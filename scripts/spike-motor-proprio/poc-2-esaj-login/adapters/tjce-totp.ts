/**
 * Wrapper isolado pra geração de TOTP — facilita mock em testes
 * unitários sem precisar bagunçar o adapter principal.
 */

import { authenticator, hotp } from "otplib";

export function gerarCodigoTotp(secret: string): string {
  const secretLimpo = secret.replace(/\s+/g, "").toUpperCase();
  return authenticator.generate(secretLimpo);
}

export interface CodigosVizinhos {
  /** Código que era válido 60s atrás (janela TOTP anterior à anterior) */
  menos2: string;
  /** Código que era válido 30s atrás (janela TOTP anterior) */
  menos1: string;
  /** Código atual — o que `gerarCodigoTotp` retorna */
  atual: string;
  /** Código que será válido daqui 30s (janela TOTP seguinte) */
  mais1: string;
  /** Código que será válido daqui 60s (2 janelas à frente) */
  mais2: string;
  /** Counter TOTP (=floor(timestampSeg/30)) da janela atual — debug */
  counterAtual: number;
}

/**
 * Gera os códigos das 5 janelas TOTP vizinhas (atual ± 2).
 *
 * Usado em diagnóstico: se o usuário comparou o código atual com o
 * app dele e bateu com nenhum, mas bate com -1/+1, é drift de clock
 * leve (≤30s) e o Keycloak provavelmente teria aceitado se tivesse
 * tolerância configurada. Se bate com ±2 (±60s), drift maior — pede
 * sync NTP. Se não bate com NENHUM, secret está diferente.
 */
export function gerarCodigosVizinhos(secret: string): CodigosVizinhos {
  const secretLimpo = secret.replace(/\s+/g, "").toUpperCase();
  const counterAtual = Math.floor(Date.now() / 1000 / 30);
  return {
    menos2: hotp.generate(secretLimpo, counterAtual - 2),
    menos1: hotp.generate(secretLimpo, counterAtual - 1),
    atual: hotp.generate(secretLimpo, counterAtual),
    mais1: hotp.generate(secretLimpo, counterAtual + 1),
    mais2: hotp.generate(secretLimpo, counterAtual + 2),
    counterAtual,
  };
}
