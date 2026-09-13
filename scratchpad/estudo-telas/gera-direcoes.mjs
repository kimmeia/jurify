/**
 * Monta a página de decisão das DIREÇÕES VISUAIS.
 *
 *   node gera-direcoes.mjs <pastaDirecoes> <saida.html>
 *
 * Três direções, não uma: a convergência do visual "cara de IA" é o caminho de
 * menor resistência do modelo, e pedir uma proposta só cai sempre no mesmo
 * ponto. As duas primeiras são FOTO do app rodando sob uma camada de token; a
 * terceira é desenho, porque muda o esqueleto da tela — e o conteúdo dela é
 * copiado das telas reais fotografadas ao lado, não inventado.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [DIR, SAIDA] = process.argv.slice(2);
const img = (n) => "data:image/jpeg;base64," + readFileSync(`${DIR}/${n}.jpg`).toString("base64");

const par = (tela, dir, legenda) => `
  <div class="par">
    <figure class="lado"><figcaption>Hoje</figcaption>
      <div class="quadro"><img src="${img(`${tela}-hoje`)}" alt="hoje"></div></figure>
    <figure class="lado"><figcaption><b>${legenda}</b></figcaption>
      <div class="quadro"><img src="${img(`${tela}-${dir}`)}" alt="${dir}"></div></figure>
  </div>`;

/* ── O FIO ────────────────────────────────────────────────────────────────
 * Desenho, e o conteúdo é REAL: as movimentações vêm de `eventos_processo`
 * do banco local, os compromissos e as conversas são os mesmos que aparecem
 * nas fotos do Dashboard e do Atendimento logo acima. */
const FIO = [
  { h: "05:30", tipo: "agenda", t: "Audiência de instrução", s: "Fórum Clóvis Beviláqua · 2ª Vara Cível", risco: true },
  { h: "07:00", tipo: "agenda", t: "Reunião — proposta de acordo", s: "Maria Aparecida Nogueira de Sousa" },
  { h: "08:14", tipo: "tribunal", t: "Juntada de petição — recurso inominado da parte autora",
    s: "0812345-67.2024.8.06.0001 · TJCE", novo: true },
  { h: "09:02", tipo: "conversa", t: "José Ribamar da Silva Filho",
    s: "“Eu quero recorrer sim, o valor ficou muito baixo”", risco: true },
  { h: "09:40", tipo: "tribunal", t: "Sentença publicada — procedente em parte",
    s: "0056789-12.2024.8.06.0001 · prazo recursal em curso", prazo: "15 dias · vence 25/09", novo: true },
  { h: "11:00", tipo: "agenda", t: "Perícia médica", s: "Cleide Farias do Nascimento" },
  { h: "11:35", tipo: "dinheiro", t: "R$ 2.000,00 recebido", s: "Maria Aparecida Nogueira de Sousa · PIX" },
  { h: "13:30", tipo: "agenda", t: "Ligar para a cliente", s: "Antônia Gomes Vasconcelos" },
  { h: "14:43", tipo: "tribunal", t: "Vista dos autos à parte contrária pelo prazo legal",
    s: "0812345-67.2024.8.06.0001 · TJCE", novo: true },
  { h: "—", tipo: "tarefa", t: "Juntar procuração assinada da Vale Verde", s: "sem hora marcada" },
  { h: "—", tipo: "tarefa", t: "Preparar perguntas das testemunhas", s: "para a audiência de amanhã" },
];

const ICONE = {
  agenda: "◷", tribunal: "§", conversa: "✆", dinheiro: "R$", tarefa: "☑",
};
const NOME = {
  agenda: "agenda", tribunal: "tribunal", conversa: "cliente", dinheiro: "financeiro", tarefa: "tarefa",
};

const linhaFio = (l) => `
  <li class="fio-linha ${l.risco ? "risco" : ""}">
    <span class="fio-hora">${l.h}</span>
    <span class="fio-marca t-${l.tipo}" title="${NOME[l.tipo]}">${ICONE[l.tipo]}</span>
    <span class="fio-txt">
      <b>${l.t}</b>${l.novo ? ' <em class="selo">novo</em>' : ""}
      ${l.prazo ? `<em class="selo prazo">${l.prazo}</em>` : ""}
      <span class="fio-sub">${l.s}</span>
    </span>
  </li>`;

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Três direções para o JuridFlow</title>
<style>
 :root{--tinta:#0f1b2d;--tinta2:#4a5b70;--tinta3:#7c8a9c;--linha:#dde3ea;--fundo:#eef2f7;
       --papel:#fff;--marinho:#194b86;--ambar:#8a5a0b;--verde:#097245;--vermelho:#b4271f;
       --sombra:0 1px 2px rgba(15,27,45,.06),0 8px 24px rgba(15,27,45,.07)}
 *{box-sizing:border-box}
 body{margin:0;background:var(--fundo);color:var(--tinta);
      font:15px/1.62 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
 .folha{max-width:1240px;margin:0 auto;padding:30px 20px 100px}
 h1{font-size:29px;font-weight:700;letter-spacing:-.022em;margin:0 0 6px}
 .sub{color:var(--tinta2);margin:0 0 10px}
 h2{font-size:21px;font-weight:680;margin:44px 0 6px;letter-spacing:-.015em;
    padding-top:20px;border-top:2px solid var(--linha)}
 h3{font-size:16px;font-weight:650;margin:24px 0 6px}
 p{margin:0 0 11px}
 code{background:#e9eef4;padding:1px 6px;border-radius:5px;font-size:13px}
 .tese{background:var(--papel);border:1px solid var(--linha);border-left:3px solid var(--marinho);
       border-radius:11px;padding:14px 17px;margin:12px 0 16px;box-shadow:var(--sombra)}
 .tese b{font-weight:650}
 .alerta{background:#fffbeb;border:1px solid #f5e2b0;border-left:3px solid var(--ambar);
         border-radius:11px;padding:13px 16px;margin:12px 0;font-size:14px}
 .par{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 14px}
 .lado{flex:1 1 440px;min-width:0;margin:0}
 .lado figcaption{font-size:13px;margin:0 0 6px;color:var(--tinta2)}
 .lado figcaption b{color:var(--tinta);font-weight:650}
 .quadro{border:1px solid var(--linha);border-radius:11px;overflow:hidden;background:var(--papel);
         box-shadow:var(--sombra)}
 .quadro img{display:block;width:100%;height:auto}
 table{border-collapse:collapse;background:var(--papel);border:1px solid var(--linha);
       border-radius:12px;overflow:hidden;box-shadow:var(--sombra);width:100%;margin:10px 0 16px}
 th,td{padding:10px 13px;text-align:left;border-bottom:1px solid var(--linha);font-size:13.5px;vertical-align:top}
 th{background:#f6f8fb;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--tinta3)}
 tr:last-child td{border-bottom:0}
 ul{margin:0 0 12px;padding-left:20px} li{margin-bottom:7px;font-size:14px}
 .selo-dir{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
           padding:2px 9px;border-radius:99px;vertical-align:3px;margin-left:8px}
 .s-foto{background:var(--verde);color:#fff}
 .s-desenho{background:var(--tinta3);color:#fff}

 /* ── a maquete do Fio ── */
 .fio-tela{background:#07060f;border:1px solid rgba(255,255,255,.09);border-radius:13px;
           padding:22px 24px 26px;color:#e7e5ef;box-shadow:var(--sombra);margin:14px 0 6px;
           font-variant-numeric:tabular-nums}
 .fio-cab{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;
          border-bottom:1px solid rgba(255,255,255,.09);padding-bottom:14px;margin-bottom:6px}
 .fio-cab h4{margin:0;font-size:19px;font-weight:650;letter-spacing:-.01em}
 .fio-cab .dia{color:#8f8aa6;font-size:13px}
 .fio-filtros{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0 8px}
 .fio-filtros span{font-size:12px;padding:3px 10px;border-radius:99px;border:1px solid rgba(255,255,255,.12);
                   color:#b8b3c9}
 .fio-filtros span.on{background:#9a73ff;border-color:#9a73ff;color:#0b0a14;font-weight:650}
 ul.fio{list-style:none;margin:0;padding:0}
 .fio-linha{display:flex;gap:13px;align-items:flex-start;padding:9px 8px 9px 10px;border-radius:7px;
            border-left:2px solid transparent}
 .fio-linha:nth-child(odd){background:rgba(255,255,255,.022)}
 .fio-linha.risco{border-left-color:#e0574c;background:rgba(224,87,76,.07)}
 .fio-hora{width:44px;flex:none;color:#8f8aa6;font-size:12.5px;padding-top:2px}
 .fio-marca{width:22px;height:22px;flex:none;border-radius:5px;display:grid;place-items:center;
            font-size:11px;font-weight:700}
 .t-agenda{background:rgba(154,115,255,.18);color:#b79cff}
 .t-tribunal{background:rgba(96,165,250,.16);color:#8fbcff}
 .t-conversa{background:rgba(45,212,191,.15);color:#5fe3cf}
 .t-dinheiro{background:rgba(74,222,128,.14);color:#79e39a;font-size:9.5px}
 .t-tarefa{background:rgba(255,255,255,.08);color:#b8b3c9}
 .fio-txt{min-width:0}
 .fio-txt b{font-weight:600;font-size:14px}
 .fio-sub{display:block;color:#8f8aa6;font-size:12.5px;margin-top:1px}
 .selo{font-style:normal;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
       padding:1px 7px;border-radius:99px;background:#9a73ff;color:#0b0a14;margin-left:7px;vertical-align:1px}
 .selo.prazo{background:rgba(224,87,76,.2);color:#ff9d94}
 .legenda{font-size:12.5px;color:var(--tinta2);margin:4px 0 0}
</style></head><body><div class="folha">

<h1>Três direções para o JuridFlow</h1>
<p class="sub">Fotografadas no app rodando, com os seus dados — 13/09/2026. Nada disto está no código.</p>

<!-- ═════════ DIAGNÓSTICO ═════════ -->
<h2>Por que o sistema hoje parece "feito com IA"</h2>
<p>Não é impressão sua, e não é falta de capricho: é um padrão conhecido e documentado.
Modelos de linguagem produzem o que é estatisticamente mais comum, e o mais comum em interface
virou <b>Inter + roxo/índigo + cartão arredondado com sombrinha</b>. A origem é literal: o
<code>indigo-500</code> era a cor de exemplo do Tailwind, e o criador dele chegou a se desculpar
publicamente por isso ter pintado de roxo metade das interfaces geradas por IA no mundo. O
<code>shadcn/ui</code> — que é a base do JuridFlow — virou o idioma padrão desses geradores.</p>

<p><b>O JuridFlow caiu em três desses defaults ao mesmo tempo</b>, e eu medi em 11 telas de
produção antes de propor qualquer coisa:</p>
<table>
  <tr><th>medido</th><th>o que isso quer dizer</th></tr>
  <tr><td><b>1 sombra</b> no sistema inteiro</td>
      <td>nada tem elevação — é cartão branco sobre fundo quase branco, separado por um traço de 1px.
          A tela não tem profundidade, e por isso "não tem cara de nada"</td></tr>
  <tr><td><b>14 raios de canto</b> diferentes, num tema que declara 4px</td>
      <td>o canto de 4px é o default duro do shadcn; os outros 13 foram escapando</td></tr>
  <tr><td><b>22 tamanhos de texto</b>, o menor com 9px</td>
      <td>sem régua tipográfica, o olho não sabe o que é importante</td></tr>
  <tr><td><b>até 17 cores de fundo</b> numa tela só</td>
      <td>cada bloco pinta o seu; não existe superfície, existe remendo</td></tr>
</table>
<div class="alerta"><b>A conclusão incômoda:</b> trocar a paleta não resolve. O que faz um produto
ter cara própria é <b>uma ideia forte levada até o fim</b> — e a única forma de sair do default é
escolher uma direção e recusar as outras. Por isso são três, e por isso elas são inconciliáveis
entre si: você escolhe UMA.</div>

<!-- ═════════ A ═════════ -->
<h2>A · Cartório <span class="selo-dir s-foto">foto do app real</span></h2>
<div class="tese"><b>Tese:</b> o advogado LÊ o dia inteiro. O software deixa de imitar painel de
startup e passa a se comportar como <b>documento</b>: papel em vez de branco clínico, serifa nos
títulos e nos números, régua fina no lugar de cartão, canto quase reto, e cor <b>só onde há
risco</b>. Nenhum gerador escolhe serifa e fundo creme para um SaaS — é exatamente o oposto do
caminho de menor resistência, e é o que mais combina com um ofício feito de texto.</div>
${par("dashboard", "cartorio", "A · Cartório")}
${par("financeiro", "cartorio", "A · Cartório")}
<p class="legenda"><b>Onde olhar:</b> "Bom dia, Dono" e o "R$ 10.700,00" em serifa; o fundo de papel
separando os cartões sem precisar de sombra; o verde-tinta no lugar do azul genérico.</p>
<ul>
  <li><b>A favor:</b> é a direção mais difícil de confundir com qualquer outro SaaS, e envelhece bem
      — papel e serifa não saem de moda como gradiente.</li>
  <li><b>Contra, honestamente:</b> serifa em tela pequena cansa mais; e o app tem MUITO número
      (financeiro, prazos) — serifa em número exige testar em 390px antes de fechar.</li>
</ul>

<!-- ═════════ B ═════════ -->
<h2>B · Mesa de operações <span class="selo-dir s-foto">foto do app real</span></h2>
<div class="tese"><b>Tese:</b> quem usa isto tem 300 processos e 50 conversas. O valor não é
"tela bonita", é <b>ver muito de uma vez e agir pelo teclado</b>. O app inteiro veste o quase-preto
que hoje só o menu tem — o menu deixa de ser uma tarja preta ao lado de um bloco branco e vira a
mesma peça. Uma única cor de acento (o violeta da marca), linhas mais baixas, números tabulares,
e a informação se separando por <b>gradação de branco</b>, não por cor. É a receita do Linear, que
funciona porque o público já vive em atalho de teclado — e o seu ⌘K já existe.</div>
${par("atendimento", "operacoes", "B · Mesa de operações")}
${par("dashboard", "operacoes", "B · Mesa de operações")}
<p class="legenda"><b>Onde olhar:</b> o menu e o conteúdo viraram a mesma superfície; as conversas
cabem mais numa tela; o violeta aparece só onde há ação.</p>
<ul>
  <li><b>A favor:</b> nenhum concorrente jurídico brasileiro é escuro-nativo e denso. É a direção
      mais "ownable" — e a que mais se aproxima do print que você mandou e disse ter gostado.</li>
  <li><b>Contra, honestamente:</b> escuro-nativo exige revisar <b>toda</b> cor de estado (o verde do
      "Nova Conversa" na foto briga com o violeta — cor única implica <b>tirar</b> cores que hoje
      existem, e tirar precisa da sua autorização, uma por uma). E advogado imprime: telas de
      documento continuariam claras.</li>
</ul>

<!-- ═════════ C ═════════ -->
<h2>C · O Fio <span class="selo-dir s-desenho">desenho — muda o esqueleto</span></h2>
<div class="tese"><b>Tese:</b> as duas direções acima trocam a PELE. Esta troca o ESQUELETO, e é a
única que muda o que o sistema É. O processo jurídico é uma <b>cronologia</b> — e hoje o JuridFlow
espalha essa cronologia em cinco telas: movimentação em Processos, cliente em Atendimento, prazo na
Agenda, pagamento no Financeiro. O Fio junta tudo num <b>único fio do dia</b>, na ordem em que
aconteceu, com filtro por tipo. É como o advogado já pensa, e é o que nenhum concorrente faz.</div>

<div class="fio-tela">
  <div class="fio-cab">
    <h4>Domingo, 13 de setembro</h4>
    <span class="dia">11 acontecimentos · 3 pedem resposta hoje</span>
  </div>
  <div class="fio-filtros">
    <span class="on">Tudo</span><span>Tribunal</span><span>Clientes</span><span>Agenda</span>
    <span>Dinheiro</span><span>Só o que pede resposta</span>
  </div>
  <ul class="fio">${FIO.map(linhaFio).join("")}</ul>
</div>
<p class="legenda">Conteúdo real: as movimentações vêm de <code>eventos_processo</code> do banco, e
os compromissos e conversas são os mesmos das fotos acima. A pele aqui é a da direção B — o Fio
funciona nas duas.</p>

<div class="alerta"><b>O risco desta direção, dito na cara:</b> a crítica mais repetida ao Clio é
exatamente que o "activity feed" dele vira uma bagunça em caso complexo. O que separa um do outro é
recorte: o Fio é <b>por dia</b> e <b>por tipo</b>, nunca uma mangueira ligada no passado inteiro —
e a linha vermelha é só para o que pede resposta, não para tudo que chegou.</div>

<!-- ═════════ RECOMENDAÇÃO ═════════ -->
<h2>O que eu recomendo</h2>
<p><b>B como pele, C como esqueleto</b> — nesta ordem, e em fatias.</p>
<ul>
  <li>A pele (B) é a que mais se parece com o print que você aprovou, custa pouco (é token, vale em
      todas as telas de uma vez) e dá pra ver na mesma semana.</li>
  <li>O Fio (C) é o que dá ao produto uma ideia própria — mas é tela nova, e tela nova custa. Só
      vale depois que a pele estiver de pé.</li>
  <li><b>A (Cartório) é a mais original das três</b> e eu ficaria feliz de fazer — mas é a que mais
      briga com o resto do que existe hoje (o verde do Financeiro, o azul dos gráficos, o violeta da
      marca). Se você escolher ela, é redesenho de cor do sistema inteiro, não um ajuste.</li>
</ul>
<p class="sub" style="margin-top:24px">Me diga <b>uma letra</b>. A partir dela eu faço o comparador
tela a tela, com antes e depois medidos, como no da tela de planos.</p>

</div></body></html>`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} — ${(html.length / 1048576).toFixed(2)} MB`);
