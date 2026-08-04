import { describe, it, expect } from "vitest";
import {
  classificarErroMonitor,
  agruparDiagnostico,
  tituloComTotal,
} from "./diagnostico-monitoramento";

describe("classificarErroMonitor", () => {
  it("sem erro devolve null", () => {
    expect(classificarErroMonitor(null)).toBeNull();
    expect(classificarErroMonitor("")).toBeNull();
    expect(classificarErroMonitor("   ")).toBeNull();
  });

  // As strings abaixo são as que o cron e os adapters gravam de fato.
  it("reconhece sessão expirada nas formas que o cron grava", () => {
    for (const msg of [
      "Sessão expirada — revalide a credencial",
      "Sessão expirada — PDPJ-cloud redirecionou pra login do Keycloak",
      "Sessão caiu durante consulta: timeout",
      "Credencial expirada no Cofre",
    ]) {
      expect(classificarErroMonitor(msg)?.causa).toBe("sessao_expirada");
    }
  });

  it("não confunde 'credencial não vinculada' com sessão expirada", () => {
    expect(classificarErroMonitor("Credencial não vinculada")?.causa).toBe("sem_credencial");
  });

  it("reconhece tribunal sem adapter", () => {
    expect(classificarErroMonitor("Tribunal TJSP sem adapter")?.causa).toBe("tribunal_sem_suporte");
    expect(
      classificarErroMonitor("Adapter de consulta pública não encontrado para TJBA")?.causa,
    ).toBe("tribunal_sem_suporte");
  });

  it("reconhece processo não localizado", () => {
    expect(classificarErroMonitor("PJe TJCE respondeu mas não localizou o processo")?.causa).toBe(
      "processo_nao_encontrado",
    );
  });

  it("reconhece documento inválido", () => {
    expect(
      classificarErroMonitor("Documento inválido: esperava 11 dígitos (CPF) ou 14 (CNPJ), recebi 9")
        ?.causa,
    ).toBe("documento_invalido");
  });

  it("erro desconhecido não some — cai num grupo próprio", () => {
    const c = classificarErroMonitor("ERR_CONNECTION_RESET no puppeteer");
    expect(c?.causa).toBe("desconhecida");
    expect(c?.severidade).toBe("aviso");
  });

  it("só sessão expirada e falta de credencial são alerta vermelho", () => {
    // O resto é aviso: são casos que o escritório resolve sem pressa, e
    // pintar tudo de vermelho devolveria o problema que a tela veio corrigir.
    expect(classificarErroMonitor("Sessão expirada")?.severidade).toBe("alerta");
    expect(classificarErroMonitor("Credencial não vinculada")?.severidade).toBe("alerta");
    expect(classificarErroMonitor("Tribunal TJSP sem adapter")?.severidade).toBe("aviso");
    expect(classificarErroMonitor("não localizou o processo")?.severidade).toBe("aviso");
  });

  it("a causa vem com texto de linha e de bloco", () => {
    const c = classificarErroMonitor("Sessão expirada — revalide a credencial")!;
    expect(c.motivo).toMatch(/Credencial do Cofre expirada/);
    expect(c.titulo).toContain("{n}");
    expect(c.acao).toBe("Revalidar no Cofre");
    expect(c.destino).toBe("cofre");
  });
});

describe("agruparDiagnostico", () => {
  it("agrupa por causa e ordena do maior pro menor", () => {
    const r = agruparDiagnostico([
      "Sessão expirada — revalide a credencial",
      "Sessão expirada — revalide a credencial",
      "Sessão expirada — revalide a credencial",
      "PJe TJCE respondeu mas não localizou o processo",
      "Credencial não vinculada",
      "Credencial não vinculada",
    ]);
    expect(r.total).toBe(6);
    expect(r.grupos.map((g) => [g.causa, g.total])).toEqual([
      ["sessao_expirada", 3],
      ["sem_credencial", 2],
      ["processo_nao_encontrado", 1],
    ]);
  });

  it("ignora os que estão saudáveis", () => {
    const r = agruparDiagnostico([null, "", "Sessão expirada", undefined]);
    expect(r.total).toBe(1);
    expect(r.grupos).toHaveLength(1);
  });

  it("nada quebrado devolve vazio", () => {
    expect(agruparDiagnostico([null, null])).toEqual({ grupos: [], total: 0 });
  });

  it("o título recebe a contagem do grupo", () => {
    const r = agruparDiagnostico(["Sessão expirada", "Sessão expirada"]);
    expect(tituloComTotal(r.grupos[0])).toBe("2 processos pararam de atualizar");
  });
});
