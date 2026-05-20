import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { resolve } from "path";

const outDir = resolve(process.cwd(), "docs");
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1200 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto("http://localhost:3000/__demo/trabalhista", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);

// Step 1: Cenário (já renderizado)
await page.screenshot({ path: `${outDir}/trabalhista-step1-cenario.png`, fullPage: true });

// Avança pro Step 2 clicando no botão "Continuar com..."
const btnContinuar = page.locator("button:has-text('Continuar com')").first();
if (await btnContinuar.count() > 0) {
  await btnContinuar.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/trabalhista-step2-dados.png`, fullPage: true });

  // Step 3
  await page.locator("button:has-text('Continuar para extras')").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/trabalhista-step3-extras.png`, fullPage: true });
}

await browser.close();
console.log("OK");
