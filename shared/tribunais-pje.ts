/**
 * Tribunais PJe que o motor próprio sabe acessar com o login nacional (PDPJ).
 *
 * Compartilhado client/server porque as duas pontas precisam da MESMA lista:
 * o seletor de estados do monitoramento por CPF (client) e a validação do que
 * pode ser vigiado (server). Duas listas divergindo = estado selecionável que
 * o robô não varre — a falha silenciosa clássica.
 */

export const TRIBUNAIS_PJE = [
  { codigo: "tjce", uf: "CE", sigla: "TJCE" },
  { codigo: "tjpe", uf: "PE", sigla: "TJPE" },
  { codigo: "tjdf", uf: "DF", sigla: "TJDFT" },
  { codigo: "tjrj", uf: "RJ", sigla: "TJRJ" },
  { codigo: "tjmg", uf: "MG", sigla: "TJMG" },
  { codigo: "tjrn", uf: "RN", sigla: "TJRN" },
  { codigo: "tjma", uf: "MA", sigla: "TJMA" },
  { codigo: "tjpa", uf: "PA", sigla: "TJPA" },
  { codigo: "tjro", uf: "RO", sigla: "TJRO" },
  { codigo: "tjpb", uf: "PB", sigla: "TJPB" },
  { codigo: "tjmt", uf: "MT", sigla: "TJMT" },
  { codigo: "tjrr", uf: "RR", sigla: "TJRR" },
  // Justiça Federal. Só entram os TRFs que o motor sabe varrer por CPF —
  // duas listas divergindo é justamente o que faz aparecer opção que o robô
  // não visita. TRF5 fica de fora porque roda por consulta pública (é vigiado
  // por número de processo, não por CPF), e TRF4 usa eproc, sem adapter.
  { codigo: "trf1", uf: "TRF1", sigla: "Federal 1ª" },
  { codigo: "trf2", uf: "TRF2", sigla: "Federal 2ª" },
  { codigo: "trf3", uf: "TRF3", sigla: "Federal 3ª" },
  { codigo: "trf6", uf: "TRF6", sigla: "Federal 6ª" },
] as const;

export type CodigoTribunalPje = (typeof TRIBUNAIS_PJE)[number]["codigo"];

/** Sede do escritório — sempre vigiada, não dá pra desmarcar. */
export const TRIBUNAL_SEDE: CodigoTribunalPje = "tjce";

export const CODIGOS_TRIBUNAIS_PJE: string[] = TRIBUNAIS_PJE.map((t) => t.codigo);

export function siglaDoTribunal(codigo: string): string {
  return TRIBUNAIS_PJE.find((t) => t.codigo === codigo)?.sigla ?? codigo.toUpperCase();
}

/**
 * Normaliza a lista escolhida pelo usuário: só códigos conhecidos, sem
 * duplicata, e a sede sempre presente (o monitoramento nasceu pra ela).
 */
export function normalizarTribunais(escolhidos: unknown): string[] {
  const lista = Array.isArray(escolhidos) ? escolhidos : [];
  const validos = lista.filter(
    (t): t is string => typeof t === "string" && CODIGOS_TRIBUNAIS_PJE.includes(t),
  );
  return [...new Set([TRIBUNAL_SEDE, ...validos])];
}

/** Fato da numeração do CNJ: a Justiça do Trabalho tem 24 regiões (TRT-1 a TRT-24). */
export const NUMEROS_TRT: readonly number[] = Array.from({ length: 24 }, (_, i) => i + 1);

// Segmento TR do CNJ (NNNNNNN-DD.AAAA.8.TR.OOOO) → tribunal estadual.
const TR_PARA_TRIBUNAL: Record<string, string> = {
  "06": "tjce", "17": "tjpe", "07": "tjdf", "19": "tjrj", "13": "tjmg",
  "20": "tjrn", "10": "tjma", "14": "tjpa", "22": "tjro", "15": "tjpb",
  "11": "tjmt", "23": "tjrr",
};

/**
 * Tribunal de origem de um CNJ estadual (J=8). O CNJ carrega a origem no
 * próprio número — é o que permite etiquetar achados antigos sem migração.
 */
export function tribunalDoCnj(cnj: string | null | undefined): string | null {
  if (!cnj) return null;
  const m = /\.8\.(\d{2})\./.exec(cnj);
  if (!m) return null;
  return TR_PARA_TRIBUNAL[m[1]] ?? null;
}

// ── Cobertura: o texto honesto, derivado da lista ───────────────────────────
//
// Todo lugar que fala "quantos tribunais o robô cobre" (site, planos, app,
// mensagens de erro) lê daqui. Nenhum número é digitado: entrou um tribunal
// no registro, todos os textos acompanham. Antes cada tela tinha o seu
// ("+90 tribunais", "16 estados", "TJCE 1º grau. Próximos: TJSP…") e todos
// mentiam de um jeito diferente.

/**
 * Tribunais vigiados por CONSULTA PÚBLICA: sem credencial no Cofre, só por
 * número de processo. Ficam fora de `TRIBUNAIS_PJE` (que é a lista do
 * seletor por CPF) e entram na cobertura por esta lista.
 */
export const TRIBUNAIS_CONSULTA_PUBLICA_PJE = [
  { codigo: "trf5", sigla: "TRF5" },
  // Justiça do Trabalho: o PJe dos TRTs tem consulta pública aberta, mesmo
  // molde JSF do TRF5. Entram os dois que têm adapter no servidor
  // (`ADAPTERS_PUBLICOS`) — o teste trava as duas listas iguais.
  { codigo: "trt2", sigla: "TRT2" },
  { codigo: "trt15", sigla: "TRT15" },
] as const;

export type TribunalCoberto = { codigo: string; sigla: string; uf?: string };

/**
 * Justiça do Trabalho com credencial: os TRTs estão no registro do PJe-JT
 * com o endereço do padrão histórico, mas NENHUM foi comprovado em campo —
 * por isso entram como "em teste": o robô aceita o processo e tenta, e o
 * número vendido não os conta.
 */
export function trtsEmTeste(): TribunalCoberto[] {
  return NUMEROS_TRT.map((n) => ({ codigo: `trt${n}`, sigla: `TRT${n}` }));
}

/** Sigla curta de exibição: TJs usam a sigla do seletor (TJDFT, não TJDF);
 *  TRFs viram o código em maiúsculas ("Federal 1ª" é rótulo de seletor). */
function siglaCurta(t: (typeof TRIBUNAIS_PJE)[number]): string {
  return t.sigla.startsWith("TJ") ? t.sigla : t.codigo.toUpperCase();
}

function ehTj(t: { codigo: string }): boolean {
  return t.codigo.startsWith("tj");
}

/** TJs cobertos: sede primeiro, depois em ordem alfabética de sigla. */
export function tjsCobertos(): TribunalCoberto[] {
  const lista = TRIBUNAIS_PJE.filter(ehTj).map((t) => ({ codigo: t.codigo, sigla: siglaCurta(t), uf: t.uf }));
  const sede = lista.filter((t) => t.codigo === TRIBUNAL_SEDE);
  const resto = lista.filter((t) => t.codigo !== TRIBUNAL_SEDE).sort((a, b) => a.sigla.localeCompare(b.sigla));
  return [...sede, ...resto];
}

/** TRFs cobertos com credencial, em ordem numérica. */
export function trfsCobertos(): TribunalCoberto[] {
  return TRIBUNAIS_PJE.filter((t) => !ehTj(t))
    .map((t) => ({ codigo: t.codigo, sigla: siglaCurta(t) }))
    .sort((a, b) => a.sigla.localeCompare(b.sigla));
}

export function coberturaTribunais(): {
  comCredencial: TribunalCoberto[];
  consultaPublica: TribunalCoberto[];
  /** Com credencial, sem comprovação em campo: aceitos, não vendidos. */
  emTeste: TribunalCoberto[];
} {
  return {
    comCredencial: [...tjsCobertos(), ...trfsCobertos()],
    consultaPublica: TRIBUNAIS_CONSULTA_PUBLICA_PJE.map((t) => ({ codigo: t.codigo, sigla: t.sigla })),
    emTeste: trtsEmTeste(),
  };
}

/** Todos os códigos que o robô aceita vigiar por número (com credencial, sem, ou em teste). */
export function codigosTribunaisCobertos(): string[] {
  const c = coberturaTribunais();
  return [...new Set([...c.comCredencial, ...c.consultaPublica, ...c.emTeste].map((t) => t.codigo))];
}

/** Só os caminhos comprovados ou abertos: é o número que as telas vendem. */
export function codigosTribunaisVendidos(): string[] {
  const c = coberturaTribunais();
  return [...new Set([...c.comCredencial, ...c.consultaPublica].map((t) => t.codigo))];
}

/** TRTs que só existem pelo caminho em teste (fora da consulta pública). */
function trtsSoEmTeste(): TribunalCoberto[] {
  const publicos = new Set(coberturaTribunais().consultaPublica.map((t) => t.codigo));
  return trtsEmTeste().filter((t) => !publicos.has(t.codigo));
}

/** "outros 22 TRTs em teste" — vazio quando não há TRT em teste. */
export function textoTrtsEmTeste(): string {
  const n = trtsSoEmTeste().length;
  if (n === 0) return "";
  const publicos = coberturaTribunais().consultaPublica.some(ehTrt);
  return `${publicos ? "outros " : ""}${n} TRTs em teste`;
}

/** Quantos tribunais dá pra vigiar por número de processo. */
export function totalTribunaisVigiaveis(): number {
  return codigosTribunaisVendidos().length;
}

/**
 * Sede — o único tribunal onde a busca por CPF/CNPJ e as novas ações foram
 * COMPROVADAS em campo. A consulta por número na hora não é só dela: vale em
 * todos os cobertos (`textoConsultaNaHora`).
 */
export function siglaConsultaNaHora(): string {
  return siglaDoTribunal(TRIBUNAL_SEDE);
}

function listaComE(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** "TRF5, TRT2 e TRT15" */
function siglasConsultaPublica(): string {
  return listaComE(coberturaTribunais().consultaPublica.map((t) => t.sigla));
}

/**
 * Onde a aba Consultar responde na hora: qualquer tribunal do registro com a
 * credencial do Cofre, e os de consulta pública sem credencial nenhuma.
 * "nos tribunais cobertos com a sua credencial (TRF5, TRT2 e TRT15 sem credencial)"
 */
export function textoConsultaNaHora(): string {
  return `nos tribunais cobertos com a sua credencial (${siglasConsultaPublica()} sem credencial)`;
}

function ehTrt(t: { codigo: string }): boolean {
  return t.codigo.startsWith("trt");
}

/**
 * O que dizer da Justiça do Trabalho, a partir da lista: os TRTs que estão
 * na consulta pública são nomeados; sem nenhum, "ainda não".
 */
export function textoJusticaDoTrabalho(): string {
  const trts = coberturaTribunais().consultaPublica.filter(ehTrt).map((t) => t.sigla);
  const emTeste = textoTrtsEmTeste();
  if (trts.length === 0) return emTeste ? `Justiça do Trabalho: ${emTeste}` : "Justiça do Trabalho ainda não";
  return `Justiça do Trabalho: ${listaComE(trts)} por consulta pública${emTeste ? `, ${emTeste}` : ""}`;
}

/** "12 TJs + 4 TRFs (TRF5, TRT2 e TRT15 por consulta pública)" */
export function textoCoberturaCurto(): string {
  return `${tjsCobertos().length} TJs + ${trfsCobertos().length} TRFs (${siglasConsultaPublica()} por consulta pública)`;
}

/** "TJCE, TJDFT, …, TRF6 e, por consulta pública, TRF5, TRT2 e TRT15" */
export function listaSiglasCobertas(): string {
  const siglas = coberturaTribunais().comCredencial.map((t) => t.sigla).join(", ");
  return `${siglas} e, por consulta pública, ${siglasConsultaPublica()}`;
}

/** Mensagem de erro única pra qualquer caminho que recusa tribunal sem motor. */
export function mensagemTribunalSemMotor(sigla: string): string {
  return `O robô ainda não entra no ${sigla}. Hoje ele cobre: ${listaSiglasCobertas()}.`;
}

/** "12 estados + 4 TRFs" — alcance da credencial nacional do Cofre. */
export function resumoPjeNacional(): string {
  return `${tjsCobertos().length} estados + ${trfsCobertos().length} TRFs`;
}

/** Rótulo da credencial nacional do Cofre: "PJe — 12 estados + 4 TRFs". */
export function rotuloPjeNacional(): string {
  return `PJe — ${resumoPjeNacional()}`;
}

/** Chip da faixa de integrações do site: "PJe · 12 TJs + 4 TRFs". */
export function chipPjeIntegracoes(): string {
  return `PJe · ${tjsCobertos().length} TJs + ${trfsCobertos().length} TRFs`;
}

/** Trecho do card do site: "hoje 12 TJs e 4 TRFs, mais TRF5, TRT2 e TRT15 por consulta pública". */
export function textoCoberturaComparativo(): string {
  return `hoje ${tjsCobertos().length} TJs e ${trfsCobertos().length} TRFs, mais ${siglasConsultaPublica()} por consulta pública`;
}

/** Linha de cobertura embaixo do subtítulo dos planos no site. */
export function textoCoberturaPricing(): string {
  const tjs = tjsCobertos().map((t) => t.sigla).join(", ");
  const trfs = listaComE(trfsCobertos().map((t) => t.sigla));
  const emTeste = textoTrtsEmTeste();
  return (
    `Cobertura hoje: PJe do ${tjs}, mais ${trfs} (${siglasConsultaPublica()} por consulta pública${emTeste ? `; ${emTeste}` : ""}). ` +
    `TJSP e os demais ainda não — conte pra gente e entra na fila.`
  );
}

/** Rodapé do guia processual do dashboard. */
export function textoCoberturaGuia(): string {
  const ufs = tjsCobertos().map((t) => t.uf ?? "").filter(Boolean).sort().join(", ");
  const trfs = trfsCobertos().map((t) => t.sigla.replace(/^TRF/, "")).join("/");
  return (
    `Cobertura hoje: PJe em ${tjsCobertos().length} estados (${ufs}) e TRF${trfs}, ` +
    `mais ${siglasConsultaPublica()} por consulta pública · consulta na hora ${textoConsultaNaHora()} · ` +
    `novas ações por CPF/CNPJ: comprovado no ${siglaConsultaNaHora()}.`
  );
}

/** Bullet "Vigia…" dos planos — a migration escreve o mesmo texto que sai daqui. */
export function bulletVigiaPlano(processos: string, cpfs: string): string {
  const emTeste = textoTrtsEmTeste();
  return (
    `Vigia ${processos} processos nos tribunais cobertos (${tjsCobertos().length} TJs e ${trfsCobertos().length} TRFs com credencial; ` +
    `${siglasConsultaPublica()} sem credencial${emTeste ? `; ${emTeste}` : ""} — TJSP ainda não) · ` +
    `${cpfs} CPFs/CNPJs (novas ações: comprovado no ${siglaConsultaNaHora()})`
  );
}

/** Aviso da caixa âmbar do "Monitorar movimentações" pra processo fora da cobertura. */
export function avisoProcessoForaDaCobertura(sigla: string): string {
  return `Este processo é do ${sigla}, e o robô ainda não entra lá. Hoje ele cobre ${listaSiglasCobertas()}.`;
}

// ── Parser puro do CNJ (client e server) ────────────────────────────────────

const SIGLA_TJ_POR_TR: Record<string, string> = {
  "01": "TJAC", "02": "TJAL", "03": "TJAP", "04": "TJAM", "05": "TJBA", "06": "TJCE",
  "07": "TJDF", "08": "TJES", "09": "TJGO", "10": "TJMA", "11": "TJMT", "12": "TJMS",
  "13": "TJMG", "14": "TJPA", "15": "TJPB", "16": "TJPR", "17": "TJPE", "18": "TJPI",
  "19": "TJRJ", "20": "TJRN", "21": "TJRO", "22": "TJRR", "23": "TJRS", "24": "TJSC",
  "25": "TJSE", "26": "TJSP", "27": "TJTO",
};

export type TribunalDoCnjPuro = { codigo: string; sigla: string; coberto: boolean };

/**
 * Tribunal de um CNJ completo (20 dígitos), sem depender do servidor — é o
 * que deixa o diálogo de monitorar avisar ANTES do clique que o processo é
 * de tribunal fora da cobertura. Aceita com ou sem máscara. Tribunal coberto
 * devolve a sigla de exibição da cobertura (TJDFT, TRF1); fora dela, a
 * sigla oficial (TJSP, TRT-2, TRF-4).
 */
export function parseCnjTribunalPuro(cnj: string | null | undefined): TribunalDoCnjPuro | null {
  const digitos = (cnj ?? "").replace(/\D/g, "");
  if (digitos.length !== 20) return null;
  const j = digitos.slice(13, 14);
  const tr = digitos.slice(14, 16);
  const n = parseInt(tr, 10);
  let codigo: string;
  let sigla: string;
  if (j === "8") {
    const tj = SIGLA_TJ_POR_TR[tr];
    if (!tj) return null;
    codigo = tj.toLowerCase();
    sigla = tj;
  } else if (j === "5" && n >= 1 && n <= NUMEROS_TRT.length) {
    codigo = `trt${n}`;
    sigla = `TRT-${n}`;
  } else if (j === "4" && n >= 1 && n <= 6) {
    codigo = `trf${n}`;
    sigla = `TRF-${n}`;
  } else {
    codigo = `j${j}_tr${tr}`;
    sigla = `J${j}-${tr}`;
  }
  const c = coberturaTribunais();
  const coberto = [...c.comCredencial, ...c.consultaPublica, ...c.emTeste].find((t) => t.codigo === codigo);
  return { codigo, sigla: coberto?.sigla ?? sigla, coberto: !!coberto };
}
