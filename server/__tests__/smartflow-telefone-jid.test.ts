/**
 * Testes — SmartFlow: resolução de JID do WhatsApp.
 *
 * Cobre o fluxo do `enviarWhatsApp` pro caso BR (8 vs 9 dígitos) sem
 * depender do Baileys real — mocka o `checarNumerosWhatsApp`.
 *
 * O caso que motivou esses testes: contato sincronizado pelo Asaas
 * vira `"85996042189"` (novo padrão, 11 dígitos, sem DDI), mas o
 * número real registrado no WhatsApp é `"558596042189"` (conta antiga
 * migrada, sem o 9º dígito). O executor precisa descobrir isso
 * consultando o servidor e usar o JID canônico.
 */

import { describe, it, expect, vi } from "vitest";
import {
  prepararCandidatosJid,
  resolverJidWhatsApp,
  type CheckWhatsappManager,
} from "../smartflow/executores";

// ─── prepararCandidatosJid (função pura) ─────────────────────────────────────

describe("prepararCandidatosJid", () => {
  it("novo padrão sem DDI (11 dígitos) gera as 3 variantes", () => {
    const r = prepararCandidatosJid("85996042189");
    expect(r).toEqual({
      candidatos: expect.arrayContaining([
        "85996042189",
        "5585996042189",
        "558596042189",
      ]),
    });
    if (r && "candidatos" in r) expect(r.candidatos).toHaveLength(3);
  });

  it("antigo com DDI (12 dígitos) gera variante com 9º dígito", () => {
    const r = prepararCandidatosJid("558596042189");
    expect(r).toEqual({
      candidatos: expect.arrayContaining(["558596042189", "5585996042189"]),
    });
    if (r && "candidatos" in r) expect(r.candidatos).toHaveLength(2);
  });

  it("novo padrão com DDI (13 dígitos) gera variante sem 9º dígito", () => {
    const r = prepararCandidatosJid("5585996042189");
    expect(r).toEqual({
      candidatos: expect.arrayContaining(["5585996042189", "558596042189"]),
    });
    if (r && "candidatos" in r) expect(r.candidatos).toHaveLength(2);
  });

  it("entrada formatada (+55 espaços e parênteses) normaliza igual ao com DDI", () => {
    const r = prepararCandidatosJid("+55 (85) 99604-2189");
    expect(r).toEqual({
      candidatos: expect.arrayContaining(["5585996042189", "558596042189"]),
    });
  });

  it("antigo sem DDI (10 dígitos) gera 3 variantes", () => {
    const r = prepararCandidatosJid("8596042189");
    expect(r).toEqual({
      candidatos: expect.arrayContaining([
        "8596042189",
        "558596042189",
        "5585996042189",
      ]),
    });
  });

  it("JID já formado passa direto sem gerar candidatos", () => {
    const r = prepararCandidatosJid("5585996042189@s.whatsapp.net");
    expect(r).toEqual({ jid: "5585996042189@s.whatsapp.net" });
  });

  it("LID passa direto como JID", () => {
    const r = prepararCandidatosJid("123456789@lid");
    expect(r).toEqual({ jid: "123456789@lid" });
  });

  it("telefone muito curto retorna null", () => {
    expect(prepararCandidatosJid("123")).toBeNull();
  });

  it("string vazia retorna null", () => {
    expect(prepararCandidatosJid("")).toBeNull();
    expect(prepararCandidatosJid("   ")).toBeNull();
  });

  it("null/undefined retorna null", () => {
    expect(prepararCandidatosJid(null)).toBeNull();
    expect(prepararCandidatosJid(undefined)).toBeNull();
  });

  it("DDD com primeiro dígito fora de 6-9 não gera variante com 9º", () => {
    // Número fixo: 11 3333-4444 — o primeiro do local é "3", não é celular.
    const r = prepararCandidatosJid("551133334444");
    expect(r).toEqual({ candidatos: ["551133334444"] });
  });
});

// ─── resolverJidWhatsApp (integração com manager mockado) ────────────────────

function criarMockManager(
  handler: (candidatos: string[]) => Array<{ jid: string; exists: boolean; lid?: string }>,
): CheckWhatsappManager & { checarNumerosWhatsApp: ReturnType<typeof vi.fn> } {
  return {
    checarNumerosWhatsApp: vi.fn(async (_canalId: number, candidatos: string[]) => handler(candidatos)),
  };
}

describe("resolverJidWhatsApp", () => {
  it("caso do usuário: Asaas sincronizou com 11 dígitos, mas WhatsApp só tem sem 9º", async () => {
    const manager = criarMockManager((candidatos) =>
      candidatos.map((c) => ({
        jid: `${c}@s.whatsapp.net`,
        exists: c === "558596042189", // só essa existe
      })),
    );

    const jid = await resolverJidWhatsApp(manager, 1, "85996042189");
    expect(jid).toBe("558596042189@s.whatsapp.net");
    expect(manager.checarNumerosWhatsApp).toHaveBeenCalledWith(
      1,
      expect.arrayContaining(["85996042189", "5585996042189", "558596042189"]),
    );
  });

  it("conta moderna: WhatsApp tem com 9º dígito", async () => {
    const manager = criarMockManager((candidatos) =>
      candidatos.map((c) => ({
        jid: `${c}@s.whatsapp.net`,
        exists: c === "5585996042189",
      })),
    );

    const jid = await resolverJidWhatsApp(manager, 1, "85996042189");
    expect(jid).toBe("5585996042189@s.whatsapp.net");
  });

  it("edição manual pro formato antigo continua funcionando", async () => {
    const manager = criarMockManager((candidatos) =>
      candidatos.map((c) => ({
        jid: `${c}@s.whatsapp.net`,
        exists: c === "558596042189",
      })),
    );

    const jid = await resolverJidWhatsApp(manager, 1, "558596042189");
    expect(jid).toBe("558596042189@s.whatsapp.net");
  });

  it("JID já cadastrado no CRM passa direto sem consultar o Baileys", async () => {
    const manager = criarMockManager(() => []);
    const jid = await resolverJidWhatsApp(
      manager,
      1,
      "5585996042189@s.whatsapp.net",
    );
    expect(jid).toBe("5585996042189@s.whatsapp.net");
    expect(manager.checarNumerosWhatsApp).not.toHaveBeenCalled();
  });

  it("número que não existe em nenhum formato retorna null", async () => {
    const manager = criarMockManager((candidatos) =>
      candidatos.map((c) => ({ jid: `${c}@s.whatsapp.net`, exists: false })),
    );

    const jid = await resolverJidWhatsApp(manager, 1, "11999999999");
    expect(jid).toBeNull();
  });

  it("telefone inválido não consulta o Baileys e retorna null", async () => {
    const manager = criarMockManager(() => []);
    const jid = await resolverJidWhatsApp(manager, 1, "abc");
    expect(jid).toBeNull();
    expect(manager.checarNumerosWhatsApp).not.toHaveBeenCalled();
  });

  it("usa o primeiro match quando múltiplos existem", async () => {
    // Se a conta tem tanto com quanto sem o 9º (raro mas possível em contas
    // antigas), o executor escolhe o primeiro que o Baileys retorna como
    // existente.
    const manager = criarMockManager((candidatos) =>
      candidatos.map((c) => ({ jid: `${c}@s.whatsapp.net`, exists: true })),
    );

    const jid = await resolverJidWhatsApp(manager, 1, "85996042189");
    expect(jid).not.toBeNull();
    expect(jid).toContain("@s.whatsapp.net");
  });

  it("prefere LID quando o Baileys retorna um", async () => {
    const manager = criarMockManager((candidatos) =>
      candidatos.map((c) => ({
        jid: `${c}@s.whatsapp.net`,
        exists: c === "5585996042189",
        lid: c === "5585996042189" ? "987654321@lid" : undefined,
      })),
    );

    const jid = await resolverJidWhatsApp(manager, 1, "85996042189");
    expect(jid).toBe("987654321@lid");
  });
});
