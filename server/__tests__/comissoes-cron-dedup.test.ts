/**
 * Teste do dedup cross-origem em `processarAgendasComissao`.
 *
 * Cenário: usuário já fechou o período manualmente. Depois cria/ativa
 * agenda automática que dispararia pra o mesmo período. Esperado:
 *  - `fecharComissao` NÃO é chamada (evita duplicar)
 *  - `marcarExecucaoConcluida` é chamada apontando pro fechamento existente
 *  - Notificação informa "X já tinha(m) fechamento"
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks dos helpers de db-comissoes ───────────────────────────────────────
const fecharComissao = vi.fn();
const marcarExecucaoConcluida = vi.fn();
const marcarExecucaoFalhou = vi.fn();
const reservarExecucao = vi.fn();
const carregarRegraComissao = vi.fn(async () => ({
  aliquotaPercent: 10,
  valorMinimo: 0,
  modo: "flat" as const,
  baseFaixa: "comissionavel" as const,
  faixas: [],
}));

// Stub da exceção — precisa ser uma classe pra `instanceof` funcionar.
class FechamentoJaExisteError extends Error {
  constructor(
    public readonly comissaoFechadaId: number,
    public readonly origem: "manual" | "automatico",
  ) {
    super(`Fechamento já existe (id=${comissaoFechadaId})`);
    this.name = "FechamentoJaExisteError";
  }
}

vi.mock("../escritorio/db-comissoes", () => ({
  fecharComissao,
  FechamentoJaExisteError,
  marcarExecucaoConcluida,
  marcarExecucaoFalhou,
  reservarExecucao,
  carregarRegraComissao,
  // Período fixo, independente da data do sistema. Evita flakiness.
  periodoMesAnterior: () => ({ inicio: "2026-03-01", fim: "2026-03-31" }),
}));

// ─── Mock do getDb ───────────────────────────────────────────────────────────
let selectQueue: unknown[][] = [];
const captured: Array<{
  op: "select" | "insert";
  table: string;
  values?: unknown;
}> = [];

function tableName(t: unknown): string {
  const anyT = t as any;
  return anyT?._?.name || anyT?.[Symbol.for("drizzle:Name")] || "unknown";
}

function makeSelectBuilder(table: unknown) {
  const next = () => Promise.resolve(selectQueue.shift() ?? []);
  const builder: any = {
    from(_t: unknown) {
      captured.push({ op: "select", table: tableName(_t) });
      return builder;
    },
    innerJoin: (..._a: unknown[]) => builder,
    leftJoin: (..._a: unknown[]) => builder,
    where: (_w: unknown) => builder,
    orderBy: (..._a: unknown[]) => builder,
    limit: (_n: number) => next(),
    then: (resolve: (v: unknown) => unknown) =>
      resolve(selectQueue.shift() ?? []),
  };
  // Nada pra fazer com `table` diretamente — só registrado em `from`.
  void table;
  return builder;
}

const mockDb = {
  select: () => ({ from: (t: unknown) => makeSelectBuilder(t) }),
  selectDistinct: () => ({ from: (t: unknown) => makeSelectBuilder(t) }),
  insert: (table: unknown) => ({
    values(values: unknown) {
      captured.push({ op: "insert", table: tableName(table), values });
      return {
        $returningId: () => Promise.resolve([{ id: 1 }]),
        then: (r: (v: unknown) => unknown) =>
          r([{ insertId: 1, affectedRows: 1 }]),
      };
    },
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

// Importa APÓS mocks (padrão dos outros testes do projeto).
const { processarAgendasComissao } = await import("../_core/cron-comissoes");

beforeEach(() => {
  selectQueue = [];
  captured.length = 0;
  fecharComissao.mockReset();
  marcarExecucaoConcluida.mockReset();
  marcarExecucaoFalhou.mockReset();
  reservarExecucao.mockReset();
  // mockClear preserva a implementação (return value do carregarRegraComissao);
  // mockReset zeraria o factory. Usamos clear pra zerar só o histórico de chamadas.
  carregarRegraComissao.mockClear();
  // Hora fixa: dia 10/abril/2026 às 18h (depois do gatilho dia=1 18:00).
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-10T21:00:00Z")); // 18:00 BRT
});

afterEach(() => {
  vi.useRealTimers();
});

describe("processarAgendasComissao — dedup cross-origem", () => {
  it("pula atendente quando fecharComissao lança FechamentoJaExisteError", async () => {
    // 1) Agendas ativas
    selectQueue.push([
      {
        id: 1,
        escritorioId: 100,
        diaDoMes: 1,
        horaLocal: "18:00",
        fusoHorario: "America/Sao_Paulo",
      },
    ]);
    // 2) Cobranças distinct atendenteId
    selectQueue.push([{ atendenteId: 10 }]);
    // 3) Colaboradores (atendente A)
    selectQueue.push([{ id: 10, userId: 50, userName: "Atendente A" }]);
    // 4) Dono do escritório
    selectQueue.push([{ userId: 1 }]);
    // 5) Destinatários da notificação
    selectQueue.push([{ userId: 1 }]);

    reservarExecucao.mockResolvedValue(42);
    // Simula que fecharComissao detectou duplicata (manual prévio)
    fecharComissao.mockRejectedValue(new FechamentoJaExisteError(999, "manual"));

    await processarAgendasComissao();

    expect(reservarExecucao).toHaveBeenCalledOnce();
    expect(fecharComissao).toHaveBeenCalledOnce();
    expect(marcarExecucaoConcluida).toHaveBeenCalledWith(42, 999);
    expect(marcarExecucaoFalhou).not.toHaveBeenCalled();

    // Notificação inclui contador de "já tinha fechamento".
    const notif = captured.find(
      (c) => c.op === "insert" && c.table === "notificacoes",
    );
    expect(notif).toBeDefined();
    const valores = notif!.values as Array<{ mensagem: string }>;
    expect(valores[0].mensagem).toContain("já tinha");
  });

  it("fecha normalmente quando NÃO existe fechamento prévio", async () => {
    selectQueue.push([
      {
        id: 1,
        escritorioId: 100,
        diaDoMes: 1,
        horaLocal: "18:00",
        fusoHorario: "America/Sao_Paulo",
      },
    ]);
    selectQueue.push([{ atendenteId: 10 }]);
    selectQueue.push([{ id: 10, userId: 50, userName: "Atendente A" }]);
    selectQueue.push([{ userId: 1 }]);
    selectQueue.push([{ userId: 1 }]);

    reservarExecucao.mockResolvedValue(42);
    fecharComissao.mockResolvedValue({
      id: 777,
      totais: { valorComissao: "100.00" },
    });

    await processarAgendasComissao();

    expect(fecharComissao).toHaveBeenCalledOnce();
    expect(marcarExecucaoConcluida).toHaveBeenCalledWith(42, 777);
    expect(marcarExecucaoFalhou).not.toHaveBeenCalled();

    // Regra carregada UMA vez por escritório (não 1x por atendente).
    // Em escritórios com 50 atendentes ativos no mês, isso evita 100
    // queries idênticas de regra+faixas.
    expect(carregarRegraComissao).toHaveBeenCalledOnce();
    expect(carregarRegraComissao).toHaveBeenCalledWith(100);

    // Cron repassa a regra pra fecharComissao via params.regraCarregada
    const callArgs = fecharComissao.mock.calls[0][0];
    expect(callArgs.regraCarregada).toEqual({
      aliquotaPercent: 10,
      valorMinimo: 0,
      modo: "flat",
      baseFaixa: "comissionavel",
      faixas: [],
    });
  });
});
