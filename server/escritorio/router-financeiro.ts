import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  asaasClientes,
  asaasCobrancas,
  categoriasCobranca,
  contatos,
  despesas,
  financeiroAnexos,
  ofxImportacoesFitid,
} from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { checkPermission } from "./check-permission";
import {
  aplicarConciliacaoOFXEmLote,
  atribuirCobrancasEmMassa,
  atualizarCategoriaCobranca,
  atualizarCategoriaDespesa,
  criarCategoriaCobranca,
  criarCategoriaDespesa,
  garantirCategoriasPadrao,
  listarCategoriasCobranca,
  listarCategoriasDespesa,
  listarFaixasComissao,
  obterRegraComissao,
  reconciliarCobrancasOrfas,
  salvarRegraComissao,
} from "./db-financeiro";

async function requireEscritorio(userId: number) {
  const result = await getEscritorioPorUsuario(userId);
  if (!result) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Escritório não encontrado.",
    });
  }
  return result;
}

/**
 * Gate único do módulo Financeiro pra qualquer ação. Respeita a matriz
 * de permissões (`checkPermission`) — funciona com cargos legados
 * (dono/gestor/etc.) e cargos personalizados configurados pelo admin.
 *
 * Substituiu o antigo `requireGestao(cargo)` que era hardcode
 * dono/gestor e ignorava cargos personalizados.
 */
async function exigirAcaoFinanceiro(
  userId: number,
  acao: "ver" | "criar" | "editar" | "excluir",
): Promise<void> {
  const perm = await checkPermission(userId, "financeiro", acao);
  const ok =
    (acao === "ver" && (perm.verTodos || perm.verProprios)) ||
    (acao === "criar" && perm.criar) ||
    (acao === "editar" && perm.editar) ||
    (acao === "excluir" && perm.excluir);
  if (!ok) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Sem permissão para ${acao} no módulo Financeiro.`,
    });
  }
}

const NOME_CAT = z.string().min(1).max(80);

export type FiltroComissaoValor = "sim" | "nao" | "indef";

/**
 * Decide o estado efetivo de comissão (sim/não/indef) combinando o
 * override manual + a flag da categoria. Espelha em JS a regra que o
 * SQL aplica em `buildFiltroComissaoSQL` — facilita testar a semântica
 * sem precisar de banco.
 */
export function decidirEstadoComissao(
  override: boolean | null,
  categoriaComissionavel: boolean | null,
): FiltroComissaoValor {
  if (override === true) return "sim";
  if (override === false) return "nao";
  if (categoriaComissionavel === true) return "sim";
  if (categoriaComissionavel === false) return "nao";
  return "indef";
}

/**
 * Monta a condição SQL pra filtrar cobranças pelo estado efetivo de
 * comissão. Vazio → undefined (sem filtro). Múltiplos estados → união
 * (OR). Requer JOIN com `categorias_cobranca` (pra resolver herança).
 */
export function buildFiltroComissaoSQL(estados: FiltroComissaoValor[]) {
  if (estados.length === 0) return undefined;
  const partes = estados.map((e) => {
    if (e === "sim") {
      return or(
        eq(asaasCobrancas.comissionavelOverride, true),
        and(
          isNull(asaasCobrancas.comissionavelOverride),
          eq(categoriasCobranca.comissionavel, true),
        )!,
      )!;
    }
    if (e === "nao") {
      return or(
        eq(asaasCobrancas.comissionavelOverride, false),
        and(
          isNull(asaasCobrancas.comissionavelOverride),
          isNotNull(asaasCobrancas.categoriaId),
          eq(categoriasCobranca.comissionavel, false),
        )!,
      )!;
    }
    return and(
      isNull(asaasCobrancas.comissionavelOverride),
      isNull(asaasCobrancas.categoriaId),
    )!;
  });
  return partes.length === 1 ? partes[0] : or(...partes)!;
}

export const financeiroRouter = router({
  // ─── Categorias de cobrança ────────────────────────────────────────────────

  listarCategoriasCobranca: protectedProcedure.query(async ({ ctx }) => {
    await exigirAcaoFinanceiro(ctx.user.id, "ver");
    const esc = await requireEscritorio(ctx.user.id);
    await garantirCategoriasPadrao(esc.escritorio.id);
    return listarCategoriasCobranca(esc.escritorio.id);
  }),

  criarCategoriaCobranca: protectedProcedure
    .input(z.object({ nome: NOME_CAT, comissionavel: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "criar");
      const id = await criarCategoriaCobranca(
        esc.escritorio.id,
        input.nome.trim(),
        input.comissionavel,
      );
      return { id };
    }),

  atualizarCategoriaCobranca: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        nome: NOME_CAT.optional(),
        comissionavel: z.boolean().optional(),
        ativo: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "editar");
      const { id, ...dados } = input;
      await atualizarCategoriaCobranca(id, esc.escritorio.id, dados);
      return { success: true };
    }),

  // ─── Categorias de despesa ─────────────────────────────────────────────────

  listarCategoriasDespesa: protectedProcedure.query(async ({ ctx }) => {
    await exigirAcaoFinanceiro(ctx.user.id, "ver");
    const esc = await requireEscritorio(ctx.user.id);
    await garantirCategoriasPadrao(esc.escritorio.id);
    return listarCategoriasDespesa(esc.escritorio.id);
  }),

  criarCategoriaDespesa: protectedProcedure
    .input(z.object({ nome: NOME_CAT }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "criar");
      const id = await criarCategoriaDespesa(esc.escritorio.id, input.nome.trim());
      return { id };
    }),

  atualizarCategoriaDespesa: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        nome: NOME_CAT.optional(),
        ativo: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "editar");
      const { id, ...dados } = input;
      await atualizarCategoriaDespesa(id, esc.escritorio.id, dados);
      return { success: true };
    }),

  // ─── Regra de comissão (singleton por escritório) ──────────────────────────

  obterRegraComissao: protectedProcedure.query(async ({ ctx }) => {
    await exigirAcaoFinanceiro(ctx.user.id, "ver");
    const esc = await requireEscritorio(ctx.user.id);
    const regra = await obterRegraComissao(esc.escritorio.id);
    const faixas = await listarFaixasComissao(esc.escritorio.id);
    if (!regra) {
      // Defaults sem persistir.
      return {
        aliquotaPercent: "0.00",
        modo: "flat" as const,
        baseFaixa: "comissionavel" as const,
        valorMinimoCobranca: "0.00",
        diaVencimentoDespesa: 5,
        faixas: [] as Array<{ limiteAte: string | null; aliquotaPercent: string }>,
      };
    }
    return {
      aliquotaPercent: regra.aliquotaPercent,
      modo: regra.modo,
      baseFaixa: regra.baseFaixa,
      valorMinimoCobranca: regra.valorMinimoCobranca,
      diaVencimentoDespesa: regra.diaVencimentoDespesa,
      faixas: faixas.map((f) => ({
        limiteAte: f.limiteAte,
        aliquotaPercent: f.aliquotaPercent,
      })),
    };
  }),

  salvarRegraComissao: protectedProcedure
    .input(
      z.object({
        modo: z.enum(["flat", "faixas"]).default("flat"),
        aliquotaPercent: z.number().min(0).max(100),
        valorMinimoCobranca: z.number().min(0),
        baseFaixa: z.enum(["bruto", "comissionavel"]).default("comissionavel"),
        /**
         * Dia do mês seguinte em que a despesa de comissão vence. 1-31.
         * Clamp pra último dia do mês acontece em `calcularVencimentoComissao`.
         * Default 5 preserva comportamento anterior ao campo virar configurável.
         */
        diaVencimentoDespesa: z.number().int().min(1).max(31).default(5),
        /**
         * Tabela de faixas. Última faixa pode ter `limiteAte: null` para
         * representar "sem teto". Vazia quando modo='flat'.
         */
        faixas: z
          .array(
            z.object({
              limiteAte: z.number().min(0).nullable(),
              aliquotaPercent: z.number().min(0).max(100),
            }),
          )
          .max(20)
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "editar");

      // Validação extra de coerência das faixas:
      if (input.modo === "faixas") {
        if (input.faixas.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Modo 'faixas' exige pelo menos uma faixa configurada.",
          });
        }
        // Limites finitos devem ser estritamente crescentes; só a última pode ser null.
        let anterior = -1;
        for (let i = 0; i < input.faixas.length; i++) {
          const f = input.faixas[i];
          if (f.limiteAte === null && i !== input.faixas.length - 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Apenas a última faixa pode ter limite 'sem teto'.",
            });
          }
          if (f.limiteAte !== null) {
            if (f.limiteAte <= anterior) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Os limites das faixas precisam ser crescentes.",
              });
            }
            anterior = f.limiteAte;
          }
        }
      }

      await salvarRegraComissao(esc.escritorio.id, {
        modo: input.modo,
        aliquotaPercent: input.aliquotaPercent,
        valorMinimoCobranca: input.valorMinimoCobranca,
        baseFaixa: input.baseFaixa,
        faixas: input.faixas,
        diaVencimentoDespesa: input.diaVencimentoDespesa,
      });
      return { success: true };
    }),

  // ─── Cobranças sincronizadas: atribuição em massa + reconciliação ──────────

  /**
   * Lista cobranças do escritório para a tela de atribuição.
   *
   * Filtros suportados (todos opcionais — combinados com AND):
   *  - apenasSemAtribuicao: sem atendente OU sem categoria
   *  - apenasSemDecisaoComissao: sem override E sem categoria
   *  - q: busca textual em descrição OU nome do contato
   *  - criadoDe/criadoAte: range em `createdAt`
   *  - recebidoDe/recebidoAte: range em `dataPagamento`
   *  - atendenteIds / incluirSemAtendente: IN (ids) OR IS NULL
   *  - categoriaIds / incluirSemCategoria: IN (ids) OR IS NULL
   *  - statuses: IN (...)
   *  - formasPagamento: IN (...)
   *  - valorMin/valorMax: cast pra DECIMAL e compara
   *  - comissao: estados "sim"/"nao"/"indef" (resolve override + categoria)
   *
   * Retorna `{ rows, totalEncontrado }` — `totalEncontrado` é a contagem
   * ANTES do limit, pra UI mostrar "Mostrando 200 de 347".
   */
  listarCobrancasParaAtribuicao: protectedProcedure
    .input(
      z
        .object({
          apenasSemAtribuicao: z.boolean().default(false),
          apenasSemDecisaoComissao: z.boolean().default(false),
          q: z.string().trim().max(120).optional(),
          criadoDe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          criadoAte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          recebidoDe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          recebidoAte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          atendenteIds: z.array(z.number().int()).max(100).optional(),
          incluirSemAtendente: z.boolean().default(false),
          categoriaIds: z.array(z.number().int()).max(100).optional(),
          incluirSemCategoria: z.boolean().default(false),
          statuses: z.array(z.string().max(64)).max(20).optional(),
          formasPagamento: z
            .array(
              z.enum([
                "BOLETO",
                "CREDIT_CARD",
                "PIX",
                "UNDEFINED",
                "DINHEIRO",
                "TRANSFERENCIA",
                "OUTRO",
              ]),
            )
            .max(10)
            .optional(),
          valorMin: z.number().nonnegative().optional(),
          valorMax: z.number().nonnegative().optional(),
          comissao: z.array(z.enum(["sim", "nao", "indef"])).max(3).optional(),
          limit: z.number().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      const db = await getDb();
      if (!db) return { rows: [], totalEncontrado: 0 };

      const conds = [eq(asaasCobrancas.escritorioId, esc.escritorio.id)];

      if (input?.apenasSemAtribuicao) {
        conds.push(
          or(
            isNull(asaasCobrancas.atendenteId),
            isNull(asaasCobrancas.categoriaId),
          )!,
        );
      }
      if (input?.apenasSemDecisaoComissao) {
        conds.push(isNull(asaasCobrancas.comissionavelOverride));
        conds.push(isNull(asaasCobrancas.categoriaId));
      }

      if (input?.q && input.q.length > 0) {
        const pat = `%${input.q.replace(/[%_]/g, (m) => "\\" + m)}%`;
        conds.push(
          or(
            like(asaasCobrancas.descricao, pat),
            like(contatos.nome, pat),
          )!,
        );
      }

      if (input?.criadoDe) {
        conds.push(gte(asaasCobrancas.createdAt, new Date(input.criadoDe)));
      }
      if (input?.criadoAte) {
        const ate = new Date(input.criadoAte);
        ate.setUTCHours(23, 59, 59, 999);
        conds.push(lte(asaasCobrancas.createdAt, ate));
      }

      if (input?.recebidoDe) {
        conds.push(gte(asaasCobrancas.dataPagamento, input.recebidoDe));
      }
      if (input?.recebidoAte) {
        conds.push(lte(asaasCobrancas.dataPagamento, input.recebidoAte));
      }

      const atendIds = input?.atendenteIds ?? [];
      const incSemAt = !!input?.incluirSemAtendente;
      if (atendIds.length > 0 || incSemAt) {
        const partes = [];
        if (atendIds.length > 0) {
          partes.push(inArray(asaasCobrancas.atendenteId, atendIds));
        }
        if (incSemAt) partes.push(isNull(asaasCobrancas.atendenteId));
        conds.push(partes.length === 1 ? partes[0]! : or(...partes)!);
      }

      const catIds = input?.categoriaIds ?? [];
      const incSemCat = !!input?.incluirSemCategoria;
      if (catIds.length > 0 || incSemCat) {
        const partes = [];
        if (catIds.length > 0) {
          partes.push(inArray(asaasCobrancas.categoriaId, catIds));
        }
        if (incSemCat) partes.push(isNull(asaasCobrancas.categoriaId));
        conds.push(partes.length === 1 ? partes[0]! : or(...partes)!);
      }

      if (input?.statuses && input.statuses.length > 0) {
        conds.push(inArray(asaasCobrancas.status, input.statuses));
      }
      if (input?.formasPagamento && input.formasPagamento.length > 0) {
        conds.push(
          inArray(asaasCobrancas.formaPagamento, input.formasPagamento),
        );
      }

      if (input?.valorMin !== undefined) {
        conds.push(
          sql`CAST(${asaasCobrancas.valor} AS DECIMAL(20,2)) >= ${input.valorMin}`,
        );
      }
      if (input?.valorMax !== undefined) {
        conds.push(
          sql`CAST(${asaasCobrancas.valor} AS DECIMAL(20,2)) <= ${input.valorMax}`,
        );
      }

      const comissaoCond = buildFiltroComissaoSQL(input?.comissao ?? []);
      if (comissaoCond) conds.push(comissaoCond);

      const where = and(...conds);

      const [rows, totalRes] = await Promise.all([
        db
          .select({
            id: asaasCobrancas.id,
            asaasPaymentId: asaasCobrancas.asaasPaymentId,
            contatoId: asaasCobrancas.contatoId,
            contatoNome: contatos.nome,
            valor: asaasCobrancas.valor,
            status: asaasCobrancas.status,
            dataPagamento: asaasCobrancas.dataPagamento,
            vencimento: asaasCobrancas.vencimento,
            descricao: asaasCobrancas.descricao,
            formaPagamento: asaasCobrancas.formaPagamento,
            atendenteId: asaasCobrancas.atendenteId,
            categoriaId: asaasCobrancas.categoriaId,
            categoriaNome: categoriasCobranca.nome,
            // Flag herdada da categoria — usada pelo UI pra resolver o
            // estado "Sim/Não/Indefinido" da coluna Comissão na tabela
            // Atribuir. Quando comissionavelOverride é null, usamos esta;
            // se ambas null → "Indefinido" (precisa decisão).
            categoriaComissionavel: categoriasCobranca.comissionavel,
            comissionavelOverride: asaasCobrancas.comissionavelOverride,
          })
          .from(asaasCobrancas)
          .leftJoin(contatos, eq(contatos.id, asaasCobrancas.contatoId))
          .leftJoin(
            categoriasCobranca,
            eq(categoriasCobranca.id, asaasCobrancas.categoriaId),
          )
          .where(where)
          .orderBy(desc(asaasCobrancas.createdAt))
          .limit(input?.limit ?? 200),
        db
          .select({ total: sql<number>`COUNT(*)` })
          .from(asaasCobrancas)
          .leftJoin(contatos, eq(contatos.id, asaasCobrancas.contatoId))
          .leftJoin(
            categoriasCobranca,
            eq(categoriasCobranca.id, asaasCobrancas.categoriaId),
          )
          .where(where),
      ]);

      const totalEncontrado = Number(totalRes[0]?.total ?? 0);
      return { rows, totalEncontrado };
    }),

  /**
   * Contadores leves pros banners de pendência na aba Cobranças do Financeiro.
   * Query SQL agregada — não carrega rows.
   *
   * 3 contadores hoje:
   *  - semCategoria — afeta DRE
   *  - semAtendente — afeta comissão
   *  - semContato   — afeta tudo (cobrança órfã = sem cliente, vinda de
   *                   webhook que chegou antes do vínculo asaas_clientes)
   *
   * Só conta pra quem tem `verTodos` no financeiro (banner é mensagem
   * de gestão pro escritório inteiro). User com só `verProprios` recebe
   * zeros — não é o público-alvo do banner de "limpe sua casa".
   */
  contadoresPendencia: protectedProcedure.query(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    const perm = await checkPermission(ctx.user.id, "financeiro", "ver");
    if (!perm.verTodos) {
      return { semCategoria: 0, semAtendente: 0, semContato: 0 };
    }
    const db = await getDb();
    if (!db) return { semCategoria: 0, semAtendente: 0, semContato: 0 };

    const [row] = await db
      .select({
        semCategoria: sql<number>`SUM(CASE WHEN ${asaasCobrancas.categoriaId} IS NULL THEN 1 ELSE 0 END)`,
        semAtendente: sql<number>`SUM(CASE WHEN ${asaasCobrancas.atendenteId} IS NULL THEN 1 ELSE 0 END)`,
        semContato: sql<number>`SUM(CASE WHEN ${asaasCobrancas.contatoId} IS NULL THEN 1 ELSE 0 END)`,
      })
      .from(asaasCobrancas)
      .where(eq(asaasCobrancas.escritorioId, esc.escritorio.id));

    return {
      semCategoria: Number(row?.semCategoria ?? 0),
      semAtendente: Number(row?.semAtendente ?? 0),
      semContato: Number(row?.semContato ?? 0),
    };
  }),

  /**
   * Lista cobranças sem cliente (contatoId NULL) agrupadas por
   * asaasCustomerId, retornando metadados pra tela de revisão:
   *  - asaasCustomerId
   *  - nome (do `asaas_clientes.nome` ou `payerName` da própria cobrança)
   *  - qtdCobrancas
   *  - valorTotal
   *  - primeiraData / ultimaData
   *
   * Permite tratar várias cobranças do mesmo pagador em 1 ação (1 vínculo
   * resolve todas).
   */
  listarOrfasAgrupadas: protectedProcedure.query(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    await exigirAcaoFinanceiro(ctx.user.id, "editar");
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select({
        asaasCustomerId: asaasCobrancas.asaasCustomerId,
        qtd: sql<number>`COUNT(*)`,
        valorTotal: sql<number>`SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(10,2)))`,
        primeiraData: sql<string>`MIN(COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento}))`,
        ultimaData: sql<string>`MAX(COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento}))`,
      })
      .from(asaasCobrancas)
      .where(
        and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          isNull(asaasCobrancas.contatoId),
        ),
      )
      .groupBy(asaasCobrancas.asaasCustomerId)
      .orderBy(desc(sql`MAX(COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento}))`))
      .limit(200);

    // Enriquece com nome do customer (asaas_clientes.nome) se houver.
    // Customer Asaas pode existir como linha sem contato vinculado quando
    // o webhook criou cobrança antes do vínculo (asaas_clientes pode
    // não existir pra esse customerId ainda).
    const customerIds = rows
      .map((r) => r.asaasCustomerId)
      .filter((c): c is string => !!c);
    let nomesMap: Record<string, string> = {};
    if (customerIds.length > 0) {
      const nomes = await db
        .select({
          customerId: asaasClientes.asaasCustomerId,
          nome: asaasClientes.nome,
        })
        .from(asaasClientes)
        .where(
          and(
            eq(asaasClientes.escritorioId, esc.escritorio.id),
            inArray(asaasClientes.asaasCustomerId, customerIds),
          ),
        );
      nomesMap = Object.fromEntries(
        nomes.filter((n) => n.nome).map((n) => [n.customerId, n.nome!]),
      );
    }

    return rows.map((r) => ({
      asaasCustomerId: r.asaasCustomerId,
      nomeCustomer: r.asaasCustomerId ? (nomesMap[r.asaasCustomerId] ?? null) : null,
      qtd: Number(r.qtd ?? 0),
      valorTotal: Number(r.valorTotal ?? 0),
      primeiraData: r.primeiraData,
      ultimaData: r.ultimaData,
    }));
  }),

  /**
   * Vincula todas as cobranças órfãs de um asaasCustomerId a um contato
   * existente do CRM (ou cria contato novo).
   *
   *  - Atualiza/cria row em `asaas_clientes` (vínculo customer → contato)
   *  - Backfilla `contatoId` em TODAS as cobranças órfãs desse customer
   *
   * Caso "esposa do Carlos": customer = Maria, contatoId escolhido = Carlos.
   * Maria não vira contato. Nome de Maria fica em `asaas_clientes.nome`
   * pra referência histórica.
   */
  vincularOrfas: protectedProcedure
    .input(
      z.object({
        asaasCustomerId: z.string().min(1),
        contatoId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "editar");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [contato] = await db
        .select({ id: contatos.id })
        .from(contatos)
        .where(
          and(
            eq(contatos.id, input.contatoId),
            eq(contatos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!contato) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado" });
      }

      // Pega o CPF do customer Asaas se já houver row em asaas_clientes
      // (criada pelo webhook anteriormente com cpfCnpj). Senão, usa "".
      // `cpfCnpj` é notNull no schema; valor real é só metadado pra
      // referência humana — o vínculo funcional é via asaasCustomerId.
      const [vinculoExistente] = await db
        .select({ cpfCnpj: asaasClientes.cpfCnpj })
        .from(asaasClientes)
        .where(
          and(
            eq(asaasClientes.escritorioId, esc.escritorio.id),
            eq(asaasClientes.asaasCustomerId, input.asaasCustomerId),
          ),
        )
        .limit(1);
      const cpfCnpj = vinculoExistente?.cpfCnpj ?? "";

      await db
        .insert(asaasClientes)
        .values({
          escritorioId: esc.escritorio.id,
          contatoId: contato.id,
          asaasCustomerId: input.asaasCustomerId,
          cpfCnpj,
          primario: false,
          ativo: true,
        })
        .onDuplicateKeyUpdate({
          set: { contatoId: contato.id, ativo: true },
        });

      const result: any = await db
        .update(asaasCobrancas)
        .set({ contatoId: contato.id })
        .where(
          and(
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
            eq(asaasCobrancas.asaasCustomerId, input.asaasCustomerId),
            isNull(asaasCobrancas.contatoId),
          ),
        );

      return { vinculadas: Number(result?.[0]?.affectedRows ?? 0) };
    }),

  atribuirCobrancasEmMassa: protectedProcedure
    .input(
      z.object({
        cobrancaIds: z.array(z.number()).min(1).max(500),
        atendenteId: z.number().nullable().optional(),
        categoriaId: z.number().nullable().optional(),
        comissionavelOverride: z.boolean().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "editar");
      const r = await atribuirCobrancasEmMassa(
        esc.escritorio.id,
        input.cobrancaIds,
        {
          atendenteId: input.atendenteId,
          categoriaId: input.categoriaId,
          comissionavelOverride: input.comissionavelOverride,
        },
      );
      return r;
    }),

  /**
   * Re-roda a cascata de inferência sobre cobranças órfãs (sem atendente).
   * Atribuições manuais nunca são sobrescritas. Útil após preencher o
   * `atendenteResponsavelId` de um cliente que tinha cobranças passadas.
   */
  reconciliarCobrancasOrfas: protectedProcedure
    .input(z.object({ contatoId: z.number().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "editar");
      return reconciliarCobrancasOrfas(esc.escritorio.id, input?.contatoId);
    }),

  // ─── DRE (Demonstrativo de Resultado) ──────────────────────────────────────

  /**
   * Calcula DRE pra o período: receitas (cobranças pagas) - despesas (pagas
   * total ou parcial), agrupado por categoria. Resultado e margem líquida.
   * Permite a UI montar relatório gerencial sem fazer agregação no cliente.
   */
  dre: protectedProcedure
    .input(
      z.object({
        dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        criterioReceita: z.enum(["pagamento", "vencimento"]).default("pagamento"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      if (input.dataInicio > input.dataFim) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "dataInicio deve ser anterior ou igual a dataFim.",
        });
      }
      const { calcularDRE } = await import("./dre");
      return calcularDRE(esc.escritorio.id, input.dataInicio, input.dataFim, input.criterioReceita);
    }),

  /**
   * Espelho do painel "Situação das cobranças" do Asaas: os 4 cards
   * (Recebidas / Confirmadas / Aguardando / Vencidas) com bruto E líquido,
   * filtrados por VENCIMENTO no período + origem=asaas — exatamente o
   * critério do painel deles. Permite conferência card-a-card.
   */
  situacaoCobrancasAsaas: protectedProcedure
    .input(
      z.object({
        dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      const db = await getDb();
      const ZERO = { bruto: 0, liquido: 0, count: 0 };
      if (!db) {
        return { recebidas: ZERO, confirmadas: ZERO, aguardando: ZERO, vencidas: ZERO };
      }
      const { dataHojeBR } = await import("../../shared/escritorio-types");
      const hoje = dataHojeBR();

      const bruto = sql`CAST(${asaasCobrancas.valor} AS DECIMAL(20,2))`;
      const liquido = sql`CAST(COALESCE(${asaasCobrancas.valorLiquido}, ${asaasCobrancas.valor}) AS DECIMAL(20,2))`;
      // Status alinhados ao painel Asaas:
      //  - Recebidas: dinheiro creditado (RECEIVED / RECEIVED_IN_CASH / DUNNING_RECEIVED)
      //  - Confirmadas: pago mas não creditado (CONFIRMED)
      //  - Aguardando: a vencer não pago (PENDING/AWAITING_* + venc >= hoje)
      //  - Vencidas: OVERDUE/DUNNING_REQUESTED, ou PENDING já vencido
      const ehRecebida = sql`${asaasCobrancas.status} IN ('RECEIVED','RECEIVED_IN_CASH','DUNNING_RECEIVED')`;
      const ehConfirmada = sql`${asaasCobrancas.status} = 'CONFIRMED'`;
      const ehPendente = sql`${asaasCobrancas.status} IN ('PENDING','AWAITING_RISK_ANALYSIS','AUTHORIZED')`;
      const ehVencidoStatus = sql`${asaasCobrancas.status} IN ('OVERDUE','DUNNING_REQUESTED')`;
      const vencFuturo = sql`${asaasCobrancas.vencimento} >= ${hoje}`;
      const vencPassado = sql`${asaasCobrancas.vencimento} < ${hoje}`;

      const condRecebidas = sql`${ehRecebida}`;
      const condConfirmadas = sql`${ehConfirmada}`;
      const condAguardando = sql`(${ehPendente} AND ${vencFuturo})`;
      const condVencidas = sql`(${ehVencidoStatus} OR (${ehPendente} AND ${vencPassado}))`;
      const somaBruto = (c: ReturnType<typeof sql>) => sql<string>`COALESCE(SUM(CASE WHEN ${c} THEN ${bruto} ELSE 0 END), 0)`;
      const somaLiq = (c: ReturnType<typeof sql>) => sql<string>`COALESCE(SUM(CASE WHEN ${c} THEN ${liquido} ELSE 0 END), 0)`;
      const somaCount = (c: ReturnType<typeof sql>) => sql<number>`COALESCE(SUM(CASE WHEN ${c} THEN 1 ELSE 0 END), 0)`;

      const [agg] = await db
        .select({
          recBruto: somaBruto(condRecebidas),
          recLiquido: somaLiq(condRecebidas),
          recCount: somaCount(condRecebidas),
          confBruto: somaBruto(condConfirmadas),
          confLiquido: somaLiq(condConfirmadas),
          confCount: somaCount(condConfirmadas),
          aguBruto: somaBruto(condAguardando),
          aguLiquido: somaLiq(condAguardando),
          aguCount: somaCount(condAguardando),
          vencBruto: somaBruto(condVencidas),
          vencLiquido: somaLiq(condVencidas),
          vencCount: somaCount(condVencidas),
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          eq(asaasCobrancas.origem, "asaas"),
          between(asaasCobrancas.vencimento, input.dataInicio, input.dataFim),
        ));

      const n = (v: unknown) => Number(v ?? 0);
      return {
        recebidas: { bruto: n(agg?.recBruto), liquido: n(agg?.recLiquido), count: n(agg?.recCount) },
        confirmadas: { bruto: n(agg?.confBruto), liquido: n(agg?.confLiquido), count: n(agg?.confCount) },
        aguardando: { bruto: n(agg?.aguBruto), liquido: n(agg?.aguLiquido), count: n(agg?.aguCount) },
        vencidas: { bruto: n(agg?.vencBruto), liquido: n(agg?.vencLiquido), count: n(agg?.vencCount) },
      };
    }),

  /**
   * Recebido Asaas POR VENCIMENTO, quebrado por forma de pagamento.
   * Mesmo critério do painel Asaas "Recebidas" (origem=asaas, status pago,
   * vencimento no período) — bate em quantidade e valor por forma. Usado
   * na seção de reconciliação pra o operador comparar PIX/Boleto direto
   * com o Asaas.
   */
  recebidoVencimentoPorForma: protectedProcedure
    .input(
      z.object({
        dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      const db = await getDb();
      if (!db) return { itens: [] as Array<{ forma: string; count: number; valor: number }> };

      const STATUS_PAGOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"];
      const rows = await db
        .select({
          forma: asaasCobrancas.formaPagamento,
          count: sql<number>`COUNT(*)`,
          valor: sql<string>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(20,2))), 0)`,
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          eq(asaasCobrancas.origem, "asaas"),
          inArray(asaasCobrancas.status, STATUS_PAGOS),
          between(asaasCobrancas.vencimento, input.dataInicio, input.dataFim),
        ))
        .groupBy(asaasCobrancas.formaPagamento);

      return {
        itens: rows
          .map((r) => ({ forma: r.forma ?? "(não informado)", count: Number(r.count || 0), valor: Number(r.valor || 0) }))
          .sort((a, b) => b.valor - a.valor),
      };
    }),

  /**
   * Diagnóstico de divergência entre "Caixa Asaas" e o painel Asaas.
   *
   * Retorna 3 cortes:
   *  1. Total por status (RECEIVED, CONFIRMED, RECEIVED_IN_CASH, DUNNING_RECEIVED)
   *     — separa o impacto de cada um. RECEIVED_IN_CASH é o suspeito
   *     #1 quando há divergência: o Asaas marca como "pago" mas o
   *     dinheiro não cai na conta deles, e o painel "Recebidos" do
   *     Asaas pode excluir.
   *  2. Cobranças nas bordas do início (5 dias antes/depois da
   *     dataInicio) — captura erro de timezone (pagamento de 21h-23h
   *     do último dia de abril pode virar primeiro de maio em UTC).
   *  3. Cobranças nas bordas do fim — mesmo motivo.
   */
  diagnosticoCaixaAsaas: protectedProcedure
    .input(
      z.object({
        dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      const db = await getDb();
      if (!db) return null;

      const ampliar = (iso: string, dias: number): string => {
        const dt = new Date(Date.UTC(
          parseInt(iso.slice(0, 4), 10),
          parseInt(iso.slice(5, 7), 10) - 1,
          parseInt(iso.slice(8, 10), 10),
        ));
        dt.setUTCDate(dt.getUTCDate() + dias);
        return dt.toISOString().slice(0, 10);
      };

      const STATUS_PAGOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"];

      // 1) Total por status no período — bruto + líquido + diferença (taxa)
      const porStatusRaw = await db
        .select({
          status: asaasCobrancas.status,
          origem: asaasCobrancas.origem,
          formaPagamento: asaasCobrancas.formaPagamento,
          valor: sql<string>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(20,2))), 0)`,
          valorLiquido: sql<string>`COALESCE(SUM(CAST(COALESCE(${asaasCobrancas.valorLiquido}, ${asaasCobrancas.valor}) AS DECIMAL(20,2))), 0)`,
          count: sql<number>`COUNT(*)`,
          comValorLiquido: sql<number>`SUM(CASE WHEN ${asaasCobrancas.valorLiquido} IS NOT NULL THEN 1 ELSE 0 END)`,
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          inArray(asaasCobrancas.status, STATUS_PAGOS),
          between(asaasCobrancas.dataPagamento, input.dataInicio, input.dataFim),
        ))
        .groupBy(asaasCobrancas.status, asaasCobrancas.origem, asaasCobrancas.formaPagamento);

      // 2) Bordas: cobranças com dataPagamento de [dataInicio-2, dataInicio+2]
      const bordaInicio = await db
        .select({
          id: asaasCobrancas.id,
          asaasPaymentId: asaasCobrancas.asaasPaymentId,
          status: asaasCobrancas.status,
          origem: asaasCobrancas.origem,
          valor: asaasCobrancas.valor,
          dataPagamento: asaasCobrancas.dataPagamento,
          descricao: asaasCobrancas.descricao,
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          inArray(asaasCobrancas.status, STATUS_PAGOS),
          between(
            asaasCobrancas.dataPagamento,
            ampliar(input.dataInicio, -2),
            ampliar(input.dataInicio, 2),
          ),
        ))
        .orderBy(asaasCobrancas.dataPagamento)
        .limit(50);

      // 3) Bordas: cobranças com dataPagamento de [dataFim-2, dataFim+2]
      const bordaFim = await db
        .select({
          id: asaasCobrancas.id,
          asaasPaymentId: asaasCobrancas.asaasPaymentId,
          status: asaasCobrancas.status,
          origem: asaasCobrancas.origem,
          valor: asaasCobrancas.valor,
          dataPagamento: asaasCobrancas.dataPagamento,
          descricao: asaasCobrancas.descricao,
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          inArray(asaasCobrancas.status, STATUS_PAGOS),
          between(
            asaasCobrancas.dataPagamento,
            ampliar(input.dataFim, -2),
            ampliar(input.dataFim, 2),
          ),
        ))
        .orderBy(asaasCobrancas.dataPagamento)
        .limit(50);

      // 4) Lista detalhada de RECEIVED_IN_CASH no período (suspeito #1)
      const recebidoEmCash = await db
        .select({
          id: asaasCobrancas.id,
          asaasPaymentId: asaasCobrancas.asaasPaymentId,
          origem: asaasCobrancas.origem,
          valor: asaasCobrancas.valor,
          dataPagamento: asaasCobrancas.dataPagamento,
          descricao: asaasCobrancas.descricao,
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          eq(asaasCobrancas.status, "RECEIVED_IN_CASH"),
          between(asaasCobrancas.dataPagamento, input.dataInicio, input.dataFim),
        ))
        .orderBy(asaasCobrancas.dataPagamento)
        .limit(100);

      const totalRecebidoEmCash = recebidoEmCash.reduce(
        (acc, c) => acc + Number(c.valor || 0),
        0,
      );

      // 5) Saúde do valorLiquido — investiga netValue corrompido.
      // Asaas cobra <1% de taxa; se "líquido" implica taxa absurda,
      // é dado errado (parcela vs total, centavos vs reais, zerado).
      const todasPagas = await db
        .select({
          id: asaasCobrancas.id,
          asaasPaymentId: asaasCobrancas.asaasPaymentId,
          status: asaasCobrancas.status,
          formaPagamento: asaasCobrancas.formaPagamento,
          valor: asaasCobrancas.valor,
          valorLiquido: asaasCobrancas.valorLiquido,
          descricao: asaasCobrancas.descricao,
          dataPagamento: asaasCobrancas.dataPagamento,
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          inArray(asaasCobrancas.status, STATUS_PAGOS),
          between(asaasCobrancas.dataPagamento, input.dataInicio, input.dataFim),
        ));

      let nLiquidoNull = 0;
      let nLiquidoZero = 0;
      let nLiquidoSuspeito = 0; // líquido < 80% do bruto (taxa real é <3%)
      let nLiquidoOk = 0;
      const outliers: Array<{
        id: number;
        asaasPaymentId: string | null;
        status: string;
        formaPagamento: string | null;
        valor: number;
        valorLiquido: number | null;
        gap: number;
        gapPercent: number;
        descricao: string | null;
        dataPagamento: string | null;
      }> = [];
      for (const c of todasPagas) {
        const bruto = Number(c.valor || 0);
        if (c.valorLiquido === null || c.valorLiquido === undefined) {
          nLiquidoNull++;
          continue;
        }
        const liq = Number(c.valorLiquido);
        if (liq === 0) {
          nLiquidoZero++;
        } else if (bruto > 0 && liq < bruto * 0.8) {
          nLiquidoSuspeito++;
        } else {
          nLiquidoOk++;
        }
        const gap = bruto - liq;
        if (bruto > 0 && gap > bruto * 0.05) {
          outliers.push({
            id: c.id,
            asaasPaymentId: c.asaasPaymentId,
            status: c.status,
            formaPagamento: c.formaPagamento,
            valor: bruto,
            valorLiquido: liq,
            gap,
            gapPercent: (gap / bruto) * 100,
            descricao: c.descricao,
            dataPagamento: c.dataPagamento,
          });
        }
      }
      outliers.sort((a, b) => b.gap - a.gap);
      const topOutliers = outliers.slice(0, 20);

      // Agregados pra resumo (totais)
      const totalBruto = porStatusRaw.reduce((acc, r) => acc + Number(r.valor || 0), 0);
      const totalLiquido = porStatusRaw.reduce((acc, r) => acc + Number(r.valorLiquido || 0), 0);
      const totalTaxas = totalBruto - totalLiquido;
      const totalCount = porStatusRaw.reduce((acc, r) => acc + Number(r.count || 0), 0);
      const totalComLiquido = porStatusRaw.reduce(
        (acc, r) => acc + Number(r.comValorLiquido || 0),
        0,
      );

      return {
        periodo: { inicio: input.dataInicio, fim: input.dataFim },
        resumo: {
          totalBruto,
          totalLiquido,
          totalTaxas,
          totalCount,
          // Quantas cobranças têm netValue preenchido (vs null). Se baixo,
          // a hipótese de taxa fica menos confiável — pode ser sync incompleto.
          comValorLiquido: totalComLiquido,
        },
        porStatus: porStatusRaw.map((r) => ({
          status: r.status,
          origem: r.origem,
          formaPagamento: r.formaPagamento,
          valor: Number(r.valor || 0),
          valorLiquido: Number(r.valorLiquido || 0),
          taxa: Number(r.valor || 0) - Number(r.valorLiquido || 0),
          count: Number(r.count || 0),
          comValorLiquido: Number(r.comValorLiquido || 0),
        })),
        bordaInicio,
        bordaFim,
        recebidoEmCash: {
          itens: recebidoEmCash,
          total: totalRecebidoEmCash,
          count: recebidoEmCash.length,
        },
        saudeValorLiquido: {
          nLiquidoNull,
          nLiquidoZero,
          nLiquidoSuspeito,
          nLiquidoOk,
          totalGapOutliers: outliers.reduce((acc, o) => acc + o.gap, 0),
          topOutliers,
        },
      };
    }),

  /**
   * Comparação AO VIVO com o Asaas — cruza cobrança-a-cobrança o que o
   * JuridFlow tem como recebido no período contra o que o Asaas retorna por
   * `paymentDate`. Revela a causa de o bruto do JuridFlow ser MAIOR que o do
   * Asaas (impossível se fosse só espelho):
   *  - `soNoJurify`: cobranças que o JuridFlow conta como pagas mas o Asaas
   *    NÃO retorna no período (estornadas/deletadas no Asaas sem webhook,
   *    ou paymentDate divergente — JuridFlow usa data do pagamento, Asaas
   *    data do crédito).
   *  - `statusDivergente`: mesma cobrança, status diferente entre os dois
   *    (ex: JuridFlow RECEIVED, Asaas REFUNDED).
   *
   * É mutation (não query) porque consome cota do Asaas: 1 sweep paginado
   * por `paymentDate`. Disparado sob demanda pelo botão de diagnóstico.
   */
  compararRecebidoComAsaas: protectedProcedure
    .input(
      z.object({
        dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { getAsaasClientForEscritorio } = await import(
        "../integracoes/asaas-sync"
      );
      const client = await getAsaasClientForEscritorio(esc.escritorio.id);
      if (!client) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Asaas não conectado.",
        });
      }

      // 1) Asaas: o que ELES consideram pago no período (filtro paymentDate)
      const asaasMap = new Map<
        string,
        { value: number; netValue: number | null; status: string; paymentDate?: string; creditDate?: string }
      >();
      let offset = 0;
      let hasMore = true;
      let paginas = 0;
      try {
        while (hasMore && paginas < 500) {
          paginas++;
          const res = await client.listarCobrancasPorJanela({
            paymentDateGe: input.dataInicio,
            paymentDateLe: input.dataFim,
            limit: 100,
            offset,
          });
          for (const c of res.data) {
            if (!c.deleted) {
              asaasMap.set(c.id, {
                value: c.value,
                netValue: c.netValue ?? null,
                status: c.status,
                paymentDate: c.paymentDate,
                creditDate: c.creditDate ?? c.estimatedCreditDate,
              });
            }
          }
          hasMore = res.hasMore;
          offset += res.limit;
        }
      } catch (err: any) {
        const status = err?.response?.status ?? err?.cause?.response?.status;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            status === 429
              ? "Asaas em rate limit (429). Tente após a janela liberar ou use o reset do rate guard."
              : `Erro ao consultar Asaas: ${err?.message ?? "desconhecido"}`,
        });
      }

      const totalAsaasValue = Array.from(asaasMap.values()).reduce(
        (acc, c) => acc + c.value,
        0,
      );

      // Quebra das cobranças da API por status — revela quantas são
      // RECEIVED (caem em "Recebidas" do painel) vs RECEIVED_IN_CASH
      // (pago manual, painel não conta). Explica a diferença API vs painel.
      const asaasPorStatus = new Map<string, { count: number; value: number }>();
      for (const c of asaasMap.values()) {
        const cur = asaasPorStatus.get(c.status) ?? { count: 0, value: 0 };
        cur.count++;
        cur.value += c.value;
        asaasPorStatus.set(c.status, cur);
      }

      // Cobranças pagas no período mas com crédito em mês diferente — a
      // causa de o painel "Recebidas Este mês" (filtra creditDate) não
      // contar cobranças que o paymentDate caiu no mês (boleto D+1 pago
      // no fim do mês credita no mês seguinte).
      const creditoMesDiferente: Array<{
        id: string;
        value: number;
        paymentDate?: string;
        creditDate?: string;
      }> = [];
      for (const [id, c] of asaasMap.entries()) {
        const mesPag = c.paymentDate?.slice(0, 7);
        const mesCred = c.creditDate?.slice(0, 7);
        if (mesPag && mesCred && mesPag !== mesCred) {
          creditoMesDiferente.push({
            id,
            value: c.value,
            paymentDate: c.paymentDate,
            creditDate: c.creditDate,
          });
        }
      }
      const totalCreditoMesDiferente = creditoMesDiferente.reduce(
        (acc, c) => acc + c.value,
        0,
      );

      // 2) JuridFlow: cobranças com status pago + dataPagamento no período
      const STATUS_PAGOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"];
      const jurifyRows = await db
        .select({
          id: asaasCobrancas.id,
          asaasPaymentId: asaasCobrancas.asaasPaymentId,
          origem: asaasCobrancas.origem,
          status: asaasCobrancas.status,
          valor: asaasCobrancas.valor,
          dataPagamento: asaasCobrancas.dataPagamento,
          descricao: asaasCobrancas.descricao,
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, esc.escritorio.id),
          // Só origem='asaas' — a comparação é Caixa Asaas vs API Asaas.
          // Cobranças manuais (Caixa Escritório) não têm par no Asaas e
          // inflariam o total do JuridFlow sem correspondência.
          eq(asaasCobrancas.origem, "asaas"),
          inArray(asaasCobrancas.status, STATUS_PAGOS),
          between(asaasCobrancas.dataPagamento, input.dataInicio, input.dataFim),
        ));

      const totalJurifyValue = jurifyRows.reduce(
        (acc, r) => acc + Number(r.valor || 0),
        0,
      );

      // 3) Diff
      const soNoJurify: typeof jurifyRows = [];
      const statusDivergente: Array<{
        row: (typeof jurifyRows)[number];
        statusAsaas: string;
      }> = [];
      for (const r of jurifyRows) {
        if (!r.asaasPaymentId) {
          // Cobrança manual (origem != asaas) não tem par no Asaas — ignora
          if (r.origem === "asaas") soNoJurify.push(r);
          continue;
        }
        const noAsaas = asaasMap.get(r.asaasPaymentId);
        if (!noAsaas) {
          soNoJurify.push(r);
        } else if (noAsaas.status !== r.status) {
          statusDivergente.push({ row: r, statusAsaas: noAsaas.status });
        }
      }
      const totalSoNoJurify = soNoJurify.reduce(
        (acc, r) => acc + Number(r.valor || 0),
        0,
      );

      // Cobranças que o Asaas tem pagas mas o JuridFlow não tem (ou não como pago)
      const jurifyIds = new Set(
        jurifyRows.map((r) => r.asaasPaymentId).filter(Boolean),
      );
      let soNoAsaasCount = 0;
      let soNoAsaasValue = 0;
      for (const [id, c] of asaasMap.entries()) {
        if (!jurifyIds.has(id)) {
          soNoAsaasCount++;
          soNoAsaasValue += c.value;
        }
      }

      return {
        periodo: { inicio: input.dataInicio, fim: input.dataFim },
        totalAsaas: { value: totalAsaasValue, count: asaasMap.size },
        totalJurify: { value: totalJurifyValue, count: jurifyRows.length },
        asaasPorStatus: Array.from(asaasPorStatus.entries())
          .map(([status, v]) => ({ status, count: v.count, value: v.value }))
          .sort((a, b) => b.value - a.value),
        creditoMesDiferente: {
          count: creditoMesDiferente.length,
          total: totalCreditoMesDiferente,
          itens: creditoMesDiferente.slice(0, 50),
        },
        diferenca: totalJurifyValue - totalAsaasValue,
        soNoJurify: {
          itens: soNoJurify.slice(0, 100),
          total: totalSoNoJurify,
          count: soNoJurify.length,
        },
        statusDivergente: {
          itens: statusDivergente.slice(0, 100),
          count: statusDivergente.length,
        },
        soNoAsaas: { count: soNoAsaasCount, value: soNoAsaasValue },
      };
    }),

  /**
   * Gera CSV do DRE pra download. Retorna `{ filename, content }` —
   * frontend cria Blob e faz download. Conteúdo já inclui BOM UTF-8
   * pra Excel reconhecer acentos.
   */
  exportarDreCsv: protectedProcedure
    .input(
      z.object({
        dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      const { calcularDRE, gerarDRECSV } = await import("./dre");
      const dre = await calcularDRE(
        esc.escritorio.id,
        input.dataInicio,
        input.dataFim,
      );
      const content = gerarDRECSV(dre, esc.escritorio.nome);
      return {
        filename: `dre_${input.dataInicio}_${input.dataFim}.csv`,
        content,
        mimeType: "text/csv;charset=utf-8",
      };
    }),

  /**
   * Gera PDF do DRE pra download. Retorna base64 (transportável via tRPC)
   * que o frontend decodifica em Blob. Tamanho típico: 10-30KB.
   */
  exportarDrePdf: protectedProcedure
    .input(
      z.object({
        dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      const { calcularDRE } = await import("./dre");
      const { gerarDREPDF } = await import("./dre-pdf");
      const dre = await calcularDRE(
        esc.escritorio.id,
        input.dataInicio,
        input.dataFim,
      );
      const buffer = await gerarDREPDF(dre, esc.escritorio.nome);
      return {
        filename: `dre_${input.dataInicio}_${input.dataFim}.pdf`,
        base64: buffer.toString("base64"),
        mimeType: "application/pdf",
      };
    }),

  // ─── Anexos (boletos, recibos, NFe) ────────────────────────────────────────

  /**
   * Sobe um anexo pra S3 e cria row em `financeiro_anexos`. Aceita
   * base64 via tRPC (limit 5MB) — suficiente pra recibos PDF, prints PNG,
   * XML de NFe. Pra arquivos maiores, futuramente migrar pra presigned URL.
   *
   * Valida:
   *  - entidade existe no escritório
   *  - tipo MIME tá na allowlist (pdf/png/jpg/webp/xml)
   *  - tamanho ≤ 5MB
   *  - BACKUP_* configurado (senão erro claro pro admin)
   */
  anexarArquivo: protectedProcedure
    .input(
      z.object({
        tipoEntidade: z.enum(["despesa", "cobranca"]),
        entidadeId: z.number().int().positive(),
        filename: z.string().min(1).max(255),
        mimeType: z.string().regex(/^(application|image|text)\/[\w.+-]+$/),
        /** Conteúdo do arquivo em base64 (sem prefixo "data:..."). */
        conteudoBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "criar");

      const MIME_PERMITIDOS = new Set([
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "application/xml",
        "text/xml",
      ]);
      if (!MIME_PERMITIDOS.has(input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Tipo de arquivo não suportado (${input.mimeType}). Permitidos: PDF, PNG, JPG, WEBP, XML.`,
        });
      }

      const buffer = Buffer.from(input.conteudoBase64, "base64");
      const TAMANHO_MAX = 5 * 1024 * 1024;
      if (buffer.length > TAMANHO_MAX) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Arquivo grande demais (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Limite: 5MB.`,
        });
      }

      const { obterAnexosConfig, montarStorageKey, uploadAnexo } = await import(
        "./anexos-storage"
      );
      const cfg = obterAnexosConfig();
      if (!cfg) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Storage de anexos não configurado. Peça ao admin pra setar BACKUP_BUCKET e credenciais S3.",
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Valida que a entidade-pai existe no escritório (evita anexar arquivos
      // a despesas/cobranças de outros escritórios via input forjado)
      if (input.tipoEntidade === "despesa") {
        const [row] = await db
          .select({ id: despesas.id })
          .from(despesas)
          .where(
            and(
              eq(despesas.id, input.entidadeId),
              eq(despesas.escritorioId, esc.escritorio.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Despesa não encontrada.",
          });
        }
      } else {
        const [row] = await db
          .select({ id: asaasCobrancas.id })
          .from(asaasCobrancas)
          .where(
            and(
              eq(asaasCobrancas.id, input.entidadeId),
              eq(asaasCobrancas.escritorioId, esc.escritorio.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Cobrança não encontrada.",
          });
        }
      }

      const storageKey = montarStorageKey(
        esc.escritorio.id,
        input.tipoEntidade,
        input.entidadeId,
        input.filename,
      );

      // Ordem: DB primeiro, S3 depois com rollback. Se S3 falhar, deleta
      // a row pra UI não mostrar anexo quebrado. Se DB falhasse depois
      // do S3, o arquivo ficaria órfão no bucket sem cleanup automático.
      const [novo] = await db
        .insert(financeiroAnexos)
        .values({
          escritorioId: esc.escritorio.id,
          tipoEntidade: input.tipoEntidade,
          entidadeId: input.entidadeId,
          storageKey,
          filename: input.filename,
          mimeType: input.mimeType,
          tamanhoBytes: buffer.length,
          uploadedByUserId: ctx.user.id,
        })
        .$returningId();

      try {
        await uploadAnexo(cfg, storageKey, buffer, input.mimeType);
      } catch (uploadErr: any) {
        // Rollback: row sem arquivo é pior que perder o upload retry-able
        await db
          .delete(financeiroAnexos)
          .where(eq(financeiroAnexos.id, novo.id))
          .catch(() => {});
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Falha ao enviar pro storage: ${uploadErr.message ?? "erro desconhecido"}. Tente novamente.`,
        });
      }

      return { id: novo.id, storageKey, tamanhoBytes: buffer.length };
    }),

  /**
   * Lista anexos de uma entidade. Retorna metadata; NÃO inclui URL pré-
   * assinada pra evitar gerar uma URL por linha (caro + URLs vazam no
   * log). Pra baixar, frontend chama `obterUrlDownload(anexoId)`.
   */
  listarAnexos: protectedProcedure
    .input(
      z.object({
        tipoEntidade: z.enum(["despesa", "cobranca"]),
        entidadeId: z.number().int().positive(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");

      const db = await getDb();
      if (!db) return [];

      return db
        .select({
          id: financeiroAnexos.id,
          filename: financeiroAnexos.filename,
          mimeType: financeiroAnexos.mimeType,
          tamanhoBytes: financeiroAnexos.tamanhoBytes,
          uploadedByUserId: financeiroAnexos.uploadedByUserId,
          createdAt: financeiroAnexos.createdAt,
        })
        .from(financeiroAnexos)
        .where(
          and(
            eq(financeiroAnexos.escritorioId, esc.escritorio.id),
            eq(financeiroAnexos.tipoEntidade, input.tipoEntidade),
            eq(financeiroAnexos.entidadeId, input.entidadeId),
          ),
        )
        .orderBy(desc(financeiroAnexos.createdAt));
    }),

  /**
   * Retorna URL assinada (5min) pra download direto do S3. Não streama
   * pelo backend — economiza CPU/banda do servidor e usa o CDN do S3.
   */
  obterUrlDownloadAnexo: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [anexo] = await db
        .select({
          storageKey: financeiroAnexos.storageKey,
          filename: financeiroAnexos.filename,
        })
        .from(financeiroAnexos)
        .where(
          and(
            eq(financeiroAnexos.id, input.id),
            eq(financeiroAnexos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!anexo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado." });
      }

      const { obterAnexosConfig, gerarUrlDownload } = await import("./anexos-storage");
      const cfg = obterAnexosConfig();
      if (!cfg) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Storage não configurado.",
        });
      }
      const url = await gerarUrlDownload(cfg, anexo.storageKey);
      return { url, filename: anexo.filename };
    }),

  excluirAnexo: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "excluir");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [anexo] = await db
        .select({ storageKey: financeiroAnexos.storageKey })
        .from(financeiroAnexos)
        .where(
          and(
            eq(financeiroAnexos.id, input.id),
            eq(financeiroAnexos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!anexo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado." });
      }

      // Apaga DB primeiro: se S3 falhar depois, fica órfão (aceitável,
      // limpável periodicamente). Inverso deixaria row apontando pra
      // arquivo inexistente, pior pro usuário.
      await db
        .delete(financeiroAnexos)
        .where(eq(financeiroAnexos.id, input.id));

      try {
        const { obterAnexosConfig, deleteAnexo } = await import("./anexos-storage");
        const cfg = obterAnexosConfig();
        if (cfg) {
          await deleteAnexo(cfg, anexo.storageKey);
        }
      } catch {
        // Best-effort: row já foi apagada, S3 limpa depois
      }

      return { success: true };
    }),

  // ─── Conciliação bancária (OFX) ────────────────────────────────────────────

  /**
   * Parseia conteúdo OFX e sugere matches com despesas/cobranças
   * pendentes no escritório. NÃO marca nada como pago — só retorna
   * preview pra UI confirmar.
   *
   * Aceita conteúdo cru do .OFX (texto). Frontend converte File→string
   * antes de chamar.
   */
  importarOFXPreview: protectedProcedure
    .input(
      z.object({
        /** Conteúdo do arquivo .OFX (texto). Limite 2MB descomprimido. */
        conteudo: z.string().min(1).max(2 * 1024 * 1024),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "editar");

      const { parseOFX, sugerirConciliacao } = await import("./ofx");
      const transacoes = parseOFX(input.conteudo);

      if (transacoes.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Nenhuma transação encontrada no arquivo OFX. Confira se baixou o extrato no formato OFX (não OFC ou CSV).",
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Pool de candidatos: despesas pendentes/parciais + cobranças
      // pendentes/vencidas. Filtra por escritório.
      const dataMin = transacoes.reduce(
        (acc, t) => (t.data < acc ? t.data : acc),
        transacoes[0].data,
      );
      const dataMax = transacoes.reduce(
        (acc, t) => (t.data > acc ? t.data : acc),
        transacoes[0].data,
      );
      // Janela ±10 dias pra cobrir tolerância de 5 dias mais buffer
      const ampliarData = (iso: string, deltaDias: number): string => {
        const dt = new Date(Date.UTC(
          parseInt(iso.slice(0, 4), 10),
          parseInt(iso.slice(5, 7), 10) - 1,
          parseInt(iso.slice(8, 10), 10),
        ));
        dt.setUTCDate(dt.getUTCDate() + deltaDias);
        return dt.toISOString().slice(0, 10);
      };
      const venciMin = ampliarData(dataMin, -10);
      const venciMax = ampliarData(dataMax, 10);

      // Filtra por vencimento direto no SQL (between sobre string ISO
      // YYYY-MM-DD comparada lexicograficamente — bate com comparação
      // de data). Antes carregávamos todas as despesas/cobranças
      // pendentes do escritório e filtrávamos em JS — não escala em
      // escritórios com muito histórico.
      const despesasRows = await db
        .select({
          id: despesas.id,
          descricao: despesas.descricao,
          valor: despesas.valor,
          vencimento: despesas.vencimento,
        })
        .from(despesas)
        .where(
          and(
            eq(despesas.escritorioId, esc.escritorio.id),
            or(eq(despesas.status, "pendente"), eq(despesas.status, "parcial")),
            between(despesas.vencimento, venciMin, venciMax),
          ),
        );

      const cobrancasRows = await db
        .select({
          id: asaasCobrancas.id,
          descricao: asaasCobrancas.descricao,
          valor: asaasCobrancas.valor,
          vencimento: asaasCobrancas.vencimento,
        })
        .from(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.escritorioId, esc.escritorio.id),
            or(
              eq(asaasCobrancas.status, "PENDING"),
              eq(asaasCobrancas.status, "OVERDUE"),
            ),
            between(asaasCobrancas.vencimento, venciMin, venciMax),
          ),
        );

      // Filtro de vencimento já aplicado no WHERE — aqui só normaliza
      // os tipos pro shape esperado por `sugerirConciliacao`.
      const despesasFiltradas = despesasRows.map((d) => ({
        id: d.id,
        descricao: d.descricao,
        valor: parseFloat(d.valor),
        vencimento: d.vencimento,
      }));
      const cobrancasFiltradas = cobrancasRows.map((c) => ({
        id: c.id,
        descricao: c.descricao ?? "",
        valor: parseFloat(c.valor),
        vencimento: c.vencimento,
      }));

      const sugestoes = sugerirConciliacao(
        transacoes,
        despesasFiltradas,
        cobrancasFiltradas,
      );

      // Idempotência: marca quais FITIDs já foram conciliados antes
      // pra UI mostrar como "já importado" e desabilitar.
      const fitidsImportados = await db
        .select({ fitid: ofxImportacoesFitid.fitid })
        .from(ofxImportacoesFitid)
        .where(
          and(
            eq(ofxImportacoesFitid.escritorioId, esc.escritorio.id),
            inArray(
              ofxImportacoesFitid.fitid,
              transacoes.map((t) => t.fitid),
            ),
          ),
        );
      const setImportados = new Set(fitidsImportados.map((r) => r.fitid));

      const sugestoesComFlag = sugestoes.map((s) => ({
        ...s,
        jaImportado: setImportados.has(s.transacao.fitid),
      }));

      return {
        totalTransacoes: transacoes.length,
        comMatch: sugestoesComFlag.filter(
          (s) => !s.jaImportado && s.candidatos.length > 0,
        ).length,
        semMatch: sugestoesComFlag.filter(
          (s) => !s.jaImportado && s.candidatos.length === 0,
        ).length,
        jaImportadas: setImportados.size,
        sugestoes: sugestoesComFlag,
      };
    }),

  /**
   * Aplica matches confirmados pelo usuário. Marca despesas como pagas
   * (pagamento total) e cobranças manuais como recebidas. Para cobranças
   * Asaas, mostra warning — webhook deveria ter sincronizado já.
   */
  confirmarConciliacaoOFX: protectedProcedure
    .input(
      z.object({
        matches: z
          .array(
            z.object({
              fitid: z.string().min(1).max(255),
              tipo: z.enum(["despesa", "cobranca"]),
              entidadeId: z.number().int().positive(),
              dataPagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              valor: z.number().positive(),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "editar");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Lote tudo-ou-nada (bug #10): se algum match tem erro estrutural,
      // nenhum é gravado. Senão, todos os válidos vão numa transação única
      // — rollback automático se o banco falhar no meio.
      const r = await aplicarConciliacaoOFXEmLote({
        escritorioId: esc.escritorio.id,
        importadoPorUserId: ctx.user.id,
        matches: input.matches,
      });

      return {
        despesasMarcadas: r.despesasMarcadas,
        cobrancasMarcadas: r.cobrancasMarcadas,
        jaImportadas: r.jaImportadas,
        erros: r.erros,
        abortado: r.abortado,
      };
    }),
});
