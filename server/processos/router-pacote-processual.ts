/**
 * Pacote Acompanhamento Processual (Fase 2 da modularização) — os três
 * namespaces que fazem o plano só-Processos ficar de pé sozinho:
 *
 *   - clientesEssencial: cadastro de 3 campos (nome, CPF/CNPJ, responsável)
 *     sobre a MESMA tabela `contatos` do CRM. Contratar Clientes completo
 *     depois não migra nada — só destrava funil/histórico/documentos.
 *   - prazos: a versão enxuta da Agenda sobre a MESMA tabela `agendamentos`
 *     — só prazos processuais e audiências, agrupados por dia.
 *   - painelProcessual: os números do dashboard da variante processual.
 *
 * Os três se declaram como módulo "processos" em shared/modulos-contratacao:
 * é o que faz o porteiro aceitá-los num plano sem `clientes`/`agenda`.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { checkPermission } from "../escritorio/check-permission";
import {
  agendamentos,
  clienteProcessos,
  colaboradores,
  contatos,
  eventosProcesso,
  motorMonitoramentos,
  prazosSugeridos,
  users,
} from "../../drizzle/schema";
import { classificarErroMonitor } from "./diagnostico-monitoramento";
import { contarMovimentacoesNaoLidas } from "./contador-movimentacoes";
import { parsearPartes, resumirPartes } from "./partes-processo";

const soDigitos = (v: string) => v.replace(/\D/g, "");

const safeParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Tipos de agendamento que a tela Prazos enxerga. O resto é Agenda completa. */
const TIPOS_PRAZO = ["prazo_processual", "audiencia"] as const;

interface PrazoItem {
  id: number;
  tipo: string;
  titulo: string;
  dataInicio: string;
  diaInteiro: boolean;
  prioridade: string;
  concluido: boolean;
  responsavelId: number;
  responsavelNome: string | null;
  contatoNome: string | null;
  descricao: string | null;
  /** Data do alerta de movimentação que originou o prazo. NULL = criado à mão. */
  origemAlertaEm: string | null;
}

/**
 * Consulta compartilhada entre `prazos.listar` e o painel — os dois mostram
 * a mesma lista e não podem discordar.
 */
async function listarPrazosPeriodo(args: {
  escritorioId: number;
  inicio: Date;
  fim: Date;
  /** null = todos; senão restringe ao responsável (verProprios). */
  soResponsavelId: number | null;
  limite: number;
}): Promise<PrazoItem[]> {
  const db = await getDb();
  if (!db) return [];

  const conds = [
    eq(agendamentos.escritorioId, args.escritorioId),
    inArray(agendamentos.tipo, [...TIPOS_PRAZO]),
    gte(agendamentos.dataInicio, args.inicio),
    lt(agendamentos.dataInicio, args.fim),
    sql`${agendamentos.status} <> 'cancelado'`,
  ];
  if (args.soResponsavelId != null) {
    conds.push(
      or(
        eq(agendamentos.responsavelId, args.soResponsavelId),
        eq(agendamentos.criadoPorId, args.soResponsavelId),
      )!,
    );
  }

  const rows = await db
    .select({
      ag: agendamentos,
      respUserName: users.name,
      contatoNome: contatos.nome,
      sugCriadoEm: prazosSugeridos.criadoEm,
    })
    .from(agendamentos)
    .leftJoin(colaboradores, eq(agendamentos.responsavelId, colaboradores.id))
    .leftJoin(users, eq(colaboradores.userId, users.id))
    .leftJoin(contatos, eq(agendamentos.contatoId, contatos.id))
    .leftJoin(prazosSugeridos, eq(prazosSugeridos.agendamentoId, agendamentos.id))
    .where(and(...conds))
    .orderBy(asc(agendamentos.dataInicio))
    .limit(args.limite);

  return rows.map((r) => ({
    id: r.ag.id,
    tipo: r.ag.tipo,
    titulo: r.ag.titulo,
    dataInicio: r.ag.dataInicio.toISOString(),
    diaInteiro: r.ag.diaInteiro,
    prioridade: r.ag.prioridade,
    concluido: r.ag.status === "concluido",
    responsavelId: r.ag.responsavelId,
    responsavelNome: r.respUserName,
    contatoNome: r.contatoNome,
    descricao: r.ag.descricao,
    origemAlertaEm: r.sugCriadoEm ? r.sugCriadoEm.toISOString() : null,
  }));
}

export const prazosRouter = router({
  /** Prazos e audiências do período (default: dos últimos 7 aos próximos 30 dias). */
  listar: protectedProcedure
    .input(
      z
        .object({
          inicio: z.string().datetime().optional(),
          fim: z.string().datetime().optional(),
          limite: z.number().int().min(1).max(300).default(200),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "ver");
      if (!perm.allowed) return { itens: [] };

      const agora = Date.now();
      const inicio = input?.inicio ? new Date(input.inicio) : new Date(agora - 7 * 86_400_000);
      const fim = input?.fim ? new Date(input.fim) : new Date(agora + 30 * 86_400_000);

      const itens = await listarPrazosPeriodo({
        escritorioId: perm.escritorioId,
        inicio,
        fim,
        soResponsavelId: perm.verTodos ? null : perm.colaboradorId,
        limite: input?.limite ?? 200,
      });
      return { itens };
    }),

  /** Prazo/audiência manual — o "+ Prazo manual" da tela. */
  criar: protectedProcedure
    .input(
      z.object({
        titulo: z.string().min(2).max(255),
        tipo: z.enum(TIPOS_PRAZO),
        /** ISO com hora. Pra prazo de dia inteiro, mande meia-noite + diaInteiro. */
        dataInicio: z.string().datetime(),
        diaInteiro: z.boolean().default(true),
        responsavelId: z.number().int().positive().optional(),
        descricao: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "criar");
      if (!perm.allowed || !perm.criar) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão pra criar prazos" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      let responsavelId = perm.colaboradorId;
      if (input.responsavelId) {
        const [resp] = await db
          .select({ id: colaboradores.id })
          .from(colaboradores)
          .where(and(
            eq(colaboradores.id, input.responsavelId),
            eq(colaboradores.escritorioId, perm.escritorioId),
            eq(colaboradores.ativo, true),
          ))
          .limit(1);
        if (!resp) throw new TRPCError({ code: "BAD_REQUEST", message: "Responsável não é do escritório" });
        responsavelId = resp.id;
      }

      const [res] = await db.insert(agendamentos).values({
        escritorioId: perm.escritorioId,
        criadoPorId: perm.colaboradorId,
        responsavelId,
        tipo: input.tipo,
        titulo: input.titulo,
        descricao: input.descricao ?? null,
        dataInicio: new Date(input.dataInicio),
        diaInteiro: input.diaInteiro,
        prioridade: input.tipo === "audiencia" ? "alta" : "normal",
        status: "pendente",
      });
      return { id: (res as { insertId: number }).insertId };
    }),

  /** Marca concluído (ou desfaz). O checkbox da lista. */
  concluir: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), desfazer: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "ver");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem acesso" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const conds = [
        eq(agendamentos.id, input.id),
        eq(agendamentos.escritorioId, perm.escritorioId),
      ];
      if (!perm.verTodos) {
        conds.push(
          or(
            eq(agendamentos.responsavelId, perm.colaboradorId),
            eq(agendamentos.criadoPorId, perm.colaboradorId),
          )!,
        );
      }
      await db
        .update(agendamentos)
        .set({ status: input.desfazer ? "pendente" : "concluido" })
        .where(and(...conds));
      return { ok: true };
    }),
});

export const clientesEssencialRouter = router({
  /** Lista enxuta: nome, documento, responsável e o que está vigiado. */
  listar: protectedProcedure
    .input(z.object({ busca: z.string().max(120).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "ver");
      if (!perm.allowed) return { itens: [] };
      const db = await getDb();
      if (!db) return { itens: [] };

      const conds = [eq(contatos.escritorioId, perm.escritorioId)];
      if (!perm.verTodos) conds.push(eq(contatos.responsavelId, perm.colaboradorId));
      const busca = input?.busca?.trim();
      if (busca) {
        const padrao = `%${busca}%`;
        conds.push(or(like(contatos.nome, padrao), like(contatos.cpfCnpj, padrao))!);
      }

      const rows = await db
        .select({
          id: contatos.id,
          nome: contatos.nome,
          cpfCnpj: contatos.cpfCnpj,
          responsavelId: contatos.responsavelId,
          respUserName: users.name,
          criadoEm: contatos.createdAt,
        })
        .from(contatos)
        .leftJoin(colaboradores, eq(contatos.responsavelId, colaboradores.id))
        .leftJoin(users, eq(colaboradores.userId, users.id))
        .where(and(...conds))
        .orderBy(asc(contatos.nome))
        .limit(300);

      // "Vigiado por": processos vinculados (clienteProcessos) e monitores
      // por documento (novas ações). Duas agregações baratas, casadas em JS.
      const ids = rows.map((r) => r.id);
      const processosPorContato = new Map<number, number>();
      if (ids.length > 0) {
        const procs = await db
          .select({ contatoId: clienteProcessos.contatoId, total: sql<number>`count(*)` })
          .from(clienteProcessos)
          .where(and(
            eq(clienteProcessos.escritorioId, perm.escritorioId),
            inArray(clienteProcessos.contatoId, ids),
          ))
          .groupBy(clienteProcessos.contatoId);
        for (const p of procs) processosPorContato.set(p.contatoId, Number(p.total));
      }

      const docsVigiados = new Set<string>();
      const monitores = await db
        .select({ searchKey: motorMonitoramentos.searchKey, searchType: motorMonitoramentos.searchType })
        .from(motorMonitoramentos)
        .where(and(
          eq(motorMonitoramentos.escritorioId, perm.escritorioId),
          eq(motorMonitoramentos.tipoMonitoramento, "novas_acoes"),
          eq(motorMonitoramentos.status, "ativo"),
        ));
      for (const m of monitores) {
        if (m.searchType === "cpf" || m.searchType === "cnpj") docsVigiados.add(soDigitos(m.searchKey));
      }

      return {
        itens: rows.map((r) => ({
          id: r.id,
          nome: r.nome,
          cpfCnpj: r.cpfCnpj,
          responsavelId: r.responsavelId,
          responsavelNome: r.respUserName,
          criadoEm: r.criadoEm.toISOString(),
          processosVinculados: processosPorContato.get(r.id) ?? 0,
          documentoVigiado: r.cpfCnpj ? docsVigiados.has(soDigitos(r.cpfCnpj)) : false,
        })),
      };
    }),

  /** Cadastro de 3 campos — o suficiente pra vigiar e atribuir. */
  criar: protectedProcedure
    .input(
      z.object({
        nome: z.string().min(2).max(255),
        cpfCnpj: z.string().max(18).optional(),
        responsavelId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "criar");
      if (!perm.allowed || !perm.criar) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão pra cadastrar clientes" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      let cpfCnpj: string | null = null;
      if (input.cpfCnpj?.trim()) {
        const dig = soDigitos(input.cpfCnpj);
        if (dig.length !== 11 && dig.length !== 14) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "CPF/CNPJ deve ter 11 ou 14 dígitos" });
        }
        cpfCnpj = input.cpfCnpj.trim();
      }

      let responsavelId: number | null = perm.colaboradorId;
      if (input.responsavelId) {
        const [resp] = await db
          .select({ id: colaboradores.id })
          .from(colaboradores)
          .where(and(
            eq(colaboradores.id, input.responsavelId),
            eq(colaboradores.escritorioId, perm.escritorioId),
            eq(colaboradores.ativo, true),
          ))
          .limit(1);
        if (!resp) throw new TRPCError({ code: "BAD_REQUEST", message: "Responsável não é do escritório" });
        responsavelId = resp.id;
      }

      const [res] = await db.insert(contatos).values({
        escritorioId: perm.escritorioId,
        nome: input.nome.trim(),
        cpfCnpj,
        responsavelId,
        origem: "manual",
        estagio: "cliente",
      });
      return { id: (res as { insertId: number }).insertId, cpfCnpj };
    }),

  /** Colaboradores ativos pro select de responsável. */
  responsaveis: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "clientes", "ver");
    if (!perm.allowed) return { itens: [] };
    const db = await getDb();
    if (!db) return { itens: [] };
    const rows = await db
      .select({ id: colaboradores.id, nome: users.name, cargo: colaboradores.cargo })
      .from(colaboradores)
      .leftJoin(users, eq(colaboradores.userId, users.id))
      .where(and(eq(colaboradores.escritorioId, perm.escritorioId), eq(colaboradores.ativo, true)))
      .orderBy(asc(users.name));
    return { itens: rows.map((r) => ({ id: r.id, nome: r.nome ?? `Colaborador ${r.id}`, cargo: r.cargo })) };
  }),
});

export const painelProcessualRouter = router({
  /**
   * Os números da variante processual do dashboard, numa chamada só e sem
   * nada pesado (teor/análise ficam de fora — isso é da central).
   */
  resumo: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "processos", "ver");
    if (!perm.allowed) return null;
    const db = await getDb();
    if (!db) return null;

    const escritorioId = perm.escritorioId;
    const agora = Date.now();

    const [movsAResolver, sugestoesPendentes, monitores, novasAcoes, prazosSemana] =
      await Promise.all([
        contarMovimentacoesNaoLidas(escritorioId),
        db
          .select({ total: sql<number>`count(*)` })
          .from(prazosSugeridos)
          .where(and(eq(prazosSugeridos.escritorioId, escritorioId), eq(prazosSugeridos.status, "pendente"))),
        db
          .select({ status: motorMonitoramentos.status, ultimoErro: motorMonitoramentos.ultimoErro })
          .from(motorMonitoramentos)
          .where(eq(motorMonitoramentos.escritorioId, escritorioId)),
        db
          .select({ total: sql<number>`count(*)` })
          .from(eventosProcesso)
          .where(and(
            eq(eventosProcesso.escritorioId, escritorioId),
            eq(eventosProcesso.tipo, "nova_acao"),
            eq(eventosProcesso.resolucao, "pendente"),
            eq(eventosProcesso.lido, false),
          )),
        listarPrazosPeriodo({
          escritorioId,
          inicio: new Date(agora - 86_400_000),
          fim: new Date(agora + 7 * 86_400_000),
          soResponsavelId: null,
          limite: 8,
        }),
      ]);

    // Últimas movimentações (leve): título derivado como na central, sem teor.
    const ultimas = await db
      .select({
        id: eventosProcesso.id,
        dataEvento: eventosProcesso.dataEvento,
        conteudo: eventosProcesso.conteudo,
        resumoIa: eventosProcesso.resumoIa,
        analiseJson: eventosProcesso.analiseJson,
        relevancia: eventosProcesso.relevancia,
        lido: eventosProcesso.lido,
        cnjAfetado: eventosProcesso.cnjAfetado,
        apelido: motorMonitoramentos.apelido,
        searchKey: motorMonitoramentos.searchKey,
        partesJson: motorMonitoramentos.partesJson,
      })
      .from(eventosProcesso)
      .leftJoin(motorMonitoramentos, eq(eventosProcesso.monitoramentoId, motorMonitoramentos.id))
      .where(and(eq(eventosProcesso.escritorioId, escritorioId), eq(eventosProcesso.tipo, "movimentacao")))
      .orderBy(desc(eventosProcesso.dataEvento))
      .limit(5);

    const ultimasMovimentacoes = ultimas.map((u) => {
      const analise = u.analiseJson ? (safeParse(u.analiseJson) as { titulo?: unknown } | null) : null;
      const titulo =
        (typeof analise?.titulo === "string" ? analise.titulo : null) ??
        u.resumoIa ??
        u.conteudo.slice(0, 160);
      const partes = resumirPartes(parsearPartes(u.partesJson), {
        searchKey: u.searchKey ?? "",
        apelido: u.apelido,
      });
      return {
        id: u.id,
        dataEvento: u.dataEvento.toISOString(),
        titulo,
        relevancia: u.relevancia,
        lido: u.lido,
        cliente: partes.rotulo ?? u.apelido ?? u.cnjAfetado ?? "Processo",
        cnj: u.cnjAfetado,
      };
    });

    const monitoramentosAtivos = monitores.filter((m) => m.status === "ativo").length;
    const monitoramentosParados = monitores.filter((m) => classificarErroMonitor(m.ultimoErro) != null).length;

    return {
      movimentacoesAResolver: movsAResolver,
      sugestoesPrazoPendentes: Number(sugestoesPendentes[0]?.total ?? 0),
      monitoramentosAtivos,
      monitoramentosParados,
      novasAcoesPendentes: Number(novasAcoes[0]?.total ?? 0),
      prazosSemana,
      ultimasMovimentacoes,
    };
  }),
});
