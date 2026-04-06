/**
 * Testes para a lógica de créditos ao fazer upgrade/downgrade de plano.
 * Verifica que a mudança de plano é justa com o cliente:
 * - Upgrade: créditos restantes preservados + novos créditos do plano
 * - Downgrade: créditos restantes preservados + novos créditos do plano
 * - Idempotência: não soma repetidamente ao consultar o mesmo plano
 * - Avulsos: créditos avulsos são sempre preservados
 */
import { describe, it, expect } from "vitest";

/**
 * Simula a lógica de getUserCreditsInfo para mudança de plano.
 * Reproduz exatamente o que está em db.ts sem precisar de DB real.
 */
function simulatePlanChange(
  currentCreditsTotal: number,
  currentCreditsUsed: number,
  currentPlanId: string | null,
  newPlanId: string,
  newPlanCreditsLimit: number
): { creditsTotal: number; creditsUsed: number; creditsRemaining: number } {
  // Detectar mudança de plano via currentPlanId
  if (currentPlanId !== newPlanId) {
    // MUDANÇA DE PLANO DETECTADA
    // Regra justa: créditos restantes do plano anterior + créditos do novo plano
    const creditsRemaining = Math.max(0, currentCreditsTotal - currentCreditsUsed);
    const newTotal = currentCreditsUsed + creditsRemaining + newPlanCreditsLimit;
    const newRemaining = Math.max(0, newTotal - currentCreditsUsed);
    return { creditsTotal: newTotal, creditsUsed: currentCreditsUsed, creditsRemaining: newRemaining };
  }

  // Mesmo plano, sem mudança
  const creditsRemaining = Math.max(0, currentCreditsTotal - currentCreditsUsed);
  return { creditsTotal: currentCreditsTotal, creditsUsed: currentCreditsUsed, creditsRemaining };
}

describe("Créditos ao fazer UPGRADE de plano", () => {
  it("deve SOMAR créditos do novo plano aos restantes (Essencial → Profissional)", () => {
    // Tinha Essencial (30 créditos), usou 20, restam 10
    // Upgrade para Profissional (100 créditos)
    const result = simulatePlanChange(30, 20, "essencial", "profissional", 100);
    // Deve ter: 20 (usados) + 10 (restantes) + 100 (novos) = 130 total
    expect(result.creditsTotal).toBe(130);
    expect(result.creditsUsed).toBe(20);
    expect(result.creditsRemaining).toBe(110); // 130 - 20 = 110
  });

  it("deve SOMAR créditos quando upgrade de Profissional para Ilimitado", () => {
    // Tinha Profissional (100 créditos), usou 50, restam 50
    // Upgrade para Ilimitado (999999 créditos)
    const result = simulatePlanChange(100, 50, "profissional", "ilimitado", 999999);
    expect(result.creditsTotal).toBe(50 + 50 + 999999);
    expect(result.creditsUsed).toBe(50);
    expect(result.creditsRemaining).toBe(50 + 999999);
  });

  it("deve funcionar quando utilizador usou todos os créditos e faz upgrade", () => {
    // Tinha Essencial (30 créditos), usou todos (30/30)
    // Upgrade para Profissional (100 créditos)
    const result = simulatePlanChange(30, 30, "essencial", "profissional", 100);
    // Deve ter: 30 (usados) + 0 (restantes) + 100 (novos) = 130 total
    expect(result.creditsTotal).toBe(130);
    expect(result.creditsUsed).toBe(30);
    expect(result.creditsRemaining).toBe(100); // Exatamente os 100 novos
  });

  it("deve funcionar quando utilizador não usou nenhum crédito e faz upgrade", () => {
    // Tinha Essencial (30 créditos), não usou nenhum
    // Upgrade para Profissional (100 créditos)
    const result = simulatePlanChange(30, 0, "essencial", "profissional", 100);
    // Deve ter: 0 (usados) + 30 (restantes) + 100 (novos) = 130 total
    expect(result.creditsTotal).toBe(130);
    expect(result.creditsUsed).toBe(0);
    expect(result.creditsRemaining).toBe(130);
  });
});

describe("Créditos ao fazer DOWNGRADE de plano", () => {
  it("deve preservar créditos restantes + novos do plano menor (Ilimitado → Essencial)", () => {
    // Tinha Ilimitado (999999 créditos), usou 50, restam 999949
    // Downgrade para Essencial (30 créditos)
    const result = simulatePlanChange(999999, 50, "ilimitado", "essencial", 30);
    // Deve ter: 50 (usados) + 999949 (restantes) + 30 (novos) = 1000029 total
    expect(result.creditsTotal).toBe(50 + 999949 + 30);
    expect(result.creditsUsed).toBe(50);
    expect(result.creditsRemaining).toBe(999949 + 30);
  });

  it("deve preservar créditos restantes + novos do plano menor (Profissional → Essencial)", () => {
    // Tinha Profissional (100 créditos), usou 80, restam 20
    // Downgrade para Essencial (30 créditos)
    const result = simulatePlanChange(100, 80, "profissional", "essencial", 30);
    // Deve ter: 80 (usados) + 20 (restantes) + 30 (novos) = 130 total
    expect(result.creditsTotal).toBe(130);
    expect(result.creditsUsed).toBe(80);
    expect(result.creditsRemaining).toBe(50); // 20 restantes + 30 novos
  });

  it("deve funcionar quando utilizador usou todos os créditos e faz downgrade", () => {
    // Tinha Profissional (100 créditos), usou todos (100/100)
    // Downgrade para Essencial (30 créditos)
    const result = simulatePlanChange(100, 100, "profissional", "essencial", 30);
    // Deve ter: 100 (usados) + 0 (restantes) + 30 (novos) = 130 total
    expect(result.creditsTotal).toBe(130);
    expect(result.creditsUsed).toBe(100);
    expect(result.creditsRemaining).toBe(30); // Exatamente os 30 novos
  });

  it("deve funcionar quando utilizador não usou nenhum crédito e faz downgrade", () => {
    // Tinha Ilimitado (999999 créditos), não usou nenhum
    // Downgrade para Essencial (30 créditos)
    const result = simulatePlanChange(999999, 0, "ilimitado", "essencial", 30);
    // Deve ter: 0 (usados) + 999999 (restantes) + 30 (novos) = 1000029 total
    expect(result.creditsTotal).toBe(1000029);
    expect(result.creditsUsed).toBe(0);
    expect(result.creditsRemaining).toBe(1000029);
  });
});

describe("Idempotência e cenários especiais", () => {
  it("não deve alterar créditos quando plano é o mesmo (consulta normal)", () => {
    // Utilizador tem Essencial (30 créditos), usou 10
    // Consulta novamente com mesmo plano
    const result = simulatePlanChange(30, 10, "essencial", "essencial", 30);
    expect(result.creditsTotal).toBe(30);
    expect(result.creditsUsed).toBe(10);
    expect(result.creditsRemaining).toBe(20);
  });

  it("não deve somar repetidamente após upgrade (idempotência)", () => {
    // Após upgrade para Profissional, creditsTotal=130, currentPlanId="profissional"
    // Na próxima consulta, plano continua "profissional"
    const result = simulatePlanChange(130, 20, "profissional", "profissional", 100);
    // Não é mudança de plano, mantém
    expect(result.creditsTotal).toBe(130);
    expect(result.creditsUsed).toBe(20);
    expect(result.creditsRemaining).toBe(110);
  });

  it("não deve somar repetidamente após downgrade (idempotência)", () => {
    // Após downgrade para Essencial, creditsTotal=130, currentPlanId="essencial"
    // Na próxima consulta, plano continua "essencial"
    const result = simulatePlanChange(130, 80, "essencial", "essencial", 30);
    // Não é mudança de plano, mantém
    expect(result.creditsTotal).toBe(130);
    expect(result.creditsUsed).toBe(80);
    expect(result.creditsRemaining).toBe(50);
  });

  it("deve preservar créditos avulsos ao mudar de plano", () => {
    // Utilizador tinha 50 créditos (30 do plano + 20 avulsos), currentPlanId="essencial"
    // Upgrade para Profissional (100 créditos)
    const result = simulatePlanChange(50, 15, "essencial", "profissional", 100);
    // Deve ter: 15 (usados) + 35 (restantes incluindo avulsos) + 100 (novos) = 150 total
    expect(result.creditsTotal).toBe(150);
    expect(result.creditsUsed).toBe(15);
    expect(result.creditsRemaining).toBe(135); // 35 restantes + 100 novos
  });

  it("deve funcionar com currentPlanId null (migração de dados antigos)", () => {
    // Utilizador antigo sem currentPlanId no registo
    // Assina Essencial (30 créditos)
    const result = simulatePlanChange(10, 5, null, "essencial", 30);
    // null !== "essencial" → mudança detectada
    // Deve ter: 5 (usados) + 5 (restantes) + 30 (novos) = 40 total
    expect(result.creditsTotal).toBe(40);
    expect(result.creditsUsed).toBe(5);
    expect(result.creditsRemaining).toBe(35);
  });

  it("deve funcionar com upgrade seguido de downgrade (cenário real do bug)", () => {
    // 1. Utilizador começa com Essencial (30), usa 9
    let result = simulatePlanChange(30, 9, "essencial", "essencial", 30);
    expect(result.creditsRemaining).toBe(21);

    // 2. Upgrade para Ilimitado
    result = simulatePlanChange(30, 9, "essencial", "ilimitado", 999999);
    expect(result.creditsTotal).toBe(9 + 21 + 999999); // 1000029
    expect(result.creditsRemaining).toBe(21 + 999999); // 1000020

    // 3. Downgrade para Essencial (após usar mais 41 créditos = total 50 usados)
    // creditsTotal agora é 1000029, usou 50
    result = simulatePlanChange(1000029, 50, "ilimitado", "essencial", 30);
    // restantes = 1000029 - 50 = 999979
    // novo total = 50 + 999979 + 30 = 1000059
    expect(result.creditsTotal).toBe(1000059);
    expect(result.creditsUsed).toBe(50);
    expect(result.creditsRemaining).toBe(1000009); // 999979 + 30
  });
});
