import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { getDb } from "../db";
import { contatos, clienteArquivos, clienteAnotacoes, conversas, leads } from "../../drizzle/schema";
import { eq, and, desc, like, or, sql } from "drizzle-orm";
import { checkPermission } from "./check-permission";
import { validarCpfCnpj, validarEmail, validarTelefone } from "../../shared/validacoes";
import { verificarLimite } from "../billing/plan-limits";
import { excluirClienteEmCascata } from "./excluir-cliente";

export const clientesRouter = router({
  listar: protectedProcedure.input(z.object({ busca: z.string().optional(), limite: z.number().min(1).max(100).optional(), pagina: z.number().min(1).optional() }).optional()).query(async ({ ctx, input }) => {
    const perm = await checkPermission(ctx.user.id, "clientes", "ver");
    if (!perm.allowed) return { clientes: [], total: 0 };
    const db = await getDb(); if (!db) return { clientes: [], total: 0 };
    const limite = input?.limite || 50; const offset = ((input?.pagina || 1) - 1) * limite;
    let where: any = eq(contatos.escritorioId, perm.escritorioId);
    // Se só pode ver próprios, filtra por responsável
    if (!perm.verTodos && perm.verProprios) { where = and(where, eq(contatos.responsavelId, perm.colaboradorId)); }
    if (input?.busca) { const b = `%${input.busca}%`; where = and(where, or(like(contatos.nome, b), like(contatos.telefone, b), like(contatos.email, b), like(contatos.cpfCnpj, b))); }
    const rows = await db.select().from(contatos).where(where).orderBy(desc(contatos.createdAt)).limit(limite).offset(offset);
    const [cnt] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(where);
    return { clientes: rows.map(r => ({ ...r, createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "", updatedAt: r.updatedAt ? (r.updatedAt as Date).toISOString() : "" })), total: Number((cnt as { count: number } | undefined)?.count || 0), pagina: input?.pagina || 1, limite, totalPaginas: Math.ceil(Number((cnt as { count: number } | undefined)?.count || 0) / limite) };
  }),

  detalhe: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return null;
    const db = await getDb(); if (!db) return null;
    const [c] = await db.select().from(contatos).where(and(eq(contatos.id, input.id), eq(contatos.escritorioId, esc.escritorio.id))).limit(1);
    if (!c) return null;
    const [cc] = await db.select({ count: sql`COUNT(*)` }).from(conversas).where(and(eq(conversas.contatoId, input.id), eq(conversas.escritorioId, esc.escritorio.id)));
    const [lc] = await db.select({ count: sql`COUNT(*)` }).from(leads).where(and(eq(leads.contatoId, input.id), eq(leads.escritorioId, esc.escritorio.id)));
    const [ac] = await db.select({ count: sql`COUNT(*)` }).from(clienteArquivos).where(and(eq(clienteArquivos.contatoId, input.id), eq(clienteArquivos.escritorioId, esc.escritorio.id)));
    const [nc] = await db.select({ count: sql`COUNT(*)` }).from(clienteAnotacoes).where(and(eq(clienteAnotacoes.contatoId, input.id), eq(clienteAnotacoes.escritorioId, esc.escritorio.id)));
    return { ...c, createdAt: c.createdAt ? (c.createdAt as Date).toISOString() : "", updatedAt: c.updatedAt ? (c.updatedAt as Date).toISOString() : "", totalConversas: Number((cc as { count: number } | undefined)?.count || 0), totalLeads: Number((lc as { count: number } | undefined)?.count || 0), totalArquivos: Number((ac as { count: number } | undefined)?.count || 0), totalAnotacoes: Number((nc as { count: number } | undefined)?.count || 0) };
  }),

  criar: protectedProcedure.input(z.object({ nome: z.string().min(2).max(255), telefone: z.string().max(20).optional(), email: z.string().max(320).optional(), cpfCnpj: z.string().max(18).optional(), origem: z.string().optional(), observacoes: z.string().optional(), tags: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "criar");
      if (!perm.allowed) throw new Error("Sem permissão para cadastrar clientes.");
      const limite = await verificarLimite(perm.escritorioId, ctx.user.id, "clientes");
      if (!limite.permitido) throw new Error(limite.mensagem);
      if (input.email && !validarEmail(input.email)) throw new Error("Email inválido.");
      if (input.cpfCnpj) { const v = validarCpfCnpj(input.cpfCnpj); if (!v.valido) throw new Error(`${v.tipo === "cpf" ? "CPF" : v.tipo === "cnpj" ? "CNPJ" : "CPF/CNPJ"} inválido.`); }
      if (input.telefone && !validarTelefone(input.telefone)) throw new Error("Telefone inválido. Use formato (XX) XXXXX-XXXX.");
      const db = await getDb(); if (!db) throw new Error("Database indisponível");
      const [r] = await db.insert(contatos).values({ escritorioId: perm.escritorioId, nome: input.nome, telefone: input.telefone || null, email: input.email || null, cpfCnpj: input.cpfCnpj || null, origem: (input.origem || "manual") as any, observacoes: input.observacoes || null, tags: input.tags || null, responsavelId: perm.colaboradorId });
      return { id: (r as { insertId: number }).insertId };
    }),

  atualizar: protectedProcedure.input(z.object({ id: z.number(), nome: z.string().min(2).max(255).optional(), telefone: z.string().max(20).optional(), email: z.string().max(320).optional(), cpfCnpj: z.string().max(18).optional(), observacoes: z.string().optional(), tags: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.allowed) throw new Error("Sem permissão para editar clientes.");
      if (input.email && !validarEmail(input.email)) throw new Error("Email inválido.");
      if (input.cpfCnpj) { const v = validarCpfCnpj(input.cpfCnpj); if (!v.valido) throw new Error("CPF/CNPJ inválido."); }
      if (input.telefone && !validarTelefone(input.telefone)) throw new Error("Telefone inválido.");
      const db = await getDb(); if (!db) throw new Error("Database indisponível");

      // Se o telefone mudou, preserva o antigo em telefonesAnteriores
      // para que o handler do WhatsApp ainda reconheça mensagens do número
      // anterior (evita perda de histórico/conexão).
      let telefonesAnterioresAtualizado: string | null | undefined;
      if (input.telefone !== undefined) {
        try {
          const [existente] = await db.select({
            telefone: contatos.telefone,
            telefonesAnteriores: contatos.telefonesAnteriores,
          }).from(contatos)
            .where(and(eq(contatos.id, input.id), eq(contatos.escritorioId, perm.escritorioId)))
            .limit(1);

          if (existente?.telefone && existente.telefone !== input.telefone) {
            const historico = (existente.telefonesAnteriores || "")
              .split(",")
              .map((t: string) => t.trim())
              .filter(Boolean);
            if (!historico.includes(existente.telefone)) {
              historico.unshift(existente.telefone);
            }
            telefonesAnterioresAtualizado = historico.join(",");
          }
        } catch {
          /* schema antigo — ignora, próximo deploy garante a coluna */
        }
      }

      const { id, ...d } = input; const u: Record<string, unknown> = {};
      if (d.nome !== undefined) u.nome = d.nome;
      if (d.telefone !== undefined) u.telefone = d.telefone;
      if (telefonesAnterioresAtualizado !== undefined) u.telefonesAnteriores = telefonesAnterioresAtualizado;
      if (d.email !== undefined) u.email = d.email;
      if (d.cpfCnpj !== undefined) u.cpfCnpj = d.cpfCnpj;
      if (d.observacoes !== undefined) u.observacoes = d.observacoes;
      if (d.tags !== undefined) u.tags = d.tags;
      await db.update(contatos).set(u).where(and(eq(contatos.id, id), eq(contatos.escritorioId, perm.escritorioId)));
      return { success: true };
    }),

  excluir: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const perm = await checkPermission(ctx.user.id, "clientes", "excluir");
    if (!perm.allowed) throw new Error("Sem permissão para excluir clientes.");
    // Cascata: cancela cobranças no Asaas, deleta espelhos locais,
    // conversas, mensagens, leads, tarefas, anotações, arquivos e
    // assinaturas — tudo vinculado a este cliente.
    const resultado = await excluirClienteEmCascata(input.id, perm.escritorioId);
    return resultado;
  }),

  listarAnotacoes: protectedProcedure.input(z.object({ contatoId: z.number() })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return []; const db = await getDb(); if (!db) return [];
    const rows = await db.select().from(clienteAnotacoes).where(and(eq(clienteAnotacoes.contatoId, input.contatoId), eq(clienteAnotacoes.escritorioId, esc.escritorio.id))).orderBy(desc(clienteAnotacoes.createdAt));
    return rows.map(r => ({ ...r, createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "", updatedAt: r.updatedAt ? (r.updatedAt as Date).toISOString() : "" }));
  }),
  criarAnotacao: protectedProcedure.input(z.object({ contatoId: z.number(), titulo: z.string().max(255).optional(), conteudo: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    const [r] = await db.insert(clienteAnotacoes).values({ escritorioId: esc.escritorio.id, contatoId: input.contatoId, titulo: input.titulo || null, conteudo: input.conteudo, criadoPor: esc.colaborador.id });
    return { id: (r as { insertId: number }).insertId };
  }),
  excluirAnotacao: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    await db.delete(clienteAnotacoes).where(and(eq(clienteAnotacoes.id, input.id), eq(clienteAnotacoes.escritorioId, esc.escritorio.id)));
    return { success: true };
  }),

  listarArquivos: protectedProcedure.input(z.object({ contatoId: z.number() })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return []; const db = await getDb(); if (!db) return [];
    const rows = await db.select().from(clienteArquivos).where(and(eq(clienteArquivos.contatoId, input.contatoId), eq(clienteArquivos.escritorioId, esc.escritorio.id))).orderBy(desc(clienteArquivos.createdAt));
    return rows.map(r => ({ ...r, createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "" }));
  }),
  salvarArquivo: protectedProcedure.input(z.object({ contatoId: z.number(), nome: z.string().max(255), tipo: z.string().max(255).optional(), tamanho: z.number().optional(), url: z.string() })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    const [r] = await db.insert(clienteArquivos).values({ escritorioId: esc.escritorio.id, contatoId: input.contatoId, nome: input.nome, tipo: input.tipo || null, tamanho: input.tamanho || null, url: input.url, uploadPor: esc.colaborador.id });
    return { id: (r as { insertId: number }).insertId };
  }),
  excluirArquivo: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    await db.delete(clienteArquivos).where(and(eq(clienteArquivos.id, input.id), eq(clienteArquivos.escritorioId, esc.escritorio.id)));
    return { success: true };
  }),

  listarConversas: protectedProcedure.input(z.object({ contatoId: z.number() })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return []; const db = await getDb(); if (!db) return [];
    const rows = await db.select().from(conversas).where(and(eq(conversas.contatoId, input.contatoId), eq(conversas.escritorioId, esc.escritorio.id))).orderBy(desc(conversas.createdAt));
    return rows.map(r => ({ id: r.id, status: r.status, assunto: r.assunto, ultimaMensagemPreview: r.ultimaMensagemPreview, ultimaMensagemAt: r.ultimaMensagemAt ? (r.ultimaMensagemAt as Date).toISOString() : "", createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "" }));
  }),

  listarLeads: protectedProcedure.input(z.object({ contatoId: z.number() })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return []; const db = await getDb(); if (!db) return [];
    const rows = await db.select().from(leads).where(and(eq(leads.contatoId, input.contatoId), eq(leads.escritorioId, esc.escritorio.id))).orderBy(desc(leads.createdAt));
    return rows.map(r => ({ id: r.id, etapaFunil: r.etapaFunil, valorEstimado: r.valorEstimado, createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "" }));
  }),

  estatisticas: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return { total: 0, novosHoje: 0, comTelefone: 0, comEmail: 0 };
    const db = await getDb(); if (!db) return { total: 0, novosHoje: 0, comTelefone: 0, comEmail: 0 };
    const eid = esc.escritorio.id;
    const [t] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(eq(contatos.escritorioId, eid));
    const [ct] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(and(eq(contatos.escritorioId, eid), sql`telefoneContato IS NOT NULL AND telefoneContato != ''`));
    const [ce] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(and(eq(contatos.escritorioId, eid), sql`emailContato IS NOT NULL AND emailContato != ''`));
    const [nh] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(and(eq(contatos.escritorioId, eid), sql`DATE(createdAtContato) = CURDATE()`));
    return { total: Number((t as { count: number } | undefined)?.count || 0), novosHoje: Number((nh as { count: number } | undefined)?.count || 0), comTelefone: Number((ct as { count: number } | undefined)?.count || 0), comEmail: Number((ce as { count: number } | undefined)?.count || 0) };
  }),
});
