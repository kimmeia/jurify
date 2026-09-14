/**
 * Os dois alvos que precisam de interação: o filtro Aniversário aberto e a
 * faixa de Notificações onde o grupo novo aparece.
 *   node captura2.mjs <pasta> <porta>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [OUT, PORTA = "3000"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const BASE = `http://localhost:${PORTA}`;

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await b.newContext({
  viewport: { width: 1600, height: 1600 },
  storageState: "/home/user/jurify/scratchpad/comp-sumulas/sessao-dono.json",
  deviceScaleFactor: 2,
});
const p = await ctx.newPage();

// ── 1. O filtro aberto ───────────────────────────────────────────────────────
await p.goto(`${BASE}/clientes`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3500);
const botao = p.locator('button:has-text("Aniversário")').first();
if (await botao.count()) {
  await botao.click();
  await p.waitForTimeout(1200);
} else {
  // No "antes" o botão não existe — abre o vizinho pra a foto ter a mesma cara.
  const cadastro = p.locator('button:has-text("Cadastro")').first();
  if (await cadastro.count()) {
    await cadastro.click();
    await p.waitForTimeout(1200);
  }
}
// A barra + o popover aberto, recortados juntos.
const caixa = await p.evaluate(() => {
  const busca = document.querySelector('input[placeholder*="Nome, telefone"]');
  let barra = busca;
  while (barra && !barra.querySelector?.('button')) barra = barra.parentElement;
  const pop = document.querySelector("[data-radix-popper-content-wrapper]");
  const r1 = (barra || busca).getBoundingClientRect();
  const r2 = pop ? pop.getBoundingClientRect() : r1;
  const x = Math.min(r1.left, r2.left) - 8;
  const y = Math.min(r1.top, r2.top) - 8;
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.max(r1.right, r2.right) - x + 8,
    height: Math.max(r1.bottom, r2.bottom) - y + 8,
  };
});
await p.screenshot({ path: `${OUT}/filtro.png`, clip: caixa });
console.log("filtro.png ok");

// ── 2. Notificações: a faixa onde o grupo novo entra ─────────────────────────
await p.goto(`${BASE}/configuracoes?tab=notificacoes`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
const recorte = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-slot="card"]')];
  const i = cards.findIndex((c) => (c.textContent || "").trim().startsWith("Atendimento"));
  if (i < 0) return null;
  const primeiro = cards[i];
  const ultimo = cards[Math.min(i + 1, cards.length - 1)];
  primeiro.scrollIntoView({ block: "start" });
  return new Promise((r) =>
    setTimeout(() => {
      const a = primeiro.getBoundingClientRect();
      const bx = ultimo.getBoundingClientRect();
      r({
        x: Math.max(0, a.left - 8),
        y: Math.max(0, a.top - 8),
        width: a.width + 16,
        height: Math.min(bx.bottom - a.top + 16, window.innerHeight - Math.max(0, a.top - 8)),
      });
    }, 600),
  );
});
if (recorte) {
  await p.screenshot({ path: `${OUT}/notificacoes.png`, clip: recorte });
  console.log("notificacoes.png ok");
} else {
  await p.screenshot({ path: `${OUT}/notificacoes.png` });
  console.log("!! cartão Atendimento não encontrado");
}

await b.close();
