/**
 * Testes — assinaturas.criarDeUpload (subir documento p/ assinatura).
 *
 * Foca nos gates que rodam ANTES de tocar o disco/converter:
 *  - arquivo de OUTRO escritório é rejeitado (multi-tenant)
 *  - path traversal ("..") é rejeitado
 *  - arquivo inexistente no disco → NOT_FOUND
 *
 * Os caminhos felizes (PDF direto / Word→PDF) dependem de filesystem +
 * conversor (LibreOffice) e são validados manualmente.
 */
import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
  })),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 10, nome: "Esc Teste", fusoHorario: "America/Sao_Paulo" },
    colaborador: { id: 1, cargo: "dono" },
  })),
}));

const { appRouter } = await import("../routers");

function caller() {
  return appRouter.createCaller({
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google",
      role: "user", asaasCustomerId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  } as TrpcContext);
}

describe("assinaturas.criarDeUpload — gates de segurança", () => {
  it("rejeita arquivo de OUTRO escritório", async () => {
    await expect(
      caller().assinaturas.criarDeUpload({
        contatoId: 5,
        titulo: "Contrato",
        arquivoUrl: "/uploads/escritorio_999/x.pdf",
      }),
    ).rejects.toThrow(/inválido/i);
  });

  it("rejeita path traversal", async () => {
    await expect(
      caller().assinaturas.criarDeUpload({
        contatoId: 5,
        titulo: "Contrato",
        arquivoUrl: "/uploads/escritorio_10/../../etc/passwd",
      }),
    ).rejects.toThrow(/inválido/i);
  });

  it("arquivo válido mas inexistente no disco → não encontrado", async () => {
    await expect(
      caller().assinaturas.criarDeUpload({
        contatoId: 5,
        titulo: "Contrato",
        arquivoUrl: "/uploads/escritorio_10/nao-existe-" + Date.now() + ".pdf",
      }),
    ).rejects.toThrow(/não encontrado/i);
  });

  it("título curto demais é rejeitado pelo schema", async () => {
    await expect(
      caller().assinaturas.criarDeUpload({
        contatoId: 5,
        titulo: "x",
        arquivoUrl: "/uploads/escritorio_10/x.pdf",
      }),
    ).rejects.toThrow();
  });
});
