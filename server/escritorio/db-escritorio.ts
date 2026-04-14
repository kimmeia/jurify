/**
 * Funções de acesso ao banco — Escritórios, Colaboradores e Convites
 * Fase 1: Fundação
 */

import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../db";
import { escritorios, colaboradores, convitesColaborador, users } from "../../drizzle/schema";
import type { CargoColaborador, PlanoAtendimento } from "../../shared/escritorio-types";
import { PLANO_LIMITES } from "../../shared/escritorio-types";
import crypto from "crypto";

// ─── Escritório ──────────────────────────────────────────────────────────────

/** Busca o escritório do usuário (como dono ou colaborador) */
export async function getEscritorioPorUsuario(userId: number) {
  const db = await getDb();
  if (!db) return null;

  // Primeiro: verifica se é colaborador de algum escritório
  const [colab] = await db.select()
    .from(colaboradores)
    .where(and(eq(colaboradores.userId, userId), eq(colaboradores.ativo, true)))
    .limit(1);

  if (colab) {
    const [esc] = await db.select().from(escritorios).where(eq(escritorios.id, colab.escritorioId)).limit(1);
    return esc ? { escritorio: esc, colaborador: colab } : null;
  }

  return null;
}

/** Cria escritório + colaborador dono automaticamente */
export async function criarEscritorio(userId: number, nome: string, email?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  // Verificar se já tem escritório
  const existente = await getEscritorioPorUsuario(userId);
  if (existente) throw new Error("Você já pertence a um escritório.");

  const limites = PLANO_LIMITES["basico"];

  // Criar escritório
  const [result] = await db.insert(escritorios).values({
    nome,
    email: email ?? null,
    ownerId: userId,
    planoAtendimento: "basico",
    maxColaboradores: limites.maxColaboradores,
    maxConexoesWhatsapp: limites.maxConexoesWhatsapp,
    diasFuncionamento: JSON.stringify(["seg", "ter", "qua", "qui", "sex"]),
  });

  const escritorioId = (result as { insertId: number }).insertId;

  // Criar colaborador dono
  await db.insert(colaboradores).values({
    escritorioId,
    userId,
    cargo: "dono",
    ativo: true,
  });

  return escritorioId as number;
}

/** Atualiza dados do escritório */
export async function atualizarEscritorio(
  escritorioId: number,
  dados: {
    nome?: string;
    cnpj?: string;
    telefone?: string;
    email?: string;
    endereco?: string;
    fusoHorario?: string;
    horarioAbertura?: string;
    horarioFechamento?: string;
    diasFuncionamento?: string[];
    mensagemAusencia?: string;
    mensagemBoasVindas?: string;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const updateData: Record<string, unknown> = {};
  if (dados.nome !== undefined) updateData.nome = dados.nome;
  if (dados.cnpj !== undefined) updateData.cnpj = dados.cnpj || null;
  if (dados.telefone !== undefined) updateData.telefone = dados.telefone || null;
  if (dados.email !== undefined) updateData.email = dados.email || null;
  if (dados.endereco !== undefined) updateData.endereco = dados.endereco || null;
  if (dados.fusoHorario !== undefined) updateData.fusoHorario = dados.fusoHorario;
  if (dados.horarioAbertura !== undefined) updateData.horarioAbertura = dados.horarioAbertura;
  if (dados.horarioFechamento !== undefined) updateData.horarioFechamento = dados.horarioFechamento;
  if (dados.diasFuncionamento !== undefined) updateData.diasFuncionamento = JSON.stringify(dados.diasFuncionamento);
  if (dados.mensagemAusencia !== undefined) updateData.mensagemAusencia = dados.mensagemAusencia || null;
  if (dados.mensagemBoasVindas !== undefined) updateData.mensagemBoasVindas = dados.mensagemBoasVindas || null;

  if (Object.keys(updateData).length === 0) return;

  await db.update(escritorios).set(updateData).where(eq(escritorios.id, escritorioId));
}

// ─── Colaboradores ──────────────────────────────────────────────────────────

/** Lista todos os colaboradores do escritório (com dados do user) */
/** Lista colaboradores ATIVOS do escritório.
 *  Removidos (ativo=false) ficam no banco apenas para o middleware
 *  bloquear sessões antigas — não devem aparecer na UI de equipe.
 */
export async function listarColaboradores(escritorioId: number) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: colaboradores.id,
      escritorioId: colaboradores.escritorioId,
      userId: colaboradores.userId,
      cargo: colaboradores.cargo,
      departamento: colaboradores.departamento,
      ativo: colaboradores.ativo,
      maxAtendimentosSimultaneos: colaboradores.maxAtendimentosSimultaneos,
      recebeLeadsAutomaticos: colaboradores.recebeLeadsAutomaticos,
      createdAt: colaboradores.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(colaboradores)
    .innerJoin(users, eq(colaboradores.userId, users.id))
    .where(and(
      eq(colaboradores.escritorioId, escritorioId),
      eq(colaboradores.ativo, true),
    ))
    .orderBy(desc(colaboradores.createdAt));

  return rows;
}

/** Conta colaboradores ativos */
export async function contarColaboradoresAtivos(escritorioId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const rows = await db.select({ id: colaboradores.id })
    .from(colaboradores)
    .where(and(eq(colaboradores.escritorioId, escritorioId), eq(colaboradores.ativo, true)));

  return rows.length;
}

/** Atualiza dados do colaborador */
export async function atualizarColaborador(
  colaboradorId: number,
  escritorioId: number,
  dados: {
    cargo?: CargoColaborador;
    departamento?: string;
    ativo?: boolean;
    maxAtendimentosSimultaneos?: number;
    recebeLeadsAutomaticos?: boolean;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const updateData: Record<string, unknown> = {};
  if (dados.cargo !== undefined) updateData.cargo = dados.cargo;
  if (dados.departamento !== undefined) updateData.departamento = dados.departamento || null;
  if (dados.ativo !== undefined) updateData.ativo = dados.ativo;
  if (dados.maxAtendimentosSimultaneos !== undefined) updateData.maxAtendimentosSimultaneos = dados.maxAtendimentosSimultaneos;
  if (dados.recebeLeadsAutomaticos !== undefined) updateData.recebeLeadsAutomaticos = dados.recebeLeadsAutomaticos;

  if (Object.keys(updateData).length === 0) return;

  await db.update(colaboradores)
    .set(updateData)
    .where(and(eq(colaboradores.id, colaboradorId), eq(colaboradores.escritorioId, escritorioId)));
}

/** Remove colaborador completamente.
 *
 * Hard-delete: a row em `colaboradores` é APAGADA. Se o usuário não
 * pertence a nenhum outro escritório, a row em `users` também é apagada
 * — assim ele pode se cadastrar novamente com o mesmo email como se
 * fosse um novo usuário.
 *
 * Os DADOS DO ESCRITÓRIO permanecem intactos (clientes, conversas, leads,
 * agendamentos, kanban, mensagens, anotações, arquivos, calculos).
 * Referências por `responsavelId`/`criadoPor` apontando pro colaborador
 * removido viram órfãs (no JOIN aparecem como "Sem responsável") — isso
 * é intencional pra não perder histórico do escritório.
 */
export async function removerColaborador(colaboradorId: number, escritorioId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  // Não pode remover o dono
  const [colab] = await db.select().from(colaboradores)
    .where(and(eq(colaboradores.id, colaboradorId), eq(colaboradores.escritorioId, escritorioId)))
    .limit(1);

  if (!colab) throw new Error("Colaborador não encontrado.");
  if (colab.cargo === "dono") throw new Error("O dono do escritório não pode ser removido.");

  const userId = colab.userId;

  // 1. Hard-delete do vínculo
  await db.delete(colaboradores).where(eq(colaboradores.id, colaboradorId));

  // 2. Se o usuário não tem mais NENHUM vínculo em outros escritórios,
  //    deleta o usuário do sistema. Isso libera o email pra recadastro.
  const outrosVinculos = await db
    .select({ id: colaboradores.id })
    .from(colaboradores)
    .where(eq(colaboradores.userId, userId))
    .limit(1);

  if (outrosVinculos.length === 0) {
    try {
      await db.delete(users).where(eq(users.id, userId));
    } catch (err) {
      // Se a deleção do user falhar (ex: FK constraint de outras tabelas
      // que referenciam users.id), não bloqueia — o vínculo já foi removido.
      // O ex-colaborador apenas não conseguirá usar o sistema.
    }
  }
}

// ─── Convites ────────────────────────────────────────────────────────────────

/** Gera token único para convite */
function gerarTokenConvite(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Cria convite para novo colaborador */
export async function criarConvite(
  escritorioId: number,
  convidadoPorId: number,
  email: string,
  cargo: "gestor" | "atendente" | "estagiario",
  departamento?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  // Verificar limite de colaboradores
  const [esc] = await db.select().from(escritorios).where(eq(escritorios.id, escritorioId)).limit(1);
  if (!esc) throw new Error("Escritório não encontrado.");

  const ativos = await contarColaboradoresAtivos(escritorioId);
  // Contamos convites pendentes também
  const pendentes = await db.select({ id: convitesColaborador.id })
    .from(convitesColaborador)
    .where(and(eq(convitesColaborador.escritorioId, escritorioId), eq(convitesColaborador.status, "pendente")));

  const totalFuturo = ativos + pendentes.length;
  // Acima do limite do plano, cada extra custa R$ 9,90 (mas permitimos — cobrança é na fatura)
  // Por enquanto: aviso no frontend, sem bloqueio

  // Verificar se já existe convite pendente para este email
  const [existente] = await db.select().from(convitesColaborador)
    .where(and(
      eq(convitesColaborador.escritorioId, escritorioId),
      eq(convitesColaborador.email, email.toLowerCase()),
      eq(convitesColaborador.status, "pendente"),
    ))
    .limit(1);

  if (existente) throw new Error(`Já existe um convite pendente para ${email}.`);

  // Verificar se já é colaborador
  const [userExistente] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (userExistente) {
    const [colabExistente] = await db.select().from(colaboradores)
      .where(and(eq(colaboradores.escritorioId, escritorioId), eq(colaboradores.userId, userExistente.id), eq(colaboradores.ativo, true)))
      .limit(1);
    if (colabExistente) throw new Error(`${email} já é colaborador deste escritório.`);
  }

  const token = gerarTokenConvite();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 dias para aceitar

  await db.insert(convitesColaborador).values({
    escritorioId,
    email: email.toLowerCase(),
    cargo,
    departamento: departamento || null,
    token,
    convidadoPorId,
    expiresAt,
  });

  return { token, expiresAt: expiresAt.toISOString() };
}

/** Lista convites do escritório */
/** Lista convites PENDENTES do escritório.
 *  Convites aceitos viram colaboradores (visíveis na aba Membros),
 *  convites expirados/cancelados não precisam ser mostrados.
 */
export async function listarConvites(escritorioId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(convitesColaborador)
    .where(
      and(
        eq(convitesColaborador.escritorioId, escritorioId),
        eq(convitesColaborador.status, "pendente"),
      ),
    )
    .orderBy(desc(convitesColaborador.createdAt));
}

/** Aceita convite (usuário clicou no link) */
export async function aceitarConvite(token: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const [convite] = await db.select().from(convitesColaborador)
    .where(eq(convitesColaborador.token, token))
    .limit(1);

  if (!convite) throw new Error("Convite não encontrado.");
  if (convite.status !== "pendente") throw new Error(`Convite já foi ${convite.status}.`);
  if (new Date(convite.expiresAt) < new Date()) {
    await db.update(convitesColaborador).set({ status: "expirado" }).where(eq(convitesColaborador.id, convite.id));
    throw new Error("Convite expirado.");
  }

  // Verificar se já pertence a outro escritório
  const existente = await getEscritorioPorUsuario(userId);
  if (existente) throw new Error("Você já pertence a um escritório. Saia do atual antes de aceitar outro convite.");

  // Resolver cargoPersonalizadoId — sem isso o checkPermission cai no
  // PERMISSOES_LEGADO (hardcoded) e ignora o que o admin configurou no
  // painel de Permissões. O nome do cargo personalizado padrão segue o
  // mapa: gestor→Gestor, atendente→Atendente, estagiario→Estagiário.
  const NOMES_CARGO: Record<string, string> = {
    gestor: "Gestor",
    atendente: "Atendente",
    estagiario: "Estagiário",
  };
  let cargoPersonalizadoId: number | null = null;
  const nomeCargo = NOMES_CARGO[convite.cargo];
  if (nomeCargo) {
    const { cargosPersonalizados } = await import("../../drizzle/schema");
    const [cp] = await db
      .select({ id: cargosPersonalizados.id })
      .from(cargosPersonalizados)
      .where(and(
        eq(cargosPersonalizados.escritorioId, convite.escritorioId),
        eq(cargosPersonalizados.nome, nomeCargo),
      ))
      .limit(1);
    cargoPersonalizadoId = cp?.id ?? null;
  }

  // Criar colaborador (com cargo personalizado vinculado)
  await db.insert(colaboradores).values({
    escritorioId: convite.escritorioId,
    userId,
    cargo: convite.cargo as CargoColaborador,
    cargoPersonalizadoId,
    departamento: convite.departamento,
    ativo: true,
  });

  // Marcar convite como aceito
  await db.update(convitesColaborador).set({
    status: "aceito",
    aceitoPorUserId: userId,
  }).where(eq(convitesColaborador.id, convite.id));

  return { escritorioId: convite.escritorioId, cargo: convite.cargo };
}

/** Cancela convite — remove do banco para não poluir a listagem.
 *  Uso: admin clica em cancelar na lista de convites pendentes.
 */
export async function cancelarConvite(conviteId: number, escritorioId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  await db
    .delete(convitesColaborador)
    .where(and(eq(convitesColaborador.id, conviteId), eq(convitesColaborador.escritorioId, escritorioId)));
}
