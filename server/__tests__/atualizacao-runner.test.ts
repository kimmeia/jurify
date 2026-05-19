/**
 * Tests — `atualizacao-runner.ts` (botão "Atualizar todos").
 *
 * Foco: lógica de orquestração — fan-out paralelo, progress tracking,
 * filtros por id, TTL de operação, retomada para o user que iniciou.
 *
 * Não testa o scrape real (mockado) — esse caminho é coberto pelo
 * cron-monitoramento e adapters dedicados.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock cron-monitoramento — pollers per-monitor ──────────────────────────
const pollarMovs = vi.fn();
const pollarNovasAcoes = vi.fn();
vi.mock("../processos/cron-monitoramento", () => ({
  pollarUmMonitoramentoMovs: pollarMovs,
  pollarUmMonitoramentoNovasAcoes: pollarNovasAcoes,
}));

// ─── Mock SSE emit ─────────────────────────────────────────────────────────
const emitirNotificacao = vi.fn();
vi.mock("../_core/sse-notifications", () => ({
  emitirNotificacao,
  iniciarHeartbeat: vi.fn(),
}));

// ─── Mock DB ────────────────────────────────────────────────────────────────
const dbState = {
  monitoramentos: [] as Array<{
    id: number;
    escritorioId: number;
    apelido: string | null;
    tipoMonitoramento: "movimentacoes" | "novas_acoes";
    status: "ativo" | "pausado" | "erro";
  }>,
};

function makeDb() {
  const builder: any = {
    select: () => builder,
    from: () => builder,
    where: () => builder,
    limit: () => builder,
    then: (resolve: any) => resolve(dbState.monitoramentos),
  };
  return {
    select: () => builder,
  };
}

vi.mock("../db", () => ({
  getDb: vi.fn(async () => makeDb()),
}));

const {
  iniciarAtualizacaoTodos,
  obterProgressoAtualizacao,
  listarOperacoesPendentes,
} = await import("../processos/atualizacao-runner");

function aguardar(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  dbState.monitoramentos = [];
  pollarMovs.mockReset();
  pollarNovasAcoes.mockReset();
  emitirNotificacao.mockReset();
});

describe("atualizacao-runner — iniciar", () => {
  it("rejeita quando não há monitoramentos ativos", async () => {
    dbState.monitoramentos = [];
    await expect(iniciarAtualizacaoTodos(1, 1)).rejects.toThrow(/Nenhum monitoramento/i);
  });

  it("retorna operacaoId e total imediatamente", async () => {
    dbState.monitoramentos = [
      { id: 1, escritorioId: 1, apelido: "A", tipoMonitoramento: "movimentacoes", status: "ativo" },
      { id: 2, escritorioId: 1, apelido: "B", tipoMonitoramento: "novas_acoes", status: "ativo" },
    ];
    pollarMovs.mockResolvedValue({ ok: true, detectadas: 0 });
    pollarNovasAcoes.mockResolvedValue({ ok: true, detectadas: 0 });

    const { operacaoId, total } = await iniciarAtualizacaoTodos(100, 1);

    expect(operacaoId).toMatch(/^atualiz:/);
    expect(total).toBe(2);
  });
});

describe("atualizacao-runner — progress tracking", () => {
  it("delega ao poller certo por tipo (movs vs novas_acoes)", async () => {
    dbState.monitoramentos = [
      { id: 1, escritorioId: 1, apelido: "A", tipoMonitoramento: "movimentacoes", status: "ativo" },
      { id: 2, escritorioId: 1, apelido: "B", tipoMonitoramento: "novas_acoes", status: "ativo" },
    ];
    pollarMovs.mockResolvedValue({ ok: true, detectadas: 3 });
    pollarNovasAcoes.mockResolvedValue({ ok: true, detectadas: 1 });

    const { operacaoId } = await iniciarAtualizacaoTodos(100, 1);
    // Polls são paralelos — pequena espera pra concluir
    await aguardar(50);

    expect(pollarMovs).toHaveBeenCalledTimes(1);
    expect(pollarNovasAcoes).toHaveBeenCalledTimes(1);

    const op = obterProgressoAtualizacao(operacaoId, 100);
    expect(op).not.toBeNull();
    expect(op!.status).toBe("concluido");
    expect(op!.ok).toBe(2);
    expect(op!.erro).toBe(0);
    expect(op!.detectadasTotal).toBe(4);
  });

  it("agrega erros separadamente", async () => {
    dbState.monitoramentos = [
      { id: 1, escritorioId: 1, apelido: "A", tipoMonitoramento: "movimentacoes", status: "ativo" },
      { id: 2, escritorioId: 1, apelido: "B", tipoMonitoramento: "movimentacoes", status: "ativo" },
    ];
    pollarMovs
      .mockResolvedValueOnce({ ok: true, detectadas: 0 })
      .mockResolvedValueOnce({ ok: false, detectadas: 0, erro: "Sessão expirada" });

    const { operacaoId } = await iniciarAtualizacaoTodos(100, 1);
    await aguardar(50);

    const op = obterProgressoAtualizacao(operacaoId, 100);
    expect(op!.ok).toBe(1);
    expect(op!.erro).toBe(1);
    expect(op!.monitores[1].status).toBe("erro");
    expect(op!.monitores[1].erro).toBe("Sessão expirada");
  });

  it("captura exceção do poller (não vaza)", async () => {
    dbState.monitoramentos = [
      { id: 1, escritorioId: 1, apelido: "A", tipoMonitoramento: "movimentacoes", status: "ativo" },
    ];
    pollarMovs.mockRejectedValue(new Error("Boom"));

    const { operacaoId } = await iniciarAtualizacaoTodos(100, 1);
    await aguardar(50);

    const op = obterProgressoAtualizacao(operacaoId, 100);
    expect(op!.status).toBe("concluido");
    expect(op!.erro).toBe(1);
    expect(op!.monitores[0].erro).toContain("Boom");
  });
});

describe("atualizacao-runner — isolamento de usuário", () => {
  it("user outro não consegue ler operação de quem iniciou", async () => {
    dbState.monitoramentos = [
      { id: 1, escritorioId: 1, apelido: "A", tipoMonitoramento: "movimentacoes", status: "ativo" },
    ];
    pollarMovs.mockResolvedValue({ ok: true, detectadas: 0 });

    const { operacaoId } = await iniciarAtualizacaoTodos(100, 1);
    await aguardar(20);

    expect(obterProgressoAtualizacao(operacaoId, 100)).not.toBeNull();
    expect(obterProgressoAtualizacao(operacaoId, 999)).toBeNull(); // outro user
  });

  it("listarOperacoesPendentes só retorna ops do user", async () => {
    dbState.monitoramentos = [
      { id: 1, escritorioId: 1, apelido: "A", tipoMonitoramento: "movimentacoes", status: "ativo" },
    ];
    // poller demora pra simular operação em andamento
    pollarMovs.mockImplementation(() => aguardar(500).then(() => ({ ok: true, detectadas: 0 })));

    await iniciarAtualizacaoTodos(100, 1);
    await aguardar(20);

    expect(listarOperacoesPendentes(100)).toHaveLength(1);
    expect(listarOperacoesPendentes(999)).toHaveLength(0);
  });
});

describe("atualizacao-runner — SSE", () => {
  it("emite progresso após cada monitoramento", async () => {
    dbState.monitoramentos = [
      { id: 1, escritorioId: 1, apelido: "A", tipoMonitoramento: "movimentacoes", status: "ativo" },
      { id: 2, escritorioId: 1, apelido: "B", tipoMonitoramento: "movimentacoes", status: "ativo" },
    ];
    pollarMovs.mockResolvedValue({ ok: true, detectadas: 0 });

    await iniciarAtualizacaoTodos(100, 1);
    await aguardar(50);

    // Emit por: rodando, ok, rodando, ok, concluido = 5+ events
    expect(emitirNotificacao.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Ultimo deve ser status=concluido
    const ultimaCall = emitirNotificacao.mock.calls[emitirNotificacao.mock.calls.length - 1];
    expect(ultimaCall[1].dados?.kind).toBe("atualizacao_progresso");
    expect(ultimaCall[1].dados?.status).toBe("concluido");
  });
});
