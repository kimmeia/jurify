/**
 * Monta a página das três direções visuais.
 *
 * Regras que vieram das reprovações anteriores:
 *  - foto grande e legível, não miniatura lado a lado (foi o "não consegui
 *    entender as diferenças");
 *  - o "hoje" fica no MESMO quadro, trocado por um botão — comparar exige o
 *    mesmo recorte, não memória;
 *  - texto curto. Ele decide olhando, não lendo minha tese.
 */
import { readFileSync, writeFileSync } from "node:fs";

const fotos = "/home/user/jurify/scratchpad/direcoes/fotos-web";
// Cada foto entra UMA vez no arquivo, numa tabela; o HTML referencia pela
// chave. Embutir a mesma imagem no src, no data-hoje e no data-novo triplicava
// o peso (21 MB no primeiro corte).
const usadas = new Map();
const chave = (f) => {
  if (!usadas.has(f)) usadas.set(f, `data:image/png;base64,${readFileSync(`${fotos}/${f}`).toString("base64")}`);
  return f.replace(/\.png$/, "");
};

const DIRECOES = [
  {
    id: "1-escuro",
    numero: "1",
    nome: "Mesa escura",
    tese: "O app inteiro veste o escuro que hoje só o menu tem. O menu deixa de ser uma tarja preta grudada num bloco branco e vira a mesma peça — e o número, o gráfico e o botão ganham profundidade.",
    cores: ["#0a0c12", "#141822", "#7c5cff", "#3ecf8e", "#e9edf6"],
    aFavor: "É a cara do print que você mandou. Nenhum concorrente jurídico brasileiro é escuro-nativo — é a direção mais difícil de copiar e a mais confortável para quem passa o dia na tela.",
    contra: "Escuro exige revisar cor por cor: o verde do «Nova Conversa» e o violeta disputam atenção na mesma tela. E documento/PDF continua branco, então a leitura alterna claro e escuro.",
  },
  {
    id: "2-claro",
    numero: "2",
    nome: "Escritório claro",
    tese: "Continua claro, mas sai do cinza de clínica: fundo de papel quente, cartão branco que FLUTUA (a sombra substitui o fio de 1px) e mais ar entre as coisas.",
    cores: ["#f1ede6", "#ffffff", "#1b2a63", "#216e4e", "#1d1b16"],
    aFavor: "É a mudança que ninguém precisa reaprender: o sistema continua o mesmo, só para de parecer apertado e improvisado. Imprime bem e envelhece bem.",
    contra: "É a mais segura — e por isso a menos memorável. Daqui a um ano ninguém aponta para a tela e diz «isso é o JuridFlow».",
  },
  {
    id: "3-marca",
    numero: "3",
    nome: "Marca em bloco",
    tese: "A marca deixa de ser só o «J» no canto: cada tela começa dentro de uma faixa roxa da logo, e os cartões brancos se recortam sobre ela. A identidade carrega a estrutura.",
    cores: ["#191229", "#4b31c3", "#ffffff", "#f6f7fb", "#16182a"],
    aFavor: "É a que mais grita «produto», não «ferramenta interna». Boa para venda, para print de anúncio e para o cliente do escritório reconhecer de longe.",
    contra: "Faixa colorida em TODA tela cansa quem fica 8 horas dentro dela — e o roxo forte disputa com os estados (vermelho de atraso, verde de pago).",
  },
];

const quadro = (id, titulo, arq, hoje) => `
  <figure class="quadro">
    <figcaption>${titulo}</figcaption>
    <div class="moldura" data-hoje="${chave(hoje)}" data-novo="${chave(arq)}">
      <img data-inicial="${chave(arq)}" alt="${titulo}"/>
    </div>
    <button class="ver-hoje" type="button" onclick="trocar(this)">Ver como é hoje</button>
  </figure>`;

const secoes = DIRECOES.map((d) => `
<section class="direcao" id="d-${d.id}">
  <div class="cabeca">
    <span class="num">${d.numero}</span>
    <div>
      <h2>${d.nome}</h2>
      <p class="tese">${d.tese}</p>
      <div class="cores">${d.cores.map((c) => `<i style="background:${c}"></i>`).join("")}</div>
    </div>
  </div>
  ${quadro(d.id, "Dashboard — computador", `dashboard-${d.id}-pc.png`, "dashboard-hoje-pc.png")}
  <div class="dupla">
    ${quadro(d.id, "Atendimento — computador", `atendimento-${d.id}-pc.png`, "atendimento-hoje-pc.png")}
    ${quadro(d.id, "Financeiro — computador", `financeiro-${d.id}-pc.png`, "financeiro-hoje-pc.png")}
  </div>
  <div class="celulares">
    ${quadro(d.id, "Dashboard — celular", `dashboard-${d.id}-cel.png`, "dashboard-hoje-cel.png")}
    ${quadro(d.id, "Atendimento — celular", `atendimento-${d.id}-cel.png`, "atendimento-hoje-cel.png")}
  </div>
  <div class="balanco">
    <p><b>A favor.</b> ${d.aFavor}</p>
    <p><b>Contra, honestamente.</b> ${d.contra}</p>
  </div>
</section>`).join("\n");

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Três direções visuais para o JuridFlow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --tinta:#14161d; --apoio:#6b7183; --linha:#e5e8ef; --fundo:#f5f6f9; --marca:#4b31c3; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--fundo); color:var(--tinta);
         font:16px/1.65 Inter, -apple-system, "Segoe UI", Roboto, sans-serif; }
  h1,h2,h3 { font-family:Poppins, Inter, sans-serif; letter-spacing:-0.03em; margin:0; }
  .capa { background:#0a0c12; color:#fff; padding:64px 24px 56px; }
  .env { max-width:1120px; margin:0 auto; }
  .capa h1 { font-size:clamp(28px,5vw,44px); font-weight:600; line-height:1.15; margin-bottom:14px; }
  .capa p { color:#aab3c6; max-width:70ch; margin:0 0 10px; }
  .capa .sel { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.14em;
               text-transform:uppercase; color:#b9a6ff; border:1px solid #3a2f6b;
               border-radius:999px; padding:5px 12px; margin-bottom:18px; }
  main { max-width:1120px; margin:0 auto; padding:36px 16px 80px; }
  .direcao { background:#fff; border-radius:20px; padding:28px; margin-bottom:28px;
             box-shadow:0 1px 2px rgba(16,24,40,.05), 0 24px 48px -32px rgba(16,24,40,.45); }
  .cabeca { display:flex; gap:18px; align-items:flex-start; margin-bottom:22px; }
  .num { flex:none; width:44px; height:44px; border-radius:14px; background:var(--marca);
         color:#fff; font-family:Poppins,sans-serif; font-weight:600; font-size:20px;
         display:grid; place-items:center; }
  .direcao h2 { font-size:26px; font-weight:600; }
  .tese { margin:6px 0 12px; color:#39404f; max-width:78ch; }
  .cores { display:flex; gap:6px; }
  .cores i { width:26px; height:26px; border-radius:8px; border:1px solid rgba(0,0,0,.08); }
  .quadro { margin:0 0 18px; }
  .quadro figcaption { font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase;
                       color:var(--apoio); margin-bottom:8px; }
  .moldura { border-radius:14px; overflow:hidden; background:#fff;
             box-shadow:0 1px 2px rgba(16,24,40,.08), 0 18px 36px -24px rgba(16,24,40,.5); }
  .moldura img { display:block; width:100%; }
  .ver-hoje { margin-top:8px; font:inherit; font-size:13px; font-weight:600; cursor:pointer;
              border:1px solid var(--linha); background:#fff; color:#39404f;
              border-radius:999px; padding:6px 14px; }
  .ver-hoje:hover { background:#f2f3f7; }
  .ver-hoje.ativo { background:#14161d; color:#fff; border-color:#14161d; }
  .dupla { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  .celulares { display:grid; grid-template-columns:repeat(2, minmax(0,260px)); gap:18px; margin-top:4px; }
  .balanco { border-top:1px solid var(--linha); margin-top:8px; padding-top:16px; }
  .balanco p { margin:0 0 8px; max-width:88ch; color:#39404f; }
  .fecho { background:#fff; border-radius:20px; padding:28px;
           box-shadow:0 1px 2px rgba(16,24,40,.05), 0 24px 48px -32px rgba(16,24,40,.45); }
  .fecho h2 { font-size:22px; margin-bottom:10px; }
  .fecho ol { margin:12px 0 0; padding-left:20px; }
  .fecho li { margin-bottom:10px; max-width:88ch; }
  @media (max-width:820px) {
    .dupla, .celulares { grid-template-columns:1fr; }
    .direcao { padding:20px; }
  }
</style>
</head>
<body>
<div class="capa"><div class="env">
  <span class="sel">Escolha uma · 16/09/2026</span>
  <h1>Três direções para a cara do JuridFlow</h1>
  <p>Não são desenhos: é o seu sistema rodando, com os seus dados, vestindo três peles diferentes. Mesmas telas, mesmos botões, nada foi tirado.</p>
  <p>Cada bloco tem o botão <b>«Ver como é hoje»</b> — a foto troca no mesmo quadro, para você comparar sem precisar lembrar.</p>
</div></div>
<main>
${secoes}
<section class="fecho">
  <h2>Como eu toco depois da sua escolha</h2>
  <ol>
    <li><b>Você aponta uma</b> — pode ser «a 1, mas com o verde do print» ou «a 2 com o roxo da 3». Misturar é permitido; ficar em cima do muro é o que produz a cara de hoje.</li>
    <li><b>Eu aplico na tela que você mais usa primeiro</b> (Atendimento), fotografo e te mostro antes de espalhar.</li>
    <li><b>Depois vai tela por tela</b>, com foto a cada passo. Nada de trocar 40 telas de uma vez e descobrir o estrago depois.</li>
  </ol>
  <p style="margin-top:14px;color:#6b7183">Se nenhuma das três presta, me diga o que está errado nelas — «escura demais», «parece banco», «quero mais parecido com o print». Cada rodada fica mais perto.</p>
</section>
</main>
<script>
  const FOTOS = __TABELA__;
  for (const img of document.querySelectorAll("img[data-inicial]")) img.src = FOTOS[img.dataset.inicial];
  function trocar(botao) {
    const m = botao.previousElementSibling;
    const img = m.querySelector("img");
    const mostrandoHoje = botao.classList.toggle("ativo");
    img.src = FOTOS[mostrandoHoje ? m.dataset.hoje : m.dataset.novo];
    botao.textContent = mostrandoHoje ? "Voltar para a proposta" : "Ver como é hoje";
  }
</script>
</body>
</html>`;

const tabela = JSON.stringify(Object.fromEntries([...usadas].map(([f, d]) => [f.replace(/\.png$/, ""), d])));
writeFileSync("/home/user/jurify/tres-direcoes-visuais.html", html.replace("__TABELA__", tabela));
console.log("tres-direcoes-visuais.html", (html.length / 1024 / 1024).toFixed(2), "MB");
