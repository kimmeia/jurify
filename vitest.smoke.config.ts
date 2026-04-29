/**
 * Config dedicada do smoke tRPC.
 *
 * Roda separado dos testes unitários (`pnpm test`) porque:
 *   1. Precisa de DATABASE_URL real configurada
 *   2. Demora mais (~60s) — não cabe no loop de dev rápido
 *   3. Tem comportamento diferente em CI (skip se DB ausente)
 *
 * Roda com: `pnpm test:smoke`
 */

import { defineConfig } from "vitest/config";
import path from "path";

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
      "@shared": path.resolve(root, "shared"),
      "@assets": path.resolve(root, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/smoke/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
