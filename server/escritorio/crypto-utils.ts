/**
 * Utilitários de criptografia — AES-256-GCM
 * Usado para armazenar tokens e chaves de API de forma segura no banco.
 *
 * Requer variável de ambiente ENCRYPTION_KEY (hex, 64 chars = 32 bytes).
 * Se não definida, usa uma chave derivada do DATABASE_URL como fallback.
 */

import crypto from "crypto";
import { createLogger } from "../_core/logger";
const log = createLogger("escritorio-crypto-utils");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recomenda 12 bytes
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey && envKey.length === 64) {
    return Buffer.from(envKey, "hex");
  }

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    throw new Error("[Crypto] ENCRYPTION_KEY é obrigatória em produção. Defina uma chave hex de 64 caracteres (32 bytes).");
  }

  // Fallback apenas em desenvolvimento: derivar do DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("[Crypto] ENCRYPTION_KEY ou DATABASE_URL deve estar definida.");
  }
  log.warn("[Crypto] AVISO: Usando chave derivada do DATABASE_URL. Defina ENCRYPTION_KEY antes de ir para produção.");
  return crypto.createHash("sha256").update(dbUrl).digest();
}

/**
 * Criptografa um texto (JSON stringified) com AES-256-GCM.
 * Retorna { encrypted, iv, tag } como strings hex.
 */
export function encrypt(plaintext: string): { encrypted: string; iv: string; tag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
}

/**
 * Decriptografa dados criptografados com AES-256-GCM.
 */
export function decrypt(encrypted: string, iv: string, tag: string): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Criptografa um objeto de configuração (converte para JSON primeiro).
 */
export function encryptConfig(config: Record<string, any>): { encrypted: string; iv: string; tag: string } {
  return encrypt(JSON.stringify(config));
}

/**
 * Decriptografa e parseia um objeto de configuração.
 */
export function decryptConfig(encrypted: string, iv: string, tag: string): Record<string, any> {
  const json = decrypt(encrypted, iv, tag);
  return JSON.parse(json);
}

/**
 * Mascara um token/chave para exibição segura.
 * Ex: "sk_live_abc123xyz789" → "sk_live_***...789"
 */
export function maskToken(token: string, visibleEnd = 4): string {
  if (!token || token.length <= visibleEnd + 4) return "****";
  return token.slice(0, 4) + "***..." + token.slice(-visibleEnd);
}

/**
 * Gera um webhook secret aleatório.
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}
