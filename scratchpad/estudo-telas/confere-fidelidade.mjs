/**
 * Confere que o mockup navegável reproduz o que foi MEDIDO no app — e não
 * só "abre". Cada verificação aqui é um número que já foi medido no
 * navegador de verdade; se o iframe der outro, a captura mentiu.
 *
 *   node confere-fidelidade.mjs <mockup.html>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";

const [ARQ] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1700, height: 1000 } });
const p = await ctx.newPage();
await p.goto(`file://${ARQ}`, { waitUntil: "load" });
await p.waitForTimeout(1200);

async function ir(tela, estado, vp) {
  await p.click(`[data-vp="${vp}"]`);
  await p.click(`[data-tela="${tela}"]`);
  await p.click(`[data-estado="${estado}"]`);
  await p.waitForTimeout(600);
}
const dentro = (fn, arg) => p.evaluate(
  ([codigo, a]) => {
    const doc = document.getElementById("quadro").contentDocument;
    return new Function("doc", "a", `return (${codigo})(doc, a)`)(doc, a);
  },
  [fn.toString(), arg],
);

const larguraColunaNome = (doc) => {
  const el = [...doc.querySelectorAll("span")].find((s) => /^w-\[220px\]/.test(s.className || ""));
  return el ? Math.round(el.getBoundingClientRect().width) : null;
};
const pilulaAgora = (doc) => {
  const el = [...doc.querySelectorAll("span")].find((s) => (s.textContent || "").startsWith("AGORA"));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { larg: Math.round(r.width), linhas: el.children.length };
};
const dinheiroCurto = (doc) => {
  const t = doc.body.innerText || "";
  return { comK: /R\$\s?[\d.]+k\b/.test(t), comMil: /R\$\s?[\d.,]+\s?mil/.test(t) };
};
const kpiEmUmaLinha = (doc) => {
  const el = [...doc.querySelectorAll("p,div,span")]
    .find((n) => /^R\$/.test((n.textContent || "").trim()) && n.children.length === 0);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const linha = parseFloat(getComputedStyle(el).fontSize) * 1.4;
  return { texto: el.textContent.trim(), altura: Math.round(r.height), umaLinha: r.height < linha * 1.6 };
};

const linhas = [];
const conferir = (o, esperado, obtido) =>
  linhas.push([
    o,
    typeof esperado === "object" ? JSON.stringify(esperado) : String(esperado),
    typeof obtido === "object" ? JSON.stringify(obtido) : String(obtido),
    JSON.stringify(esperado) === JSON.stringify(obtido) ? "ok" : "DIVERGIU",
  ]);

await ir("movimentacoes", "antes", "desktop");
conferir("Movimentações · coluna do nome (antes)", 220, await dentro(larguraColunaNome));
await ir("movimentacoes", "depois", "desktop");
conferir("Movimentações · coluna do nome (depois)", 380, await dentro(larguraColunaNome));

await ir("agenda", "antes", "desktop");
const a1 = await dentro(pilulaAgora);
linhas.push(["Agenda · pílula AGORA (antes)", "> 48px, 1 linha", `${a1?.larg}px, filhos=${a1?.linhas}`, a1 && a1.larg > 48 ? "ok" : "DIVERGIU"]);
await ir("agenda", "depois", "desktop");
const a2 = await dentro(pilulaAgora);
linhas.push(["Agenda · pílula AGORA (depois)", "48px, 2 linhas", `${a2?.larg}px, filhos=${a2?.linhas}`, a2 && a2.larg === 48 && a2.linhas === 2 ? "ok" : "DIVERGIU"]);

await ir("financeiro", "antes", "desktop");
conferir("Financeiro · dinheiro (antes)", { comK: true, comMil: false }, await dentro(dinheiroCurto));
await ir("financeiro", "depois", "desktop");
conferir("Financeiro · dinheiro (depois)", { comK: false, comMil: true }, await dentro(dinheiroCurto));

// Altura do valor do KPI: comparar os dois estados é mais honesto do que
// adivinhar "quantas linhas" a partir do font-size.
await ir("financeiro", "antes", "celular");
const k1 = await dentro(kpiEmUmaLinha);
await ir("financeiro", "depois", "celular");
const k2 = await dentro(kpiEmUmaLinha);
linhas.push([
  "Financeiro · altura do valor no celular",
  "antes bem mais alto (quebrou)",
  `antes ${k1?.texto} ${k1?.altura}px → depois ${k2?.texto} ${k2?.altura}px`,
  k1 && k2 && k1.altura >= k2.altura * 1.5 ? "ok" : "DIVERGIU",
]);

console.log("conferência".padEnd(42), "esperado".padEnd(24), "obtido".padEnd(30), "");
for (const l of linhas) console.log(l[0].padEnd(42), l[1].padEnd(24), l[2].padEnd(30), l[3]);
const ruins = linhas.filter((l) => l[3] !== "ok").length;
console.log(`\n${linhas.length - ruins}/${linhas.length} conferem`);
await b.close();
process.exit(ruins ? 1 : 0);
