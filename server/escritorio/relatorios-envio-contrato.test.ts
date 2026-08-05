/**
 * Contrato entre `gerarRelatorioPdf` e o router.
 *
 * O despacho é por nome de procedure em objeto `any` — TypeScript não vê o
 * erro se o nome estiver errado ou se o caller não enxergar aquele router.
 * Foi exatamente isso que quebrou uma vez: `enviarPorEmail` usava o caller do
 * `relatoriosRouter`, e as procedures de export vivem no `relatoriosPdfRouter`.
 */

import { describe, it, expect } from "vitest";
import { mergeRouters } from "../_core/trpc";
import { relatoriosRouter, relatoriosPdfRouter } from "./router-relatorios";
import { RELATORIOS_ENVIAVEIS } from "./relatorios-envio";

/** Procedures que `gerarRelatorioPdf` invoca por relatório. */
const CHAMADAS: Record<string, string[]> = {
  atendimento: ["exportarAtendimentoPdf", "atendimento"],
  comercial: ["exportarComercialPdf", "comercialDashboard"],
  producao: ["exportarProducaoPdf", "producao"],
  agenda: ["exportarAgendaPdf", "agenda"],
  // financeiro não passa pelo router — gera o DRE direto.
  financeiro: [],
};

const completo = mergeRouters(relatoriosRouter, relatoriosPdfRouter);
const disponiveis = new Set(Object.keys((completo as any)._def.procedures));

describe("contrato de envio de relatórios", () => {
  it("cobre todos os relatórios enviáveis", () => {
    expect(Object.keys(CHAMADAS).sort()).toEqual([...RELATORIOS_ENVIAVEIS].sort());
  });

  for (const [relatorio, procedures] of Object.entries(CHAMADAS)) {
    for (const nome of procedures) {
      it(`${relatorio}: o router expõe ${nome}`, () => {
        expect(disponiveis.has(nome)).toBe(true);
      });
    }
  }

  it("o merge não perde procedure de nenhum dos dois routers", () => {
    for (const nome of Object.keys((relatoriosRouter as any)._def.procedures)) {
      expect(disponiveis.has(nome)).toBe(true);
    }
    for (const nome of Object.keys((relatoriosPdfRouter as any)._def.procedures)) {
      expect(disponiveis.has(nome)).toBe(true);
    }
  });
});
