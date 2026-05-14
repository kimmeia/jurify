/**
 * Testes do helper `deduplicarVinculosPorCustomer`.
 *
 * Bug original: `asaas_clientes` não tem UNIQUE (escritorioId,
 * asaasCustomerId). O cron `syncCobrancasEscritorio` itera sobre TODAS
 * as linhas — quando há duplicatas (bugs históricos no fluxo de
 * vincular contato ou data imports), a mesma cobrança Asaas é
 * consultada N vezes. Dobra consumo de cota do rate guard E faz
 * cobranças oscilarem entre contatos (cada iter sobrescreve contatoId).
 *
 * Regra de escolha: primario=true vence; tiebreak por menor id (estável).
 */

import { describe, it, expect } from "vitest";
import { deduplicarVinculosPorCustomer } from "../integracoes/asaas-sync";

describe("deduplicarVinculosPorCustomer", () => {
  it("sem duplicatas: retorna todos os vínculos", () => {
    const vinc = [
      { id: 1, asaasCustomerId: "cus_A", primario: true },
      { id: 2, asaasCustomerId: "cus_B", primario: true },
      { id: 3, asaasCustomerId: "cus_C", primario: false },
    ];
    const r = deduplicarVinculosPorCustomer(vinc);
    expect(r).toHaveLength(3);
    expect(r.map((v) => v.asaasCustomerId).sort()).toEqual(["cus_A", "cus_B", "cus_C"]);
  });

  it("duplicata simples: 2 linhas mesmo customerId → 1", () => {
    const vinc = [
      { id: 1, asaasCustomerId: "cus_X", primario: true },
      { id: 2, asaasCustomerId: "cus_X", primario: true },
    ];
    const r = deduplicarVinculosPorCustomer(vinc);
    expect(r).toHaveLength(1);
  });

  it("primário vence não-primário (independente da ordem)", () => {
    const vincPrimDepois = [
      { id: 5, asaasCustomerId: "cus_X", primario: false },
      { id: 99, asaasCustomerId: "cus_X", primario: true },
    ];
    const r1 = deduplicarVinculosPorCustomer(vincPrimDepois);
    expect(r1).toHaveLength(1);
    expect(r1[0].id).toBe(99);
    expect(r1[0].primario).toBe(true);

    const vincPrimAntes = [
      { id: 99, asaasCustomerId: "cus_X", primario: true },
      { id: 5, asaasCustomerId: "cus_X", primario: false },
    ];
    const r2 = deduplicarVinculosPorCustomer(vincPrimAntes);
    expect(r2).toHaveLength(1);
    expect(r2[0].id).toBe(99);
  });

  it("ambos primários ou ambos não: menor id vence (estável)", () => {
    const vincAmbosPrim = [
      { id: 10, asaasCustomerId: "cus_X", primario: true },
      { id: 3, asaasCustomerId: "cus_X", primario: true },
    ];
    expect(deduplicarVinculosPorCustomer(vincAmbosPrim)[0].id).toBe(3);

    const vincNenhumPrim = [
      { id: 10, asaasCustomerId: "cus_X", primario: false },
      { id: 3, asaasCustomerId: "cus_X", primario: false },
    ];
    expect(deduplicarVinculosPorCustomer(vincNenhumPrim)[0].id).toBe(3);
  });

  it("primario null/undefined trata como não-primário", () => {
    const vinc = [
      { id: 1, asaasCustomerId: "cus_X", primario: null as boolean | null },
      { id: 2, asaasCustomerId: "cus_X", primario: true },
    ];
    const r = deduplicarVinculosPorCustomer(vinc);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(2);
  });

  it("cenário de produção: 250 vínculos com ~80 duplicatas → reduz ao único set", () => {
    const vinc: Array<{ id: number; asaasCustomerId: string; primario: boolean }> = [];
    let id = 1;
    for (let i = 0; i < 170; i++) {
      vinc.push({ id: id++, asaasCustomerId: `cus_${i}`, primario: true });
    }
    // 80 duplicatas dos primeiros 80
    for (let i = 0; i < 80; i++) {
      vinc.push({ id: id++, asaasCustomerId: `cus_${i}`, primario: false });
    }
    const r = deduplicarVinculosPorCustomer(vinc);
    expect(r).toHaveLength(170);
    // Todos os escolhidos têm primario=true
    expect(r.every((v) => v.primario === true)).toBe(true);
  });

  it("lista vazia → retorna vazio", () => {
    expect(deduplicarVinculosPorCustomer([])).toEqual([]);
  });
});
