import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const [saida, larg, alt, movel] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({
  viewport: { width: Number(larg), height: Number(alt) },
  storageState: "scratchpad/anuncio/sessao.json",
  deviceScaleFactor: 2, isMobile: movel === "1", hasTouch: movel === "1",
});
const p = await ctx.newPage();
await p.addInitScript(() => { try { localStorage.setItem("jurify:mobileCompleto", "1"); } catch {} });
await p.goto("http://localhost:3000/relatorios", { waitUntil: "networkidle" }).catch(()=>{});
await p.waitForTimeout(4000);
const tab = p.getByRole("button", { name: "Comercial", exact: true }).first();
await tab.scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
await tab.click({ force: true });
await p.waitForTimeout(8000);
console.log("cartao presente:", await p.locator(':text("De qual anúncio veio o lead")').count());
await p.screenshot({ path: saida, fullPage: true });
await b.close();
