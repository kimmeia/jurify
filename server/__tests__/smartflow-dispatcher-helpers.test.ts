/**
 * Testes dos predicados puros usados pelo dispatcher do SmartFlow.
 *
 * Cobre os três gatilhos novos introduzidos nesta sprint:
 *  - `mensagem_canal` (filtro por canal configurado)
 *  - `pagamento_vencido` (threshold mínimo de dias de atraso)
 *  - `pagamento_proximo_vencimento` (antecedência máxima em dias)
 *
 * E o dedupe que protege contra dispositivos duplicados na janela de 24h
 * (quando webhook PAYMENT_OVERDUE do Asaas concorre com o cobranças-scheduler).
 */

import { describe, it, expect } from "vitest";
import {
  aceitaCanal,
  contextoContemPagamento,
  deveDispararProximo,
  deveDispararVencido,
  diasEntre,
  parseVencimento,
} from "../smartflow/dispatcher-helpers";

describe("aceitaCanal (gatilho mensagem_canal)", () => {
  it("aceita qualquer canal quando config.canais está vazio", () => {
    expect(aceitaCanal({}, "whatsapp_qr")).toBe(true);
    expect(aceitaCanal({ canais: [] }, "whatsapp_api")).toBe(true);
    expect(aceitaCanal(undefined, "instagram")).toBe(true);
  });

  it("filtra por canal quando canais está populado", () => {
    const cfg = { canais: ["whatsapp_qr" as const] };
    expect(aceitaCanal(cfg, "whatsapp_qr")).toBe(true);
    expect(aceitaCanal(cfg, "whatsapp_api")).toBe(false);
    expect(aceitaCanal(cfg, "instagram")).toBe(false);
  });

  it("aceita múltiplos canais simultâneos", () => {
    const cfg = { canais: ["whatsapp_qr" as const, "whatsapp_api" as const] };
    expect(aceitaCanal(cfg, "whatsapp_qr")).toBe(true);
    expect(aceitaCanal(cfg, "whatsapp_api")).toBe(true);
    expect(aceitaCanal(cfg, "facebook")).toBe(false);
  });
});

describe("deveDispararVencido (gatilho pagamento_vencido)", () => {
  it("dispara imediatamente quando diasAtraso=0 (default)", () => {
    expect(deveDispararVencido({}, 0)).toBe(true);
    expect(deveDispararVencido({}, 1)).toBe(true);
    expect(deveDispararVencido(undefined, 5)).toBe(true);
  });

  it("respeita o threshold configurado", () => {
    const cfg = { diasAtraso: 3 };
    expect(deveDispararVencido(cfg, 2)).toBe(false);
    expect(deveDispararVencido(cfg, 3)).toBe(true);
    expect(deveDispararVencido(cfg, 10)).toBe(true);
  });

  it("normaliza valores negativos para 0", () => {
    // um admin poderia digitar -1 — o predicado não explode, trata como 0
    expect(deveDispararVencido({ diasAtraso: -5 }, 0)).toBe(true);
  });
});

describe("deveDispararProximo (gatilho pagamento_proximo_vencimento)", () => {
  it("ignora pagamentos já vencidos (diasAteVencer < 0)", () => {
    expect(deveDispararProximo({ diasAntes: 3 }, -1)).toBe(false);
    expect(deveDispararProximo({ diasAntes: 10 }, -5)).toBe(false);
  });

  it("dispara dentro da janela configurada", () => {
    const cfg = { diasAntes: 3 };
    expect(deveDispararProximo(cfg, 0)).toBe(true); // vence hoje
    expect(deveDispararProximo(cfg, 3)).toBe(true); // no limite
    expect(deveDispararProximo(cfg, 4)).toBe(false);
  });

  it("usa default 3 quando diasAntes não está configurado", () => {
    expect(deveDispararProximo({}, 2)).toBe(true);
    expect(deveDispararProximo({}, 3)).toBe(true);
    expect(deveDispararProximo({}, 4)).toBe(false);
  });
});

describe("contextoContemPagamento (dedupe)", () => {
  it("reconhece pagamentoId no JSON serializado", () => {
    const ctx = JSON.stringify({
      mensagem: "Cobrança vencida",
      pagamentoId: "pay_abc123",
      diasAtraso: 5,
    });
    expect(contextoContemPagamento(ctx, "pay_abc123")).toBe(true);
  });

  it("não dá falso positivo com IDs parecidos", () => {
    const ctx = JSON.stringify({ pagamentoId: "pay_abc123_extra" });
    // LIKE parcial poderia dar false-positive, mas como cercamos com aspas
    // na chave+valor exatos, o match é exato:
    expect(contextoContemPagamento(ctx, "pay_abc123")).toBe(false);
    expect(contextoContemPagamento(ctx, "pay_abc123_extra")).toBe(true);
  });

  it("retorna false pra contexto vazio ou sem o campo", () => {
    expect(contextoContemPagamento(null, "pay_x")).toBe(false);
    expect(contextoContemPagamento("", "pay_x")).toBe(false);
    expect(contextoContemPagamento(JSON.stringify({}), "pay_x")).toBe(false);
    expect(contextoContemPagamento(JSON.stringify({ outroId: "pay_x" }), "pay_x")).toBe(false);
  });
});

describe("diasEntre / parseVencimento", () => {
  it("diasEntre calcula dias inteiros", () => {
    const hoje = new Date("2026-04-20T12:00:00");
    const ontem = new Date("2026-04-19T12:00:00");
    const semanaAtras = new Date("2026-04-13T12:00:00");
    expect(diasEntre(hoje, ontem)).toBe(1);
    expect(diasEntre(hoje, semanaAtras)).toBe(7);
    expect(diasEntre(ontem, hoje)).toBe(-1);
  });

  it("parseVencimento aceita formato ISO do Asaas (YYYY-MM-DD)", () => {
    const d = parseVencimento("2026-04-30");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(3); // abril = 3
    expect(d!.getDate()).toBe(30);
  });

  it("parseVencimento devolve null para inputs inválidos", () => {
    expect(parseVencimento(null)).toBeNull();
    expect(parseVencimento("")).toBeNull();
    expect(parseVencimento("data-invalida")).toBeNull();
  });
});
