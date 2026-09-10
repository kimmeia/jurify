// Gera mockup-tipografia-escala.html — a proposta em uma página:
// a linha ampliada (antes × depois), a escala de 7 degraus, a prova de
// largura medida no navegador, os números e o plano em 4 fatias.
import { readFileSync, writeFileSync } from "node:fs";
const FONTES = readFileSync(process.argv[2], "utf8");
const RAIZ = process.argv[3];

const relogio = (c) =>
  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="${c}" stroke-width="2.2"/><path d="M12 7v5.4l3.4 2" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const balanca = (c) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M7 21h10M5 7h14M8 7l-3 6h6L8 7Zm8 0-3 6h6l-3-6Z" stroke="${c}" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
const kebab = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.7" fill="#6d7d8c"/><circle cx="12" cy="12" r="1.7" fill="#6d7d8c"/><circle cx="19" cy="12" r="1.7" fill="#6d7d8c"/></svg>`;

/* A linha da lista, parametrizada pelos tamanhos. `v` = "a" (antes) ou "d" (depois). */
const linha = (v) => `
<div class="row ${v}">
  <div class="rav">${balanca("#194b86")}</div>
  <div class="rmeio">
    <div class="rl1">
      <span class="rdot"></span>
      <span class="rnome">José Ribamar da Silva Filho</span>
      <span class="rselo">${v === "a" ? "2º GRAU?" : "2º grau?"}</span>
    </div>
    <div class="rcnj">0056789-12.2024.8.06.0001 · TJCE</div>
    <div class="rl3">
      <span class="rmov">Sentença publicada</span>
      <span class="rprazo">${relogio("#a8231b")}${v === "a" ? "PRAZO VENCE HOJE" : "prazo vence hoje"}</span>
    </div>
  </div>
  <div class="rdir"><div class="rtempo">há 3 dias</div><div class="rtr">última mov.</div></div>
  <div class="rkb">${kebab}</div>
</div>`;

const degraus = [
  ["micro", "11", "700 · caixa alta · +.06em", "rótulo de seção, cabeçalho de coluna, selo", "7 · 7,5 · 8 · 8,5 · 9 · 9,5 · 10 · 10,5", "d-micro"],
  ["apoio", "11,5", "500", "meta, carimbo de tempo, texto de ajuda", "10 · 10,5 · 11 · 11,5", "d-apoio"],
  ["corpo", "13", "500 / 600", "texto de lista, controle, valor", "12 · 12,5 · 12,8 · 13 · 13,5 · xs · sm", "d-corpo"],
  ["secao", "15", "700 Poppins", "título de card", "14 · 14,5 · 15 · base · lg", "d-secao"],
  ["numero", "22", "700 tabular", "número de cartão (KPI)", "19 · 22 · 26 · 30 · 34 · 38 · 42", "d-numero"],
  ["titulo", "20", "700 Poppins", "título de aba / subpágina", "17 · 18 · 19 · 20 · xl", "d-titulo"],
  ["pagina", "26", "700 Poppins", "título da tela", "22 · 24 · 26 · 27 · 28 · 2xl · 3xl", "d-pagina"],
];
const amostra = {
  "d-micro": "PROCESSOS VIGIADOS",
  "d-apoio": "última varredura às 06:12",
  "d-corpo": "Sentença publicada",
  "d-secao": "Prazos da semana",
  "d-numero": "248",
  "d-titulo": "Monitorados",
  "d-pagina": "Processos",
};

const larguras = [
  ["2º grau?", "45,9", "45,2", "-0,8"],
  ["Pausado", "46,7", "46,0", "-0,7"],
  ["prazo vence hoje", "96,7", "90,9", "-5,7"],
  ["TJCE", "24,0", "27,4", "+3,4"],
];

const fatias = [
  ["1", "Escala + piso de legibilidade", "As 6 telas do dia a dia — Processos, Clientes, Atendimento, Agenda, Kanban, Financeiro.", "on"],
  ["2", "Cara de produto único", "Cabeçalho, respiro e linguagem de “vazio/carregando” iguais nas 47 telas.", ""],
  ["3", "Celular", "As 16 telas com tabela ganham versão de cartão para o telefone.", ""],
  ["4", "Resto do sistema", "Editor do SmartFlow e as 24 telas do painel admin.", ""],
];

const numeros = [
  ["2.856", "tamanhos de fonte escritos à mão", ""],
  ["33", "valores diferentes — um sistema usa 7", ""],
  ["1.501", "estão em 10px ou menos", "al"],
  ["16 de 16", "telas com tabela não abrem bem no celular", "al"],
];

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>JuridFlow · Sistema visual · tipografia</title>
${FONTES}
<style>
  :root{
    --bg:#f4f6f8; --surface:#fff; --borda:#dfe4ea; --hairline:#eef1f4;
    --tinta:#16202c; --corpo:#33404f; --mudo:#5a6b7d; --fraco:#6d7d8c;
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
  .ct{padding:11px 15px;border-bottom:1px solid var(--hairline);display:flex;align-items:center;justify-content:space-between}
  .ctt{font-family:'Poppins';font-weight:700;font-size:15px}

  .grade{margin-top:13px;flex:1;display:grid;grid-template-columns:806px 1fr;gap:18px;min-height:0}
  .col{display:flex;flex-direction:column;gap:14px;min-height:0}

  /* ── linha ampliada ── */
  .lupa{padding:14px 15px 16px}
  .tagv{display:inline-flex;align-items:center;gap:7px;border-radius:20px;padding:3px 10px;
        font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
  .tagv.a{background:var(--alerta-bg);color:var(--alerta)}
  .tagv.d{background:var(--ok-bg);color:var(--ok)}
  .palco{height:106px;overflow:hidden;margin-top:10px}
  .zoom{transform:scale(1.3);transform-origin:top left;width:593px}
  .row{display:flex;align-items:center;gap:12px;padding:11px 13px;border:1px solid var(--borda);
       border-radius:11px;background:var(--surface)}
  .rav{width:36px;height:36px;border-radius:10px;flex:0 0 36px;background:var(--acento-bg);
       display:flex;align-items:center;justify-content:center}
  .rmeio{flex:1;min-width:0}
  .rl1{display:flex;align-items:center;gap:7px}
  .rdot{width:8px;height:8px;border-radius:50%;background:#8a5a0b;flex:0 0 8px}
  .rl3{margin-top:5px;display:flex;align-items:center;gap:7px;min-width:0}
  .rmov{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rnome{white-space:nowrap}
  .rcnj{margin-top:2px;font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;color:var(--mudo)}
  .rselo{border-radius:5px;padding:2px 6px;background:var(--aviso-bg);color:var(--aviso);white-space:nowrap}
  .rprazo{border-radius:20px;padding:2px 9px;background:var(--alerta-bg);color:var(--alerta);
          display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .rdir{flex:0 0 auto;text-align:right;min-width:70px}
  .rkb{width:26px;flex:0 0 26px;display:flex;justify-content:center;color:var(--fraco)}

  /* antes: os tamanhos que estão no código */
  .a .rnome{font-size:13px;font-weight:700}
  .a .rselo{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
  .a .rcnj{font-size:10.5px}
  .a .rmov{font-size:12px;color:var(--mudo)}
  .a .rprazo{font-size:9px;font-weight:600}
  .a .rtempo{font-size:11.5px;font-weight:600;color:#4a5a6b}
  .a .rtr{font-size:10px;color:var(--mudo)}
  /* depois: a escala */
  .d .rnome{font-size:13px;font-weight:700}
  .d .rselo{font-size:11px;font-weight:600}
  .d .rcnj{font-size:11.5px}
  .d .rmov{font-size:13px;color:var(--corpo)}
  .d .rprazo{font-size:11px;font-weight:600}
  .d .rtempo{font-size:11.5px;font-weight:600;color:var(--tinta)}
  .d .rtr{font-size:11px;color:var(--fraco)}

  .notas{margin-top:11px;display:flex;flex-direction:column;gap:5px}
  .nota{display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--corpo);line-height:1.35}
  .nota b{color:var(--tinta)}
  .pin{flex:0 0 auto;margin-top:1px;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:800;
       font-variant-numeric:tabular-nums}
  .pin.al{background:var(--alerta-bg);color:var(--alerta)}
  .pin.ok{background:var(--ok-bg);color:var(--ok)}
  .divisor{height:1px;background:var(--hairline);margin:14px 0}

  /* ── prova de largura ── */
  .larg{padding:12px 15px 14px}
  .lgh{display:grid;grid-template-columns:1fr 74px 74px 62px;gap:8px;padding:0 0 6px}
  .lgr{display:grid;grid-template-columns:1fr 74px 74px 62px;gap:8px;padding:6px 0;
       border-top:1px solid var(--hairline);align-items:center}
  .lgr .txt{font-size:13px;color:var(--corpo)}
  .lgr .n{font-size:13px;font-variant-numeric:tabular-nums;text-align:right;color:var(--mudo)}
  .lgr .dif{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;text-align:right}
  .lgr .dif.ok{color:var(--ok)} .lgr .dif.al{color:var(--alerta)}
  .rodape-larg{margin-top:10px;font-size:13px;color:var(--corpo);line-height:1.4}

  /* ── escala ── */
  .esc{padding:4px 0 6px;overflow:hidden}
  .er{display:grid;grid-template-columns:214px 66px 1fr;gap:10px;align-items:center;
      padding:8px 15px;border-bottom:1px solid var(--hairline)}
  .er:last-child{border-bottom:0}
  .am{color:var(--tinta);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .tok{display:flex;align-items:baseline;gap:5px}
  .tok .nm{font-size:13px;font-weight:700;color:var(--acento-forte)}
  .tok .px{font-size:11px;font-weight:600;color:var(--fraco);font-variant-numeric:tabular-nums}
  .uso{font-size:11.5px;color:var(--mudo);line-height:1.3}
  .uso i{font-style:normal;color:#9aa7b4}

  .d-micro{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fraco)}
  .d-apoio{font-size:11.5px;font-weight:500;color:var(--mudo)}
  .d-corpo{font-size:13px;font-weight:500;color:var(--corpo)}
  .d-secao{font-family:'Poppins';font-weight:700;font-size:15px}
  .d-numero{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
  .d-titulo{font-family:'Poppins';font-weight:700;font-size:20px}
  .d-pagina{font-family:'Poppins';font-weight:700;font-size:26px;letter-spacing:-.01em}

  /* ── fatias ── */
  .fat{padding:5px 0 7px}
  .fr{display:flex;gap:11px;padding:9px 15px;border-bottom:1px solid var(--hairline);align-items:flex-start}
  .fr:last-child{border-bottom:0}
  .fn{width:24px;height:24px;flex:0 0 24px;border-radius:7px;background:var(--hairline);color:var(--fraco);
      display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800}
  .fr.on .fn{background:var(--acento);color:#fff}
  .ft{font-size:13px;font-weight:700}
  .fr.on .ft{color:var(--acento-forte)}
  .fd{font-size:11.5px;color:var(--mudo);margin-top:2px;line-height:1.35}
  .selo-rec{margin-left:auto;flex:0 0 auto;background:var(--acento-bg);color:var(--acento-forte);
            border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700}

  /* ── números ── */
  .bom{padding:5px 0 7px}
  .br{display:flex;gap:10px;padding:8px 15px;border-bottom:1px solid var(--hairline);align-items:flex-start}
  .br:last-child{border-bottom:0}
  .bc{width:17px;height:17px;flex:0 0 17px;border-radius:50%;background:var(--ok-bg);color:var(--ok);
      display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;margin-top:1px}
  .bt{font-size:13px;font-weight:600;color:var(--corpo)}
  .bt b{color:var(--tinta)}
  .nums{margin-top:13px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;flex:0 0 auto}
  .nc{background:var(--surface);border:1px solid var(--borda);border-radius:12px;padding:12px 15px}
  .nc.al{background:var(--alerta-bg);border-color:var(--alerta-borda)}
  .nc .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
  .nc.al .v{color:var(--alerta)}
  .nc .l{margin-top:5px;font-size:11.5px;color:var(--mudo);line-height:1.3}
  .nc.al .l{color:#8a3a34}
</style>
</head>
<body>
<div class="wrap">
  <div>
    <div class="h1">Sistema visual — a tipografia</div>
    <div class="sub">A cor já é um sistema no JuridFlow (9.639 usos de token, zero cor solta). A tipografia não: são 33 tamanhos escritos à mão, e o que é crítico ficou no menor deles.</div>
  </div>

  <div class="grade">
    <div class="col">
      <div class="card">
        <div class="ct"><span class="ctt">A mesma linha da sua lista de Processos</span><span class="micro">ampliada 1,3×</span></div>
        <div class="lupa">
          <span class="tagv a">Antes · como está hoje</span>
          <div class="palco"><div class="zoom">${linha("a")}</div></div>
          <div class="notas">
            <div class="nota"><span class="pin al">9px</span><span><b>“2º grau?”</b> — avisa que o processo subiu para recurso.</span></div>
            <div class="nota"><span class="pin al">9px</span><span><b>“prazo vence hoje”</b> — o prazo do seu cliente, na menor letra da tela.</span></div>
            <div class="nota"><span class="pin al">6</span><span>tamanhos diferentes nesta <b>única linha</b>: 13 · 9 · 10,5 · 12 · 11,5 · 10px.</span></div>
          </div>
          <div class="divisor"></div>
          <span class="tagv d">Depois · a escala</span>
          <div class="palco"><div class="zoom">${linha("d")}</div></div>
          <div class="notas">
            <div class="nota"><span class="pin ok">3</span><span>tamanhos na mesma linha: <b>13 · 11,5 · 11px</b>. Nada abaixo de 11.</span></div>
            <div class="nota"><span class="pin ok">✓</span><span>A hierarquia passa a vir de <b>peso e cor</b>, não de inventar mais um tamanho.</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="ct"><span class="ctt">Subir para 11px quase não custa largura</span><span class="micro">medido no navegador</span></div>
        <div class="larg">
          <div class="lgh"><span class="micro">selo</span><span class="micro" style="text-align:right">9px caixa alta</span><span class="micro" style="text-align:right">11px normal</span><span class="micro" style="text-align:right">diferença</span></div>
          ${larguras.map(([t, a, d, dif]) => `
          <div class="lgr"><span class="txt">${t}</span><span class="n">${a}px</span><span class="n">${d}px</span><span class="dif ${dif.startsWith("+") ? "al" : "ok"}">${dif}px</span></div>`).join("")}
          <div class="rodape-larg">Maiúscula é mais larga que minúscula: trocar <b>PRAZO VENCE HOJE</b> por <b>prazo vence hoje</b> economiza 5,7px mesmo subindo a fonte. A exceção são siglas que já nascem em maiúscula — <b>TJCE</b> cresce 3,4px, porque não tem minúscula a ganhar.</div>
        </div>
      </div>
    </div>

    <div class="col">
      <div class="card">
        <div class="ct"><span class="ctt">A escala — 7 degraus no lugar de 33</span><span class="micro">amostra em tamanho real</span></div>
        <div class="esc">
          ${degraus.map(([nome, px, peso, uso, absorve, cls]) => `
          <div class="er">
            <span class="am ${cls}">${amostra[cls]}</span>
            <span class="tok"><span class="nm">${nome}</span><span class="px">${px}</span></span>
            <span class="uso">${uso}<br><i>absorve ${absorve}</i></span>
          </div>`).join("")}
        </div>
      </div>

      <div class="card">
        <div class="ct"><span class="ctt">O que já está bom — não vou mexer</span><span class="micro">achado do estudo</span></div>
        <div class="bom">
          <div class="br"><span class="bc">✓</span><span class="bt"><b>A cor já é um sistema.</b> 9.639 usos de token, <b>zero</b> cor solta — light e escuro.</span></div>
          <div class="br"><span class="bc">✓</span><span class="bt"><b>O menu está certo.</b> 4 grupos, 16 itens, cada um só para quem contratou o módulo.</span></div>
          <div class="br"><span class="bc">✓</span><span class="bt"><b>A cor de status.</b> Verde “em dia”, âmbar “novidade”, vermelho só o que exige ação hoje.</span></div>
        </div>
      </div>

      <div class="card">
        <div class="ct"><span class="ctt">O plano, em 4 fatias</span><span class="micro">pare em qualquer uma</span></div>
        <div class="fat">
          ${fatias.map(([n, t, d, on]) => `
          <div class="fr ${on}">
            <span class="fn">${n}</span>
            <span><span class="ft">${t}</span><div class="fd">${d}</div></span>
            ${on ? '<span class="selo-rec">começar aqui</span>' : ""}
          </div>`).join("")}
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

writeFileSync(`${RAIZ}/mockup-tipografia-escala.html`, html);
console.log("ok: escala gerada");
