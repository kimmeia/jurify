/**
 * Fotografa TODAS as telas do sistema como estão em produção hoje, para o
 * estudo de estética. Página inteira (não só a dobra) no computador, e a
 * primeira tela no celular — é assim que se julga layout.
 *
 *   node fotos-producao.mjs <sessao.json> <pasta>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [SESSAO, PASTA] = process.argv.slice(2);

const ROTAS = [
  ["dashboard", "/dashboard"], ["atendimento", "/atendimento"], ["clientes", "/clientes"],
  ["agenda", "/agenda"], ["processos", "/processos"], ["kanban", "/kanban"],
  ["acordos", "/acordos"], ["financeiro", "/financeiro"], ["relatorios", "/relatorios"],
  ["tarefas", "/tarefas"], ["configuracoes", "/configuracoes"], ["calculos", "/calculos"],
  ["jurisia", "/jurisia"], ["modelos", "/modelos-contrato"], ["automacoes", "/automacoes"],
];

mkdirSync(`${PASTA}/computador`, { recursive: true });
mkdirSync(`${PASTA}/celular`, { recursive: true });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const [pasta, larg, alt, inteira] of [["computador", 1440, 900, true], ["celular", 390, 844, false]]) {
  const ctx = await b.newContext({
    viewport: { width: larg, height: alt }, storageState: SESSAO,
    isMobile: larg < 500, hasTouch: larg < 500, deviceScaleFactor: 1,
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("jurify:mobileCompleto", "1"); } catch {} });
  // A faixa "STAGING — não use dados reais" só existe fora de produção. Ela
  // rouba 24px do topo e pinta a foto de âmbar; num estudo de estética isso
  // vira achado falso.
  await ctx.addInitScript(() => {
    const por = () => {
      const st = document.createElement("style");
      st.textContent = ".bg-warning.text-center.select-none{display:none !important}";
      document.head && document.head.appendChild(st);
    };
    if (document.head) por(); else addEventListener("DOMContentLoaded", por);
  });
  const p = await ctx.newPage();
  for (const [nome, rota] of ROTAS) {
    try {
      await p.goto(`http://localhost:3000${rota}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await p.waitForTimeout(3800);
      // Página inteira no computador tem um teto: tela de 4.000px vira foto
      // que ninguém lê. Acima disso, corta na altura útil.
      const h = await p.evaluate(() => document.scrollingElement.scrollHeight);
      await p.screenshot({
        path: `${PASTA}/${pasta}/${nome}.png`,
        fullPage: inteira && h <= 2600,
        ...(inteira && h > 2600 ? { clip: { x: 0, y: 0, width: larg, height: 2600 } } : {}),
      });
      console.log(`${pasta}/${nome}`.padEnd(28), `altura ${h}px`);
    } catch (e) {
      console.log(`${pasta}/${nome} FALHOU: ${String(e).slice(0, 70)}`);
    }
  }
  await ctx.close();
}
await b.close();
