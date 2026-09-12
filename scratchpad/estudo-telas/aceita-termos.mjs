import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1200);
await p.fill('input[type="email"]', "dono-smoke@juridflow.com.br");
await p.fill('input[type="password"]', "Smoke123!");
await p.click('button[type="submit"]');
await p.waitForTimeout(4000);
// aceita os Termos v2 (o gate é bloqueante pro dono)
const cbx = p.locator('[role="checkbox"], input[type="checkbox"]').first();
if (await cbx.count()) { await cbx.click(); await p.waitForTimeout(400); }
const btn = p.locator('button:has-text("Aceitar e continuar")');
if (await btn.count()) { await btn.click(); await p.waitForTimeout(3000); }
console.log("termos aceitos?", (await p.locator('button:has-text("Aceitar e continuar")').count()) === 0 ? "sim" : "NÃO");
await ctx.storageState({ path: process.argv[2] });
await b.close();
