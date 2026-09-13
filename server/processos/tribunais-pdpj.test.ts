import { describe, it, expect } from "vitest";
import {
  pdpjTjConfig,
  pdpjTrtConfig,
  getConfigTribunal,
  tribunalTemMotorProprio,
  tribunalRequerCredencial,
  tribunalTemConsultaPublica,
  configPorSistema,
  contagemRegistro,
  segundoGrauMapeado,
  sistemaAtendeTribunal,
  sistemasQueAtendem,
  tribunaisPjeDisponiveis,
  SISTEMA_PJE_NACIONAL,
  TRIBUNAIS_CONSULTA_PUBLICA,
} from "./tribunais-pdpj";

describe("tribunais-pdpj (registro central)", () => {
  it("TJCE 1º grau bate com a config validada (comportamento preservado)", () => {
    const c = getConfigTribunal("tjce");
    expect(c).not.toBeNull();
    expect(c!.urlEntrada).toBe("https://pje.tjce.jus.br/");
    expect(c!.urlBusca).toBe(
      "https://pje.tjce.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam",
    );
    expect(c!.grau).toBe(1);
  });

  it("TJCE 2º grau usa o portal pje2grau", () => {
    const c = getConfigTribunal("tjce", 2);
    expect(c).not.toBeNull();
    expect(c!.urlEntrada).toBe("https://pje.tjce.jus.br/pje2grau/");
    expect(c!.urlBusca).toBe(
      "https://pje.tjce.jus.br/pje2grau/Processo/ConsultaProcesso/listView.seam",
    );
    expect(c!.grau).toBe(2);
  });

  it("tribunal não registrado → null / sem motor próprio", () => {
    // TJSP usa E-SAJ — não tem adapter PDPJ
    expect(getConfigTribunal("tjsp")).toBeNull();
    expect(tribunalTemMotorProprio("tjce")).toBe(true);
    expect(tribunalTemMotorProprio("tjsp")).toBe(false);
  });

  it("Lote 1 (PJe-PDPJ multi-estado) gera URLs no padrão do estado", () => {
    // Smoke: cada TJ habilitado aponta pro próprio portal — não pode
    // cair em pje.tjce.jus.br por engano.
    const casos: [string, string][] = [
      // TJRJ foge do padrão: tribunal-como-subdomínio do pje.jus.br —
      // pje.tjrj.jus.br nem resolve DNS (validação do Cofre, 20/08).
      ["tjrj", "https://tjrj.pje.jus.br/1g/login.seam"],
      ["tjmg", "https://pje.tjmg.jus.br/"],
      // Endereços reais confirmados na validação de 20/08 (o derivado caía
      // em portal institucional ou não respondia).
      ["tjrn", "https://pje1g.tjrn.jus.br/pje/login.seam"],
      ["tjma", "https://pje.tjma.jus.br/"],
      ["tjpa", "https://pje.tjpa.jus.br/pje/login.seam"],
      ["tjro", "https://pjepg.tjro.jus.br/pje/login.seam"],
      ["tjpe", "https://pje.cloud.tjpe.jus.br/1g/login.seam"],
      ["tjpb", "https://pje.tjpb.jus.br/"],
      ["tjmt", "https://pje.tjmt.jus.br/"],
      ["tjrr", "https://pje.tjrr.jus.br/"],
    ];
    for (const [trib, esperado] of casos) {
      const c = getConfigTribunal(trib);
      expect(c, `${trib} deve estar habilitado`).not.toBeNull();
      expect(c!.urlEntrada).toBe(esperado);
      expect(tribunalTemMotorProprio(trib)).toBe(true);
    }
  });

  it("TJDF é exceção: id 'tjdf' mas portal vive em pje.tjdft.jus.br", () => {
    const c = getConfigTribunal("tjdf");
    expect(c).not.toBeNull();
    expect(c!.tribunal).toBe("tjdf");
    expect(c!.urlEntrada).toBe("https://pje.tjdft.jus.br/");
  });

  it("pdpjTjConfig gera o padrão PJe a partir da UF (adicionar estado = 1 linha)", () => {
    const mg = pdpjTjConfig("mg");
    expect(mg.tribunal).toBe("tjmg");
    expect(mg.urlEntrada).toBe("https://pje.tjmg.jus.br/");
    expect(mg.urlBusca).toBe(
      "https://pje.tjmg.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam",
    );
  });
});

describe("configPorSistema (login tribunal-aware)", () => {
  it("pje_tjce → config do TJCE (login no portal certo)", () => {
    const c = configPorSistema("pje_tjce");
    expect(c).not.toBeNull();
    expect(c!.urlEntrada).toBe("https://pje.tjce.jus.br/");
  });

  it("Lote 1: cada sistema cofre PJe-TJ leva ao portal correto", () => {
    // Garante que cred "pje_tjmg" não cai no portal TJCE
    expect(configPorSistema("pje_tjmg")?.urlEntrada).toBe("https://pje.tjmg.jus.br/");
    expect(configPorSistema("pje_tjrj")?.urlEntrada).toBe("https://tjrj.pje.jus.br/1g/login.seam");
    expect(configPorSistema("pje_tjrn")?.urlEntrada).toBe("https://pje1g.tjrn.jus.br/pje/login.seam");
    expect(configPorSistema("pje_tjpe")?.urlEntrada).toBe("https://pje.cloud.tjpe.jus.br/1g/login.seam");
  });

  it("pje_tjdft (cofre) resolve via alias pra config do TJDF", () => {
    // No CNJ o código é tjdf (DF), mas no cofre é pje_tjdft (sigla
    // histórica DFT). Alias garante que login vai pro portal certo.
    const c = configPorSistema("pje_tjdft");
    expect(c).not.toBeNull();
    expect(c!.urlEntrada).toBe("https://pje.tjdft.jus.br/");
  });

  it("PJe-TJ ainda não habilitado → null (não cai no portal do TJCE)", () => {
    // TJES, TJPR, TJRS, TJGO ainda não estão no REGISTRO
    expect(configPorSistema("pje_tjes")).toBeNull();
    expect(configPorSistema("pje_tjpr")).toBeNull();
  });

  it("sistemas não-PJe-TJ → null (e-SAJ, e-Proc, TRT, wildcard)", () => {
    expect(configPorSistema("esaj_tjsp")).toBeNull();
    expect(configPorSistema("eproc_trf2")).toBeNull();
    expect(configPorSistema("pje_restrito_trt7")).toBeNull();
    expect(configPorSistema("pje_*")).toBeNull();
  });
});

describe("Consulta pública (TRF-5) — sem cofre", () => {
  it("TRF-5 está no set de consulta pública e conta como motor próprio", () => {
    expect(TRIBUNAIS_CONSULTA_PUBLICA.has("trf5")).toBe(true);
    expect(tribunalTemMotorProprio("trf5")).toBe(true);
  });

  it("TRF-5 NÃO requer credencial — bifurcação que pula cofre/sessão", () => {
    expect(tribunalRequerCredencial("trf5")).toBe(false);
    // TJ continua exigindo
    expect(tribunalRequerCredencial("tjce")).toBe(true);
    expect(tribunalRequerCredencial("tjmg")).toBe(true);
  });

  it("getConfigTribunal('trf5') é null — TRF-5 não usa config PDPJ-cloud", () => {
    // TRF-5 roda por adapter próprio (TRF5Scraper), não pela config PDPJ.
    // configPorSistema também é null porque consulta pública não tem
    // sistema cofre correspondente.
    expect(getConfigTribunal("trf5")).toBeNull();
    expect(configPorSistema("trf5")).toBeNull();
  });
});

describe("Justiça do Trabalho (PJe-JT) — 24 TRTs como candidatos", () => {
  const NUMEROS = Array.from({ length: 24 }, (_, i) => i + 1);

  it("pdpjTrtConfig deriva o padrão histórico do PJe-JT (grau no path)", () => {
    const g1 = pdpjTrtConfig(7);
    expect(g1.tribunal).toBe("trt7");
    expect(g1.grau).toBe(1);
    expect(g1.nome).toBe("Tribunal Regional do Trabalho da 7ª Região — PJe 1º grau");
    expect(g1.urlEntrada).toBe("https://pje.trt7.jus.br/primeirograu/login.seam");
    expect(g1.urlBusca).toBe(
      "https://pje.trt7.jus.br/primeirograu/Processo/ConsultaProcesso/listView.seam",
    );

    const g2 = pdpjTrtConfig(7, 2);
    expect(g2.grau).toBe(2);
    expect(g2.nome).toBe("Tribunal Regional do Trabalho da 7ª Região — PJe 2º grau");
    expect(g2.urlEntrada).toBe("https://pje.trt7.jus.br/segundograu/login.seam");
    expect(g2.urlBusca).toBe(
      "https://pje.trt7.jus.br/segundograu/Processo/ConsultaProcesso/listView.seam",
    );
  });

  it("override sobrepõe só o que foi passado", () => {
    const c = pdpjTrtConfig(2, 1, { urlEntrada: "https://x.trt2.jus.br/login" });
    expect(c.urlEntrada).toBe("https://x.trt2.jus.br/login");
    expect(c.urlBusca).toBe(
      "https://pje.trt2.jus.br/primeirograu/Processo/ConsultaProcesso/listView.seam",
    );
  });

  it("trt1..trt24 estão no REGISTRO com a URL derivada do próprio regional", () => {
    for (const n of NUMEROS) {
      const c = getConfigTribunal(`trt${n}`);
      expect(c, `trt${n} precisa estar no REGISTRO`).not.toBeNull();
      expect(c!.tribunal).toBe(`trt${n}`);
      expect(c!.grau).toBe(1);
      expect(c!.urlEntrada).toBe(`https://pje.trt${n}.jus.br/primeirograu/login.seam`);
      expect(tribunalTemMotorProprio(`trt${n}`)).toBe(true);
    }
    // 25 não é TRT.
    expect(getConfigTribunal("trt25")).toBeNull();
    expect(getConfigTribunal("trt0")).toBeNull();
  });

  it("trt1..trt24 têm o 2º grau mapeado em REGISTRO_G2 (segundograu no path)", () => {
    for (const n of NUMEROS) {
      expect(segundoGrauMapeado(`trt${n}`), `trt${n}`).toBe(true);
      const c = getConfigTribunal(`trt${n}`, 2);
      expect(c, `trt${n} 2º grau`).not.toBeNull();
      expect(c!.grau).toBe(2);
      expect(c!.urlEntrada).toBe(`https://pje.trt${n}.jus.br/segundograu/login.seam`);
      expect(c!.urlBusca).toBe(
        `https://pje.trt${n}.jus.br/segundograu/Processo/ConsultaProcesso/listView.seam`,
      );
      // Sem a linha em REGISTRO_G2 o fallback derivaria pje.trtN.jus.br/pje2grau
      // — host de TJ num tribunal do trabalho.
      expect(c!.urlEntrada).not.toContain("pje2grau");
      expect(c!.urlEntrada).not.toContain("primeirograu");
    }
  });

  it("os endereços de 1º e 2º grau nunca são o mesmo", () => {
    for (const n of NUMEROS) {
      expect(getConfigTribunal(`trt${n}`, 1)!.urlEntrada).not.toBe(
        getConfigTribunal(`trt${n}`, 2)!.urlEntrada,
      );
    }
  });

  it("configPorSistema aceita pje_trtN (regex tj|trf|trt)", () => {
    expect(configPorSistema("pje_trt7")?.urlEntrada).toBe(
      "https://pje.trt7.jus.br/primeirograu/login.seam",
    );
    expect(configPorSistema("pje_trt15")?.tribunal).toBe("trt15");
    expect(configPorSistema("pje_trt24")?.tribunal).toBe("trt24");
    // Os ids antigos continuam sem uso — não resolvem config.
    expect(configPorSistema("pje_restrito_trt7")).toBeNull();
    expect(configPorSistema("pje_restrito_*")).toBeNull();
  });

  it("sistemasQueAtendem(trtN) = [específico, nacional]; a nacional atende os TRTs", () => {
    expect(sistemasQueAtendem("trt7")).toEqual(["pje_trt7", SISTEMA_PJE_NACIONAL]);
    expect(sistemaAtendeTribunal(SISTEMA_PJE_NACIONAL, "trt7")).toBe(true);
    expect(sistemaAtendeTribunal("pje_trt7", "trt7")).toBe(true);
    expect(sistemaAtendeTribunal("pje_trt7", "trt2")).toBe(false);
  });

  it("tribunaisPjeDisponiveis lista os 24 TRTs depois dos TJs e TRFs", () => {
    const lista = tribunaisPjeDisponiveis();
    for (const n of NUMEROS) expect(lista).toContain(`trt${n}`);
    expect(lista.indexOf("trt1")).toBeGreaterThan(lista.indexOf("trf6"));
    expect(lista.filter((t) => t.startsWith("trt"))).toHaveLength(24);
  });

  it("contagemRegistro conta por segmento — é o número do rótulo da tela", () => {
    const c = contagemRegistro();
    expect(c.trts).toBe(24);
    expect(c.trfs).toBe(4);
    expect(c.tjs).toBe(12);
    expect(c.total).toBe(c.tjs + c.trfs + c.trts);
  });

  it("credencial: TRT exige credencial SALVO se estiver na consulta pública", () => {
    // Independe de quem popula a lista pública: a regra é conjunta.
    for (const n of NUMEROS) {
      const t = `trt${n}`;
      expect(tribunalRequerCredencial(t), t).toBe(!tribunalTemConsultaPublica(t));
    }
    // Quem está na lista pública hoje continua sem exigir credencial.
    for (const t of TRIBUNAIS_CONSULTA_PUBLICA) {
      expect(tribunalTemConsultaPublica(t)).toBe(true);
      expect(tribunalRequerCredencial(t)).toBe(false);
    }
    // Um TRT fora da lista pública exige — é o caminho com credencial.
    const foraDaPublica = NUMEROS.map((n) => `trt${n}`).filter(
      (t) => !tribunalTemConsultaPublica(t),
    );
    expect(foraDaPublica.length).toBeGreaterThan(0);
    for (const t of foraDaPublica) expect(tribunalRequerCredencial(t)).toBe(true);
    // Fora do registro nunca exige.
    expect(tribunalRequerCredencial("tjsp")).toBe(false);
    expect(tribunalTemConsultaPublica("tjsp")).toBe(false);
  });

  it("TRT que entra na consulta pública deixa de exigir credencial, sem sair do REGISTRO", () => {
    // Simula o que a lista pública fará com trt2/trt15: o tribunal fica nos
    // DOIS lugares. Sem o `&& !tribunalTemConsultaPublica` a credencial
    // continuaria sendo exigida e quem não tem senha não vigiaria nada.
    const cobaia = "trt24";
    expect(tribunalRequerCredencial(cobaia)).toBe(true);
    TRIBUNAIS_CONSULTA_PUBLICA.add(cobaia);
    try {
      expect(tribunalTemConsultaPublica(cobaia)).toBe(true);
      expect(tribunalRequerCredencial(cobaia)).toBe(false);
      expect(tribunalTemMotorProprio(cobaia)).toBe(true);
      // A config e o alcance da credencial nacional continuam lá.
      expect(getConfigTribunal(cobaia)).not.toBeNull();
      expect(sistemaAtendeTribunal(SISTEMA_PJE_NACIONAL, cobaia)).toBe(true);
    } finally {
      TRIBUNAIS_CONSULTA_PUBLICA.delete(cobaia);
    }
    expect(tribunalRequerCredencial(cobaia)).toBe(true);
  });

  it("os TRTs continuam no REGISTRO mesmo quando também são consulta pública", () => {
    // Quem tem credencial usa a config; quem não tem vigia pelo caminho
    // público. Tirar do REGISTRO tiraria o primeiro caminho.
    for (const t of TRIBUNAIS_CONSULTA_PUBLICA) {
      if (!t.startsWith("trt")) continue;
      expect(getConfigTribunal(t)).not.toBeNull();
      expect(sistemaAtendeTribunal(SISTEMA_PJE_NACIONAL, t)).toBe(true);
    }
  });
});
