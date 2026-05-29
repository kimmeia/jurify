/**
 * Testes — `criarCanal` (db-canais).
 *
 * Foca no campo `registradoCloudApi`: o cadastro MANUAL de WhatsApp Cloud
 * precisa gravar `true` (número já operacional na BM do cliente) pra UI não
 * travar o canal no fluxo de PIN/registro do Embedded Signup. Os demais
 * canais continuam com o default `false`.
 *
 * getDb e crypto-utils mockados — captura os `values` do insert sem tocar
 * banco nem chave de criptografia real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: { insertValues: any } = { insertValues: null };

const dbStub = {
  insert: () => ({
    values: (v: any) => {
      captured.insertValues = v;
      return Promise.resolve([{ insertId: 123 }]);
    },
  }),
};

vi.mock("../db", () => ({ getDb: async () => dbStub }));

vi.mock("../escritorio/crypto-utils", () => ({
  encryptConfig: () => ({ encrypted: "ENC", iv: "IV", tag: "TAG" }),
  decryptConfig: () => ({}),
  maskToken: (t: string) => t,
  generateWebhookSecret: () => "secret123",
}));

const { criarCanal } = await import("../escritorio/db-canais");

beforeEach(() => {
  captured.insertValues = null;
});

describe("criarCanal — registradoCloudApi", () => {
  it("grava registradoCloudApi=true quando passado (cadastro manual)", async () => {
    const id = await criarCanal({
      escritorioId: 1,
      tipo: "whatsapp_api",
      nome: "WhatsApp Cloud",
      telefone: "5585999999999",
      registradoCloudApi: true,
      config: { accessToken: "EAA", phoneNumberId: "PN", wabaId: "WABA" },
    });

    expect(id).toBe(123);
    expect(captured.insertValues.registradoCloudApi).toBe(true);
    expect(captured.insertValues.tipo).toBe("whatsapp_api");
    expect(captured.insertValues.status).toBe("conectado");
  });

  it("default é false quando não passado (canais normais)", async () => {
    await criarCanal({
      escritorioId: 1,
      tipo: "whatsapp_qr",
      nome: "QR",
    });
    expect(captured.insertValues.registradoCloudApi).toBe(false);
    // Sem config → desconectado (não muda comportamento existente).
    expect(captured.insertValues.status).toBe("desconectado");
  });
});
