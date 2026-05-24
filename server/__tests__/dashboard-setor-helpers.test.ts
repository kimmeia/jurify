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
  calcularRangeCashFlow,
  resolverRangeCashFlow,
} from "../routers/dashboard-setor-helpers";
import { metaProporcionalPeriodo } from "../escritorio/router-relatorios";

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

  // Regressão: com HORA no range (ex.: mês vigente à tarde, ou filtro até
  // 23:59:59), a contagem de dias precisa ser floor(diff)+1 — NÃO round.
  // Math.round inflava o range em 1 dia e baixava o % da meta só aqui.
  it("range com hora à tarde (1mai 00h → 23mai 18h) conta 23 dias, não 24", () => {
    const ini = new Date(2026, 4, 1, 0, 0, 0);
    const fim = new Date(2026, 4, 23, 18, 0, 0);
    // 30000 * 23/31 = 22258.06 (com round seria 24/31 = 23225.81)
    expect(proporcionalizarMeta(30000, ini, fim)).toBeCloseTo(30000 * (23 / 31), 1);
  });

  it("filtro de data até 23:59:59 (1mai → 23mai 23:59:59) conta 23 dias", () => {
    const ini = new Date(2026, 4, 1, 0, 0, 0);
    const fim = new Date(2026, 4, 23, 23, 59, 59);
    expect(proporcionalizarMeta(30000, ini, fim)).toBeCloseTo(30000 * (23 / 31), 1);
  });

  it("manhã e tarde do mesmo dia dão o MESMO resultado (estável ao longo do dia)", () => {
    const ini = new Date(2026, 4, 1, 0, 0, 0);
    const manha = proporcionalizarMeta(30000, ini, new Date(2026, 4, 23, 9, 0, 0));
    const tarde = proporcionalizarMeta(30000, ini, new Date(2026, 4, 23, 18, 0, 0));
    expect(manha).toBe(tarde);
  });

  it("range maior que o mês escala acima de 100% (sem teto, como o relatório)", () => {
    // 1 mar → 31 mai ≈ 92 dias; mês de início (março) tem 31 dias.
    const ini = new Date(2026, 2, 1, 0, 0, 0);
    const fim = new Date(2026, 4, 31, 0, 0, 0);
    const r = proporcionalizarMeta(30000, ini, fim)!;
    // Antes (com Math.min(1, ...)) travava em 30000; agora escala proporcional.
    expect(r).toBeGreaterThan(30000);
  });
});

describe("proporcionalizarMeta × metaProporcionalPeriodo — paridade dashboard/relatório", () => {
  // O dashboard comercial e o relatório comercial mostram "% da meta" pra
  // mesma pessoa/período. Ambos partem da meta proporcional ao range, então
  // os dois helpers TÊM que dar o mesmo número — senão as telas divergem.
  const meta = 30000;
  const cenarios: Array<[string, Date, Date]> = [
    ["mês vigente à tarde", new Date(2026, 4, 1, 0, 0, 0), new Date(2026, 4, 23, 18, 0, 0)],
    ["mês vigente de manhã", new Date(2026, 4, 1, 0, 0, 0), new Date(2026, 4, 23, 9, 0, 0)],
    ["filtro até 23:59:59", new Date(2026, 4, 1, 0, 0, 0), new Date(2026, 4, 23, 23, 59, 59)],
    ["range de 7 dias cravados", new Date(2026, 4, 1, 0, 0, 0), new Date(2026, 4, 7, 0, 0, 0)],
    ["cross-mês curto (25abr → 5mai)", new Date(2026, 3, 25, 0, 0, 0), new Date(2026, 4, 5, 23, 59, 59)],
    ["multi-mês (1mar → 31mai)", new Date(2026, 2, 1, 0, 0, 0), new Date(2026, 4, 31, 0, 0, 0)],
  ];

  for (const [nome, ini, fim] of cenarios) {
    it(`${nome}: dashboard === relatório`, () => {
      const dash = proporcionalizarMeta(meta, ini, fim);
      const rel = +metaProporcionalPeriodo(meta, ini, fim).toFixed(2);
      expect(dash).toBe(rel);
    });
  }
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

describe("calcularRangeCashFlow", () => {
  // Constrói Date no UTC pra inicioStr/pontosKeys (que usam toISOString)
  // baterem com o dia "civil" esperado independentemente do timezone do CI.
  function utcMidday(y: number, mZeroIdx: number, d: number): Date {
    return new Date(Date.UTC(y, mZeroIdx, d, 12, 0, 0));
  }

  it("cenário do bug: 21/mai com days=21 → 01/mai a 21/mai (era 30/abr)", () => {
    const hoje = utcMidday(2026, 4, 21);
    const r = calcularRangeCashFlow(21, hoje);
    expect(r.inicioStr).toBe("2026-05-01");
    expect(r.pontosKeys[0]).toBe("2026-05-01");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-05-21");
    expect(r.pontosKeys).toHaveLength(21);
  });

  it("dia 1 do mês (days=1) → range de 1 dia só, sem virar mês anterior", () => {
    const hoje = utcMidday(2026, 4, 1);
    const r = calcularRangeCashFlow(1, hoje);
    expect(r.inicioStr).toBe("2026-05-01");
    expect(r.pontosKeys).toEqual(["2026-05-01"]);
  });

  it("primeiros 6 dias do mês (days 2-6) → range correto, sempre começando em 01/mai", () => {
    for (let dia = 2; dia <= 6; dia++) {
      const hoje = utcMidday(2026, 4, dia);
      const r = calcularRangeCashFlow(dia, hoje);
      expect(r.inicioStr).toBe("2026-05-01");
      expect(r.pontosKeys[0]).toBe("2026-05-01");
      expect(r.pontosKeys).toHaveLength(dia);
      expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe(
        `2026-05-${String(dia).padStart(2, "0")}`,
      );
    }
  });

  it("último dia de mês 31 (days=31) → inclui dia 1 e dia 31, 31 pontos", () => {
    const hoje = utcMidday(2026, 4, 31);
    const r = calcularRangeCashFlow(31, hoje);
    expect(r.inicioStr).toBe("2026-05-01");
    expect(r.pontosKeys[0]).toBe("2026-05-01");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-05-31");
    expect(r.pontosKeys).toHaveLength(31);
  });

  it("fevereiro bissexto (2024): 29/fev com days=29 → 01/fev a 29/fev", () => {
    const hoje = utcMidday(2024, 1, 29);
    const r = calcularRangeCashFlow(29, hoje);
    expect(r.inicioStr).toBe("2024-02-01");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2024-02-29");
    expect(r.pontosKeys).toHaveLength(29);
  });

  it("fevereiro não-bissexto (2026): 28/fev com days=28 → 01/fev a 28/fev", () => {
    const hoje = utcMidday(2026, 1, 28);
    const r = calcularRangeCashFlow(28, hoje);
    expect(r.inicioStr).toBe("2026-02-01");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-02-28");
    expect(r.pontosKeys).toHaveLength(28);
  });

  it("default 30 dias atravessa virada de mês (21/mai → 22/abr a 21/mai)", () => {
    const hoje = utcMidday(2026, 4, 21);
    const r = calcularRangeCashFlow(30, hoje);
    expect(r.inicioStr).toBe("2026-04-22");
    expect(r.pontosKeys[0]).toBe("2026-04-22");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-05-21");
    expect(r.pontosKeys).toHaveLength(30);
  });

  it("virada de ano: 03/jan/2026 com days=3 → 01/jan a 03/jan, sem virar pra 2025", () => {
    const hoje = utcMidday(2026, 0, 3);
    const r = calcularRangeCashFlow(3, hoje);
    expect(r.pontosKeys).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("virada de ano para trás: 02/jan/2026 com days=10 → atravessa pra dez/2025", () => {
    const hoje = utcMidday(2026, 0, 2);
    const r = calcularRangeCashFlow(10, hoje);
    expect(r.inicioStr).toBe("2025-12-24");
    expect(r.pontosKeys[0]).toBe("2025-12-24");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-01-02");
    expect(r.pontosKeys).toHaveLength(10);
  });

  it("pontosKeys são únicos (sem dia duplicado)", () => {
    const hoje = utcMidday(2026, 4, 21);
    const r = calcularRangeCashFlow(21, hoje);
    expect(new Set(r.pontosKeys).size).toBe(r.pontosKeys.length);
  });

  it("inicioStr é o primeiro elemento de pontosKeys", () => {
    const hoje = utcMidday(2026, 4, 21);
    const r = calcularRangeCashFlow(21, hoje);
    expect(r.inicioStr).toBe(r.pontosKeys[0]);
  });

  it("não muta o parâmetro `hoje` recebido", () => {
    const hoje = utcMidday(2026, 4, 21);
    const antes = hoje.getTime();
    calcularRangeCashFlow(21, hoje);
    expect(hoje.getTime()).toBe(antes);
  });
});

describe("resolverRangeCashFlow — range do Painel Geral no fuso do escritório", () => {
  const SP = "America/Sao_Paulo"; // UTC-3
  const MANAUS = "America/Manaus"; // UTC-4

  // Bug reportado: server em UTC + horário noturno BRT fazia o range começar
  // no dia 02. `agora` aqui é sempre o INSTANTE UTC (como o server vê), e o
  // range precisa refletir o dia CIVIL no fuso do escritório.

  it("BUG: 23/mai 22h BRT (= 24/mai 01h UTC) → começa em 01/mai, NÃO 02", () => {
    const agora = new Date("2026-05-24T01:00:00Z");
    const r = resolverRangeCashFlow(agora, SP);
    expect(r.inicioStr).toBe("2026-05-01");
    expect(r.pontosKeys[0]).toBe("2026-05-01");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-05-23");
    expect(r.pontosKeys).toHaveLength(23);
  });

  it("meio do dia (24/mai 12h BRT = 15h UTC) → 01/mai a 24/mai, 24 pontos", () => {
    const agora = new Date("2026-05-24T15:00:00Z");
    const r = resolverRangeCashFlow(agora, SP);
    expect(r.inicioStr).toBe("2026-05-01");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-05-24");
    expect(r.pontosKeys).toHaveLength(24);
  });

  it("estável nas 24h do dia: qualquer hora de 15/mai BRT → sempre 01→15/mai", () => {
    // Varre 00h..23h BRT do dia 15 (incluindo 21h-23h, a janela que bugava).
    // hora BRT h ↔ instante UTC h+3 (pode virar pro dia 16 em UTC).
    for (let horaBrt = 0; horaBrt <= 23; horaBrt++) {
      const agora = new Date(Date.UTC(2026, 4, 15, horaBrt + 3, 0, 0));
      const r = resolverRangeCashFlow(agora, SP);
      expect(r.inicioStr).toBe("2026-05-01");
      expect(r.pontosKeys[0]).toBe("2026-05-01");
      expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-05-15");
      expect(r.pontosKeys).toHaveLength(15);
    }
  });

  it("manhã e noite do MESMO dia civil BR dão range idêntico", () => {
    const manha = resolverRangeCashFlow(new Date("2026-05-23T13:00:00Z"), SP); // 10h BRT dia 23
    const noite = resolverRangeCashFlow(new Date("2026-05-24T01:00:00Z"), SP); // 22h BRT dia 23
    expect(noite.inicioStr).toBe(manha.inicioStr);
    expect(noite.pontosKeys).toEqual(manha.pontosKeys);
  });

  it("dia 1 à noite (01/mai 22h BRT = 02/mai 01h UTC) → só [01/mai], 1 ponto", () => {
    const agora = new Date("2026-05-02T01:00:00Z");
    const r = resolverRangeCashFlow(agora, SP);
    expect(r.pontosKeys).toEqual(["2026-05-01"]);
  });

  it("virada de mês à noite BRT (31/mai 22h = 01/jun 01h UTC) → maio inteiro, não junho", () => {
    const agora = new Date("2026-06-01T01:00:00Z");
    const r = resolverRangeCashFlow(agora, SP);
    expect(r.inicioStr).toBe("2026-05-01");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-05-31");
    expect(r.pontosKeys).toHaveLength(31);
  });

  it("virada de ano à noite BRT (31/dez 22h = 01/jan 01h UTC) → dezembro/2025", () => {
    const agora = new Date("2026-01-01T01:00:00Z");
    const r = resolverRangeCashFlow(agora, SP);
    expect(r.inicioStr).toBe("2025-12-01");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2025-12-31");
    expect(r.pontosKeys).toHaveLength(31);
  });

  it("fuso Manaus (UTC-4): 23/mai 22h AMT (= 24/mai 02h UTC) → começa em 01/mai", () => {
    const agora = new Date("2026-05-24T02:00:00Z");
    const r = resolverRangeCashFlow(agora, MANAUS);
    expect(r.inicioStr).toBe("2026-05-01");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-05-23");
  });

  it("fusos diferentes no MESMO instante podem cair em dias civis distintos", () => {
    // 24/mai 03:30 UTC → SP (UTC-3) = 00:30 dia 24; Manaus (UTC-4) = 23:30 dia 23.
    const agora = new Date("2026-05-24T03:30:00Z");
    const sp = resolverRangeCashFlow(agora, SP);
    const manaus = resolverRangeCashFlow(agora, MANAUS);
    expect(sp.pontosKeys[sp.pontosKeys.length - 1]).toBe("2026-05-24");
    expect(manaus.pontosKeys[manaus.pontosKeys.length - 1]).toBe("2026-05-23");
    expect(sp.inicioStr).toBe("2026-05-01");
    expect(manaus.inicioStr).toBe("2026-05-01");
  });

  it("daysOverride: pede 'últimos 7 dias' terminando hoje (no fuso)", () => {
    const agora = new Date("2026-05-24T15:00:00Z"); // 12h BRT dia 24
    const r = resolverRangeCashFlow(agora, SP, 7);
    expect(r.inicioStr).toBe("2026-05-18");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-05-24");
    expect(r.pontosKeys).toHaveLength(7);
  });

  it("daysOverride atravessa virada de mês mesmo na janela noturna", () => {
    const agora = new Date("2026-05-02T01:00:00Z"); // 01/mai 22h BRT
    const r = resolverRangeCashFlow(agora, SP, 10);
    expect(r.inicioStr).toBe("2026-04-22");
    expect(r.pontosKeys[r.pontosKeys.length - 1]).toBe("2026-05-01");
    expect(r.pontosKeys).toHaveLength(10);
  });

  it("inicioStr é sempre o primeiro ponto e (sem override) é sempre dia 01", () => {
    for (let dia = 1; dia <= 28; dia++) {
      const agora = new Date(Date.UTC(2026, 4, dia, 15, 0, 0)); // meio-dia BRT
      const r = resolverRangeCashFlow(agora, SP);
      expect(r.inicioStr).toBe(r.pontosKeys[0]);
      expect(r.pontosKeys[0]).toBe("2026-05-01");
      expect(r.pontosKeys).toHaveLength(dia);
    }
  });

  it("não muta o parâmetro `agora` recebido", () => {
    const agora = new Date("2026-05-24T01:00:00Z");
    const antes = agora.getTime();
    resolverRangeCashFlow(agora, SP);
    expect(agora.getTime()).toBe(antes);
  });
});
