import { test, expect } from "@playwright/test";

test("cabeçalhos de segurança HTTP estão presentes", async ({ request }) => {
  const resp = await request.get("/");
  expect(resp.status()).toBeGreaterThanOrEqual(200);
  expect(resp.status()).toBeLessThan(400);

  const headers = resp.headers();

  // Strict-Transport-Security: HSTS ligado, max-age 1 ano.
  expect(headers["strict-transport-security"]).toBeTruthy();
  expect(headers["strict-transport-security"]).toMatch(/max-age=\d+/);

  // X-Frame-Options: barra clickjacking.
  expect(headers["x-frame-options"]).toBeTruthy();

  // X-Content-Type-Options: barra MIME sniffing.
  expect(headers["x-content-type-options"]).toBe("nosniff");

  // Referrer-Policy: privacidade do referrer.
  expect(headers["referrer-policy"]).toBeTruthy();

  // X-Powered-By: removido pelo helmet pra não expor stack.
  expect(headers["x-powered-by"]).toBeUndefined();

  // Cross-Origin-Opener-Policy: configurado manualmente pra permitir
  // popup do Google Sign-In via postMessage.
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
});
