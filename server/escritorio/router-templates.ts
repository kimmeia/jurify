import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { mensagemTemplates } from "../../drizzle/schema";
import { eq, and, like, or, sql } from "drizzle-orm";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { TRPCError } from "@trpc/server";

export const templatesRouter = router({
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
        console.error("[Templates] Erro ao listar:", err.message);
        return [];
      }
    }),

  criar: protectedProcedure
    .input(z.object({
      titulo: z.string().min(1).max(100),
      conteudo: z.string().min(1).max(2000),
      categoria: z.enum(["saudacao", "cobranca", "agendamento", "juridico", "encerramento", "outro"]).optional(),
      atalho: z.string().max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritorio nao encontrado." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const cat = input.categoria || "outro";
      const atalho = input.atalho || null;

      const result = await db.execute(
        sql`INSERT INTO mensagem_templates (escritorioIdTpl, tituloTpl, conteudoTpl, categoriaTpl, atalhoTpl, criadoPorTpl) VALUES (${esc.escritorio.id}, ${input.titulo}, ${input.conteudo}, ${cat}, ${atalho}, ${esc.colaborador.id})`
      );

      const insertId = (result as any)[0]?.insertId || (result as any).insertId || 0;
      return { id: insertId };
    }),

  atualizar: protectedProcedure
    .input(z.object({
      id: z.number(),
      titulo: z.string().min(1).max(100).optional(),
      conteudo: z.string().min(1).max(2000).optional(),
      categoria: z.enum(["saudacao", "cobranca", "agendamento", "juridico", "encerramento", "outro"]).optional(),
      atalho: z.string().max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const sets: string[] = [];
      const vals: any[] = [];
      if (input.titulo) { sets.push("tituloTpl = ?"); vals.push(input.titulo); }
      if (input.conteudo) { sets.push("conteudoTpl = ?"); vals.push(input.conteudo); }
      if (input.categoria) { sets.push("categoriaTpl = ?"); vals.push(input.categoria); }
      if (input.atalho !== undefined) { sets.push("atalhoTpl = ?"); vals.push(input.atalho || null); }

      if (sets.length > 0) {
        await db.execute(sql.raw(`UPDATE mensagem_templates SET ${sets.join(", ")} WHERE id = ${input.id} AND escritorioIdTpl = ${esc.escritorio.id}`));
      }
      return { success: true };
    }),

  excluir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.execute(
        sql`DELETE FROM mensagem_templates WHERE id = ${input.id} AND escritorioIdTpl = ${esc.escritorio.id}`
      );
      return { success: true };
    }),
});
