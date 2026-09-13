/**
 * As telas REDESENHADAS do navegável — o lado "depois".
 *
 * Exporta só marcação + CSS. O invólucro (menu, chaves Antes/Depois e
 * Computador/Celular) fica em `gera-navegavel-novo.mjs`.
 *
 * O que mudou em relação à primeira tentativa, que o dono reprovou:
 *  · UMA cor de acento. Os pontinhos coloridos por tipo viraram rótulo em
 *    versalete monocromático — quatro matizes era exatamente o ruído que eu
 *    tinha criticado no diagnóstico.
 *  · UM foco. A tela abre com A PRÓXIMA COISA em tipo grande, porque às 13h12
 *    o que decide a próxima ação é "daqui a 18 minutos", não um gráfico.
 *  · MENOS elementos. A primeira versão tinha frase + filtros + 11 linhas +
 *    3 prazos + 4 esperas + 4 números. Aqui o dia começa em AGORA e o que já
 *    passou fica esmaecido — é a ideia que carrega o desenho.
 *  · Larguras por CONTAINER QUERY, não por viewport: a mesma marcação responde
 *    a 1440 e a 390 dentro do palco do navegável.
 */

export const CSS = `
/* O container é o INVÓLUCRO, nunca a própria .tela: um elemento não responde
 * à sua própria container query. Com o container na .tela, o menu sumia no
 * celular mas a coluna de 208px continuava no grid — e o conteúdo ia inteiro
 * para dentro dela. */
.palco-conteudo{container-type:inline-size}
.tela{
  --preto:#0a0910; --painel:#14121e; --painel2:#1b1826;
  --fio:rgba(255,255,255,.07); --fio2:rgba(255,255,255,.14);
  --texto:#f0eef7; --texto2:#a29dba; --texto3:#6d6885;
  --marca:#9a73ff; --alarme:#ff6a5c;
  background:var(--preto); color:var(--texto); min-height:100%;
  font:400 14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  font-variant-numeric:tabular-nums; -webkit-font-smoothing:antialiased;
  display:grid; grid-template-columns:208px minmax(0,1fr);
}
.tela *{box-sizing:border-box;margin:0;padding:0}

/* ── menu ───────────────────────────────────────────────────────────────── */
.tela .menu{border-right:1px solid var(--fio);padding:18px 0 16px;display:flex;flex-direction:column}
.tela .marca{display:flex;align-items:center;gap:8px;padding:0 18px 20px;font-size:16px;
             font-weight:700;letter-spacing:-.02em}
.tela .marca i{font-family:Poppins,Inter,sans-serif;font-style:normal;font-size:20px}
.tela .marca u{text-decoration:none;color:var(--marca)}
.tela .g{padding:13px 18px 4px;font-size:9.5px;font-weight:700;letter-spacing:.15em;
         text-transform:uppercase;color:var(--texto3)}
.tela .i{display:flex;align-items:center;gap:9px;padding:7px 18px;color:var(--texto2);font-size:13px;
         cursor:default}
.tela .i.on{color:#fff;background:rgba(154,115,255,.12);box-shadow:inset 2px 0 0 var(--marca)}
.tela .i b{margin-left:auto;font-size:10px;font-weight:700;min-width:16px;height:16px;border-radius:4px;
           display:grid;place-items:center;background:rgba(255,255,255,.07);color:var(--texto2)}
.tela .i b.al{background:rgba(255,106,92,.16);color:var(--alarme)}
.tela .pe{margin-top:auto;padding:13px 18px 0;border-top:1px solid var(--fio);font-size:11.5px;
          color:var(--texto3);line-height:1.4}

/* ── área ───────────────────────────────────────────────────────────────── */
.tela .conteudo{min-width:0;display:flex;flex-direction:column}
.tela .barra{display:flex;align-items:center;gap:12px;padding:16px 26px 0}
.tela .barra h2{font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
                color:var(--texto3)}
.tela .barra .dt{font-size:12.5px;color:var(--texto3)}
.tela .barra .k{margin-left:auto;font-size:11.5px;color:var(--texto3);display:flex;gap:7px;
                align-items:center}
.tela .tec{border:1px solid var(--fio2);border-radius:5px;padding:1px 6px;font-size:10.5px;
           color:var(--texto2)}

/* ── o foco: a próxima coisa ────────────────────────────────────────────── */
.tela .foco{padding:22px 26px 24px;border-bottom:1px solid var(--fio)}
.tela .foco .em{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
                color:var(--alarme);margin-bottom:9px}
.tela .foco h3{font-size:34px;line-height:1.12;font-weight:650;letter-spacing:-.03em;max-width:22ch}
.tela .foco .sub{font-size:14px;color:var(--texto2);margin-top:8px;max-width:60ch}
.tela .foco .sub q{color:var(--texto);quotes:"“" "”"}
.tela .acoes{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
.tela .bt{border:1px solid var(--fio2);border-radius:7px;padding:6px 13px;font-size:13px;
          color:var(--texto);background:transparent}
.tela .bt.p{background:var(--marca);border-color:var(--marca);color:#0b0a14;font-weight:600}

/* ── corpo em duas colunas ──────────────────────────────────────────────── */
.tela .duas{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 292px;
            grid-template-rows:minmax(0,1fr) auto}
.tela .fio{min-width:0;min-height:0;padding:0 0 18px;overflow:auto}
.tela .lado{border-left:1px solid var(--fio);background:var(--painel);min-width:0;
            min-height:0;overflow:auto}

.tela .cab{display:flex;align-items:center;gap:9px;padding:13px 26px 10px}
.tela .cab h4{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
              color:var(--texto3)}
.tela .cab .fim{margin-left:auto;font-size:11.5px;color:var(--texto3)}

/* linha do dia: rótulo em versalete no lugar de bolinha colorida */
.tela .l{display:grid;grid-template-columns:52px 74px minmax(0,1fr);gap:0 14px;align-items:baseline;
         padding:9px 26px;border-top:1px solid rgba(255,255,255,.045)}
.tela .l:first-of-type{border-top:0}
.tela .l .h{font-size:12px;color:var(--texto3);text-align:right}
.tela .l .tp{font-size:9.5px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;
             color:var(--texto3)}
.tela .l .c{min-width:0}
.tela .l .c>*{display:block}
.tela .l .c .t{font-size:14px;font-weight:500;letter-spacing:-.005em}
.tela .l .c .s{font-size:12px;color:var(--texto3);margin-top:1px}
.tela .l.passou{opacity:.42}
.tela .l.agora-linha{border-top:1px solid var(--alarme);padding-top:0;padding-bottom:0;height:0;
                     position:relative}
.tela .l.agora-linha span{position:absolute;left:26px;top:-7px;background:var(--preto);padding-right:9px;
                          font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
                          color:var(--alarme)}
.tela .l .mk{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
             color:var(--marca);margin-left:8px}

/* ── régua de prazos ────────────────────────────────────────────────────── */
.tela .pz{display:grid;grid-template-columns:46px minmax(0,1fr);gap:0 13px;padding:12px 20px;
          border-top:1px solid var(--fio);align-items:start}
.tela .pz>span{display:block;min-width:0}
.tela .pz .n,.tela .pz .u,.tela .pz .t,.tela .pz .s{display:block}
.tela .pz .n{font-size:26px;font-weight:700;letter-spacing:-.04em;line-height:.95}
.tela .pz .n.q{color:var(--alarme)}
.tela .pz .u{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--texto3)}
.tela .pz .t{font-size:13px;font-weight:500;line-height:1.3}
.tela .pz .s{font-size:11.5px;color:var(--texto3);margin-top:2px}

/* ── fila de espera / lista genérica ────────────────────────────────────── */
.tela .q{display:flex;align-items:center;gap:10px;padding:8px 20px}
.tela .q .av{width:25px;height:25px;flex:none;border-radius:7px;display:grid;place-items:center;
             font-size:10px;font-weight:700;background:var(--painel2);color:var(--texto2)}
.tela .q .nm{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tela .q .tm{margin-left:auto;font-size:12px;color:var(--texto3)}
.tela .q .tm.al{color:var(--alarme);font-weight:650}

/* ── rodapé de dinheiro ─────────────────────────────────────────────────── */
.tela .caixa{border-top:1px solid var(--fio);display:flex;gap:34px;padding:13px 26px;
             background:var(--painel);flex-wrap:wrap;align-items:baseline;grid-column:1/-1}
.tela .caixa .v>*{display:block}
.tela .caixa .v{display:flex;flex-direction:column;gap:1px}
.tela .caixa .r{font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--texto3)}
.tela .caixa .n{font-size:18px;font-weight:650;letter-spacing:-.025em}
.tela .caixa .n.al{color:var(--alarme)}
.tela .caixa .h{font-size:11px;color:var(--texto3)}
.tela .caixa .fim{margin-left:auto;font-size:11.5px;color:var(--texto3)}

/* ── atendimento: a fila ────────────────────────────────────────────────── */
.tela .fila{display:grid;grid-template-columns:64px minmax(0,1fr);gap:0 16px;padding:14px 26px;
            border-top:1px solid rgba(255,255,255,.045);align-items:start}
.tela .fila:first-of-type{border-top:0}
.tela .fila .esp{text-align:right}
.tela .fila .esp>*{display:block}
.tela .fila .esp .n{font-size:22px;font-weight:700;letter-spacing:-.04em;line-height:1}
.tela .fila .esp .n.al{color:var(--alarme)}
.tela .fila .esp .u{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--texto3)}
.tela .fila>span:last-child>*{display:block}
.tela .fila .nome{font-size:15px;font-weight:600;letter-spacing:-.01em}
.tela .fila .fala{font-size:13.5px;color:var(--texto2);margin-top:3px;padding-left:11px;
                  border-left:2px solid var(--fio2)}
.tela .fila .meta{font-size:11.5px;color:var(--texto3);margin-top:5px}
.tela .fila .meta b{color:var(--marca);font-weight:600}

/* ── financeiro: linhas de cobrança ─────────────────────────────────────── */
.tela .cob{display:grid;grid-template-columns:minmax(0,1fr) 108px 92px 96px;gap:0 14px;
           padding:10px 26px;border-top:1px solid rgba(255,255,255,.045);align-items:baseline}
.tela .cob:first-of-type{border-top:0}
.tela .cob .cl{font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;
               text-overflow:ellipsis}
.tela .cob .vl{font-size:13.5px;text-align:right;font-weight:600}
.tela .cob .dt{font-size:12px;color:var(--texto3);text-align:right}
.tela .cob .st{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
               text-align:right;color:var(--texto3)}
.tela .cob .st.al{color:var(--alarme)}
.tela .cob .st.ok{color:var(--texto2)}
.tela .cabc{display:grid;grid-template-columns:minmax(0,1fr) 108px 92px 96px;gap:0 14px;
            padding:9px 26px;font-size:9.5px;font-weight:700;letter-spacing:.13em;
            text-transform:uppercase;color:var(--texto3);border-bottom:1px solid var(--fio)}
.tela .cabc span:nth-child(n+2){text-align:right}

/* ═════ CELULAR — por container query, então vale dentro do palco ═════ */
@container (max-width: 560px){
  .tela{grid-template-columns:1fr}
  .tela .menu{display:none}
  .tela .barra{padding:14px 16px 0}
  .tela .foco{padding:16px 16px 18px}
  .tela .foco h3{font-size:25px}
  .tela .duas{grid-template-columns:1fr;grid-template-rows:none}
  .tela .fio,.tela .lado{overflow:visible}
  .tela .conteudo{overflow:auto}
  /* no celular o que pede resposta vem ANTES do resto do dia */
  .tela .lado{border-left:0;border-bottom:1px solid var(--fio);order:-1}
  .tela .l{grid-template-columns:44px minmax(0,1fr);padding:9px 16px;row-gap:2px}
  .tela .l .tp{grid-column:2;font-size:9px}
  .tela .l .c{grid-column:2}
  .tela .l.agora-linha span{left:16px}
  .tela .cab,.tela .q,.tela .pz{padding-left:16px;padding-right:16px}
  .tela .caixa{gap:18px 26px;padding:13px 16px}
  .tela .fila{grid-template-columns:52px minmax(0,1fr);padding:12px 16px}
  .tela .cob,.tela .cabc{grid-template-columns:minmax(0,1fr) 92px;padding-left:16px;padding-right:16px}
  .tela .cob .dt,.tela .cob .st,.tela .cabc span:nth-child(3),.tela .cabc span:nth-child(4){display:none}
  .tela .barra .k{display:none}
}
`;

const menu = (ativo) => `
  <nav class="menu">
    <div class="marca"><i>J.</i><span>Jurid<u>Flow</u></span></div>
    <div class="g">Dia a dia</div>
    <div class="i${ativo === "hoje" ? " on" : ""}">Hoje</div>
    <div class="i">Agenda <b>2</b></div>
    <div class="i${ativo === "atendimento" ? " on" : ""}">Atendimento <b class="al">2</b></div>
    <div class="g">Carteira</div>
    <div class="i">Clientes</div>
    <div class="i">Processos <b>2</b></div>
    <div class="i">Acordos</div>
    <div class="g">Gestão</div>
    <div class="i${ativo === "financeiro" ? " on" : ""}">Financeiro</div>
    <div class="i">Relatórios</div>
    <div class="pe">Dono Smoke<br>Boyadjian Advogados</div>
  </nav>`;

const barra = (titulo, data) => `
  <div class="barra"><h2>${titulo}</h2><span class="dt">${data}</span>
    <span class="k"><span class="tec">⌘K</span> buscar ou criar</span></div>`;

/* ── HOJE ────────────────────────────────────────────────────────────────── */
const DIA = [
  ["05:30", "Agenda", "Audiência de instrução", "Fórum Clóvis Beviláqua · 2ª Vara Cível", true],
  ["07:00", "Agenda", "Reunião — proposta de acordo", "Maria Aparecida Nogueira de Sousa", true],
  ["08:14", "Tribunal", "Juntada de petição — recurso inominado", "0812345-67 · TJCE", true, true],
  ["09:02", "Cliente", "José Ribamar — “quero recorrer sim”", "esperando resposta há 6 horas", true],
  ["09:40", "Tribunal", "Sentença — procedente em parte", "0056789-12 · recurso até 25/09", true, true],
  ["11:00", "Agenda", "Perícia médica", "Cleide Farias do Nascimento", true],
  ["11:35", "Caixa", "R$ 2.000,00 recebido", "Maria Aparecida · PIX", true],
];
const DIA_DEPOIS = [
  ["13:30", "Agenda", "Ligar para a cliente", "Antônia Gomes — “consigo pagar na sexta”"],
  ["14:43", "Tribunal", "Vista dos autos à parte contrária", "0812345-67 · TJCE", false, true],
  ["17:00", "Agenda", "Preparar perguntas das testemunhas", "para a audiência de amanhã"],
];
const linhaDia = ([h, tp, t, s, passou, novo]) => `
  <div class="l${passou ? " passou" : ""}">
    <span class="h">${h}</span><span class="tp">${tp}</span>
    <span class="c"><span class="t">${t}${novo ? '<span class="mk">novo</span>' : ""}</span>
      <span class="s">${s}</span></span>
  </div>`;

export const HOJE = `
<div class="tela">
  ${menu("hoje")}
  <div class="conteudo">
    ${barra("Hoje", "domingo, 13 de setembro · 13:12")}

    <div class="foco">
      <div class="em">daqui a 18 minutos</div>
      <h3>Ligar para Antônia Gomes Vasconcelos</h3>
      <p class="sub">Ela escreveu às 09:02: <q>Consigo pagar na sexta, pode ser?</q> — e está esperando
        há 4 horas. Tem <b>R$ 1.600,00</b> vencidos no nome dela.</p>
      <div class="acoes">
        <span class="bt p">Abrir a conversa</span>
        <span class="bt">Ver as cobranças</span>
        <span class="bt">Adiar 1 hora</span>
      </div>
    </div>

    <div class="duas">
      <section class="fio">
        <div class="cab"><h4>O dia</h4><span class="fim">7 já aconteceram · 3 pela frente</span></div>
        ${DIA.map(linhaDia).join("")}
        <div class="l agora-linha"><span>agora · 13:12</span></div>
        ${DIA_DEPOIS.map(linhaDia).join("")}
      </section>

      <aside class="lado">
        <div class="cab"><h4>Prazos</h4></div>
        <div class="pz"><span><span class="n q">3</span><span class="u">dias</span></span>
          <span><span class="t">Recurso inominado</span><span class="s">0056789-12 · Cleide Farias</span></span></div>
        <div class="pz"><span><span class="n">8</span><span class="u">dias</span></span>
          <span><span class="t">Contestação</span><span class="s">0034521-89 · Raimundo Nonato</span></span></div>
        <div class="pz"><span><span class="n">14</span><span class="u">dias</span></span>
          <span><span class="t">Manifestação sobre laudo</span><span class="s">0091234-56 · Antônia Gomes</span></span></div>
        <div class="cab" style="border-top:1px solid var(--fio);margin-top:6px"><h4>Esperando você</h4></div>
        <div class="q"><span class="av">JR</span><span class="nm">José Ribamar da Silva</span><span class="tm al">6h</span></div>
        <div class="q"><span class="av">AG</span><span class="nm">Antônia Gomes Vasconcelos</span><span class="tm al">4h</span></div>
        <div class="q"><span class="av">TB</span><span class="nm">Tirzah Barbosa de Sousa</span><span class="tm">4h</span></div>
        <div class="q" style="padding-bottom:14px"><span class="av">FE</span><span class="nm">Francisco Edilson</span><span class="tm">1d</span></div>
      </aside>

      <div class="caixa">
        <span class="v"><span class="r">Recebido em setembro</span><span class="n">R$ 10.700,00</span></span>
        <span class="v"><span class="r">A receber, em dia</span><span class="n">R$ 7.750,00</span><span class="h">3 cobranças</span></span>
        <span class="v"><span class="r">Vencido</span><span class="n al">R$ 1.600,00</span><span class="h">1 cliente</span></span>
        <span class="v"><span class="r">Em negociação</span><span class="n">R$ 22.700,00</span><span class="h">4 leads</span></span>
        <span class="fim">ver o mês inteiro →</span>
      </div>
    </div>
  </div>
</div>`;

/* ── ATENDIMENTO ─────────────────────────────────────────────────────────── */
const FILA = [
  ["6h", true, "José Ribamar da Silva Filho", "Eu quero recorrer sim, o valor ficou muito baixo",
   "Cleide · 0056789-12 · <b>sentença publicada há 3h</b>"],
  ["4h", true, "Antônia Gomes Vasconcelos", "Consigo pagar na sexta, pode ser?",
   "cliente desde 2024 · <b>R$ 1.600,00 vencidos</b>"],
  ["4h", false, "Tirzah Barbosa de Sousa", "Boa tarde! Vi o anúncio de vocês sobre aposentadoria",
   "lead novo · veio do Instagram"],
  ["1d", false, "Francisco Edilson Martins", "Obrigado, doutor! Até amanhã então",
   "não precisa de resposta · marcado como resolvido"],
];
const linhaFila = ([t, al, nome, fala, meta]) => `
  <div class="fila">
    <span class="esp"><span class="n${al ? " al" : ""}">${t}</span><span class="u">esperando</span></span>
    <span><span class="nome">${nome}</span>
      <span class="fala">“${fala}”</span>
      <span class="meta">${meta}</span></span>
  </div>`;

export const ATENDIMENTO = `
<div class="tela">
  ${menu("atendimento")}
  <div class="conteudo">
    ${barra("Atendimento", "6 conversas · 2 esperando há mais de 4h")}

    <div class="foco">
      <div class="em">o mais antigo sem resposta</div>
      <h3>José Ribamar espera há 6 horas</h3>
      <p class="sub">A sentença do processo dele saiu hoje às 09:40 — <b>procedente em parte</b>, e o
        prazo de recurso vence em 3 dias. Ele já sabe: escreveu às 09:02.</p>
      <div class="acoes">
        <span class="bt p">Responder</span>
        <span class="bt">Abrir o processo</span>
        <span class="bt">Passar para outro atendente</span>
      </div>
    </div>

    <div class="duas">
      <section class="fio">
        <div class="cab"><h4>Fila, do mais antigo ao mais novo</h4>
          <span class="fim">a fala do cliente aparece inteira — não cortada</span></div>
        ${FILA.map(linhaFila).join("")}
      </section>
      <aside class="lado">
        <div class="cab"><h4>Hoje</h4></div>
        <div class="pz"><span><span class="n">73</span><span class="u">min</span></span>
          <span><span class="t">Tempo médio de resposta</span><span class="s">ontem foram 48 min</span></span></div>
        <div class="pz"><span><span class="n">1</span><span class="u">resolv.</span></span>
          <span><span class="t">Resolvidas hoje</span><span class="s">média da semana: 4</span></span></div>
        <div class="cab" style="border-top:1px solid var(--fio)"><h4>Quem está atendendo</h4></div>
        <div class="q"><span class="av">DS</span><span class="nm">Dono Smoke</span><span class="tm">2</span></div>
        <div class="q" style="padding-bottom:14px"><span class="av">GS</span><span class="nm">Gestor Smoke</span><span class="tm">1</span></div>
      </aside>
    </div>
  </div>
</div>`;

/* ── FINANCEIRO ──────────────────────────────────────────────────────────── */
const COB = [
  ["Raimundo Nonato de Alencar", "R$ 900,00", "27/09", "em dia", ""],
  ["Maria Aparecida Nogueira de Sousa", "R$ 2.000,00", "22/09", "em dia", ""],
  ["Antônia Gomes Vasconcelos", "R$ 1.600,00", "02/09", "11 dias", "al"],
  ["Cleide Farias do Nascimento", "R$ 1.250,00", "30/09", "em dia", ""],
  ["José Ribamar da Silva Filho", "R$ 4.000,00", "15/09", "em dia", ""],
  ["Tirzah Barbosa de Sousa", "R$ 950,00", "05/09", "pago", "ok"],
];
const linhaCob = ([cl, vl, dt, st, cls]) => `
  <div class="cob"><span class="cl">${cl}</span><span class="vl">${vl}</span>
    <span class="dt">${dt}</span><span class="st ${cls}">${st}</span></div>`;

export const FINANCEIRO = `
<div class="tela">
  ${menu("financeiro")}
  <div class="conteudo">
    ${barra("Financeiro", "setembro · 01 a 30")}

    <div class="foco">
      <div class="em">a única coisa vencida</div>
      <h3>R$ 1.600,00 de Antônia Gomes, há 11 dias</h3>
      <p class="sub">Ela respondeu hoje às 09:02: <q>Consigo pagar na sexta, pode ser?</q> — e está
        esperando resposta. O resto do mês está em dia: R$ 7.750,00 a receber em 3 cobranças.</p>
      <div class="acoes">
        <span class="bt p">Responder e combinar a data</span>
        <span class="bt">Renegociar a cobrança</span>
      </div>
    </div>

    <div class="duas">
      <section class="fio">
        <div class="cab"><h4>Cobranças de setembro</h4><span class="fim">6 · ordenadas por vencimento</span></div>
        <div class="cabc"><span>Cliente</span><span>Valor</span><span>Vence</span><span>Situação</span></div>
        ${COB.map(linhaCob).join("")}
      </section>
      <aside class="lado">
        <div class="cab"><h4>O mês</h4></div>
        <div class="pz"><span><span class="n">10,7</span><span class="u">mil</span></span>
          <span><span class="t">Entrou no caixa</span><span class="s">agosto foram 8,2 mil</span></span></div>
        <div class="pz"><span><span class="n">7,7</span><span class="u">mil</span></span>
          <span><span class="t">A receber, em dia</span><span class="s">3 cobranças</span></span></div>
        <div class="pz"><span><span class="n q">1,6</span><span class="u">mil</span></span>
          <span><span class="t">Vencido</span><span class="s">1 cliente · 13% do mês</span></span></div>
        <div class="cab" style="border-top:1px solid var(--fio)"><h4>Entrou por onde</h4></div>
        <div class="q"><span class="av">PX</span><span class="nm">PIX</span><span class="tm">R$ 10.700</span></div>
        <div class="q" style="padding-bottom:14px"><span class="av">AS</span><span class="nm">Asaas</span><span class="tm">R$ 0</span></div>
      </aside>
    </div>
  </div>
</div>`;

export const TELAS = [
  { id: "hoje", nome: "Hoje", html: HOJE },
  { id: "atendimento", nome: "Atendimento", html: ATENDIMENTO },
  { id: "financeiro", nome: "Financeiro", html: FINANCEIRO },
];
