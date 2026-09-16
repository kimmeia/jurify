import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ storageState: "/home/user/jurify/scratchpad/comp-sumulas/sessao-admin.json", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/admin/ia?aba=conhecimento", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(5000);
const r = await p.evaluate(() => {
  const t = document.querySelector("table");
  if (!t) return { erro: "sem tabela", titulo: document.title, texto: document.body.innerText.slice(0, 300) };
  const env = t.closest("div[class*='overflow']") || t.parentElement;
  const cols = [...t.querySelectorAll("thead th")].map((th) => ({ t: th.textContent.trim().slice(0, 22), w: Math.round(th.getBoundingClientRect().width) }));
  return {
    tabela: Math.round(t.getBoundingClientRect().width),
    scrollW: t.scrollWidth,
    envolucro: Math.round(env.getBoundingClientRect().width),
    envScroll: env.scrollWidth,
    rolaDeLado: env.scrollWidth > env.clientWidth + 1,
    cols,
  };
});
console.log(JSON.stringify(r, null, 1));
await p.screenshot({ path: "/home/user/jurify/scratchpad/estrutura/tabela-antes.png" });
await b.close();
