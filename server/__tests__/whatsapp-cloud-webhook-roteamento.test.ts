/**
 * Testes — roteamento do webhook WhatsApp Cloud (isolamento por número).
 *
 * Regressão: o webhook resolvia o canal pelo phone_number_id e, se falhasse,
 * caía num fallback por wabaId. Como vários números podem dividir a MESMA
 * WABA e só alguns estarem conectados neste JuridFlow, esse fallback ENTREGAVA
 * a mensagem de um número não-conectado pro canal de outro número da mesma
 * WABA — vazamento entre sistemas (ex.: número usado noutro CRM aparecia aqui).
 *
 * Fix: `resolverCanalDaMensagem` casa SÓ pelo phone_number_id (único por
 * número). Número desconhecido → null (mensagem ignorada), mesmo que a WABA
 * exista em outro canal.
 */

import { describe, it, expect, vi } from "vitest";

// Dois canais conectados, AMBOS na mesma WABA "WABA1", com números distintos.
const canais = [
  { id: 1, escritorioId: 10, configEncrypted: "A", configIv: "iv", configTag: "tag" },
  { id: 2, escritorioId: 20, configEncrypted: "B", configIv: "iv", configTag: "tag" },
];
const configs: Record<string, any> = {
  A: { phoneNumberId: "PN_A", wabaId: "WABA1", accessToken: "tokA" },
  B: { phoneNumberId: "PN_B", wabaId: "WABA1", accessToken: "tokB" },
};

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: async () => canais }) }),
  }),
}));

vi.mock("../escritorio/crypto-utils", () => ({
  decryptConfig: (enc: string) => configs[enc],
}));

// Evita carregar a árvore pesada do handler ao importar o webhook.
vi.mock("../integracoes/whatsapp-handler", () => ({
  processarMensagemRecebida: vi.fn(),
}));

const { resolverCanalDaMensagem, detectarRestricaoConta, extrairMotivosDesconexaoCoex } = await import("../integracoes/whatsapp-cloud-webhook");

describe("resolverCanalDaMensagem — isolamento por número", () => {
  it("acha o canal pelo phone_number_id exato", async () => {
    const r = await resolverCanalDaMensagem("PN_A");
    expect(r?.canalId).toBe(1);
    expect(r?.escritorioId).toBe(10);
    expect(r?.accessToken).toBe("tokA");
  });

  it("casa cada número com SEU canal (não troca dentro da mesma WABA)", async () => {
    const r = await resolverCanalDaMensagem("PN_B");
    expect(r?.canalId).toBe(2);
    expect(r?.escritorioId).toBe(20);
  });

  it("NÃO vaza: número desconhecido na mesma WABA → null (sem fallback por WABA)", async () => {
    // PN_Z não está em nenhum canal. WABA1 existe (canais 1 e 2). Antes, o
    // fallback por wabaId entregava a mensagem do PN_Z pro canal 1 ou 2.
    const r = await resolverCanalDaMensagem("PN_Z");
    expect(r).toBeNull();
  });

  it("retorna null sem phone_number_id", async () => {
    expect(await resolverCanalDaMensagem(undefined)).toBeNull();
    expect(await resolverCanalDaMensagem("")).toBeNull();
  });
});

describe("detectarRestricaoConta — evento account_update", () => {
  it("detecta desativação/restrição da conta e monta motivo legível", () => {
    const r = detectarRestricaoConta({
      event: "DISABLED_UPDATE",
      ban_info: { ban_state: "SCHEDULED_FOR_DISABLE" },
    });
    expect(r.restritivo).toBe(true);
    expect(r.motivo).toContain("DISABLED_UPDATE");
    expect(r.motivo).toContain("SCHEDULED_FOR_DISABLE");
  });

  it("detecta ACCOUNT_RESTRICTION com restriction_info", () => {
    const r = detectarRestricaoConta({
      event: "ACCOUNT_RESTRICTION",
      restriction_info: [{ restriction_type: "RESTRICTED_ADD_PHONE_NUMBER" }],
    });
    expect(r.restritivo).toBe(true);
    expect(r.motivo).toContain("RESTRICTED_ADD_PHONE_NUMBER");
  });

  it("NÃO trata eventos informativos como restrição", () => {
    expect(detectarRestricaoConta({ event: "ACCOUNT_UPDATE" }).restritivo).toBe(false);
    expect(detectarRestricaoConta({ event: "PARTNER_ADDED" }).restritivo).toBe(false);
    expect(detectarRestricaoConta({}).restritivo).toBe(false);
  });

  it("PARTNER_REMOVED também NÃO é restrição (tem tratamento próprio de CoEx)", () => {
    expect(detectarRestricaoConta({ event: "PARTNER_REMOVED" }).restritivo).toBe(false);
  });
});

describe("extrairMotivosDesconexaoCoex — PARTNER_REMOVED", () => {
  it("lê reasons de waba_info.disconnection_info (shape objeto)", () => {
    const m = extrairMotivosDesconexaoCoex({
      event: "PARTNER_REMOVED",
      waba_info: { disconnection_info: { reasons: ["ACCOUNT_DISCONNECTED", "USER_RE_REGISTERED"] } },
    });
    expect(m).toBe("ACCOUNT_DISCONNECTED · USER_RE_REGISTERED");
  });

  it("lê disconnection_info na raiz (shape array)", () => {
    const m = extrairMotivosDesconexaoCoex({
      disconnection_info: [{ reason: "CHANGE_NUMBER" }],
    });
    expect(m).toBe("CHANGE_NUMBER");
  });

  it("sem info detalhada cai no fallback PARTNER_REMOVED", () => {
    expect(extrairMotivosDesconexaoCoex({ event: "PARTNER_REMOVED" })).toBe("PARTNER_REMOVED");
    expect(extrairMotivosDesconexaoCoex({})).toBe("PARTNER_REMOVED");
  });
});
