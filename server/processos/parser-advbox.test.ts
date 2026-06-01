import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  parseAdvboxXlsx,
  parsearColunaCliente,
  parsearValorCausa,
} from "./parser-advbox";

/** Constrói um XLSX em memória com os 28 headers Advbox + linhas de dado. */
async function fakeAdvboxXlsx(linhas: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Dados");
  ws.addRow([
    "Nome do cliente", "Parte contrária", "Grupo de ação", "Tipo de ação",
    "Fase judicial", "Etapa", "Número do processo", "Número do protocolo",
    "Processo originário", "Pasta/Caso", "Ano", "Data do requerimento",
    "Segmento", "Comarca", "Vara", "Tribunal", "Data do fechamento",
    "Data do trânsito em julgado", "Data do arquivamento", "Resultado do processo",
    "Expectiva/Valor da causa (R$)", "Valor dos honorários (R$)", "Honorários (%)",
    "Contingenciamento", "Responsável", "Último andamento", "Anotações Gerais",
    "Data de cadastro",
  ]);
  for (const linha of linhas) ws.addRow(linha);
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

function linhaCompleta(over: Partial<{ A: string; D: string; G: string; U: string }>) {
  return [
    over.A ?? "JONAS GOMES DE SOUSA (087.376.983-03)",
    "", "CÍVEL",
    over.D ?? "CONTRATOS BANCÁRIOS",
    "RECURSAL", "RECURSO PROTOCOLADO/INICIADO",
    over.G ?? "3032130-39.2026.8.06.0001",
    "", "", "", null, "", "", "", "", "", "", "", "", "",
    over.U ?? "R$45.114,52",
    "", "", "", "VIRNA BALBINO LIRA", "", "", "20/05/2026 16:51:40",
  ];
}

describe("parsearColunaCliente", () => {
  it("extrai nome + CPF formatado", () => {
    const r = parsearColunaCliente("JONAS GOMES DE SOUSA (087.376.983-03)");
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("JONAS GOMES DE SOUSA");
    expect(r[0].cpfCnpj).toBe("08737698303");
    expect(r[0].tipoDoc).toBe("cpf");
  });

  it("extrai nome + CNPJ formatado", () => {
    const r = parsearColunaCliente("3D IMPORTS COMERCIO LTDA (38.038.369/0001-66)");
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("3D IMPORTS COMERCIO LTDA");
    expect(r[0].cpfCnpj).toBe("38038369000166");
    expect(r[0].tipoDoc).toBe("cnpj");
  });

  it("nome sem doc — cpfCnpj fica null", () => {
    const r = parsearColunaCliente("ABIMAEL LIMA DE OLIVEIRA");
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("ABIMAEL LIMA DE OLIVEIRA");
    expect(r[0].cpfCnpj).toBeNull();
    expect(r[0].tipoDoc).toBeNull();
  });

  it("múltiplos clientes separados por ';' — cria todos", () => {
    const r = parsearColunaCliente(
      "3D IMPORTS LTDA (38.038.369/0001-66);DIEGO SAN (087.376.983-03)",
    );
    expect(r).toHaveLength(2);
    expect(r[0].nome).toBe("3D IMPORTS LTDA");
    expect(r[1].nome).toBe("DIEGO SAN");
  });

  it("descarta segmento que é apenas um CNJ (artefato Advbox)", () => {
    const r = parsearColunaCliente(
      "3032130-39.2026.8.06.0001;JONAS GOMES DE SOUSA (087.376.983-03)",
    );
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("JONAS GOMES DE SOUSA");
  });

  it("doc inválido — guarda nome inteiro, sem cpfCnpj", () => {
    const r = parsearColunaCliente("FULANO DA SILVA (123.456.789-99)");
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("FULANO DA SILVA");
    expect(r[0].cpfCnpj).toBeNull();
  });

  it("string vazia → array vazio", () => {
    expect(parsearColunaCliente("")).toEqual([]);
    expect(parsearColunaCliente("   ")).toEqual([]);
  });
});

describe("parsearValorCausa", () => {
  it.each([
    ["R$45.114,52", 4511452],
    ["R$ 1.000,00", 100000],
    ["R$1.000", 100000],
    ["45114,52", 4511452],
    ["0", 0],
    ["R$ 22.000,00", 2200000],
  ])("converte %s em %d centavos", (input, expected) => {
    expect(parsearValorCausa(input)).toBe(expected);
  });

  it.each(["", "   ", "abc", "R$abc"])("retorna null pra %s", (input) => {
    expect(parsearValorCausa(input)).toBeNull();
  });

  it("rejeita negativos", () => {
    expect(parsearValorCausa("-100")).toBeNull();
  });
});

describe("parseAdvboxXlsx — integração", () => {
  it("parseia linha típica completa", async () => {
    const buf = await fakeAdvboxXlsx([linhaCompleta({})]);
    const r = await parseAdvboxXlsx(buf);
    expect(r.totalLinhas).toBe(1);
    expect(r.processos).toHaveLength(1);
    const p = r.processos[0];
    expect(p.linhaNum).toBe(2);
    expect(p.cnj).toBe("30321303920268060001");
    expect(p.cnjValido).toBe(true);
    expect(p.tribunal).toBe("TJCE");
    expect(p.clientes).toHaveLength(1);
    expect(p.clientes[0].nome).toBe("JONAS GOMES DE SOUSA");
    expect(p.clientes[0].cpfCnpj).toBe("08737698303");
    expect(p.valorCausaCentavos).toBe(4511452);
    expect(p.classe).toBe("CONTRATOS BANCÁRIOS");
    expect(p.alertas).toHaveLength(0);
  });

  it("CNJ trabalhista → infere TRT", async () => {
    const buf = await fakeAdvboxXlsx([linhaCompleta({ G: "0001415-16.2024.5.07.0015" })]);
    const r = await parseAdvboxXlsx(buf);
    expect(r.processos[0].tribunal).toBe("TRT-7");
  });

  it("CNJ federal → infere TRF", async () => {
    const buf = await fakeAdvboxXlsx([linhaCompleta({ G: "0800127-69.2025.4.05.8109" })]);
    const r = await parseAdvboxXlsx(buf);
    expect(r.processos[0].tribunal).toBe("TRF-5");
  });

  it("linha sem CNJ — alerta + processo ainda registrado", async () => {
    const buf = await fakeAdvboxXlsx([linhaCompleta({ G: "" })]);
    const r = await parseAdvboxXlsx(buf);
    expect(r.processos).toHaveLength(1);
    expect(r.processos[0].cnj).toBeNull();
    expect(r.processos[0].alertas).toContain("Sem número do processo.");
    expect(r.avisos.some((a) => a.tipo === "linha_sem_cnj")).toBe(true);
  });

  it("linha sem cliente — alerta dedicado", async () => {
    const buf = await fakeAdvboxXlsx([linhaCompleta({ A: "" })]);
    const r = await parseAdvboxXlsx(buf);
    expect(r.processos[0].clientes).toHaveLength(0);
    expect(r.processos[0].alertas).toContain("Sem cliente identificado.");
  });

  it("linha totalmente vazia é ignorada", async () => {
    const buf = await fakeAdvboxXlsx([
      ["", "", "", "", "", "", "", "", "", "", null, "", "", "", "", "",
       "", "", "", "", "", "", "", "", "", "", "", ""],
      linhaCompleta({}),
    ]);
    const r = await parseAdvboxXlsx(buf);
    expect(r.totalLinhas).toBe(1);
  });

  it("valor inválido — alerta + centavos null", async () => {
    const buf = await fakeAdvboxXlsx([linhaCompleta({ U: "ZZZ" })]);
    const r = await parseAdvboxXlsx(buf);
    expect(r.processos[0].valorCausaCentavos).toBeNull();
    expect(r.processos[0].alertas[0]).toContain("Valor não reconhecido");
  });

  it("cabeçalho errado → throws", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("X");
    ws.addRow(["foo", "bar"]);
    const ab = await wb.xlsx.writeBuffer();
    await expect(parseAdvboxXlsx(Buffer.from(ab as ArrayBuffer))).rejects.toThrow(
      /Cabeçalho/,
    );
  });

  it("planilha real Advbox (sample) parseia sem crash", async () => {
    const fs = await import("node:fs/promises");
    const path = "/root/.claude/uploads/c6f0305a-71ba-48e0-abcc-e937e3b2a169/9f865905-Advbox20260529_11105532_1.xlsx";
    let buf: Buffer;
    try {
      buf = await fs.readFile(path);
    } catch {
      return;
    }
    const r = await parseAdvboxXlsx(buf);
    expect(r.totalLinhas).toBeGreaterThan(400);
    expect(r.processos.every((p) => p.linhaNum >= 2)).toBe(true);
    expect(r.processos.filter((p) => p.cnj !== null).length).toBeGreaterThan(400);
    expect(r.processos.filter((p) => p.clientes.length > 0).length).toBeGreaterThan(400);
  });
});
