/**
 * Smoke pós-deploy: verifica que SELECTs em users não dão 5xx.
 *
 * Esse teste existe em resposta ao incidente do PR #122 v1, onde
 * uma migration falhou silenciosamente e o servidor passou a gerar
 * 5xx em qualquer SELECT na tabela `users` (coluna referenciada não
 * existia). Detecção de schema desatualizado vs código.
 */

import { test, expect } from "@playwright/test";

test("auth.loginEmail com user inexistente NÃO retorna 5xx (schema OK)", async ({ request }) => {
  // Email que com certeza não existe no banco. Se o schema estiver
  // sincronizado, a query SELECT roda e retorna user=undefined → o tRPC
  // responde com erro de "credenciais inválidas" (4xx). Se a query falhar
  // por coluna inexistente, retorna 5xx — isso é o que queremos detectar.
  const fakeEmail = `nonexistent-${Date.now()}@nada-jurify.com.br`;

  const resp = await request.post("/api/trpc/auth.loginEmail?batch=1", {
    data: {
      "0": { json: { email: fakeEmail, password: "qualquerSenha123" } },
    },
    headers: { "content-type": "application/json" },
  });

  // 4xx = ok (auth/validação), 5xx = problema de schema/banco
  expect(
    resp.status(),
    `loginEmail retornou ${resp.status()} — provavelmente erro de schema. Response: ${await resp.text().catch(() => "")}`,
  ).toBeLessThan(500);
});

test("auth.me responde sem crash (cookie ausente)", async ({ request }) => {
  const resp = await request.get("/api/trpc/auth.me?input=" + encodeURIComponent(JSON.stringify({})));
  // me com cookie ausente deve retornar user=null em 200, ou no máximo 401.
  expect(resp.status()).toBeLessThan(500);
});
