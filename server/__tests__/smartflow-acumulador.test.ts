import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { acumularMensagem, _resetAcumulador, _pendentesAcumulador } from "../smartflow/acumulador";

describe("acumularMensagem (janela deslizante)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetAcumulador();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uma mensagem dispara após a janela, com o texto", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    acumularMensagem("c1", 15, "oi", run);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);
    expect(run).toHaveBeenCalledWith("oi");
  });

  it("junta mensagens picadas numa só (unidas por \\n)", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    acumularMensagem("c1", 15, "oi", run);
    await vi.advanceTimersByTimeAsync(5000);
    acumularMensagem("c1", 15, "queria agendar", run);
    await vi.advanceTimersByTimeAsync(15000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("oi\nqueria agendar");
  });

  it("janela deslizante: reinicia o cronômetro a cada mensagem", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    acumularMensagem("c1", 15, "a", run);
    await vi.advanceTimersByTimeAsync(10000); // 10s
    acumularMensagem("c1", 15, "b", run); // reinicia
    await vi.advanceTimersByTimeAsync(10000); // +10s (só 10s desde a última)
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000); // 15s desde a última
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("a\nb");
  });

  it("chaves diferentes (conversas) são independentes", async () => {
    const r1 = vi.fn().mockResolvedValue(undefined);
    const r2 = vi.fn().mockResolvedValue(undefined);
    acumularMensagem("canal:1", 15, "x", r1);
    acumularMensagem("canal:2", 15, "y", r2);
    expect(_pendentesAcumulador()).toBe(2);
    await vi.advanceTimersByTimeAsync(15000);
    expect(r1).toHaveBeenCalledWith("x");
    expect(r2).toHaveBeenCalledWith("y");
  });
});
