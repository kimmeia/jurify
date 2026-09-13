/**
 * Captura o editor de plano (e o Dashboard, pro piloto visual) num estado do
 * código — "antes" ou "depois" — e MEDE a largura do conteúdo contra a janela.
 *
 *   node captura-editor.mjs <sessao.json> <pasta> <rotulo>
 *
 * Roda contra o app em pé: troque de branch, espere o Vite recarregar, rode de
 * novo com outro rótulo. É a regra da casa — o "depois" é foto, não desenho.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const [SESSAO, PASTA, ROTULO] = process.argv.slice(2);
mkdirSync(PASTA, { recursive: true });

const TELAS = [
  { id: "editor", url: "/admin/planos/atende" },
  { id: "dashboard", url: "/dashboard" },
];
const TAMANHOS = [
  { id: "monitor", w: 1440, h: 900 },
  { id: "celular", w: 390, h: 844 },
];

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const medidas = {};

for (const t of TAMANHOS) {
  const ctx = await b.newContext({
    storageState: SESSAO,
    viewport: { width: t.w, height: t.h },
    deviceScaleFactor: 2,
  });
  // A faixa "STAGING" não existe em produção e pintaria de âmbar o topo de
  // toda foto — num estudo de estética isso vira achado falso.
  await ctx.addInitScript(() => {
    const por = () => {
      const st = document.createElement("style");
      st.textContent = ".bg-warning.text-center.select-none{display:none !important}";
      document.head && document.head.appendChild(st);
    };
    if (document.head) por(); else addEventListener("DOMContentLoaded", por);
  });
  const p = await ctx.newPage();
  if (t.w < 700) {
    // o app manda celular pro /atendimento; esta chave abre o app completo
    await p.addInitScript(() => localStorage.setItem("jurify:mobileCompleto", "1"));
  }
  for (const tela of TELAS) {
    await p.goto(`http://localhost:3000${tela.url}`, { waitUntil: "domcontentloaded", timeout: 40000 });
    await p.waitForTimeout(4200);
    const m = await p.evaluate(() => ({
      janela: window.innerWidth,
      conteudo: document.documentElement.scrollWidth,
      altura: document.documentElement.scrollHeight,
    }));
    medidas[`${tela.id}-${t.id}`] = m;
    await p.screenshot({ path: `${PASTA}/${tela.id}-${t.id}-${ROTULO}.png`, fullPage: true });
    console.log(`${tela.id}/${t.id}/${ROTULO}: janela ${m.janela} · conteúdo ${m.conteudo} · rola ${m.conteudo - m.janela}px`);
  }
  await ctx.close();
}

writeFileSync(`${PASTA}/medidas-${ROTULO}.json`, JSON.stringify(medidas, null, 2));
await b.close();
