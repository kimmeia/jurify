/**
 * Funções de acesso ao banco — Agendamentos e Lembretes
 * Fase 4
 */

import { eq, and, desc, gte, lte, or, asc } from "drizzle-orm";
import { getDb } from "../db";
import { agendamentos, agendamentoLembretes, colaboradores, users } from "../../drizzle/schema";
import type { TipoAgendamento, PrioridadeAgendamento, StatusAgendamento } from "../../shared/agendamento-constants";

// ─── Agendamentos ────────────────────────────────────────────────────────────

export async function criarAgendamento(dados: {
  escritorioId: number;
  criadoPorId: number;
  responsavelId: number;
  tipo: TipoAgendamento;
  titulo: string;
  descricao?: string;
  dataInicio: string;
  dataFim?: string;
  diaInteiro?: boolean;
  local?: string;
  prioridade?: PrioridadeAgendamento;
  processoId?: number;
  corHex?: string;
  lembretes?: { tipo: string; minutosAntes: number }[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const [result] = await db.insert(agendamentos).values({
    escritorioId: dados.escritorioId,
    criadoPorId: dados.criadoPorId,
    responsavelId: dados.responsavelId,
    tipo: dados.tipo,
    titulo: dados.titulo,
    descricao: dados.descricao || null,
    dataInicio: new Date(dados.dataInicio),
    dataFim: dados.dataFim ? new Date(dados.dataFim) : null,
    diaInteiro: dados.diaInteiro ?? false,
    local: dados.local || null,
    prioridade: dados.prioridade ?? "normal",
    processoId: dados.processoId ?? null,
    corHex: dados.corHex ?? "#3b82f6",
  });

  const agendamentoId = (result as { insertId: number }).insertId;

  // Criar lembretes
  if (dados.lembretes && dados.lembretes.length > 0) {
    for (const lem of dados.lembretes) {
      await db.insert(agendamentoLembretes).values({
        agendamentoId,
        tipo: lem.tipo as any,
        minutosAntes: lem.minutosAntes,
      });
    }
  }

  return agendamentoId;
}

export async function listarAgendamentos(
  escritorioId: number,
  filtros?: {
    dataInicio?: string;
    dataFim?: string;
    responsavelId?: number;
    tipo?: TipoAgendamento;
    status?: StatusAgendamento;
  },
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(agendamentos.escritorioId, escritorioId)];

  if (filtros?.dataInicio) {
    conditions.push(gte(agendamentos.dataInicio, new Date(filtros.dataInicio)));
  }
  if (filtros?.dataFim) {
    conditions.push(lte(agendamentos.dataInicio, new Date(filtros.dataFim)));
  }
  if (filtros?.responsavelId) {
    conditions.push(eq(agendamentos.responsavelId, filtros.responsavelId));
  }
  if (filtros?.tipo) {
    conditions.push(eq(agendamentos.tipo, filtros.tipo));
  }
  if (filtros?.status) {
    conditions.push(eq(agendamentos.status, filtros.status));
  }

  const rows = await db
    .select({
      id: agendamentos.id,
      escritorioId: agendamentos.escritorioId,
      criadoPorId: agendamentos.criadoPorId,
      responsavelId: agendamentos.responsavelId,
      tipo: agendamentos.tipo,
      titulo: agendamentos.titulo,
      descricao: agendamentos.descricao,
      dataInicio: agendamentos.dataInicio,
      dataFim: agendamentos.dataFim,
      diaInteiro: agendamentos.diaInteiro,
      local: agendamentos.local,
      prioridade: agendamentos.prioridade,
      status: agendamentos.status,
      processoId: agendamentos.processoId,
      corHex: agendamentos.corHex,
      createdAt: agendamentos.createdAt,
      responsavelNome: users.name,
    })
    .from(agendamentos)
    .innerJoin(colaboradores, eq(agendamentos.responsavelId, colaboradores.id))
    .innerJoin(users, eq(colaboradores.userId, users.id))
    .where(and(...conditions))
    .orderBy(asc(agendamentos.dataInicio));

  return rows.map((r) => ({
    ...r,
    dataInicio: r.dataInicio ? (r.dataInicio as Date).toISOString() : "",
    dataFim: r.dataFim ? (r.dataFim as Date).toISOString() : null,
    createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
  }));
}

export async function obterAgendamento(agendamentoId: number, escritorioId: number) {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db.select()
    .from(agendamentos)
    .where(and(eq(agendamentos.id, agendamentoId), eq(agendamentos.escritorioId, escritorioId)))
    .limit(1);

  if (!row) return null;

  const lembretes = await db.select()
    .from(agendamentoLembretes)
    .where(eq(agendamentoLembretes.agendamentoId, agendamentoId));

  return {
    ...row,
    dataInicio: row.dataInicio ? (row.dataInicio as Date).toISOString() : "",
    dataFim: row.dataFim ? (row.dataFim as Date).toISOString() : null,
    createdAt: row.createdAt ? (row.createdAt as Date).toISOString() : "",
    lembretes,
  };
}

export async function atualizarAgendamento(
  agendamentoId: number,
  escritorioId: number,
  dados: {
    titulo?: string;
    descricao?: string;
    dataInicio?: string;
    dataFim?: string;
    diaInteiro?: boolean;
    local?: string;
    prioridade?: PrioridadeAgendamento;
    status?: StatusAgendamento;
    responsavelId?: number;
    tipo?: TipoAgendamento;
    corHex?: string;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const updateData: Record<string, unknown> = {};
  if (dados.titulo !== undefined) updateData.titulo = dados.titulo;
  if (dados.descricao !== undefined) updateData.descricao = dados.descricao || null;
  if (dados.dataInicio !== undefined) updateData.dataInicio = new Date(dados.dataInicio);
  if (dados.dataFim !== undefined) updateData.dataFim = dados.dataFim ? new Date(dados.dataFim) : null;
  if (dados.diaInteiro !== undefined) updateData.diaInteiro = dados.diaInteiro;
  if (dados.local !== undefined) updateData.local = dados.local || null;
  if (dados.prioridade !== undefined) updateData.prioridade = dados.prioridade;
  if (dados.status !== undefined) updateData.status = dados.status;
  if (dados.responsavelId !== undefined) updateData.responsavelId = dados.responsavelId;
  if (dados.tipo !== undefined) updateData.tipo = dados.tipo;
  if (dados.corHex !== undefined) updateData.corHex = dados.corHex;

  if (Object.keys(updateData).length === 0) return;

  await db.update(agendamentos)
    .set(updateData)
    .where(and(eq(agendamentos.id, agendamentoId), eq(agendamentos.escritorioId, escritorioId)));
}

export async function excluirAgendamento(agendamentoId: number, escritorioId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  // Excluir lembretes primeiro
  await db.delete(agendamentoLembretes).where(eq(agendamentoLembretes.agendamentoId, agendamentoId));
  // Excluir agendamento
  await db.delete(agendamentos)
    .where(and(eq(agendamentos.id, agendamentoId), eq(agendamentos.escritorioId, escritorioId)));
}

export async function listarProximosCompromissos(escritorioId: number, limite = 5) {
  const db = await getDb();
  if (!db) return [];

  const agora = new Date();

  const rows = await db
    .select({
      id: agendamentos.id,
      tipo: agendamentos.tipo,
      titulo: agendamentos.titulo,
      dataInicio: agendamentos.dataInicio,
      prioridade: agendamentos.prioridade,
      status: agendamentos.status,
      corHex: agendamentos.corHex,
      responsavelNome: users.name,
    })
    .from(agendamentos)
    .innerJoin(colaboradores, eq(agendamentos.responsavelId, colaboradores.id))
    .innerJoin(users, eq(colaboradores.userId, users.id))
    .where(and(
      eq(agendamentos.escritorioId, escritorioId),
      gte(agendamentos.dataInicio, agora),
      or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
    ))
    .orderBy(asc(agendamentos.dataInicio))
    .limit(limite);

  return rows.map((r) => ({
    ...r,
    dataInicio: r.dataInicio ? (r.dataInicio as Date).toISOString() : "",
  }));
}

export async function contarAgendamentosPorStatus(escritorioId: number) {
  const db = await getDb();
  if (!db) return { pendente: 0, em_andamento: 0, concluido: 0, atrasado: 0 };

  const rows = await db.select()
    .from(agendamentos)
    .where(eq(agendamentos.escritorioId, escritorioId));

  const agora = new Date();
  let pendente = 0, em_andamento = 0, concluido = 0, atrasado = 0, cancelado = 0;

  for (const r of rows) {
    if (r.status === "concluido") { concluido++; continue; }
    if (r.status === "cancelado") { cancelado++; continue; }
    if (r.status === "em_andamento") { em_andamento++; continue; }
    // Verificar se está atrasado
    if ((r.status === "pendente" || r.status === "atrasado") && r.dataInicio && new Date(r.dataInicio) < agora) {
      atrasado++;
    } else {
      pendente++;
    }
  }

  return { pendente, em_andamento, concluido, atrasado };
}
