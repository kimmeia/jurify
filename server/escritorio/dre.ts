/**
 * Cálculo do DRE (Demonstrativo de Resultado) por escritório e período.
 *
 * Agrega:
 *  - Receitas: cobranças pagas (status RECEIVED/CONFIRMED/RECEIVED_IN_CASH)
 *    no período, agrupadas por categoria de cobrança.
 *  - Despesas: lançamentos com `valorPago > 0` no período (pagos parcial
 *    ou totalmente), agrupados por categoria de despesa.
 *
 * Resultado = Receitas - Despesas. Margem = Resultado / Receitas.
 *
 * Critério de período:
 *  - Receitas filtram por `dataPagamento`
 *  - Despesas filtram por `dataPagamento` quando status='pago', senão por
 *    `vencimento` quando status='parcial' (parcial sem dataPagamento total)
 *
 * Sem categoria: agrupado sob "(sem categoria)" — útil pra detectar
 * lançamentos não classificados que precisam atenção do operador.
 */

import { and, between, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  asaasCobrancas,
  categoriasCobranca,
  categoriasDespesa,
  despesas,
} from "../../drizzle/schema";

export interface DRECategoria {
  categoriaId: number | null;
  categoriaNome: string;
  total: number;
  count: number;
  /** Percentual relativo ao total da seção (0-100). */
  percentual: number;
}

export interface DREResultado {
  periodo: { inicio: string; fim: string };
  receitas: {
    total: number;
    porCategoria: DRECategoria[];
  };
  despesas: {
    total: number;
    porCategoria: DRECategoria[];
  };
  resultadoLiquido: number;
  /** Margem líquida em percentual (0-100). NaN se receita=0. */
  margemPercent: number;
}

const STATUS_PAGO = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"] as const;

const SEM_CATEGORIA = "(sem categoria)";

/**
 * Calcula DRE pra um escritório num intervalo de datas (inclusivo).
 *
 * Datas em formato ISO YYYY-MM-DD. Validação de input é responsabilidade
 * do caller (procedure tRPC).
 */
export async function calcularDRE(
  escritorioId: number,
  dataInicio: string,
  dataFim: string,
): Promise<DREResultado> {
  const db = await getDb();
  if (!db) {
    return {
      periodo: { inicio: dataInicio, fim: dataFim },
      receitas: { total: 0, porCategoria: [] },
      despesas: { total: 0, porCategoria: [] },
      resultadoLiquido: 0,
      margemPercent: NaN,
    };
  }

  // ─── RECEITAS ──────────────────────────────────────────────────────────────
  // Cobranças pagas no período, agrupadas por categoria.
  // Left join com categorias_cobranca pra trazer nome — pode ser null
  // (cobrança sem categoria atribuída, comum em PIX direto pelo Asaas).
  const rowsReceita = await db
    .select({
      categoriaId: asaasCobrancas.categoriaId,
      categoriaNome: categoriasCobranca.nome,
      valor: asaasCobrancas.valor,
    })
    .from(asaasCobrancas)
    .leftJoin(
      categoriasCobranca,
      eq(categoriasCobranca.id, asaasCobrancas.categoriaId),
    )
    .where(
      and(
        eq(asaasCobrancas.escritorioId, escritorioId),
        inArray(asaasCobrancas.status, STATUS_PAGO as unknown as string[]),
        between(asaasCobrancas.dataPagamento, dataInicio, dataFim),
      ),
    );

  // ─── DESPESAS ──────────────────────────────────────────────────────────────
  // Lançamentos com `valorPago > 0` no período. Usa dataPagamento quando
  // 'pago' (data exata do pagamento total) ou vencimento quando 'parcial'
  // (não tem data total — usa vencimento como aproximação).
  const rowsDespesa = await db
    .select({
      categoriaId: despesas.categoriaId,
      categoriaNome: categoriasDespesa.nome,
      valor: despesas.valorPago,
      status: despesas.status,
      dataPagamento: despesas.dataPagamento,
      vencimento: despesas.vencimento,
    })
    .from(despesas)
    .leftJoin(
      categoriasDespesa,
      eq(categoriasDespesa.id, despesas.categoriaId),
    )
    .where(
      and(
        eq(despesas.escritorioId, escritorioId),
        inArray(despesas.status, ["pago", "parcial"] as const),
      ),
    );

  // Filtra despesas dentro do período em código (a data efetiva muda por
  // status). Mantém SQL simples e evita CASE/COALESCE no WHERE.
  const despesasNoPeriodo = rowsDespesa.filter((d) => {
    const dataEfetiva = d.status === "pago" ? d.dataPagamento : d.vencimento;
    if (!dataEfetiva) return false;
    return dataEfetiva >= dataInicio && dataEfetiva <= dataFim;
  });

  // ─── AGREGAÇÃO POR CATEGORIA ──────────────────────────────────────────────
  const agregar = (
    rows: Array<{
      categoriaId: number | null;
      categoriaNome: string | null;
      valor: string;
    }>,
  ): { total: number; porCategoria: DRECategoria[] } => {
    const grupo = new Map<
      string,
      { categoriaId: number | null; nome: string; total: number; count: number }
    >();

    for (const row of rows) {
      const key =
        row.categoriaId === null ? "null" : String(row.categoriaId);
      const valorNum = parseFloat(row.valor) || 0;
      const ja = grupo.get(key);
      if (ja) {
        ja.total += valorNum;
        ja.count++;
      } else {
        grupo.set(key, {
          categoriaId: row.categoriaId,
          nome: row.categoriaNome ?? SEM_CATEGORIA,
          total: valorNum,
          count: 1,
        });
      }
    }

    const totalGeral = Array.from(grupo.values()).reduce(
      (s, g) => s + g.total,
      0,
    );

    const porCategoria: DRECategoria[] = Array.from(grupo.values())
      .map((g) => ({
        categoriaId: g.categoriaId,
        categoriaNome: g.nome,
        total: +g.total.toFixed(2),
        count: g.count,
        percentual:
          totalGeral > 0 ? +((g.total / totalGeral) * 100).toFixed(2) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    return { total: +totalGeral.toFixed(2), porCategoria };
  };

  const receitas = agregar(rowsReceita);
  const despesasAgg = agregar(despesasNoPeriodo);

  const resultadoLiquido = +(receitas.total - despesasAgg.total).toFixed(2);
  const margemPercent =
    receitas.total > 0
      ? +((resultadoLiquido / receitas.total) * 100).toFixed(2)
      : NaN;

  return {
    periodo: { inicio: dataInicio, fim: dataFim },
    receitas,
    despesas: despesasAgg,
    resultadoLiquido,
    margemPercent,
  };
}

/**
 * Gera CSV do DRE pra download. Formato simples — abre direto no Excel
 * e em qualquer planilha. Usa ';' como separador (padrão BR) pra evitar
 * conflito com vírgula decimal.
 */
export function gerarDRECSV(dre: DREResultado, nomeEscritorio: string): string {
  const linhas: string[] = [];
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const num = (n: number) => n.toFixed(2).replace(".", ",");

  linhas.push(`"DRE — ${escape(nomeEscritorio).slice(1, -1)}"`);
  linhas.push(
    `"Período";"${dre.periodo.inicio.split("-").reverse().join("/")} a ${dre.periodo.fim
      .split("-")
      .reverse()
      .join("/")}"`,
  );
  linhas.push("");

  linhas.push('"RECEITAS"');
  linhas.push('"Categoria";"Total (R$)";"Qtd";"% da seção"');
  for (const cat of dre.receitas.porCategoria) {
    linhas.push(
      `${escape(cat.categoriaNome)};${num(cat.total)};${cat.count};${num(cat.percentual)}%`,
    );
  }
  linhas.push(`"TOTAL RECEITAS";${num(dre.receitas.total)};;`);
  linhas.push("");

  linhas.push('"DESPESAS"');
  linhas.push('"Categoria";"Total (R$)";"Qtd";"% da seção"');
  for (const cat of dre.despesas.porCategoria) {
    linhas.push(
      `${escape(cat.categoriaNome)};${num(cat.total)};${cat.count};${num(cat.percentual)}%`,
    );
  }
  linhas.push(`"TOTAL DESPESAS";${num(dre.despesas.total)};;`);
  linhas.push("");

  linhas.push(`"RESULTADO LÍQUIDO";${num(dre.resultadoLiquido)};;`);
  linhas.push(
    `"MARGEM";${isNaN(dre.margemPercent) ? "—" : num(dre.margemPercent) + "%"};;`,
  );

  // BOM UTF-8 pra Excel reconhecer acentos
  return "﻿" + linhas.join("\r\n");
}
