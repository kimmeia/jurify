import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { verificarTurnstile, turnstileAtivo } from "../_core/turnstile";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("Turnstile — fail-open por configuração, fail-closed com chave", () => {
  afterEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("sem TURNSTILE_SECRET_KEY o cadastro segue como sempre", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(turnstileAtivo()).toBe(false);
    expect((await verificarTurnstile(undefined, "1.2.3.4")).ok).toBe(true);
  });

  it("com a chave presente, token ausente barra (sem nem chamar a Cloudflare)", async () => {
    process.env.TURNSTILE_SECRET_KEY = "chave-de-teste";
    expect(turnstileAtivo()).toBe(true);
    const r = await verificarTurnstile(undefined, "1.2.3.4");
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("token_ausente");
  });
});

describe("amarras — métricas reais e proteção do funil", () => {
  it("MRR não inventa mais R$ 97: preço vem da tabela planos + valor negociado", () => {
    const dbFonte = ler("server/db.ts");
    const stats = dbFonte.slice(dbFonte.indexOf("export async function getAdminStats"), dbFonte.indexOf("Colunas seguras de `users`"));
    expect(stats).not.toContain("9700");
    expect(stats).not.toContain("PLANS");
    expect(stats).toContain("valorNegociadoCentavos");
    // Cortesia e trial não são receita.
    expect(stats).toContain("if (sub.cortesia) continue;");
    // ...nem contam como "assinatura paga": cortesia fica status='active',
    // e sem o filtro o painel dizia "1 plano pago" pra quem só tem cortesia.
    expect(stats).toContain("activeSubs.filter((s) => !s.cortesia)");
    expect(stats).toContain("cortesiasAtivas");
  });

  it("receitaMensal e inadimplentes saíram do PLANS deprecado", () => {
    const adm = ler("server/routers/admin.ts");
    const receita = adm.slice(adm.indexOf("receitaMensal:"), adm.indexOf("calculosPorModulo:"));
    expect(receita).not.toContain("PLANS");
    expect(receita).toContain("valorNegociadoCentavos");
    expect(receita).toContain("leftJoin(planosTable");

    const inad = adm.slice(adm.indexOf("listarInadimplentes:"), adm.indexOf("listarAuditoria:"));
    expect(inad).not.toContain("PLANS");
    expect(inad).toContain("valorNegociadoCentavos");
  });

  it("signup verifica o Turnstile e o form envia o token", () => {
    const auth = ler("server/routers/auth.ts");
    expect(auth).toContain("verificarTurnstile(input.turnstileToken, ip)");

    const form = ler("client/src/pages/auth/AuthForms.tsx");
    expect(form).toContain("TurnstileWidget");
    expect(form).toContain("turnstileToken");
  });

  it("/cadastro remonta o form ao trocar de modo — sem isso mostrava o LOGIN", () => {
    // /login e /cadastro montam AuthForms na mesma posição da árvore; sem a
    // key o React reaproveita a instância e o estado `tab` fica preso.
    const split = ler("client/src/pages/auth/AuthSplitPage.tsx");
    expect(split).toContain("key={modo}");
  });

  it("dashboard processual guia quem ainda não tem credencial (guia de 3 passos)", () => {
    const dash = ler("client/src/pages/dashboards/DashboardProcessual.tsx");
    expect(dash).toContain("cofreCredenciais.listarParaSelecao");
    expect(dash).toContain("<GuiaProcessual");

    // O guia substituiu o aviso amber — e leva direto pro Cofre.
    const guia = ler("client/src/pages/dashboards/GuiaProcessual.tsx");
    expect(guia).toContain("Conectar credencial");
    expect(guia).toContain("/processos?tab=cofre");
  });
});
