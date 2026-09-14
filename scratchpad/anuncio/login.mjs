import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
await p.fill('input[type="email"]', "dono-smoke@juridflow.com.br");
await p.fill('input[type="password"]', "Smoke123!");
await p.click('button[type="submit"]');
await p.waitForTimeout(5000);
const cx = p.locator('[role="checkbox"]').first();
if (await cx.count()) {
  await cx.click().catch(() => {});
  await p.click('button:has-text("Aceitar e continuar")').catch(() => {});
  await p.waitForTimeout(2500);
}
await ctx.storageState({ path: "scratchpad/anuncio/sessao.json" });
console.log("URL final:", p.url());
await b.close();
