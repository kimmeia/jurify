import { describe, expect, it } from "vitest";
import { decidirPreview, resumirPreview, __test } from "./router-importar-processos";
import type { LinhaAdvbox } from "../processos/parser-advbox";

function linha(over: Partial<LinhaAdvbox>): LinhaAdvbox {
  return {
    linhaNum: 2,
    cnj: "30321303920268060001",
    cnjOriginal: "3032130-39.2026.8.06.0001",
    cnjValido: true,
    tribunal: "TJCE",
    clientes: [{ nome: "JONAS GOMES", cpfCnpj: "08737698303", tipoDoc: "cpf", textoOriginal: "..." }],
    classe: "CONTRATOS BANCÁRIOS",
    valorCausaCentavos: 4511452,
    valorCausaTexto: "R$45.114,52",
    alertas: [],
    ...over,
  };
}

describe("normalizarNome", () => {
  it("colapsa whitespace + remove acentos + maiúscula", () => {
    expect(__test.normalizarNome("  José da  Silva ")).toBe("JOSE DA SILVA");
    expect(__test.normalizarNome("ÇAÇÃO")).toBe("CACAO");
  });
});

describe("adicionarTag", () => {
  it("adiciona quando vazio", () => {
    expect(__test.adicionarTag(null, "advbox-import")).toBe("advbox-import");
    expect(__test.adicionarTag("", "advbox-import")).toBe("advbox-import");
  });
  it("não duplica", () => {
    expect(__test.adicionarTag("advbox-import", "advbox-import")).toBe("advbox-import");
    expect(__test.adicionarTag("vip, advbox-import", "advbox-import")).toBe("vip, advbox-import");
  });
  it("preserva tags existentes", () => {
    expect(__test.adicionarTag("vip", "advbox-import")).toBe("vip, advbox-import");
  });
});

describe("decidirPreview — dedupe contra DB", () => {
  it("linha completa nova → status novo", () => {
    const r = decidirPreview([linha({})], new Map(), new Map(), new Map());
    expect(r[0].status).toBe("novo");
    expect(r[0].contatoExistenteId).toBeNull();
    expect(r[0].processoExistenteId).toBeNull();
  });

  it("cliente já existe por CPF mas processo é novo → ainda 'novo' (vínculo será criado)", () => {
    const porDoc = new Map([["08737698303", { id: 42, nome: "JONAS GOMES" }]]);
    const r = decidirPreview([linha({})], porDoc, new Map(), new Map());
    expect(r[0].status).toBe("novo");
    expect(r[0].contatoExistenteId).toBe(42);
    expect(r[0].contatoExistenteNome).toBe("JONAS GOMES");
    expect(r[0].processoExistenteId).toBeNull();
  });

  it("cliente + processo já existem → ja_existe_processo", () => {
    const porDoc = new Map([["08737698303", { id: 42, nome: "JONAS GOMES" }]]);
    const mapaProc = new Map([["42|30321303920268060001", 7]]);
    const r = decidirPreview([linha({})], porDoc, new Map(), mapaProc);
    expect(r[0].status).toBe("ja_existe_processo");
    expect(r[0].processoExistenteId).toBe(7);
  });

  it("cliente sem doc dedupe por nome normalizado", () => {
    const porNome = new Map([["JONAS GOMES", { id: 99, nome: "Jonas Gomes" }]]);
    const semDoc = linha({
      clientes: [{ nome: "  Jonas  Gomes  ", cpfCnpj: null, tipoDoc: null, textoOriginal: "Jonas Gomes" }],
    });
    const r = decidirPreview([semDoc], new Map(), porNome, new Map());
    expect(r[0].contatoExistenteId).toBe(99);
  });

  it("linha sem cliente → status sem_cliente", () => {
    const r = decidirPreview([linha({ clientes: [] })], new Map(), new Map(), new Map());
    expect(r[0].status).toBe("sem_cliente");
  });

  it("linha sem CNJ → status sem_cnj_invalido", () => {
    const r = decidirPreview(
      [linha({ cnj: null, cnjValido: false })],
      new Map(), new Map(), new Map(),
    );
    expect(r[0].status).toBe("sem_cnj_invalido");
  });

  it("CNJ com dígito errado → status sem_cnj_invalido", () => {
    const r = decidirPreview(
      [linha({ cnjValido: false })],
      new Map(), new Map(), new Map(),
    );
    expect(r[0].status).toBe("sem_cnj_invalido");
  });

  it("preserva campos do parser (tribunal, classe, valor)", () => {
    const r = decidirPreview([linha({})], new Map(), new Map(), new Map());
    expect(r[0].tribunal).toBe("TJCE");
    expect(r[0].classe).toBe("CONTRATOS BANCÁRIOS");
    expect(r[0].valorCausaCentavos).toBe(4511452);
  });
});

describe("resumirPreview", () => {
  it("conta por status", () => {
    const linhas = decidirPreview(
      [
        linha({}),                                  // novo
        linha({ cnj: null, cnjValido: false }),     // sem_cnj_invalido
        linha({ clientes: [] }),                    // sem_cliente
        linha({}),                                  // novo
      ],
      new Map(), new Map(), new Map(),
    );
    const resumo = resumirPreview(linhas);
    expect(resumo.novos).toBe(2);
    expect(resumo.semCnjOuInvalido).toBe(1);
    expect(resumo.semCliente).toBe(1);
    expect(resumo.jaExistem).toBe(0);
  });
});
