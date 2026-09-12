import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport:{width:1600,height:1000}, storageState:process.argv[2] });
const p = await ctx.newPage();

// 1. truncamento do nome em Processos
await p.goto("http://localhost:3000/processos",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(3500);
console.log("PROCESSOS —", await p.evaluate(() => {
  const el = [...document.querySelectorAll("main *")].find(n => n.textContent?.startsWith("Maria Aparecida") && n.children.length===0);
  if (!el) return "não achei o nome";
  const r = el.getBoundingClientRect();
  const truncado = el.scrollWidth > el.clientWidth + 1;
  const main = document.querySelector("main").getBoundingClientRect();
  return `nome ocupa ${Math.round(r.width)}px, truncado=${truncado} (texto real ${el.scrollWidth}px), sobra ${Math.round(main.right - r.right)}px vazios à direita`;
}));
// 2. faixas de aviso empilhadas
for (const [nome, rota] of [["financeiro","/financeiro"],["processos","/processos"]]) {
  await p.goto(`http://localhost:3000${rota}`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(3000);
  const n = await p.evaluate(() => {
    const m = document.querySelector("main");
    const avisos = [...m.querySelectorAll("div")].filter(d => {
      const bg = getComputedStyle(d).backgroundColor;
      const t = (d.textContent||"").trim();
      return d.children.length < 8 && t.length > 25 && t.length < 220 &&
        /desconectado|sem categoria|Saldo baixo|atenção|Atenção/.test(t) &&
        !/rgba\(0, 0, 0, 0\)/.test(bg);
    });
    return [...new Set(avisos.map(a=>a.textContent.trim().replace(/\s+/g," ").slice(0,58)))];
  });
  console.log(`AVISOS em ${nome}: ${n.length}`); n.forEach(x=>console.log("   ·", x));
}
// 3. todos os títulos e seus tamanhos renderizados
console.log("\nTÍTULOS (tamanho renderizado):");
for (const [nome, rota] of [["dashboard","/dashboard"],["agenda","/agenda"],["atendimento","/atendimento"],
  ["processos","/processos"],["acordos","/acordos"],["relatorios","/relatorios"],["tarefas","/tarefas"],
  ["automacoes","/automacoes"],["roadmap","/roadmap"],["agentes-ia","/agentes-ia"],["ponto","/ponto"]]) {
  await p.goto(`http://localhost:3000${rota}`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(2500);
  const d = await p.evaluate(() => {
    const h = document.querySelector("main h1, main h2");
    if (!h) return null;
    const cs = getComputedStyle(h);
    return { t: h.textContent.trim().slice(0,28), px: cs.fontSize, fam: cs.fontFamily.split(",")[0].replace(/"/g,""), peso: cs.fontWeight };
  });
  console.log(`  ${nome.padEnd(12)} ${d ? `${d.px.padEnd(7)} ${d.fam.padEnd(8)} ${d.peso}  "${d.t}"` : "— sem h1/h2 —"}`);
}
await b.close();
