/**
 * Backfill — normaliza `leads.valorEstimado` legacy do formato BR
 * ("3.000", "1.500,00", "R$ 2.500,00") pro formato US ("3000.00",
 * "1500.00", "2500.00") que o `CAST(... AS DECIMAL)` do MySQL entende
 * sem distorcer.
 *
 * Contexto: por anos o sistema gravou a string crua do operador no
 * banco. Como `CAST('3.000' AS DECIMAL)` no MySQL retorna 3.00 (lê o
 * ponto como decimal separator US), relatórios subestimaram valores
 * em ~1000x quando o operador digitou pontos como separador de milhar.
 * Após o fix no helper `normalizarValorBR`, novos registros já entram
 * em formato US. Este script atualiza os registros antigos.
 *
 * SEMPRE roda em modo DRY-RUN por padrão. Lista cada `leads.id` com
 * `valorEstimado` legacy vs normalizado pra revisão. Só aplica com
 * `--apply` explícito.
 *
 * Casos pulados (skip):
 *  - valorEstimado NULL ou string vazia
 *  - já está em formato US (normalização não muda nada)
 *  - não-parseável (lixo no banco — UPDATE manualmente)
 *
 * Uso:
 *   pnpm tsx scripts/backfill-valor-estimado-br.ts             # dry-run
 *   pnpm tsx scripts/backfill-valor-estimado-br.ts --apply     # aplica
 *   pnpm tsx scripts/backfill-valor-estimado-br.ts --escritorio=42
 */

import "dotenv/config";
import { eq, isNotNull, and } from "drizzle-orm";
import { getDb } from "../server/db";
import { leads } from "../drizzle/schema";
import { normalizarValorBR } from "../shared/valor-br";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const escritorioFiltro = (() => {
  const arg = args.find((a) => a.startsWith("--escritorio="));
  return arg ? Number(arg.split("=")[1]) : null;
})();

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Banco indisponível. Verifique DATABASE_URL.");
    process.exit(1);
  }

  const conds = [isNotNull(leads.valorEstimado)];
  if (escritorioFiltro) conds.push(eq(leads.escritorioId, escritorioFiltro));

  const rows = await db
    .select({
      id: leads.id,
      escritorioId: leads.escritorioId,
      valorEstimado: leads.valorEstimado,
    })
    .from(leads)
    .where(and(...conds));

  let alterados = 0;
  let inalterados = 0;
  let invalidos = 0;
  const mudancas: Array<{
    id: number;
    escritorioId: number;
    de: string;
    para: string;
  }> = [];

  for (const r of rows) {
    const original = (r.valorEstimado ?? "").trim();
    if (!original) {
      inalterados++;
      continue;
    }
    const norm = normalizarValorBR(original);
    if (norm === null) {
      invalidos++;
      console.warn(
        `  [INVÁLIDO] lead.id=${r.id} esc=${r.escritorioId} valor=${JSON.stringify(original)} — não é parseável, pula`,
      );
      continue;
    }
    if (norm === original) {
      inalterados++;
      continue;
    }
    alterados++;
    mudancas.push({
      id: r.id,
      escritorioId: r.escritorioId,
      de: original,
      para: norm,
    });
  }

  console.log("");
  console.log("─".repeat(78));
  console.log(`Total leads escaneados : ${rows.length}`);
  console.log(`Inalterados (já em US ou vazio): ${inalterados}`);
  console.log(`Inválidos (lixo no banco)      : ${invalidos}`);
  console.log(`Pra atualizar                   : ${alterados}`);
  console.log("─".repeat(78));

  if (alterados > 0) {
    console.log("");
    console.log("Mudanças propostas (até 50 mostradas):");
    console.log("");
    console.log("  id      esc   de                          →  para");
    console.log("  " + "─".repeat(72));
    for (const m of mudancas.slice(0, 50)) {
      const id = String(m.id).padEnd(6);
      const esc = String(m.escritorioId).padEnd(5);
      const de = JSON.stringify(m.de).padEnd(28);
      console.log(`  ${id}  ${esc} ${de}  →  ${JSON.stringify(m.para)}`);
    }
    if (mudancas.length > 50) {
      console.log(`  ... e mais ${mudancas.length - 50} alterações`);
    }
  }

  if (!apply) {
    console.log("");
    console.log("DRY-RUN: nada foi gravado. Rode novamente com --apply pra aplicar.");
    process.exit(0);
  }

  if (alterados === 0) {
    console.log("");
    console.log("Nada pra atualizar.");
    process.exit(0);
  }

  console.log("");
  console.log("Aplicando UPDATE em batch…");
  let aplicados = 0;
  for (const m of mudancas) {
    await db.update(leads).set({ valorEstimado: m.para }).where(eq(leads.id, m.id));
    aplicados++;
    if (aplicados % 50 === 0) {
      console.log(`  ${aplicados}/${mudancas.length}…`);
    }
  }
  console.log(`✓ Aplicado em ${aplicados} leads.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
