/**
 * Funções de acesso ao banco — Canais de Integração
 * Fase 2
 */

import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../db";
import { canaisIntegrados, integracaoAuditLog } from "../../drizzle/schema";
import { encryptConfig, decryptConfig, maskToken, generateWebhookSecret } from "./crypto-utils";
import type { TipoCanal, StatusCanal } from "../../shared/canal-types";

// ─── Canais ──────────────────────────────────────────────────────────────────

/** Lista canais do escritório (sem dados sensíveis). Apenas leitura —
 *  nenhum efeito colateral destrutivo. Canais órfãos whatsapp_api sem
 *  telefone são FILTRADOS do retorno (não aparecem na UI) mas
 *  permanecem no banco para evitar corrida com o fluxo de Embedded
 *  Signup que pode estar preenchendo o telefone em paralelo. O cleanup
 *  definitivo desses resíduos vive em `removerCanaisOrfaos`, chamado
 *  explicitamente por operação admin ou cron.
 */
export async function listarCanais(escritorioId: number) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db.select()
    .from(canaisIntegrados)
    .where(eq(canaisIntegrados.escritorioId, escritorioId))
    .orderBy(desc(canaisIntegrados.createdAt));

  // Filtra órfãos da apresentação sem deletar. Se o usuário está no meio
  // de um Embedded Signup e o telefone ainda não foi gravado, o registro
  // simplesmente não aparece até que o fluxo finalize.
  const ocultarOrfao = (r: (typeof rows)[number]) =>
    r.tipo === "whatsapp_api" && (!r.telefone || r.telefone === "");

  return rows
    .filter((r) => !ocultarOrfao(r))
    .map((r) => ({
      id: r.id,
      escritorioId: r.escritorioId,
      tipo: r.tipo as TipoCanal,
      nome: r.nome || "",
      status: r.status as StatusCanal,
      telefone: r.telefone || undefined,
      ultimaSync: r.ultimaSync ? (r.ultimaSync as Date).toISOString() : undefined,
      mensagemErro: r.mensagemErro || undefined,
      temConfig: !!(r.configEncrypted && r.configIv && r.configTag),
      createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
    }));
}

/** Remove canais whatsapp_api órfãos (sem telefone) de um escritório.
 *  Executado explicitamente — não é chamado pela query de listagem.
 *  Devolve a quantidade de linhas removidas para diagnóstico.
 */
export async function removerCanaisOrfaos(escritorioId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const todos = await db
    .select({ id: canaisIntegrados.id, tipo: canaisIntegrados.tipo, telefone: canaisIntegrados.telefone })
    .from(canaisIntegrados)
    .where(eq(canaisIntegrados.escritorioId, escritorioId));

  const orfaosIds = todos
    .filter((c) => c.tipo === "whatsapp_api" && (!c.telefone || c.telefone === ""))
    .map((c) => c.id);

  let removidos = 0;
  for (const id of orfaosIds) {
    try {
      await db.delete(canaisIntegrados).where(eq(canaisIntegrados.id, id));
      removidos++;
    } catch {
      /* best-effort */
    }
  }
  return removidos;
}

/** Cria um novo canal */
export async function criarCanal(dados: {
  escritorioId: number;
  tipo: TipoCanal;
  nome: string;
  telefone?: string;
  config?: Record<string, any>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  let configEncrypted: string | null = null;
  let configIv: string | null = null;
  let configTag: string | null = null;

  if (dados.config && Object.keys(dados.config).length > 0) {
    const enc = encryptConfig(dados.config);
    configEncrypted = enc.encrypted;
    configIv = enc.iv;
    configTag = enc.tag;
  }

  const webhookSecret = generateWebhookSecret();

  const [result] = await db.insert(canaisIntegrados).values({
    escritorioId: dados.escritorioId,
    tipo: dados.tipo,
    nome: dados.nome || null,
    telefone: dados.telefone || null,
    configEncrypted,
    configIv,
    configTag,
    webhookSecret,
    status: dados.config ? "conectado" : "desconectado",
  });

  return (result as { insertId: number }).insertId;
}

/** Atualiza configuração do canal (criptografa novos dados) */
export async function atualizarConfigCanal(
  canalId: number,
  escritorioId: number,
  config: Record<string, any>,
  telefone?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const enc = encryptConfig(config);

  const updateData: Record<string, unknown> = {
    configEncrypted: enc.encrypted,
    configIv: enc.iv,
    configTag: enc.tag,
    status: "conectado",
  };

  if (telefone !== undefined) updateData.telefone = telefone || null;

  await db.update(canaisIntegrados)
    .set(updateData)
    .where(and(eq(canaisIntegrados.id, canalId), eq(canaisIntegrados.escritorioId, escritorioId)));
}

/** Obtém configuração decriptada (apenas para uso interno do servidor) */
export async function obterConfigCanal(canalId: number, escritorioId: number): Promise<Record<string, any> | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db.select()
    .from(canaisIntegrados)
    .where(and(eq(canaisIntegrados.id, canalId), eq(canaisIntegrados.escritorioId, escritorioId)))
    .limit(1);

  if (!row || !row.configEncrypted || !row.configIv || !row.configTag) return null;

  try {
    return decryptConfig(row.configEncrypted, row.configIv, row.configTag);
  } catch {
    return null;
  }
}

/** Obtém config mascarada (para exibição no frontend) */
export async function obterConfigMascarada(canalId: number, escritorioId: number): Promise<Record<string, string> | null> {
  const config = await obterConfigCanal(canalId, escritorioId);
  if (!config) return null;

  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && value.length > 8) {
      masked[key] = maskToken(value);
    } else {
      masked[key] = "****";
    }
  }
  return masked;
}

/** Lê o texto fixo de auto-reply do canal (fallback quando SmartFlow não responde).
 *  Usado pelo handler do WhatsApp a cada mensagem recebida sem cenário SmartFlow,
 *  então evite trabalho pesado aqui — é só um SELECT simples. */
export async function obterAutoReplyCanal(canalId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select({ autoReply: canaisIntegrados.autoReplyFallback })
    .from(canaisIntegrados)
    .where(eq(canaisIntegrados.id, canalId))
    .limit(1);

  const texto = row?.autoReply?.trim();
  return texto || null;
}

/** Atualiza o auto-reply do canal. Texto vazio/null desativa o envio automático. */
export async function atualizarAutoReplyCanal(
  canalId: number,
  escritorioId: number,
  texto: string | null,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const limpo = texto?.trim() || "";
  const valor = limpo ? limpo.slice(0, 500) : null;

  await db
    .update(canaisIntegrados)
    .set({ autoReplyFallback: valor })
    .where(and(eq(canaisIntegrados.id, canalId), eq(canaisIntegrados.escritorioId, escritorioId)));
}

/** Atualiza status do canal */
export async function atualizarStatusCanal(
  canalId: number,
  escritorioId: number,
  status: StatusCanal,
  mensagemErro?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const updateData: Record<string, unknown> = { status };
  if (mensagemErro !== undefined) updateData.mensagemErro = mensagemErro || null;
  if (status === "conectado") updateData.ultimaSync = new Date();

  await db.update(canaisIntegrados)
    .set(updateData)
    .where(and(eq(canaisIntegrados.id, canalId), eq(canaisIntegrados.escritorioId, escritorioId)));
}

/** Exclui canal */
export async function excluirCanal(canalId: number, escritorioId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  await db.delete(canaisIntegrados)
    .where(and(eq(canaisIntegrados.id, canalId), eq(canaisIntegrados.escritorioId, escritorioId)));
}

/** Conta canais por tipo (para verificar limite do plano) */
export async function contarCanaisPorTipo(escritorioId: number): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};

  const rows = await db.select()
    .from(canaisIntegrados)
    .where(eq(canaisIntegrados.escritorioId, escritorioId));

  const contagem: Record<string, number> = {};
  for (const r of rows) {
    const tipo = r.tipo as string;
    const isWhatsapp = tipo === "whatsapp_qr" || tipo === "whatsapp_api";
    const key = isWhatsapp ? "whatsapp" : tipo;
    contagem[key] = (contagem[key] || 0) + 1;
  }
  return contagem;
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

export async function registrarAudit(dados: {
  escritorioId: number;
  colaboradorId: number;
  canalId?: number;
  acao: "conectou" | "desconectou" | "editou_config" | "testou" | "erro";
  detalhes?: string;
  ip?: string;
}) {
  const db = await getDb();
  if (!db) return;

  await db.insert(integracaoAuditLog).values({
    escritorioId: dados.escritorioId,
    colaboradorId: dados.colaboradorId,
    canalId: dados.canalId ?? null,
    acao: dados.acao,
    detalhes: dados.detalhes || null,
    ip: dados.ip || null,
  });
}

export async function listarAuditLog(escritorioId: number, limite = 20) {
  const db = await getDb();
  if (!db) return [];

  return db.select()
    .from(integracaoAuditLog)
    .where(eq(integracaoAuditLog.escritorioId, escritorioId))
    .orderBy(desc(integracaoAuditLog.createdAt))
    .limit(limite);
}
