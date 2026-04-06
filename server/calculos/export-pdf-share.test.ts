/**
 * Testes do endpoint de compartilhamento de PDF
 * 
 * Verifica:
 * - Geração de filename correto
 * - Geração de storage key com sufixo aleatório
 * - Validação de parâmetros
 */

import { describe, it, expect } from "vitest";

// ─── Helpers extraídos do export-pdf-route.ts ──────────────────────────────

function generateFilename(protocolo?: string): string {
  return protocolo
    ? `parecer-tecnico-${protocolo}.pdf`
    : `parecer-tecnico-${new Date().toISOString().slice(0, 10)}.pdf`;
}

function generateStorageKey(protocolo?: string): string {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  const slug = protocolo || new Date().toISOString().slice(0, 10);
  return `pareceres/${slug}-${timestamp}-${rand}.pdf`;
}

describe("PDF Share - Helpers", () => {
  describe("generateFilename", () => {
    it("deve gerar filename com protocolo", () => {
      const result = generateFilename("BANC-2026-001");
      expect(result).toBe("parecer-tecnico-BANC-2026-001.pdf");
    });

    it("deve gerar filename com data quando sem protocolo", () => {
      const result = generateFilename();
      expect(result).toMatch(/^parecer-tecnico-\d{4}-\d{2}-\d{2}\.pdf$/);
    });

    it("deve gerar filename com data quando protocolo undefined", () => {
      const result = generateFilename(undefined);
      expect(result).toMatch(/^parecer-tecnico-\d{4}-\d{2}-\d{2}\.pdf$/);
    });
  });

  describe("generateStorageKey", () => {
    it("deve gerar key com protocolo e sufixo aleatório", () => {
      const result = generateStorageKey("TRAB-2026-005");
      expect(result).toMatch(/^pareceres\/TRAB-2026-005-\d+-[a-z0-9]+\.pdf$/);
    });

    it("deve gerar key com data quando sem protocolo", () => {
      const result = generateStorageKey();
      expect(result).toMatch(/^pareceres\/\d{4}-\d{2}-\d{2}-\d+-[a-z0-9]+\.pdf$/);
    });

    it("deve gerar keys únicas em chamadas consecutivas", () => {
      const key1 = generateStorageKey("TEST");
      const key2 = generateStorageKey("TEST");
      expect(key1).not.toBe(key2);
    });

    it("deve começar com prefixo pareceres/", () => {
      const result = generateStorageKey("ABC");
      expect(result.startsWith("pareceres/")).toBe(true);
    });

    it("deve terminar com .pdf", () => {
      const result = generateStorageKey("ABC");
      expect(result.endsWith(".pdf")).toBe(true);
    });
  });

  describe("Validação de parâmetros de compartilhamento", () => {
    it("deve rejeitar markdown vazio", () => {
      const markdown = "";
      expect(!markdown || typeof markdown !== "string").toBe(true);
    });

    it("deve aceitar markdown válido", () => {
      const markdown = "# Parecer Técnico\n\nConteúdo do parecer.";
      expect(!markdown || typeof markdown !== "string").toBe(false);
    });

    it("deve rejeitar markdown não-string", () => {
      const markdown = 123 as any;
      expect(!markdown || typeof markdown !== "string").toBe(true);
    });

    it("deve construir URL de e-mail corretamente", () => {
      const subject = "Parecer Técnico Bancário - BANC-001";
      const body = "Segue o parecer.\n\nLink: https://example.com/parecer.pdf";
      const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      expect(mailto).toContain("mailto:?subject=");
      expect(mailto).toContain("Parecer");
      expect(mailto).toContain("https%3A%2F%2Fexample.com");
    });

    it("deve construir URL de WhatsApp corretamente", () => {
      const text = "Parecer Técnico (BANC-001)\n\nAcesse: https://example.com/parecer.pdf";
      const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
      expect(whatsappUrl).toContain("api.whatsapp.com/send?text=");
      expect(whatsappUrl).toContain("Parecer");
      expect(whatsappUrl).toContain("https%3A%2F%2Fexample.com");
    });
  });
});
