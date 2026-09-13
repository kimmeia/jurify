/**
 * QUEM empurra a tela do editor de plano para fora da janela.
 *
 * A pergunta não é "quanto rola de lado" (isso já foi medido: 2110px numa
 * janela de 1440) e sim QUAL elemento exige essa largura. Um filho de grid
 * nasce com `min-width: auto`, então basta um conteúdo que não quebra para a
 * coluna inteira crescer e levar a linha junto — o culpado costuma estar
 * fundo na árvore, não no container que aparenta estar largo.
 *
 *   node culpado-editor-plano.mjs <sessao.json>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";

const [SESSAO] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ storageState: SESSAO, viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/admin/planos/atende", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);

const r = await p.evaluate(() => {
  const janela = window.innerWidth;
  const fora = [];
  for (const el of document.querySelectorAll("body *")) {
    const c = el.getBoundingClientRect();
    if (c.right <= janela + 1 || c.width < 20) continue;
    // só quem NÃO tem filho igualmente largo: é o que realmente exige a largura
    const filhoLargo = [...el.children].some((f) => f.getBoundingClientRect().right > janela + 1);
    if (filhoLargo) continue;
    const est = getComputedStyle(el);
    fora.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 90),
      txt: (el.textContent || "").trim().slice(0, 60),
      largura: Math.round(c.width),
      direita: Math.round(c.right),
      minW: est.minWidth,
      quebra: est.whiteSpace,
      flex: est.flex,
    });
  }
  // colunas do grid principal
  const grid = [...document.querySelectorAll("div")].find((d) =>
    getComputedStyle(d).display === "grid" && d.getBoundingClientRect().width > 1200,
  );
  const colunas = grid
    ? { template: getComputedStyle(grid).gridTemplateColumns, largura: Math.round(grid.getBoundingClientRect().width),
        filhos: [...grid.children].map((f) => ({
          w: Math.round(f.getBoundingClientRect().width),
          minW: getComputedStyle(f).minWidth,
          cls: (f.className || "").toString().slice(0, 60),
        })) }
    : null;
  return { janela, conteudo: document.documentElement.scrollWidth, fora: fora.slice(0, 12), colunas };
});

console.log(`janela ${r.janela} · conteúdo ${r.conteudo}`);
console.log("\n— grid principal —");
console.log(JSON.stringify(r.colunas, null, 2));
console.log("\n— quem passa da borda e não tem filho igualmente largo —");
for (const f of r.fora) {
  console.log(`${f.tag} w=${f.largura} direita=${f.direita} minW=${f.minW} ws=${f.quebra}`);
  console.log(`   cls: ${f.cls}`);
  console.log(`   txt: ${f.txt}`);
}
await b.close();
