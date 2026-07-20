/**
 * Testes de integração HTTP do webhook WhatsApp Cloud — congela o contrato
 * do endpoint real (GET/POST /api/webhooks/whatsapp) num app Express de
 * verdade, com body raw + HMAC como em produção.
 *
 * Cobre:
 *  - GET verificação: token correto → 200 challenge; errado → 403; sem mode → 400.
 *  - POST: HMAC inválido/ausente → 401 e NADA processado.
 *  - POST messages: mensagem chega em processarMensagemRecebida com os campos
 *    parseados (telefone, conteúdo, messageId, timestamp).
 *  - POST messages de número não conectado → ignorada (multi-tenant).
 *  - POST statuses: update em mensagens por idExterno; `failed` registra
 *    motivo e aciona o disjuntor de template.
 *  - POST account_update restritivo → canais da WABA banidos + guard.
 *  - object desconhecido → ack sem processamento.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

// ─── Estado dos mocks ────────────────────────────────────────────────────────

const APP_SECRET = "segredo-teste-hmac";
const VERIFY_TOKEN = "verify-token-123";

const adminRow = { apiKeyEncrypted: "ADMIN", apiKeyIv: "iv", apiKeyTag: "tag" };
const canaisRows = [
  { id: 1, escritorioId: 10, configEncrypted: "CANAL_A", configIv: "iv", configTag: "tag" },
  { id: 2, escritorioId: 20, configEncrypted: "CANAL_B", configIv: "iv", configTag: "tag" },
];
const configs: Record<string, any> = {
  ADMIN: { appSecret: APP_SECRET, webhookVerifyToken: VERIFY_TOKEN },
  CANAL_A: { phoneNumberId: "PN_A", wabaId: "WABA1", accessToken: "tokA" },
  CANAL_B: { phoneNumberId: "PN_B", wabaId: "WABA1", accessToken: "tokB" },
};

type Captured = { op: "update" | "insert"; table: string; set?: any; values?: any };
let captured: Captured[] = [];

function tableName(t: unknown): string {
  return (t as any)?.[Symbol.for("drizzle:Name")] || (t as any)?._?.name || "unknown";
}

function makeSelectBuilder(table: unknown) {
  const rows = () => {
    const name = tableName(table);
    if (name === "admin_integracoes") return [adminRow];
    if (name === "canais_integrados") return canaisRows;
    return [];
  };
  const builder: any = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => Promise.resolve(rows()),
    then: (resolve: (v: unknown) => unknown) => resolve(rows()),
  };
  return builder;
}

const mockDb = {
  select: () => ({ from: (t: unknown) => makeSelectBuilder(t) }),
  insert: (t: unknown) => ({
    values: (values: unknown) => {
      captured.push({ op: "insert", table: tableName(t), values });
      return Promise.resolve([{ affectedRows: 1, insertId: 99 }]);
    },
  }),
  update: (t: unknown) => ({
    set: (set: any) => ({
      where: () => {
        captured.push({ op: "update", table: tableName(t), set });
        return Promise.resolve([{ affectedRows: 1 }]);
      },
    }),
  }),
};

vi.mock("../db", () => ({ getDb: async () => mockDb }));
vi.mock("../escritorio/crypto-utils", () => ({
  decryptConfig: (enc: string) => configs[enc],
  // encryptConfig não é usado pelo webhook, mas o módulo real exporta.
  encryptConfig: () => ({ encrypted: "", iv: "", tag: "" }),
}));

const processarMensagemRecebida = vi.fn(async () => ({ contatoId: 1, conversaId: 1, mensagemId: 1 }));
vi.mock("../integracoes/whatsapp-handler", () => ({
  processarMensagemRecebida: (...a: any[]) => processarMensagemRecebida(...a),
}));

const marcarCanalRestrito = vi.fn(async () => {});
const registrarFalhaTemplate = vi.fn(async () => {});
vi.mock("../integracoes/whatsapp-envio-guard", () => ({
  marcarCanalRestrito: (...a: any[]) => marcarCanalRestrito(...a),
  registrarFalhaTemplate: (...a: any[]) => registrarFalhaTemplate(...a),
}));

vi.mock("../integracoes/whatsapp-alertas", () => ({
  avaliarTransicaoSaude: () => [],
  notificarSaudeCanal: async () => {},
}));

const { calcularAssinaturaMeta } = await import("../integracoes/meta-signature");
const { registerWhatsAppCloudWebhook } = await import("../integracoes/whatsapp-cloud-webhook");

// ─── App Express real (mesmo middleware de rawBody da produção) ─────────────

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        const url = (req as { url?: string }).url ?? "";
        if (url.startsWith("/api/webhooks/")) {
          (req as { rawBody?: Buffer }).rawBody = buf;
        }
      },
    }),
  );
  registerWhatsAppCloudWebhook(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("porta não alocada");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  captured = [];
  processarMensagemRecebida.mockClear();
  marcarCanalRestrito.mockClear();
  registrarFalhaTemplate.mockClear();
  delete process.env.META_APP_SECRET_EXTRA;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function postWebhook(body: unknown, opts: { assinar?: boolean; assinatura?: string } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const assinar = opts.assinar ?? true;
  if (opts.assinatura) headers["X-Hub-Signature-256"] = opts.assinatura;
  else if (assinar) headers["X-Hub-Signature-256"] = calcularAssinaturaMeta(raw, APP_SECRET);
  return fetch(`${baseUrl}/api/webhooks/whatsapp`, { method: "POST", headers, body: raw });
}

/** O POST responde 200 antes de processar — espera o background assentar. */
const aguardarProcessamento = () => new Promise((r) => setTimeout(r, 80));

function eventoMessages(phoneNumberId: string, extra: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA1",
      changes: [{
        field: "messages",
        value: { metadata: { phone_number_id: phoneNumberId }, ...extra },
      }],
    }],
  };
}

// ─── GET verificação ─────────────────────────────────────────────────────────

describe("GET /api/webhooks/whatsapp — verificação da Meta", () => {
  it("token correto → 200 com o challenge", async () => {
    const res = await fetch(
      `${baseUrl}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=desafio-42`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("desafio-42");
  });

  it("token errado → 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=x`,
    );
    expect(res.status).toBe(403);
  });

  it("sem hub.mode=subscribe → 400", async () => {
    const res = await fetch(`${baseUrl}/api/webhooks/whatsapp`);
    expect(res.status).toBe(400);
  });
});

// ─── POST: HMAC ──────────────────────────────────────────────────────────────

describe("POST — validação HMAC", () => {
  it("sem header de assinatura → 401 e nada processado", async () => {
    const res = await postWebhook(eventoMessages("PN_A", {
      messages: [{ from: "5585999990000", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "oi" } }],
    }), { assinar: false });
    expect(res.status).toBe(401);
    await aguardarProcessamento();
    expect(processarMensagemRecebida).not.toHaveBeenCalled();
  });

  it("assinatura inválida → 401 e nada processado", async () => {
    const res = await postWebhook(eventoMessages("PN_A", {
      messages: [{ from: "5585999990000", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "oi" } }],
    }), { assinatura: "sha256=" + "0".repeat(64) });
    expect(res.status).toBe(401);
    await aguardarProcessamento();
    expect(processarMensagemRecebida).not.toHaveBeenCalled();
  });
});

// ─── POST: messages ──────────────────────────────────────────────────────────

describe("POST — field messages", () => {
  it("mensagem de texto chega parseada no handler com o canal certo", async () => {
    const res = await postWebhook(eventoMessages("PN_A", {
      contacts: [{ wa_id: "5585999990000", profile: { name: "Maria" } }],
      messages: [{ from: "5585999990000", id: "wamid.ABC", timestamp: "1700000000", type: "text", text: { body: "olá!" } }],
    }));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(processarMensagemRecebida).toHaveBeenCalledTimes(1));

    const [canalId, escritorioId, msg] = processarMensagemRecebida.mock.calls[0] as any[];
    expect(canalId).toBe(1);
    expect(escritorioId).toBe(10);
    expect(msg).toMatchObject({
      telefone: "5585999990000",
      nome: "Maria",
      conteudo: "olá!",
      tipo: "texto",
      messageId: "wamid.ABC",
      timestamp: 1700000000,
      chatId: "5585999990000@s.whatsapp.net",
    });
  });

  it("número não conectado → ignorada sem processar (isolamento multi-tenant)", async () => {
    const res = await postWebhook(eventoMessages("PN_DESCONHECIDO", {
      messages: [{ from: "5585999990000", id: "wamid.X", timestamp: "1700000000", type: "text", text: { body: "oi" } }],
    }));
    expect(res.status).toBe(200);
    await aguardarProcessamento();
    expect(processarMensagemRecebida).not.toHaveBeenCalled();
  });

  it("object diferente de whatsapp_business_account → ack sem processamento", async () => {
    const res = await postWebhook({ object: "page", entry: [] });
    expect(res.status).toBe(200);
    await aguardarProcessamento();
    expect(processarMensagemRecebida).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });
});

// ─── POST: statuses ──────────────────────────────────────────────────────────

describe("POST — statuses de entrega", () => {
  it("delivered atualiza a mensagem por idExterno e limpa erroEntrega", async () => {
    await postWebhook(eventoMessages("PN_A", {
      statuses: [{ id: "wamid.OUT1", status: "delivered" }],
    }));
    await vi.waitFor(() => {
      const up = captured.find((c) => c.op === "update" && c.table === "mensagens");
      expect(up?.set).toMatchObject({ status: "entregue", erroEntrega: null });
    });
    expect(registrarFalhaTemplate).not.toHaveBeenCalled();
  });

  it("failed persiste o motivo da Meta e aciona o disjuntor de template", async () => {
    await postWebhook(eventoMessages("PN_A", {
      statuses: [{
        id: "wamid.OUT2",
        status: "failed",
        errors: [{ code: 131026, title: "Message undeliverable" }],
      }],
    }));
    await vi.waitFor(() => {
      const up = captured.find((c) => c.op === "update" && c.table === "mensagens");
      expect(up?.set?.status).toBe("falha");
      expect(String(up?.set?.erroEntrega)).toContain("131026");
    });
    await vi.waitFor(() => expect(registrarFalhaTemplate).toHaveBeenCalledTimes(1));
  });
});

// ─── POST: account_update ────────────────────────────────────────────────────

describe("POST — account_update", () => {
  it("evento restritivo bane os canais da WABA e tripa o guard", async () => {
    await postWebhook({
      object: "whatsapp_business_account",
      entry: [{
        id: "WABA1",
        changes: [{
          field: "account_update",
          value: { event: "DISABLED_UPDATE", ban_info: { ban_state: "SCHEDULE_FOR_DISABLE" } },
        }],
      }],
    });
    await vi.waitFor(() => {
      const ups = captured.filter((c) => c.op === "update" && c.table === "canais_integrados");
      expect(ups.length).toBe(2);
      for (const up of ups) expect(up.set?.status).toBe("banido");
    });
    expect(marcarCanalRestrito).toHaveBeenCalledTimes(2);
  });

  it("evento informativo não mexe em nada", async () => {
    await postWebhook({
      object: "whatsapp_business_account",
      entry: [{
        id: "WABA1",
        changes: [{ field: "account_update", value: { event: "VERIFIED_ACCOUNT" } }],
      }],
    });
    await aguardarProcessamento();
    expect(captured.filter((c) => c.table === "canais_integrados")).toHaveLength(0);
    expect(marcarCanalRestrito).not.toHaveBeenCalled();
  });
});
