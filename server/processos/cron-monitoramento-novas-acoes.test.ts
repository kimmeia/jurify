/**
 * Regressão do baseline silencioso em pollMonitoramentosNovasAcoes.
 *
 * Bug original (até 12/05/2026): o ramo "Primeira execução: armazena
 * baseline" dentro de cron-monitoramento.ts ficava no else de
 * cnjsNovos.length>0. Como o monitoramento é criado com
 * cnjsConhecidos="[]", cnjsNovos == resultado.cnjs sempre que havia
 * processos pré-existentes, então o ramo de baseline era inalcançável.
 * Resultado: TODOS os processos antigos do CPF/CNPJ apareciam como
 * "novas ações" — falso-positivo confirmado em produção.
 *
 * Estes testes cobrem o fix análogo a pollMonitoramentosMovs:451,
 * com flag isPrimeiraExecucao explícita.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks dos adapters ──────────────────────────────────────────────────────
const consultarTjcePorCpf = vi.fn();
const consultarTjce = vi.fn();
vi.mock("./adapters/pje-tjce", () => ({
  consultarTjce,
  consultarTjcePorCpf,
}));

const recuperarSessao = vi.fn();
vi.mock("../escritorio/cofre-helpers", () => ({
  recuperarSessao,
}));

const emitirNotificacao = vi.fn();
vi.mock("../_core/sse-notifications", () => ({
  emitirNotificacao,
}));

// CUSTOS é importado pelo cron mas só usado em cobrarMonitoramentosMensais
vi.mock("../routers/processos", () => ({
  CUSTOS: {
    monitorar_pessoa_mes: 15,
    monitorar_processo_mes: 2,
    consulta_cnj: 1,
  },
}));

// ─── Mock do getDb ───────────────────────────────────────────────────────────
let selectQueue: unknown[][] = [];
const captured: Array<{
  op: "select" | "insert" | "update";
  table: string;
  values?: unknown;
  set?: Record<string, unknown>;
}> = [];

function tableName(t: unknown): string {
  const anyT = t as any;
  return anyT?._?.name || anyT?.[Symbol.for("drizzle:Name")] || "unknown";
}

function makeSelectBuilder(table: unknown) {
  captured.push({ op: "select", table: tableName(table) });
  const next = () => Promise.resolve(selectQueue.shift() ?? []);
  const builder: any = {
    from: (_t: unknown) => builder,
    innerJoin: (..._a: unknown[]) => builder,
    leftJoin: (..._a: unknown[]) => builder,
    where: (_w: unknown) => builder,
    orderBy: (..._a: unknown[]) => builder,
    limit: (_n: number) => next(),
    then: (resolve: (v: unknown) => unknown) =>
      resolve(selectQueue.shift() ?? []),
  };
  return builder;
}

const mockDb = {
  select: () => ({ from: (t: unknown) => makeSelectBuilder(t) }),
  insert: (table: unknown) => ({
    values(values: unknown) {
      captured.push({ op: "insert", table: tableName(table), values });
      return Promise.resolve([{ insertId: 1, affectedRows: 1 }]);
    },
  }),
  update: (table: unknown) => ({
    set(set: Record<string, unknown>) {
      return {
        where(_w: unknown) {
          captured.push({ op: "update", table: tableName(table), set });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      };
    },
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

const { pollMonitoramentosNovasAcoes } = await import("./cron-monitoramento");

const MON_BASE = {
  id: 42,
  escritorioId: 100,
  criadoPor: 7,
  tipoMonitoramento: "novas_acoes" as const,
  searchType: "cpf" as const,
  searchKey: "12345678901",
  apelido: "João Silva",
  tribunal: "tjce",
  credencialId: 999,
  status: "ativo" as const,
  recurrenceHoras: 6,
  ultimaConsultaEm: null,
  hashUltimasMovs: null,
  cnjsConhecidos: "[]",
  totalNovasAcoes: 0,
  ultimoErro: null,
};

beforeEach(() => {
  selectQueue = [];
  captured.length = 0;
  consultarTjcePorCpf.mockReset();
  consultarTjce.mockReset();
  recuperarSessao.mockReset();
  emitirNotificacao.mockReset();
});

describe("pollMonitoramentosNovasAcoes — baseline silencioso (regressão FP)", () => {
  it("primeira execução: registra baseline com lido=true e NÃO dispara notificação", async () => {
    // Sessão recuperada
    recuperarSessao.mockResolvedValue("storage-state-json");
    // 3 CNJs reais retornados pelo scraper
    consultarTjcePorCpf.mockResolvedValue({
      ok: true,
      cnjs: [
        "0000001-23.2025.8.06.0001",
        "0000002-45.2025.8.06.0001",
        "0000003-67.2025.8.06.0001",
      ],
    });
    // Pendentes: 1 monitoramento com cnjsConhecidos="[]"
    selectQueue.push([MON_BASE]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter(
      (c) => c.op === "insert" && c.table === "eventos_processo",
    );
    expect(eventos).toHaveLength(3);
    for (const ev of eventos) {
      expect((ev.values as { lido: boolean }).lido).toBe(true);
      expect((ev.values as { tipo: string }).tipo).toBe("nova_acao");
      expect((ev.values as { conteudo: string }).conteudo).toMatch(/^Baseline:/);
      const json = JSON.parse((ev.values as { conteudoJson: string }).conteudoJson);
      expect(json.baseline).toBe(true);
    }

    // NÃO criou notificação no sino
    const notifs = captured.filter(
      (c) => c.op === "insert" && c.table === "notificacoes",
    );
    expect(notifs).toHaveLength(0);

    // NÃO disparou SSE
    expect(emitirNotificacao).not.toHaveBeenCalled();

    // Atualizou cnjsConhecidos com todos os 3 CNJs
    const upd = captured.find(
      (c) => c.op === "update" && c.table === "motor_monitoramentos",
    );
    expect(upd).toBeDefined();
    expect(JSON.parse(upd!.set!.cnjsConhecidos as string)).toEqual([
      "0000001-23.2025.8.06.0001",
      "0000002-45.2025.8.06.0001",
      "0000003-67.2025.8.06.0001",
    ]);
    // Não bumpou totalNovasAcoes
    expect(upd!.set!.totalNovasAcoes).toBeUndefined();
  });

  it("execução subsequente: notifica APENAS CNJs novos vs cnjsConhecidos", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({
      ok: true,
      cnjs: [
        "0000001-23.2025.8.06.0001",
        "0000002-45.2025.8.06.0001",
        "0000003-67.2025.8.06.0001", // único realmente novo
      ],
    });
    selectQueue.push([
      {
        ...MON_BASE,
        cnjsConhecidos: JSON.stringify([
          "0000001-23.2025.8.06.0001",
          "0000002-45.2025.8.06.0001",
        ]),
      },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter(
      (c) => c.op === "insert" && c.table === "eventos_processo",
    );
    expect(eventos).toHaveLength(1);
    expect((eventos[0].values as { lido: boolean }).lido).toBe(false);
    expect((eventos[0].values as { cnjAfetado: string }).cnjAfetado).toBe(
      "0000003-67.2025.8.06.0001",
    );

    // Criou 1 notificação
    const notifs = captured.filter(
      (c) => c.op === "insert" && c.table === "notificacoes",
    );
    expect(notifs).toHaveLength(1);
    expect((notifs[0].values as { tipo: string }).tipo).toBe("nova_acao");

    // Disparou SSE exatamente 1×
    expect(emitirNotificacao).toHaveBeenCalledOnce();
    expect(emitirNotificacao).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ tipo: "nova_acao" }),
    );
  });

  it("execução subsequente sem novidade: só atualiza ultimaConsultaEm", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({
      ok: true,
      cnjs: [
        "0000001-23.2025.8.06.0001",
        "0000002-45.2025.8.06.0001",
      ],
    });
    selectQueue.push([
      {
        ...MON_BASE,
        cnjsConhecidos: JSON.stringify([
          "0000001-23.2025.8.06.0001",
          "0000002-45.2025.8.06.0001",
        ]),
      },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter(
      (c) => c.op === "insert" && c.table === "eventos_processo",
    );
    expect(eventos).toHaveLength(0);
    const notifs = captured.filter(
      (c) => c.op === "insert" && c.table === "notificacoes",
    );
    expect(notifs).toHaveLength(0);
    expect(emitirNotificacao).not.toHaveBeenCalled();

    const upd = captured.find(
      (c) => c.op === "update" && c.table === "motor_monitoramentos",
    );
    expect(upd).toBeDefined();
    expect(upd!.set!.ultimaConsultaEm).toBeInstanceOf(Date);
    expect(upd!.set!.cnjsConhecidos).toBeUndefined();
  });

  it("primeira execução com scraper retornando 0 CNJs: atualiza cnjsConhecidos=[] silenciosamente", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: [] });
    selectQueue.push([MON_BASE]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter(
      (c) => c.op === "insert" && c.table === "eventos_processo",
    );
    expect(eventos).toHaveLength(0);
    const notifs = captured.filter(
      (c) => c.op === "insert" && c.table === "notificacoes",
    );
    expect(notifs).toHaveLength(0);
    expect(emitirNotificacao).not.toHaveBeenCalled();

    const upd = captured.find(
      (c) => c.op === "update" && c.table === "motor_monitoramentos",
    );
    expect(upd).toBeDefined();
    expect(JSON.parse(upd!.set!.cnjsConhecidos as string)).toEqual([]);
  });
});

describe("pollMonitoramentosNovasAcoes — filtro de polo passivo", () => {
  const CPF = MON_BASE.searchKey; // "12345678901"
  const APELIDO = MON_BASE.apelido; // "João Silva"
  const CNJ_NOVO = "0009999-99.2026.8.06.0001";

  function detalheMock(args: {
    partes?: Array<{ nome: string; polo: "ativo" | "passivo" | "terceiro"; documento?: string | null }>;
    dataDistribuicao?: string | null;
    ok?: boolean;
  } = {}) {
    return {
      ok: args.ok ?? true,
      tribunal: "tjce",
      cnj: CNJ_NOVO,
      latenciaMs: 100,
      capa: args.ok === false ? null : {
        cnj: CNJ_NOVO,
        classe: null,
        assuntos: [],
        orgaoJulgador: null,
        juiz: null,
        comarca: null,
        uf: "CE",
        valorCausaCentavos: null,
        dataDistribuicao: args.dataDistribuicao ?? null,
        status: null,
        partes: (args.partes ?? []).map((p) => ({
          nome: p.nome,
          polo: p.polo,
          tipo: "fisica" as const,
          documento: p.documento ?? null,
          advogados: [],
        })),
        segredoJustica: false,
      },
      movimentacoes: [],
      categoriaErro: null,
      mensagemErro: null,
      screenshotPath: null,
      finalizadoEm: new Date().toISOString(),
    };
  }

  it("silencia (lido=true, sem notif) quando cliente é POLO ATIVO no CNJ novo", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_NOVO] });
    consultarTjce.mockResolvedValue(
      detalheMock({
        partes: [
          { polo: "ativo", nome: APELIDO, documento: CPF }, // cliente é autor
          { polo: "passivo", nome: "EMPRESA RÉ LTDA", documento: "99999999000100" },
        ],
      }),
    );
    selectQueue.push([{ ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]) }]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect(eventos).toHaveLength(1);
    expect((eventos[0].values as any).lido).toBe(true);
    expect((eventos[0].values as any).conteudo).toMatch(/Cliente é autor/);
    const json = JSON.parse((eventos[0].values as any).conteudoJson);
    expect(json.poloDoCliente).toBe("ativo");
    expect(json.motivoSilencio).toBe("polo_ativo");
    expect(json.filtradoPorPolo).toBe(true);

    const notifs = captured.filter((c) => c.op === "insert" && c.table === "notificacoes");
    expect(notifs).toHaveLength(0);
    expect(emitirNotificacao).not.toHaveBeenCalled();

    const upd = captured.find((c) => c.op === "update" && c.table === "motor_monitoramentos");
    expect(upd!.set!.totalNovasAcoes).toBe(0); // não soma silenciados
  });

  it("alerta (lido=false + notif) quando cliente é POLO PASSIVO", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_NOVO] });
    consultarTjce.mockResolvedValue(
      detalheMock({
        partes: [
          { polo: "ativo", nome: "BANCO XPTO S.A.", documento: "11111111000100" },
          { polo: "passivo", nome: APELIDO, documento: CPF },
        ],
      }),
    );
    selectQueue.push([{ ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]) }]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect(eventos).toHaveLength(1);
    expect((eventos[0].values as any).lido).toBe(false);
    expect((eventos[0].values as any).conteudo).toMatch(/Nova ação detectada/);
    const json = JSON.parse((eventos[0].values as any).conteudoJson);
    expect(json.poloDoCliente).toBe("passivo");
    expect(json.motivoSilencio).toBeNull();

    expect(emitirNotificacao).toHaveBeenCalledOnce();
    const notifs = captured.filter((c) => c.op === "insert" && c.table === "notificacoes");
    expect(notifs).toHaveLength(1);
  });

  it("alerta quando cliente é TERCEIRO interessado", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_NOVO] });
    consultarTjce.mockResolvedValue(
      detalheMock({
        partes: [
          { polo: "ativo", nome: "AUTOR PRINCIPAL", documento: "11111111111" },
          { polo: "passivo", nome: "RÉU PRINCIPAL", documento: "22222222222" },
          { polo: "terceiro", nome: APELIDO, documento: CPF },
        ],
      }),
    );
    selectQueue.push([{ ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]) }]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect((eventos[0].values as any).lido).toBe(false);
    expect(JSON.parse((eventos[0].values as any).conteudoJson).poloDoCliente).toBe("terceiro");
    expect(emitirNotificacao).toHaveBeenCalledOnce();
  });

  it("alerta (safe default) quando cliente não aparece nas partes (scraper falhou parcial)", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_NOVO] });
    consultarTjce.mockResolvedValue(
      detalheMock({
        partes: [
          { polo: "ativo", nome: "ALGUÉM", documento: "11111111111" },
          { polo: "passivo", nome: "OUTRO ALGUÉM", documento: "22222222222" },
        ],
      }),
    );
    selectQueue.push([{ ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]) }]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect((eventos[0].values as any).lido).toBe(false); // alerta
    expect(JSON.parse((eventos[0].values as any).conteudoJson).poloDoCliente).toBe("desconhecido");
    expect(emitirNotificacao).toHaveBeenCalledOnce();
  });

  it("alerta (safe default) quando detail scrape exception", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_NOVO] });
    consultarTjce.mockRejectedValue(new Error("Network error"));
    selectQueue.push([{ ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]) }]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect((eventos[0].values as any).lido).toBe(false);
    expect(emitirNotificacao).toHaveBeenCalledOnce();
  });

  it("alerta (safe default) quando detail scrape retorna ok=false", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_NOVO] });
    consultarTjce.mockResolvedValue(detalheMock({ ok: false }));
    selectQueue.push([{ ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]) }]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect((eventos[0].values as any).lido).toBe(false);
    expect(emitirNotificacao).toHaveBeenCalledOnce();
  });
});

describe("pollMonitoramentosNovasAcoes — filtro combinado polo + data", () => {
  const CPF = MON_BASE.searchKey;
  const APELIDO = MON_BASE.apelido;
  const CNJ_NOVO = "0009999-99.2023.8.06.0001";

  function detalheMock(dataDistribuicao: string | null, partes: Array<{ nome: string; polo: "ativo" | "passivo" | "terceiro"; documento?: string | null }>) {
    return {
      ok: true,
      tribunal: "tjce",
      cnj: CNJ_NOVO,
      latenciaMs: 100,
      capa: {
        cnj: CNJ_NOVO,
        classe: null,
        assuntos: [],
        orgaoJulgador: null,
        juiz: null,
        comarca: null,
        uf: "CE",
        valorCausaCentavos: null,
        dataDistribuicao,
        status: null,
        partes: partes.map((p) => ({
          nome: p.nome,
          polo: p.polo,
          tipo: "fisica" as const,
          documento: p.documento ?? null,
          advogados: [],
        })),
        segredoJustica: false,
      },
      movimentacoes: [],
      categoriaErro: null,
      mensagemErro: null,
      screenshotPath: null,
      finalizadoEm: new Date().toISOString(),
    };
  }

  it("polo passivo + ajuizado ANTES do cadastro → silencia (data prevalece)", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_NOVO] });
    consultarTjce.mockResolvedValue(
      detalheMock(
        "2023-05-15T00:00:00.000Z", // ajuizado em maio/2023
        [{ polo: "passivo", nome: APELIDO, documento: CPF }],
      ),
    );
    selectQueue.push([
      {
        ...MON_BASE,
        cnjsConhecidos: JSON.stringify(["existente-1"]),
        dataReferenciaCadastro: new Date("2025-01-01T00:00:00.000Z"), // cadastrado em 2025
      },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect((eventos[0].values as any).lido).toBe(true); // silenciado
    expect((eventos[0].values as any).conteudo).toMatch(/Baseline antigo/);
    const json = JSON.parse((eventos[0].values as any).conteudoJson);
    expect(json.motivoSilencio).toBe("anterior_cadastro");
    expect(json.filtradoPorData).toBe(true);

    expect(emitirNotificacao).not.toHaveBeenCalled();
  });

  it("polo passivo + ajuizado APÓS cadastro → alerta", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_NOVO] });
    consultarTjce.mockResolvedValue(
      detalheMock(
        "2026-05-15T00:00:00.000Z",
        [{ polo: "passivo", nome: APELIDO, documento: CPF }],
      ),
    );
    selectQueue.push([
      {
        ...MON_BASE,
        cnjsConhecidos: JSON.stringify(["existente-1"]),
        dataReferenciaCadastro: new Date("2025-01-01T00:00:00.000Z"),
      },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect((eventos[0].values as any).lido).toBe(false);
    expect(emitirNotificacao).toHaveBeenCalledOnce();
  });

  it("polo ativo + dataRef NULL → silencia (polo vence sozinho)", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_NOVO] });
    consultarTjce.mockResolvedValue(
      detalheMock(
        "2026-05-15T00:00:00.000Z",
        [{ polo: "ativo", nome: APELIDO, documento: CPF }],
      ),
    );
    selectQueue.push([
      {
        ...MON_BASE,
        cnjsConhecidos: JSON.stringify(["existente-1"]),
        dataReferenciaCadastro: null, // monitoramento legado sem backfill
      },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect((eventos[0].values as any).lido).toBe(true);
    expect(JSON.parse((eventos[0].values as any).conteudoJson).motivoSilencio).toBe("polo_ativo");
    expect(emitirNotificacao).not.toHaveBeenCalled();
  });

  it("dataRef NULL + cliente em partes desconhecido → alerta (legado sem polo nem data)", async () => {
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_NOVO] });
    consultarTjce.mockResolvedValue(
      detalheMock("2023-01-01T00:00:00.000Z", []),
    );
    selectQueue.push([
      { ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]), dataReferenciaCadastro: null },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect((eventos[0].values as any).lido).toBe(false);
  });

  it("mistura: 1 CNJ polo passivo + 1 CNJ polo ativo → 1 alerta e 1 silencioso", async () => {
    const CNJ_PASSIVO = "0001111-11.2026.8.06.0001";
    const CNJ_ATIVO = "0002222-22.2026.8.06.0001";
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_PASSIVO, CNJ_ATIVO] });

    // Detail mock que reage ao CNJ consultado
    consultarTjce.mockImplementation(async (cnj: string) => {
      if (cnj === CNJ_PASSIVO) {
        return detalheMock("2026-05-15T00:00:00.000Z", [
          { polo: "passivo", nome: APELIDO, documento: CPF },
        ]);
      }
      return detalheMock("2026-05-15T00:00:00.000Z", [
        { polo: "ativo", nome: APELIDO, documento: CPF },
      ]);
    });

    selectQueue.push([
      { ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]), dataReferenciaCadastro: null },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect(eventos).toHaveLength(2);

    const evPassivo = eventos.find((e) => (e.values as any).cnjAfetado === CNJ_PASSIVO);
    const evAtivo = eventos.find((e) => (e.values as any).cnjAfetado === CNJ_ATIVO);
    expect((evPassivo!.values as any).lido).toBe(false);
    expect((evAtivo!.values as any).lido).toBe(true);

    // 1 notif (só do passivo), totalNovasAcoes += 1
    const notifs = captured.filter((c) => c.op === "insert" && c.table === "notificacoes");
    expect(notifs).toHaveLength(1);
    expect(emitirNotificacao).toHaveBeenCalledOnce();

    const upd = captured.find((c) => c.op === "update" && c.table === "motor_monitoramentos");
    expect(upd!.set!.totalNovasAcoes).toBe(1);
  });
});

describe("pollMonitoramentosNovasAcoes — salvaguarda CNJ antigo sem dataRef", () => {
  // Bug em produção (22/05/2026): monitoramentos legados sem
  // `dataReferenciaCadastro` puxavam o histórico inteiro do CPF do PJe.
  // Cliente com processo de 2015 + processos recentes gerava 3 cards
  // "Nova ação detectada", incluindo o de 11 anos atrás.
  //
  // Fix: quando dataRef=NULL, usa o ano do próprio CNJ como salvaguarda —
  // se >3 anos atrás, silencia mesmo sem detail scrape resolver polo.

  const CPF = MON_BASE.searchKey;
  const APELIDO = MON_BASE.apelido;

  function detalhe(cnj: string, dataDist: string | null, polo: "ativo" | "passivo" | "terceiro" | null) {
    return {
      ok: true,
      tribunal: "tjce",
      cnj,
      latenciaMs: 100,
      capa: {
        cnj,
        classe: null,
        assuntos: [],
        orgaoJulgador: null,
        juiz: null,
        comarca: null,
        uf: "CE",
        valorCausaCentavos: null,
        dataDistribuicao: dataDist,
        status: null,
        partes: polo ? [{ nome: APELIDO, polo, tipo: "fisica" as const, documento: CPF, advogados: [] }] : [],
        segredoJustica: false,
      },
      movimentacoes: [],
      categoriaErro: null,
      mensagemErro: null,
      screenshotPath: null,
      finalizadoEm: new Date().toISOString(),
    };
  }

  it("CNJ de 2015 + dataRef NULL + polo passivo → silencia por ano antigo (NÃO alerta)", async () => {
    const CNJ_2015 = "0140340-27.2015.8.06.0001";
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_2015] });
    consultarTjce.mockResolvedValue(detalhe(CNJ_2015, "2015-03-27T00:00:00.000Z", "passivo"));
    selectQueue.push([
      { ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]), dataReferenciaCadastro: null },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect(eventos).toHaveLength(1);
    expect((eventos[0].values as any).lido).toBe(true); // SILENCIADO
    expect((eventos[0].values as any).conteudo).toMatch(/Processo antigo/);
    const json = JSON.parse((eventos[0].values as any).conteudoJson);
    expect(json.motivoSilencio).toBe("cnj_antigo");
    expect(json.filtradoPorAnoCnj).toBe(true);

    // SEM notificação no sino + SEM SSE
    const notifs = captured.filter((c) => c.op === "insert" && c.table === "notificacoes");
    expect(notifs).toHaveLength(0);
    expect(emitirNotificacao).not.toHaveBeenCalled();
  });

  it("CNJ recente (2026) + dataRef NULL + polo passivo → alerta normal", async () => {
    const CNJ_2026 = "3026436-89.2026.8.06.0001";
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_2026] });
    consultarTjce.mockResolvedValue(detalhe(CNJ_2026, "2026-05-15T00:00:00.000Z", "passivo"));
    selectQueue.push([
      { ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]), dataReferenciaCadastro: null },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect(eventos).toHaveLength(1);
    expect((eventos[0].values as any).lido).toBe(false); // ALERTA
    expect(JSON.parse((eventos[0].values as any).conteudoJson).motivoSilencio).toBeNull();
    expect(emitirNotificacao).toHaveBeenCalledOnce();
  });

  it("mix 2015 (antigo) + 2026 (recente) com dataRef NULL → só 2026 alerta", async () => {
    // Cenário real reportado: cliente Diego Aguiar, 3 CNJs (2 de 2026 + 1 de 2015)
    const CNJ_2015 = "0140340-27.2015.8.06.0001";
    const CNJ_2026A = "3026436-89.2026.8.06.0001";
    const CNJ_2026B = "3025486-80.2026.8.06.0001";
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({
      ok: true,
      cnjs: ["existente-1", CNJ_2015, CNJ_2026A, CNJ_2026B],
    });
    consultarTjce.mockImplementation(async (cnj: string) => {
      if (cnj === CNJ_2015) return detalhe(CNJ_2015, "2015-03-27T00:00:00.000Z", "passivo");
      if (cnj === CNJ_2026A) return detalhe(CNJ_2026A, "2026-05-10T00:00:00.000Z", "passivo");
      return detalhe(CNJ_2026B, "2026-05-12T00:00:00.000Z", "passivo");
    });
    selectQueue.push([
      { ...MON_BASE, cnjsConhecidos: JSON.stringify(["existente-1"]), dataReferenciaCadastro: null },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect(eventos).toHaveLength(3);

    const ev2015 = eventos.find((e) => (e.values as any).cnjAfetado === CNJ_2015);
    const ev2026a = eventos.find((e) => (e.values as any).cnjAfetado === CNJ_2026A);
    const ev2026b = eventos.find((e) => (e.values as any).cnjAfetado === CNJ_2026B);

    expect((ev2015!.values as any).lido).toBe(true); // SILENCIADO
    expect(JSON.parse((ev2015!.values as any).conteudoJson).motivoSilencio).toBe("cnj_antigo");

    expect((ev2026a!.values as any).lido).toBe(false); // ALERTA
    expect((ev2026b!.values as any).lido).toBe(false); // ALERTA

    // Apenas 1 notificação consolidada com os 2 CNJs relevantes
    const notifs = captured.filter((c) => c.op === "insert" && c.table === "notificacoes");
    expect(notifs).toHaveLength(1);
    expect(emitirNotificacao).toHaveBeenCalledOnce();

    const upd = captured.find((c) => c.op === "update" && c.table === "motor_monitoramentos");
    expect(upd!.set!.totalNovasAcoes).toBe(2); // só os 2 recentes
  });

  it("dataRef PRESENTE (mais precisa que ano CNJ) → usa filtro de data, não ano", async () => {
    // Quando dataRef existe, é a fonte de verdade. CNJ antigo NÃO entra
    // na regra do ano — vai pelo filtro `anterior_cadastro`.
    const CNJ_2015 = "0140340-27.2015.8.06.0001";
    recuperarSessao.mockResolvedValue("storage-state-json");
    consultarTjcePorCpf.mockResolvedValue({ ok: true, cnjs: ["existente-1", CNJ_2015] });
    consultarTjce.mockResolvedValue(detalhe(CNJ_2015, "2015-03-27T00:00:00.000Z", "passivo"));
    selectQueue.push([
      {
        ...MON_BASE,
        cnjsConhecidos: JSON.stringify(["existente-1"]),
        dataReferenciaCadastro: new Date("2025-01-01T00:00:00.000Z"),
      },
    ]);

    await pollMonitoramentosNovasAcoes();

    const eventos = captured.filter((c) => c.op === "insert" && c.table === "eventos_processo");
    expect(eventos).toHaveLength(1);
    expect((eventos[0].values as any).lido).toBe(true);
    expect(JSON.parse((eventos[0].values as any).conteudoJson).motivoSilencio).toBe("anterior_cadastro");
  });
});
