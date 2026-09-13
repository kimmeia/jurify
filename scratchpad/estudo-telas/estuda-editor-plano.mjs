/**
 * Fotografa e MEDE o editor de plano (/admin/planos/:slug) — a tela que o dono
 * chamou de feia. Mede o que o navegador realmente pintou: largura do conteúdo
 * contra a da janela (rolagem lateral), largura da coluna da esquerda, e todo
 * elemento cujo texto TRANSBORDA a caixa.
 *
 *   node estuda-editor-plano.mjs <sessao.json> <pasta-de-saida>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const [SESSAO, SAIDA] = process.argv.slice(2);
mkdirSync(SAIDA, { recursive: true });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const [nome, largura, altura] of [["monitor", 1440, 900], ["celular", 390, 844]]) {
  const ctx = await b.newContext({
    storageState: SESSAO,
    viewport: { width: largura, height: altura },
    deviceScaleFactor: 2,
  });
  const p = await ctx.newPage();
  await p.goto("http://localhost:3000/admin/planos/atende", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(4000);

  const medida = await p.evaluate(() => {
    const doc = document.documentElement;
    const transbordam = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const folgaX = el.scrollWidth - Math.ceil(r.width);
      const folgaY = el.scrollHeight - Math.ceil(r.height);
      const est = getComputedStyle(el);
      const cortado = est.overflow === "visible" || est.overflowX === "visible";
      if ((folgaX > 2 || folgaY > 2) && el.children.length === 0 && cortado) {
        transbordam.push({
          txt: (el.textContent || "").trim().slice(0, 48),
          caixa: `${Math.round(r.width)}x${Math.round(r.height)}`,
          conteudo: `${el.scrollWidth}x${el.scrollHeight}`,
        });
      }
    }
    const rotulos = [...document.querySelectorAll("label")].map((l) => ({
      t: (l.textContent || "").trim().slice(0, 30),
      w: Math.round(l.getBoundingClientRect().width),
      h: Math.round(l.getBoundingClientRect().height),
    }));
    const colunas = [...document.querySelectorAll("main > div, main > form > div")].map((d) => ({
      w: Math.round(d.getBoundingClientRect().width),
      cls: d.className.slice(0, 70),
    }));
    return {
      janela: window.innerWidth,
      conteudo: doc.scrollWidth,
      rolaDeLado: doc.scrollWidth - window.innerWidth,
      transbordam: transbordam.slice(0, 25),
      rotulosAltos: rotulos.filter((r) => r.h > 22).slice(0, 15),
      colunas: colunas.slice(0, 8),
    };
  });

  writeFileSync(`${SAIDA}/medida-${nome}.json`, JSON.stringify(medida, null, 2));
  console.log(`\n### ${nome} (${largura}px)`);
  console.log(`janela ${medida.janela} · conteúdo ${medida.conteudo} · rola de lado ${medida.rolaDeLado}px`);
  console.log(`textos que transbordam a própria caixa: ${medida.transbordam.length}`);
  for (const t of medida.transbordam.slice(0, 8)) console.log(`  "${t.txt}" caixa ${t.caixa} conteúdo ${t.conteudo}`);

  await p.screenshot({ path: `${SAIDA}/editor-plano-${nome}.png`, fullPage: nome === "monitor" });
  await ctx.close();
}

await b.close();
