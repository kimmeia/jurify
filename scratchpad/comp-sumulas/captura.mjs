/**
 * Fotografa a tela de Conhecimento jurídico no estado que a branch estiver.
 *   node captura.mjs <pasta> <sessao-admin>
 * Três alvos: a tabela de fontes, o diálogo de colar súmulas e o painel da
 * sondagem (dentro da dobra "Sondagem, fila de ingestão, zerar").
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [OUT, SESSAO] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1920, height: 2600 }, storageState: SESSAO });
const p = await ctx.newPage();

const irPara = async (rota) => {
  await p.goto(`http://localhost:3000${rota}`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3500);
};

// 1. a tabela de fontes
await irPara("/admin/ia?aba=conhecimento");
const tabela = p.locator("table").first();
if (await tabela.count()) {
  const cartao = p.locator('[data-slot="card"]').filter({ has: tabela }).first();
  await (await cartao.count() ? cartao : tabela).screenshot({ path: `${OUT}/fontes.png` });
  console.log("fontes.png ok");
} else {
  console.log("!! tabela de fontes não encontrada");
  await p.screenshot({ path: `${OUT}/fontes.png`, fullPage: false });
}

// 2. o diálogo de colar (só existe no DEPOIS)
const botaoColar = p.locator('button:has-text("Colar texto oficial")').first();
if (await botaoColar.count()) {
  await botaoColar.click();
  await p.waitForTimeout(1200);
  const dlg = p.locator('[role="dialog"]').first();
  await dlg.screenshot({ path: `${OUT}/colar.png` });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(600);
  console.log("colar.png ok");
} else {
  console.log("(sem botão de colar neste estado)");
}

// 3. a sondagem, dentro de DUAS dobras (o painel técnico inteiro mora numa)
const dobraExterna = p.locator('summary:has-text("Tribunais e varredura")').first();
if (await dobraExterna.count()) {
  await dobraExterna.scrollIntoViewIfNeeded();
  await dobraExterna.click();
  await p.waitForTimeout(2000);
}
const ferramentas = p.locator('button:has-text("Mostrar ferramentas técnicas")').first();
if (await ferramentas.count()) {
  await ferramentas.scrollIntoViewIfNeeded();
  await ferramentas.click();
  await p.waitForTimeout(1500);
} else {
  console.log("(botão de ferramentas técnicas não encontrado)");
}
const sondar = p.locator('button:has-text("Sondar")').first();
if (await sondar.count()) {
  await sondar.scrollIntoViewIfNeeded();
  await sondar.click();
  await p.waitForTimeout(3000);
  // O cartão exato, marcado no DOM pelo TÍTULO: filtrar `div` por "tem o botão
  // Sondar dentro" pega a barra de busca (o mais de dentro) ou a página inteira
  // (o mais de fora) — as duas coisas já saíram nas tentativas anteriores.
  const achou = await p.evaluate(() => {
    const alvo = [...document.querySelectorAll("*")].find(
      (e) => e.children.length === 0 && /Sondagem de fontes públicas|Quais fontes o robô consegue ler/.test(e.textContent || ""),
    );
    const cartao = alvo?.closest('[data-slot="card"]');
    if (!cartao) return false;
    cartao.setAttribute("data-alvo-foto", "1");
    return true;
  });
  console.log("cartão marcado?", achou);
  if (achou) {
    const cx = p.locator('[data-alvo-foto="1"]');
    await cx.scrollIntoViewIfNeeded();
    await p.waitForTimeout(500);
    await cx.screenshot({ path: `${OUT}/sondagem.png` });
  } else {
    await p.screenshot({ path: `${OUT}/sondagem.png` });
  }
  console.log("sondagem.png ok");
} else {
  console.log("!! botão Sondar não encontrado");
}

await b.close();
