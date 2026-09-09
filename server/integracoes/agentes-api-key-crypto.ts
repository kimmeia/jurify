/**
 * Cadeado da chave da OpenAI que o escritório cola DENTRO de um agente.
 *
 * Grava com `CANAIS_ENCRYPTION_KEY` e, sem ela, com `ENCRYPTION_KEY` (a
 * mesma que protege o resto do sistema). Antes, sem a variável, o cadeado
 * era uma chave de zeros — quem lesse o banco lia a chave do cliente.
 * A leitura tenta as chaves conhecidas em ordem, inclusive a de zeros,
 * pra que o que já foi gravado continue funcionando sem recadastro; o
 * registro passa a usar a chave boa na próxima vez que o cliente salvar.
 */

import crypto from "crypto";
import { createLogger } from "../_core/logger";

const log = createLogger("agentes-api-key-crypto");

const ALGORITHM = "aes-256-gcm";
const CHAVE_LEGADA_ZEROS = "0".repeat(64);

function hex64(v: string | undefined): string | null {
  return v && /^[0-9a-fA-F]{64}$/.test(v) ? v : null;
}

function chaveEncryptionKey(): string | null {
  const env = hex64(process.env.ENCRYPTION_KEY);
  if (env) return env;
  if (process.env.NODE_ENV === "production") return null;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  // Mesma derivação de crypto-utils fora de produção.
  return crypto.createHash("sha256").update(dbUrl).digest("hex");
}

/** Chave usada pra GRAVAR: a dedicada, senão a geral do sistema. */
export function chaveDeGravacao(): string {
  const dedicada = hex64(process.env.CANAIS_ENCRYPTION_KEY);
  if (dedicada) return dedicada;
  const geral = chaveEncryptionKey();
  if (geral) return geral;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[agentes-api-key-crypto] Defina CANAIS_ENCRYPTION_KEY ou ENCRYPTION_KEY (hex, 64 chars) em produção.",
    );
  }
  return CHAVE_LEGADA_ZEROS;
}

/** Chaves tentadas na LEITURA, em ordem — a de zeros por último, só pelo legado. */
export function chavesDeLeitura(): string[] {
  const lista: string[] = [];
  const dedicada = hex64(process.env.CANAIS_ENCRYPTION_KEY);
  if (dedicada) lista.push(dedicada);
  const geral = chaveEncryptionKey();
  if (geral && !lista.includes(geral)) lista.push(geral);
  lista.push(CHAVE_LEGADA_ZEROS);
  return lista;
}

export function encryptApiKey(apiKey: string): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(chaveDeGravacao(), "hex"), iv);
  let encrypted = cipher.update(apiKey, "utf8", "base64");
  encrypted += cipher.final("base64");
  return { encrypted, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decryptCom(chaveHex: string, encrypted: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(chaveHex, "hex"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function decryptApiKey(encrypted: string, iv: string, tag: string): string {
  const chaves = chavesDeLeitura();
  let ultimoErro: unknown = null;
  for (let i = 0; i < chaves.length; i++) {
    try {
      const texto = decryptCom(chaves[i], encrypted, iv, tag);
      if (i > 0 && chaves[i] === CHAVE_LEGADA_ZEROS) {
        log.info("chave de agente lida com o cadeado legado — será regravada com a chave atual no próximo salvar");
      }
      return texto;
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error("Não foi possível decriptar a chave do agente.");
}
