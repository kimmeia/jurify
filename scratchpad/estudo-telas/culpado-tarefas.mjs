/** Quem empurra a tela Tarefas de lado no celular. */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 }, storageState: process.argv[2], isMobile: true, hasTouch: true,
});
await ctx.addInitScript(() => { try { localStorage.setItem("jurify:mobileCompleto", "1"); } catch {} });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/tarefas", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4200);
const r = await p.evaluate(() => {
  const limite = document.scrollingElement.clientWidth;
  const fora = [];
  for (const el of document.querySelectorAll("body *")) {
    const c = el.getBoundingClientRect();
    if (c.right > limite + 1 && c.width > 6 && c.height > 6) {
      const estilo = getComputedStyle(el);
      fora.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === "string" ? el.className : "").replace(/\s+/g, " ").slice(0, 110),
        dir: Math.round(c.right), larg: Math.round(c.width), txt: (el.textContent || "").trim().slice(0, 40),
        overflowX: estilo.overflowX, minW: estilo.minWidth, flexShrink: estilo.flexShrink,
      });
    }
  }
  return { limite, scrollWidth: document.scrollingElement.scrollWidth, fora: fora.slice(0, 14) };
});
console.log(`viewport ${r.limite}px · conteúdo ${r.scrollWidth}px\n`);
for (const f of r.fora) {
  console.log(`<${f.tag}> direita=${f.dir} largura=${f.larg} overflowX=${f.overflowX} minW=${f.minW} shrink=${f.flexShrink}`);
  console.log(`   class: ${f.cls}`);
  console.log(`   texto: ${f.txt}\n`);
}
await b.close();
