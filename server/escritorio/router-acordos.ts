/**
 * Router — Acordos (tratativas de quitação e negociação com a parte contrária).
 *
 * Visão GLOBAL do escritório: `listar` NÃO exige contatoId (ao contrário de
 * clienteProcessos), justamente pra resolver a dor de abrir cliente por cliente.
 * Gate reusa a permissão de "clientes" (acordo é vinculado a cliente);
 * `verProprios` filtra pelos acordos onde o colaborador é responsável.
 * Valores trafegam em CENTAVOS (int).
 *
 * O caso normal do setor é QUITAÇÃO: o cliente deve 100 mil e quer quitar por
 * 10. Então `valorInicial` é a dívida de origem, `valorPretendido` é o número
 * BAIXO que se quer pagar, `valorDisponivel` é o teto que o cliente aguenta, e
 * `valorProposta` é o que a outra parte aceita receber hoje.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  acordos,
  acordoTratativas,
  asaasCobrancas,
  contatos,
  clienteProcessos,
  colaboradores,
  tarefas,
  users,
} from "../../drizzle/schema";
import { eq, and, or, desc, inArray, like, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { checkPermission } from "./check-permission";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { toIsoString } from "../_core/dates";
import { escapeLikePattern } from "../_core/sql-helpers";
import {
  DIAS_PARADO_ALERTA,
  estaParado,
  vezDeQuem,
  type VezDe,
} from "../../shared/acordos";
import {
  dataHojeBR,
  FUSO_HORARIO_PADRAO,
  inicioDoDiaNoFuso,
  resolverPeriodoNoFuso,
} from "../../shared/escritorio-types";

const STATUS = ["negociando", "proposta_enviada", "fechado", "cancelado"] as const;
const ABERTOS = ["negociando", "proposta_enviada"] as const;

type ResumoTratativa = { ultimaEm: string | null; vez: VezDe };

/**
 * Última movimentação e de quem é a vez, por acordo.
 *
 * Vem em consulta separada porque `vezDeQuem` precisa ANDAR pela lista: uma
 * nota não transfere a obrigação de responder, então a resposta pode estar duas
 * ou três tratativas atrás. Um `MAX(createdAt)` devolveria a data certa e o
 * autor errado.
 */
async function resumirTratativas(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  acordoIds: number[],
): Promise<Map<number, ResumoTratativa>> {
  const out = new Map<number, ResumoTratativa>();
  if (acordoIds.length === 0) return out;

  const linhas = await db
    .select({
      acordoId: acordoTratativas.acordoId,
      tipo: acordoTratativas.tipo,
      autorUserId: acordoTratativas.autorUserId,
      createdAt: acordoTratativas.createdAt,
    })
    .from(acordoTratativas)
    .where(inArray(acordoTratativas.acordoId, acordoIds))
    .orderBy(acordoTratativas.acordoId, desc(acordoTratativas.createdAt));

  // Ordenadas da mais nova pra mais velha dentro de cada acordo: a primeira dá
  // a data, e daí se caminha pra trás até achar quem realmente move a bola.
  const porAcordo = new Map<number, typeof linhas>();
  for (const l of linhas) {
    const lista = porAcordo.get(l.acordoId) ?? [];
    lista.push(l);
    porAcordo.set(l.acordoId, lista);
  }

  for (const [acordoId, lista] of porAcordo) {
    let vez: VezDe = null;
    for (let i = lista.length - 1; i >= 0; i--) {
      const t = lista[i]!;
      vez = vezDeQuem(t.tipo, t.autorUserId == null, vez);
    }
    out.set(acordoId, { ultimaEm: toIsoString(lista[0]!.createdAt), vez });
  }
  return out;
}

/** Colaboradorid do responsável a partir de um userId (opcional). */
async function colaboradorDoUser(
  db: any,
  escritorioId: number,
  responsavelUserId: number | null | undefined,
): Promise<number | null> {
  if (!responsavelUserId) return null;
  const [c] = await db
    .select({ id: colaboradores.id })
    .from(colaboradores)
    .where(and(eq(colaboradores.escritorioId, escritorioId), eq(colaboradores.userId, responsavelUserId)))
    .limit(1);
  return c?.id ?? null;
}

/** Carrega o acordo garantindo escritório e responsável, ou lança. */
async function acordoEditavel(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  perm: { escritorioId: number; verTodos: boolean; colaboradorId: number },
  acordoId: number,
  exigirAberto = true,
) {
  const [a] = await db
    .select()
    .from(acordos)
    .where(and(eq(acordos.id, acordoId), eq(acordos.escritorioId, perm.escritorioId)))
    .limit(1);
  if (!a) throw new TRPCError({ code: "NOT_FOUND" });
  if (!perm.verTodos && a.responsavelId !== perm.colaboradorId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acordo de outro responsável." });
  }
  if (exigirAberto && (a.status === "fechado" || a.status === "cancelado")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Acordo encerrado." });
  }
  return a;
}

export const acordosRouter = router({
  /**
   * Lista de acordos do escritório, já com o que a tela precisa pra priorizar:
   * há quantos dias parou e de quem é a vez.
   *
   * Filtro e busca vão pro BANCO. Filtrar no navegador só funciona enquanto a
   * lista inteira couber na memória — e ela vinha sem limite nenhum, então o
   * problema chegava junto com o crescimento do escritório.
   */
  listar: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(STATUS).optional(),
          /** Atalho pros três grupos que a tela oferece como abas. */
          grupo: z.enum(["abertos", "fechados", "cancelados"]).optional(),
          responsavelId: z.number().int().positive().optional(),
          busca: z.string().max(120).optional(),
          /** Só o que passou do corte de dias sem movimento. */
          apenasParados: z.boolean().optional(),
          limite: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const vazio = { itens: [], total: 0, temMais: false };
      const perm = await checkPermission(ctx.user.id, "clientes", "ver");
      if (!perm.allowed) return vazio;
      const db = await getDb();
      if (!db) return vazio;

      const limite = input?.limite ?? 50;
      const offset = input?.offset ?? 0;

      const conds = [eq(acordos.escritorioId, perm.escritorioId)];
      if (input?.status) conds.push(eq(acordos.status, input.status));
      if (input?.grupo === "abertos") conds.push(inArray(acordos.status, [...ABERTOS]));
      if (input?.grupo === "fechados") conds.push(eq(acordos.status, "fechado"));
      if (input?.grupo === "cancelados") conds.push(eq(acordos.status, "cancelado"));
      if (input?.responsavelId) conds.push(eq(acordos.responsavelId, input.responsavelId));
      if (!perm.verTodos) conds.push(eq(acordos.responsavelId, perm.colaboradorId));

      const termo = input?.busca?.trim();
      if (termo) {
        const padrao = `%${escapeLikePattern(termo)}%`;
        conds.push(or(like(contatos.nome, padrao), like(acordos.parteContraria, padrao))!);
      }

      const [{ total }] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(acordos)
        .innerJoin(contatos, eq(contatos.id, acordos.contatoId))
        .where(and(...conds));

      const rows = await db
        .select({
          id: acordos.id,
          contatoId: acordos.contatoId,
          clienteNome: contatos.nome,
          processoId: acordos.processoId,
          processoApelido: clienteProcessos.apelido,
          processoNumeroCnj: clienteProcessos.numeroCnj,
          parteContraria: acordos.parteContraria,
          contatoContrarioNome: acordos.contatoContrarioNome,
          contatoContrarioTelefone: acordos.contatoContrarioTelefone,
          responsavelId: acordos.responsavelId,
          responsavelNome: users.name,
          valorProposta: acordos.valorProposta,
          valorInicial: acordos.valorInicial,
          valorPretendido: acordos.valorPretendido,
          valorDisponivel: acordos.valorDisponivel,
          valorFechado: acordos.valorFechado,
          status: acordos.status,
          motivoCancelamento: acordos.motivoCancelamento,
          fechadoEm: acordos.fechadoEm,
          cobrancaId: acordos.cobrancaId,
          proximoPassoEm: acordos.proximoPassoEm,
          tarefaRetornoId: acordos.tarefaRetornoId,
          tarefaRetornoStatus: tarefas.status,
          createdAt: acordos.createdAt,
          updatedAt: acordos.updatedAt,
        })
        .from(acordos)
        .innerJoin(contatos, eq(contatos.id, acordos.contatoId))
        .leftJoin(clienteProcessos, eq(clienteProcessos.id, acordos.processoId))
        .leftJoin(colaboradores, eq(colaboradores.id, acordos.responsavelId))
        .leftJoin(users, eq(users.id, colaboradores.userId))
        .leftJoin(tarefas, eq(tarefas.id, acordos.tarefaRetornoId))
        .where(and(...conds))
        .orderBy(desc(acordos.updatedAt))
        .limit(limite)
        .offset(offset);

      const resumoTrat = await resumirTratativas(db, rows.map((r) => r.id));

      const itens = rows.map((r) => {
        const t = resumoTrat.get(r.id);
        // Acordo recém-criado sem tratativa nenhuma ainda usa a criação como
        // referência — senão nasceria "sem movimento" e entraria no alerta.
        const ultimaEm = t?.ultimaEm ?? toIsoString(r.createdAt);
        const aberto = r.status === "negociando" || r.status === "proposta_enviada";
        const retornoPendente =
          r.tarefaRetornoStatus === "pendente" || r.tarefaRetornoStatus === "em_andamento";
        return {
          ...r,
          responsavelNome: r.responsavelNome ?? null,
          ultimaMovimentacaoEm: ultimaEm,
          vezDe: aberto ? (t?.vez ?? null) : null,
          parado: aberto && estaParado(ultimaEm),
          proximoPassoEm: retornoPendente ? toIsoString(r.proximoPassoEm) : null,
          fechadoEm: toIsoString(r.fechadoEm),
          createdAt: toIsoString(r.createdAt) ?? "",
          updatedAt: toIsoString(r.updatedAt) ?? "",
        };
      });

      // Parados primeiro dentro da página: quem não movimenta há 31 dias é o
      // que precisa de ação, e ordenar por "mais recente" enterra justamente
      // esse no fim da lista.
      const ordenados = [...itens].sort(
        (a, b) =>
          Number(b.parado) - Number(a.parado) ||
          (a.ultimaMovimentacaoEm ?? "").localeCompare(b.ultimaMovimentacaoEm ?? ""),
      );
      const filtrados = input?.apenasParados ? ordenados.filter((i) => i.parado) : ordenados;

      return {
        itens: filtrados,
        total: Number(total ?? 0),
        temMais: offset + rows.length < Number(total ?? 0),
      };
    }),

  /**
   * Números do topo. Separa o que é DO PERÍODO do que é de todos os tempos —
   * misturar os dois lado a lado é o que fazia "taxa de fechamento" (histórica)
   * parecer a taxa do mês exibido ao lado dela.
   */
  resumo: protectedProcedure.query(async ({ ctx }) => {
    const zero = {
      emNegociacao: 0,
      valorEmNegociacao: 0,
      fechadosMes: 0,
      valorFechadoMes: 0,
      taxaFechamentoMes: null as number | null,
      descontoMedioMes: null as number | null,
      parados: 0,
      esperandoNos: 0,
      esperandoEles: 0,
      fechadosSemCobranca: 0,
      periodo: { dataInicio: "", dataFim: "" },
    };

    const perm = await checkPermission(ctx.user.id, "clientes", "ver");
    if (!perm.allowed) return zero;
    const db = await getDb();
    if (!db) return zero;
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return zero;

    const fuso = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
    const periodo = resolverPeriodoNoFuso(new Date(), fuso);

    const base = [eq(acordos.escritorioId, perm.escritorioId)];
    if (!perm.verTodos) base.push(eq(acordos.responsavelId, perm.colaboradorId));

    const rows = await db
      .select({
        id: acordos.id,
        status: acordos.status,
        valorProposta: acordos.valorProposta,
        valorInicial: acordos.valorInicial,
        valorFechado: acordos.valorFechado,
        fechadoEm: acordos.fechadoEm,
        cobrancaId: acordos.cobrancaId,
      })
      .from(acordos)
      .where(and(...base));

    const abertos = rows.filter((r) => r.status === "negociando" || r.status === "proposta_enviada");
    const resumoTrat = await resumirTratativas(db, abertos.map((r) => r.id));

    let valorEmNegociacao = 0;
    let parados = 0;
    let esperandoNos = 0;
    let esperandoEles = 0;
    for (const r of abertos) {
      valorEmNegociacao += Number(r.valorProposta || 0);
      const t = resumoTrat.get(r.id);
      if (estaParado(t?.ultimaEm)) parados += 1;
      if (t?.vez === "nos") esperandoNos += 1;
      if (t?.vez === "eles") esperandoEles += 1;
    }

    // Recorte do mês pelo `fechadoEm`, não pelo `updatedAt`: o segundo muda em
    // qualquer escrita na linha e traria um acordo de janeiro pro mês em que
    // alguém corrigiu um telefone.
    const inicioMs = periodo.dataInicio.getTime();
    const fimMs = periodo.dataFim.getTime();
    const noMes = (d: Date | null) => {
      if (!d) return false;
      const ms = d instanceof Date ? d.getTime() : new Date(d).getTime();
      return ms >= inicioMs && ms <= fimMs;
    };

    let fechadosMes = 0;
    let valorFechadoMes = 0;
    let canceladosMes = 0;
    let somaDesconto = 0;
    let comDesconto = 0;
    let fechadosSemCobranca = 0;

    for (const r of rows) {
      if (r.status === "fechado") {
        if (r.cobrancaId == null) fechadosSemCobranca += 1;
        if (noMes(r.fechadoEm as Date | null)) {
          fechadosMes += 1;
          const valor = Number(r.valorFechado ?? r.valorProposta ?? 0);
          valorFechadoMes += valor;
          const origem = Number(r.valorInicial ?? 0);
          if (origem > 0) {
            somaDesconto += ((origem - valor) / origem) * 100;
            comDesconto += 1;
          }
        }
      }
      // Cancelado não tem data própria; `updatedAt` é a melhor aproximação e o
      // erro aqui só afeta o denominador da taxa, não um valor exibido.
      if (r.status === "cancelado" && noMes(null)) canceladosMes += 1;
    }

    const encerradosMes = fechadosMes + canceladosMes;
    return {
      emNegociacao: abertos.length,
      valorEmNegociacao,
      fechadosMes,
      valorFechadoMes,
      taxaFechamentoMes: encerradosMes > 0 ? Math.round((fechadosMes / encerradosMes) * 100) : null,
      descontoMedioMes: comDesconto > 0 ? +(somaDesconto / comDesconto).toFixed(1) : null,
      parados,
      esperandoNos,
      esperandoEles,
      fechadosSemCobranca,
      diasParadoAlerta: DIAS_PARADO_ALERTA,
      periodo: { dataInicio: periodo.dataInicioStr, dataFim: periodo.dataFimStr },
    };
  }),

  /** Detalhe do acordo + histórico de tratativas. */
  obter: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "ver");
      if (!perm.allowed) return null;
      const db = await getDb();
      if (!db) return null;

      const [a] = await db
        .select({
          id: acordos.id,
          contatoId: acordos.contatoId,
          clienteNome: contatos.nome,
          processoId: acordos.processoId,
          processoApelido: clienteProcessos.apelido,
          processoNumeroCnj: clienteProcessos.numeroCnj,
          parteContraria: acordos.parteContraria,
          contatoContrarioNome: acordos.contatoContrarioNome,
          contatoContrarioTelefone: acordos.contatoContrarioTelefone,
          responsavelId: acordos.responsavelId,
          responsavelNome: users.name,
          valorProposta: acordos.valorProposta,
          valorInicial: acordos.valorInicial,
          valorPretendido: acordos.valorPretendido,
          valorDisponivel: acordos.valorDisponivel,
          valorFechado: acordos.valorFechado,
          status: acordos.status,
          motivoCancelamento: acordos.motivoCancelamento,
          fechadoEm: acordos.fechadoEm,
          cobrancaId: acordos.cobrancaId,
          proximoPassoEm: acordos.proximoPassoEm,
          tarefaRetornoId: acordos.tarefaRetornoId,
          tarefaRetornoStatus: tarefas.status,
          createdAt: acordos.createdAt,
          updatedAt: acordos.updatedAt,
        })
        .from(acordos)
        .innerJoin(contatos, eq(contatos.id, acordos.contatoId))
        .leftJoin(clienteProcessos, eq(clienteProcessos.id, acordos.processoId))
        .leftJoin(colaboradores, eq(colaboradores.id, acordos.responsavelId))
        .leftJoin(users, eq(users.id, colaboradores.userId))
        .leftJoin(tarefas, eq(tarefas.id, acordos.tarefaRetornoId))
        .where(and(eq(acordos.id, input.id), eq(acordos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!a) return null;
      if (!perm.verTodos && a.responsavelId !== perm.colaboradorId) return null;

      const trats = await db
        .select({
          id: acordoTratativas.id,
          tipo: acordoTratativas.tipo,
          valor: acordoTratativas.valor,
          conteudo: acordoTratativas.conteudo,
          createdAt: acordoTratativas.createdAt,
          autorUserId: acordoTratativas.autorUserId,
          autorLabel: acordoTratativas.autorLabel,
          autorNome: users.name,
        })
        .from(acordoTratativas)
        .leftJoin(users, eq(users.id, acordoTratativas.autorUserId))
        .where(eq(acordoTratativas.acordoId, input.id))
        .orderBy(desc(acordoTratativas.createdAt));

      const resumoTrat = await resumirTratativas(db, [a.id]);
      const t = resumoTrat.get(a.id);
      const ultimaEm = t?.ultimaEm ?? toIsoString(a.createdAt);
      const aberto = a.status === "negociando" || a.status === "proposta_enviada";
      const retornoPendente =
        a.tarefaRetornoStatus === "pendente" || a.tarefaRetornoStatus === "em_andamento";

      return {
        ...a,
        ultimaMovimentacaoEm: ultimaEm,
        vezDe: aberto ? (t?.vez ?? null) : null,
        parado: aberto && estaParado(ultimaEm),
        proximoPassoEm: retornoPendente ? toIsoString(a.proximoPassoEm) : null,
        fechadoEm: toIsoString(a.fechadoEm),
        createdAt: toIsoString(a.createdAt) ?? "",
        updatedAt: toIsoString(a.updatedAt) ?? "",
        tratativas: trats.map((t) => ({
          ...t,
          daParteContraria: t.autorUserId == null,
          autor: t.autorNome ?? t.autorLabel ?? "—",
          createdAt: toIsoString(t.createdAt) ?? "",
        })),
      };
    }),

  /** Cria um acordo (registra a proposta inicial como 1ª tratativa). */
  criar: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      processoId: z.number().optional(),
      parteContraria: z.string().min(1).max(255),
      contatoContrarioNome: z.string().max(255).optional(),
      contatoContrarioTelefone: z.string().max(20).optional(),
      responsavelUserId: z.number().optional(),
      /** Marcos (centavos). Numa quitação: inicial = dívida, pretendido = o que
       *  se quer pagar, disponível = teto que o cliente aguenta. */
      valorInicial: z.number().int().min(0),
      valorPretendido: z.number().int().min(0),
      valorDisponivel: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "criar");
      if (!perm.criar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para criar acordos." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cli] = await db
        .select({ id: contatos.id })
        .from(contatos)
        .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!cli) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });

      if (input.processoId) {
        const [p] = await db
          .select({ id: clienteProcessos.id })
          .from(clienteProcessos)
          .where(and(
            eq(clienteProcessos.id, input.processoId),
            eq(clienteProcessos.escritorioId, perm.escritorioId),
            eq(clienteProcessos.contatoId, input.contatoId),
          ))
          .limit(1);
        if (!p) throw new TRPCError({ code: "BAD_REQUEST", message: "Processo inválido para este cliente." });
      }

      const responsavelId =
        (await colaboradorDoUser(db, perm.escritorioId, input.responsavelUserId)) ?? perm.colaboradorId;

      const [res] = await db.insert(acordos).values({
        escritorioId: perm.escritorioId,
        contatoId: input.contatoId,
        processoId: input.processoId ?? null,
        parteContraria: input.parteContraria,
        contatoContrarioNome: input.contatoContrarioNome ?? null,
        contatoContrarioTelefone: input.contatoContrarioTelefone ?? null,
        responsavelId,
        valorProposta: input.valorInicial,
        valorInicial: input.valorInicial,
        valorPretendido: input.valorPretendido,
        valorDisponivel: input.valorDisponivel,
        status: "negociando",
        criadoPor: ctx.user.id,
      });
      const id = (res as { insertId: number }).insertId;

      await db.insert(acordoTratativas).values({
        acordoId: id,
        autorUserId: ctx.user.id,
        tipo: "proposta",
        valor: input.valorInicial,
        conteudo: "Acordo aberto com o valor de origem registrado",
      });
      return { id };
    }),

  /**
   * Edita partes/contato/responsável/processo e os três marcos de um acordo em
   * aberto. O cliente vinculado é imutável (definido na criação). Não altera a
   * proposta atual (essa só muda ao registrar tratativa/fechar).
   */
  editar: protectedProcedure
    .input(z.object({
      id: z.number(),
      parteContraria: z.string().min(1).max(255),
      contatoContrarioNome: z.string().max(255).optional(),
      contatoContrarioTelefone: z.string().max(20).optional(),
      responsavelUserId: z.number().nullable().optional(),
      processoId: z.number().nullable().optional(),
      valorInicial: z.number().int().min(0),
      valorPretendido: z.number().int().min(0),
      valorDisponivel: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar acordos." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const a = await acordoEditavel(db, perm, input.id);

      if (input.processoId != null) {
        const [p] = await db
          .select({ id: clienteProcessos.id })
          .from(clienteProcessos)
          .where(and(
            eq(clienteProcessos.id, input.processoId),
            eq(clienteProcessos.escritorioId, perm.escritorioId),
            eq(clienteProcessos.contatoId, a.contatoId),
          ))
          .limit(1);
        if (!p) throw new TRPCError({ code: "BAD_REQUEST", message: "Processo inválido para este cliente." });
      }

      const responsavelId =
        input.responsavelUserId !== undefined
          ? (await colaboradorDoUser(db, perm.escritorioId, input.responsavelUserId)) ?? a.responsavelId
          : a.responsavelId;

      await db.update(acordos)
        .set({
          parteContraria: input.parteContraria,
          contatoContrarioNome: input.contatoContrarioNome ?? null,
          contatoContrarioTelefone: input.contatoContrarioTelefone ?? null,
          responsavelId,
          processoId: input.processoId ?? null,
          valorInicial: input.valorInicial,
          valorPretendido: input.valorPretendido,
          valorDisponivel: input.valorDisponivel,
        })
        .where(eq(acordos.id, input.id));
      return { ok: true };
    }),

  /**
   * Registra uma tratativa (proposta/contraproposta/nota). Atualiza o valor
   * corrente do acordo quando a tratativa traz valor, e move o status para
   * "proposta_enviada" numa proposta nossa (se ainda negociando).
   */
  registrarTratativa: protectedProcedure
    .input(z.object({
      acordoId: z.number(),
      tipo: z.enum(["proposta", "contraproposta", "nota"]),
      valor: z.number().int().min(0).optional(),
      conteudo: z.string().min(1).max(2000),
      /** true = tratativa veio da parte contrária (autor livre, não conta como nosso). */
      daParteContraria: z.boolean().optional(),
      autorLabel: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const a = await acordoEditavel(db, perm, input.acordoId);

      await db.insert(acordoTratativas).values({
        acordoId: input.acordoId,
        autorUserId: input.daParteContraria ? null : ctx.user.id,
        autorLabel: input.daParteContraria ? (input.autorLabel || a.contatoContrarioNome || "Parte contrária") : null,
        tipo: input.tipo,
        valor: input.valor ?? null,
        conteudo: input.conteudo,
      });

      const set: Record<string, unknown> = {};
      if (input.valor != null) set.valorProposta = input.valor;
      if (input.tipo === "proposta" && !input.daParteContraria && a.status === "negociando") {
        set.status = "proposta_enviada";
      }
      // Movimentou: o retorno agendado cumpriu o papel dele e sai do caminho.
      if (a.tarefaRetornoId != null) {
        set.proximoPassoEm = null;
        set.tarefaRetornoId = null;
      }
      if (Object.keys(set).length > 0) {
        await db.update(acordos).set(set).where(eq(acordos.id, input.acordoId));
      }
      return { ok: true };
    }),

  /**
   * Agenda o próximo passo criando uma TAREFA de verdade.
   *
   * A tarefa é a fonte de verdade — tem responsável, prazo, entra na agenda de
   * hoje e no ranking do painel Operacional. A data no acordo é só cache de
   * exibição, e some sozinha quando a tarefa é concluída ou a negociação anda.
   */
  agendarRetorno: protectedProcedure
    .input(z.object({
      acordoId: z.number(),
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      titulo: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });

      const a = await acordoEditavel(db, perm, input.acordoId);

      const fuso = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
      const hoje = dataHojeBR(fuso);
      if (input.data < hoje) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A data do retorno já passou." });
      }
      const vencimento = inicioDoDiaNoFuso(input.data, fuso);

      const [res] = await db.insert(tarefas).values({
        escritorioId: perm.escritorioId,
        contatoId: a.contatoId,
        processoId: a.processoId ?? null,
        responsavelId: a.responsavelId ?? perm.colaboradorId,
        criadoPor: perm.colaboradorId,
        titulo: input.titulo?.trim() || `Retomar acordo com ${a.parteContraria}`,
        descricao: `Retorno da negociação registrada no acordo #${a.id}.`,
        status: "pendente",
        prioridade: "normal",
        dataVencimento: vencimento,
      });
      const tarefaId = (res as { insertId: number }).insertId;

      await db.update(acordos)
        .set({ proximoPassoEm: vencimento, tarefaRetornoId: tarefaId })
        .where(eq(acordos.id, input.acordoId));

      await db.insert(acordoTratativas).values({
        acordoId: input.acordoId,
        autorUserId: ctx.user.id,
        tipo: "nota",
        conteudo: `Retorno agendado para ${input.data.split("-").reverse().join("/")}`,
      });
      return { ok: true, tarefaId };
    }),

  /** Marca o acordo como FECHADO com o valor final acordado. */
  fechar: protectedProcedure
    .input(z.object({ acordoId: z.number(), valorFechado: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await acordoEditavel(db, perm, input.acordoId);

      // Fechar NÃO gera cobrança. Boleto na mão do cliente é ação com efeito
      // fora do sistema, e efeito externo não acontece como consequência
      // silenciosa de mudar um status — quem cobra decide e clica.
      await db.update(acordos)
        .set({
          status: "fechado",
          valorFechado: input.valorFechado,
          fechadoEm: new Date(),
          proximoPassoEm: null,
          tarefaRetornoId: null,
        })
        .where(eq(acordos.id, input.acordoId));
      await db.insert(acordoTratativas).values({
        acordoId: input.acordoId,
        autorUserId: ctx.user.id,
        tipo: "fechamento",
        valor: input.valorFechado,
        conteudo: "Acordo fechado",
      });
      return { ok: true };
    }),

  /**
   * Anota qual cobrança nasceu do acordo.
   *
   * Chamada depois de `asaas.criarCobranca` — o acordo não cria cobrança por
   * conta própria, porque aquela procedure já carrega idempotência, gate de
   * permissão do Financeiro e a regra de comissão. Duplicar isso aqui seria
   * manter duas versões da mesma regra de dinheiro.
   */
  vincularCobranca: protectedProcedure
    .input(z.object({ acordoId: z.number(), asaasPaymentId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [a] = await db
        .select({ id: acordos.id, responsavelId: acordos.responsavelId })
        .from(acordos)
        .where(and(eq(acordos.id, input.acordoId), eq(acordos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      if (!perm.verTodos && a.responsavelId !== perm.colaboradorId) throw new TRPCError({ code: "FORBIDDEN" });

      const [cob] = await db
        .select({ id: asaasCobrancas.id })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, perm.escritorioId),
          eq(asaasCobrancas.asaasPaymentId, input.asaasPaymentId),
        ))
        .limit(1);
      if (!cob) throw new TRPCError({ code: "NOT_FOUND", message: "Cobrança não encontrada." });

      await db.update(acordos).set({ cobrancaId: cob.id }).where(eq(acordos.id, input.acordoId));
      await db.insert(acordoTratativas).values({
        acordoId: input.acordoId,
        autorUserId: ctx.user.id,
        tipo: "nota",
        conteudo: "Cobrança gerada a partir deste acordo",
      });
      return { ok: true, cobrancaId: cob.id };
    }),

  /** Cancela o acordo COM motivo (o "porquê" fica no registro e na lista). */
  cancelar: protectedProcedure
    .input(z.object({ acordoId: z.number(), motivo: z.string().min(1).max(512), observacao: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await acordoEditavel(db, perm, input.acordoId);

      await db.update(acordos)
        .set({
          status: "cancelado",
          motivoCancelamento: input.motivo,
          proximoPassoEm: null,
          tarefaRetornoId: null,
        })
        .where(eq(acordos.id, input.acordoId));
      await db.insert(acordoTratativas).values({
        acordoId: input.acordoId,
        autorUserId: ctx.user.id,
        tipo: "cancelamento",
        conteudo: input.observacao ? `${input.motivo} — ${input.observacao}` : input.motivo,
      });
      return { ok: true };
    }),

  /**
   * Reabre um acordo CANCELADO.
   *
   * Cancelamento era terminal e absoluto: quem clicava errado perdia o
   * histórico inteiro da negociação e só podia recomeçar do zero. Fechado
   * continua terminal de propósito — ali existe valor acordado, e possivelmente
   * cobrança emitida, então "desfazer" seria mexer em dinheiro já combinado.
   */
  reabrir: protectedProcedure
    .input(z.object({ acordoId: z.number(), motivo: z.string().max(512).optional() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const a = await acordoEditavel(db, perm, input.acordoId, false);
      if (a.status !== "cancelado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Só acordo cancelado pode ser reaberto." });
      }

      await db.update(acordos)
        .set({ status: "negociando", motivoCancelamento: null })
        .where(eq(acordos.id, input.acordoId));
      await db.insert(acordoTratativas).values({
        acordoId: input.acordoId,
        autorUserId: ctx.user.id,
        tipo: "nota",
        conteudo: input.motivo?.trim() || "Acordo reaberto",
      });
      return { ok: true };
    }),
});
