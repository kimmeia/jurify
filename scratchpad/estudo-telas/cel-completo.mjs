import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const [OUT, SESSAO] = process.argv.slice(2);
const ROTAS = [["financeiro","/financeiro"],["clientes","/clientes"],["processos","/processos"],
  ["agenda","/agenda"],["relatorios","/relatorios"],["kanban","/kanban"],["dashboard","/dashboard"],["acordos","/acordos"]];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, storageState:SESSAO, isMobile:true, hasTouch:true });
// sai do "modo foco" — é o que o usuário faz em "Abrir versão completa"
await ctx.addInitScript(() => { try { localStorage.setItem("jurify:mobileCompleto","1"); } catch {} });
const p = await ctx.newPage();
console.log("TELA".padEnd(12), "URL".padEnd(14), "TABELA", "  VEREDITO");
for (const [nome, rota] of ROTAS) {
  await p.goto(`http://localhost:3000${rota}`, { waitUntil:"networkidle", timeout:30000 }).catch(()=>{});
  await p.waitForTimeout(4000);
  const i = await p.evaluate(() => {
    const el = document.scrollingElement;
    const t = document.querySelector("main table") || document.querySelector("table");
    // procura QUALQUER elemento que estoure a largura da tela
    let pior = null;
    for (const n of document.querySelectorAll("main *")) {
      const r = n.getBoundingClientRect();
      if (r.width > window.innerWidth + 8 && r.width > (pior?.w ?? 0))
        pior = { w: Math.round(r.width), tag: n.tagName.toLowerCase(), cls: (n.className?.baseVal ?? n.className ?? "").toString().slice(0,40) };
    }
    return { url: location.pathname, rola: el.scrollWidth > el.clientWidth + 4, cont: el.scrollWidth,
             vp: el.clientWidth, tab: t ? Math.round(t.getBoundingClientRect().width) : 0, pior };
  });
  await p.screenshot({ path: `${OUT}/completo-${nome}.png` });
  const v = i.rola ? `ROLA DE LADO — conteúdo ${i.cont}px em ${i.vp}px` + (i.pior ? ` (pior: <${i.pior.tag}> ${i.pior.w}px)` : "") : "cabe";
  console.log(nome.padEnd(12), i.url.padEnd(14), (i.tab? i.tab+"px":"—").padEnd(7), v);
}
await b.close();
