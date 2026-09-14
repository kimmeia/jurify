import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
await p.goto("file:///home/user/jurify/mockup-notificacoes-padrao.html");
await p.waitForTimeout(1000);
let falhas = 0;
for (const [botao, alvo, nome] of [["#bd", "#td", "computador"], ["#bc", "#tc", "celular"]]) {
  await p.click(botao);
  await p.waitForTimeout(500);
  const visivel = await p.locator(alvo).isVisible();
  const d = await p.locator(alvo + " img").evaluate((e) => ({ w: e.naturalWidth, h: e.naturalHeight }));
  const ok = visivel && d.w > 300 && d.h > 300;
  console.log(`${ok ? "✓" : "✗"} ${nome} — ${d.w}x${d.h}`);
  if (!ok) falhas++;
}
const blocos = await p.locator("div.bloco").count();
console.log(`${blocos === 3 ? "✓" : "✗"} ${blocos} blocos de texto`);
if (blocos !== 3) falhas++;
await b.close();
console.log(falhas === 0 ? "tudo conferido" : `${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
