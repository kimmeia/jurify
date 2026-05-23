#!/usr/bin/env tsx
/**
 * Runner CLI da auditoria de tribunais.
 *
 * A lógica de auditoria (alvos, detecção de tecnologia/versão, fetch) mora
 * em server/admin/auditar-tribunais.ts e é compartilhada com a procedure
 * admin `adminTribunais.auditar`. Este arquivo só formata o relatório.
 *
 * Uso:
 *   pnpm tsx scripts/spike-motor-proprio/poc-1-pje-scraper/audit-tribunais.ts
 *   SPIKE_AUDIT_IDS=tjce-2g,trt7 pnpm tsx .../audit-tribunais.ts
 *
 * Atenção: o sandbox de dev do Claude Code tem allowlist de hosts e
 * bloqueia os tribunais (HTTP 403 "Host not in allowlist"). Rode em
 * staging Railway, local com rede liberada, ou via a procedure admin.
 */
import {
  auditarTribunais,
  type ResultadoAuditoria,
} from "../../../server/admin/auditar-tribunais";

function imprimirRelatorio(resultados: ResultadoAuditoria[]): void {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("RELATÓRIO DETALHADO");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const r of resultados) {
    console.log(`▸ ${r.label}`);
    console.log(`    URL inicial : ${r.urlInicial}`);
    console.log(`    URL final   : ${r.urlFinal ?? "(falha)"}`);
    console.log(`    HTTP        : ${r.httpStatus ?? "—"}`);
    console.log(`    Tecnologia  : ${r.tecnologia}`);
    console.log(`    Versão PJe  : ${r.versaoProvavel}`);
    console.log(`    PDPJ-cloud  : ${r.usaPdpjCloud ? "SIM (credencial TJCE 1g serve)" : "NÃO / indeterminado"}`);
    console.log(`    Reuso TJCE  : ${r.reuso}`);
    for (const o of r.observacoes) console.log(`    Obs         : ${o}`);
    if (r.erro) console.log(`    Erro        : ${r.erro}`);
    console.log();
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("DECISÃO RECOMENDADA");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const noPdpj = resultados.filter((r) => r.usaPdpjCloud && !r.erro && r.id !== "pdpj-sso");
  console.log(`Acessíveis com a credencial PDPJ-cloud atual: ${noPdpj.length}`);
  for (const r of noPdpj) {
    console.log(`  • ${r.label} — ${r.versaoProvavel} — reuso ${r.reuso}`);
  }

  const foraPdpj = resultados.filter((r) => !r.usaPdpjCloud && !r.erro && r.id !== "pdpj-sso");
  if (foraPdpj.length > 0) {
    console.log(`\nFora do PDPJ-cloud (precisariam credencial separada):`);
    for (const r of foraPdpj) console.log(`  • ${r.label} — ${r.tecnologia}`);
  }

  const falhas = resultados.filter((r) => r.erro);
  if (falhas.length > 0) {
    console.log(`\nFalhas técnicas (não conclui — provável WAF/rede):`);
    for (const r of falhas) console.log(`  • ${r.label} — ${r.erro}`);
  }

  console.log("\nFIM");
}

async function main(): Promise<void> {
  console.log(`Auditoria iniciada — ${new Date().toISOString()}`);

  const ids = process.env.SPIKE_AUDIT_IDS
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids && ids.length > 0) console.log(`Filtro de alvos: ${ids.join(", ")}`);
  console.log();

  const resultados = await auditarTribunais(ids);

  for (const r of resultados) {
    const tag = r.erro
      ? `✗ ${r.erro.slice(0, 60)}`
      : `status=${r.httpStatus ?? "—"} ${r.tecnologia}${r.usaPdpjCloud ? " [PDPJ-cloud]" : ""}`;
    console.log(`  ${r.label.padEnd(38)} ${tag}`);
  }

  imprimirRelatorio(resultados);
}

main().catch((err) => {
  console.error("Falha geral:", err);
  process.exit(1);
});
