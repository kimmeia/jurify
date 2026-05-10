/**
 * Converte DOCX → PDF reusando o Chromium do Playwright que já está
 * instalado no container pro motor próprio.
 *
 * Estratégia:
 *   1. mammoth gera HTML semântico do DOCX (preserva texto, tabelas
 *      simples, listas, formatação básica)
 *   2. Playwright renderiza via Chromium e exporta como PDF A4
 *
 * Trade-off: layout pode divergir levemente do Word (fontes exatas,
 * headers/footers, numeração de páginas custom). Pra contratos
 * jurídicos típicos (texto + tabelas básicas), aceitável. Pra layout
 * pixel-perfect precisaria libreoffice no container — fora do escopo.
 *
 * Custo: ~2-5s por conversão, ~200MB RAM por instância de Chromium
 * (criada e fechada dentro da função). Aceitável pra volume baixo.
 */

import mammoth from "mammoth";
import { chromium } from "@playwright/test";
import { createLogger } from "../_core/logger";

const log = createLogger("docx-to-pdf");

const CSS_BASE = `
  body {
    font-family: "Times New Roman", Times, serif;
    line-height: 1.5;
    font-size: 12pt;
    color: #111;
    margin: 0;
    padding: 0;
  }
  h1, h2, h3, h4 {
    font-weight: bold;
    margin: 1em 0 0.5em;
    line-height: 1.3;
  }
  h1 { font-size: 16pt; }
  h2 { font-size: 14pt; }
  h3 { font-size: 13pt; }
  p {
    margin: 0.5em 0;
    text-align: justify;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
  }
  td, th {
    border: 1px solid #999;
    padding: 6px 10px;
    vertical-align: top;
  }
  ol, ul {
    margin: 0.5em 0 0.5em 2em;
  }
  strong, b { font-weight: bold; }
  em, i { font-style: italic; }
  @page { size: A4; margin: 2cm; }
`;

export async function converterDocxParaPdf(docxBuffer: Buffer): Promise<Buffer> {
  const t0 = Date.now();

  const { value: html, messages } = await mammoth.convertToHtml({
    buffer: docxBuffer,
  });
  if (messages.length > 0) {
    log.debug(
      { issues: messages.slice(0, 5).map((m) => m.message) },
      "mammoth warnings",
    );
  }

  const fullHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <style>${CSS_BASE}</style>
</head>
<body>${html}</body>
</html>`;

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(fullHtml, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      margin: { top: "2cm", right: "2cm", bottom: "2cm", left: "2cm" },
      printBackground: true,
    });
    log.info(
      { latenciaMs: Date.now() - t0, tamanhoPdf: pdf.length },
      "DOCX → PDF concluído",
    );
    return pdf;
  } finally {
    await browser.close();
  }
}
