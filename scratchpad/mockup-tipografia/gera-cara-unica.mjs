// Gera mockup-cara-unica.html — Fatia 2 do plano de frontend.
// Contexto: docs/frontend-sistema-visual-2026-09-10.md
//
// Os exemplos do "antes" são FIÉIS ao código: as classes escritas sob cada
// cabeçalho são as que estão no repo hoje (grep em client/src/pages).
import { readFileSync, writeFileSync } from "node:fs";
const FONTES = readFileSync(process.argv[2], "utf8");
const RAIZ = process.argv[3];

const ic = {
  lupa: (c = "#6d7d8c") =>
    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="${c}" stroke-width="2"/><path d="m20 20-3.2-3.2" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`,
  mais: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  chev: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="#6d7d8c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pasta: (c) =>
    `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5v-10Z" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  giro: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 3a9 9 0 1 0 9 9" stroke="#6d7d8c" stroke-width="2.4" stroke-linecap="round"/></svg>`,
};

/* ── Card A: os cabeçalhos como estão hoje ───────────────────────────────
   As classes citadas são as que estão no repo. */
const HOJE = [
  {
    tela: "Processos",
    classe: 'text-pagina font-bold tracking-tight leading-none',
    ritmo: "space-y-4 min-w-0",
    html: `
      <div class="hd">
        <div>
          <div class="tt-pagina">Processos</div>
          <div class="tt-sub">O robô entra nos tribunais todo dia e avisa o que mudou</div>
          <div class="pastilhas">
            <span class="pst"><b>8</b> monitorados</span>
            <span class="pst al"><b>1</b> parado</span>
          </div>
        </div>
        <div class="acoes"><span class="bt">Resumo diário</span><span class="bt bp">${ic.mais}Monitorar</span></div>
      </div>`,
  },
  {
    tela: "Relatórios",
    classe: 'text-2xl font-bold tracking-tight',
    ritmo: "space-y-4",
    html: `
      <div class="hd">
        <div><div class="tt-2xl">Relatórios</div></div>
        <div class="acoes"><span class="bt">Período ${ic.chev}</span><span class="bt">Exportar PDF</span></div>
      </div>`,
  },
  {
    tela: "Acordos",
    classe: "sem &lt;h1&gt; — a tela começa no conteúdo",
    ritmo: "space-y-3.5 p-4 md:p-6",
    html: `
      <div class="hd">
        <div class="busca-so">${ic.lupa()}<span>Buscar acordo por cliente ou processo</span></div>
        <div class="acoes"><span class="bt bp">${ic.mais}Novo acordo</span></div>
      </div>`,
  },
];

/* ── Card B: o mesmo cabeçalho para todas ── */
const DEPOIS = [
  {
    tela: "Processos",
    titulo: "Processos",
    sub: "O robô entra nos tribunais todo dia e avisa o que mudou",
    pastilhas: [["8", "monitorados", ""], ["1", "parado", "al"]],
    acoes: [["Resumo diário", ""], ["Monitorar", "bp"]],
  },
  {
    tela: "Relatórios",
    titulo: "Relatórios",
    sub: "O que entrou, o que foi fechado e quem vendeu, no período escolhido",
    pastilhas: [["R$ 83 mil", "recebido", ""], ["20", "fechados", ""]],
    acoes: [["Período", "ch"], ["Exportar PDF", ""]],
  },
  {
    tela: "Acordos",
    titulo: "Acordos",
    sub: "O que cada cliente combinou de pagar e quanto já entrou",
    pastilhas: [["14", "em dia", ""], ["3", "atrasados", "al"]],
    acoes: [["Novo acordo", "bp"]],
  },
];

const cabecalhoNovo = (d) => `
  <div class="hd">
    <div>
      <div class="tt-pagina">${d.titulo}</div>
      <div class="tt-sub">${d.sub}</div>
      <div class="pastilhas">
        ${d.pastilhas.map(([n, r, c]) => `<span class="pst ${c}"><b>${n}</b> ${r}</span>`).join("")}
      </div>
    </div>
    <div class="acoes">
      ${d.acoes.map(([t, c]) => `<span class="bt ${c === "bp" ? "bp" : ""}">${c === "bp" ? ic.mais : ""}${t}${c === "ch" ? ic.chev : ""}</span>`).join("")}
    </div>
  </div>`;

const numeros = [
  ["18", "variantes de <b>&lt;h1&gt;</b> escritas à mão", ""],
  ["9", "ritmos de espaçamento diferentes", ""],
  ["30", "telas usam girinho <b>e</b> esqueleto ao mesmo tempo", "al"],
  ["0", "usos do componente de lista vazia que já existe", "al"],
];

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>JuridFlow · Cara de produto único</title>
${FONTES}
<style>
  :root{
    --bg:#f4f6f8; --surface:#fff; --borda:#dfe4ea; --hairline:#eef1f4;
    --tinta:#16202c; --corpo:#33404f; --mudo:#5a6b7d; --fraco:#6d7d8c; --fantasma:#aab6c2;
    --acento:#194b86; --acento-forte:#11325c; --acento-bg:#eaf1f8;
    --ok:#097245; --ok-bg:#e9f6ef; --aviso:#8a5a0b; --aviso-bg:#fdf6e7;
    --alerta:#a8231b; --alerta-bg:#fdf0ef; --alerta-borda:#f0c5c1;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1600px;height:1050px;overflow:hidden}
  body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--tinta)}
  .wrap{padding:20px 30px;height:100%;display:flex;flex-direction:column}

  .h1{font-family:'Poppins';font-weight:700;font-size:26px;letter-spacing:-.01em;line-height:1}
  .sub{margin-top:6px;font-size:13px;color:var(--mudo)}
  .micro{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fraco)}

  .card{background:var(--surface);border:1px solid var(--borda);border-radius:14px;flex:0 0 auto}
  .ct{padding:10px 15px;border-bottom:1px solid var(--hairline);display:flex;align-items:center;justify-content:space-between}
  .ctt{font-family:'Poppins';font-weight:700;font-size:15px}

  .grade{margin-top:13px;flex:1;display:grid;grid-template-columns:790px 1fr;gap:16px;min-height:0}
  .col{display:flex;flex-direction:column;gap:11px;min-height:0}

  /* ── amostra de tela ── */
  .amostra{padding:9px 14px 11px}
  .peca{border:1px solid var(--borda);border-radius:11px;padding:10px 13px;background:#fcfdfe}
  .peca + .rot{margin-top:6px}
  .rot{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:5px}
  .rot .nome{font-size:13px;font-weight:700}
  .rot code{font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;font-size:11px;color:var(--alerta);
            background:var(--alerta-bg);border-radius:4px;padding:1px 5px}
  .rot code.ok{color:var(--ok);background:var(--ok-bg)}
  .bloco + .bloco{margin-top:9px}

  .hd{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
  .tt-pagina{font-family:'Poppins';font-weight:700;font-size:26px;letter-spacing:-.01em;line-height:1}
  .tt-2xl{font-family:'Inter';font-weight:700;font-size:24px;letter-spacing:-.02em;line-height:1}
  .tt-sub{margin-top:4px;font-size:13px;color:var(--mudo)}
  .pastilhas{display:flex;gap:7px;margin-top:7px}
  .pst{border:1px solid var(--borda);background:var(--surface);border-radius:9px;padding:4px 10px;
       font-size:11.5px;color:var(--mudo)}
  .pst b{font-size:13px;color:var(--tinta);font-variant-numeric:tabular-nums}
  .pst.al{background:var(--alerta-bg);border-color:var(--alerta-borda)}
  .pst.al b,.pst.al{color:var(--alerta)}
  .acoes{display:flex;gap:7px;flex:0 0 auto;align-items:center}
  .bt{border:1px solid var(--borda);background:var(--surface);border-radius:9px;padding:7px 12px;
      font-size:13px;font-weight:500;color:var(--corpo);display:inline-flex;align-items:center;gap:6px}
  .bt.bp{background:var(--acento);border-color:var(--acento);color:#fff;font-weight:600;
         box-shadow:0 8px 18px -9px #194b8699}
  .busca-so{flex:1;max-width:360px;border:1px solid var(--borda);background:var(--surface);border-radius:9px;
            padding:9px 12px;display:flex;align-items:center;gap:9px;font-size:13px;color:var(--fraco)}

  /* ── anatomia ── */
  .anat{padding:10px 15px 12px}
  .slot{display:flex;align-items:flex-start;gap:10px;padding:5px 0;border-top:1px solid var(--hairline)}
  .slot:first-child{border-top:0;padding-top:2px}
  .slot .n{width:20px;height:20px;flex:0 0 20px;border-radius:6px;background:var(--acento-bg);
           color:var(--acento-forte);display:flex;align-items:center;justify-content:center;
           font-size:11px;font-weight:800;margin-top:1px}
  .slot .t{font-size:13px;font-weight:700}
  .slot .d{font-size:11.5px;color:var(--mudo);margin-top:1px;line-height:1.35}
  .slot .d em{font-style:normal;color:var(--acento-forte);font-weight:600}
  .regra{margin-top:8px;padding:8px 10px;background:var(--acento-bg);border-radius:9px;
         font-size:11.5px;color:var(--acento-forte);line-height:1.35}

  /* ── antes × depois lado a lado ── */
  .ad{padding:10px 14px 11px;display:grid;grid-template-columns:1fr 1fr;gap:13px}
  .lado{display:flex;flex-direction:column;min-width:0}
  .tagv{align-self:flex-start;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700;
        letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px}
  .tagv.a{background:var(--alerta-bg);color:var(--alerta)}
  .tagv.d{background:var(--ok-bg);color:var(--ok)}
  .caixa{border:1px solid var(--borda);border-radius:10px;background:#fcfdfe;padding:10px;flex:1;
         display:flex;flex-direction:column;justify-content:center}
  .nota-p{margin-top:6px;font-size:11.5px;color:var(--mudo);line-height:1.35}

  /* vazio */
  .vazio-ruim{font-size:12px;color:var(--mudo)}
  .vazio-ruim + .vazio-ruim{margin-top:14px;padding-top:12px;border-top:1px dashed var(--borda)}
  .vazio-bom{text-align:center}
  .vazio-bom .ib{width:42px;height:42px;border-radius:12px;background:var(--hairline);margin:0 auto 9px;
                 display:flex;align-items:center;justify-content:center}
  .vazio-bom .t{font-size:13px;font-weight:700}
  .vazio-bom .d{font-size:11.5px;color:var(--mudo);margin-top:3px;line-height:1.35}
  .vazio-bom .b{margin-top:10px;display:inline-flex;align-items:center;gap:6px;background:var(--acento);
                color:#fff;border-radius:9px;padding:7px 13px;font-size:13px;font-weight:600}
  .vz-titulo{font-size:13px;font-weight:700;color:var(--tinta)}
  .vz-sub{font-size:11.5px;color:var(--mudo);margin-top:2px}

  /* carregando */
  .car-ruim{display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--mudo);font-size:13px}
  .esq{display:flex;flex-direction:column;gap:7px}
  .esq .l{display:flex;align-items:center;gap:10px}
  .esq .q{width:27px;height:27px;border-radius:8px;background:var(--hairline);flex:0 0 27px}
  .esq .b1{height:8px;border-radius:4px;background:var(--hairline)}
  .esq .b2{height:7px;border-radius:4px;background:#f4f6f8;margin-top:5px}
  .esq .cl{flex:1;min-width:0}

  /* números */
  .nums{margin-top:13px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;flex:0 0 auto}
  .nc{background:var(--surface);border:1px solid var(--borda);border-radius:12px;padding:11px 15px}
  .nc.al{background:var(--alerta-bg);border-color:var(--alerta-borda)}
  .nc .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
  .nc.al .v{color:var(--alerta)}
  .nc .l{margin-top:4px;font-size:11.5px;color:var(--mudo);line-height:1.3}
  .nc.al .l{color:#8a3a34}
</style>
</head>
<body>
<div class="wrap">
  <div>
    <div class="h1">Cara de produto único</div>
    <div class="sub">Cada tela do JuridFlow foi escrita como se fosse o primeiro dia do projeto. Três coisas, repetidas em todas as telas, resolvem isso: um cabeçalho, um respiro, uma forma de dizer “carregando” e “está vazio”.</div>
  </div>

  <div class="grade">
    <div class="col">
      <div class="card">
        <div class="ct"><span class="ctt">O cabeçalho de cada tela, hoje</span><span class="micro">fiel ao código</span></div>
        <div class="amostra">
          ${HOJE.map(
            (h) => `
          <div class="bloco">
            <div class="rot"><span class="nome">${h.tela}</span><code>${h.classe}</code><code>${h.ritmo}</code></div>
            <div class="peca">${h.html}</div>
          </div>`,
          ).join("")}
        </div>
      </div>

      <div class="card">
        <div class="ct"><span class="ctt">O mesmo cabeçalho, nas 47 telas</span><span class="micro">um componente só</span></div>
        <div class="amostra">
          ${DEPOIS.map(
            (d) => `
          <div class="bloco">
            <div class="rot"><span class="nome">${d.tela}</span><code class="ok">&lt;PageHeader /&gt;</code><code class="ok">o mesmo respiro</code></div>
            <div class="peca">${cabecalhoNovo(d)}</div>
          </div>`,
          ).join("")}
        </div>
      </div>
    </div>

    <div class="col">
      <div class="card">
        <div class="ct"><span class="ctt">O que o cabeçalho tem</span><span class="micro">sempre nesta ordem</span></div>
        <div class="anat">
          <div class="slot"><span class="n">1</span><span><span class="t">Título da tela</span><div class="d">Um substantivo. Sempre no mesmo tamanho — <em>pagina, 26px</em>.</div></span></div>
          <div class="slot"><span class="n">2</span><span><span class="t">Uma linha dizendo o que a tela resolve</span><div class="d">Escrita para quem abriu pela primeira vez, não para quem já sabe. <em>corpo, 13px</em>.</div></span></div>
          <div class="slot"><span class="n">3</span><span><span class="t">Pastilhas com o número que importa</span><div class="d">O que está em dia, o que precisa de você. Opcional.</div></span></div>
          <div class="slot"><span class="n">4</span><span><span class="t">Ações, à direita</span><div class="d">A principal em azul; o resto neutro. Uma azul por tela.</div></span></div>
          <div class="regra">O que a tela não tiver, some — <b>nunca vira outra estrutura</b>. É isso que faz a pessoa reconhecer onde clicar sem reaprender a cada tela.</div>
        </div>
      </div>

      <div class="card">
        <div class="ct"><span class="ctt">Quando a lista está vazia</span><span class="micro">81 telas, 81 jeitos</span></div>
        <div class="ad">
          <div class="lado">
            <span class="tagv a">Hoje</span>
            <div class="caixa">
              <div class="vazio-ruim">Nenhum card no funil.</div>
              <div class="vazio-ruim">
                <div class="vz-titulo">Nenhum monitoramento ativo</div>
                <div class="vz-sub">Cadastre um processo para começar</div>
              </div>
            </div>
            <div class="nota-p">Duas telas, dois níveis de capricho — e nenhuma das duas oferece o botão que resolve.</div>
          </div>
          <div class="lado">
            <span class="tagv d">Proposto</span>
            <div class="caixa">
              <div class="vazio-bom">
                <div class="ib">${ic.pasta("#6d7d8c")}</div>
                <div class="t">Nenhum processo monitorado ainda</div>
                <div class="d">Cadastre o primeiro e o robô passa a avisar o que muda no tribunal.</div>
                <div class="b">${ic.mais}Monitorar processo</div>
              </div>
            </div>
            <div class="nota-p">Sempre três coisas: o que está vazio, por que importa, e o botão que sai dali. O componente já existe no projeto e nunca foi usado.</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="ct"><span class="ctt">Enquanto carrega</span><span class="micro">99 girinhos × 47 esqueletos</span></div>
        <div class="ad">
          <div class="lado">
            <span class="tagv a">Hoje</span>
            <div class="caixa">
              <div class="car-ruim">${ic.giro}<span>Carregando...</span></div>
            </div>
            <div class="nota-p">A tela vira uma rodinha e “pula” quando os dados chegam — e <b>30 telas usam os dois ao mesmo tempo</b>.</div>
          </div>
          <div class="lado">
            <span class="tagv d">Proposto</span>
            <div class="caixa">
              <div class="esq">
                ${[1, 2, 3]
                  .map(
                    (i) => `<div class="l"><div class="q"></div><div class="cl"><div class="b1" style="width:${[72, 58, 65][i - 1]}%"></div><div class="b2" style="width:${[45, 38, 50][i - 1]}%"></div></div></div>`,
                  )
                  .join("")}
              </div>
            </div>
            <div class="nota-p">O esqueleto tem a forma da lista que vem, então nada pula. Girinho só no botão clicado.</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="nums">
    ${numeros.map(([v, l, c]) => `<div class="nc ${c}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("")}
  </div>
</div>
</body>
</html>`;

writeFileSync(`${RAIZ}/mockup-cara-unica.html`, html);
console.log("ok: mockup-cara-unica.html gerado");
