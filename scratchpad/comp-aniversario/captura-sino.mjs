/**
 * Fotografa o sino aberto — o lembrete como ele chega.
 *   node captura-sino.mjs <pasta> <porta>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [OUT, PORTA = "3000"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await b.newContext({
  viewport: { width: 1600, height: 1000 },
  storageState: "/home/user/jurify/scratchpad/comp-sumulas/sessao-dono.json",
  deviceScaleFactor: 2,
});
const p = await ctx.newPage();
await p.goto(`http://localhost:${PORTA}/clientes`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);

// O sino mora no topo do menu lateral.
const sino = p.locator('[aria-label="Notificações"]').first();
if (await sino.count()) {
  await sino.click();
  await p.waitForTimeout(1500);
  const painel = p.locator("[data-radix-popper-content-wrapper]").first();
  if (await painel.count()) {
    await painel.screenshot({ path: `${OUT}/sino.png` });
    console.log("sino.png ok");
  } else {
    await p.screenshot({ path: `${OUT}/sino.png` });
    console.log("!! painel do sino não encontrado — página inteira");
  }
} else {
  console.log("!! sino não encontrado");
  await p.screenshot({ path: `${OUT}/sino.png` });
}
await b.close();
