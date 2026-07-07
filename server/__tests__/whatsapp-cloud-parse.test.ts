/**
 * Testes — parseMensagemCloud: tradução do `message` cru do webhook Cloud API.
 *
 * Regressão do bug "[system]": quando o cliente troca de número, a Meta manda
 * um `type: "system"`. Antes caía no `default`, virava um cru "[system]" tratado
 * como texto — e o bot RESPONDIA o evento, martelando o número velho (já morto)
 * e gerando 131026. Agora vira tipo "sistema" (o handler não dispara bot pra ele)
 * e mostra o número novo de forma legível.
 */

import { describe, it, expect, vi } from "vitest";

// Evita puxar o grafo pesado (handler → db-crm → smartflow) e conexão de DB só
// pra testar o parser puro. Mesma estratégia do whatsapp-handler.test.ts.
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
vi.mock("../integracoes/whatsapp-handler", () => ({ processarMensagemRecebida: vi.fn() }));

import { parseMensagemCloud } from "../integracoes/whatsapp-cloud-webhook";

describe("parseMensagemCloud — evento system (troca de número)", () => {
  it("mapeia system com new_wa_id para tipo 'sistema' mostrando o número novo", () => {
    const r = parseMensagemCloud(
      {
        type: "system",
        from: "558581975243",
        system: { type: "customer_changed_number", new_wa_id: "5585981975243", body: "changed number" },
      },
      "558581975243",
    );
    expect(r.tipo).toBe("sistema");
    expect(r.conteudo).toContain("mudou o número");
    expect(r.conteudo).toContain("5585981975243");
  });

  it("aceita wa_id como campo alternativo do número novo", () => {
    const r = parseMensagemCloud(
      { type: "system", from: "5585xxx", system: { wa_id: "5511988887777" } },
      "5585xxx",
    );
    expect(r.tipo).toBe("sistema");
    expect(r.conteudo).toContain("5511988887777");
  });

  it("sem número novo (ex: troca de identidade) cai no body", () => {
    const r = parseMensagemCloud(
      { type: "system", from: "x", system: { type: "customer_identity_changed", body: "identidade mudou" } },
      "x",
    );
    expect(r.tipo).toBe("sistema");
    expect(r.conteudo).toBe("📱 identidade mudou");
  });

  it("system sem detalhes ainda vira tipo 'sistema' (nunca dispara bot)", () => {
    const r = parseMensagemCloud({ type: "system", from: "x", system: {} }, "x");
    expect(r.tipo).toBe("sistema");
    expect(r.conteudo).toBe("📱 Evento do sistema WhatsApp");
  });

  it("NÃO cai mais no default como '[system]' texto — o cerne do bug", () => {
    const r = parseMensagemCloud(
      { type: "system", from: "x", system: { new_wa_id: "5585999999999" } },
      "x",
    );
    expect(r.conteudo).not.toBe("[system]");
    expect(r.tipo).not.toBe("texto");
  });
});

describe("parseMensagemCloud — tipos normais (sanidade da extração)", () => {
  it("texto", () => {
    const r = parseMensagemCloud({ type: "text", text: { body: "oi" } }, "x");
    expect(r).toMatchObject({ tipo: "texto", conteudo: "oi" });
  });

  it("tipo desconhecido continua caindo no default '[tipo]'", () => {
    const r = parseMensagemCloud({ type: "reaction" }, "x");
    expect(r).toMatchObject({ tipo: "texto", conteudo: "[reaction]" });
  });

  it("interactive button_reply usa o título clicado", () => {
    const r = parseMensagemCloud(
      { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b1", title: "Quero agendar" } } },
      "x",
    );
    expect(r.conteudo).toBe("Quero agendar");
    expect(r.interactiveReply).toMatchObject({ tipo: "button", id: "b1", titulo: "Quero agendar" });
  });

  it("documento carrega mediaId e nome original do arquivo", () => {
    const r = parseMensagemCloud(
      { type: "document", document: { id: "media-1", filename: "contrato.pdf" } },
      "x",
    );
    expect(r).toMatchObject({ tipo: "documento", mediaId: "media-1", nomeOriginalArquivo: "contrato.pdf" });
  });
});
