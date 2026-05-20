/**
 * Regressão: o atendimento agora envia notas de voz reais (gravadas via
 * MediaRecorder no navegador, upload base64, mediaUrl propagado pro
 * Baileys). Esses helpers cuidam dos detalhes que o frontend não vê.
 *
 * Antes os áudios não eram enviados — o componente só mandava texto
 * literal. Esses testes garantem que os helpers fazem o lado servidor
 * corretamente.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { resolverMediaPathLocal } from "../escritorio/router-crm";
import { detectarMimetypeAudio } from "../integracoes/whatsapp-baileys";

describe("resolverMediaPathLocal", () => {
  it("converte URL local '/uploads/...' para path absoluto resolvido a partir do cwd", () => {
    const resultado = resolverMediaPathLocal("/uploads/escritorio_5/abc.webm");
    expect(resultado).toBe(path.resolve(process.cwd(), "uploads/escritorio_5/abc.webm"));
    expect(path.isAbsolute(resultado)).toBe(true);
  });

  it("preserva URLs HTTP (Baileys também aceita)", () => {
    expect(resolverMediaPathLocal("https://cdn.example.com/x.mp3")).toBe("https://cdn.example.com/x.mp3");
    expect(resolverMediaPathLocal("http://example.com/x.mp3")).toBe("http://example.com/x.mp3");
  });

  it("preserva paths que já são absolutos (não force prefixar uploads)", () => {
    const absoluto = "/var/data/foo.mp3";
    expect(resolverMediaPathLocal(absoluto)).toBe(absoluto);
  });

  it("preserva qualquer string que não bate com padrão conhecido", () => {
    expect(resolverMediaPathLocal("data:audio/webm;base64,xxx")).toBe("data:audio/webm;base64,xxx");
  });
});

describe("detectarMimetypeAudio", () => {
  it("mapeia .webm pra audio/webm com codec opus (gravação Chrome/Firefox)", () => {
    expect(detectarMimetypeAudio("/uploads/x/nota-de-voz-123.webm")).toBe("audio/webm; codecs=opus");
  });

  it("mapeia .ogg/.oga pra audio/ogg com codec opus", () => {
    expect(detectarMimetypeAudio("/uploads/x/y.ogg")).toBe("audio/ogg; codecs=opus");
    expect(detectarMimetypeAudio("/uploads/x/y.oga")).toBe("audio/ogg; codecs=opus");
  });

  it("mapeia .mp4/.m4a pra audio/mp4 (gravação Safari)", () => {
    expect(detectarMimetypeAudio("/uploads/x/y.mp4")).toBe("audio/mp4");
    expect(detectarMimetypeAudio("/uploads/x/y.m4a")).toBe("audio/mp4");
  });

  it("mapeia .aac/.wav", () => {
    expect(detectarMimetypeAudio("foo.aac")).toBe("audio/aac");
    expect(detectarMimetypeAudio("foo.wav")).toBe("audio/wav");
  });

  it("desconhecido cai em audio/mpeg (fallback compatível)", () => {
    expect(detectarMimetypeAudio("foo.xyz")).toBe("audio/mpeg");
    expect(detectarMimetypeAudio("sem-extensao")).toBe("audio/mpeg");
  });

  it("ignora querystring e fragmento ao decidir a extensão", () => {
    expect(detectarMimetypeAudio("https://cdn/foo.webm?v=1&t=2")).toBe("audio/webm; codecs=opus");
    expect(detectarMimetypeAudio("/uploads/x/y.mp4#position=10")).toBe("audio/mp4");
  });

  it("é case-insensitive (arquivos vindos do Safari podem ter .MP4)", () => {
    expect(detectarMimetypeAudio("foo.WEBM")).toBe("audio/webm; codecs=opus");
    expect(detectarMimetypeAudio("foo.MP4")).toBe("audio/mp4");
  });
});
