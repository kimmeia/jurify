/**
 * Monta o comparador da proposta de aniversário.
 *
 * Uma comparação por achado, os dois lados ao mesmo tempo, o MESMO recorte,
 * anel medido no navegador (alvos.json) e botão Piscar. As fotos saíram do app
 * rodando — "antes" na branch publicada (porta 3001), "depois" na branch
 * descartável (porta 3000).
 */
import { readFileSync, writeFileSync } from "node:fs";

const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
const alvosAntes = JSON.parse(readFileSync("antes/alvos.json", "utf8"));
const alvosDepois = JSON.parse(readFileSync("depois/alvos.json", "utf8"));

const COMPARACOES = [
  {
    id: "novo-cliente",
    titulo: "1 · O campo, onde ele nasce",
    tela: "Clientes → Novo cliente (computador)",
    ondeOlhar:
      "Na qualificação civil. Hoje Nacionalidade ocupa a linha inteira; na proposta ela divide a linha com Data de nascimento, e embaixo do campo aparece a leitura do que foi digitado.",
    nota:
      "O MESMO bloco aparece na edição da ficha — é um componente só, usado nas duas telas. Fica opcional: quem não souber a data deixa em branco, e nada trava.",
  },
  {
    id: "ficha",
    titulo: "2 · O aniversário na ficha",
    tela: "Clientes → ficha do cliente (computador)",
    ondeOlhar:
      "Na linha de contato do cabeçalho, depois do CPF. Longe do dia mostra «12 de março · 41 anos»; a 7 dias ou menos vira contagem regressiva e ganha o atalho «mandar parabéns».",
    nota:
      "Sem data gravada não existe selo nenhum: a linha fica exatamente como é hoje.",
  },
  {
    id: "lista",
    titulo: "3 · Quem faz aniversário",
    tela: "Clientes → barra de filtros (computador)",
    ondeOlhar:
      "Entre «Cadastro» e «Mais» entra o filtro «Aniversário», com três opções: hoje, próximos 7 dias e neste mês.",
    nota:
      "É o mesmo cálculo do selo da ficha e do lembrete — uma função só, pra tela e servidor nunca discordarem.",
  },
  {
    id: "notificacoes",
    titulo: "4 · O lembrete, com interruptor",
    tela: "Configurações → Notificações (computador)",
    ondeOlhar:
      "Depois de «Atendimento» entra um grupo novo, «Clientes», com o aviso «Aniversário de cliente» — ligado de fábrica e desligável a qualquer momento, como todos os outros.",
    nota:
      "Ele entra na tela que você aprovou ontem, com a mesma mecânica: só o que você MUDA fica gravado.",
  },
];

const SOZINHAS = [
  {
    id: "filtro",
    titulo: "Como o filtro abre",
    arquivo: "depois/filtro.png",
    texto: "As três opções do filtro novo. Só entra quem tem a data preenchida — o rodapé do menu diz isso.",
  },
  {
    id: "sino",
    titulo: "O lembrete como ele chega",
    arquivo: "depois/sino.png",
    texto:
      "De manhã, uma vez por dia, com TODOS os aniversariantes do dia num aviso só — cinco aniversários não podem virar cinco toques no celular. Esta foto é do sino do app rodando.",
  },
];

const anel = (r) =>
  `<div class="anel" style="left:${r.left.toFixed(2)}%;top:${r.top.toFixed(2)}%;width:${r.width.toFixed(2)}%;height:${r.height.toFixed(2)}%"></div>`;

const blocos = COMPARACOES.map((c) => {
  const a = b64(`antes/${c.id}.png`);
  const d = b64(`depois/${c.id}.png`);
  return `
<section class="comp" id="c-${c.id}">
  <header>
    <h2>${c.titulo}</h2>
    <p class="tela">${c.tela}</p>
  </header>
  <p class="olhar"><b>Onde olhar:</b> ${c.ondeOlhar}</p>
  <div class="par" data-par="${c.id}">
    <figure>
      <figcaption>HOJE</figcaption>
      <div class="foto"><img src="${a}" alt="antes"/>${anel(alvosAntes[c.id])}</div>
    </figure>
    <figure>
      <figcaption class="novo">PROPOSTA</figcaption>
      <div class="foto"><img src="${d}" alt="depois"/>${anel(alvosDepois[c.id])}</div>
    </figure>
  </div>
  <div class="acoes">
    <button type="button" onclick="piscar('${c.id}', this)">Piscar (sobrepõe os dois)</button>
    <span class="nota">${c.nota}</span>
  </div>
  <div class="pisca" id="pisca-${c.id}" hidden>
    <img src="${a}" class="p-antes" alt="antes"/>
    <img src="${d}" class="p-depois" alt="depois"/>
  </div>
</section>`;
}).join("\n");

const sozinhas = SOZINHAS.map(
  (s) => `
<section class="comp so-uma">
  <header><h2>${s.titulo}</h2></header>
  <p class="olhar">${s.texto}</p>
  <div class="foto sozinha"><img src="${b64(s.arquivo)}" alt="${s.titulo}"/></div>
</section>`,
).join("\n");

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Aniversário do cliente — proposta para aprovar</title>
<style>
  :root {
    --tinta: #16181d; --apoio: #5b6373; --linha: #e3e6ec; --fundo: #f6f7f9;
    --marca: #1e2a5a; --novo: #146c43; --anel: #d1483f;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--fundo); color: var(--tinta);
         font: 15px/1.6 -apple-system, "Segoe UI", Roboto, Inter, sans-serif; }
  .capa { background: #0f1526; color: #fff; padding: 32px 24px 28px; }
  .capa .env { max-width: 1180px; margin: 0 auto; }
  .capa h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: -0.3px; }
  .capa p { margin: 0 0 6px; color: #c3cad9; max-width: 72ch; }
  .capa .sel { display: inline-block; font-size: 11px; font-weight: 700;
               letter-spacing: .1em; text-transform: uppercase; color: #9fb0d6;
               border: 1px solid #33406b; border-radius: 3px; padding: 3px 8px;
               margin-bottom: 12px; }
  main { max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; }
  .comp { background: #fff; border: 1px solid var(--linha); border-radius: 10px;
          padding: 20px; margin-bottom: 22px; }
  .comp header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
  .comp h2 { margin: 0; font-size: 18px; }
  .tela { margin: 0; color: var(--apoio); font-size: 13px; }
  .olhar { margin: 10px 0 14px; color: #2c3242; font-size: 14px; max-width: 90ch; }
  .par { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  figure { margin: 0; }
  figcaption { font-size: 11px; font-weight: 800; letter-spacing: .1em;
               text-transform: uppercase; color: var(--apoio); margin-bottom: 6px; }
  figcaption.novo { color: var(--novo); }
  .foto { position: relative; border: 1px solid var(--linha); border-radius: 6px;
          overflow: hidden; background: #fff; }
  .foto img { display: block; width: 100%; }
  .foto.sozinha { max-width: 520px; }
  .anel { position: absolute; border: 2.5px solid var(--anel); border-radius: 5px;
          box-shadow: 0 0 0 3px rgba(209,72,63,.16); pointer-events: none; }
  .acoes { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 12px; }
  .acoes button { font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
                  border: 1px solid var(--marca); color: var(--marca); background: #fff;
                  border-radius: 6px; padding: 6px 12px; }
  .acoes button:hover { background: #eef1f8; }
  .nota { color: var(--apoio); font-size: 13px; flex: 1 1 320px; min-width: 0; }
  .pisca { position: relative; margin-top: 14px; border: 1px solid var(--linha);
           border-radius: 6px; overflow: hidden; }
  .pisca img { display: block; width: 100%; }
  .pisca .p-depois { position: absolute; inset: 0; height: auto; }
  .pisca.on .p-depois { animation: bate 1.1s steps(1) infinite; }
  @keyframes bate { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
  .decisoes { background: #fff; border: 1px solid var(--linha); border-left: 4px solid var(--marca);
              border-radius: 10px; padding: 20px; }
  .decisoes h2 { margin: 0 0 4px; font-size: 18px; }
  .decisoes ol { margin: 12px 0 0; padding-left: 20px; }
  .decisoes li { margin-bottom: 14px; max-width: 90ch; }
  .decisoes .rec { color: var(--novo); font-weight: 700; }
  .alerta { background: #fff8e8; border: 1px solid #e7cf9a; border-radius: 8px;
            padding: 14px 16px; margin: 18px 0 0; max-width: 92ch; }
  .alerta b { color: #7a5306; }
  .achado { background: #fff; border: 1px solid var(--linha); border-radius: 10px;
            padding: 20px; margin-bottom: 22px; }
  .achado h2 { margin: 0 0 8px; font-size: 18px; }
  code { background: #eef0f4; border-radius: 4px; padding: 1px 5px; font-size: 13px; }
  @media (max-width: 760px) {
    .par { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="capa"><div class="env">
  <span class="sel">Proposta para aprovar · 14/09/2026</span>
  <h1>Data de nascimento no cadastro, e o lembrete do aniversário</h1>
  <p>Você pediu um campo para guardar a data de nascimento do cliente e ser lembrado do aniversário. Esta é a proposta, fotografada no sistema rodando: à esquerda o JuridFlow de hoje, à direita o mesmo lugar com a mudança.</p>
  <p>Nada foi publicado. Depois do seu «pode fazer» eu implemento com as amarras de sempre.</p>
</div></div>
<main>
${blocos}
${sozinhas}

<section class="achado">
  <h2>Um achado que só a foto pegou</h2>
  <p>A primeira versão usava o campo de data do próprio navegador. Na foto ele saiu <b><code>09/14/1985</code></b> — mês antes do dia, no formato americano, porque o campo nativo desenha no idioma do NAVEGADOR e não no do sistema. Num cadastro jurídico isso é risco, não estética: quem digita «03/04» não sabe se marcou 3 de abril ou 4 de março.</p>
  <p>O JuridFlow já tinha aprendido isso no filtro «Cadastro», que usa campo de texto mascarado por esse motivo. A proposta agora usa o mesmo: <code>dd/mm/aaaa</code>, e data que não existe (31/02) fica em vermelho sem gravar nada.</p>
</section>

<section class="decisoes">
  <h2>O que eu preciso que você decida</h2>
  <ol>
    <li><b>Mandar os parabéns: manual ou automático?</b><br/>
      Na proposta o botão «mandar parabéns» abre o WhatsApp <b>do seu celular</b> com o texto pronto para editar — quem envia é você. <span class="rec">É o que eu recomendo.</span><br/>
      Mandar sozinho pelo número do escritório é <b>disparo proativo da plataforma</b> — exatamente o padrão que gerou os dois avisos de spam da Meta em agosto. Dá para fazer, mas é decisão sua e vira um pedido à parte, com modelo aprovado na Meta.</li>
    <li><b>A que horas o lembrete chega?</b> A proposta manda às <b>8h da manhã</b>, no fuso do escritório, no próprio dia. Se preferir, dá para avisar também na véspera.</li>
    <li><b>Quem recebe?</b> A proposta manda para o <b>responsável pelo cadastro</b>, e para você quando a chave «quero receber também o que é dos meus colaboradores» estiver ligada — a mesma régua da movimentação de processo.</li>
    <li><b>Aniversário de empresa?</b> Cliente pessoa jurídica não tem nascimento. Hoje o campo simplesmente fica em branco para eles. Se quiser guardar a data de fundação do CNPJ, é outro campo.</li>
  </ol>
  <div class="alerta">
    <p style="margin:0"><b>Duas coisas que ficam registradas:</b> (1) já existe hoje um jeito de criar campos extras no cadastro (Configurações → Campos de cliente, com tipo «data»), mas o valor dele mora num pacote de texto que nenhuma consulta alcança — dava para <i>guardar</i> a data e não dava para <i>ser lembrado</i> dela. Por isso a proposta é um campo de verdade. (2) No celular, a tela de Clientes já leva para o Atendimento hoje — isso é de antes e não foi mexido: o campo se preenche no computador, e o lembrete chega no celular normalmente.</p>
  </div>
</section>
</main>
<script>
  function piscar(id, botao) {
    var el = document.getElementById("pisca-" + id);
    var ligado = !el.hidden && el.classList.contains("on");
    if (ligado) {
      el.classList.remove("on"); el.hidden = true; botao.textContent = "Piscar (sobrepõe os dois)";
    } else {
      el.hidden = false; el.classList.add("on"); botao.textContent = "Parar de piscar";
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
</script>
</body>
</html>`;

writeFileSync("/home/user/jurify/comparador-aniversario-cliente.html", html);
console.log("comparador-aniversario-cliente.html", (html.length / 1024 / 1024).toFixed(2), "MB");
