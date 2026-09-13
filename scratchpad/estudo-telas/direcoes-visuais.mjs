/**
 * Fotografa o app rodando sob TRÊS direções visuais diferentes.
 *
 *   node direcoes-visuais.mjs <sessao.json> <pasta>
 *
 * Por que três e não uma: a convergência do visual "feito com IA" não é falta
 * de capacidade do modelo, é o caminho de menor resistência — pedir UMA
 * proposta entrega sempre o mesmo ponto (Inter + roxo + cartão arredondado).
 * Três direções obrigam a sair dele, e quem escolhe é o dono.
 *
 * As direções são aplicadas como CAMADA DE TOKEN por cima do app real: o que
 * sai na foto é a tela de verdade, com os dados de verdade — não desenho.
 * Camada de token muda a PELE (cor, tipo, densidade, elevação); o ESQUELETO
 * (o que cada tela mostra e em que ordem) só muda com redesenho, e é por isso
 * que a terceira direção vem desenhada à parte.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [SESSAO, PASTA] = process.argv.slice(2);
mkdirSync(PASTA, { recursive: true });

const TELAS = [
  { id: "dashboard", url: "/dashboard" },
  { id: "atendimento", url: "/atendimento" },
  { id: "financeiro", url: "/financeiro" },
];

const DIRECOES = [
  { id: "hoje", tema: "claro", css: "" },

  /* ── A · CARTÓRIO ────────────────────────────────────────────────────────
   * O advogado LÊ o dia inteiro. Aqui o software se comporta como documento,
   * não como painel: fundo de papel, serifa nos títulos e nos números, régua
   * fina no lugar de cartão, canto quase reto e cor SÓ onde há risco.
   * Nenhum gerador escolhe serifa e fundo creme para um SaaS — é o oposto do
   * caminho de menor resistência, e é o que mais combina com um ofício que é
   * feito de texto. */
  {
    id: "cartorio",
    tema: "claro",
    css: `
      :root {
        --background: #f6f3ec;
        --card: #fffefa;
        --muted: #efeae0;
        --border: #ddd6c8;
        --input: #ddd6c8;
        --foreground: #1c1a16;
        --muted-foreground: #6b6459;
        --primary: #1f3a2e;
        --radius: 0.125rem;
        --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
        --serifa: Georgia, "Liberation Serif", "Times New Roman", serif;
      }
      [data-slot="card"] {
        box-shadow: none;
        border-color: var(--border);
        background: var(--card);
      }
      h1, h2, [data-slot="card-title"] {
        font-family: var(--serifa);
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      /* Números grandes também em serifa: é o que dá o ar de documento. */
      .tabular-nums, [class*="text-[var(--text-numero)]"], [class*="text-[var(--text-pagina)]"] {
        font-family: var(--serifa);
        font-variant-numeric: tabular-nums;
      }
    `,
  },

  /* ── B · MESA DE OPERAÇÕES ───────────────────────────────────────────────
   * 300 processos e 50 conversas: o valor é ver muito de uma vez e agir por
   * teclado. O app INTEIRO veste o quase-preto que hoje só o menu tem, uma
   * única cor de acento (o violeta da marca), linhas mais baixas e números
   * tabulares. Escuro NATIVO, não "modo escuro" — a informação se separa por
   * gradação de branco, não por cor. */
  {
    id: "operacoes",
    tema: "escuro",
    css: `
      :root, .dark {
        --background: #07060f;
        --card: #100e1c;
        --popover: #100e1c;
        --muted: #17152a;
        --border: rgba(255,255,255,.09);
        --input: rgba(255,255,255,.12);
        --foreground: #e7e5ef;
        --muted-foreground: #8f8aa6;
        --primary: #9a73ff;
        --primary-foreground: #0b0a14;
        --radius: 0.375rem;
      }
      [data-slot="card"] {
        box-shadow: none;
        border-color: rgba(255,255,255,.09);
        background: var(--card);
      }
      /* Densidade: o mesmo conteúdo em menos altura, sem encolher a letra. */
      [data-slot="card"] { gap: 1rem; padding-top: 1rem; padding-bottom: 1rem; }
      [data-slot="card-header"], [data-slot="card-content"] { padding-left: 1rem; padding-right: 1rem; }
      table td, table th { padding-top: .375rem; padding-bottom: .375rem; }
      body { font-variant-numeric: tabular-nums; }
    `,
  },
];

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const d of DIRECOES) {
  const ctx = await b.newContext({
    storageState: SESSAO,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript(([tema, extra]) => {
    try { localStorage.setItem("jurify:tema", tema); } catch {}
    const por = () => {
      const st = document.createElement("style");
      st.textContent =
        ".bg-warning.text-center.select-none{display:none !important}" + extra;
      document.head && document.head.appendChild(st);
    };
    if (document.head) por(); else addEventListener("DOMContentLoaded", por);
  }, [d.tema, d.css]);

  const p = await ctx.newPage();
  for (const tela of TELAS) {
    await p.goto(`http://localhost:3000${tela.url}`, { waitUntil: "domcontentloaded", timeout: 40000 });
    await p.waitForTimeout(4500);
    await p.screenshot({ path: `${PASTA}/${tela.id}-${d.id}.png` });
    console.log(`${tela.id}/${d.id} ok`);
  }
  await ctx.close();
}
await b.close();
