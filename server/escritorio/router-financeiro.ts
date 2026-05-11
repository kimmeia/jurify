import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
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
        faixas: [] as Array<{ limiteAte: string | null; aliquotaPercent: string }>,
      };
    }
    return {
      aliquotaPercent: regra.aliquotaPercent,
      modo: regra.modo,
      baseFaixa: regra.baseFaixa,
      valorMinimoCobranca: regra.valorMinimoCobranca,
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
      });
      return { success: true };
    }),

  // ─── Cobranças sincronizadas: atribuição em massa + reconciliação ──────────

  /**
   * Lista cobranças do escritório para a tela de atribuição. Suporta filtro
   * `apenasSemAtribuicao` que limita o resultado às cobranças sem atendente
   * OU sem categoria — o caso típico após sync do Asaas.
   */
  listarCobrancasParaAtribuicao: protectedProcedure
    .input(
      z
        .object({
          apenasSemAtribuicao: z.boolean().default(false),
          /** Mostra apenas cobranças cujo estado de comissão está
           *  indefinido — sem categoria E sem `comissionavelOverride`.
           *  Cenário típico: PIX direto pro Asaas que cria cobrança
           *  via webhook sem categoria atribuída. */
          apenasSemDecisaoComissao: z.boolean().default(false),
          limit: z.number().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      const db = await getDb();
      if (!db) return [];

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
        // "Sem decisão" = sem override AND sem categoria. Se tem
        // categoria (mesmo não-comissionável), foi uma decisão tomada.
        conds.push(isNull(asaasCobrancas.comissionavelOverride));
        conds.push(isNull(asaasCobrancas.categoriaId));
      }

      return db
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
        .where(and(...conds))
        .orderBy(desc(asaasCobrancas.createdAt))
        .limit(input?.limit ?? 200);
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
      return calcularDRE(esc.escritorio.id, input.dataInicio, input.dataFim);
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
            // between via SQL pra evitar comparar string mês>dia em datas
            // (datas ISO comparam-se lexicograficamente sem problemas)
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
          ),
        );

      // Filtra em JS pelo intervalo ampliado de datas — evita complicar
      // o WHERE com SQL between dependente do dialeto
      const despesasFiltradas = despesasRows
        .filter((d) => d.vencimento >= venciMin && d.vencimento <= venciMax)
        .map((d) => ({
          id: d.id,
          descricao: d.descricao,
          valor: parseFloat(d.valor),
          vencimento: d.vencimento,
        }));
      const cobrancasFiltradas = cobrancasRows
        .filter((c) => c.vencimento >= venciMin && c.vencimento <= venciMax)
        .map((c) => ({
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

      let despesasMarcadas = 0;
      let cobrancasMarcadas = 0;
      let jaImportadas = 0;
      const erros: string[] = [];

      for (const m of input.matches) {
        try {
          // 1) Idempotência: registra FITID. Se já existe (UNIQUE viola),
          // pula o match sem mutar entidade-pai. Faz isso ANTES do UPDATE
          // pra garantir que reimport não sobrescreve dataPagamento.
          try {
            await db.insert(ofxImportacoesFitid).values({
              escritorioId: esc.escritorio.id,
              fitid: m.fitid,
              tipoEntidade: m.tipo,
              entidadeId: m.entidadeId,
              valor: m.valor.toFixed(2),
              dataPagamento: m.dataPagamento,
              importadoPorUserId: ctx.user.id,
            });
          } catch (insertErr: any) {
            // Drizzle / MySQL: erro 1062 = duplicate key
            if (
              insertErr.code === "ER_DUP_ENTRY" ||
              /Duplicate entry/i.test(insertErr.message ?? "")
            ) {
              jaImportadas++;
              continue;
            }
            throw insertErr;
          }

          // 2) Aplicação do match
          if (m.tipo === "despesa") {
            const [d] = await db
              .select({ valor: despesas.valor })
              .from(despesas)
              .where(
                and(
                  eq(despesas.id, m.entidadeId),
                  eq(despesas.escritorioId, esc.escritorio.id),
                ),
              )
              .limit(1);
            if (!d) {
              erros.push(`Despesa #${m.entidadeId} não encontrada`);
              continue;
            }
            await db
              .update(despesas)
              .set({
                status: "pago",
                dataPagamento: m.dataPagamento,
                valorPago: d.valor,
              })
              .where(
                and(
                  eq(despesas.id, m.entidadeId),
                  eq(despesas.escritorioId, esc.escritorio.id),
                ),
              );
            despesasMarcadas++;
          } else {
            const [c] = await db
              .select({ origem: asaasCobrancas.origem })
              .from(asaasCobrancas)
              .where(
                and(
                  eq(asaasCobrancas.id, m.entidadeId),
                  eq(asaasCobrancas.escritorioId, esc.escritorio.id),
                ),
              )
              .limit(1);
            if (!c) {
              erros.push(`Cobrança #${m.entidadeId} não encontrada`);
              continue;
            }
            if (c.origem !== "manual") {
              erros.push(
                `Cobrança #${m.entidadeId} é Asaas — sincroniza automaticamente via webhook (pulada)`,
              );
              continue;
            }
            await db
              .update(asaasCobrancas)
              .set({ status: "RECEIVED", dataPagamento: m.dataPagamento })
              .where(eq(asaasCobrancas.id, m.entidadeId));
            cobrancasMarcadas++;
          }
        } catch (err: any) {
          erros.push(`${m.tipo} #${m.entidadeId}: ${err.message}`);
        }
      }

      return { despesasMarcadas, cobrancasMarcadas, jaImportadas, erros };
    }),
});
