/**
 * Cobrança por módulo — catálogo de preços, módulos avulsos por escritório
 * e composição da fatura (cena 1 do mockup aprovado da modularização).
 *
 * Avulsos moram em `escritorio_addons` com produto "modulo:<slug>" — mesma
 * tabela do add-on JurisIA, mesma semântica de status/vigência/preço
 * congelado na concessão. O preço do catálogo é só o DEFAULT sugerido na
 * hora de conceder; a linha do escritório é a fonte da cobrança.
 */

import { and, eq, like } from "drizzle-orm";
import { getDb } from "../db";
import { colaboradores, escritorioAddons, escritorios, modulosCatalogo } from "../../drizzle/schema";
import { MODULOS_APP, ehModuloValido } from "@shared/modulos-app";
import {
  PRODUTO_MODULO_PREFIXO,
  avulsoVigente,
  calcularFatura,
  moduloParaProduto,
  produtoParaModulo,
  type DescontoEscritorio,
  type FaturaCalculada,
} from "@shared/fatura-modulos";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export interface ModuloCatalogoItem {
  id: string;
  nome: string;
  descricao: string;
  precoMensalCentavos: number;
}

/** Módulos vendáveis (obrigatórios ficam de fora: não têm preço) × preços gravados. */
export async function listarCatalogoModulos(): Promise<ModuloCatalogoItem[]> {
  const db = await getDb();
  const precos = new Map<string, number>();
  if (db) {
    const rows = await db.select().from(modulosCatalogo);
    for (const r of rows) precos.set(r.modulo, r.precoMensalCentavos);
  }
  return MODULOS_APP.filter((m) => !m.obrigatorio).map((m) => ({
    id: m.id,
    nome: m.nome,
    descricao: m.descricao,
    precoMensalCentavos: precos.get(m.id) ?? 0,
  }));
}

export async function salvarPrecoModulo(args: {
  modulo: string;
  precoMensalCentavos: number;
  atualizadoPor: number;
}): Promise<void> {
  if (!ehModuloValido(args.modulo)) throw new Error(`Módulo desconhecido: ${args.modulo}`);
  const def = MODULOS_APP.find((m) => m.id === args.modulo);
  if (def?.obrigatorio) throw new Error("Módulo obrigatório não tem preço — já vem em todo plano.");

  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");
  const preco = Math.max(0, Math.trunc(args.precoMensalCentavos));
  await db
    .insert(modulosCatalogo)
    .values({ modulo: args.modulo, precoMensalCentavos: preco, atualizadoPor: args.atualizadoPor })
    .onDuplicateKeyUpdate({
      set: { precoMensalCentavos: preco, atualizadoPor: args.atualizadoPor },
    });
}

export interface ModuloAvulsoRegistro {
  modulo: string;
  nome: string;
  status: string;
  precoCentavos: number;
  inicioEm: string | null;
  expiraEm: string | null;
  observacao: string | null;
  vigente: boolean;
}

export async function listarAvulsosDoEscritorio(
  escritorioId: number,
  agoraMs = Date.now(),
): Promise<ModuloAvulsoRegistro[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(escritorioAddons)
    .where(and(
      eq(escritorioAddons.escritorioId, escritorioId),
      like(escritorioAddons.produto, `${PRODUTO_MODULO_PREFIXO}%`),
    ));

  const registros: ModuloAvulsoRegistro[] = [];
  for (const row of rows) {
    const modulo = produtoParaModulo(row.produto);
    if (!modulo || !ehModuloValido(modulo)) continue;
    const registro = {
      modulo,
      nome: MODULOS_APP.find((m) => m.id === modulo)?.nome ?? modulo,
      status: row.status,
      precoCentavos: row.precoCentavos,
      inicioEm: iso(row.inicioEm),
      expiraEm: iso(row.expiraEm),
      observacao: row.observacao,
      vigente: false,
    };
    registro.vigente = avulsoVigente(registro, agoraMs);
    registros.push(registro);
  }
  return registros;
}

/** Slugs dos módulos avulsos valendo agora — o que o porteiro soma ao plano. */
export async function modulosAvulsosVigentes(escritorioId: number): Promise<string[]> {
  const avulsos = await listarAvulsosDoEscritorio(escritorioId);
  return avulsos.filter((a) => a.vigente).map((a) => a.modulo);
}

export async function salvarModuloAvulso(args: {
  escritorioId: number;
  modulo: string;
  status: "ativo" | "suspenso" | "cancelado";
  precoCentavos: number;
  expiraEm: Date | null;
  observacao: string | null;
  concedidoPor: number;
}): Promise<void> {
  if (!ehModuloValido(args.modulo)) throw new Error(`Módulo desconhecido: ${args.modulo}`);
  const def = MODULOS_APP.find((m) => m.id === args.modulo);
  if (def?.obrigatorio) throw new Error("Módulo obrigatório já vem em todo plano.");

  const { salvarAddon } = await import("./addons-repo");
  await salvarAddon({
    escritorioId: args.escritorioId,
    produto: moduloParaProduto(args.modulo),
    status: args.status,
    limiteMensal: 0,
    inicioEm: null,
    expiraEm: args.expiraEm,
    precoCentavos: args.precoCentavos,
    observacao: args.observacao,
    concedidoPor: args.concedidoPor,
  });
}

export async function atendentesAtivosDoEscritorio(escritorioId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ id: colaboradores.id })
    .from(colaboradores)
    .where(and(eq(colaboradores.escritorioId, escritorioId), eq(colaboradores.ativo, true)));
  return rows.length;
}

export interface FaturaEscritorio extends FaturaCalculada {
  planoSlug: string | null;
  planoNome: string | null;
  /** Cesta do plano — o dialog de avulso não oferece o que já está incluso. */
  modulosDoPlano: string[];
  atendentesAtivos: number;
  atendentesInclusos: number | null;
  precoAtendenteAdicionalCentavos: number;
  desconto: (DescontoEscritorio & { observacao: string | null }) | null;
  cortesia: boolean;
  /** Valor fechado na conversa (assinatura sob consulta), quando existe. */
  valorNegociadoCentavos: number | null;
}

/**
 * Fatura mensal composta do escritório — o que o admin vê no painel e o
 * número que pode ser aplicado na assinatura Asaas. Sem plano resolvido
 * (cortesia, trial sem plano) a fatura sai zerada com o motivo no shape.
 */
export async function faturaDoEscritorio(escritorioId: number): Promise<FaturaEscritorio> {
  const agoraMs = Date.now();
  const db = await getDb();

  let desconto: (DescontoEscritorio & { observacao: string | null }) | null = null;
  let ownerId: number | null = null;
  if (db) {
    const [esc] = await db
      .select({
        ownerId: escritorios.ownerId,
        descontoTipo: escritorios.descontoTipo,
        descontoValor: escritorios.descontoValor,
        descontoValidoAte: escritorios.descontoValidoAte,
        descontoObservacao: escritorios.descontoObservacao,
      })
      .from(escritorios)
      .where(eq(escritorios.id, escritorioId))
      .limit(1);
    if (esc) {
      ownerId = esc.ownerId;
      if (esc.descontoTipo === "percentual" || esc.descontoTipo === "fixo") {
        desconto = {
          tipo: esc.descontoTipo,
          valor: esc.descontoValor,
          validoAte: iso(esc.descontoValidoAte),
          observacao: esc.descontoObservacao,
        };
      }
    }
  }

  let planoSlug: string | null = null;
  let cortesia = false;
  let valorNegociadoCentavos: number | null = null;
  if (ownerId != null) {
    const { getActiveSubscriptionComHeranca } = await import("../db");
    const sub = await getActiveSubscriptionComHeranca(ownerId);
    planoSlug = sub?.planId ?? null;
    cortesia = Boolean(sub?.cortesia);
    valorNegociadoCentavos = sub?.valorNegociadoCentavos ?? null;
  }

  const { getPlanoBySlug } = await import("./planos-repo");
  const plano = planoSlug ? await getPlanoBySlug(planoSlug) : null;

  const avulsos = (await listarAvulsosDoEscritorio(escritorioId, agoraMs)).filter((a) => a.vigente);
  const atendentesAtivos = await atendentesAtivosDoEscritorio(escritorioId);

  const fatura = calcularFatura({
    nomePlano: plano?.nome ?? planoSlug ?? "sem plano",
    precoPacoteCentavos: plano?.precoMensalCentavos ?? 0,
    valorNegociadoCentavos,
    avulsos: avulsos.map((a) => ({ modulo: a.modulo, nome: a.nome, precoCentavos: a.precoCentavos })),
    atendentesAtivos,
    atendentesInclusos: plano?.atendentesInclusos ?? null,
    precoAtendenteAdicionalCentavos: plano?.precoAtendenteAdicionalCentavos ?? 0,
    desconto,
    agoraMs,
  });

  return {
    ...fatura,
    planoSlug,
    planoNome: plano?.nome ?? null,
    modulosDoPlano: plano?.modulosLiberados ?? [],
    atendentesAtivos,
    atendentesInclusos: plano?.atendentesInclusos ?? null,
    precoAtendenteAdicionalCentavos: plano?.precoAtendenteAdicionalCentavos ?? 0,
    desconto,
    cortesia,
    valorNegociadoCentavos,
  };
}
