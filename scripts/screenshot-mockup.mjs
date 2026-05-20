import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { resolve } from "path";

const htmlPath = resolve(process.cwd(), "docs/calculos-redesign-mockup.html");
const outPath = resolve(process.cwd(), "docs/calculos-redesign-mockup.png");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto("file://" + htmlPath, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();
console.log("Saved:", outPath);
