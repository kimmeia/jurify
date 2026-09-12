import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const [OUT, SESSAO] = process.argv.slice(2);
const ROTAS = [
  ["dashboard","/dashboard"],["agenda","/agenda"],["atendimento","/atendimento"],
  ["clientes","/clientes"],["processos","/processos"],["acordos","/acordos"],
  ["kanban","/kanban"],["jurisia","/jurisia"],["ponto","/ponto"],
  ["calculos","/calculos"],["modelos","/modelos-contrato"],["automacoes","/automacoes"],
  ["financeiro","/financeiro"],["relatorios","/relatorios"],["tarefas","/tarefas"],
  ["configuracoes","/configuracoes"],["roadmap","/roadmap"],["agentes-ia","/agentes-ia"],
];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const linhas = [];
for (const [larg, alt, pasta] of [[1600,1000,"desktop"],[390,844,"celular"]]) {
  const ctx = await b.newContext({ viewport:{width:larg,height:alt}, deviceScaleFactor:2, storageState:SESSAO, isMobile: larg<500, hasTouch: larg<500 });
  const p = await ctx.newPage();
  for (const [nome, rota] of ROTAS) {
    try {
      await p.goto(`http://localhost:3000${rota}`, { waitUntil:"domcontentloaded", timeout:25000 });
      await p.waitForTimeout(3200);
      await p.screenshot({ path: `${OUT}/${pasta}/${nome}.png` });
      if (pasta === "desktop") {
        const d = await p.evaluate(() => {
          const m = document.querySelector("main") || document.body;
          const h = m.querySelector("h1,h2");
          const rolaLado = m.scrollWidth > m.clientWidth + 4;
          return {
            h: h?.textContent?.trim().slice(0,36) ?? "—",
            cls: (h?.className ?? "").replace(/\s+/g," ").slice(0,58),
            tabs: [...m.querySelectorAll('[role="tab"],[data-slot="tabs-trigger"]')].length,
            tabela: !!m.querySelector("table"),
            rolaLado,
          };
        });
        linhas.push([nome, d]);
      } else {
        const d = await p.evaluate(() => {
          const el = document.scrollingElement;
          const tab = document.querySelector("main table");
          return { rolaLado: el.scrollWidth > el.clientWidth + 4,
                   larguraConteudo: el.scrollWidth,
                   tabelaLarga: tab ? tab.getBoundingClientRect().width : 0 };
        });
        const i = linhas.find(([n]) => n === nome);
        if (i) i[1].cel = d;
      }
    } catch (e) { console.log(`${nome} (${pasta}) FALHOU: ${String(e).slice(0,70)}`); }
  }
  await ctx.close();
}
console.log("TELA".padEnd(15), "TÍTULO".padEnd(30), "CLASSE".padEnd(46), "abas tab  celular");
for (const [n,d] of linhas) {
  const cel = d.cel ? (d.cel.rolaLado ? `ROLA DE LADO (${d.cel.larguraConteudo}px)` : "ok") : "?";
  console.log(n.padEnd(15), `"${d.h}"`.padEnd(30), (d.cls||"—").padEnd(46), String(d.tabs).padEnd(4), (d.tabela?"sim":"não").padEnd(4), cel);
}
await b.close();
