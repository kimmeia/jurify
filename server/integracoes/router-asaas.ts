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
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { asaasConfig, asaasClientes, asaasCobrancas, contatos, users } from "../../drizzle/schema";
import { eq, and, desc, like, or, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { encrypt, decrypt, generateWebhookSecret, maskToken } from "../escritorio/crypto-utils";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { AsaasClient } from "./asaas-client";
import { syncCobrancasDeCliente, syncCobrancasEscritorio } from "./asaas-sync";
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
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Testar a key
      const client = new AsaasClient(input.apiKey);
      const teste = await client.testarConexao();

      if (!teste.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: teste.mensagem + (teste.detalhes ? ` (${teste.detalhes})` : ""),
        });
      }

      // Criptografar
      const { encrypted, iv, tag } = encrypt(input.apiKey);
      const webhookToken = generateWebhookSecret();

      // Upsert config
      const [existing] = await db.select().from(asaasConfig)
        .where(eq(asaasConfig.escritorioId, esc.escritorio.id)).limit(1);

      if (existing) {
        await db.update(asaasConfig).set({
          apiKeyEncrypted: encrypted,
          apiKeyIv: iv,
          apiKeyTag: tag,
          modo: client.modo,
          status: "conectado",
          webhookToken,
          ultimoTeste: new Date(),
          mensagemErro: null,
          saldo: teste.saldo?.toString() || null,
        }).where(eq(asaasConfig.id, existing.id));
      } else {
        await db.insert(asaasConfig).values({
          escritorioId: esc.escritorio.id,
          apiKeyEncrypted: encrypted,
          apiKeyIv: iv,
          apiKeyTag: tag,
          modo: client.modo,
          status: "conectado",
          webhookToken,
          ultimoTeste: new Date(),
          saldo: teste.saldo?.toString() || null,
        });
      }

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

  desconectar: protectedProcedure.mutation(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await db.update(asaasConfig).set({
      status: "desconectado",
      apiKeyEncrypted: null,
      apiKeyIv: null,
      apiKeyTag: null,
      saldo: null,
    }).where(eq(asaasConfig.escritorioId, esc.escritorio.id));

    return { success: true };
  }),

  // ─── SYNC CLIENTES ───────────────────────────────────────────────────────

  /** Sincroniza clientes do Asaas com contatos do CRM por CPF/CNPJ */
  sincronizarClientes: protectedProcedure.mutation(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    const client = await requireAsaasClient(esc.escritorio.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    let offset = 0;
    let hasMore = true;
    let vinculados = 0;
    let novos = 0;
    let removidos = 0;
    const idsAsaas = new Set<string>(); // Rastreia todos os clientes ativos no Asaas

    while (hasMore) {
      const page = await client.listarClientes(offset, 100);

      for (const asaasCli of page.data) {
        // Se deletado no Asaas, marcar para remoção
        if (asaasCli.deleted) {
          const [vinc] = await db.select({ id: asaasClientes.id, contatoId: asaasClientes.contatoId })
            .from(asaasClientes)
            .where(and(
              eq(asaasClientes.escritorioId, esc.escritorio.id),
              eq(asaasClientes.asaasCustomerId, asaasCli.id)
            )).limit(1);
          if (vinc) {
            await db.delete(asaasClientes).where(eq(asaasClientes.id, vinc.id));
            removidos++;
            log.info(`[Asaas Sync] Cliente ${asaasCli.id} deletado localmente`);
          }
          continue;
        }
        if (!asaasCli.cpfCnpj) continue;

        idsAsaas.add(asaasCli.id);
        const cpfLimpo = asaasCli.cpfCnpj.replace(/\D/g, "");

        // Verificar se já existe vínculo
        const [jaVinculado] = await db.select().from(asaasClientes)
          .where(and(
            eq(asaasClientes.escritorioId, esc.escritorio.id),
            eq(asaasClientes.asaasCustomerId, asaasCli.id)
          )).limit(1);

        if (jaVinculado) continue;

        // Procurar contato por CPF/CNPJ
        const [contato] = await db.select().from(contatos)
          .where(and(
            eq(contatos.escritorioId, esc.escritorio.id),
            or(
              eq(contatos.cpfCnpj, cpfLimpo),
              eq(contatos.cpfCnpj, asaasCli.cpfCnpj),
              like(contatos.cpfCnpj, `%${cpfLimpo}%`)
            )
          )).limit(1);

        if (contato) {
          // Vincular contato existente — ATUALIZAR dados com nome novo do Asaas
          await db.update(contatos).set({
            nome: asaasCli.name,
            cpfCnpj: cpfLimpo,
            email: asaasCli.email || contato.email,
            telefone: asaasCli.mobilePhone || asaasCli.phone || contato.telefone,
          }).where(eq(contatos.id, contato.id));

          // Remover vínculos antigos para este contato
          await db.delete(asaasClientes).where(and(
            eq(asaasClientes.escritorioId, esc.escritorio.id),
            eq(asaasClientes.contatoId, contato.id)
          ));

          await db.insert(asaasClientes).values({
            escritorioId: esc.escritorio.id,
            contatoId: contato.id,
            asaasCustomerId: asaasCli.id,
            cpfCnpj: cpfLimpo,
            nome: asaasCli.name,
          });
          vinculados++;
        } else {
          // Criar contato novo no CRM
          const [novoContato] = await db.insert(contatos).values({
            escritorioId: esc.escritorio.id,
            nome: asaasCli.name,
            cpfCnpj: cpfLimpo,
            email: asaasCli.email || null,
            telefone: asaasCli.mobilePhone || asaasCli.phone || null,
            origem: "manual",
          }).$returningId();

          await db.insert(asaasClientes).values({
            escritorioId: esc.escritorio.id,
            contatoId: novoContato.id,
            asaasCustomerId: asaasCli.id,
            cpfCnpj: cpfLimpo,
            nome: asaasCli.name,
          });
          novos++;
        }
      }

      hasMore = page.hasMore;
      offset += page.limit;
    }

    // Remover vínculos órfãos: clientes que existem localmente mas não retornaram do Asaas
    // (caso o cliente tenha sido deletado e nem aparece mais como deleted=true)
    const vinculosLocais = await db.select({ id: asaasClientes.id, asaasCustomerId: asaasClientes.asaasCustomerId })
      .from(asaasClientes)
      .where(eq(asaasClientes.escritorioId, esc.escritorio.id));

    for (const vinc of vinculosLocais) {
      if (!idsAsaas.has(vinc.asaasCustomerId)) {
        await db.delete(asaasClientes).where(eq(asaasClientes.id, vinc.id));
        removidos++;
        log.info(`[Asaas Sync] Cliente órfão ${vinc.asaasCustomerId} removido (não existe mais no Asaas)`);
      }
    }

    // Após sincronizar clientes, sincronizar cobranças de todos os vinculados
    let cobNovas = 0, cobAtualizadas = 0, cobRemovidas = 0;
    try {
      const result = await syncCobrancasEscritorio(esc.escritorio.id);
      cobNovas = result.novas;
      cobAtualizadas = result.atualizadas;
      cobRemovidas = result.removidas;
    } catch (err: any) {
      log.warn(`[Asaas] Erro ao sincronizar cobranças: ${err.message}`);
    }

    return {
      vinculados,
      novos,
      removidos,
      total: vinculados + novos,
      // Contadores granulares de cobranças (toast do frontend usa estes)
      cobNovas,
      cobAtualizadas,
      cobRemovidas,
      // Mantém legado para retrocompatibilidade (soma total)
      cobrancasSincronizadas: cobNovas + cobAtualizadas + cobRemovidas,
    };
  }),

  /** Vincula um contato específico ao Asaas (cria cliente no Asaas se não existir) */
  vincularContato: protectedProcedure
    .input(z.object({ contatoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Buscar contato
      const [contato] = await db.select().from(contatos)
        .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!contato) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado" });
      if (!contato.cpfCnpj) throw new TRPCError({ code: "BAD_REQUEST", message: "Contato sem CPF/CNPJ. Preencha o CPF/CNPJ primeiro." });

      const cpfLimpo = contato.cpfCnpj.replace(/\D/g, "");

      // 1. Verificar se este contato já está vinculado localmente
      const [jaVinculado] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (jaVinculado) return { success: true, asaasCustomerId: jaVinculado.asaasCustomerId, jaExistia: true, novoClienteCriado: false, cobrancasSincronizadas: 0 };

      // 2. Verificar se OUTRO contato com mesmo CPF já está vinculado localmente
      //    (evita duplicar no Asaas quando há contatos duplicados no CRM)
      const [mesmoCpfVinculado] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.cpfCnpj, cpfLimpo), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (mesmoCpfVinculado) {
        // Já existe vínculo com esse CPF — reusar o customer do Asaas
        await db.insert(asaasClientes).values({
          escritorioId: esc.escritorio.id,
          contatoId: input.contatoId,
          asaasCustomerId: mesmoCpfVinculado.asaasCustomerId,
          cpfCnpj: cpfLimpo,
          nome: contato.nome,
        });
        // Sync cobranças do customer reutilizado
        let cobSync = 0;
        try {
          const r = await syncCobrancasDeCliente(client, esc.escritorio.id, input.contatoId, mesmoCpfVinculado.asaasCustomerId);
          cobSync = r.novas + r.atualizadas;
        } catch { /* não bloqueia */ }
        return { success: true, asaasCustomerId: mesmoCpfVinculado.asaasCustomerId, jaExistia: true, novoClienteCriado: false, cobrancasSincronizadas: cobSync };
      }

      // 3. Buscar no Asaas por CPF/CNPJ (API)
      let asaasCli: { id: string; name: string } | null = null;
      try {
        asaasCli = await client.buscarClientePorCpfCnpj(cpfLimpo);
      } catch (err: any) {
        log.warn({ err: err.message, cpf: cpfLimpo }, "Busca Asaas por CPF falhou — NÃO criando duplicata");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível verificar se o cliente já existe no Asaas. Tente novamente em alguns minutos.",
        });
      }

      // 4. Se não existe no Asaas, validar dados mínimos e criar
      let novoClienteCriado = false;
      if (!asaasCli) {
        if (!contato.nome || contato.nome.length < 2) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Preencha o nome do contato antes de vincular ao financeiro." });
        }
        asaasCli = await client.criarCliente({
          name: contato.nome,
          cpfCnpj: cpfLimpo,
          email: contato.email || undefined,
          mobilePhone: contato.telefone?.replace(/\D/g, "") || undefined,
        });
        novoClienteCriado = true;
      }

      // Salvar vínculo
      await db.insert(asaasClientes).values({
        escritorioId: esc.escritorio.id,
        contatoId: input.contatoId,
        asaasCustomerId: asaasCli.id,
        cpfCnpj: cpfLimpo,
        nome: asaasCli.name,
      });

      // Puxar cobranças existentes deste cliente no Asaas
      let cobrancasSincronizadas = 0;
      try {
        const resultado = await syncCobrancasDeCliente(client, esc.escritorio.id, input.contatoId, asaasCli.id);
        cobrancasSincronizadas = resultado.novas + resultado.atualizadas;
      } catch (err: any) {
        log.warn({ err: err.message }, "Sync de cobranças após vincular falhou (não bloqueia)");
      }

      return {
        success: true,
        asaasCustomerId: asaasCli.id,
        jaExistia: false,
        novoClienteCriado,
        cobrancasSincronizadas,
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
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Buscar vínculo Asaas do contato
      const [vinculo] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!vinculo) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Contato não vinculado ao Asaas. Vincule o contato primeiro.",
        });
      }

      // Criar cobrança no Asaas
      const cobranca = await client.criarCobranca({
        customer: vinculo.asaasCustomerId,
        billingType: input.formaPagamento,
        value: input.valor,
        dueDate: input.vencimento,
        description: input.descricao,
      });

      // Salvar localmente
      await db.insert(asaasCobrancas).values({
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
      });

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

  /** Lista cobranças do escritório com filtros */
  listarCobrancas: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      contatoId: z.number().optional(),
      busca: z.string().optional(),
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

        if (input?.status) conditions.push(eq(asaasCobrancas.status, input.status));
        if (input?.contatoId) conditions.push(eq(asaasCobrancas.contatoId, input.contatoId));

        // Filtro por permissão: se verProprios only, só mostra cobranças
        // de contatos cujo responsável é o próprio colaborador.
        const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
        if (visiveis !== null) {
          if (visiveis.length === 0) return { items: [], total: 0 };
          conditions.push(inArray(asaasCobrancas.contatoId, visiveis));
        }

        const items = await db.select().from(asaasCobrancas)
          .where(and(...conditions))
          .orderBy(desc(asaasCobrancas.createdAt))
          .limit(input?.limit ?? 50)
          .offset(input?.offset ?? 0);

        // Enriquecer com nome do contato
        const contatoIds = [...new Set(items.map((i) => i.contatoId).filter(Boolean))];
        let contatosMap: Record<number, string> = {};
        if (contatoIds.length > 0) {
          const contatosList = await db.select({ id: contatos.id, nome: contatos.nome })
            .from(contatos)
            .where(inArray(contatos.id, contatoIds as number[]));
          contatosMap = Object.fromEntries(contatosList.map((c) => [c.id, c.nome]));
        }

        const enriched = items.map((i) => ({
          ...i,
          nomeContato: i.contatoId ? contatosMap[i.contatoId] || "—" : "—",
        }));

        const allItems = await db.select({ id: asaasCobrancas.id }).from(asaasCobrancas).where(and(...conditions));

        return { items: enriched, total: allItems.length };
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

  /** Sincronizar cobranças de um contato específico com o Asaas (pull) */
  syncCobrancasContato: protectedProcedure
    .input(z.object({ contatoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [vinculo] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!vinculo) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não vinculado ao Asaas" });

      const stats = await syncCobrancasDeCliente(client, esc.escritorio.id, input.contatoId, vinculo.asaasCustomerId);
      // Mantém compatibilidade com o frontend existente (atualizadas = total de mudanças)
      return {
        novas: stats.novas,
        atualizadas: stats.atualizadas,
        removidas: stats.removidas,
        // Retrocompat: total geral de mudanças
        total: stats.novas + stats.atualizadas + stats.removidas,
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
  kpis: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { recebido: 0, pendente: 0, vencido: 0, totalCobrancas: 0 };

    const db = await getDb();
    if (!db) return { recebido: 0, pendente: 0, vencido: 0, totalCobrancas: 0 };

    try {
      const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
      if (visiveis !== null && visiveis.length === 0) {
        return { recebido: 0, pendente: 0, vencido: 0, totalCobrancas: 0 };
      }
      const conds = [eq(asaasCobrancas.escritorioId, esc.escritorio.id)];
      if (visiveis !== null) conds.push(inArray(asaasCobrancas.contatoId, visiveis));
      const todas = await db.select().from(asaasCobrancas).where(and(...conds));

      let recebido = 0, pendente = 0, vencido = 0;
      for (const c of todas) {
        const val = parseFloat(c.valor) || 0;
        if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status)) recebido += val;
        else if (c.status === "PENDING") pendente += val;
        else if (c.status === "OVERDUE") vencido += val;
      }

      return { recebido, pendente, vencido, totalCobrancas: todas.length };
    } catch {
      return { recebido: 0, pendente: 0, vencido: 0, totalCobrancas: 0 };
    }
  }),

  /** Fluxo de caixa mensal — últimos N meses, agrupado por mês de vencimento/pagamento */
  cashFlowMensal: protectedProcedure
    .input(z.object({ meses: z.number().int().min(3).max(24).default(6) }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { pontos: [], totalRecebido: 0, totalPendente: 0, totalVencido: 0 };
      const db = await getDb();
      if (!db) return { pontos: [], totalRecebido: 0, totalPendente: 0, totalVencido: 0 };

      const meses = input?.meses ?? 6;
      try {
        const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
        if (visiveis !== null && visiveis.length === 0) {
          return { pontos: [], totalRecebido: 0, totalPendente: 0, totalVencido: 0 };
        }
        const conds = [eq(asaasCobrancas.escritorioId, esc.escritorio.id)];
        if (visiveis !== null) conds.push(inArray(asaasCobrancas.contatoId, visiveis));
        const todas = await db.select().from(asaasCobrancas).where(and(...conds));

        const porMes = new Map<string, { recebido: number; pendente: number; vencido: number }>();
        const hoje = new Date();
        for (let i = meses - 1; i >= 0; i--) {
          const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          porMes.set(key, { recebido: 0, pendente: 0, vencido: 0 });
        }

        let totalRecebido = 0, totalPendente = 0, totalVencido = 0;
        const hojeStr = hoje.toISOString().slice(0, 10);

        for (const c of todas) {
          const valor = parseFloat(c.valor) || 0;
          const pago = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status);
          const refDate = pago ? (c.dataPagamento || c.vencimento) : c.vencimento;
          if (!refDate) continue;
          const mes = refDate.slice(0, 7);
          const bucket = porMes.get(mes);

          if (pago) {
            totalRecebido += valor;
            if (bucket) bucket.recebido += valor;
          } else if (c.status === "PENDING") {
            if (c.vencimento < hojeStr) {
              totalVencido += valor;
              if (bucket) bucket.vencido += valor;
            } else {
              totalPendente += valor;
              if (bucket) bucket.pendente += valor;
            }
          } else if (c.status === "OVERDUE") {
            totalVencido += valor;
            if (bucket) bucket.vencido += valor;
          }
        }

        const pontos = Array.from(porMes.entries()).map(([mes, v]) => ({
          mes,
          recebido: Math.round(v.recebido * 100) / 100,
          pendente: Math.round(v.pendente * 100) / 100,
          vencido: Math.round(v.vencido * 100) / 100,
        }));

        return { pontos, totalRecebido, totalPendente, totalVencido };
      } catch {
        return { pontos: [], totalRecebido: 0, totalPendente: 0, totalVencido: 0 };
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
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const cpfLimpo = input.cpfCnpj.replace(/\D/g, "");

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
        });
      }

      // Verificar/criar contato no CRM
      let contatoId: number;
      const [contatoExistente] = await db.select().from(contatos)
        .where(and(eq(contatos.escritorioId, esc.escritorio.id), like(contatos.cpfCnpj, `%${cpfLimpo}%`)))
        .limit(1);

      if (contatoExistente) {
        contatoId = contatoExistente.id;
      } else {
        const [novo] = await db.insert(contatos).values({
          escritorioId: esc.escritorio.id,
          nome: input.nome,
          cpfCnpj: cpfLimpo,
          email: input.email || null,
          telefone: input.telefone || null,
          origem: "manual",
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

        const vinculos = await db.select().from(asaasClientes).where(and(...conditions));

        // DEDUPLICAR: se houver múltiplos vínculos para o mesmo contatoId,
        // manter apenas o mais recente (maior id) e DELETAR os antigos
        const porContato = new Map<number, typeof vinculos[0]>();
        const idsParaDeletar: number[] = [];
        for (const v of vinculos) {
          const existente = porContato.get(v.contatoId);
          if (!existente || v.id > existente.id) {
            if (existente) idsParaDeletar.push(existente.id);
            porContato.set(v.contatoId, v);
          } else {
            idsParaDeletar.push(v.id);
          }
        }
        // Limpar duplicatas no banco (silenciosamente)
        for (const id of idsParaDeletar) {
          try { await db.delete(asaasClientes).where(eq(asaasClientes.id, id)); } catch {}
        }

        // Enriquecer com dados do contato (apenas únicos)
        const result = [];
        for (const v of porContato.values()) {
          const [contato] = await db.select({ nome: contatos.nome, telefone: contatos.telefone, email: contatos.email })
            .from(contatos).where(eq(contatos.id, v.contatoId)).limit(1);

          // Contar cobranças
          const cobrancasLocal = await db.select().from(asaasCobrancas)
            .where(and(eq(asaasCobrancas.asaasCustomerId, v.asaasCustomerId), eq(asaasCobrancas.escritorioId, esc.escritorio.id)));

          let pendente = 0, vencido = 0, pago = 0;
          for (const c of cobrancasLocal) {
            const val = parseFloat(c.valor) || 0;
            if (c.status === "PENDING") pendente += val;
            else if (c.status === "OVERDUE") vencido += val;
            else if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status)) pago += val;
          }

          result.push({
            ...v,
            contatoNome: contato?.nome || v.nome,
            contatoTelefone: contato?.telefone,
            contatoEmail: contato?.email,
            totalCobrancas: cobrancasLocal.length,
            pendente, vencido, pago,
          });
        }

        return result;
      } catch {
        return [];
      }
    }),

  // ─── EXCLUIR COBRANÇA ──────────────────────────────────────────────────

  /** Exclui/cancela uma cobrança no Asaas */
  excluirCobranca: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cob] = await db.select().from(asaasCobrancas)
        .where(and(eq(asaasCobrancas.id, input.id), eq(asaasCobrancas.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!cob) throw new TRPCError({ code: "NOT_FOUND" });

      await client.excluirCobranca(cob.asaasPaymentId);
      await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, input.id));

      return { success: true };
    }),

  /** Obtém QR Code Pix de uma cobrança */
  obterPixQrCode: protectedProcedure
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

      try {
        const qr = await client.obterPixQrCode(cob.asaasPaymentId);
        return { payload: qr.payload, image: qr.encodedImage, expirationDate: qr.expirationDate };
      } catch {
        return null;
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
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [vinculo] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!vinculo) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Contato não vinculado ao Asaas." });

      const assinatura = await client.criarAssinatura({
        customer: vinculo.asaasCustomerId,
        billingType: input.formaPagamento,
        value: input.valor,
        nextDueDate: input.proximoVencimento,
        cycle: input.ciclo,
        description: input.descricao,
      });

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
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);

      await client.cancelarAssinatura(input.assinaturaId);
      return { success: true };
    }),

  // ─── PARCELAMENTOS ─────────────────────────────────────────────────────

  /** Criar cobrança parcelada */
  criarParcelamento: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      valorTotal: z.number().min(0.01),
      parcelas: z.number().min(2).max(24),
      vencimento: z.string(),
      formaPagamento: z.enum(["BOLETO", "CREDIT_CARD", "PIX", "UNDEFINED"]),
      descricao: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [vinculo] = await db.select().from(asaasClientes)
        .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!vinculo) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Contato não vinculado ao Asaas." });

      const parcela = await client.criarParcelamento({
        customer: vinculo.asaasCustomerId,
        billingType: input.formaPagamento,
        totalValue: input.valorTotal,
        installmentCount: input.parcelas,
        dueDate: input.vencimento,
        description: input.descricao,
      });

      return { success: true, parcelamentoId: parcela.id };
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
