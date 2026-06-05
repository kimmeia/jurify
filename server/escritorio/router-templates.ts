import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { mensagemTemplates } from "../../drizzle/schema";
import { eq, and, like, or, sql, type SQL } from "drizzle-orm";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { checkPermission } from "./check-permission";
import { TRPCError } from "@trpc/server";
import { createLogger } from "../_core/logger";
const log = createLogger("escritorio-router-templates");

// Templates de mensagem são "ativo do escritório" — só dono/gestor (ou cargo
// com flag "editar" no módulo atendimento) cria/edita/remove. Qualquer
// atendente LISTA pra escolher na hora de responder o cliente.
async function exigirGestaoTemplates(userId: number) {
  const perm = await checkPermission(userId, "atendimento", "editar");
  if (!perm.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Apenas o escritório (dono ou gestor) pode criar/editar templates.",
    });
  }
  return perm;
}

const categoriaEnum = z.enum([
  "saudacao", "cobranca", "agendamento", "juridico", "encerramento", "outro",
]);
const midiaTipoEnum = z.enum(["imagem", "video", "audio", "documento"]);

export const templatesRouter = router({
  /** Lista todos os templates do escritório — disponível pra todo atendente.
   *  Resiliente à ausência das colunas de mídia (migration 0139): se ainda
   *  não rodou em produção, a query com schema novo lança "Unknown column",
   *  e o fallback abaixo retorna só campos básicos com midia=null. */
  listar: protectedProcedure
    .input(z.object({ categoria: z.string().optional(), busca: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];
      try {
        const conditions: any[] = [eq(mensagemTemplates.escritorioId, esc.escritorio.id)];
        if (input?.categoria) conditions.push(eq(mensagemTemplates.categoria, input.categoria as any));
        if (input?.busca) {
          const b = `%${input.busca}%`;
          conditions.push(or(like(mensagemTemplates.titulo, b), like(mensagemTemplates.conteudo, b)));
        }
        return await db.select().from(mensagemTemplates).where(and(...conditions));
      } catch (err: any) {
        // Fallback resiliente — provavelmente "Unknown column midiaUrlTpl"
        // porque migration 0139 ainda não rodou. Retorna shape compatível
        // com midia null em vez de quebrar a UX.
        log.warn("[Templates] listar com schema novo falhou, fallback básico:", err.message);
        try {
          const cats = input?.categoria ? sql`AND categoriaTpl = ${input.categoria}` : sql``;
          const busca = input?.busca ? sql`AND (tituloTpl LIKE ${`%${input.busca}%`} OR conteudoTpl LIKE ${`%${input.busca}%`})` : sql``;
          const rows = await db.execute(sql`
            SELECT id, escritorioIdTpl AS escritorioId, tituloTpl AS titulo, conteudoTpl AS conteudo,
                   categoriaTpl AS categoria, atalhoTpl AS atalho, criadoPorTpl AS criadoPor,
                   createdAtTpl AS createdAt
            FROM mensagem_templates
            WHERE escritorioIdTpl = ${esc.escritorio.id} ${cats} ${busca}
          `);
          const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : (rows as any).rows ?? [];
          return (list as any[]).map((r) => ({ ...r, midiaUrl: null, midiaTipo: null }));
        } catch (err2: any) {
          log.error("[Templates] fallback também falhou:", err2.message);
          return [];
        }
      }
    }),

  criar: protectedProcedure
    .input(z.object({
      titulo: z.string().min(1).max(100),
      conteudo: z.string().min(1).max(2000),
      categoria: categoriaEnum.optional(),
      atalho: z.string().max(20).optional(),
      midiaUrl: z.string().max(512).optional().nullable(),
      midiaTipo: midiaTipoEnum.optional().nullable(),
    }).refine(
      (d) => (!d.midiaUrl && !d.midiaTipo) || (!!d.midiaUrl && !!d.midiaTipo),
      { message: "Informe midiaUrl E midiaTipo juntos, ou nenhum." },
    ))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritorio nao encontrado." });
      await exigirGestaoTemplates(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const cat = input.categoria || "outro";
      const atalho = input.atalho || null;
      const midiaUrl = input.midiaUrl || null;
      const midiaTipo = input.midiaTipo || null;

      let result;
      try {
        result = await db.execute(
          sql`INSERT INTO mensagem_templates
            (escritorioIdTpl, tituloTpl, conteudoTpl, categoriaTpl, atalhoTpl, midiaUrlTpl, midiaTipoTpl, criadoPorTpl)
            VALUES (${esc.escritorio.id}, ${input.titulo}, ${input.conteudo}, ${cat}, ${atalho}, ${midiaUrl}, ${midiaTipo}, ${esc.colaborador.id})`
        );
      } catch (err: any) {
        // Migration 0139 ainda não rodou em produção — INSERT cita
        // colunas inexistentes. Fallback sem mídia. Se o operador tinha
        // anexado mídia, ela é ignorada (warning no log).
        if (/Unknown column/i.test(err?.message || "")) {
          log.warn("[Templates] colunas de mídia ausentes — INSERT sem mídia (rode migration 0139)");
          result = await db.execute(
            sql`INSERT INTO mensagem_templates
              (escritorioIdTpl, tituloTpl, conteudoTpl, categoriaTpl, atalhoTpl, criadoPorTpl)
              VALUES (${esc.escritorio.id}, ${input.titulo}, ${input.conteudo}, ${cat}, ${atalho}, ${esc.colaborador.id})`
          );
        } else {
          throw err;
        }
      }

      const header = Array.isArray(result) ? (result[0] as { insertId?: number }) : (result as { insertId?: number });
      const insertId = header?.insertId ?? 0;
      return { id: insertId };
    }),

  atualizar: protectedProcedure
    .input(z.object({
      id: z.number(),
      titulo: z.string().min(1).max(100).optional(),
      conteudo: z.string().min(1).max(2000).optional(),
      categoria: categoriaEnum.optional(),
      atalho: z.string().max(20).optional(),
      midiaUrl: z.string().max(512).optional().nullable(),
      midiaTipo: midiaTipoEnum.optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED" });
      await exigirGestaoTemplates(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const updates: SQL[] = [];
      if (input.titulo) updates.push(sql`tituloTpl = ${input.titulo}`);
      if (input.conteudo) updates.push(sql`conteudoTpl = ${input.conteudo}`);
      if (input.categoria) updates.push(sql`categoriaTpl = ${input.categoria}`);
      if (input.atalho !== undefined) updates.push(sql`atalhoTpl = ${input.atalho || null}`);
      if (input.midiaUrl !== undefined) updates.push(sql`midiaUrlTpl = ${input.midiaUrl || null}`);
      if (input.midiaTipo !== undefined) updates.push(sql`midiaTipoTpl = ${input.midiaTipo || null}`);

      if (updates.length > 0) {
        await db.execute(sql`UPDATE mensagem_templates SET ${sql.join(updates, sql`, `)} WHERE id = ${input.id} AND escritorioIdTpl = ${esc.escritorio.id}`);
      }
      return { success: true };
    }),

  excluir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED" });
      await exigirGestaoTemplates(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.execute(
        sql`DELETE FROM mensagem_templates WHERE id = ${input.id} AND escritorioIdTpl = ${esc.escritorio.id}`
      );
      return { success: true };
    }),
});
