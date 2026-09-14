/**
 * Origem do lead por anúncio (Click-to-WhatsApp).
 *
 * O parser encara payload de produção que ninguém controla: a Meta varia o
 * envelope do `referral` por tipo de criativo (imagem, vídeo, post orgânico)
 * e entre versões da API. O contrato que estes testes travam é que campo
 * ausente nunca derruba o parse da mensagem — no máximo vira string vazia,
 * e envelope irreconhecível vira `undefined` em vez de origem fantasma na
 * ficha do contato.
 */

import { describe, it, expect } from "vitest";
import { extrairReferralAnuncio, parseMensagemCloud } from "../integracoes/whatsapp-cloud-webhook";
import { parseOrigemAnuncio } from "../integracoes/whatsapp-origem-anuncio";

describe("extrairReferralAnuncio", () => {
  it("extrai anúncio em vídeo com todos os campos", () => {
    const ref = extrairReferralAnuncio({
      referral: {
        source_url: "https://fb.me/abc",
        source_id: "120210000000000000",
        source_type: "ad",
        headline: "Foi demitido sem justa causa?",
        body: "Fale com um advogado trabalhista.",
        media_type: "video",
        video_url: "https://scontent.example/v.mp4",
        thumbnail_url: "https://scontent.example/t.jpg",
        ctwa_clid: "ARAbc123",
      },
    });
    expect(ref).toMatchObject({
      sourceId: "120210000000000000",
      sourceType: "ad",
      titulo: "Foi demitido sem justa causa?",
      midiaTipo: "video",
      videoUrl: "https://scontent.example/v.mp4",
      ctwaClid: "ARAbc123",
    });
    expect(ref?.imagemUrl).toBe("");
  });

  it("aceita envelope parcial — criativo de imagem sem headline", () => {
    const ref = extrairReferralAnuncio({
      referral: { source_type: "ad", media_type: "image", image_url: "https://x/i.jpg" },
    });
    expect(ref?.midiaTipo).toBe("image");
    expect(ref?.imagemUrl).toBe("https://x/i.jpg");
    expect(ref?.titulo).toBe("");
  });

  it("mensagem comum (sem referral) não vira origem", () => {
    expect(extrairReferralAnuncio({ type: "text", text: { body: "oi" } })).toBeUndefined();
    expect(extrairReferralAnuncio({ referral: {} })).toBeUndefined();
    expect(extrairReferralAnuncio({ referral: null })).toBeUndefined();
    expect(extrairReferralAnuncio(undefined)).toBeUndefined();
  });

  it("valor não-string da Meta não quebra o parse", () => {
    const ref = extrairReferralAnuncio({ referral: { source_id: 12345, headline: null } });
    expect(ref?.sourceId).toBe("12345");
    expect(ref?.titulo).toBe("");
  });

  it("chega junto da mensagem parseada, sem afetar conteúdo e tipo", () => {
    const m = parseMensagemCloud(
      {
        type: "text",
        text: { body: "vi o anúncio de vocês" },
        referral: { source_type: "ad", headline: "Rescisão" },
      },
      "5585999999999",
    );
    expect(m.conteudo).toBe("vi o anúncio de vocês");
    expect(m.tipo).toBe("texto");
    expect(m.referral?.titulo).toBe("Rescisão");
  });
});

describe("parseOrigemAnuncio (leitura do que foi gravado)", () => {
  it("devolve o objeto gravado", () => {
    const json = JSON.stringify({ titulo: "Rescisão", midiaTipo: "video" });
    expect(parseOrigemAnuncio(json)?.titulo).toBe("Rescisão");
  });

  it("contato sem origem e JSON corrompido devolvem null", () => {
    expect(parseOrigemAnuncio(null)).toBeNull();
    expect(parseOrigemAnuncio("")).toBeNull();
    expect(parseOrigemAnuncio("{quebrado")).toBeNull();
    expect(parseOrigemAnuncio("42")).toBeNull();
  });
});
