/** Foto de uma tela no celular ou no computador, direto do app rodando.
 *   node foto-rapida.mjs <rota> <destino.png> <sessao.json> [larg] [alt] */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const [rota, saida, sessao, larg = "390", alt = "844"] = process.argv.slice(2);
const L = Number(larg), A = Number(alt);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: L, height: A }, storageState: sessao, isMobile: L < 500, hasTouch: L < 500, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem("jurify:mobileCompleto", "1"); } catch {} });
const p = await ctx.newPage();
await p.goto(`http://localhost:3000${rota}`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4200);
await p.screenshot({ path: saida });
console.log("ok", saida);
await b.close();
