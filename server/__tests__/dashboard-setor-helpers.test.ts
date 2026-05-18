/**
 * Testes dos helpers puros do Dashboard por setor.
 *
 * Cobrem os 5 cálculos centrais que alimentam os painéis:
 *   - proporcionalizarMeta: meta cortada conforme range vs mês cheio
 *   - calcularProgressoMeta: % atingido vs meta
 *   - percentInadimplenciaPorValor: vencido / total esperado
 *   - percentInadimplenciaPorCliente: clientes devendo / clientes com cobrança
 *   - taxaConclusaoNoPrazo: concluído no prazo / total concluído
 *   - classificarTarefaPrazo: bucket de prazo
 */

import { describe, expect, it } from "vitest";
import {
  proporcionalizarMeta,
  calcularProgressoMeta,
  percentInadimplenciaPorValor,
  percentInadimplenciaPorCliente,
  taxaConclusaoNoPrazo,
  classificarTarefaPrazo,
} from "../routers/dashboard-setor-helpers";

describe("proporcionalizarMeta", () => {
  it("range cheio do mês (1-31 mai) retorna meta cheia", () => {
    const ini = new Date(2026, 4, 1); // 1 mai
    const fim = new Date(2026, 4, 31); // 31 mai (mês com 31 dias)
    expect(proporcionalizarMeta(10000, ini, fim)).toBeCloseTo(10000, 1);
  });

  it("range de 7 dias num mês de 31 → 7/31 da meta", () => {
    const ini = new Date(2026, 4, 1);
    const fim = new Date(2026, 4, 7);
    const r = proporcionalizarMeta(10000, ini, fim);
    expect(r).toBeCloseTo(10000 * (7 / 31), 1);
  });

  it("range de 1 dia → 1/diasNoMes", () => {
    const ini = new Date(2026, 4, 14);
    const fim = new Date(2026, 4, 14);
    expect(proporcionalizarMeta(10000, ini, fim)).toBeCloseTo(10000 / 31, 1);
  });

  it("fevereiro de 28 dias, range cheio → meta cheia", () => {
    const ini = new Date(2026, 1, 1);
    const fim = new Date(2026, 1, 28);
    expect(proporcionalizarMeta(5000, ini, fim)).toBeCloseTo(5000, 1);
  });

  it("meta null retorna null", () => {
    const ini = new Date(2026, 4, 1);
    const fim = new Date(2026, 4, 14);
    expect(proporcionalizarMeta(null, ini, fim)).toBeNull();
  });

  it("meta zero retorna null (sem meta configurada)", () => {
    const ini = new Date(2026, 4, 1);
    const fim = new Date(2026, 4, 14);
    expect(proporcionalizarMeta(0, ini, fim)).toBeNull();
  });

  it("meta negativa retorna null", () => {
    const ini = new Date(2026, 4, 1);
    const fim = new Date(2026, 4, 14);
    expect(proporcionalizarMeta(-100, ini, fim)).toBeNull();
  });
});

describe("calcularProgressoMeta", () => {
  it("metade do alvo → 50%", () => {
    expect(calcularProgressoMeta(5000, 10000)).toBe(50.0);
  });

  it("atingiu cravado → 100%", () => {
    expect(calcularProgressoMeta(10000, 10000)).toBe(100);
  });

  it("ultrapassou meta (estouro positivo é informação útil) → mostra >100%", () => {
    expect(calcularProgressoMeta(15000, 10000)).toBe(150);
  });

  it("zero faturado → 0%", () => {
    expect(calcularProgressoMeta(0, 10000)).toBe(0);
  });

  it("sem meta configurada (null) → null (frontend mostra 'sem meta')", () => {
    expect(calcularProgressoMeta(5000, null)).toBeNull();
  });

  it("meta zero → null (não tem como dividir)", () => {
    expect(calcularProgressoMeta(5000, 0)).toBeNull();
  });

  it("arredonda pra 1 casa decimal", () => {
    expect(calcularProgressoMeta(3333, 10000)).toBe(33.3);
    expect(calcularProgressoMeta(3337, 10000)).toBe(33.4);
  });
});

describe("percentInadimplenciaPorValor", () => {
  it("vencido = metade do esperado → 50%", () => {
    expect(percentInadimplenciaPorValor(5000, 10000)).toBe(50);
  });

  it("nada vencido → 0%", () => {
    expect(percentInadimplenciaPorValor(0, 10000)).toBe(0);
  });

  it("100% vencido → 100%", () => {
    expect(percentInadimplenciaPorValor(10000, 10000)).toBe(100);
  });

  it("total zero (nenhuma cobrança esperada) → 0%", () => {
    expect(percentInadimplenciaPorValor(0, 0)).toBe(0);
    expect(percentInadimplenciaPorValor(500, 0)).toBe(0);
  });

  it("arredonda pra 1 casa decimal", () => {
    expect(percentInadimplenciaPorValor(1234, 10000)).toBe(12.3);
  });
});

describe("percentInadimplenciaPorCliente", () => {
  it("3 inadimplentes em 10 clientes → 30%", () => {
    expect(percentInadimplenciaPorCliente(3, 10)).toBe(30);
  });

  it("todos os clientes pagaram → 0%", () => {
    expect(percentInadimplenciaPorCliente(0, 50)).toBe(0);
  });

  it("todos os clientes devendo → 100%", () => {
    expect(percentInadimplenciaPorCliente(10, 10)).toBe(100);
  });

  it("sem clientes → 0% (evita divisão por zero)", () => {
    expect(percentInadimplenciaPorCliente(0, 0)).toBe(0);
  });

  it("arredonda pra 1 casa decimal", () => {
    expect(percentInadimplenciaPorCliente(1, 3)).toBe(33.3);
  });
});

describe("taxaConclusaoNoPrazo", () => {
  it("todas concluídas no prazo → 100%", () => {
    expect(taxaConclusaoNoPrazo(10, 0)).toBe(100);
  });

  it("metade no prazo, metade fora → 50%", () => {
    expect(taxaConclusaoNoPrazo(5, 5)).toBe(50);
  });

  it("nenhuma no prazo → 0%", () => {
    expect(taxaConclusaoNoPrazo(0, 10)).toBe(0);
  });

  it("nenhuma concluída no período → null (frontend mostra '—')", () => {
    expect(taxaConclusaoNoPrazo(0, 0)).toBeNull();
  });

  it("arredonda pra 1 casa decimal", () => {
    expect(taxaConclusaoNoPrazo(2, 3)).toBe(40);
    expect(taxaConclusaoNoPrazo(1, 3)).toBe(25);
  });
});

describe("classificarTarefaPrazo", () => {
  const agora = new Date("2026-05-14T12:00:00Z");
  const ontem = new Date("2026-05-13T12:00:00Z");
  const amanha = new Date("2026-05-15T12:00:00Z");
  const semanaPassada = new Date("2026-05-07T12:00:00Z");

  it("pendente com venc futuro → no_prazo", () => {
    expect(classificarTarefaPrazo("pendente", amanha, null, agora)).toBe("no_prazo");
  });

  it("pendente com venc passado → atrasada", () => {
    expect(classificarTarefaPrazo("pendente", ontem, null, agora)).toBe("atrasada");
  });

  it("em_andamento com venc passado → atrasada", () => {
    expect(classificarTarefaPrazo("em_andamento", ontem, null, agora)).toBe("atrasada");
  });

  it("em_andamento com venc futuro → no_prazo", () => {
    expect(classificarTarefaPrazo("em_andamento", amanha, null, agora)).toBe("no_prazo");
  });

  it("pendente sem dataVencimento → no_prazo (não dá pra atrasar sem prazo)", () => {
    expect(classificarTarefaPrazo("pendente", null, null, agora)).toBe("no_prazo");
  });

  it("concluida + concluidaAt antes do venc → concluida_no_prazo", () => {
    expect(classificarTarefaPrazo("concluida", amanha, agora, agora)).toBe("concluida_no_prazo");
  });

  it("concluida + concluidaAt = venc → concluida_no_prazo (igualdade vale como no prazo)", () => {
    expect(classificarTarefaPrazo("concluida", agora, agora, agora)).toBe("concluida_no_prazo");
  });

  it("concluida + concluidaAt depois do venc → concluida_fora", () => {
    expect(classificarTarefaPrazo("concluida", semanaPassada, agora, agora)).toBe("concluida_fora");
  });

  it("concluida sem dataVencimento → concluida_no_prazo (default otimista)", () => {
    expect(classificarTarefaPrazo("concluida", null, agora, agora)).toBe("concluida_no_prazo");
  });

  it("concluida sem concluidaAt → concluida_no_prazo (sem timestamp, assume ok)", () => {
    expect(classificarTarefaPrazo("concluida", amanha, null, agora)).toBe("concluida_no_prazo");
  });

  it("cancelada → cancelada (não conta nas métricas)", () => {
    expect(classificarTarefaPrazo("cancelada", ontem, null, agora)).toBe("cancelada");
    expect(classificarTarefaPrazo("cancelada", null, null, agora)).toBe("cancelada");
  });

  it("comportamento na borda exata: venc = agora pra pendente → no_prazo", () => {
    expect(classificarTarefaPrazo("pendente", agora, null, agora)).toBe("no_prazo");
  });
});
