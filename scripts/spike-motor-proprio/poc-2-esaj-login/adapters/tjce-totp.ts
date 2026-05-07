/**
 * Wrapper isolado pra geração de TOTP — facilita mock em testes
 * unitários sem precisar bagunçar o adapter principal.
 */

import { authenticator } from "otplib";

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
  /** Counter TOTP (=floor(timestampMs/30000)) da janela atual — debug */
  counterAtual: number;
}

/**
 * Gera os códigos das 5 janelas TOTP vizinhas (atual ± 2).
 *
 * IMPORTANTE: usa `authenticator.options.epoch` em vez de
 * `hotp.generate(secret, counter)`. Razão: `hotp` por default não
 * decodifica base32, então `hotp.generate("MZDW6ZLS...", counter)`
 * trata o secret como ASCII raw — código resultante NÃO BATE com
 * `authenticator.generate(secret)` que decodifica base32 corretamente.
 * Bug detectado em 07/05/2026 quando "janela atual" via authenticator
 * gerava 164735 e via hotp gerava 702342 com mesmo secret/counter.
 *
 * Solução: muda `authenticator.options.epoch` (timestamp em ms) pra
 * cada janela e gera com o mesmo decoder de base32 do código atual.
 * Restaura opção original ao terminar.
 */
export function gerarCodigosVizinhos(secret: string): CodigosVizinhos {
  const secretLimpo = secret.replace(/\s+/g, "").toUpperCase();
  const agoraMs = Date.now();
  const stepMs = 30_000;
  const counterAtual = Math.floor(agoraMs / stepMs);

  const optsOriginal = { ...authenticator.options };

  const gerarEm = (deltaMs: number): string => {
    authenticator.options = { ...optsOriginal, epoch: agoraMs + deltaMs };
    return authenticator.generate(secretLimpo);
  };

  try {
    return {
      menos2: gerarEm(-2 * stepMs),
      menos1: gerarEm(-1 * stepMs),
      atual: gerarEm(0),
      mais1: gerarEm(1 * stepMs),
      mais2: gerarEm(2 * stepMs),
      counterAtual,
    };
  } finally {
    // Restaura sempre — mesmo se algum gerarEm lançar exceção,
    // não deixa estado modificado pro próximo chamador.
    authenticator.options = optsOriginal;
  }
}
