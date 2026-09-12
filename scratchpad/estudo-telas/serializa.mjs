/**
 * Serializa as telas REAIS do app rodando, para montar o mockup navegável.
 *
 *   node serializa.mjs <pasta-de-saida> <sessao.json>
 *
 * Grava, na pasta de saída:
 *   css.txt                 — o CSS compilado do app (uma vez, vale pra todas)
 *   <viewport>/<tela>.html  — só o <body>, com imagens/canvas embutidos
 *
 * Por que serializar em vez de desenhar: mockup desenhado à mão já foi
 * reprovado pelo dono ("cópia barata"). A marcação aqui é a do app.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const [OUT, SESSAO, SO] = process.argv.slice(2);

const TELAS = [
  ["dashboard", "/dashboard"],
  ["atendimento", "/atendimento"],
  ["clientes", "/clientes"],
  ["agenda", "/agenda"],
  ["processos", "/processos"],
  ["movimentacoes", "/movimentacoes"],
  ["kanban", "/kanban"],
  ["acordos", "/acordos"],
  ["financeiro", "/financeiro"],
  ["relatorios", "/relatorios"],
  ["tarefas", "/tarefas"],
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
  const ctx = await b.newContext({
    viewport: { width: larg, height: alt },
    storageState: SESSAO,
    isMobile: larg < 500,
    hasTouch: larg < 500,
    deviceScaleFactor: 1,
  });
  // No celular o app abre em "modo atendimento" e joga qualquer outra rota
  // pro /atendimento. A versão completa é o que um usuário de celular vê
  // depois de "Abrir versão completa" — é ela que precisa ser fotografada.
  await ctx.addInitScript(() => {
    try { localStorage.setItem("jurify:mobileCompleto", "1"); } catch { /* modo privado */ }
  });
  const p = await ctx.newPage();
  p.on("dialog", (d) => d.dismiss().catch(() => {}));

  for (const [nome, rota] of TELAS.filter(([n]) => !SO || SO.split(",").includes(n))) {
    try {
      await p.goto(`http://localhost:3000${rota}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await p.waitForTimeout(4200);

      const r = await p.evaluate(async () => {
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

        const clone = document.body.cloneNode(true);

        // script nenhum sobrevive: o HTML salvo é foto, não app.
        clone.querySelectorAll("script,noscript").forEach((n) => n.remove());

        // <img> do mesmo host não existe offline → embute.
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

        // <canvas> é pintado por JS; sem JS fica branco → virou imagem.
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
          }
        }

        // CSS compilado: o do Vite é same-origin e legível; o do Google Fonts
        // estoura SecurityError — e não faz falta, a fonte entra embutida.
        let css = "";
        for (const s of document.styleSheets) {
          try {
            for (const rule of s.cssRules) css += rule.cssText + "\n";
          } catch { /* folha de outro host */ }
        }

        return {
          body: clone.outerHTML,
          classeHtml: document.documentElement.className,
          css,
          rolaLado: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 4,
          altura: document.scrollingElement.scrollHeight,
        };
      });

      writeFileSync(`${OUT}/${pasta}/${nome}.html`, r.body);
      if (!cssSalvo) { writeFileSync(`${OUT}/css.txt`, r.css); cssSalvo = true; }
      console.log(
        `${pasta}/${nome}`.padEnd(28),
        `${(r.body.length / 1024).toFixed(0)}kb`.padEnd(8),
        `altura ${r.altura}px`.padEnd(16),
        r.rolaLado ? "ROLA DE LADO" : "ok",
      );
    } catch (e) {
      console.log(`${pasta}/${nome} FALHOU: ${String(e).slice(0, 90)}`);
    }
  }
  await ctx.close();
}
await b.close();
