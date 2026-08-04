#!/usr/bin/env node
/**
 * Renderiza mockups HTML em PNG com Chromium headless.
 *
 *   node scripts/render.mjs mock.html                 # tamanho lido do CSS
 *   node scripts/render.mjs mock.html 1600x1050       # tamanho explícito
 *   node scripts/render.mjs a.html b.html 1600x1050   # vários arquivos
 *   node scripts/render.mjs pasta/                    # todo .html da pasta
 *
 * Sai com código 1 se algum arquivo estourar o palco (overflow), porque
 * conteúdo cortado é o erro mais comum e passa fácil despercebido.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);

function acharPlaywright() {
  const tentativas = ["playwright", "playwright-core"];
  for (const m of tentativas) {
    try { return require(m); } catch {}
  }
  // pnpm não faz hoist: procura no store do repo
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const store = path.join(dir, "node_modules", ".pnpm");
    if (fs.existsSync(store)) {
      const pkg = fs.readdirSync(store).find((d) => /^playwright(-core)?@/.test(d));
      if (pkg) {
        const sub = pkg.startsWith("playwright-core@") ? "playwright-core" : "playwright";
        return require(path.join(store, pkg, "node_modules", sub, "index.js"));
      }
    }
    dir = path.dirname(dir);
  }
  throw new Error("playwright não encontrado — rode a partir do repo ou instale-o");
}

function acharChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const raiz = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!fs.existsSync(raiz)) return undefined; // deixa o playwright resolver sozinho
  const dirs = fs.readdirSync(raiz).filter((d) => d.startsWith("chromium-")).sort();
  for (const d of dirs.reverse()) {
    const bin = path.join(raiz, d, "chrome-linux", "chrome");
    if (fs.existsSync(bin)) return bin;
  }
  return undefined; // headless_shell não serve: ignora e cai no default
}

/** O template trava `html,body { width:Npx; height:Npx }` — daí sai o viewport. */
function tamanhoDoCss(arquivo) {
  const css = fs.readFileSync(arquivo, "utf8");
  const w = css.match(/html\s*,\s*body\s*\{[^}]*width\s*:\s*(\d+)px/i);
  const h = css.match(/html\s*,\s*body\s*\{[^}]*height\s*:\s*(\d+)px/i);
  return w && h ? { width: +w[1], height: +h[1] } : { width: 1600, height: 1050 };
}

const argv = process.argv.slice(2);
if (!argv.length) {
  console.error("uso: node render.mjs <arquivo.html|pasta> [...] [LARGURAxALTURA]");
  process.exit(2);
}

let forcado = null;
const alvos = [];
for (const a of argv) {
  const m = a.match(/^(\d+)x(\d+)$/);
  if (m) { forcado = { width: +m[1], height: +m[2] }; continue; }
  const abs = path.resolve(a);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    for (const f of fs.readdirSync(abs).filter((f) => f.endsWith(".html"))) alvos.push(path.join(abs, f));
  } else {
    alvos.push(abs);
  }
}

const { chromium } = acharPlaywright();
const executablePath = acharChromium();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let estourou = false;

for (const arquivo of alvos) {
  const { width, height } = forcado || tamanhoDoCss(arquivo);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const erros = [];
  page.on("requestfailed", (r) => erros.push(r.url()));
  await page.goto(`file://${arquivo}`);
  // sem isso o screenshot sai com fonte de fallback e todo o espaçamento muda
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);

  // `overflow:hidden` no palco zera o scrollWidth/Height — solta por um
  // instante só para medir o tamanho real do conteúdo, depois devolve.
  const over = await page.evaluate(() => {
    const d = document.documentElement;
    const antes = [d.style.overflow, document.body.style.overflow];
    d.style.overflow = "visible";
    document.body.style.overflow = "visible";
    const medida = { w: d.scrollWidth, h: d.scrollHeight };
    d.style.overflow = antes[0];
    document.body.style.overflow = antes[1];
    return medida;
  });

  const out = arquivo.replace(/\.html$/, ".png");
  await page.screenshot({ path: out });
  await page.close();

  console.log(`ok: ${out}  (${width}x${height} @2x)`);
  if (erros.length) console.warn(`   ⚠ recursos não carregados: ${erros.join(", ")}`);
  if (over.w > width || over.h > height) {
    estourou = true;
    console.warn(`   ⚠ overflow: conteúdo ocupa ${over.w}x${over.h} — algo está cortado no PNG`);
  }
}

await browser.close();
process.exit(estourou ? 1 : 0);
