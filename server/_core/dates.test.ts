import { describe, it, expect } from "vitest";
import { toIsoString } from "./dates";

describe("toIsoString", () => {
  it("Date → ISO", () => {
    const d = new Date("2026-05-15T14:30:00.000Z");
    expect(toIsoString(d)).toBe("2026-05-15T14:30:00.000Z");
  });

  it("string MySQL 'YYYY-MM-DD HH:MM:SS' → ISO", () => {
    const iso = toIsoString("2026-05-15 14:30:00");
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getUTCFullYear()).toBe(2026);
  });

  it("string ISO já formatada → ISO", () => {
    expect(toIsoString("2026-05-15T14:30:00.000Z")).toBe("2026-05-15T14:30:00.000Z");
  });

  it("null → null", () => {
    expect(toIsoString(null)).toBeNull();
  });

  it("undefined → null", () => {
    expect(toIsoString(undefined)).toBeNull();
  });

  it("string inválida → null (não lança)", () => {
    expect(toIsoString("não-é-data")).toBeNull();
    expect(toIsoString("")).toBeNull();
  });

  it("number (epoch ms) → ISO", () => {
    expect(toIsoString(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("não lança em entrada que era o bug original (MAX() retornando string)", () => {
    const maxData: Date | string | null = "2026-05-15 14:30:00";
    expect(() => toIsoString(maxData)).not.toThrow();
    expect(toIsoString(maxData)).toMatch(/^2026-05-15T/);
  });
});
