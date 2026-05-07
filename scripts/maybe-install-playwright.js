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

// O package.json tem "type": "module", então .js é ESM por default.
// Usamos import dinâmico (sem await top-level pra manter compatibilidade
// com Node mais antigo) ou import direto.
import { execSync } from "node:child_process";

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
  // Sem --with-deps: o postinstall do Railway/Nixpacks roda como user
  // não-root, e --with-deps tentaria `sudo apt-get install` e falharia.
  // As libs do sistema (libnss3, libxkbcommon, libgtk-3-0, etc) entram
  // via nixpacks.toml > aptPkgs, que executa em fase privilegiada do
  // build do container.
  execSync("npx playwright install chromium", { stdio: "inherit" });
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
