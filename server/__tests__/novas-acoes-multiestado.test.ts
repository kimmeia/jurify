/**
 * Monitoramento por CPF/CNPJ em vários estados — aprovado no mockup de 20/08.
 *
 * O medo que motivou a feature: cliente processado fora do CE passava batido
 * (a varredura só olhava o TJCE). Os medos que a implementação precisa
 * afastar: (a) a falha de UM tribunal derrubar a varredura dos outros;
 * (b) estado adicionado depois alarmar todo o estoque antigo de lá;
 * (c) o seletor da tela oferecer estado que o robô não varre.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  CODIGOS_TRIBUNAIS_PJE,
  TRIBUNAIS_PJE,
  TRIBUNAL_SEDE,
  normalizarTribunais,
  siglaDoTribunal,
  tribunalDoCnj,
} from "../../shared/tribunais-pje";
import { lerTribunaisDoMonitor, lerTribunaisBaseline } from "../processos/monitor-tribunais";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("normalizarTribunais — o que a tela manda vira o que o robô varre", () => {
  it("a sede entra sempre, mesmo se a tela não mandar", () => {
    expect(normalizarTribunais([])).toEqual([TRIBUNAL_SEDE]);
    expect(normalizarTribunais(["tjpe"])).toEqual([TRIBUNAL_SEDE, "tjpe"]);
  });

  it("código desconhecido e duplicata caem fora", () => {
    expect(normalizarTribunais(["tjsp", "tjpe", "tjpe", 42, "drop table"])).toEqual([
      TRIBUNAL_SEDE,
      "tjpe",
    ]);
  });

  it("aceita qualquer coisa sem quebrar (input é do usuário)", () => {
    expect(normalizarTribunais(null)).toEqual([TRIBUNAL_SEDE]);
    expect(normalizarTribunais("tjpe")).toEqual([TRIBUNAL_SEDE]);
  });
});

describe("tribunalDoCnj — o CNJ carrega a origem no próprio número", () => {
  it("mapeia os segmentos dos 12 estados habilitados", () => {
    expect(tribunalDoCnj("0203344-18.2026.8.06.0001")).toBe("tjce");
    expect(tribunalDoCnj("0812345-90.2026.8.17.0001")).toBe("tjpe");
    expect(tribunalDoCnj("0709911-42.2026.8.07.0001")).toBe("tjdf");
    expect(tribunalDoCnj("0100200-33.2026.8.19.0001")).toBe("tjrj");
  });

  it("fora da justiça estadual (ou fora da grade) → null, nunca chute", () => {
    expect(tribunalDoCnj("0001234-55.2026.5.07.0001")).toBeNull(); // TRT
    expect(tribunalDoCnj("0001234-55.2026.8.26.0001")).toBeNull(); // TJSP (sem motor)
    expect(tribunalDoCnj(null)).toBeNull();
  });

  it("toda entrada da grade tem sigla legível", () => {
    for (const t of TRIBUNAIS_PJE) {
      expect(siglaDoTribunal(t.codigo)).toBe(t.sigla);
    }
  });
});

describe("lerTribunaisDoMonitor — legado NULL continua funcionando", () => {
  it("coluna nova vence; NULL/inválido cai pro tribunal original", () => {
    expect(lerTribunaisDoMonitor({ tribunal: "tjce", tribunais: '["tjce","tjpe"]' })).toEqual([
      "tjce",
      "tjpe",
    ]);
    expect(lerTribunaisDoMonitor({ tribunal: "tjce", tribunais: null })).toEqual(["tjce"]);
    expect(lerTribunaisDoMonitor({ tribunal: "tjce", tribunais: "não-json" })).toEqual(["tjce"]);
  });
});

describe("lerTribunaisBaseline — o legado NÃO pode virar baseline de novo", () => {
  it("monitor antigo que já varreu conta o tribunal original como baselineado", () => {
    // Sem isso, a 1ª varredura pós-migração trataria CNJ novo DE VERDADE
    // como baseline silencioso — alerta perdido.
    expect(
      lerTribunaisBaseline({ tribunal: "tjce", tribunaisBaseline: null, cnjsConhecidos: '["x"]' }),
    ).toEqual(["tjce"]);
  });

  it('monitor recém-criado ("[]") NÃO conta como baselineado', () => {
    // Monitor novo nasce com cnjsConhecidos = "[]". Tratar isso como "já
    // varreu" faria a 1ª varredura alarmar a carteira inteira do cliente —
    // a regressão de falso-positivo que o teste do cron guarda.
    expect(
      lerTribunaisBaseline({ tribunal: "tjce", tribunaisBaseline: null, cnjsConhecidos: "[]" }),
    ).toEqual([]);
    expect(
      lerTribunaisBaseline({ tribunal: "tjce", tribunaisBaseline: null, cnjsConhecidos: null }),
    ).toEqual([]);
  });

  it("a coluna nova vence o legado", () => {
    expect(
      lerTribunaisBaseline({
        tribunal: "tjce",
        tribunaisBaseline: '["tjce","tjpe"]',
        cnjsConhecidos: "[]",
      }),
    ).toEqual(["tjce", "tjpe"]);
  });
});

describe("a varredura no cron", () => {
  const cron = ler("server/processos/cron-monitoramento.ts");

  it("falha de um tribunal vira linha de resultado, não fim da varredura", () => {
    expect(cron).toContain("falhas.push({ tribunal");
    expect(cron).toContain("varreduraJson");
    expect(cron).toContain("resumoFalhas");
  });

  it("baseline é por tribunal", () => {
    expect(cron).toContain("primeiraDoTribunal");
    expect(cron).toContain("lerTribunaisBaseline(mon)");
  });

  it("o detail scrape roda no tribunal do CNJ, não no da sede", () => {
    expect(cron).toContain("consultarTjce(cnj, sessao, cfg)");
  });
});

describe("router e telas", () => {
  it("criar aceita a lista de estados e normaliza no servidor", () => {
    const router = ler("server/routers/processos.ts");
    expect(router).toContain("normalizarTribunais(input.tribunais)");
    expect(router).toContain("atualizarTribunaisNovasAcoes");
  });

  it("os dois pontos de criação usam o mesmo seletor de estados", () => {
    expect(ler("client/src/pages/Clientes.tsx")).toContain("<EstadosPicker");
    expect(ler("client/src/pages/Processos.tsx")).toContain("<EstadosPicker");
  });

  it("cada achado carrega o selo do tribunal de origem", () => {
    const processos = ler("client/src/pages/Processos.tsx");
    expect(processos).toContain("tribunalDoCnj(a.cnj)");
    expect(processos).toContain("CoberturaVarredura");
  });

  it("a migração é aditiva e o schema acompanha", () => {
    const mig = ler("drizzle/0198_monitoramento_cpf_multiestado.sql");
    expect(mig).toContain("ADD COLUMN tribunais TEXT DEFAULT NULL");
    expect(mig).not.toMatch(/DROP|MODIFY/i);
    const schema = ler("drizzle/schema.ts");
    expect(schema).toContain('tribunais: text("tribunais")');
    expect(schema).toContain('varreduraJson: text("varredura_json")');
  });

  it("a grade da tela e a lista do servidor são a MESMA lista", () => {
    // Divergirem = estado selecionável que o robô não varre. A regra é essa,
    // não o tamanho: a lista cresce (a Justiça Federal entrou em 01/09) e
    // travar a contagem só obrigava a mexer no teste sem conferir nada.
    const pdpj = ler("server/processos/tribunais-pdpj.ts");
    for (const codigo of CODIGOS_TRIBUNAIS_PJE) {
      const chave = codigo === "tjdf" ? "tjdf:" : `${codigo}:`;
      expect(pdpj, `${codigo} precisa existir no REGISTRO do motor`).toContain(chave);
    }
    // Encolher a cobertura é remoção, e remoção passa por decisão explícita.
    expect(CODIGOS_TRIBUNAIS_PJE.length).toBeGreaterThanOrEqual(16);
  });

  it("o que a tela oferece por CPF é o que o motor sabe varrer por CPF", () => {
    // TRF5 roda por consulta pública e TRF4 usa eproc — os dois têm motor
    // (ou terão), mas não pela via que a busca por CPF usa. Oferecer no
    // seletor viraria opção que devolve "sem adapter de CPF" toda varredura.
    expect(CODIGOS_TRIBUNAIS_PJE).not.toContain("trf5");
    expect(CODIGOS_TRIBUNAIS_PJE).not.toContain("trf4");
    for (const federal of ["trf1", "trf2", "trf3", "trf6"]) {
      expect(CODIGOS_TRIBUNAIS_PJE).toContain(federal);
    }
  });
});
