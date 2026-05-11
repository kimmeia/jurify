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

  const { setores, cargosPersonalizados } = await import("../../drizzle/schema");
  const rows = await db
    .select({
      id: colaboradores.id,
      escritorioId: colaboradores.escritorioId,
      userId: colaboradores.userId,
      cargo: colaboradores.cargo,
      cargoPersonalizadoId: colaboradores.cargoPersonalizadoId,
      cargoPersonalizadoNome: cargosPersonalizados.nome,
      departamento: colaboradores.departamento,
      setorId: colaboradores.setorId,
      setorNome: setores.nome,
      setorCor: setores.cor,
      ativo: colaboradores.ativo,
      maxAtendimentosSimultaneos: colaboradores.maxAtendimentosSimultaneos,
      recebeLeadsAutomaticos: colaboradores.recebeLeadsAutomaticos,
      createdAt: colaboradores.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(colaboradores)
    .innerJoin(users, eq(colaboradores.userId, users.id))
    .leftJoin(setores, eq(colaboradores.setorId, setores.id))
    .leftJoin(cargosPersonalizados, eq(colaboradores.cargoPersonalizadoId, cargosPersonalizados.id))
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

/** Atualiza dados do colaborador.
 *  Dono é protegido: não pode ser rebaixado nem desativado por esta via.
 *  Remoção do dono segue passando por removerColaborador (que também barra).
 */
export async function atualizarColaborador(
  colaboradorId: number,
  escritorioId: number,
  dados: {
    cargo?: CargoColaborador;
    /** Quando informado, é a fonte da verdade. O enum `cargo` é derivado
     *  do nome do cargo personalizado (default ou "atendente" pra custom). */
    cargoPersonalizadoId?: number | null;
    departamento?: string;
    /** FK pra setores. Null limpa o vínculo. */
    setorId?: number | null;
    ativo?: boolean;
    maxAtendimentosSimultaneos?: number;
    recebeLeadsAutomaticos?: boolean;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const [alvo] = await db
    .select({ cargo: colaboradores.cargo })
    .from(colaboradores)
    .where(and(eq(colaboradores.id, colaboradorId), eq(colaboradores.escritorioId, escritorioId)))
    .limit(1);
  if (!alvo) throw new Error("Colaborador não encontrado.");
  if (alvo.cargo === "dono") {
    if (dados.cargo !== undefined && dados.cargo !== "dono") {
      throw new Error("O cargo do dono do escritório não pode ser alterado.");
    }
    if (dados.cargoPersonalizadoId !== undefined) {
      throw new Error("O cargo do dono do escritório não pode ser alterado.");
    }
    if (dados.ativo === false) {
      throw new Error("O dono do escritório não pode ser desativado.");
    }
  }

  const updateData: Record<string, unknown> = {};
  if (dados.cargo !== undefined) updateData.cargo = dados.cargo;
  if (dados.departamento !== undefined) updateData.departamento = dados.departamento || null;
  if (dados.ativo !== undefined) updateData.ativo = dados.ativo;
  if (dados.maxAtendimentosSimultaneos !== undefined) updateData.maxAtendimentosSimultaneos = dados.maxAtendimentosSimultaneos;
  if (dados.recebeLeadsAutomaticos !== undefined) updateData.recebeLeadsAutomaticos = dados.recebeLeadsAutomaticos;

  // Setor FK: null limpa. Validar que pertence ao escritório.
  if (dados.setorId !== undefined) {
    if (dados.setorId === null) {
      updateData.setorId = null;
    } else {
      const { setores } = await import("../../drizzle/schema");
      const [s] = await db
        .select({ id: setores.id })
        .from(setores)
        .where(and(eq(setores.id, dados.setorId), eq(setores.escritorioId, escritorioId)))
        .limit(1);
      if (!s) throw new Error("Setor inválido para este escritório.");
      updateData.setorId = dados.setorId;
    }
  }

  // CargoPersonalizadoId: null limpa. Quando informado, deriva o enum
  // `cargo` pelo nome do cargo personalizado (segue a regra de
  // aceitarConvite): default vira o enum correspondente; custom vira
  // "atendente" como fallback seguro de permissão.
  if (dados.cargoPersonalizadoId !== undefined) {
    if (dados.cargoPersonalizadoId === null) {
      updateData.cargoPersonalizadoId = null;
    } else {
      const { cargosPersonalizados } = await import("../../drizzle/schema");
      const [cp] = await db
        .select({ id: cargosPersonalizados.id, nome: cargosPersonalizados.nome })
        .from(cargosPersonalizados)
        .where(and(
          eq(cargosPersonalizados.id, dados.cargoPersonalizadoId),
          eq(cargosPersonalizados.escritorioId, escritorioId),
        ))
        .limit(1);
      if (!cp) throw new Error("Cargo inválido para este escritório.");
      updateData.cargoPersonalizadoId = cp.id;
      // Deriva enum legado pelo nome do cargo.
      const NOME_PARA_LEGADO: Record<string, CargoColaborador> = {
        Dono: "dono",
        Gestor: "gestor",
        Atendente: "atendente",
        Estagiário: "estagiario",
        SDR: "sdr",
      };
      // Não permite atribuir cargo "Dono" via UI — sempre fica "atendente"
      // se for um custom desconhecido (defesa contra escalada).
      if (cp.nome === "Dono") {
        throw new Error("Não é possível promover ninguém a Dono.");
      }
      updateData.cargo = NOME_PARA_LEGADO[cp.nome] ?? "atendente";
    }
  }

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
  /**
   * Cargo do convite. Pode ser um dos defaults ("gestor", "atendente",
   * "estagiario") OU o nome de um cargo personalizado existente do
   * escritório (ex: "advogados"). A validação é feita ANTES de chamar
   * essa função (pelo router enviarConvite).
   */
  cargo: string,
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

  const result = await db.insert(convitesColaborador).values({
    escritorioId,
    email: email.toLowerCase(),
    cargo,
    departamento: departamento || null,
    token,
    convidadoPorId,
    expiresAt,
  });
  const inviteId =
    (result as unknown as { insertId: number }[])[0]?.insertId ??
    (result as unknown as { insertId: number }).insertId;

  return { id: inviteId, token, expiresAt: expiresAt.toISOString() };
}

/** Persiste resultado do último envio de email pra um convite. */
export async function atualizarStatusEmailConvite(
  conviteId: number,
  emailEnviado: boolean,
  ultimoErroEmail?: string | null,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(convitesColaborador)
    .set({
      emailEnviado,
      ultimoErroEmail: ultimoErroEmail ?? null,
    })
    .where(eq(convitesColaborador.id, conviteId));
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

  // Idempotência: se o usuário já é colaborador deste escritório (ex:
  // aceitou em outra aba milissegundos antes), tratamos como sucesso
  // em vez de explodir. UNIQUE(escritorioId, userId) no banco garante
  // que só existe 1 linha mesmo em race.
  const [jaColab] = await db
    .select()
    .from(colaboradores)
    .where(
      and(
        eq(colaboradores.userId, userId),
        eq(colaboradores.escritorioId, convite.escritorioId),
      ),
    )
    .limit(1);
  if (jaColab) {
    await db
      .update(convitesColaborador)
      .set({ status: "aceito", aceitoPorUserId: userId })
      .where(eq(convitesColaborador.id, convite.id));
    return { escritorioId: convite.escritorioId, cargo: jaColab.cargo };
  }

  // Verificar se já pertence a outro escritório
  const existente = await getEscritorioPorUsuario(userId);
  if (existente) throw new Error("Você já pertence a um escritório. Saia do atual antes de aceitar outro convite.");

  // Resolver cargoPersonalizadoId.
  //
  // Dois caminhos:
  //  1) convite.cargo é um dos defaults ("gestor"|"atendente"|"estagiario"):
  //     resolve pelo NOME canonical (Gestor/Atendente/Estagiário) — assim
  //     escritórios que customizaram permissões do "Gestor" no painel
  //     passam a valer.
  //  2) convite.cargo é o nome de um cargo personalizado (ex: "advogados"):
  //     busca direto pelo nome. Nesse caso a coluna `colaboradores.cargo`
  //     (enum) recebe "atendente" como fallback seguro — checkPermission
  //     usa cargoPersonalizadoId como fonte da verdade, mas se algo der
  //     errado, fica com permissões mínimas em vez de admin.
  const NOMES_CARGO_DEFAULT: Record<string, string> = {
    gestor: "Gestor",
    atendente: "Atendente",
    estagiario: "Estagiário",
    sdr: "SDR",
  };
  const ehDefault = convite.cargo in NOMES_CARGO_DEFAULT;
  const nomeBuscado = ehDefault ? NOMES_CARGO_DEFAULT[convite.cargo] : convite.cargo;

  const { cargosPersonalizados } = await import("../../drizzle/schema");
  const [cp] = await db
    .select({ id: cargosPersonalizados.id })
    .from(cargosPersonalizados)
    .where(and(
      eq(cargosPersonalizados.escritorioId, convite.escritorioId),
      eq(cargosPersonalizados.nome, nomeBuscado),
    ))
    .limit(1);
  const cargoPersonalizadoId: number | null = cp?.id ?? null;

  // Cargo enum: se for default, mantém. Se for custom, fallback pra
  // "atendente" (permissões mínimas em caso de cargoPersonalizadoId não
  // resolver).
  const cargoEnum: CargoColaborador = ehDefault
    ? (convite.cargo as CargoColaborador)
    : "atendente";

  // Criar colaborador (com cargo personalizado vinculado). Em caso de
  // race com outra aba, UNIQUE(escritorioId, userId) barra o INSERT
  // duplicado — capturamos e prosseguimos idempotente.
  try {
    await db.insert(colaboradores).values({
      escritorioId: convite.escritorioId,
      userId,
      cargo: cargoEnum,
      cargoPersonalizadoId,
      departamento: convite.departamento,
      ativo: true,
    });
  } catch (err: any) {
    const msg = String(err?.message || "").toLowerCase();
    const duplicate =
      msg.includes("duplicate entry") ||
      msg.includes("duplicate key") ||
      err?.code === "ER_DUP_ENTRY";
    if (!duplicate) throw err;
  }

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
