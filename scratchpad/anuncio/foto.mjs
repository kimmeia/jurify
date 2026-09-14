import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const [url, saida, larg, alt] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({
  viewport: { width: Number(larg || 1440), height: Number(alt || 900) },
  storageState: "scratchpad/anuncio/sessao.json",
  deviceScaleFactor: 2,
});
const p = await ctx.newPage();
const erros = [];
p.on("console", (m) => { if (m.type() === "error") erros.push(m.text().slice(0, 160)); });
await p.goto(url, { waitUntil: "networkidle" }).catch(() => {});
await p.waitForTimeout(4000);
await p.screenshot({ path: saida, fullPage: true });
console.log("ok:", saida, "| titulo:", (await p.title()).slice(0, 60));
if (erros.length) console.log("erros de console:", erros.slice(0, 4).join(" || "));
await b.close();
