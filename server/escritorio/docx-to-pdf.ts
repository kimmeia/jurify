/**
 * Converte DOCX → PDF via LibreOffice headless (`soffice --convert-to pdf`).
 *
 * Por que LibreOffice e não mammoth (versão anterior): mammoth converte
 * DOCX→HTML perdendo logos embutidas, fontes custom, headers/footers,
 * alinhamentos complexos. LibreOffice abre o DOCX nativamente —
 * fidelidade ~100% do Word. Trade-off: imagem Docker +400MB, build
 * +1-2min, conversão 3-5s por chamada.
 *
 * Concorrência: cada chamada usa --user-profile-dir único pra evitar
 * conflito entre instâncias paralelas (LibreOffice trava o profile dir
 * default quando múltiplos processos rodam ao mesmo tempo).
 *
 * Pré-requisito: `soffice` (libreoffice-writer) instalado no PATH.
 * Em local sem libreoffice → erro claro com instrução; em produção
 * (Docker) sempre disponível.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { createLogger } from "../_core/logger";

const execAsync = promisify(exec);
const log = createLogger("docx-to-pdf");

export async function converterDocxParaPdf(docxBuffer: Buffer): Promise<Buffer> {
  const t0 = Date.now();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jurify-docx2pdf-"));
  const profileDir = path.join(tmpDir, "profile");
  const docxPath = path.join(tmpDir, "input.docx");

  try {
    await fs.writeFile(docxPath, docxBuffer);
    const cmd = [
      "soffice",
      "--headless",
      `-env:UserInstallation=file://${profileDir}`,
      "--convert-to",
      "pdf",
      "--outdir",
      `"${tmpDir}"`,
      `"${docxPath}"`,
    ].join(" ");

    try {
      await execAsync(cmd, { timeout: 60_000 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT") || msg.includes("not found")) {
        throw new Error(
          "LibreOffice (soffice) não encontrado. Instale com 'apt install libreoffice-writer' " +
            "ou rode em ambiente Docker do projeto.",
        );
      }
      throw new Error(`Falha na conversão DOCX→PDF: ${msg}`);
    }

    const pdfPath = path.join(tmpDir, "input.pdf");
    const pdf = await fs.readFile(pdfPath);
    log.info(
      { latenciaMs: Date.now() - t0, tamanhoPdf: pdf.length },
      "DOCX → PDF concluído",
    );
    return pdf;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {
      /* best effort cleanup */
    });
  }
}
