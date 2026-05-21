import { describe, expect, it } from "vitest";
import {
  extractDbErrorMessage,
  isDuplicateEntryError,
} from "../_core/sql-helpers";

describe("isDuplicateEntryError", () => {
  it("pega mysql2 cru com code", () => {
    expect(isDuplicateEntryError({ code: "ER_DUP_ENTRY", message: "x" })).toBe(true);
  });

  it("pega mysql2 cru com errno numerico", () => {
    expect(isDuplicateEntryError({ errno: 1062, message: "x" })).toBe(true);
  });

  it("pega via message regex (sem code)", () => {
    expect(isDuplicateEntryError({ message: "Duplicate entry '2-x' for key 'uq'" })).toBe(true);
  });

  it("pega Drizzle wrap: code so em err.cause", () => {
    const err = {
      message: "Failed query: insert into despesas ...",
      cause: { code: "ER_DUP_ENTRY", errno: 1062, message: "Duplicate entry '...' for key '...'" },
    };
    expect(isDuplicateEntryError(err)).toBe(true);
  });

  it("pega Drizzle wrap: so cause.errno", () => {
    const err = {
      message: "Failed query: ...",
      cause: { errno: 1062 },
    };
    expect(isDuplicateEntryError(err)).toBe(true);
  });

  it("pega Drizzle wrap: so via cause.message", () => {
    const err = {
      message: "Failed query: insert into despesas",
      cause: { message: "Duplicate entry 'x' for key 'desp_asaas_fintrans_uq'" },
    };
    expect(isDuplicateEntryError(err)).toBe(true);
  });

  it("nao confunde outros erros de FK/constraint", () => {
    expect(
      isDuplicateEntryError({
        message: "Failed query: ...",
        cause: { code: "ER_NO_REFERENCED_ROW_2", message: "Cannot add or update a child row" },
      }),
    ).toBe(false);
  });

  it("nao quebra com null/undefined", () => {
    expect(isDuplicateEntryError(null)).toBe(false);
    expect(isDuplicateEntryError(undefined)).toBe(false);
    expect(isDuplicateEntryError("string solta")).toBe(false);
  });

  it("nao quebra com objeto vazio", () => {
    expect(isDuplicateEntryError({})).toBe(false);
  });
});

describe("extractDbErrorMessage", () => {
  it("prefere cause.message quando Drizzle empacota", () => {
    const err = {
      message: "Failed query: insert into despesas ... params: ...",
      cause: { code: "ER_DUP_ENTRY", message: "Duplicate entry '2-ftn_001' for key 'desp_asaas_fintrans_uq'" },
    };
    expect(extractDbErrorMessage(err)).toBe(
      "Duplicate entry '2-ftn_001' for key 'desp_asaas_fintrans_uq'",
    );
  });

  it("usa err.message quando nao tem cause", () => {
    expect(extractDbErrorMessage({ message: "ENOTFOUND" })).toBe("ENOTFOUND");
  });

  it("cai pra String(err) quando err nao e objeto", () => {
    expect(extractDbErrorMessage("texto solto")).toBe("texto solto");
    expect(extractDbErrorMessage(null)).toBe("");
  });
});
