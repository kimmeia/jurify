/**
 * Testes de regressão pra bugs do engine-rescisao.ts.
 *
 * Bugs cobertos:
 * 1. 13º proporcional ignorava data de admissão — empregado admitido no mesmo
 *    ano da rescisão recebia 13º como se tivesse trabalhado desde janeiro.
 * 2. Férias proporcionais contavam mês parcial errado quando o dia de
 *    demissão era ANTES do dia de admissão (mesmo mês calendar).
 *
 * Fundamentação legal:
 * - 13º: Lei 4.090/1962 §2º — "fração igual ou superior a 15 dias de
 *   trabalho será havida como mês integral". Conta meses trabalhados NO ANO.
 * - Férias: CLT art. 146 par. único — "1/12 por mês de serviço ou fração
 *   superior a 14 dias" (= ≥15 dias). Conta meses do último aniversário.
 */

import { describe, expect, it } from "vitest";
import { calcularRescisao } from "./engine-rescisao";
import type { ParametrosRescisao } from "../../shared/trabalhista-types";

const baseParams: Omit<ParametrosRescisao, "dataAdmissao" | "dataDesligamento" | "tipoRescisao"> = {
  salarioBruto: 3000,
  tipoContrato: "indeterminado",
  avisoPrevioTrabalhado: false,
  avisoPrevioIndenizado: false,
  feriasVencidas: false,
};

describe("Bug 13º proporcional — admissão no mesmo ano da rescisão", () => {
  it("admitido em mar/2024, demitido em 10/jun/2024 → 3 avos (não 5)", () => {
    // Trabalhou: Mar (full), Abr (full), Mai (full), Jun 1-10 (10 dias < 15, não conta)
    // 3 avos × 3000 / 12 = 750
    const r = calcularRescisao({
      ...baseParams,
      dataAdmissao: "2024-03-01",
      dataDesligamento: "2024-06-10",
      tipoRescisao: "sem_justa_causa",
    });
    const decimo = r.verbas.find(v => v.descricao.startsWith("13º Salário"));
    expect(decimo).toBeDefined();
    expect(decimo!.valor).toBeCloseTo(750, 0);
    expect(decimo!.descricao).toContain("3/12");
  });

  it("admitido em mar/2024, demitido em 15/abr/2024 → 2 avos (não 4)", () => {
    // Trabalhou: Mar (full) + Abr 1-15 (15 dias >= 15, conta) = 2 avos
    // 2 avos × 3000 / 12 = 500
    const r = calcularRescisao({
      ...baseParams,
      dataAdmissao: "2024-03-01",
      dataDesligamento: "2024-04-15",
      tipoRescisao: "sem_justa_causa",
    });
    const decimo = r.verbas.find(v => v.descricao.startsWith("13º Salário"));
    expect(decimo).toBeDefined();
    expect(decimo!.valor).toBeCloseTo(500, 0);
    expect(decimo!.descricao).toContain("2/12");
  });

  it("admitido em set/2024, demitido em 10/nov/2024 → 2 avos (não 10)", () => {
    // Trabalhou: Set 1-30 (full), Out (full), Nov 1-10 (10 < 15) = 2 avos
    const r = calcularRescisao({
      ...baseParams,
      dataAdmissao: "2024-09-01",
      dataDesligamento: "2024-11-10",
      tipoRescisao: "sem_justa_causa",
    });
    const decimo = r.verbas.find(v => v.descricao.startsWith("13º Salário"));
    expect(decimo).toBeDefined();
    expect(decimo!.descricao).toContain("2/12");
  });

  it("REGRESSÃO: admitido em ano anterior → comportamento inalterado", () => {
    // Adm 2020, des Jun/2024: deve dar 5 avos (Jan-Mai completos, Jun < 15 dias)
    const r = calcularRescisao({
      ...baseParams,
      dataAdmissao: "2020-01-01",
      dataDesligamento: "2024-06-10",
      tipoRescisao: "sem_justa_causa",
    });
    const decimo = r.verbas.find(v => v.descricao.startsWith("13º Salário"));
    expect(decimo).toBeDefined();
    expect(decimo!.descricao).toContain("5/12");
    expect(decimo!.valor).toBeCloseTo(1250, 0);
  });
});

describe("Bug férias proporcionais — fração parcial de mês", () => {
  it("adm 20/mar, des 03/jul (parcial 14 dias) → 3 avos (não 4)", () => {
    // Aniversários: Mar20→Abr20 (1), Abr20→Mai20 (2), Mai20→Jun20 (3) completos.
    // Parcial Jun20→Jul3 = 14 dias. NÃO conta (precisa >14).
    const r = calcularRescisao({
      ...baseParams,
      dataAdmissao: "2024-03-20",
      dataDesligamento: "2024-07-03",
      tipoRescisao: "sem_justa_causa",
    });
    const ferias = r.verbas.find(v => v.descricao.startsWith("Férias Proporcionais"));
    expect(ferias).toBeDefined();
    expect(ferias!.descricao).toContain("3/12");
    expect(ferias!.valor).toBeCloseTo(750, 0);
  });

  it("adm 20/mar, des 02/abr (parcial 13 dias) → 0 avos (não 1)", () => {
    // Apenas 13 dias trabalhados no único período aquisitivo (Mar20→Apr20).
    // Não atinge 15 dias mínimos. Sem férias proporcionais.
    const r = calcularRescisao({
      ...baseParams,
      dataAdmissao: "2024-03-20",
      dataDesligamento: "2024-04-02",
      tipoRescisao: "sem_justa_causa",
    });
    const ferias = r.verbas.find(v => v.descricao.startsWith("Férias Proporcionais"));
    expect(ferias).toBeUndefined();
  });

  it("adm 20/mar, des 04/abr (parcial 16 dias) → 1 avo", () => {
    // 16 dias trabalhados >= 15. Conta 1 avo.
    const r = calcularRescisao({
      ...baseParams,
      dataAdmissao: "2024-03-20",
      dataDesligamento: "2024-04-04",
      tipoRescisao: "sem_justa_causa",
    });
    const ferias = r.verbas.find(v => v.descricao.startsWith("Férias Proporcionais"));
    expect(ferias).toBeDefined();
    expect(ferias!.descricao).toContain("1/12");
    expect(ferias!.valor).toBeCloseTo(250, 0);
  });

  it("adm 20/mar, des 03/abr (parcial 15 dias exatos) → 1 avo (>=15 conta)", () => {
    const r = calcularRescisao({
      ...baseParams,
      dataAdmissao: "2024-03-20",
      dataDesligamento: "2024-04-03",
      tipoRescisao: "sem_justa_causa",
    });
    const ferias = r.verbas.find(v => v.descricao.startsWith("Férias Proporcionais"));
    expect(ferias).toBeDefined();
    expect(ferias!.descricao).toContain("1/12");
  });
});
