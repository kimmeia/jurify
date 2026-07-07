/**
 * Router do Agente Jurídico — Fase 1 (base de conhecimento + busca).
 *
 * Expõe a base curada (súmulas/leis/precedentes) e a busca por similaridade
 * que alimenta a avaliação de sucesso e a redação de peças (incrementos 2 e 3).
 * Embeddings usam a chave OpenAI do escritório (fallback plataforma).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, or, sql, desc, like } from "drizzle-orm";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { fontesJuridicas, escritorios } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { resolverAPIKey } from "../integracoes/router-agentes-ia";
import { gerarEmbedding, gerarEmbeddingSeguro } from "./embeddings";
import { recuperarFontes, seedFontesRevisional, reindexarEmbeddings } from "./base";
import { checkPermission } from "../escritorio/check-permission";
import { AREA_REVISIONAL } from "./fontes-revisional";
import { chamarLLMEscritorio, conversarLLMEscritorio } from "./llm";
import { avaliarViabilidade, type FonteContexto } from "./avaliacao";
import { gerarPeca, TIPOS_PECA } from "./peca";
import { montarPecaDocx } from "./docx";
import { montarDossie, montarMovimentacao } from "./dossie";
import { montarConteudoDocumentos, garantirConteudoDocs, resolverConteudoFonte, chunkTexto } from "./leitura-documento";
import { montarSystemPromptAgente } from "./agente-conversa";

/** Resolve a chave OpenAI (embeddings sempre via OpenAI). null se não houver. */
async function resolverChaveOpenAI(escritorioId: number): Promise<string | null> {
  const r = await resolverAPIKey(escritorioId, null, "openai");
  return r && r.provider === "openai" ? r.key : null;
}

/**
 * Fatia o texto da fonte em trechos, embedda cada um (se houver chave OpenAI) e
 * insere em `fontes_juridicas`. Compartilhado por adicionarFonte (escritório) e
 * subirDecisao (admin global). Sem chave: insere sem embedding (reindexa depois).
 */
async function inserirFonteComChunks(
  db: any,
  key: string | null,
  campos: {
    escritorioId: number | null;
    tipo: "sumula" | "lei" | "precedente" | "tese";
    identificador: string;
    orgao?: string | null;
    area: string;
    titulo?: string | null;
    tags?: string | null;
    texto: string;
  },
): Promise<{ trechos: number; indexadas: number }> {
  const partes = chunkTexto(campos.texto);
  const trechos = partes.length ? partes : [campos.texto];
  let indexadas = 0;
  for (let i = 0; i < trechos.length; i++) {
    const textoIndex = [campos.identificador, campos.titulo, trechos[i]].filter(Boolean).join(" — ");
    const emb = key ? await gerarEmbeddingSeguro(textoIndex, key).catch(() => null) : null;
    await db.insert(fontesJuridicas).values({
      escritorioId: campos.escritorioId,
      tipo: campos.tipo,
      identificador: trechos.length > 1 ? `${campos.identificador} [${i + 1}/${trechos.length}]` : campos.identificador,
      orgao: campos.orgao ?? null,
      area: campos.area,
      titulo: campos.titulo ?? null,
      texto: trechos[i],
      tags: campos.tags ?? null,
      embedding: emb ? JSON.stringify(emb) : null,
    });
    if (emb) indexadas++;
  }
  return { trechos: trechos.length, indexadas };
}

export const juridicoRouter = router({
  /** Contagem da base por tipo/área + quantas já estão indexadas (com embedding). */
  estatisticasBase: protectedProcedure
    .input(z.object({ area: z.string().max(80).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { total: 0, indexadas: 0, porTipo: {} as Record<string, number> };
      const db = await getDb();
      if (!db) return { total: 0, indexadas: 0, porTipo: {} as Record<string, number> };

      const escCond = or(isNull(fontesJuridicas.escritorioId), eq(fontesJuridicas.escritorioId, esc.escritorio.id))!;
      const conds = [escCond];
      if (input?.area) conds.push(eq(fontesJuridicas.area, input.area));

      const rows = await db
        .select({ tipo: fontesJuridicas.tipo, temEmb: sql<number>`CASE WHEN ${fontesJuridicas.embedding} IS NULL THEN 0 ELSE 1 END` })
        .from(fontesJuridicas)
        .where(and(...conds));

      const porTipo: Record<string, number> = {};
      let indexadas = 0;
      for (const r of rows) {
        porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;
        if (Number(r.temEmb) === 1) indexadas++;
      }
      return { total: rows.length, indexadas, porTipo };
    }),

  /** Lista as fontes da base (sem o blob de embedding) — pra gestão/consulta. */
  listarFontes: protectedProcedure
    .input(z.object({
      area: z.string().max(80).optional(),
      busca: z.string().max(160).optional(),
      origem: z.enum(["todas", "minhas", "globais"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      const origem = input?.origem ?? "todas";
      const escCond =
        origem === "minhas" ? eq(fontesJuridicas.escritorioId, esc.escritorio.id)
        : origem === "globais" ? isNull(fontesJuridicas.escritorioId)
        : or(isNull(fontesJuridicas.escritorioId), eq(fontesJuridicas.escritorioId, esc.escritorio.id))!;
      const conds = [escCond];
      if (input?.area) conds.push(eq(fontesJuridicas.area, input.area));
      if (input?.busca) {
        const b = `%${input.busca}%`;
        conds.push(or(like(fontesJuridicas.identificador, b), like(fontesJuridicas.titulo, b), like(fontesJuridicas.texto, b))!);
      }
      return db
        .select({
          id: fontesJuridicas.id,
          escritorioId: fontesJuridicas.escritorioId,
          tipo: fontesJuridicas.tipo,
          identificador: fontesJuridicas.identificador,
          orgao: fontesJuridicas.orgao,
          area: fontesJuridicas.area,
          titulo: fontesJuridicas.titulo,
          texto: fontesJuridicas.texto,
          indexada: sql<number>`CASE WHEN ${fontesJuridicas.embedding} IS NULL THEN 0 ELSE 1 END`,
        })
        .from(fontesJuridicas)
        .where(and(...conds))
        .orderBy(desc(fontesJuridicas.id))
        .limit(200);
    }),

  /** Adiciona uma fonte PRÓPRIA do escritório (súmula/lei/precedente/modelo). */
  adicionarFonte: protectedProcedure
    .input(z.object({
      tipo: z.enum(["sumula", "lei", "precedente", "tese"]),
      identificador: z.string().min(2).max(160),
      orgao: z.string().max(60).optional(),
      area: z.string().max(80).optional(),
      titulo: z.string().max(255).optional(),
      // Conteúdo por TEXTO, LINK (ex.: súmula/jurisprudência) ou ARQUIVO
      // (PDF/DOCX/imagem) — a IA lê o conteúdo inteiro.
      texto: z.string().max(20000).optional(),
      link: z.string().url().max(1000).optional(),
      arquivoBase64: z.string().optional(),
      nomeArquivo: z.string().max(200).optional(),
      tags: z.string().max(500).optional(),
      modelo: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "processos", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão pra editar fontes." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const modelo = input.modelo || "claude-sonnet-4-20250514";
      const leitura = await resolverConteudoFonte(perm.escritorioId, {
        texto: input.texto, link: input.link, arquivoBase64: input.arquivoBase64, nomeArquivo: input.nomeArquivo, modelo,
      });
      if (!leitura.texto) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Não deu pra ler a fonte: ${leitura.nota || "informe texto, link ou arquivo"}` });
      }
      const key = await resolverChaveOpenAI(perm.escritorioId);
      const r = await inserirFonteComChunks(db, key, {
        escritorioId: perm.escritorioId, tipo: input.tipo, identificador: input.identificador,
        orgao: input.orgao, area: input.area || AREA_REVISIONAL, titulo: input.titulo, tags: input.tags, texto: leitura.texto,
      });
      return { trechos: r.trechos, indexada: r.indexadas > 0, via: leitura.via };
    }),

  /** Exclui uma fonte PRÓPRIA do escritório (não mexe na base global). */
  excluirFonte: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "processos", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão pra editar fontes." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // escritorioId setado garante que só remove fonte própria (global é NULL).
      await db.delete(fontesJuridicas).where(and(eq(fontesJuridicas.id, input.id), eq(fontesJuridicas.escritorioId, perm.escritorioId)));
      return { success: true };
    }),

  /** Busca por similaridade — recupera as fontes mais relevantes à consulta. */
  buscar: protectedProcedure
    .input(z.object({
      query: z.string().min(3).max(2000),
      area: z.string().max(80).optional(),
      topK: z.number().int().min(1).max(20).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritório não encontrado." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const key = await resolverChaveOpenAI(esc.escritorio.id);
      if (!key) {
        return {
          disponivel: false,
          motivo: "Nenhuma chave OpenAI configurada — a busca inteligente da base usa embeddings da OpenAI. Configure em Integrações.",
          fontes: [],
        };
      }
      let queryEmb: number[];
      try {
        queryEmb = await gerarEmbedding(input.query, key);
      } catch (err: any) {
        return { disponivel: false, motivo: err?.message || "Falha ao consultar embeddings.", fontes: [] };
      }
      const fontes = await recuperarFontes(db, queryEmb, {
        area: input.area ?? AREA_REVISIONAL,
        escritorioId: esc.escritorio.id,
        topK: input.topK ?? 6,
      });
      return { disponivel: true, motivo: null as string | null, fontes };
    }),

  /**
   * Avaliação de sucesso (viabilidade) — recupera as fontes do caso e pede ao
   * modelo do escritório uma análise estruturada e citada (nota + fatores +
   * força por tese). Sem % inventado; citações conferidas contra as fontes.
   */
  avaliarSucesso: protectedProcedure
    .input(z.object({
      fatos: z.string().min(10).max(8000),
      area: z.string().max(80).optional(),
      teses: z.array(z.string().max(300)).max(20).optional(),
      modelo: z.string().max(64).optional(),
      topK: z.number().int().min(1).max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritório não encontrado." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const area = input.area ?? AREA_REVISIONAL;
      const modelo = input.modelo || "gpt-4o-mini";

      const key = await resolverChaveOpenAI(esc.escritorio.id);
      if (!key) {
        return { disponivel: false, motivo: "Sem chave OpenAI pra recuperar as fontes (embeddings). Configure em Integrações.", avaliacao: null, fontes: [] as Awaited<ReturnType<typeof recuperarFontes>> };
      }
      const consulta = [input.fatos, ...(input.teses ?? [])].join("\n");
      let queryEmb: number[];
      try {
        queryEmb = await gerarEmbedding(consulta, key);
      } catch (e: any) {
        return { disponivel: false, motivo: e?.message || "Falha nos embeddings.", avaliacao: null, fontes: [] as Awaited<ReturnType<typeof recuperarFontes>> };
      }

      const fontes = await recuperarFontes(db, queryEmb, { area, escritorioId: esc.escritorio.id, topK: input.topK ?? 8 });
      const fontesCtx: FonteContexto[] = fontes.map((f) => ({ identificador: f.identificador, titulo: f.titulo, texto: f.texto }));

      let llmErro: string | undefined;
      const chamar = async (system: string, user: string): Promise<string | null> => {
        const r = await chamarLLMEscritorio(esc.escritorio.id, { system, user, modelo, maxTokens: 2500 });
        if (!r.texto && r.erro) llmErro = r.erro;
        return r.texto;
      };
      const { avaliacao, erro } = await avaliarViabilidade({ fatos: input.fatos, area, teses: input.teses }, fontesCtx, chamar);
      if (!avaliacao) {
        return { disponivel: false, motivo: llmErro || erro || "Falha na avaliação.", avaliacao: null, fontes };
      }
      return { disponivel: true, motivo: null as string | null, avaliacao, fontes };
    }),

  /** Tipos de peça disponíveis (Fase 1: revisional). */
  tiposPeca: protectedProcedure.query(() =>
    Object.values(TIPOS_PECA).map((t) => ({ id: t.id, label: t.label, area: t.area, secoes: t.secoes })),
  ),

  /**
   * Redige a peça: recupera as fontes, o modelo do escritório redige citando
   * só essas fontes, e a verificação marca citações sem respaldo (anti-invenção).
   */
  /**
   * Dossiê do cliente pro Agente: qualificação + processo + lista de documentos.
   * Alimenta a tela (preview + seleção) antes de gerar a peça. Isolado por
   * escritório. Gate: quem pode ver clientes.
   */
  contextoDoCliente: protectedProcedure
    .input(z.object({ contatoId: z.number(), processoId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "ver");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão pra ver clientes." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const dossie = await montarDossie(db, perm.escritorioId, input.contatoId, input.processoId);
      const movimentacao = dossie.cnj ? await montarMovimentacao(db, perm.escritorioId, dossie.cnj) : "";
      return { ...dossie, movimentacao };
    }),

  /** Lê as instruções personalizadas do Agente Jurídico (comportamento). */
  obterInstrucoesAgente: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { instrucoes: "" };
    const db = await getDb();
    if (!db) return { instrucoes: "" };
    const [row] = await db
      .select({ instrucoes: escritorios.instrucoesAgenteJuridico })
      .from(escritorios)
      .where(eq(escritorios.id, esc.escritorio.id))
      .limit(1);
    return { instrucoes: row?.instrucoes ?? "" };
  }),

  /** Salva as instruções personalizadas do agente (dono/gestor). */
  salvarInstrucoesAgente: protectedProcedure
    .input(z.object({ instrucoes: z.string().max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "processos", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão pra editar o agente." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(escritorios)
        .set({ instrucoesAgenteJuridico: input.instrucoes.trim() || null })
        .where(eq(escritorios.id, perm.escritorioId));
      return { success: true };
    }),

  /**
   * Conversa do Agente Jurídico: analisa o caso (dossiê + MOVIMENTAÇÃO
   * processual), pesquisa jurisprudência na base (RAG na última fala) e
   * responde com estratégia/peça no modelo do escritório. Multi-turno.
   */
  conversar: protectedProcedure
    .input(z.object({
      contatoId: z.number().optional(),
      processoId: z.number().optional(),
      mensagens: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      })).min(1).max(40),
      modelo: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritório não encontrado." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const modelo = input.modelo || "gpt-4o-mini";

      // 1. Dossiê + movimentação processual (dados reais do caso).
      const dossie = input.contatoId
        ? await montarDossie(db, esc.escritorio.id, input.contatoId, input.processoId)
        : null;
      const movimentacao = dossie?.cnj ? await montarMovimentacao(db, esc.escritorio.id, dossie.cnj) : "";

      // 1b. Conteúdo dos documentos do cliente (texto/Vision, com cache) — pra o
      // agente LER os documentos na conversa, não só saber que existem.
      const docsCtx = input.contatoId
        ? await garantirConteudoDocs(db, esc.escritorio.id, input.contatoId, modelo)
        : { texto: "" };

      // 2. Jurisprudência: RAG na última fala do usuário (+ resumo do processo).
      const ultimaUser = [...input.mensagens].reverse().find((m) => m.role === "user")?.content || "";
      let jurisprudencia: Array<{ identificador: string; titulo: string | null; texto: string }> = [];
      const key = await resolverChaveOpenAI(esc.escritorio.id);
      if (key && ultimaUser) {
        try {
          const emb = await gerarEmbedding([ultimaUser, dossie?.processo].filter(Boolean).join("\n"), key);
          const fontes = await recuperarFontes(db, emb, { escritorioId: esc.escritorio.id, topK: 6 });
          jurisprudencia = fontes.map((f) => ({ identificador: f.identificador, titulo: f.titulo, texto: f.texto }));
        } catch { /* sem jurisprudência não impede a conversa */ }
      }

      // 3. Timbre do escritório + advogado (assinatura).
      const [escRow] = await db
        .select({ nome: escritorios.nome, endereco: escritorios.endereco, cnpj: escritorios.cnpj, oab: escritorios.oab, telefone: escritorios.telefone, email: escritorios.email, instrucoes: escritorios.instrucoesAgenteJuridico })
        .from(escritorios)
        .where(eq(escritorios.id, esc.escritorio.id))
        .limit(1);

      const system = montarSystemPromptAgente({
        escritorio: escRow ?? { nome: esc.escritorio.nome },
        advogado: (ctx.user as any)?.name ?? null,
        oab: escRow?.oab ?? null,
        instrucoes: escRow?.instrucoes ?? null,
        dossie: dossie ?? undefined,
        movimentacao,
        documentos: docsCtx.texto || undefined,
        jurisprudencia,
      });

      const r = await conversarLLMEscritorio(esc.escritorio.id, { system, mensagens: input.mensagens, modelo });
      return {
        resposta: r.texto,
        erro: r.texto ? null : (r.erro || "A IA não respondeu. Tente de novo ou troque o modelo."),
        contexto: {
          andamentos: movimentacao ? movimentacao.split("\n").filter(Boolean).length : 0,
          precedentes: jurisprudencia.length,
          documentos: (docsCtx as { lidos?: number }).lidos ?? 0,
          temDossie: !!dossie?.qualificacao,
          temProcesso: !!dossie?.processo,
        },
      };
    }),

  gerarPeca: protectedProcedure
    .input(z.object({
      fatos: z.string().min(10).max(8000),
      tipo: z.string().max(80),
      teses: z.array(z.string().max(300)).max(20).optional(),
      resumoAvaliacao: z.string().max(2000).optional(),
      modelo: z.string().max(64).optional(),
      topK: z.number().int().min(1).max(20).optional(),
      // Dossiê real: quando informado, a peça é fundamentada nos dados do
      // cliente/processo (qualificação, CNJ, valor, anotações) em vez de genérica.
      contatoId: z.number().optional(),
      processoId: z.number().optional(),
      // Documentos do cliente a LER (id de cliente_arquivos) — texto/Vision entra
      // como fato na peça.
      documentoIds: z.array(z.number()).max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritório não encontrado." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const tipo = TIPOS_PECA[input.tipo];
      if (!tipo) throw new TRPCError({ code: "BAD_REQUEST", message: "Tipo de peça inválido." });

      const modelo = input.modelo || "gpt-4o-mini";

      // Dossiê real do cliente/processo (qualificação, processo, anotações).
      const dossie = input.contatoId
        ? await montarDossie(db, esc.escritorio.id, input.contatoId, input.processoId)
        : null;
      const fatosCompleto = dossie?.fatosContexto
        ? `${input.fatos}\n\n${dossie.fatosContexto}`
        : input.fatos;

      // Leitura dos documentos selecionados (extração/Vision, modelo do escritório).
      let docsTexto = "";
      if (input.contatoId && input.documentoIds?.length) {
        const r = await montarConteudoDocumentos(db, esc.escritorio.id, input.contatoId, input.documentoIds, modelo);
        docsTexto = r.texto;
      }
      const key = await resolverChaveOpenAI(esc.escritorio.id);
      if (!key) {
        return { disponivel: false, motivo: "Sem chave OpenAI pra recuperar as fontes (embeddings). Configure em Integrações.", texto: null, fontes: [] as Awaited<ReturnType<typeof recuperarFontes>>, verificacao: null };
      }
      const consulta = [input.fatos, dossie?.fatosContexto, ...(input.teses ?? [])].filter(Boolean).join("\n");
      let queryEmb: number[];
      try {
        queryEmb = await gerarEmbedding(consulta, key);
      } catch (e: any) {
        return { disponivel: false, motivo: e?.message || "Falha nos embeddings.", texto: null, fontes: [] as Awaited<ReturnType<typeof recuperarFontes>>, verificacao: null };
      }

      const fontes = await recuperarFontes(db, queryEmb, { area: tipo.area, escritorioId: esc.escritorio.id, topK: input.topK ?? 10 });
      const fontesCtx: FonteContexto[] = fontes.map((f) => ({ identificador: f.identificador, titulo: f.titulo, texto: f.texto }));

      let llmErro: string | undefined;
      const chamar = async (system: string, user: string): Promise<string | null> => {
        const r = await chamarLLMEscritorio(esc.escritorio.id, { system, user, modelo, maxTokens: 4000 });
        if (!r.texto && r.erro) llmErro = r.erro;
        return r.texto;
      };
      const { texto, verificacao, erro } = await gerarPeca(
        {
          fatos: fatosCompleto,
          teses: input.teses,
          resumoAvaliacao: input.resumoAvaliacao,
          qualificacao: dossie?.qualificacao,
          processo: dossie?.processo,
          documentos: docsTexto || undefined,
        },
        fontesCtx, tipo, chamar,
      );
      if (!texto) {
        return { disponivel: false, motivo: llmErro || erro || "Falha ao redigir.", texto: null, fontes, verificacao: null };
      }
      return { disponivel: true, motivo: null as string | null, texto, fontes, verificacao };
    }),

  /** Exporta o texto (peça, já editado) em .docx pra download. */
  exportarPecaDocx: protectedProcedure
    .input(z.object({ texto: z.string().min(1).max(60000), nomeArquivo: z.string().max(120).optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritório não encontrado." });
      const buffer = montarPecaDocx(input.texto);
      const slug = (input.nomeArquivo || "peca")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "peca";
      return {
        filename: `${slug}.docx`,
        base64: buffer.toString("base64"),
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }),

  /** [admin] Semeia a base revisional (global) e indexa os embeddings. */
  seedBaseRevisional: adminProcedure.mutation(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const seed = await seedFontesRevisional(db);
    let indexadas = 0;
    // escritorioId ?? 0 → cai na chave da plataforma (admin) quando o admin
    // do sistema não é dono de escritório.
    const key = await resolverChaveOpenAI(esc?.escritorio.id ?? 0);
    if (key) {
      const r = await reindexarEmbeddings(db, key, { escritorioId: null, area: AREA_REVISIONAL });
      indexadas = r.indexadas;
    }
    return { ...seed, indexadas, indexou: !!key };
  }),

  /** [admin] Reindexa fontes globais ainda sem embedding. */
  reindexar: adminProcedure
    .input(z.object({ area: z.string().max(80).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const key = await resolverChaveOpenAI(esc?.escritorio.id ?? 0);
      if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sem chave OpenAI pra indexar (configure a chave da plataforma ou do escritório)." });
      return reindexarEmbeddings(db, key, { escritorioId: null, area: input?.area });
    }),

  /** [admin] Estado da base GLOBAL (independe de escritório) — pro painel. */
  statusBaseGlobal: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, indexadas: 0, porTipo: {} as Record<string, number> };
    const rows = await db
      .select({ tipo: fontesJuridicas.tipo, temEmb: sql<number>`CASE WHEN ${fontesJuridicas.embedding} IS NULL THEN 0 ELSE 1 END` })
      .from(fontesJuridicas)
      .where(isNull(fontesJuridicas.escritorioId));
    const porTipo: Record<string, number> = {};
    let indexadas = 0;
    for (const r of rows) {
      porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;
      if (Number(r.temEmb) === 1) indexadas++;
    }
    return { total: rows.length, indexadas, porTipo };
  }),

  /**
   * [admin] Sobe uma DECISÃO/jurisprudência pra base GLOBAL: lê o arquivo
   * (extração ou Vision), fatia em trechos, embedda cada um e insere como fonte
   * global (escritorioId NULL) — amplia o conhecimento do Agente pra todos os
   * escritórios. É o "subir decisão" (vs. só sincronizar a base fixa).
   */
  subirDecisao: adminProcedure
    .input(z.object({
      identificador: z.string().min(2).max(160),
      titulo: z.string().max(255).optional(),
      area: z.string().max(80).optional(),
      tipo: z.enum(["sumula", "lei", "precedente", "tese"]).optional(),
      // Decisão por ARQUIVO (PDF/DOCX/imagem), LINK (súmula/jurisprudência) ou TEXTO.
      base64: z.string().optional(),
      nomeArquivo: z.string().max(200).optional(),
      link: z.string().url().max(1000).optional(),
      texto: z.string().max(20000).optional(),
      modelo: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const key = await resolverChaveOpenAI(esc?.escritorio.id ?? 0);
      if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sem chave OpenAI pra indexar (configure a chave da plataforma ou do escritório)." });

      const modelo = input.modelo || "claude-sonnet-4-20250514"; // Claude lê PDF nativo (escaneado)
      const leitura = await resolverConteudoFonte(esc?.escritorio.id ?? 0, {
        texto: input.texto, link: input.link, arquivoBase64: input.base64, nomeArquivo: input.nomeArquivo, modelo,
      });
      if (!leitura.texto) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Não foi possível ler: ${leitura.nota || "informe arquivo, link ou texto"}` });
      }
      const r = await inserirFonteComChunks(db, key, {
        escritorioId: null, // global — vale pra todos os escritórios
        tipo: input.tipo || "precedente",
        identificador: input.identificador,
        area: input.area || AREA_REVISIONAL,
        titulo: input.titulo,
        texto: leitura.texto,
      });
      return { trechos: r.trechos, indexadas: r.indexadas, via: leitura.via };
    }),
});
