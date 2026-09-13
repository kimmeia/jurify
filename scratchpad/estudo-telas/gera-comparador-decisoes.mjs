/**
 * Comparador ANTES | DEPOIS organizado por DECISÃO — para o dono aprovar ou
 * não cada uma das propostas em aberto, olhando as telas reais do sistema.
 *
 *   node gera-comparador-decisoes.mjs <ser-antes> <ser-depois> <fontes.css> <itens.json> <saida.html>
 *
 * Mesmo motor visual do `gera-comparador.mjs` (lado a lado, mesmo recorte e
 * mesma rolagem, anel no ponto que mudou, linha da borda no celular, Piscar,
 * "Onde olhar", régua opcional, passeio pelas telas), com três diferenças:
 *   - os itens vêm do JSON, não de uma lista escrita aqui;
 *   - a página é dividida em SEÇÕES (as decisões): título, "O que você
 *     decide", as opções A/B/C com a recomendada marcada, "fica de fora" e só
 *     então as comparações da seção;
 *   - uma seção pode ser SEM TELA: em vez de comparação traz uma tabela
 *     "arquivo · antes · depois · por quê" (código escapado, em monospace);
 *   - o topo tem o menu das decisões e um resumo "O que aprovar" com uma
 *     caixinha por decisão (A/B/C) que o dono marca só para se organizar —
 *     é classe CSS, não persiste, não manda nada a lugar nenhum.
 *
 * FORMATO DO itens.json
 * ---------------------
 * {
 *   "titulo": "Quatro decisões — antes e depois",       // cabeçalho
 *   "subtitulo": "telas serializadas em 13/09/2026",    // linha abaixo do título
 *   "telas": { "config-canais": "Configurações · Canais", "ajuda": "Central de ajuda" },
 *       // rótulo de cada tela no passeio "Navegar pelo sistema"; opcional —
 *       // sem ele o nome do arquivo vira rótulo. Só entram telas que existem
 *       // em <ser-antes>/desktop/<tela>.html.
 *   "decisoes": [
 *     {
 *       "id": "d1",                                     // usado no menu e nas fotos
 *       "titulo": "Nome curto da decisão",
 *       "decide": "Uma frase: o que exatamente ele decide aqui.",
 *       "opcoes": [
 *         { "letra": "A", "titulo": "…", "descricao": "…", "recomendada": true },
 *         { "letra": "B", "titulo": "…", "descricao": "…" }
 *       ],
 *       "foraDaProposta": ["o que NÃO entra, e por quê", "…"],   // opcional
 *       "tabela": [                                      // seção SEM TELA
 *         { "arquivo": "server/x.ts", "antes": "código de hoje", "depois": "código proposto", "porque": "…" }
 *       ],
 *       "itens": [                                       // seção COM TELA
 *         {
 *           "id": "canais-frase",                       // nome da foto no confere
 *           "curto": "Título da comparação (menu e cabeçalho)",
 *           "tela": "config-canais",                    // arquivo serializado
 *           "vista": "desktop" | "celular",             // onde a diferença acontece
 *           "olhe": "Onde olhar: uma frase dizendo o que procurar.",
 *           "alvo": { "texto": "sem risco de banimento", "subir": 1 },
 *               // como achar o ponto: o elemento MAIS FUNDO que contém `texto`
 *               // (o k-ésimo com `indice`, padrão 0) e daí `subir` níveis;
 *               // ou { "css": "seletor", "indice": 0, "subir": 0 };
 *               // `dentro` (css) restringe a busca a um container, ex. "[role=dialog]".
 *           "alvoAntes": {…}, "alvoDepois": {…},        // opcional: alvo diferente por lado
 *               // (o texto mudou); `null` explícito = "esse lado NÃO tem o ponto"
 *               // — o anel fica só no lado que tem, e é isso que conta a história
 *           "medida": { "antes": 461, "depois": 390, "tela": 390, "rotulo": "…" },  // régua, opcional
 *           "pontos": [["título curto", "explicação em português de gente"]]
 *         }
 *       ]
 *     }
 *   ]
 * }
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";

const [ANTES, DEPOIS, FONTES_CSS, ITENS_JSON, SAIDA] = process.argv.slice(2);
if (!ANTES || !DEPOIS || !FONTES_CSS || !ITENS_JSON || !SAIDA) {
  console.error("uso: node gera-comparador-decisoes.mjs <ser-antes> <ser-depois> <fontes.css> <itens.json> <saida.html>");
  process.exit(2);
}

const CONF = JSON.parse(readFileSync(ITENS_JSON, "utf8"));
const DECISOES = CONF.decisoes || [];
if (!DECISOES.length) { console.error("itens.json sem `decisoes`"); process.exit(2); }

const ROTULO_PADRAO = {
  "config-canais": "Configurações · Canais",
  "config-canais-dialog": "Canais · diálogo do WhatsApp",
  "clientes-novo": "Clientes · Novo cliente",
  "clientes-novo-envio": "Clientes · depois de «Cadastrar»",
  "ajuda": "Central de ajuda",
  "ajuda-tarefa-nova": "Ajuda · tarefa nova",
  "ajuda-cadastrar": "Ajuda · Cadastrar um cliente",
};

// Itens achatados numa lista única: o menu, as setas e o `[data-i]` do
// confere contam de 1 a N sem saber de seção.
const ITENS = [];
DECISOES.forEach((d, di) => {
  (d.itens || []).forEach((it) => {
    ITENS.push({ ...it, vista: it.vista || "desktop", decisao: d.id, decisaoIdx: di });
  });
});

const telasUsadas = new Set(ITENS.map((it) => it.tela));
const telasNoDisco = existsSync(`${ANTES}/desktop`)
  ? readdirSync(`${ANTES}/desktop`).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5))
  : [];
const TELAS = [...new Set([...telasUsadas, ...telasNoDisco])].map((id) => [id, (CONF.telas || {})[id] || ROTULO_PADRAO[id] || id]);

const fontes = readFileSync(FONTES_CSS, "utf8");
const dados = { css: {}, telas: { antes: {}, depois: {} } };
const faltando = [];
for (const [estado, dir] of [["antes", ANTES], ["depois", DEPOIS]]) {
  dados.css[estado] = existsSync(`${dir}/css.txt`) ? readFileSync(`${dir}/css.txt`, "utf8") : "";
  for (const vp of ["desktop", "celular"]) {
    dados.telas[estado][vp] = {};
    for (const [nome] of TELAS) {
      const arq = `${dir}/${vp}/${nome}.html`;
      if (existsSync(arq)) dados.telas[estado][vp][nome] = readFileSync(arq, "utf8");
      else if (telasUsadas.has(nome)) faltando.push(`${estado}/${vp}/${nome}`);
    }
  }
}
if (faltando.length) console.error(`AVISO: capturas que faltam (a comparação vai abrir vazia): ${faltando.join(", ")}`);

/** JSON dentro de <script> não pode conter "</" nem "<!--". */
const jsonSeguro = (o) =>
  JSON.stringify(o).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\u0021--");
const escapar = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** `código` vira <code> nos textos escritos por mim (não nas células de código, que são escapadas inteiras). */
const cod = (t) => escapar(t).replace(/`([^`]+)`/g, "<code>$1</code>");

const NOME_TELA = Object.fromEntries(TELAS);

/* ---------- nav esquerda ---------- */

let contador = 0;
const navDecisoes = DECISOES.map((d, di) => {
  const itens = (d.itens || []).map(() => {
    const i = contador++;
    const it = ITENS[i];
    return `
    <button class="item" data-i="${i}">
      <span class="rot"><span class="num">${i + 1}</span>${escapar(it.curto)}</span>
      <span class="sub">${escapar(NOME_TELA[it.tela] || it.tela)} · ${it.vista === "celular" ? "no celular" : "no computador"}</span>
    </button>`;
  }).join("");
  const semTela = !(d.itens || []).length;
  return `
  <div class="titulo${di ? " sep" : ""}">Decisão ${di + 1}</div>
  <button class="item capa" data-decisao="${escapar(d.id)}">
    <span class="rot">${escapar(d.titulo)}</span>
    <span class="sub sem-recuo">${semTela ? "sem tela: é no código" : `${(d.itens || []).length} comparaç${(d.itens || []).length === 1 ? "ão" : "ões"}`}</span>
  </button>
  ${itens}`;
}).join("");

const menuTelas = TELAS.map(([id, rotulo]) =>
  `<button class="item peq" data-tela="${escapar(id)}">${escapar(rotulo)}</button>`).join("");

const menuTopo = DECISOES.map((d, di) =>
  `<button class="aba" data-decisao="${escapar(d.id)}"><span class="n">${di + 1}</span><span class="t">${escapar(d.titulo)}</span><span class="marca-topo" data-marca-de="${escapar(d.id)}"></span></button>`).join("");

/* ---------- resumo "O que aprovar" ---------- */

const caixinhas = DECISOES.map((d, di) => `
  <section class="caixa" data-caixa="${escapar(d.id)}">
    <div class="caixa-cab">
      <span class="num">${di + 1}</span>
      <div class="caixa-tit">
        <h3>${escapar(d.titulo)}</h3>
        <p>${escapar(d.decide || "")}</p>
      </div>
    </div>
    <div class="escolhas">
      ${(d.opcoes || []).map((o) => `
      <button class="escolha" data-marca="${escapar(o.letra)}" data-decisao-marca="${escapar(d.id)}" title="${escapar(o.titulo)}">
        <b>${escapar(o.letra)}</b><span>${escapar(o.titulo)}</span>${o.recomendada ? '<i class="rec">recomendada</i>' : ""}
      </button>`).join("")}
    </div>
    <div class="caixa-pe">
      <span class="estado" data-estado-de="${escapar(d.id)}">ainda sem escolha</span>
      <button class="ver" data-decisao="${escapar(d.id)}">ver a decisão →</button>
    </div>
  </section>`).join("");

/* ---------- capa de cada decisão ---------- */

function capaHtml(d, di) {
  const opcoes = (d.opcoes || []).map((o) => `
    <div class="opcao${o.recomendada ? " rec" : ""}">
      <div class="opcao-cab"><span class="letra">${escapar(o.letra)}</span><h3>${escapar(o.titulo)}</h3>${o.recomendada ? '<span class="pino verde">recomendada</span>' : ""}</div>
      <p>${cod(o.descricao || "")}</p>
    </div>`).join("");
  const fora = (d.foraDaProposta || []).length
    ? `<div class="bloco"><h4>Fica de fora</h4><ul class="fora">${d.foraDaProposta.map((f) => `<li>${cod(f)}</li>`).join("")}</ul></div>`
    : "";
  const tabela = (d.tabela || []).length
    ? `<div class="bloco"><h4>O que muda no código</h4>
       <div class="rolagem"><table class="codigo">
         <thead><tr><th>arquivo</th><th class="a">antes</th><th class="d">depois</th><th>por quê</th></tr></thead>
         <tbody>${d.tabela.map((l) => `<tr>
           <td><code>${escapar(l.arquivo)}</code></td>
           <td class="a"><pre>${escapar(l.antes)}</pre></td>
           <td class="d"><pre>${escapar(l.depois)}</pre></td>
           <td class="pq">${cod(l.porque)}</td>
         </tr>`).join("")}</tbody>
       </table></div></div>`
    : "";
  const lista = (d.itens || []).length
    ? `<div class="bloco"><h4>As comparações desta decisão</h4><div class="lista-comp">${(d.itens || []).map((it) => {
        const i = ITENS.findIndex((x) => x.id === it.id && x.decisao === d.id);
        return `<button class="comp" data-i="${i}"><span class="num">${i + 1}</span><span><b>${escapar(it.curto)}</b><small>${escapar(NOME_TELA[it.tela] || it.tela)} · ${it.vista === "celular" ? "no celular" : "no computador"}</small></span></button>`;
      }).join("")}</div></div>`
    : "";
  return `
    <div class="capa-dec">
      <div class="decide"><b>O que você decide</b><span>${cod(d.decide || "")}</span></div>
      <div class="bloco"><h4>Opções</h4><div class="opcoes">${opcoes}</div></div>
      ${fora}${tabela}${lista}
    </div>`;
}
const CAPAS = Object.fromEntries(DECISOES.map((d, di) => [d.id, capaHtml(d, di)]));

/* ---------- HTML ---------- */

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(CONF.titulo || "JuridFlow — decisões, antes e depois")}</title>
<style>
${fontes}
:root{
  --tinta:#0f172a; --tinta-2:#334155; --tinta-3:#64748b; --tinta-4:#94a3b8; --linha:#e2e8f0;
  --fundo:#f8fafc; --papel:#fff; --marinho:#194b86; --marinho-claro:#e8eef7;
  --vermelho:#b42318; --vermelho-bg:#fef3f2; --verde:#067647; --verde-bg:#ecfdf3;
  --ambar:#93470d; --ambar-bg:#fffaeb; --ambar-linha:#fedf89;
  --sombra:0 1px 2px rgba(15,23,42,.06),0 8px 24px rgba(15,23,42,.08);
}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--tinta);
  font-family:Inter,system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.5;
  -webkit-font-smoothing:antialiased}
header{position:sticky;top:0;z-index:30;background:var(--papel);border-bottom:1px solid var(--linha)}
.linha1{padding:10px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.marca{display:flex;align-items:center;gap:10px;min-width:0}
.marca .j{width:34px;height:34px;border-radius:9px;background:var(--marinho);color:#fff;
  font-family:Poppins,Inter,sans-serif;font-weight:800;font-size:19px;
  display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.marca b{font-size:15px;font-weight:700;letter-spacing:-.01em;display:block}
.marca small{color:var(--tinta-3);font-size:11.5px;display:block}
.chaves{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-left:auto}
.chave{display:inline-flex;background:var(--fundo);border:1px solid var(--linha);border-radius:9px;padding:3px;gap:2px}
.chave button{appearance:none;border:0;background:transparent;color:var(--tinta-2);font:inherit;
  font-weight:600;font-size:12.5px;padding:6px 12px;border-radius:7px;cursor:pointer;white-space:nowrap}
.chave button[aria-pressed=true]{background:var(--papel);color:var(--tinta);border:1px solid var(--linha);padding:5px 11px}
.rotulo{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--tinta-4)}
.topo{display:flex;gap:6px;padding:0 14px 8px;overflow-x:auto;align-items:stretch}
.aba{appearance:none;border:1px solid var(--linha);background:var(--papel);border-radius:10px;cursor:pointer;
  font:inherit;padding:7px 12px 7px 8px;display:flex;align-items:center;gap:8px;color:var(--tinta-2);
  font-weight:600;font-size:12.5px;white-space:nowrap;text-align:left}
.aba .n{width:20px;height:20px;border-radius:99px;background:var(--fundo);border:1px solid var(--linha);
  font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;color:var(--tinta-3)}
.aba[aria-current=true]{border-color:var(--marinho);color:var(--marinho);background:var(--marinho-claro)}
.aba[aria-current=true] .n{background:var(--marinho);color:#fff;border-color:var(--marinho)}
.aba.resumo{background:var(--tinta);color:#fff;border-color:var(--tinta)}
.aba.resumo[aria-current=true]{background:var(--marinho);border-color:var(--marinho);color:#fff}
.marca-topo:empty{display:none}
.marca-topo{background:var(--verde-bg);color:var(--verde);border:1px solid #abefc6;border-radius:99px;
  font-size:11px;font-weight:700;padding:1px 7px}

.corpo{display:grid;grid-template-columns:300px minmax(0,1fr);align-items:start}
nav{border-right:1px solid var(--linha);background:var(--papel);min-height:calc(100vh - 100px);padding:14px 12px 40px}
nav .titulo{padding:4px 10px 8px;font-size:11px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;color:var(--tinta-4)}
nav .titulo.sep{margin-top:14px;border-top:1px solid var(--linha);padding-top:14px}
.item{display:block;width:100%;text-align:left;appearance:none;border:0;background:transparent;
  padding:8px 11px;border-radius:9px;cursor:pointer;font:inherit;margin-bottom:2px;color:var(--tinta)}
.item:hover{background:var(--fundo)}
.item[aria-current=true]{background:var(--marinho-claro)}
.item[aria-current=true] .rot{color:var(--marinho)}
.item.capa .rot{font-weight:700}
.item.peq{padding:6px 11px;font-size:13px;font-weight:600;color:var(--tinta-2)}
.item.peq[aria-current=true]{color:var(--marinho)}
.rot{display:flex;align-items:baseline;gap:8px;font-weight:600;font-size:13px;line-height:1.3}
.num{flex:0 0 auto;width:19px;height:19px;border-radius:99px;background:var(--tinta-4);color:#fff;
  font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;
  transform:translateY(2px)}
.item[aria-current=true] .num{background:var(--marinho)}
.sub{display:block;color:var(--tinta-4);font-size:11.5px;margin-top:2px;padding-left:27px}
.sub.sem-recuo{padding-left:0}

main{padding:20px 22px 70px;min-width:0}
.cabeca{margin-bottom:12px}
.cabeca .trilha{font-size:11.5px;color:var(--tinta-4);font-weight:600;margin-bottom:2px}
.cabeca h1{margin:0 0 3px;font-size:22px;font-weight:700;letter-spacing:-.02em}
.cabeca .onde{display:inline-flex;align-items:center;gap:7px;color:var(--tinta-2);font-size:13px;flex-wrap:wrap}
.pino{display:inline-flex;align-items:center;gap:5px;background:var(--marinho-claro);color:var(--marinho);
  font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:99px}
.pino.verde{background:var(--verde-bg);color:var(--verde)}
.explica{background:var(--papel);border:1px solid var(--linha);border-left:3px solid var(--ambar-linha);
  border-radius:11px;padding:12px 15px;margin-bottom:14px;max-width:1000px}
.explica h3{margin:0 0 2px;font-size:14px;font-weight:650}
.explica p{margin:0 0 10px;color:var(--tinta-2);font-size:13px}
.explica p:last-child{margin-bottom:0}
code{background:var(--fundo);border:1px solid var(--linha);padding:1px 5px;border-radius:5px;font-size:12px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.olhe{display:flex;gap:10px;align-items:baseline;max-width:1000px;margin:-4px 0 14px;
  background:var(--ambar-bg);border:1px solid var(--ambar-linha);border-radius:10px;padding:11px 15px;
  color:var(--ambar);font-size:13px}
.olhe b{flex:0 0 auto;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}

.par{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
.lado{flex:0 0 auto}
.selo{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;margin-bottom:7px}
.selo.a{color:var(--vermelho)}
.selo.d{color:var(--verde)}
.selo i{width:10px;height:10px;border-radius:3px;display:inline-block}
.selo.a i{background:var(--vermelho)}
.selo.d i{background:var(--verde)}
.lente{position:relative;overflow:hidden;background:#fff;border-radius:12px;border:1px solid var(--linha)}
.lente.a{outline:2px solid var(--vermelho-bg)}
.lente.d{outline:2px solid var(--verde-bg)}
.lente iframe{border:0;display:block;transform-origin:0 0;background:#fff}
.anel{position:absolute;border:2px solid var(--vermelho);border-radius:7px;
  box-shadow:0 0 0 9999px rgba(15,23,42,.06);pointer-events:none}
.lente.d .anel{border-color:var(--verde)}
.borda-tela{position:absolute;top:0;bottom:0;width:0;border-left:2px dashed var(--vermelho);pointer-events:none}
.borda-tela span{position:absolute;top:6px;right:5px;background:var(--vermelho);color:#fff;
  font-size:10px;font-weight:700;padding:2px 6px;border-radius:5px;white-space:nowrap}
.aviso-lente{margin-top:7px;color:var(--tinta-3);font-size:11.5px;max-width:420px}
.aviso-lente.some{color:var(--vermelho);font-weight:600}

.regua{max-width:1000px;margin:18px 0 0;background:var(--papel);border:1px solid var(--linha);border-radius:11px;padding:13px 16px}
.regua h4{margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--tinta-4)}
.barra{display:grid;grid-template-columns:64px minmax(0,1fr) 92px;align-items:center;gap:10px;margin-bottom:7px}
.barra b{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--tinta-4)}
.barra .trilha{height:16px;background:var(--fundo);border-radius:5px;position:relative;overflow:hidden}
.barra .cabe{position:absolute;top:0;bottom:0;left:0;background:#c6d4e6}
.barra .sobra{position:absolute;top:0;bottom:0;background:var(--vermelho);opacity:.85}
.barra .marco{position:absolute;top:-3px;bottom:-3px;border-left:2px dashed var(--tinta-2)}
.barra i{font-style:normal;font-size:12.5px;font-weight:600;text-align:right;color:var(--tinta-2);font-variant-numeric:tabular-nums}
.barra i.mal{color:var(--vermelho)}
.barra i.bem{color:var(--verde)}
.regua small{display:block;margin-top:6px;color:var(--tinta-4);font-size:11.5px}
.rodape{margin-top:22px;color:var(--tinta-4);font-size:12px;max-width:1000px}
.recado{position:fixed;left:50%;bottom:26px;transform:translate(-50%,14px);opacity:0;
  background:var(--tinta);color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;
  pointer-events:none;transition:.18s;z-index:40;max-width:86vw;text-align:center;box-shadow:var(--sombra)}
.recado.ver{opacity:1;transform:translate(-50%,0)}

/* resumo "O que aprovar" */
.resumo-intro{max-width:900px;color:var(--tinta-2);margin:0 0 16px}
.caixas{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px;max-width:1200px}
.caixa{background:var(--papel);border:1px solid var(--linha);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.caixa.marcada{border-color:var(--marinho)}
.caixa-cab{display:flex;gap:10px;align-items:flex-start}
.caixa-cab .num{transform:none;margin-top:2px;background:var(--marinho)}
.caixa-tit h3{margin:0;font-size:15px;font-weight:700;letter-spacing:-.01em}
.caixa-tit p{margin:2px 0 0;color:var(--tinta-3);font-size:12.5px}
.escolhas{display:flex;flex-direction:column;gap:6px}
.escolha{appearance:none;border:1px solid var(--linha);background:var(--fundo);border-radius:10px;padding:8px 10px;
  display:flex;align-items:center;gap:10px;cursor:pointer;font:inherit;text-align:left;color:var(--tinta)}
.escolha b{width:24px;height:24px;border-radius:7px;border:1px solid var(--linha);background:var(--papel);
  display:inline-flex;align-items:center;justify-content:center;font-size:12px;flex:0 0 auto}
.escolha span{flex:1;font-weight:500;font-size:13px}
.escolha .rec{font-style:normal;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  color:var(--verde);background:var(--verde-bg);padding:2px 7px;border-radius:99px}
.escolha.marcada{background:var(--marinho-claro);border-color:var(--marinho)}
.escolha.marcada b{background:var(--marinho);color:#fff;border-color:var(--marinho)}
.escolha.marcada span{font-weight:600;color:var(--marinho)}
.caixa-pe{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid var(--linha);padding-top:10px}
.caixa-pe .estado{font-size:12px;color:var(--tinta-4);font-weight:600}
.caixa.marcada .caixa-pe .estado{color:var(--marinho)}
.caixa-pe .ver{appearance:none;border:0;background:transparent;color:var(--marinho);font:inherit;font-weight:700;font-size:12.5px;cursor:pointer;padding:4px 6px;border-radius:7px}
.caixa-pe .ver:hover{background:var(--marinho-claro)}
.nota-resumo{margin-top:14px;color:var(--tinta-4);font-size:12px;max-width:900px}

/* capa da decisão */
.capa-dec{max-width:1100px}
.decide{display:flex;gap:12px;align-items:baseline;background:var(--papel);border:1px solid var(--linha);
  border-left:3px solid var(--marinho);border-radius:11px;padding:12px 15px;margin-bottom:16px;font-size:14px}
.decide b{flex:0 0 auto;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--marinho)}
.bloco{margin-bottom:18px}
.bloco h4{margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--tinta-4)}
.opcoes{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.opcao{background:var(--papel);border:1px solid var(--linha);border-radius:14px;padding:13px 15px}
.opcao.rec{border-color:#abefc6;background:#fbfffc}
.opcao-cab{display:flex;align-items:center;gap:9px;margin-bottom:5px;flex-wrap:wrap}
.opcao-cab h3{margin:0;font-size:14px;font-weight:700}
.letra{width:26px;height:26px;border-radius:8px;background:var(--tinta);color:#fff;font-weight:700;font-size:13px;
  display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.opcao.rec .letra{background:var(--verde)}
.opcao p{margin:0;color:var(--tinta-2);font-size:13px}
.fora{margin:0;padding:0 0 0 18px;color:var(--tinta-2)}
.fora li{margin-bottom:5px}
.rolagem{overflow-x:auto;background:var(--papel);border:1px solid var(--linha);border-radius:14px}
table.codigo{border-collapse:collapse;width:100%;min-width:900px;font-size:12.5px}
table.codigo th{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--tinta-4);
  text-align:left;padding:10px 12px;border-bottom:1px solid var(--linha);background:var(--fundo)}
table.codigo th.a{color:var(--vermelho)} table.codigo th.d{color:var(--verde)}
table.codigo td{padding:10px 12px;border-bottom:1px solid var(--linha);vertical-align:top}
table.codigo tr:last-child td{border-bottom:0}
table.codigo td.a{background:var(--vermelho-bg)} table.codigo td.d{background:var(--verde-bg)}
table.codigo pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;
  white-space:pre-wrap;word-break:break-word;line-height:1.45}
table.codigo td.pq{color:var(--tinta-2);min-width:220px}
.lista-comp{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}
.comp{appearance:none;border:1px solid var(--linha);background:var(--papel);border-radius:12px;padding:10px 12px;
  display:flex;gap:10px;align-items:flex-start;cursor:pointer;font:inherit;text-align:left;color:var(--tinta)}
.comp:hover{border-color:var(--marinho)}
.comp .num{background:var(--marinho);transform:none;margin-top:2px}
.comp b{display:block;font-size:13px;font-weight:600}
.comp small{display:block;color:var(--tinta-4);font-size:11.5px}

@media (max-width:1000px){
  .corpo{grid-template-columns:1fr}
  nav{border-right:0;border-bottom:1px solid var(--linha);min-height:0}
  main{padding:14px}
  .chaves{margin-left:0;width:100%}
}
</style>
</head>
<body>

<header>
  <div class="linha1">
    <div class="marca">
      <div class="j">J</div>
      <div>
        <b>${escapar(CONF.titulo || "JuridFlow — decisões, antes e depois")}</b>
        <small>${escapar(CONF.subtitulo || "telas do sistema rodando, serializadas")}</small>
      </div>
    </div>
    <div class="chaves">
      <span class="rotulo">Vista</span>
      <div class="chave" id="chave-modo">
        <button data-modo="lado" aria-pressed="true">Lado a lado</button>
        <button data-modo="piscar" aria-pressed="false">Piscar</button>
        <button data-modo="inteira" aria-pressed="false">Tela inteira</button>
      </div>
      <div class="chave">
        <button id="anterior">← anterior</button>
        <button id="proximo">próximo →</button>
      </div>
    </div>
  </div>
  <div class="topo">
    <button class="aba resumo" data-decisao="resumo"><span class="t">O que aprovar</span></button>
    ${menuTopo}
  </div>
</header>

<div class="corpo">
  <nav>
    ${navDecisoes}
    <div class="titulo sep">Navegar pelo sistema</div>
    ${menuTelas}
  </nav>
  <main>
    <div class="cabeca">
      <div class="trilha" id="trilha"></div>
      <h1 id="titulo">—</h1>
      <div class="onde" id="onde"></div>
    </div>
    <div id="resumo" hidden>
      <p class="resumo-intro">Cada caixa é uma decisão. Marque a letra que você aprova só para se organizar enquanto olha — a marca é do seu navegador, não vai para lugar nenhum. A resposta de verdade é a de sempre: “pode fazer” por escrito, dizendo a letra.</p>
      <div class="caixas">${caixinhas}</div>
      <p class="nota-resumo">A opção marcada como <b>recomendada</b> é a que o estudo sugere; a escolha é sua. As comparações mostram a tela de hoje (antes) e a proposta rodando numa cópia descartável do sistema (depois) — nada disso está no ar.</p>
    </div>
    <div id="capa" hidden></div>
    <div id="explica"></div>
    <div class="par" id="par"></div>
    <div id="regua"></div>
    <div class="rodape" id="rodape"></div>
  </main>
</div>

<div class="recado" id="recado"></div>

<script type="application/json" id="dados">${jsonSeguro(dados)}</script>
<script type="application/json" id="itens">${jsonSeguro(ITENS)}</script>
<script type="application/json" id="decisoes">${jsonSeguro(DECISOES.map((d) => ({ id: d.id, titulo: d.titulo, decide: d.decide || "", opcoes: (d.opcoes || []).map((o) => ({ letra: o.letra, titulo: o.titulo })) })))}</script>
<script type="application/json" id="capas">${jsonSeguro(CAPAS)}</script>
<script type="application/json" id="nomes">${jsonSeguro(NOME_TELA)}</script>
<script>
const D = JSON.parse(document.getElementById("dados").textContent);
const ITENS = JSON.parse(document.getElementById("itens").textContent);
const DECISOES = JSON.parse(document.getElementById("decisoes").textContent);
const CAPAS = JSON.parse(document.getElementById("capas").textContent);
const NOME = JSON.parse(document.getElementById("nomes").textContent);
const MEDIDA = { desktop:[1440,900], celular:[390,844] };
/** Caixa da lupa: o celular pede caixa alta e estreita; o monitor, larga. */
const CAIXA = { desktop:[548,372], celular:[406,452] };
const PAD = 26;

// vista: "resumo" | "capa" | "item" | "tela"
let vista = "resumo", idx = 0, modo = "lado", decisaoAberta = null, telaLivre = null, estadoLivre = "depois";
const marcas = {}; // decisão → letra marcada (só nesta aba, só classe CSS)

const recado = document.getElementById("recado");
let tRec;
function falar(t){
  recado.textContent = t; recado.classList.add("ver");
  clearTimeout(tRec); tRec = setTimeout(()=>recado.classList.remove("ver"), 2400);
}

function pagina(estado, vista, tela){
  const corpo = ((D.telas[estado]||{})[vista]||{})[tela];
  if (!corpo) return '<body style="font:14px Inter,sans-serif;color:#64748b;padding:30px">Tela não capturada neste tamanho.</body>';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>' +
    D.css[estado] + '</style></head>' + corpo + '</html>';
}

/**
 * Acha o ponto que mudou dentro da tela. Por texto: o elemento MAIS FUNDO que
 * contém o texto (senão pegaria o <body>), o k-ésimo se pedirem, e daí sobe
 * os níveis pedidos. Por css: querySelectorAll(css)[indice].
 */
function acharAlvo(doc, alvo){
  if (!alvo) return null;
  const raiz = alvo.dentro ? doc.querySelector(alvo.dentro) : doc.body;
  if (!raiz) return null;
  let el = null;
  if (alvo.css) {
    el = raiz.querySelectorAll(alvo.css)[alvo.indice || 0] || null;
  } else if (alvo.texto) {
    const alvos = [...raiz.querySelectorAll("*")].filter((e) => {
      if (e.tagName === "SCRIPT" || e.tagName === "STYLE") return false;
      const t = (e.textContent || "");
      if (!t.includes(alvo.texto)) return false;
      return ![...e.children].some((f) => (f.textContent || "").includes(alvo.texto));
    });
    el = alvos[alvo.indice || 0] || null;
  }
  if (!el) return null;
  for (let i = 0; i < (alvo.subir || 0) && el.parentElement && el.parentElement.tagName !== "BODY"; i++) el = el.parentElement;
  return el;
}

/** Alvo de um lado: o específico do lado, senão o comum; null explícito = esse lado não tem o ponto. */
function alvoDoLado(it, lado){
  const chave = lado === "antes" ? "alvoAntes" : "alvoDepois";
  if (chave in it) return it[chave];
  return it.alvo || null;
}

function medirAlvo(frame, alvo, rolagemForcada){
  const doc = frame.contentDocument;
  if (!doc || !alvo) return null;
  const el = acharAlvo(doc, alvo);
  if (!el) return null;
  const se = doc.scrollingElement;
  const r0 = el.getBoundingClientRect();
  // Rola só na vertical: na horizontal a tela tem que ficar como ABRE, senão
  // o vazamento lateral (que é o defeito) desaparece da foto.
  // A MESMA rolagem nos dois lados, de propósito: quando o conserto empurra
  // o elemento para a linha de baixo, é essa descida que conta a história.
  se.scrollTop = rolagemForcada != null ? rolagemForcada : Math.max(0, r0.top + se.scrollTop - 70);
  se.scrollLeft = 0;
  const r = el.getBoundingClientRect();
  return { left:r.left, top:r.top, width:r.width, height:r.height, rolagem: se.scrollTop,
    texto: (el.textContent || "").trim().slice(0, 160), tag: el.tagName.toLowerCase(),
    cls: (typeof el.className === "string" ? el.className : "").slice(0, 60) };
}

function rolarPara(frame, rolagem){
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.scrollingElement.scrollTop = rolagem; doc.scrollingElement.scrollLeft = 0;
}

function carregar(frame, estado, vista, tela){
  return new Promise((ok) => { frame.onload = () => ok(); frame.srcdoc = pagina(estado, vista, tela); });
}

function lado(classe, rotulo){
  return '<div class="lado"><div class="selo ' + classe + '"><i></i>' + rotulo + '</div>' +
    '<div class="lente ' + classe + '"><iframe title="' + rotulo + '"></iframe>' +
    '<div class="anel" hidden></div><div class="borda-tela" hidden><span></span></div></div>' +
    '<div class="aviso-lente"></div></div>';
}

function barra(rotulo, valor, tela, pior, teto, comLimite){
  const cabe = Math.min(valor, tela) / teto * 100;
  const sobra = Math.max(0, valor - tela) / teto * 100;
  const marco = tela / teto * 100;
  return '<div class="barra"><b>' + rotulo + '</b><div class="trilha">' +
    '<div class="cabe" style="width:' + (comLimite ? cabe : valor / teto * 100).toFixed(2) + '%"></div>' +
    (comLimite && sobra > 0 ? '<div class="sobra" style="left:' + marco.toFixed(2) + '%;width:' + sobra.toFixed(2) + '%"></div>' : '') +
    (comLimite ? '<div class="marco" style="left:' + marco.toFixed(2) + '%"></div>' : '') +
    '</div><i class="' + (pior ? "mal" : "bem") + '">' + valor + 'px</i></div>';
}

const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const codigo = (t) => esc(t).replace(/\\x60([^\\x60]+)\\x60/g, "<code>$1</code>");

function pintarMenus(){
  document.querySelectorAll("nav [data-i], .lista-comp [data-i]").forEach((b) => b.setAttribute("aria-current", String(vista === "item" && Number(b.dataset.i) === idx)));
  document.querySelectorAll("[data-tela]").forEach((b) => b.setAttribute("aria-current", String(vista === "tela" && telaLivre === b.dataset.tela)));
  const decAtual = vista === "capa" ? decisaoAberta : vista === "item" ? ITENS[idx].decisao : vista === "resumo" ? "resumo" : null;
  document.querySelectorAll("[data-decisao]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.decisao === decAtual)));
  document.querySelectorAll("[data-modo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modo === modo)));
  for (const d of DECISOES){
    const m = marcas[d.id];
    document.querySelectorAll('[data-marca-de="' + d.id + '"]').forEach((e) => e.textContent = m ? "aprovar " + m : "");
    document.querySelectorAll('[data-decisao-marca="' + d.id + '"]').forEach((b) => b.classList.toggle("marcada", b.dataset.marca === m));
    const caixa = document.querySelector('[data-caixa="' + d.id + '"]');
    if (caixa) caixa.classList.toggle("marcada", !!m);
    const est = document.querySelector('[data-estado-de="' + d.id + '"]');
    if (est) est.textContent = m ? "você marcou: " + m + " — " + (d.opcoes.find((o) => o.letra === m) || {}).titulo : "ainda sem escolha";
  }
}

async function pintar(){
  pintarMenus();
  const resumo = document.getElementById("resumo");
  const capa = document.getElementById("capa");
  const par = document.getElementById("par");
  const regua = document.getElementById("regua");
  const explica = document.getElementById("explica");
  const trilha = document.getElementById("trilha");
  const rodape = document.getElementById("rodape");
  resumo.hidden = vista !== "resumo"; capa.hidden = vista !== "capa";
  par.innerHTML = ""; regua.innerHTML = ""; explica.innerHTML = ""; rodape.textContent = ""; trilha.textContent = "";

  if (vista === "resumo"){
    document.getElementById("titulo").textContent = "O que aprovar";
    document.getElementById("onde").textContent = DECISOES.length + " decisões · cada uma com opções, e as comparações de tela onde a mudança aparece.";
    return;
  }

  if (vista === "capa"){
    const di = DECISOES.findIndex((d) => d.id === decisaoAberta);
    const d = DECISOES[di];
    trilha.textContent = "Decisão " + (di + 1) + " de " + DECISOES.length;
    document.getElementById("titulo").textContent = d.titulo;
    document.getElementById("onde").innerHTML = marcas[d.id] ? '<span class="pino verde">você marcou ' + marcas[d.id] + '</span>' : '<span class="pino">sem marca ainda — marque em “O que aprovar”</span>';
    capa.innerHTML = CAPAS[d.id];
    capa.querySelectorAll("[data-i]").forEach((b) => b.onclick = () => irPara(Number(b.dataset.i)));
    pintarMenus();
    return;
  }

  // "Navegar pelo sistema": uma tela inteira por vez, com chave de estado.
  if (vista === "tela"){
    explica.innerHTML = '<div class="explica" style="border-left-color:var(--linha)"><p>' +
      'Aqui não há comparação: é o sistema para você passear, nos dois tamanhos. ' +
      'Use <b>Lado a lado</b> numa comparação numerada à esquerda para ver a diferença.</p></div>';
    document.getElementById("titulo").textContent = NOME[telaLivre] || telaLivre;
    document.getElementById("onde").innerHTML = '<span class="pino">versão: ' + estadoLivre + '</span> ' +
      '<button class="ver" id="trocaEstado" style="appearance:none;border:1px solid var(--linha);background:#fff;border-radius:7px;padding:3px 9px;font:inherit;font-size:12px;cursor:pointer">ver ' + (estadoLivre === "antes" ? "depois" : "antes") + '</button>';
    document.getElementById("trocaEstado").onclick = () => { estadoLivre = estadoLivre === "antes" ? "depois" : "antes"; pintar(); };
    par.innerHTML = lado("d", "computador") + lado("d", "celular");
    const [dk, cel] = par.querySelectorAll(".lente");
    const fdk = dk.querySelector("iframe"), fcel = cel.querySelector("iframe");
    fdk.style.width = "1440px"; fdk.style.height = "900px"; fdk.style.transform = "scale(0.42)";
    dk.style.width = "605px"; dk.style.height = "378px";
    fcel.style.width = "390px"; fcel.style.height = "844px"; fcel.style.transform = "scale(0.52)";
    cel.style.width = "203px"; cel.style.height = "439px";
    par.querySelectorAll(".selo").forEach((s, i) => { s.className = "selo d"; s.innerHTML = '<i></i>' + (i ? "celular" : "computador"); });
    await Promise.all([carregar(fdk, estadoLivre, "desktop", telaLivre), carregar(fcel, estadoLivre, "celular", telaLivre)]);
    rodape.textContent = "Foto, não protótipo: dentro da moldura nada abre, filtra ou envia.";
    return;
  }

  const it = ITENS[idx];
  const dec = DECISOES[it.decisaoIdx];
  const dentroDaDecisao = ITENS.filter((x) => x.decisao === it.decisao);
  const k0 = dentroDaDecisao.findIndex((x) => x === it) + 1;
  const [L,A] = MEDIDA[it.vista];
  const [BW,BH] = modo === "inteira" ? [it.vista === "celular" ? 390 : 720, it.vista === "celular" ? 844 : 450] : CAIXA[it.vista];

  trilha.innerHTML = 'Decisão ' + (it.decisaoIdx + 1) + ' · <button data-decisao="' + esc(it.decisao) + '" style="appearance:none;border:0;background:transparent;font:inherit;color:var(--marinho);cursor:pointer;padding:0;font-weight:700">' + esc(dec.titulo) + '</button> · comparação ' + k0 + ' de ' + dentroDaDecisao.length;
  trilha.querySelector("[data-decisao]").onclick = () => abrirDecisao(it.decisao);
  document.getElementById("titulo").textContent = (idx + 1) + ". " + it.curto;
  document.getElementById("onde").innerHTML =
    '<span class="pino">' + esc(NOME[it.tela] || it.tela) + '</span>' +
    '<span>' + (it.vista === "celular" ? "como aparece num celular de 390px de largura" : "como aparece num monitor de 1440px") + '</span>';

  explica.innerHTML = '<div class="explica">' + (it.pontos || [])
    .map(([t,d]) => "<h3>" + codigo(t) + "</h3><p>" + codigo(d) + "</p>").join("") + '</div>' +
    (it.olhe ? '<div class="olhe"><b>Onde olhar</b><span>' + codigo(it.olhe) + '</span></div>' : "");

  par.innerHTML = modo === "piscar"
    ? '<div class="lado"><div class="selo a" id="seloPiscar"><i></i>piscando entre antes e depois</div>' +
      '<div class="lente a" style="position:relative">' +
      '<iframe title="antes"></iframe><div class="anel" hidden></div><div class="borda-tela" hidden><span></span></div>' +
      '<iframe title="depois" style="position:absolute;inset:0"></iframe>' +
      '</div><div class="aviso-lente">O mesmo pedaço da tela, no mesmo lugar, alternando a cada 0,9s. É assim que o olho acha diferença pequena.</div></div>'
    : lado("a", "antes") + lado("d", "depois");

  const lentes = [...par.querySelectorAll(".lente")];
  const frames = [...par.querySelectorAll("iframe")];
  const avisos = [...par.querySelectorAll(".aviso-lente")];
  for (const f of frames){ f.style.width = L + "px"; f.style.height = A + "px"; }
  for (const l of lentes){ l.style.width = BW + "px"; l.style.height = BH + "px"; }

  const [fa, fd] = [frames[0], frames[1]];
  await Promise.all([
    carregar(fa, "antes", it.vista, it.tela),
    carregar(fd, "depois", it.vista, it.tela),
  ]);

  if (modo === "inteira"){
    const k = Math.min(1, BW / L, BH / A);
    for (const f of frames) f.style.transform = "scale(" + k + ")";
    for (const l of lentes){ l.style.width = Math.round(L*k) + "px"; l.style.height = Math.round(A*k) + "px"; }
    marcar(fa, lentes[0], alvoDoLado(it, "antes"), k, L);
    marcar(fd, lentes[1] || lentes[0], alvoDoLado(it, "depois"), k, L);
    rodape.textContent = "Tela inteira, nos dois estados. O anel marca o ponto que mudou.";
    return;
  }

  const aa = alvoDoLado(it, "antes"), ad = alvoDoLado(it, "depois");
  let ra = medirAlvo(fa, aa);
  let rd = medirAlvo(fd, ad, ra ? ra.rolagem : null);
  if (ra && !rd && ad) { /* depois não achou: tenta sem forçar a rolagem */ rd = medirAlvo(fd, ad, null); if (rd) { ra = medirAlvo(fa, aa, rd.rolagem) || ra; } }
  if (!ra && !rd){
    // Cai na tela inteira SÓ nesta comparação: mexer na variável de modo
    // fazia todas as seguintes abrirem sem lupa, sem ninguém ter pedido.
    falar("Não localizei o ponto nesta captura — mostrando a tela inteira.");
    const k = Math.min(1, BW / L, BH / A);
    for (const f of frames) f.style.transform = "scale(" + k + ")";
    for (const l of lentes){ l.style.width = Math.round(L*k) + "px"; l.style.height = Math.round(A*k) + "px"; }
    rodape.textContent = "Ponto não localizado nesta captura — tela inteira, nos dois estados.";
    return;
  }
  // Um lado só: o ponto existe num estado e não no outro — o recorte vem do
  // lado que tem, e o outro recebe a MESMA rolagem, sem anel.
  const base = ra || rd;
  if (!ra) rolarPara(fa, base.rolagem);
  if (!rd) rolarPara(fd, base.rolagem);
  const rA = ra || base, rD = rd || base;

  // O recorte cobre os DOIS retângulos (eles mudam de lugar e de tamanho)
  // e, no celular, sempre começa na borda esquerda e vai além dos 390px —
  // sem isso a linha da borda da tela some da foto e o vazamento fica invisível.
  const cel = it.vista === "celular";
  const dirA = rA.left + rA.width, dirD = rD.left + rD.width;
  const x0 = cel ? 0 : Math.max(0, Math.min(rA.left, rD.left) - PAD);
  const x1 = cel ? Math.max(404, Math.max(dirA, dirD) + PAD) : Math.max(dirA, dirD) + PAD;
  const y0 = Math.max(0, Math.min(rA.top, rD.top) - PAD);
  const y1 = Math.max(rA.top + rA.height, rD.top + rD.height) + PAD;
  const necW = Math.max(x1 - x0, cel ? 424 : 520);
  const necH = Math.max(y1 - y0, 170);
  // Teto de 1.8×: zoom demais corta o contexto e o dono perde a referência.
  const k = Math.max(0.45, Math.min(1.8, Math.min(BW/necW, BH/necH)));
  aplicar(fa, lentes[0], ra, k, x0, y0, it);
  aplicar(fd, lentes[modo === "piscar" ? 0 : 1], rd, k, x0, y0, it, modo === "piscar");
  if (modo !== "piscar"){
    if (!ra && aa !== null) avisos[0].textContent = "";
    if (aa === null) { avisos[0].classList.add("some"); avisos[0].textContent = "Aqui o ponto ainda não existe."; }
    if (ad === null) { avisos[1].classList.add("some"); avisos[1].textContent = "Aqui o ponto some — é isso que muda."; }
    if (!ra && aa) { avisos[0].classList.add("some"); avisos[0].textContent = "Ponto não localizado neste lado da captura."; }
    if (!rd && ad) { avisos[1].classList.add("some"); avisos[1].textContent = "Ponto não localizado neste lado da captura."; }
  }
  rodape.textContent =
    "Zoom de " + k.toFixed(1) + "× no mesmo pedaço da tela, nos dois estados. " +
    (cel ? "A linha tracejada é a borda do celular: o que passa dela o usuário só vê arrastando a página." : "");

  if (it.medida){
    const r = it.medida;
    const comLimite = r.antes > r.tela;
    const teto = Math.max(r.antes, r.depois, r.tela) * 1.06;
    regua.innerHTML = '<div class="regua"><h4>' + esc(r.rotulo || "largura do conteúdo · a tela do celular tem 390px") + '</h4>' +
      barra("antes", r.antes, r.tela, comLimite, teto, comLimite) +
      barra("depois", r.depois, r.tela, r.depois > r.tela, teto, comLimite) +
      '<small>' + (comLimite
        ? "A linha tracejada é a borda da tela. A barra vermelha é o quanto o conteúdo passava dela."
        : "Medido no navegador, nos dois estados.") +
      '</small></div>';
  }

  if (modo === "piscar") piscar();
}

function marcar(frame, lente, alvo, k, L){
  const r = medirAlvo(frame, alvo);
  frame.style.transform = "scale(" + k + ")";
  const anel = lente.querySelector(".anel");
  if (!r || !anel) return;
  anel.hidden = false;
  anel.style.left = ((r.left)*k - 3) + "px";
  anel.style.top = ((r.top)*k - 3) + "px";
  anel.style.width = (r.width*k + 6) + "px";
  anel.style.height = (r.height*k + 6) + "px";
}

function aplicar(frame, lente, r, k, tx, ty, it, segundo){
  frame.style.transform = "scale(" + k + ") translate(" + (-tx) + "px," + (-ty) + "px)";
  const anel = segundo ? null : lente.querySelector(".anel");
  if (anel && r){
    anel.hidden = false;
    anel.style.left = ((r.left - tx)*k - 3) + "px";
    anel.style.top = ((r.top - ty)*k - 3) + "px";
    anel.style.width = (r.width*k + 6) + "px";
    anel.style.height = (r.height*k + 6) + "px";
  }
  if (it.vista === "celular" && !segundo){
    const borda = lente.querySelector(".borda-tela");
    const x = (390 - tx)*k;
    if (borda && x > 12 && x < lente.clientWidth - 2){
      borda.hidden = false;
      borda.style.left = x + "px";
      borda.querySelector("span").textContent = "borda da tela · 390px";
    }
  }
}

let timerPiscar;
function piscar(){
  clearInterval(timerPiscar);
  const fs = document.querySelectorAll("#par iframe");
  const selo = document.getElementById("seloPiscar");
  if (fs.length < 2) return;
  let mostrandoDepois = false;
  const troca = () => {
    mostrandoDepois = !mostrandoDepois;
    fs[1].style.opacity = mostrandoDepois ? "1" : "0";
    if (selo){
      selo.className = "selo " + (mostrandoDepois ? "d" : "a");
      selo.innerHTML = '<i></i>' + (mostrandoDepois ? "depois" : "antes");
    }
  };
  troca();
  timerPiscar = setInterval(troca, 900);
}

function irPara(i){ clearInterval(timerPiscar); if (!ITENS.length) return; idx = (i + ITENS.length) % ITENS.length; vista = "item"; pintar(); }
function abrirDecisao(id){ clearInterval(timerPiscar); if (id === "resumo") { vista = "resumo"; } else { decisaoAberta = id; vista = "capa"; } pintar(); }

document.querySelectorAll("nav [data-i]").forEach((b) => b.onclick = () => irPara(Number(b.dataset.i)));
document.querySelectorAll("header [data-decisao], nav [data-decisao], #resumo [data-decisao]").forEach((b) => b.onclick = () => abrirDecisao(b.dataset.decisao));
document.querySelectorAll("[data-tela]").forEach((b) => b.onclick = () => { clearInterval(timerPiscar); telaLivre = b.dataset.tela; vista = "tela"; pintar(); });
document.querySelectorAll("[data-modo]").forEach((b) => b.onclick = () => { clearInterval(timerPiscar); modo = b.dataset.modo; if (vista === "item") pintar(); else pintarMenus(); });
document.querySelectorAll("[data-marca]").forEach((b) => b.onclick = () => {
  const d = b.dataset.decisaoMarca, l = b.dataset.marca;
  marcas[d] = marcas[d] === l ? null : l;
  pintarMenus();
});
// próximo/anterior andam pelas comparações; da capa, "próximo" abre a primeira da decisão
document.getElementById("anterior").onclick = () => irPara(vista === "item" ? idx - 1 : idx);
document.getElementById("proximo").onclick = () => {
  if (vista === "item") return irPara(idx + 1);
  if (vista === "capa"){ const i = ITENS.findIndex((x) => x.decisao === decisaoAberta); if (i >= 0) return irPara(i); }
  irPara(0);
};
addEventListener("keydown", (e) => {
  if (e.target && /input|textarea/i.test(e.target.tagName)) return;
  if (e.key === "ArrowLeft") document.getElementById("anterior").click();
  if (e.key === "ArrowRight") document.getElementById("proximo").click();
});

// Para o confere-comparador-decisoes.mjs medir com a MESMA busca do comparador.
window.__comparador = {
  itens: ITENS, decisoes: DECISOES,
  vistaAtual: () => ({ vista, idx, modo, decisaoAberta }),
  medirLados(){
    const it = ITENS[idx];
    const frames = [...document.querySelectorAll("#par iframe")];
    if (frames.length < 2) return null;
    const medir = (f, alvo) => {
      const doc = f.contentDocument;
      if (!doc || !alvo) return null;
      const el = acharAlvo(doc, alvo);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const se = doc.scrollingElement;
      return { left: Math.round(r.left), top: Math.round(r.top + se.scrollTop), width: Math.round(r.width), height: Math.round(r.height),
        dir: Math.round(r.right), texto: (el.textContent || "").trim().slice(0, 120), tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 50) };
    };
    return {
      id: it.id, vista: it.vista, esperaAntes: alvoDoLado(it, "antes") !== null, esperaDepois: alvoDoLado(it, "depois") !== null,
      a: medir(frames[0], alvoDoLado(it, "antes")), d: medir(frames[1], alvoDoLado(it, "depois")),
      conteudo: frames.map((f) => { const doc = f.contentDocument; return doc && doc.body ? { nos: doc.body.querySelectorAll("*").length, texto: (doc.body.innerText || "").length } : { nos: 0, texto: 0 }; }),
    };
  },
};
pintar();
</script>
</body>
</html>
`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} — ${(html.length / 1024 / 1024).toFixed(2)} MB · ${DECISOES.length} decisões · ${ITENS.length} comparações · ${TELAS.length} telas no passeio`);
