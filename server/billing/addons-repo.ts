/**
 * Leitura e escrita dos add-ons contratados à parte.
 *
 * A decisão de quem tem acesso NÃO mora aqui — mora em
 * `shared/addon-jurisia.ts`, que é puro e testado. Este arquivo só busca as
 * duas pontas (plano e add-on) e entrega pra ela decidir.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { escritorioAddons } from "../../drizzle/schema";
import {
  MODULO_JURISIA,
  resolverAcessoJurisIA,
  type AcessoJurisIA,
  type AddonParaAcesso,
  type PlanoParaAcesso,
  type StatusAddon,
} from "../../shared/addon-jurisia";

export interface AddonRegistro extends AddonParaAcesso {
  id: number;
  produto: string;
  precoCentavos: number;
  observacao: string | null;
  atualizadoEm: string | null;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export async function buscarAddon(
  escritorioId: number,
  produto: string,
): Promise<AddonRegistro | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(escritorioAddons)
    .where(and(
      eq(escritorioAddons.escritorioId, escritorioId),
      eq(escritorioAddons.produto, produto),
    ))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    produto: row.produto,
    status: row.status as StatusAddon,
    limiteMensal: row.limiteMensal,
    inicioEm: iso(row.inicioEm),
    expiraEm: iso(row.expiraEm),
    precoCentavos: row.precoCentavos,
    observacao: row.observacao,
    atualizadoEm: iso(row.atualizadoEm),
  };
}

/**
 * Acesso ao JurisIA de um escritório, considerando plano E add-on.
 *
 * `planSlug` null significa sem assinatura ativa — o add-on ainda pode
 * liberar, e é justamente o caso do piloto e da cortesia.
 */
export async function acessoJurisIA(args: {
  escritorioId: number;
  planSlug: string | null;
  agora?: Date;
}): Promise<AcessoJurisIA> {
  let plano: PlanoParaAcesso | null = null;
  if (args.planSlug) {
    const { getPlanoBySlug } = await import("./planos-repo");
    const p = await getPlanoBySlug(args.planSlug);
    if (p) {
      plano = {
        modulos: p.modulosLiberados ?? [],
        jurisiaMensagensMes: p.limites.jurisiaMensagensMes ?? 0,
      };
    }
  }

  const addon = await buscarAddon(args.escritorioId, MODULO_JURISIA);
  return resolverAcessoJurisIA({ plano, addon, agora: args.agora ?? new Date() });
}

/**
 * Plano vigente de um escritório, pela assinatura do DONO.
 *
 * É o dono quem assina; colaborador herda. Ler a assinatura de um colaborador
 * qualquer daria "sem plano" num escritório que paga em dia.
 */
export async function getEscritorioPlanSlug(escritorioId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const { escritorios } = await import("../../drizzle/schema");
  const [esc] = await db
    .select({ ownerId: escritorios.ownerId })
    .from(escritorios)
    .where(eq(escritorios.id, escritorioId))
    .limit(1);
  if (!esc?.ownerId) return null;

  const { getActiveSubscriptionComHeranca } = await import("../db");
  const sub = await getActiveSubscriptionComHeranca(esc.ownerId);
  return sub?.planId ?? null;
}

export interface SalvarAddonArgs {
  escritorioId: number;
  produto: string;
  status: StatusAddon;
  limiteMensal: number;
  inicioEm: Date | null;
  expiraEm: Date | null;
  precoCentavos: number;
  observacao: string | null;
  concedidoPor: number | null;
}

/** Cria ou atualiza — o índice único (escritório, produto) garante um só. */
export async function salvarAddon(args: SalvarAddonArgs): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");

  const valores = {
    escritorioId: args.escritorioId,
    produto: args.produto,
    status: args.status,
    limiteMensal: Math.max(0, Math.trunc(args.limiteMensal)),
    inicioEm: args.inicioEm,
    expiraEm: args.expiraEm,
    precoCentavos: Math.max(0, Math.trunc(args.precoCentavos)),
    observacao: args.observacao,
    concedidoPor: args.concedidoPor,
  };

  await db
    .insert(escritorioAddons)
    .values(valores)
    .onDuplicateKeyUpdate({
      set: {
        status: valores.status,
        limiteMensal: valores.limiteMensal,
        inicioEm: valores.inicioEm,
        expiraEm: valores.expiraEm,
        precoCentavos: valores.precoCentavos,
        observacao: valores.observacao,
        concedidoPor: valores.concedidoPor,
      },
    });
}

/** Todos os escritórios com add-on de um produto — a lista do painel admin. */
export async function listarAddons(produto: string) {
  const db = await getDb();
  if (!db) return [];
  const { escritorios } = await import("../../drizzle/schema");
  return db
    .select({
      escritorioId: escritorioAddons.escritorioId,
      escritorioNome: escritorios.nome,
      status: escritorioAddons.status,
      limiteMensal: escritorioAddons.limiteMensal,
      inicioEm: escritorioAddons.inicioEm,
      expiraEm: escritorioAddons.expiraEm,
      precoCentavos: escritorioAddons.precoCentavos,
      observacao: escritorioAddons.observacao,
      atualizadoEm: escritorioAddons.atualizadoEm,
    })
    .from(escritorioAddons)
    .innerJoin(escritorios, eq(escritorios.id, escritorioAddons.escritorioId))
    .where(eq(escritorioAddons.produto, produto))
    .orderBy(escritorioAddons.status, escritorios.nome);
}
