/**
 * Link do WhatsApp Web e máscara — uma régua só pro DDI.
 *
 * O WhatsApp entrega o telefone como "5585997965706" e o cadastro à mão
 * grava "(85) 99796-5706". Cada tela resolvia o 55 do seu jeito: a Agenda
 * prefixava sempre (wa.me/555585…), a assinatura nunca prefixava
 * (wa.me/85997965706), e duas máscaras locais cortavam nos 11 primeiros
 * dígitos ("(55) 85997-9657"). `telefoneParaWaMe` e `mascararTelefoneBR`
 * são a régua única; estes testes travam o comportamento nas pontas.
 */

import { describe, expect, it } from "vitest";
import { mascararTelefoneBR, telefoneParaWaMe } from "../../shared/telefone";

const WA_85 = "https://wa.me/5585997965706";

describe("telefoneParaWaMe", () => {
  it("número que nasceu do WhatsApp (já com 55) não ganha outro 55", () => {
    expect(telefoneParaWaMe("5585997965706")).toBe(WA_85);
    expect(telefoneParaWaMe("+55 (85) 99796-5706")).toBe(WA_85);
    expect(telefoneParaWaMe("55 85 99796-5706")).toBe(WA_85);
  });

  it("número do cadastro à mão (sem 55) ganha o 55", () => {
    expect(telefoneParaWaMe("85997965706")).toBe(WA_85);
    expect(telefoneParaWaMe("(85) 99796-5706")).toBe(WA_85);
    // Sem o nono dígito também: o helper não inventa o 9, só o DDI.
    expect(telefoneParaWaMe("8597965706")).toBe("https://wa.me/558597965706");
    expect(telefoneParaWaMe("(85) 9796-5706")).toBe("https://wa.me/558597965706");
  });

  it("nunca sai 55 duplicado, seja qual for a forma de entrada", () => {
    for (const v of ["5585997965706", "85997965706", "(85) 99796-5706", "8597965706", "+55 85 99796-5706"]) {
      expect(telefoneParaWaMe(v), v).toMatch(/^https:\/\/wa\.me\/5585/);
      expect(telefoneParaWaMe(v), v).not.toMatch(/wa\.me\/5555/);
    }
  });

  it("DDD 55 (RS) não é confundido com código do país", () => {
    // 10/11 dígitos começando com 55 é Santa Maria, não DDI — precisa do prefixo.
    expect(telefoneParaWaMe("(55) 9979-6570")).toBe("https://wa.me/555599796570");
    expect(telefoneParaWaMe("55999796570")).toBe("https://wa.me/5555999796570");
  });

  it("vazio devolve null (o botão não deve montar wa.me/ sem número)", () => {
    expect(telefoneParaWaMe("")).toBeNull();
    expect(telefoneParaWaMe(null)).toBeNull();
    expect(telefoneParaWaMe(undefined)).toBeNull();
    expect(telefoneParaWaMe("( ) -")).toBeNull();
  });
});

describe("máscara e link concordam", () => {
  it("o deep-link ?telefone= com o número do cadastro vira o número certo", () => {
    // Era o caso do Atendimento: máscara local cortava em 11 e o envio ia
    // pra "5555859979657".
    expect(mascararTelefoneBR("5585997965706")).toBe("(85) 99796-5706");
    expect(mascararTelefoneBR("5585997965706")).not.toMatch(/^\(55\)/);
  });

  it("mascarar e depois montar o link dá o mesmo destino do número cru", () => {
    for (const v of ["5585997965706", "85997965706", "(85) 99796-5706"]) {
      expect(telefoneParaWaMe(mascararTelefoneBR(v))).toBe(telefoneParaWaMe(v));
    }
  });
});
