/**
 * Dirige o comparador e fotografa cada comparação, para OLHAR se a
 * diferença realmente salta. Também acusa lupa que não achou o ponto
 * (cai na tela inteira) e caixa que saiu vazia.
 *
 *   node confere-comparador.mjs <comparador.html> <pasta-de-fotos>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [ARQ, FOTOS] = process.argv.slice(2);
mkdirSync(FOTOS, { recursive: true });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const erros = [];
p.on("pageerror", (e) => erros.push(String(e).slice(0, 180)));
p.on("console", (m) => { if (m.type() === "error") erros.push("console: " + m.text().slice(0, 180)); });

await p.goto(`file://${ARQ}`, { waitUntil: "load", timeout: 60000 });
await p.waitForTimeout(1500);

const quantos = await p.$$eval("[data-i]", (b) => b.length);
console.log("#".padEnd(3), "achado".padEnd(38), "anéis", "borda", "zoom", "conteúdo das duas caixas");

for (let i = 0; i < quantos; i++) {
  await p.click(`[data-i="${i}"]`);
  await p.waitForTimeout(1400);
  const d = await p.evaluate(() => {
    const lentes = [...document.querySelectorAll("#par .lente")];
    const frames = [...document.querySelectorAll("#par iframe")];
    const anel = [...document.querySelectorAll("#par .anel")].filter((a) => !a.hidden).length;
    const borda = [...document.querySelectorAll("#par .borda-tela")].filter((a) => !a.hidden).length;
    const conteudo = frames.map((f) => {
      const doc = f.contentDocument;
      return doc && doc.body ? doc.body.querySelectorAll("*").length : 0;
    });
    const m = (document.getElementById("rodape").textContent || "").match(/Zoom de ([\d.]+)/);
    return {
      titulo: (document.getElementById("titulo").textContent || "").slice(0, 38),
      anel, borda, conteudo,
      zoom: m ? m[1] : "—",
      caixas: lentes.map((l) => `${l.clientWidth}x${l.clientHeight}`).join(" "),
      regua: !!document.querySelector("#regua .regua"),
    };
  });
  const ruim = d.anel < 1 || d.conteudo.some((n) => n < 60);
  console.log(
    String(i + 1).padEnd(3), d.titulo.padEnd(38),
    String(d.anel).padEnd(5), String(d.borda).padEnd(5), String(d.zoom).padEnd(4),
    d.conteudo.join("/").padEnd(12), d.caixas.padEnd(18),
    d.regua ? "régua" : "", ruim ? "  ← CONFERIR" : "",
  );
  if (ruim) erros.push(`achado ${i + 1} (${d.titulo}) sem anel ou com caixa vazia`);
  await p.screenshot({ path: `${FOTOS}/${String(i + 1).padStart(2, "0")}-${d.titulo.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 26)}.png` });
}

// piscar e tela inteira num achado de celular, e o modo navegar
await p.click('[data-i="0"]'); await p.waitForTimeout(900);
await p.click('[data-modo="piscar"]'); await p.waitForTimeout(1500);
await p.screenshot({ path: `${FOTOS}/z-piscar.png` });
await p.click('[data-modo="inteira"]'); await p.waitForTimeout(1600);
await p.screenshot({ path: `${FOTOS}/z-inteira.png` });
await p.click('[data-modo="lado"]'); await p.waitForTimeout(800);
await p.click('[data-tela="clientes"]'); await p.waitForTimeout(2000);
await p.screenshot({ path: `${FOTOS}/z-navegar.png` });
await p.click('[data-pendentes="1"]'); await p.waitForTimeout(700);
await p.screenshot({ path: `${FOTOS}/z-pendentes.png` });

console.log("\n" + (erros.length ? `PROBLEMAS (${erros.length}):\n` + erros.join("\n") : "nenhum erro de página"));
await b.close();
