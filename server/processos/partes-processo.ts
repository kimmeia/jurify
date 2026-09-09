/**
 * Partes do processo para exibição.
 *
 * O monitoramento já coleta a capa (e persiste em `motor_monitoramentos
 * .partes_json`), mas a UI de movimentações mostrava só o apelido — e quando
 * o monitoramento não tem apelido, caía no CNJ. Resultado: o card exibia o
 * mesmo número duas vezes e não dizia de quem era o processo.
 *
 * Quem lê a movimentação precisa de "Fulano × Banco Tal" antes de qualquer
 * outra coisa: é assim que o advogado reconhece o caso.
 */

import { lerPolo, type PoloParte } from "../../shared/polo-parte";

export type { PoloParte };

export type ParteResumo = {
  nome: string;
  polo: PoloParte;
  documento: string | null;
  /** "AUTOR", "REU", "ADVOGADO"… vem entre parênteses no nome cru do PJe. */
  papel: string | null;
};

export type PartesDoProcesso = {
  autores: string[];
  reus: string[];
  /** "Fulano × Banco Tal" — o jeito como o advogado se refere ao caso. */
  rotulo: string | null;
  /** Quem é o NOSSO cliente, quando dá pra identificar. */
  cliente: string | null;
  clientePolo: PoloParte | null;
};

const VAZIO: PartesDoProcesso = {
  autores: [],
  reus: [],
  rotulo: null,
  cliente: null,
  clientePolo: null,
};

function digitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O PJe não entrega o nome limpo: vem tudo numa linha só, como
 * `CARLOS JEFFERSON RIBEIRO DOS SANTOS - CPF: 066.968.283-70 (AUTOR)`.
 * Sem separar isso, encurtar o nome produzia coisas como "CARLOS (AUTOR)".
 */
const RE_PAPEL = /\(\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s/.-]{1,30})\s*\)\s*$/;
const RE_REGISTRADO = /\s+registrad[oa]\(a\)\s+civilmente\s+como\s+.*$/i;
const RE_DOC_TAIL = /\s*[-–—]?\s*\b(?:CPF|CNPJ|OAB|RG|CPF\/CNPJ)\b\s*[:.]?.*$/i;
const RE_DOC_VALOR = /\b(?:CPF|CNPJ)\s*[:.]?\s*([\d][\d.\-/]{9,20})/i;

/** Papéis que aparecem na lista de partes mas não SÃO parte do processo. */
const PAPEIS_AUXILIARES = new Set([
  "ADVOGADO",
  "ADVOGADA",
  "PROCURADOR",
  "PROCURADORA",
  "DEFENSOR",
  "DEFENSORA",
  "DEFENSOR PUBLICO",
  "PERITO",
  "PERITA",
  "TESTEMUNHA",
  "REPRESENTANTE",
  "CUSTOS LEGIS",
  "FISCAL DA LEI",
]);

const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "van", "von", "y"]);

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function extrairPapel(bruto: string): string | null {
  // Casa no fim da linha crua: o "(a)" de "registrado(a)" fica no meio e é
  // curto demais pro padrão, então não confunde.
  const m = bruto.trim().match(RE_PAPEL);
  if (!m) return null;
  return semAcento(m[1]).toUpperCase().replace(/\s+/g, " ").trim();
}

/** Só o nome: sem o papel entre parênteses, sem CPF/CNPJ/OAB pendurados. */
export function limparNomeParte(bruto: string): string {
  return bruto
    .trim()
    .replace(RE_REGISTRADO, "")
    .replace(RE_PAPEL, "")
    .replace(RE_DOC_TAIL, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,;:–—-]+$/, "")
    .trim();
}

function documentoNoNome(bruto: string): string | null {
  const m = bruto.match(RE_DOC_VALOR);
  return m ? m[1] : null;
}

/**
 * CAIXA ALTA num cabeçalho grita. Quando o nome vem todo em maiúsculas — que
 * é como o tribunal manda — vira capitulação; se já tem minúscula (apelido
 * digitado pelo usuário, por exemplo), fica exatamente como está.
 */
export function titulizar(nome: string): string {
  if (/[a-zà-ÿ]/.test(nome)) return nome;
  return nome
    .split(/\s+/)
    .map((palavra, i) => {
      const min = palavra.toLowerCase();
      if (i > 0 && CONECTIVOS.has(semAcento(min))) return min;
      // "S.A.", "S/A", "ME", "EPP" — sigla não vira "S.a."
      if (/[./]/.test(palavra) || palavra.length <= 2) return palavra;
      return palavra.charAt(0) + min.slice(1);
    })
    .join(" ");
}

/** Tolerante a JSON quebrado e a formatos antigos — nunca lança. */
export function parsearPartes(json: string | null | undefined): ParteResumo[] {
  if (!json) return [];
  let bruto: unknown;
  try {
    bruto = JSON.parse(json);
  } catch {
    return [];
  }
  // Já houve formato { partes: [...] } e formato array puro.
  const lista = Array.isArray(bruto)
    ? bruto
    : Array.isArray((bruto as { partes?: unknown })?.partes)
      ? (bruto as { partes: unknown[] }).partes
      : [];

  const out: ParteResumo[] = [];
  for (const p of lista) {
    const o = p as Record<string, unknown>;
    const bruto = typeof o?.nome === "string" ? o.nome.trim() : "";
    if (!bruto) continue;
    // Se a limpeza levar tudo (linha só com documento, por exemplo), fica o
    // original: nome estranho é melhor que parte sumida.
    const nome = limparNomeParte(bruto) || bruto;
    out.push({
      nome: nome.slice(0, 160),
      polo: lerPolo(o?.polo),
      documento:
        (typeof o?.documento === "string" ? o.documento : null) ?? documentoNoNome(bruto),
      papel: extrairPapel(bruto),
    });
  }
  return out;
}

/**
 * Encurta nome de parte para caber num card sem virar sopa de letras:
 * "Carlos Jefferson Ribeiro dos Santos" → "Carlos Jefferson".
 *
 * Conta só palavras significativas — "Maria da Silva" tem duas, não três,
 * senão o corte devolveria "Maria da".
 */
export function nomeCurto(nome: string, maxPalavras = 2): string {
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  const significativas = palavras.filter((p) => !CONECTIVOS.has(semAcento(p.toLowerCase())));
  if (significativas.length <= maxPalavras) return nome.trim();
  return significativas.slice(0, maxPalavras).join(" ");
}

/**
 * Monta o resumo das partes e identifica o cliente.
 *
 * A identificação segue a mesma ordem de confiança do polo-matcher: documento
 * bate > nome bate com o apelido > desconhecido. Chutar "o autor é o nosso
 * cliente" seria errado com frequência — metade da carteira de um escritório
 * costuma ser defesa.
 */
export function resumirPartes(
  partes: ParteResumo[],
  opts?: { searchKey?: string | null; apelido?: string | null },
): PartesDoProcesso {
  if (!partes.length) {
    // Sem capa coletada ainda: o apelido, quando existe, é o melhor que temos.
    const apelido = opts?.apelido?.trim();
    return apelido ? { ...VAZIO, cliente: apelido } : VAZIO;
  }

  const autores = partes.filter((p) => p.polo === "ativo").map((p) => p.nome);
  const reus = partes.filter((p) => p.polo === "passivo").map((p) => p.nome);

  // Advogado vem misturado no mesmo polo da parte que representa; se ele
  // vier primeiro, o rótulo mostraria o escritório no lugar do cliente.
  const primeiroDoPolo = (polo: PoloParte): string | null => {
    const doPolo = partes.filter((p) => p.polo === polo);
    const parte = doPolo.find((p) => !p.papel || !PAPEIS_AUXILIARES.has(p.papel)) ?? doPolo[0];
    return parte ? titulizar(nomeCurto(parte.nome)) : null;
  };

  const autor = primeiroDoPolo("ativo");
  const reu = primeiroDoPolo("passivo");
  const rotulo = autor && reu ? `${autor} × ${reu}` : (autor ?? reu ?? null);

  // 1) documento da busca bate com o de alguma parte
  const chave = digitos(opts?.searchKey);
  let cliente: ParteResumo | undefined;
  if (chave.length >= 11) {
    cliente = partes.find((p) => digitos(p.documento) && digitos(p.documento) === chave);
  }

  // 2) apelido do monitoramento bate com o nome de alguma parte
  if (!cliente && opts?.apelido) {
    const alvo = normalizar(opts.apelido);
    if (alvo.length >= 4) {
      cliente =
        partes.find((p) => normalizar(p.nome) === alvo) ??
        partes.find((p) => normalizar(p.nome).includes(alvo) || alvo.includes(normalizar(p.nome)));
    }
  }

  return {
    autores,
    reus,
    rotulo,
    cliente: cliente ? titulizar(cliente.nome) : (opts?.apelido?.trim() ?? null),
    clientePolo: cliente?.polo ?? null,
  };
}
