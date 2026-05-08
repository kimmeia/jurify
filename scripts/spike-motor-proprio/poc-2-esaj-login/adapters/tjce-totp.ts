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
 * IMPORTANTE: NUNCA mexer no singleton `authenticator.options` global.
 * Bug crítico detectado em 08/05/2026: o setter de `authenticator.options`
 * faz MERGE (não REPLACE), e o getter mergeia defaults+options. Então
 * "salvar opts originais e restaurar" deixa `_options.epoch` permanentemente
 * fixado no `Date.now()` capturado na primeira chamada — pois o getter
 * do default sempre retorna `epoch: Date.now()` no momento da captura,
 * e o setter persiste isso em `_options`.
 *
 * Como `authenticator` é singleton de processo (otplib exporta uma
 * instância única), isso contamina TODAS as outras chamadas no
 * processo: cron de revalidação, validação manual concorrente de
 * outras credenciais, qualquer `authenticator.generate(...)` daí
 * pra frente passa a usar epoch travado no passado → códigos da
 * janela errada → Keycloak rejeita.
 *
 * Solução: usa `authenticator.clone()` pra cada janela. clone()
 * cria instância nova com mesmas opções, mas modificações nela
 * NÃO vazam pro singleton. Isolamento total entre callers
 * concorrentes.
 */
export function gerarCodigosVizinhos(secret: string): CodigosVizinhos {
  const secretLimpo = secret.replace(/\s+/g, "").toUpperCase();
  const agoraMs = Date.now();
  const stepMs = 30_000;
  const counterAtual = Math.floor(agoraMs / stepMs);

  const gerarEm = (deltaMs: number): string => {
    // clone() retorna instância isolada; mexer em .options dela não
    // afeta o singleton global compartilhado por outros callers.
    const inst = authenticator.clone();
    inst.options = { epoch: agoraMs + deltaMs };
    return inst.generate(secretLimpo);
  };

  return {
    menos2: gerarEm(-2 * stepMs),
    menos1: gerarEm(-1 * stepMs),
    atual: gerarEm(0),
    mais1: gerarEm(1 * stepMs),
    mais2: gerarEm(2 * stepMs),
    counterAtual,
  };
}
