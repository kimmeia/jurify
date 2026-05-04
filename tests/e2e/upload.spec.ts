import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test.describe("Upload de arquivos", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "dono");
  });

  test("rejeita .exe disfarçado de .pdf via API tRPC", async ({ page }) => {
    // Buffer de PE/EXE inicia com "MZ" (0x4D 0x5A). Mandamos esse
    // conteúdo declarando MIME application/pdf — magic-number deve detectar.
    const exeMagic = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const padding = Buffer.alloc(1024, 0); // padding pra não dar arquivo vazio
    const buf = Buffer.concat([exeMagic, padding]);
    const base64 = buf.toString("base64");

    // page.request compartilha cookies com page.context() — sem isso,
    // a request bate sem auth e o backend rejeita por UNAUTHORIZED
    // antes de chegar na validação de magic number, mascarando o teste.
    const resp = await page.request.post("/api/trpc/upload.enviar?batch=1", {
      data: {
        "0": {
          json: {
            nome: "documento_falso.pdf",
            tipo: "application/pdf",
            base64,
            tamanho: buf.length,
          },
        },
      },
      headers: { "content-type": "application/json" },
    });

    // Espera erro 4xx (BAD_REQUEST) com mensagem indicando que o tipo
    // declarado não bate com o conteúdo.
    const text = await resp.text();
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    expect(text).toMatch(/tipo|conte[uú]do|n[aã]o bate|n[aã]o permit/i);
  });

  test("rejeita arquivo vazio", async ({ page }) => {
    const resp = await page.request.post("/api/trpc/upload.enviar?batch=1", {
      data: {
        "0": {
          json: {
            nome: "vazio.pdf",
            tipo: "application/pdf",
            base64: "",
            tamanho: 0,
          },
        },
      },
      headers: { "content-type": "application/json" },
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
  });
});
