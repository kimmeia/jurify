/**
 * Utilitários puros (sem efeitos colaterais) para normalização de dados
 * vindos dos tribunais. Reusados por todos os adapters (TRT, TJ, TRF, Eproc).
 *
 * 100% testável sem mock.
 */

import crypto from "node:crypto";

/**
 * Normaliza CNJ removendo máscara: aceita "0001234-56.2024.5.02.0001",
 * "00012345620245020001" ou qualquer mistura, retorna 20 dígitos puros.
 *
 * Usado pra dedupe de processos e construção de URLs de tribunal.
 */
export function normalizarCnj(cnj: string): string {
  return cnj.replace(/\D/g, "");
}

/**
 * Aplica máscara CNJ padrão: NNNNNNN-DD.AAAA.J.TR.OOOO
 * Aceita CNJ sem máscara (20 dígitos) ou já mascarado.
 */
export function mascararCnj(cnj: string): string {
  const limpo = normalizarCnj(cnj);
  if (limpo.length !== 20) return cnj;
  return `${limpo.slice(0, 7)}-${limpo.slice(7, 9)}.${limpo.slice(9, 13)}.${limpo.slice(13, 14)}.${limpo.slice(14, 16)}.${limpo.slice(16, 20)}`;
}

/**
 * Valida CNJ pelo dígito verificador (módulo 97).
 *
 * Algoritmo CNJ Resolução 65/2008:
 *   1. Remove máscara
 *   2. Pega NNNNNNN + AAAA + J + TR + OOOO (sem o DD)
 *   3. Concatena, calcula 98 - (numero × 100 mod 97)
 *   4. Compara com DD
 */
export function validarCnj(cnj: string): boolean {
  const limpo = normalizarCnj(cnj);
  if (limpo.length !== 20) return false;

  const numero = limpo.slice(0, 7);
  const dv = limpo.slice(7, 9);
  const ano = limpo.slice(9, 13);
  const justica = limpo.slice(13, 14);
  const tribunal = limpo.slice(14, 16);
  const orgao = limpo.slice(16, 20);

  // Cálculo módulo 97 com BigInt — o número intermediário passa de
  // Number.MAX_SAFE_INTEGER (2^53), então BigInt é obrigatório pra evitar
  // perda de precisão.
  const concat = `${numero}${ano}${justica}${tribunal}${orgao}`;
  const resto = BigInt(concat) % 97n;
  const dvCalculado = Number(98n - (resto * 100n) % 97n);

  return dvCalculado === parseInt(dv, 10);
}

/**
 * Extrai o alias do tribunal a partir do CNJ.
 *
 * Segmento de justiça (Resolução CNJ 65/2008):
 *   1=STF, 2=CNJ, 3=STJ
 *   4 = Justiça Federal (TRFs 1-6)
 *   5 = Justiça do Trabalho (TST e TRTs 1-24)
 *   6 = Justiça Eleitoral (TSE e TREs)
 *   7 = Justiça Militar da União (STM)
 *   8 = Justiça dos Estados (TJs)
 *   9 = Justiça Militar Estadual
 */
export function aliasTribunalDoCnj(cnj: string): string | null {
  const limpo = normalizarCnj(cnj);
  if (limpo.length !== 20) return null;

  const justica = limpo.slice(13, 14);
  const tribunalNum = parseInt(limpo.slice(14, 16), 10);

  if (justica === "4") {
    if (tribunalNum >= 1 && tribunalNum <= 6) return `trf${tribunalNum}`;
  }
  if (justica === "5") {
    if (tribunalNum >= 1 && tribunalNum <= 24) return `trt${tribunalNum}`;
  }
  if (justica === "8") {
    return aliasTjPorCodigo(tribunalNum);
  }

  return null;
}

const TJ_POR_CODIGO: Record<number, string> = {
  1: "tjac", 2: "tjal", 3: "tjap", 4: "tjam", 5: "tjba",
  6: "tjce", 7: "tjdft", 8: "tjes", 9: "tjgo", 10: "tjma",
  11: "tjmt", 12: "tjms", 13: "tjmg", 14: "tjpa", 15: "tjpb",
  16: "tjpr", 17: "tjpe", 18: "tjpi", 19: "tjrj", 20: "tjrn",
  21: "tjrs", 22: "tjro", 23: "tjrr", 24: "tjsc", 25: "tjsp",
  26: "tjse", 27: "tjto",
};

function aliasTjPorCodigo(codigo: number): string | null {
  return TJ_POR_CODIGO[codigo] ?? null;
}

/**
 * Parse de data brasileira em vários formatos comuns:
 *   "10/05/2024", "10/05/2024 14:30:00", "10/05/2024 14:30",
 *   "2024-05-10", "2024-05-10T14:30:00",
 *   "10 mai 2024", "10 mai. 2024" (pt-br abreviado, usado pelo PJe TJCE)
 *
 * Retorna ISO 8601 ou null se não conseguir parsear.
 */
export function parseDataBR(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // ISO já formatado — passa direto
  const iso = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  if (iso.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // DD/MM/YYYY [HH:MM[:SS]]
  const m = trimmed.match(
    /^(\d{1,2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = m;
    const d = new Date(
      `${yyyy}-${mm}-${dd.padStart(2, "0")}T${hh}:${mi}:${ss}-03:00`,
    );
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // "DD mmm YYYY" pt-br abreviado (PJe TJCE expõe assim no painel lateral)
  const ptMonths: Record<string, string> = {
    jan: "01", fev: "02", mar: "03", abr: "04",
    mai: "05", jun: "06", jul: "07", ago: "08",
    set: "09", out: "10", nov: "11", dez: "12",
  };
  const m2 = trimmed.match(
    /^(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?\s+(\d{4})$/i,
  );
  if (m2) {
    const dd = m2[1].padStart(2, "0");
    const mm = ptMonths[m2[2].toLowerCase()] ?? "01";
    const yyyy = m2[3];
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00-03:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

/**
 * Normaliza texto para comparação/dedupe:
 *  - lowercase
 *  - remove acentos
 *  - colapsa espaços e quebras de linha
 *  - trim
 *
 * Não muda pontuação para preservar nuances semânticas
 * (ex: "PJe" e "Pje" colapsam, mas "horas extras" e "horas-extras" não).
 */
export function normalizarTexto(texto: string): string {
  // ̀-ͯ cobre o bloco "Combining Diacritical Marks" do Unicode —
  // depois de NFD, acentos viram caracteres combining que removemos aqui.
  // Forma escape em vez de literal pra evitar surpresas com encoding.
  const REGEX_DIACRITICOS = /[̀-ͯ]/g;
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(REGEX_DIACRITICOS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrai valor monetário em centavos a partir de string brasileira.
 * Ex: "R$ 1.234,56" → 123456, "R$ 50,00" → 5000, "1234,56" → 123456
 *
 * Retorna null se não conseguir parsear (campo vazio ou formato inesperado).
 */
export function parseValorBRLCentavos(input: string | null | undefined): number | null {
  if (!input) return null;
  const limpo = input
    .replace(/R\$\s*/gi, "")
    .replace(/\s/g, "")
    .trim();
  if (!limpo) return null;

  // Detecta formato:
  //   "1.234,56"   → tem vírgula decimal → reais (R$ 1.234,56)
  //   "1234.56"    → tem ponto decimal (sem vírgula) → reais
  //   "5449470"    → só dígitos, sem decimal → CENTAVOS sem máscara
  //                  (PJe TJCE expõe valor da causa assim em alguns campos)
  //   "100"        → só dígitos pequeno → reais ("R$ 100,00")
  const temVirgula = limpo.includes(",");
  const temPontoDecimal = !temVirgula && /\.\d{1,2}$/.test(limpo);
  const ehSoDigitos = /^\d+$/.test(limpo);

  if (ehSoDigitos) {
    // Heurística: dígitos puros sem máscara. Se >= 1000, assume que
    // são centavos (PJe sem máscara expõe "5449470" pra R$ 54.494,70).
    // Valores menores são raros pra valor de causa, mas tratamos como
    // reais (ex: "100" = R$ 100,00 — embora improvável, não vamos
    // estourar 100x à toa).
    const num = parseInt(limpo, 10);
    if (isNaN(num)) return null;
    return num >= 1000 ? num : num * 100;
  }

  // Formato BR: ponto como separador de milhar, vírgula como decimal
  const valor = temVirgula
    ? limpo.replace(/\./g, "").replace(",", ".")
    : temPontoDecimal
      ? limpo // já está em formato US (ponto decimal)
      : limpo;
  const num = parseFloat(valor);
  if (isNaN(num)) return null;

  return Math.round(num * 100);
}

/**
 * Hash SHA-256 de string normalizada — usado pra dedupe de eventos.
 *
 * Por que usar normalizarTexto antes do hash:
 * Evita falsos diferentes por whitespace/acentuação. Ex: "Audiência em 10/05"
 * e "audiência em 10/05" produzem o mesmo hash.
 */
export function hashEvento(componentes: (string | null | undefined)[]): string {
  const concat = componentes
    .filter(Boolean)
    .map((c) => normalizarTexto(String(c)))
    .join("|");
  return crypto.createHash("sha256").update(concat).digest("hex");
}

/**
 * Hash SHA-256 de CPF — usado em `dje_publicacoes.partesCpfsHash` (LGPD).
 *
 * Limpa máscara antes do hash pra que CPF "123.456.789-00" e "12345678900"
 * produzam o mesmo hash.
 */
export function hashCpf(cpf: string): string {
  const limpo = cpf.replace(/\D/g, "");
  return crypto.createHash("sha256").update(limpo).digest("hex");
}

/**
 * Detecta se um texto provavelmente é um CNJ válido.
 * Útil pra extrair CNJs de meio de texto (ex: ementa de DJE).
 */
export function extrairCnjs(texto: string): string[] {
  const regex = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;
  const matches = texto.match(regex) || [];
  return matches.filter((m) => validarCnj(m));
}

/**
 * Espera N milissegundos. Wrapper sobre setTimeout.
 *
 * Usado em scrapers pra delays educados entre requests
 * (evita ban por rate limit do tribunal).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
