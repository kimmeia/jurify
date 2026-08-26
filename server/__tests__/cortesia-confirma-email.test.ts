import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/**
 * Conta liberada na mão pelo admin não pode ficar presa no "confirme seu
 * e-mail" (26/08: o dono criou uma demo com e-mail fictício, deu cortesia
 * e o login continuou barrado — e-mail fictício nunca confirma). Cortesia
 * e ativação manual passam a marcar o e-mail como verificado.
 */
describe("ação manual do admin confirma o e-mail", () => {
  const adm = ler("server/routers/admin.ts");

  it("as 3 portas de liberação manual chamam a confirmação", () => {
    expect(adm).toContain("async function confirmarEmailPorAcaoAdmin");
    // Cortesia por assinatura, cortesia por user e ativação negociada.
    const chamadas = adm.split("await confirmarEmailPorAcaoAdmin(").length - 1;
    expect(chamadas).toBeGreaterThanOrEqual(3);
  });

  it("só marca quem ainda não confirmou — não sobrescreve a data original", () => {
    const helper = adm.slice(
      adm.indexOf("async function confirmarEmailPorAcaoAdmin"),
      adm.indexOf("export const adminRouter"),
    );
    expect(helper).toContain("emailVerificado: true");
    expect(helper).toContain("eq(users.emailVerificado, false)");
  });

  it("migration 0208 destrava as contas de cortesia que JÁ estavam presas", () => {
    const sql = ler("drizzle/0208_email_confirmado_cortesia.sql");
    expect(sql).toContain("s.cortesia = 1");
    expect(sql).toContain("email_verificado = 1");
    expect(sql).toContain("WHERE u.email_verificado = 0");
  });
});
