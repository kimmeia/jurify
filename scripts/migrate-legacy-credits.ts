/**
 * Script one-shot: migra saldo de `userCredits` (legacy) → `escritorio_creditos`.
 *
 *   pnpm tsx scripts/migrate-legacy-credits.ts
 *
 * Idempotente — pode rodar 2x sem duplicar saldo (verifica transação
 * `migracao_legacy_userCredits` por escritório).
 *
 * Roda em STAGING e PRODUÇÃO. Não destrutivo: zera apenas saldo disponível
 * em userCredits (mantém linha pra histórico).
 */

import "dotenv/config";
import { migrarCreditosLegacyParaEscritorio } from "../server/billing/migrate-legacy-credits";

async function main() {
  console.log("[migrate] iniciando migração de créditos legacy → escritório...");

  const result = await migrarCreditosLegacyParaEscritorio();

  console.log("\n=== RESUMO ===");
  console.log(`Processados:    ${result.processados}`);
  console.log(`Migrados:       ${result.migrados}`);
  console.log(`Total créditos: ${result.totalCreditos}`);
  console.log(`Pulados:        ${result.pulados}`);
  console.log(`Erros:          ${result.erros}`);

  if (result.detalhes.length > 0) {
    console.log("\n=== DETALHES ===");
    for (const d of result.detalhes) {
      const tag = d.status.padEnd(15);
      const linha = `[${tag}] user=${d.userId} (${d.userName}) esc=${d.escritorioId} saldo=${d.saldoLegacy}`;
      console.log(d.erro ? `${linha} ERRO: ${d.erro}` : linha);
    }
  }

  if (result.erros > 0) {
    console.error(`\n${result.erros} erro(s) durante migração — revisar logs acima`);
    process.exit(1);
  }

  console.log("\nmigração concluída com sucesso.");
  process.exit(0);
}

main().catch((err) => {
  console.error("erro fatal:", err);
  process.exit(1);
});
