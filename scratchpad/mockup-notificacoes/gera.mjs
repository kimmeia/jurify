/**
 * Mockup navegável — Notificações push padrão.
 *
 * As duas fotos saíram do app RODANDO, com a tela montada dentro de
 * Configurações usando os componentes de verdade (a branch é descartável, o
 * estado é local, nada é gravado). O que está aqui pra aprovar é o CONJUNTO de
 * avisos e quais vêm ligados de fábrica.
 *
 *   node gera.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const b64 = (p) => readFileSync(p).toString("base64");
const desktop = b64("scratchpad/mockup-notificacoes/desktop.png");
const celular = b64("scratchpad/mockup-notificacoes/celular.png");

const ACHADOS = [
  {
    t: "O que existe hoje, medido no código",
    itens: [
      "Push funciona: o aparelho se inscreve pelo sino (“Ativar notificações neste aparelho”) e há botão de teste.",
      "<b>Não existe escolha nenhuma.</b> Quem ativa recebe SETE tipos de aviso; quem não quer um deles só pode desligar todos.",
      "O dono e os gestores recebem <b>toda mensagem de toda conversa</b> do escritório. É o que faz o celular tocar o dia inteiro.",
      "O aviso de movimentação vai para <b>quem cadastrou o processo no vigia</b> — não para o dono, e não para o responsável pelo caso.",
      "Quatro avisos que já existem <b>não chegam no celular</b>: prazo vencendo, pagamento recebido, cobrança vencida e credencial de tribunal quebrada.",
    ],
  },
  {
    t: "Por que estes padrões, e não outros",
    itens: [
      "<b>Decisão e providência ligadas, rotina desligada.</b> A IA já classifica cada movimentação em “relevante” e “rotina” — isso não é para construir, é para usar. Rotina é 8 de cada 10; é ela que faz o aviso virar ruído e o advogado desligar tudo.",
      "<b>“Nova conversa iniciada” no lugar de “toda mensagem”.</b> Quem atende continua recebendo as conversas dele; o dono passa a ser avisado do que é notícia — cliente novo, ou cliente que voltou depois do atendimento encerrado.",
      "<b>Dinheiro ligado para quem vê o Financeiro.</b> Pagamento que entra e cobrança que venceu são as duas coisas que o dono quer saber na hora, e hoje as duas só aparecem se ele abrir a tela.",
      "<b>Saúde do sistema só para o dono.</b> WhatsApp com qualidade caindo e credencial de tribunal quebrada são avisos que evitam prejuízo silencioso — a credencial quebrada para de vigiar processo sem ninguém perceber.",
      "<b>Silêncio das 21h às 7h ligado.</b> O aviso não some: fica no sino e aparece de manhã.",
    ],
  },
  {
    t: "O que eu preciso que você decida",
    itens: [
      "<b>1.</b> A lista está certa? Falta algum aviso que você quer no celular, ou sobra algum?",
      "<b>2.</b> Os padrões marcados “PADRÃO” são os certos para uma conta nova?",
      "<b>3.</b> O dono deve poder receber o que é dos colaboradores (a chave no fim da tela), ou cada um só recebe o que é seu?",
      "<b>4.</b> “Cliente esperando há 15 minutos” vale a pena? É o único da lista que não tem nada pronto por trás.",
    ],
  },
];

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notificações do app — mockup para aprovar</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f6f7f9; color:#16181d;
    font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }
  header { background:#07060f; color:#fff; padding:22px 20px; }
  header h1 { margin:0 0 6px; font-size:20px; }
  header p { margin:0; max-width:80ch; color:#c9c8d4; font-size:13px; }
  main { padding:18px 20px 60px; max-width:1200px; margin:0 auto; }
  .chaves { display:flex; gap:8px; margin-bottom:14px; }
  .chaves button { border:1px solid #cfd3da; background:#fff; border-radius:999px;
    padding:7px 16px; font-size:13px; font-weight:700; cursor:pointer; }
  .chaves button.on { background:#07060f; color:#fff; border-color:#07060f; }
  .tela { background:#fff; border:1px solid #e3e5ea; border-radius:12px; padding:10px;
    margin-bottom:22px; }
  .tela img { display:block; width:100%; height:auto; border-radius:8px; }
  .tela.cel { max-width:420px; margin-left:auto; margin-right:auto; }
  .oculto { display:none; }
  .bloco { background:#fff; border:1px solid #e3e5ea; border-radius:12px;
    padding:14px 16px; margin-bottom:14px; }
  .bloco h2 { margin:0 0 8px; font-size:15px; }
  .bloco ul { margin:0; padding-left:18px; font-size:13px; color:#3a3f4a; }
  .bloco li { margin:5px 0; }
  .legenda { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px; font-size:12px; }
  .legenda span { border-radius:6px; padding:3px 8px; font-weight:700; }
  .l1 { background:#e8f3ec; color:#1d6b3f; border:1px solid #bfe0cb; }
  .l2 { background:#e8f0fb; color:#1f4e8c; border:1px solid #c3d8f2; }
  .l3 { background:#fdf3e0; color:#8a5a12; border:1px solid #f0dfb0; }
  .decidir { border-color:#f0dfb0; background:#fff8e6; }
</style></head>
<body>
<header>
  <h1>Notificações do app — o que deve tocar o seu celular</h1>
  <p>A tela está montada DENTRO do sistema rodando, com os componentes de verdade: é foto, não
     desenho. Nada é gravado ainda — o que está aqui pra aprovar é a lista de avisos e quais vêm
     ligados de fábrica.</p>
</header>
<main>
  <div class="legenda">
    <span class="l1">já funciona</span> o aviso existe e já chega no celular
    <span class="l2">novo</span> precisa ser construído
    <span class="l3">hoje não chega no celular</span> existe no sino, mas não vira push
  </div>

  <div class="chaves">
    <button id="bd" class="on">Computador</button>
    <button id="bc">Celular</button>
  </div>

  <div class="tela" id="td"><img src="data:image/png;base64,${desktop}" alt="computador"></div>
  <div class="tela cel oculto" id="tc"><img src="data:image/png;base64,${celular}" alt="celular"></div>

  ${ACHADOS.map(
    (a, i) =>
      `<div class="bloco${i === 2 ? " decidir" : ""}"><h2>${a.t}</h2><ul>${a.itens
        .map((x) => `<li>${x}</li>`)
        .join("")}</ul></div>`,
  ).join("")}
</main>
<script>
  const bd = document.getElementById("bd"), bc = document.getElementById("bc");
  const td = document.getElementById("td"), tc = document.getElementById("tc");
  bd.onclick = () => { bd.classList.add("on"); bc.classList.remove("on"); td.classList.remove("oculto"); tc.classList.add("oculto"); };
  bc.onclick = () => { bc.classList.add("on"); bd.classList.remove("on"); tc.classList.remove("oculto"); td.classList.add("oculto"); };
</script>
</body></html>`;

writeFileSync("mockup-notificacoes-padrao.html", html);
console.log("mockup em mockup-notificacoes-padrao.html -", Math.round(html.length / 1024), "KB");
