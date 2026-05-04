import { test, expect } from "@playwright/test";

test("/api/health/live responde 200 com ambiente", async ({ request }) => {
  const resp = await request.get("/api/health/live");
  expect(resp.status()).toBe(200);
  const data = await resp.json();
  expect(data.ok).toBe(true);
  expect(typeof data.uptime).toBe("number");
  // CI seta JURIFY_AMBIENTE=test, então "test" é valor válido aqui também.
  expect(["production", "staging", "development", "test", undefined]).toContain(data.ambiente);
});

test("/api/health pinga DB e responde 200 quando saudável", async ({ request }) => {
  const resp = await request.get("/api/health");
  expect(resp.status()).toBe(200);
  const data = await resp.json();
  expect(data.ok).toBe(true);
  expect(data.db).toBe("ok");
  expect(typeof data.latencyMs).toBe("number");
  expect(data.latencyMs).toBeLessThan(2000);
});

test("/api/debug/templates não expõe endpoint debug", async ({ request }) => {
  // O endpoint de debug foi removido — qualquer request nesse path não
  // deve retornar JSON com dados internos (lista de templates, etc).
  // Como o catch-all do SPA serve o index.html pra rotas desconhecidas,
  // 200 é aceitável SE o conteúdo for HTML (não JSON com schema interno).
  const resp = await request.get("/api/debug/templates");
  const ct = resp.headers()["content-type"] || "";
  if (resp.status() === 200) {
    expect(ct).not.toMatch(/application\/json/i);
  } else {
    expect(resp.status()).toBeGreaterThanOrEqual(400);
  }
});
