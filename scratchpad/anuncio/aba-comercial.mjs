import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({ viewport: { width: Number(process.argv[3] || 1440), height: Number(process.argv[4] || 900) }, storageState: "scratchpad/anuncio/sessao.json", deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/relatorios", { waitUntil: "networkidle" }).catch(() => {});
await p.waitForTimeout(3000);
await p.getByRole("button", { name: /Comercial/i }).first().click().catch(async () => {
  await p.getByText("Comercial", { exact: false }).first().click();
});
await p.waitForTimeout(5000);
const achou = await p.getByText("De qual anúncio veio o lead").count();
console.log("cartão de anúncios na tela:", achou);
await p.screenshot({ path: process.argv[2], fullPage: true });
await b.close();
