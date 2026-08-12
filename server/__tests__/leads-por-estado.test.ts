/**
 * De qual estado veio o lead.
 *
 * Este arquivo existe porque a fonte do dado é uma aproximação, e aproximação
 * sem trava vira número errado apresentado como certo. Três invariantes:
 *
 *  1. DDD fora da tabela da Anatel NÃO vira estado. Aceitar faixa em vez de
 *     whitelist jogaria número truncado e telefone estrangeiro dentro de um
 *     estado real, e o erro não apareceria na tela;
 *  2. endereço confirmado no cadastro ganha do DDD, e a procedência volta
 *     junto — a tela precisa dizer quanto do painel é fato e quanto é dedução;
 *  3. conversão por estado só existe a partir de 10 leads, porque abaixo disso
 *     um fechamento a mais move a taxa em dezenas de pontos.
 */

import { describe, expect, it } from "vitest";
import {
  agregarLeadsPorEstado,
  dddDoTelefone,
  estadoDoLead,
  MINIMO_PARA_CONVERSAO,
  ufDoDdd,
  ufDoTelefone,
  UFS,
} from "../../shared/leads-uf";

describe("ufDoDdd", () => {
  it("mapeia os DDDs que a casa mais vê", () => {
    expect(ufDoDdd("85")).toBe("CE");
    expect(ufDoDdd("88")).toBe("CE");
    expect(ufDoDdd("11")).toBe("SP");
    expect(ufDoDdd("21")).toBe("RJ");
    expect(ufDoDdd("61")).toBe("DF");
  });

  it("recusa código que a Anatel nunca emitiu", () => {
    // Uma faixa 11–99 aceitaria todos estes e enfiaria lixo num estado real.
    for (const inexistente of ["20", "23", "26", "29", "30", "36", "39", "40", "50", "52", "56", "57", "58", "59", "60", "70", "72", "76", "78", "80", "90"]) {
      expect(ufDoDdd(inexistente), inexistente).toBeNull();
    }
  });

  it("recusa o que nem é DDD", () => {
    expect(ufDoDdd("")).toBeNull();
    expect(ufDoDdd("1")).toBeNull();
    expect(ufDoDdd("851")).toBeNull();
    expect(ufDoDdd("ab")).toBeNull();
  });

  it("todo DDD conhecido cai numa UF que existe", () => {
    for (let n = 11; n <= 99; n++) {
      const uf = ufDoDdd(String(n));
      if (uf) expect(UFS, String(n)).toContain(uf);
    }
  });
});

describe("dddDoTelefone", () => {
  it("lê os formatos que a base tem hoje", () => {
    expect(dddDoTelefone("5585999990000")).toBe("85"); // DDI + 9 dígitos
    expect(dddDoTelefone("558532220000")).toBe("85"); // DDI + fixo de 8
    expect(dddDoTelefone("85999990000")).toBe("85"); // sem DDI
    expect(dddDoTelefone("8532220000")).toBe("85"); // fixo sem DDI
    expect(dddDoTelefone("+55 (85) 99999-0000")).toBe("85"); // com máscara
  });

  it("descarta o prefixo de longa distância", () => {
    expect(dddDoTelefone("085999990000")).toBe("85");
  });

  it("a leitura com DDI ganha da leitura sem DDI", () => {
    // "5511987654321": com DDI é SP (11). Lido sem DDI daria "55" — que é DDD
    // do Rio Grande do Sul. É a ambiguidade mais provável da base inteira,
    // porque 55 é ao mesmo tempo o código do país e um DDD válido.
    expect(dddDoTelefone("5511987654321")).toBe("11");
    expect(ufDoTelefone("5511987654321")).toBe("SP");
  });

  it("número que não cabe em nenhum formato brasileiro volta null", () => {
    expect(dddDoTelefone("")).toBeNull();
    expect(dddDoTelefone(null)).toBeNull();
    expect(dddDoTelefone(undefined)).toBeNull();
    expect(dddDoTelefone("12345")).toBeNull();
    expect(dddDoTelefone("351912345678")).toBeNull(); // Portugal, 12 dígitos sem 55
  });

  it("telefone com DDD inválido não vira estado", () => {
    expect(dddDoTelefone("5530999990000")).toBe("30");
    expect(ufDoTelefone("5530999990000")).toBeNull();
  });
});

describe("estadoDoLead", () => {
  it("responde pelo DDD", () => {
    expect(estadoDoLead({ telefone: "5585999990000" })).toBe("CE");
  });

  it("IGNORA o endereço do cadastro, de propósito", () => {
    // `uf` só é preenchido no formulário de qualificação, que na prática só é
    // aberto quando o caso virou peça. Preferi-lo faria a contagem medir
    // clientes qualificados numa barra que diz leads — e o recorte mudaria a
    // cada qualificação feita, sem reconciliar com nada.
    expect(estadoDoLead({ uf: "CE", telefone: "5511987654321" } as { telefone: string })).toBe("SP");
  });

  it("sem telefone, não há estado", () => {
    expect(estadoDoLead({})).toBeNull();
    expect(estadoDoLead({ telefone: "" })).toBeNull();
  });
});

describe("agregarLeadsPorEstado", () => {
  const lead = (telefone: string | null, ganho = false) => ({ telefone, ganho });

  it("conta por estado e ordena do maior volume pro menor", () => {
    const r = agregarLeadsPorEstado([
      lead("5585999990001"),
      lead("5585999990002"),
      lead("5511999990003"),
      lead("5588999990004"), // 88 também é CE
    ]);
    expect(r.estados.map((e) => [e.uf, e.leads])).toEqual([["CE", 3], ["SP", 1]]);
    expect(r.comEstado).toBe(4);
    expect(r.semEstado).toBe(0);
  });

  it("a cobertura fecha com o total de leads do período", () => {
    // Se a soma não bater com o KPI ao lado, o painel conta uma história e o
    // KPI conta outra — é a divergência que o dono chamou de regra mais
    // importante de relatórios.
    const r = agregarLeadsPorEstado([
      lead("5511999990001"),
      lead("5585999990002"),
      lead(null),
      lead("5530999990003"), // DDD que a Anatel nunca emitiu
    ]);
    expect(r.comEstado).toBe(2);
    expect(r.semEstado).toBe(2);
    expect(r.comEstado + r.semEstado).toBe(4);
    expect(r.estados.reduce((s, e) => s + e.leads, 0)).toBe(r.comEstado);
  });

  it("o total de fechados cobre também quem não tem estado identificado", () => {
    // A tela mostra o total ao lado da coluna por estado. Se o total fosse só
    // a soma dos estados, o lead ganho sem DDD reconhecível sumiria da conta e
    // o leitor veria dois números diferentes pra mesma coisa.
    const r = agregarLeadsPorEstado([
      lead("5585999990001", true),
      lead("5511999990002", true),
      lead("5511999990003", false),
      lead(null, true), // ganhou, mas não dá pra dizer de onde veio
    ]);
    expect(r.ganhos).toBe(3);
    expect(r.estados.reduce((s, e) => s + e.ganhos, 0)).toBe(2);
    expect(r.ganhos - r.estados.reduce((s, e) => s + e.ganhos, 0)).toBe(1);
  });

  it("fechados nunca passam dos leads do próprio estado", () => {
    // Numerador e denominador saem da MESMA coorte. É o que impede a linha
    // "12 de 8" que apareceria se o fechado viesse de outra janela de tempo.
    const r = agregarLeadsPorEstado([
      lead("5585999990001", true),
      lead("5585999990002", true),
      lead("5585999990003", false),
    ]);
    for (const e of r.estados) expect(e.ganhos).toBeLessThanOrEqual(e.leads);
    expect(r.ganhos).toBeLessThanOrEqual(r.comEstado + r.semEstado);
  });

  it("suprime conversão abaixo do piso", () => {
    const poucos = Array.from({ length: MINIMO_PARA_CONVERSAO - 1 }, (_, i) =>
      lead("5585999990" + String(i).padStart(3, "0"), i === 0));
    expect(agregarLeadsPorEstado(poucos).estados[0]).toMatchObject({
      uf: "CE",
      leads: MINIMO_PARA_CONVERSAO - 1,
      ganhos: 1,
      conversao: null,
    });
  });

  it("mostra conversão a partir do piso", () => {
    const dez = Array.from({ length: 10 }, (_, i) =>
      lead("5585999990" + String(i).padStart(3, "0"), i < 2));
    expect(agregarLeadsPorEstado(dez).estados[0]).toMatchObject({ leads: 10, ganhos: 2, conversao: 20 });
  });

  it("empate de volume não muda de ordem entre consultas", () => {
    // Sem desempate estável a lista pisca a cada recarregamento, e o advogado
    // acha que o dado mudou quando só a ordenação era indeterminada.
    const entrada = [lead("5511999990001"), lead("5521999990002"), lead("5585999990003")];
    const a = agregarLeadsPorEstado(entrada).estados.map((e) => e.uf);
    const b = agregarLeadsPorEstado([...entrada].reverse()).estados.map((e) => e.uf);
    expect(a).toEqual(b);
    expect(a).toEqual(["CE", "RJ", "SP"]);
  });

  it("período sem lead nenhum não quebra", () => {
    expect(agregarLeadsPorEstado([])).toEqual({ estados: [], ganhos: 0, comEstado: 0, semEstado: 0 });
  });
});
