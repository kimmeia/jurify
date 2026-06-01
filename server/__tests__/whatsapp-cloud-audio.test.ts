/**
 * Nota de voz na WhatsApp Cloud API.
 *
 * A Cloud API rejeita áudio webm (formato que o Chrome grava) — por isso o
 * upload precisa converter pra ogg/opus antes de subir. Estes testes travam
 * a regra de decisão: o que converte e o que passa direto. (A conversão em si
 * roda ffmpeg e é validada no ambiente; aqui cobrimos a decisão pura.)
 */

import { describe, it, expect } from "vitest";
import { decidirFormatoAudioCloud } from "../integracoes/whatsapp-cloud-audio";

describe("decidirFormatoAudioCloud", () => {
  it("converte webm (Chrome/Edge) pra ogg/opus", () => {
    const r = decidirFormatoAudioCloud("nota-de-voz-123.webm");
    expect(r.converter).toBe(true);
    expect(r.mime).toBe("audio/ogg");
  });

  it("converte wav (não suportado pela Cloud API) pra ogg", () => {
    expect(decidirFormatoAudioCloud("x.wav").converter).toBe(true);
  });

  it("passa ogg direto (Firefox grava ogg/opus, já aceito)", () => {
    const r = decidirFormatoAudioCloud("x.ogg");
    expect(r.converter).toBe(false);
    expect(r.mime).toBe("audio/ogg");
  });

  it("passa m4a/mp4 direto como audio/mp4 (Safari)", () => {
    expect(decidirFormatoAudioCloud("x.m4a")).toEqual({ converter: false, mime: "audio/mp4" });
    expect(decidirFormatoAudioCloud("x.mp4")).toEqual({ converter: false, mime: "audio/mp4" });
  });

  it("passa mp3/aac/amr direto com o mime certo", () => {
    expect(decidirFormatoAudioCloud("x.mp3").mime).toBe("audio/mpeg");
    expect(decidirFormatoAudioCloud("x.aac").mime).toBe("audio/aac");
    expect(decidirFormatoAudioCloud("x.amr").mime).toBe("audio/amr");
  });

  it("é case-insensitive e ignora o caminho", () => {
    expect(decidirFormatoAudioCloud("/uploads/escritorio_5/NOTA.WEBM").converter).toBe(true);
    expect(decidirFormatoAudioCloud("/uploads/escritorio_5/foo.OGG").converter).toBe(false);
  });

  it("extensão desconhecida cai na conversão (lado seguro)", () => {
    expect(decidirFormatoAudioCloud("arquivo-sem-ext").converter).toBe(true);
    expect(decidirFormatoAudioCloud("x.bin").converter).toBe(true);
  });
});
