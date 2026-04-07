/**
 * Hash de senha usando scrypt (built-in do Node).
 *
 * Por que scrypt e não bcrypt?
 *   - scrypt vem nativo no Node, sem dependência extra
 *   - sem build steps (bcrypt precisa compilar nativo, dói no deploy)
 *   - resistente a ataques de hardware (GPU/ASIC) por ser memory-hard
 *   - usado por dropbox, etc.
 *
 * Formato armazenado: `{salt_hex}:{hash_hex}` em uma única string.
 * Salt: 16 bytes random
 * Hash: 64 bytes derivados via scrypt
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Gera o hash de uma senha em texto plano.
 * Retorna a string `{salt}:{hash}` pronta pra armazenar no banco.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 6) {
    throw new Error("Senha deve ter pelo menos 6 caracteres");
  }
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Verifica se a senha corresponde ao hash armazenado.
 * Usa timingSafeEqual pra evitar ataques de timing.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (!password || !storedHash) return false;
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expectedHash = Buffer.from(hashHex, "hex");
    const actualHash = await scrypt(password, salt, expectedHash.length);
    return timingSafeEqual(expectedHash, actualHash);
  } catch {
    return false;
  }
}
