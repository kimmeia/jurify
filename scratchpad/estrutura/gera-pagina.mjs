/**
 * Monta a página das três direções de ESTRUTURA.
 *
 * A rodada anterior foi reprovada com a frase certa: "apenas mudou algumas
 * cores". Era verdade — eram três peles sobre o MESMO esqueleto (menu lateral
 * de 15 itens, tira de abas, grade de cartões brancos, KPI + gráfico). Aqui o
 * que muda é o esqueleto; a cor é consequência.
 */
import { readFileSync, writeFileSync } from "node:fs";

const proto = "/home/user/jurify/scratchpad/estrutura/fotos";
const hoje = "/home/user/jurify/scratchpad/direcoes/fotos-web";
const usadas = new Map();
const chave = (caminho, nome) => {
  if (!usadas.has(nome)) usadas.set(nome, `data:image/png;base64,${readFileSync(caminho).toString("base64")}`);
  return nome;
};
const p = (f) => chave(`${proto}/${f}`, f.replace(/\.png$/, ""));
const h = (f) => chave(`${hoje}/${f}`, `hoje-${f.replace(/\.png$/, "")}`);

const DIRECOES = [
  {
    id: "a-pauta",
    numero: "A",
    nome: "A pauta do dia",
    frase: "A tela deixa de ser painel e vira <b>pauta</b>: uma lista única, na ordem em que o dia cobra você.",
    muda: [
      "<b>Acabam os cartões.</b> O que era caixinha branca vira linha, com hora, tipo, cliente e o botão da ação ali mesmo.",
      "<b>O menu vira trilho de ícones</b> (os 15 itens continuam lá). Navegação não é o assunto às 8 da manhã.",
      "<b>Os números saem das caixas</b> e viram uma faixa de texto no topo — dinheiro é contexto, não é o trabalho.",
      "<b>A ordem é a pressão</b>, não o módulo: passou do prazo, hoje, quem espera, o dinheiro que precisa de você.",
    ],
    contra: "Quem gosta de ver tudo em blocos vai sentir falta do painel. E a tela cresce em altura: dia cheio dá rolagem.",
  },
  {
    id: "b-bancada",
    numero: "B",
    nome: "Bancada",
    frase: "Ferramenta de quem passa o dia dentro dela: <b>tudo é tabela</b>, muita informação de uma vez, operação pelo teclado.",
    muda: [
      "<b>Nenhum cartão, nenhum canto arredondado.</b> Três painéis de tabela dividindo a tela: conversas, prazos, movimentações.",
      "<b>Números em fonte tabular</b> (os dígitos alinham em coluna) e a faixa do topo em uma linha só.",
      "<b>Atalhos à vista</b> — J/K navega, R responde, T transfere. O ⌘K que já existe vira o centro.",
      "<b>Densidade é a estética.</b> Cabem 6 conversas, 7 prazos e 4 movimentações sem rolar.",
    ],
    contra: "É a mais dura de aprender e a menos convidativa para o cliente do escritório ver. Escuro-nativo exige revisar cor por cor.",
  },
  {
    id: "c-boletim",
    numero: "C",
    nome: "O boletim",
    frase: "A tela imita o que um chefe de gabinete deixaria na sua mesa: <b>uma folha</b>, com os números escritos dentro das frases.",
    muda: [
      "<b>Não existe menu lateral.</b> Uma barra fina no topo com ☰ e a busca; o resto é a folha.",
      "<b>Largura de leitura</b> (780px) e tipografia de documento — título em serifa, seções com régua.",
      "<b>O resumo é um parágrafo</b>: «Você tem uma audiência às 8h30… um prazo venceu ontem… R$ 1.600,00 vencidos».",
      "<b>Imprime igual ao que se vê.</b> É a única das três que vira PDF para levar à reunião.",
    ],
    contra: "É a mais radical: quem procura «o painel» não acha. E some a visão de muitos itens ao mesmo tempo — é uma folha, não um cockpit.",
  },
];

const quadro = (titulo, foto, fotoHoje) => `
  <figure class="quadro">
    <figcaption>${titulo}</figcaption>
    <div class="moldura" data-novo="${foto}" data-hoje="${fotoHoje}">
      <img data-inicial="${foto}" alt="${titulo}"/>
    </div>
    <button class="ver-hoje" type="button" onclick="trocar(this)">Ver como é hoje</button>
  </figure>`;

const secoes = DIRECOES.map((d) => `
<section class="direcao" id="d-${d.id}">
  <div class="cabeca">
    <span class="num">${d.numero}</span>
    <div>
      <h2>${d.nome}</h2>
      <p class="frase">${d.frase}</p>
    </div>
  </div>
  ${quadro("Computador", p(`${d.id}-pc.png`), h("dashboard-hoje-pc.png"))}
  <div class="detalhe">
    <div class="lista">
      <h3>O que muda de estrutura</h3>
      <ul>${d.muda.map((m) => `<li>${m}</li>`).join("")}</ul>
      <p class="contra"><b>Contra, honestamente.</b> ${d.contra}</p>
    </div>
    ${quadro("Celular", p(`${d.id}-cel.png`), h("dashboard-hoje-cel.png"))}
  </div>
</section>`).join("\n");

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Três estruturas para o JuridFlow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap" rel="stylesheet">
<style>
  :root { --tinta:#14161d; --apoio:#6b7183; --linha:#e5e8ef; --fundo:#f5f6f9; --marca:#4b31c3; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--fundo); color:var(--tinta);
         font:16px/1.65 Inter,-apple-system,"Segoe UI",Roboto,sans-serif; }
  h1,h2,h3 { margin:0; letter-spacing:-0.025em; }
  .capa { background:#0a0c12; color:#fff; padding:60px 24px 52px; }
  .env { max-width:1120px; margin:0 auto; }
  .capa h1 { font:600 clamp(28px,5vw,42px)/1.15 Newsreader,Georgia,serif; margin-bottom:16px; }
  .capa p { color:#aab3c6; max-width:72ch; margin:0 0 10px; }
  .capa .sel { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.14em;
               text-transform:uppercase; color:#b9a6ff; border:1px solid #3a2f6b;
               border-radius:999px; padding:5px 12px; margin-bottom:18px; }
  .capa .erro { border-left:3px solid #7c5cff; padding-left:16px; margin-top:22px; color:#d6dbe6; }
  main { max-width:1120px; margin:0 auto; padding:34px 16px 80px; }
  .direcao { background:#fff; border-radius:20px; padding:28px; margin-bottom:26px;
             box-shadow:0 1px 2px rgba(16,24,40,.05), 0 24px 48px -32px rgba(16,24,40,.45); }
  .cabeca { display:flex; gap:18px; align-items:flex-start; margin-bottom:20px; }
  .num { flex:none; width:44px; height:44px; border-radius:14px; background:var(--marca);
         color:#fff; font:600 19px/1 Inter,sans-serif; display:grid; place-items:center; }
  .direcao h2 { font-size:27px; font-weight:600; }
  .frase { margin:6px 0 0; color:#39404f; max-width:80ch; }
  .quadro { margin:0; }
  .quadro figcaption { font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase;
                       color:var(--apoio); margin-bottom:8px; }
  .moldura { border-radius:12px; overflow:hidden; background:#fff; border:1px solid var(--linha); }
  .moldura img { display:block; width:100%; }
  .ver-hoje { margin-top:8px; font:600 13px/1 Inter,sans-serif; cursor:pointer;
              border:1px solid var(--linha); background:#fff; color:#39404f;
              border-radius:999px; padding:7px 14px; }
  .ver-hoje.ativo { background:#14161d; color:#fff; border-color:#14161d; }
  .detalhe { display:grid; grid-template-columns:1fr 300px; gap:26px; margin-top:22px; align-items:start; }
  .lista h3 { font-size:12px; font-weight:700; letter-spacing:.16em; text-transform:uppercase;
              color:var(--apoio); margin-bottom:10px; }
  .lista ul { margin:0; padding-left:18px; }
  .lista li { margin-bottom:9px; color:#39404f; }
  .contra { margin:14px 0 0; padding-top:12px; border-top:1px solid var(--linha); color:#6b7183; font-size:15px; }
  .detalhe .moldura { max-height:520px; }
  .detalhe .moldura img { object-fit:cover; object-position:top; }
  .fecho { background:#fff; border-radius:20px; padding:28px;
           box-shadow:0 1px 2px rgba(16,24,40,.05), 0 24px 48px -32px rgba(16,24,40,.45); }
  .fecho h2 { font-size:22px; margin-bottom:12px; }
  .fecho li { margin-bottom:10px; max-width:88ch; }
  .aviso { background:#fffaf0; border:1px solid #f0e0bd; border-radius:12px; padding:16px 18px;
           margin:0 0 26px; color:#5f4a1f; }
  @media (max-width:860px) { .detalhe { grid-template-columns:1fr; } .direcao { padding:20px; } }
</style>
</head>
<body>
<div class="capa"><div class="env">
  <span class="sel">Escolha uma · 16/09/2026</span>
  <h1>Três estruturas — não três cores</h1>
  <p>Você disse que a rodada anterior só mudou tinta e continuou igual a qualquer software. Estava certo: eram três peles sobre o mesmo esqueleto — menu lateral com 15 itens, tira de abas, grade de cartões brancos, KPI com gráfico de linha. Esse esqueleto é o molde que quase todo sistema novo usa.</p>
  <div class="erro">Aqui o que muda é o <b>esqueleto</b>: o que aparece, em que ordem, em que formato e como se navega. A cor vem depois, como consequência.</div>
</div></div>
<main>

<div class="aviso">
  <b>Como ler estas fotos.</b> As três são telas montadas com o seu conteúdo real — os mesmos clientes, prazos e valores que estão no sistema — mas ainda não são o app rodando: mudar estrutura não se faz pintando por cima do que existe. Quando você escolher uma, eu implemento no app de verdade e fotografo <i>antes</i> de espalhar para as outras telas.
</div>

${secoes}

<section class="fecho">
  <h2>O que acontece depois da sua escolha</h2>
  <ol>
    <li><b>Você aponta uma</b> — ou mistura («a A, mas com as tabelas da B»). O que não pode é ficar no meio: meio-termo é o que produz a cara de hoje.</li>
    <li><b>Eu implemento a tela inicial de verdade</b>, no app, com os seus dados, e te mando a foto do app rodando para comparar com estas.</li>
    <li><b>Só depois espalho</b> — Atendimento, Clientes, Processos, Financeiro —, uma por vez, com foto a cada passo. Nada é removido sem você autorizar item a item.</li>
  </ol>
  <p style="margin-top:14px;color:#6b7183">Se as três continuarem erradas, me diga qual <b>parte</b> incomoda: a navegação, a densidade, o tipo de letra, a ausência de gráfico. Estrutura é discutível em pedaços — é assim que a próxima rodada chega mais perto.</p>
</section>
</main>
<script>
  const FOTOS = __TABELA__;
  for (const img of document.querySelectorAll("img[data-inicial]")) img.src = FOTOS[img.dataset.inicial];
  function trocar(botao) {
    const m = botao.previousElementSibling;
    const img = m.querySelector("img");
    const hoje = botao.classList.toggle("ativo");
    img.src = FOTOS[hoje ? m.dataset.hoje : m.dataset.novo];
    botao.textContent = hoje ? "Voltar para a proposta" : "Ver como é hoje";
  }
</script>
</body>
</html>`;

const tabela = JSON.stringify(Object.fromEntries(usadas));
writeFileSync("/home/user/jurify/tres-estruturas.html", html.replace("__TABELA__", tabela));
console.log("tres-estruturas.html pronto");
