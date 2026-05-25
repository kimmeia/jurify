// Renderiza os mockups HTML em PNG (full-page + hero) via Playwright.
// Uso: node docs/lp-mockups/render.mjs [a b c]
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const which = process.argv.slice(2).length ? process.argv.slice(2) : ["a", "b", "c"];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

for (const id of which) {
  const file = join(__dirname, `dir-${id}.html`);
  const url = "file://" + file;
  await page.goto(url, { waitUntil: "networkidle" });
  // garante fontes carregadas
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  // full page
  await page.screenshot({
    path: join(__dirname, `out-dir-${id}-full.png`),
    fullPage: true,
  });

  // hero (viewport top)
  await page.screenshot({
    path: join(__dirname, `out-dir-${id}-hero.png`),
    clip: { x: 0, y: 0, width: 1280, height: 900 },
  });

  console.log(`✓ dir-${id} renderizado`);
}

await browser.close();
console.log("Done.");
