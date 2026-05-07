/**
 * Helpers do Cofre de Credenciais — operações sensíveis isoladas
 * num único lugar.
 *
 * Responsabilidades:
 *  - Buscar credencial do banco e decriptar todos os campos
 *  - Gerar código TOTP atual a partir do secret armazenado
 *  - Salvar/atualizar sessões persistidas (cookies criptografados)
 *  - Atualizar status da credencial após tentativa de login
 *
 * SEGURANÇA: estas funções operam com dados decriptados em memória.
 * NUNCA logue o conteúdo (senhas, secrets, cookies). NUNCA retorne
 * o objeto decriptado para o frontend — só pra adapters server-side
 * que vão usar imediatamente e descartar.
 */

import { eq } from "drizzle-orm";
import { authenticator } from "otplib";
import { decrypt, encrypt } from "./crypto-utils";
import { getDb } from "../db";
import { cofreCredenciais, cofreSessoes } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("cofre-helpers");

export interface CredencialDecriptada {
  id: number;
  escritorioId: number;
  sistema: string;
  apelido: string;
  username: string;
  password: string;
  totpSecret: string | null;
  status: string;
}

/**
 * Busca credencial pelo ID, decripta todos os campos sensíveis.
 *
 * Retorna null se a credencial não existe ou está marcada como
 * `removida`. Lança erro se algum campo encriptado estiver corrompido
 * (provável regressão de schema ou tentativa de uso em ambiente sem
 * a chave de criptografia correta).
 */
export async function buscarCredencialDecriptada(
  id: number,
): Promise<CredencialDecriptada | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(cofreCredenciais)
    .where(eq(cofreCredenciais.id, id))
    .limit(1);

  if (!row || row.status === "removida") return null;

  const username = decrypt(row.usernameEnc, row.usernameIv, row.usernameTag);
  const password = decrypt(row.passwordEnc, row.passwordIv, row.passwordTag);
  const totpSecret =
    row.totpSecretEnc && row.totpSecretIv && row.totpSecretTag
      ? decrypt(row.totpSecretEnc, row.totpSecretIv, row.totpSecretTag)
      : null;

  return {
    id: row.id,
    escritorioId: row.escritorioId,
    sistema: row.sistema,
    apelido: row.apelido,
    username,
    password,
    totpSecret,
    status: row.status,
  };
}

/**
 * Gera o código TOTP de 6 dígitos atual a partir do secret base32.
 *
 * Configuração padrão do otplib (algorithm=SHA1, digits=6, step=30s) bate
 * com a maioria dos tribunais e com Google Authenticator/Authy.
 *
 * Retorna string sempre com 6 dígitos (zero-padded), ex: "012345".
 */
export function gerarCodigoTotp(secret: string): string {
  // Limpa whitespace e converte pra uppercase pra robustez (alguns
  // tribunais exibem o secret com espaços a cada 4 chars).
  const secretLimpo = secret.replace(/\s+/g, "").toUpperCase();
  return authenticator.generate(secretLimpo);
}

/**
 * Atualiza status da credencial após tentativa de login.
 *
 * Sucesso → status="ativa", limpa erro, marca timestamp.
 * Falha → status="erro", grava mensagem técnica.
 *
 * Em ambos os casos, atualiza ultimoLoginTentativaEm pra dashboard de saúde.
 */
export async function atualizarStatusAposLogin(
  id: number,
  resultado: { ok: boolean; mensagemErro?: string | null },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const agora = new Date();

  if (resultado.ok) {
    await db
      .update(cofreCredenciais)
      .set({
        status: "ativa",
        ultimoLoginSucessoEm: agora,
        ultimoLoginTentativaEm: agora,
        ultimoErro: null,
      })
      .where(eq(cofreCredenciais.id, id));
    log.info({ credencialId: id }, "[cofre] credencial validada com sucesso");
  } else {
    await db
      .update(cofreCredenciais)
      .set({
        status: "erro",
        ultimoLoginTentativaEm: agora,
        ultimoErro: resultado.mensagemErro?.slice(0, 1000) ?? "Falha desconhecida no login",
      })
      .where(eq(cofreCredenciais.id, id));
    log.warn(
      { credencialId: id, erro: resultado.mensagemErro?.slice(0, 200) },
      "[cofre] login falhou — credencial marcada como erro",
    );
  }
}

/**
 * Salva sessão persistida (cookies + localStorage) pra evitar relogin
 * a cada raspagem. O Playwright fornece o `storageState` como objeto
 * JSON-serializable que inclui cookies e localStorage por origin.
 *
 * Substitui sessão anterior se já existir uma pra essa credencial —
 * evita acumular sessões expiradas.
 */
export async function salvarSessao(
  credencialId: number,
  storageStateJson: string,
  expiraEmEstimado?: Date,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const enc = encrypt(storageStateJson);
  const agora = new Date();

  // Apaga sessões anteriores da mesma credencial — política mais simples
  // e evita lookup confuso ("qual a mais recente?"). Quando precisar de
  // múltiplas sessões simultâneas (ex: desktop + mobile), revisar.
  await db.delete(cofreSessoes).where(eq(cofreSessoes.credencialId, credencialId));

  await db.insert(cofreSessoes).values({
    credencialId,
    cookiesEnc: enc.encrypted,
    cookiesIv: enc.iv,
    cookiesTag: enc.tag,
    capturadoEm: agora,
    expiraEmEstimado: expiraEmEstimado ?? null,
    ultimoUsoEm: agora,
  });

  log.info(
    { credencialId, expiraEm: expiraEmEstimado?.toISOString() ?? "sem prazo" },
    "[cofre] sessão salva",
  );
}

/**
 * Recupera sessão salva (decriptada) ou null se não existe / expirada.
 *
 * Atualiza `ultimoUsoEm` pra que o dashboard de saúde mostre quando a
 * sessão foi efetivamente usada (vs. só capturada).
 */
export async function recuperarSessao(credencialId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(cofreSessoes)
    .where(eq(cofreSessoes.credencialId, credencialId))
    .limit(1);

  if (!row) return null;

  // Se sessão tem prazo estimado e já passou, deleta e retorna null —
  // evita usar cookies expirados que vão dar erro 401 no tribunal.
  if (row.expiraEmEstimado && new Date(row.expiraEmEstimado) < new Date()) {
    await db.delete(cofreSessoes).where(eq(cofreSessoes.id, row.id));
    log.info({ credencialId }, "[cofre] sessão expirada removida");
    return null;
  }

  try {
    const json = decrypt(row.cookiesEnc, row.cookiesIv, row.cookiesTag);
    await db
      .update(cofreSessoes)
      .set({ ultimoUsoEm: new Date() })
      .where(eq(cofreSessoes.id, row.id));
    return json;
  } catch (err) {
    log.error(
      { credencialId, err: err instanceof Error ? err.message : String(err) },
      "[cofre] falha ao decriptar sessão — possível mudança de ENCRYPTION_KEY",
    );
    return null;
  }
}
