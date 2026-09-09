/**
 * Um número, um cadastro.
 *
 * O WhatsApp cria uma ficha magra (nome do perfil, telefone e mais nada) na
 * primeira mensagem. Quando o escritório cadastra a pessoa de verdade, a
 * conversa continuava presa à ficha magra — e a resposta continuava saindo
 * pro endereço do primeiro contato, mesmo quando o cliente passava a
 * escrever de outro identificador (o número sem o 9, por exemplo).
 *
 * Aqui mora o que corrige isso na chegada de cada mensagem:
 *  - o endereço de resposta da conversa acompanha de onde o cliente escreveu;
 *  - ficha magra com cadastro completo do mesmo número é absorvida por ele,
 *    com registro reversível por 7 dias (`contatos_unificacoes`).
 *
 * As regras puras (o que é ficha magra, quem sobrevive, como agrupar por
 * número) ficam exportadas pra tela de duplicados usar a MESMA régua.
 */

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { clienteProcessos, contatos, contatosUnificacoes, conversas } from "../../drizzle/schema";
import { isLidJid } from "../../shared/whatsapp-types";
import { chaveTelefoneBR } from "../../shared/telefone";
import { createLogger } from "../_core/logger";

const log = createLogger("reconhecer-cadastro");

export const JANELA_DESFAZER_MS = 7 * 24 * 60 * 60 * 1000;

export type FichaIdentidade = {
  id: number;
  cpfCnpj: string | null;
  email: string | null;
  estagio: string;
  createdAt: Date | string | null;
};

/**
 * Mesma régua do "Vincular a cliente": ficha magra é a que nasceu no
 * atendimento e não identifica ninguém — sem CPF, sem e-mail, ainda lead e
 * sem processo. Qualquer um desses quatro sinais faz dela um cadastro de
 * verdade, que nunca é absorvido sozinho.
 */
export function ehFichaMagra(
  c: { cpfCnpj: string | null; email: string | null; estagio: string },
  temProcesso: boolean,
): boolean {
  return !c.cpfCnpj?.trim() && !c.email?.trim() && c.estagio === "lead" && !temProcesso;
}

function instante(v: Date | string | null | undefined): number {
  if (!v) return Number.POSITIVE_INFINITY;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Decisão do dono: sobrevive a ficha com CPF; em empate, a mais antiga. */
export function escolherSobrevivente<T extends FichaIdentidade>(a: T, b: T): { principal: T; duplicado: T } {
  const aCpf = !!a.cpfCnpj?.trim();
  const bCpf = !!b.cpfCnpj?.trim();
  if (aCpf !== bCpf) return aCpf ? { principal: a, duplicado: b } : { principal: b, duplicado: a };
  const ta = instante(a.createdAt);
  const tb = instante(b.createdAt);
  if (ta !== tb) return ta < tb ? { principal: a, duplicado: b } : { principal: b, duplicado: a };
  return a.id <= b.id ? { principal: a, duplicado: b } : { principal: b, duplicado: a };
}

/** Grupos de fichas que apontam pro mesmo telefone (DDD + 8 dígitos); só com 2 ou mais. */
export function agruparPorTelefone<T extends { id: number; telefone: string | null }>(
  lista: T[],
): Array<{ chave: string; contatos: T[] }> {
  const grupos = new Map<string, T[]>();
  for (const c of lista) {
    const chave = chaveTelefoneBR(c.telefone);
    if (!chave) continue;
    const g = grupos.get(chave) ?? [];
    g.push(c);
    grupos.set(chave, g);
  }
  return [...grupos.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([chave, g]) => ({ chave, contatos: g }))
    .sort((a, b) => b.contatos.length - a.contatos.length || a.chave.localeCompare(b.chave));
}

const JID_TELEFONE = /^\d{10,15}@s\.whatsapp\.net$/;

/**
 * O endereço de resposta da conversa passa a ser de onde o cliente escreveu.
 * Só pra identificador que é telefone: @lid é opaco e o envio já sabe cair
 * no telefone do cadastro nesse caso.
 */
export async function atualizarEnderecoDeResposta(
  db: any,
  opts: { escritorioId: number; conversaId: number; chatId: string | null | undefined },
): Promise<boolean> {
  const chatId = opts.chatId || "";
  if (!chatId || isLidJid(chatId) || !JID_TELEFONE.test(chatId)) return false;
  const [conv] = await db
    .select({ chatIdExterno: conversas.chatIdExterno })
    .from(conversas)
    .where(and(eq(conversas.id, opts.conversaId), eq(conversas.escritorioId, opts.escritorioId)))
    .limit(1);
  if (!conv || conv.chatIdExterno === chatId) return false;
  await db
    .update(conversas)
    .set({ chatIdExterno: chatId })
    .where(and(eq(conversas.id, opts.conversaId), eq(conversas.escritorioId, opts.escritorioId)));
  log.info({ conversaId: opts.conversaId, de: conv.chatIdExterno, para: chatId }, "[Cadastro] endereço de resposta atualizado");
  return true;
}

async function temProcesso(db: any, escritorioId: number, contatoId: number): Promise<boolean> {
  const [p] = await db
    .select({ id: clienteProcessos.id })
    .from(clienteProcessos)
    .where(and(eq(clienteProcessos.contatoId, contatoId), eq(clienteProcessos.escritorioId, escritorioId)))
    .limit(1);
  return !!p;
}

/**
 * Chamado a cada mensagem recebida, depois que conversa e contato foram
 * resolvidos. Devolve o contato que a mensagem deve seguir usando — o mesmo
 * de antes, ou o cadastro completo que absorveu a ficha magra.
 */
export async function reconhecerCadastroNaEntrada(
  db: any,
  opts: {
    escritorioId: number;
    conversaId: number;
    contatoId: number;
    chatId: string | null | undefined;
    telefone?: string | null;
  },
): Promise<{ contatoId: number; unificacaoId: number | null; enderecoAtualizado: boolean }> {
  const enderecoAtualizado = await atualizarEnderecoDeResposta(db, opts);
  const semMudanca = { contatoId: opts.contatoId, unificacaoId: null, enderecoAtualizado };

  const [atual] = await db
    .select({
      id: contatos.id, telefone: contatos.telefone, cpfCnpj: contatos.cpfCnpj,
      email: contatos.email, estagio: contatos.estagio, createdAt: contatos.createdAt,
    })
    .from(contatos)
    .where(and(eq(contatos.id, opts.contatoId), eq(contatos.escritorioId, opts.escritorioId)))
    .limit(1);
  if (!atual) return semMudanca;
  if (!ehFichaMagra(atual, await temProcesso(db, opts.escritorioId, atual.id))) return semMudanca;

  const telefone = (opts.telefone || atual.telefone || "").replace(/\D/g, "");
  if (!telefone) return semMudanca;

  const { buscarContatosPorTelefone } = await import("./db-crm");
  const mesmoNumero = await buscarContatosPorTelefone(opts.escritorioId, telefone, { excetoId: atual.id });
  const completos: FichaIdentidade[] = [];
  for (const c of mesmoNumero) {
    if (!ehFichaMagra(c, false) || (await temProcesso(db, opts.escritorioId, c.id))) completos.push(c);
  }
  if (completos.length === 0) return semMudanca;

  const principal = completos.reduce((melhor, c) => escolherSobrevivente(melhor, c).principal);
  const { id: unificacaoId } = await unificarComRegistro(db, {
    escritorioId: opts.escritorioId,
    principalId: principal.id,
    duplicadoId: atual.id,
    origem: "automatica",
    executadoPor: null,
  });
  log.info(
    { escritorioId: opts.escritorioId, principalId: principal.id, duplicadoId: atual.id, unificacaoId },
    "[Cadastro] ficha magra absorvida pelo cadastro completo do mesmo número",
  );
  return { contatoId: principal.id, unificacaoId, enderecoAtualizado };
}

/**
 * Mesclar com memória: fotografa a ficha absorvida e os ids de tudo que
 * muda de dono ANTES de rodar o `unificarContatos` de sempre, e grava o
 * registro que o "Desfazer" lê.
 */
export async function unificarComRegistro(
  db: any,
  opts: {
    escritorioId: number;
    principalId: number;
    duplicadoId: number;
    origem: "automatica" | "manual";
    executadoPor: number | null;
  },
): Promise<{ id: number; tabelasAtualizadas: string[] }> {
  if (opts.principalId === opts.duplicadoId) throw new Error("IDs iguais");
  const { unificarContatos, TABELAS_VINCULO_CONTATO } = await import("./db-crm");

  const [principal] = await db.select().from(contatos)
    .where(and(eq(contatos.id, opts.principalId), eq(contatos.escritorioId, opts.escritorioId)))
    .limit(1);
  const [duplicado] = await db.select().from(contatos)
    .where(and(eq(contatos.id, opts.duplicadoId), eq(contatos.escritorioId, opts.escritorioId)))
    .limit(1);
  if (!principal) throw new Error("Contato principal não encontrado");
  if (!duplicado) throw new Error("Contato duplicado não encontrado");

  const movidos: Record<string, number[]> = {};
  for (const { tabela, coluna } of TABELAS_VINCULO_CONTATO) {
    try {
      const r = await db.execute(
        sql.raw(`SELECT id FROM \`${tabela}\` WHERE \`${coluna}\` = ${Number(opts.duplicadoId)}`),
      );
      const linhas: Array<{ id: unknown }> = Array.isArray((r as any)?.[0]) ? (r as any)[0] : [];
      const ids = linhas.map((l) => Number(l.id)).filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length > 0) movidos[tabela] = ids;
    } catch {
      // Tabela pode não existir (migration pendente) — o UPDATE também vai pular
    }
  }

  const principalAntes = {
    email: principal.email ?? null,
    cpfCnpj: principal.cpfCnpj ?? null,
    observacoes: principal.observacoes ?? null,
    telefonesSecundarios: principal.telefonesSecundarios ?? null,
  };

  const { tabelasAtualizadas } = await unificarContatos(opts.escritorioId, opts.principalId, opts.duplicadoId);

  const [ins] = await db.insert(contatosUnificacoes).values({
    escritorioId: opts.escritorioId,
    principalId: opts.principalId,
    duplicadoId: opts.duplicadoId,
    origem: opts.origem,
    duplicadoSnapshot: duplicado,
    principalAntes,
    movidos,
    executadoPor: opts.executadoPor,
  });
  return { id: Number((ins as any)?.insertId ?? 0), tabelasAtualizadas };
}

function comoData(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Volta a ficha absorvida com o MESMO id, devolve pra ela o que tinha mudado
 * de dono e restaura na sobrevivente os campos que a unificação copiou.
 */
export async function desfazerUnificacao(
  db: any,
  opts: { escritorioId: number; id: number; executadoPor: number | null; agoraMs?: number },
): Promise<{ principalId: number; duplicadoId: number }> {
  const agora = opts.agoraMs ?? Date.now();
  const [reg] = await db.select().from(contatosUnificacoes)
    .where(and(eq(contatosUnificacoes.id, opts.id), eq(contatosUnificacoes.escritorioId, opts.escritorioId)))
    .limit(1);
  if (!reg) throw new Error("Unificação não encontrada.");
  if (reg.desfeitaEm) throw new Error("Essa unificação já foi desfeita.");
  if (agora - instante(reg.createdAt) > JANELA_DESFAZER_MS) {
    throw new Error("O prazo de 7 dias pra desfazer essa unificação já passou.");
  }

  const [jaExiste] = await db.select({ id: contatos.id }).from(contatos)
    .where(eq(contatos.id, reg.duplicadoId))
    .limit(1);
  if (jaExiste) throw new Error("A ficha absorvida já existe de novo — nada a desfazer.");

  const snapshot = (reg.duplicadoSnapshot ?? {}) as Record<string, unknown>;
  const { createdAt, updatedAt, ...resto } = snapshot;
  await db.insert(contatos).values({
    ...resto,
    id: reg.duplicadoId,
    escritorioId: opts.escritorioId,
    createdAt: comoData(createdAt) ?? new Date(),
    updatedAt: comoData(updatedAt) ?? new Date(),
  });

  const { TABELAS_VINCULO_CONTATO } = await import("./db-crm");
  const movidos = (reg.movidos ?? {}) as Record<string, number[]>;
  for (const { tabela, coluna } of TABELAS_VINCULO_CONTATO) {
    const ids = (movidos[tabela] ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) continue;
    try {
      await db.execute(
        sql.raw(`UPDATE \`${tabela}\` SET \`${coluna}\` = ${Number(reg.duplicadoId)} WHERE id IN (${ids.join(",")})`),
      );
    } catch {
      // Tabela pode não existir (migration pendente) — seguir
    }
  }

  const antes = (reg.principalAntes ?? {}) as {
    email?: string | null; cpfCnpj?: string | null; observacoes?: string | null; telefonesSecundarios?: string | null;
  };
  await db.update(contatos)
    .set({
      email: antes.email ?? null,
      cpfCnpj: antes.cpfCnpj ?? null,
      observacoes: antes.observacoes ?? null,
      telefonesSecundarios: antes.telefonesSecundarios ?? null,
    })
    .where(and(eq(contatos.id, reg.principalId), eq(contatos.escritorioId, opts.escritorioId)));

  await db.update(contatosUnificacoes)
    .set({ desfeitaEm: new Date(agora), desfeitaPor: opts.executadoPor })
    .where(eq(contatosUnificacoes.id, reg.id));

  log.info({ unificacaoId: reg.id, principalId: reg.principalId, duplicadoId: reg.duplicadoId }, "[Cadastro] unificação desfeita");
  return { principalId: reg.principalId, duplicadoId: reg.duplicadoId };
}

export type UnificacaoRecente = {
  id: number;
  origem: "automatica" | "manual";
  createdAt: string;
  principalNome: string;
  duplicadoNome: string;
  duplicadoTelefone: string | null;
  duplicadoOrigem: string | null;
  duplicadoCriadoEm: string | null;
  contagens: { conversas: number; cobrancas: number; processos: number; leads: number; arquivos: number };
};

/** A unificação mais recente (ainda desfazível) que deixou este contato como sobrevivente. */
export async function unificacaoRecente(
  db: any,
  opts: { escritorioId: number; contatoId: number; agoraMs?: number },
): Promise<UnificacaoRecente | null> {
  const agora = opts.agoraMs ?? Date.now();
  const desde = new Date(agora - JANELA_DESFAZER_MS);
  const [reg] = await db.select().from(contatosUnificacoes)
    .where(and(
      eq(contatosUnificacoes.escritorioId, opts.escritorioId),
      eq(contatosUnificacoes.principalId, opts.contatoId),
      isNull(contatosUnificacoes.desfeitaEm),
      gte(contatosUnificacoes.createdAt, desde),
    ))
    .orderBy(desc(contatosUnificacoes.id))
    .limit(1);
  if (!reg) return null;

  const [principal] = await db.select({ nome: contatos.nome }).from(contatos)
    .where(eq(contatos.id, reg.principalId))
    .limit(1);
  const snap = (reg.duplicadoSnapshot ?? {}) as Record<string, unknown>;
  const movidos = (reg.movidos ?? {}) as Record<string, number[]>;
  const conta = (t: string) => (Array.isArray(movidos[t]) ? movidos[t].length : 0);
  const criado = comoData(reg.createdAt) ?? new Date(agora);
  const dupCriadoEm = comoData(snap.createdAt);
  return {
    id: reg.id,
    origem: reg.origem,
    createdAt: criado.toISOString(),
    principalNome: principal?.nome ?? "",
    duplicadoNome: typeof snap.nome === "string" ? snap.nome : "",
    duplicadoTelefone: typeof snap.telefone === "string" ? snap.telefone : null,
    duplicadoOrigem: typeof snap.origem === "string" ? snap.origem : null,
    duplicadoCriadoEm: dupCriadoEm ? dupCriadoEm.toISOString() : null,
    contagens: {
      conversas: conta("conversas"),
      cobrancas: conta("asaas_cobrancas"),
      processos: conta("cliente_processos"),
      leads: conta("leads"),
      arquivos: conta("cliente_arquivos"),
    },
  };
}
