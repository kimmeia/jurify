import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { resolve } from "path";

const htmlPath = resolve(process.cwd(), "docs/calculos-submodulos-mockup.html");
const outDir = resolve(process.cwd(), "docs");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 4000 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto("file://" + htmlPath, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.screenshot({ path: `${outDir}/calculos-submodulos-mockup.png`, fullPage: true });

const secoes = ["bancario", "imobiliario", "previdenciario", "diversos"];
for (const id of secoes) {
  // pega o range entre #sectionId e o próximo .screen-divider (ou fim)
  const box = await page.evaluate((sectionId) => {
    const sec = document.getElementById(sectionId);
    if (!sec) return null;
    const top = sec.getBoundingClientRect().top + window.scrollY;
    let bottom = top + sec.offsetHeight;
    let cur = sec.nextElementSibling;
    // Pega no máximo 2 blocos seguintes (wizard + resultado / hero + grid)
    let count = 0;
    while (cur && !cur.classList.contains("screen-divider") && count < 2) {
      const r = cur.getBoundingClientRect();
      bottom = r.bottom + window.scrollY;
      cur = cur.nextElementSibling;
      count++;
    }
    return { x: 0, y: Math.floor(top), width: 1280, height: Math.ceil(bottom - top) };
  }, id);
  if (!box) continue;
  await page.setViewportSize({ width: 1280, height: Math.min(box.height + 100, 10000) });
  await page.evaluate((y) => window.scrollTo(0, y), box.y);
  await page.waitForTimeout(200);
  await page.screenshot({
    path: `${outDir}/calculos-${id}.png`,
    clip: { x: 0, y: 0, width: 1280, height: box.height },
    fullPage: false,
  });
}

await browser.close();
console.log("OK");
