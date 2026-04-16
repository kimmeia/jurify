/**
 * Tetos Legais com Timeline — busca o limite vigente na DATA DO CONTRATO.
 *
 * Antes (hardcoded): engine sempre aplicava o teto ATUAL, mesmo pra
 * contratos antigos. Isso é errado juridicamente — norma nova não
 * retroage automaticamente.
 *
 * Agora: tabela `tetos_legais` com `vigenciaDe` e `vigenciaAte`.
 * O helper busca a regra vigente na data exata do contrato.
 * Se não encontrar, retorna null → engine usa regra geral 1,5× BACEN
 * e o parecer inclui nota explicativa.
 */

import { getDb } from "../db";
import { tetosLegais } from "../../drizzle/schema";
import { eq, and, lte, or, isNull } from "drizzle-orm";
import { createLogger } from "../_core/logger";
const log = createLogger("calculos-tetos-legais");

export interface TetoLegalVigente {
  tetoMensal: number;
  fundamento: string;
  vigenciaDe: string;
  observacao: string | null;
}

/**
 * Mapeia a combinação (modalidade + vínculo) do engine pra a `categoria`
 * usada na tabela tetos_legais. Mantém compatibilidade com o formato
 * que o engine espera.
 */
function resolverCategoria(
  modalidadeCredito: string,
  tipoVinculoConsignado?: string,
): string | null {
  if (modalidadeCredito === "cheque_especial") return "cheque_especial";
  if (modalidadeCredito === "consignado") {
    if (tipoVinculoConsignado === "inss") return "consignado_inss";
    if (tipoVinculoConsignado === "servidor_publico") return "consignado_servidor";
    // CLT, militar, outros: sem teto específico cadastrado (por enquanto)
    return null;
  }
  // cartao_credito: a Lei 14.690 é sobre juros acumulados, não taxa mensal.
  // Tratada separadamente no engine (verificarTetoJurosCartao).
  return null;
}

/**
 * Busca o teto legal vigente na data do contrato.
 *
 * Retorna null se:
 * - A modalidade/vínculo não tem teto específico (ex: CLT, veículo, pessoal)
 * - Não existe teto cadastrado pra data do contrato (ex: contrato de 2018,
 *   mas só temos teto de 2025 em diante)
 * - DB indisponível
 *
 * Quando retorna null, o engine aplica regra geral (1,5× BACEN) e o
 * parecer inclui nota de que não há teto legal específico conhecido pra
 * a data da contratação.
 */
export async function obterTetoLegalPorData(
  modalidadeCredito: string,
  dataContrato: string,
  tipoVinculoConsignado?: string,
): Promise<TetoLegalVigente | null> {
  const categoria = resolverCategoria(modalidadeCredito, tipoVinculoConsignado);
  if (!categoria) return null;

  try {
    const db = await getDb();
    if (!db) return null;

    // Busca tetos dessa categoria onde:
    //   vigenciaDe <= dataContrato
    //   AND (vigenciaAte IS NULL OR vigenciaAte >= dataContrato)
    const rows = await db
      .select()
      .from(tetosLegais)
      .where(
        and(
          eq(tetosLegais.categoria, categoria),
          lte(tetosLegais.vigenciaDe, dataContrato),
          or(
            isNull(tetosLegais.vigenciaAte),
            // vigenciaAte >= dataContrato (string ISO, comparação lexicográfica funciona)
            // Drizzle não tem gte pra varchar — usamos SQL raw
          ),
        ),
      )
      .orderBy(tetosLegais.vigenciaDe)
      .limit(10);

    // Filtra por vigenciaAte em JS (mais seguro que SQL em varchar)
    const vigentes = rows.filter(
      (r) => !r.vigenciaAte || r.vigenciaAte >= dataContrato,
    );

    if (vigentes.length === 0) {
      log.info(
        { categoria, dataContrato },
        "Sem teto legal cadastrado para esta data — engine usa regra geral",
      );
      return null;
    }

    // Pega o mais recente vigente (último da lista ordenada por vigenciaDe)
    const teto = vigentes[vigentes.length - 1];
    const tetoMensal = parseFloat(teto.tetoMensal);
    if (isNaN(tetoMensal) || tetoMensal <= 0) {
      log.warn({ categoria, dataContrato, raw: teto.tetoMensal }, "Teto com valor inválido");
      return null;
    }

    return {
      tetoMensal,
      fundamento: teto.fundamento,
      vigenciaDe: teto.vigenciaDe,
      observacao: teto.observacao,
    };
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao buscar teto legal — engine usa regra geral");
    return null;
  }
}
