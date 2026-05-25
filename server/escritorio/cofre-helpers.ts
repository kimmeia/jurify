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
 *
 * Quando `tentarRelogin=true` e a sessão expirou, tenta refazer o
 * login automaticamente (hoje só PJe TJCE, único adapter implementado).
 * Útil pra fluxos onde o usuário está esperando — em vez de devolver
 * null e exigir "vá em Cofre → Validar", o sistema renova a sessão
 * sozinho. Cofre+adapter precisa: senha + 2FA conhecidos. Se a credencial
 * tem 2FA externo (TOTP secret salvo), funciona; se não tem, falha
 * silenciosamente e devolve null como antes.
 */
export async function recuperarSessao(
  credencialId: number,
  options: { tentarRelogin?: boolean; forcarRelogin?: boolean } = {},
): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(cofreSessoes)
    .where(eq(cofreSessoes.credencialId, credencialId))
    .limit(1);

  // Sessão presente e não expirada — caminho feliz (a menos que forcarRelogin,
  // usado quando a consulta bateu numa sessão morta no PDPJ apesar da estimativa).
  if (!options.forcarRelogin && row && (!row.expiraEmEstimado || new Date(row.expiraEmEstimado) >= new Date())) {
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

  // Sessão expirada — remove e (opcional) tenta relogin
  if (row) {
    await db.delete(cofreSessoes).where(eq(cofreSessoes.id, row.id));
    log.info({ credencialId }, "[cofre] sessão expirada removida");
  }

  if (!options.tentarRelogin) return null;

  return await tentarReloginAutomatico(credencialId);
}

/**
 * Tenta relogin automático pra renovar sessão expirada.
 *
 * Só funciona pra PJe TJCE hoje (único adapter). Se sucesso, salva nova
 * sessão e marca credencial como "ativa". Se falha, marca "expirada" pra
 * UI sinalizar que precisa de ação manual.
 */
// Dedup de relogin concorrente por credencial: quando vários polls da MESMA
// credencial detectam a sessão caída ao mesmo tempo (ex: "Atualizar todos" com
// 9 processos), só UM faz o login real; os outros aguardam e reusam a sessão
// nova. Evita logins simultâneos no PDPJ (rate-limit / códigos 2FA colidindo).
const reloginEmAndamento = new Map<number, Promise<string | null>>();

function tentarReloginAutomatico(credencialId: number): Promise<string | null> {
  const emAndamento = reloginEmAndamento.get(credencialId);
  if (emAndamento) return emAndamento;
  const promessa = tentarReloginAutomaticoImpl(credencialId).finally(() => {
    reloginEmAndamento.delete(credencialId);
  });
  reloginEmAndamento.set(credencialId, promessa);
  return promessa;
}

async function tentarReloginAutomaticoImpl(credencialId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const [cred] = await db
    .select()
    .from(cofreCredenciais)
    .where(eq(cofreCredenciais.id, credencialId))
    .limit(1);
  if (!cred) return null;

  // Hoje só PJe TJCE tem adapter de testarLogin
  if (cred.sistema !== "pje_tjce") {
    log.info(
      { credencialId, sistema: cred.sistema },
      "[cofre] relogin automático não disponível pra esse sistema",
    );
    return null;
  }

  try {
    const decriptada = await buscarCredencialDecriptada(credencialId);
    if (!decriptada) {
      await marcarCredencialExpirada(credencialId, "Credencial não pôde ser decriptada");
      return null;
    }

    const { PjeTjceScraper } = await import(
      "../../scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce"
    );
    const scraper = new PjeTjceScraper({
      username: decriptada.username,
      password: decriptada.password,
      totpSecret: decriptada.totpSecret,
    });

    const resultado = await scraper.testarLogin();

    if (resultado.ok && resultado.storageStateJson) {
      const expira = new Date(Date.now() + 90 * 60 * 1000);
      await salvarSessao(credencialId, resultado.storageStateJson, expira);
      await atualizarStatusAposLogin(credencialId, { ok: true });
      log.info({ credencialId }, "[cofre] relogin automático sucesso — sessão renovada");
      return resultado.storageStateJson;
    }

    await marcarCredencialExpirada(
      credencialId,
      `${resultado.mensagem}${resultado.detalhes ? ` (${resultado.detalhes})` : ""}`,
    );
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ credencialId, err: msg }, "[cofre] relogin automático crashed");
    await marcarCredencialExpirada(credencialId, `Erro técnico: ${msg.slice(0, 200)}`);
    return null;
  }
}

/**
 * Marca uma credencial como "expirada" no DB.
 *
 * Diferente de `status="erro"` (login validado falhou), `expirada` é
 * usado quando a sessão estava ativa mas caiu durante uso (cookies
 * expiraram, tribunal forçou relogin, etc). UI mostra com mesma cor
 * vermelha que erro, mas mensagem distinta convidando a renovar.
 *
 * Além de mudar o status, dispara notificação in-app (sino + SSE) pra
 * o dono da credencial — sem isso, o user só descobre que a credencial
 * caiu na próxima vez que tenta consultar (e fica achando que o sistema
 * está quebrado). Notificação é best-effort: falhas logam mas não bloqueiam
 * o UPDATE de status.
 */
export async function marcarCredencialExpirada(
  credencialId: number,
  motivo: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Captura estado anterior pra decidir se gera notificação. Quando a
  // credencial já estava "expirada" ou "erro", uma segunda detecção é
  // ruído (cron + consulta detectam quase simultaneamente). Só notifica
  // em transição de "saudável" pra "caída".
  const [anterior] = await db
    .select({
      status: cofreCredenciais.status,
      apelido: cofreCredenciais.apelido,
      sistema: cofreCredenciais.sistema,
      criadoPor: cofreCredenciais.criadoPor,
    })
    .from(cofreCredenciais)
    .where(eq(cofreCredenciais.id, credencialId))
    .limit(1);

  await db
    .update(cofreCredenciais)
    .set({
      status: "expirada",
      ultimoLoginTentativaEm: new Date(),
      ultimoErro: motivo.slice(0, 1000),
    })
    .where(eq(cofreCredenciais.id, credencialId));
  log.warn({ credencialId, motivo: motivo.slice(0, 200) }, "[cofre] credencial marcada como expirada");

  if (anterior && (anterior.status === "ativa" || anterior.status === "validando")) {
    await notificarCredencialCaiu({
      credencialId,
      userId: anterior.criadoPor,
      apelido: anterior.apelido,
      sistema: anterior.sistema,
      motivo,
      novoStatus: "expirada",
    });
  }
}

/**
 * Notifica o dono da credencial que ela caiu (status "expirada" ou "erro").
 *
 * Persiste em `notificacoes` (sino do app) E emite SSE (toast em tempo real
 * + invalida cache de credenciais no frontend). Resiliente: falhas são
 * logadas mas não propagam — manter o caller (cron/runner) seguindo seu
 * fluxo importa mais que notificar 100% das vezes.
 */
export async function notificarCredencialCaiu(params: {
  credencialId: number;
  userId: number;
  apelido: string;
  sistema: string;
  motivo: string;
  novoStatus: "expirada" | "erro";
}): Promise<void> {
  try {
    const { notificacoes } = await import("../../drizzle/schema");
    const { emitirNotificacao } = await import("../_core/sse-notifications");
    const db = await getDb();
    const titulo =
      params.novoStatus === "expirada"
        ? `Credencial ${params.apelido} caiu — sessão expirou`
        : `Credencial ${params.apelido} com erro de login`;
    const mensagem = `${params.motivo.slice(0, 240)}${
      params.motivo.length > 240 ? "…" : ""
    } — vá em Processos → Cofre pra revalidar.`;
    if (db) {
      await db.insert(notificacoes).values({
        userId: params.userId,
        titulo,
        mensagem,
        tipo: "sistema",
      });
    }
    emitirNotificacao(params.userId, {
      tipo: "credencial_erro",
      titulo,
      mensagem,
      dados: {
        credencialId: params.credencialId,
        sistema: params.sistema,
        novoStatus: params.novoStatus,
      },
    });
  } catch (err) {
    log.error(
      { credencialId: params.credencialId, err: err instanceof Error ? err.message : String(err) },
      "[cofre] notificarCredencialCaiu falhou (best-effort)",
    );
  }
}

/**
 * Notifica o dono da credencial que ela voltou a funcionar após estar
 * "expirada" ou "erro". Usado pelo cron de revalidação quando consegue
 * recuperar sessão automaticamente — fecha o loop do user (vê "caiu" →
 * vê "voltou" sem precisar checar manualmente).
 */
export async function notificarCredencialRecuperada(params: {
  credencialId: number;
  userId: number;
  apelido: string;
  sistema: string;
}): Promise<void> {
  try {
    const { notificacoes } = await import("../../drizzle/schema");
    const { emitirNotificacao } = await import("../_core/sse-notifications");
    const db = await getDb();
    const titulo = `Credencial ${params.apelido} reconectada`;
    const mensagem = `O sistema renovou a sessão automaticamente — o monitoramento voltou a funcionar.`;
    if (db) {
      await db.insert(notificacoes).values({
        userId: params.userId,
        titulo,
        mensagem,
        tipo: "sistema",
      });
    }
    emitirNotificacao(params.userId, {
      tipo: "credencial_recuperada",
      titulo,
      mensagem,
      dados: { credencialId: params.credencialId, sistema: params.sistema },
    });
  } catch (err) {
    log.error(
      { credencialId: params.credencialId, err: err instanceof Error ? err.message : String(err) },
      "[cofre] notificarCredencialRecuperada falhou (best-effort)",
    );
  }
}

// `buscarCredencialDecriptada` é definida mais abaixo no arquivo
