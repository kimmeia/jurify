/**
 * Monta o comparador do que ficou pra trás: a tela de editar plano e o piloto
 * da linguagem visual.
 *
 *   node gera-mockup-pendentes.mjs <pastaTela> <pastaPiloto> <pastaRecorte> <saida.html>
 *
 * Regras da casa que este arquivo cumpre (CLAUDE.md, "Navegar não é comparar"):
 * uma comparação por achado, os dois lados ao mesmo tempo e na MESMA escala,
 * a linha tracejada da borda da tela (é ela que torna o vazamento visível —
 * um quadro de 390px CORTA justamente o defeito), régua medida e uma frase
 * "onde olhar". As imagens são captura do app rodando, nunca desenho.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [TELA, PILOTO, RECORTE, SAIDA] = process.argv.slice(2);
const img = (caminho) => "data:image/jpeg;base64," + readFileSync(caminho).toString("base64");

/** Painel com a linha tracejada da borda da tela. */
function painel(rotulo, arquivo, larguraDaImagem, larguraDaJanela, nota) {
  const corte = Math.min(100, (larguraDaJanela / larguraDaImagem) * 100);
  const sobra = larguraDaImagem - larguraDaJanela;
  return `
    <figure class="lado">
      <figcaption><b>${rotulo}</b> ${nota ? `<span class="nota">${nota}</span>` : ""}</figcaption>
      <div class="quadro">
        <img src="${img(arquivo)}" alt="${rotulo}">
        ${sobra > 0 ? `<div class="fora" style="left:${corte}%"></div>` : ""}
        <div class="borda" style="left:${corte}%"><span>borda da tela · ${larguraDaJanela}px</span></div>
      </div>
      <p class="regua">${sobra > 0
        ? `<b class="ruim">${sobra}px para fora da tela</b> — o que está à direita da linha só aparece rolando de lado`
        : `<b class="bom">cabe inteiro</b> — nada além da borda`}</p>
    </figure>`;
}

/** Par simples, sem linha de borda (usado nos recortes e no piloto). */
function par(rotuloA, arqA, notaA, rotuloB, arqB, notaB, alturaMax) {
  const est = alturaMax ? ` style="max-height:${alturaMax}px;object-fit:contain;object-position:top left"` : "";
  return `
    <div class="par">
      <figure class="lado">
        <figcaption><b>${rotuloA}</b> <span class="nota">${notaA}</span></figcaption>
        <div class="quadro simples"><img src="${img(arqA)}" alt="${rotuloA}"${est}></div>
      </figure>
      <figure class="lado">
        <figcaption><b>${rotuloB}</b> <span class="nota">${notaB}</span></figcaption>
        <div class="quadro simples"><img src="${img(arqB)}" alt="${rotuloB}"${est}></div>
      </figure>
    </div>`;
}

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>O que ficou pra trás — editar plano e a linguagem visual</title>
<style>
  :root{--tinta:#0f1b2d;--tinta2:#4a5b70;--tinta3:#7c8a9c;--linha:#dde3ea;--fundo:#eef2f7;
        --papel:#fff;--marinho:#194b86;--ambar:#8a5a0b;--verde:#097245;--vermelho:#b4271f;
        --sombra:0 1px 2px rgba(15,27,45,.06),0 8px 24px rgba(15,27,45,.07)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--fundo);color:var(--tinta);
       font:15px/1.6 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  .folha{max-width:1280px;margin:0 auto;padding:28px 20px 90px}
  h1{font-size:27px;font-weight:700;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:var(--tinta2);margin:0 0 8px}
  h2{font-size:20px;font-weight:680;margin:42px 0 4px;letter-spacing:-.015em;
     padding-top:18px;border-top:2px solid var(--linha)}
  h3{font-size:16px;font-weight:650;margin:26px 0 3px}
  p{margin:0 0 10px}
  code{background:#e9eef4;padding:1px 6px;border-radius:5px;font-size:13px}
  .olhe{background:#fffbeb;border:1px solid #f5e2b0;border-left:3px solid var(--ambar);
        border-radius:10px;padding:10px 14px;margin:10px 0 14px;font-size:14px}
  .olhe b{font-weight:650}
  .par{display:flex;gap:16px;flex-wrap:wrap;margin:0 0 6px}
  .lado{flex:1 1 460px;min-width:0;margin:0}
  .lado figcaption{font-size:13.5px;margin:0 0 7px;display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}
  .nota{color:var(--tinta3);font-size:12.5px}
  .quadro{position:relative;border:1px solid var(--linha);border-radius:12px;overflow:hidden;
          background:var(--papel);box-shadow:var(--sombra)}
  .quadro img{display:block;width:100%;height:auto}
  .quadro.simples img{border-radius:11px}
  .fora{position:absolute;top:0;bottom:0;right:0;background:rgba(180,39,31,.13);
        border-left:0;pointer-events:none}
  .borda{position:absolute;top:0;bottom:0;width:0;border-left:2px dashed var(--vermelho);
         pointer-events:none}
  .borda span{position:absolute;top:6px;left:5px;background:var(--vermelho);color:#fff;
              font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:5px;white-space:nowrap}
  .regua{font-size:13px;color:var(--tinta2);margin:8px 0 0}
  .ruim{color:var(--vermelho)}
  .bom{color:var(--verde)}
  table{border-collapse:collapse;background:var(--papel);border:1px solid var(--linha);
        border-radius:12px;overflow:hidden;box-shadow:var(--sombra);width:100%;margin:10px 0 16px}
  th,td{padding:10px 13px;text-align:left;border-bottom:1px solid var(--linha);font-size:13.5px;
        vertical-align:top}
  th{background:#f6f8fb;font-size:11px;font-weight:700;letter-spacing:.07em;
     text-transform:uppercase;color:var(--tinta3)}
  tr:last-child td{border-bottom:0}
  .cx{background:var(--papel);border:1px solid var(--linha);border-radius:12px;padding:15px 18px;
      box-shadow:var(--sombra);margin:12px 0}
  .cx.parado{border-left:3px solid var(--tinta3)}
  .cx.aprova{border-left:3px solid var(--verde)}
  ul{margin:0 0 10px;padding-left:20px}
  li{margin-bottom:6px;font-size:14px}
  .selo{display:inline-block;background:var(--verde);color:#fff;font-size:10.5px;font-weight:700;
        letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:99px;
        vertical-align:2px}
  .selo.cinza{background:var(--tinta3)}
</style>
</head>
<body>
<div class="folha">

<h1>O que ficou pra trás</h1>
<p class="sub">A tela de editar plano e a linguagem visual, fotografadas no app rodando — 13/09/2026.<br>
Tudo aqui é <b>proposta</b>: está numa branch descartável, nada foi mergeado.</p>

<!-- ══════════════ PARTE 1 ══════════════ -->
<h2>1 · A tela de editar plano <span class="selo">pronta pra aprovar</span></h2>
<p>Você mandou o print e disse "aqui também está feio". Antes de mexer eu medi, e o
número explica o print inteiro: a tela pede <b>2110px de largura numa janela de 1440px</b>.
Os 670px que sobram são justamente a coluna da direita — "Clientes ativos", "Consultas de
processo / mês", a soma dos módulos — que no seu print aparecem cortados.</p>

<div class="olhe"><b>A causa, medida:</b> na lista "Destaques do cartão", o texto de cada linha
usa <code>truncate</code> (não quebra) dentro de um flex sem largura mínima. Um item de flex
nasce com <code>min-width: auto</code>, então esse texto <b>exige</b> a largura inteira dele —
1467px medidos — e empurra o cartão, a coluna, o grid e a página. Não é a tela que é larga
demais: é uma linha de texto que se recusa a quebrar.</div>

<h3>Achado 1 · No computador, 670px ficam fora da tela</h3>
<div class="par">
  ${painel("Hoje", `${TELA}/editor-monitor-antes.jpg`, 2110, 1440, "janela de 1440px")}
  ${painel("Proposta", `${TELA}/editor-monitor-depois.jpg`, 1440, 1440, "mesma janela")}
</div>
<p class="regua"><b>Onde olhar:</b> a linha vermelha é onde a sua tela acaba. À esquerda, tudo
que está depois dela você só vê rolando de lado — inclusive três campos de limite e o preço
dos módulos.</p>

<h3>Achado 2 · No celular, 1215px ficam fora</h3>
<div class="par">
  ${painel("Hoje", `${TELA}/editor-celular-antes.jpg`, 1605, 390, "celular de 390px")}
  ${painel("Proposta", `${TELA}/editor-celular-depois.jpg`, 390, 390, "mesmo celular")}
</div>
<p class="regua"><b>Onde olhar:</b> hoje a tela inteira fica espremida numa faixa estreita à
esquerda; a proposta empilha as três colunas e os campos ocupam a largura do aparelho.</p>

<h3>Achado 3 · O aviso caindo por cima do código do plano</h3>
${par(
  "Hoje", `${RECORTE}/codigo-interno-antes.jpg`,
  "coluna com 184px — o aviso não cabe ao lado e monta em cima do «atende»",
  "Proposta", `${RECORTE}/codigo-interno-depois.jpg`,
  "coluna com 278px e o aviso virou linha embaixo, como os outros",
)}

<h3>Achado 4 · O destaque comprido, que é quem empurra a tela</h3>
${par(
  "Hoje", `${RECORTE}/destaque-longo-antes.jpg`,
  "uma linha só, 1531px de largura exigida — e ainda assim cortada na tela",
  "Proposta", `${RECORTE}/destaque-longo-depois.jpg`,
  "quebra em 3 linhas dentro de 700px: nada escondido",
)}
<div class="olhe">Aqui há uma <b>decisão sua</b>: eu troquei "cortar com …" por
<b>quebrar em linhas</b>. Cortar caberia igual, mas este é o texto que você está editando —
esconder o fim dele numa tela de edição me parece pior do que a linha ficar mais alta.
Se preferir cortar, é uma palavra de diferença.</div>

<h3>O que muda no código</h3>
<table>
  <tr><th>o quê</th><th>antes</th><th>depois</th></tr>
  <tr><td>Texto do destaque</td><td><code>flex-1 truncate</code></td>
      <td><code>min-w-0 flex-1 break-words</code></td></tr>
  <tr><td>As três colunas</td><td><code>1fr 1.15fr 0.95fr</code></td>
      <td><code>300px minmax(0,1fr) 330px</code></td></tr>
  <tr><td>Código interno</td><td>campo e aviso na mesma faixa de 36px</td>
      <td>aviso vira linha de apoio embaixo</td></tr>
  <tr><td>Grade de limites</td><td>2 colunas fixas até <code>sm</code></td>
      <td>1 → 2 → 3 colunas conforme a largura</td></tr>
</table>
<p class="regua">Quatro classes. Nenhum campo, aviso ou botão foi removido — a prévia do cartão,
os módulos e os destaques continuam todos lá.</p>

<!-- ══════════════ PARTE 2 ══════════════ -->
<h2>2 · A linguagem visual <span class="selo cinza">piloto, pra você julgar a direção</span></h2>
<p>Você mandou o print de um painel escuro e disse "gostei dessa ideia de layout e dessa fonte".
Duas boas notícias antes de qualquer proposta: <b>a fonte já está no projeto</b> (Poppins, a
mesma família geométrica do anúncio, hoje usada só na marca e no login) e <b>o tema escuro
já existe</b> — é uma preferência sua em Configurações, não um recurso a construir.</p>

<p>O que falta é o que o raio-X mediu em 11 telas de produção:</p>
<table>
  <tr><th>medido hoje</th><th>o que isso causa</th><th>no piloto</th></tr>
  <tr><td><b>1 sombra</b> no sistema inteiro</td>
      <td>nada tem elevação: cartão branco sobre fundo quase branco, separado por um traço de 1px</td>
      <td>sombra de verdade em dois níveis; a borda some no tema claro</td></tr>
  <tr><td><b>14 raios de canto</b> diferentes</td>
      <td>o tema declara 4px e o print que você gostou usa ~12px — por isso ele parece macio e o nosso, duro</td>
      <td>uma família só, a partir de 12px</td></tr>
  <tr><td><b>22 tamanhos de texto</b></td>
      <td>o menor é 9px, abaixo do piso de 11px que combinamos</td>
      <td>não mexi ainda — é a próxima fatia, e mexe em muita tela</td></tr>
</table>

<h3>No tema claro — Dashboard</h3>
${par("Hoje", `${PILOTO}/dashboard-claro-antes.jpg`, "cantos de 4px, sem elevação",
      "Piloto", `${PILOTO}/dashboard-claro-depois.jpg`, "12px, sombra em dois níveis, títulos em Poppins")}
<div class="olhe"><b>Onde olhar:</b> os cartões param de encostar uns nos outros e o olho acha
sozinho onde um termina. É a mesma informação — não tirei nem acrescentei nada.</div>

<h3>No tema claro — Clientes</h3>
${par("Hoje", `${PILOTO}/clientes-claro-antes.jpg`, "",
      "Piloto", `${PILOTO}/clientes-claro-depois.jpg`, "")}

<h3>O tema escuro, que já existe — Financeiro</h3>
${par("Hoje", `${PILOTO}/financeiro-escuro-antes.jpg`, "escuro de hoje",
      "Piloto", `${PILOTO}/financeiro-escuro-depois.jpg`, "escuro com a elevação nova")}
<div class="olhe"><b>Achado que apareceu na foto:</b> no escuro, o valor
<b>"R$ 10,7 mil" do cartão verde some no próprio verde</b> — verde escuro sobre verde — e o
"R$ 7,8 mil" ao lado sai violeta. Isso já estava anotado como pendência de cor e <b>não
consertei aqui</b>: é decisão de paleta, não de layout. Se quiser, entra na próxima.</div>

<!-- ══════════════ PARTE 3 ══════════════ -->
<h2>3 · O que eu recomendo</h2>
<div class="cx aprova">
  <p><b>Aprovar a Parte 1 inteira.</b> São quatro classes, conserta um defeito que você viu
  sozinho no print, e não muda nada do que a tela faz.</p>
  <p style="margin:0"><b>Na Parte 2, decidir só a direção</b> — "sim, é por aí" ou "não gostei".
  Se for sim, eu aplico em fatias e cada fatia vem com foto antes/depois, como esta. Não faz
  sentido virar 40 telas de uma vez.</p>
</div>
<div class="cx parado">
  <p style="margin:0"><b>Continua parado, e não é por esquecimento:</b> o menu do Devular
  (<code>crm-saas</code>). O código está escrito na branch <code>claude/cor-do-menu-13-09</code>,
  mas <b>não consigo subir aquele app aqui</b> — o proxy bloqueia o servidor de onde uma das
  dependências vem, e sem instalar não há como rodar teste, build, nem tirar foto. Mergear sem
  ter visto quebra a regra que você mesmo criou. Ou você roda aí, ou me autoriza no escuro.</p>
</div>

<p class="sub" style="margin-top:30px">Nada disto está em <code>develop</code> nem em
<code>main</code>. É a regra: você vê primeiro.</p>
</div>
</body>
</html>`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} — ${(html.length / 1048576).toFixed(2)} MB`);
