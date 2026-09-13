/**
 * Recortes de DETALHE do editor de plano, por elemento — não por coordenada
 * chutada. A tela muda de largura entre os dois estados (2110px → 1440px),
 * então recorte por posição fixa mostraria pedaços diferentes de cada lado; o
 * que fixa o par é o ELEMENTO.
 *
 *   node recortes-editor.mjs <sessao.json> <pasta> <rotulo>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [SESSAO, PASTA, ROTULO] = process.argv.slice(2);
mkdirSync(PASTA, { recursive: true });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ storageState: SESSAO, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/admin/planos/atende", { waitUntil: "domcontentloaded", timeout: 40000 });
await p.waitForTimeout(4200);

/** Caixa que cobre o rótulo e o que vier logo abaixo dele. */
async function recorte(nome, textoDoRotulo, altura) {
  const caixa = await p.evaluate(([txt, alt]) => {
    const el = [...document.querySelectorAll("label, div, span")]
      .find((e) => e.textContent?.trim() === txt);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 14), y: Math.max(0, r.y - 10), width: Math.min(520, r.width + 28), height: alt };
  }, [textoDoRotulo, altura]);
  if (!caixa) { console.log(`  (não achei "${textoDoRotulo}")`); return; }
  await p.screenshot({ path: `${PASTA}/${nome}-${ROTULO}.png`, clip: caixa, fullPage: true });
  console.log(`  ${nome}: ${Math.round(caixa.width)}x${caixa.height} em (${Math.round(caixa.x)},${Math.round(caixa.y)})`);
}

console.log(`— recortes (${ROTULO}) —`);
await recorte("codigo-interno", "Código interno", 110);
await recorte("clientes-ativos", "Clientes ativos", 90);

// A linha comprida dos destaques: pega o elemento pelo começo do texto.
const linha = await p.evaluate(() => {
  const el = [...document.querySelectorAll("span")]
    .find((e) => e.textContent?.startsWith("Vigia 300 processos"));
  if (!el) return null;
  const r = el.closest("div").getBoundingClientRect();
  return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: Math.min(1100, r.width + 20), height: Math.min(140, r.height + 20) };
});
if (linha) {
  await p.screenshot({ path: `${PASTA}/destaque-longo-${ROTULO}.png`, clip: linha, fullPage: true });
  console.log(`  destaque-longo: ${Math.round(linha.width)}x${Math.round(linha.height)} (largura EXIGIDA pelo texto)`);
}

await b.close();
