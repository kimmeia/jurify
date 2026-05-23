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
import { asaasConfig, asaasClientes, asaasCobrancas, asaasConfigCobrancaPai, asaasWebhookEventos, categoriasCobranca, clienteProcessos, cobrancaAcoes, colaboradores, comissoesFechadas, comissoesFechadasItens, comissoesLancamentosLog, contatos, users } from "../../drizzle/schema";
import { eq, and, desc, like, or, inArray, between, gte, lte, sql, isNull } from "drizzle-orm";
import { alias as aliasedTable } from "drizzle-orm/mysql-core";
import {
  STATUS_PAGO_ASAAS,
  STATUS_PENDENTE_ASAAS,
  STATUS_VENCIDO_ASAAS,
} from "../_core/asaas-status";
import { TRPCError } from "@trpc/server";
import { encrypt, decrypt, generateWebhookSecret, maskToken } from "../escritorio/crypto-utils";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { AsaasClient, type AsaasCustomer } from "./asaas-client";
import { executarExclusaoCobrancasEmMassa } from "./asaas-cobrancas-bulk";
import { adotarCobrancasOrfas } from "./asaas-adocao-orfas";
import { calcularParcelas } from "./parcelamento-local";
import {
  syncCobrancasDeCliente,
  syncCobrancasEscritorio,
  syncCobrancasPorVencimentoEscritorio,
  syncTodasCobrancasDoContato,
  agregarVinculosPorContato,
  inserirVinculoAsaasIdempotente,
  type VinculoLinha,
  type CobrancaAgg,
  type ContatoMeta,
} from "./asaas-sync";
import {
  garantirCategoriaDespesaTaxasAsaas,
  garantirCategoriaCobrancaServicosAsaas,
} from "./asaas-despesas-auto";
import { checkPermission } from "../escritorio/check-permission";
import { exigirDonoOuAdmin } from "../escritorio/router-backup";
import { createLogger } from "../_core/logger";
import { dataHojeBR } from "../../shared/escritorio-types";
import {
  decidirExcluirCobranca,
  decidirVinculoBeneficiario,
  decidirResolverPar,
  type Decision,
} from "./financeiro-duplicidade-rules";

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

/** Converte uma `Decision` (regra pura) em `TRPCError` quando falha, ou
 *  retorna o payload quando passa. Centraliza a tradução. */
function unwrapDecision<T>(d: Decision<T>): T {
  if (!d.ok) throw new TRPCError({ code: d.code, message: d.message });
  return d.data;
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

  await inserirVinculoAsaasIdempotente({
    escritorioId,
    contatoId,
    asaasCustomerId: asaasCli.id,
    cpfCnpj: cpfLimpo,
    nome: asaasCli.name,
    primario: true,
  });

  for (const sec of secundarios) {
    if (sec.id === asaasCli.id) continue;
    await inserirVinculoAsaasIdempotente({
      escritorioId,
      contatoId,
      asaasCustomerId: sec.id,
      cpfCnpj: (sec.cpfCnpj || cpfLimpo).replace(/\D/g, ""),
      nome: sec.name,
      primario: false,
    });
  }

  try {
    // historicoCompleto: primeiro sync deve trazer TODAS as cobranças do
    // cliente no Asaas, não só as dos últimos 90 dias. Caso contrário o
    // operador acabou de vincular e vê "Nenhuma cobrança" pra clientes
    // com histórico antigo — UX quebrada que motivou esse fix.
    const r = await syncTodasCobrancasDoContato(client, escritorioId, contatoId, {
      historicoCompleto: true,
    });
    // Sync OK — limpa erro anterior (caso fosse retry).
    await db
      .update(asaasClientes)
      .set({ ultimoErroSync: null, ultimoErroSyncEm: null })
      .where(and(
        eq(asaasClientes.contatoId, contatoId),
        eq(asaasClientes.escritorioId, escritorioId),
      ));
    return { cobrancasSincronizadas: r.novas + r.atualizadas, erroSync: null };
  } catch (err: any) {
    log.warn(
      { err: err.message, contatoId, asaasCustomerId: asaasCli.id },
      "Sync de cobranças após vincular falhou (não bloqueia o vínculo)",
    );
    const mensagem = (err?.message || "Erro desconhecido ao sincronizar cobranças").slice(0, 500);
    // Persiste no DB pra UI mostrar banner com retry e admin investigar.
    try {
      await db
        .update(asaasClientes)
        .set({ ultimoErroSync: mensagem, ultimoErroSyncEm: new Date() })
        .where(and(
          eq(asaasClientes.contatoId, contatoId),
          eq(asaasClientes.escritorioId, escritorioId),
        ));
    } catch {
      /* DB write best-effort — não bloqueia o retorno do vínculo */
    }
    return {
      cobrancasSincronizadas: 0,
      erroSync: mensagem,
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

  /**
   * Estado do rate guard local pra mostrar na UI ("Cota: X/20k usadas, libera
   * em Yh"). Leitura puramente local — não chama o Asaas.
   *
   * Retorna `bloqueado=true` quando a Camada 2 está esgotada e nenhum sync
   * vai progredir até o reset (manual ou automático em 12h da janela).
   */
  statusRateGuard: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { conectado: false } as const;
    const client = await getAsaasClient(esc.escritorio.id);
    if (!client) return { conectado: false } as const;

    const snap = client.getRateGuardSnapshot();
    const QUOTA_LIMITE = 20_000;
    const QUOTA_JANELA_MS = 12 * 60 * 60 * 1000;
    const janelaExpira = snap.quotaWindowStart + QUOTA_JANELA_MS;
    const agora = Date.now();
    const msAteExpirar = Math.max(0, janelaExpira - agora);
    return {
      conectado: true,
      quotaUsada: snap.quotaCount,
      quotaLimite: QUOTA_LIMITE,
      quotaPercent: Math.min(100, Math.round((snap.quotaCount / QUOTA_LIMITE) * 100)),
      bloqueado: snap.quotaCount >= QUOTA_LIMITE,
      janelaCurta: snap.janelaCurtaCount,
      inflight: snap.inflight,
      msAteExpirar,
      horasAteExpirar: Math.ceil(msAteExpirar / (60 * 60 * 1000)),
    };
  }),

  /**
   * Reset manual do rate guard local (Camada 2). Antes de zerar o contador,
   * faz 1 GET ao /finance/balance do Asaas (bypassa o guard) pra ler
   * `RateLimit-Remaining`. Se o Asaas devolver 429 ou remaining muito baixo,
   * NÃO reseta — informar isso à UI evita queimar 12h de bloqueio real ao
   * tentar a próxima chamada logo após reset.
   *
   * Só dono/gestor (gate financeiro `editar`) pode resetar — operador comum
   * não deve poder.
   */
  resetarRateGuard: protectedProcedure.mutation(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
    if (!perm.editar) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão para resetar o rate guard.",
      });
    }
    const esc = await requireEscritorio(ctx.user.id);
    const client = await getAsaasClient(esc.escritorio.id);
    if (!client) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Asaas não está conectado.",
      });
    }

    const teste = await client.testarCotaRealAsaas();
    if (teste.estouradoNoAsaas) {
      return {
        sucesso: false,
        motivo:
          "O Asaas REAL está em 429 (cota global estourada). Resetar agora só vai cair no mesmo bloqueio — aguarde a liberação da janela.",
        resetSec: teste.resetSec,
        remaining: teste.remaining,
      };
    }
    // Margem conservadora: se a cota real está com menos de 1000 reqs
    // restantes (5% de 20k), também recusa pra dar folga ao próximo sync.
    if (teste.remaining !== null && teste.remaining < 1000) {
      return {
        sucesso: false,
        motivo: `O Asaas só tem ${teste.remaining} requests restantes na janela atual. Resetar agora arrisca estourar de novo em segundos. Aguarde a janela rodar.`,
        resetSec: teste.resetSec,
        remaining: teste.remaining,
      };
    }

    const r = await client.resetarRateGuardLocal(
      `manual por user=${ctx.user.id} (Asaas remaining=${teste.remaining ?? "?"})`,
    );
    return {
      sucesso: true,
      quotaCountAntes: r.quotaCountAntes,
      remaining: teste.remaining,
    };
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

      // Detecção de rate limit. Cobre 2 caminhos:
      //  - HTTP 429 do Asaas (servidor remoto rejeitou)
      //  - "rate_limit:" emitido pelo guard local (cota 12h/janela 60s
      //    bloqueou antes da request sair) — não desconectar nesse caso,
      //    user precisa só aguardar a janela liberar.
      // Em ambos: salvamos a key com status="aguardando_validacao" e o
      // cron `validarConexoesAsaasPendentes` retenta quando liberar.
      const haystack = `${teste.mensagem} ${teste.detalhes ?? ""}`;
      const isRateLimit =
        !teste.ok &&
        (/HTTP 429|rate.?limit|cota.*(?:requisi[çc][õo]es|12h|pr[óo]xima)/i.test(haystack));

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

    const haystack = `${teste.mensagem} ${teste.detalhes ?? ""}`;
    const isRateLimit =
      !teste.ok &&
      /HTTP 429|rate.?limit|cota.*(?:requisi[çc][õo]es|12h|pr[óo]xima)/i.test(haystack);

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
        /** Preset rápido. Em "custom", `dataInicio` e `dataFim` são obrigatórios.
         *  Em "completo" pega 3 anos retro com config turbo (intervalo=5min,
         *  diasPorTick=7) — ~13h de execução, pensado pra rodar de noite. */
        periodo: z.enum(["24h", "7d", "30d", "completo", "custom"]),
        dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        /** Cooldown entre janelas. Default 60min — conservador pra evitar
         *  saturar a cota Asaas. Min 5min. Preset "completo" força 5. */
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
      // Preset "completo" sobrescreve intervalo/diasPorTick em modo turbo.
      // Os demais respeitam o input do usuário.
      let intervaloEfetivo = input.intervaloMinutos;
      let diasPorTickEfetivo = 1;
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
      } else if (input.periodo === "completo") {
        // 10 anos retro cobre praticamente todo escritório. Janelas
        // vazias (períodos sem cobrança) processam em ~1 request cada
        // — não estoura cota mesmo no pior caso.
        const dt = new Date(hoje);
        dt.setUTCDate(dt.getUTCDate() - (365 * 10 - 1));
        dataInicio = dt.toISOString().slice(0, 10);
        dataFim = hojeIso;
        intervaloEfetivo = 5;
        diasPorTickEfetivo = 7;
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
      const MAX_DIAS = 365 * 10;
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
          historicoSyncIntervaloMinutos: intervaloEfetivo,
          historicoSyncDiasPorTick: diasPorTickEfetivo,
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
          intervaloMinutos: intervaloEfetivo,
          diasPorTick: diasPorTickEfetivo,
        },
        "[Asaas] Sync histórica agendada",
      );

      return {
        success: true,
        dataInicio,
        dataFim,
        totalDias,
        intervaloMinutos: intervaloEfetivo,
        // Estimativa pro usuário: (totalDias / diasPorTick) × intervalo em horas
        estimativaHoras: Math.ceil(
          (totalDias / diasPorTickEfetivo) * intervaloEfetivo / 60,
        ),
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
        diasPorTick: asaasConfig.historicoSyncDiasPorTick,
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
        intervaloMinutos: 10,
        diasPorTick: 1,
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

  /**
   * Ajusta `intervaloMinutos` (5..60) e `diasPorTick` (1..7) do sync
   * histórico. Acelera ou desacelera sem cancelar o progresso atual.
   *
   * Cenário típico: cliente piloto com 3 anos de histórico — o default
   * (10min × 1 dia) demora ~7,5 dias de calendário. Subir pra 5min × 7
   * dias = 1 dia de calendário, mas pressiona o rate guard.
   */
  ajustarVelocidadeSyncHistorico: protectedProcedure
    .input(
      z.object({
        intervaloMinutos: z.number().int().min(5).max(60),
        diasPorTick: z.number().int().min(1).max(7),
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

      await db
        .update(asaasConfig)
        .set({
          historicoSyncIntervaloMinutos: input.intervaloMinutos,
          historicoSyncDiasPorTick: input.diasPorTick,
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
    // Pega customers que TÊM cobrança local sem contato vinculado, busca
    // no Asaas e cria/vincula contato no CRM. Lógica em helper compartilhado
    // com o cron de sync histórico (asaas-adocao-orfas.ts).
    const resultadoAdocao = await adotarCobrancasOrfas(esc.escritorio.id, client);
    novos += resultadoAdocao.novosContatos;
    vinculados += resultadoAdocao.vinculadosExistentes;

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
    // Refresh das cobranças via listagem paginada por janela curta
    // (24h por padrão). Substituiu o pattern antigo de
    // `atualizarCobrancasLocaisDoEscritorio` que fazia GET individual
    // por cobrança local — em escritório com 500 cobranças vinha gerando
    // 500 requests sequenciais ao Asaas (~3min de rajada).
    //
    // Agora usa `syncCobrancasEscritorio` com diasHistorico=1: pra cada
    // vínculo, 1 request paginado (≤2 páginas no típico). 50 vínculos =
    // ~50 requests em vez de 500. Webhook em tempo real cobre o resto
    // dos eventos; este botão é só "catch-up" das últimas 24h.
    let cobNovas = 0, cobAtualizadas = 0, cobRemovidas = 0;
    const cobAdotadas = 0;
    try {
      // Turbo seguro: 1 dia × 500ms delay porque a janela curta limita
      // o número de cobranças por customer (raramente >1 página). Reduz
      // 200 customers × 1s = 3min30s pra ~100s. Webhook em tempo real é
      // a fonte primária; este botão só é catch-up das últimas 24h.
      const result = await syncCobrancasEscritorio(esc.escritorio.id, {
        diasHistorico: 1,
        delayMs: 500,
      });
      cobNovas = result.novas;
      cobAtualizadas = result.atualizadas;
      cobRemovidas = result.removidas;
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
   * Importa o extrato financeiro do Asaas como despesas locais.
   *
   * Cobre TUDO o que `/v3/financialTransactions` retorna como débito:
   * PIX/TED saindo, taxas de notificação (SMS/WhatsApp/voz/email),
   * mensalidade Asaas, antecipações, etc. Cada movimentação vira uma
   * despesa categorizada (Notificações Asaas, Transferências PIX/TED,
   * etc). Tipos novos do Asaas caem em "Outras movimentações Asaas".
   *
   * Idempotente: UNIQUE INDEX (escritorioId, asaasFinTransId) impede
   * duplicação em re-execução. Sem `desde`/`ate`, usa últimos 30 dias.
   */
  sincronizarExtrato: protectedProcedure
    .input(z.object({
      desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
      if (!perm.editar) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para sincronizar extrato Asaas.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const client = await requireAsaasClient(esc.escritorio.id);

      const ate = input.ate ?? dataHojeBR();
      const desde = input.desde ?? (() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
      })();

      const { sincronizarExtratoAsaas } = await import("./asaas-extrato");
      const resultado = await sincronizarExtratoAsaas(
        esc.escritorio.id,
        client,
        {
          startDate: desde,
          finishDate: ate,
          criadoPorUserId: esc.escritorio.ownerId,
        },
      );

      return {
        ...resultado,
        periodo: { desde, ate },
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
        await inserirVinculoAsaasIdempotente({
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
  /**
   * Marca uma cobrança como "pagamento por terceiro" — o pagador (contatoId,
   * vinculado ao customer Asaas) é uma pessoa diferente do cliente real
   * (contatoBeneficiarioId). Caso clássico: Carlos é cliente, mas a esposa
   * paga as faturas pela conta dela. A cobrança fica vinculada ao Carlos
   * pra DRE/comissão; o nome da esposa aparece como "Pago por" na linha.
   *
   * `contatoBeneficiarioId` null/undefined remove o vínculo (volta a contar
   * só o pagador). Valida que o beneficiário pertence ao mesmo escritório.
   */
  atribuirBeneficiario: protectedProcedure
    .input(
      z.object({
        cobrancaId: z.number(),
        contatoBeneficiarioId: z.number().nullable(),
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

      if (input.contatoBeneficiarioId !== null) {
        const [benef] = await db
          .select({ id: contatos.id })
          .from(contatos)
          .where(
            and(
              eq(contatos.id, input.contatoBeneficiarioId),
              eq(contatos.escritorioId, esc.escritorio.id),
            ),
          )
          .limit(1);
        if (!benef) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Beneficiário não encontrado neste escritório.",
          });
        }
      }

      const [cob] = await db
        .select({ id: asaasCobrancas.id })
        .from(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.id, input.cobrancaId),
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!cob) throw new TRPCError({ code: "NOT_FOUND" });

      await db
        .update(asaasCobrancas)
        .set({ contatoBeneficiarioId: input.contatoBeneficiarioId })
        .where(eq(asaasCobrancas.id, cob.id));

      return { success: true };
    }),

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
        ? input.dataPagamento ?? dataHojeBR()
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

      const dataPag = input.dataPagamento ?? dataHojeBR();
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
      /** Filtros avançados — multi-select de categoria/atendente + flags
       *  "incluir sem" pra cobrir cobranças com NULL no campo. UI da aba
       *  Cobranças expõe via popover "Filtros avançados". */
      categoriaIds: z.array(z.number().int().positive()).optional(),
      incluirSemCategoria: z.boolean().optional(),
      atendenteIds: z.array(z.number().int().positive()).optional(),
      incluirSemAtendente: z.boolean().optional(),
      /** Status efetivo de comissão. "sim"/"nao"/"indef" — calculado em
       *  cima de comissionavelOverride + categoria.comissionavel (regra
       *  igual ao router-financeiro `comissaoStatus`). */
      comissao: z.array(z.enum(["sim", "nao", "indef"])).optional(),
      /** Range de valor (decimais). Filtros parciais OK. */
      valorMin: z.number().min(0).optional(),
      valorMax: z.number().min(0).optional(),
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
        if (input?.contatoId) {
          // Inclui cobranças onde o contato é o pagador OU o beneficiário
          // lógico. Resolve o caso "Carlos pagou no CPF da esposa": a aba
          // financeiro do Carlos passa a mostrar a cobrança beneficiária
          // junto com as dele.
          conditions.push(
            or(
              eq(asaasCobrancas.contatoId, input.contatoId),
              eq(asaasCobrancas.contatoBeneficiarioId, input.contatoId),
            )!,
          );
        }
        if (input?.atendenteId) conditions.push(eq(asaasCobrancas.atendenteId, input.atendenteId));

        // Filtros avançados: categoria + atendente multi-select com
        // "incluir sem" pra cobrir cobranças com NULL. Lógica:
        //   ids vazios + incluirSem false → ignora (filtro inativo)
        //   ids vazios + incluirSem true  → APENAS sem (IS NULL)
        //   ids preenchidos + incluirSem false → IN (ids)
        //   ids preenchidos + incluirSem true  → IN (ids) OR IS NULL
        const catIds = input?.categoriaIds ?? [];
        if (catIds.length > 0 && input?.incluirSemCategoria) {
          conditions.push(
            or(
              inArray(asaasCobrancas.categoriaId, catIds),
              isNull(asaasCobrancas.categoriaId),
            )!,
          );
        } else if (catIds.length > 0) {
          conditions.push(inArray(asaasCobrancas.categoriaId, catIds));
        } else if (input?.incluirSemCategoria) {
          conditions.push(isNull(asaasCobrancas.categoriaId));
        }

        const atIds = input?.atendenteIds ?? [];
        if (atIds.length > 0 && input?.incluirSemAtendente) {
          conditions.push(
            or(
              inArray(asaasCobrancas.atendenteId, atIds),
              isNull(asaasCobrancas.atendenteId),
            )!,
          );
        } else if (atIds.length > 0) {
          conditions.push(inArray(asaasCobrancas.atendenteId, atIds));
        } else if (input?.incluirSemAtendente) {
          conditions.push(isNull(asaasCobrancas.atendenteId));
        }

        // Status efetivo de comissão. Replica a regra do
        // router-financeiro (comissionavelOverride + categoria.comissionavel):
        //   sim   → override=true OU (override=null AND categoria.comissionavel=true)
        //   nao   → override=false OU (override=null AND categoriaId NOT NULL AND categoria.comissionavel=false)
        //   indef → override=null AND categoriaId IS NULL
        const comissaoFiltro = input?.comissao ?? [];
        if (comissaoFiltro.length > 0 && comissaoFiltro.length < 3) {
          const conds: any[] = [];
          if (comissaoFiltro.includes("sim")) {
            conds.push(
              sql`${asaasCobrancas.comissionavelOverride} = TRUE OR (
                ${asaasCobrancas.comissionavelOverride} IS NULL
                AND ${asaasCobrancas.categoriaId} IN (
                  SELECT ${categoriasCobranca.id} FROM ${categoriasCobranca}
                  WHERE ${categoriasCobranca.comissionavel} = TRUE
                )
              )`,
            );
          }
          if (comissaoFiltro.includes("nao")) {
            conds.push(
              sql`${asaasCobrancas.comissionavelOverride} = FALSE OR (
                ${asaasCobrancas.comissionavelOverride} IS NULL
                AND ${asaasCobrancas.categoriaId} IS NOT NULL
                AND ${asaasCobrancas.categoriaId} IN (
                  SELECT ${categoriasCobranca.id} FROM ${categoriasCobranca}
                  WHERE ${categoriasCobranca.comissionavel} = FALSE
                )
              )`,
            );
          }
          if (comissaoFiltro.includes("indef")) {
            conds.push(
              sql`${asaasCobrancas.comissionavelOverride} IS NULL
                  AND ${asaasCobrancas.categoriaId} IS NULL`,
            );
          }
          if (conds.length > 0) {
            conditions.push(or(...conds)!);
          }
        }

        if (input?.valorMin !== undefined) {
          conditions.push(sql`CAST(${asaasCobrancas.valor} AS DECIMAL(10,2)) >= ${input.valorMin}`);
        }
        if (input?.valorMax !== undefined) {
          conditions.push(sql`CAST(${asaasCobrancas.valor} AS DECIMAL(10,2)) <= ${input.valorMax}`);
        }

        if (input?.vencimentoInicio && input?.vencimentoFim) {
          conditions.push(between(asaasCobrancas.vencimento, input.vencimentoInicio, input.vencimentoFim));
        } else if (input?.vencimentoInicio) {
          conditions.push(gte(asaasCobrancas.vencimento, input.vencimentoInicio));
        } else if (input?.vencimentoFim) {
          conditions.push(lte(asaasCobrancas.vencimento, input.vencimentoFim));
        }
        // Filtro de período "efetivo": COALESCE(dataPagamento, vencimento).
        // Antes filtrava só por dataPagamento, excluindo PENDING/OVERDUE
        // (que nunca foram pagas, dataPagamento=NULL). Resultado: banner
        // "224 sem categoria" não batia com lista (mostrava 67) porque as
        // 157 pendentes/vencidas sumiam silenciosamente. COALESCE bate com
        // a ordenação `COALESCE(dataPagamento, vencimento) DESC` usada
        // abaixo — agora o que aparece bate com o que é ordenado.
        if (input?.pagamentoInicio && input?.pagamentoFim) {
          conditions.push(
            sql`COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento})
                BETWEEN ${input.pagamentoInicio} AND ${input.pagamentoFim}`,
          );
        } else if (input?.pagamentoInicio) {
          conditions.push(
            sql`COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento})
                >= ${input.pagamentoInicio}`,
          );
        } else if (input?.pagamentoFim) {
          conditions.push(
            sql`COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento})
                <= ${input.pagamentoFim}`,
          );
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
        //
        // Inclui também `contatoBeneficiarioId` quando definido (caso
        // "pagamento por terceiro" — Carlos é cliente, esposa pagou).
        // UI mostra "Carlos Silva [cliente] · Pago por Maria Silva".
        const contatoIds = [
          ...new Set(
            items
              .flatMap((i) => [i.contatoId, i.contatoBeneficiarioId])
              .filter(Boolean) as number[],
          ),
        ];
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
          const nomeBeneficiarioRaw = i.contatoBeneficiarioId
            ? contatosMap[i.contatoBeneficiarioId]
            : null;
          return {
            ...i,
            nomeContato:
              (nomeContrato && nomeContrato.trim()) ||
              (nomeFallback && nomeFallback.trim()) ||
              "—",
            nomeContatoBeneficiario:
              nomeBeneficiarioRaw && nomeBeneficiarioRaw.trim()
                ? nomeBeneficiarioRaw
                : null,
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
        // Verificar se contato está vinculado (TODOS os vínculos — pode
        // haver duplicatas com mesmo CPF; pegamos status agregado).
        const vinculos = await db.select().from(asaasClientes)
          .where(and(eq(asaasClientes.contatoId, input.contatoId), eq(asaasClientes.escritorioId, esc.escritorio.id)));

        // Mesmo sem vínculo Asaas direto, o contato pode ter cobranças
        // vinculadas como beneficiário (esposa pagou pelo cliente).
        // Antes daqui retornava `vinculado: false` e zerava tudo — perdendo
        // o histórico de pagamentos de terceiros.
        // Por isso `vinculado` agora reflete só o vínculo direto, mas a
        // consulta de cobranças segue rodando pra captar beneficiárias.

        // Cobranças que CONTAM pro contato (pagador direto OU beneficiário
        // lógico via contatoBeneficiarioId). Resolve o caso Carlos+esposa:
        // a cobrança continua na esposa (auditoria), mas aparece no resumo
        // do Carlos quando `contatoBeneficiarioId = Carlos.id`.
        const cobrancas = await db.select().from(asaasCobrancas)
          .where(and(
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
            or(
              and(
                eq(asaasCobrancas.contatoId, input.contatoId),
                isNull(asaasCobrancas.contatoBeneficiarioId),
              ),
              eq(asaasCobrancas.contatoBeneficiarioId, input.contatoId),
            )!,
          ))
          .orderBy(desc(asaasCobrancas.createdAt))
          .limit(20);

        if (vinculos.length === 0 && cobrancas.length === 0) {
          return {
            vinculado: false,
            pendente: 0,
            vencido: 0,
            pago: 0,
            cobrancas: [],
            sincronizadoEm: null,
            ultimoErroSync: null,
          };
        }

        let pendente = 0, vencido = 0, pago = 0;
        for (const c of cobrancas) {
          const val = parseFloat(c.valor) || 0;
          if (c.status === "PENDING") pendente += val;
          else if (c.status === "OVERDUE") vencido += val;
          else if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status)) pago += val;
        }

        // Estado do sync: pega o vínculo primário, ou o primeiro se não
        // houver primário marcado. Erro mais recente entre todos os
        // vínculos é o que a UI deve mostrar.
        // Se o contato só tem cobranças beneficiárias (sem vínculo Asaas
        // próprio), `primario` é null — o frontend já trata "vinculado: false"
        // mas mostra os totais e cobranças capturadas.
        const primario = vinculos.find((v) => v.primario) ?? vinculos[0] ?? null;
        const erros = vinculos
          .filter((v) => v.ultimoErroSync)
          .sort((a, b) => {
            const ta = a.ultimoErroSyncEm?.getTime() ?? 0;
            const tb = b.ultimoErroSyncEm?.getTime() ?? 0;
            return tb - ta;
          });
        const erroMaisRecente = erros[0] ?? null;

        return {
          vinculado: vinculos.length > 0,
          asaasCustomerId: primario?.asaasCustomerId ?? null,
          totalVinculos: vinculos.length,
          pendente,
          vencido,
          pago,
          cobrancas,
          sincronizadoEm: primario?.sincronizadoEm?.toISOString() ?? null,
          ultimoErroSync: erroMaisRecente?.ultimoErroSync ?? null,
          ultimoErroSyncEm: erroMaisRecente?.ultimoErroSyncEm?.toISOString() ?? null,
        };
      } catch {
        return null;
      }
    }),

  /**
   * Versão batch do `resumoContato` — pega o resumo (vinculado + somas
   * pendente/vencido/pago) de vários contatos numa query só.
   *
   * Motivação: o componente FinanceiroBadge na lista de Clientes era
   * renderizado por linha, disparando N queries `resumoContato` (1 por
   * cliente visível, até 50/página). Esta procedure devolve um Record
   * indexado por contatoId; frontend faz 1 chamada por página.
   *
   * Não retorna o array `cobrancas` (pesado e desnecessário pro badge —
   * só os totais bastam). Pra detalhe completo, frontend continua usando
   * `resumoContato`.
   */
  resumoPorContatos: protectedProcedure
    .input(z.object({ contatoIds: z.array(z.number().int().positive()).max(100) }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc || input.contatoIds.length === 0) return {} as Record<number, {
        vinculado: boolean; pendente: number; vencido: number; pago: number;
      }>;
      const db = await getDb();
      if (!db) return {};

      try {
        // Vínculos primários (ou primeiro) por contato
        const vinculos = await db.select({ contatoId: asaasClientes.contatoId })
          .from(asaasClientes)
          .where(and(
            eq(asaasClientes.escritorioId, esc.escritorio.id),
            inArray(asaasClientes.contatoId, input.contatoIds),
          ));
        const vinculados = new Set(vinculos.map((v) => v.contatoId));

        // Cobranças que contam pra cada contato — pagador direto OU
        // beneficiário lógico. Traz ambos pra somar 1x cada (o WHERE OR
        // garante union). A coluna `contatoBeneficiarioId` tem prioridade
        // semântica: quando setada, é o "dono" do pagamento (Carlos);
        // quando NULL, o pagador (contatoId) é o dono (comportamento legado).
        const cobs = await db.select({
          contatoId: asaasCobrancas.contatoId,
          contatoBeneficiarioId: asaasCobrancas.contatoBeneficiarioId,
          status: asaasCobrancas.status,
          valor: asaasCobrancas.valor,
        }).from(asaasCobrancas).where(and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          or(
            inArray(asaasCobrancas.contatoId, input.contatoIds),
            inArray(asaasCobrancas.contatoBeneficiarioId, input.contatoIds),
          )!,
        ));

        const result: Record<number, {
          vinculado: boolean; pendente: number; vencido: number; pago: number;
        }> = {};
        for (const id of input.contatoIds) {
          result[id] = { vinculado: vinculados.has(id), pendente: 0, vencido: 0, pago: 0 };
        }
        for (const c of cobs) {
          // Atribui ao beneficiário se houver, senão ao pagador (semântica
          // COALESCE). Cobrança órfã sem ambos → ignora.
          const donoId = c.contatoBeneficiarioId ?? c.contatoId;
          if (donoId == null) continue;
          const r = result[donoId];
          if (!r) continue;
          const val = parseFloat(c.valor) || 0;
          if (c.status === "PENDING") r.pendente += val;
          else if (c.status === "OVERDUE") r.vencido += val;
          else if (c.status === "RECEIVED" || c.status === "CONFIRMED" || c.status === "RECEIVED_IN_CASH") r.pago += val;
        }
        return result;
      } catch {
        return {};
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
    .input(z.object({
      contatoId: z.number(),
      /**
       * Quando true, ignora o filtro de customers já linkados a outro
       * contato JuridFlow — migra o customer Asaas pra ESTE contato. Operador
       * confirma na UI (toast oferece o botão "Mover pra cá") quando o
       * primeiro sync detecta `motivoVazio="cpf_em_outro_contato"`.
       */
      forcarMigracao: z.boolean().default(false),
    }))
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

      // ── Passo 1: reconciliação por CPF ──────────────────────────────
      // Roda SEMPRE — mesmo quando o contato não tem vínculo prévio. Antes
      // havia early-return aqui, o que impedia clientes cadastrados manualmente
      // (que ainda não passaram pelo fluxo Asaas) de descobrir cobranças
      // existentes pelo CPF.
      //
      // Quando reconciliação cria o PRIMEIRO vínculo do contato, marca como
      // primário (assim a próxima cobrança nova já usa esse customer).
      //
      // Best-effort: se o CPF estiver vazio ou a busca no Asaas falhar,
      // prossegue com os vínculos atuais (não aborta o sync).
      let customersAdicionados = 0;
      let erroReconciliacao: string | null = null;
      // Sinaliza pro frontend a causa exata quando nada foi sincronizado
      // (pra mostrar mensagem útil ao operador).
      let motivoVazio: "sem_cpf" | "cpf_nao_existe_asaas" | "cpf_em_outro_contato" | null = null;

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
          if (todosDoCpf.length === 0 && vinculosExistentes.length === 0) {
            motivoVazio = "cpf_nao_existe_asaas";
          }
          const idsJaVinculados = new Set(vinculosExistentes.map((v) => v.asaasCustomerId));
          const candidatos = todosDoCpf.filter((c) => !idsJaVinculados.has(c.id));

          if (candidatos.length > 0) {
            let novos: typeof candidatos;

            if (input.forcarMigracao) {
              // Modo migração: ignora filtro, vai usar TODOS os candidatos.
              // Antes de inserir, remove vínculos antigos desses customers
              // (estavam em outros contatos no JuridFlow). Cobranças órfãs serão
              // re-adotadas pelo loop de adopção em syncTodasCobrancasDoContato.
              await db.delete(asaasClientes).where(and(
                eq(asaasClientes.escritorioId, esc.escritorio.id),
                inArray(asaasClientes.asaasCustomerId, candidatos.map((c) => c.id)),
              ));
              novos = candidatos;
            } else {
              const disponiveisIds = await filtrarCustomersDisponiveis(
                db,
                esc.escritorio.id,
                candidatos.map((c) => c.id),
              );
              novos = candidatos.filter((c) => disponiveisIds.has(c.id));

              // Se TODOS os candidatos retornados pelo Asaas já estão linkados
              // a outro contato no JuridFlow (e este contato não tem vínculo
              // próprio), avisa o user pra confirmar migração.
              if (novos.length === 0 && vinculosExistentes.length === 0) {
                motivoVazio = "cpf_em_outro_contato";
              }
            }

            // Decide qual deles vira primário: se o contato ainda não tem
            // nenhum vínculo, o primeiro novo vira primário. Senão, mantém
            // o primário atual (novos entram como secundários, só pra
            // sincronizar histórico).
            let jaTemPrimario = vinculosExistentes.some((v) => v.primario);

            for (const cli of novos) {
              const ehEsteOPrimario = !jaTemPrimario;
              await inserirVinculoAsaasIdempotente({
                escritorioId: esc.escritorio.id,
                contatoId: input.contatoId,
                asaasCustomerId: cli.id,
                cpfCnpj: (cli.cpfCnpj || cpfLimpo).replace(/\D/g, ""),
                nome: cli.name,
                primario: ehEsteOPrimario,
              });
              if (ehEsteOPrimario) jaTemPrimario = true;
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
      } else if (vinculosExistentes.length === 0) {
        // Sem CPF E sem vínculo: não tem nem o que sincronizar.
        motivoVazio = "sem_cpf";
      }

      // ── Passo 2: sync de cobranças de TODOS os vínculos ─────────────
      // Modo "apenas criar/atualizar": o botão UI nunca deve deletar
      // cobranças locais, mesmo que o Asaas marque `cob.deleted=true`.
      // Cleanup de cobrança apagada no Asaas é responsabilidade do cron,
      // não desse fluxo manual.
      //
      // historicoCompleto: o botão "Sincronizar" da UI também merece o
      // histórico completo. O cap de 90 dias só faz sentido pra cron
      // periódico (que recebe o histórico via webhook em tempo real). No
      // clique manual o operador quer reconciliar TUDO.
      let stats = { novas: 0, atualizadas: 0, removidas: 0 };
      let erroSync: string | null = erroReconciliacao;
      try {
        stats = await syncTodasCobrancasDoContato(client, esc.escritorio.id, input.contatoId, {
          apenasCriarAtualizar: true,
          historicoCompleto: true,
        });
      } catch (err: any) {
        erroSync = err?.message || "Erro desconhecido ao sincronizar cobranças";
      }

      // Persiste estado do sync nos vínculos: limpa erro quando OK; salva
      // mensagem quando falhou. UI mostra banner com retry pelo campo.
      try {
        const mensagem = erroSync ? erroSync.slice(0, 500) : null;
        await db
          .update(asaasClientes)
          .set({
            ultimoErroSync: mensagem,
            ultimoErroSyncEm: mensagem ? new Date() : null,
          })
          .where(and(
            eq(asaasClientes.contatoId, input.contatoId),
            eq(asaasClientes.escritorioId, esc.escritorio.id),
          ));
      } catch {
        /* best-effort */
      }

      return {
        customersAdicionados,
        novas: stats.novas,
        atualizadas: stats.atualizadas,
        removidas: stats.removidas,
        total: stats.novas + stats.atualizadas + stats.removidas,
        erroSync,
        motivoVazio,
      };
    }),

  /** Sincronizar tudo: clientes + cobranças do escritório inteiro.
   *  Default: 90 dias retroativos (catch-up completo). Caller pode passar
   *  `diasHistorico` menor pra um sync mais rápido (ex: 7 dias). */
  sincronizarTudo: protectedProcedure
    .input(
      z
        .object({
          diasHistorico: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      const result = await syncCobrancasEscritorio(esc.escritorio.id, {
        diasHistorico: input?.diasHistorico,
      });
      const sweep = await syncCobrancasPorVencimentoEscritorio(esc.escritorio.id);
      return {
        ...result,
        novas: result.novas + sweep.novas,
        atualizadas: result.atualizadas + sweep.atualizadas,
      };
    }),

  /** Sync rápido sob-demanda — janela curta (3 dias) + turbo (delay 500ms
   *  entre vínculos). Pensado pro botão "Atualizar agora" da UI: retorna
   *  em segundos em vez de minutos. O webhook já cobre real-time, então
   *  a janela curta basta pra pegar o que perdeu por race condition.
   *
   *  Risco assumido: o turbo pode bater no rate guard local (Camada 1)
   *  em escritórios com 60+ customers — nesse caso aborta gracefully e
   *  retorna parcial. Operador roda "Sincronizar tudo" depois pra catch-up.
   */
  sincronizarRapido: protectedProcedure.mutation(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    const result = await syncCobrancasEscritorio(esc.escritorio.id, {
      diasHistorico: 3,
      delayMs: 500,
    });
    const sweep = await syncCobrancasPorVencimentoEscritorio(esc.escritorio.id);
    return {
      ...result,
      novas: result.novas + sweep.novas,
      atualizadas: result.atualizadas + sweep.atualizadas,
    };
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
    const ZERO = {
      recebido: 0, recebidoLiquido: 0, recebidoCount: 0,
      pendente: 0, vencido: 0,
      recebidoComVencimentoNoPeriodo: 0, recebidoComVencimentoNoPeriodoCount: 0,
      recebidoAsaasPorVencimento: 0, recebidoAsaasPorVencimentoCount: 0,
      recebidoManual: 0, recebidoManualCount: 0,
      recebidoNoPrazo: 0, recebidoNoPrazoCount: 0,
      recebidoAtraso: 0, recebidoAtrasoCount: 0,
      recebidoAdiantado: 0, recebidoAdiantadoCount: 0,
      totalCobrancas: 0,
    };
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return ZERO;

    const db = await getDb();
    if (!db) return ZERO;

    try {
      const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
      if (visiveis !== null && visiveis.length === 0) return ZERO;
      const conds = [eq(asaasCobrancas.escritorioId, esc.escritorio.id)];
      if (visiveis !== null) conds.push(inArray(asaasCobrancas.contatoId, visiveis));

      // Agregação em SQL via CASE WHEN. Antes carregávamos TODAS as
      // cobranças do escritório em memória (`db.select().from(...)`) e
      // somávamos em JS — em escritórios com 10k+ cobranças isso era
      // ~5MB de payload e segundos de CPU por chamada, multiplicado
      // por refetch a cada 5min na UI. Agora 1 row volta do DB.
      //
      // "Hoje" pra detectar PENDING-past-due. Bate com cashFlowMensal
      // (que também classifica PENDING vencido como Vencido). Sem isso
      // o KPI mostrava 0 enquanto o gráfico do hero mostrava o vencido
      // real — status só vira OVERDUE quando o Asaas dispara
      // PAYMENT_OVERDUE, que pode atrasar dias.
      const hojeStr = dataHojeBR();
      const pagIni = input?.pagamentoInicio ?? null;
      const pagFim = input?.pagamentoFim ?? null;
      const vencIni = input?.vencimentoInicio ?? null;
      const vencFim = input?.vencimentoFim ?? null;

      // Predicados SQL alinhados com a lógica JS original:
      //  - pago: status pago + dataPagamento dentro do range (sem filtro →
      //          conta mesmo com dataPagamento NULL pra bater com noRangePag)
      //  - pendente: status=PENDING + vencimento >= hoje + vencimento no range
      //  - vencido: (status=OVERDUE OR (status=PENDING + venc < hoje))
      //             + vencimento no range
      //
      // Sobre dataPagamento NULL: o inRangePag faz `(pagIni IS NULL OR date >=
      // pagIni) AND (pagFim IS NULL OR date <= pagFim)`. Quando sem filtro
      // (ambos null), o OR é TRUE pra qualquer date (inclusive NULL). Quando
      // com filtro, NULL >= pagIni vira NULL → o AND fica NULL → WHERE trata
      // como FALSE → exclui. Mesmo behavior do JS `noRangePag(null)`.
      const inRangePag = sql`(${pagIni} IS NULL OR ${asaasCobrancas.dataPagamento} >= ${pagIni})
        AND (${pagFim} IS NULL OR ${asaasCobrancas.dataPagamento} <= ${pagFim})`;
      const inRangeVenc = sql`(${vencIni} IS NULL OR ${asaasCobrancas.vencimento} >= ${vencIni})
        AND (${vencFim} IS NULL OR ${asaasCobrancas.vencimento} <= ${vencFim})`;
      const valorDec = sql`CAST(${asaasCobrancas.valor} AS DECIMAL(20,2))`;
      const valorLiquidoDec = sql`CAST(COALESCE(${asaasCobrancas.valorLiquido}, ${asaasCobrancas.valor}) AS DECIMAL(20,2))`;
      const ehPago = inArray(asaasCobrancas.status, STATUS_PAGO_ASAAS as unknown as string[]);
      const ehPending = inArray(asaasCobrancas.status, STATUS_PENDENTE_ASAAS as unknown as string[]);
      const ehOverdue = inArray(asaasCobrancas.status, STATUS_VENCIDO_ASAAS as unknown as string[]);
      // Discriminação e ponte com o Asaas contam SÓ origem='asaas' — o painel
      // do Asaas não conhece cobranças manuais (Caixa Escritório). Manual
      // entra como linha própria na reconciliação.
      const ehAsaas = sql`${asaasCobrancas.origem} = 'asaas'`;
      const ehManual = sql`${asaasCobrancas.origem} = 'manual'`;
      const pendingNoFuturo = sql`${asaasCobrancas.vencimento} >= ${hojeStr}`;
      const pendingNoPassado = sql`${asaasCobrancas.vencimento} < ${hojeStr}`;
      // Discriminação do recebido (caixa real, pago no período) por situação
      // de prazo, comparando o vencimento com o período de pagamento. Só faz
      // sentido quando pagIni/pagFim estão definidos (filtro de período).
      //  - no prazo: venceu dentro do período
      // Discriminação por situação de prazo: compara a DATA DE PAGAMENTO
      // com a DATA DE VENCIMENTO de cada cobrança (não com o mês). Aplicada
      // sobre as cobranças que VENCEM no período (inRangeVenc), pra bater
      // com o conjunto que o painel Asaas mostra em "Recebidas".
      //  - adiantado: pagou ANTES do vencimento
      //  - no prazo: pagou no DIA do vencimento
      //  - atraso: pagou DEPOIS do vencimento
      // Datas são strings YYYY-MM-DD — comparação lexicográfica == cronológica.
      const pagAdiantado = sql`(${asaasCobrancas.dataPagamento} IS NOT NULL AND ${asaasCobrancas.dataPagamento} < ${asaasCobrancas.vencimento})`;
      const pagNoPrazo = sql`(${asaasCobrancas.dataPagamento} IS NOT NULL AND ${asaasCobrancas.dataPagamento} = ${asaasCobrancas.vencimento})`;
      const pagAtraso = sql`(${asaasCobrancas.dataPagamento} IS NOT NULL AND ${asaasCobrancas.dataPagamento} > ${asaasCobrancas.vencimento})`;

      const [agg] = await db
        .select({
          recebido: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${inRangePag} THEN ${valorDec} ELSE 0 END), 0)`,
          recebidoLiquido: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${inRangePag} THEN ${valorLiquidoDec} ELSE 0 END), 0)`,
          pendente: sql<string>`COALESCE(SUM(CASE WHEN ${ehPending} AND ${pendingNoFuturo} AND ${inRangeVenc} THEN ${valorDec} ELSE 0 END), 0)`,
          vencido: sql<string>`COALESCE(SUM(CASE WHEN ((${ehPending} AND ${pendingNoPassado}) OR ${ehOverdue}) AND ${inRangeVenc} THEN ${valorDec} ELSE 0 END), 0)`,
          // Cobranças pagas cujo VENCIMENTO foi no período (independente de quando o pagamento ocorreu).
          // Usado pra calcular taxa de inadimplência exata: do que deveria ser pago no período, quanto foi.
          recebidoComVencimentoNoPeriodo: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${inRangeVenc} THEN ${valorDec} ELSE 0 END), 0)`,
          recebidoComVencimentoNoPeriodoCount: sql<number>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${inRangeVenc} THEN 1 ELSE 0 END), 0)`,
          // PONTE COM ASAAS: cobranças Asaas (origem=asaas) pagas com vencimento
          // no período. É o que o painel "Recebidas" do Asaas conta (por venc).
          recebidoAsaasPorVencimento: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${ehAsaas} AND ${inRangeVenc} THEN ${valorDec} ELSE 0 END), 0)`,
          recebidoAsaasPorVencimentoCount: sql<number>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${ehAsaas} AND ${inRangeVenc} THEN 1 ELSE 0 END), 0)`,
          // Caixa manual (origem=manual, Caixa Escritório) pago no período
          recebidoManual: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${ehManual} AND ${inRangePag} THEN ${valorDec} ELSE 0 END), 0)`,
          recebidoManualCount: sql<number>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${ehManual} AND ${inRangePag} THEN 1 ELSE 0 END), 0)`,
          // Discriminação do recebido POR VENCIMENTO (bate com painel Asaas)
          // por situação de prazo (pagamento vs vencimento de cada cobrança).
          recebidoNoPrazo: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${ehAsaas} AND ${inRangeVenc} AND ${pagNoPrazo} THEN ${valorDec} ELSE 0 END), 0)`,
          recebidoNoPrazoCount: sql<number>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${ehAsaas} AND ${inRangeVenc} AND ${pagNoPrazo} THEN 1 ELSE 0 END), 0)`,
          recebidoAtraso: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${ehAsaas} AND ${inRangeVenc} AND ${pagAtraso} THEN ${valorDec} ELSE 0 END), 0)`,
          recebidoAtrasoCount: sql<number>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${ehAsaas} AND ${inRangeVenc} AND ${pagAtraso} THEN 1 ELSE 0 END), 0)`,
          recebidoAdiantado: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${ehAsaas} AND ${inRangeVenc} AND ${pagAdiantado} THEN ${valorDec} ELSE 0 END), 0)`,
          recebidoAdiantadoCount: sql<number>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${ehAsaas} AND ${inRangeVenc} AND ${pagAdiantado} THEN 1 ELSE 0 END), 0)`,
          recebidoCount: sql<number>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${inRangePag} THEN 1 ELSE 0 END), 0)`,
          totalCobrancas: sql<number>`COALESCE(SUM(CASE
            WHEN ${ehPago} AND ${inRangePag} THEN 1
            WHEN ${ehPending} AND ${inRangeVenc} THEN 1
            WHEN ${ehOverdue} AND ${inRangeVenc} THEN 1
            ELSE 0 END), 0)`,
        })
        .from(asaasCobrancas)
        .where(and(...conds));

      return {
        recebido: Number(agg?.recebido ?? 0),
        recebidoLiquido: Number(agg?.recebidoLiquido ?? 0),
        recebidoCount: Number(agg?.recebidoCount ?? 0),
        pendente: Number(agg?.pendente ?? 0),
        vencido: Number(agg?.vencido ?? 0),
        recebidoComVencimentoNoPeriodo: Number(agg?.recebidoComVencimentoNoPeriodo ?? 0),
        recebidoComVencimentoNoPeriodoCount: Number(agg?.recebidoComVencimentoNoPeriodoCount ?? 0),
        recebidoAsaasPorVencimento: Number(agg?.recebidoAsaasPorVencimento ?? 0),
        recebidoAsaasPorVencimentoCount: Number(agg?.recebidoAsaasPorVencimentoCount ?? 0),
        recebidoManual: Number(agg?.recebidoManual ?? 0),
        recebidoManualCount: Number(agg?.recebidoManualCount ?? 0),
        recebidoNoPrazo: Number(agg?.recebidoNoPrazo ?? 0),
        recebidoNoPrazoCount: Number(agg?.recebidoNoPrazoCount ?? 0),
        recebidoAtraso: Number(agg?.recebidoAtraso ?? 0),
        recebidoAtrasoCount: Number(agg?.recebidoAtrasoCount ?? 0),
        recebidoAdiantado: Number(agg?.recebidoAdiantado ?? 0),
        recebidoAdiantadoCount: Number(agg?.recebidoAdiantadoCount ?? 0),
        totalCobrancas: Number(agg?.totalCobrancas ?? 0),
      };
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
          meses: z.number().int().min(1).max(60).optional(),
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
          // Hard cap de 60 meses (5 anos). Range maior é truncado silenciosamente —
          // o filtro WHERE usa rangeFim baseado na última chave, então cobranças
          // fora desse cap não aparecem nem no SUM nem nos buckets.
          const cursor = new Date(ini.getFullYear(), ini.getMonth(), 1);
          const fimChave = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, "0")}`;
          let i = 0;
          while (i < 60) {
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

        // Agregação em SQL: antes carregávamos TODAS as cobranças do
        // escritório em memória (`db.select().from(...)`) e bucketizávamos
        // em JS — escritórios com 10k+ cobranças geravam payload de MBs
        // a cada refresh do gráfico (10min na UI). Agora 1 query agrupa
        // por mês/dia, retornando só uma linha por bucket.
        const buckets = new Map<string, Bucket>();
        for (const k of chaves) buckets.set(k, { recebido: 0, pendente: 0, vencido: 0 });

        if (chaves.length === 0) {
          return { granularidade, pontos: [], totalRecebido: 0, totalPendente: 0, totalVencido: 0 };
        }

        const hojeStr = dataHojeBR();
        const sliceLen = granularidade === "dia" ? 10 : 7;
        // Limites do range pra filtro de WHERE: 1º dia do 1º bucket até
        // último dia do último bucket. Em granularidade=dia as chaves já
        // são YYYY-MM-DD; em mes calculamos último dia do mês.
        const primeiraChave = chaves[0];
        const ultimaChave = chaves[chaves.length - 1];
        const rangeIni = granularidade === "dia" ? primeiraChave : `${primeiraChave}-01`;
        const rangeFim = granularidade === "dia"
          ? ultimaChave
          : (() => {
              const [y, m] = ultimaChave.split("-").map(Number);
              return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
            })();

        // SQL: GROUP BY o "refDate" recortado (data de pagamento pra pago,
        // vencimento pro resto). LEFT(date, N) funciona com strings YYYY-MM-DD.
        const valorDec = sql`CAST(${asaasCobrancas.valor} AS DECIMAL(20,2))`;
        const ehPago = sql`${asaasCobrancas.status} IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')`;
        const ehPending = sql`${asaasCobrancas.status} = 'PENDING'`;
        const ehOverdue = sql`${asaasCobrancas.status} = 'OVERDUE'`;
        const refDateExpr = sql`CASE WHEN ${ehPago}
          THEN COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento})
          ELSE ${asaasCobrancas.vencimento} END`;

        const linhas = await db
          .select({
            chave: sql<string>`LEFT(${refDateExpr}, ${sliceLen})`,
            recebido: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} THEN ${valorDec} ELSE 0 END), 0)`,
            pendente: sql<string>`COALESCE(SUM(CASE WHEN ${ehPending} AND ${asaasCobrancas.vencimento} >= ${hojeStr} THEN ${valorDec} ELSE 0 END), 0)`,
            vencido: sql<string>`COALESCE(SUM(CASE WHEN ${ehOverdue} OR (${ehPending} AND ${asaasCobrancas.vencimento} < ${hojeStr}) THEN ${valorDec} ELSE 0 END), 0)`,
          })
          .from(asaasCobrancas)
          .where(
            and(
              ...conds,
              // Filtro de range — limita cobranças carregadas ao período
              // do gráfico. Usa o refDate (mesma expressão do GROUP BY)
              // pra garantir consistência com a bucketização.
              sql`(
                (${ehPago} AND COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento}) BETWEEN ${rangeIni} AND ${rangeFim})
                OR ((${ehPending} OR ${ehOverdue}) AND ${asaasCobrancas.vencimento} BETWEEN ${rangeIni} AND ${rangeFim})
              )`,
            ),
          )
          .groupBy(sql`LEFT(${refDateExpr}, ${sliceLen})`);

        let totalRecebido = 0, totalPendente = 0, totalVencido = 0;
        for (const r of linhas) {
          const bucket = buckets.get(r.chave);
          // Chaves fora do range escolhido (raro — filtro WHERE deveria
          // ter cortado) são ignoradas pra não inflar totais.
          if (!bucket) continue;
          const rec = Number(r.recebido ?? 0);
          const pen = Number(r.pendente ?? 0);
          const ven = Number(r.vencido ?? 0);
          bucket.recebido = rec;
          bucket.pendente = pen;
          bucket.vencido = ven;
          totalRecebido += rec;
          totalPendente += pen;
          totalVencido += ven;
        }

        const pontos = Array.from(buckets.entries()).map(([chave, v]) => ({
          chave,
          recebido: Math.round(v.recebido * 100) / 100,
          pendente: Math.round(v.pendente * 100) / 100,
          vencido: Math.round(v.vencido * 100) / 100,
        }));

        return { granularidade, pontos, totalRecebido, totalPendente, totalVencido };
      } catch (err) {
        log.error(
          { module: "asaas-cashFlowMensal", err, input },
          "Falha ao agregar fluxo de caixa",
        );
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
        // Usa fuso BR (server roda UTC; após 21h BRT viraria amanhã)
        const hojeStr = dataHojeBR();
        const fimStr = fim.toISOString().slice(0, 10);

        const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, esc.escritorio.id);
        if (visiveis !== null && visiveis.length === 0) {
          return { semanas: [], total: 0, atrasado: 0 };
        }
        const condsP: any[] = [
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          eq(asaasCobrancas.status, "PENDING"),
          // Limita ao que o forecast pode usar: vencidas (qualquer data
          // < hoje, contam como atrasado) OU dentro da janela de previsão
          // (vencimento <= fimStr). Cobranças com vencimento > fim não
          // entrariam em nenhum bucket — antes eram carregadas e
          // descartadas em JS.
          lte(asaasCobrancas.vencimento, fimStr),
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
        await inserirVinculoAsaasIdempotente({
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
                vencimento: asaasCobrancas.vencimento,
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
            vencimento: c.vencimento,
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
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cob] = await db.select().from(asaasCobrancas)
        .where(and(eq(asaasCobrancas.id, input.id), eq(asaasCobrancas.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!cob) throw new TRPCError({ code: "NOT_FOUND" });

      // Política: Asaas só PENDING; manual qualquer status. Cobrança em
      // fechamento de comissão fica congelada (vira item órfão no snapshot
      // se removida). Regra pura em `financeiro-duplicidade-rules`.
      const itensComissao = await db
        .select({ comissaoFechadaId: comissoesFechadasItens.comissaoFechadaId })
        .from(comissoesFechadasItens)
        .where(eq(comissoesFechadasItens.asaasCobrancaId, input.id))
        .limit(1);
      const { ehManual } = unwrapDecision(
        decidirExcluirCobranca(
          cob,
          itensComissao[0]?.comissaoFechadaId ?? null,
        ),
      );

      // Cobrança manual: deleta direto, sem chamar Asaas (não passou
      // pela API). Cobrança Asaas PENDING: chama API e depois remove local.
      if (ehManual) {
        await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, input.id));
      } else {
        const client = await requireAsaasClient(esc.escritorio.id);
        await client.excluirCobranca(cob.asaasPaymentId!);
        await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, input.id));
      }

      return { success: true };
    }),

  // ═════════════════════════════════════════════════════════════════════════
  // PAGADOR TERCEIRO (beneficiário lógico)
  // Resolve o caso "Carlos é cliente mas a esposa pagou via Asaas no CPF dela".
  // A cobrança Asaas mantém o contatoId pagador (auditoria), e o
  // contatoBeneficiarioId aponta pro contato CRM dono lógico do pagamento.
  // Elimina a necessidade de lançar manual duplicado.
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Marca esta cobrança como pagamento de OUTRO contato (beneficiário).
   * KPI / resumo do beneficiário / comissão usam beneficiário em lugar do
   * pagador. Reversível via `desvincularPagamentoBeneficiario`.
   *
   * Validações:
   *  - Cobrança e contato beneficiário pertencem ao escritório
   *  - Beneficiário != pagador (faz pouco sentido vincular ao mesmo)
   *  - Bloqueia se a cobrança já entrou em fechamento de comissão
   *    (snapshot imutável — primeiro exclui o fechamento)
   *
   * Reatribuição opcional de atendente: caller pode pedir pra atualizar
   * o atendenteId da cobrança pro responsável do contato beneficiário,
   * pra a comissão ir pra quem cuida do Carlos (não do CPF da esposa).
   */
  vincularPagamentoBeneficiario: protectedProcedure
    .input(
      z.object({
        cobrancaId: z.number().int().positive(),
        contatoBeneficiarioId: z.number().int().positive(),
        /** Se true, seta atendenteId = responsavelId do contato beneficiário. */
        reatribuirAtendente: z.boolean().default(false),
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
        .select({
          id: asaasCobrancas.id,
          contatoId: asaasCobrancas.contatoId,
        })
        .from(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.id, input.cobrancaId),
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!cob) throw new TRPCError({ code: "NOT_FOUND", message: "Cobrança não encontrada." });

      const [benef] = await db
        .select({ id: contatos.id, responsavelId: contatos.responsavelId })
        .from(contatos)
        .where(
          and(
            eq(contatos.id, input.contatoBeneficiarioId),
            eq(contatos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!benef) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contato beneficiário não encontrado." });
      }

      // Trava de integridade: cobrança em fechamento de comissão não pode
      // mudar de beneficiário (snapshot ficaria inconsistente). Regra
      // pura em `financeiro-duplicidade-rules`.
      const itemFech = await db
        .select({ comissaoFechadaId: comissoesFechadasItens.comissaoFechadaId })
        .from(comissoesFechadasItens)
        .where(eq(comissoesFechadasItens.asaasCobrancaId, input.cobrancaId))
        .limit(1);
      const { contatoBeneficiarioId, novoAtendenteId } = unwrapDecision(
        decidirVinculoBeneficiario({
          cob,
          benef,
          fechamentoComissaoId: itemFech[0]?.comissaoFechadaId ?? null,
          reatribuirAtendente: input.reatribuirAtendente,
        }),
      );

      const set: Record<string, unknown> = { contatoBeneficiarioId };
      if (novoAtendenteId !== null) {
        set.atendenteId = novoAtendenteId;
      }
      await db
        .update(asaasCobrancas)
        .set(set)
        .where(eq(asaasCobrancas.id, input.cobrancaId));

      return {
        success: true,
        atendenteReatribuido: novoAtendenteId,
      };
    }),

  /**
   * Remove o vínculo de beneficiário — a cobrança volta a contar pro
   * contato pagador original (contatoId). Reversível.
   */
  desvincularPagamentoBeneficiario: protectedProcedure
    .input(z.object({ cobrancaId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "editar");
      if (!perm.editar) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const itemFech = await db
        .select({ comissaoFechadaId: comissoesFechadasItens.comissaoFechadaId })
        .from(comissoesFechadasItens)
        .where(eq(comissoesFechadasItens.asaasCobrancaId, input.cobrancaId))
        .limit(1);
      if (itemFech.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cobrança já está no fechamento de comissão #${itemFech[0].comissaoFechadaId}. Exclua o fechamento antes de desvincular.`,
        });
      }

      await db
        .update(asaasCobrancas)
        .set({ contatoBeneficiarioId: null })
        .where(
          and(
            eq(asaasCobrancas.id, input.cobrancaId),
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          ),
        );
      return { success: true };
    }),

  /**
   * Busca cobranças que POSSIVELMENTE são a mesma do pagamento que o
   * operador está prestes a lançar manual. Usado pelo dialog "Nova
   * cobrança manual" pra detectar duplicata antes do submit — evita a
   * inflação do caixa que motivou o Sprint todo.
   *
   * Critério: mesma faixa de valor (±0.01) + data próxima
   * (vencimento OU dataPagamento dentro de ±janelaDias do alvo) +
   * cobrança pertence a OUTRO contato (não-auto) + sem beneficiário
   * (não-resolvida ainda).
   *
   * UI ideal: dispara onBlur do campo valor, mostra warning inline
   * "tem 1 pagamento Asaas de R$ 10k da Esposa Carlos em 12/05 que
   * pode ser este — vincular em vez de criar?".
   */
  buscarDuplicataPotencial: protectedProcedure
    .input(
      z.object({
        contatoBeneficiarioId: z.number().int().positive(),
        valor: z.number().positive(),
        /** Data de referência (vencimento da manual que vai criar). */
        dataReferencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        janelaDias: z.number().int().min(0).max(60).default(7),
      }),
    )
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "ver");
      if (!perm.verTodos && !perm.verProprios) return [];
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) return [];

      const valorCent = Math.round(input.valor * 100);
      const rows = await db
        .select({
          id: asaasCobrancas.id,
          asaasPaymentId: asaasCobrancas.asaasPaymentId,
          valor: asaasCobrancas.valor,
          status: asaasCobrancas.status,
          origem: asaasCobrancas.origem,
          dataPagamento: asaasCobrancas.dataPagamento,
          vencimento: asaasCobrancas.vencimento,
          descricao: asaasCobrancas.descricao,
          contatoIdPagador: asaasCobrancas.contatoId,
          contatoNomePagador: contatos.nome,
        })
        .from(asaasCobrancas)
        .leftJoin(contatos, eq(contatos.id, asaasCobrancas.contatoId))
        .where(
          and(
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
            inArray(asaasCobrancas.status, STATUS_PAGO_ASAAS as unknown as string[]),
            isNull(asaasCobrancas.contatoBeneficiarioId),
            sql`(${asaasCobrancas.contatoId} IS NULL OR ${asaasCobrancas.contatoId} != ${input.contatoBeneficiarioId})`,
            sql`ABS(ROUND(CAST(${asaasCobrancas.valor} AS DECIMAL(20,2)) * 100) - ${valorCent}) <= 1`,
            sql`(
              ABS(DATEDIFF(COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento}), ${input.dataReferencia})) <= ${input.janelaDias}
            )`,
          ),
        )
        .orderBy(desc(asaasCobrancas.dataPagamento))
        .limit(5);

      return rows.map((r) => ({
        ...r,
        valor: parseFloat(r.valor) || 0,
      }));
    }),

  /**
   * Lista cobranças do escritório que podem ser vinculadas como pagamento
   * deste contato (esposa/familiar pagou). Filtros aplicados:
   *  - Pagas (RECEIVED/CONFIRMED/RECEIVED_IN_CASH)
   *  - contatoBeneficiarioId IS NULL (ainda não atribuídas a ninguém)
   *  - contatoId != contatoBeneficiarioParaVincular (sem auto-vincular)
   *  - Busca opcional por nome do contato pagador / descrição
   *
   * UI usa pra popular um seletor "Vincular pagamento que entrou no nome de X
   * mas é deste cliente".
   */
  listarCobrancasParaVincularBeneficiario: protectedProcedure
    .input(
      z.object({
        contatoBeneficiarioId: z.number().int().positive(),
        busca: z.string().trim().max(120).optional(),
        /** Filtros adicionais — UI do dialog expõe pra restringir lista
         *  longa em escritórios com muitos pagamentos órfãos. */
        formaPagamento: z.array(z.string()).optional(),
        origem: z.enum(["manual", "asaas"]).optional(),
        valorMin: z.number().min(0).optional(),
        valorMax: z.number().min(0).optional(),
        periodoInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        periodoFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "ver");
      if (!perm.verTodos && !perm.verProprios) return [];
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) return [];

      const conds = [
        eq(asaasCobrancas.escritorioId, esc.escritorio.id),
        inArray(asaasCobrancas.status, STATUS_PAGO_ASAAS as unknown as string[]),
        isNull(asaasCobrancas.contatoBeneficiarioId),
        // Não permite vincular cobrança que já é deste contato (pagador =
        // beneficiário fica como NULL na coluna nova, mas a UI ainda
        // mostraria como candidata). Filtra explícito.
        sql`(${asaasCobrancas.contatoId} IS NULL OR ${asaasCobrancas.contatoId} != ${input.contatoBeneficiarioId})`,
      ];

      if (input.busca && input.busca.length > 0) {
        const pat = `%${input.busca.replace(/[%_]/g, (m) => "\\" + m)}%`;
        conds.push(
          or(
            like(asaasCobrancas.descricao, pat),
            like(contatos.nome, pat),
          )!,
        );
      }
      if (input.formaPagamento && input.formaPagamento.length > 0) {
        conds.push(inArray(asaasCobrancas.formaPagamento, input.formaPagamento as any));
      }
      if (input.origem === "manual") {
        conds.push(eq(asaasCobrancas.origem, "manual"));
      } else if (input.origem === "asaas") {
        conds.push(sql`${asaasCobrancas.origem} != 'manual'`);
      }
      if (input.valorMin !== undefined) {
        conds.push(sql`CAST(${asaasCobrancas.valor} AS DECIMAL(14,2)) >= ${input.valorMin}`);
      }
      if (input.valorMax !== undefined) {
        conds.push(sql`CAST(${asaasCobrancas.valor} AS DECIMAL(14,2)) <= ${input.valorMax}`);
      }
      if (input.periodoInicio) {
        conds.push(gte(asaasCobrancas.dataPagamento, input.periodoInicio));
      }
      if (input.periodoFim) {
        conds.push(lte(asaasCobrancas.dataPagamento, input.periodoFim));
      }

      return db
        .select({
          id: asaasCobrancas.id,
          asaasPaymentId: asaasCobrancas.asaasPaymentId,
          valor: asaasCobrancas.valor,
          status: asaasCobrancas.status,
          dataPagamento: asaasCobrancas.dataPagamento,
          descricao: asaasCobrancas.descricao,
          contatoIdPagador: asaasCobrancas.contatoId,
          contatoNomePagador: contatos.nome,
          contatoCpfPagador: contatos.cpfCnpj,
          origem: asaasCobrancas.origem,
          formaPagamento: asaasCobrancas.formaPagamento,
        })
        .from(asaasCobrancas)
        .leftJoin(contatos, eq(contatos.id, asaasCobrancas.contatoId))
        .where(and(...conds))
        .orderBy(desc(asaasCobrancas.dataPagamento))
        .limit(input.limit);
    }),

  /**
   * Versão em massa de `vincularPagamentoBeneficiario`. Aceita até 50
   * cobranças por chamada. Pra cada uma, aplica `decidirVinculoBeneficiario`
   * individualmente — se falha (já em fechamento, mesmo pagador, etc),
   * pula sem abortar o lote.
   *
   * Resposta: contadores + lista de erros por cobrancaId pra UI mostrar
   * o que falhou.
   */
  vincularPagamentoBeneficiarioEmMassa: protectedProcedure
    .input(
      z.object({
        cobrancaIds: z.array(z.number().int().positive()).min(1).max(50),
        contatoBeneficiarioId: z.number().int().positive(),
        reatribuirAtendente: z.boolean().default(false),
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

      const [benef] = await db
        .select({ id: contatos.id, responsavelId: contatos.responsavelId })
        .from(contatos)
        .where(
          and(
            eq(contatos.id, input.contatoBeneficiarioId),
            eq(contatos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!benef) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contato beneficiário não encontrado.",
        });
      }

      const cobs = await db
        .select({
          id: asaasCobrancas.id,
          contatoId: asaasCobrancas.contatoId,
        })
        .from(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
            inArray(asaasCobrancas.id, input.cobrancaIds),
          ),
        );

      const cobsMap = new Map(cobs.map((c) => [c.id, c]));
      const fechamentos = await db
        .select({
          asaasCobrancaId: comissoesFechadasItens.asaasCobrancaId,
          comissaoFechadaId: comissoesFechadasItens.comissaoFechadaId,
        })
        .from(comissoesFechadasItens)
        .where(inArray(comissoesFechadasItens.asaasCobrancaId, input.cobrancaIds));
      const fechamentoPorCobranca = new Map(
        fechamentos.map((f) => [f.asaasCobrancaId, f.comissaoFechadaId]),
      );

      let vinculadas = 0;
      let atendentesReatribuidos = 0;
      const erros: Array<{ cobrancaId: number; mensagem: string }> = [];

      for (const id of input.cobrancaIds) {
        const cob = cobsMap.get(id);
        if (!cob) {
          erros.push({ cobrancaId: id, mensagem: "Cobrança não encontrada" });
          continue;
        }
        const decision = decidirVinculoBeneficiario({
          cob,
          benef,
          fechamentoComissaoId: fechamentoPorCobranca.get(id) ?? null,
          reatribuirAtendente: input.reatribuirAtendente,
        });
        if (!decision.ok) {
          erros.push({ cobrancaId: id, mensagem: decision.message });
          continue;
        }
        const set: Record<string, unknown> = {
          contatoBeneficiarioId: decision.data.contatoBeneficiarioId,
        };
        if (decision.data.novoAtendenteId !== null) {
          set.atendenteId = decision.data.novoAtendenteId;
          atendentesReatribuidos++;
        }
        await db
          .update(asaasCobrancas)
          .set(set)
          .where(eq(asaasCobrancas.id, id));
        vinculadas++;
      }

      return { vinculadas, atendentesReatribuidos, erros };
    }),

  /**
   * Cancela várias cobranças PENDING em massa. Serializa as chamadas
   * ao Asaas (uma de cada vez) pra respeitar o rate limit da API — se
   * detectar `RateLimitError`, aborta o lote e devolve resumo do
   * progresso. O frontend antes disparava N mutations em paralelo no
   * `for (const c of selecionadas) excluirCobMut.mutate(...)`, podendo
   * estourar a cota de 12h da API key.
   *
   * Filtros aplicados aqui (não no input):
   *  - Ignora cobranças que não pertencem ao escritório do usuário
   *  - Ignora cobranças com status != PENDING (já paga/vencida/etc)
   *  - Cobranças com origem='manual' ou sem `asaasPaymentId` deletam
   *    direto no DB sem chamar a API
   *
   * Resposta: contadores agregados + lista de erros por id. UI pode
   * mostrar resumo "X canceladas, Y ignoradas, Z erros".
   */
  excluirCobrancasEmMassa: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "excluir");
      if (!perm.excluir) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para excluir cobranças no módulo Financeiro.",
        });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return executarExclusaoCobrancasEmMassa({
        db,
        escritorioId: esc.escritorio.id,
        ids: input.ids,
        getAsaasClient: () => requireAsaasClient(esc.escritorio.id),
      });
    }),

  // ═════════════════════════════════════════════════════════════════════════
  // RESET DE HISTÓRICO (operação destrutiva — só dono do escritório)
  //
  // Caso de uso: caixa contaminado por lançamentos manuais errados
  // (duplicatas tipo Carlos+esposa) — operador quer apagar tudo e
  // ressincronizar do Asaas pra ter um histórico limpo.
  //
  // Apaga (escopado por escritorioId): asaas_cobrancas, cobranca_acoes
  // (FK), comissoes_fechadas_itens (FK), comissoes_fechadas,
  // comissoes_lancamentos_log (idempotência de cron), asaas_webhook_eventos
  // (audit de eventos antigos).
  //
  // Preserva: asaas_config (API key + webhook), asaas_clientes (mapeamento
  // contato↔customer), asaas_config_cobranca_pai (config padrão), regras
  // de comissão, categorias, despesas, contatos.
  //
  // Após o reset, o usuário roda "Sincronizar tudo" (botão existente) pra
  // o Asaas reinserir o histórico baseado nos vínculos preservados.
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Dry-run do reset — retorna quantas linhas seriam apagadas em cada
   * tabela. UI mostra antes do operador digitar a confirmação. Read-only.
   */
  previaApagarHistoricoCobrancas: protectedProcedure.query(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    exigirDonoOuAdmin(ctx.user, esc);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const eid = esc.escritorio.id;
    const [cobs] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(asaasCobrancas)
      .where(eq(asaasCobrancas.escritorioId, eid));
    const [acoes] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(cobrancaAcoes)
      .innerJoin(asaasCobrancas, eq(asaasCobrancas.id, cobrancaAcoes.cobrancaId))
      .where(eq(asaasCobrancas.escritorioId, eid));
    const [comFech] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(comissoesFechadas)
      .where(eq(comissoesFechadas.escritorioId, eid));
    const [comItens] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(comissoesFechadasItens)
      .innerJoin(comissoesFechadas, eq(comissoesFechadas.id, comissoesFechadasItens.comissaoFechadaId))
      .where(eq(comissoesFechadas.escritorioId, eid));
    const [lancLog] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(comissoesLancamentosLog)
      .where(eq(comissoesLancamentosLog.escritorioId, eid));
    const [webhooks] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(asaasWebhookEventos)
      .where(eq(asaasWebhookEventos.escritorioId, eid));

    return {
      escritorioId: eid,
      escritorioNome: esc.escritorio.nome,
      apagar: {
        cobrancas: Number(cobs?.c ?? 0),
        cobrancaAcoes: Number(acoes?.c ?? 0),
        comissoesFechadas: Number(comFech?.c ?? 0),
        comissoesItens: Number(comItens?.c ?? 0),
        comissoesLogs: Number(lancLog?.c ?? 0),
        webhookEventos: Number(webhooks?.c ?? 0),
      },
      preservar: [
        "Configuração Asaas (API key + webhook)",
        "Mapeamento contato ↔ cliente Asaas",
        "Regras de comissão",
        "Categorias de cobrança",
        "Despesas e categorias de despesa",
        "Contatos, processos, clientes",
      ],
    };
  }),

  /**
   * Executa o reset. Confirmação dupla obrigatória:
   *  1. Gate de dono (não-dono → 403)
   *  2. Input `confirmacao` precisa ser exatamente o texto literal —
   *     evita clique acidental / endpoint chamado por engano
   *
   * Tudo em uma transação MySQL — rollback automático se algo falhar.
   * Ordem dos DELETEs respeita FKs (filhos primeiro, pai depois).
   */
  apagarHistoricoCobrancas: protectedProcedure
    .input(
      z.object({
        confirmacao: z.literal("RESETAR HISTORICO COBRANCAS"),
      }),
    )
    .mutation(async ({ ctx }) => {
      const esc = await requireEscritorio(ctx.user.id);
      exigirDonoOuAdmin(ctx.user, esc);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const eid = esc.escritorio.id;

      const deletados = {
        cobrancaAcoes: 0,
        comissoesItens: 0,
        comissoesFechadas: 0,
        comissoesLogs: 0,
        webhookEventos: 0,
        cobrancas: 0,
      };

      await db.transaction(async (tx) => {
        // 1. cobranca_acoes (FK → asaas_cobrancas). Filtra via join porque
        //    a tabela N:M não tem escritorioId direto.
        const acoesAlvo = await tx
          .select({ cobrancaId: cobrancaAcoes.cobrancaId })
          .from(cobrancaAcoes)
          .innerJoin(asaasCobrancas, eq(asaasCobrancas.id, cobrancaAcoes.cobrancaId))
          .where(eq(asaasCobrancas.escritorioId, eid));
        if (acoesAlvo.length > 0) {
          const cobIds = Array.from(new Set(acoesAlvo.map((a) => a.cobrancaId)));
          const r = await tx
            .delete(cobrancaAcoes)
            .where(inArray(cobrancaAcoes.cobrancaId, cobIds));
          deletados.cobrancaAcoes = (r as any)?.[0]?.affectedRows ?? acoesAlvo.length;
        }

        // 2. comissoes_fechadas_itens (FK → asaas_cobrancas e comissoes_fechadas).
        //    Filtra pelo escritorioId da comissão fechada.
        const fechIds = (
          await tx
            .select({ id: comissoesFechadas.id })
            .from(comissoesFechadas)
            .where(eq(comissoesFechadas.escritorioId, eid))
        ).map((r) => r.id);
        if (fechIds.length > 0) {
          const r = await tx
            .delete(comissoesFechadasItens)
            .where(inArray(comissoesFechadasItens.comissaoFechadaId, fechIds));
          deletados.comissoesItens = (r as any)?.[0]?.affectedRows ?? 0;
        }

        // 3. comissoes_fechadas (cabeçalho)
        if (fechIds.length > 0) {
          const r = await tx
            .delete(comissoesFechadas)
            .where(eq(comissoesFechadas.escritorioId, eid));
          deletados.comissoesFechadas = (r as any)?.[0]?.affectedRows ?? fechIds.length;
        }

        // 4. comissoes_lancamentos_log (idempotência de cron — referenciava
        //    comissaoFechadaId; sem cabeçalho, log fica órfão e atrapalha retries)
        const r4 = await tx
          .delete(comissoesLancamentosLog)
          .where(eq(comissoesLancamentosLog.escritorioId, eid));
        deletados.comissoesLogs = (r4 as any)?.[0]?.affectedRows ?? 0;

        // 5. asaas_webhook_eventos (audit antigo — não tem FK, mas faz parte
        //    do histórico que o usuário quer limpar)
        const r5 = await tx
          .delete(asaasWebhookEventos)
          .where(eq(asaasWebhookEventos.escritorioId, eid));
        deletados.webhookEventos = (r5 as any)?.[0]?.affectedRows ?? 0;

        // 6. asaas_cobrancas (pai — depois de todos os dependentes)
        const r6 = await tx
          .delete(asaasCobrancas)
          .where(eq(asaasCobrancas.escritorioId, eid));
        deletados.cobrancas = (r6 as any)?.[0]?.affectedRows ?? 0;
      });

      log.warn(
        { escritorioId: eid, userId: ctx.user.id, deletados },
        "Reset de histórico financeiro executado",
      );

      return {
        success: true,
        deletados,
        proximoPasso:
          "Vá em Financeiro → Sincronizar tudo (ou aguarde o cron) pra o Asaas reinserir o histórico baseado nos vínculos preservados.",
      };
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

  /** Obtém linha digitável do boleto. Linha digitável é imutável por
   *  boleto — uma vez emitida, o número não muda. Cacheamos em
   *  `asaas_cobrancas.linhaDigitavelPayload` (JSON serializado dos 3
   *  campos retornados pelo Asaas). Próximas leituras pulam a chamada
   *  externa — antes era 1 request Asaas por copy do boleto. */
  obterLinhaDigitavel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
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

      // Cache hit: payload já persistido localmente. Pula chamada Asaas.
      if (cob.linhaDigitavelPayload) {
        try {
          return JSON.parse(cob.linhaDigitavelPayload) as {
            identificationField: string;
            nossoNumero: string;
            barCode: string;
          };
        } catch {
          // JSON corrompido (improvável): cai pro fallback de buscar.
        }
      }

      const client = await requireAsaasClient(esc.escritorio.id);
      try {
        const payload = await client.obterLinhaDigitavel(cob.asaasPaymentId);
        // Cacheia pra próximas leituras. Falha aqui é não-fatal:
        // resposta volta normal pro usuário; só não cacheou.
        try {
          await db
            .update(asaasCobrancas)
            .set({ linhaDigitavelPayload: JSON.stringify(payload) })
            .where(eq(asaasCobrancas.id, cob.id));
        } catch {
          /* não bloqueia */
        }
        return payload;
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
   *  pertence a um colaborador individual.
   *
   *  Cache em DB: o frontend (Financeiro.tsx) faz polling de 5min por
   *  usuário aberto, e antes cada polling era 1 request direto ao Asaas.
   *  10 users do mesmo escritório = 10 requests/5min — desperdício de
   *  cota, todos retornando o mesmo número. Agora:
   *
   *    - Lê `asaas_config.saldo` do DB se < 10min de idade (TTL)
   *    - Se stale ou nunca buscado, chama Asaas + cacheia (com timestamp)
   *    - Webhook PAYMENT_RECEIVED/CONFIRMED zera o timestamp pra forçar
   *      refresh na próxima leitura (saldo provavelmente mudou)
   *
   *  Não-fatal: se a chamada Asaas falha (rate limit, rede), devolve o
   *  saldo cacheado mesmo que stale — UI mostra "saldo de há X minutos"
   *  é melhor que mostrar nada. */
  obterSaldo: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;

    const perm = await checkPermission(ctx.user.id, "financeiro", "ver");
    if (!perm.verTodos) return null;

    const db = await getDb();
    if (!db) return null;

    const [cfg] = await db
      .select({
        id: asaasConfig.id,
        saldo: asaasConfig.saldo,
        saldoAtualizadoEm: asaasConfig.saldoAtualizadoEm,
      })
      .from(asaasConfig)
      .where(eq(asaasConfig.escritorioId, esc.escritorio.id))
      .limit(1);

    if (!cfg) return null;

    const SALDO_CACHE_TTL_MS = 10 * 60 * 1000;
    const cacheValido =
      cfg.saldoAtualizadoEm !== null &&
      cfg.saldo !== null &&
      Date.now() - cfg.saldoAtualizadoEm.getTime() < SALDO_CACHE_TTL_MS;

    if (cacheValido) {
      return { balance: Number(cfg.saldo) || 0 };
    }

    const client = await getAsaasClient(esc.escritorio.id);
    if (!client) {
      // Sem client mas tem saldo cacheado → devolve stale (melhor que null)
      if (cfg.saldo !== null) return { balance: Number(cfg.saldo) || 0 };
      return null;
    }

    try {
      const saldo = await client.obterSaldo();
      await db
        .update(asaasConfig)
        .set({
          saldo: String(saldo.balance),
          saldoAtualizadoEm: new Date(),
        })
        .where(eq(asaasConfig.id, cfg.id));
      return saldo;
    } catch {
      // Falha na chamada Asaas (rate limit, rede): devolve cacheado se
      // houver. Pior que stale é nada — UI continua funcional.
      if (cfg.saldo !== null) return { balance: Number(cfg.saldo) || 0 };
      return null;
    }
  }),

  // ─── LIMPEZA DE CONTATOS ASAAS ÓRFÃOS ─────────────────────────────────────
  //
  // Contexto: o `sincronizarClientes` antigo (corrigido em PR #241) fazia
  // bulk import de TODOS os customers do Asaas, criando contatos no CRM
  // mesmo pra leads/inativos sem cobrança. Estas duas procedures dão um
  // caminho controlado pra limpar esses contatos órfãos depois.
  //
  // Critério de elegibilidade pra deletar:
  //  - origem='asaas'
  //  - mesmo escritório do user (multi-tenancy)
  //  - SEM cobrança vinculada (nenhuma linha em asaas_cobrancas)
  //  - SEM processo/ação vinculado (nenhuma linha em cliente_processos)
  //
  // Vínculo asaas_clientes é removido junto.

  /**
   * Preview da limpeza: conta quantos contatos seriam apagados e devolve
   * até 20 nomes pro user revisar antes de confirmar. Não muta nada.
   */
  preverLimpezaContatosAsaas: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "financeiro", "excluir");
    if (!perm.excluir) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão para excluir contatos do escritório.",
      });
    }
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const candidatos = await db
      .select({ id: contatos.id, nome: contatos.nome, createdAt: contatos.createdAt })
      .from(contatos)
      .where(
        and(
          eq(contatos.escritorioId, esc.escritorio.id),
          eq(contatos.origem, "asaas"),
        ),
      );

    if (candidatos.length === 0) return { total: 0, amostra: [] };

    const candidatoIds = candidatos.map((c) => c.id);

    const comCobranca = await db
      .selectDistinct({ contatoId: asaasCobrancas.contatoId })
      .from(asaasCobrancas)
      .where(
        and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          inArray(asaasCobrancas.contatoId, candidatoIds),
        ),
      );
    const setComCobranca = new Set(
      comCobranca.map((c) => c.contatoId).filter((x): x is number => !!x),
    );

    const comProcesso = await db
      .selectDistinct({ contatoId: clienteProcessos.contatoId })
      .from(clienteProcessos)
      .where(
        and(
          eq(clienteProcessos.escritorioId, esc.escritorio.id),
          inArray(clienteProcessos.contatoId, candidatoIds),
        ),
      );
    const setComProcesso = new Set(
      comProcesso.map((c) => c.contatoId).filter((x): x is number => !!x),
    );

    const orfaos = candidatos.filter(
      (c) => !setComCobranca.has(c.id) && !setComProcesso.has(c.id),
    );

    return {
      total: orfaos.length,
      amostra: orfaos.slice(0, 20).map((o) => ({
        id: o.id,
        nome: o.nome,
        createdAt: o.createdAt,
      })),
    };
  }),

  /**
   * Executa a limpeza. Idempotente — pode rodar várias vezes; novas
   * execuções com `total=0` no preview são no-op.
   *
   * Faz batch de até 5000 contatos por chamada (proteção contra delete
   * massivo acidental). Se houver mais, o user clica de novo.
   */
  executarLimpezaContatosAsaas: protectedProcedure.mutation(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "financeiro", "excluir");
    if (!perm.excluir) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão para excluir contatos do escritório.",
      });
    }
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const candidatos = await db
      .select({ id: contatos.id })
      .from(contatos)
      .where(
        and(
          eq(contatos.escritorioId, esc.escritorio.id),
          eq(contatos.origem, "asaas"),
        ),
      );

    if (candidatos.length === 0) {
      return { deletados: 0, vinculosRemovidos: 0 };
    }

    const candidatoIds = candidatos.map((c) => c.id);

    const comCobranca = await db
      .selectDistinct({ contatoId: asaasCobrancas.contatoId })
      .from(asaasCobrancas)
      .where(
        and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          inArray(asaasCobrancas.contatoId, candidatoIds),
        ),
      );
    const setComCobranca = new Set(
      comCobranca.map((c) => c.contatoId).filter((x): x is number => !!x),
    );

    const comProcesso = await db
      .selectDistinct({ contatoId: clienteProcessos.contatoId })
      .from(clienteProcessos)
      .where(
        and(
          eq(clienteProcessos.escritorioId, esc.escritorio.id),
          inArray(clienteProcessos.contatoId, candidatoIds),
        ),
      );
    const setComProcesso = new Set(
      comProcesso.map((c) => c.contatoId).filter((x): x is number => !!x),
    );

    const idsAlvo = candidatos
      .filter((c) => !setComCobranca.has(c.id) && !setComProcesso.has(c.id))
      .map((c) => c.id)
      .slice(0, 5000);

    if (idsAlvo.length === 0) {
      return { deletados: 0, vinculosRemovidos: 0 };
    }

    // Primeiro apaga vínculos asaas_clientes (FK lógico). Depois contatos.
    const rVinc = await db
      .delete(asaasClientes)
      .where(
        and(
          eq(asaasClientes.escritorioId, esc.escritorio.id),
          inArray(asaasClientes.contatoId, idsAlvo),
        ),
      );
    const vinculosRemovidos = Number(
      (rVinc as any)?.[0]?.affectedRows ?? (rVinc as any)?.affectedRows ?? 0,
    );

    const rContato = await db
      .delete(contatos)
      .where(
        and(
          eq(contatos.escritorioId, esc.escritorio.id),
          inArray(contatos.id, idsAlvo),
        ),
      );
    const deletados = Number(
      (rContato as any)?.[0]?.affectedRows ?? (rContato as any)?.affectedRows ?? 0,
    );

    log.info(
      { escritorioId: esc.escritorio.id, deletados, vinculosRemovidos },
      "[Asaas] Limpeza de contatos órfãos executada",
    );

    return { deletados, vinculosRemovidos };
  }),

  /**
   * Diagnostica possíveis duplicidades de cobranças/pagamentos no escritório.
   * Read-only — não cancela nem altera nada. Retorna 3 categorias:
   *
   * 1. Cobranças órfãs pagas: status RECEIVED/CONFIRMED/RECEIVED_IN_CASH
   *    sem `contatoId` vinculado. Típico de Pix em nome de terceiro
   *    (esposa/marido) que o webhook não conseguiu vincular ao cliente
   *    do CRM.
   *
   * 2. Pares suspeitos: 2 cobranças pagas com mesmo valor + dataPagamento
   *    ≤ 7 dias entre si + ao menos uma é manual ou órfã. Heurística
   *    grossa propositalmente — usuário valida caso a caso (parcelamentos
   *    do mesmo cliente ficam de fora via parcelamentoLocalId).
   *
   * 3. Cobranças manuais já-pagas (origem='manual', status pago): volume
   *    informativo, pra calibrar a probabilidade de duplicidade
   *    (manual já-paga é o caminho típico do cenário Carlos+Esposa).
   */
  /**
   * Lista TODOS os pares suspeitos com info detalhada de cada lado.
   * Versão completa do `diagnosticarDuplicidades.paresSuspeitos.exemplos`
   * (que cap em 5). Usada pelo wizard "Resolver duplicatas" pra mostrar
   * cobrança por cobrança e permitir auto-fix.
   *
   * Cada par traz: ambas cobranças completas + nomes de contatos +
   * indicadores se estão em fechamento de comissão (bloqueia ação).
   */
  listarParesSuspeitos: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "financeiro", "ver");
    if (!perm.verTodos && !perm.verProprios) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
    }
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) return [];

    const eid = esc.escritorio.id;
    const statusPagoList = STATUS_PAGO_ASAAS as unknown as string[];
    const aliasB = aliasedTable(asaasCobrancas, "b");

    const rows = await db
      .select({
        aId: asaasCobrancas.id,
        aValor: asaasCobrancas.valor,
        aOrigem: asaasCobrancas.origem,
        aContatoId: asaasCobrancas.contatoId,
        aContatoBeneficiarioId: asaasCobrancas.contatoBeneficiarioId,
        aDataPag: asaasCobrancas.dataPagamento,
        aStatus: asaasCobrancas.status,
        aDescricao: asaasCobrancas.descricao,
        aAsaasPaymentId: asaasCobrancas.asaasPaymentId,
        aFormaPag: asaasCobrancas.formaPagamento,
        bId: aliasB.id,
        bValor: aliasB.valor,
        bOrigem: aliasB.origem,
        bContatoId: aliasB.contatoId,
        bContatoBeneficiarioId: aliasB.contatoBeneficiarioId,
        bDataPag: aliasB.dataPagamento,
        bStatus: aliasB.status,
        bDescricao: aliasB.descricao,
        bAsaasPaymentId: aliasB.asaasPaymentId,
        bFormaPag: aliasB.formaPagamento,
      })
      .from(asaasCobrancas)
      .innerJoin(
        aliasB,
        and(
          eq(aliasB.escritorioId, asaasCobrancas.escritorioId),
          sql`${asaasCobrancas.id} < ${aliasB.id}`,
          eq(aliasB.valor, asaasCobrancas.valor),
          inArray(aliasB.status, statusPagoList),
          sql`ABS(DATEDIFF(${asaasCobrancas.dataPagamento}, ${aliasB.dataPagamento})) <= 7`,
        ),
      )
      .where(
        and(
          eq(asaasCobrancas.escritorioId, eid),
          inArray(asaasCobrancas.status, statusPagoList),
          sql`(${asaasCobrancas.origem} = 'manual' OR ${aliasB.origem} = 'manual'
               OR ${asaasCobrancas.contatoId} IS NULL OR ${aliasB.contatoId} IS NULL)`,
          sql`(${asaasCobrancas.parcelamentoLocalId} IS NULL
               OR ${aliasB.parcelamentoLocalId} IS NULL
               OR ${asaasCobrancas.parcelamentoLocalId} != ${aliasB.parcelamentoLocalId})`,
          // Match por contato: pares só são suspeitos se forem do MESMO contato
          // OU se pelo menos uma das cobranças está órfã (contatoId NULL — o
          // operador precisa decidir antes de declarar duplicata). Sem essa
          // restrição, 1 cobrança órfã de R$50 emparelhava com TODAS as outras
          // cobranças de R$50 pagas naquela semana (bug do "38 pares" — uma
          // cobrança sem contato falsamente parece duplicata de qualquer cliente
          // que pagou o mesmo valor por coincidência).
          sql`(
            ${asaasCobrancas.contatoId} IS NULL
            OR ${aliasB.contatoId} IS NULL
            OR ${asaasCobrancas.contatoId} = ${aliasB.contatoId}
          )`,
          // Filtro: par já resolvido por beneficiário não aparece mais.
          // Se A.contatoBeneficiarioId == B.contatoId ou B.contatoBeneficiarioId
          // == A.contatoId, o operador já consolidou esse par via "vincular
          // pagamento de terceiro" — não precisa aparecer no wizard.
          //
          // COALESCE crítico: `NULL = X` é NULL (não FALSE) em SQL, e `NOT NULL`
          // continua NULL, que o WHERE trata como falso → excluiria TODOS os
          // pares novos (contatoBeneficiarioId IS NULL nos dois lados é o caso
          // comum). Sem COALESCE, o banner mostra count mas wizard vem vazio.
          sql`NOT (
            COALESCE(${asaasCobrancas.contatoBeneficiarioId} = ${aliasB.contatoId}, FALSE)
            OR COALESCE(${aliasB.contatoBeneficiarioId} = ${asaasCobrancas.contatoId}, FALSE)
          )`,
        ),
      )
      .orderBy(desc(asaasCobrancas.dataPagamento))
      .limit(200);

    if (rows.length === 0) return [];

    // Enriquece com nomes de contatos pra UI mostrar "Esposa Carlos ↔ Carlos".
    const contatoIds = new Set<number>();
    for (const r of rows) {
      if (r.aContatoId) contatoIds.add(r.aContatoId);
      if (r.bContatoId) contatoIds.add(r.bContatoId);
    }
    const contatosList =
      contatoIds.size > 0
        ? await db
            .select({ id: contatos.id, nome: contatos.nome })
            .from(contatos)
            .where(
              and(
                eq(contatos.escritorioId, eid),
                inArray(contatos.id, Array.from(contatoIds)),
              ),
            )
        : [];
    const nomePorContato = new Map<number, string>(
      contatosList.map((c) => [c.id, c.nome]),
    );

    // Marca quais ids estão em fechamento de comissão (bloqueio de ação).
    const todosIds = rows.flatMap((r) => [r.aId, r.bId]);
    const itensFech =
      todosIds.length > 0
        ? await db
            .select({ asaasCobrancaId: comissoesFechadasItens.asaasCobrancaId })
            .from(comissoesFechadasItens)
            .where(inArray(comissoesFechadasItens.asaasCobrancaId, todosIds))
        : [];
    const idsEmFechamento = new Set(
      itensFech.map((i) => i.asaasCobrancaId),
    );

    return rows.map((r) => ({
      a: {
        id: r.aId,
        valor: parseFloat(r.aValor) || 0,
        origem: r.aOrigem,
        contatoId: r.aContatoId,
        contatoNome: r.aContatoId ? nomePorContato.get(r.aContatoId) ?? null : null,
        dataPagamento: r.aDataPag,
        status: r.aStatus,
        descricao: r.aDescricao,
        asaasPaymentId: r.aAsaasPaymentId,
        formaPagamento: r.aFormaPag,
        emFechamento: idsEmFechamento.has(r.aId),
      },
      b: {
        id: r.bId,
        valor: parseFloat(r.bValor) || 0,
        origem: r.bOrigem,
        contatoId: r.bContatoId,
        contatoNome: r.bContatoId ? nomePorContato.get(r.bContatoId) ?? null : null,
        dataPagamento: r.bDataPag,
        status: r.bStatus,
        descricao: r.bDescricao,
        asaasPaymentId: r.bAsaasPaymentId,
        formaPagamento: r.bFormaPag,
        emFechamento: idsEmFechamento.has(r.bId),
      },
    }));
  }),

  /**
   * Resolve UM par suspeito de uma vez (auto-fix em transação).
   *
   * Caso de uso típico: par Asaas+manual (Carlos+esposa). O wizard chama
   * com a Asaas como "manter" e a manual como "remover". Backend:
   *   1. Valida que a "manter" existe e não está em fechamento
   *   2. (opcional) Vincula "manter" como pagamento beneficiário do
   *      contato da "remover" — preserva o histórico no perfil correto
   *   3. Exclui a "remover" (manual qualquer status; Asaas só PENDING)
   *   4. Tudo em transação MySQL — rollback automático se algo falhar
   *
   * Se `vincularBeneficiario=false`, só remove a cobrança escolhida.
   * Útil quando o operador olha o par e decide "as duas são reais, só
   * uma delas tava errada".
   */
  resolverDuplicataPar: protectedProcedure
    .input(
      z.object({
        manterCobrancaId: z.number().int().positive(),
        removerCobrancaId: z.number().int().positive(),
        /** Se true, "manter" ganha contatoBeneficiarioId = contatoId da "remover".
         *  Quando false, só exclui sem vincular. */
        vincularBeneficiario: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "financeiro", "excluir");
      if (!perm.excluir) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      }
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Lê ambas em paralelo. Valida escritório.
      const [manter] = await db
        .select()
        .from(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.id, input.manterCobrancaId),
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      const [remover] = await db
        .select()
        .from(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.id, input.removerCobrancaId),
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);

      if (!manter || !remover) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Uma das cobranças não foi encontrada no seu escritório.",
        });
      }

      const itensFech = await db
        .select({ asaasCobrancaId: comissoesFechadasItens.asaasCobrancaId })
        .from(comissoesFechadasItens)
        .where(
          inArray(comissoesFechadasItens.asaasCobrancaId, [
            input.manterCobrancaId,
            input.removerCobrancaId,
          ]),
        );
      const idsEmFech = new Set(itensFech.map((i) => i.asaasCobrancaId));

      // Regra pura: valida matriz (mesma id, fechamento, status Asaas,
      // manual-only no auto-fix) — `financeiro-duplicidade-rules`.
      const { vincularBeneficiarioPara } = unwrapDecision(
        decidirResolverPar({
          manter,
          remover,
          manterEmFechamento: idsEmFech.has(input.manterCobrancaId),
          removerEmFechamento: idsEmFech.has(input.removerCobrancaId),
          vincularBeneficiario: input.vincularBeneficiario,
        }),
      );

      // Auto-fix em transação: vincula + remove. Se algo falhar, rollback.
      await db.transaction(async (tx) => {
        if (
          vincularBeneficiarioPara !== null &&
          manter.contatoId !== vincularBeneficiarioPara
        ) {
          await tx
            .update(asaasCobrancas)
            .set({ contatoBeneficiarioId: vincularBeneficiarioPara })
            .where(eq(asaasCobrancas.id, input.manterCobrancaId));
        }
        await tx
          .delete(asaasCobrancas)
          .where(eq(asaasCobrancas.id, input.removerCobrancaId));
      });

      return {
        success: true,
        vinculouBeneficiario: vincularBeneficiarioPara !== null,
        beneficiarioId: vincularBeneficiarioPara,
      };
    }),

  diagnosticarDuplicidades: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "financeiro", "ver");
    if (!perm.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão pra ler o financeiro.",
      });
    }
    const esc = await requireEscritorio(ctx.user.id);
    const db = await getDb();
    if (!db) {
      return {
        orfasRecebidas: { count: 0, valorTotal: 0 },
        paresSuspeitos: { count: 0, valorTotal: 0, exemplos: [] },
        manuaisJaPagas: { count: 0, valorTotal: 0 },
      };
    }

    const eid = esc.escritorio.id;
    const statusPagoList = STATUS_PAGO_ASAAS as unknown as string[];
    const valorDec = sql`CAST(${asaasCobrancas.valor} AS DECIMAL(20,2))`;

    // 1. Órfãs pagas
    const [orfas] = await db
      .select({
        count: sql<number>`COUNT(*)`,
        valorTotal: sql<string>`COALESCE(SUM(${valorDec}), 0)`,
      })
      .from(asaasCobrancas)
      .where(and(
        eq(asaasCobrancas.escritorioId, eid),
        isNull(asaasCobrancas.contatoId),
        inArray(asaasCobrancas.status, statusPagoList),
      ));

    // 2. Pares suspeitos via self-join. Heurística: mesmo valor + datas próximas,
    //    pelo menos uma é manual ou órfã. Exclui parcelas do mesmo parcelamento.
    //    a.id < b.id evita contar (A,B) e (B,A) como duplicata.
    const aliasB = aliasedTable(asaasCobrancas, "b");
    const paresRows = await db
      .select({
        aId: asaasCobrancas.id,
        bId: aliasB.id,
        valor: asaasCobrancas.valor,
        aContatoId: asaasCobrancas.contatoId,
        aOrigem: asaasCobrancas.origem,
        aDataPag: asaasCobrancas.dataPagamento,
        bContatoId: aliasB.contatoId,
        bOrigem: aliasB.origem,
        bDataPag: aliasB.dataPagamento,
      })
      .from(asaasCobrancas)
      .innerJoin(
        aliasB,
        and(
          eq(aliasB.escritorioId, asaasCobrancas.escritorioId),
          sql`${asaasCobrancas.id} < ${aliasB.id}`,
          eq(aliasB.valor, asaasCobrancas.valor),
          inArray(aliasB.status, statusPagoList),
          sql`ABS(DATEDIFF(${asaasCobrancas.dataPagamento}, ${aliasB.dataPagamento})) <= 7`,
        ),
      )
      .where(and(
        eq(asaasCobrancas.escritorioId, eid),
        inArray(asaasCobrancas.status, statusPagoList),
        // Pelo menos um lado é manual ou órfã
        sql`(${asaasCobrancas.origem} = 'manual' OR ${aliasB.origem} = 'manual'
             OR ${asaasCobrancas.contatoId} IS NULL OR ${aliasB.contatoId} IS NULL)`,
        // Exclui parcelas do mesmo parcelamento
        sql`(${asaasCobrancas.parcelamentoLocalId} IS NULL
             OR ${aliasB.parcelamentoLocalId} IS NULL
             OR ${asaasCobrancas.parcelamentoLocalId} != ${aliasB.parcelamentoLocalId})`,
      ))
      .limit(100);

    const paresValorTotal = paresRows.reduce(
      (acc, p) => acc + (parseFloat(p.valor as string) || 0),
      0,
    );
    const exemplos = paresRows.slice(0, 5).map((p) => ({
      idA: p.aId,
      idB: p.bId,
      valor: parseFloat(p.valor as string) || 0,
      lados: `${p.aOrigem === "manual" ? "manual" : p.aContatoId == null ? "órfã" : "asaas"} ↔ ${p.bOrigem === "manual" ? "manual" : p.bContatoId == null ? "órfã" : "asaas"}`,
      dataPagA: p.aDataPag,
      dataPagB: p.bDataPag,
    }));

    // 3. Manuais já-pagas (volume informativo)
    const [manuais] = await db
      .select({
        count: sql<number>`COUNT(*)`,
        valorTotal: sql<string>`COALESCE(SUM(${valorDec}), 0)`,
      })
      .from(asaasCobrancas)
      .where(and(
        eq(asaasCobrancas.escritorioId, eid),
        eq(asaasCobrancas.origem, "manual"),
        inArray(asaasCobrancas.status, statusPagoList),
      ));

    return {
      orfasRecebidas: {
        count: Number(orfas?.count ?? 0),
        valorTotal: Number(orfas?.valorTotal ?? 0),
      },
      paresSuspeitos: {
        count: paresRows.length,
        valorTotal: paresValorTotal,
        exemplos,
      },
      manuaisJaPagas: {
        count: Number(manuais?.count ?? 0),
        valorTotal: Number(manuais?.valorTotal ?? 0),
      },
    };
  }),
});
