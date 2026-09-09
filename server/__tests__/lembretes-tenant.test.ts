/**
 * Lembrete de agendamento respeita a parede entre escritórios.
 *
 * `agendamento_lembretes` não tem escritorioId — a tenancy vem do pai. O
 * `removerLembrete` sempre fez o join; a LISTAGEM não fazia, e devolvia os
 * lembretes de qualquer agendamento cujo id fosse chutado. Achado na
 * auditoria de isolamento de 18/08.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const router = readFileSync(
  join(__dirname, "..", "escritorio", "router-agenda.ts"),
  "utf8",
);

describe("lembretes e a parede entre escritórios", () => {
  const corpoDe = (nome: string) => {
    const i = router.indexOf(`${nome}: protectedProcedure`);
    expect(i, `${nome} sumiu`).toBeGreaterThan(0);
    return router.slice(i, i + 1800);
  };

  it("listar exige que o agendamento seja do escritório", () => {
    const corpo = corpoDe("listarLembretes");
    expect(corpo).toContain("innerJoin(agendamentos");
    expect(corpo).toContain("eq(agendamentos.escritorioId, perm.escritorioId)");
  });

  it("salvar e remover continuam validando o pai", () => {
    expect(corpoDe("salvarLembretes")).toContain("ag.escritorioId !== perm.escritorioId");
    expect(corpoDe("removerLembrete")).toContain("eq(agendamentos.escritorioId, perm.escritorioId)");
  });
});
