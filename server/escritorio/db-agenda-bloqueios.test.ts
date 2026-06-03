import { describe, expect, it } from "vitest";
import { bloqueiosAplicaveis } from "./db-agenda-bloqueios";
import type { AgendaBloqueio } from "../../drizzle/schema";

function bloqueio(overrides: Partial<AgendaBloqueio>): AgendaBloqueio {
  return {
    id: 1, escritorioId: 1, data: "2026-12-25", horaInicio: null, horaFim: null,
    motivo: null, recorrenteAnual: false, criadoPorId: null, createdAt: new Date(),
    ...overrides,
  } as AgendaBloqueio;
}

describe("bloqueiosAplicaveis", () => {
  it("retorna o bloqueio quando data bate exatamente", () => {
    const todos = [bloqueio({ data: "2026-04-21", motivo: "Tiradentes" })];
    expect(bloqueiosAplicaveis("2026-04-21", todos)).toHaveLength(1);
    expect(bloqueiosAplicaveis("2026-04-22", todos)).toHaveLength(0);
  });

  it("recorrenteAnual=true: aplica em qualquer ano no mesmo dia/mês", () => {
    const todos = [bloqueio({ data: "2024-12-25", motivo: "Natal", recorrenteAnual: true })];
    expect(bloqueiosAplicaveis("2026-12-25", todos)).toHaveLength(1);
    expect(bloqueiosAplicaveis("2027-12-25", todos)).toHaveLength(1);
    expect(bloqueiosAplicaveis("2026-12-24", todos)).toHaveLength(0);
  });

  it("recorrenteAnual=false: NÃO se aplica em ano diferente", () => {
    const todos = [bloqueio({ data: "2026-06-15", motivo: "Evento pontual", recorrenteAnual: false })];
    expect(bloqueiosAplicaveis("2026-06-15", todos)).toHaveLength(1);
    expect(bloqueiosAplicaveis("2027-06-15", todos)).toHaveLength(0);
  });
});
