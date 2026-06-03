/**
 * Testes — WhatsApp Business Calling API.
 *
 * Cobre (1) os normalizadores puros do envelope de evento da Meta e (2) os
 * métodos de calling do client com axios mockado, garantindo que o payload
 * enviado ao Graph API segue o formato exigido (action, session sdp, etc).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  direcaoChamadaDeMeta,
  statusChamadaDeTerminate,
  normalizarEventoChamada,
} from "../../shared/whatsapp-calling-types";

// ─── Helpers puros ───────────────────────────────────────────────────────────

describe("direcaoChamadaDeMeta", () => {
  it("BUSINESS_INITIATED → saída", () => {
    expect(direcaoChamadaDeMeta("BUSINESS_INITIATED")).toBe("saida");
  });
  it("USER_INITIATED → entrada", () => {
    expect(direcaoChamadaDeMeta("USER_INITIATED")).toBe("entrada");
  });
  it("ausente/desconhecido → entrada (default seguro)", () => {
    expect(direcaoChamadaDeMeta(undefined)).toBe("entrada");
    expect(direcaoChamadaDeMeta("xpto")).toBe("entrada");
  });
});

describe("statusChamadaDeTerminate", () => {
  it("mapeia os status conhecidos da Meta", () => {
    expect(statusChamadaDeTerminate("COMPLETED")).toBe("encerrada");
    expect(statusChamadaDeTerminate("FAILED")).toBe("falha");
    expect(statusChamadaDeTerminate("REJECTED")).toBe("rejeitada");
    expect(statusChamadaDeTerminate("NO_ANSWER")).toBe("perdida");
  });
  it("status desconhecido cai em encerrada", () => {
    expect(statusChamadaDeTerminate("WHATEVER")).toBe("encerrada");
    expect(statusChamadaDeTerminate(undefined)).toBe("encerrada");
  });
});

describe("normalizarEventoChamada", () => {
  it("connect de entrada usa o `from` como telefone do cliente e fica tocando", () => {
    const ev = normalizarEventoChamada({
      id: "CALL_1",
      from: "5511988887777",
      to: "551140042020",
      event: "connect",
      direction: "USER_INITIATED",
      timestamp: "1762216151",
      session: { sdp: "v=0...", sdp_type: "offer" },
    });
    expect(ev.callId).toBe("CALL_1");
    expect(ev.evento).toBe("connect");
    expect(ev.direcao).toBe("entrada");
    expect(ev.telefone).toBe("5511988887777");
    expect(ev.status).toBe("tocando");
    expect(ev.sdp).toBe("v=0...");
    expect(ev.sdpType).toBe("offer");
    expect(ev.timestamp).toBe(1762216151);
  });

  it("terminate COMPLETED traz duração e status encerrada", () => {
    const ev = normalizarEventoChamada({
      id: "CALL_1",
      event: "terminate",
      direction: "USER_INITIATED",
      status: "COMPLETED",
      duration: 42,
    });
    expect(ev.evento).toBe("terminate");
    expect(ev.status).toBe("encerrada");
    expect(ev.duracaoSegundos).toBe(42);
  });

  it("saída (business-initiated) usa o `to` como telefone do cliente", () => {
    const ev = normalizarEventoChamada({
      id: "CALL_2",
      from: "551140042020",
      to: "5511988887777",
      event: "connect",
      direction: "BUSINESS_INITIATED",
    });
    expect(ev.direcao).toBe("saida");
    expect(ev.telefone).toBe("5511988887777");
  });

  it("evento sem id é normalizado mas com callId vazio (handler descarta)", () => {
    const ev = normalizarEventoChamada({ event: "connect", from: "55119" });
    expect(ev.callId).toBe("");
  });
});

// ─── Métodos de calling do client (axios mockado) ────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock("axios", () => ({
  default: {
    create: () => ({ get: mockGet, post: mockPost, delete: mockDelete }),
  },
}));

import { WhatsAppCloudClient } from "../integracoes/whatsapp-cloud";

function novoClient() {
  return new WhatsAppCloudClient({ accessToken: "tok", phoneNumberId: "PN1", wabaId: "WABA1" });
}

describe("WhatsAppCloudClient — calling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ data: {} });
  });

  it("definirStatusCalling posta o objeto calling em /settings", async () => {
    await novoClient().definirStatusCalling("ENABLED");
    const [url, payload] = mockPost.mock.calls[0];
    expect(url).toBe("/PN1/settings");
    expect(payload).toEqual({ calling: { status: "ENABLED" } });
  });

  it("definirStatusCalling repassa campos extra (ex: visibilidade do ícone)", async () => {
    await novoClient().definirStatusCalling("DISABLED", { call_icon_visibility: "DISABLE_ALL" });
    const [, payload] = mockPost.mock.calls[0];
    expect(payload).toEqual({ calling: { status: "DISABLED", call_icon_visibility: "DISABLE_ALL" } });
  });

  it("getCallingSettings devolve o objeto calling", async () => {
    mockGet.mockResolvedValueOnce({ data: { calling: { status: "ENABLED" } } });
    const out = await novoClient().getCallingSettings();
    expect(mockGet).toHaveBeenCalledWith("/PN1/settings", { params: { fields: "calling" } });
    expect(out).toEqual({ status: "ENABLED" });
  });

  it("preAceitarChamada posta action pre_accept com SDP answer", async () => {
    await novoClient().preAceitarChamada("CALL_1", "sdp-answer");
    const [url, payload] = mockPost.mock.calls[0];
    expect(url).toBe("/PN1/calls");
    expect(payload).toEqual({
      messaging_product: "whatsapp",
      action: "pre_accept",
      call_id: "CALL_1",
      session: { sdp_type: "answer", sdp: "sdp-answer" },
    });
  });

  it("aceitarChamada posta action accept com SDP answer", async () => {
    await novoClient().aceitarChamada("CALL_1", "sdp-answer");
    const [, payload] = mockPost.mock.calls[0];
    expect(payload.action).toBe("accept");
    expect(payload.call_id).toBe("CALL_1");
    expect(payload.session).toEqual({ sdp_type: "answer", sdp: "sdp-answer" });
  });

  it("rejeitarChamada posta action reject sem session", async () => {
    await novoClient().rejeitarChamada("CALL_1");
    const [, payload] = mockPost.mock.calls[0];
    expect(payload.action).toBe("reject");
    expect(payload.call_id).toBe("CALL_1");
    expect(payload.session).toBeUndefined();
  });

  it("encerrarChamada posta action terminate", async () => {
    await novoClient().encerrarChamada("CALL_1");
    const [, payload] = mockPost.mock.calls[0];
    expect(payload.action).toBe("terminate");
    expect(payload.call_id).toBe("CALL_1");
  });

  it("iniciarChamada (saída) posta connect com SDP offer + to e retorna o call_id", async () => {
    mockPost.mockResolvedValueOnce({ data: { calls: [{ id: "CALL_NEW" }] } });
    const id = await novoClient().iniciarChamada("(11) 98888-7777", "sdp-offer", "ref-123");
    const [url, payload] = mockPost.mock.calls[0];
    expect(url).toBe("/PN1/calls");
    expect(payload.action).toBe("connect");
    expect(payload.call_id).toBeUndefined(); // saída cria o call_id na Meta
    expect(payload.to).toBe("11988887777"); // só dígitos
    expect(payload.session).toEqual({ sdp_type: "offer", sdp: "sdp-offer" });
    expect(payload.biz_opaque_callback_data).toBe("ref-123");
    expect(id).toBe("CALL_NEW");
  });

  it("pedirPermissaoLigacao manda interactive call_permission_request e retorna o message_id", async () => {
    mockPost.mockResolvedValueOnce({ data: { messages: [{ id: "wamid.PERM" }] } });
    const id = await novoClient().pedirPermissaoLigacao("5511988887777", "Podemos te ligar?");
    const [url, payload] = mockPost.mock.calls[0];
    expect(url).toBe("/PN1/messages");
    expect(payload.type).toBe("interactive");
    expect(payload.interactive).toEqual({
      type: "call_permission_request",
      action: { name: "call_permission_request" },
      body: { text: "Podemos te ligar?" },
    });
    expect(id).toBe("wamid.PERM");
  });
});
