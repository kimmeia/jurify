/**
 * As telas REDESENHADAS — lado "depois" do navegável.
 *
 * ESTA VERSÃO NASCEU DE UMA CORREÇÃO DE ROTA. As duas anteriores foram
 * reprovadas ("nenhuma diferença a não ser algumas cores" e depois "ridículo"),
 * e o motivo estava no lugar mais óbvio: o dono tinha mandado um print do
 * painel que ele queria — escuro, RICO, com cartão arredondado, elevação,
 * gráfico, mapa de calor e avatares — e eu respondi com tipografia seca, fio de
 * 1px, sem cartão e sem gráfico. Impus a minha tese de "menos é mais" por cima
 * da referência que ele escolheu.
 *
 * Aqui a linguagem é a DO PRINT DELE:
 *  · painel elevado sobre fundo escuro, canto de 14px, borda clara de 8%;
 *  · cartões de número com variação e minigráfico;
 *  · mapa de calor de movimentações por dia da semana × hora;
 *  · avatares, barras de progresso, gráfico de área;
 *  · cor usada de propósito: violeta da marca, salmão no calor e no atraso,
 *    verde só em dinheiro que entrou.
 * O conteúdo continua real (banco local e telas fotografadas).
 */

export const CSS = `
/* O container é o INVÓLUCRO, nunca a própria .tela: um elemento não responde
 * à sua própria container query. */
.palco-conteudo{container-type:inline-size}
.tela{
  --fundo:#0b0b10; --painel:#15151d; --painel2:#1d1d27; --painel3:#242430;
  --fio:rgba(255,255,255,.08); --fio2:rgba(255,255,255,.14);
  --texto:#f2f1f6; --texto2:#a6a3b5; --texto3:#6e6b80;
  --marca:#9a73ff; --marca2:#c4aaff; --quente:#f9765f; --quente2:#ffb199;
  --verde:#4ed39a; --azul:#6ba8ff; --ambar:#f5c162;
  --r:14px;
  background:var(--fundo); color:var(--texto); min-height:100%;
  font:400 13.5px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  font-variant-numeric:tabular-nums; -webkit-font-smoothing:antialiased;
  display:grid; grid-template-columns:220px minmax(0,1fr);
}
.tela *{box-sizing:border-box;margin:0;padding:0}

/* ── menu ─────────────────────────────────────────────────────────────── */
.tela .menu{background:var(--fundo);padding:18px 12px 14px;display:flex;flex-direction:column;gap:2px}
.tela .marca{display:flex;align-items:center;gap:9px;padding:2px 10px 18px;font-size:16px;
             font-weight:700;letter-spacing:-.02em}
.tela .marca i{font-family:Poppins,Inter,sans-serif;font-style:normal;font-size:20px}
.tela .marca u{text-decoration:none;color:var(--marca)}
.tela .g{padding:14px 10px 5px;font-size:9.5px;font-weight:700;letter-spacing:.15em;
         text-transform:uppercase;color:var(--texto3)}
.tela .i{display:flex;align-items:center;gap:10px;padding:8px 10px;color:var(--texto2);font-size:13px;
         border-radius:9px}
.tela .i .ic{width:15px;height:15px;flex:none;border-radius:4px;background:currentColor;opacity:.45}
.tela .i.on{color:#fff;background:var(--painel2)}
.tela .i.on .ic{opacity:1;background:var(--marca)}
.tela .i b{margin-left:auto;font-size:10px;font-weight:700;min-width:18px;height:18px;border-radius:6px;
           display:grid;place-items:center;background:var(--painel2);color:var(--texto2)}
.tela .i b.al{background:rgba(249,118,95,.18);color:var(--quente)}
.tela .pe{margin-top:auto;display:flex;align-items:center;gap:9px;padding:10px;border-radius:10px;
          background:var(--painel)}
.tela .pe .av{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-size:11px;
              font-weight:700;background:var(--marca);color:#100d1c}
.tela .pe span{font-size:12px;line-height:1.3;min-width:0}
.tela .pe span em{display:block;font-style:normal;color:var(--texto3);font-size:11px}

/* ── área ─────────────────────────────────────────────────────────────── */
.tela .conteudo{min-width:0;display:flex;flex-direction:column;background:#0e0e14;
                border-left:1px solid var(--fio);overflow:auto}
.tela .topo{display:flex;align-items:center;gap:14px;padding:16px 22px 0}
.tela .topo h2{font-size:19px;font-weight:650;letter-spacing:-.02em}
.tela .topo .dt{font-size:12.5px;color:var(--texto3)}
.tela .busca{margin-left:auto;display:flex;align-items:center;gap:8px;background:var(--painel);
             border:1px solid var(--fio);border-radius:10px;padding:6px 11px;font-size:12.5px;
             color:var(--texto3);min-width:180px}
.tela .tec{margin-left:auto;border:1px solid var(--fio2);border-radius:5px;padding:0 5px;font-size:10.5px}
.tela .btp{background:var(--marca);color:#120d20;font-weight:650;font-size:12.5px;border-radius:10px;
           padding:8px 14px}

.tela .grade{display:grid;gap:14px;padding:16px 22px 22px}
.tela .g4{grid-template-columns:repeat(4,minmax(0,1fr))}
.tela .g2{grid-template-columns:minmax(0,1.55fr) minmax(0,1fr)}

/* ── cartão ───────────────────────────────────────────────────────────── */
.tela .c{background:var(--painel);border:1px solid var(--fio);border-radius:var(--r);padding:15px 16px;
         box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 10px 24px rgba(0,0,0,.35);min-width:0}
.tela .c.sem{padding:0;overflow:hidden}
.tela .ct{display:flex;align-items:center;gap:9px;margin-bottom:12px}
.tela .ct h3{font-size:13px;font-weight:600;letter-spacing:-.01em}
.tela .ct .mais{margin-left:auto;font-size:11.5px;color:var(--texto3)}

/* cartão de número */
.tela .kpi .rot{font-size:11px;color:var(--texto3);letter-spacing:.03em;display:flex;align-items:center;gap:7px}
.tela .kpi .pt{width:7px;height:7px;border-radius:50%;background:var(--marca)}
.tela .kpi .pt.q{background:var(--quente)} .tela .kpi .pt.v{background:var(--verde)}
.tela .kpi .pt.a{background:var(--ambar)}
.tela .kpi .n{font-size:29px;font-weight:700;letter-spacing:-.035em;margin:9px 0 3px;line-height:1}
.tela .kpi .n.q{color:var(--quente)} .tela .kpi .n.v{color:var(--verde)}
.tela .kpi .sb{font-size:11.5px;color:var(--texto3)}
.tela .kpi .sb b{color:var(--verde);font-weight:600}
.tela .kpi .sb b.d{color:var(--quente)}
.tela .spark{display:flex;align-items:flex-end;gap:3px;height:26px;margin-top:11px}
.tela .spark i{flex:1;background:var(--painel3);border-radius:2px}
.tela .spark i.on{background:var(--marca)}
.tela .spark i.q{background:var(--quente)}

/* ── mapa de calor ────────────────────────────────────────────────────── */
.tela .calor{display:grid;grid-template-columns:30px repeat(12,minmax(0,1fr));gap:4px;align-items:center}
.tela .calor .hh{font-size:9.5px;color:var(--texto3);text-align:right;padding-right:3px}
.tela .calor u{display:block;aspect-ratio:1;border-radius:4px;background:var(--painel2)}
.tela .calor u.n1{background:rgba(249,118,95,.18)} .tela .calor u.n2{background:rgba(249,118,95,.34)}
.tela .calor u.n3{background:rgba(249,118,95,.56)} .tela .calor u.n4{background:rgba(249,118,95,.82)}
.tela .calor .dd{font-size:9.5px;color:var(--texto3);text-align:center}
.tela .legenda{display:flex;align-items:center;gap:6px;margin-top:11px;font-size:10.5px;color:var(--texto3)}
.tela .legenda u{width:13px;height:13px;border-radius:4px;display:block;background:var(--painel2)}

/* ── linha de prazo (barra) ───────────────────────────────────────────── */
.tela .prz{display:grid;grid-template-columns:minmax(0,1fr) 62px;gap:0 12px;align-items:center;
           padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}
.tela .prz:first-of-type{border-top:0;padding-top:0}
.tela .prz>span{display:block;min-width:0}
.tela .prz .t,.tela .prz .s,.tela .prz .barra{display:block}
.tela .prz .t{font-size:13px;font-weight:500}
.tela .prz .s{font-size:11.5px;color:var(--texto3);margin-top:2px}
.tela .prz .barra{height:5px;border-radius:99px;background:var(--painel3);margin-top:7px;overflow:hidden}
.tela .prz .barra i{display:block;height:100%;border-radius:99px;background:var(--marca)}
.tela .prz .barra i.q{background:var(--quente)}
.tela .prz .barra i.a{background:var(--ambar)}
.tela .prz .dias{text-align:right}
.tela .prz .dias b{display:block;font-size:20px;font-weight:700;letter-spacing:-.03em;line-height:1}
.tela .prz .dias b.q{color:var(--quente)} .tela .prz .dias b.a{color:var(--ambar)}
.tela .prz .dias em{font-style:normal;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;
                    color:var(--texto3)}

/* ── lista de movimentação ────────────────────────────────────────────── */
.tela .mv{display:flex;gap:11px;padding:10px 0;border-top:1px solid rgba(255,255,255,.05)}
.tela .mv:first-of-type{border-top:0;padding-top:0}
.tela .mv .tag{flex:none;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
               padding:3px 8px;border-radius:7px;background:rgba(107,168,255,.14);color:var(--azul);
               height:fit-content}
.tela .mv .tag.ag{background:rgba(154,115,255,.16);color:var(--marca2)}
.tela .mv .tag.cl{background:rgba(78,211,154,.14);color:var(--verde)}
.tela .mv .co{min-width:0}
.tela .mv .co b{display:block;font-size:13px;font-weight:500;line-height:1.35}
.tela .mv .co span{display:block;font-size:11.5px;color:var(--texto3);margin-top:2px}
.tela .mv .hr{margin-left:auto;font-size:11px;color:var(--texto3);flex:none}

/* ── pessoas ──────────────────────────────────────────────────────────── */
.tela .ps{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}
.tela .ps:first-of-type{border-top:0;padding-top:0}
.tela .ps .av{width:30px;height:30px;flex:none;border-radius:10px;display:grid;place-items:center;
              font-size:11px;font-weight:700;color:#120d20}
.tela .ps .co{min-width:0}
.tela .ps .co b{display:block;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;
                text-overflow:ellipsis}
.tela .ps .co span{display:block;font-size:11.5px;color:var(--texto3);white-space:nowrap;overflow:hidden;
                   text-overflow:ellipsis}
.tela .ps .tm{margin-left:auto;flex:none;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:8px;
              background:var(--painel2);color:var(--texto2)}
.tela .ps .tm.al{background:rgba(249,118,95,.16);color:var(--quente)}

/* ── gráfico de área ──────────────────────────────────────────────────── */
.tela .graf{position:relative;height:132px;margin-top:6px}
.tela .graf svg{width:100%;height:100%;display:block;overflow:visible}
.tela .eixo{display:flex;justify-content:space-between;font-size:10px;color:var(--texto3);margin-top:8px}

/* ── agenda em coluna de hora ─────────────────────────────────────────── */
.tela .ag{display:grid;grid-template-columns:46px minmax(0,1fr);gap:0 12px;padding:8px 0;
          border-top:1px solid rgba(255,255,255,.05);align-items:start}
.tela .ag:first-of-type{border-top:0;padding-top:0}
.tela .ag .h{font-size:11.5px;color:var(--texto3);padding-top:2px}
.tela .ag .co b{display:block;font-size:13px;font-weight:500}
.tela .ag .co span{display:block;font-size:11.5px;color:var(--texto3);margin-top:1px}
.tela .ag.ja{opacity:.45}
.tela .ag .pino{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--marca);
                margin-right:7px;vertical-align:2px}
.tela .ag .pino.q{background:var(--quente)}

/* ── tabela ───────────────────────────────────────────────────────────── */
.tela .tb{width:100%;border-collapse:collapse}
.tela .tb th{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
             color:var(--texto3);text-align:left;padding:0 0 10px}
.tela .tb th:nth-child(n+2),.tela .tb td:nth-child(n+2){text-align:right}
.tela .tb td{padding:10px 0;border-top:1px solid rgba(255,255,255,.05);font-size:13px}
.tela .tb td .cl{display:flex;align-items:center;gap:9px}
.tela .tb td .av{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:10px;
                 font-weight:700;color:#120d20;flex:none}
.tela .tb td b{font-weight:600}
.tela .pill{font-size:10.5px;font-weight:650;padding:3px 9px;border-radius:8px;background:var(--painel2);
            color:var(--texto2)}
.tela .pill.q{background:rgba(249,118,95,.16);color:var(--quente)}
.tela .pill.v{background:rgba(78,211,154,.14);color:var(--verde)}

/* ═════ CELULAR ═════ */
@container (max-width: 620px){
  .tela{grid-template-columns:1fr}
  .tela .menu{display:none}
  .tela .conteudo{border-left:0}
  .tela .topo{padding:14px 14px 0;flex-wrap:wrap}
  .tela .busca{display:none}
  .tela .grade{padding:12px 14px 18px;gap:11px}
  .tela .g4{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tela .g2{grid-template-columns:1fr}
  .tela .kpi .n{font-size:23px}
  .tela .calor{grid-template-columns:26px repeat(12,minmax(0,1fr));gap:3px}
  .tela .tb th:nth-child(3),.tela .tb td:nth-child(3){display:none}
}
`;

/* ── peças reaproveitadas ──────────────────────────────────────────────── */
const menu = (ativo) => `
  <nav class="menu">
    <div class="marca"><i>J.</i><span>Jurid<u>Flow</u></span></div>
    <div class="g">Dia a dia</div>
    <div class="i${ativo === "hoje" ? " on" : ""}"><span class="ic"></span>Hoje</div>
    <div class="i"><span class="ic"></span>Agenda <b>2</b></div>
    <div class="i${ativo === "atendimento" ? " on" : ""}"><span class="ic"></span>Atendimento <b class="al">2</b></div>
    <div class="g">Carteira</div>
    <div class="i"><span class="ic"></span>Clientes</div>
    <div class="i"><span class="ic"></span>Processos <b>2</b></div>
    <div class="i"><span class="ic"></span>Acordos</div>
    <div class="g">Gestão</div>
    <div class="i${ativo === "financeiro" ? " on" : ""}"><span class="ic"></span>Financeiro</div>
    <div class="i"><span class="ic"></span>Relatórios</div>
    <div class="pe"><span class="av">DS</span><span>Dono Smoke<em>Boyadjian Advogados</em></span></div>
  </nav>`;

const topo = (h, dt, acao) => `
  <div class="topo"><h2>${h}</h2><span class="dt">${dt}</span>
    <span class="busca">Buscar processo, cliente ou CNJ <span class="tec">⌘K</span></span>
    <span class="btp">${acao}</span></div>`;

const kpi = (rot, cor, n, ncor, sb, barras) => `
  <div class="c kpi">
    <div class="rot"><span class="pt ${cor}"></span>${rot}</div>
    <div class="n ${ncor}">${n}</div>
    <div class="sb">${sb}</div>
    <div class="spark">${barras.map((b) => `<i class="${b}"></i>`).join("")}</div>
  </div>`;

const AV = ["#9a73ff", "#f9765f", "#4ed39a", "#6ba8ff", "#f5c162", "#c4aaff"];
const av = (ini, i) => `<span class="av" style="background:${AV[i % AV.length]}">${ini}</span>`;

/* ── HOJE ──────────────────────────────────────────────────────────────── */
const CALOR = [
  ["09h", [1, 2, 3, 2, 4, 1, 0, 2, 3, 1, 2, 0]],
  ["11h", [2, 3, 4, 3, 2, 2, 1, 3, 4, 2, 1, 1]],
  ["14h", [0, 1, 2, 4, 3, 4, 2, 1, 2, 3, 4, 2]],
  ["17h", [1, 0, 1, 2, 1, 3, 1, 0, 1, 2, 1, 0]],
];
const linhaCalor = ([h, cels]) =>
  `<span class="hh">${h}</span>${cels.map((n) => `<u class="${n ? "n" + n : ""}"></u>`).join("")}`;

const PRAZOS = [
  ["Recurso inominado", "0056789-12 · Cleide Farias", 3, "q", 88],
  ["Contestação", "0034521-89 · Raimundo Nonato", 8, "a", 60],
  ["Manifestação sobre laudo", "0091234-56 · Antônia Gomes", 14, "", 32],
  ["Juntar procuração", "Vale Verde · sem processo", 21, "", 14],
];
const linhaPrazo = ([t, s, d, cor, pct]) => `
  <div class="prz">
    <span><span class="t">${t}</span><span class="s">${s}</span>
      <span class="barra"><i class="${cor}" style="width:${pct}%"></i></span></span>
    <span class="dias"><b class="${cor}">${d}</b><em>dias</em></span>
  </div>`;

const MOVS = [
  ["Tribunal", "", "Juntada de petição — recurso inominado", "0812345-67 · TJCE", "08:14"],
  ["Tribunal", "", "Sentença — procedente em parte", "0056789-12 · recurso até 25/09", "09:40"],
  ["Cliente", "cl", "José Ribamar — “quero recorrer sim”", "esperando há 6 horas", "09:02"],
  ["Tribunal", "", "Vista dos autos à parte contrária", "0812345-67 · TJCE", "14:43"],
  ["Agenda", "ag", "Perícia médica realizada", "Cleide Farias do Nascimento", "11:00"],
];
const linhaMov = ([tag, cls, t, s, hr]) => `
  <div class="mv"><span class="tag ${cls}">${tag}</span>
    <span class="co"><b>${t}</b><span>${s}</span></span><span class="hr">${hr}</span></div>`;

const AGENDA = [
  ["05:30", "Audiência de instrução", "Fórum Clóvis Beviláqua · 2ª Vara Cível", true, ""],
  ["07:00", "Reunião — proposta de acordo", "Maria Aparecida Nogueira", true, ""],
  ["11:00", "Perícia médica", "Cleide Farias do Nascimento", true, ""],
  ["13:30", "Ligar para a cliente", "Antônia Gomes — “pago na sexta”", false, "q"],
  ["17:00", "Preparar perguntas", "para a audiência de amanhã", false, ""],
];
const linhaAg = ([h, t, s, ja, cor]) => `
  <div class="ag${ja ? " ja" : ""}"><span class="h">${h}</span>
    <span class="co"><b><span class="pino ${cor}"></span>${t}</b><span>${s}</span></span></div>`;

const ESPERA = [
  ["JR", "José Ribamar da Silva", "“Eu quero recorrer sim, o valor ficou baixo”", "6h", true],
  ["AG", "Antônia Gomes Vasconcelos", "“Consigo pagar na sexta, pode ser?”", "4h", true],
  ["TB", "Tirzah Barbosa de Sousa", "“Vi o anúncio sobre aposentadoria”", "4h", false],
];
const linhaPs = ([ini, nome, fala, tm, al], i) => `
  <div class="ps">${av(ini, i)}<span class="co"><b>${nome}</b><span>${fala}</span></span>
    <span class="tm${al ? " al" : ""}">${tm}</span></div>`;

export const HOJE = `
<div class="tela">${menu("hoje")}
  <div class="conteudo">
    ${topo("Bom dia, Dono", "domingo, 13 de setembro · 13:12", "+ Novo")}

    <div class="grade g4">
      ${kpi("Prazos em 7 dias", "q", "2", "q", 'o mais curto vence em <b class="d">3 dias</b>',
        ["", "", "on", "", "q", "on", ""])}
      ${kpi("Esperando resposta", "a", "3", "", "o mais antigo há <b class=\"d\">6 horas</b>",
        ["on", "", "on", "on", "", "q", "on"])}
      ${kpi("Movimentações novas", "", "4", "", "em 3 processos · <b>+2</b> que ontem",
        ["", "on", "", "on", "on", "", "on"])}
      ${kpi("Entrou em setembro", "v", "R$ 10,7 mil", "v", "<b>+30%</b> sobre agosto",
        ["", "on", "on", "", "on", "on", "on"])}
    </div>

    <div class="grade g2" style="padding-top:0">
      <div class="c">
        <div class="ct"><h3>O que acontece hoje</h3><span class="mais">5 de 11 já aconteceram</span></div>
        ${MOVS.map(linhaMov).join("")}
      </div>
      <div class="c">
        <div class="ct"><h3>Prazos</h3><span class="mais">ver todos</span></div>
        ${PRAZOS.map(linhaPrazo).join("")}
      </div>
    </div>

    <div class="grade g2" style="padding-top:0">
      <div class="c">
        <div class="ct"><h3>Quando o tribunal se mexe</h3>
          <span class="mais">últimas 12 semanas</span></div>
        <div class="calor">
          ${CALOR.map(linhaCalor).join("")}
          <span></span>${["S", "T", "Q", "Q", "S", "S", "D", "S", "T", "Q", "Q", "S"]
            .map((d) => `<span class="dd">${d}</span>`).join("")}
        </div>
        <div class="legenda">menos
          <u></u><u class="n1"></u><u class="n2"></u><u class="n3"></u><u class="n4"></u>mais
        </div>
      </div>
      <div class="c">
        <div class="ct"><h3>Agenda de hoje</h3><span class="mais">4 · 2 tarefas</span></div>
        ${AGENDA.map(linhaAg).join("")}
      </div>
    </div>

    <div class="grade" style="padding-top:0;grid-template-columns:1fr">
      <div class="c">
        <div class="ct"><h3>Clientes esperando resposta</h3><span class="mais">abrir o Atendimento →</span></div>
        ${ESPERA.map(linhaPs).join("")}
      </div>
    </div>
  </div>
</div>`;

/* ── ATENDIMENTO ───────────────────────────────────────────────────────── */
const FILA = [
  ["JR", "José Ribamar da Silva Filho", "“Eu quero recorrer sim, o valor ficou muito baixo”",
   "6h", true, "sentença publicada há 3h · prazo em 3 dias"],
  ["AG", "Antônia Gomes Vasconcelos", "“Consigo pagar na sexta, pode ser?”",
   "4h", true, "R$ 1.600,00 vencidos há 11 dias"],
  ["TB", "Tirzah Barbosa de Sousa", "“Boa tarde! Vi o anúncio sobre aposentadoria”",
   "4h", false, "lead novo · veio do Instagram"],
  ["CF", "Cleide Farias do Nascimento", "“Então eu levo os exames na segunda?”",
   "2h", false, "perícia médica hoje às 11h"],
  ["FE", "Francisco Edilson Martins", "“Obrigado, doutor! Até amanhã então”",
   "1d", false, "não precisa de resposta"],
];
const linhaFila = ([ini, nome, fala, tm, al, meta], i) => `
  <div class="ps" style="padding:12px 0">${av(ini, i)}
    <span class="co"><b>${nome}</b><span>${fala}</span>
      <span style="color:var(--texto3);font-size:11px;margin-top:3px">${meta}</span></span>
    <span class="tm${al ? " al" : ""}">${tm}</span></div>`;

export const ATENDIMENTO = `
<div class="tela">${menu("atendimento")}
  <div class="conteudo">
    ${topo("Atendimento", "6 conversas · 2 esperando há mais de 4h", "+ Nova conversa")}

    <div class="grade g4">
      ${kpi("Esperando agora", "q", "3", "q", "2 passaram de 4 horas", ["on", "", "on", "on", "", "q", "q"])}
      ${kpi("Em atendimento", "", "2", "", "com Dono e Gestor", ["", "on", "on", "", "on", "", "on"])}
      ${kpi("Tempo médio", "a", "73 min", "", "ontem foram <b>48 min</b>", ["on", "on", "", "q", "q", "on", "q"])}
      ${kpi("Resolvidas hoje", "v", "1", "", "média da semana: <b>4</b>", ["on", "on", "on", "", "", "on", ""])}
    </div>

    <div class="grade g2" style="padding-top:0">
      <div class="c">
        <div class="ct"><h3>Fila — do mais antigo ao mais novo</h3>
          <span class="mais">a fala aparece inteira</span></div>
        ${FILA.map(linhaFila).join("")}
      </div>
      <div class="c">
        <div class="ct"><h3>Quando o cliente escreve</h3><span class="mais">últimas 12 semanas</span></div>
        <div class="calor">
          ${CALOR.map(linhaCalor).join("")}
          <span></span>${["S", "T", "Q", "Q", "S", "S", "D", "S", "T", "Q", "Q", "S"]
            .map((d) => `<span class="dd">${d}</span>`).join("")}
        </div>
        <div class="ct" style="margin:18px 0 12px"><h3>Quem está atendendo</h3></div>
        ${[["DS", "Dono Smoke", "2 conversas abertas", "2", false],
           ["GS", "Gestor Smoke", "1 conversa aberta", "1", false]].map(linhaPs).join("")}
      </div>
    </div>
  </div>
</div>`;

/* ── FINANCEIRO ────────────────────────────────────────────────────────── */
const PONTOS = [0, 0, 380, 0, 0, 0, 0, 10700, 0, 0, 1400, 0, 0];
const maxP = Math.max(...PONTOS);
const caminho = PONTOS.map((v, i) => {
  const x = (i / (PONTOS.length - 1)) * 100;
  const y = 100 - (v / maxP) * 92;
  return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
}).join(" ");

const COBS = [
  ["RN", "Raimundo Nonato de Alencar", "R$ 900,00", "27/09", "em dia", ""],
  ["MA", "Maria Aparecida Nogueira", "R$ 2.000,00", "22/09", "em dia", ""],
  ["AG", "Antônia Gomes Vasconcelos", "R$ 1.600,00", "02/09", "11 dias", "q"],
  ["CF", "Cleide Farias do Nascimento", "R$ 1.250,00", "30/09", "em dia", ""],
  ["JR", "José Ribamar da Silva Filho", "R$ 4.000,00", "15/09", "em dia", ""],
  ["TB", "Tirzah Barbosa de Sousa", "R$ 950,00", "05/09", "pago", "v"],
];
const linhaCob = ([ini, nome, vl, dt, st, cls], i) => `
  <tr><td><span class="cl">${av(ini, i)}<span>${nome}</span></span></td>
    <td><b>${vl}</b></td><td>${dt}</td><td><span class="pill ${cls}">${st}</span></td></tr>`;

export const FINANCEIRO = `
<div class="tela">${menu("financeiro")}
  <div class="conteudo">
    ${topo("Financeiro", "setembro · 01 a 30", "+ Nova cobrança")}

    <div class="grade g4">
      ${kpi("Entrou no caixa", "v", "R$ 10,7 mil", "v", "<b>+30%</b> sobre agosto",
        ["", "on", "", "", "on", "on", "on"])}
      ${kpi("A receber, em dia", "", "R$ 7,7 mil", "", "3 cobranças", ["on", "", "on", "on", "", "on", ""])}
      ${kpi("Vencido", "q", "R$ 1,6 mil", "q", "1 cliente · <b class=\"d\">13% do mês</b>",
        ["", "", "q", "", "q", "", "q"])}
      ${kpi("Em negociação", "a", "R$ 22,7 mil", "", "4 leads no funil", ["on", "on", "", "on", "on", "", "on"])}
    </div>

    <div class="grade g2" style="padding-top:0">
      <div class="c">
        <div class="ct"><h3>Entradas do mês</h3><span class="mais">R$ 10.700,00 em 3 pagamentos</span></div>
        <div class="graf">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs><linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#4ed39a" stop-opacity=".38"/>
              <stop offset="100%" stop-color="#4ed39a" stop-opacity="0"/></linearGradient></defs>
            <path d="${caminho} L100,100 L0,100 Z" fill="url(#gr)"/>
            <path d="${caminho}" fill="none" stroke="#4ed39a" stroke-width="1.6"
                  vector-effect="non-scaling-stroke"/>
          </svg>
        </div>
        <div class="eixo"><span>01 set</span><span>07 set</span><span>13 set</span></div>
      </div>
      <div class="c">
        <div class="ct"><h3>Quem deve</h3><span class="mais">1 cliente</span></div>
        ${linhaPs(["AG", "Antônia Gomes Vasconcelos", "R$ 1.600,00 · vencido há 11 dias", "11d", true], 1)}
        <div class="ct" style="margin:18px 0 12px"><h3>Como entrou</h3></div>
        <div class="prz"><span><span class="t">PIX</span>
          <span class="barra"><i style="width:100%"></i></span></span>
          <span class="dias"><b>100</b><em>%</em></span></div>
        <div class="prz"><span><span class="t">Asaas (boleto e cartão)</span>
          <span class="barra"><i style="width:2%"></i></span></span>
          <span class="dias"><b>0</b><em>%</em></span></div>
      </div>
    </div>

    <div class="grade" style="padding-top:0;grid-template-columns:1fr">
      <div class="c">
        <div class="ct"><h3>Cobranças de setembro</h3><span class="mais">6 · por vencimento</span></div>
        <table class="tb">
          <tr><th>Cliente</th><th>Valor</th><th>Vence</th><th>Situação</th></tr>
          ${COBS.map(linhaCob).join("")}
        </table>
      </div>
    </div>
  </div>
</div>`;

export const TELAS = [
  { id: "hoje", nome: "Hoje", html: HOJE },
  { id: "atendimento", nome: "Atendimento", html: ATENDIMENTO },
  { id: "financeiro", nome: "Financeiro", html: FINANCEIRO },
];
