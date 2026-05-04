/**
 * Testes do import de backup do escritório.
 *
 * Cobertura: validação do ZIP (formato, manifesto, escritorioId, versão).
 * Os caminhos de DELETE/INSERT no banco real não são testados aqui (precisam
 * de MySQL rodando) — ficam pra teste de integração / manual.
 *
 * Mockamos `getDb` pra simular preview sem banco. Isso valida a estrutura
 * da função (lê manifesto, faz COUNT por tabela, retorna shape correto).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  ORDEM_TOPOLOGICA,
  TABELAS_INCLUIR,
  TABELAS_SATELITE,
} from "../backup/escritorio-tabelas";

// Mock do getDb pra preview — retorna um conn que sempre devolve `[ {c: 0} ]`.
vi.mock("../db", () => ({
  getDb: async () => ({
    $client: {
      execute: async () => [[{ c: 0 }], []],
    },
  }),
}));

describe("escritorio-import — validação", () => {
  let previewImportEscritorio: typeof import("../backup/escritorio-import").previewImportEscritorio;

  beforeEach(async () => {
    const mod = await import("../backup/escritorio-import");
    previewImportEscritorio = mod.previewImportEscritorio;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function montarZipCompleto(opts: {
    versao?: 1 | 2;
    escritorioId?: number;
    escritorioNome?: string;
    pularManifesto?: boolean;
    pularTabela?: string;
    manifestoCorrupto?: boolean;
    tabelaCorrupta?: string;
  } = {}): Promise<Buffer> {
    const {
      versao = 2,
      escritorioId = 42,
      escritorioNome = "Escritório Teste",
      pularManifesto = false,
      pularTabela,
      manifestoCorrupto = false,
      tabelaCorrupta,
    } = opts;
    const zip = new JSZip();
    if (!pularManifesto) {
      zip.file(
        "manifesto.json",
        manifestoCorrupto
          ? "{not valid json"
          : JSON.stringify({
              versao,
              geradoEm: new Date().toISOString(),
              escritorioId,
              escritorioNome,
              tabelas: [],
              excluidasPorSegredo: [],
              excluidasNaoRelevantes: [],
              aviso: "test",
            }),
      );
    }
    for (const t of TABELAS_INCLUIR) {
      if (t.nomeBanco === pularTabela) continue;
      zip.file(
        `tabelas/${t.nomeBanco}.json`,
        t.nomeBanco === tabelaCorrupta ? "{not json" : "[]",
      );
    }
    for (const t of TABELAS_SATELITE) {
      if (t.nomeBanco === pularTabela) continue;
      zip.file(
        `tabelas/${t.nomeBanco}.json`,
        t.nomeBanco === tabelaCorrupta ? "{not json" : "[]",
      );
    }
    return zip.generateAsync({ type: "nodebuffer" });
  }

  it("recusa arquivo que não é ZIP válido", async () => {
    const lixo = Buffer.from("isto não é um zip");
    await expect(previewImportEscritorio(lixo, 42)).rejects.toThrow(/não é um ZIP/i);
  });

  it("recusa ZIP sem manifesto.json", async () => {
    const zip = await montarZipCompleto({ pularManifesto: true });
    await expect(previewImportEscritorio(zip, 42)).rejects.toThrow(/manifesto/i);
  });

  it("recusa manifesto com JSON inválido", async () => {
    const zip = await montarZipCompleto({ manifestoCorrupto: true });
    await expect(previewImportEscritorio(zip, 42)).rejects.toThrow(/manifesto/i);
  });

  it("recusa backup com versão antiga (v1) — round-trip não confiável", async () => {
    const zip = await montarZipCompleto({ versao: 1 });
    await expect(previewImportEscritorio(zip, 42)).rejects.toThrow(/Versão.*1.*não.*suportada/i);
  });

  it("recusa import quando escritorioId do backup é diferente do alvo", async () => {
    const zip = await montarZipCompleto({ escritorioId: 99 });
    await expect(previewImportEscritorio(zip, 42)).rejects.toThrow(/só pode ser importado/i);
  });

  it("recusa quando alguma tabela esperada falta no ZIP", async () => {
    const zip = await montarZipCompleto({ pularTabela: "contatos" });
    await expect(previewImportEscritorio(zip, 42)).rejects.toThrow(/contatos.*faltando/i);
  });

  it("recusa quando uma tabela tem JSON corrompido", async () => {
    const zip = await montarZipCompleto({ tabelaCorrupta: "contatos" });
    await expect(previewImportEscritorio(zip, 42)).rejects.toThrow(/contatos.*corrompido/i);
  });

  it("aceita ZIP completo válido e retorna preview com todas as tabelas em ordem", async () => {
    const zip = await montarZipCompleto({ escritorioId: 42 });
    const preview = await previewImportEscritorio(zip, 42);
    expect(preview.manifesto.escritorioId).toBe(42);
    expect(preview.manifesto.versao).toBe(2);
    // Cada tabela em ORDEM_TOPOLOGICA deve aparecer no preview
    expect(preview.tabelas.length).toBe(ORDEM_TOPOLOGICA.length);
    expect(preview.tabelas.map((t) => t.nome)).toEqual([...ORDEM_TOPOLOGICA]);
    // Mock retorna 0 pra tudo
    expect(preview.totalApagar).toBe(0);
    expect(preview.totalInserir).toBe(0);
  });
});
