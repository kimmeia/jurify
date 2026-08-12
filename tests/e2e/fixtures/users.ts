/**
 * Contas seed pro robô E2E. Devem existir no banco antes dos testes
 * rodarem — criadas por `scripts/seed-staging.ts`.
 *
 * A senha tem que sair da MESMA fonte que o seed usa, senão o robô tenta
 * entrar com uma e a conta foi criada com outra. O valor de fábrica serve pro
 * banco descartável da CI; contra staging, `SMOKE_PASSWORD` vem de secret —
 * senha publicada no repositório não pode virar credencial de ambiente vivo.
 *
 * NÃO USAR em produção: o seed recusa rodar lá.
 */

export const SEED_PASSWORD = process.env.SMOKE_PASSWORD || "Smoke123!";

export const SEED_USERS = {
  admin: {
    email: "admin-smoke@juridflow.com.br",
    name: "Admin Smoke",
    role: "admin" as const,
  },
  dono: {
    email: "dono-smoke@juridflow.com.br",
    name: "Dono Smoke",
    role: "user" as const,
    cargo: "dono" as const,
  },
  gestor: {
    email: "gestor-smoke@juridflow.com.br",
    name: "Gestor Smoke",
    role: "user" as const,
    cargo: "gestor" as const,
  },
  atendente: {
    email: "atendente-smoke@juridflow.com.br",
    name: "Atendente Smoke",
    role: "user" as const,
    cargo: "atendente" as const,
  },
} as const;

export type SeedRole = keyof typeof SEED_USERS;

/** Prefixo usado em artefatos criados pelos testes — facilita teardown. */
export const E2E_PREFIX = "[E2E]";
