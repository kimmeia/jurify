import { chromium } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

const variants = ["v2-hibrido", "v2-dark", "v2-light"];

for (const name of variants) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto("file://" + join(__dirname, name + ".html"), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2600); // deixa as animações de entrada assentarem
  await page.screenshot({ path: join(__dirname, `out-${name}-full.png`), fullPage: true });
  await page.screenshot({ path: join(__dirname, `out-${name}-hero.png`), clip: { x: 0, y: 0, width: 1280, height: 1080 } });
  console.log("ok:", name);
  await page.close();
}

await browser.close();
