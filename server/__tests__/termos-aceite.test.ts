import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { TERMOS_VERSAO, precisaAceitarTermos } from "../../shared/termos";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("precisaAceitarTermos", () => {
  const dono = { role: "user", impersonado: false, ehDono: true };

  it("dono com versão antiga (ou nenhuma) é travado", () => {
    expect(precisaAceitarTermos({ ...dono, versaoAceita: 0 })).toBe(true);
    expect(precisaAceitarTermos({ ...dono, versaoAceita: null })).toBe(true);
    expect(precisaAceitarTermos({ ...dono, versaoAceita: TERMOS_VERSAO - 1 })).toBe(true);
  });

  it("dono com a versão vigente passa direto", () => {
    expect(precisaAceitarTermos({ ...dono, versaoAceita: TERMOS_VERSAO })).toBe(false);
    expect(precisaAceitarTermos({ ...dono, versaoAceita: TERMOS_VERSAO + 1 })).toBe(false);
  });

  it("colaborador nunca é travado — quem responde pelo contrato é o dono", () => {
    expect(precisaAceitarTermos({ role: "user", impersonado: false, ehDono: false, versaoAceita: 0 })).toBe(false);
  });

  it("admin e impersonação nunca aceitam — aceite é ato pessoal do contratante", () => {
    expect(precisaAceitarTermos({ role: "admin", impersonado: false, ehDono: true, versaoAceita: 0 })).toBe(false);
    expect(precisaAceitarTermos({ role: "user", impersonado: true, ehDono: true, versaoAceita: 0 })).toBe(false);
  });
});

describe("amarras do aceite no código", () => {
  it("o cadastro trava o botão sem o aceite e grava a trilha com IP", () => {
    const form = ler("client/src/pages/auth/AuthForms.tsx");
    expect(form).toContain("!aceitouTermos");
    expect(form).toContain("marque o aceite acima pra habilitar o botão");

    const auth = ler("server/routers/auth.ts");
    expect(auth).toContain("termosVersaoAceita: TERMOS_VERSAO");
    expect(auth).toContain('contexto: "cadastro"');
  });

  it("o gate bloqueante não fecha sem aceitar (sem X, sem Esc, sem clicar fora)", () => {
    const gate = ler("client/src/components/TermosGate.tsx");
    expect(gate).toContain("[&>button]:hidden");
    expect(gate).toContain("onInteractOutside={(e) => e.preventDefault()}");
    expect(gate).toContain("onEscapeKeyDown={(e) => e.preventDefault()}");
    expect(gate).toContain("disabled={!aceitou");
  });

  it("o gate está montado na área logada, antes do guard de assinatura", () => {
    const app = ler("client/src/App.tsx");
    const areaCliente = app.slice(app.indexOf("function ClientArea"), app.indexOf("function ClientAreaNoGuard"));
    expect(areaCliente.indexOf("<TermosGate />")).toBeGreaterThan(-1);
    expect(areaCliente.indexOf("<TermosGate />")).toBeLessThan(areaCliente.indexOf("<SubscriptionGuard>"));
  });

  it("o texto vigente traz a cláusula de responsabilidade e os suboperadores de IA", () => {
    const termos = ler("client/src/pages/Termos.tsx");
    expect(termos).toContain("responsabilidade exclusiva do");
    expect(termos).toContain("Escritório é o CONTROLADOR");
    expect(termos).toContain("OpenAI e Anthropic");

    const privacidade = ler("client/src/pages/Privacidade.tsx");
    expect(privacidade).toContain("Anthropic");
    expect(privacidade).toContain("não usam esses dados pra");
  });

  it("a migration acompanha a versão: contas antigas ficam abaixo da vigente", () => {
    // O UPDATE marca contas com aceite antigo como versão 1; se TERMOS_VERSAO
    // não for maior que 1, o re-aceite do texto novo nunca dispara.
    expect(TERMOS_VERSAO).toBeGreaterThan(1);
    const migration = ler("drizzle/0202_aceite_termos_versionado.sql");
    expect(migration).toContain("SET termosVersaoAceita = 1 WHERE aceitouTermosEm IS NOT NULL");
  });
});
