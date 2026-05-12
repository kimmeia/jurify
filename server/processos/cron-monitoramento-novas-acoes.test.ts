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
vi.mock("./adapters/pje-tjce", () => ({
  consultarTjce: vi.fn(),
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
