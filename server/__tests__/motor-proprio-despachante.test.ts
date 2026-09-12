/**
 * Motor próprio, fundação: o runner da aba Consultar e o cron passam pelo
 * despachante; TRT2/TRT15 entram por consulta pública; o texto dos planos
 * acompanha (migration 0227).
 *
 * O que estas amarras travam:
 *  - o runner não sabe mais de "tjce": qualquer tribunal vai pro despachante
 *    com o código do CNJ, e consulta pública vai com sessão null;
 *  - o cron não tem mais o ramo literal do TRF5;
 *  - a lista compartilhada diz TRT2 e TRT15, e os textos derivam disso;
 *  - a migration 0227 reescreve o bullet certo, idempotente, com WHERE igual
 *    ao texto que a 0223 gravou.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const consultarProcesso = vi.fn();
const consultarPorDocumento = vi.fn();
vi.mock("../processos/adapters", () => ({ consultarProcesso, consultarPorDocumento }));

const marcarCredencialExpirada = vi.fn();
vi.mock("../escritorio/cofre-helpers", () => ({ marcarCredencialExpirada }));

const runner = await import("../processos/motor-proprio-runner");
const { parseCnjTribunal } = await import("../processos/cnj-parser");
const shared = await import("../../shared/tribunais-pje");

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const CNJ_TRT2 = "0001234-12.2024.5.02.0001";
const CNJ_TRT15 = "0001234-12.2024.5.15.0001";
const CNJ_TRF5 = "0001234-12.2024.4.05.0001";
const CNJ_TJMG = "0001234-12.2024.8.13.0001";
const CNJ_TJSP = "0001234-12.2024.8.26.0001";

function resultadoOk(tribunal: string, cnj: string) {
  return {
    ok: true,
    tribunal,
    cnj,
    latenciaMs: 10,
    capa: {
      cnj,
      classe: "Reclamação Trabalhista",
      assuntos: [],
      orgaoJulgador: null,
      juiz: null,
      comarca: null,
      uf: "SP",
      valorCausaCentavos: null,
      dataDistribuicao: null,
      status: null,
      partes: [],
      segredoJustica: false,
    },
    movimentacoes: [],
    categoriaErro: null,
    mensagemErro: null,
    screenshotPath: null,
    finalizadoEm: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runner: o tribunal do CNJ vai pro despachante, sem 'if tjce'", () => {
  it("consulta pública: sessão null chega ao despachante com o código do tribunal", async () => {
    consultarProcesso.mockResolvedValueOnce(resultadoOk("trt2", CNJ_TRT2));
    const { requestId, status } = runner.iniciarConsultaMotorProprio(CNJ_TRT2, null);
    expect(status).toBe("running");
    expect(requestId.startsWith("motor:trt2:")).toBe(true);
    await vi.waitFor(() => expect(runner.obterStatusMotorProprio(requestId)?.status).toBe("completed"));
    expect(consultarProcesso).toHaveBeenCalledWith("trt2", CNJ_TRT2, null);
    const r = runner.obterResultadoMotorProprio(requestId)!;
    expect(r.page_data[0].response_type).toBe("lawsuit");
    expect((r.page_data[0].response_data as { tribunal_acronym: string }).tribunal_acronym).toBe("TRT2");
  });

  it.each([
    ["trt15", CNJ_TRT15],
    ["trf5", CNJ_TRF5],
  ])("%s também é aceito pelo runner (temMotorProprio vem da lista compartilhada)", async (codigo, cnj) => {
    consultarProcesso.mockResolvedValueOnce(resultadoOk(codigo, cnj));
    const { requestId } = runner.iniciarConsultaMotorProprio(cnj, null);
    expect(requestId.startsWith(`motor:${codigo}:`)).toBe(true);
    await vi.waitFor(() => expect(consultarProcesso).toHaveBeenCalledWith(codigo, cnj, null));
  });

  it("tribunal do registro: a sessão e o código DELE (tjmg, não tjce) chegam ao despachante", async () => {
    consultarProcesso.mockResolvedValueOnce(resultadoOk("tjmg", CNJ_TJMG));
    const { requestId } = runner.iniciarConsultaMotorProprio(CNJ_TJMG, "sessao-mg", 7);
    expect(requestId.startsWith("motor:tjmg:")).toBe(true);
    await vi.waitFor(() => expect(runner.obterStatusMotorProprio(requestId)?.status).toBe("completed"));
    expect(consultarProcesso).toHaveBeenCalledWith("tjmg", CNJ_TJMG, "sessao-mg");
    expect(marcarCredencialExpirada).not.toHaveBeenCalled();
  });

  it("fora da cobertura recusa antes de qualquer adapter", () => {
    expect(() => runner.iniciarConsultaMotorProprio(CNJ_TJSP, "s")).toThrow(/Motor próprio não disponível pra TJSP/);
    expect(consultarProcesso).not.toHaveBeenCalled();
  });

  it("adapter que explode vira status error com a mensagem, sem derrubar o processo", async () => {
    consultarProcesso.mockRejectedValueOnce(new Error("portal fora do ar"));
    const { requestId } = runner.iniciarConsultaMotorProprio(CNJ_TRT2, null);
    await vi.waitFor(() => expect(runner.obterStatusMotorProprio(requestId)?.status).toBe("error"));
    const r = runner.obterResultadoMotorProprio(requestId)!;
    expect(r.page_data[0].response_type).toBe("application_error");
    expect((r.page_data[0].response_data as { message: string }).message).toBe("portal fora do ar");
  });

  it("busca por documento: o tribunal informado vai pro despachante (nunca cravado em tjce)", async () => {
    consultarPorDocumento.mockResolvedValueOnce({ ok: true, cnjs: [CNJ_TJMG], linhas: [] });
    const { requestId } = runner.iniciarConsultaDocumentoMotorProprio("cpf", "12345678901", "sessao-mg", "tjmg", 7);
    expect(requestId.startsWith("motor:tjmg:doc:")).toBe(true);
    await vi.waitFor(() => expect(runner.obterStatusMotorProprio(requestId)?.status).toBe("completed"));
    expect(consultarPorDocumento).toHaveBeenCalledWith("tjmg", "cpf", "12345678901", "sessao-mg");
    const r = runner.obterResultadoMotorProprio(requestId)!;
    expect(r.all_count).toBe(1);
    expect((r.page_data[0].response_data as { tribunal_acronym: string }).tribunal_acronym).toBe("TJMG");
  });

  it("o código-fonte do runner não decide mais por tribunal literal", () => {
    const src = ler("server/processos/motor-proprio-runner.ts");
    expect(src).not.toContain('=== "tjce"');
    expect(src).not.toContain("não implementado");
    expect(src).toContain('from "./adapters"');
    expect(src).toContain("consultarProcesso(codigoTribunal, cnj, storageStateJson)");
    expect(src).toContain("consultarPorDocumento(codigoTribunal, tipo, valor, storageStateJson)");
    expect(src).toContain("storageStateJson: string | null");
  });
});

describe("cron: o ramo literal do TRF5 virou despachante", () => {
  const cron = ler("server/processos/cron-monitoramento.ts");

  it("não há mais 'mon.tribunal === \"trf5\"' nem import direto do adapter do TRF5", () => {
    expect(cron).not.toContain('mon.tribunal === "trf5"');
    expect(cron).not.toContain('import("./adapters/pje-trf5")');
  });

  it("consulta pública passa por temAdapterPublico + consultarProcesso com sessão null e teorMaximo", () => {
    expect(cron).toContain('import { consultarProcesso, temAdapterPublico } from "./adapters"');
    const i = cron.indexOf("if (!requerCred) {");
    const bloco = cron.slice(i, cron.indexOf("// ── Caminho PDPJ-cloud", i));
    expect(bloco).toContain("if (temAdapterPublico(mon.tribunal)) {");
    expect(bloco).toContain("resultado = await consultarProcesso(mon.tribunal, mon.searchKey, null, { teorMaximo });");
    // A mensagem que o diagnóstico classifica continua a mesma.
    expect(bloco).toContain("erro: `Adapter de consulta pública não encontrado para ${mon.tribunal}`");
  });
});

describe("router: consulta pública sem credencial, e o tribunal da busca por CPF vem do pedido", () => {
  const router = ler("server/routers/processos.ts");

  it("consultarCNJ libera tribunal de consulta pública ANTES do cofre — e cobra a consulta", () => {
    const i = router.indexOf("if (!tribunalRequerCredencial(tribunal.codigoTribunal)) {");
    expect(i).toBeGreaterThan(-1);
    const bloco = router.slice(i, i + 700);
    expect(bloco).toContain('await contarUso(esc.escritorio.id, "consulta_processo");');
    expect(bloco).toContain("iniciarConsultaMotorProprio(input.cnj, null)");
    // O cofre só é consultado depois, no caminho com credencial.
    expect(i).toBeLessThan(router.indexOf("const sistemaCofre = sistemaCofrePorTribunal(tribunal.codigoTribunal);"));
  });

  it("consultarDocumento e criarMonitoramentoNovasAcoes não cravam mais 'tjce'", () => {
    expect(router).not.toContain('? "tjce"');
    expect(router).not.toContain("ainda só funciona pra TJCE");
    expect(router.split("codigoTribunal: z.string().max(16).optional()").length - 1).toBeGreaterThanOrEqual(2);
    expect(router).toContain("const codigoTribunal = input.codigoTribunal ?? TRIBUNAL_SEDE;");
    expect(router).toContain("const tribunalDaCred = input.codigoTribunal ?? TRIBUNAL_SEDE;");
    expect(router).toContain("function sistemasParaDocumento(codigoTribunal: string): string[]");
    expect(router.split("sistemas: sistemasParaDocumento(").length - 1).toBe(2);
  });
});

describe("cobertura compartilhada: TRT2 e TRT15 por consulta pública", () => {
  it("a lista tem os dois, e o parser do CNJ (client e servidor) os reconhece como cobertos", () => {
    const codigos = shared.TRIBUNAIS_CONSULTA_PUBLICA_PJE.map((t) => t.codigo);
    expect(codigos).toEqual(expect.arrayContaining(["trf5", "trt2", "trt15"]));
    expect(shared.parseCnjTribunalPuro(CNJ_TRT2)).toEqual({ codigo: "trt2", sigla: "TRT2", coberto: true });
    expect(shared.parseCnjTribunalPuro(CNJ_TRT15)).toEqual({ codigo: "trt15", sigla: "TRT15", coberto: true });
    expect(parseCnjTribunal(CNJ_TRT2)?.temMotorProprio).toBe(true);
    expect(parseCnjTribunal(CNJ_TRT15)?.temMotorProprio).toBe(true);
    // TRT-7 continua fora: adapter não existe.
    expect(parseCnjTribunal("0001234-12.2024.5.07.0001")?.temMotorProprio).toBe(false);
    expect(shared.parseCnjTribunalPuro("0001234-12.2024.5.07.0001")?.coberto).toBe(false);
  });

  it("os TRTs continuam FORA do seletor por CPF (é consulta pública, sem credencial)", () => {
    expect(shared.CODIGOS_TRIBUNAIS_PJE).not.toContain("trt2");
    expect(shared.CODIGOS_TRIBUNAIS_PJE).not.toContain("trt15");
    expect(shared.totalTribunaisVigiaveis()).toBe(shared.TRIBUNAIS_PJE.length + shared.TRIBUNAIS_CONSULTA_PUBLICA_PJE.length);
  });

  it("os textos derivam da lista: Justiça do Trabalho deixa de ser 'ainda não'", () => {
    expect(shared.textoJusticaDoTrabalho()).toBe("Justiça do Trabalho: TRT2 e TRT15 por consulta pública");
    expect(shared.bulletVigiaPlano("300", "15")).toBe(
      "Vigia 300 processos nos tribunais cobertos (12 TJs e 4 TRFs, mais TRF5, TRT2 e TRT15 por consulta pública — " +
        "TJSP ainda não; Justiça do Trabalho: TRT2 e TRT15 por consulta pública) · 15 CPFs/CNPJs (novas ações: comprovado no TJCE)",
    );
    expect(shared.bulletVigiaPlano("300", "15")).not.toContain("TRTs ainda não");
    expect(shared.textoCoberturaPricing()).not.toContain("Justiça do Trabalho e os demais ainda não");
    expect(shared.textoConsultaNaHora()).toBe("nos tribunais cobertos com a sua credencial (TRF5, TRT2 e TRT15 sem credencial)");
    expect(shared.mensagemTribunalSemMotor("TRT7")).toContain("TRF5, TRT2 e TRT15");
  });

  it("a aba Consultar e o guia dizem que a consulta na hora vale nos cobertos; a busca por CPF segue na sede", () => {
    const tela = ler("client/src/pages/Processos.tsx");
    expect(tela).toContain("Número do processo direto {textoConsultaNaHora()}, ou busca por CPF/CNPJ — hoje no {siglaConsultaNaHora()}.");
    expect(tela).toContain("Consulta na hora {textoConsultaNaHora()}. Para vigiar, {totalTribunaisVigiaveis()} tribunais.");
    expect(shared.textoCoberturaGuia()).toContain("consulta na hora nos tribunais cobertos com a sua credencial");
    expect(shared.textoCoberturaGuia()).toContain("novas ações por CPF/CNPJ: comprovado no TJCE.");
  });
});

describe("migration 0227: bullet certo de cada plano, idempotente, WHERE = texto da 0223", () => {
  const mig = ler("drizzle/0227_tribunais_bullet_planos_trt.sql");
  const mig0223 = ler("drizzle/0223_tribunais_texto_planos.sql");
  const seed = ler("drizzle/0217_pacote_3_planos.sql");

  function indiceDoBulletVigia(slug: string): number {
    const ini = seed.indexOf(`'${slug}', `);
    const fim = seed.indexOf("\n)", ini);
    const features = seed.slice(ini, fim).slice(seed.slice(ini, fim).lastIndexOf("JSON_ARRAY("));
    const bullets = [...features.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    return bullets.findIndex((b) => b.startsWith("Vigia "));
  }

  /** O texto que a 0223 GRAVOU num plano (o SET dela) — é o WHERE da 0227. */
  function textoGravadoPela0223(slug: string, indice: number): string {
    const fim = mig0223.indexOf(`WHERE slug = '${slug}'`);
    const trecho = mig0223.slice(0, fim);
    const ini = trecho.lastIndexOf(`JSON_REPLACE(features, '$[${indice}]',`);
    const m = trecho.slice(ini).match(/'\$\[\d+\]',\s*'([^']*)'/);
    if (!m) throw new Error(`0223 sem SET pro ${slug}`);
    return m[1];
  }

  const planos: Array<[string, string, string]> = [
    ["atende", "300", "15"],
    ["escritorio", "1.000", "50"],
    ["escala", "2.500", "150"],
  ];

  for (const [slug, processos, cpfs] of planos) {
    it(`${slug}: mesmo índice da seed, WHERE = SET da 0223, texto novo = bulletVigiaPlano`, () => {
      const i = indiceDoBulletVigia(slug);
      expect(i).toBeGreaterThan(-1);
      const antigo = textoGravadoPela0223(slug, i);
      const novo = shared.bulletVigiaPlano(processos, cpfs);
      expect(novo).not.toBe(antigo);
      const w = mig.indexOf(`WHERE slug = '${slug}'`);
      const trecho = mig.slice(w - 500, w + 400);
      expect(trecho).toContain(`JSON_REPLACE(features, '$[${i}]',`);
      expect(trecho).toContain(`'${novo}'`);
      expect(trecho).toContain(`AND JSON_UNQUOTE(JSON_EXTRACT(features, '$[${i}]')) = '${antigo}'`);
    });
  }

  it("não reescreve o array inteiro e mexe só nos 3 planos", () => {
    expect(mig).not.toContain("features = JSON_ARRAY(");
    expect(mig.split("JSON_REPLACE(").length - 1).toBe(3);
    expect(mig.split("UPDATE planos").length - 1).toBe(3);
  });
});
