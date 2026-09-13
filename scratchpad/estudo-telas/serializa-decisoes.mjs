/**
 * Serializa as telas REAIS das quatro decisões em aberto (13/09/2026), no
 * estado "antes" (código de hoje) ou "depois" (branch descartável com a
 * proposta), para o comparador `gera-comparador-decisoes.mjs`.
 *
 *   node serializa-decisoes.mjs <saida> <sessao.json> <antes|depois> [tela,tela]
 *
 * Igual ao `serializa.mjs` (css.txt + <desktop|celular>/<tela>.html, imagens
 * e canvas embutidos, sem script, `jurify:mobileCompleto="1"` no celular),
 * com duas coisas a mais:
 *   - cada tela pode ter um `preparar(page, modo)` — abre diálogo, preenche
 *     campo, clica «Cadastrar» — e um `limpar(modo, viewport)` que apaga o
 *     que a preparação criou no banco;
 *   - o aviso de ambiente (STAGING / DEV LOCAL) sai do DOM antes da foto:
 *     produção não o tem.
 *
 * Telas:
 *   config-canais         /configuracoes?tab=canais com o escritório SEM canal
 *   config-canais-dialog  idem + card «WhatsApp Business» clicado (MetaConnectDialog)
 *   clientes-novo         /clientes?novo=1 (NovoClienteDialog aberto)
 *   clientes-novo-envio   idem + Nome e Telefone preenchidos + clique em «Cadastrar»
 *                         antes → erros na tela, nada criado (conferido por SELECT)
 *                         depois → espera 2,5s, serializa e APAGA o contato criado
 *   ajuda                 /ajuda
 *   ajuda-tarefa-nova     /ajuda/responder-cliente-atendimento
 *   ajuda-cadastrar       /ajuda/cadastrar-cliente
 *
 * As duas telas de canais MEXEM NO BANCO enquanto rodam — rode-as à parte,
 * sem outro agente capturando print ao mesmo tempo:
 *   node serializa-decisoes.mjs <saida> <sessao.json> antes config-canais,config-canais-dialog
 *
 * Como o canal some sem DELETE: `fk_conversas_canalId` é ON DELETE CASCADE —
 * apagar a linha de canais_integrados levaria junto as conversas do canal e
 * as mensagens delas. Então a linha é ESTACIONADA num escritório que não
 * existe (UPDATE escritorioId), o que basta para `listarCanais` devolver vazio
 * e o card «WhatsApp Business» aparecer, e volta pelo `canais_bak` no fim
 * (inclusive o updatedAt). Se o script morrer no meio, `canais_bak` fica no
 * banco e o próprio script se recusa a rodar de novo até você restaurar:
 *   UPDATE canais_integrados c JOIN canais_bak b ON b.id=c.id
 *     SET c.escritorioId=b.escritorioId, c.updatedAtCanal=b.updatedAtCanal;
 *   DROP TABLE canais_bak;
 *
 * Banco: mariadb -u$JF_DB_USER -p$JF_DB_PASS -h$JF_DB_HOST $JF_DB
 * (padrão jf/jf/127.0.0.1/juridflow). Dono: $DONO_EMAIL
 * (padrão dono-smoke@juridflow.com.br) — é dele o escritório que perde o canal.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [OUT, SESSAO, MODO, SO] = process.argv.slice(2);
if (!OUT || !SESSAO || !["antes", "depois"].includes(MODO)) {
  console.error("uso: node serializa-decisoes.mjs <saida> <sessao.json> <antes|depois> [tela,tela]");
  process.exit(2);
}
const BASE = process.env.APP_URL || "http://localhost:3000";
const DONO_EMAIL = process.env.DONO_EMAIL || "dono-smoke@juridflow.com.br";
const ESTACIONAMENTO = 999999;
const NOME_TESTE = "Ana Beatriz Correia";
const TEL_TESTE = "(85) 99999-0007";

/* ---------- banco ---------- */

function sql(query) {
  return execFileSync(
    "mariadb",
    [
      `-u${process.env.JF_DB_USER || "jf"}`,
      `-p${process.env.JF_DB_PASS || "jf"}`,
      `-h${process.env.JF_DB_HOST || "127.0.0.1"}`,
      "--default-character-set=utf8mb4",
      "-N", "-B", "-e", query,
      process.env.JF_DB || "juridflow",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function escritorioDoDono() {
  const id = sql(
    `SELECT escritorioId FROM colaboradores WHERE cargo='dono' AND userId=(SELECT id FROM users WHERE email='${esc(DONO_EMAIL)}') ORDER BY id LIMIT 1`,
  );
  if (!id) throw new Error(`não achei o escritório do dono ${DONO_EMAIL}`);
  return Number(id);
}

function esconderCanal(escritorioId) {
  if (sql("SHOW TABLES LIKE 'canais_bak'")) {
    throw new Error("canais_bak já existe: uma rodada anterior morreu no meio. Restaure (ver cabeçalho) antes de rodar de novo.");
  }
  sql(`CREATE TABLE canais_bak AS SELECT * FROM canais_integrados WHERE escritorioId=${escritorioId}`);
  sql(`UPDATE canais_integrados SET escritorioId=${ESTACIONAMENTO} WHERE id IN (SELECT id FROM canais_bak)`);
  const guardados = sql("SELECT COUNT(*) FROM canais_bak");
  const restantes = sql(`SELECT COUNT(*) FROM canais_integrados WHERE escritorioId=${escritorioId}`);
  console.log(`banco: ${guardados} canal(is) do escritório ${escritorioId} guardado(s) em canais_bak e estacionado(s); restam ${restantes} no escritório`);
}

function restaurarCanal(escritorioId) {
  sql("UPDATE canais_integrados c JOIN canais_bak b ON b.id=c.id SET c.escritorioId=b.escritorioId, c.updatedAtCanal=b.updatedAtCanal");
  const guardados = Number(sql("SELECT COUNT(*) FROM canais_bak"));
  const devolvidos = Number(sql("SELECT COUNT(*) FROM canais_integrados c JOIN canais_bak b ON b.id=c.id AND c.escritorioId=b.escritorioId AND c.updatedAtCanal=b.updatedAtCanal"));
  const noEscritorio = sql(`SELECT GROUP_CONCAT(CONCAT(id,':',statusCanal,':',IFNULL(telefoneCanal,'')) ORDER BY id) FROM canais_integrados WHERE escritorioId=${escritorioId}`);
  if (devolvidos !== guardados) {
    console.error(`banco: RESTAURAÇÃO INCOMPLETA — ${devolvidos} de ${guardados} voltaram. canais_bak foi MANTIDA; restaure à mão (ver cabeçalho).`);
    return false;
  }
  sql("DROP TABLE canais_bak");
  console.log(`banco: ${devolvidos} canal(is) de volta no escritório ${escritorioId} (${noEscritorio}); canais_bak apagada`);
  return true;
}

function contatosDeTeste(escritorioId) {
  return Number(sql(`SELECT COUNT(*) FROM contatos WHERE nomeContato='${esc(NOME_TESTE)}' AND escritorioIdContato=${escritorioId}`));
}

/** Apaga o contato que «Cadastrar» criou — filhos com chave estrangeira primeiro. */
function apagarContatoDeTeste(escritorioId) {
  const where = `nomeContato='${esc(NOME_TESTE)}' AND escritorioIdContato=${escritorioId}`;
  const ids = sql(`SELECT GROUP_CONCAT(id) FROM contatos WHERE ${where}`);
  if (!ids) return 0;
  sql(`DELETE FROM conversas WHERE contatoIdConv IN (${ids})`);
  sql(`DELETE FROM leads WHERE contatoIdLead IN (${ids})`);
  sql(`DELETE FROM contatos WHERE id IN (${ids})`);
  return ids.split(",").length;
}

/* ---------- telas ---------- */

const dialogoAberto = async (p, texto) => {
  await p.waitForSelector(`[role="dialog"]:has-text("${texto}")`, { timeout: 20000 });
  await p.waitForTimeout(800);
};

const TELAS = [
  {
    nome: "config-canais",
    rota: "/configuracoes?tab=canais",
    banco: "esconderCanal",
    preparar: async (p) => {
      await p.waitForSelector('text="WhatsApp Business"', { timeout: 20000 });
    },
  },
  {
    nome: "config-canais-dialog",
    rota: "/configuracoes?tab=canais",
    banco: "esconderCanal",
    preparar: async (p) => {
      const card = p.getByText("WhatsApp Business", { exact: true }).first();
      await card.waitFor({ timeout: 20000 });
      await card.click();
      await dialogoAberto(p, "WhatsApp Business");
    },
  },
  {
    nome: "clientes-novo",
    rota: "/clientes?novo=1",
    preparar: async (p) => dialogoAberto(p, "Novo Cliente"),
  },
  {
    nome: "clientes-novo-envio",
    rota: "/clientes?novo=1",
    preparar: async (p, modo) => {
      await dialogoAberto(p, "Novo Cliente");
      const dialogo = p.locator('[role="dialog"]:has-text("Novo Cliente")');
      await dialogo.getByPlaceholder("Nome completo").fill(NOME_TESTE);
      await dialogo.getByPlaceholder("(85) 99999-0000").fill(TEL_TESTE);
      // o campo consulta `clientes.verificarTelefone` com debounce de 400ms;
      // sem esperar, «Cadastrar» ainda estaria travado esperando a resposta
      await p.waitForTimeout(1200);
      await dialogo.getByRole("button", { name: "Cadastrar", exact: true }).click();
      await p.waitForTimeout(modo === "depois" ? 2500 : 900);
    },
    limpar: (modo, viewport, escritorioId) => {
      const n = contatosDeTeste(escritorioId);
      if (modo === "antes") {
        console.log(`  banco (${viewport}): ${n} contato(s) "${NOME_TESTE}" — ${n === 0 ? "nada foi criado, como esperado" : "ATENÇÃO: o antes criou cadastro"}`);
        if (n > 0) apagarContatoDeTeste(escritorioId);
        return;
      }
      const apagados = apagarContatoDeTeste(escritorioId);
      console.log(`  banco (${viewport}): ${n} contato(s) "${NOME_TESTE}" criado(s) pelo clique, ${apagados} apagado(s); restam ${contatosDeTeste(escritorioId)}`);
    },
  },
  // O menu lateral aparece em qualquer tela do app; o Dashboard é a que o
  // dono abre primeiro, então é onde a cor da marca se julga.
  {
    nome: "menu",
    rota: "/dashboard",
    preparar: async (p) => {
      // No celular o menu mora numa gaveta: sem abrir, a foto não tem menu.
      const gaveta = p.locator('[data-sidebar="trigger"], button[aria-label="Toggle Sidebar"]').first();
      if (await gaveta.count()) {
        const visivel = await gaveta.isVisible().catch(() => false);
        if (visivel) { await gaveta.click(); await p.waitForTimeout(900); }
      }
      await p.waitForSelector('[data-sidebar="menu-button"]', { timeout: 20000 });
      await p.waitForTimeout(1500);
    },
  },
  { nome: "ajuda", rota: "/ajuda", preparar: async (p) => { await p.waitForSelector('text="em breve"', { timeout: 20000 }); } },
  { nome: "ajuda-tarefa-nova", rota: "/ajuda/responder-cliente-atendimento" },
  { nome: "ajuda-cadastrar", rota: "/ajuda/cadastrar-cliente", preparar: async (p) => { await p.waitForSelector("img", { timeout: 20000 }); } },
];

const VIEWPORTS = [
  ["desktop", 1440, 900],
  ["celular", 390, 844],
];

const pedidas = SO ? SO.split(",").map((s) => s.trim()).filter(Boolean) : null;
const desconhecidas = (pedidas || []).filter((n) => !TELAS.some((t) => t.nome === n));
if (desconhecidas.length) {
  console.error(`tela(s) desconhecida(s): ${desconhecidas.join(", ")} — existem: ${TELAS.map((t) => t.nome).join(", ")}`);
  process.exit(2);
}
const telas = TELAS.filter((t) => !pedidas || pedidas.includes(t.nome));

/* ---------- serialização (a mesma do serializa.mjs) ---------- */

const SERIALIZAR = async () => {
  /** Vira data: URI o que o HTML salvo não conseguiria buscar depois. */
  const paraDataUri = async (url) => {
    try {
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return `data:${resp.headers.get("content-type") || "image/png"};base64,${btoa(bin)}`;
    } catch { return null; }
  };

  // aviso de ambiente: produção não o tem, e ele empurra a tela 24px pra baixo
  for (const d of document.querySelectorAll('[role="status"]')) {
    const t = d.textContent || "";
    if (t.includes("STAGING") || t.includes("DEV LOCAL")) d.remove();
  }

  const clone = document.body.cloneNode(true);

  // script nenhum sobrevive: o HTML salvo é foto, não app.
  clone.querySelectorAll("script,noscript").forEach((n) => n.remove());
  // trava de rolagem do diálogo (Radix) não faz sentido numa foto e impede
  // o comparador de rolar até o ponto
  clone.style.removeProperty("overflow");
  clone.style.removeProperty("pointer-events");
  clone.style.removeProperty("padding-right");
  clone.style.removeProperty("margin-right");

  const imgsVivas = [...document.body.querySelectorAll("img")];
  const imgsClone = [...clone.querySelectorAll("img")];
  for (let i = 0; i < imgsClone.length; i++) {
    const src = imgsVivas[i]?.currentSrc || imgsVivas[i]?.src || "";
    imgsClone[i].removeAttribute("srcset");
    if (!src || src.startsWith("data:")) continue;
    const d = await paraDataUri(src);
    if (d) imgsClone[i].setAttribute("src", d);
    else imgsClone[i].remove();
  }

  const canvasVivos = [...document.body.querySelectorAll("canvas")];
  const canvasClone = [...clone.querySelectorAll("canvas")];
  for (let i = 0; i < canvasClone.length; i++) {
    try {
      const img = document.createElement("img");
      img.src = canvasVivos[i].toDataURL("image/png");
      const r = canvasVivos[i].getBoundingClientRect();
      img.style.width = `${r.width}px`;
      img.style.height = `${r.height}px`;
      canvasClone[i].replaceWith(img);
    } catch { /* canvas sujo (cross-origin) — deixa como está */ }
  }

  // o que o usuário digitou vive em .value, não no atributo.
  const vivos = [...document.body.querySelectorAll("input,textarea,select")];
  const clones = [...clone.querySelectorAll("input,textarea,select")];
  for (let i = 0; i < clones.length; i++) {
    const v = vivos[i];
    if (!v) continue;
    if (v.tagName === "TEXTAREA") clones[i].textContent = v.value;
    else if (v.tagName === "INPUT") {
      if (v.type === "checkbox" || v.type === "radio") {
        if (v.checked) clones[i].setAttribute("checked", "");
      } else if (v.value) clones[i].setAttribute("value", v.value);
    } else if (v.tagName === "SELECT") {
      [...clones[i].options].forEach((o, k) => { if (v.options[k]?.selected) o.setAttribute("selected", ""); });
    }
  }

  let css = "";
  for (const s of document.styleSheets) {
    try {
      for (const rule of s.cssRules) css += rule.cssText + "\n";
    } catch { /* folha de outro host */ }
  }

  return {
    body: clone.outerHTML,
    css,
    rolaLado: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 4,
    altura: document.scrollingElement.scrollHeight,
    temDialogo: !!document.querySelector('[role="dialog"]'),
  };
};

/* ---------- roda ---------- */

const precisaEsconderCanal = telas.some((t) => t.banco === "esconderCanal");
const precisaBanco = precisaEsconderCanal || telas.some((t) => t.limpar);
const escritorioId = precisaBanco ? escritorioDoDono() : null;
if (precisaBanco) console.log(`escritório do dono: ${escritorioId} (${DONO_EMAIL}) · modo ${MODO}`);

if (precisaEsconderCanal) esconderCanal(escritorioId);
let cssSalvo = false;
let falhas = 0;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
try {
  for (const [pasta, larg, alt] of VIEWPORTS) {
    mkdirSync(`${OUT}/${pasta}`, { recursive: true });
    const ctx = await b.newContext({
      viewport: { width: larg, height: alt },
      storageState: SESSAO,
      isMobile: larg < 500,
      hasTouch: larg < 500,
      deviceScaleFactor: 1,
    });
    // No celular o app abre em "modo atendimento" e joga qualquer outra rota
    // pro /atendimento; a "versão completa" é o que precisa ser fotografado.
    await ctx.addInitScript(() => {
      try { localStorage.setItem("jurify:mobileCompleto", "1"); } catch { /* modo privado */ }
    });
    const p = await ctx.newPage();
    p.on("dialog", (d) => d.dismiss().catch(() => {}));

    for (const tela of telas) {
      try {
        await p.goto(`${BASE}${tela.rota}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await p.waitForTimeout(tela.espera ?? 4200);
        if (tela.preparar) await tela.preparar(p, MODO);
        await p.mouse.move(larg - 4, 4);
        await p.waitForTimeout(500);

        const r = await p.evaluate(SERIALIZAR);
        writeFileSync(`${OUT}/${pasta}/${tela.nome}.html`, r.body);
        if (!cssSalvo) { writeFileSync(`${OUT}/css.txt`, r.css); cssSalvo = true; }
        console.log(
          `${pasta}/${tela.nome}`.padEnd(30),
          `${(r.body.length / 1024).toFixed(0)}kb`.padEnd(8),
          `altura ${r.altura}px`.padEnd(16),
          (r.temDialogo ? "diálogo aberto" : "").padEnd(15),
          r.rolaLado ? "ROLA DE LADO" : "ok",
        );
      } catch (e) {
        falhas++;
        console.log(`${pasta}/${tela.nome} FALHOU: ${String(e).slice(0, 160)}`);
      } finally {
        if (tela.limpar) {
          try { tela.limpar(MODO, pasta, escritorioId); }
          catch (e) { console.log(`  limpar(${tela.nome}) FALHOU: ${String(e).slice(0, 160)}`); }
        }
      }
    }
    await ctx.close();
  }
} finally {
  await b.close();
  if (precisaEsconderCanal && !restaurarCanal(escritorioId)) process.exitCode = 1;
}
if (falhas) process.exitCode = 1;
