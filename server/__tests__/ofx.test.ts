/**
 * Testes do parser OFX e sugestor de conciliação. Funções puras —
 * sem mock de DB necessário.
 */

import { describe, it, expect } from "vitest";
import {
  parseOFX,
  sugerirConciliacao,
  type TransacaoOFX,
} from "../escritorio/ofx";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// OFX SGML estilo Itaú (mais comum no Brasil). Tags sem fechamento.
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKACCTFROM>
<BANKID>0341
<ACCTID>1234/56789
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260510
<TRNAMT>-3000.00
<FITID>20260510001
<MEMO>ALUGUEL ESCRITORIO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260512
<TRNAMT>5000.00
<FITID>20260512001
<MEMO>TED HONORARIOS JOAO SILVA
</STMTTRN>
<STMTTRN>
<TRNTYPE>FEE
<DTPOSTED>20260515
<TRNAMT>-25.50
<FITID>20260515001
<MEMO>TARIFA TED
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

// OFX 2.x XML (Santander moderno, exportações de planilha)
const OFX_XML = `<?xml version="1.0"?>
<OFX>
  <STMTTRN>
    <TRNTYPE>DEBIT</TRNTYPE>
    <DTPOSTED>20260520</DTPOSTED>
    <TRNAMT>-1500.00</TRNAMT>
    <FITID>ABC123</FITID>
    <MEMO>Internet escritorio</MEMO>
  </STMTTRN>
  <STMTTRN>
    <TRNTYPE>CREDIT</TRNTYPE>
    <DTPOSTED>20260521</DTPOSTED>
    <TRNAMT>2000.00</TRNAMT>
    <FITID>ABC124</FITID>
    <NAME>PIX MARIA</NAME>
  </STMTTRN>
</OFX>`;

// OFX malformado: bloco sem FITID (deve ser descartado)
const OFX_SEM_FITID = `<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260601
<TRNAMT>-100.00
<MEMO>SEM ID
</STMTTRN>`;

// ─── Parser ───────────────────────────────────────────────────────────────────

describe("parseOFX — SGML clássico (Itaú/Bradesco)", () => {
  it("extrai 3 transações do exemplo SGML", () => {
    const txs = parseOFX(OFX_SGML);
    expect(txs).toHaveLength(3);
  });

  it("preserva sinal: DEBIT negativo, CREDIT positivo", () => {
    const txs = parseOFX(OFX_SGML);
    expect(txs[0].valor).toBe(-3000);
    expect(txs[1].valor).toBe(5000);
    expect(txs[2].valor).toBe(-25.5);
  });

  it("converte DTPOSTED YYYYMMDD → YYYY-MM-DD", () => {
    const txs = parseOFX(OFX_SGML);
    expect(txs[0].data).toBe("2026-05-10");
    expect(txs[1].data).toBe("2026-05-12");
  });

  it("captura descrição do MEMO", () => {
    const txs = parseOFX(OFX_SGML);
    expect(txs[0].descricao).toBe("ALUGUEL ESCRITORIO");
    expect(txs[1].descricao).toBe("TED HONORARIOS JOAO SILVA");
  });

  it("captura tipo TRNTYPE normalizado em uppercase", () => {
    const txs = parseOFX(OFX_SGML);
    expect(txs[0].tipo).toBe("DEBIT");
    expect(txs[1].tipo).toBe("CREDIT");
    expect(txs[2].tipo).toBe("FEE");
  });

  it("captura FITID como identificador", () => {
    const txs = parseOFX(OFX_SGML);
    expect(txs[0].fitid).toBe("20260510001");
    expect(txs[1].fitid).toBe("20260512001");
  });
});

describe("parseOFX — XML 2.x", () => {
  it("aceita formato XML moderno", () => {
    const txs = parseOFX(OFX_XML);
    expect(txs).toHaveLength(2);
    expect(txs[0].descricao).toBe("Internet escritorio");
    expect(txs[1].descricao).toBe("PIX MARIA"); // NAME fallback quando sem MEMO
  });
});

describe("parseOFX — robustez", () => {
  it("ignora bloco sem FITID", () => {
    const txs = parseOFX(OFX_SEM_FITID);
    expect(txs).toHaveLength(0);
  });

  it("retorna array vazio em string vazia", () => {
    expect(parseOFX("")).toEqual([]);
  });

  it("tolera datas com horário (YYYYMMDDHHMMSS)", () => {
    const ofx = `<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260601120000
<TRNAMT>100.00
<FITID>X1
<MEMO>teste
</STMTTRN>`;
    const txs = parseOFX(ofx);
    expect(txs[0].data).toBe("2026-06-01");
  });
});

// ─── Matcher / sugestor ──────────────────────────────────────────────────────

describe("sugerirConciliacao — match exato", () => {
  it("DEBIT casa com despesa pendente de mesmo valor e data próxima", () => {
    const txs: TransacaoOFX[] = [
      {
        fitid: "X1",
        data: "2026-05-10",
        valor: -3000,
        descricao: "ALUGUEL",
        tipo: "DEBIT",
      },
    ];
    const despesas = [
      { id: 100, descricao: "Aluguel maio", valor: 3000, vencimento: "2026-05-10" },
      { id: 101, descricao: "Internet", valor: 200, vencimento: "2026-05-10" },
    ];
    const cobrancas: Array<{ id: number; descricao: string; valor: number; vencimento: string }> = [];

    const sugest = sugerirConciliacao(txs, despesas, cobrancas);
    expect(sugest).toHaveLength(1);
    expect(sugest[0].candidatos).toHaveLength(1);
    expect(sugest[0].candidatos[0].id).toBe(100);
    expect(sugest[0].candidatos[0].tipo).toBe("despesa");
    expect(sugest[0].candidatos[0].diffDias).toBe(0);
  });

  it("CREDIT casa com cobrança pendente de mesmo valor", () => {
    const txs: TransacaoOFX[] = [
      {
        fitid: "X2",
        data: "2026-05-12",
        valor: 5000,
        descricao: "TED",
        tipo: "CREDIT",
      },
    ];
    const cobrancas = [
      { id: 200, descricao: "Honorários", valor: 5000, vencimento: "2026-05-10" },
    ];

    const sugest = sugerirConciliacao(txs, [], cobrancas);
    expect(sugest[0].candidatos).toHaveLength(1);
    expect(sugest[0].candidatos[0].id).toBe(200);
    expect(sugest[0].candidatos[0].tipo).toBe("cobranca");
    expect(sugest[0].candidatos[0].diffDias).toBe(2);
  });

  it("não casa cobrança quando transação é DEBIT (sinal trocado)", () => {
    const txs: TransacaoOFX[] = [
      { fitid: "X3", data: "2026-05-10", valor: -1000, descricao: "x", tipo: "DEBIT" },
    ];
    const cobrancas = [
      { id: 1, descricao: "x", valor: 1000, vencimento: "2026-05-10" },
    ];
    const sugest = sugerirConciliacao(txs, [], cobrancas);
    expect(sugest[0].candidatos).toHaveLength(0);
  });

  it("respeita janela de ±5 dias", () => {
    const txs: TransacaoOFX[] = [
      {
        fitid: "X4",
        data: "2026-05-20",
        valor: -100,
        descricao: "x",
        tipo: "DEBIT",
      },
    ];
    const despesas = [
      { id: 1, descricao: "dentro janela", valor: 100, vencimento: "2026-05-15" }, // 5 dias = aceita
      { id: 2, descricao: "fora janela", valor: 100, vencimento: "2026-05-14" }, // 6 dias = rejeita
    ];
    const sugest = sugerirConciliacao(txs, despesas, []);
    expect(sugest[0].candidatos.map((c) => c.id)).toEqual([1]);
  });

  it("tolerância de 1 centavo no valor", () => {
    const txs: TransacaoOFX[] = [
      {
        fitid: "X5",
        data: "2026-05-10",
        valor: -100.01,
        descricao: "x",
        tipo: "DEBIT",
      },
    ];
    const despesas = [
      { id: 1, descricao: "exato", valor: 100, vencimento: "2026-05-10" }, // diff 1 centavo: aceita
      { id: 2, descricao: "longe", valor: 99.99, vencimento: "2026-05-10" }, // diff 2 centavos: rejeita
    ];
    const sugest = sugerirConciliacao(txs, despesas, []);
    expect(sugest[0].candidatos.map((c) => c.id)).toEqual([1]);
  });

  it("ordena candidatos por diffDias asc", () => {
    const txs: TransacaoOFX[] = [
      {
        fitid: "X6",
        data: "2026-05-20",
        valor: -100,
        descricao: "x",
        tipo: "DEBIT",
      },
    ];
    const despesas = [
      { id: 1, descricao: "3 dias atrás", valor: 100, vencimento: "2026-05-17" },
      { id: 2, descricao: "mesma data", valor: 100, vencimento: "2026-05-20" },
      { id: 3, descricao: "5 dias atrás", valor: 100, vencimento: "2026-05-15" },
    ];
    const sugest = sugerirConciliacao(txs, despesas, []);
    expect(sugest[0].candidatos.map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it("sem candidatos: retorna array vazio mas mantém sugestão (UI cria nova)", () => {
    const txs: TransacaoOFX[] = [
      {
        fitid: "X7",
        data: "2026-05-10",
        valor: -999,
        descricao: "Algo desconhecido",
        tipo: "DEBIT",
      },
    ];
    const sugest = sugerirConciliacao(txs, [], []);
    expect(sugest).toHaveLength(1);
    expect(sugest[0].candidatos).toEqual([]);
    expect(sugest[0].transacao.descricao).toBe("Algo desconhecido");
  });
});
