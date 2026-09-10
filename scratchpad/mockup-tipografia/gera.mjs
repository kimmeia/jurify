// Gera mockup-tipografia-antes.html e -depois.html a partir de UM corpo comum.
// A única diferença entre os dois arquivos é o bloco de tipografia: mesmo
// conteúdo, mesma grade, mesmas cores. É o que torna a comparação honesta.
import { readFileSync, writeFileSync } from "node:fs";

const FONTES = readFileSync(process.argv[2], "utf8");
const RAIZ = process.argv[3];

/* ── tokens reais de produção (OKLCH do index.css → hex) ── */
const TOKENS = `
  --bg:#f4f6f8; --surface:#fff; --borda:#dfe4ea; --hairline:#eef1f4;
  --tinta:#16202c; --corpo:#33404f; --mudo:#5a6b7d; --fraco:#6d7d8c; --fantasma:#aab6c2;
  --acento:#194b86; --acento-forte:#11325c; --acento-bg:#eaf1f8;
  --ok:#097245; --ok-bg:#e9f6ef;
  --aviso:#8a5a0b; --aviso-bg:#fdf6e7;
  --alerta:#a8231b; --alerta-bg:#fdf0ef;
  --menu:#16202c; --menu-txt:#c4ced8; --menu-on:#24384f; --menu-acento:#6fa5dd;
  --marca:#7f22fe;
`;

/* ── ANTES: os tamanhos exatos que estão no código hoje ──
   Processos.tsx:2285 (27px) · :2286 (13.5px) · :1283 (13px) · :1287 e :1293 (9px)
   :1301 (10.5px) · :1312-1330 (12px) · :1340,1348 (11.5px) · :1344,1355 (10px)
   :1520-1526 (9px, pílulas de prazo) · :329-330 (9px, tribunal/instância)      */
const ANTES = `
  .t-pagina  { font-family:'Poppins'; font-weight:700; font-size:27px;   letter-spacing:-.01em; line-height:1; }
  .t-sub     { font-size:13.5px; color:var(--mudo); }
  .t-past-n  { font-size:15px;   font-weight:700; font-variant-numeric:tabular-nums; }
  .t-past-r  { font-size:11.5px; color:var(--mudo); }
  .t-aba     { font-size:12px;   font-weight:600; }
  .t-ctrl    { font-size:13px;   font-weight:500; color:var(--corpo); }
  .t-secao   { font-family:'Poppins'; font-weight:700; font-size:16px; }
  .t-nome    { font-size:13px;   font-weight:700; }
  .t-selo    { font-size:9px;    font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
  .t-cnj     { font-size:10.5px; font-family:ui-monospace,'SFMono-Regular',Menlo,monospace; color:var(--mudo); }
  .t-mov     { font-size:12px;   color:var(--mudo); }
  .t-mov.al  { color:var(--alerta); }
  .t-tempo   { font-size:11.5px; font-weight:600; color:#4a5a6b; }
  .t-tempo-r { font-size:10px;   color:var(--mudo); }
  .t-prazo   { font-size:9px;    font-weight:600; }
  .t-micro   { font-size:10px;   font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--fraco); }
  .t-rodape  { font-size:12.5px; color:#475569; }
  .t-menu    { font-size:13px;   font-weight:500; }
  .t-menu-g  { font-size:9.5px;  font-weight:700; text-transform:uppercase; letter-spacing:.07em; }
`;

/* ── DEPOIS: 7 degraus, piso de 11px ──
   micro 11 · apoio 11,5 · corpo 13 · secao 15 · titulo 20 · numero 22 · pagina 26
   A hierarquia passa a vir de PESO e COR, não de mais um tamanho novo.        */
const DEPOIS = `
  .t-pagina  { font-family:'Poppins'; font-weight:700; font-size:26px;   letter-spacing:-.01em; line-height:1; }
  .t-sub     { font-size:13px;   color:var(--mudo); }
  .t-past-n  { font-size:15px;   font-weight:700; font-variant-numeric:tabular-nums; }
  .t-past-r  { font-size:11.5px; color:var(--mudo); }
  .t-aba     { font-size:13px;   font-weight:600; }
  .t-ctrl    { font-size:13px;   font-weight:500; color:var(--corpo); }
  .t-secao   { font-family:'Poppins'; font-weight:700; font-size:15px; }
  .t-nome    { font-size:13px;   font-weight:700; }
  .t-selo    { font-size:11px;   font-weight:600; }
  .t-cnj     { font-size:11.5px; font-family:ui-monospace,'SFMono-Regular',Menlo,monospace; color:var(--mudo); }
  .t-mov     { font-size:13px;   color:var(--corpo); }
  .t-mov.al  { color:var(--alerta); font-weight:500; }
  .t-tempo   { font-size:11.5px; font-weight:600; color:var(--tinta); }
  .t-tempo-r { font-size:11px;   color:var(--fraco); }
  .t-prazo   { font-size:11px;   font-weight:600; }
  .t-micro   { font-size:11px;   font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--fraco); }
  .t-rodape  { font-size:13px;   color:var(--corpo); }
  .t-menu    { font-size:13px;   font-weight:500; }
  .t-menu-g  { font-size:11px;   font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
`;

const BASE = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1600px; height:1050px; overflow:hidden; }
  body { font-family:'Inter',sans-serif; background:var(--bg); color:var(--tinta); display:flex; }

  /* ── menu lateral (escuro nos dois temas, como em produção) ── */
  .menu { width:230px; flex:0 0 230px; background:var(--menu); color:var(--menu-txt);
          padding:16px 0 0; display:flex; flex-direction:column; }
  .logo { display:flex; align-items:center; gap:9px; padding:0 16px 16px; }
  .logo .j { width:29px; height:29px; border-radius:8px; background:var(--marca); color:#fff;
             font-family:'Poppins'; font-weight:800; font-size:16px;
             display:flex; align-items:center; justify-content:center; }
  .logo .n { font-family:'Poppins'; font-weight:700; font-size:15px; color:#fff; }
  .grupo { padding:0 8px; margin-bottom:9px; }
  .grupo > .t-menu-g { color:#7d8b99; padding:7px 8px 4px; }
  .mi { display:flex; align-items:center; gap:10px; padding:7px 9px; border-radius:7px; }
  .mi.on { background:var(--menu-on); color:#fff; }
  .mi .ic { width:16px; height:16px; flex:0 0 16px; opacity:.85; }
  .mi.on .ic { opacity:1; }
  .mi .bd { margin-left:auto; background:var(--aviso); color:#fff; border-radius:20px;
            padding:1px 6px; font-size:10px; font-weight:700; }
  .mi .bd.al { background:var(--alerta); }

  /* ── palco ── */
  .wrap { flex:1; padding:24px 28px; display:flex; flex-direction:column; min-width:0; }
  .topo { display:flex; align-items:flex-start; justify-content:space-between; flex:0 0 auto; }
  .past { display:flex; gap:8px; margin-top:11px; }
  .pastilha { border:1px solid var(--borda); background:var(--surface); border-radius:10px;
              padding:5px 11px; display:flex; align-items:baseline; gap:6px; }
  .pastilha.al { background:var(--alerta-bg); border-color:#f0c5c1; }
  .pastilha.al .t-past-n, .pastilha.al .t-past-r { color:var(--alerta); }
  .acoes { display:flex; align-items:center; gap:8px; flex:0 0 auto; }
  .cred { display:inline-flex; align-items:center; gap:7px; border:1px solid var(--borda);
          background:var(--surface); border-radius:10px; padding:7px 11px; }
  .btn { border:1px solid var(--borda); background:var(--surface); border-radius:9px;
         padding:8px 13px; display:flex; align-items:center; gap:7px; }
  .btn-p { background:var(--acento); color:#fff; border-color:var(--acento); font-weight:600;
           box-shadow:0 8px 18px -9px #194b8699; }

  /* ── abas ── */
  .abas { display:flex; gap:3px; background:var(--hairline); padding:3px; border-radius:9px;
          margin-top:16px; align-self:flex-start; flex:0 0 auto; }
  .abas span { padding:6px 14px; border-radius:7px; color:var(--mudo); display:flex; align-items:center; gap:7px; }
  .abas span.on { background:var(--surface); color:var(--tinta); box-shadow:0 1px 3px #0f172a1a; }
  .abas .cnt { background:var(--aviso); color:#fff; border-radius:20px; padding:0 5px; font-size:10px; font-weight:700; }

  /* ── barra de filtro ── */
  .filtros { margin-top:12px; background:var(--surface); border:1px solid var(--borda);
             border-radius:12px; padding:11px 13px; display:flex; align-items:center; gap:9px; flex:0 0 auto; }
  .busca { position:relative; flex:1; max-width:380px; }
  .busca input { width:100%; height:36px; border:1px solid var(--borda); border-radius:9px;
                 padding:0 12px 0 34px; font-family:'Inter'; font-size:13px; color:var(--tinta); outline:none; }
  .busca input::placeholder { color:var(--fraco); }
  .busca svg { position:absolute; left:11px; top:50%; transform:translateY(-50%); }
  .sel { height:36px; border:1px solid var(--borda); border-radius:9px; padding:0 11px;
         display:flex; align-items:center; gap:8px; }

  /* ── lista ── */
  .lista { margin-top:12px; background:var(--surface); border:1px solid var(--borda);
           border-radius:12px; flex:1; display:flex; flex-direction:column; overflow:hidden; }
  .lista-topo { padding:10px 15px; border-bottom:1px solid var(--hairline);
                display:flex; align-items:center; justify-content:space-between; flex:0 0 auto; }
  .linha { display:flex; align-items:center; gap:12px; padding:11px 15px;
           border-bottom:1px solid var(--hairline); flex:0 0 auto; }
  .linha:last-child { border-bottom:0; }
  .av { width:36px; height:36px; border-radius:10px; flex:0 0 36px;
        display:flex; align-items:center; justify-content:center; background:var(--acento-bg); }
  .av.al { background:var(--alerta-bg); }
  .av.pz { background:var(--hairline); }
  .meio { flex:1; min-width:0; }
  .l1 { display:flex; align-items:center; gap:7px; min-width:0; }
  .l1 .t-nome { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ponto { width:8px; height:8px; border-radius:50%; flex:0 0 8px; }
  .selo { border-radius:5px; padding:2px 6px; flex:0 0 auto; white-space:nowrap; }
  .selo.mudo { background:var(--hairline); color:var(--fraco); }
  .selo.aviso { background:var(--aviso-bg); color:var(--aviso); }
  .l2 { margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .l3 { margin-top:5px; display:flex; align-items:center; gap:7px; min-width:0; }
  .l3 .t-mov { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .prazo { border-radius:20px; padding:2px 9px; flex:0 0 auto; white-space:nowrap;
           display:inline-flex; align-items:center; gap:5px; }
  .prazo.ok { background:var(--ok-bg); color:var(--ok); }
  .prazo.al { background:var(--alerta-bg); color:var(--alerta); }
  .dir { flex:0 0 auto; text-align:right; min-width:82px; }
  .dir .t-tempo-r { margin-top:1px; }
  .kebab { width:28px; height:28px; border-radius:7px; flex:0 0 28px;
           display:flex; align-items:center; justify-content:center; color:var(--fraco); }

  /* ── rodapé ── */
  .rodape { margin-top:11px; background:var(--surface); border:1px solid var(--borda);
            border-radius:11px; padding:10px 15px; display:flex; align-items:center; gap:12px; flex:0 0 auto; }
  .rodape b { color:var(--tinta); }
  .selo-canto { margin-left:auto; border-radius:20px; padding:3px 11px; font-size:11px; font-weight:700; }

  /* ── faixa de identificação do mockup (fora do produto) ── */
  .faixa { position:fixed; top:0; left:230px; right:0; height:26px; display:flex; align-items:center;
           justify-content:center; gap:9px; font-size:11px; font-weight:700; letter-spacing:.06em;
           text-transform:uppercase; z-index:9; }
  .faixa.a { background:#fdf0ef; color:#a8231b; border-bottom:1px solid #f0c5c1; }
  .faixa.d { background:#e9f6ef; color:#097245; border-bottom:1px solid #bfe3d1; }
  .wrap { padding-top:38px; }
`;

const ico = {
  lupa: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#6d7d8c" stroke-width="2"/><path d="m20 20-3.2-3.2" stroke="#6d7d8c" stroke-width="2" stroke-linecap="round"/></svg>`,
  balanca: (c) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M7 21h10M5 7h14M8 7l-3 6h6L8 7Zm8 0-3 6h6l-3-6Z" stroke="${c}" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
  moeda: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#8a5a0b" stroke-width="1.8"/><path d="M12 7.5v9M9.8 10a2.2 2.2 0 0 1 2.2-1.6c1.2 0 2.2.8 2.2 1.8 0 2.4-4.4 1.2-4.4 3.6 0 1 1 1.8 2.2 1.8a2.2 2.2 0 0 0 2.2-1.6" stroke="#8a5a0b" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  kebab: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.7" fill="#6d7d8c"/><circle cx="12" cy="12" r="1.7" fill="#6d7d8c"/><circle cx="19" cy="12" r="1.7" fill="#6d7d8c"/></svg>`,
  chev: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="#6d7d8c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  relogio: (c) => `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="${c}" stroke-width="2.2"/><path d="M12 7v5.4l3.4 2" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  mais: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  mail: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2.5" stroke="#33404f" stroke-width="1.8"/><path d="m4 7 8 5.5L20 7" stroke="#33404f" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};
const mIco = (d) => `<svg class="ic" viewBox="0 0 24 24" fill="none"><path d="${d}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const MENU = `
<div class="menu">
  <div class="logo"><div class="j">J</div><div class="n">JuridFlow</div></div>
  <div class="grupo">
    <div class="t-menu-g">Dia a dia</div>
    <div class="mi"><span class="t-menu">${mIco("M8 2v3M16 2v3M3.5 9h17M4.5 5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z")}</span><span class="t-menu">Agenda</span><span class="bd">4</span></div>
    <div class="mi">${mIco("M4 12a8 8 0 0 1 16 0M4 12v4a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2Zm16 0v4a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2Z")}<span class="t-menu">Atendimento</span><span class="bd">7</span></div>
  </div>
  <div class="grupo">
    <div class="t-menu-g">Carteira</div>
    <div class="mi">${mIco("M16 20v-2a4 4 0 0 0-8 0v2M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z")}<span class="t-menu">Clientes</span></div>
    <div class="mi on">${mIco("M14 3H7a1.6 1.6 0 0 0-1.6 1.6v14.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V8L14 3Zm0 0v5h4.6M9 13h6M9 17h4")}<span class="t-menu">Processos</span><span class="bd">2</span></div>
    <div class="mi">${mIco("M7 10h3l2 3 2-6 2 3h3M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z")}<span class="t-menu">Acordos</span></div>
    <div class="mi">${mIco("M4 4h6v7H4V4Zm10 0h6v11h-6V4ZM4 15h6v5H4v-5Zm10 4h6v1h-6v-1Z")}<span class="t-menu">Kanban</span></div>
  </div>
  <div class="grupo">
    <div class="t-menu-g">Ferramentas</div>
    <div class="mi">${mIco("M9 3v18M4.5 3h15a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-15A1.5 1.5 0 0 1 4.5 3Zm8.5 6h-4m4 4h-4m4 4h-4")}<span class="t-menu">Cálculos</span></div>
    <div class="mi">${mIco("M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z")}<span class="t-menu">Automações</span></div>
  </div>
  <div class="grupo">
    <div class="t-menu-g">Gestão</div>
    <div class="mi">${mIco("M12 2v20M17 5.5H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6")}<span class="t-menu">Financeiro</span></div>
    <div class="mi">${mIco("M4 20V10m5 10V4m5 16v-7m5 7V8")}<span class="t-menu">Relatórios</span></div>
  </div>
</div>`;

/* ── as 8 linhas. Dados coerentes: 8 monitorados, 1 parado, 3 prazos abertos. ── */
const linha = (r) => `
<div class="linha">
  <div class="av ${r.av || ""}">${ico.balanca(r.avc || "#194b86")}</div>
  <div class="meio">
    <div class="l1">
      <span class="ponto" style="background:${r.dot}"></span>
      <span class="t-nome">${r.nome}</span>
      ${r.selos.map((s) => `<span class="selo ${s.t} t-selo">${s.txt}</span>`).join("")}
    </div>
    <div class="l2 t-cnj">${r.cnj}</div>
    <div class="l3">
      <span class="t-mov${r.movAl ? " al" : ""}">${r.mov}</span>
      ${r.prazo ? `<span class="prazo ${r.prazo.t} t-prazo">${ico.relogio(r.prazo.t === "al" ? "#a8231b" : "#097245")}${r.prazo.txt}</span>` : ""}
    </div>
  </div>
  <div class="dir">
    <div class="t-tempo">${r.tempo}</div>
    <div class="t-tempo-r">${r.tempoR}</div>
  </div>
  <div class="kebab">${ico.kebab}</div>
</div>`;

const LINHAS = [
  {
    nome: "Maria Aparecida Nogueira de Sousa", dot: "#097245",
    selos: [{ t: "aviso", txt: "2º grau?" }],
    cnj: "0812345-67.2024.8.06.0001 · TJCE",
    mov: "Juntada de petição — recurso inominado da parte autora",
    tempo: "há 2 horas", tempoR: "última mov.",
  },
  {
    nome: "Construtora Vale Verde Ltda", dot: "#097245", selos: [],
    cnj: "0034521-89.2023.8.06.0170 · TJCE",
    mov: "Despacho: cite-se a parte requerida",
    prazo: { t: "ok", txt: "prazo em 5 dias" },
    tempo: "há 1 dia", tempoR: "última mov.",
  },
  {
    nome: "Francisco Edilson Martins Rocha", dot: "#a8231b", av: "al", avc: "#a8231b", selos: [],
    cnj: "1004567-22.2025.4.01.3100 · TRF1",
    mov: "Login falhou no tribunal — senha do Cofre recusada", movAl: true,
    tempo: "há 12 dias", tempoR: "parado",
  },
  {
    nome: "Antônia Gomes Vasconcelos", dot: "#aab6c2", av: "pz", avc: "#6d7d8c",
    selos: [{ t: "mudo", txt: "Pausado" }],
    cnj: "0700891-45.2024.8.06.0064 · TJCE",
    mov: "Sem movimentação registrada ainda",
    tempo: "—", tempoR: "última mov.",
  },
  {
    nome: "José Ribamar da Silva Filho", dot: "#8a5a0b", selos: [],
    cnj: "0056789-12.2024.8.06.0001 · TJCE",
    mov: "Sentença publicada — procedente em parte",
    prazo: { t: "al", txt: "prazo vence hoje" },
    tempo: "há 3 dias", tempoR: "última mov.",
  },
  {
    nome: "Laticínios Serra Azul S/A", dot: "#097245",
    selos: [{ t: "aviso", txt: "2º grau?" }],
    cnj: "0091234-56.2023.8.06.0001 · TJCE",
    mov: "Conclusos para julgamento — 3ª Câmara de Direito Privado",
    tempo: "há 6 dias", tempoR: "última mov.",
  },
  {
    nome: "Raimundo Nonato de Alencar", dot: "#097245", selos: [],
    cnj: "0067432-18.2024.8.06.0112 · TJCE",
    mov: "Audiência de conciliação designada para 24/09",
    prazo: { t: "ok", txt: "prazo em 11 dias" },
    tempo: "há 8 dias", tempoR: "última mov.",
  },
  {
    nome: "Comércio de Peças Ipiranga ME", dot: "#097245", selos: [],
    cnj: "0812999-03.2025.8.06.0001 · TJCE",
    mov: "Certidão de decurso de prazo da parte requerida",
    tempo: "há 9 dias", tempoR: "última mov.",
  },
];

const CORPO = `
${MENU}
<div class="wrap">
  <div class="topo">
    <div>
      <div class="t-pagina">Processos</div>
      <div class="t-sub" style="margin-top:5px">O robô entra nos tribunais todo dia e avisa o que mudou nos seus processos</div>
      <div class="past">
        <div class="pastilha"><span class="t-past-n">8</span><span class="t-past-r">monitorados</span></div>
        <div class="pastilha al"><span class="t-past-n">1</span><span class="t-past-r">parado</span></div>
        <div class="pastilha"><span class="t-past-n">2</span><span class="t-past-r">novas ações</span></div>
      </div>
    </div>
    <div class="acoes">
      <div class="cred">${ico.moeda}<span class="t-past-n">248</span><span class="t-past-r">créditos</span></div>
      <div class="btn"><span class="t-ctrl">Resumo diário</span></div>
      <div class="btn btn-p">${ico.mais}<span class="t-ctrl" style="color:#fff;font-weight:600">Monitorar processo</span></div>
    </div>
  </div>

  <div class="abas t-aba">
    <span class="on">Monitorados</span>
    <span>Novas ações <i class="cnt" style="font-style:normal">2</i></span>
    <span>Movimentações</span>
    <span>Cofre de senhas</span>
  </div>

  <div class="filtros">
    <div class="busca">${ico.lupa}<input value="" placeholder="Buscar por nome, CNJ ou CPF do cliente"></div>
    <div class="sel"><span class="t-ctrl">Todos os tribunais</span>${ico.chev}</div>
    <div class="sel"><span class="t-ctrl">Qualquer situação</span>${ico.chev}</div>
    <div class="sel" style="border-color:#194b86;background:#eaf1f8"><span class="t-ctrl" style="color:#11325c;font-weight:600">Com prazo aberto</span>${ico.chev}</div>
  </div>

  <div class="lista">
    <div class="lista-topo">
      <span class="t-micro">8 processos vigiados</span>
      <span class="t-micro">última varredura hoje às 06:12</span>
    </div>
    ${LINHAS.map(linha).join("")}
  </div>

  <div class="rodape">
    <span class="t-rodape"><b>3</b> processos com prazo aberto · <b>1</b> credencial precisa de atenção</span>
    <span class="selo-canto" style="background:#fdf0ef;color:#a8231b">1 prazo vence hoje</span>
  </div>
</div>`;

function monta(qual) {
  const tipo = qual === "antes" ? ANTES : DEPOIS;
  const faixa =
    qual === "antes"
      ? `<div class="faixa a">Antes — como está hoje no sistema</div>`
      : `<div class="faixa d">Depois — escala de 7 degraus, nada abaixo de 11px</div>`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>JuridFlow · Processos · ${qual}</title>
${FONTES}
<style>
  :root {${TOKENS}}
${BASE}
${tipo}
</style>
</head>
<body>
${faixa}
${CORPO}
</body>
</html>`;
}

writeFileSync(`${RAIZ}/mockup-tipografia-antes.html`, monta("antes"));
writeFileSync(`${RAIZ}/mockup-tipografia-depois.html`, monta("depois"));
console.log("ok: antes + depois gerados");
