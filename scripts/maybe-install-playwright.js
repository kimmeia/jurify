#!/usr/bin/env node
/**
 * Postinstall condicional — instala Chromium do Playwright apenas em
 * ambientes que precisam dele (staging, durante o Spike do motor próprio).
 *
 * Por que condicional:
 *  - Playwright + Chromium pesa ~300MB e leva ~2min pra baixar.
 *  - Em production NÃO queremos esse peso até o motor próprio estar
 *    validado e separado em worker dedicado (Sprint 1 oficial).
 *  - Em dev local também não quer poluir — quem precisa rodar PoC
 *    local instala manualmente com `pnpm exec playwright install chromium`.
 *
 * Gatilho:
 *  Roda quando `JURIFY_AMBIENTE === "staging"` OU quando
 *  `INSTALL_PLAYWRIGHT_CHROMIUM === "1"` for definida explicitamente.
 *
 * Em qualquer outro caso, vira no-op silencioso (sai com código 0
 * pra não quebrar `pnpm install`).
 */

const { execSync } = require("node:child_process");

const ambiente = process.env.JURIFY_AMBIENTE || "";
const force = process.env.INSTALL_PLAYWRIGHT_CHROMIUM === "1";

if (ambiente !== "staging" && !force) {
  // Silencioso de propósito — não polui logs de instalação em prod/dev local.
  process.exit(0);
}

console.log(
  `[postinstall] JURIFY_AMBIENTE=${ambiente || "(unset)"} — instalando Chromium pro motor próprio...`,
);

try {
  // --with-deps instala libs do sistema (libnss, libxkbcommon, etc) que o
  // Chromium headless precisa em containers Alpine/Debian. Em ambiente que
  // não permite sudo (Railway Nixpacks), o flag é ignorado/no-op pras libs
  // do sistema mas baixa o navegador normalmente.
  execSync("npx playwright install --with-deps chromium", { stdio: "inherit" });
  console.log("[postinstall] Chromium instalado com sucesso.");
} catch (err) {
  // Não falhar o pnpm install — motor próprio ainda não é blocker.
  // App principal continua funcionando; só PoC e endpoints do motor não.
  console.warn(
    `[postinstall] Falha ao instalar Chromium (não-fatal): ${err.message}`,
  );
  console.warn(
    "[postinstall] Endpoints do motor próprio retornarão erro até Chromium ser instalado.",
  );
  process.exit(0);
}
