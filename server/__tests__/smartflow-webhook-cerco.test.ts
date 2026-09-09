/**
 * O passo de webhook do SmartFlow com cerco.
 *
 * O corpo do POST carrega o contexto do fluxo — nome, telefone e dados de
 * pagamento do cliente. A URL era aceita sem validação nenhuma: apontada pra
 * localhost ou pro IP de metadado da nuvem, o engine virava um proxy
 * autenticado dentro da infra (SSRF), com dado de cliente no payload. E sem
 * timeout, um endpoint pendurado segurava a conversa pra sempre.
 */

import { describe, expect, it } from "vitest";
import { validarUrlDeWebhook } from "../smartflow/executores";

describe("pra onde o webhook pode apontar", () => {
  it("endereço interno é recusado", () => {
    for (const url of [
      "http://localhost:3000/api/trpc",
      "http://127.0.0.1/admin",
      "http://0.0.0.0:8080/",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://10.0.3.7/segredo",
      "http://172.16.0.1/",
      "http://192.168.1.1/router",
      "http://db.railway.internal/",
      "http://impressora.local/",
    ]) {
      expect(() => validarUrlDeWebhook(url), url).toThrow(/interno/);
    }
  });

  it("esquema fora de http(s) é recusado", () => {
    for (const url of ["file:///etc/passwd", "ftp://x.com/a", "gopher://x/1"]) {
      expect(() => validarUrlDeWebhook(url), url).toThrow();
    }
  });

  it("destino externo legítimo continua passando", () => {
    for (const url of [
      "https://hooks.zapier.com/hooks/catch/123/abc",
      "https://n8n.escritorio.com.br/webhook/lead",
      "http://api.parceiro.com/receber",
    ]) {
      expect(validarUrlDeWebhook(url).hostname, url).toBeTruthy();
    }
  });
});

describe("o disparo em si", () => {
  it("tem teto de tempo e não segue redirect", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const s = readFileSync(join(__dirname, "..", "smartflow", "executores.ts"), "utf8");
    const i = s.indexOf("async chamarWebhook(");
    const corpo = s.slice(i, i + 1600);
    expect(corpo).toContain("AbortController");
    expect(corpo).toContain('redirect: "error"');
    // Redirect seguido às cegas furaria a validação: URL externa aprovada
    // respondendo 302 pra localhost.
    expect(corpo).toContain("validarUrlDeWebhook(url)");
  });
});
