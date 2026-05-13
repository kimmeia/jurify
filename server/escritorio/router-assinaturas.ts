/**
 * Router tRPC — Assinatura Digital de Documentos
 * 
 * Fluxo: Criar documento → Enviar link (WhatsApp/email) → Cliente visualiza → Assina → Salvo na ficha
 * Token único por assinatura para acesso público (sem login).
 */

import { z } from "zod";
import path from "path";
import fs from "fs";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { assinaturasDigitais, assinaturaCampos, contatos } from "../../drizzle/schema";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import crypto from "crypto";
import { estamparAssinatura } from "./pdf-stamp-assinatura";
import { createLogger } from "../_core/logger";

const log = createLogger("router-assinaturas");

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function gerarToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export const assinaturasRouter = router({
  /** Lista assinaturas de um cliente */
  listarPorCliente: protectedProcedure
    .input(z.object({ contatoId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      const rows = await db.select().from(assinaturasDigitais)
        .where(and(eq(assinaturasDigitais.contatoId, input.contatoId), eq(assinaturasDigitais.escritorioId, esc.escritorio.id)))
        .orderBy(desc(assinaturasDigitais.createdAt));

      return rows.map(r => ({
        id: r.id,
        titulo: r.titulo,
        descricao: r.descricao,
        status: r.status,
        documentoUrl: r.documentoUrl,
        documentoAssinadoUrl: r.documentoAssinadoUrl,
        assinantNome: r.assinantNome,
        assinantEmail: r.assinantEmail,
        tokenAssinatura: r.tokenAssinatura,
        enviadoAt: r.enviadoAt ? (r.enviadoAt as Date).toISOString() : null,
        visualizadoAt: r.visualizadoAt ? (r.visualizadoAt as Date).toISOString() : null,
        assinadoAt: r.assinadoAt ? (r.assinadoAt as Date).toISOString() : null,
        expiracaoAt: r.expiracaoAt ? (r.expiracaoAt as Date).toISOString() : null,
        createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
      }));
    }),

  /** Cria documento para assinatura */
  criar: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      titulo: z.string().min(2).max(255),
      descricao: z.string().max(512).optional(),
      documentoUrl: z.string().min(5),
      diasExpiracao: z.number().min(1).max(90).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      // Buscar dados do contato para pré-preencher
      const [contato] = await db.select().from(contatos)
        .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, esc.escritorio.id)))
        .limit(1);

      const token = gerarToken();
      const diasExp = input.diasExpiracao || 30;
      const expiracao = new Date();
      expiracao.setDate(expiracao.getDate() + diasExp);

      const [result] = await db.insert(assinaturasDigitais).values({
        escritorioId: esc.escritorio.id,
        contatoId: input.contatoId,
        titulo: input.titulo,
        descricao: input.descricao || null,
        documentoUrl: input.documentoUrl,
        assinantNome: contato?.nome || null,
        assinantEmail: contato?.email || null,
        assinantTelefone: contato?.telefone || null,
        tokenAssinatura: token,
        enviadoPor: esc.colaborador.id,
        status: "pendente",
        expiracaoAt: expiracao,
      });

      return {
        id: (result as { insertId: number }).insertId,
        token,
        linkAssinatura: `/assinar/${token}`,
      };
    }),

  /** Marca como enviado (após enviar link por WhatsApp/email) */
  marcarEnviado: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      await db.update(assinaturasDigitais)
        .set({ status: "enviado", enviadoAt: new Date() })
        .where(and(eq(assinaturasDigitais.id, input.id), eq(assinaturasDigitais.escritorioId, esc.escritorio.id)));

      return { success: true };
    }),

  /** Cancela/recusa assinatura */
  cancelar: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      await db.update(assinaturasDigitais)
        .set({ status: "recusado" })
        .where(and(eq(assinaturasDigitais.id, input.id), eq(assinaturasDigitais.escritorioId, esc.escritorio.id)));

      return { success: true };
    }),

  /** Exclui assinatura */
  excluir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      // Cascade: campos posicionais são órfãos sem a assinatura mãe.
      try {
        await db.delete(assinaturaCampos).where(eq(assinaturaCampos.assinaturaId, input.id));
      } catch {
        /* tabela pode não existir em deploys antigos — não bloqueia */
      }
      await db.delete(assinaturasDigitais)
        .where(and(eq(assinaturasDigitais.id, input.id), eq(assinaturasDigitais.escritorioId, esc.escritorio.id)));

      return { success: true };
    }),

  /**
   * Salva (substitui) a configuração de campos posicionais de uma
   * assinatura. Apaga campos antigos e insere os novos numa transação.
   * Usado pelo editor visual ANTES de enviar o link pro cliente.
   *
   * Permitido só enquanto a assinatura ainda não foi assinada (status
   * pendente/enviado/visualizado) — depois disso, mudar a posição
   * invalidaria o PDF já carimbado.
   *
   * Coords em pontos PDF (origem bottom-left). Frontend faz a conversão
   * de top-left antes de chamar.
   */
  salvarCampos: protectedProcedure
    .input(z.object({
      assinaturaId: z.number(),
      campos: z.array(z.object({
        tipo: z.enum(["ASSINATURA", "DATA", "NOME", "CPF"]),
        pagina: z.number().int().min(1),
        x: z.number(),
        y: z.number(),
        largura: z.number().positive(),
        altura: z.number().positive(),
        obrigatorio: z.boolean().default(true),
        signatarioIndex: z.number().int().min(0).default(0),
      })).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [assinatura] = await db.select().from(assinaturasDigitais)
        .where(and(
          eq(assinaturasDigitais.id, input.assinaturaId),
          eq(assinaturasDigitais.escritorioId, esc.escritorio.id),
        ))
        .limit(1);
      if (!assinatura) throw new Error("Assinatura não encontrada ou pertence a outro escritório.");
      if (assinatura.status === "assinado" || assinatura.status === "expirado" || assinatura.status === "recusado") {
        throw new Error(`Não é possível alterar campos de uma assinatura ${assinatura.status}.`);
      }

      // Substitui inteiro: delete + insert. Mais simples que diff em sub-50 rows.
      await db.transaction(async (tx) => {
        await tx.delete(assinaturaCampos).where(eq(assinaturaCampos.assinaturaId, input.assinaturaId));
        if (input.campos.length > 0) {
          await tx.insert(assinaturaCampos).values(
            input.campos.map((c) => ({
              assinaturaId: input.assinaturaId,
              tipo: c.tipo,
              pagina: c.pagina,
              x: c.x,
              y: c.y,
              largura: c.largura,
              altura: c.altura,
              obrigatorio: c.obrigatorio,
              signatarioIndex: c.signatarioIndex,
            })),
          );
        }
      });

      return { success: true, total: input.campos.length };
    }),

  /**
   * Lê campos posicionais de uma assinatura (lado operador).
   * Reabrir o editor pra ajustar = listar + persistir de novo via salvarCampos.
   */
  listarCampos: protectedProcedure
    .input(z.object({ assinaturaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      // Confere que a assinatura é do escritório (evita read cross-tenant)
      const [a] = await db.select({ id: assinaturasDigitais.id })
        .from(assinaturasDigitais)
        .where(and(
          eq(assinaturasDigitais.id, input.assinaturaId),
          eq(assinaturasDigitais.escritorioId, esc.escritorio.id),
        ))
        .limit(1);
      if (!a) return [];

      try {
        return await db.select().from(assinaturaCampos)
          .where(eq(assinaturaCampos.assinaturaId, input.assinaturaId))
          .orderBy(asc(assinaturaCampos.pagina), asc(assinaturaCampos.id));
      } catch {
        /* tabela pode não existir em deploys antigos */
        return [];
      }
    }),

  /**
   * Lista campos pra o cliente preencher (rota pública via token).
   * Devolve só o necessário pra renderizar caixas amarelas: id, tipo,
   * página, coords. NÃO devolve valorPreenchido (cliente só vê o seu
   * input atual no client-side state).
   */
  listarCamposPorToken: publicProcedure
    .input(z.object({ token: z.string().min(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const [doc] = await db.select({ id: assinaturasDigitais.id })
        .from(assinaturasDigitais)
        .where(eq(assinaturasDigitais.tokenAssinatura, input.token))
        .limit(1);
      if (!doc) return [];

      try {
        const campos = await db.select({
          id: assinaturaCampos.id,
          tipo: assinaturaCampos.tipo,
          pagina: assinaturaCampos.pagina,
          x: assinaturaCampos.x,
          y: assinaturaCampos.y,
          largura: assinaturaCampos.largura,
          altura: assinaturaCampos.altura,
          obrigatorio: assinaturaCampos.obrigatorio,
          signatarioIndex: assinaturaCampos.signatarioIndex,
        }).from(assinaturaCampos)
          .where(eq(assinaturaCampos.assinaturaId, doc.id))
          .orderBy(asc(assinaturaCampos.pagina), asc(assinaturaCampos.id));
        return campos;
      } catch {
        return [];
      }
    }),

  /** Estatísticas de assinaturas do escritório */
  estatisticas: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { total: 0, pendentes: 0, assinados: 0, expirados: 0 };
    const db = await getDb();
    if (!db) return { total: 0, pendentes: 0, assinados: 0, expirados: 0 };

    const rows = await db.select({
      status: assinaturasDigitais.status,
      total: sql<number>`COUNT(*)`,
    }).from(assinaturasDigitais)
      .where(eq(assinaturasDigitais.escritorioId, esc.escritorio.id))
      .groupBy(assinaturasDigitais.status);

    const sm: Record<string, number> = {};
    for (const r of rows) sm[r.status as string] = Number(r.total);

    return {
      total: Object.values(sm).reduce((a, b) => a + b, 0),
      pendentes: (sm["pendente"] || 0) + (sm["enviado"] || 0) + (sm["visualizado"] || 0),
      assinados: sm["assinado"] || 0,
      expirados: sm["expirado"] || 0,
    };
  }),

  // ─── Rotas Públicas (acesso do cliente via token) ──────────────────────

  /** Visualizar documento (cliente abre o link) */
  visualizarPorToken: publicProcedure
    .input(z.object({ token: z.string().min(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const [doc] = await db.select().from(assinaturasDigitais)
        .where(eq(assinaturasDigitais.tokenAssinatura, input.token))
        .limit(1);

      if (!doc) return null;

      // Verificar expiração
      if (doc.expiracaoAt && new Date(doc.expiracaoAt) < new Date()) {
        await db.update(assinaturasDigitais)
          .set({ status: "expirado" })
          .where(eq(assinaturasDigitais.id, doc.id));
        return { ...mapDoc(doc), status: "expirado" };
      }

      // Marcar como visualizado (se ainda não foi)
      if (doc.status === "pendente" || doc.status === "enviado") {
        await db.update(assinaturasDigitais)
          .set({ status: "visualizado", visualizadoAt: new Date() })
          .where(eq(assinaturasDigitais.id, doc.id));
      }

      return mapDoc(doc);
    }),

  /**
   * Cliente assina documento via /assinar/:token.
   *
   * Recebe a assinatura manuscrita capturada pelo signature_pad como PNG
   * base64. Faz:
   *   1. Salva PNG em /uploads/assinaturas/escritorio_<id>/assinatura_*.png
   *   2. Lê PDF original do disco (gerado anteriormente pelo LibreOffice)
   *   3. Estampa imagem na última página + adiciona página de certificação
   *   4. Salva PDF assinado em /uploads/assinaturas/escritorio_<id>/assinado_*.pdf
   *   5. UPDATE status=assinado + URLs novos
   *
   * Se PDF original não está acessível em disco (volume efêmero perdeu),
   * fallback graceful: registra status=assinado mas sem documentoAssinadoUrl,
   * com warning. Operador precisa re-uploadar o documento.
   */
  assinarPorToken: publicProcedure
    .input(z.object({
      token: z.string().min(10),
      nomeCompleto: z.string().min(3),
      cpf: z.string().max(20).optional(),
      concordo: z.boolean(),
      assinaturaImagemBase64: z.string().min(100),
      ip: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!input.concordo) throw new Error("É necessário concordar com os termos.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [doc] = await db.select().from(assinaturasDigitais)
        .where(eq(assinaturasDigitais.tokenAssinatura, input.token))
        .limit(1);

      if (!doc) throw new Error("Documento não encontrado.");
      if (doc.status === "assinado") throw new Error("Documento já foi assinado.");
      if (doc.status === "expirado") throw new Error("Documento expirado.");
      if (doc.status === "recusado") throw new Error("Documento foi cancelado.");

      if (doc.expiracaoAt && new Date(doc.expiracaoAt) < new Date()) {
        await db.update(assinaturasDigitais)
          .set({ status: "expirado" })
          .where(eq(assinaturasDigitais.id, doc.id));
        throw new Error("Documento expirado.");
      }

      // 1. Salva PNG da assinatura
      const pngBuffer = Buffer.from(input.assinaturaImagemBase64, "base64");
      const sigDir = path.resolve(`./uploads/assinaturas/escritorio_${doc.escritorioId}`);
      ensureDir(sigDir);
      const sigFilename = `assinatura_${doc.id}_${Date.now()}.png`;
      fs.writeFileSync(path.join(sigDir, sigFilename), pngBuffer);
      const assinaturaImagemUrl = `/uploads/assinaturas/escritorio_${doc.escritorioId}/${sigFilename}`;

      // 2. Lê PDF original e estampa
      const assinadoAt = new Date();
      let documentoAssinadoUrl: string | null = null;
      try {
        const docPath = path.resolve("." + doc.documentoUrl);
        if (!fs.existsSync(docPath)) {
          throw new Error(`PDF original não encontrado em ${docPath}`);
        }
        const pdfOriginal = fs.readFileSync(docPath);
        const pdfAssinado = await estamparAssinatura({
          pdfOriginal,
          assinaturaImagem: pngBuffer,
          nomeCompleto: input.nomeCompleto,
          cpf: input.cpf,
          ip: input.ip,
          assinadoAt,
        });
        const pdfFilename = `assinado_${doc.id}_${Date.now()}.pdf`;
        fs.writeFileSync(path.join(sigDir, pdfFilename), pdfAssinado);
        documentoAssinadoUrl = `/uploads/assinaturas/escritorio_${doc.escritorioId}/${pdfFilename}`;
      } catch (err: unknown) {
        // Não bloqueia a assinatura se a estampa falhar — registra mesmo
        // assim com warning. Escritório pode regenerar o PDF assinado
        // depois quando o original estiver disponível.
        log.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            assinaturaId: doc.id,
            documentoUrl: doc.documentoUrl,
          },
          "Falha ao estampar PDF — assinatura registrada sem documentoAssinadoUrl",
        );
      }

      // 3. UPDATE
      await db.update(assinaturasDigitais).set({
        status: "assinado",
        assinadoAt,
        assinantNome: input.nomeCompleto,
        assinanteCpf: input.cpf || null,
        ipAssinatura: input.ip || null,
        assinaturaImagemUrl,
        documentoAssinadoUrl,
      }).where(eq(assinaturasDigitais.id, doc.id));

      // SSE notif
      try {
        const { emitirParaEscritorio } = await import("../_core/sse-notifications");
        emitirParaEscritorio(doc.escritorioId, {
          tipo: "assinatura_concluida",
          titulo: "Documento assinado!",
          mensagem: `${input.nomeCompleto} assinou "${doc.titulo}"`,
          dados: { assinaturaId: doc.id, contatoId: doc.contatoId },
        });
      } catch {
        /* SSE indisponível */
      }

      return {
        success: true,
        message: "Documento assinado com sucesso!",
        documentoAssinadoUrl,
      };
    }),
});

function mapDoc(doc: any) {
  return {
    id: doc.id,
    titulo: doc.titulo,
    descricao: doc.descricao,
    status: doc.status,
    documentoUrl: doc.documentoUrl,
    documentoAssinadoUrl: doc.documentoAssinadoUrl ?? null,
    assinantNome: doc.assinantNome,
    expiracaoAt: doc.expiracaoAt ? (doc.expiracaoAt as Date).toISOString() : null,
  };
}
