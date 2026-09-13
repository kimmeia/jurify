/**
 * Fotografa o app com variantes de cor do MENU, aplicadas por cima do CSS
 * real — sem tocar em código. É o "depois" honesto de uma mudança de cor.
 *
 *   node variantes-menu.mjs <sessao.json> <pasta>
 *
 * Por que variantes e não uma: o header do Devular é `#07060f` a 80% sobre um
 * hero ESCURO, e ali isso rende quase-preto. O mesmo 80% num menu lateral de
 * app tem a PÁGINA CLARA atrás e rende grafite (#37363e). "A mesma cor" e "a
 * mesma transparência" deixam de ser a mesma coisa — o dono escolhe olhando.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [SESSAO, PASTA] = process.argv.slice(2);

/** `--sidebar` e vizinhos. Só o menu muda; o resto do app fica intocado. */
const VARIANTES = {
  hoje: "",
  // A: o que está escrito no CSS do Devular, literal.
  transparente: `
    :root { --sidebar: rgba(7,6,15,.8); }
    [data-slot="sidebar"], aside, .bg-sidebar { backdrop-filter: blur(12px); }
  `,
  // B: o que se VÊ no print do header do Devular.
  solido: `:root { --sidebar: #07060f; }`,
  // C: B com o item ativo e a borda afinados para o fundo quase-preto.
  solidoAfinado: `
    :root {
      --sidebar: #07060f;
      --sidebar-accent: #1b1b29;
      --sidebar-border: rgba(255,255,255,.10);
      --sidebar-foreground: #c9c9d4;
    }
  `,
};

const TELAS = [["dashboard", "/dashboard"], ["clientes", "/clientes"], ["processos", "/processos"]];

mkdirSync(PASTA, { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const [variante, css] of Object.entries(VARIANTES)) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: SESSAO });
  await ctx.addInitScript(
    ([extra]) => {
      const por = () => {
        const st = document.createElement("style");
        st.textContent =
          ".bg-warning.text-center.select-none{display:none !important}" + extra;
        document.head && document.head.appendChild(st);
      };
      if (document.head) por(); else addEventListener("DOMContentLoaded", por);
    },
    [css],
  );
  const p = await ctx.newPage();
  for (const [nome, rota] of TELAS) {
    await p.goto(`http://localhost:3000${rota}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await p.waitForTimeout(3800);
    await p.screenshot({ path: `${PASTA}/${nome}-${variante}.png` });
    // recorte só do menu, que é o que muda
    await p.screenshot({ path: `${PASTA}/menu-${nome}-${variante}.png`, clip: { x: 0, y: 0, width: 330, height: 900 } });
  }
  const cor = await p.evaluate(() => {
    const menu = [...document.querySelectorAll("body *")].find((el) => {
      const c = el.getBoundingClientRect();
      return c.left <= 1 && c.width > 180 && c.width < 340 && c.height > 600;
    });
    const alvo = menu ? menu.querySelector("[class*='bg-sidebar'], nav, div") || menu : null;
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.fillStyle = getComputedStyle(document.body).backgroundColor; cx.fillRect(0, 0, 1, 1);
    cx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--sidebar").trim();
    cx.fillRect(0, 0, 1, 1);
    const [r, g, bl] = cx.getImageData(0, 0, 1, 1).data;
    return "#" + [r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("");
  });
  console.log(`${variante.padEnd(16)} menu renderiza ${cor}`);
  await ctx.close();
}
await b.close();
