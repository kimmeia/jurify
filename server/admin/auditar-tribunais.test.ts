/**
 * Testes da heurística de detecção de tecnologia/versão dos tribunais.
 *
 * A heurística é frágil por natureza (depende de marcadores no HTML que os
 * tribunais podem mudar) — estes testes travam o comportamento esperado pra
 * que mudanças sejam intencionais. Não testam `auditarTribunal` (faz fetch
 * de rede real, não roda em CI).
 */
import { describe, it, expect } from "vitest";
import {
  detectarTecnologia,
  detectarVersaoPje,
  estimarReuso,
  ALVOS,
} from "./auditar-tribunais";

describe("detectarTecnologia", () => {
  it("identifica E-SAJ pela URL", () => {
    expect(detectarTecnologia("https://esaj.tjce.jus.br/", "", "")).toContain("E-SAJ");
  });

  it("identifica E-SAJ pelo título mesmo sem URL esaj", () => {
    expect(detectarTecnologia("https://x.jus.br/", "", "Portal e-SAJ")).toContain("E-SAJ");
  });

  it("identifica Eproc e Projudi", () => {
    expect(detectarTecnologia("https://eproc.trf4.jus.br/", "", "")).toBe("Eproc");
    expect(detectarTecnologia("https://projudi.tjgo.jus.br/", "", "")).toBe("Projudi");
  });

  it("identifica Keycloak SSO pelo host do PDPJ-cloud", () => {
    expect(detectarTecnologia("https://sso.cloud.pje.jus.br/", "", "")).toBe("Keycloak SSO");
  });

  it("cai pra PJe quando nenhum marcador específico aparece", () => {
    expect(detectarTecnologia("https://pje.tjce.jus.br/pje1grau/", "", "")).toBe("PJe");
  });
});

describe("detectarVersaoPje", () => {
  it("detecta PJe 1.x por .seam na URL (o que o adapter TJCE usa)", () => {
    const url = "https://pje.tjce.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam";
    expect(detectarVersaoPje("", url)).toContain("PJe 1.x");
  });

  it("detecta PJe 1.x por RichFaces/a4j no HTML", () => {
    expect(detectarVersaoPje('<script src="/a4j.framework.js">', "")).toContain("PJe 1.x");
  });

  it("detecta PJe 2.x por PrimeFaces", () => {
    expect(detectarVersaoPje("<script>PrimeFaces.cw(...)</script>", "")).toContain("PJe 2.x");
  });

  it("detecta PJe 4.x por SPA (app-root / webpack)", () => {
    expect(detectarVersaoPje("<app-root></app-root>", "")).toContain("PJe 4.x");
    expect(detectarVersaoPje("window.webpackChunk = []", "")).toContain("PJe 4.x");
  });

  it("marca JSF genérico só quando não há sinal mais específico", () => {
    expect(detectarVersaoPje("javax.faces.ViewState", "")).toContain("JSF");
    // com PrimeFaces presente, prefere o sinal forte e não cai no genérico
    expect(detectarVersaoPje("javax.faces + PrimeFaces", "")).toBe("PrimeFaces → PJe 2.x");
  });

  it("retorna Indeterminada sem nenhum marcador", () => {
    expect(detectarVersaoPje("<html><body>oi</body></html>", "")).toBe("Indeterminada");
  });
});

describe("estimarReuso", () => {
  it("BAIXO pra PJe 1.x (mesma stack do adapter TJCE)", () => {
    expect(estimarReuso("RichFaces/Seam → PJe 1.x", "PJe")).toBe("BAIXO");
  });

  it("MÉDIO pra PJe 2.x", () => {
    expect(estimarReuso("PrimeFaces → PJe 2.x", "PJe")).toBe("MÉDIO");
  });

  it("ALTO pra PJe 4.x ou tecnologia não-PJe", () => {
    expect(estimarReuso("Angular SPA → PJe 4.x", "PJe")).toBe("ALTO");
    expect(estimarReuso("Indeterminada", "E-SAJ (ASP.NET)")).toBe("ALTO");
  });

  it("INDETERMINADO quando é PJe mas versão desconhecida", () => {
    expect(estimarReuso("Indeterminada", "PJe")).toBe("INDETERMINADO");
  });
});

describe("ALVOS", () => {
  it("tem ids únicos", () => {
    const ids = ALVOS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("inclui o baseline TJCE e o SSO central", () => {
    const ids = ALVOS.map((a) => a.id);
    expect(ids).toContain("tjce-entrada");
    expect(ids).toContain("pdpj-sso");
  });

  it("todas as URLs são https", () => {
    for (const a of ALVOS) expect(a.url.startsWith("https://")).toBe(true);
  });
});
