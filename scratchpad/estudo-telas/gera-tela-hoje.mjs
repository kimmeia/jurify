/**
 * Comparação da tela "Hoje": o Dashboard atual × a tela reconstruída.
 *
 *   node gera-tela-hoje.mjs <pastaComp> <saida.html>
 *
 * Existe porque a rodada anterior entregou camada de token — mesma tela, outra
 * paleta — e o dono acusou na hora. O que muda aqui é o ESQUELETO; por isso a
 * tabela da página compara estrutura, não cor.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [DIR, SAIDA] = process.argv.slice(2);
const img = (n) => "data:image/jpeg;base64," + readFileSync(`${DIR}/${n}.jpg`).toString("base64");

const LINHAS = [
  ["Fileira de cartões de KPI com quatro números",
   "<b>Uma frase que se lê</b>: “2 clientes esperam há mais de 4 horas, 1 prazo vence em 3 dias e " +
   "R$ 1.600 estão vencidos”. O mesmo dado, sem quatro caixas."],
  ["Agenda num cartão; movimentação do tribunal em outra tela; conversa do cliente em outra; " +
   "pagamento em outra",
   "<b>Um fio do dia</b>, com coluna de hora e a marca <b>AGORA</b>: audiência, movimentação do " +
   "TJCE, fala do cliente e pagamento na ordem em que aconteceram."],
  ["O prazo aparece como data escrita no meio de uma frase",
   "<b>Régua de contagem regressiva</b> — 3, 8, 14 em número grande, fixa à direita. É o que " +
   "destrói um escritório; então é o que não sai da tela."],
  ["Gráfico de área ocupando um terço da tela",
   "<b>Sumiu.</b> Curva de 13 dias não muda decisão no meio do expediente. O caixa virou uma " +
   "linha no rodapé, com os mesmos quatro números."],
  ["Quem está esperando resposta só aparece entrando no Atendimento",
   "<b>“Esperando você”</b> fixo, com o tempo de espera em vermelho quando passa do limite."],
  ["Saudação “Bom dia, Dono” ocupando a primeira dobra",
   "O nome sai do topo. A primeira coisa que a tela diz é <b>o que está errado agora</b>."],
];

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hoje — a tela refeita, não repintada</title>
<style>
 :root{--tinta:#0f1b2d;--tinta2:#4a5b70;--tinta3:#7c8a9c;--linha:#dde3ea;--fundo:#eef2f7;
       --papel:#fff;--vermelho:#b4271f;--verde:#097245;
       --sombra:0 1px 2px rgba(15,27,45,.06),0 8px 24px rgba(15,27,45,.07)}
 *{box-sizing:border-box} body{margin:0;background:var(--fundo);color:var(--tinta);
   font:15px/1.62 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
 .folha{max-width:1180px;margin:0 auto;padding:30px 20px 90px}
 h1{font-size:28px;letter-spacing:-.022em;margin:0 0 5px;font-weight:700}
 .sub{color:var(--tinta2);margin:0 0 22px}
 h2{font-size:19px;margin:38px 0 8px;padding-top:18px;border-top:2px solid var(--linha);
    letter-spacing:-.015em;font-weight:680}
 p{margin:0 0 11px}
 .cx{background:var(--papel);border:1px solid var(--linha);border-radius:12px;padding:15px 18px;
     box-shadow:var(--sombra);margin:12px 0}
 .cx.mea{border-left:3px solid var(--vermelho)}
 figure{margin:0 0 18px} figcaption{font-size:13px;color:var(--tinta2);margin:0 0 7px}
 figcaption b{color:var(--tinta)}
 .q{border:1px solid var(--linha);border-radius:12px;overflow:hidden;box-shadow:var(--sombra);
    background:var(--papel)}
 .q img{display:block;width:100%;height:auto}
 table{border-collapse:collapse;background:var(--papel);border:1px solid var(--linha);
       border-radius:12px;overflow:hidden;box-shadow:var(--sombra);width:100%;margin:10px 0 16px}
 th,td{padding:11px 14px;text-align:left;border-bottom:1px solid var(--linha);font-size:14px;
       vertical-align:top}
 th{background:#f6f8fb;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
    color:var(--tinta3)}
 tr:last-child td{border-bottom:0}
 td.a{color:var(--tinta2);width:43%}
 ul{margin:0 0 10px;padding-left:20px} li{margin-bottom:7px;font-size:14px}
</style></head><body><div class="folha">

<h1>Hoje — a tela refeita, não repintada</h1>
<p class="sub">Você disse que não havia diferença nenhuma além de cor. Estava certo.</p>

<div class="cx mea"><b>O que eu errei:</b> mandei três "direções" em que duas eram a MESMA tela com
outra paleta — camada de token não redesenha nada, só troca a tinta. Pior: eu sabia disso e escrevi
no próprio arquivo em vez de resolver. O que vem abaixo é tela nova.</div>

<h2>A de hoje</h2>
<figure>
  <figcaption>Dashboard atual — saudação, cartão de dinheiro, gráfico, cartão de agenda e três cartões</figcaption>
  <div class="q"><img src="${img("antes")}" alt="dashboard atual"></div>
</figure>

<h2>A proposta</h2>
<figure>
  <figcaption><b>Hoje</b> — uma frase, o dia como linha do tempo, régua de prazos e o caixa numa linha</figcaption>
  <div class="q"><img src="${img("depois")}" alt="tela nova"></div>
</figure>

<h2>O que mudou de estrutura — nenhuma linha aqui é sobre cor</h2>
<table>
  <tr><th>hoje</th><th>proposta</th></tr>
  ${LINHAS.map(([a, b]) => `<tr><td class="a">${a}</td><td>${b}</td></tr>`).join("\n  ")}
</table>

<div class="cx"><b>O que NÃO é invenção:</b> compromissos, movimentações com CNJ, falas dos clientes,
valores e nomes saíram do seu banco e das telas que eu fotografei. O que é desenho aqui é a
ESTRUTURA — e é exatamente isso que estava faltando nas propostas anteriores.</div>

<h2>O preço, dito antes de você aprovar</h2>
<ul>
  <li>É <b>tela nova</b>, não ajuste: rota, componente e uma leitura no servidor que junta quatro
      fontes (agenda, movimentações, conversas, cobranças) numa linha do tempo só. Ordem de
      grandeza: dias, não horas.</li>
  <li><b>O Dashboard atual não morre.</b> Ele vira "Visão do mês" e continua com gráfico e abas —
      nada é removido sem você mandar, uma coisa de cada vez.</li>
  <li>A frase do topo precisa de <b>regra</b>: quanto tempo de espera conta como "esperando", quantos
      dias contam como prazo crítico. Eu proponho os números; a decisão é sua.</li>
  <li>Falta o celular. Num aparelho de 390px o fio vira uma coluna só e a régua de prazos entra
      antes do dia — isso eu desenho junto, não depois.</li>
</ul>

<p class="sub" style="margin-top:22px">Mandei junto o arquivo <b>tela-hoje.html</b>: é esta tela em
tamanho real no navegador, não uma foto dela.</p>

</div></body></html>`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} — ${(html.length / 1048576).toFixed(2)} MB`);
