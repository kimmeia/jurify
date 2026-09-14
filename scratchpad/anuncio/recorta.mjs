import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({ viewport: { width: Number(process.argv[3]||1440), height: Number(process.argv[4]||900) }, storageState: "scratchpad/anuncio/sessao.json", deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/relatorios", { waitUntil: "networkidle" }).catch(()=>{});
await p.waitForTimeout(3500);
await p.getByRole("button", { name: "Comercial", exact: true }).first().click();
await p.waitForTimeout(7000);
const alvo = p.locator("div").filter({ hasText: /^De qual anúncio veio o lead/ }).last();
const cartao = p.locator(':text("De qual anúncio veio o lead")').first();
await cartao.scrollIntoViewIfNeeded();
await p.waitForTimeout(800);
// sobe até o Card que contém o título
const box = await cartao.evaluate((el) => {
  let n = el; while (n && !(n.className && String(n.className).includes("rounded"))) n = n.parentElement;
  const r = (n || el).getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
await p.screenshot({ path: process.argv[2], clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(box.width + 16, 1440), height: Math.min(box.height + 16, 900) } });
console.log("recorte:", JSON.stringify(box));
await b.close();
