import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const [OUT, PORTA] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1600 }, storageState: "/home/user/jurify/scratchpad/comp-sumulas/sessao-dono.json", deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(`http://localhost:${PORTA}/configuracoes?tab=notificacoes`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4500);
const recorte = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-slot="card"]')];
  const i = cards.findIndex((c) => (c.textContent || "").trim().startsWith("Atendimento"));
  if (i < 0) return null;
  const primeiro = cards[i], ultimo = cards[Math.min(i + 1, cards.length - 1)];
  primeiro.scrollIntoView({ block: "start" });
  return new Promise((r) => setTimeout(() => {
    const a = primeiro.getBoundingClientRect(), bx = ultimo.getBoundingClientRect();
    r({ x: Math.max(0, a.left - 8), y: Math.max(0, a.top - 8), width: a.width + 16,
        height: Math.min(bx.bottom - a.top + 16, window.innerHeight - Math.max(0, a.top - 8)) });
  }, 700));
});
if (recorte) { await p.screenshot({ path: `${OUT}/notificacoes.png`, clip: recorte }); console.log("ok", JSON.stringify(recorte)); }
else { console.log("!! não achou"); }
await b.close();
