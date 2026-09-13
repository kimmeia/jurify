/**
 * Sessão do ADMIN da plataforma (o painel /admin não abre com o dono do
 * escritório). Grava o storageState para as fotos do estudo.
 *
 *   node sessao-admin.mjs /caminho/sessao-admin.json
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1500);
await p.fill('input[type="email"]', "admin-smoke@juridflow.com.br");
await p.fill('input[type="password"]', "Smoke123!");
await p.click('button[type="submit"]');
await p.waitForTimeout(4000);
const cbx = p.locator('[role="checkbox"], input[type="checkbox"]').first();
if (await cbx.count()) { await cbx.click().catch(() => {}); await p.waitForTimeout(400); }
const btn = p.locator('button:has-text("Aceitar e continuar")');
if (await btn.count()) { await btn.click(); await p.waitForTimeout(3000); }
await p.goto("http://localhost:3000/admin", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
console.log("url final:", p.url());
await ctx.storageState({ path: process.argv[2] });
await b.close();
