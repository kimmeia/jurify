/**
 * Mede, DENTRO de cada foto, onde fica o pedaço que muda — em porcentagem do
 * recorte, que é o que o comparador usa pra desenhar o anel.
 *
 * O anel medido no navegador é o que impede o erro do estudo de 12/09: três
 * dos dez anéis estavam no elemento errado e saíam iguais nos dois lados.
 *
 *   node mede.mjs <pasta> <porta>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const [OUT, PORTA] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const BASE = `http://localhost:${PORTA}`;

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await b.newContext({
  viewport: { width: 1600, height: 1400 },
  storageState: "/home/user/jurify/scratchpad/comp-sumulas/sessao-dono.json",
});
const p = await ctx.newPage();
const medidas = {};

const pct = (alvo, dentro) => ({
  left: ((alvo.left - dentro.left) / dentro.width) * 100,
  top: ((alvo.top - dentro.top) / dentro.height) * 100,
  width: (alvo.width / dentro.width) * 100,
  height: (alvo.height / dentro.height) * 100,
});

// ── novo-cliente: a linha Nacionalidade + Data de nascimento ─────────────────
await p.goto(`${BASE}/clientes`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3500);
await p.locator('button:has-text("Novo cliente")').first().click();
await p.waitForTimeout(2000);
medidas["novo-cliente"] = await p.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  const acha = (re) => [...dlg.querySelectorAll("label")].find((l) => re.test(l.textContent || ""));
  // O alvo é a FAIXA da linha: de Nacionalidade até o fim do campo vizinho,
  // quando ele existe. No "antes" é só a Nacionalidade, que ocupa a largura
  // inteira — é exatamente essa a diferença.
  const nac = acha(/Nacionalidade/)?.parentElement;
  const nasc = acha(/Data de nascimento/)?.parentElement;
  const rn = nac.getBoundingClientRect();
  const rb = nasc ? nasc.getBoundingClientRect() : rn;
  const d = dlg.getBoundingClientRect();
  const left = Math.min(rn.left, rb.left);
  const top = Math.min(rn.top, rb.top);
  return {
    alvo: { left, top, width: Math.max(rn.right, rb.right) - left, height: Math.max(rn.bottom, rb.bottom) - top },
    dentro: { left: d.left, top: d.top, width: d.width, height: d.height },
  };
});
await p.keyboard.press("Escape");
await p.waitForTimeout(900);

// ── lista: o trecho da barra depois do botão "Cadastro" ──────────────────────
medidas["lista"] = await p.evaluate(() => {
  // O MESMO invólucro que a foto usou: sobe do botão Responsável até o
  // elemento que também contém a busca.
  const resp = [...document.querySelectorAll("button")].find((b) => /^Responsável$/.test((b.textContent || "").trim()));
  let barra = resp;
  while (barra && !barra.querySelector('input[placeholder*="Nome, telefone"]')) barra = barra.parentElement;
  const botoes = [...barra.querySelectorAll("button")];
  const cadastro = botoes.find((x) => /^Cadastro$/.test((x.textContent || "").trim()));
  const ultimo = botoes[botoes.length - 1];
  const c = cadastro.getBoundingClientRect();
  const u = ultimo.getBoundingClientRect();
  const d = barra.getBoundingClientRect();
  return {
    alvo: { left: c.right + 4, top: c.top, width: u.right - c.right - 4, height: c.height },
    dentro: { left: d.left, top: d.top, width: d.width, height: d.height },
  };
});

// ── ficha: a linha de contato do hero ────────────────────────────────────────
await p.locator("text=Maria Aparecida Nogueira de Sousa").first().click();
await p.waitForTimeout(3500);
medidas["ficha"] = await p.evaluate(() => {
  const h2 = [...document.querySelectorAll("h2")].find((h) => /Maria Aparecida/.test(h.textContent || ""));
  // A linha dos contatos é a que tem o CPF.
  const linha = [...h2.parentElement.children].find((e) => /810\.442/.test(e.textContent || ""));
  let hero = h2;
  while (hero && !/Gerar contrato/.test(hero.textContent || "")) hero = hero.parentElement;
  const a = linha.getBoundingClientRect();
  const d = hero.getBoundingClientRect();
  return { alvo: { left: a.left, top: a.top, width: a.width, height: a.height },
           dentro: { left: d.left, top: d.top, width: d.width, height: d.height } };
});

// ── notificações: o SEGUNDO cartão do recorte ────────────────────────────────
await p.goto(`${BASE}/configuracoes?tab=notificacoes`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
medidas["notificacoes"] = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-slot="card"]')];
  const i = cards.findIndex((c) => (c.textContent || "").trim().startsWith("Atendimento"));
  const primeiro = cards[i];
  const segundo = cards[Math.min(i + 1, cards.length - 1)];
  primeiro.scrollIntoView({ block: "start" });
  return new Promise((r) =>
    setTimeout(() => {
      const a = primeiro.getBoundingClientRect();
      const s = segundo.getBoundingClientRect();
      const janela = window.innerHeight;
      const dentro = {
        left: a.left - 8,
        top: a.top - 8,
        width: a.width + 16,
        height: Math.min(s.bottom - a.top + 16, janela - Math.max(0, a.top - 8)),
      };
      r({ alvo: { left: s.left, top: s.top, width: s.width, height: s.height }, dentro });
    }, 700),
  );
});

const saida = {};
for (const [k, v] of Object.entries(medidas)) saida[k] = pct(v.alvo, v.dentro);
writeFileSync(`${OUT}/alvos.json`, JSON.stringify(saida, null, 2));
console.log(JSON.stringify(saida, null, 2));
await b.close();
