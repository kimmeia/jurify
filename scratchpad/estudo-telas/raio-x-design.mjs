/**
 * Raio-X do design que está NO AR: mede, no navegador, o que o sistema
 * realmente usa — cores, tamanhos de texto, raios, sombras, espaçamentos,
 * densidade, contraste. Nada de leitura de código: o que sai daqui é o que
 * o advogado vê.
 *
 *   node raio-x-design.mjs <sessao.json> <saida.json>
 *
 * Por que existe: "mudar cores/padrões" só se discute com o inventário do
 * que existe hoje. Opinião sobre estética sem medida vira briga de gosto.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";

const [SESSAO, SAIDA] = process.argv.slice(2);

const ROTAS = [
  ["dashboard", "/dashboard"], ["atendimento", "/atendimento"], ["clientes", "/clientes"],
  ["agenda", "/agenda"], ["processos", "/processos"], ["kanban", "/kanban"],
  ["acordos", "/acordos"], ["financeiro", "/financeiro"], ["relatorios", "/relatorios"],
  ["tarefas", "/tarefas"], ["configuracoes", "/configuracoes"],
];

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: SESSAO });
const p = await ctx.newPage();

const relatorio = { tokens: null, telas: {}, agregado: null };

await p.goto("http://localhost:3000/dashboard", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);

// ── 1. Os tokens declarados, já resolvidos em hex ────────────────────────
relatorio.tokens = await p.evaluate(() => {
  const raiz = getComputedStyle(document.documentElement);
  const nomes = [];
  for (const folha of document.styleSheets) {
    try {
      for (const r of folha.cssRules) {
        if (r.selectorText === ":root" || r.selectorText === "html") {
          for (const prop of r.style) if (prop.startsWith("--")) nomes.push(prop);
        }
      }
    } catch { /* folha de outro host */ }
  }
  const unico = [...new Set(nomes)].sort();
  const conv = document.createElement("div");
  document.body.appendChild(conv);
  const paraHex = (valor) => {
    conv.style.color = "";
    conv.style.color = valor;
    const c = getComputedStyle(conv).color;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, bl] = m[1].split(",").map((n) => Math.round(parseFloat(n)));
    return "#" + [r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("");
  };
  const out = {};
  for (const n of unico) {
    const bruto = raiz.getPropertyValue(n).trim();
    out[n] = { bruto, hex: /oklch|rgb|hsl|#/.test(bruto) ? paraHex(bruto) : null };
  }
  conv.remove();
  return out;
});

// ── 2. Por tela: o que é realmente pintado ───────────────────────────────
const medirTela = () => {
  const dentro = document.querySelector("main") || document.body;
  const els = [...dentro.querySelectorAll("*")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const conta = (f) => {
    const m = new Map();
    for (const el of els) { const v = f(el); if (v) m.set(v, (m.get(v) || 0) + 1); }
    return [...m.entries()].sort((a, b2) => b2[1] - a[1]);
  };
  const cs = (el) => getComputedStyle(el);
  const temTexto = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  const tamanhos = conta((el) => (temTexto(el) ? cs(el).fontSize : null));
  const pesos = conta((el) => (temTexto(el) ? cs(el).fontWeight : null));
  const coresTexto = conta((el) => (temTexto(el) ? cs(el).color : null));
  const fundos = conta((el) => {
    const c = cs(el).backgroundColor;
    return c && c !== "rgba(0, 0, 0, 0)" ? c : null;
  });
  const raios = conta((el) => {
    const r = cs(el).borderRadius;
    return r && r !== "0px" ? r : null;
  });
  const sombras = conta((el) => {
    const s = cs(el).boxShadow;
    return s && s !== "none" ? s.slice(0, 60) : null;
  });
  const bordas = conta((el) => {
    const w = cs(el).borderTopWidth;
    return w && w !== "0px" ? `${w} ${cs(el).borderTopColor}` : null;
  });
  const espacos = conta((el) => {
    const g = cs(el).gap;
    return g && g !== "normal" && g !== "0px" ? g : null;
  });
  const paddings = conta((el) => {
    const q = cs(el).padding;
    return q && q !== "0px" ? q : null;
  });

  // densidade: quanto da tela é "tinta" vs respiro
  const corpo = document.scrollingElement;
  const area = corpo.scrollWidth * corpo.scrollHeight;
  let areaCards = 0;
  for (const el of els) {
    const c = cs(el);
    if ((c.borderTopWidth !== "0px" || c.boxShadow !== "none") && c.backgroundColor !== "rgba(0, 0, 0, 0)") {
      const r = el.getBoundingClientRect();
      areaCards += r.width * r.height;
    }
  }

  // hierarquia: o maior texto da tela e quantos "níveis" existem
  const usados = tamanhos.map(([t]) => parseFloat(t)).sort((a, b3) => b3 - a);

  return {
    nos: els.length,
    tamanhosDeTexto: tamanhos.slice(0, 14),
    nTamanhos: tamanhos.length,
    maiorTexto: usados[0] ?? null,
    pesos: pesos.slice(0, 8),
    coresDeTexto: coresTexto.slice(0, 10),
    nCoresTexto: coresTexto.length,
    fundos: fundos.slice(0, 12),
    nFundos: fundos.length,
    raios: raios.slice(0, 10),
    nRaios: raios.length,
    sombras: sombras.slice(0, 6),
    nSombras: sombras.length,
    bordas: bordas.slice(0, 8),
    gaps: espacos.slice(0, 10),
    paddings: paddings.slice(0, 10),
    alturaPagina: corpo.scrollHeight,
    densidade: area ? +(areaCards / area).toFixed(2) : null,
  };
};

for (const [nome, rota] of ROTAS) {
  try {
    await p.goto(`http://localhost:3000${rota}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await p.waitForTimeout(3800);
    relatorio.telas[nome] = await p.evaluate(medirTela);
    console.log(
      nome.padEnd(15),
      `${relatorio.telas[nome].nTamanhos} tam`.padEnd(8),
      `${relatorio.telas[nome].nCoresTexto} cores`.padEnd(10),
      `${relatorio.telas[nome].nFundos} fundos`.padEnd(11),
      `${relatorio.telas[nome].nRaios} raios`.padEnd(10),
      `${relatorio.telas[nome].nSombras} sombras`.padEnd(12),
      `maior ${relatorio.telas[nome].maiorTexto}px`,
    );
  } catch (e) {
    console.log(`${nome} FALHOU: ${String(e).slice(0, 70)}`);
  }
}

// ── 3. Agregado: o sistema visto de cima ─────────────────────────────────
const juntar = (campo) => {
  const m = new Map();
  for (const t of Object.values(relatorio.telas)) {
    for (const [v, n] of t[campo] || []) m.set(v, (m.get(v) || 0) + n);
  }
  return [...m.entries()].sort((a, b2) => b2[1] - a[1]);
};
relatorio.agregado = {
  tamanhosDeTexto: juntar("tamanhosDeTexto"),
  coresDeTexto: juntar("coresDeTexto"),
  fundos: juntar("fundos"),
  raios: juntar("raios"),
  sombras: juntar("sombras"),
  gaps: juntar("gaps"),
  paddings: juntar("paddings"),
};

writeFileSync(SAIDA, JSON.stringify(relatorio, null, 2));
console.log(`\n${SAIDA} — ${Object.keys(relatorio.telas).length} telas`);
console.log("tamanhos de texto no sistema:", relatorio.agregado.tamanhosDeTexto.map(([t, n]) => `${t}×${n}`).join(" "));
console.log("raios:", relatorio.agregado.raios.map(([t, n]) => `${t}×${n}`).join(" "));
await b.close();
