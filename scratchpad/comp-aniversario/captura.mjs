/**
 * Fotografa as telas do cadastro de cliente no estado em que a branch estiver.
 *   node captura.mjs <pasta-de-saida> <porta> [largura]
 *
 * Quatro alvos, os mesmos nos dois lados da comparação:
 *   1. novo-cliente.png — o diálogo "Novo cliente" (bloco de qualificação civil)
 *   2. lista.png        — a barra de filtros da lista de Clientes
 *   3. ficha.png        — o hero da ficha do cliente
 *   4. notificacoes.png — a tela Configurações → Notificações
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [OUT, PORTA = "3000", LARGURA = "1600"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const BASE = `http://localhost:${PORTA}`;
const SESSAO = "/home/user/jurify/scratchpad/comp-sumulas/sessao-dono.json";

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await b.newContext({
  viewport: { width: Number(LARGURA), height: 1400 },
  storageState: SESSAO,
  deviceScaleFactor: 2,
});
const p = await ctx.newPage();

const irPara = async (rota) => {
  await p.goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3500);
};

/** Marca no DOM o elemento que vai ser fotografado — nunca "a div de fora". */
async function marcar(fn) {
  return p.evaluate(fn);
}

async function fotoDoAlvo(nome) {
  const alvo = p.locator("[data-alvo-foto]").first();
  if (await alvo.count()) {
    await alvo.screenshot({ path: `${OUT}/${nome}.png` });
    console.log(`${nome}.png ok`);
    return true;
  }
  console.log(`!! ${nome}: alvo não encontrado — página inteira`);
  await p.screenshot({ path: `${OUT}/${nome}.png` });
  return false;
}

// ── 1. Novo cliente ──────────────────────────────────────────────────────────
await irPara("/clientes");
const novo = p.locator('button:has-text("Novo cliente")').first();
if (await novo.count()) {
  await novo.click();
  await p.waitForTimeout(2000);
  await p.locator('[role="dialog"]').first().screenshot({ path: `${OUT}/novo-cliente.png` });
  console.log("novo-cliente.png ok");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1000);
} else {
  console.log("!! botão Novo cliente não encontrado");
}

// ── 2. Barra de filtros da lista ─────────────────────────────────────────────
await marcar(() => {
  document.querySelectorAll("[data-alvo-foto]").forEach((e) => e.removeAttribute("data-alvo-foto"));
  const botao = [...document.querySelectorAll("button")].find((b) =>
    /^Responsável$/.test((b.textContent || "").trim()),
  );
  // O invólucro da barra: sobe até o elemento que também contém a busca.
  let el = botao;
  while (el && !el.querySelector('input[placeholder*="Nome, telefone"]')) el = el.parentElement;
  if (el) el.setAttribute("data-alvo-foto", "1");
  return !!el;
});
await fotoDoAlvo("lista");

// ── 3. Ficha do cliente ──────────────────────────────────────────────────────
const nomeCliente = p.locator("text=Maria Aparecida Nogueira de Sousa").first();
if (await nomeCliente.count()) {
  await nomeCliente.click();
  await p.waitForTimeout(3500);
} else {
  console.log("!! cliente de teste não encontrado na lista");
}
const achouHero = await marcar(() => {
  document.querySelectorAll("[data-alvo-foto]").forEach((e) => e.removeAttribute("data-alvo-foto"));
  const h2 = [...document.querySelectorAll("h2")].find((h) =>
    /Maria Aparecida/.test(h.textContent || ""),
  );
  if (!h2) return false;
  // Só a faixa azul: sobe até o bloco que tem os botões de ação. Incluir os
  // KPIs e o formulário faria uma foto de 3.400px onde o selo some.
  let el = h2;
  while (el && !/Gerar contrato/.test(el.textContent || "")) el = el.parentElement;
  if (el) el.setAttribute("data-alvo-foto", "1");
  return !!el;
});
console.log("hero marcado?", achouHero);
await fotoDoAlvo("ficha");

// ── 4. Configurações → Notificações ──────────────────────────────────────────
await irPara("/configuracoes?tab=notificacoes");
await marcar(() => {
  document.querySelectorAll("[data-alvo-foto]").forEach((e) => e.removeAttribute("data-alvo-foto"));
  const titulo = [...document.querySelectorAll("*")].find(
    (e) => e.children.length === 0 && /^Atendimento$/.test((e.textContent || "").trim()),
  );
  const cartao = titulo?.closest('[data-slot="card"]');
  if (cartao) cartao.setAttribute("data-alvo-foto", "1");
  return !!cartao;
});
await fotoDoAlvo("notificacoes");

await b.close();
