/**
 * Fotografa a MESMA tela real do app com cada direção visual aplicada.
 * A direção é uma folha de estilo injetada por cima do app rodando — mesma
 * marcação, mesmos dados, só a pele muda. É assim que a comparação é honesta.
 *
 *   node scratchpad/direcoes/captura.mjs
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SESSAO = "/home/user/jurify/scratchpad/comp-sumulas/sessao-dono.json";
const raiz = "/home/user/jurify/scratchpad/direcoes";

const DIRECOES = [
  { id: "hoje", css: null },
  { id: "1-escuro", css: `${raiz}/css/1-escuro.css` },
  { id: "2-claro", css: `${raiz}/css/2-claro.css` },
  { id: "3-marca", css: `${raiz}/css/3-marca.css` },
];

const TELAS = [
  { id: "dashboard", url: "/dashboard", esperar: "text=Dashboard", rolar: 0 },
  { id: "atendimento", url: "/atendimento", esperar: "text=Tirzah", clicar: "Tirzah" },
  { id: "financeiro", url: "/financeiro", esperar: "text=Financeiro", rolar: 0 },
];

const VIEWPORTS = [
  ["pc", { width: 1440, height: 900 }],
  ["cel", { width: 390, height: 844 }],
];

// A faixa de STAGING não existe em produção e pintaria o topo de toda foto.
const SEM_FAIXA = `div[role="status"].bg-warning { display: none !important; }`;

const b = await chromium.launch({ executablePath: EXEC });
for (const [vp, viewport] of VIEWPORTS) {
  for (const tela of TELAS) {
    if (vp === "cel" && tela.id === "financeiro") continue;
    for (const d of DIRECOES) {
      const ctx = await b.newContext({ storageState: SESSAO, viewport, deviceScaleFactor: 2 });
      const p = await ctx.newPage();
      await p.goto(`http://localhost:3000${tela.url}`, { waitUntil: "domcontentloaded" });
      await p.waitForSelector(tela.esperar, { timeout: 45000 }).catch(() => {});
      await p.waitForTimeout(2500);
      await p.addStyleTag({ content: SEM_FAIXA });
      if (d.css) await p.addStyleTag({ content: readFileSync(d.css, "utf8") });
      if (tela.clicar) {
        await p.locator(`text=${tela.clicar}`).first().click().catch(() => {});
        await p.waitForTimeout(1800);
      }
      await p.waitForTimeout(900);
      await p.screenshot({ path: `${raiz}/fotos/${tela.id}-${d.id}-${vp}.png` });
      console.log(`${tela.id}-${d.id}-${vp}.png`);
      await ctx.close();
    }
  }
}
await b.close();
