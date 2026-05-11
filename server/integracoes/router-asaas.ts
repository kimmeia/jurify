/**
 * Router tRPC — Asaas (Cobranças por Escritório)
 *
 * Cada escritório conecta sua própria API key do Asaas.
 * protectedProcedure: todas as rotas exigem login + escritório.
 *
 * Funcionalidades:
 * - Conectar/desconectar API key
 * - Sincronizar clientes Asaas ↔ contatos CRM (por CPF/CNPJ)
 * - Criar cobranças (boleto, Pix, cartão)
 * - Resumo financeiro por contato
 * - Listar cobranças com filtros
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { asaasConfig, asaasClientes, asaasCobrancas, asaasConfigCobrancaPai, clienteProcessos, cobrancaAcoes, colaboradores, contatos, users } from "../../drizzle/schema";
import { eq, and, desc, like, or, inArray, between, gte, lte, sql, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { encrypt, decrypt, generateWebhookSecret, maskToken } from "../escritorio/crypto-utils";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { AsaasClient, type AsaasCustomer } from "./asaas-client";
import { calcularParcelas } from "./parcelamento-local";
import {
  syncCobrancasDeCliente,
  syncCobrancasEscritorio,
  syncTodasCobrancasDoContato,
  atualizarCobrancasLocaisDoEscritorio,
  agregarVinculosPorContato,
  type VinculoLinha,
  type CobrancaAgg,
  type ContatoMeta,
} from "./asaas-sync";
import {
  garantirCategoriaDespesaTaxasAsaas,
  garantirCategoriaCobrancaServicosAsaas,
} from "./asaas-despesas-auto";
import { checkPermission } from "../escritorio/check-permission";
import { createLogger } from "../_core/logger";

/** Helper: retorna IDs dos contatos visíveis ao colaborador atual.
 *  Se ele tem verTodos no módulo "financeiro" → null (sem filtro).
 *  Se só verProprios → array de contatoIds onde responsavelId = colabId.
 *  Se não tem nenhum acesso → array vazio (nada visível).
 */
async function contatosVisiveisFinanceiro(
  userId: number,
  escritorioId: number,
): Promise<number[] | null> {
  const perm = await checkPermission(userId, "financeiro", "ver");
  if (perm.verTodos) return null;
  if (!perm.verProprios) return [];

  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({ id: contatos.id })
    .from(contatos)
    .where(and(
      eq(contatos.escritorioId, escritorioId),
      eq(contatos.responsavelId, perm.colaboradorId),
    ));
  return rows.map((r) => r.id);
}
const log = createLogger("integracoes-router-asaas");

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function requireEscritorio(userId: number) {
  const result = await getEscritorioPorUsuario(userId);
  if (!result) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Você precisa de um escritório para usar cobranças." });
  }
  return result;
}

/**
 * Valida que os `processoIds` informados existem, pertencem ao escritório
 * e ao mesmo contato. Retorna os IDs validados (filtra duplicatas/inválidos
 * silenciosamente — não lança, pra não bloquear cobrança por erro de UX).
 *
 * Uso: chamado em `criarCobranca`/`criarParcelamento` antes de inserir
 * vínculos em `cobranca_acoes`.
 */
async function validarProcessoIds(
  escritorioId: number,
  contatoId: number,
  processoIds: number[] | undefined,
): Promise<number[]> {
  if (!processoIds || processoIds.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  const unicos = Array.from(new Set(processoIds.filter((n) => Number.isInteger(n) && n > 0)));
  if (unicos.length === 0) return [];

  const rows = await db
    .select({ id: clienteProcessos.id })
    .from(clienteProcessos)
    .where(
      and(
        inArray(clienteProcessos.id, unicos),
        eq(clienteProcessos.escritorioId, escritorioId),
        eq(clienteProcessos.contatoId, contatoId),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Insere os vínculos cobrança ↔ ações em `cobranca_acoes`. Idempotente
 * (PRIMARY KEY composta evita duplicatas — usa INSERT IGNORE).
 */
async function vincularCobrancaAcoes(
  cobrancaId: number,
  processoIds: number[],
): Promise<void> {
  if (processoIds.length === 0) return;
  const db = await getDb();
  if (!db) return;
  // INSERT individual com try/catch — drizzle não tem onConflictDoNothing
  // pra MySQL, então toleramos erro de duplicate key silenciosamente.
  for (const processoId of processoIds) {
    try {
      await db.insert(cobrancaAcoes).values({ cobrancaId, processoId });
    } catch (err: any) {
      if (!/duplicate|primary key/i.test(err?.message || "")) {
        log.warn(
          { err: err.message, cobrancaId, processoId },
          "[cobrancaAcoes] falha ao vincular (não-fatal)",
        );
      }
    }
  }
}

/**
 * Valida que o atendente pertence ao escritório, está ativo e retorna o nome
 * (do `users.name`) — usado para preencher `groupName` no Asaas.
 * Lança TRPCError se inválido.
 */
async function validarAtendente(escritorioId: number, atendenteId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  const [row] = await db
    .select({ nome: users.name, ativo: colaboradores.ativo })
    .from(colaboradores)
    .innerJoin(users, eq(users.id, colaboradores.userId))
    .where(
      and(
        eq(colaboradores.id, atendenteId),
        eq(colaboradores.escritorioId, escritorioId),
      ),
    )
    .limit(1);
  if (!row || !row.ativo) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Atendente inválido ou inativo.",
    });
  }
  return { nome: row.nome };
}

export async function getAsaasClient(escritorioId: number): Promise<AsaasClient | null> {
  const db = await getDb();
  if (!db) return null;

  const [cfg] = await db.select().from(asaasConfig)
    .where(and(eq(asaasConfig.escritorioId, escritorioId), eq(asaasConfig.status, "conectado")))
    .limit(1);

  if (!cfg || !cfg.apiKeyEncrypted || !cfg.apiKeyIv || !cfg.apiKeyTag) return null;

  try {
    const apiKey = decrypt(cfg.apiKeyEncrypted, cfg.apiKeyIv, cfg.apiKeyTag);
    return new AsaasClient(apiKey, cfg.modo as any);
  } catch {
    return null;
  }
}

async function requireAsaasClient(escritorioId: number) {
  const client = await getAsaasClient(escritorioId);
  if (!client) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Asaas não conectado. Vá em Configurações e conecte sua API key.",
    });
  }
  return client;
}

/**
 * Dado um conjunto de ids de customers do Asaas, devolve o subconjunto
 * que AINDA NÃO está vinculado a nenhum contato do escritório. Usamos
 * tanto no fluxo por telefone (buscar duplicatas que podem ser reusadas)
 * quanto no por CPF (filtrar customers que pertencem a outro contato).
 */
async function filtrarCustomersDisponiveis(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
  asaasCustomerIds: string[],
): Promise<Set<string>> {
  if (asaasCustomerIds.length === 0) return new Set();

  const jaLinkados = await db
    .select({ asaasCustomerId: asaasClientes.asaasCustomerId })
    .from(asaasClientes)
    .where(and(
      eq(asaasClientes.escritorioId, escritorioId),
      inArray(asaasClientes.asaasCustomerId, asaasCustomerIds),
    ));

  const linkadosSet = new Set(jaLinkados.map((r) => r.asaasCustomerId));
  return new Set(asaasCustomerIds.filter((id) => !linkadosSet.has(id)));
}

/**
 * Recebe N customers do Asaas com o mesmo CPF e decide:
 *  - qual vira primário (usado pra criar cobranças novas).
 *  - quais viram secundários (mantidos para o histórico de cobranças).
 *
 * Heurística: prioriza o customer com MAIS cobranças não-deletadas (quem
 * tem histórico real); secundários só são mantidos se também tiverem
 * cobranças (não polui a tabela com customers "vazios"). Se nenhum tiver
 * cobranças, usa o primeiro e descarta os demais.
 *
 * Best-effort: uma falha na contagem por customer não aborta o fluxo.
 */
async function escolherPrimarioEhSecundarios(
  client: AsaasClient,
  customers: AsaasCustomer[],
): Promise<{ primario: AsaasCustomer; secundarios: AsaasCustomer[] }> {
  if (customers.length === 1) {
    return { primario: customers[0], secundarios: [] };
  }

  const contagens: { cli: AsaasCustomer; total: number }[] = [];
  for (const cli of customers) {
    try {
      const res = await client.listarCobrancas({ customer: cli.id, limit: 100 });
      // totalCount é confiável quando vem; senão, conta o que caiu.
      const total = typeof res.totalCount === "number" ? res.totalCount : res.data.length;
      contagens.push({ cli, total });
    } catch (err: any) {
      log.warn(
        { err: err.message, asaasCustomerId: cli.id },
        "Falha ao contar cobranças do customer duplicado — assumindo 0",
      );
      contagens.push({ cli, total: 0 });
    }
  }

  contagens.sort((a, b) => b.total - a.total);
  const primario = contagens[0].cli;
  const secundarios = contagens
    .slice(1)
    .filter((c) => c.total > 0)
    .map((c) => c.cli);

  return { primario, secundarios };
}

/**
 * Resultado do sync de cobranças que acompanha a conclusão da vinculação.
 * `erroSync` é null quando tudo OK e string quando a API do Asaas falhou —
 * permite o frontend distinguir "sem cobranças" (0 + null) de "falhou" (0 + msg).
 */
type SyncResult = {
  cobrancasSincronizadas: number;
  erroSync: string | null;
};

/**
 * Fecha o ciclo de vinculação: escreve no CRM (contatos) o que veio do
 * Asaas como fonte de verdade, grava o vínculo principal + eventuais
 * vínculos secundários (duplicatas do Asaas com mesmo CPF) e sincroniza
 * cobranças de todos eles no mesmo contato do CRM.
 *
 * Nome/CPF/email/telefone do Asaas têm precedência; se algum campo faltar
 * no Asaas, o valor atual do CRM é preservado (fallback com ||).
 *
 * Secundários recebem `primario=false` e servem só para puxar histórico;
 * cobranças novas sempre saem do primário (ver criarCobranca).
 *
 * O sync de cobranças é best-effort: uma falha aqui não bloqueia o vínculo,
 * mas é reportada de volta no `erroSync` do retorno pra UI poder alertar.
 */
async function finalizarVinculacao(
  client: AsaasClient,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
  contatoId: number,
  contato: { nome: string; cpfCnpj: string | null; email: string | null; telefone: string | null },
  asaasCli: AsaasCustomer,
  cpfLimpo: string,
  secundarios: AsaasCustomer[] = [],
): Promise<SyncResult> {
  await db.update(contatos).set({
    nome: asaasCli.name || contato.nome,
    cpfCnpj: (asaasCli.cpfCnpj || cpfLimpo).replace(/\D/g, ""),
    email: asaasCli.email || contato.email,
    telefone: asaasCli.mobilePhone || asaasCli.phone || contato.telefone,
  }).where(and(
    eq(contatos.id, contatoId),
    eq(contatos.escritorioId, escritorioId),
  ));

  await db.insert(asaasClientes).values({
    escritorioId,
    contatoId,
    asaasCustomerId: asaasCli.id,
    cpfCnpj: cpfLimpo,
    nome: asaasCli.name,
    primario: true,
  });

  for (const sec of secundarios) {
    if (sec.id === asaasCli.id) continue;
    await db.insert(asaasClientes).values({
      escritorioId,
      contatoId,
      asaasCustomerId: sec.id,
      cpfCnpj: (sec.cpfCnpj || cpfLimpo).replace(/\D/g, ""),
      nome: sec.name,
      primario: false,
    });
  }

  try {
    const r = await syncTodasCobrancasDoContato(client, escritorioId, contatoId);
    return { cobrancasSincronizadas: r.novas + r.atualizadas, erroSync: null };
  } catch (err: any) {
    log.warn(
      { err: err.message, contatoId, asaasCustomerId: asaasCli.id },
      "Sync de cobranças após vincular falhou (não bloqueia o vínculo)",
    );
    return {
      cobrancasSincronizadas: 0,
      erroSync: err?.message || "Erro desconhecido ao sincronizar cobranças",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export const asaasRouter = router({
  // ─── STATUS / CONEXÃO ────────────────────────────────────────────────────

  /** Verifica se o Asaas está conectado para este escritório */
  status: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { conectado: false, modo: null, saldo: null, apiKeyPreview: null };

    const db = await getDb();
    if (!db) return { conectado: false, modo: null, saldo: null, apiKeyPreview: null };

    try {
      const [cfg] = await db.select().from(asaasConfig)
        .where(eq(asaasConfig.escritorioId, esc.escritorio.id))
        .limit(1);

      if (!cfg) return { conectado: false, modo: null, saldo: null, apiKeyPreview: null };

      let apiKeyPreview: string | null = null;
      if (cfg.apiKeyEncrypted && cfg.apiKeyIv && cfg.apiKeyTag) {
        try {
          const key = decrypt(cfg.apiKeyEncrypted, cfg.apiKeyIv, cfg.apiKeyTag);
          apiKeyPreview = maskToken(key, 6);
        } catch {}
      }

      return {
        conectado: cfg.status === "conectado",
        modo: cfg.modo,
        saldo: cfg.saldo,
        apiKeyPreview,
        status: cfg.status,
        mensagemErro: cfg.mensagemErro,
      };
    } catch {
      return { conectado: false, modo: null, saldo: null, apiKeyPreview: null };
    }
  }),

  /** Conecta o Asaas com a API key do escritório */
  conectar: protectedProcedure
    .input(z.object({ apiKey: z.string().min(10), webhookUrl: z.string().url().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Conectar/desconectar Asaas é configuração crítica do escritório
      // (afeta TODO o financeiro). Atendente/estagiário não entra aqui.
      const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
      if (!perm.editar) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para conectar a conta Asaas do escritório.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Testar a key
      const client = new AsaasClient(input.apiKey);
      const teste = await client.testarConexao();

      // Detecção de rate limit (429) — Asaas tem janela de 12h.
      // Em vez de falhar, salvamos a key com status="aguardando_validacao".
      // Cron `validarConexoesAsaasPendentes` retenta quando liberar.
      const isRateLimit =
        !teste.ok &&
        (/HTTP 429/i.test(teste.mensagem) ||
          /cota.*requisi[çc][õo]es|rate.?limit/i.test(teste.detalhes ?? ""));

      // 401 = chave inválida. NÃO salva — falha imediato.
      if (!teste.ok && !isRateLimit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: teste.mensagem + (teste.detalhes ? ` (${teste.detalhes})` : ""),
        });
      }

      // Criptografar
      const { encrypted, iv, tag } = encrypt(input.apiKey);
      const webhookToken = generateWebhookSecret();

      const novoStatus = isRateLimit ? ("aguardando_validacao" as const) : ("conectado" as const);
      const novaMsgErro = isRateLimit
        ? "rate_limit_429: Asaas em cota excedida (janela 12h). Validação automática em background."
        : null;

      // Upsert config
      const [existing] = await db.select().from(asaasConfig)
        .where(eq(asaasConfig.escritorioId, esc.escritorio.id)).limit(1);

      if (existing) {
        await db.update(asaasConfig).set({
          apiKeyEncrypted: encrypted,
          apiKeyIv: iv,
          apiKeyTag: tag,
          modo: client.modo,
          status: novoStatus,
          webhookToken,
          ultimoTeste: new Date(),
          mensagemErro: novaMsgErro,
          saldo: teste.saldo?.toString() || null,
        }).where(eq(asaasConfig.id, existing.id));
      } else {
        await db.insert(asaasConfig).values({
          escritorioId: esc.escritorio.id,
          apiKeyEncrypted: encrypted,
          apiKeyIv: iv,
          apiKeyTag: tag,
          modo: client.modo,
          status: novoStatus,
          webhookToken,
          ultimoTeste: new Date(),
          mensagemErro: novaMsgErro,
          saldo: teste.saldo?.toString() || null,
        });
      }

      // Se rate-limited, retorna sucesso com aviso (frontend mostra
      // mensagem amigável). Webhook só registra quando validar.
      if (isRateLimit) {
        return {
          success: true,
          modo: client.modo,
          saldo: null,
          webhookRegistrado: false,
          webhookErro: null,
          aguardandoValidacao: true,
          mensagem:
            "Sua chave foi salva, mas o Asaas está em cota excedida (rate limit 12h). " +
            "Vamos validar automaticamente em background. Status atualiza pra \"conectado\" quando liberar.",
        };
      }

      // Auto-criar categorias padrão. Quando o escritório conecta o Asaas
      // pela primeira vez, criamos:
      //  - "Taxas Asaas" (despesas) — usada pelo webhook pra registrar
      //    automaticamente a taxa de cada cobrança paga
      //  - "Serviços jurídicos" (cobranças) — categoria default opcional
      //    pra cobranças vindas do passado/webhook sem categoria
      // Idempotente: chamadas seguintes não criam duplicatas.
      await garantirCategoriaDespesaTaxasAsaas(esc.escritorio.id);
      await garantirCategoriaCobrancaServicosAsaas(esc.escritorio.id);

      // Auto-registrar webhook no Asaas
      let webhookRegistrado = false;
      let webhookErro: string | null = null;
      if (input.webhookUrl) {
        try {
          const fullWebhookUrl = `${input.webhookUrl.replace(/\/$/, "")}/api/webhooks/asaas`;
          // Asaas exige email obrigatorio - usar o email do usuario logado
          const [userRow] = await db.select({ email: users.email }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
          const email = userRow?.email || "noreply@calcsaas.app";
          await client.configurarWebhook(fullWebhookUrl, webhookToken, email);
          webhookRegistrado = true;
          log.info(`[Asaas] Webhook auto-registrado: ${fullWebhookUrl}`);
        } catch (err: any) {
          webhookErro = err.response?.data?.errors?.[0]?.description || err.message || "Erro desconhecido";
          log.warn(`[Asaas] Falha ao auto-registrar webhook: ${webhookErro}`);
        }
      }

      return {
        success: true,
        modo: client.modo,
        saldo: teste.saldo,
        webhookRegistrado,
        webhookErro,
        mensagem: `Conectado ao Asaas (${client.modo === "sandbox" ? "Sandbox" : "Produção"})${webhookRegistrado ? " — webhook ativo" : webhookErro ? ` — webhook: ${webhookErro}` : ""}`,
      };
    }),

  /** Desconecta o Asaas */
  /** Re-registra o webhook no Asaas (para conexões existentes que não tinham webhook) */
  reconfigurarWebhook: protectedProcedure
    .input(z.object({ webhookUrl: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
      if (!perm.editar) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para reconfigurar o webhook Asaas.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cfg] = await db.select().from(asaasConfig)
        .where(eq(asaasConfig.escritorioId, esc.escritorio.id)).limit(1);
      if (!cfg) throw new TRPCError({ code: "NOT_FOUND", message: "Asaas não conectado" });

      const fullWebhookUrl = `${input.webhookUrl.replace(/\/$/, "")}/api/webhooks/asaas`;
      try {
        if (!cfg.webhookToken) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Token do webhook não configurado" });
        // Asaas exige email obrigatorio
        const [userRow] = await db.select({ email: users.email }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
        const email = userRow?.email || "noreply@calcsaas.app";
        await client.configurarWebhook(fullWebhookUrl, cfg.webhookToken, email);
        return { success: true, webhookUrl: fullWebhookUrl };
      } catch (err: any) {
        const msg = err.response?.data?.errors?.[0]?.description || err.message || "Erro desconhecido";
        throw new TRPCError({ code: "BAD_REQUEST", message: `Falha ao registrar webhook: ${msg}` });
      }
    }),

  /**
   * Força validação manual de uma config existente. Útil quando user
   * tá aguardando rate limit liberar e quer testar agora em vez de
   * esperar o cron de 30min.
   */
  validarAgora: protectedProcedure.mutation(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
    if (!perm.editar) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
    }
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [cfg] = await db.select().from(asaasConfig)
      .where(eq(asaasConfig.escritorioId, esc.escritorio.id)).limit(1);
    if (!cfg || !cfg.apiKeyEncrypted) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Nenhuma chave salva. Conecte primeiro." });
    }

    let apiKey: string;
    try {
      apiKey = decrypt(cfg.apiKeyEncrypted, cfg.apiKeyIv ?? "", cfg.apiKeyTag ?? "");
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao descriptografar a key salva" });
    }

    const client = new AsaasClient(apiKey);
    const teste = await client.testarConexao();

    const isRateLimit =
      !teste.ok &&
      (/HTTP 429/i.test(teste.mensagem) ||
        /cota.*requisi[çc][õo]es|rate.?limit/i.test(teste.detalhes ?? ""));

    if (teste.ok) {
      await db.update(asaasConfig).set({
        status: "conectado",
        ultimoTeste: new Date(),
        mensagemErro: null,
        saldo: teste.saldo?.toString() || null,
      }).where(eq(asaasConfig.id, cfg.id));
      return { ok: true, status: "conectado" as const, saldo: teste.saldo };
    }

    if (isRateLimit) {
      await db.update(asaasConfig).set({
        status: "aguardando_validacao",
        ultimoTeste: new Date(),
        mensagemErro: "rate_limit_429: continua bloqueado. Próxima tentativa automática em ~30min.",
      }).where(eq(asaasConfig.id, cfg.id));
      return {
        ok: false,
        status: "aguardando_validacao" as const,
        mensagem: "Asaas ainda em rate limit. Vamos retentar automaticamente em até 30min.",
      };
    }

    // Erro real (chave inválida etc)
    await db.update(asaasConfig).set({
      status: "erro",
      ultimoTeste: new Date(),
      mensagemErro: teste.mensagem + (teste.detalhes ? ` (${teste.detalhes})` : ""),
    }).where(eq(asaasConfig.id, cfg.id));
    return {
      ok: false,
      status: "erro" as const,
      mensagem: teste.mensagem,
    };
  }),

  desconectar: protectedProcedure.mutation(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
    if (!perm.editar) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão para desconectar a conta Asaas do escritório.",
      });
    }
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await db.update(asaasConfig).set({
      status: "desconectado",
      apiKeyEncrypted: null,
      apiKeyIv: null,
      apiKeyTag: null,
      saldo: null,
      // Limpa sync histórica também — não faz sentido continuar com cron
      // tentando importar pra conta desconectada.
      historicoSyncStatus: "inativo",
      historicoSyncCursor: null,
      historicoSyncErroMensagem: null,
    }).where(eq(asaasConfig.escritorioId, esc.escritorio.id));

    return { success: true };
  }),

  // ─── SINCRONIZAÇÃO HISTÓRICA EM JANELAS (anti-rate-limit) ────────────────

  /**
   * Inicia a importação histórica de cobranças do passado, processada
   * em janelas de 1 dia pelo cron `processarSyncHistorico` a cada
   * `intervaloMinutos`. Webhook continua cobrindo eventos futuros em
   * tempo real — esta sync é só pra preencher o passado sem estourar
   * cota do Asaas (rate limit 12h).
   *
   * Quem chama: usuário clica "Importar histórico" no dialog Asaas.
   * Escolhe o período (24h/7d/30d/custom) e o intervalo entre janelas.
   */
  iniciarSyncHistorico: protectedProcedure
    .input(
      z.object({
        /** Preset rápido. Em "custom", `dataInicio` e `dataFim` são obrigatórios. */
        periodo: z.enum(["24h", "7d", "30d", "custom"]),
        dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        /** Cooldown entre janelas. Default 60min — conservador pra evitar
         *  saturar a cota Asaas. Min 5min. */
        intervaloMinutos: z.number().int().min(5).max(720).default(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
      if (!perm.editar) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para iniciar sincronização histórica.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cfg] = await db
        .select()
        .from(asaasConfig)
        .where(eq(asaasConfig.escritorioId, esc.escritorio.id))
        .limit(1);
      if (!cfg || cfg.status !== "conectado") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Asaas não está conectado. Conecte antes de importar histórico.",
        });
      }
      if (
        cfg.historicoSyncStatus === "agendado" ||
        cfg.historicoSyncStatus === "executando"
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Já existe uma importação em andamento. Aguarde ou cancele antes de iniciar nova.",
        });
      }

      // Resolve datas absolutas a partir do preset.
      const hoje = new Date();
      const hojeIso = hoje.toISOString().slice(0, 10);
      let dataInicio: string;
      let dataFim: string;
      if (input.periodo === "custom") {
        if (!input.dataInicio || !input.dataFim) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Período custom exige dataInicio e dataFim.",
          });
        }
        if (input.dataInicio > input.dataFim) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "dataInicio deve ser anterior ou igual a dataFim.",
          });
        }
        dataInicio = input.dataInicio;
        dataFim = input.dataFim;
      } else {
        const dias =
          input.periodo === "24h" ? 1 : input.periodo === "7d" ? 7 : 30;
        const dt = new Date(hoje);
        dt.setUTCDate(dt.getUTCDate() - (dias - 1));
        dataInicio = dt.toISOString().slice(0, 10);
        dataFim = hojeIso;
      }

      // Conta dias inclusivos pra exibir progresso (UI mostra X/Y dias).
      const { contarDiasInclusivos } = await import("./asaas-sync-historico");
      const totalDias = contarDiasInclusivos(dataInicio, dataFim);
      // Limita teto pra evitar pedido absurdo (ex: 10 anos). Pode subir depois.
      const MAX_DIAS = 365 * 3;
      if (totalDias > MAX_DIAS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Período muito longo (${totalDias} dias). Máximo permitido: ${MAX_DIAS}.`,
        });
      }

      await db
        .update(asaasConfig)
        .set({
          historicoSyncStatus: "agendado",
          historicoSyncDe: dataInicio,
          historicoSyncAte: dataFim,
          historicoSyncCursor: dataFim,
          historicoSyncTotalDias: totalDias,
          historicoSyncDiasFeitos: 0,
          historicoSyncCobrancasImportadas: 0,
          historicoSyncCobrancasAtualizadas: 0,
          historicoSyncIntervaloMinutos: input.intervaloMinutos,
          historicoSyncIniciadoEm: new Date(),
          historicoSyncUltimaJanelaEm: null,
          historicoSyncConcluidoEm: null,
          historicoSyncErroMensagem: null,
        })
        .where(eq(asaasConfig.id, cfg.id));

      log.info(
        {
          escritorioId: esc.escritorio.id,
          dataInicio,
          dataFim,
          totalDias,
          intervaloMinutos: input.intervaloMinutos,
        },
        "[Asaas] Sync histórica agendada",
      );

      return {
        success: true,
        dataInicio,
        dataFim,
        totalDias,
        intervaloMinutos: input.intervaloMinutos,
        // Estimativa pro usuário: totalDias × intervaloMinutos em horas
        estimativaHoras: Math.ceil((totalDias * input.intervaloMinutos) / 60),
      };
    }),

  /** Retorna o estado atual da sincronização histórica. */
  statusSyncHistorico: protectedProcedure.query(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [cfg] = await db
      .select({
        status: asaasConfig.historicoSyncStatus,
        de: asaasConfig.historicoSyncDe,
        ate: asaasConfig.historicoSyncAte,
        cursor: asaasConfig.historicoSyncCursor,
        totalDias: asaasConfig.historicoSyncTotalDias,
        diasFeitos: asaasConfig.historicoSyncDiasFeitos,
        cobrancasImportadas: asaasConfig.historicoSyncCobrancasImportadas,
        cobrancasAtualizadas: asaasConfig.historicoSyncCobrancasAtualizadas,
        intervaloMinutos: asaasConfig.historicoSyncIntervaloMinutos,
        iniciadoEm: asaasConfig.historicoSyncIniciadoEm,
        ultimaJanelaEm: asaasConfig.historicoSyncUltimaJanelaEm,
        concluidoEm: asaasConfig.historicoSyncConcluidoEm,
        erroMensagem: asaasConfig.historicoSyncErroMensagem,
      })
      .from(asaasConfig)
      .where(eq(asaasConfig.escritorioId, esc.escritorio.id))
      .limit(1);

    if (!cfg) {
      return {
        status: "inativo" as const,
        de: null,
        ate: null,
        cursor: null,
        totalDias: null,
        diasFeitos: 0,
        cobrancasImportadas: 0,
        cobrancasAtualizadas: 0,
        intervaloMinutos: 60,
        iniciadoEm: null,
        ultimaJanelaEm: null,
        concluidoEm: null,
        erroMensagem: null,
        proximaJanelaEm: null,
      };
    }

    // Calcula previsão da próxima janela: ultimaJanelaEm + intervaloMinutos.
    // Se ainda não rodou nenhuma (agendado), retorna null (próximo tick
    // do cron pega — geralmente em < 5min).
    let proximaJanelaEm: Date | null = null;
    if (
      cfg.status === "executando" &&
      cfg.ultimaJanelaEm &&
      cfg.intervaloMinutos > 0
    ) {
      proximaJanelaEm = new Date(
        cfg.ultimaJanelaEm.getTime() + cfg.intervaloMinutos * 60_000,
      );
    }

    return {
      ...cfg,
      proximaJanelaEm,
    };
  }),

  /** Pausa uma sincronização em andamento. Cron skipa enquanto pausada. */
  pausarSyncHistorico: protectedProcedure.mutation(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
    if (!perm.editar) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
    }
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await db
      .update(asaasConfig)
      .set({ historicoSyncStatus: "pausado" })
      .where(
        and(
          eq(asaasConfig.escritorioId, esc.escritorio.id),
          inArray(asaasConfig.historicoSyncStatus, [
            "agendado",
            "executando",
          ] as const),
        ),
      );

    return { success: true };
  }),

  /** Retoma uma sincronização pausada (ou em erro recuperável). */
  retomarSyncHistorico: protectedProcedure.mutation(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
    if (!perm.editar) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
    }
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [cfg] = await db
      .select()
      .from(asaasConfig)
      .where(eq(asaasConfig.escritorioId, esc.escritorio.id))
      .limit(1);
    if (!cfg) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Configuração Asaas não encontrada.",
      });
    }
    if (cfg.historicoSyncStatus === "concluido") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Importação já concluída. Inicie uma nova se precisar.",
      });
    }
    if (cfg.historicoSyncStatus !== "pausado" && cfg.historicoSyncStatus !== "erro") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Nada pra retomar — importação não está pausada nem em erro.",
      });
    }

    // Reset de ultimaJanelaEm pra null faz o cron processar imediato
    // no próximo tick (sem aguardar mais um intervaloMinutos).
    await db
      .update(asaasConfig)
      .set({
        historicoSyncStatus: "executando",
        historicoSyncUltimaJanelaEm: null,
        historicoSyncErroMensagem: null,
      })
      .where(eq(asaasConfig.id, cfg.id));

    return { success: true };
  }),

  /** Cancela e zera a sincronização histórica. */
  cancelarSyncHistorico: protectedProcedure.mutation(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
    if (!perm.editar) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
    }
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await db
      .update(asaasConfig)
      .set({
        historicoSyncStatus: "inativo",
        historicoSyncDe: null,
        historicoSyncAte: null,
        historicoSyncCursor: null,
        historicoSyncTotalDias: null,
        historicoSyncDiasFeitos: 0,
        historicoSyncCobrancasImportadas: 0,
        historicoSyncCobrancasAtualizadas: 0,
        historicoSyncIniciadoEm: null,
        historicoSyncUltimaJanelaEm: null,
        historicoSyncConcluidoEm: null,
        historicoSyncErroMensagem: null,
      })
      .where(eq(asaasConfig.escritorioId, esc.escritorio.id));

    return { success: true };
  }),

  // ─── SYNC CLIENTES ───────────────────────────────────────────────────────

  /** Sincroniza clientes do Asaas com contatos do CRM por CPF/CNPJ */
  sincronizarClientes: protectedProcedure.mutation(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    const client = await requireAsaasClient(esc.escritorio.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // Nova semântica (conservadora): NÃO importa em bulk todos os clientes
    // do Asaas (escritórios com milhares de customers ficavam com CRM
    // poluído de leads/inativos). Em vez disso:
    //  1) Refresca dados dos vínculos JÁ EXISTENTES (GET /customers/{id})
    //  2) Adota sob demanda: customer Asaas que tem cobrança local órfã
    //     (contatoId NULL) ganha contato local + vínculo
    //
    // Pra importar TODA a base do Asaas, há fluxo separado em
    // Configurações ("Importar histórico" pega cobranças + customers
    // associados sob demanda) — sempre por período.
    const THROTTLE_MS = 350;
    let vinculados = 0;
    let novos = 0;
    let removidos = 0;
    let atualizadosVinculados = 0;

    // ─── Etapa 1: refresh dos vínculos existentes ─────────────────────────────
    const vinculosLocais = await db
      .select({
        id: asaasClientes.id,
        contatoId: asaasClientes.contatoId,
        asaasCustomerId: asaasClientes.asaasCustomerId,
      })
      .from(asaasClientes)
      .where(eq(asaasClientes.escritorioId, esc.escritorio.id));

    for (let i = 0; i < vinculosLocais.length; i++) {
      const v = vinculosLocais[i];
      if (i > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS));
      try {
        const cli = await client.buscarCliente(v.asaasCustomerId);
        if (cli.deleted) {
          await db.delete(asaasClientes).where(eq(asaasClientes.id, v.id));
          removidos++;
          continue;
        }
        if (cli.name) {
          const cpfLimpo = cli.cpfCnpj ? cli.cpfCnpj.replace(/\D/g, "") : null;
          await db
            .update(contatos)
            .set({
              nome: cli.name,
              ...(cpfLimpo ? { cpfCnpj: cpfLimpo } : {}),
              email: cli.email ?? null,
              telefone: cli.mobilePhone ?? cli.phone ?? null,
            })
            .where(
              and(
                eq(contatos.id, v.contatoId),
                eq(contatos.escritorioId, esc.escritorio.id),
              ),
            );
          atualizadosVinculados++;
        }
      } catch (err: any) {
        const status = err?.response?.status ?? err?.cause?.response?.status;
        if (status === 404) {
          // Customer removido do Asaas → solta o vínculo (mantém contato no CRM)
          await db.delete(asaasClientes).where(eq(asaasClientes.id, v.id));
          removidos++;
        } else if (status === 429) {
          log.warn(`[Asaas Sync] Rate limit 429 após ${i} de ${vinculosLocais.length} clientes — abortando refresh`);
          break;
        }
        // Outros erros: pula esse cliente, segue o próximo
      }
    }

    // ─── Etapa 2: adoção sob demanda de cobranças órfãs ───────────────────────
    // Pega customers que TÊM cobrança local sem contato vinculado. Limita
    // ao que está no DB — não puxa nada da listagem do Asaas.
    const orfas = await db
      .selectDistinct({ customerId: asaasCobrancas.asaasCustomerId })
      .from(asaasCobrancas)
      .where(
        and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          isNull(asaasCobrancas.contatoId),
        ),
      );

    const customersOrfaos = orfas
      .map((o) => o.customerId)
      .filter((c): c is string => !!c);

    for (let i = 0; i < customersOrfaos.length; i++) {
      const customerId = customersOrfaos[i];
      if (i > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS));

      // Pode já ter vínculo (se Etapa 1 criou); verifica antes
      const [jaTem] = await db
        .select({ id: asaasClientes.id })
        .from(asaasClientes)
        .where(
          and(
            eq(asaasClientes.escritorioId, esc.escritorio.id),
            eq(asaasClientes.asaasCustomerId, customerId),
          ),
        )
        .limit(1);
      if (jaTem) continue;

      try {
        const cli = await client.buscarCliente(customerId);
        if (cli.deleted || !cli.name?.trim()) continue;

        const cpfLimpo = cli.cpfCnpj ? cli.cpfCnpj.replace(/\D/g, "") : null;

        // Tenta achar contato existente por CPF antes de criar novo
        let contatoIdAlvo: number | null = null;
        if (cpfLimpo) {
          const [contatoExistente] = await db
            .select({ id: contatos.id })
            .from(contatos)
            .where(
              and(
                eq(contatos.escritorioId, esc.escritorio.id),
                eq(contatos.cpfCnpj, cpfLimpo),
              ),
            )
            .limit(1);
          contatoIdAlvo = contatoExistente?.id ?? null;
        }

        if (contatoIdAlvo === null) {
          const [novoContato] = await db
            .insert(contatos)
            .values({
              escritorioId: esc.escritorio.id,
              nome: cli.name,
              cpfCnpj: cpfLimpo,
              email: cli.email ?? null,
              telefone: cli.mobilePhone ?? cli.phone ?? null,
              origem: "asaas",
            })
            .$returningId();
          contatoIdAlvo = novoContato.id;
          novos++;
        } else {
          vinculados++;
        }

        await db.insert(asaasClientes).values({
          escritorioId: esc.escritorio.id,
          contatoId: contatoIdAlvo,
          asaasCustomerId: customerId,
          cpfCnpj: cpfLimpo ?? "",
          nome: cli.name,
        });
      } catch (err: any) {
        const status = err?.response?.status ?? err?.cause?.response?.status;
        if (status === 429) {
          log.warn(`[Asaas Sync] Rate limit 429 na adoção de órfãos — abortando`);
          break;
        }
        // 404 e outros: pula esse customer
      }
    }

    // Refresh das cobranças JÁ EXISTENTES no DB. NÃO importa cobranças
    // novas — esse é o escopo do botão Sincronizar do Financeiro
    // (refresh rápido sem risco de rate limit). Pra puxar histórico
    // novo, o admin usa "Importar histórico" em Configurações (cron
    // throttled em janelas de 1 dia).
    //
    // Inclui adoção bulk: cobranças com contatoId NULL cujo customer
    // agora tem vínculo (criado pelo sync de clientes acima) ficam com
    // nome correto. Resolve o caso "depois de sincronizar, cobranças
    // antigas ainda apareciam com '—'".
    let cobNovas = 0, cobAtualizadas = 0, cobRemovidas = 0, cobAdotadas = 0;
    try {
      const result = await atualizarCobrancasLocaisDoEscritorio(esc.escritorio.id);
      cobAtualizadas = result.atualizadas;
      cobRemovidas = result.removidas;
      cobAdotadas = result.adotadas;
      // cobNovas fica 0 — sync deste botão não importa nada novo
    } catch (err: any) {
      log.warn(`[Asaas] Erro ao atualizar cobranças locais: ${err.message}`);
    }

    return {
      vinculados,
      novos,
      removidos,
      atualizadosVinculados,
      total: vinculados + novos,
      // Contadores granulares de cobranças (toast do frontend usa estes)
      cobNovas,
      cobAtualizadas,
      cobRemovidas,
      cobAdotadas,
      // Mantém legado para retrocompatibilidade (soma total)
      cobrancasSincronizadas: cobNovas + cobAtualizadas + cobRemovidas,
    };
  }),

  /**
   * Vincula um contato do CRM a um cliente do Asaas em até 3 passos:
   *   1. Busca no Asaas por CPF/CNPJ → se achar, vincula direto
   *      (Asaas é fonte de verdade, atualiza nome/email/telefone do CRM).
   *   2. Se não achar por CPF, busca por telefone → se retornar candidatos,
   *      devolve `status: "precisa_decidir"` pro usuário escolher entre
   *      vincular a um existente (mesma pessoa) ou criar novo (responsável
   *      legal, familiar, etc.).
   *   3. Se não achar em nada, cria novo cliente no Asaas com nome + CPF
   *      (email opcional).
   *
   * A decisão do usuário (passo 2) é efetivada via `confirmarVinculacao`.
   */
  vincularContato: protectedProcedure
    .input(z.object({ contatoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [contato] = await db.select().from(contatos)
        .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!contato) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado" });
      if (!contato.nome || contato.nome.trim().length < 2) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Preencha o nome completo do contato antes de vincular." });
      }
      if (!contato.cpfCnpj) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Contato sem CPF/CNPJ. Preencha o CPF/CNPJ primeiro." });
      }

      // Já vinculado localmente — retorna o estado atual sem tocar na API.
      const [jaVinculado] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (jaVinculado) {
        return {
          status: "vinculado" as const,
          asaasCustomerId: jaVinculado.asaasCustomerId,
          jaExistia: true,
          novoClienteCriado: false,
          cobrancasSincronizadas: 0,
          erroSync: null,
        };
      }

      const cpfLimpo = contato.cpfCnpj.replace(/\D/g, "");

      // ── Passo 1: buscar TODOS os customers por CPF/CNPJ ──────────────
      // O Asaas permite duplicatas com mesmo CPF; consolidamos todos sob
      // o mesmo contato do CRM. O "primário" (usado pra criar cobranças
      // novas) é escolhido por heurística em escolherPrimarioEhSecundarios.
      let customersComCpf: AsaasCustomer[] = [];
      try {
        customersComCpf = await client.buscarTodosClientesPorCpfCnpj(cpfLimpo);
      } catch (err: any) {
        log.warn({ err: err.message, cpf: cpfLimpo }, "Busca Asaas por CPF falhou — NÃO criando duplicata");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível verificar se o cliente já existe no Asaas. Tente novamente em alguns minutos.",
        });
      }

      // Filtra customers já vinculados a OUTROS contatos do escritório
      // (não podemos reutilizar sem quebrar exclusividade desse outro).
      if (customersComCpf.length > 0) {
        const idsDisponiveis = await filtrarCustomersDisponiveis(
          db,
          esc.escritorio.id,
          customersComCpf.map((c) => c.id),
        );
        customersComCpf = customersComCpf.filter((c) => idsDisponiveis.has(c.id));
      }

      if (customersComCpf.length > 0) {
        const { primario, secundarios } = await escolherPrimarioEhSecundarios(client, customersComCpf);
        const { cobrancasSincronizadas, erroSync } = await finalizarVinculacao(
          client,
          db,
          esc.escritorio.id,
          input.contatoId,
          contato,
          primario,
          cpfLimpo,
          secundarios,
        );
        return {
          status: "vinculado" as const,
          asaasCustomerId: primario.id,
          jaExistia: true,
          novoClienteCriado: false,
          cobrancasSincronizadas,
          erroSync,
          customersVinculados: 1 + secundarios.length,
        };
      }

      // ── Passo 2: buscar por telefone ─────────────────────────────────
      let candidatos: AsaasCustomer[] = [];
      if (contato.telefone) {
        try {
          candidatos = await client.buscarClientesPorTelefone(contato.telefone);
          // Remove candidatos já vinculados a outros contatos do escritório:
          // esses só geram confusão (não podem ser reusados sem quebrar a
          // exclusividade CRM↔Asaas para outro contato).
          if (candidatos.length > 0) {
            const ids = candidatos.map((c) => c.id);
            const jaLinkados = await db
              .select({ asaasCustomerId: asaasClientes.asaasCustomerId })
              .from(asaasClientes)
              .where(and(
                eq(asaasClientes.escritorioId, esc.escritorio.id),
                inArray(asaasClientes.asaasCustomerId, ids),
              ));
            const linkadosSet = new Set(jaLinkados.map((r) => r.asaasCustomerId));
            candidatos = candidatos.filter((c) => !linkadosSet.has(c.id));
          }
        } catch (err: any) {
          log.warn(
            { err: err.message, tel: contato.telefone },
            "Busca Asaas por telefone falhou — seguindo como se não houvesse candidatos",
          );
        }
      }

      if (candidatos.length > 0) {
        return {
          status: "precisa_decidir" as const,
          candidatos: candidatos.map((c) => ({
            id: c.id,
            name: c.name,
            cpfCnpj: c.cpfCnpj || null,
            email: c.email || null,
            phone: c.phone || null,
            mobilePhone: c.mobilePhone || null,
          })),
        };
      }

      // ── Passo 3: nada encontrado → criar novo ────────────────────────
      const novoAsaasCli = await client.criarCliente({
        name: contato.nome,
        cpfCnpj: cpfLimpo,
        ...(contato.email ? { email: contato.email } : {}),
        ...(contato.telefone ? { mobilePhone: contato.telefone.replace(/\D/g, "") } : {}),
      });

      const { cobrancasSincronizadas, erroSync } = await finalizarVinculacao(
        client,
        db,
        esc.escritorio.id,
        input.contatoId,
        contato,
        novoAsaasCli,
        cpfLimpo,
      );

      return {
        status: "vinculado" as const,
        asaasCustomerId: novoAsaasCli.id,
        jaExistia: false,
        novoClienteCriado: true,
        cobrancasSincronizadas,
        erroSync,
      };
    }),

  /**
   * Efetiva a decisão tomada pelo usuário no diálogo de candidatos por
   * telefone (retornado por vincularContato quando status = precisa_decidir).
   *
   * - vincular_existente: reusa o cliente Asaas informado. Se o Asaas não
   *   tem CPF nesse cadastro, fazemos PUT para setar o CPF do CRM antes
   *   de vincular (garante consistência).
   * - criar_novo: cria cliente novo no Asaas (nome + CPF obrigatórios).
   */
  confirmarVinculacao: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      acao: z.enum(["vincular_existente", "criar_novo"]),
      asaasCustomerId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [contato] = await db.select().from(contatos)
        .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!contato) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado" });
      if (!contato.nome || contato.nome.trim().length < 2) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Preencha o nome completo do contato antes de vincular." });
      }
      if (!contato.cpfCnpj) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Contato sem CPF/CNPJ. Preencha o CPF/CNPJ primeiro." });
      }

      const [jaVinculado] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (jaVinculado) {
        return {
          status: "vinculado" as const,
          asaasCustomerId: jaVinculado.asaasCustomerId,
          jaExistia: true,
          novoClienteCriado: false,
          cobrancasSincronizadas: 0,
          erroSync: null,
        };
      }

      const cpfLimpo = contato.cpfCnpj.replace(/\D/g, "");

      if (input.acao === "vincular_existente") {
        if (!input.asaasCustomerId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "asaasCustomerId é obrigatório para vincular a um existente." });
        }

        // Verifica se esse customer já está linkado a outro contato do
        // escritório. Se estiver, bloqueia (evita duplicação de vínculo).
        const [outroVinculo] = await db.select().from(asaasClientes)
          .where(and(
            eq(asaasClientes.escritorioId, esc.escritorio.id),
            eq(asaasClientes.asaasCustomerId, input.asaasCustomerId),
          ))
          .limit(1);
        if (outroVinculo) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Este cliente do Asaas já está vinculado a outro contato do CRM.",
          });
        }

        let asaasCli: AsaasCustomer;
        try {
          asaasCli = await client.buscarCliente(input.asaasCustomerId);
        } catch (err: any) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Cliente Asaas ${input.asaasCustomerId} não encontrado: ${err.message || "erro desconhecido"}`,
          });
        }

        // Se o Asaas não tem CPF nesse cadastro, ou o CPF é diferente do
        // CRM, atualizamos no Asaas (CRM é fonte quando Asaas está vazio;
        // caso o Asaas já tenha CPF, preservamos — impede sobrescrever
        // identidade de uma pessoa por outra).
        const cpfAsaas = (asaasCli.cpfCnpj || "").replace(/\D/g, "");
        if (!cpfAsaas) {
          try {
            asaasCli = await client.atualizarCliente(asaasCli.id, { cpfCnpj: cpfLimpo });
          } catch (err: any) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Falha ao atualizar CPF no Asaas: ${err.message || "erro desconhecido"}`,
            });
          }
        } else if (cpfAsaas !== cpfLimpo) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Este cliente do Asaas tem outro CPF cadastrado. Não é possível vincular a este contato.",
          });
        }

        const { cobrancasSincronizadas, erroSync } = await finalizarVinculacao(
          client,
          db,
          esc.escritorio.id,
          input.contatoId,
          contato,
          asaasCli,
          cpfLimpo,
        );
        return {
          status: "vinculado" as const,
          asaasCustomerId: asaasCli.id,
          jaExistia: true,
          novoClienteCriado: false,
          cobrancasSincronizadas,
          erroSync,
        };
      }

      // acao = "criar_novo"
      // Antes de criar, reconfere por CPF (pode ter sido cadastrado no
      // intervalo entre o primeiro clique e a confirmação).
      let asaasCli: AsaasCustomer | null = null;
      try {
        asaasCli = await client.buscarClientePorCpfCnpj(cpfLimpo);
      } catch {
        /* se falhar, tentamos criar e o próprio Asaas rejeita se duplicar */
      }

      if (!asaasCli) {
        asaasCli = await client.criarCliente({
          name: contato.nome,
          cpfCnpj: cpfLimpo,
          ...(contato.email ? { email: contato.email } : {}),
          ...(contato.telefone ? { mobilePhone: contato.telefone.replace(/\D/g, "") } : {}),
        });
      }

      const { cobrancasSincronizadas, erroSync } = await finalizarVinculacao(
        client,
        db,
        esc.escritorio.id,
        input.contatoId,
        contato,
        asaasCli,
        cpfLimpo,
      );
      return {
        status: "vinculado" as const,
        asaasCustomerId: asaasCli.id,
        jaExistia: false,
        novoClienteCriado: true,
        cobrancasSincronizadas,
        erroSync,
      };
    }),

  /**
   * @deprecated Use `syncCobrancasContato` — agora faz a mesma coisa.
   *
   * Mantido apenas para rollback seguro / compatibilidade de clientes
   * antigos. Pode ser removido num refactor futuro quando a certeza de
   * que nenhum consumidor externo depende dele.
   *
   * Reconcilia o vínculo Asaas de um contato já vinculado: busca todos os
   * customers do Asaas com o mesmo CPF, adiciona os que ainda não estão
   * vinculados (como secundários, primario=false) e puxa cobranças de
   * todos. Usado quando o Asaas tem duplicatas do CPF e o vínculo inicial
   * pegou um customer "vazio", deixando histórico financeiro de fora.
   *
   * Idempotente: rodar várias vezes não cria linhas duplicadas.
   */
  reconciliarVinculo: protectedProcedure
    .input(z.object({ contatoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [contato] = await db.select().from(contatos)
        .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!contato) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado" });
      if (!contato.cpfCnpj) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Contato sem CPF/CNPJ." });
      }

      const vinculosExistentes = await db.select().from(asaasClientes)
        .where(and(
          eq(asaasClientes.contatoId, input.contatoId),
          eq(asaasClientes.escritorioId, esc.escritorio.id),
        ));
      if (vinculosExistentes.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Contato ainda não está vinculado. Use 'Vincular' antes de reconciliar.",
        });
      }

      const cpfLimpo = contato.cpfCnpj.replace(/\D/g, "");
      const idsJaVinculados = new Set(vinculosExistentes.map((v) => v.asaasCustomerId));

      // Busca todos os customers do Asaas com esse CPF. Os que já estão
      // vinculados a esse próprio contato mantemos; os vinculados a OUTROS
      // contatos do escritório ficam de fora (não podemos reusá-los).
      let todosDoCpf: AsaasCustomer[] = [];
      try {
        todosDoCpf = await client.buscarTodosClientesPorCpfCnpj(cpfLimpo);
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Falha ao consultar Asaas: ${err.message || "erro desconhecido"}`,
        });
      }

      const disponiveisIds = await filtrarCustomersDisponiveis(
        db,
        esc.escritorio.id,
        todosDoCpf.map((c) => c.id).filter((id) => !idsJaVinculados.has(id)),
      );

      const novos = todosDoCpf.filter((c) => disponiveisIds.has(c.id));

      let customersAdicionados = 0;
      for (const cli of novos) {
        await db.insert(asaasClientes).values({
          escritorioId: esc.escritorio.id,
          contatoId: input.contatoId,
          asaasCustomerId: cli.id,
          cpfCnpj: (cli.cpfCnpj || cpfLimpo).replace(/\D/g, ""),
          nome: cli.name,
          primario: false, // reconciliação NUNCA muda o primário existente
        });
        customersAdicionados++;
      }

      // Re-sincroniza cobranças de TODOS os customers vinculados (primário + secundários)
      let cobrancasSincronizadas = 0;
      let erroSync: string | null = null;
      try {
        const r = await syncTodasCobrancasDoContato(client, esc.escritorio.id, input.contatoId);
        cobrancasSincronizadas = r.novas + r.atualizadas;
      } catch (err: any) {
        erroSync = err?.message || "Erro desconhecido ao sincronizar cobranças";
      }

      return {
        customersAdicionados,
        totalCustomersVinculados: vinculosExistentes.length + customersAdicionados,
        cobrancasSincronizadas,
        erroSync,
      };
    }),

  // ─── COBRANÇAS ───────────────────────────────────────────────────────────

  /** Criar cobrança para um contato */
  criarCobranca: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      valor: z.number().min(0.01),
      vencimento: z.string().min(10),
      formaPagamento: z.enum(["BOLETO", "CREDIT_CARD", "PIX", "UNDEFINED"]),
      descricao: z.string().max(512).optional(),
      /** Atendente que receberá comissão pela cobrança. Se omitido, herda do contato. */
      atendenteId: z.number().optional(),
      /** Categoria de cobrança (define elegibilidade padrão da comissão). */
      categoriaId: z.number().optional(),
      /** Override manual: TRUE/FALSE força; null/undefined = obedece a categoria. */
      comissionavelOverride: z.boolean().nullable().optional(),
      /**
       * Ações vinculadas (cliente_processos.id). Quando o pagamento é
       * recebido, o dispatcher dispara `pagamento_recebido` UMA VEZ por
       * ação — cada execução do SmartFlow tem o contexto da ação dela.
       * Vazio/omitido → comportamento legado (1 evento sem `acaoId`).
       */
      processoIds: z.array(z.number().int().positive()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "criar");
      if (!perm.criar) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para criar cobranças no módulo Financeiro.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Buscar vínculo Asaas primário do contato. Um contato pode ter
      // múltiplos vínculos (duplicatas no Asaas com mesmo CPF), mas
      // cobranças novas SEMPRE saem do primário — garante que a cobrança
      // caia num customer só e não aumente a duplicação.
      const [vinculoPrimario] = await db.select().from(asaasClientes)
        .where(and(
          eq(asaasClientes.contatoId, input.contatoId),
          eq(asaasClientes.escritorioId, esc.escritorio.id),
          eq(asaasClientes.primario, true),
        ))
        .limit(1);

      // Fallback para dados legados (pré-migração): se não há primário
      // explícito, usa qualquer vínculo. Evita quebrar contatos antigos.
      const [vinculo] = vinculoPrimario
        ? [vinculoPrimario]
        : await db.select().from(asaasClientes)
            .where(and(
              eq(asaasClientes.contatoId, input.contatoId),
              eq(asaasClientes.escritorioId, esc.escritorio.id),
            ))
            .limit(1);

      if (!vinculo) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Contato não vinculado ao Asaas. Vincule o contato primeiro.",
        });
      }

      // Resolve atendente: explícito > responsável do contato > nenhum.
      // O `responsavelId` do cliente é a única fonte: quem cuida do cliente
      // é quem recebe comissão pelas cobranças.
      let atendenteId: number | null = input.atendenteId ?? null;
      if (atendenteId === null) {
        const [contatoRow] = await db
          .select({ responsavelId: contatos.responsavelId })
          .from(contatos)
          .where(eq(contatos.id, input.contatoId))
          .limit(1);
        atendenteId = contatoRow?.responsavelId ?? null;
      }
      if (atendenteId !== null) {
        await validarAtendente(esc.escritorio.id, atendenteId);
      }

      // Carimba o atendente no Asaas para que cobranças importadas em outro
      // canal (webhook, sync) consigam reidentificar a atribuição original.
      const externalReference =
        atendenteId !== null ? `atendente:${atendenteId}` : undefined;

      // Criar cobrança no Asaas. O `client.criarCobranca` já formata erros
      // do Asaas com a descrição original ("Vencimento não pode ser data
      // passada", etc); convertemos pra TRPCError BAD_REQUEST pra o
      // frontend exibir mensagem útil em vez de "status code 500".
      let cobranca;
      try {
        cobranca = await client.criarCobranca({
          customer: vinculo.asaasCustomerId,
          billingType: input.formaPagamento,
          value: input.valor,
          dueDate: input.vencimento,
          description: input.descricao,
          externalReference,
        });
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err?.message || "Erro ao criar cobrança no Asaas" });
      }

      // Salvar localmente. INSERT retorna `insertId` em MySQL — usamos
      // pra vincular as ações na tabela N:M `cobranca_acoes` logo abaixo.
      const [resultInsert] = await db.insert(asaasCobrancas).values({
        escritorioId: esc.escritorio.id,
        contatoId: input.contatoId,
        asaasPaymentId: cobranca.id,
        asaasCustomerId: vinculo.asaasCustomerId,
        valor: cobranca.value.toString(),
        valorLiquido: cobranca.netValue?.toString() || null,
        vencimento: cobranca.dueDate,
        formaPagamento: input.formaPagamento,
        status: cobranca.status,
        descricao: input.descricao || null,
        invoiceUrl: cobranca.invoiceUrl,
        bankSlipUrl: cobranca.bankSlipUrl || null,
        externalReference: externalReference ?? null,
        atendenteId,
        categoriaId: input.categoriaId ?? null,
        comissionavelOverride: input.comissionavelOverride ?? null,
      });
      const cobrancaIdLocal = (resultInsert as { insertId: number }).insertId;

      // Vincular ações (N:M). Validação garante que os processos pertencem
      // ao mesmo contato + escritório (anti-spoof). IDs inválidos viram no-op.
      const acoesValidas = await validarProcessoIds(
        esc.escritorio.id,
        input.contatoId,
        input.processoIds,
      );
      await vincularCobrancaAcoes(cobrancaIdLocal, acoesValidas);

      // Se é Pix, buscar QR Code
      let pixQrCode = null;
      if (input.formaPagamento === "PIX") {
        try {
          pixQrCode = await client.obterPixQrCode(cobranca.id);
          await db.update(asaasCobrancas)
            .set({ pixQrCodePayload: pixQrCode.payload })
            .where(eq(asaasCobrancas.asaasPaymentId, cobranca.id));
        } catch {}
      }

      return {
        success: true,
        cobranca: {
          id: cobranca.id,
          status: cobranca.status,
          invoiceUrl: cobranca.invoiceUrl,
          bankSlipUrl: cobranca.bankSlipUrl,
          pixQrCode: pixQrCode ? { payload: pixQrCode.payload, image: pixQrCode.encodedImage } : null,
        },
      };
    }),

  /**
   * Sobrescreve flag `comissionavelOverride` numa cobrança existente.
   *  - `true`  → força entrar na comissão (ignora padrão da categoria)
   *  - `false` → força ficar de fora
   *  - `null`  → volta pro padrão (categoria.comissionavel)
   *
   * Útil pra ajustar cobranças que vieram via webhook (parcelamento,
   * assinatura) e estavam com o flag herdado errado, ou pra excepcionar
   * casos pontuais sem mudar a categoria.
   */
  atualizarComissionavel: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        valor: z.boolean().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
      if (!perm.editar) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão pra editar cobranças.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cob] = await db
        .select({ id: asaasCobrancas.id })
        .from(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.id, input.id),
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!cob) throw new TRPCError({ code: "NOT_FOUND" });

      await db
        .update(asaasCobrancas)
        .set({ comissionavelOverride: input.valor })
        .where(eq(asaasCobrancas.id, cob.id));

      return { success: true, valor: input.valor };
    }),

  /**
   * Cria cobrança "manual" — sem passar pela API Asaas. Usada quando
   * o cliente paga em dinheiro/cartão presencial, ou quando o
   * escritório está sem Asaas conectado e quer registrar a entrada
   * no contas-a-receber.
   *
   * Diferenças vs `criarCobranca`:
   *  - Não chama Asaas (não tem invoiceUrl, pixQrCode, etc)
   *  - `asaasPaymentId` e `asaasCustomerId` ficam NULL
   *  - `origem='manual'`
   *  - Aceita formas extras: DINHEIRO, TRANSFERENCIA, OUTRO
   *  - Pode nascer já paga (`jaPaga:true` → status=RECEIVED + dataPagamento)
   */
  criarCobrancaManual: protectedProcedure
    .input(
      z.object({
        contatoId: z.number(),
        valor: z.number().min(0.01),
        descricao: z.string().max(512).optional(),
        vencimento: z.string(),
        formaPagamento: z.enum([
          "PIX",
          "BOLETO",
          "CREDIT_CARD",
          "DINHEIRO",
          "TRANSFERENCIA",
          "OUTRO",
        ]),
        /** Se true, registra como já recebida (status=RECEIVED + dataPagamento). */
        jaPaga: z.boolean().default(false),
        dataPagamento: z.string().optional(),
        atendenteId: z.number().optional(),
        categoriaId: z.number().optional(),
        comissionavelOverride: z.boolean().nullable().optional(),
        /** Ações vinculadas (cliente_processos.id). Mesma semântica de criarCobranca. */
        processoIds: z.array(z.number().int().positive()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "criar");
      if (!perm.criar) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para criar cobranças no módulo Financeiro.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Valida que o contato existe no escritório.
      const [cont] = await db
        .select({ id: contatos.id })
        .from(contatos)
        .where(
          and(
            eq(contatos.id, input.contatoId),
            eq(contatos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!cont) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado." });
      }

      // Inferência de atendente — mesma lógica do path Asaas.
      let atendenteId: number | null = input.atendenteId ?? null;
      if (atendenteId === null) {
        const [contatoRow] = await db
          .select({ responsavelId: contatos.responsavelId })
          .from(contatos)
          .where(eq(contatos.id, input.contatoId))
          .limit(1);
        atendenteId = contatoRow?.responsavelId ?? null;
      }
      if (atendenteId !== null) {
        await validarAtendente(esc.escritorio.id, atendenteId);
      }

      const dataPag = input.jaPaga
        ? input.dataPagamento ?? new Date().toISOString().slice(0, 10)
        : null;
      const status = input.jaPaga ? "RECEIVED" : "PENDING";

      const [r] = await db
        .insert(asaasCobrancas)
        .values({
          escritorioId: esc.escritorio.id,
          contatoId: input.contatoId,
          asaasPaymentId: null,
          asaasCustomerId: null,
          origem: "manual",
          valor: input.valor.toFixed(2),
          // Manual: bruto = líquido (sem taxa Asaas).
          valorLiquido: input.valor.toFixed(2),
          vencimento: input.vencimento,
          formaPagamento: input.formaPagamento as any,
          status,
          descricao: input.descricao || null,
          dataPagamento: dataPag,
          atendenteId,
          categoriaId: input.categoriaId ?? null,
          comissionavelOverride: input.comissionavelOverride ?? null,
        })
        .$returningId();

      const cobrancaIdLocal = (r as { id: number }).id;

      // Vincula ações (N:M)
      const acoesValidas = await validarProcessoIds(
        esc.escritorio.id,
        input.contatoId,
        input.processoIds,
      );
      await vincularCobrancaAcoes(cobrancaIdLocal, acoesValidas);

      return {
        success: true,
        cobrancaId: cobrancaIdLocal,
        status,
      };
    }),

  /**
   * Marca cobrança manual como recebida. Equivalente ao "Marcar paga"
   * do contas-a-pagar, mas pra entrada. Não funciona em cobrança Asaas
   * (status sincroniza via webhook automaticamente).
   */
  marcarCobrancaPaga: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        dataPagamento: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
      if (!perm.editar) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cob] = await db
        .select({ origem: asaasCobrancas.origem })
        .from(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.id, input.id),
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!cob) throw new TRPCError({ code: "NOT_FOUND" });
      if (cob.origem !== "manual") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cobranças Asaas são marcadas como pagas via webhook automaticamente.",
        });
      }

      const dataPag = input.dataPagamento ?? new Date().toISOString().slice(0, 10);
      await db
        .update(asaasCobrancas)
        .set({ status: "RECEIVED", dataPagamento: dataPag })
        .where(eq(asaasCobrancas.id, input.id));
      return { success: true, dataPagamento: dataPag };
    }),

  /** Lista cobranças do escritório com filtros */
  listarCobrancas: protectedProcedure
    .input(z.object({
      /** Aceita string única (legado) OU array (multi-select novo). */
      status: z.union([z.string(), z.array(z.string())]).optional(),
      /** Aceita string única (legado) OU array (multi-select novo). */
      formaPagamento: z.union([z.string(), z.array(z.string())]).optional(),
      contatoId: z.number().optional(),
      busca: z.string().optional(),
      /** Filtra cobranças por vencimento ≥ data (YYYY-MM-DD). */
      vencimentoInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      /** Filtra cobranças por vencimento ≤ data (YYYY-MM-DD). */
      vencimentoFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      /**
       * Filtra cobranças por DATA DE PAGAMENTO (≥). Útil pra "ver o que
       * recebi em maio" — bate com o critério da aba Comissões.
       * Cobranças não pagas (PENDING/OVERDUE) são excluídas implicitamente
       * porque não têm dataPagamento.
       */
      pagamentoInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      pagamentoFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      /** Filtro por atendente (responsável pela comissão). */
      atendenteId: z.number().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { items: [], total: 0 };

      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      try {
        const conditions: any[] = [eq(asaasCobrancas.escritorioId, esc.escritorio.id)];

        // Status: aceita string ou array (multi-select)
        if (input?.status) {
          const statusList = Array.isArray(input.status) ? input.status : [input.status];
          if (statusList.length === 1) {
            conditions.push(eq(asaasCobrancas.status, statusList[0]));
          } else if (statusList.length > 1) {
            conditions.push(inArray(asaasCobrancas.status, statusList));
          }
        }
        // Forma de pagamento: aceita string ou array (multi-select)
        if (input?.formaPagamento) {
          const formaList = Array.isArray(input.formaPagamento)
            ? input.formaPagamento
            : [input.formaPagamento];
          if (formaList.length === 1) {
            conditions.push(eq(asaasCobrancas.formaPagamento, formaList[0] as any));
          } else if (formaList.length > 1) {
            conditions.push(inArray(asaasCobrancas.formaPagamento, formaList as any));
          }
        }
        if (input?.contatoId) conditions.push(eq(asaasCobrancas.contatoId, input.contatoId));
        if (input?.atendenteId) conditions.push(eq(asaasCobrancas.atendenteId, input.atendenteId));
        if (input?.vencimentoInicio && input?.vencimentoFim) {
          conditions.push(between(asaasCobrancas.vencimento, input.vencimentoInicio, input.vencimentoFim));
        } else if (input?.vencimentoInicio) {
          conditions.push(gte(asaasCobrancas.vencimento, input.vencimentoInicio));
        } else if (input?.vencimentoFim) {
          conditions.push(lte(asaasCobrancas.vencimento, input.vencimentoFim));
        }
        if (input?.pagamentoInicio && input?.pagamentoFim) {
          conditions.push(between(asaasCobrancas.dataPagamento, input.pagamentoInicio, input.pagamentoFim));
        } else if (input?.pagamentoInicio) {
          conditions.push(gte(asaasCobrancas.dataPagamento, input.pagamentoInicio));
        } else if (input?.pagamentoFim) {
          conditions.push(lte(asaasCobrancas.dataPagamento, input.pagamentoFim));
        }

        // Filtro por permissão: se verProprios only, só mostra cobranças
        // de contatos cujo responsável é o próprio colaborador.
        const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
        if (visiveis !== null) {
          if (visiveis.length === 0) return { items: [], total: 0 };
          conditions.push(inArray(asaasCobrancas.contatoId, visiveis));
        }

        // Total pra paginação. Counts em separado evita carregar todas
        // as linhas só pra contar.
        const [totalRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(asaasCobrancas)
          .where(and(...conditions));
        const total = Number(totalRow?.count ?? 0);

        const items = await db.select().from(asaasCobrancas)
          .where(and(...conditions))
          // Ordenação: data de recebimento desc com fallback pra vencimento.
          // `COALESCE(dataPagamento, vencimento)` faz cobranças pagas
          // recentes aparecerem no topo (ordem real do caixa) e pendentes
          // se posicionarem pelo vencimento. createdAt como tiebreaker
          // pra cobranças com mesma data.
          .orderBy(
            sql`COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento}) DESC`,
            desc(asaasCobrancas.createdAt),
          )
          .limit(input?.limit ?? 50)
          .offset(input?.offset ?? 0);

        // Enriquecer com nome do contato — primário do CRM. Fallback pro
        // nome em `asaas_clientes` quando contato não existe (customer
        // do Asaas sem CPF que ainda não virou contato local).
        const contatoIds = [...new Set(items.map((i) => i.contatoId).filter(Boolean))];
        let contatosMap: Record<number, string> = {};
        if (contatoIds.length > 0) {
          const contatosList = await db.select({ id: contatos.id, nome: contatos.nome })
            .from(contatos)
            .where(inArray(contatos.id, contatoIds as number[]));
          contatosMap = Object.fromEntries(contatosList.map((c) => [c.id, c.nome]));
        }

        // Fallback: cobranças sem contatoId OU com contato sem nome buscam
        // em `asaas_clientes` pelo asaasCustomerId. É o vínculo direto com
        // o customer do Asaas, que sempre tem nome quando o sync rodou.
        const customerIdsSemNome = items
          .filter((i) =>
            !i.contatoId || !contatosMap[i.contatoId] || contatosMap[i.contatoId].trim() === "",
          )
          .map((i) => i.asaasCustomerId)
          .filter((c): c is string => !!c);
        let asaasClienteNomeMap: Record<string, string> = {};
        if (customerIdsSemNome.length > 0) {
          const linhas = await db
            .select({
              customerId: asaasClientes.asaasCustomerId,
              nome: asaasClientes.nome,
            })
            .from(asaasClientes)
            .where(
              and(
                eq(asaasClientes.escritorioId, esc.escritorio.id),
                inArray(asaasClientes.asaasCustomerId, customerIdsSemNome),
              ),
            );
          asaasClienteNomeMap = Object.fromEntries(
            linhas
              .filter((l) => l.nome && l.nome.trim())
              .map((l) => [l.customerId, l.nome as string]),
          );
        }

        // Enriquecer com ações vinculadas (apelido / tipo). 1 query por
        // batch — JOIN feito client-side em JS pra evitar N+1.
        const cobrancaIds = items.map((i) => i.id);
        type AcaoLinha = { cobrancaId: number; processoId: number; apelido: string | null; tipo: string | null };
        let acoesPorCobranca: Map<number, AcaoLinha[]> = new Map();
        if (cobrancaIds.length > 0) {
          const acoesRows = await db
            .select({
              cobrancaId: cobrancaAcoes.cobrancaId,
              processoId: cobrancaAcoes.processoId,
              apelido: clienteProcessos.apelido,
              tipo: clienteProcessos.tipo,
            })
            .from(cobrancaAcoes)
            .innerJoin(clienteProcessos, eq(clienteProcessos.id, cobrancaAcoes.processoId))
            .where(inArray(cobrancaAcoes.cobrancaId, cobrancaIds));
          for (const r of acoesRows) {
            const arr = acoesPorCobranca.get(r.cobrancaId) ?? [];
            arr.push(r);
            acoesPorCobranca.set(r.cobrancaId, arr);
          }
        }

        const enriched = items.map((i) => {
          const nomeContrato = i.contatoId ? contatosMap[i.contatoId] : null;
          const nomeFallback = i.asaasCustomerId
            ? asaasClienteNomeMap[i.asaasCustomerId]
            : null;
          return {
            ...i,
            nomeContato:
              (nomeContrato && nomeContrato.trim()) ||
              (nomeFallback && nomeFallback.trim()) ||
              "—",
            acoesVinculadas: acoesPorCobranca.get(i.id) ?? [],
          };
        });

        return { items: enriched, total };
      } catch {
        return { items: [], total: 0 };
      }
    }),

  // ─── RESUMO FINANCEIRO ───────────────────────────────────────────────────

  /** Resumo financeiro de um contato (para exibir no CRM/Atendimento) */
  resumoContato: protectedProcedure
    .input(z.object({ contatoId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;

      const db = await getDb();
      if (!db) return null;

      try {
        // Verificar se contato está vinculado
        const [vinculo] = await db.select().from(asaasClientes)
          .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)))
          .limit(1);

        if (!vinculo) return { vinculado: false, pendente: 0, vencido: 0, pago: 0, cobrancas: [] };

        // Buscar cobranças locais
        const cobrancas = await db.select().from(asaasCobrancas)
          .where(and(eq(asaasCobrancas.contatoId, input.contatoId), eq(asaasCobrancas.escritorioId, esc.escritorio.id)))
          .orderBy(desc(asaasCobrancas.createdAt))
          .limit(20);

        let pendente = 0, vencido = 0, pago = 0;
        for (const c of cobrancas) {
          const val = parseFloat(c.valor) || 0;
          if (c.status === "PENDING") pendente += val;
          else if (c.status === "OVERDUE") vencido += val;
          else if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status)) pago += val;
        }

        return {
          vinculado: true,
          asaasCustomerId: vinculo.asaasCustomerId,
          pendente,
          vencido,
          pago,
          cobrancas,
        };
      } catch {
        return null;
      }
    }),

  /**
   * Sincroniza cobranças de um contato com o Asaas em dois passos:
   *
   *   1. Reconciliação por CPF: o Asaas permite duplicatas de customer com
   *      o mesmo CPF. Se o contato tem CPF cadastrado, busca TODOS os
   *      customers com esse CPF e adiciona os que ainda não estão
   *      vinculados (como `primario=false`, não muda o primário).
   *
   *   2. Sync das cobranças de TODOS os customers vinculados (primário +
   *      secundários). Isso garante que o histórico completo apareça mesmo
   *      quando o vínculo original era num customer "vazio".
   *
   * Absorve a função antiga do endpoint `reconciliarVinculo` — um único
   * clique no frontend ("Sincronizar") cobre os dois fluxos.
   */
  syncCobrancasContato: protectedProcedure
    .input(z.object({ contatoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const vinculosExistentes = await db.select().from(asaasClientes)
        .where(and(
          eq(asaasClientes.contatoId, input.contatoId),
          eq(asaasClientes.escritorioId, esc.escritorio.id),
        ));

      if (vinculosExistentes.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contato não vinculado ao Asaas" });
      }

      // ── Passo 1: reconciliação por CPF ──────────────────────────────
      // Best-effort: se o CPF estiver vazio ou a busca no Asaas falhar,
      // prossegue com os vínculos atuais (não aborta o sync).
      let customersAdicionados = 0;
      let erroReconciliacao: string | null = null;

      const [contato] = await db.select({ cpfCnpj: contatos.cpfCnpj }).from(contatos)
        .where(and(
          eq(contatos.id, input.contatoId),
          eq(contatos.escritorioId, esc.escritorio.id),
        ))
        .limit(1);

      const cpfLimpo = (contato?.cpfCnpj || "").replace(/\D/g, "");
      if (cpfLimpo) {
        try {
          const todosDoCpf = await client.buscarTodosClientesPorCpfCnpj(cpfLimpo);
          const idsJaVinculados = new Set(vinculosExistentes.map((v) => v.asaasCustomerId));
          const candidatos = todosDoCpf.filter((c) => !idsJaVinculados.has(c.id));

          if (candidatos.length > 0) {
            const disponiveisIds = await filtrarCustomersDisponiveis(
              db,
              esc.escritorio.id,
              candidatos.map((c) => c.id),
            );
            const novos = candidatos.filter((c) => disponiveisIds.has(c.id));

            for (const cli of novos) {
              await db.insert(asaasClientes).values({
                escritorioId: esc.escritorio.id,
                contatoId: input.contatoId,
                asaasCustomerId: cli.id,
                cpfCnpj: (cli.cpfCnpj || cpfLimpo).replace(/\D/g, ""),
                nome: cli.name,
                primario: false,
              });
              customersAdicionados++;
            }
          }
        } catch (err: any) {
          erroReconciliacao = err?.message || "Erro ao buscar duplicatas no Asaas";
          log.warn(
            { err: erroReconciliacao, contatoId: input.contatoId, cpf: cpfLimpo },
            "Reconciliação por CPF falhou — prosseguindo com vínculos atuais",
          );
        }
      }

      // ── Passo 2: sync de cobranças de TODOS os vínculos ─────────────
      let stats = { novas: 0, atualizadas: 0, removidas: 0 };
      let erroSync: string | null = erroReconciliacao;
      try {
        stats = await syncTodasCobrancasDoContato(client, esc.escritorio.id, input.contatoId);
      } catch (err: any) {
        erroSync = err?.message || "Erro desconhecido ao sincronizar cobranças";
      }

      return {
        customersAdicionados,
        novas: stats.novas,
        atualizadas: stats.atualizadas,
        removidas: stats.removidas,
        total: stats.novas + stats.atualizadas + stats.removidas,
        erroSync,
      };
    }),

  /** Sincronizar tudo: clientes + cobranças do escritório inteiro */
  sincronizarTudo: protectedProcedure.mutation(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    const result = await syncCobrancasEscritorio(esc.escritorio.id);
    return result;
  }),

  // ─── KPIs ────────────────────────────────────────────────────────────────

  /** KPIs financeiros do escritório */
  /**
   * KPIs do Financeiro: total recebido (pago), pendente, vencido.
   *
   * Filtros opcionais por período:
   *   - `pagamentoInicio` / `pagamentoFim`: aplica em cobranças PAGAS
   *     (RECEIVED/CONFIRMED/RECEIVED_IN_CASH) — bate com a aba Cobranças
   *     filtrando por data de pagamento.
   *   - `vencimentoInicio` / `vencimentoFim`: aplica em PENDING/OVERDUE
   *     — pra "ver o que vence em maio".
   *
   * Sem filtros, retorna o total histórico (comportamento legado).
   */
  kpis: protectedProcedure
    .input(
      z
        .object({
          pagamentoInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          pagamentoFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          vencimentoInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          vencimentoFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
    const ZERO = { recebido: 0, recebidoLiquido: 0, pendente: 0, vencido: 0, totalCobrancas: 0 };
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return ZERO;

    const db = await getDb();
    if (!db) return ZERO;

    try {
      const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
      if (visiveis !== null && visiveis.length === 0) return ZERO;
      const conds = [eq(asaasCobrancas.escritorioId, esc.escritorio.id)];
      if (visiveis !== null) conds.push(inArray(asaasCobrancas.contatoId, visiveis));
      const todas = await db.select().from(asaasCobrancas).where(and(...conds));

      const noRangePag = (data: string | null): boolean => {
        if (!input?.pagamentoInicio && !input?.pagamentoFim) return true;
        if (!data) return false;
        if (input.pagamentoInicio && data < input.pagamentoInicio) return false;
        if (input.pagamentoFim && data > input.pagamentoFim) return false;
        return true;
      };
      const noRangeVenc = (venc: string): boolean => {
        if (!input?.vencimentoInicio && !input?.vencimentoFim) return true;
        if (input.vencimentoInicio && venc < input.vencimentoInicio) return false;
        if (input.vencimentoFim && venc > input.vencimentoFim) return false;
        return true;
      };

      let recebido = 0;
      let recebidoLiquido = 0;
      let pendente = 0;
      let vencido = 0;
      let totalCobrancas = 0;
      for (const c of todas) {
        const val = parseFloat(c.valor) || 0;
        // valorLiquido vem do Asaas (`netValue`) com taxa já abatida.
        // Pra cobranças sem este campo (manuais ou antigas), usamos o
        // bruto como aproximação — sem taxa, líquido = bruto.
        const liq = c.valorLiquido != null ? parseFloat(c.valorLiquido) : val;
        if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status)) {
          if (noRangePag(c.dataPagamento)) {
            recebido += val;
            recebidoLiquido += liq;
            totalCobrancas++;
          }
        } else if (c.status === "PENDING") {
          if (noRangeVenc(c.vencimento)) {
            pendente += val;
            totalCobrancas++;
          }
        } else if (c.status === "OVERDUE") {
          if (noRangeVenc(c.vencimento)) {
            vencido += val;
            totalCobrancas++;
          }
        }
      }

      return { recebido, recebidoLiquido, pendente, vencido, totalCobrancas };
    } catch {
      return ZERO;
    }
  }),

  /** Fluxo de caixa mensal — últimos N meses, agrupado por mês de vencimento/pagamento */
  cashFlowMensal: protectedProcedure
    .input(
      z
        .object({
          /** Quantidade de meses contando do mês corrente pra trás. Ignorado se
           *  `dataInicio` e `dataFim` forem informados. Default: 6. */
          meses: z.number().int().min(1).max(24).optional(),
          /** Range customizado — primeiro dia do mês inicial (YYYY-MM-DD). */
          dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          /** Range customizado — último dia do mês final (YYYY-MM-DD). */
          dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      type Bucket = { recebido: number; pendente: number; vencido: number };
      const ZERO = { granularidade: "mes" as "mes" | "dia", pontos: [] as Array<{ chave: string } & Bucket>, totalRecebido: 0, totalPendente: 0, totalVencido: 0 };

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return ZERO;
      const db = await getDb();
      if (!db) return ZERO;

      // Decide range + granularidade.
      // - Sem custom: presets contam meses pra trás (granularidade=mes)
      // - Com custom: granularidade=dia se range ≤ 62 dias; senão mes
      const usandoRange = !!(input?.dataInicio && input?.dataFim);
      let granularidade: "dia" | "mes" = "mes";
      let chaves: string[] = [];

      if (usandoRange) {
        const ini = new Date(`${input!.dataInicio}T00:00:00`);
        const fim = new Date(`${input!.dataFim}T00:00:00`);
        if (ini > fim) return ZERO;
        const diffDias = Math.round((fim.getTime() - ini.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        granularidade = diffDias <= 62 ? "dia" : "mes";

        if (granularidade === "dia") {
          // Hard cap de 366 dias pra range diário (caso o threshold mude).
          const cursor = new Date(ini);
          let i = 0;
          while (i < 366) {
            chaves.push(cursor.toISOString().slice(0, 10));
            if (cursor.getTime() >= fim.getTime()) break;
            cursor.setDate(cursor.getDate() + 1);
            i++;
          }
        } else {
          const cursor = new Date(ini.getFullYear(), ini.getMonth(), 1);
          const fimChave = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, "0")}`;
          let i = 0;
          while (i < 36) {
            const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
            chaves.push(k);
            if (k === fimChave) break;
            cursor.setMonth(cursor.getMonth() + 1);
            i++;
          }
        }
      } else {
        const meses = input?.meses ?? 6;
        const hoje = new Date();
        for (let i = meses - 1; i >= 0; i--) {
          const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
          chaves.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
        }
      }

      try {
        const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
        if (visiveis !== null && visiveis.length === 0) return ZERO;
        const conds = [eq(asaasCobrancas.escritorioId, esc.escritorio.id)];
        if (visiveis !== null) conds.push(inArray(asaasCobrancas.contatoId, visiveis));
        const todas = await db.select().from(asaasCobrancas).where(and(...conds));

        const buckets = new Map<string, Bucket>();
        for (const k of chaves) buckets.set(k, { recebido: 0, pendente: 0, vencido: 0 });

        let totalRecebido = 0, totalPendente = 0, totalVencido = 0;
        const hojeStr = new Date().toISOString().slice(0, 10);
        const sliceLen = granularidade === "dia" ? 10 : 7;

        for (const c of todas) {
          const valor = parseFloat(c.valor) || 0;
          const pago = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status);
          const refDate = pago ? (c.dataPagamento || c.vencimento) : c.vencimento;
          if (!refDate) continue;
          const chave = refDate.slice(0, sliceLen);
          const bucket = buckets.get(chave);
          // Totais só contam o que cai DENTRO do range escolhido pelo usuário
          // (bate com o que o gráfico mostra). Sem essa guarda, o número
          // grande do hero ficaria com o acumulado histórico do escritório.
          if (!bucket) continue;

          if (pago) {
            totalRecebido += valor;
            bucket.recebido += valor;
          } else if (c.status === "PENDING") {
            if (c.vencimento < hojeStr) {
              totalVencido += valor;
              bucket.vencido += valor;
            } else {
              totalPendente += valor;
              bucket.pendente += valor;
            }
          } else if (c.status === "OVERDUE") {
            totalVencido += valor;
            bucket.vencido += valor;
          }
        }

        const pontos = Array.from(buckets.entries()).map(([chave, v]) => ({
          chave,
          recebido: Math.round(v.recebido * 100) / 100,
          pendente: Math.round(v.pendente * 100) / 100,
          vencido: Math.round(v.vencido * 100) / 100,
        }));

        return { granularidade, pontos, totalRecebido, totalPendente, totalVencido };
      } catch {
        return ZERO;
      }
    }),

  /** Previsão de recebimentos — próximos N dias, agrupado por semana */
  forecast: protectedProcedure
    .input(z.object({ dias: z.number().int().min(7).max(90).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { semanas: [], total: 0, atrasado: 0 };
      const db = await getDb();
      if (!db) return { semanas: [], total: 0, atrasado: 0 };

      const dias = input?.dias ?? 30;
      try {
        const hoje = new Date();
        const fim = new Date();
        fim.setDate(fim.getDate() + dias);
        const hojeStr = hoje.toISOString().slice(0, 10);
        const fimStr = fim.toISOString().slice(0, 10);

        const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
        if (visiveis !== null && visiveis.length === 0) {
          return { semanas: [], total: 0, atrasado: 0 };
        }
        const condsP: any[] = [
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          eq(asaasCobrancas.status, "PENDING"),
        ];
        if (visiveis !== null) condsP.push(inArray(asaasCobrancas.contatoId, visiveis));
        const pendentes = await db.select().from(asaasCobrancas).where(and(...condsP));

        const semanas: { semana: string; label: string; valor: number; quantidade: number }[] = [];
        let total = 0;
        let atrasado = 0;

        for (let sem = 0; sem < Math.ceil(dias / 7); sem++) {
          const ini = new Date(hoje);
          ini.setDate(ini.getDate() + sem * 7);
          const fimSem = new Date(ini);
          fimSem.setDate(fimSem.getDate() + 6);
          const iniStr = ini.toISOString().slice(0, 10);
          const fimSemStr = fimSem.toISOString().slice(0, 10);
          semanas.push({
            semana: iniStr,
            label: `${ini.getDate()}/${ini.getMonth() + 1} - ${fimSem.getDate()}/${fimSem.getMonth() + 1}`,
            valor: 0,
            quantidade: 0,
          });
        }

        for (const c of pendentes) {
          const valor = parseFloat(c.valor) || 0;
          if (!c.vencimento) continue;

          if (c.vencimento < hojeStr) {
            atrasado += valor;
            continue;
          }
          if (c.vencimento > fimStr) continue;

          total += valor;
          const diffDias = Math.floor(
            (new Date(c.vencimento).getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24),
          );
          const idxSem = Math.min(semanas.length - 1, Math.max(0, Math.floor(diffDias / 7)));
          semanas[idxSem].valor += valor;
          semanas[idxSem].quantidade += 1;
        }

        return { semanas, total, atrasado };
      } catch {
        return { semanas: [], total: 0, atrasado: 0 };
      }
    }),

  // ─── CLIENTES ASAAS (CRUD) ─────────────────────────────────────────────

  /** Criar cliente direto no Asaas + vincular ao CRM */
  criarClienteAsaas: protectedProcedure
    .input(z.object({
      nome: z.string().min(1).max(255),
      cpfCnpj: z.string().min(11).max(18),
      email: z.string().email().optional(),
      telefone: z.string().optional(),
      cep: z.string().optional(),
      endereco: z.string().optional(),
      numero: z.string().optional(),
      bairro: z.string().optional(),
      /**
       * Colaborador responsável pelo cliente — recebe a conversa quando o
       * cliente entra em contato E recebe comissão pelas cobranças.
       * Refletido como `groupName` no painel Asaas.
       */
      responsavelId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "criar");
      if (!perm.criar) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para criar clientes no módulo Financeiro.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const cpfLimpo = input.cpfCnpj.replace(/\D/g, "");

      // Resolve responsável (opcional) — define `groupName` no Asaas e fica
      // gravado em `contatos.responsavelId` para inferência de comissão.
      let atendenteNome: string | undefined;
      if (input.responsavelId !== undefined) {
        const v = await validarAtendente(esc.escritorio.id, input.responsavelId);
        atendenteNome = v.nome ?? undefined;
      }

      // 1. Verificar se já vinculado localmente por CPF
      const [localExistente] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.cpfCnpj, cpfLimpo), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);

      // 2. Buscar no Asaas por CPF
      let asaasCli: { id: string; name: string } | null = null;
      try {
        asaasCli = await client.buscarClientePorCpfCnpj(cpfLimpo);
      } catch (err: any) {
        log.warn({ err: err.message, cpf: cpfLimpo }, "Busca Asaas por CPF falhou");
        if (localExistente) {
          asaasCli = { id: localExistente.asaasCustomerId, name: localExistente.nome || input.nome };
        } else {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Não foi possível verificar se o cliente já existe no Asaas. Tente novamente.",
          });
        }
      }

      // 3. Se não existe, criar
      if (!asaasCli) {
        asaasCli = await client.criarCliente({
          name: input.nome,
          cpfCnpj: cpfLimpo,
          email: input.email,
          mobilePhone: input.telefone?.replace(/\D/g, ""),
          postalCode: input.cep?.replace(/\D/g, ""),
          address: input.endereco,
          addressNumber: input.numero,
          province: input.bairro,
          groupName: atendenteNome,
        });
      } else if (atendenteNome) {
        // Cliente já existia no Asaas → atualiza só o agrupador. Falha silenciosa
        // pra não quebrar o cadastro (groupName é metadado, não bloqueante).
        try {
          await client.atualizarCliente(asaasCli.id, { groupName: atendenteNome });
        } catch (err: any) {
          log.warn({ err: err.message, asaasId: asaasCli.id }, "Falha ao atualizar groupName no Asaas");
        }
      }

      // Verificar/criar contato no CRM
      let contatoId: number;
      const [contatoExistente] = await db.select().from(contatos)
        .where(and(eq(contatos.escritorioId, esc.escritorio.id), like(contatos.cpfCnpj, `%${cpfLimpo}%`)))
        .limit(1);

      if (contatoExistente) {
        contatoId = contatoExistente.id;
        // Atualiza responsável se mudou (ou se preenchendo pela 1ª vez).
        if (
          input.responsavelId !== undefined &&
          contatoExistente.responsavelId !== input.responsavelId
        ) {
          await db
            .update(contatos)
            .set({ responsavelId: input.responsavelId })
            .where(eq(contatos.id, contatoId));
        }
      } else {
        const [novo] = await db.insert(contatos).values({
          escritorioId: esc.escritorio.id,
          nome: input.nome,
          cpfCnpj: cpfLimpo,
          email: input.email || null,
          telefone: input.telefone || null,
          origem: "manual",
          responsavelId: input.responsavelId ?? null,
        }).$returningId();
        contatoId = novo.id;
      }

      // Vincular
      const [jaVinculado] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.asaasCustomerId, asaasCli.id), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!jaVinculado) {
        await db.insert(asaasClientes).values({
          escritorioId: esc.escritorio.id,
          contatoId,
          asaasCustomerId: asaasCli.id,
          cpfCnpj: cpfLimpo,
          nome: asaasCli.name,
        });
      }

      return { success: true, asaasCustomerId: asaasCli.id, contatoId };
    }),

  /** Listar clientes vinculados ao Asaas */
  listarClientesVinculados: protectedProcedure
    .input(z.object({ busca: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];

      const db = await getDb();
      if (!db) return [];

      try {
        const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
        if (visiveis !== null && visiveis.length === 0) return [];

        const conditions: any[] = [eq(asaasClientes.escritorioId, esc.escritorio.id)];
        if (visiveis !== null) conditions.push(inArray(asaasClientes.contatoId, visiveis));
        if (input?.busca) {
          const b = `%${input.busca}%`;
          conditions.push(or(like(asaasClientes.nome, b), like(asaasClientes.cpfCnpj, b)));
        }

        const vinculosRaw = await db.select().from(asaasClientes).where(and(...conditions));
        if (vinculosRaw.length === 0) return [];

        // Agrega vários customers Asaas (mesmo CPF, duplicatas permitidas pelo
        // Asaas) num único item por contato do CRM. Sem deletar nada — o
        // vínculo N:1 é parte do modelo: ver comentário em agregarVinculosPorContato.
        const contatoIds = [...new Set(vinculosRaw.map((v) => v.contatoId))];
        const customerIds = [...new Set(vinculosRaw.map((v) => v.asaasCustomerId))];

        const contatosList = await db
          .select({
            id: contatos.id,
            nome: contatos.nome,
            telefone: contatos.telefone,
            email: contatos.email,
          })
          .from(contatos)
          .where(and(
            eq(contatos.escritorioId, esc.escritorio.id),
            inArray(contatos.id, contatoIds),
          ));
        const contatosMeta: Record<number, ContatoMeta> = {};
        for (const c of contatosList) {
          contatosMeta[c.id] = { nome: c.nome, telefone: c.telefone, email: c.email };
        }

        const cobrancasRaw = customerIds.length > 0
          ? await db
              .select({
                asaasCustomerId: asaasCobrancas.asaasCustomerId,
                valor: asaasCobrancas.valor,
                status: asaasCobrancas.status,
              })
              .from(asaasCobrancas)
              .where(and(
                eq(asaasCobrancas.escritorioId, esc.escritorio.id),
                inArray(asaasCobrancas.asaasCustomerId, customerIds),
              ))
          : [];

        const vinculos: VinculoLinha[] = vinculosRaw.map((v) => ({
          id: v.id,
          contatoId: v.contatoId,
          asaasCustomerId: v.asaasCustomerId,
          cpfCnpj: v.cpfCnpj,
          nome: v.nome,
          primario: (v as { primario?: boolean | null }).primario ?? null,
        }));
        // Filtra cobranças com asaasCustomerId não-null — cobranças
        // manuais (sem vínculo Asaas) não entram nessa agregação que
        // depende do customerId.
        const cobrancas: CobrancaAgg[] = cobrancasRaw
          .filter((c): c is typeof c & { asaasCustomerId: string } => c.asaasCustomerId !== null)
          .map((c) => ({
            asaasCustomerId: c.asaasCustomerId,
            valor: c.valor,
            status: c.status,
          }));

        return agregarVinculosPorContato(vinculos, cobrancas, contatosMeta);
      } catch {
        return [];
      }
    }),

  // ─── EXCLUIR COBRANÇA ──────────────────────────────────────────────────

  /** Exclui/cancela uma cobrança no Asaas */
  excluirCobranca: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "excluir");
      if (!perm.excluir) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para excluir cobranças no módulo Financeiro.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cob] = await db.select().from(asaasCobrancas)
        .where(and(eq(asaasCobrancas.id, input.id), eq(asaasCobrancas.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!cob) throw new TRPCError({ code: "NOT_FOUND" });

      // Cobrança manual: deleta direto, sem chamar Asaas (não passou
      // pela API). Cobrança Asaas: chama API e depois remove local.
      if (cob.origem === "manual" || !cob.asaasPaymentId) {
        await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, input.id));
      } else {
        await client.excluirCobranca(cob.asaasPaymentId);
        await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, input.id));
      }

      return { success: true };
    }),

  /**
   * Obtém QR Code Pix de uma cobrança. Mutation (não query) porque
   * tem efeito colateral: cacheia o payload em `pixQrCodePayload` na
   * primeira chamada — assim cobranças PIX antigas (criadas antes do
   * cacheamento) param de bater no Asaas a cada copy.
   */
  obterPixQrCode: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cob] = await db
        .select()
        .from(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.id, input.id),
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);

      if (!cob) throw new TRPCError({ code: "NOT_FOUND" });

      // Cache hit — pula chamada externa.
      if (cob.pixQrCodePayload) {
        return { payload: cob.pixQrCodePayload, image: null, fromCache: true };
      }

      // Cobrança manual não tem QR Asaas — devolve null pra UI tratar.
      if (!cob.asaasPaymentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cobrança manual não tem QR Code Pix do Asaas.",
        });
      }

      const client = await requireAsaasClient(esc.escritorio.id);
      try {
        const qr = await client.obterPixQrCode(cob.asaasPaymentId);
        if (qr?.payload) {
          await db
            .update(asaasCobrancas)
            .set({ pixQrCodePayload: qr.payload })
            .where(eq(asaasCobrancas.id, cob.id));
        }
        return { payload: qr.payload, image: qr.encodedImage, fromCache: false };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Falha ao buscar QR Code Pix",
        });
      }
    }),

  /** Obtém linha digitável do boleto */
  obterLinhaDigitavel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cob] = await db.select().from(asaasCobrancas)
        .where(and(eq(asaasCobrancas.id, input.id), eq(asaasCobrancas.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!cob) throw new TRPCError({ code: "NOT_FOUND" });
      if (!cob.asaasPaymentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cobrança manual não tem boleto.",
        });
      }

      try {
        return await client.obterLinhaDigitavel(cob.asaasPaymentId);
      } catch {
        return null;
      }
    }),

  // ─── ASSINATURAS (RECORRÊNCIA) ─────────────────────────────────────────

  /** Criar assinatura recorrente */
  criarAssinatura: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      valor: z.number().min(0.01),
      proximoVencimento: z.string(),
      ciclo: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUALLY", "YEARLY"]),
      formaPagamento: z.enum(["BOLETO", "CREDIT_CARD", "PIX", "UNDEFINED"]),
      descricao: z.string().max(512).optional(),
      // Config de comissão — aplicada nas cobranças geradas pela
      // assinatura via webhook.
      atendenteId: z.number().optional(),
      categoriaId: z.number().optional(),
      comissionavelOverride: z.boolean().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "criar");
      if (!perm.criar) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para criar assinaturas no módulo Financeiro.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [vinculo] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!vinculo) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Contato não vinculado ao Asaas." });

      let assinatura;
      try {
        assinatura = await client.criarAssinatura({
          customer: vinculo.asaasCustomerId,
          billingType: input.formaPagamento,
          value: input.valor,
          nextDueDate: input.proximoVencimento,
          cycle: input.ciclo,
          description: input.descricao,
        });
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err?.message || "Erro ao criar assinatura no Asaas" });
      }

      // Persiste config se algum flag foi informado. Sem flags, mantém
      // path legado (webhook usa responsavelId do contato).
      if (input.atendenteId || input.categoriaId || input.comissionavelOverride !== undefined) {
        try {
          await db.insert(asaasConfigCobrancaPai).values({
            escritorioId: esc.escritorio.id,
            tipo: "assinatura",
            asaasParentId: assinatura.id,
            atendenteId: input.atendenteId ?? null,
            categoriaId: input.categoriaId ?? null,
            comissionavelOverride: input.comissionavelOverride ?? null,
          });
        } catch (err: any) {
          // Não-fatal: assinatura já criada. Loga e segue.
          console.warn("[criarAssinatura] falha ao salvar config de comissão", err?.message);
        }
      }

      return { success: true, assinaturaId: assinatura.id, status: assinatura.status };
    }),

  /** Listar assinaturas do escritório */
  listarAssinaturas: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];

    const client = await getAsaasClient(esc.escritorio.id);
    if (!client) return [];

    const db = await getDb();
    if (!db) return [];

    try {
      const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
      if (visiveis !== null && visiveis.length === 0) return [];

      // Buscar clientes vinculados (filtrados por permissão se aplicável)
      const condsV: any[] = [eq(asaasClientes.escritorioId, esc.escritorio.id)];
      if (visiveis !== null) condsV.push(inArray(asaasClientes.contatoId, visiveis));
      const vinculos = await db.select().from(asaasClientes).where(and(...condsV));

      const assinaturas = [];
      for (const v of vinculos) {
        try {
          const res = await client.listarAssinaturas({ customer: v.asaasCustomerId, limit: 50 });
          for (const sub of res.data) {
            if (!sub.deleted) {
              assinaturas.push({ ...sub, contatoId: v.contatoId, contatoNome: v.nome || "—" });
            }
          }
        } catch {}
      }

      return assinaturas;
    } catch {
      return [];
    }
  }),

  /** Cancelar assinatura */
  cancelarAssinatura: protectedProcedure
    .input(z.object({ assinaturaId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "excluir");
      if (!perm.excluir) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para cancelar assinaturas no módulo Financeiro.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);

      await client.cancelarAssinatura(input.assinaturaId);
      return { success: true };
    }),

  // ─── PARCELAMENTOS ─────────────────────────────────────────────────────

  /**
   * Criar cobrança parcelada — modo LOCAL.
   *
   * Em vez de usar o /installments do Asaas (que junta tudo no cartão de
   * crédito como 1 transação parcelada na fatura), criamos N cobranças
   * avulsas independentes com vencimentos mensais sequenciais. Cada
   * parcela é amarrada pelo `parcelamentoLocalId` pra agrupar visualmente
   * no CRM. Resultado: cliente paga cada parcela com o método que quiser
   * (cartão na 1, PIX na 2, boleto na 3 — totalmente independente).
   *
   * Se uma parcela falhar ao criar no Asaas, as anteriores **não são
   * revertidas** — o usuário vê o erro e pode tentar criar as restantes
   * manualmente. Não fazemos rollback porque cobranças no Asaas têm
   * cancelamento próprio e rollback em massa é arriscado.
   */
  criarParcelamento: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      valorTotal: z.number().min(0.01),
      parcelas: z.number().min(2).max(24),
      vencimento: z.string(),
      formaPagamento: z.enum(["BOLETO", "CREDIT_CARD", "PIX", "UNDEFINED"]),
      descricao: z.string().max(512).optional(),
      atendenteId: z.number().optional(),
      categoriaId: z.number().optional(),
      comissionavelOverride: z.boolean().nullable().optional(),
      /**
       * Ações vinculadas (cliente_processos.id). Cada parcela criada
       * herda o mesmo conjunto de ações — seu cenário do "pacote"
       * (R$ 3.000 em 3x ativando 3 ações distintas) funciona aqui.
       */
      processoIds: z.array(z.number().int().positive()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "criar");
      if (!perm.criar) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para criar parcelamentos no módulo Financeiro.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [vinculo] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!vinculo) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Contato não vinculado ao Asaas." });

      // Valida ações UMA VEZ pra todo o parcelamento (mesmo conjunto vai
      // pra cada parcela criada).
      const acoesValidas = await validarProcessoIds(
        esc.escritorio.id,
        input.contatoId,
        input.processoIds,
      );

      const parcelamentoLocalId = nanoid(16);
      const descBase = input.descricao || "Parcelamento";
      const plano = calcularParcelas(input.valorTotal, input.parcelas, input.vencimento);

      const parcelasCriadas: Array<{ asaasPaymentId: string; parcelaAtual: number; valor: number }> = [];
      let erroParcela: { numero: number; mensagem: string } | null = null;

      for (const p of plano) {
        try {
          const cobranca = await client.criarCobranca({
            customer: vinculo.asaasCustomerId,
            billingType: input.formaPagamento,
            value: p.valor,
            dueDate: p.vencimento,
            description: `${descBase} — parcela ${p.parcelaAtual}/${p.parcelaTotal}`,
          });

          await db.insert(asaasCobrancas).values({
            escritorioId: esc.escritorio.id,
            contatoId: input.contatoId,
            asaasPaymentId: cobranca.id,
            asaasCustomerId: vinculo.asaasCustomerId,
            origem: "asaas",
            valor: p.valor.toFixed(2),
            vencimento: p.vencimento,
            formaPagamento: input.formaPagamento,
            status: cobranca.status,
            descricao: `${descBase} — parcela ${p.parcelaAtual}/${p.parcelaTotal}`,
            invoiceUrl: cobranca.invoiceUrl || null,
            bankSlipUrl: cobranca.bankSlipUrl || null,
            atendenteId: input.atendenteId ?? null,
            categoriaId: input.categoriaId ?? null,
            comissionavelOverride: input.comissionavelOverride ?? null,
            parcelamentoLocalId,
            parcelaAtual: p.parcelaAtual,
            parcelaTotal: p.parcelaTotal,
          }).onDuplicateKeyUpdate({
            // Caso o webhook PAYMENT_CREATED do Asaas tenha chegado antes
            // do nosso INSERT (corrida rara), preserva os campos do
            // parcelamento que o webhook desconhece.
            set: {
              parcelamentoLocalId,
              parcelaAtual: p.parcelaAtual,
              parcelaTotal: p.parcelaTotal,
              atendenteId: input.atendenteId ?? null,
              categoriaId: input.categoriaId ?? null,
              comissionavelOverride: input.comissionavelOverride ?? null,
            },
          });

          // Busca o id local pela chave única (asaasPaymentId) — o
          // onDuplicateKeyUpdate não retorna insertId confiável em update.
          if (acoesValidas.length > 0) {
            const [cobLocal] = await db
              .select({ id: asaasCobrancas.id })
              .from(asaasCobrancas)
              .where(
                and(
                  eq(asaasCobrancas.escritorioId, esc.escritorio.id),
                  eq(asaasCobrancas.asaasPaymentId, cobranca.id),
                ),
              )
              .limit(1);
            if (cobLocal) {
              await vincularCobrancaAcoes(cobLocal.id, acoesValidas);
            }
          }

          parcelasCriadas.push({ asaasPaymentId: cobranca.id, parcelaAtual: p.parcelaAtual, valor: p.valor });
        } catch (err: any) {
          erroParcela = { numero: p.parcelaAtual, mensagem: err?.message || String(err) };
          break;
        }
      }

      if (erroParcela) {
        const detalhe = parcelasCriadas.length === 0
          ? `Falha ao criar a 1ª parcela: ${erroParcela.mensagem}`
          : `${parcelasCriadas.length} parcela(s) criadas. Falhou na ${erroParcela.numero}ª: ${erroParcela.mensagem}. ` +
            `Você pode tentar criar as parcelas restantes manualmente.`;
        throw new TRPCError({ code: "BAD_REQUEST", message: detalhe });
      }

      return {
        success: true,
        parcelamentoLocalId,
        parcelas: parcelasCriadas,
      };
    }),

  /** Obter saldo da conta Asaas — só visível pra quem tem verTodos
   *  no módulo financeiro. Saldo é informação do escritório, não
   *  pertence a um colaborador individual. */
  obterSaldo: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;

    const perm = await checkPermission(ctx.user.id, "financeiro", "ver");
    if (!perm.verTodos) return null;

    const client = await getAsaasClient(esc.escritorio.id);
    if (!client) return null;

    try {
      return await client.obterSaldo();
    } catch {
      return null;
    }
  }),
});
