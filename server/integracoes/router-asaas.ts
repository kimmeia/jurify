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
import { asaasConfig, asaasClientes, asaasCobrancas, asaasConfigCobrancaPai, colaboradores, contatos, users } from "../../drizzle/schema";
import { eq, and, desc, like, or, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { encrypt, decrypt, generateWebhookSecret, maskToken } from "../escritorio/crypto-utils";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { AsaasClient, type AsaasCustomer } from "./asaas-client";
import {
  syncCobrancasDeCliente,
  syncCobrancasEscritorio,
  syncTodasCobrancasDoContato,
  agregarVinculosPorContato,
  type VinculoLinha,
  type CobrancaAgg,
  type ContatoMeta,
} from "./asaas-sync";
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
          // Vincular contato existente — ATUALIZAR dados com nome novo do Asaas.
          // NÃO deletamos vínculos antigos: o Asaas permite duplicatas com o
          // mesmo CPF, e o modelo suporta N customers → 1 contato CRM. Só
          // adicionamos o vínculo novo se ainda não existir (o SELECT em
          // `jaVinculado` acima já garante isso para o asaasCli atual).
          await db.update(contatos).set({
            nome: asaasCli.name,
            cpfCnpj: cpfLimpo,
            email: asaasCli.email || contato.email,
            telefone: asaasCli.mobilePhone || asaasCli.phone || contato.telefone,
          }).where(eq(contatos.id, contato.id));

          await db.insert(asaasClientes).values({
            escritorioId: esc.escritorio.id,
            contatoId: contato.id,
            asaasCustomerId: asaasCli.id,
            cpfCnpj: cpfLimpo,
            nome: asaasCli.name,
          });
          vinculados++;
        } else {
          // Criar contato novo no CRM com origem "asaas" — script de
          // sincronização importou esse cliente direto da conta Asaas.
          const [novoContato] = await db.insert(contatos).values({
            escritorioId: esc.escritorio.id,
            nome: asaasCli.name,
            cpfCnpj: cpfLimpo,
            email: asaasCli.email || null,
            telefone: asaasCli.mobilePhone || asaasCli.phone || null,
            origem: "asaas",
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

      // Criar cobrança no Asaas
      const cobranca = await client.criarCobranca({
        customer: vinculo.asaasCustomerId,
        billingType: input.formaPagamento,
        value: input.valor,
        dueDate: input.vencimento,
        description: input.descricao,
        externalReference,
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
        externalReference: externalReference ?? null,
        atendenteId,
        categoriaId: input.categoriaId ?? null,
        comissionavelOverride: input.comissionavelOverride ?? null,
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
  kpis: protectedProcedure.query(async ({ ctx }) => {
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

      let recebido = 0;
      let recebidoLiquido = 0;
      let pendente = 0;
      let vencido = 0;
      for (const c of todas) {
        const val = parseFloat(c.valor) || 0;
        // valorLiquido vem do Asaas (`netValue`) com taxa já abatida.
        // Pra cobranças sem este campo (manuais ou antigas), usamos o
        // bruto como aproximação — sem taxa, líquido = bruto.
        const liq = c.valorLiquido != null ? parseFloat(c.valorLiquido) : val;
        if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status)) {
          recebido += val;
          recebidoLiquido += liq;
        } else if (c.status === "PENDING") pendente += val;
        else if (c.status === "OVERDUE") vencido += val;
      }

      return { recebido, recebidoLiquido, pendente, vencido, totalCobrancas: todas.length };
    } catch {
      return ZERO;
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
        const cobrancas: CobrancaAgg[] = cobrancasRaw.map((c) => ({
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

      await client.excluirCobranca(cob.asaasPaymentId);
      await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, input.id));

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

      const assinatura = await client.criarAssinatura({
        customer: vinculo.asaasCustomerId,
        billingType: input.formaPagamento,
        value: input.valor,
        nextDueDate: input.proximoVencimento,
        cycle: input.ciclo,
        description: input.descricao,
      });

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

  /** Criar cobrança parcelada */
  criarParcelamento: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      valorTotal: z.number().min(0.01),
      parcelas: z.number().min(2).max(24),
      vencimento: z.string(),
      formaPagamento: z.enum(["BOLETO", "CREDIT_CARD", "PIX", "UNDEFINED"]),
      descricao: z.string().max(512).optional(),
      // Config de comissão — aplicada nas parcelas geradas via webhook.
      atendenteId: z.number().optional(),
      categoriaId: z.number().optional(),
      comissionavelOverride: z.boolean().nullable().optional(),
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

      const parcela = await client.criarParcelamento({
        customer: vinculo.asaasCustomerId,
        billingType: input.formaPagamento,
        totalValue: input.valorTotal,
        installmentCount: input.parcelas,
        dueDate: input.vencimento,
        description: input.descricao,
      });

      // Persiste config se algum flag de comissão foi informado.
      if (input.atendenteId || input.categoriaId || input.comissionavelOverride !== undefined) {
        try {
          await db.insert(asaasConfigCobrancaPai).values({
            escritorioId: esc.escritorio.id,
            tipo: "parcelamento",
            asaasParentId: parcela.id,
            atendenteId: input.atendenteId ?? null,
            categoriaId: input.categoriaId ?? null,
            comissionavelOverride: input.comissionavelOverride ?? null,
          });
        } catch (err: any) {
          console.warn("[criarParcelamento] falha ao salvar config de comissão", err?.message);
        }
      }

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
