/**
 * Dirige o comparador das decisões como o dono vai dirigir e diz, por
 * comparação, se ela COMUNICA: as duas caixas têm conteúdo, o anel achou o
 * ponto nos lados em que ele deveria existir, e o retângulo do ponto MUDA
 * entre antes e depois (ou o texto dentro dele muda). Anel idêntico nos dois
 * lados com o mesmo texto é a falha da primeira entrega de 12/09 — o dono
 * olhou dois quadros iguais e não viu diferença nenhuma.
 *
 *   node confere-comparador-decisoes.mjs <comparador.html> <pasta-de-fotos>
 *
 * Fotos: <pasta>/capa-<decisao>.png (uma por decisão, mais capa-resumo.png),
 * <pasta>/<id-da-comparação>.png e z-piscar / z-inteira / z-navegar.
 * Saída: uma linha por comparação, OK ou PROBLEMA com o motivo.
 * Sai com código 1 quando há PROBLEMA ou erro de página.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [ARQ, FOTOS] = process.argv.slice(2);
if (!ARQ || !FOTOS) { console.error("uso: node confere-comparador-decisoes.mjs <comparador.html> <pasta-de-fotos>"); process.exit(2); }
mkdirSync(FOTOS, { recursive: true });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const erros = [];
p.on("pageerror", (e) => erros.push(String(e).slice(0, 180)));
p.on("console", (m) => { if (m.type() === "error") erros.push("console: " + m.text().slice(0, 180)); });

await p.goto(`file://${ARQ}`, { waitUntil: "load", timeout: 120000 });
await p.waitForTimeout(1500);

/* ---------- as decisões: capa, tabela, resumo ---------- */
const decisoes = await p.$$eval("header [data-decisao]", (bs) => bs.map((b) => b.dataset.decisao));
console.log(`decisões no menu do topo: ${decisoes.join(" · ")}`);
for (const id of decisoes) {
  await p.click(`header [data-decisao="${id}"]`);
  await p.waitForTimeout(700);
  const d = await p.evaluate(() => ({
    titulo: (document.getElementById("titulo").textContent || "").slice(0, 60),
    linhasTabela: document.querySelectorAll("#capa table.codigo tbody tr").length,
    opcoes: document.querySelectorAll("#capa .opcao").length,
    recomendadas: document.querySelectorAll("#capa .opcao.rec").length,
    fora: document.querySelectorAll("#capa .fora li").length,
    comparacoes: document.querySelectorAll("#capa .lista-comp [data-i]").length,
    caixas: document.querySelectorAll("#resumo .caixa").length,
    vazia: !document.getElementById("resumo").hidden ? false : (document.getElementById("capa").innerHTML.trim().length < 40),
  }));
  const linha = id === "resumo"
    ? `resumo: ${d.caixas} caixinhas`
    : `${d.opcoes} opções (${d.recomendadas} recomendada) · ${d.fora} fora · ${d.linhasTabela ? d.linhasTabela + " linhas de código" : d.comparacoes + " comparações"}`;
  const ruim = id !== "resumo" && (d.vazia || d.opcoes < 1 || d.recomendadas !== 1 || (d.linhasTabela === 0 && d.comparacoes === 0));
  console.log(`${ruim ? "PROBLEMA" : "OK      "} capa ${id.padEnd(10)} ${d.titulo.padEnd(44)} ${linha}`);
  if (ruim) erros.push(`capa ${id}: ${d.vazia ? "vazia" : d.recomendadas !== 1 ? "recomendadas=" + d.recomendadas : "sem tabela nem comparação"}`);
  await p.screenshot({ path: `${FOTOS}/capa-${id}.png`, fullPage: id !== "resumo" });
}

// as caixinhas marcam e desmarcam (só classe, nada persiste)
await p.click('header [data-decisao="resumo"]'); await p.waitForTimeout(400);
const marcou = await p.evaluate(() => {
  const b = document.querySelector("#resumo .escolha"); if (!b) return "sem caixinha";
  b.click(); const ok1 = b.classList.contains("marcada") && b.closest(".caixa").classList.contains("marcada");
  b.click(); const ok2 = !b.classList.contains("marcada");
  return ok1 && ok2 ? "marca e desmarca" : "NÃO alterna";
});
console.log(`caixinhas: ${marcou}`);
if (marcou !== "marca e desmarca") erros.push("caixinha do resumo não alterna");

/* ---------- as comparações ---------- */
const quantos = await p.$$eval("nav [data-i]", (bs) => bs.length);
console.log("\n" + "#".padEnd(3), "comparação".padEnd(30), "vista".padEnd(8), "anéis", "borda", "zoom", "nós a/d".padEnd(12), "antes dir/larg".padEnd(15), "depois dir/larg".padEnd(15), "veredito");
let problemas = 0;
for (let i = 0; i < quantos; i++) {
  await p.click(`nav [data-i="${i}"]`);
  await p.waitForTimeout(1500);
  const d = await p.evaluate(() => {
    const m = window.__comparador.medirLados();
    const anel = [...document.querySelectorAll("#par .anel")].filter((a) => !a.hidden).length;
    const borda = [...document.querySelectorAll("#par .borda-tela")].filter((a) => !a.hidden).length;
    const z = (document.getElementById("rodape").textContent || "").match(/Zoom de ([\d.]+)/);
    return { ...m, anel, borda, zoom: z ? z[1] : "—", titulo: (document.getElementById("titulo").textContent || "").slice(0, 30) };
  });
  const motivos = [];
  if (!d) { motivos.push("sem iframes"); }
  else {
    if (d.conteudo[0].nos < 60 || d.conteudo[0].texto < 80) motivos.push("caixa do ANTES vazia");
    if (d.conteudo[1].nos < 60 || d.conteudo[1].texto < 80) motivos.push("caixa do DEPOIS vazia");
    if (d.esperaAntes && !d.a) motivos.push("alvo não achado no antes");
    if (d.esperaDepois && !d.d) motivos.push("alvo não achado no depois");
    if (d.a && d.d) {
      const mesmoRet = d.a.left === d.d.left && d.a.top === d.d.top && d.a.width === d.d.width && d.a.height === d.d.height;
      // Decisão de COR não mexe em geometria nem em texto: o que muda é a
      // tinta. Sem olhar cor, a conferência reprovava a comparação certa.
      const mudaCor = d.a.fundo !== d.d.fundo || d.a.tinta !== d.d.tinta;
      if (mesmoRet && d.a.texto === d.d.texto && !mudaCor) motivos.push("MESMO retângulo, mesmo texto e MESMA cor nos dois lados — o anel não conta história");
    }
    if (d.zoom === "—" && (d.esperaAntes || d.esperaDepois) && (d.a || d.d)) motivos.push("caiu na tela inteira");
  }
  const historia = !d ? "—"
    : d.a && d.d
      ? (d.vista === "celular" && d.a.dir > 390 && d.d.dir <= 390 ? "cruza→cabe"
        : (d.a.width !== d.d.width || d.a.height !== d.d.height) ? "muda de tamanho"
        : (d.a.left !== d.d.left || d.a.top !== d.d.top) ? "muda de lugar"
        : d.a.texto !== d.d.texto ? "texto muda"
        : (d.a.fundo !== d.d.fundo || d.a.tinta !== d.d.tinta) ? "muda de cor" : "MESMO retângulo")
      : d.a && !d.d ? (d.esperaDepois ? "sumiu?" : "some no depois")
      : !d.a && d.d ? (d.esperaAntes ? "faltou no antes?" : "aparece no depois")
      : "alvo não achado";
  const ok = motivos.length === 0;
  if (!ok) { problemas++; erros.push(`comparação ${i + 1} (${d ? d.id : "?"}): ${motivos.join("; ")}`); }
  console.log(
    String(i + 1).padEnd(3), (d ? d.id : "?").slice(0, 30).padEnd(30), (d ? d.vista : "?").padEnd(8),
    String(d ? d.anel : 0).padEnd(5), String(d ? d.borda : 0).padEnd(5), String(d ? d.zoom : "—").padEnd(4),
    (d ? `${d.conteudo[0].nos}/${d.conteudo[1].nos}` : "—").padEnd(12),
    (d && d.a ? `${d.a.dir}/${d.a.width}` : "—").padEnd(15), (d && d.d ? `${d.d.dir}/${d.d.width}` : "—").padEnd(15),
    (ok ? "OK · " : "PROBLEMA · ") + historia + (ok ? "" : " — " + motivos.join("; ")),
  );
  if (d && d.a) console.log("     antes ", d.a.tag, d.a.cls, "·", JSON.stringify(d.a.texto.slice(0, 50)));
  if (d && d.d) console.log("     depois", d.d.tag, d.d.cls, "·", JSON.stringify(d.d.texto.slice(0, 50)));
  await p.screenshot({ path: `${FOTOS}/${(d ? d.id : "comp-" + (i + 1)).replace(/[^a-zA-Z0-9_-]+/g, "-")}.png` });
}

/* ---------- piscar, tela inteira e o passeio ---------- */
if (quantos) {
  await p.click('nav [data-i="0"]'); await p.waitForTimeout(900);
  await p.click('[data-modo="piscar"]'); await p.waitForTimeout(1500);
  const piscando = await p.$$eval("#par iframe", (fs) => fs.length);
  if (piscando !== 2) erros.push("piscar sem os dois iframes");
  await p.screenshot({ path: `${FOTOS}/z-piscar.png` });
  await p.click('[data-modo="inteira"]'); await p.waitForTimeout(1600);
  await p.screenshot({ path: `${FOTOS}/z-inteira.png` });
  await p.click('[data-modo="lado"]'); await p.waitForTimeout(600);
}
const primeiraTela = await p.$eval("[data-tela]", (b) => b.dataset.tela).catch(() => null);
if (primeiraTela) {
  await p.click(`[data-tela="${primeiraTela}"]`); await p.waitForTimeout(2200);
  const nos = await p.$$eval("#par iframe", (fs) => fs.map((f) => (f.contentDocument && f.contentDocument.body ? f.contentDocument.body.querySelectorAll("*").length : 0)));
  console.log(`\npasseio (${primeiraTela}): computador ${nos[0]} nós · celular ${nos[1]} nós`);
  if (nos.some((n) => n < 60)) erros.push(`passeio ${primeiraTela} com caixa vazia`);
  await p.screenshot({ path: `${FOTOS}/z-navegar.png` });
}

console.log("\n" + (erros.length ? `PROBLEMAS (${erros.length}):\n` + erros.join("\n") : `nenhum problema · ${quantos} comparações OK · fotos em ${FOTOS}`));
await b.close();
if (erros.length) process.exitCode = 1;
