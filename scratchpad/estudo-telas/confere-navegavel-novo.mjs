/**
 * Dirige o navegável por Playwright ANTES de entregar: as 12 combinações
 * (3 telas × antes/depois × computador/celular) têm que aparecer com conteúdo.
 * Combinação em branco não aparece sozinha — foi assim que um navegável já
 * saiu daqui pela metade.
 *
 *   node confere-navegavel-novo.mjs <arquivo.html> [pastaFotos]
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [ARQ, FOTOS] = process.argv.slice(2);
if (FOTOS) mkdirSync(FOTOS, { recursive: true });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const erros = [];
p.on("console", (m) => m.type() === "error" && erros.push(m.text()));
await p.goto(`file://${ARQ}`, { waitUntil: "load" });
await p.waitForTimeout(1200);

let falhas = 0;
for (const tela of ["hoje", "atendimento", "financeiro"]) {
  await p.click(`nav.telas button[data-tela="${tela}"]`);
  for (const lado of ["antes", "depois"]) {
    await p.click(`#ch-lado button[data-lado="${lado}"]`);
    for (const modo of ["comp", "cel"]) {
      await p.click(`#ch-modo button[data-modo="${modo}"]`);
      await p.waitForTimeout(450);
      const r = await p.evaluate(() => {
        const el = document.querySelector(".palco-conteudo:not([hidden])");
        if (!el) return { vazio: true, motivo: "nenhum painel visível" };
        const img = el.querySelector("img:not([style*='display: none'])");
        const visiveis = [...el.querySelectorAll("img")].filter((i) => i.offsetParent !== null);
        const txt = (el.innerText || "").trim().length;
        const cx = el.getBoundingClientRect();
        return {
          vazio: cx.width < 40 || cx.height < 40,
          texto: txt,
          imgs: visiveis.length,
          imgOk: visiveis.every((i) => i.naturalWidth > 0),
          larguraPalco: document.getElementById("palco").style.width,
          temImg: !!img,
        };
      });
      const ok = !r.vazio && (r.texto > 120 || (r.imgs > 0 && r.imgOk));
      if (!ok) { falhas++; console.log(`VAZIO  ${tela}/${lado}/${modo} ${JSON.stringify(r)}`); }
      else console.log(`ok     ${tela}/${lado}/${modo} · palco ${r.larguraPalco} · ${r.imgs ? "foto" : r.texto + " car."}`);
      if (FOTOS) await p.screenshot({ path: `${FOTOS}/${tela}-${lado}-${modo}.png` });
    }
  }
}
console.log(`\n${12 - falhas}/12 combinações com conteúdo · erros de console: ${erros.length}`);
if (erros.length) console.log(erros.slice(0, 3).join("\n"));
await b.close();
process.exit(falhas || erros.length ? 1 : 0);
