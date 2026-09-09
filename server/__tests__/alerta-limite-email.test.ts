import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  decidirNivel,
  ehErroDeLimite,
  FRACAO_AVISO,
  LIMITE_DIARIO_PADRAO,
} from "../_core/email-limite";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/**
 * Monitor do limite diário do Resend (mockup aprovado 25/08): amarelo aos
 * 80%, vermelho quando o Resend recusa, e-mail de aviso com retry até a
 * cota renovar, reenvio automático do que falhou por limite.
 */
describe("ehErroDeLimite — reconhece a recusa do Resend por limite", () => {
  it("pega o formato gravado no email_log (status + body)", () => {
    expect(ehErroDeLimite('429 {"message":"Too many requests"}')).toBe(true);
    expect(ehErroDeLimite("You have reached your daily email quota")).toBe(true);
    expect(ehErroDeLimite("rate_limit_exceeded")).toBe(true);
    expect(ehErroDeLimite("Erro ao enviar email (429): rate limit")).toBe(true);
  });

  it("não confunde outras falhas com limite", () => {
    expect(ehErroDeLimite('403 {"message":"domain not verified"}')).toBe(false);
    expect(ehErroDeLimite("401 API key inválida")).toBe(false);
    expect(ehErroDeLimite(null)).toBe(false);
    expect(ehErroDeLimite(undefined)).toBe(false);
    expect(ehErroDeLimite("")).toBe(false);
  });
});

describe("decidirNivel — amarelo pela contagem, vermelho só com recusa real", () => {
  it("79/100 sem falhas = ok; 80/100 = aviso (80%)", () => {
    expect(decidirNivel({ usadosHoje: 79, limite: 100, falhasLimite24h: 0 })).toBe("ok");
    expect(decidirNivel({ usadosHoje: 80, limite: 100, falhasLimite24h: 0 })).toBe("aviso");
    expect(FRACAO_AVISO).toBe(0.8);
    expect(LIMITE_DIARIO_PADRAO).toBe(100);
  });

  it("falha por limite = estouro, mesmo com contagem baixa (reinício de dia UTC)", () => {
    expect(decidirNivel({ usadosHoje: 5, limite: 100, falhasLimite24h: 3 })).toBe("estouro");
  });

  it("limite 0 desliga o amarelo (pós-upgrade), mas o vermelho continua valendo", () => {
    expect(decidirNivel({ usadosHoje: 500, limite: 0, falhasLimite24h: 0 })).toBe("ok");
    expect(decidirNivel({ usadosHoje: 500, limite: 0, falhasLimite24h: 1 })).toBe("estouro");
  });
});

describe("amarras — o alerta chega inteiro no painel e no cron", () => {
  it("cron registra o monitor de hora em hora", () => {
    const cron = ler("server/_core/cron-jobs.ts");
    expect(cron).toContain("verificarLimiteEmails");
  });

  it("router expõe limiteDiario pro card da Visão Geral", () => {
    const rt = ler("server/admin/router-admin-email-log.ts");
    expect(rt).toContain("limiteDiario:");
    expect(rt).toContain("statusLimiteEmails");
  });

  it("Visão Geral mostra o card com upgrade e caminho pro log", () => {
    const dash = ler("client/src/pages/AdminDashboard.tsx");
    expect(dash).toContain("adminEmailLog.limiteDiario");
    expect(dash).toContain("Fazer upgrade no Resend");
    expect(dash).toContain("/admin/saude?aba=emails");
    // Vermelho e amarelo são o MESMO card com tom diferente.
    expect(dash).toContain('nivel === "estouro"');
  });

  it("reenvio automático prioriza confirmações de cadastro e para no primeiro 429", () => {
    const mon = ler("server/_core/email-limite.ts");
    expect(mon).toContain('"confirmacao_email"');
    expect(mon).toContain("if (r.porLimite) break;");
    // Dedup do aviso: 1 sucesso por dia UTC — a falha 429 do próprio aviso
    // não conta, é o que faz ele sair sozinho quando a cota renova.
    expect(mon).toContain("avisadoHoje");
  });
});
