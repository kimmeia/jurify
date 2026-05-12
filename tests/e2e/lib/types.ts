/**
 * Tipos compartilhados pelos helpers de teste E2E.
 *
 * `TestRole` espelha o enum `colaboradores.cargo` do schema. Mantém em
 * sincronia se algum cargo novo for adicionado lá.
 */

export type TestRole = "dono" | "gestor" | "atendente" | "estagiario" | "sdr";

export const TEST_CARGOS: readonly TestRole[] = [
  "dono",
  "gestor",
  "atendente",
  "estagiario",
  "sdr",
] as const;

export interface TestUser {
  id: number;
  email: string;
  name: string;
  cargo: TestRole;
}

export interface TestEscritorio {
  id: number;
  nome: string;
  runId: string;
  users: Record<TestRole, TestUser>;
}
