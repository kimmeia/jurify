/**
 * Fotografa as DUAS telas que compartilham o mesmo componente, pra provar a
 * separação: o cadastro novo exige a data, a edição não.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
mkdirSync("obrigatorio", { recursive: true });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({
  viewport: { width: 1600, height: 1400 },
  storageState: "/home/user/jurify/scratchpad/comp-sumulas/sessao-dono.json",
  deviceScaleFactor: 2,
});
const p = await ctx.newPage();

const recorte = async (nome) => {
  const caixa = await p.evaluate(() => {
    const lbl = [...document.querySelectorAll("label")].find((l) =>
      /Data de nascimento/.test(l.textContent || ""));
    if (!lbl) return null;
    const nac = [...document.querySelectorAll("label")].find((l) =>
      /Nacionalidade/.test(l.textContent || ""));
    const a = (nac || lbl).parentElement.getBoundingClientRect();
    const c = lbl.parentElement.getBoundingClientRect();
    lbl.parentElement.scrollIntoView({ block: "center" });
    return new Promise((r) => setTimeout(() => {
      const a2 = (nac || lbl).parentElement.getBoundingClientRect();
      const c2 = lbl.parentElement.getBoundingClientRect();
      const x = Math.min(a2.left, c2.left) - 10, y = Math.min(a2.top, c2.top) - 10;
      r({ x: Math.max(0, x), y: Math.max(0, y),
          width: Math.max(a2.right, c2.right) - x + 10,
          height: Math.max(a2.bottom, c2.bottom) - y + 10 });
    }, 500));
  });
  if (!caixa) { console.log(`!! ${nome}: campo não encontrado`); return; }
  await p.screenshot({ path: `obrigatorio/${nome}.png`, clip: caixa });
  console.log(`${nome}.png ok`);
};

// 1. Novo cliente — tem que exigir
await p.goto("http://localhost:3000/clientes", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
await p.locator('button:has-text("Novo cliente")').first().click();
await p.waitForTimeout(2000);
await recorte("cadastro-novo");

// Prova de comportamento: clicar em Cadastrar com tudo menos a data.
await p.fill('input[placeholder="Nome completo"]', "Teste Obrigatorio");
await p.fill('input[placeholder="(85) 99999-0000"]', "85999990000");
await p.fill('input[placeholder="000.000.000-00"]', "39053344705");
await p.fill('input[placeholder="Ex: Engenheiro civil"]', "Engenheira");
await p.fill('input[placeholder="Brasileira"]', "Brasileira");
await p.click('button:has-text("Cadastrar")');
await p.waitForTimeout(1800);
const toast = await p.evaluate(() =>
  [...document.querySelectorAll("[data-sonner-toast], [role='status']")]
    .map((t) => t.textContent).join(" | "));
console.log("aviso ao tentar cadastrar sem a data:", toast || "(nenhum)");
await p.keyboard.press("Escape");
await p.waitForTimeout(1200);

// 2. Edição da ficha — NÃO pode exigir
await p.locator("text=Maria Aparecida Nogueira de Sousa").first().click();
await p.waitForTimeout(3500);
await recorte("edicao");

await b.close();
