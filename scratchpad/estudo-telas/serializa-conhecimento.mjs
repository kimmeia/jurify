/**
 * Serializa as telas do mockup "Conhecimento jurídico" — as duas que a fusão
 * toca, e que vivem em sessões DIFERENTES (o painel é do admin da plataforma,
 * a conversa é do advogado).
 *
 *   node serializa-conhecimento.mjs <pasta-de-saida> <sessao-dono> <sessao-admin>
 *
 * Duas diferenças pro `serializa.mjs` de sempre, e as duas são por necessidade:
 *  - cada tela declara a sessão que a abre;
 *  - a conversa do JurisIA só mostra a resposta DEPOIS de clicar no trabalho
 *    salvo na lista lateral. Sem esse clique o mockup guardaria a tela de
 *    "Como posso ajudar?", que é justamente o que não muda entre antes e
 *    depois.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const [OUT, SESSAO_DONO, SESSAO_ADMIN, ESTADO = "depois"] = process.argv.slice(2);

/**
 * O mesmo nome de tela aponta pra rotas diferentes nos dois estados — é o
 * próprio assunto do mockup: as DUAS abas de antes viram UMA. Sem esse mapa,
 * o "antes" da fusão cairia na aba Agentes IA, que não tem nada a ver.
 */
const TELAS = ESTADO === "antes"
  ? [
      { nome: "jurisia", rota: "/jurisia", sessao: "dono", abrirConversa: true },
      { nome: "admin-biblioteca", rota: "/admin/ia?aba=base", sessao: "admin" },
      { nome: "admin-acervo", rota: "/admin/ia?aba=jurisia", sessao: "admin" },
    ]
  : [
      { nome: "jurisia", rota: "/jurisia", sessao: "dono", abrirConversa: true },
      { nome: "admin-biblioteca", rota: "/admin/ia?aba=conhecimento", sessao: "admin" },
      { nome: "admin-acervo", rota: "/admin/ia?aba=conhecimento", sessao: "admin", abrirDobra: true },
    ];

const VIEWPORTS = [
  ["desktop", 1440, 900],
  ["celular", 390, 844],
];

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

let cssSalvo = false;

for (const [pasta, larg, alt] of VIEWPORTS) {
  mkdirSync(`${OUT}/${pasta}`, { recursive: true });

  for (const tela of TELAS) {
    const ctx = await b.newContext({
      viewport: { width: larg, height: alt },
      storageState: tela.sessao === "admin" ? SESSAO_ADMIN : SESSAO_DONO,
      isMobile: larg < 500,
      hasTouch: larg < 500,
      deviceScaleFactor: 1,
    });
    await ctx.addInitScript(() => {
      try { localStorage.setItem("jurify:mobileCompleto", "1"); } catch { /* modo privado */ }
    });
    const p = await ctx.newPage();
    p.on("dialog", (d) => d.dismiss().catch(() => {}));

    try {
      await p.goto(`http://localhost:3000${tela.rota}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await p.waitForTimeout(4500);

      if (tela.abrirConversa) {
        const alvo = p.locator("text=Revisional TJCE").first();
        if (await alvo.count()) {
          await alvo.click();
          await p.waitForTimeout(3000);
        }
      }

      if (tela.abrirDobra) {
        const dobra = p.locator("summary:has-text('Tribunais e varredura')").first();
        if (await dobra.count()) {
          await dobra.click();
          await p.waitForTimeout(3500);
        }
      }

      const r = await p.evaluate(async () => {
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

        const clone = document.body.cloneNode(true);
        clone.querySelectorAll("script,noscript").forEach((n) => n.remove());

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
            const rc = canvasVivos[i].getBoundingClientRect();
            img.style.width = `${rc.width}px`;
            img.style.height = `${rc.height}px`;
            canvasClone[i].replaceWith(img);
          } catch { /* canvas sujo */ }
        }

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
        };
      });

      writeFileSync(`${OUT}/${pasta}/${tela.nome}.html`, r.body);
      if (!cssSalvo) { writeFileSync(`${OUT}/css.txt`, r.css); cssSalvo = true; }
      console.log(
        `${pasta}/${tela.nome}`.padEnd(30),
        `${(r.body.length / 1024).toFixed(0)}kb`.padEnd(8),
        `altura ${r.altura}px`.padEnd(16),
        r.rolaLado ? "ROLA DE LADO" : "ok",
      );
    } catch (e) {
      console.log(`${pasta}/${tela.nome} FALHOU: ${String(e).slice(0, 100)}`);
    }
    await ctx.close();
  }
}
await b.close();
