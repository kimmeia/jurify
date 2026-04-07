/**
 * Testes — Exportação de PDF
 *
 * Estes testes invocam o gerador de PDF real (PDFKit) com markdown
 * de exemplo e verificam que:
 *  1. Um Buffer válido é retornado
 *  2. O Buffer começa com o magic header de PDF (%PDF-)
 *  3. O tamanho do Buffer é razoável (não vazio, não corrompido)
 *
 * Não validamos o conteúdo visual — isso requereria um leitor de PDF.
 */

import { describe, it, expect } from "vitest";
import { gerarPDF } from "./export-pdf";

const PDF_MAGIC = Buffer.from("%PDF-");

describe("gerarPDF", () => {
  it("retorna um Buffer não vazio para markdown simples", async () => {
    const md = "# Título\n\nTexto simples.";
    const buf = await gerarPDF(md);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500); // PDF mínimo > 500 bytes
  });

  it("buffer começa com o magic header de PDF", async () => {
    const buf = await gerarPDF("# Teste");
    expect(buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)).toBe(true);
  });

  it("aceita markdown com tabelas", async () => {
    const md = `# Parecer

## Tabela de Verbas

| Descrição | Valor |
|-----------|-------|
| Salário | R$ 3.000,00 |
| FGTS | R$ 240,00 |
| Total | R$ 3.240,00 |

Texto após tabela.`;
    const buf = await gerarPDF(md);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  it("aceita markdown com listas e ênfase", async () => {
    const md = `# Parecer

**Conclusão:** o autor tem direito a:

- Verba 1
- Verba 2
- *Verba 3 itálica*`;
    const buf = await gerarPDF(md);
    expect(buf.length).toBeGreaterThan(500);
  });

  it("não falha em markdown vazio", async () => {
    const buf = await gerarPDF("");
    expect(buf).toBeInstanceOf(Buffer);
    // Mesmo um PDF vazio tem header e estrutura mínima
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  it("aceita markdown com múltiplas seções", async () => {
    const md = `# PARECER TÉCNICO

## 1. INTRODUÇÃO

Texto introdutório.

## 2. ANÁLISE

### 2.1 Subseção

Conteúdo da subseção.

## 3. CONCLUSÃO

Conclusão final.`;
    const buf = await gerarPDF(md);
    expect(buf.length).toBeGreaterThan(1000);
  });
});
