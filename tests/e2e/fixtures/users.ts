/**
 * Contas seed pro robô E2E. Devem existir no banco antes dos testes
 * rodarem — criadas por `scripts/seed-staging.ts`.
 *
 * Senha padronizada pra simplicidade. NÃO USAR em produção (seed
 * recusa rodar lá).
 */

export const SEED_PASSWORD = "Smoke123!";

export const SEED_USERS = {
  admin: {
    email: "admin-smoke@jurify.com.br",
    name: "Admin Smoke",
    role: "admin" as const,
  },
  dono: {
    email: "dono-smoke@jurify.com.br",
    name: "Dono Smoke",
    role: "user" as const,
    cargo: "dono" as const,
  },
  gestor: {
    email: "gestor-smoke@jurify.com.br",
    name: "Gestor Smoke",
    role: "user" as const,
    cargo: "gestor" as const,
  },
  atendente: {
    email: "atendente-smoke@jurify.com.br",
    name: "Atendente Smoke",
    role: "user" as const,
    cargo: "atendente" as const,
  },
} as const;

export type SeedRole = keyof typeof SEED_USERS;

/** Prefixo usado em artefatos criados pelos testes — facilita teardown. */
export const E2E_PREFIX = "[E2E]";
