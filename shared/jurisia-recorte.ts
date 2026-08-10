/**
 * Recorte do acervo público — a base de uma pesquisa jurisprudencial.
 *
 * A diferença em relação a perguntar sobre um processo é de onde vem a
 * resposta: lá são as movimentações daquele caso, aqui é um pedaço do acervo
 * nacional ("revisional de contrato bancário no TJCE"). E aqui existe um risco
 * novo, que não existia lá: **o modelo inventar número**. "72% dos casos são
 * procedentes" sai de um LLM com a mesma fluência de um dado real, e num
 * produto de pesquisa jurídica o número É o entregável.
 *
 * Por isso a estatística NÃO passa pelo modelo. Ela é contada em SQL, exibida
 * pela tela, e o modelo recebe a ordem de não produzir números — com
 * `contemNumeroInventado` conferindo a saída, do mesmo jeito que
 * `validarResposta` confere as citações. Prompt pede; trava garante.
 */

import type { ResultadoProcesso } from "./datajud-desfecho";
import { ORDEM_RECURSO, rotuloRecurso, type ResultadoRecurso } from "./datajud-recurso";
import type { PerfilRecorte } from "./jurisia-perfil";
import type { Comparacao } from "./jurisia-estrategia";
import type { Tendencia } from "./jurisia-tendencia";
import { naturezaDoGrau, type ComposicaoNatureza, type NaturezaProcesso } from "./jurisia-grau";

export interface FiltroRecorte {
  tribunal: string | null;
  /** Termo pra casar com o nome da classe processual. */
  classeTermo: string | null;
  /** Termo pra casar com o nome do assunto (TPU). */
  assuntoTermo: string | null;
  /** Termo pra casar com o nome do órgão julgador (vara, câmara). */
  orgaoTermo: string | null;
  /** Só processos ajuizados a partir deste ano. */
  desdeAno: number | null;
}

export interface ProcessoAcervo {
  id: number;
  cnj: string;
  tribunal: string;
  /** Como veio do DataJud. Vira jurisprudência ou estatística em `jurisia-grau`. */
  grau: string | null;
  classeNome: string | null;
  assuntoNome: string | null;
  /** Todos os assuntos da TPU, separados por " · ". Null nos processos
   *  gravados antes da coluna existir. */
  assuntosTodos: string | null;
  orgaoNome: string | null;
  resultado: ResultadoProcesso | null;
  /** ISO ou null. */
  resultadoEm: string | null;
  resultadoMovimento: string | null;
  resultadoRecurso: ResultadoRecurso | null;
  /** ISO ou null. */
  resultadoRecursoEm: string | null;
  resultadoRecursoMovimento: string | null;
  ajuizamentoEm: string | null;
}

export interface FatiaResultado {
  resultado: ResultadoProcesso;
  quantidade: number;
  /** Sobre os que já terminaram. Soma exatamente 100 entre as fatias. */
  percentual: number;
}

export interface FatiaRecurso {
  resultado: ResultadoRecurso;
  quantidade: number;
  percentual: number;
}

/**
 * O segundo eixo do recorte: como o RECURSO terminou.
 *
 * Existe separado porque "provido" e "procedente" apontam para lados
 * diferentes (`datajud-recurso.ts` explica). Um recorte de AREsp no STJ
 * preenche este eixo e deixa o de mérito vazio — antes disso a tela mostrava
 * o acervo inteiro como "em andamento", que era falso.
 */
export interface EstatisticaRecursal {
  comResultado: number;
  fatias: FatiaRecurso[];
  amostraPequena: boolean;
}

export interface EstatisticaRecorte {
  total: number;
  comResultado: number;
  emAndamento: number;
  fatias: FatiaResultado[];
  /** Estatística sobre punhado de caso é anedota. A tela precisa avisar. */
  amostraPequena: boolean;
  /**
   * Quantos dos decididos já transitaram em julgado.
   *
   * Opcional porque pesquisa gravada antes desta conta não tem o número — e
   * `undefined` precisa ser lido como "não sei", nunca como zero: dizer
   * "nenhum transitou" sobre um recorte que a gente não mediu é pior que
   * calar.
   */
  transitados?: number;
  /**
   * Opcional porque pesquisa gravada antes do eixo recursal não tem — e
   * `undefined` é "não medi", nunca "nenhum recurso julgado".
   */
  recursal?: EstatisticaRecursal;
  /**
   * Decididos em QUALQUER um dos dois eixos, sem dupla contagem.
   *
   * `comResultado` é o denominador das fatias de mérito e precisa continuar
   * sendo só isso. Somar os dois eixos daria número maior que o total nos
   * processos que preenchem os dois.
   */
  decididos?: number;
}

/** Abaixo disso o percentual engana mais do que informa. */
export const MIN_AMOSTRA = 10;

/** Teto de processos citáveis num turno. */
export const MAX_FONTES_RECORTE = 40;

const ROTULO: Record<ResultadoProcesso, string> = {
  procedente: "Procedente",
  parcial: "Parcialmente procedente",
  improcedente: "Improcedente",
  acordo: "Acordo homologado",
  extinto_sem_merito: "Extinto sem resolução do mérito",
};

export function rotuloResultado(r: ResultadoProcesso): string {
  return ROTULO[r];
}

/** Versão curta pra rótulo de barra, onde a coluna é estreita e truncar
 *  ("Extinto sem resolu…") custa mais que abreviar. */
const ROTULO_CURTO: Record<ResultadoProcesso, string> = {
  procedente: "Procedente",
  parcial: "Procedente em parte",
  improcedente: "Improcedente",
  acordo: "Acordo",
  extinto_sem_merito: "Extinto sem mérito",
};

export function rotuloCurtoResultado(r: ResultadoProcesso): string {
  return ROTULO_CURTO[r];
}

const termo = (v: unknown, max = 120): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length >= 3 ? t.slice(0, max) : null;
};

/**
 * Sanitiza o filtro que o interpretador extraiu da pergunta. É saída de LLM,
 * então nada aqui pode confiar no formato.
 */
export function normalizarFiltro(bruto: unknown): FiltroRecorte {
  const o: any = typeof bruto === "string" ? seguroJson(bruto) : bruto;
  const tribunalBruto = termo(o?.tribunal, 16);
  const ano = Number(o?.desdeAno);
  const anoAtual = 2100;

  return {
    tribunal: tribunalBruto ? tribunalBruto.toUpperCase().replace(/[^A-Z0-9]/g, "") || null : null,
    classeTermo: termo(o?.classeTermo),
    assuntoTermo: termo(o?.assuntoTermo),
    orgaoTermo: termo(o?.orgaoTermo),
    desdeAno: Number.isInteger(ano) && ano >= 1990 && ano <= anoAtual ? ano : null,
  };
}

function seguroJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Filtro sem nenhum critério pegaria "o Brasil inteiro" e devolveria uma
 * estatística que não responde pergunta nenhuma. Melhor recusar e pedir o
 * recorte do que entregar média nacional disfarçada de resposta.
 */
export function filtroVazio(f: FiltroRecorte): boolean {
  return !f.tribunal && !f.classeTermo && !f.assuntoTermo && !f.orgaoTermo;
}

export function descreverFiltro(f: FiltroRecorte): string {
  const partes = [f.classeTermo, f.assuntoTermo, f.orgaoTermo, f.tribunal].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  if (f.desdeAno) partes.push(`desde ${f.desdeAno}`);
  return partes.join(" · ");
}

/**
 * Ordem canônica das fatias. Fixa, e nunca por tamanho.
 *
 * Duas razões. A prática: comparar "TJCE" com "TJSP" exige a mesma linha no
 * mesmo lugar; ordenar por quantidade embaralha o painel a cada pesquisa. A
 * técnica: a cor de cada resultado é um slot fixo de uma paleta cujas garantias
 * de daltonismo valem para PARES ADJACENTES nesta ordem — reordenar (ou sumir
 * com a fatia zerada, que também muda vizinhança) quebra a validação.
 *
 * Por isso zero também aparece. E ele informa: "acordo: 0" num recorte é a
 * descoberta de que aquela vara não homologa acordo nenhum.
 */
export const ORDEM_RESULTADO: ResultadoProcesso[] = [
  "procedente",
  "parcial",
  "improcedente",
  "acordo",
  "extinto_sem_merito",
];

/**
 * Percentuais que somam 100 — pelo maior resto.
 *
 * Arredondar cada fatia sozinha produz "62% + 24% + 15% = 101%", e num painel
 * que existe pra ser levado a sério isso queima a credibilidade do número
 * certo do lado.
 */
function percentuaisPorMaiorResto(quantidades: number[]): number[] {
  const soma = quantidades.reduce((s, n) => s + n, 0);
  if (soma === 0) return quantidades.map(() => 0);

  const pcts = quantidades.map((q) => Math.floor((q * 100) / soma));
  let sobra = 100 - pcts.reduce((s, p) => s + p, 0);
  const porResto = quantidades
    .map((q, i) => ({ i, resto: (q * 100) / soma - pcts[i], vazia: q === 0 }))
    // Fatia zerada nunca recebe sobra: 0 processos não podem virar 1%.
    .filter((e) => !e.vazia)
    .sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of porResto) {
    if (sobra <= 0) break;
    pcts[i]++;
    sobra--;
  }
  return pcts;
}

export function montarEstatistica(
  total: number,
  porResultado: Record<ResultadoProcesso, number>,
): EstatisticaRecorte {
  const quantidades = ORDEM_RESULTADO.map((r) => Math.max(0, porResultado[r] ?? 0));
  const comResultado = quantidades.reduce((s, n) => s + n, 0);
  const pcts = percentuaisPorMaiorResto(quantidades);

  const fatias: FatiaResultado[] = ORDEM_RESULTADO.map((resultado, i) => ({
    resultado,
    quantidade: quantidades[i],
    percentual: pcts[i],
  }));

  return {
    total,
    comResultado,
    emAndamento: Math.max(0, total - comResultado),
    fatias,
    amostraPequena: comResultado < MIN_AMOSTRA,
  };
}

export function montarEstatisticaRecursal(
  porResultado: Partial<Record<ResultadoRecurso, number>>,
): EstatisticaRecursal {
  const quantidades = ORDEM_RECURSO.map((r) => Math.max(0, porResultado[r] ?? 0));
  const comResultado = quantidades.reduce((s, n) => s + n, 0);
  const pcts = percentuaisPorMaiorResto(quantidades);

  return {
    comResultado,
    fatias: ORDEM_RECURSO.map((resultado, i) => ({
      resultado,
      quantidade: quantidades[i],
      percentual: pcts[i],
    })),
    amostraPequena: comResultado < MIN_AMOSTRA,
  };
}

const dataCurta = (iso: string | null): string | null => {
  if (!iso) return null;
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso.slice(0, 10);
};

/** CNJ só-dígitos volta ao formato legível pro advogado reconhecer. */
export function formatarCnj(cnj: string): string {
  const d = cnj.replace(/\D/g, "");
  if (d.length !== 20) return cnj;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
}

export interface FonteRecorte {
  id: number;
  rotulo: string;
  data: string;
  /** null quando o tribunal não informou o grau. */
  natureza: NaturezaProcesso | null;
}

export interface ContextoRecorte {
  fontes: FonteRecorte[];
  texto: string;
}

const DESCRICAO_NATUREZA: Record<NaturezaProcesso, string> = {
  jurisprudencia: "decisão de órgão colegiado (acórdão — pode ser citada como jurisprudência)",
  estatistica: "sentença de juiz singular (NÃO é jurisprudência — não fundamenta petição)",
};

/**
 * Como o processo terminou, em uma frase — lendo os DOIS eixos.
 *
 * Ler só `resultado` era o defeito que fazia um recorte inteiro de agravo no
 * STJ aparecer como "em andamento": instância superior grava `resultadoRecurso`
 * e deixa o mérito vazio, porque quem julga o pedido é a origem.
 */
export function desfechoDoProcesso(p: {
  resultado: ResultadoProcesso | null;
  resultadoRecurso: ResultadoRecurso | null;
}): string {
  if (p.resultadoRecurso) return `Recurso ${rotuloRecurso(p.resultadoRecurso).toLowerCase()}`;
  if (p.resultado) return ROTULO[p.resultado];
  return "Em andamento";
}

/**
 * O que o processo é SOBRE, separado do veículo pelo qual chegou.
 *
 * "Agravo em Recurso Especial" é classe — o instrumento. Ele não diz se a
 * briga é de busca e apreensão, alimentos ou revisional, e sem o assunto ao
 * lado o advogado lê uma lista de quarenta linhas iguais.
 */
export function assuntoDoProcesso(p: {
  assuntoNome: string | null;
  assuntosTodos?: string | null;
}): string | null {
  const todos = typeof p.assuntosTodos === "string" ? p.assuntosTodos.trim() : "";
  if (todos.length > 0) return todos;
  return p.assuntoNome && p.assuntoNome.trim().length > 0 ? p.assuntoNome.trim() : null;
}

/**
 * Monta o bloco que vai pro modelo. Cada processo é uma [FONTE], e o que ele
 * carrega é o desfecho e o movimento que o gerou — é sobre isso que o modelo
 * pode afirmar alguma coisa, e nada além.
 */
export function montarContextoRecorte(
  processos: ProcessoAcervo[],
  opts?: { maxFontes?: number },
): ContextoRecorte {
  const escolhidos = processos.slice(0, opts?.maxFontes ?? MAX_FONTES_RECORTE);
  const fontes: FonteRecorte[] = [];
  const blocos: string[] = [];

  for (const p of escolhidos) {
    const assunto = assuntoDoProcesso(p);
    // O assunto vem antes da classe: é o que distingue uma linha da outra.
    const rotulo = [desfechoDoProcesso(p), assunto, p.classeNome, p.orgaoNome]
      .filter(Boolean)
      .join(" · ");

    const data =
      dataCurta(p.resultadoRecursoEm) ??
      dataCurta(p.resultadoEm) ??
      dataCurta(p.ajuizamentoEm) ??
      "";
    const natureza = naturezaDoGrau(p.grau);
    fontes.push({ id: p.id, rotulo: `${formatarCnj(p.cnj)} — ${rotulo}`, data, natureza });

    const linhas = [`[FONTE ${p.id}] ${formatarCnj(p.cnj)} (${p.tribunal})`];
    // Sem isto o modelo cita sentença de vara como se fosse entendimento do
    // tribunal — que é exatamente a afirmação que o advogado leva pro processo.
    if (natureza) linhas.push(`instância: ${DESCRICAO_NATUREZA[natureza]}`);
    if (p.classeNome) linhas.push(`classe (veículo processual): ${p.classeNome}`);
    if (assunto) linhas.push(`assunto (matéria discutida): ${assunto}`);
    if (p.orgaoNome) linhas.push(`órgão: ${p.orgaoNome}`);
    if (p.resultado) linhas.push(`mérito do pedido: ${ROTULO[p.resultado]}`);
    if (p.resultadoRecurso) {
      linhas.push(`desfecho do recurso: ${rotuloRecurso(p.resultadoRecurso)}`);
    }
    if (!p.resultado && !p.resultadoRecurso) linhas.push("resultado: ainda sem desfecho");
    const movimento = p.resultadoRecursoMovimento ?? p.resultadoMovimento;
    if (movimento) linhas.push(`movimento decisivo: ${movimento}`);
    if (data) linhas.push(`data: ${data}`);
    blocos.push(linhas.join("\n"));
  }

  return { fontes, texto: blocos.join("\n\n") };
}

/**
 * Como a pesquisa fica no banco. A estatística vai junto porque ela é o
 * entregável: reabrir a conversa amanhã tem que mostrar o mesmo painel, e
 * recontar o acervo daria outro número (ele cresce a cada varredura).
 */
export interface PesquisaGravada {
  achou: boolean;
  afirmacoes: Array<{ texto: string; fontes: number[] }>;
  conclusao: string | null;
  fontesUsadas: number[];
  fontesDetalhe: FonteRecorte[];
  estatistica: EstatisticaRecorte;
  /** null quando o recorte não tinha o que medir. */
  perfil: PerfilRecorte | null;
  /** Só no modo estratégia: o cruzamento com o histórico do escritório. */
  comparacao?: Comparacao | null;
  descricaoFiltro: string;
  /** Opcionais: pesquisas gravadas antes da separação por instância não têm. */
  natureza?: ComposicaoNatureza;
  avisoNatureza?: string | null;
  /** O que o recorte decide hoje. Ausente nas pesquisas gravadas antes disso. */
  tendencia?: Tendencia | null;
}

/**
 * A trava numérica.
 *
 * O modelo não conta — a contagem é do SQL e aparece no painel ao lado. Se ele
 * produzir estatística mesmo assim, o turno é recusado inteiro: número inventado
 * ao lado do número certo é pior que resposta nenhuma.
 *
 * Deliberadamente estreita. Dígito em CNJ, em "3ª Vara", em ano e em "art. 42 do
 * CDC" é legítimo e útil — o que não pode é dígito virar medida do acervo.
 */
const PADROES_NUMERICOS: RegExp[] = [
  /\d+([.,]\d+)?\s*%/,
  /\b\d+([.,]\d+)?\s*por\s*cento\b/i,
  /\b\d+\s+(processos?|casos?|a[çc][õo]es|decis[õo]es|senten[çc]as|julgados?|ac[óo]rd[ãa]os?)\b/i,
  /\b\d+\s+(de|em)\s+cada\s+\d+\b/i,
  // "8 de 10". Os dois lados limitados a 3 dígitos pra não pegar citação de
  // lei ("8.078 de 1990") nem data ("10 de 2023") — proporção que um modelo
  // escreve é de números pequenos.
  /\b\d{1,3}\s+(de|em)\s+\d{1,3}\b/i,
];

/** Devolve o trecho ofensivo, ou null se o texto está limpo. */
export function contemNumeroInventado(texto: string): string | null {
  for (const re of PADROES_NUMERICOS) {
    const m = re.exec(texto);
    if (m) return m[0];
  }
  return null;
}

/** Varre afirmações E conclusão — a conclusão é justamente onde o modelo mais
 *  tenta resumir "na maioria dos 40 casos". */
export function numeroInventadoNaResposta(r: {
  afirmacoes: Array<{ texto: string }>;
  conclusao: string | null;
}): string | null {
  for (const a of r.afirmacoes) {
    const achado = contemNumeroInventado(a.texto);
    if (achado) return achado;
  }
  return r.conclusao ? contemNumeroInventado(r.conclusao) : null;
}
