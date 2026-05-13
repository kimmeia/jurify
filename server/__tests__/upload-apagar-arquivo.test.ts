/**
 * Testes — helper `apagarArquivoDoDisco` em server/upload/upload-route.
 *
 * Antes do fix A5, deletar uma cliente_arquivos row (excluirArquivo /
 * excluirPasta / excluirClienteEmCascata) só apagava o metadado do DB.
 * O binário em ./uploads/escritorio_{id}/ ficava órfão consumindo
 * espaço indefinidamente.
 *
 * O helper agora é chamado pelos 3 pontos de delete. Aqui testamos a
 * mecânica do helper isoladamente: rejeita path-traversal, ignora URLs
 * externas/legacy, swallow ENOENT (idempotente), apaga arquivo real.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";

import { apagarArquivoDoDisco } from "../upload/upload-route";

const UPLOAD_DIR = path.resolve("./uploads");
const ESC_ID = 999_999; // ID fake pra não colidir com dados reais

beforeEach(async () => {
  await fs.mkdir(path.join(UPLOAD_DIR, `escritorio_${ESC_ID}`), { recursive: true });
});

afterEach(async () => {
  // Cleanup do diretório de teste
  try {
    await fs.rm(path.join(UPLOAD_DIR, `escritorio_${ESC_ID}`), { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("apagarArquivoDoDisco", () => {
  it("apaga arquivo que existe", async () => {
    const filepath = path.join(UPLOAD_DIR, `escritorio_${ESC_ID}/teste.txt`);
    await fs.writeFile(filepath, "conteúdo de teste");
    const url = `/uploads/escritorio_${ESC_ID}/teste.txt`;

    await apagarArquivoDoDisco(url, ESC_ID);

    // Arquivo não existe mais
    await expect(fs.access(filepath)).rejects.toThrow();
  });

  it("é idempotente — não lança quando arquivo já foi apagado (ENOENT)", async () => {
    const url = `/uploads/escritorio_${ESC_ID}/inexistente.txt`;
    // Não deve lançar
    await expect(apagarArquivoDoDisco(url, ESC_ID)).resolves.toBeUndefined();
  });

  it("rejeita silenciosamente URL fora do escritório (cross-tenant)", async () => {
    const filepath = path.join(UPLOAD_DIR, `escritorio_${ESC_ID}/protegido.txt`);
    await fs.writeFile(filepath, "não deve apagar");

    // URL aponta pra escritório 999_999 mas chamada passa ID 1
    await apagarArquivoDoDisco(`/uploads/escritorio_${ESC_ID}/protegido.txt`, 1);

    // Arquivo ainda existe (URL fora do escritório do caller foi ignorada)
    const conteudo = await fs.readFile(filepath, "utf8");
    expect(conteudo).toBe("não deve apagar");
  });

  it("rejeita URL com path traversal", async () => {
    // Garantir que existe um arquivo "alvo" fora do escritório
    const alvoDir = path.join(UPLOAD_DIR, `escritorio_${ESC_ID + 1}`);
    await fs.mkdir(alvoDir, { recursive: true });
    const alvoFile = path.join(alvoDir, "alvo.txt");
    await fs.writeFile(alvoFile, "não toca");

    // Tentativa de traversal
    const url = `/uploads/escritorio_${ESC_ID}/../escritorio_${ESC_ID + 1}/alvo.txt`;
    await apagarArquivoDoDisco(url, ESC_ID);

    // Arquivo alvo intacto
    const conteudo = await fs.readFile(alvoFile, "utf8");
    expect(conteudo).toBe("não toca");

    // Cleanup adicional
    await fs.rm(alvoDir, { recursive: true, force: true });
  });

  it("ignora URLs externas (S3 legacy, http://...)", async () => {
    // Não deve lançar — só retorna silenciosamente
    await expect(
      apagarArquivoDoDisco("https://s3.amazonaws.com/bucket/file.pdf", ESC_ID),
    ).resolves.toBeUndefined();
  });

  it("ignora URL vazia / null-like", async () => {
    await expect(apagarArquivoDoDisco("", ESC_ID)).resolves.toBeUndefined();
  });
});
