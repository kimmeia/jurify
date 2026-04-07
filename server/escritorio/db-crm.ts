/**
 * Funções de acesso ao banco — CRM (Contatos, Conversas, Mensagens, Leads)
 * Fase 3 — Inclui algoritmo de distribuição inteligente de leads
 */

import { eq, and, desc, asc, or, sql, gte, lte, like } from "drizzle-orm";
import { getDb } from "../db";
import { contatos, conversas, mensagens, leads, colaboradores, users, canaisIntegrados, escritorios } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("crm");

// Tipos compartilhados para validação de entrada
type OrigemContato = "whatsapp" | "instagram" | "facebook" | "telefone" | "manual" | "site";
type PrioridadeConv = "baixa" | "normal" | "alta" | "urgente";
type StatusConv = "aguardando" | "em_atendimento" | "resolvido" | "fechado";
type DirecaoMsg = "entrada" | "saida";
type TipoMsg = "texto" | "imagem" | "audio" | "video" | "documento" | "localizacao" | "contato" | "sticker" | "sistema";
type EtapaFunil = "novo" | "qualificado" | "proposta" | "negociacao" | "fechado_ganho" | "fechado_perdido";

// ─── Contatos ────────────────────────────────────────────────────────────────

const ORIGENS_VALIDAS = new Set<OrigemContato>([
  "whatsapp", "instagram", "facebook", "telefone", "manual", "site",
]);

function validarOrigem(v: string | undefined): OrigemContato {
  if (v && ORIGENS_VALIDAS.has(v as OrigemContato)) return v as OrigemContato;
  return "manual";
}

export async function criarContato(dados: {
  escritorioId: number; nome: string; telefone?: string; email?: string;
  cpfCnpj?: string; origem?: string; tags?: string[]; observacoes?: string;
  responsavelId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const [result] = await db.insert(contatos).values({
    escritorioId: dados.escritorioId,
    nome: dados.nome,
    telefone: dados.telefone || null,
    email: dados.email || null,
    cpfCnpj: dados.cpfCnpj || null,
    origem: validarOrigem(dados.origem),
    tags: dados.tags ? JSON.stringify(dados.tags) : null,
    observacoes: dados.observacoes || null,
    responsavelId: dados.responsavelId ?? null,
  });
  return (result as { insertId: number }).insertId;
}

export async function listarContatos(escritorioId: number, busca?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(contatos.escritorioId, escritorioId)];
  if (busca) {
    conditions.push(or(
      like(contatos.nome, `%${busca}%`),
      like(contatos.telefone, `%${busca}%`),
      like(contatos.email, `%${busca}%`),
    )!);
  }
  const rows = await db.select().from(contatos)
    .where(and(...conditions)).orderBy(desc(contatos.createdAt)).limit(100);
  return rows.map((r) => ({
    ...r,
    tags: r.tags ? JSON.parse(r.tags as string) : [],
    createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
  }));
}

export async function atualizarContato(id: number, escritorioId: number, dados: Record<string, any>) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const updateData: Record<string, unknown> = {};
  if (dados.nome !== undefined) updateData.nome = dados.nome;
  if (dados.telefone !== undefined) updateData.telefone = dados.telefone || null;
  if (dados.email !== undefined) updateData.email = dados.email || null;
  if (dados.cpfCnpj !== undefined) updateData.cpfCnpj = dados.cpfCnpj || null;
  if (dados.tags !== undefined) updateData.tags = JSON.stringify(dados.tags);
  if (dados.observacoes !== undefined) updateData.observacoes = dados.observacoes || null;
  if (dados.responsavelId !== undefined) updateData.responsavelId = dados.responsavelId;
  if (Object.keys(updateData).length === 0) return;
  await db.update(contatos).set(updateData)
    .where(and(eq(contatos.id, id), eq(contatos.escritorioId, escritorioId)));
}

export async function excluirContato(id: number, escritorioId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  await db.delete(contatos).where(and(eq(contatos.id, id), eq(contatos.escritorioId, escritorioId)));
}

// ─── Conversas ───────────────────────────────────────────────────────────────

const PRIORIDADES_VALIDAS = new Set<PrioridadeConv>([
  "baixa", "normal", "alta", "urgente",
]);
const STATUS_CONV_VALIDOS = new Set<StatusConv>([
  "aguardando", "em_atendimento", "resolvido", "fechado",
]);

function validarPrioridade(v: string | undefined): PrioridadeConv {
  if (v && PRIORIDADES_VALIDAS.has(v as PrioridadeConv)) return v as PrioridadeConv;
  return "normal";
}

export async function criarConversa(dados: {
  escritorioId: number; contatoId: number; canalId: number;
  atendenteId?: number; assunto?: string; prioridade?: string;
  chatIdExterno?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const [result] = await db.insert(conversas).values({
    escritorioId: dados.escritorioId,
    contatoId: dados.contatoId,
    canalId: dados.canalId,
    atendenteId: dados.atendenteId ?? null,
    assunto: dados.assunto || null,
    prioridade: validarPrioridade(dados.prioridade),
    chatIdExterno: dados.chatIdExterno || null,
  });
  return (result as { insertId: number }).insertId;
}

export async function listarConversas(escritorioId: number, filtros?: {
  status?: string; atendenteId?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(conversas.escritorioId, escritorioId)];
  if (filtros?.status && STATUS_CONV_VALIDOS.has(filtros.status as StatusConv)) {
    conditions.push(eq(conversas.status, filtros.status as StatusConv));
  }
  if (filtros?.atendenteId) conditions.push(eq(conversas.atendenteId, filtros.atendenteId));

  const rows = await db
    .select({
      id: conversas.id, contatoId: conversas.contatoId,
      contatoNome: contatos.nome, contatoTelefone: contatos.telefone,
      canalId: conversas.canalId, canalNome: canaisIntegrados.nome, canalTipo: canaisIntegrados.tipo,
      atendenteId: conversas.atendenteId,
      status: conversas.status, prioridade: conversas.prioridade,
      assunto: conversas.assunto,
      chatIdExterno: conversas.chatIdExterno,
      ultimaMensagemAt: conversas.ultimaMensagemAt,
      ultimaMensagemPreview: conversas.ultimaMensagemPreview,
      createdAt: conversas.createdAt,
    })
    .from(conversas)
    .innerJoin(contatos, eq(conversas.contatoId, contatos.id))
    .innerJoin(canaisIntegrados, eq(conversas.canalId, canaisIntegrados.id))
    .where(and(...conditions))
    .orderBy(desc(conversas.ultimaMensagemAt))
    .limit(100);

  // Buscar nomes dos atendentes
  const atendenteIds = [...new Set(rows.filter(r => r.atendenteId).map(r => r.atendenteId!))];
  const atendenteMap: Record<number, string> = {};
  if (atendenteIds.length > 0) {
    for (const aid of atendenteIds) {
      const [colab] = await db.select({ nome: users.name })
        .from(colaboradores).innerJoin(users, eq(colaboradores.userId, users.id))
        .where(eq(colaboradores.id, aid)).limit(1);
      if (colab) atendenteMap[aid] = colab.nome || "Sem nome";
    }
  }

  return rows.map((r) => ({
    ...r,
    atendenteNome: r.atendenteId ? atendenteMap[r.atendenteId] : undefined,
    ultimaMensagemAt: r.ultimaMensagemAt ? (r.ultimaMensagemAt as Date).toISOString() : undefined,
    createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
  }));
}

export async function atualizarConversa(id: number, escritorioId: number, dados: Record<string, any>) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const updateData: Record<string, unknown> = {};
  if (dados.status !== undefined) updateData.status = dados.status;
  if (dados.atendenteId !== undefined) updateData.atendenteId = dados.atendenteId;
  if (dados.prioridade !== undefined) updateData.prioridade = dados.prioridade;
  if (dados.assunto !== undefined) updateData.assunto = dados.assunto || null;
  if (Object.keys(updateData).length === 0) return;
  await db.update(conversas).set(updateData)
    .where(and(eq(conversas.id, id), eq(conversas.escritorioId, escritorioId)));
}

export async function excluirConversa(id: number, escritorioId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  // Excluir mensagens primeiro (FK)
  const [conv] = await db.select({ id: conversas.id }).from(conversas)
    .where(and(eq(conversas.id, id), eq(conversas.escritorioId, escritorioId))).limit(1);
  if (!conv) throw new Error("Conversa não encontrada.");
  await db.delete(mensagens).where(eq(mensagens.conversaId, id));
  await db.delete(conversas).where(and(eq(conversas.id, id), eq(conversas.escritorioId, escritorioId)));
}

// ─── Mensagens ───────────────────────────────────────────────────────────────

const TIPOS_MSG_VALIDOS = new Set<TipoMsg>([
  "texto", "imagem", "audio", "video", "documento", "localizacao", "contato", "sticker", "sistema",
]);

export async function enviarMensagem(dados: {
  conversaId: number; remetenteId?: number; direcao: string;
  tipo?: string; conteudo: string; mediaUrl?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  if (dados.direcao !== "entrada" && dados.direcao !== "saida") {
    throw new Error(`Direção inválida: ${dados.direcao}`);
  }
  const tipoValido: TipoMsg = TIPOS_MSG_VALIDOS.has(dados.tipo as TipoMsg) ? (dados.tipo as TipoMsg) : "texto";
  const [result] = await db.insert(mensagens).values({
    conversaId: dados.conversaId,
    remetenteId: dados.remetenteId ?? null,
    direcao: dados.direcao as DirecaoMsg,
    tipo: tipoValido,
    conteudo: dados.conteudo,
    mediaUrl: dados.mediaUrl || null,
    status: "enviada",
  });

  // Atualizar preview da conversa
  await db.update(conversas).set({
    ultimaMensagemAt: new Date(),
    ultimaMensagemPreview: dados.conteudo.slice(0, 250),
  }).where(eq(conversas.id, dados.conversaId));

  return (result as { insertId: number }).insertId;
}

export async function listarMensagens(conversaId: number, limite = 50) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(mensagens)
    .where(eq(mensagens.conversaId, conversaId))
    .orderBy(asc(mensagens.createdAt)).limit(limite);

  // Buscar nomes dos remetentes
  const remIds = [...new Set(rows.filter(r => r.remetenteId).map(r => r.remetenteId!))];
  const remMap: Record<number, string> = {};
  if (remIds.length > 0) {
    for (const rid of remIds) {
      const [colab] = await db.select({ nome: users.name })
        .from(colaboradores).innerJoin(users, eq(colaboradores.userId, users.id))
        .where(eq(colaboradores.id, rid)).limit(1);
      if (colab) remMap[rid] = colab.nome || "Atendente";
    }
  }

  return rows.map((r) => ({
    ...r,
    remetenteNome: r.remetenteId ? remMap[r.remetenteId] : undefined,
    createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
  }));
}

// ─── Leads ───────────────────────────────────────────────────────────────────

export async function criarLead(dados: {
  escritorioId: number; contatoId: number; conversaId?: number;
  responsavelId?: number; valorEstimado?: string; origemLead?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const [result] = await db.insert(leads).values({
    escritorioId: dados.escritorioId,
    contatoId: dados.contatoId,
    conversaId: dados.conversaId ?? null,
    responsavelId: dados.responsavelId ?? null,
    valorEstimado: dados.valorEstimado || null,
    origemLead: dados.origemLead || null,
  });
  return (result as { insertId: number }).insertId;
}

export async function listarLeads(escritorioId: number, etapa?: string) {
  const db = await getDb();
  if (!db) return [];
  const ETAPAS_VALIDAS = new Set<EtapaFunil>([
    "novo", "qualificado", "proposta", "negociacao", "fechado_ganho", "fechado_perdido",
  ]);
  const conditions = [eq(leads.escritorioId, escritorioId)];
  if (etapa && ETAPAS_VALIDAS.has(etapa as EtapaFunil)) {
    conditions.push(eq(leads.etapaFunil, etapa as EtapaFunil));
  }

  const rows = await db
    .select({
      id: leads.id, contatoId: leads.contatoId,
      contatoNome: contatos.nome, contatoTelefone: contatos.telefone,
      responsavelId: leads.responsavelId,
      conversaId: leads.conversaId,
      etapaFunil: leads.etapaFunil, valorEstimado: leads.valorEstimado,
      origemLead: leads.origemLead, probabilidade: leads.probabilidade,
      dataFechamentoPrevisto: leads.dataFechamentoPrevisto,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(contatos, eq(leads.contatoId, contatos.id))
    .where(and(...conditions))
    .orderBy(desc(leads.createdAt)).limit(200);

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
  }));
}

export async function atualizarLead(id: number, escritorioId: number, dados: Record<string, any>) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const updateData: Record<string, unknown> = {};
  if (dados.etapaFunil !== undefined) updateData.etapaFunil = dados.etapaFunil;
  if (dados.valorEstimado !== undefined) updateData.valorEstimado = dados.valorEstimado || null;
  if (dados.responsavelId !== undefined) updateData.responsavelId = dados.responsavelId;
  if (dados.probabilidade !== undefined) updateData.probabilidade = dados.probabilidade;
  if (dados.motivoPerda !== undefined) updateData.motivoPerda = dados.motivoPerda || null;
  if (dados.observacoes !== undefined) updateData.observacoes = dados.observacoes || null;
  if (Object.keys(updateData).length === 0) return;
  await db.update(leads).set(updateData)
    .where(and(eq(leads.id, id), eq(leads.escritorioId, escritorioId)));
}

export async function excluirLead(id: number, escritorioId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  await db.delete(leads).where(and(eq(leads.id, id), eq(leads.escritorioId, escritorioId)));
}

// ─── Métricas ────────────────────────────────────────────────────────────────

export async function obterMetricasDashboard(escritorioId: number) {
  const db = await getDb();
  if (!db) return { totalContatos: 0, conversasAbertas: 0, conversasAguardando: 0, leadsNovos: 0, leadsGanhos: 0, valorPipeline: 0, tempoMedioResposta: 0 };

  const [contatosCount] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(contatos).where(eq(contatos.escritorioId, escritorioId));

  const convRows = await db.select({ status: conversas.status })
    .from(conversas).where(eq(conversas.escritorioId, escritorioId));

  const leadRows = await db.select({ etapa: leads.etapaFunil, valor: leads.valorEstimado })
    .from(leads).where(eq(leads.escritorioId, escritorioId));

  const abertas = convRows.filter(r => r.status === "aguardando" || r.status === "em_atendimento").length;
  const aguardando = convRows.filter(r => r.status === "aguardando").length;
  const novos = leadRows.filter(r => r.etapa === "novo").length;
  const ganhos = leadRows.filter(r => r.etapa === "fechado_ganho").length;
  const pipeline = leadRows
    .filter(r => r.etapa !== "fechado_ganho" && r.etapa !== "fechado_perdido")
    .reduce((s, r) => s + (parseFloat(r.valor || "0") || 0), 0);

  return {
    totalContatos: (contatosCount as { count: number } | undefined)?.count ?? 0,
    conversasAbertas: abertas,
    conversasAguardando: aguardando,
    leadsNovos: novos,
    leadsGanhos: ganhos,
    valorPipeline: pipeline,
    tempoMedioResposta: 0,
  };
}

// ─── Distribuição Inteligente de Leads ───────────────────────────────────────

/**
 * Distribuição inteligente de conversas para atendentes.
 * 
 * Algoritmo:
 * 1. Verifica horário de funcionamento do escritório
 * 2. Filtra atendentes ativos + que recebem leads + online (heartbeat 10min)
 * 3. Se cliente já falou com alguém antes → prioriza o mesmo atendente (continuidade)
 * 4. Calcula carga proporcional (conversas abertas / máximo)
 * 5. Desempate por ultimaDistribuicao (quem recebeu há mais tempo ganha = round-robin real)
 * 6. Se ninguém online → retorna null (fila de espera)
 * 
 * @param escritorioId - ID do escritório
 * @param contatoId - ID do contato (para buscar atendente anterior)
 * @param canalId - ID do canal (opcional, para priorização futura)
 */
export async function distribuirLead(
  escritorioId: number,
  contatoId?: number,
  canalId?: number,
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  // ─── 1. Verificar horário de funcionamento ─────────────────────────────
  const [esc] = await db.select().from(escritorios)
    .where(eq(escritorios.id, escritorioId)).limit(1);

  if (esc) {
    const agora = new Date();
    const diasSemana = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
    const diaHoje = diasSemana[agora.getDay()];
    const diasFuncionamento = esc.diasFuncionamento 
      ? (typeof esc.diasFuncionamento === "string" ? JSON.parse(esc.diasFuncionamento) : esc.diasFuncionamento) 
      : ["seg", "ter", "qua", "qui", "sex"];

    if (!diasFuncionamento.includes(diaHoje)) {
      log.debug({ diaHoje }, "Distribuição: escritório fechado hoje");
      return null; // Escritório fechado hoje
    }

    // Verificar horário (formato HH:MM)
    const horaAtual = agora.getHours() * 60 + agora.getMinutes();
    const abertura = esc.horarioAbertura ? parseHorario(esc.horarioAbertura) : 480; // 08:00
    const fechamento = esc.horarioFechamento ? parseHorario(esc.horarioFechamento) : 1080; // 18:00

    if (horaAtual < abertura || horaAtual > fechamento) {
      log.debug({ abertura: esc.horarioAbertura, fechamento: esc.horarioFechamento }, "Distribuição: fora do horário");
      return null; // Fora do expediente
    }
  }

  // ─── 2. Buscar atendentes disponíveis (ativos + recebe leads + online) ─
  const dezMinAtras = new Date(Date.now() - 10 * 60 * 1000);

  const atendentes = await db.select()
    .from(colaboradores)
    .where(and(
      eq(colaboradores.escritorioId, escritorioId),
      eq(colaboradores.ativo, true),
      eq(colaboradores.recebeLeadsAutomaticos, true),
    ));

  if (atendentes.length === 0) return null;

  // Filtrar apenas quem está online (heartbeat nos últimos 10 min)
  const online = atendentes.filter(at => {
    if (!at.ultimaAtividade) return false;
    return new Date(at.ultimaAtividade) >= dezMinAtras;
  });

  // Se ninguém online, usar todos os ativos como fallback
  // (melhor distribuir para alguém do que deixar sem atendente)
  const candidatos = online.length > 0 ? online : atendentes;

  // ─── 3. Priorizar atendente anterior do mesmo cliente ──────────────────
  if (contatoId) {
    const [convAnterior] = await db.select()
      .from(conversas)
      .where(and(
        eq(conversas.escritorioId, escritorioId),
        eq(conversas.contatoId, contatoId),
        sql`atendenteIdConv IS NOT NULL`,
      ))
      .orderBy(desc(conversas.createdAt))
      .limit(1);

    if (convAnterior?.atendenteId) {
      const anteriorDisponivel = candidatos.find(c => c.id === convAnterior.atendenteId);
      if (anteriorDisponivel) {
        // Verificar se não está sobrecarregado
        const [cargaAnterior] = await db.select({ count: sql<number>`COUNT(*)` })
          .from(conversas)
          .where(and(
            eq(conversas.escritorioId, escritorioId),
            eq(conversas.atendenteId, convAnterior.atendenteId),
            or(eq(conversas.status, "aguardando"), eq(conversas.status, "em_atendimento")),
          ));

        const carga = Number((cargaAnterior as { count: number } | undefined)?.count || 0);
        const max = anteriorDisponivel.maxAtendimentosSimultaneos || 5;

        if (carga < max) {
          log.info({ atendenteId: anteriorDisponivel.id }, "Distribuição: retornando ao atendente anterior");
          await marcarDistribuicao(db, anteriorDisponivel.id);
          return anteriorDisponivel.id;
        }
      }
    }
  }

  // ─── 4. Calcular carga de cada candidato ───────────────────────────────
  const cargas: {
    id: number;
    carga: number;
    proporcional: number;
    ultimaDist: Date | null;
    estaOnline: boolean;
  }[] = [];

  // Query única para contar conversas abertas de TODOS os candidatos (evita N+1)
  const candidatoIds = candidatos.map(c => c.id);
  const cargaMap: Record<number, number> = {};

  if (candidatoIds.length > 0) {
    const cargasDb = await db.select({
      atendenteId: conversas.atendenteId,
      carga: sql<number>`COUNT(*)`,
    }).from(conversas)
      .where(and(
        eq(conversas.escritorioId, escritorioId),
        sql`atendenteIdConv IN (${sql.join(candidatoIds.map(id => sql`${id}`), sql`, `)})`,
        or(eq(conversas.status, "aguardando"), eq(conversas.status, "em_atendimento")),
      ))
      .groupBy(conversas.atendenteId);

    for (const r of cargasDb) if (r.atendenteId) cargaMap[r.atendenteId] = Number(r.carga);
  }

  for (const at of candidatos) {
    const carga = cargaMap[at.id] || 0;
    const max = at.maxAtendimentosSimultaneos || 5;

    if (carga >= max) continue; // Sobrecarregado

    cargas.push({
      id: at.id,
      carga,
      proporcional: carga / max,
      ultimaDist: at.ultimaDistribuicao ? new Date(at.ultimaDistribuicao) : null,
      estaOnline: at.ultimaAtividade ? new Date(at.ultimaAtividade) >= dezMinAtras : false,
    });
  }

  if (cargas.length === 0) return null; // Todos sobrecarregados

  // ─── 5. Ordenação inteligente ──────────────────────────────────────────
  // Prioridade: online primeiro → menor carga proporcional → quem recebeu há mais tempo
  cargas.sort((a, b) => {
    // Online tem prioridade
    if (a.estaOnline !== b.estaOnline) return a.estaOnline ? -1 : 1;
    // Menor carga proporcional
    if (Math.abs(a.proporcional - b.proporcional) > 0.1) return a.proporcional - b.proporcional;
    // Desempate: quem recebeu distribuição há mais tempo (round-robin real)
    const aTime = a.ultimaDist?.getTime() || 0;
    const bTime = b.ultimaDist?.getTime() || 0;
    return aTime - bTime; // Menor tempo = recebeu há mais tempo = prioridade
  });

  const escolhido = cargas[0];
  log.info({ colaboradorId: escolhido.id, carga: escolhido.carga, online: escolhido.estaOnline }, "Distribuição: lead atribuído");

  await marcarDistribuicao(db, escolhido.id);
  return escolhido.id;
}

/** Marca o momento da distribuição para round-robin justo */
async function marcarDistribuicao(db: any, colaboradorId: number) {
  try {
    await db.update(colaboradores)
      .set({ ultimaDistribuicao: new Date() })
      .where(eq(colaboradores.id, colaboradorId));
  } catch { /* best-effort */ }
}

/** Registra heartbeat do colaborador (chamar a cada ação no frontend) */
export async function registrarAtividadeColaborador(colaboradorId: number) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(colaboradores)
      .set({ ultimaAtividade: new Date() })
      .where(eq(colaboradores.id, colaboradorId));
  } catch { /* best-effort */ }
}

/** Converte "HH:MM" para minutos desde meia-noite */
function parseHorario(h: string): number {
  const [hh, mm] = h.split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
}


// ─── Métricas Detalhadas do Dashboard Atendimento ────────────────────────────

export async function obterMetricasDetalhadas(escritorioId: number) {
  const db = await getDb();
  if (!db) return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  // Mensagens hoje (entrada/saída)
  const msgsHoje = await db.select({
    direcao: mensagens.direcao,
    total: sql<number>`COUNT(*)`,
  }).from(mensagens)
    .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
    .where(and(eq(conversas.escritorioId, escritorioId), sql`createdAtMsg >= CURDATE()`))
    .groupBy(mensagens.direcao);

  const msgsEntradaHoje = Number(msgsHoje.find(m => m.direcao === "entrada")?.total || 0);
  const msgsSaidaHoje = Number(msgsHoje.find(m => m.direcao === "saida")?.total || 0);

  // Conversas por status
  const statusRows = await db.select({
    status: conversas.status,
    total: sql<number>`COUNT(*)`,
  }).from(conversas)
    .where(eq(conversas.escritorioId, escritorioId))
    .groupBy(conversas.status);

  const porStatus: Record<string, number> = {};
  for (const r of statusRows) porStatus[r.status as string] = Number(r.total);

  // Conversas resolvidas hoje
  const [resolvidasHoje] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(conversas)
    .where(and(
      eq(conversas.escritorioId, escritorioId),
      eq(conversas.status, "resolvido"),
      sql`updatedAtConv >= CURDATE()`,
    ));

  // Novas conversas hoje
  const [novasHoje] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(conversas)
    .where(and(eq(conversas.escritorioId, escritorioId), sql`createdAtConv >= CURDATE()`));

  // Mensagens por canal (últimos 7 dias)
  const porCanal = await db.select({
    canalId: conversas.canalId,
    total: sql<number>`COUNT(*)`,
  }).from(mensagens)
    .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
    .where(and(eq(conversas.escritorioId, escritorioId), sql`createdAtMsg >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`))
    .groupBy(conversas.canalId);

  // Nomes dos canais
  const canaisIds = porCanal.map(c => c.canalId).filter(Boolean);
  const canaisMap: Record<number, string> = {};
  if (canaisIds.length > 0) {
    for (const cid of canaisIds) {
      const [canal] = await db.select({ nome: canaisIntegrados.nome, tipo: canaisIntegrados.tipo })
        .from(canaisIntegrados).where(eq(canaisIntegrados.id, cid!)).limit(1);
      if (canal) canaisMap[cid!] = canal.nome || canal.tipo || `Canal ${cid}`;
    }
  }

  // Ranking de atendentes (conversas resolvidas nos últimos 30 dias)
  const rankingRows = await db.select({
    atendenteId: conversas.atendenteId,
    resolvidas: sql<number>`SUM(CASE WHEN statusConv = 'resolvido' THEN 1 ELSE 0 END)`,
    emAtendimento: sql<number>`SUM(CASE WHEN statusConv = 'em_atendimento' THEN 1 ELSE 0 END)`,
    total: sql<number>`COUNT(*)`,
  }).from(conversas)
    .where(and(
      eq(conversas.escritorioId, escritorioId),
      sql`atendenteIdConv IS NOT NULL`,
      sql`createdAtConv >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
    ))
    .groupBy(conversas.atendenteId);

  // Nomes dos atendentes — busca todos de uma vez (evita N+1)
  const atendenteIds = rankingRows.map(r => r.atendenteId).filter(Boolean) as number[];
  const colabMap: Record<number, { nome: string; online: boolean }> = {};
  if (atendenteIds.length > 0) {
    const allColabs = await db.select().from(colaboradores).where(sql`id IN (${sql.join(atendenteIds.map(id => sql`${id}`), sql`, `)})`);
    const userIds = allColabs.map(c => c.userId);
    const allUsers = userIds.length > 0 ? await db.select({ id: users.id, name: users.name }).from(users).where(sql`id IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`) : [];
    const userMap: Record<number, string> = {};
    for (const u of allUsers) userMap[u.id] = u.name || "Sem nome";
    for (const c of allColabs) {
      colabMap[c.id] = { nome: userMap[c.userId] || "Sem nome", online: c.ultimaAtividade ? (new Date(c.ultimaAtividade).getTime() > Date.now() - 10 * 60 * 1000) : false };
    }
  }

  const ranking = rankingRows.filter(r => r.atendenteId).map(r => ({
    id: r.atendenteId!,
    nome: colabMap[r.atendenteId!]?.nome || "Sem nome",
    resolvidas: Number(r.resolvidas || 0),
    emAtendimento: Number(r.emAtendimento || 0),
    total: Number(r.total || 0),
    online: colabMap[r.atendenteId!]?.online || false,
  }));
  ranking.sort((a, b) => b.resolvidas - a.resolvidas);

  // Tempo médio de primeira resposta (últimos 7 dias, em minutos)
  // Simplificado: diferença entre createdAtConv e primeira msg de saída
  const [tmr] = await db.select({
    avg: sql<number>`AVG(TIMESTAMPDIFF(MINUTE, c.createdAtConv, m.createdAtMsg))`,
  }).from(sql`(
    SELECT c.id as conv_id, c.createdAtConv, MIN(m.createdAtMsg) as createdAtMsg
    FROM conversas c
    JOIN mensagens m ON m.conversaIdMsg = c.id AND m.direcaoMsg = 'saida'
    WHERE c.escritorioIdConv = ${escritorioId}
    AND c.createdAtConv >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    GROUP BY c.id, c.createdAtConv
  ) sub`);

  const tempoMedioResposta = Math.round(Number((tmr as any)?.avg || 0));

  return {
    msgsEntradaHoje,
    msgsSaidaHoje,
    msgsTotalHoje: msgsEntradaHoje + msgsSaidaHoje,
    conversasPorStatus: porStatus,
    resolvidasHoje: Number((resolvidasHoje as { count: number } | undefined)?.count || 0),
    novasHoje: Number((novasHoje as { count: number } | undefined)?.count || 0),
    porCanal: porCanal.map(c => ({
      canalId: c.canalId,
      nome: canaisMap[c.canalId!] || `Canal ${c.canalId}`,
      total: Number(c.total),
    })),
    ranking,
    tempoMedioResposta,
  };
}
