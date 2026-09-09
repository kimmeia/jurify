import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  cartaoDoFunil,
  situacaoComercial,
  subMaisRelevante,
  type SubResumo,
} from "../admin/funil-remarketing";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const DIA = 24 * 60 * 60 * 1000;
const AGORA = 1_800_000_000_000;

const sub = (s: Partial<SubResumo>): SubResumo => ({
  status: "trialing",
  cortesia: false,
  cortesiaExpiraEm: null,
  trialIniciadoEm: null,
  trialExpiraEm: null,
  ...s,
});

/**
 * Funil de remarketing (mockup aprovado 25/08): o problema era advogado
 * cadastrar e ninguém ver. Estas regras são o que decide quem aparece nos
 * cartões "Pra falar hoje" — errar aqui = remarketing perdido de novo.
 */
describe("situacaoComercial — o motivo comercial de cada dono", () => {
  it("sem assinatura nenhuma = nunca ativou", () => {
    expect(situacaoComercial(null, AGORA)).toBe("nunca_ativou");
  });

  it("trial rodando: >7d = em teste; ≤7d = vencendo; passou = vencido", () => {
    expect(situacaoComercial(sub({ trialExpiraEm: AGORA + 10 * DIA }), AGORA)).toBe("em_teste");
    expect(situacaoComercial(sub({ trialExpiraEm: AGORA + 3 * DIA }), AGORA)).toBe("teste_vencendo");
    expect(situacaoComercial(sub({ trialExpiraEm: AGORA - 1 * DIA }), AGORA)).toBe("teste_vencido");
  });

  it("cancelada que teve trial = vencido; ativa = ativa; cortesia vigente ganha", () => {
    expect(situacaoComercial(sub({ status: "canceled", trialExpiraEm: AGORA - 5 * DIA }), AGORA)).toBe("teste_vencido");
    expect(situacaoComercial(sub({ status: "active" }), AGORA)).toBe("ativa");
    expect(situacaoComercial(sub({ status: "active", cortesia: true }), AGORA)).toBe("cortesia");
    // Cortesia expirada NÃO mascara o resto.
    expect(situacaoComercial(sub({ status: "active", cortesia: true, cortesiaExpiraEm: AGORA - DIA }), AGORA)).toBe("ativa");
  });

  it("inadimplente (past_due) NÃO vira remarketing de teste — tem fluxo próprio", () => {
    expect(situacaoComercial(sub({ status: "past_due" }), AGORA)).toBe("ativa");
  });

  it("entre várias subs, a ativa define a situação (não a de trial vencido)", () => {
    const escolhida = subMaisRelevante(
      [sub({ status: "canceled", trialExpiraEm: AGORA - 30 * DIA }), sub({ status: "active" })],
      AGORA,
    );
    expect(escolhida?.status).toBe("active");
  });
});

describe("cartaoDoFunil — quem conta como 'pra falar hoje'", () => {
  it("nunca ativou: entra se cadastrou há ≤90d e ainda não teve contato", () => {
    const base = { situacao: "nunca_ativou" as const, trialExpiraEm: null, agoraMs: AGORA };
    expect(cartaoDoFunil({ ...base, criadoEmMs: AGORA - 2 * DIA, ultimoContatoEm: null })).toBe("nunca_ativou");
    // Janela de 90d: os cadastros de 60-70d que o dono descobriu CONTAM.
    expect(cartaoDoFunil({ ...base, criadoEmMs: AGORA - 72 * DIA, ultimoContatoEm: null })).toBe("nunca_ativou");
    // Marcou contato depois do cadastro → sai da conta (o "2 vira 1").
    expect(cartaoDoFunil({ ...base, criadoEmMs: AGORA - 2 * DIA, ultimoContatoEm: AGORA - DIA })).toBe(null);
    // Conta morta de 4 meses não é "pra falar hoje".
    expect(cartaoDoFunil({ ...base, criadoEmMs: AGORA - 120 * DIA, ultimoContatoEm: null })).toBe(null);
  });

  it("cadastro solto (sem escritório) entra no funil — era o bug dos cartões zerados", () => {
    // A amarra é no SQL: a população do funil não pode voltar a ser só
    // donos de escritório, senão quem parou antes de confirmar o e-mail
    // (o alvo nº 1) some dos cartões de novo.
    const dbFonte = ler("server/db.ts");
    const trecho = dbFonte.slice(dbFonte.indexOf("const alvoFunil"), dbFonte.indexOf("const donos ="));
    expect(trecho).toContain("escritorios.ownerId");
    expect(trecho).toContain("notInArray");
    expect(trecho).toContain("colaboradores.ativo");
  });

  it("teste vencido: contato APÓS o vencimento tira da conta; antes não", () => {
    const base = { situacao: "teste_vencido" as const, criadoEmMs: AGORA - 40 * DIA, agoraMs: AGORA };
    const venceu = AGORA - 5 * DIA;
    expect(cartaoDoFunil({ ...base, trialExpiraEm: venceu, ultimoContatoEm: null })).toBe("teste_vencido");
    expect(cartaoDoFunil({ ...base, trialExpiraEm: venceu, ultimoContatoEm: venceu + DIA })).toBe(null);
    // Contato antigo (durante o trial) não conta — a pessoa venceu DEPOIS.
    expect(cartaoDoFunil({ ...base, trialExpiraEm: venceu, ultimoContatoEm: venceu - 3 * DIA })).toBe("teste_vencido");
  });

  it("ativa/cortesia nunca entram em cartão nenhum", () => {
    expect(
      cartaoDoFunil({ situacao: "ativa", criadoEmMs: AGORA - DIA, trialExpiraEm: null, ultimoContatoEm: null, agoraMs: AGORA }),
    ).toBe(null);
  });
});

describe("amarras — o funil chega inteiro nas telas", () => {
  it("migration 0207 + schema em sincronia (caderninho de contato)", () => {
    const sql = ler("drizzle/0207_contato_comercial.sql");
    expect(sql).toContain("ultimoContatoComercialEm");
    const schema = ler("drizzle/schema.ts");
    expect(schema).toContain("ultimoContatoComercialEm");
    expect(schema).toContain("ultimoContatoComercialCanal");
  });

  it("marcarContatoComercial grava o resumo no user E a nota comercial na ficha", () => {
    const adm = ler("server/routers/admin.ts");
    const trecho = adm.slice(adm.indexOf("marcarContatoComercial:"), adm.indexOf("recentUsers:"));
    expect(trecho).toContain("ultimoContatoComercialEm");
    expect(trecho).toContain("clienteNotasAdmin");
    expect(trecho).toContain('categoria: "comercial"');
  });

  it("filtro do funil usa os MESMOS ids que o cartão contou", () => {
    const dbFonte = ler("server/db.ts");
    expect(dbFonte).toContain("calcularFunilRemarketing");
    const trecho = dbFonte.slice(dbFonte.indexOf("if (opts.funil)"), dbFonte.indexOf("const whereClause"));
    expect(trecho).toContain("conds.push(inArray(users.id, ids))");
  });

  it("/admin/clients tem os 3 cartões, a coluna Situação e o marcar contato", () => {
    const tela = ler("client/src/pages/admin/AdminClients.tsx");
    expect(tela).toContain("FunilCards");
    expect(tela).toContain("Cadastraram e não ativaram");
    expect(tela).toContain("SituacaoBadge");
    expect(tela).toContain("marcarContatoComercial");
    // Deep-link do card da Visão Geral.
    expect(tela).toContain('get("funil")');
  });

  it("Visão Geral avisa cadastro novo sem ativação — era ali que o dono não via", () => {
    const dash = ler("client/src/pages/AdminDashboard.tsx");
    expect(dash).toContain("funilRemarketing");
    expect(dash).toContain("/admin/clients?funil=nunca_ativou");
  });
});
