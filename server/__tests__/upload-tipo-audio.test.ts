/**
 * Regressão: notas de voz (gravadas via MediaRecorder) eram rejeitadas no
 * upload com "Conteúdo do arquivo é \"video/webm\", que não é permitido."
 *
 * Causa: o file-type detecta o container WebM/MP4 como `video/*` mesmo
 * quando ele carrega só áudio. A allowlist do conteúdo barrava `video/webm`
 * ANTES de a exceção `audioContainerCompativel` ser consultada (ela só
 * rodava no gate de match declarado-vs-conteúdo). Resultado: a nota de voz
 * nunca subia, mesmo o cliente declarando corretamente `audio/webm`.
 *
 * Estes testes travam a regra: a tolerância de container de áudio vale nos
 * dois gates, e nada além dessas duas duplas é afrouxado.
 */

import { describe, it, expect } from "vitest";
import { rejeitarConteudoDetectado } from "../upload/upload-route";

describe("rejeitarConteudoDetectado", () => {
  it("aceita audio/webm declarado quando o file-type detecta video/webm", () => {
    expect(rejeitarConteudoDetectado("audio/webm", "video/webm")).toBeNull();
  });

  it("aceita audio/mp4 declarado quando o file-type detecta video/mp4 (Safari)", () => {
    expect(rejeitarConteudoDetectado("audio/mp4", "video/mp4")).toBeNull();
  });

  it("aceita match exato de um tipo permitido", () => {
    expect(rejeitarConteudoDetectado("application/pdf", "application/pdf")).toBeNull();
    expect(rejeitarConteudoDetectado("image/png", "image/png")).toBeNull();
    expect(rejeitarConteudoDetectado("audio/ogg", "audio/ogg")).toBeNull();
  });

  it("rejeita vídeo de verdade (declarado e detectado como video/webm)", () => {
    const motivo = rejeitarConteudoDetectado("video/webm", "video/webm");
    expect(motivo).toContain("não é permitido");
  });

  it("não afrouxa a exceção pra video/* fora das duplas de áudio", () => {
    // declarar audio/ogg não deve liberar um conteúdo video/webm
    expect(rejeitarConteudoDetectado("audio/ogg", "video/webm")).toContain("não é permitido");
    // nem o cruzamento webm<->mp4
    expect(rejeitarConteudoDetectado("audio/mp4", "video/webm")).toContain("não é permitido");
    // video/mp4 entrou na allowlist (anexo de vídeo do composer), mas
    // declarar audio/webm com conteúdo video/mp4 segue REJEITADO — agora
    // pelo mismatch declarado≠detectado, não mais pela allowlist.
    expect(rejeitarConteudoDetectado("audio/webm", "video/mp4")).toContain("não bate com o conteúdo");
  });

  it("aceita vídeo MP4 legítimo (declarado e detectado como video/mp4)", () => {
    expect(rejeitarConteudoDetectado("video/mp4", "video/mp4")).toBeNull();
  });

  it("rejeita conteúdo que não está na allowlist (ex: executável)", () => {
    expect(rejeitarConteudoDetectado("application/pdf", "application/x-msdownload"))
      .toContain("não é permitido");
  });

  it("rejeita divergência declarado-vs-conteúdo entre tipos permitidos", () => {
    const motivo = rejeitarConteudoDetectado("application/pdf", "image/png");
    expect(motivo).toContain("não bate");
  });
});
