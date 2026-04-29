import { test, expect } from "@playwright/test";

test("/api/health/live responde 200 com ambiente", async ({ request }) => {
  const resp = await request.get("/api/health/live");
  expect(resp.status()).toBe(200);
  const data = await resp.json();
  expect(data.ok).toBe(true);
  expect(typeof data.uptime).toBe("number");
  expect(["production", "staging", "development", undefined]).toContain(data.ambiente);
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

test("/api/debug/templates retorna 404 (endpoint debug removido)", async ({ request }) => {
  const resp = await request.get("/api/debug/templates");
  expect(resp.status()).toBe(404);
});
