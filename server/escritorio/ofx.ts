/**
 * Parser OFX (Open Financial Exchange) + matcher pra conciliação
 * bancária.
 *
 * Suporta OFX 1.x SGML (mais comum entre bancos brasileiros — Itaú,
 * Bradesco, Santander, Caixa). XML moderno OFX 2.x funciona como
 * subset porque também parseamos tags com regex tolerante.
 *
 * Parser NÃO valida cabeçalho OFX (OFXHEADER:100 etc) — vai direto pro
 * conteúdo procurando blocos <STMTTRN>. Funciona em arquivos completos
 * ou em fragmentos.
 *
 * Matcher é DETERMINÍSTICO e CONSERVADOR: só sugere quando valor bate
 * exato (com tolerância de R$ 0,01 pra arredondamento) E data está
 * dentro de janela de ±5 dias do vencimento. Saídas (TRNAMT negativo)
 * casam com despesas pendentes/parciais; entradas (positivo) casam com
 * cobranças pendentes/vencidas.
 *
 * Reconciliação manual sempre prevalece — o sistema sugere mas o
 * usuário confirma cada match na UI.
 */

/** Uma transação parseada do extrato OFX. */
export interface TransacaoOFX {
  /** Identificador único da transação dentro do extrato (FITID). */
  fitid: string;
  /** Data postada no banco (ISO YYYY-MM-DD). */
  data: string;
  /** Valor em reais — positivo (entrada/CREDIT) ou negativo (saída/DEBIT). */
  valor: number;
  /** Descrição / memo da transação (campo MEMO ou NAME). */
  descricao: string;
  /** Tipo bruto do OFX (DEBIT, CREDIT, FEE, etc). */
  tipo: string;
}

/**
 * Parseia um arquivo OFX inteiro (string). Retorna array de transações.
 * Tolerante a:
 *  - Quebra de linha CRLF, LF ou nenhuma
 *  - Tags com/sem fechamento explícito (SGML deixa fechar implícito)
 *  - Acentuação latin-1 vs UTF-8 (caller deve decodificar antes)
 *  - Ordem dos campos dentro do bloco
 */
export function parseOFX(conteudo: string): TransacaoOFX[] {
  const transacoes: TransacaoOFX[] = [];

  // Captura cada bloco <STMTTRN>...</STMTTRN>. O fechamento pode estar
  // ausente em SGML — fallback procura próximo <STMTTRN> ou fim do doc.
  const regexBloco = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = regexBloco.exec(conteudo)) !== null) {
    const bloco = match[1];

    const tipo = extrairTag(bloco, "TRNTYPE") ?? "";
    const dataRaw = extrairTag(bloco, "DTPOSTED") ?? "";
    const valorRaw = extrairTag(bloco, "TRNAMT") ?? "";
    const fitid = extrairTag(bloco, "FITID") ?? "";
    const memo =
      extrairTag(bloco, "MEMO") ?? extrairTag(bloco, "NAME") ?? "";

    const data = converterDataOFX(dataRaw);
    const valor = parseFloat(valorRaw.replace(",", "."));
    if (!data || isNaN(valor) || !fitid) continue;

    transacoes.push({
      fitid: fitid.trim(),
      data,
      valor,
      descricao: memo.trim(),
      tipo: tipo.trim().toUpperCase(),
    });
  }

  return transacoes;
}

/**
 * Extrai conteúdo da primeira ocorrência de uma tag dentro de um bloco.
 * Aceita 3 sintaxes:
 *  - `<TAG>valor</TAG>` (XML)
 *  - `<TAG>valor` (SGML, fecha na próxima tag ou newline)
 *  - `<TAG>valor<` (degeneracia: termina ao encontrar próximo `<`)
 */
function extrairTag(bloco: string, tag: string): string | null {
  // Tentativa 1: XML completo
  const reXml = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, "i");
  const m1 = bloco.match(reXml);
  if (m1) return m1[1];

  // Tentativa 2: SGML (até próxima tag ou EOL)
  const reSgml = new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i");
  const m2 = bloco.match(reSgml);
  if (m2) return m2[1];

  return null;
}

/**
 * Converte data OFX (`YYYYMMDD` ou `YYYYMMDDHHMMSS[.sss][TZ]`) → ISO
 * `YYYY-MM-DD`. Retorna null se inválida.
 *
 * Validação inclui dias inexistentes no mês (30-fev, 31-abr, etc.) via
 * round-trip por Date.UTC: criamos a data e verificamos se o objeto
 * preservou ano/mês/dia. Datas inválidas são auto-normalizadas pelo
 * Date (`30-fev` → `02-mar`), e isso bate ano/mês/dia → detectamos.
 */
function converterDataOFX(raw: string): string | null {
  const limpa = raw.trim();
  if (limpa.length < 8) return null;
  const y = limpa.slice(0, 4);
  const m = limpa.slice(4, 6);
  const d = limpa.slice(6, 8);
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return null;
  const ano = parseInt(y, 10);
  const mes = parseInt(m, 10);
  const dia = parseInt(d, 10);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  // Round-trip pra detectar datas inválidas (30-fev, 31-abr)
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    dt.getUTCFullYear() !== ano ||
    dt.getUTCMonth() !== mes - 1 ||
    dt.getUTCDate() !== dia
  ) {
    return null;
  }

  return `${y}-${m}-${d}`;
}

// ─── Matching ────────────────────────────────────────────────────────────────

export interface CandidatoMatch {
  id: number;
  tipo: "despesa" | "cobranca";
  descricao: string;
  valor: number;
  vencimento: string;
  /** Diferença em dias entre vencimento e data da transação (abs). */
  diffDias: number;
}

export interface SugestaoConciliacao {
  transacao: TransacaoOFX;
  /** Candidatos ordenados por melhor match (menor diffDias primeiro). */
  candidatos: CandidatoMatch[];
}

const TOLERANCIA_VALOR_CENTAVOS = 1;
const JANELA_DIAS = 5;

/**
 * Conta dias absolutos entre 2 datas ISO `YYYY-MM-DD`. Não usa Date
 * (evita timezone surprises) — calcula via número de dias desde epoch UTC.
 */
function diffDiasIso(a: string, b: string): number {
  const aMs = Date.UTC(
    parseInt(a.slice(0, 4), 10),
    parseInt(a.slice(5, 7), 10) - 1,
    parseInt(a.slice(8, 10), 10),
  );
  const bMs = Date.UTC(
    parseInt(b.slice(0, 4), 10),
    parseInt(b.slice(5, 7), 10) - 1,
    parseInt(b.slice(8, 10), 10),
  );
  return Math.abs(Math.round((aMs - bMs) / 86_400_000));
}

/**
 * Pra cada transação OFX, procura candidatos no pool de despesas pendentes
 * (saídas) ou cobranças pendentes (entradas).
 *
 * Critério de match:
 *  - Sinal correto: TRNAMT < 0 → despesa; TRNAMT > 0 → cobrança
 *  - Valor: |TRNAMT| === valor da entidade (tolerância 1 centavo)
 *  - Data: vencimento ± 5 dias da DTPOSTED
 *
 * Retorna SugestaoConciliacao mesmo quando candidatos.length === 0 —
 * UI mostra essas como "sem match, criar nova despesa/cobrança?".
 */
export function sugerirConciliacao(
  transacoes: TransacaoOFX[],
  despesasPendentes: Array<{
    id: number;
    descricao: string;
    valor: number;
    vencimento: string;
  }>,
  cobrancasPendentes: Array<{
    id: number;
    descricao: string;
    valor: number;
    vencimento: string;
  }>,
): SugestaoConciliacao[] {
  return transacoes.map((tx) => {
    const valorAbs = Math.abs(tx.valor);
    const ehSaida = tx.valor < 0;

    const pool = ehSaida ? despesasPendentes : cobrancasPendentes;
    const tipo: "despesa" | "cobranca" = ehSaida ? "despesa" : "cobranca";

    const candidatos: CandidatoMatch[] = pool
      .filter((entidade) => {
        // Bate valor (tolerância 0.01) E está na janela de dias
        const diffCentavos = Math.abs(
          Math.round(entidade.valor * 100) - Math.round(valorAbs * 100),
        );
        if (diffCentavos > TOLERANCIA_VALOR_CENTAVOS) return false;
        const diff = diffDiasIso(entidade.vencimento, tx.data);
        return diff <= JANELA_DIAS;
      })
      .map((entidade) => ({
        id: entidade.id,
        tipo,
        descricao: entidade.descricao,
        valor: entidade.valor,
        vencimento: entidade.vencimento,
        diffDias: diffDiasIso(entidade.vencimento, tx.data),
      }))
      .sort((a, b) => a.diffDias - b.diffDias);

    return { transacao: tx, candidatos };
  });
}
