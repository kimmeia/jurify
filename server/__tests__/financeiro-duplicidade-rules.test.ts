/**
 * Testes — regras puras de duplicidade do financeiro.
 *
 * Cobre a matriz de decisão que sustenta as 4 procedures novas:
 *  - Sprint 1 — `decidirExcluirCobranca` (excluirCobranca)
 *  - Sprint 2 — `decidirVinculoBeneficiario` (vincularPagamentoBeneficiario)
 *  - Sprint 3 — `decidirResolverPar` (resolverDuplicataPar — auto-fix)
 *  - Sprint 4 — `pontuarDuplicataPotencial` (buscarDuplicataPotencial)
 *
 * Funções puras: sem DB, sem rede. Testa só a regra de negócio.
 */

import { describe, it, expect } from "vitest";
import {
  decidirExcluirCobranca,
  decidirVinculoBeneficiario,
  decidirResolverPar,
  pontuarDuplicataPotencial,
  diffEmDias,
  type CobrancaParaRegra,
  type CobrancaParaScore,
  type BeneficiarioParaRegra,
} from "../integracoes/financeiro-duplicidade-rules";

function cob(overrides: Partial<CobrancaParaRegra> = {}): CobrancaParaRegra {
  return {
    id: 1,
    origem: "asaas",
    status: "PENDING",
    asaasPaymentId: "pay_123",
    contatoId: 10,
    contatoBeneficiarioId: null,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint 1 — excluirCobranca
// ════════════════════════════════════════════════════════════════════════════

describe("decidirExcluirCobranca — Sprint 1", () => {
  it("manual + status pago + sem fechamento → OK (caso Carlos+esposa)", () => {
    const r = decidirExcluirCobranca(
      cob({ origem: "manual", status: "RECEIVED", asaasPaymentId: null }),
      null,
    );
    expect(r).toEqual({ ok: true, data: { ehManual: true, precisaCancelarNoAsaas: false } });
  });

  it("manual + PENDING + sem fechamento → OK", () => {
    const r = decidirExcluirCobranca(
      cob({ origem: "manual", status: "PENDING", asaasPaymentId: null }),
      null,
    );
    expect(r.ok).toBe(true);
  });

  it("Asaas + PENDING + sem fechamento → OK (precisa cancelar via API)", () => {
    const r = decidirExcluirCobranca(cob({ status: "PENDING" }), null);
    expect(r).toEqual({
      ok: true,
      data: { ehManual: false, precisaCancelarNoAsaas: true },
    });
  });

  it("Asaas + RECEIVED + sem fechamento → BAD_REQUEST (cancele no painel)", () => {
    const r = decidirExcluirCobranca(cob({ status: "RECEIVED" }), null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("BAD_REQUEST");
    expect(r.message).toContain("painel do Asaas");
  });

  it("Asaas + OVERDUE + sem fechamento → BAD_REQUEST (cancele no painel)", () => {
    const r = decidirExcluirCobranca(cob({ status: "OVERDUE" }), null);
    expect(r.ok).toBe(false);
  });

  it("manual + em fechamento → BAD_REQUEST mesmo sendo manual", () => {
    const r = decidirExcluirCobranca(
      cob({ origem: "manual", status: "RECEIVED", asaasPaymentId: null }),
      42,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("#42");
    expect(r.message).toContain("Exclua o fechamento");
  });

  it("Asaas PENDING + em fechamento → BAD_REQUEST (mensagem de fechamento, não de status)", () => {
    const r = decidirExcluirCobranca(cob({ status: "PENDING" }), 7);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("#7");
  });

  it("ordem das checagens: Asaas-não-PENDING ganha de fechamento (mensagem mais útil)", () => {
    // Cobrança Asaas RECEIVED em fechamento — operador tem 2 problemas. A
    // mensagem "cancele no painel do Asaas" é mais acionável porque mesmo
    // depois de excluir o fechamento, ele ainda não conseguiria excluir
    // pelo CRM. Garantimos essa ordem.
    const r = decidirExcluirCobranca(cob({ status: "RECEIVED" }), 99);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("painel do Asaas");
    expect(r.message).not.toContain("#99");
  });

  it("origem null + asaasPaymentId null → trata como manual (defensivo)", () => {
    const r = decidirExcluirCobranca(
      cob({ origem: null, asaasPaymentId: null, status: "OVERDUE" }),
      null,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ehManual).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Sprint 2 — vincularPagamentoBeneficiario
// ════════════════════════════════════════════════════════════════════════════

function benef(overrides: Partial<BeneficiarioParaRegra> = {}): BeneficiarioParaRegra {
  return { id: 20, responsavelId: 5, ...overrides };
}

describe("decidirVinculoBeneficiario — Sprint 2", () => {
  it("pagador != beneficiário + sem fechamento → OK", () => {
    const r = decidirVinculoBeneficiario({
      cob: { id: 1, contatoId: 10 },
      benef: benef({ id: 20 }),
      fechamentoComissaoId: null,
      reatribuirAtendente: false,
    });
    expect(r).toEqual({
      ok: true,
      data: { contatoBeneficiarioId: 20, novoAtendenteId: null },
    });
  });

  it("pagador == beneficiário → BAD_REQUEST (mesmo contato)", () => {
    const r = decidirVinculoBeneficiario({
      cob: { id: 1, contatoId: 20 },
      benef: benef({ id: 20 }),
      fechamentoComissaoId: null,
      reatribuirAtendente: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("mesmo pagador");
  });

  it("pagador NULL → não é considerado mesmo (passa)", () => {
    // Cobrança órfã (sem pagador vinculado) sendo atribuída — OK.
    const r = decidirVinculoBeneficiario({
      cob: { id: 1, contatoId: null },
      benef: benef({ id: 20 }),
      fechamentoComissaoId: null,
      reatribuirAtendente: false,
    });
    expect(r.ok).toBe(true);
  });

  it("em fechamento → BAD_REQUEST com número da comissão", () => {
    const r = decidirVinculoBeneficiario({
      cob: { id: 1, contatoId: 10 },
      benef: benef({ id: 20 }),
      fechamentoComissaoId: 88,
      reatribuirAtendente: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("#88");
  });

  it("reatribuirAtendente=true + benef tem responsável → propaga novoAtendenteId", () => {
    const r = decidirVinculoBeneficiario({
      cob: { id: 1, contatoId: 10 },
      benef: benef({ id: 20, responsavelId: 5 }),
      fechamentoComissaoId: null,
      reatribuirAtendente: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.novoAtendenteId).toBe(5);
  });

  it("reatribuirAtendente=true + benef SEM responsável → não muda atendente", () => {
    const r = decidirVinculoBeneficiario({
      cob: { id: 1, contatoId: 10 },
      benef: benef({ id: 20, responsavelId: null }),
      fechamentoComissaoId: null,
      reatribuirAtendente: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.novoAtendenteId).toBeNull();
  });

  it("reatribuirAtendente=false → ignora responsável", () => {
    const r = decidirVinculoBeneficiario({
      cob: { id: 1, contatoId: 10 },
      benef: benef({ id: 20, responsavelId: 5 }),
      fechamentoComissaoId: null,
      reatribuirAtendente: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.novoAtendenteId).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Sprint 3 — resolverDuplicataPar
// ════════════════════════════════════════════════════════════════════════════

describe("decidirResolverPar — Sprint 3", () => {
  // Cenário base: Asaas (manter) + manual (remover), nenhuma em fechamento
  const base = {
    manter: cob({ id: 1, origem: "asaas", asaasPaymentId: "pay_1", status: "RECEIVED", contatoId: 50 }),
    remover: cob({ id: 2, origem: "manual", asaasPaymentId: null, status: "RECEIVED", contatoId: 10 }),
    manterEmFechamento: false,
    removerEmFechamento: false,
  };

  it("caso clássico Carlos+esposa: Asaas (esposa) mantém, manual (Carlos) remove, vincula benef → OK", () => {
    const r = decidirResolverPar({ ...base, vincularBeneficiario: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.vincularBeneficiarioPara).toBe(10);
    expect(r.data.removerEhManual).toBe(true);
  });

  it("vincularBeneficiario=false → não propaga contato, só remove", () => {
    const r = decidirResolverPar({ ...base, vincularBeneficiario: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.vincularBeneficiarioPara).toBeNull();
  });

  it("manter == remover → BAD_REQUEST imediato (não compara outras condições)", () => {
    const r = decidirResolverPar({
      ...base,
      manter: cob({ id: 5 }),
      remover: cob({ id: 5 }),
      vincularBeneficiario: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("não podem ser a mesma");
  });

  it("remover em fechamento → BAD_REQUEST (precedence acima de tudo)", () => {
    const r = decidirResolverPar({
      ...base,
      removerEmFechamento: true,
      vincularBeneficiario: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("remover já está em fechamento");
  });

  it("manter em fechamento + vincular=true → BAD_REQUEST (snapshot imutável)", () => {
    const r = decidirResolverPar({
      ...base,
      manterEmFechamento: true,
      vincularBeneficiario: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("manter já está em fechamento");
    expect(r.message).toContain("vincular=false");
  });

  it("manter em fechamento + vincular=false → OK (escape válido)", () => {
    const r = decidirResolverPar({
      ...base,
      manterEmFechamento: true,
      vincularBeneficiario: false,
    });
    expect(r.ok).toBe(true);
  });

  it("remover Asaas + RECEIVED → BAD_REQUEST (auto-fix não chama API)", () => {
    const r = decidirResolverPar({
      ...base,
      remover: cob({ id: 2, origem: "asaas", asaasPaymentId: "pay_x", status: "RECEIVED" }),
      vincularBeneficiario: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("não está pendente");
  });

  it("remover Asaas PENDING → BAD_REQUEST (auto-fix só remove manual)", () => {
    // Asaas PENDING podia ser excluída pelo botão normal, mas o auto-fix
    // se recusa pra não estragar a transação com chamada externa.
    const r = decidirResolverPar({
      ...base,
      remover: cob({ id: 2, origem: "asaas", asaasPaymentId: "pay_x", status: "PENDING" }),
      vincularBeneficiario: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("só remove cobrança manual");
  });

  it("remover sem contato + vincular=true → vincularBeneficiarioPara=null (não inventa)", () => {
    const r = decidirResolverPar({
      ...base,
      remover: cob({ id: 2, origem: "manual", asaasPaymentId: null, contatoId: null }),
      vincularBeneficiario: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.vincularBeneficiarioPara).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Sprint 4 — buscarDuplicataPotencial (scoring)
// ════════════════════════════════════════════════════════════════════════════

function cobScore(overrides: Partial<CobrancaParaScore> = {}): CobrancaParaScore {
  return {
    id: 1,
    origem: "asaas",
    status: "RECEIVED",
    asaasPaymentId: "pay_x",
    contatoId: 99, // não-alvo
    contatoBeneficiarioId: null,
    valor: 10000,
    dataPagamento: "2026-05-12",
    vencimento: "2026-05-10",
    ...overrides,
  };
}

describe("pontuarDuplicataPotencial — Sprint 4", () => {
  const baseArgs = {
    valorAlvo: 10000,
    dataReferencia: "2026-05-12",
    janelaDias: 7,
    contatoBeneficiarioAlvo: 10,
  };

  it("valor exato + mesma data + RECEIVED → 100 (match perfeito)", () => {
    expect(pontuarDuplicataPotencial({ cob: cobScore(), ...baseArgs })).toBe(100);
  });

  it("valor exato + 1 dia de diff → 80", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ dataPagamento: "2026-05-11" }),
        ...baseArgs,
      }),
    ).toBe(80);
  });

  it("valor exato + 7 dias de diff → 80 (limite da janela média)", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ dataPagamento: "2026-05-05" }),
        ...baseArgs,
      }),
    ).toBe(80);
  });

  it("valor exato + 8-30 dias + janelaDias=30 → 50", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ dataPagamento: "2026-04-20" }),
        ...baseArgs,
        janelaDias: 30,
      }),
    ).toBe(50);
  });

  it("valor diferente (10001) → 0", () => {
    expect(
      pontuarDuplicataPotencial({ cob: cobScore({ valor: 10001 }), ...baseArgs }),
    ).toBe(0);
  });

  it("valor 10000.005 ≈ alvo 10000.00 (1 centavo de tolerância) → 100", () => {
    // Tolerância de ±1 centavo arredondado.
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ valor: 10000.005 }),
        ...baseArgs,
      }),
    ).toBe(100);
  });

  it("data fora da janela (8 dias com janelaDias=7) → 0", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ dataPagamento: "2026-05-04" }),
        ...baseArgs,
      }),
    ).toBe(0);
  });

  it("contatoBeneficiarioId já preenchido → 0 (já resolvida)", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ contatoBeneficiarioId: 77 }),
        ...baseArgs,
      }),
    ).toBe(0);
  });

  it("pagador == beneficiário alvo → 0 (faria auto-vínculo)", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ contatoId: 10 }),
        ...baseArgs,
      }),
    ).toBe(0);
  });

  it("status não-pago (PENDING) → 0", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ status: "PENDING" }),
        ...baseArgs,
      }),
    ).toBe(0);
  });

  it("status OVERDUE → 0", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ status: "OVERDUE" }),
        ...baseArgs,
      }),
    ).toBe(0);
  });

  it("sem dataPagamento, usa vencimento como fallback", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ dataPagamento: null, vencimento: "2026-05-12" }),
        ...baseArgs,
      }),
    ).toBe(100);
  });

  it("sem dataPagamento nem vencimento → 0", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ dataPagamento: null, vencimento: null }),
        ...baseArgs,
      }),
    ).toBe(0);
  });

  it("pagador NULL (órfã) é candidata válida (não bate auto-match)", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ contatoId: null }),
        ...baseArgs,
      }),
    ).toBe(100);
  });

  it("RECEIVED_IN_CASH (pix recebido) é considerado pago → score alto", () => {
    expect(
      pontuarDuplicataPotencial({
        cob: cobScore({ status: "RECEIVED_IN_CASH" }),
        ...baseArgs,
      }),
    ).toBe(100);
  });
});

describe("diffEmDias", () => {
  it("mesma data → 0", () => {
    expect(diffEmDias("2026-05-12", "2026-05-12")).toBe(0);
  });
  it("diff positivo (a depois de b)", () => {
    expect(diffEmDias("2026-05-15", "2026-05-12")).toBe(3);
  });
  it("diff negativo (a antes de b)", () => {
    expect(diffEmDias("2026-05-10", "2026-05-12")).toBe(-2);
  });
  it("travessia de mês", () => {
    expect(diffEmDias("2026-06-02", "2026-05-31")).toBe(2);
  });
  it("data inválida → +Infinity (faz a regra rejeitar)", () => {
    expect(diffEmDias("xxxx", "2026-05-12")).toBe(Number.POSITIVE_INFINITY);
  });
});
