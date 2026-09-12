/** Foto da aba "O que NÃO entrou" do navegável, para conferir no olho. */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const [ARQ, SAIDA] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext({ viewport: { width: 1500, height: 1150 } })).newPage();
await p.goto(`file://${ARQ}`, { waitUntil: "load" });
await p.waitForTimeout(1200);
await p.click('[data-tela="__pendentes"]');
await p.waitForTimeout(400);
await p.screenshot({ path: SAIDA });
console.log("ok", SAIDA);
await b.close();
