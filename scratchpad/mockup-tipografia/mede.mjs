import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const FONTES = readFileSync(process.argv[2], "utf8");

const casos = [
  ["2º grau?", "2º GRAU?"], ["Pausado", "PAUSADO"], ["Baseline", "BASELINE"],
  ["prazo vence hoje", "PRAZO VENCE HOJE"], ["TJCE", "TJCE"], ["1ª inst.", "1ª INST."],
];
const html = `<!doctype html><meta charset="utf-8">${FONTES}
<style>body{font-family:'Inter',sans-serif;margin:0}
.a{display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.d{display:inline-block;font-size:11px;font-weight:600}</style>
${casos.map(([d, a], i) => `<div><span class="a" id="a${i}">${a}</span></div><div><span class="d" id="d${i}">${d}</span></div>`).join("")}`;
writeFileSync("/tmp/mede.html", html);

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage();
await p.goto("file:///tmp/mede.html");
await p.evaluate(() => document.fonts.ready);
const r = await p.evaluate((n) => {
  const o = [];
  for (let i = 0; i < n; i++) o.push([
    document.getElementById("a" + i).getBoundingClientRect().width,
    document.getElementById("d" + i).getBoundingClientRect().width,
    document.getElementById("d" + i).textContent,
  ]);
  return o;
}, casos.length);
for (const [a, d, t] of r) {
  const dif = d - a;
  console.log(`${t.padEnd(18)} 9px caps: ${a.toFixed(1).padStart(6)}px   11px normal: ${d.toFixed(1).padStart(6)}px   dif: ${dif >= 0 ? "+" : ""}${dif.toFixed(1)}px`);
}
await b.close();
