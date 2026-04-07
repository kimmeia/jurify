/**
 * Cache de taxas médias do BACEN.
 *
 * v4:
 * - Validação rigorosa do cache: rejeita valores absurdos
 * - Cache usa dataReferencia REAL da API (não a dataContrato)
 * - Limites de taxa por modalidade para detectar dados corrompidos
 * - Cache expira em 30 dias (createdAt) para re-buscar dados atualizados
 */

import { eq, and, gt } from "drizzle-orm";
import { getDb } from "../db";
import { taxasMediasBacen } from "../../drizzle/schema";
import type { ModalidadeCredito, TipoPessoa, TipoVinculoConsignado } from "../../shared/financiamento-types";
import { getCodigoSgs } from "../../shared/financiamento-types";
import { buscarTaxaMediaBACEN, anualParaMensal } from "./bcb-taxas-medias";
import { createLogger } from "../_core/logger";
const log = createLogger("calculos-db-taxas-medias");

/** Cache expira após 30 dias */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Limites máximos de taxa MENSAL por modalidade (% a.m.).
 * Se o cache retorna valor acima disto, está corrompido.
 */
const LIMITES_TAXA_MENSAL: Record<string, number> = {
  credito_pessoal: 15,
  consignado: 5,
  financiamento_veiculo: 5,
  financiamento_imobiliario: 3,
  cartao_credito: 20,
  cheque_especial: 15,
  capital_giro: 8,
};

/**
 * Valida se os valores do cache são razoáveis.
 */
function validarCacheEntry(taxaMensal: number, taxaAnual: number, modalidade: string): boolean {
  if (taxaMensal <= 0 || taxaAnual <= 0) return false;

  const limite = LIMITES_TAXA_MENSAL[modalidade] ?? 20;
  if (taxaMensal > limite) {
    log.warn(`[cache] Taxa mensal ${taxaMensal}% excede limite ${limite}% para ${modalidade} — cache corrompido`);
    return false;
  }

  // Verificar coerência mensal/anual
  const anualCalculada = (Math.pow(1 + taxaMensal / 100, 12) - 1) * 100;
  const diff = Math.abs(anualCalculada - taxaAnual);
  if (diff > 5) {
    log.warn(`[cache] Incoerência mensal/anual: ${taxaMensal}% → ${anualCalculada.toFixed(2)}% vs ${taxaAnual}% — cache corrompido`);
    return false;
  }

  return true;
}

/**
 * Busca taxa média no cache local. Se não existir, estiver expirado ou corrompido,
 * consulta o BACEN e armazena/atualiza.
 */
export async function obterTaxaMedia(
  modalidade: ModalidadeCredito,
  dataContrato: string, // YYYY-MM-DD
  tipoPessoa?: TipoPessoa,
  tipoVinculoConsignado?: TipoVinculoConsignado
): Promise<{ taxaMensal: number; taxaAnual: number; dataReferencia: string; fonte: "cache" | "bacen" }> {
  const db = await getDb();
  const codigoSgs = getCodigoSgs(modalidade, tipoPessoa, tipoVinculoConsignado);

  // 1. Tentar buscar no cache (válido e não expirado)
  if (db) {
    try {
      const expiraEm = new Date(Date.now() - CACHE_TTL_MS);

      const cached = await db
        .select()
        .from(taxasMediasBacen)
        .where(
          and(
            eq(taxasMediasBacen.modalidade, modalidade),
            eq(taxasMediasBacen.codigoSgs, codigoSgs),
            eq(taxasMediasBacen.data, dataContrato),
            gt(taxasMediasBacen.createdAt, expiraEm)
          )
        )
        .limit(1);

      if (cached.length > 0) {
        const row = cached[0];
        const taxaMensal = parseFloat(row.taxaMensal);
        const taxaAnual = row.taxaAnual ? parseFloat(row.taxaAnual) : 0;

        // Validação rigorosa do cache
        if (validarCacheEntry(taxaMensal, taxaAnual, modalidade)) {
          log.info(`[cache] Hit: ${modalidade}/${dataContrato} (SGS ${codigoSgs}) → ${taxaAnual}% a.a. (${taxaMensal}% a.m.)`);
          return {
            taxaMensal,
            taxaAnual,
            dataReferencia: row.data,
            fonte: "cache",
          };
        } else {
          // Cache corrompido: deletar e re-buscar
          log.warn(`[cache] Valor corrompido para ${modalidade}/${dataContrato}, deletando e re-buscando...`);
          await db
            .delete(taxasMediasBacen)
            .where(
              and(
                eq(taxasMediasBacen.modalidade, modalidade),
                eq(taxasMediasBacen.codigoSgs, codigoSgs),
                eq(taxasMediasBacen.data, dataContrato)
              )
            );
        }
      }
    } catch (e) {
      log.warn({ err: String(e) }, "Erro ao buscar cache de taxas");
    }
  }

  // 2. Buscar na API do BACEN (pode lançar erro se data futura ou dados inválidos)
  const resultado = await buscarTaxaMediaBACEN(modalidade, dataContrato, tipoPessoa, tipoVinculoConsignado);

  // 3. Validar antes de salvar no cache
  if (db && validarCacheEntry(resultado.taxaMensal, resultado.taxaAnual, modalidade)) {
    try {
      // Deletar cache antigo para esta modalidade/data/sgs (se existir)
      await db
        .delete(taxasMediasBacen)
        .where(
          and(
            eq(taxasMediasBacen.modalidade, modalidade),
            eq(taxasMediasBacen.codigoSgs, codigoSgs),
            eq(taxasMediasBacen.data, dataContrato)
          )
        );

      // Inserir novo
      await db.insert(taxasMediasBacen).values({
        modalidade,
        codigoSgs,
        data: dataContrato,
        taxaMensal: resultado.taxaMensal.toString(),
        taxaAnual: resultado.taxaAnual.toString(),
      });

      log.info(`[cache] Saved: ${modalidade}/${dataContrato} (SGS ${codigoSgs}) → ${resultado.taxaAnual}% a.a. (${resultado.taxaMensal}% a.m.)`);
    } catch (e) {
      log.warn({ err: String(e) }, "Erro ao salvar cache de taxas");
    }
  }

  return { ...resultado, fonte: "bacen" };
}
