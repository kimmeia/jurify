/**
 * Extras avulsos de um escritório: leitura pro enforcement e pra fatura.
 *
 * As regras puras (quais extras existem, como somam ao teto, o que significa
 * zero em cada um) moram em `shared/extras-avulsos.ts`. Aqui só se busca a
 * linha e se decide vigência, com o MESMO `avulsoVigente` dos módulos avulsos —
 * duas noções de "está valendo" na mesma tabela era o caminho certo pra cobrar
 * um mês a mais do que se entrega.
 *
 * A leitura é escopada por escritório e nunca lança: teto é decisão de
 * fail-open no produto inteiro (ver `limites-monitoramento`), e um erro de
 * consulta não pode barrar cliente pagante.
 */

import { and, eq, like } from "drizzle-orm";
import { getDb } from "../db";
import { escritorioAddons } from "../../drizzle/schema";
import { avulsoVigente } from "@shared/fatura-modulos";
import {
  PRODUTO_EXTRA_PREFIXO,
  definicaoDoExtra,
  ehChaveExtra,
  extraParaProduto,
  produtoParaExtra,
  somarAoTeto,
  type ChaveExtra,
} from "@shared/extras-avulsos";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export interface ExtraRegistro {
  chave: ChaveExtra;
  rotulo: string;
  /** Quanto a mais foi concedido (mora em `limiteMensal`). */
  quantidade: number;
  /** Preço mensal TOTAL da concessão, congelado. */
  precoCentavos: number;
  status: string;
  inicioEm: string | null;
  expiraEm: string | null;
  observacao: string | null;
  vigente: boolean;
}

/** Todas as concessões de extra do escritório, vigentes ou não (a tela mostra as duas). */
export async function listarExtrasDoEscritorio(
  escritorioId: number,
  agoraMs = Date.now(),
): Promise<ExtraRegistro[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(escritorioAddons)
    .where(and(
      eq(escritorioAddons.escritorioId, escritorioId),
      like(escritorioAddons.produto, `${PRODUTO_EXTRA_PREFIXO}%`),
    ));

  const registros: ExtraRegistro[] = [];
  for (const row of rows) {
    const chave = produtoParaExtra(row.produto);
    if (!chave) continue;
    const registro: ExtraRegistro = {
      chave,
      rotulo: definicaoDoExtra(chave)?.rotulo ?? chave,
      quantidade: row.limiteMensal,
      precoCentavos: row.precoCentavos,
      status: row.status,
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

/** Quantidade extra VIGENTE por chave. Chave ausente = nada comprado. */
export async function extrasVigentesDoEscritorio(
  escritorioId: number,
): Promise<Partial<Record<ChaveExtra, number>>> {
  try {
    const registros = await listarExtrasDoEscritorio(escritorioId);
    const mapa: Partial<Record<ChaveExtra, number>> = {};
    for (const r of registros) {
      if (!r.vigente || r.quantidade <= 0) continue;
      mapa[r.chave] = (mapa[r.chave] ?? 0) + r.quantidade;
    }
    return mapa;
  } catch {
    // Teto é fail-open: sem conseguir ler o extra, o cliente fica com o do
    // plano — nunca com menos.
    return {};
  }
}

/**
 * Teto do plano já com o extra comprado somado.
 *
 * Atalho do caminho comum, pra quem enforce não precisar conhecer a regra de
 * "o que significa zero neste teto" — ela vem da definição do extra.
 */
export async function tetoComExtra(
  escritorioId: number,
  chave: ChaveExtra,
  tetoDoPlano: number | null,
): Promise<number | null> {
  const def = definicaoDoExtra(chave);
  if (!def) return tetoDoPlano;
  const extras = await extrasVigentesDoEscritorio(escritorioId);
  return somarAoTeto(tetoDoPlano, extras[chave] ?? 0, { zeroEIlimitado: def.zeroEIlimitado });
}

export async function salvarExtraAvulso(args: {
  escritorioId: number;
  chave: string;
  quantidade: number;
  precoCentavos: number;
  status: "ativo" | "suspenso" | "cancelado";
  expiraEm: Date | null;
  observacao: string | null;
  concedidoPor: number;
}): Promise<void> {
  if (!ehChaveExtra(args.chave)) throw new Error(`Extra desconhecido: ${args.chave}`);
  const { salvarAddon } = await import("./addons-repo");
  await salvarAddon({
    escritorioId: args.escritorioId,
    produto: extraParaProduto(args.chave),
    status: args.status,
    limiteMensal: Math.max(0, Math.trunc(args.quantidade)),
    inicioEm: null,
    expiraEm: args.expiraEm,
    precoCentavos: Math.max(0, Math.trunc(args.precoCentavos)),
    observacao: args.observacao,
    concedidoPor: args.concedidoPor,
  });
}
