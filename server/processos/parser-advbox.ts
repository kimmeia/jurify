/**
 * Parser do export de processos da Advbox (XLSX).
 *
 * Layout esperado (28 colunas, linha 1 = cabeçalho):
 *   A=Nome do cliente, B=Parte contrária, C=Grupo de ação, D=Tipo de ação,
 *   E=Fase judicial, F=Etapa, G=Número do processo, ..., U=Valor da causa,
 *   Y=Responsável, ..., AB=Data de cadastro
 *
 * Pure: recebe Buffer, devolve estrutura pronta pra preview. Não toca DB
 * nem rede. Erros de parsing por linha ficam em `alertas` — o lote inteiro
 * só falha se o cabeçalho não bate (arquivo errado).
 */

import ExcelJS from "exceljs";
import { validarCpfCnpj } from "../../shared/validacoes";
import { parseCnjTribunal } from "./cnj-parser";
import { normalizarCnj, validarCnj } from "../../scripts/spike-motor-proprio/lib/parser-utils";

export type ClienteAdvbox = {
  /** Nome do cliente, sem o doc entre parênteses */
  nome: string;
  /** CPF/CNPJ só com dígitos. Null quando não veio ou é inválido. */
  cpfCnpj: string | null;
  /** Tipo do doc detectado, pra UI mostrar badge. */
  tipoDoc: "cpf" | "cnpj" | null;
  /** Texto original como apareceu na coluna (útil pra preview). */
  textoOriginal: string;
};

export type LinhaAdvbox = {
  /** 1-based, batendo com Excel (linha 1 = cabeçalho, dados começam em 2). */
  linhaNum: number;
  /** CNJ normalizado (só dígitos) ou null. */
  cnj: string | null;
  /** CNJ original formatado, útil pra exibição. */
  cnjOriginal: string;
  /** True quando o CNJ passou no dígito verificador. */
  cnjValido: boolean;
  /** Sigla do tribunal inferida do CNJ (ex: "TJCE"). Null se CNJ inválido. */
  tribunal: string | null;
  /** Código interno do tribunal (ex: "tjce", "trt7") — usado pra cruzar com
   *  credenciais do cofre. Null se CNJ inválido. */
  codigoTribunal: string | null;
  /** True se temos adapter de monitoramento automático pra esse tribunal
   *  (hoje só TJCE 1º grau). Quando false, importação cria vínculo mas não
   *  monitora. */
  temMotorProprio: boolean;
  /** Cliente(s) extraído(s) da coluna A. Sempre pelo menos 1 quando a linha é válida. */
  clientes: ClienteAdvbox[];
  /** Classe processual (coluna D — "Tipo de ação"). */
  classe: string | null;
  /** Valor em centavos, parseado da coluna U. Null quando vazio/inválido. */
  valorCausaCentavos: number | null;
  /** Texto bruto do valor (pra preview). */
  valorCausaTexto: string;
  /** Mensagens não-fatais (sem CNJ válido, sem clientes, valor não parseado, etc). */
  alertas: string[];
};

export type AvisoArquivo = {
  tipo: "linha_vazia" | "linha_sem_cliente" | "linha_sem_cnj" | "valor_invalido";
  linhaNum: number;
  detalhe: string;
};

export type ResultadoParse = {
  totalLinhas: number;
  processos: LinhaAdvbox[];
  avisos: AvisoArquivo[];
};

/** Cabeçalhos exatos esperados — usados pra validar que é um export Advbox. */
const HEADERS_OBRIGATORIOS = ["Nome do cliente", "Número do processo"] as const;

const COL = {
  cliente: 1,    // A
  classe: 4,     // D — "Tipo de ação"
  cnj: 7,        // G — "Número do processo"
  valor: 21,     // U — "Expectiva/Valor da causa (R$)"
} as const;

/** Bate com a forma "NNNNNNN-DD.AAAA.J.TR.OOOO". Usado pra descartar
 *  CNJs duplicados no campo de nome (linha 2 do arquivo de exemplo). */
const CNJ_RE = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;

/** Captura "(...)" no final do segmento — onde a Advbox põe o CPF/CNPJ. */
const DOC_TRAILING_RE = /\s*\(([\d.\-/]{11,18})\)\s*$/;

/**
 * Quebra a célula em N candidatos (separados por `;`), descarta segmentos
 * que são puramente um CNJ (artefato do export) e extrai cpfCnpj de cada.
 */
export function parsearColunaCliente(raw: string): ClienteAdvbox[] {
  const txt = raw.trim();
  if (!txt) return [];
  const segmentos = txt
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !CNJ_RE.test(s));

  const out: ClienteAdvbox[] = [];
  for (const seg of segmentos) {
    const m = seg.match(DOC_TRAILING_RE);
    let nome = seg;
    let cpfCnpj: string | null = null;
    let tipoDoc: "cpf" | "cnpj" | null = null;
    if (m) {
      nome = seg.slice(0, m.index).trim();
      const docRaw = m[1];
      const v = validarCpfCnpj(docRaw);
      if (v.valido) {
        cpfCnpj = docRaw.replace(/\D/g, "");
        tipoDoc = v.tipo;
      }
    }
    if (!nome) continue;
    out.push({ nome, cpfCnpj, tipoDoc, textoOriginal: seg });
  }
  return out;
}

/**
 * Converte "R$45.114,52" → 4511452 (centavos).
 * Aceita espaços, "R$ " opcional. Retorna null se vazio ou não-numérico.
 *
 * Casos cobertos: "R$45.114,52", "R$ 1.000", "45114,52", "0", "" .
 */
export function parsearValorCausa(raw: string): number | null {
  const txt = raw.trim();
  if (!txt) return null;
  const limpo = txt
    .replace(/R\$/i, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Lê o valor de uma célula do exceljs como string limpa. */
function celulaStr(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return "";
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  // Rich text / hyperlink / formula — extrai .text quando disponível
  if (typeof v === "object" && "text" in v && typeof (v as { text: unknown }).text === "string") {
    return (v as { text: string }).text;
  }
  if (typeof v === "object" && "result" in v) {
    const r = (v as { result: unknown }).result;
    if (typeof r === "string" || typeof r === "number") return String(r);
  }
  return "";
}

/**
 * Lê o XLSX e devolve linhas estruturadas + avisos do arquivo.
 *
 * Throws quando o cabeçalho não bate com layout Advbox (arquivo errado).
 * Não lança por linha individual — registra `alertas` na própria linha.
 */
export async function parseAdvboxXlsx(buffer: Buffer): Promise<ResultadoParse> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Planilha sem abas.");

  // Cabeçalho — confirma layout Advbox
  const headerCells: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c) => {
    headerCells.push(celulaStr(c).trim());
  });
  for (const obrig of HEADERS_OBRIGATORIOS) {
    if (!headerCells.includes(obrig)) {
      throw new Error(
        `Cabeçalho não bate com export Advbox. Esperava coluna "${obrig}".`,
      );
    }
  }

  const processos: LinhaAdvbox[] = [];
  const avisos: AvisoArquivo[] = [];
  let totalLinhas = 0;

  // Linha 1 = header. Dados começam em 2.
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const clienteRaw = celulaStr(row.getCell(COL.cliente));
    const cnjOriginal = celulaStr(row.getCell(COL.cnj)).trim();
    const classeRaw = celulaStr(row.getCell(COL.classe)).trim();
    const valorRaw = celulaStr(row.getCell(COL.valor));

    // Linha totalmente vazia — não conta
    if (!clienteRaw && !cnjOriginal && !classeRaw && !valorRaw) continue;
    totalLinhas++;

    const alertas: string[] = [];
    const clientes = parsearColunaCliente(clienteRaw);
    if (clientes.length === 0) {
      alertas.push("Sem cliente identificado.");
      avisos.push({ tipo: "linha_sem_cliente", linhaNum: r, detalhe: clienteRaw.slice(0, 80) });
    }

    let cnj: string | null = null;
    let cnjValido = false;
    let tribunal: string | null = null;
    let codigoTribunal: string | null = null;
    let temMotorProprio = false;
    if (cnjOriginal) {
      const normalizado = normalizarCnj(cnjOriginal);
      if (normalizado.length === 20) {
        cnj = normalizado;
        cnjValido = validarCnj(cnjOriginal);
        const tParse = parseCnjTribunal(cnjOriginal);
        tribunal = tParse?.siglaTribunal ?? null;
        codigoTribunal = tParse?.codigoTribunal ?? null;
        temMotorProprio = tParse?.temMotorProprio ?? false;
        if (!cnjValido) alertas.push("CNJ com dígito verificador inválido.");
      } else {
        alertas.push("Número do processo fora do formato CNJ.");
      }
    } else {
      alertas.push("Sem número do processo.");
      avisos.push({ tipo: "linha_sem_cnj", linhaNum: r, detalhe: "" });
    }

    let valorCausaCentavos: number | null = null;
    if (valorRaw.trim()) {
      valorCausaCentavos = parsearValorCausa(valorRaw);
      if (valorCausaCentavos === null) {
        alertas.push(`Valor não reconhecido: "${valorRaw.trim()}"`);
        avisos.push({ tipo: "valor_invalido", linhaNum: r, detalhe: valorRaw.trim() });
      }
    }

    processos.push({
      linhaNum: r,
      cnj,
      cnjOriginal,
      cnjValido,
      tribunal,
      codigoTribunal,
      temMotorProprio,
      clientes,
      classe: classeRaw || null,
      valorCausaCentavos,
      valorCausaTexto: valorRaw.trim(),
      alertas,
    });
  }

  return { totalLinhas, processos, avisos };
}
