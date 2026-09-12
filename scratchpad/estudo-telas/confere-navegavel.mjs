/**
 * Dirige o mockup navegável como o dono vai dirigir, e confere que cada
 * combinação (tela × antes/depois × computador/celular) desenhou algo.
 * Tira foto das combinações que interessam para conferência visual.
 *
 *   node confere-navegavel.mjs <mockup.html> <pasta-de-fotos>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [ARQ, FOTOS] = process.argv.slice(2);
mkdirSync(FOTOS, { recursive: true });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const erros = [];
p.on("pageerror", (e) => erros.push(String(e).slice(0, 160)));
p.on("console", (m) => { if (m.type() === "error") erros.push("console: " + m.text().slice(0, 160)); });

await p.goto(`file://${ARQ}`, { waitUntil: "load", timeout: 60000 });
await p.waitForTimeout(1500);

const TELAS = await p.$$eval("[data-tela]", (bs) => bs.map((b) => b.dataset.tela));
const FOTOGRAFAR = new Set(["dashboard", "agenda", "financeiro", "movimentacoes", "acordos", "tarefas", "processos"]);

console.log("tela".padEnd(16), "estado".padEnd(8), "vista".padEnd(9), "nós", "texto", "larg×alt do corpo");
for (const vp of ["desktop", "celular"]) {
  await p.click(`[data-vp="${vp}"]`);
  for (const tela of TELAS) {
    await p.click(`[data-tela="${tela}"]`);
    for (const estado of ["antes", "depois"]) {
      await p.click(`[data-estado="${estado}"]`);
      await p.waitForTimeout(700);
      const d = await p.evaluate(() => {
        const f = document.getElementById("quadro");
        const doc = f.contentDocument;
        const body = doc && doc.body;
        return {
          nos: body ? body.querySelectorAll("*").length : 0,
          texto: body ? (body.innerText || "").trim().length : 0,
          larg: body ? body.scrollWidth : 0,
          alt: body ? body.scrollHeight : 0,
          rolaLado: body ? body.scrollWidth > doc.documentElement.clientWidth + 4 : false,
          fonte: body ? getComputedStyle(body).fontFamily.split(",")[0] : "?",
        };
      });
      const ruim = d.nos < 80 || d.texto < 80;
      console.log(
        tela.padEnd(16), estado.padEnd(8), vp.padEnd(9),
        String(d.nos).padEnd(5), String(d.texto).padEnd(6),
        `${d.larg}×${d.alt}`.padEnd(12), d.fonte.padEnd(9),
        d.rolaLado ? "ROLA DE LADO" : "", ruim ? "  ← VAZIO?" : "",
      );
      if (ruim) erros.push(`${tela}/${estado}/${vp} veio vazio (${d.nos} nós, ${d.texto} chars)`);
      if (FOTOGRAFAR.has(tela)) {
        await p.screenshot({ path: `${FOTOS}/${vp}-${tela}-${estado}.png`, fullPage: false });
      }
    }
  }
}

console.log("\n" + (erros.length ? `ERROS (${erros.length}):\n` + erros.join("\n") : "nenhum erro de página"));
await b.close();
