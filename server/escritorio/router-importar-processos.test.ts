import { describe, expect, it } from "vitest";
import {
  decidirPreview,
  resumirPreview,
  __test,
  type MapaProcessos,
} from "./router-importar-processos";
import type { LinhaAdvbox } from "../processos/parser-advbox";

function linha(over: Partial<LinhaAdvbox>): LinhaAdvbox {
  return {
    linhaNum: 2,
    cnj: "30321303920268060001",
    cnjOriginal: "3032130-39.2026.8.06.0001",
    cnjValido: true,
    tribunal: "TJCE",
    codigoTribunal: "tjce",
    temMotorProprio: true,
    clientes: [{ nome: "JONAS GOMES", cpfCnpj: "08737698303", tipoDoc: "cpf", textoOriginal: "..." }],
    classe: "CONTRATOS BANCÁRIOS",
    valorCausaCentavos: 4511452,
    valorCausaTexto: "R$45.114,52",
    alertas: [],
    ...over,
  };
}

function mapaVazio(): MapaProcessos {
  return { porContatoECnj: new Map(), porCnj: new Map() };
}

function mapa(
  porContatoECnj: [string, number][] = [],
  porCnj: [string, { contatoId: number; contatoNome: string }[]][] = [],
): MapaProcessos {
  return {
    porContatoECnj: new Map(porContatoECnj),
    porCnj: new Map(porCnj),
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
    const r = decidirPreview([linha({})], new Map(), new Map(), mapaVazio());
    expect(r[0].status).toBe("novo");
    expect(r[0].contatoExistenteId).toBeNull();
    expect(r[0].processoExistenteId).toBeNull();
    expect(r[0].cnjEmOutrosContatos).toEqual([]);
  });

  it("cliente já existe por CPF mas processo é novo → ainda 'novo' (vínculo será criado)", () => {
    const porDoc = new Map([["08737698303", { id: 42, nome: "JONAS GOMES" }]]);
    const r = decidirPreview([linha({})], porDoc, new Map(), mapaVazio());
    expect(r[0].status).toBe("novo");
    expect(r[0].contatoExistenteId).toBe(42);
    expect(r[0].contatoExistenteNome).toBe("JONAS GOMES");
    expect(r[0].processoExistenteId).toBeNull();
  });

  it("cliente + processo já existem → ja_existe_processo", () => {
    const porDoc = new Map([["08737698303", { id: 42, nome: "JONAS GOMES" }]]);
    const m = mapa(
      [["42|30321303920268060001", 7]],
      [["30321303920268060001", [{ contatoId: 42, contatoNome: "JONAS GOMES" }]]],
    );
    const r = decidirPreview([linha({})], porDoc, new Map(), m);
    expect(r[0].status).toBe("ja_existe_processo");
    expect(r[0].processoExistenteId).toBe(7);
    expect(r[0].cnjEmOutrosContatos).toEqual([]);
  });

  it("CNJ vinculado a OUTRO cliente do escritório → cnj_em_outro_cliente", () => {
    // Cenário: na planilha vem "Maria José" (sem CPF) — não bate com
    // nenhum contato. Mas o CNJ está vinculado a "Maria J. Silva" no DB.
    const m = mapa(
      [],
      [["30321303920268060001", [{ contatoId: 88, contatoNome: "Maria J. Silva" }]]],
    );
    const r = decidirPreview([linha({})], new Map(), new Map(), m);
    expect(r[0].status).toBe("cnj_em_outro_cliente");
    expect(r[0].contatoExistenteId).toBeNull();
    expect(r[0].cnjEmOutrosContatos).toHaveLength(1);
    expect(r[0].cnjEmOutrosContatos[0]).toEqual({ contatoId: 88, contatoNome: "Maria J. Silva" });
  });

  it("CNJ no mesmo cliente NÃO conta como 'outro cliente'", () => {
    // O CNJ existe no escritório mas vinculado AO MESMO contato que
    // viria da planilha — deve ser 'ja_existe_processo', não 'cnj_em_outro_cliente'.
    const porDoc = new Map([["08737698303", { id: 42, nome: "JONAS GOMES" }]]);
    const m = mapa(
      [["42|30321303920268060001", 7]],
      [["30321303920268060001", [{ contatoId: 42, contatoNome: "JONAS GOMES" }]]],
    );
    const r = decidirPreview([linha({})], porDoc, new Map(), m);
    expect(r[0].status).toBe("ja_existe_processo");
    expect(r[0].cnjEmOutrosContatos).toEqual([]);
  });

  it("cliente sem doc dedupe por nome normalizado", () => {
    const porNome = new Map([["JONAS GOMES", { id: 99, nome: "Jonas Gomes" }]]);
    const semDoc = linha({
      clientes: [{ nome: "  Jonas  Gomes  ", cpfCnpj: null, tipoDoc: null, textoOriginal: "Jonas Gomes" }],
    });
    const r = decidirPreview([semDoc], new Map(), porNome, mapaVazio());
    expect(r[0].contatoExistenteId).toBe(99);
  });

  it("linha sem cliente → status sem_cliente", () => {
    const r = decidirPreview([linha({ clientes: [] })], new Map(), new Map(), mapaVazio());
    expect(r[0].status).toBe("sem_cliente");
  });

  it("linha sem CNJ → status sem_cnj_invalido", () => {
    const r = decidirPreview(
      [linha({ cnj: null, cnjValido: false })],
      new Map(), new Map(), mapaVazio(),
    );
    expect(r[0].status).toBe("sem_cnj_invalido");
  });

  it("CNJ com dígito errado → status sem_cnj_invalido", () => {
    const r = decidirPreview(
      [linha({ cnjValido: false })],
      new Map(), new Map(), mapaVazio(),
    );
    expect(r[0].status).toBe("sem_cnj_invalido");
  });

  it("preserva campos do parser (tribunal, classe, valor)", () => {
    const r = decidirPreview([linha({})], new Map(), new Map(), mapaVazio());
    expect(r[0].tribunal).toBe("TJCE");
    expect(r[0].classe).toBe("CONTRATOS BANCÁRIOS");
    expect(r[0].valorCausaCentavos).toBe(4511452);
  });
});

describe("resumirPreview", () => {
  it("conta por status", () => {
    const m = mapa(
      [],
      [["30321303920268060001", [{ contatoId: 88, contatoNome: "Outro Cliente" }]]],
    );
    const linhas = decidirPreview(
      [
        linha({}),                                  // cnj_em_outro_cliente (cnj no DB com contato 88)
        linha({ cnj: null, cnjValido: false, codigoTribunal: null, temMotorProprio: false }),
        linha({ clientes: [] }),                    // sem_cliente
        linha({ cnj: "00000000000000000000", cnjOriginal: "0000000-00.0000.0.00.0000" }), // novo
      ],
      new Map(), new Map(), m,
    );
    const resumo = resumirPreview(linhas);
    expect(resumo.novos).toBe(1);
    expect(resumo.cnjEmOutroCliente).toBe(1);
    expect(resumo.semCnjOuInvalido).toBe(1);
    expect(resumo.semCliente).toBe(1);
    expect(resumo.jaExistem).toBe(0);
  });

  it("monitoraveisPorSistema inclui linhas 'novo' E 'ja_existe_processo'", () => {
    // Cenário do bug: user importou antes (sem monitor), agora reimporta
    // pra ativar monitor. Todas as linhas TJCE devem aparecer como
    // elegíveis pra monitor (mesmo as que já têm vínculo).
    const m = mapa(
      [["42|99999999999999999999", 7]],
      [["99999999999999999999", [{ contatoId: 42, contatoNome: "X" }]]],
    );
    const porDoc = new Map([["08737698303", { id: 42, nome: "X" }]]);
    const linhas = decidirPreview(
      [
        linha({}),  // TJCE novo — monitorável
        linha({ cnj: "11111111111111111111", cnjOriginal: "0000001-00.2025.8.06.0001" }), // TJCE novo — monitorável
        linha({
          cnj: "22222222222222222222",
          cnjOriginal: "0800127-69.2025.4.05.8109",
          tribunal: "TRF-5",
          codigoTribunal: "trf5",
          temMotorProprio: false,
        }),  // não elegível
        linha({ cnj: "99999999999999999999", cnjOriginal: "9999999-99.2025.8.06.0001" }), // ja_existe — também monitorável
      ],
      porDoc, new Map(), m,
    );
    const resumo = resumirPreview(linhas);
    // 2 novos + 1 ja_existe TJCE = 3 monitoráveis pje_tjce
    expect(resumo.monitoraveisPorSistema).toEqual({ pje_tjce: 3 });
  });

  it("monitoraveisPorSistema vazio quando nenhum 'novo' é elegível", () => {
    const linhas = decidirPreview(
      [
        linha({
          tribunal: "TRT-7",
          codigoTribunal: "trt7",
          temMotorProprio: false,
        }),
      ],
      new Map(), new Map(), mapaVazio(),
    );
    const resumo = resumirPreview(linhas);
    expect(resumo.monitoraveisPorSistema).toEqual({});
    expect(resumo.novos).toBe(1);
  });
});
