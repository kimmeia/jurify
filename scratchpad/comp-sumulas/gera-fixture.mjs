/**
 * A sondagem que RODOU EM PRODUÇÃO, transcrita do print que o dono mandou.
 * Serve só pra montar o comparador: as duas versões da tela (antes e depois)
 * são fotografadas com os MESMOS dados, que são dados de verdade.
 */
import { writeFileSync } from "node:fs";

// fonte, nome, pergunta, status, ms, veredito, temEmenta, causa, retry
const L = [
  ["DataJud", "índice api_publica_stj", "índice existe? traz grau e movimentos? existe campo de ementa?", 200, 412, "responde-json", false, null, null],
  ["DataJud", "índice api_publica_tst", "índice existe? traz grau e movimentos? existe campo de ementa?", 200, 388, "responde-json", false, null, null],
  ["DataJud", "índice api_publica_tse", "índice existe? traz grau e movimentos? existe campo de ementa?", 200, 401, "responde-json", false, null, null],
  ["DataJud", "índice api_publica_stm", "índice existe? traz grau e movimentos? existe campo de ementa?", 200, 377, "responde-json", false, null, null],
  ["DataJud", "vocabulário de movimentos do STJ", "quais movimentos o STJ usa? é o que calibra o desfecho de recurso", 200, 3991, "responde-json", false, null, null],
  ["STF", "busca de jurisprudência (backend da SPA)", "a SPA tem backend JSON aberto? traz ementa?", null, 1204, "erro", null, "tls", null],
  ["STF", "portal de dados abertos", "existe portal com dataset pra baixar em lote?", null, 88, "erro", null, "dns", null],
  ["STF", "portal institucional", "o domínio responde? (controle — se nem isso abrir, é rede)", null, 1150, "erro", null, "tls", null],
  ["STJ", "SCON — pesquisa de jurisprudência", "o 403 é do cabeçalho ou do IP? (repete com UA de navegador)", 403, 268, "bloqueado", false, null, "persistiu"],
  ["STJ", "portal institucional", "controle do domínio — mesmo 403 do SCON?", 403, 240, "bloqueado", false, null, "persistiu"],
  ["DJEN", "Comunica API — com filtro", "o 403 é do cabeçalho ou do IP? (repete com UA de navegador)", 403, 196, "bloqueado", false, null, "persistiu"],
  ["DJEN", "Comunica API — raiz, sem filtro", "o 403 vem do endpoint ou dos parâmetros que eu inventei?", 403, 181, "bloqueado", false, null, "persistiu"],
  ["CNJ", "portal de dados abertos", "existe dataset do CNJ pra baixar em lote?", null, 74, "erro", null, "dns", null],
  ["TJSP", "e-SAJ — julgados de 2º grau", "a consulta de jurisprudência do maior tribunal do país abre daqui?", 200, 612, "responde-html", true, null, null],
  ["TJSP", "Diário da Justiça Eletrônico", "o diário do tribunal responde? é onde a decisão é publicada", 200, 505, "responde-html", false, null, null],
  ["TJMG", "consulta de jurisprudência", "outro TJ, outro sistema — o padrão se repete?", 200, 646, "responde-html", true, null, null],
  ["TJRJ", "consulta de jurisprudência", "outro TJ, outro sistema — o padrão se repete?", 404, 330, "bloqueado", false, null, null],
  ["TRF4", "jurisprudência", "justiça federal publica ementa em endereço aberto?", 200, 1180, "responde-html", true, null, null],
  ["TJCE", "PJe (controle)", "controle: o motor próprio loga aqui todo dia, então tem que responder", 200, 890, "responde-html", false, null, null],
  ["LexML", "SRU explain", "o protocolo de coleta está de pé? quais índices ele expõe?", 200, 430, "responde-html", false, null, null],
  // as duas que entraram DEPOIS da sondagem dele — sem medição ainda
  ["STJ", "STJ · Súmulas — endereço da coleta", "a lista de súmulas abre daqui? o texto do enunciado vem nela?", 403, 205, "bloqueado", false, null, "persistiu"],
  ["LexML", "LexML · Rede de informação legislativa e jurídica — endereço da coleta", "a lista de súmulas abre daqui? o texto do enunciado vem nela?", 200, 512, "responde-html", false, null, null],
];

const resultados = L.map(([fonte, nome, pergunta, status, ms, veredito, temEmenta, causa, retry]) => ({
  fonte, nome, pergunta, status, tipo: veredito === "responde-json" ? "application/json" : "text/html",
  bytes: veredito === "erro" ? 0 : 24000, ms, veredito, forma: "",
  temEmenta, sumulasNoCorpo: 0, erro: causa ? "detalhe técnico na dobra" : null,
  amostra: "", causa, retryNavegador: retry, datajud: null, vocabulario: null,
}));

writeFileSync("scratchpad/comp-sumulas/sonda-producao.json", JSON.stringify({
  resultados, termo: "dano moral", bloqueioDeRede: false,
  comEmenta: resultados.filter((r) => r.temEmenta).map((r) => `${r.fonte}/${r.nome}`),
  comSumula: [],
}, null, 1));
console.log("fixture com", resultados.length, "linhas");
