/**
 * Fotografa as telas do dono nos dois temas, num estado do código.
 *
 *   node captura-piloto.mjs <sessao.json> <pasta> <rotulo>
 *
 * O tema escuro é ligado pela classe `.dark` no <html>, que é como o próprio
 * app faz — não é filtro nem CSS inventado por cima.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [SESSAO, PASTA, ROTULO] = process.argv.slice(2);
mkdirSync(PASTA, { recursive: true });

const TELAS = [
  { id: "dashboard", url: "/dashboard" },
  { id: "clientes", url: "/clientes" },
  { id: "financeiro", url: "/financeiro" },
];

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const tema of ["claro", "escuro"]) {
  const ctx = await b.newContext({
    storageState: SESSAO,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  // O tema é do PRÓPRIO app: preferência em localStorage, resolvida pelo
  // ThemeContext. Forçar a classe .dark no <html> por fora não funciona — o
  // contexto reescreve depois de hidratar, e a foto sai clara.
  await ctx.addInitScript(([escuro]) => {
    try { localStorage.setItem("jurify:tema", escuro ? "escuro" : "claro"); } catch {}
    const por = () => {
      const st = document.createElement("style");
      st.textContent = ".bg-warning.text-center.select-none{display:none !important}";
      document.head && document.head.appendChild(st);
    };
    if (document.head) por(); else addEventListener("DOMContentLoaded", por);
  }, [tema === "escuro"]);

  const p = await ctx.newPage();
  for (const tela of TELAS) {
    await p.goto(`http://localhost:3000${tela.url}`, { waitUntil: "domcontentloaded", timeout: 40000 });
    await p.waitForTimeout(4200);
    await p.screenshot({ path: `${PASTA}/${tela.id}-${tema}-${ROTULO}.png` });
    console.log(`${tela.id}/${tema}/${ROTULO} ok`);
  }
  await ctx.close();
}
await b.close();
