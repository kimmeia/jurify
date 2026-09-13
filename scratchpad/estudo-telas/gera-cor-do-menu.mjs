/**
 * Monta a página de decisão da COR DO MENU: as variantes fotografadas no app
 * rodando, em tamanho real, com o hex medido no pixel de cada uma.
 *
 *   node gera-cor-do-menu.mjs <pasta-das-fotos> <saida.html>
 *
 * As fotos entram embutidas em base64 — o arquivo abre sozinho no navegador
 * do dono, como manda a regra do mockup.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [FOTOS, SAIDA] = process.argv.slice(2);
const b64 = (arq) => "data:image/png;base64," + readFileSync(`${FOTOS}/${arq}`).toString("base64");

const VARIANTES = [
  {
    id: "hoje", rotulo: "Hoje", hex: "#16202c", tom: "azul-ardósia",
    nota: "O menu atual do JuridFlow. Azul escuro com um toque de azul no cinza.",
    selo: null,
  },
  {
    id: "transparente", rotulo: "A · o CSS do Devular, literal", hex: "#37363e", tom: "grafite",
    nota: "<code>rgba(7,6,15,.8)</code> + <code>blur</code>, exatamente como está escrito no " +
      "<code>Home.tsx:148</code> do Devular. Num menu de app, quem está atrás é a PÁGINA CLARA — " +
      "então os 80% clareiam a cor e ela chega em grafite, não no quase-preto do print.",
    selo: null,
  },
  {
    id: "solido", rotulo: "B · a cor que você vê no print", hex: "#07060f", tom: "quase-preto",
    nota: "O mesmo <code>#07060f</code>, sem transparência. É o que o header do Devular " +
      "APARENTA sobre o hero escuro dele (#080710). O item ativo continua no azul de hoje, " +
      "que sobre o quase-preto fica com mais contraste do que tinha.",
    selo: "recomendo",
  },
  {
    id: "solidoAfinado", rotulo: "C · B com o item ativo neutro", hex: "#07060f", tom: "quase-preto",
    nota: "Igual ao B, mas com o item ativo e o texto puxados para o neutro. Fica mais " +
      "\"Devular\" — e o item ativo quase some. Foi por isso que recomendei o B.",
    selo: null,
  },
];

const cartao = (v) => `
  <figure class="variante${v.selo ? " eleita" : ""}">
    <figcaption>
      <b>${v.rotulo}</b>
      ${v.selo ? `<span class="selo">${v.selo}</span>` : ""}
      <span class="amostra" style="background:${v.hex}"></span>
      <code>${v.hex}</code> <i>${v.tom}</i>
    </figcaption>
    <img src="${b64(`menu-dashboard-${v.id}.png`)}" alt="menu ${v.rotulo}" width="330">
    <p>${v.nota}</p>
  </figure>`;

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>A cor do menu — Devular e JuridFlow</title>
<style>
  :root{--tinta:#0f1b2d;--tinta2:#4a5b70;--tinta3:#7c8a9c;--linha:#dde3ea;--fundo:#eef2f7;
        --papel:#fff;--marinho:#194b86;--ambar:#8a5a0b;--verde:#097245;
        --sombra:0 1px 2px rgba(15,27,45,.06),0 8px 24px rgba(15,27,45,.07)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--fundo);color:var(--tinta);
       font:15px/1.6 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
       -webkit-font-smoothing:antialiased}
  .folha{max-width:1180px;margin:0 auto;padding:30px 24px 80px}
  h1{font-size:27px;font-weight:700;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:var(--tinta2);margin:0 0 26px}
  h2{font-size:18px;font-weight:650;margin:36px 0 10px;letter-spacing:-.01em}
  p{margin:0 0 12px}
  code{background:#e9eef4;padding:1px 6px;border-radius:5px;font-size:13px}
  table{border-collapse:collapse;background:var(--papel);border:1px solid var(--linha);
        border-radius:12px;overflow:hidden;box-shadow:var(--sombra);width:100%;margin:0 0 8px}
  th,td{padding:11px 14px;text-align:left;border-bottom:1px solid var(--linha);font-size:14px}
  th{background:#f6f8fb;font-size:11.5px;font-weight:700;letter-spacing:.07em;
     text-transform:uppercase;color:var(--tinta3)}
  tr:last-child td{border-bottom:0}
  .chip{display:inline-block;width:15px;height:15px;border-radius:4px;vertical-align:-3px;
        margin-right:7px;border:1px solid rgba(15,27,45,.15)}
  .grade{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin:14px 0 0}
  .variante{margin:0;background:var(--papel);border:1px solid var(--linha);border-radius:14px;
            padding:14px;box-shadow:var(--sombra);width:362px}
  .variante.eleita{border-color:#9dc6a6;box-shadow:0 0 0 3px #e6f4ec,var(--sombra)}
  .variante img{display:block;border-radius:9px;border:1px solid var(--linha);width:330px;height:auto}
  .variante figcaption{margin:0 0 10px;font-size:13.5px;display:flex;align-items:center;
                       gap:8px;flex-wrap:wrap}
  .variante figcaption b{font-weight:650}
  .variante p{margin:10px 0 0;font-size:13px;color:var(--tinta2);line-height:1.5}
  .amostra{width:17px;height:17px;border-radius:5px;display:inline-block;
           border:1px solid rgba(15,27,45,.2)}
  .selo{background:var(--verde);color:#fff;font-size:10.5px;font-weight:700;letter-spacing:.06em;
        text-transform:uppercase;padding:2px 8px;border-radius:99px}
  .aviso{background:var(--papel);border:1px solid var(--linha);border-left:3px solid var(--ambar);
         border-radius:11px;padding:14px 17px;box-shadow:var(--sombra);margin:14px 0}
  .aviso b{font-weight:650}
  .aviso.parado{border-left-color:var(--tinta3)}
  .larga img{width:100%;height:auto;border-radius:12px;border:1px solid var(--linha);display:block}
  .par{display:flex;gap:16px;flex-wrap:wrap}
  .par > div{flex:1 1 520px;min-width:0}
  .par h3{font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
          color:var(--tinta3);margin:0 0 7px}
  ul{margin:0 0 12px;padding-left:20px}
  li{margin-bottom:6px}
</style>
</head>
<body>
<div class="folha">

  <h1>A cor do menu, dos dois produtos</h1>
  <p class="sub">Medido no código do Devular e fotografado no JuridFlow rodando — 13/09/2026.</p>

  <h2>O que eu medi, antes de mexer em qualquer coisa</h2>
  <table>
    <tr><th>onde</th><th>o que está escrito</th><th>como aparece</th></tr>
    <tr>
      <td>Header do Devular<br><code>client/src/pages/Home.tsx:148</code></td>
      <td><code>bg-[#07060f]/80 backdrop-blur-md</code><br>borda <code>white/10</code></td>
      <td><span class="chip" style="background:#080710"></span><code>#080710</code> — sobre o hero escuro,
          os 80% quase não clareiam</td>
    </tr>
    <tr>
      <td>Menu do JuridFlow, hoje</td>
      <td><code>--sidebar: oklch(0.240 0.027 253)</code></td>
      <td><span class="chip" style="background:#16202c"></span><code>#16202c</code> — azul-ardósia</td>
    </tr>
    <tr>
      <td>Menu do app do Devular, hoje</td>
      <td><code>--sidebar: oklch(0.98 0.003 260)</code></td>
      <td><span class="chip" style="background:#fafafb"></span><code>#fafafb</code> — quase branco</td>
    </tr>
  </table>

  <div class="aviso">
    <b>“A mesma transparência” não dá a mesma cor nos dois lugares.</b><br>
    No Devular o header flutua sobre um hero <b>escuro</b>: 80% de quase-preto sobre quase-preto
    continua quase-preto. Num menu lateral de app, o que está atrás é a <b>página clara</b> —
    os mesmos 80% clareiam a cor até <code>#37363e</code>, um grafite. Por isso as duas leituras
    abaixo, fotografadas no app de verdade: você escolhe pela aparência, não pela linha de CSS.
  </div>

  <h2>As quatro, no app rodando — tamanho real</h2>
  <div class="grade">
    ${VARIANTES.map(cartao).join("\n")}
  </div>

  <h2>A recomendada, na tela inteira</h2>
  <div class="par">
    <div><h3>Hoje · #16202c</h3><div class="larga"><img src="${b64("dashboard-hoje.png")}" alt="hoje"></div></div>
    <div><h3>B · #07060f</h3><div class="larga"><img src="${b64("dashboard-solido.png")}" alt="proposta"></div></div>
  </div>

  <h2>E o menu do Devular?</h2>
  <div class="aviso parado">
    <b>Ali a mudança é bem maior, e eu não mexo sem você ver.</b> O menu do app do Devular hoje é
    <b>quase branco</b> (<code>#fafafb</code>), com o texto escuro. Trocar só o fundo para
    <code>#07060f</code> deixaria o texto preto sobre preto — invisível. Para virar quase-preto
    ele precisa do conjunto todo, que é o que o JuridFlow já tem:
    <ul>
      <li><code>--sidebar</code> → <code>#07060f</code></li>
      <li><code>--sidebar-foreground</code> → claro (hoje é escuro)</li>
      <li><code>--sidebar-accent</code> e <code>--sidebar-accent-foreground</code> → item ativo legível no escuro</li>
      <li><code>--sidebar-border</code> → <code>rgba(255,255,255,.10)</code>, igual ao header dele</li>
    </ul>
    Posso subir o Devular aqui e fotografar do mesmo jeito antes de escrever qualquer linha —
    é meia hora de ambiente. <b>Me diz se quer que eu faça.</b>
  </div>

  <h2>O que eu faria</h2>
  <ul>
    <li><b>B</b> nos dois produtos: <code>#07060f</code> sólido. É a cor que você vê no print, e
        fica idêntica nos dois, independente do que houver atrás.</li>
    <li>Manter o item ativo do JuridFlow no azul de hoje — sobre o quase-preto ele ganha contraste
        em vez de perder (o C, que neutraliza esse azul, quase apaga o item).</li>
    <li>A borda em branco 10%, como o header do Devular — o JuridFlow já está em 12%, fica igual.</li>
  </ul>

  <p class="sub" style="margin-top:26px">Nada disso está no código ainda. É a regra: você vê primeiro.</p>
</div>
</body>
</html>
`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} — ${(html.length / 1024 / 1024).toFixed(2)} MB`);
