/**
 * O "antes" no celular, para o navegável. Sem isto a chave Computador⟷Celular
 * só teria um lado, que é o erro que o dono já reprovou uma vez.
 *
 *   node antes-celular.mjs <sessao.json> <pasta>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [SESSAO, PASTA] = process.argv.slice(2);
mkdirSync(PASTA, { recursive: true });

const TELAS = [
  ["hoje", "/dashboard"],
  ["atendimento", "/atendimento"],
  ["financeiro", "/financeiro"],
];

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ storageState: SESSAO, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
// O app manda celular para /atendimento; esta chave abre o app completo.
await ctx.addInitScript(() => {
  try { localStorage.setItem("jurify:mobileCompleto", "1"); } catch {}
  const por = () => {
    const st = document.createElement("style");
    st.textContent = ".bg-warning.text-center.select-none{display:none !important}";
    document.head && document.head.appendChild(st);
  };
  if (document.head) por(); else addEventListener("DOMContentLoaded", por);
});
const p = await ctx.newPage();
for (const [id, rota] of TELAS) {
  await p.goto(`http://localhost:3000${rota}`, { waitUntil: "domcontentloaded", timeout: 40000 });
  await p.waitForTimeout(4500);
  await p.screenshot({ path: `${PASTA}/${id}-antes-celular.png`, fullPage: true });
  console.log(`${id} celular ok`);
}
await b.close();
