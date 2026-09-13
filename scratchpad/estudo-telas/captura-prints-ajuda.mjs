// Recaptura os prints da tarefa «Cadastrar um cliente» da Central de ajuda
// (client/public/ajuda/cadastrar-cliente-1/2.png) do app rodando.
//
//   node captura-prints-ajuda.mjs <pasta-de-saida> [http://localhost:3000]
//
// Antes: app no ar (docs/rodar-o-app-localmente.md), seed-staging + povoar.sql
// e UMA linha em asaas_config com statusAsaas='conectado' — sem ela a coluna
// Financeiro da lista fica em "sem cobrança" (a query só roda com o Asaas
// conectado). O aviso de ambiente (STAGING/DESENVOLVIMENTO) sai do DOM antes
// da foto: produção não o tem. O mouse é estacionado fora das linhas, senão a
// linha sob o clique do login sai com os ícones de hover.
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const [OUT, BASE = "http://localhost:3000"] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1500);
await p.fill('input[type="email"]', "dono-smoke@juridflow.com.br");
await p.fill('input[type="password"]', "Smoke123!");
await p.click('button[type="submit"]');
await p.waitForTimeout(4500);
const cbx = p.locator('[role="checkbox"], input[type="checkbox"]').first();
if (await cbx.count()) { await cbx.click(); await p.waitForTimeout(400); }
const btn = p.locator('button:has-text("Aceitar e continuar")');
if (await btn.count()) { await btn.click(); await p.waitForTimeout(3000); }

const tiraAvisoAmbiente = () => p.evaluate(() => {
  for (const d of document.querySelectorAll("div.bg-warning.text-center.py-1")) {
    if (d.textContent?.includes("STAGING") || d.textContent?.includes("DESENVOLVIMENTO")) d.remove();
  }
});
async function foto(rota, espera, arquivo) {
  await p.goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded" });
  for (const s of espera) await p.waitForSelector(s, { timeout: 20000 });
  await p.waitForTimeout(2500);
  await tiraAvisoAmbiente();
  await p.mouse.move(1436, 4);
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${arquivo}` });
  console.log(arquivo, "| 99796 na tela:", await p.locator("text=99796").count());
}
await foto("/clientes", ["text=Novo cliente", "text=Maria Aparecida", "text=pendente"], "cadastrar-cliente-1.png");
await foto("/clientes?novo=1", ['[role="dialog"]:has-text("Novo Cliente")', "text=pendente"], "cadastrar-cliente-2.png");
await b.close();
