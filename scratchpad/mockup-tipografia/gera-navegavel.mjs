// Gera mockup-cara-unica-navegavel.html — o protótipo clicável da Fatia 2.
// Contexto e plano: docs/frontend-sistema-visual-2026-09-10.md
//
// A skill de mockup pede "sem JavaScript"; o dono pediu navegável
// explicitamente ("gere um navegável para eu visualizar como ficará no mundo
// real"), e o projeto já tem precedente (mockup-correcoes-p1.html). O JS aqui
// é só troca de classe no <body> — nenhum dado, nenhuma lógica de produto.
//
// O modo "Hoje" é FIEL ao código: Clientes, Acordos, Financeiro e
// Movimentações não têm <h1> nenhum hoje; Processos e Agenda têm
// `text-pagina`; Relatórios tem `text-2xl`. Os ritmos (space-y-*) são os
// que estão no repo. Conferido por grep em 11/09.
import { readFileSync, writeFileSync } from "node:fs";
const FONTES = readFileSync(process.argv[2], "utf8");
const RAIZ = process.argv[3];

/* ─────────────────────────── ícones ─────────────────────────── */
const sv = (d, o = {}) =>
  `<svg width="${o.w || 16}" height="${o.w || 16}" viewBox="0 0 24 24" fill="none"><path d="${d}" stroke="${o.c || "currentColor"}" stroke-width="${o.sw || 1.9}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const IC = {
  agenda: "M8 2v3M16 2v3M3.5 9h17M4.5 5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  fone: "M4 12a8 8 0 0 1 16 0M4 12v4a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2Zm16 0v4a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2Z",
  users: "M16 20v-2a4 4 0 0 0-8 0v2M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  doc: "M14 3H7a1.6 1.6 0 0 0-1.6 1.6v14.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V8L14 3Zm0 0v5h4.6M9 13h6M9 17h4",
  aperto: "M7 10h3l2 3 2-6 2 3h3M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z",
  grade: "M4 4h6v7H4V4Zm10 0h6v11h-6V4ZM4 15h6v5H4v-5Zm10 4h6v1h-6v-1Z",
  calc: "M9 3v18M4.5 3h15a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-15A1.5 1.5 0 0 1 4.5 3Zm8.5 6h-4m4 4h-4m4 4h-4",
  raio: "M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z",
  cifrao: "M12 2v20M17 5.5H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6",
  barras: "M4 20V10m5 10V4m5 16v-7m5 7V8",
  balanca: "M12 3v18M7 21h10M5 7h14M8 7l-3 6h6L8 7Zm8 0-3 6h6l-3-6Z",
  relogio: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5.4l3.4 2",
  pasta: "M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5v-10Z",
  mais: "M12 5v14M5 12h14",
  chev: "m6 9 6 6 6-6",
  lupa: "",
};
const lupa = (c = "#6d7d8c") =>
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="${c}" stroke-width="2"/><path d="m20 20-3.2-3.2" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`;
const kebab = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.7" fill="#6d7d8c"/><circle cx="12" cy="12" r="1.7" fill="#6d7d8c"/><circle cx="19" cy="12" r="1.7" fill="#6d7d8c"/></svg>`;

/* ─────────────────────────── menu ─────────────────────────── */
const MENU = [
  { grupo: "Dia a dia", itens: [
    { id: "agenda", rot: "Agenda", ic: IC.agenda, bd: "4" },
    { id: "atendimento", rot: "Atendimento", ic: IC.fone, bd: "7", inerte: true },
  ]},
  { grupo: "Carteira", itens: [
    { id: "clientes", rot: "Clientes", ic: IC.users },
    { id: "processos", rot: "Processos", ic: IC.doc, bd: "2" },
    { id: "acordos", rot: "Acordos", ic: IC.aperto },
    { id: "kanban", rot: "Kanban", ic: IC.grade, inerte: true },
  ]},
  { grupo: "Ferramentas", itens: [
    { id: "calculos", rot: "Cálculos", ic: IC.calc, inerte: true },
    { id: "automacoes", rot: "Automações", ic: IC.raio, inerte: true },
  ]},
  { grupo: "Gestão", itens: [
    { id: "financeiro", rot: "Financeiro", ic: IC.cifrao },
    { id: "relatorios", rot: "Relatórios", ic: IC.barras },
  ]},
];

/* ─────────────────────────── conteúdo das telas ─────────────────────────── */
const PROCESSOS = [
  ["Maria Aparecida Nogueira de Sousa", "0812345-67.2024.8.06.0001 · TJCE", "Juntada de petição — recurso inominado da parte autora", "há 2 horas", "#097245", { t: "aviso", x: "2º grau?" }, null],
  ["Construtora Vale Verde Ltda", "0034521-89.2023.8.06.0170 · TJCE", "Despacho: cite-se a parte requerida", "há 1 dia", "#097245", null, { t: "ok", x: "prazo em 5 dias" }],
  ["Francisco Edilson Martins Rocha", "1004567-22.2025.4.01.3100 · TRF1", "Login falhou no tribunal — senha do Cofre recusada", "há 12 dias", "#a8231b", null, null, true],
  ["Antônia Gomes Vasconcelos", "0700891-45.2024.8.06.0064 · TJCE", "Sem movimentação registrada ainda", "—", "#aab6c2", { t: "mudo", x: "Pausado" }, null],
  ["José Ribamar da Silva Filho", "0056789-12.2024.8.06.0001 · TJCE", "Sentença publicada — procedente em parte", "há 3 dias", "#8a5a0b", null, { t: "al", x: "prazo vence hoje" }],
  ["Laticínios Serra Azul S/A", "0091234-56.2023.8.06.0001 · TJCE", "Conclusos para julgamento — 3ª Câmara de Direito Privado", "há 6 dias", "#097245", { t: "aviso", x: "2º grau?" }, null],
];

const CLIENTES = [
  ["Maria Aparecida Nogueira de Sousa", "810.***.***-04 · (85) 99796-5706", "Trabalhista · Ana Lúcia", "cliente desde mar/2024", "#097245", null, null],
  ["Construtora Vale Verde Ltda", "12.***.***/0001-70 · (85) 3255-1180", "Cível · Ana Lúcia", "cliente desde jan/2023", "#097245", null, null],
  ["Tirzah Barbosa de Lima", "sem CPF · (85) 98811-1508", "Lead · sem responsável", "cadastrado hoje", "#8a5a0b", { t: "aviso", x: "cadastro incompleto" }, null],
  ["Francisco Edilson Martins Rocha", "045.***.***-11 · (85) 99120-3344", "Previdenciário · Rafael", "cliente desde set/2025", "#097245", null, null],
  ["Comércio de Peças Ipiranga ME", "33.***.***/0001-05 · (85) 3244-9090", "Cível · Milena", "cliente desde ago/2024", "#097245", null, null],
  ["Cleide Farias do Nascimento", "702.***.***-88 · (88) 99733-1201", "Consumidor · Rafael", "cliente desde nov/2024", "#097245", null, null],
];

const ACORDOS = [
  ["Maria Aparecida Nogueira de Sousa", "0812345-67.2024.8.06.0001", "R$ 12.000,00 em 6× · 3 pagas", "próxima 20/09", "#097245", null, { t: "ok", x: "em dia" }],
  ["Construtora Vale Verde Ltda", "0034521-89.2023.8.06.0170", "R$ 48.500,00 em 10× · 7 pagas", "próxima 15/09", "#097245", null, { t: "ok", x: "em dia" }],
  ["José Ribamar da Silva Filho", "0056789-12.2024.8.06.0001", "R$ 7.400,00 em 4× · 1 paga", "venceu 02/09", "#a8231b", null, { t: "al", x: "13 dias de atraso" }],
  ["Laticínios Serra Azul S/A", "0091234-56.2023.8.06.0001", "R$ 95.000,00 em 12× · 12 pagas", "quitado 28/08", "#097245", { t: "mudo", x: "Quitado" }, null],
  ["Antônia Gomes Vasconcelos", "0700891-45.2024.8.06.0064", "R$ 3.200,00 em 2× · 0 pagas", "venceu 05/09", "#a8231b", null, { t: "al", x: "10 dias de atraso" }],
];

const AGENDA = [
  ["08:30", "Audiência de instrução", "Maria Aparecida · 3ª Vara do Trabalho", "Ana Lúcia", "#a8231b", "hoje"],
  ["10:00", "Reunião — proposta de acordo", "Construtora Vale Verde · escritório", "Ana Lúcia", "#194b86", "hoje"],
  ["14:00", "Perícia médica", "Francisco Edilson · INSS Centro", "Rafael", "#8a5a0b", "hoje"],
  ["16:30", "Ligar para o cliente", "Tirzah Barbosa · retorno do WhatsApp", "Milena", "#6d7d8c", "hoje"],
  ["09:00", "Audiência de conciliação", "Raimundo Nonato · Juizado Especial", "Rafael", "#194b86", "amanhã"],
  ["11:30", "Assinatura de contrato", "Comércio de Peças Ipiranga · escritório", "Milena", "#097245", "amanhã"],
];

const COBRANCAS = [
  ["Maria Aparecida Nogueira de Sousa", "Honorários — parcela 4/6", "R$ 2.000,00", "20/09/2026", "ok", "Em dia"],
  ["Construtora Vale Verde Ltda", "Honorários — parcela 8/10", "R$ 4.850,00", "15/09/2026", "ok", "Em dia"],
  ["José Ribamar da Silva Filho", "Acordo — parcela 2/4", "R$ 1.850,00", "02/09/2026", "al", "13 dias em atraso"],
  ["Antônia Gomes Vasconcelos", "Entrada do acordo", "R$ 1.600,00", "05/09/2026", "al", "10 dias em atraso"],
  ["Comércio de Peças Ipiranga ME", "Consultoria mensal", "R$ 1.200,00", "10/09/2026", "pago", "Pago em 09/09"],
  ["Cleide Farias do Nascimento", "Honorários — parcela 1/3", "R$ 900,00", "25/09/2026", "ok", "Em dia"],
];

const KPIS = [
  ["R$ 83.150", "recebido no período", "+12% vs. agosto", "ok"],
  ["20", "contratos fechados", "2 cancelados depois", ""],
  ["R$ 214.300", "valor fechado", "+8% vs. agosto", "ok"],
  ["38", "leads que entraram", "18 ainda em aberto", ""],
  ["3", "contratos cancelados", "R$ 18.400 recebidos antes", "al"],
];

/* ─────────────────────────── telas ─────────────────────────── */
const TELAS = [
  {
    id: "processos",
    rot: "Processos",
    rotDir: "última mov.",
    pastilhasVazio: [["0", "monitorados", ""]],
    hoje: { titulo: { txt: "Processos", cls: "tt-pagina" }, sub: "O robô entra nos tribunais todo dia e avisa o que mudou nos seus processos", pastilhas: true, ritmo: "16px", ritmoCls: "space-y-4" },
    sub: "O robô entra nos tribunais todo dia e avisa o que mudou nos seus processos",
    pastilhas: [["6", "monitorados", ""], ["1", "parado", "al"], ["2", "novas ações", ""]],
    acoes: [["Resumo diário", ""], ["Monitorar processo", "bp"]],
    abas: ["Monitorados", "Novas ações", "Movimentações", "Cofre de senhas"],
    filtros: ["Buscar por nome, CNJ ou CPF do cliente", "Todos os tribunais", "Qualquer situação"],
    tipo: "lista", dados: PROCESSOS, icone: IC.balanca,
    rodape: ["<b>2</b> processos com prazo aberto · <b>1</b> credencial precisa de atenção", "1 prazo vence hoje"],
    vazioHoje: "Nenhum monitoramento ativo",
    vazio: { ic: IC.pasta, t: "Nenhum processo monitorado ainda", d: "Cadastre o primeiro e o robô passa a avisar o que muda no tribunal, todo dia.", b: "Monitorar processo" },
  },
  {
    id: "clientes",
    rot: "Clientes",
    rotDir: "situação",
    pastilhasVazio: [["0", "cadastros", ""]],
    hoje: { titulo: null, sub: null, pastilhas: false, ritmo: "24px", ritmoCls: "space-y-6" },
    sub: "Quem é cliente, quem ainda é lead, e de quem é cada um",
    pastilhas: [["418", "cadastros", ""], ["12", "leads em aberto", ""], ["3", "faltando dados", "al"]],
    acoes: [["Conferência de cadastros", ""], ["Novo cliente", "bp"]],
    abas: ["Todos", "Clientes", "Leads", "Arquivados"],
    filtros: ["Buscar por nome, CPF/CNPJ ou telefone", "Todos os responsáveis", "Qualquer área"],
    tipo: "lista", dados: CLIENTES, icone: IC.users,
    rodape: ["<b>418</b> cadastros · <b>12</b> leads aguardando primeiro contato", "3 faltando dados"],
    vazioHoje: "Nenhum cliente encontrado.",
    vazio: { ic: IC.users, t: "Nenhum cliente com esse filtro", d: "Tente limpar os filtros, ou cadastre um cliente novo para começar a carteira.", b: "Novo cliente" },
  },
  {
    id: "agenda",
    rot: "Agenda",
    rotDir: "responsável",
    pastilhasVazio: [["0", "hoje", ""]],
    hoje: { titulo: { txt: "Agenda", cls: "tt-pagina" }, sub: null, pastilhas: false, ritmo: "16px", ritmoCls: "space-y-4 py-2" },
    sub: "Audiências, perícias e compromissos da equipe, no fuso do escritório",
    pastilhas: [["4", "hoje", ""], ["1", "audiência", "al"], ["9", "esta semana", ""]],
    acoes: [["Hoje", ""], ["Novo compromisso", "bp"]],
    abas: ["Dia", "Semana", "Mês", "Lista"],
    filtros: ["Buscar por cliente, processo ou local", "Toda a equipe", "Todos os tipos"],
    tipo: "agenda", dados: AGENDA, icone: IC.agenda,
    rodape: ["<b>4</b> compromissos hoje · <b>1</b> audiência às 08:30", "1 sem confirmação"],
    vazioHoje: "Nenhum evento com este filtro",
    vazio: { ic: IC.agenda, t: "Nada marcado para hoje", d: "A agenda está livre. Marque um compromisso ou mude o filtro de período.", b: "Novo compromisso" },
  },
  {
    id: "acordos",
    rot: "Acordos",
    rotDir: "parcela",
    pastilhasVazio: [["0", "acordos", ""]],
    hoje: { titulo: null, sub: null, pastilhas: false, ritmo: "14px", ritmoCls: "space-y-3.5 p-4 md:p-6" },
    sub: "O que cada cliente combinou de pagar e quanto já entrou",
    pastilhas: [["14", "em dia", ""], ["2", "atrasados", "al"], ["R$ 166 mil", "a receber", ""]],
    acoes: [["Exportar", ""], ["Novo acordo", "bp"]],
    abas: ["Todos", "Em dia", "Atrasados", "Quitados"],
    filtros: ["Buscar acordo por cliente ou processo", "Qualquer situação", "Todos os responsáveis"],
    tipo: "lista", dados: ACORDOS, icone: IC.aperto,
    rodape: ["<b>R$ 166.100</b> a receber · <b>2</b> acordos em atraso", "R$ 4.800 vencidos"],
    vazioHoje: "Nenhum acordo cadastrado.",
    vazio: { ic: IC.aperto, t: "Nenhum acordo cadastrado ainda", d: "Quando você fechar um parcelamento com o cliente, registre aqui para acompanhar o que entra.", b: "Novo acordo" },
  },
  {
    id: "financeiro",
    rot: "Financeiro",
    rotDir: "situação",
    pastilhasVazio: [["R$ 0", "a receber", ""]],
    hoje: { titulo: null, sub: null, pastilhas: false, ritmo: "24px", ritmoCls: "space-y-6" },
    sub: "Cobranças, despesas e comissões do escritório",
    pastilhas: [["R$ 12.400", "a receber", ""], ["R$ 3.450", "em atraso", "al"], ["R$ 1.200", "recebido hoje", ""]],
    acoes: [["Importar extrato", ""], ["Nova cobrança", "bp"]],
    abas: ["Cobranças", "Despesas", "Comissões", "Assinaturas"],
    filtros: ["Buscar por cliente ou descrição", "Setembro de 2026", "Qualquer situação"],
    tipo: "tabela", dados: COBRANCAS, icone: IC.cifrao,
    rodape: ["<b>6</b> cobranças no período · <b>R$ 12.400</b> previstos", "2 em atraso"],
    vazioHoje: "Sem lançamentos no período.",
    vazio: { ic: IC.cifrao, t: "Nenhuma cobrança neste período", d: "Mude o mês no filtro acima, ou crie a primeira cobrança para este cliente.", b: "Nova cobrança" },
  },
  {
    id: "relatorios",
    rot: "Relatórios",
    rotDir: "",
    pastilhasVazio: null,
    hoje: { titulo: { txt: "Relatórios", cls: "tt-2xl" }, sub: null, pastilhas: false, ritmo: "16px", ritmoCls: "space-y-4" },
    sub: "O que entrou, o que foi fechado e quem vendeu, no período que você escolher",
    pastilhas: [["01–30/09", "período", ""], ["toda a equipe", "filtro", ""]],
    acoes: [["Período", "ch"], ["Exportar PDF", ""]],
    abas: ["Comercial", "Financeiro", "Operacional", "Agendamentos"],
    filtros: ["Buscar por atendente ou origem", "Toda a equipe", "Todos os setores"],
    tipo: "kpis", dados: KPIS, icone: IC.barras,
    rodape: ["Contratos fechados contam pela data do fechamento · pagamentos, pela data em que caíram", "2 cancelados depois"],
    vazioHoje: "Sem canal no período.",
    vazio: { ic: IC.barras, t: "Nada aconteceu neste período", d: "Não houve lead, fechamento ou pagamento entre as datas escolhidas. Tente um período maior.", b: "Mudar período" },
  },
];

/* ─────────────────────────── renderizadores ─────────────────────────── */
const pastilha = ([n, r, c]) => `<span class="pst ${c}"><b>${n}</b> ${r}</span>`;
const botao = ([t, c]) =>
  `<span class="bt ${c === "bp" ? "bp" : ""}">${c === "bp" ? sv(IC.mais, { w: 15, c: "#fff", sw: 2.4 }) : ""}${t}${c === "ch" ? sv(IC.chev, { w: 13, c: "#6d7d8c", sw: 2.2 }) : ""}</span>`;

const selo = (s) => (s ? `<span class="selo ${s.t}">${s.x}</span>` : "");
const pilula = (p) =>
  p ? `<span class="pil ${p.t}">${sv(IC.relogio, { w: 11, c: p.t === "al" ? "#a8231b" : "#097245", sw: 2.2 })}${p.x}</span>` : "";

const linhaLista = (icone, rotDir) => ([nome, meta, txt, tempo, cor, s, p, alerta]) => `
  <div class="ln">
    <div class="av ${alerta ? "al" : ""}">${sv(icone, { w: 18, c: alerta ? "#a8231b" : "#194b86", sw: 1.7 })}</div>
    <div class="mid">
      <div class="l1"><span class="dot" style="background:${cor}"></span><span class="nm">${nome}</span>${selo(s)}</div>
      <div class="l2">${meta}</div>
      <div class="l3"><span class="mv ${alerta ? "al" : ""}">${txt}</span>${pilula(p)}</div>
    </div>
    <div class="dir"><div class="tp">${tempo}</div><div class="tr">${rotDir}</div></div>
    <div class="kb">${kebab}</div>
  </div>`;

const linhaAgenda = ([hora, titulo, quem, resp, cor, dia]) => `
  <div class="ln">
    <div class="hr"><b>${hora}</b><span>${dia}</span></div>
    <div class="mid">
      <div class="l1"><span class="dot" style="background:${cor}"></span><span class="nm">${titulo}</span></div>
      <div class="l3"><span class="mv">${quem}</span></div>
    </div>
    <div class="dir"><div class="tp">${resp}</div><div class="tr">responsável</div></div>
    <div class="kb">${kebab}</div>
  </div>`;

const tabela = (linhas) => `
  <div class="tb">
    <div class="th"><span>Cliente</span><span>Descrição</span><span class="d">Valor</span><span class="d">Vencimento</span><span>Situação</span></div>
    ${linhas
      .map(
        ([cli, desc, val, venc, st, stx]) => `
      <div class="tr2">
        <span class="c-nome">${cli}</span>
        <span class="c-desc">${desc}</span>
        <span class="d c-val">${val}</span>
        <span class="d c-venc">${venc}</span>
        <span><span class="selo ${st === "pago" ? "mudo" : st}">${stx}</span></span>
      </div>`,
      )
      .join("")}
  </div>`;

const kpis = (linhas) => `
  <div class="kpis">
    ${linhas
      .map(
        ([v, r, s, c]) => `
      <div class="kpi ${c}">
        <div class="kv">${v}</div>
        <div class="kr">${r}</div>
        <div class="ks">${s}</div>
      </div>`,
      )
      .join("")}
  </div>`;

const conteudo = (t) =>
  t.tipo === "agenda"
    ? t.dados.map(linhaAgenda).join("")
    : t.tipo === "tabela"
      ? tabela(t.dados)
      : t.tipo === "kpis"
        ? kpis(t.dados)
        : t.dados.map(linhaLista(t.icone, t.rotDir)).join("");

const esqueleto = (t) =>
  t.tipo === "kpis"
    ? `<div class="kpis">${[1, 2, 3, 4, 5].map(() => `<div class="kpi"><div class="sk sk-v"></div><div class="sk sk-r"></div><div class="sk sk-s"></div></div>`).join("")}</div>`
    : `<div class="esq">${[72, 58, 65, 54, 68, 61]
        .map((w) => `<div class="el"><div class="eq"></div><div class="ec"><div class="eb1" style="width:${w}%"></div><div class="eb2" style="width:${Math.round(w * 0.6)}%"></div></div><div class="ed"></div></div>`)
        .join("")}</div>`;

/* cabeçalho "hoje": fiel ao que existe no código */
const cabecalhoHoje = (t) => {
  const h = t.hoje;
  const esq = h.titulo
    ? `<div><div class="${h.titulo.cls}">${h.titulo.txt}</div>${h.sub ? `<div class="tt-sub">${h.sub}</div>` : ""}${h.pastilhas ? `<div class="pastilhas q-dados">${t.pastilhas.map(pastilha).join("")}</div><div class="pastilhas q-vazio">${t.pastilhasVazio.map(pastilha).join("")}</div><div class="pastilhas q-carregando">${t.pastilhasVazio.map(pastilha).join("")}</div>` : ""}</div>`
    : `<div class="busca-so">${lupa()}<span>${t.filtros[0]}</span></div>`;
  return `<div class="hd">${esq}<div class="acoes">${t.acoes.map(botao).join("")}</div></div>`;
};

const cabecalhoNovo = (t) => `
  <div class="hd">
    <div>
      <div class="tt-pagina">${t.rot}</div>
      <div class="tt-sub">${t.sub}</div>
      ${
        t.pastilhasVazio
          ? `<div class="pastilhas q-dados">${t.pastilhas.map(pastilha).join("")}</div>
             <div class="pastilhas q-vazio">${t.pastilhasVazio.map(pastilha).join("")}</div>
             <div class="pastilhas q-carregando">${t.pastilhasVazio.map(pastilha).join("")}</div>`
          : `<div class="pastilhas">${t.pastilhas.map(pastilha).join("")}</div>`
      }
    </div>
    <div class="acoes">${t.acoes.map(botao).join("")}</div>
  </div>`;

const abas = (t, on = 0) =>
  `<div class="abas">${t.abas.map((a, i) => `<span class="${i === on ? "on" : ""}">${a}</span>`).join("")}</div>`;

const filtros = (t, comBusca = true) => `
  <div class="filtros">
    ${comBusca ? `<div class="busca">${lupa()}<span>${t.filtros[0]}</span></div>` : ""}
    <div class="sel">${t.filtros[1]}${sv(IC.chev, { w: 13, c: "#6d7d8c", sw: 2.2 })}</div>
    <div class="sel">${t.filtros[2]}${sv(IC.chev, { w: 13, c: "#6d7d8c", sw: 2.2 })}</div>
  </div>`;

const caixa = (t, modo) => `
  <div class="caixa">
    <div class="caixa-topo">
      <span>
        <span class="micro q-dados">${t.tipo === "kpis" ? "resultado do período" : `${t.dados.length} ${t.id === "financeiro" ? "cobranças" : t.id === "agenda" ? "compromissos" : "registros"}`}</span>
        <span class="micro q-vazio">nenhum registro</span>
        <span class="micro q-carregando">buscando…</span>
      </span>
      <span class="micro q-dados">atualizado hoje às 06:12</span>
    </div>
    <div class="corpo est-dados">${conteudo(t)}</div>
    <div class="corpo est-vazio">
      ${
        modo === "hoje"
          ? `<div class="vazio-ruim">${t.vazioHoje}</div>`
          : `<div class="vazio-bom">
               <div class="ib">${sv(t.vazio.ic, { w: 26, c: "#6d7d8c", sw: 1.6 })}</div>
               <div class="vt">${t.vazio.t}</div>
               <div class="vd">${t.vazio.d}</div>
               <div class="vb">${sv(IC.mais, { w: 15, c: "#fff", sw: 2.4 })}${t.vazio.b}</div>
             </div>`
      }
    </div>
    <div class="corpo est-carregando">
      ${
        modo === "hoje"
          ? `<div class="car-ruim"><span class="giro"></span><span>Carregando...</span></div>`
          : esqueleto(t)
      }
    </div>
  </div>`;

const rodape = (t) =>
  `<div class="rodape"><span>${t.rodape[0]}</span><span class="pill-al">${t.rodape[1]}</span></div>`;

const tela = (t) => `
<section class="tela" data-tela="${t.id}">
  <div class="var var-hoje" style="--ritmo:${t.hoje.ritmo}">
    ${cabecalhoHoje(t)}
    ${abas(t)}
    ${filtros(t, !!t.hoje.titulo)}
    ${caixa(t, "hoje")}
    ${rodape(t)}
  </div>
  <div class="var var-proposto">
    ${cabecalhoNovo(t)}
    ${abas(t)}
    ${filtros(t)}
    ${caixa(t, "proposto")}
    ${rodape(t)}
  </div>
</section>`;

/* ─────────────────────────── página ─────────────────────────── */
const menuHtml = MENU.map(
  (g) => `
  <div class="grupo">
    <div class="gt">${g.grupo}</div>
    ${g.itens
      .map(
        (i) =>
          `<div class="mi ${i.inerte ? "inerte" : ""}" ${i.inerte ? "" : `data-ir="${i.id}"`}>${sv(i.ic, { w: 16 })}<span>${i.rot}</span>${i.bd ? `<span class="bd">${i.bd}</span>` : ""}</div>`,
      )
      .join("")}
  </div>`,
).join("");

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JuridFlow · Cara de produto único · navegável</title>
${FONTES}
<style>
  :root{
    --bg:#f4f6f8; --surface:#fff; --borda:#dfe4ea; --hairline:#eef1f4;
    --tinta:#16202c; --corpo:#33404f; --mudo:#5a6b7d; --fraco:#6d7d8c; --fantasma:#aab6c2;
    --acento:#194b86; --acento-forte:#11325c; --acento-bg:#eaf1f8;
    --ok:#097245; --ok-bg:#e9f6ef; --aviso:#8a5a0b; --aviso-bg:#fdf6e7;
    --alerta:#a8231b; --alerta-bg:#fdf0ef; --alerta-borda:#f0c5c1;
    --menu:#16202c; --menu-txt:#c4ced8; --menu-on:#24384f; --marca:#7f22fe;
    /* a escala aprovada na Fatia 1 */
    --t-micro:11px; --t-apoio:11.5px; --t-corpo:13px; --t-secao:15px;
    --t-titulo:20px; --t-numero:22px; --t-pagina:26px;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%}
  body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--tinta);display:flex;overflow:hidden}

  /* ── menu ── */
  .menu{width:232px;flex:0 0 232px;background:var(--menu);color:var(--menu-txt);
        padding:16px 0 0;display:flex;flex-direction:column;overflow-y:auto}
  .logo{display:flex;align-items:center;gap:9px;padding:0 16px 16px}
  .logo .j{width:29px;height:29px;border-radius:8px;background:var(--marca);color:#fff;
           font-family:'Poppins';font-weight:800;font-size:16px;display:flex;align-items:center;justify-content:center}
  .logo .n{font-family:'Poppins';font-weight:700;font-size:var(--t-secao);color:#fff}
  .grupo{padding:0 8px;margin-bottom:9px}
  .gt{font-size:var(--t-micro);font-weight:700;text-transform:uppercase;letter-spacing:.06em;
      color:#7d8b99;padding:7px 8px 4px}
  .mi{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:7px;
      font-size:var(--t-corpo);font-weight:500;cursor:pointer;transition:background .12s}
  .mi svg{opacity:.85;flex:0 0 16px}
  .mi:hover{background:#1e2d3d}
  .mi.on{background:var(--menu-on);color:#fff}
  .mi.on svg{opacity:1}
  .mi.inerte{opacity:.55;cursor:default}
  .mi.inerte:hover{background:transparent}
  .mi .bd{margin-left:auto;background:var(--aviso);color:#fff;border-radius:20px;
          padding:1px 6px;font-size:var(--t-micro);font-weight:700}

  /* ── área principal ── */
  main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}

  /* barra do mockup — NÃO faz parte do produto */
  .demo{flex:0 0 auto;background:#101a24;color:#c4ced8;padding:9px 22px;
        display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  .demo .tag{font-size:var(--t-micro);font-weight:800;letter-spacing:.08em;text-transform:uppercase;
             background:#24384f;color:#8fb4e0;border-radius:5px;padding:3px 8px}
  .demo .lb{font-size:var(--t-apoio);color:#8b9aa8;font-weight:600}
  .seg{display:flex;gap:3px;background:#1c2a38;padding:3px;border-radius:9px}
  .seg span{padding:5px 13px;border-radius:7px;font-size:var(--t-corpo);font-weight:600;
            color:#93a2b0;cursor:pointer;transition:all .12s;white-space:nowrap}
  .seg span:hover{color:#dbe4ec}
  .seg span.on{background:#f4f6f8;color:#16202c}
  .demo .dica{margin-left:auto;font-size:var(--t-apoio);color:#7d8b99}

  .rolagem{flex:1;overflow-y:auto;padding:24px 28px 28px}
  .tela{display:none}
  .tela.on{display:block}
  .var{display:none;flex-direction:column}
  body[data-modo="hoje"] .var-hoje{display:flex;gap:var(--ritmo)}
  body[data-modo="proposto"] .var-proposto{display:flex;gap:16px}

  /* ── cabeçalho ── */
  .hd{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .tt-pagina{font-family:'Poppins';font-weight:700;font-size:var(--t-pagina);letter-spacing:-.01em;line-height:1}
  .tt-2xl{font-weight:700;font-size:24px;letter-spacing:-.02em;line-height:1}
  .tt-sub{margin-top:5px;font-size:var(--t-corpo);color:var(--mudo)}
  .pastilhas{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  .pst{border:1px solid var(--borda);background:var(--surface);border-radius:10px;padding:5px 11px;
       font-size:var(--t-apoio);color:var(--mudo)}
  .pst b{font-size:var(--t-corpo);color:var(--tinta);font-variant-numeric:tabular-nums}
  .pst.al{background:var(--alerta-bg);border-color:var(--alerta-borda);color:var(--alerta)}
  .pst.al b{color:var(--alerta)}
  .acoes{display:flex;gap:8px;flex:0 0 auto;align-items:center}
  .bt{border:1px solid var(--borda);background:var(--surface);border-radius:9px;padding:8px 13px;
      font-size:var(--t-corpo);font-weight:500;color:var(--corpo);display:inline-flex;align-items:center;gap:7px;
      white-space:nowrap;cursor:pointer}
  .bt.bp{background:var(--acento);border-color:var(--acento);color:#fff;font-weight:600;
         box-shadow:0 8px 18px -9px #194b8699}
  .busca-so{flex:1;max-width:380px;border:1px solid var(--borda);background:var(--surface);border-radius:9px;
            padding:10px 12px;display:flex;align-items:center;gap:9px;font-size:var(--t-corpo);color:var(--fraco)}

  /* ── abas e filtros ── */
  .abas{display:flex;gap:3px;background:var(--hairline);padding:3px;border-radius:9px;align-self:flex-start}
  .abas span{padding:7px 15px;border-radius:7px;font-size:var(--t-corpo);font-weight:600;
             color:var(--mudo);cursor:pointer;white-space:nowrap}
  .abas span.on{background:var(--surface);color:var(--tinta);box-shadow:0 1px 3px #0f172a1a}
  .filtros{background:var(--surface);border:1px solid var(--borda);border-radius:12px;padding:11px 13px;
           display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .busca{flex:1;min-width:240px;max-width:380px;border:1px solid var(--borda);border-radius:9px;height:38px;
         padding:0 12px;display:flex;align-items:center;gap:9px;font-size:var(--t-corpo);color:var(--fraco)}
  .sel{height:38px;border:1px solid var(--borda);border-radius:9px;padding:0 11px;display:flex;
       align-items:center;gap:8px;font-size:var(--t-corpo);font-weight:500;color:var(--corpo);white-space:nowrap}

  /* ── caixa de conteúdo ── */
  .caixa{background:var(--surface);border:1px solid var(--borda);border-radius:12px;overflow:hidden}
  .caixa-topo{padding:10px 15px;border-bottom:1px solid var(--hairline);
              display:flex;align-items:center;justify-content:space-between;gap:12px}
  .micro{font-size:var(--t-micro);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fraco)}
  .corpo{display:none}
  body[data-estado="dados"] .est-dados,
  body[data-estado="vazio"] .est-vazio,
  body[data-estado="carregando"] .est-carregando{display:block}
  /* contagem, pastilhas e rodapé acompanham o estado: lista vazia com o
     cabeçalho dizendo "6 monitorados" é incoerência que derruba a proposta */
  .q-dados,.q-vazio,.q-carregando{display:none}
  body[data-estado="dados"] span.q-dados,
  body[data-estado="vazio"] span.q-vazio,
  body[data-estado="carregando"] span.q-carregando{display:inline}
  body[data-estado="dados"] .pastilhas.q-dados,
  body[data-estado="vazio"] .pastilhas.q-vazio,
  body[data-estado="carregando"] .pastilhas.q-carregando{display:flex}
  /* especificidade acima da definição de .rodape, que vem depois nesta folha:
     com (0,1,0) nos dois, a última venceria e o rodapé apareceria na lista vazia */
  body[data-estado] .rodape{display:none}
  body[data-estado="dados"] .rodape{display:flex}

  /* ── linha de lista ── */
  .ln{display:flex;align-items:center;gap:12px;padding:11px 15px;border-bottom:1px solid var(--hairline)}
  .ln:last-child{border-bottom:0}
  .av{width:36px;height:36px;border-radius:10px;flex:0 0 36px;background:var(--acento-bg);
      display:flex;align-items:center;justify-content:center}
  .av.al{background:var(--alerta-bg)}
  .hr{width:52px;flex:0 0 52px;text-align:right}
  .hr b{display:block;font-size:var(--t-corpo);font-weight:700;font-variant-numeric:tabular-nums}
  .hr span{display:block;font-size:var(--t-micro);color:var(--fraco);margin-top:1px}
  .mid{flex:1;min-width:0}
  .l1{display:flex;align-items:center;gap:7px;min-width:0}
  .dot{width:8px;height:8px;border-radius:50%;flex:0 0 8px}
  .nm{font-size:var(--t-corpo);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .l2{margin-top:2px;font-size:var(--t-apoio);font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;
      color:var(--mudo);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .l3{margin-top:5px;display:flex;align-items:center;gap:7px;min-width:0}
  .mv{font-size:var(--t-corpo);color:var(--corpo);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mv.al{color:var(--alerta)}
  .selo{border-radius:5px;padding:2px 6px;font-size:var(--t-micro);font-weight:600;flex:0 0 auto;white-space:nowrap}
  .selo.aviso{background:var(--aviso-bg);color:var(--aviso)}
  .selo.mudo{background:var(--hairline);color:var(--fraco)}
  .selo.ok{background:var(--ok-bg);color:var(--ok)}
  .selo.al{background:var(--alerta-bg);color:var(--alerta)}
  .pil{border-radius:20px;padding:2px 9px;font-size:var(--t-micro);font-weight:600;flex:0 0 auto;
       display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .pil.ok{background:var(--ok-bg);color:var(--ok)}
  .pil.al{background:var(--alerta-bg);color:var(--alerta)}
  .dir{flex:0 0 auto;text-align:right;min-width:92px}
  .tp{font-size:var(--t-apoio);font-weight:600;color:var(--tinta)}
  .tr{font-size:var(--t-micro);color:var(--fraco);margin-top:1px}
  .kb{width:28px;flex:0 0 28px;display:flex;justify-content:center;color:var(--fraco);cursor:pointer}

  /* ── tabela ── */
  .tb{width:100%}
  .th,.tr2{display:grid;grid-template-columns:1.5fr 1.7fr .8fr .9fr 1.1fr;gap:12px;align-items:center;
           padding:10px 15px}
  .th{border-bottom:1px solid var(--hairline)}
  .th span{font-size:var(--t-micro);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fraco)}
  .th .d,.tr2 .d{text-align:right}
  .tr2{border-bottom:1px solid var(--hairline);font-size:var(--t-corpo)}
  .tr2:last-child{border-bottom:0}
  .c-nome{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .c-desc{color:var(--mudo);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .c-val{font-weight:700;font-variant-numeric:tabular-nums}
  .c-venc{color:var(--mudo);font-variant-numeric:tabular-nums}

  /* ── kpis ── */
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--hairline)}
  .kpi{background:var(--surface);padding:14px 15px}
  .kv{font-size:var(--t-numero);font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
  .kpi.al .kv{color:var(--alerta)}
  .kr{font-size:var(--t-apoio);color:var(--mudo);margin-top:4px}
  .ks{font-size:var(--t-micro);color:var(--fraco);margin-top:5px}
  .kpi.ok .ks{color:var(--ok)}
  .kpi.al .ks{color:var(--alerta)}

  /* ── vazio ── */
  .vazio-ruim{padding:16px 15px 20px;font-size:var(--t-corpo);color:var(--mudo)}
  .vazio-bom{padding:38px 20px 40px;text-align:center}
  .vazio-bom .ib{width:46px;height:46px;border-radius:13px;background:var(--hairline);margin:0 auto 11px;
                 display:flex;align-items:center;justify-content:center}
  .vt{font-size:var(--t-secao);font-family:'Poppins';font-weight:700}
  .vd{font-size:var(--t-corpo);color:var(--mudo);margin-top:5px;max-width:420px;
      margin-left:auto;margin-right:auto;line-height:1.45}
  .vb{margin-top:14px;display:inline-flex;align-items:center;gap:7px;background:var(--acento);color:#fff;
      border-radius:9px;padding:9px 15px;font-size:var(--t-corpo);font-weight:600;cursor:pointer;
      box-shadow:0 8px 18px -9px #194b8699}

  /* ── carregando ── */
  .car-ruim{padding:56px 20px;display:flex;flex-direction:column;align-items:center;gap:10px;
            color:var(--mudo);font-size:var(--t-corpo)}
  .giro{width:19px;height:19px;border-radius:50%;border:2.4px solid var(--hairline);
        border-top-color:var(--fraco);animation:gira .8s linear infinite}
  @keyframes gira{to{transform:rotate(360deg)}}
  .esq{padding:4px 0}
  .el{display:flex;align-items:center;gap:12px;padding:11px 15px;border-bottom:1px solid var(--hairline)}
  .el:last-child{border-bottom:0}
  .eq{width:36px;height:36px;border-radius:10px;background:var(--hairline);flex:0 0 36px}
  .ec{flex:1;min-width:0}
  .eb1{height:9px;border-radius:5px;background:var(--hairline)}
  .eb2{height:7px;border-radius:4px;background:#f6f8fa;margin-top:6px}
  .ed{width:76px;height:9px;border-radius:5px;background:var(--hairline);flex:0 0 76px}
  .sk{background:var(--hairline);border-radius:5px}
  .sk-v{height:18px;width:72%} .sk-r{height:8px;width:56%;margin-top:8px}
  .sk-s{height:7px;width:44%;margin-top:7px;background:#f6f8fa}
  .esq .eb1,.esq .eb2,.esq .eq,.esq .ed,.sk{animation:pisca 1.4s ease-in-out infinite}
  @keyframes pisca{0%,100%{opacity:1}50%{opacity:.55}}

  /* ── rodapé ── */
  .rodape{background:var(--surface);border:1px solid var(--borda);border-radius:11px;padding:11px 15px;
          display:flex;align-items:center;gap:14px;font-size:var(--t-corpo);color:var(--corpo);flex-wrap:wrap}
  .rodape b{color:var(--tinta)}
  .pill-al{margin-left:auto;background:var(--alerta-bg);color:var(--alerta);border-radius:20px;
           padding:3px 11px;font-size:var(--t-micro);font-weight:700;white-space:nowrap}

  @media (max-width:1100px){
    .menu{display:none}
    .kpis{grid-template-columns:repeat(2,1fr)}
    .th,.tr2{grid-template-columns:1.4fr 1fr 1fr}
    .th span:nth-child(2),.tr2 .c-desc,.th span:nth-child(4),.tr2 .c-venc{display:none}
  }
</style>
</head>
<body data-modo="proposto" data-estado="dados">
  <aside class="menu">
    <div class="logo"><div class="j">J</div><div class="n">JuridFlow</div></div>
    ${menuHtml}
  </aside>

  <main>
    <div class="demo">
      <span class="tag">mockup</span>
      <span class="lb">Cabeçalho:</span>
      <div class="seg" id="seg-modo">
        <span data-modo="hoje">Como está hoje</span>
        <span data-modo="proposto" class="on">Proposto</span>
      </div>
      <span class="lb">Estado da tela:</span>
      <div class="seg" id="seg-estado">
        <span data-estado="dados" class="on">Com dados</span>
        <span data-estado="vazio">Lista vazia</span>
        <span data-estado="carregando">Carregando</span>
      </div>
      <span class="dica">Clique nos itens do menu para trocar de tela</span>
    </div>

    <div class="rolagem">
      ${TELAS.map(tela).join("")}
    </div>
  </main>

<script>
  // Só troca de classe. Nenhum dado, nenhuma lógica de produto.
  const body = document.body;
  function mostrar(id){
    document.querySelectorAll('.tela').forEach(s => s.classList.toggle('on', s.dataset.tela === id));
    document.querySelectorAll('.mi[data-ir]').forEach(m => m.classList.toggle('on', m.dataset.ir === id));
    document.querySelector('.rolagem').scrollTop = 0;
  }
  document.querySelectorAll('.mi[data-ir]').forEach(m =>
    m.addEventListener('click', () => mostrar(m.dataset.ir)));
  document.querySelectorAll('#seg-modo span').forEach(s =>
    s.addEventListener('click', () => {
      body.dataset.modo = s.dataset.modo;
      document.querySelectorAll('#seg-modo span').forEach(o => o.classList.toggle('on', o === s));
    }));
  document.querySelectorAll('#seg-estado span').forEach(s =>
    s.addEventListener('click', () => {
      body.dataset.estado = s.dataset.estado;
      document.querySelectorAll('#seg-estado span').forEach(o => o.classList.toggle('on', o === s));
    }));
  mostrar('processos');
</script>
</body>
</html>`;

writeFileSync(`${RAIZ}/mockup-cara-unica-navegavel.html`, html);
console.log("ok: mockup-cara-unica-navegavel.html gerado");
