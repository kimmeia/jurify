/**
 * Dirige o comparador no navegador antes de entregar.
 *
 * Confere, de verdade: que toda foto carregou (naturalWidth > 0), que cada
 * anel está DENTRO da foto, que o anel MUDA entre os dois lados — foi assim
 * que em 12/09 se descobriu que três de dez anéis estavam no elemento errado
 * —, e que o botão Piscar abre e fecha.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
await p.goto("file:///home/user/jurify/comparador-aniversario-cliente.html");
await p.waitForTimeout(2500);

let falhas = 0;
const diz = (ok, txt) => {
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${txt}`);
};

const imgs = await p.evaluate(() =>
  [...document.images].map((i) => ({ w: i.naturalWidth, h: i.naturalHeight, alt: i.alt })),
);
diz(imgs.length > 0, `${imgs.length} imagens no arquivo`);
diz(imgs.every((i) => i.w > 0 && i.h > 0), "toda imagem carregou (nenhuma em branco)");

const comps = await p.evaluate(() =>
  [...document.querySelectorAll("section.comp:not(.so-uma)")].map((s) => {
    const figs = [...s.querySelectorAll("figure")].map((f) => {
      const foto = f.querySelector(".foto").getBoundingClientRect();
      const an = f.querySelector(".anel").getBoundingClientRect();
      return {
        dentro:
          an.left >= foto.left - 1 && an.top >= foto.top - 1 &&
          an.right <= foto.right + 1 && an.bottom <= foto.bottom + 1,
        w: Math.round(an.width), h: Math.round(an.height),
        relW: +(an.width / foto.width).toFixed(4), relH: +(an.height / foto.height).toFixed(4),
      };
    });
    return { id: s.id, figs };
  }),
);

for (const c of comps) {
  diz(c.figs.length === 2, `${c.id}: dois lados`);
  diz(c.figs.every((f) => f.dentro), `${c.id}: anel dentro da foto nos dois lados`);
  const [a, d] = c.figs;
  const mudou = Math.abs(a.relW - d.relW) > 0.01 || Math.abs(a.relH - d.relH) > 0.01;
  diz(mudou, `${c.id}: o anel MUDA entre hoje e a proposta (${a.w}×${a.h} → ${d.w}×${d.h})`);
}

// Piscar abre e fecha
const primeiro = comps[0].id.replace("c-", "");
await p.click(`#c-${primeiro} .acoes button`);
await p.waitForTimeout(700);
diz(await p.locator(`#pisca-${primeiro}`).isVisible(), "Piscar abre a sobreposição");
await p.click(`#c-${primeiro} .acoes button`);
await p.waitForTimeout(500);
diz(!(await p.locator(`#pisca-${primeiro}`).isVisible()), "Piscar fecha de novo");

// Celular: nada pode vazar de lado
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(1200);
const larg = await p.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  win: window.innerWidth,
}));
diz(larg.doc <= larg.win + 1, `cabe em 390px (conteúdo ${larg.doc}px)`);

await p.setViewportSize({ width: 1400, height: 1000 });
await p.waitForTimeout(800);
await p.screenshot({ path: "comparador-aberto.png" });

console.log(falhas === 0 ? "\nTUDO CERTO" : `\n${falhas} FALHA(S)`);
await b.close();
process.exit(falhas === 0 ? 0 : 1);
