import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { calcularFatura } from "../../shared/fatura-modulos";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const base = {
  nomePlano: "Monitoramento Essencial",
  precoPacoteCentavos: 0, // sob consulta: tabela é R$ 0
  avulsos: [],
  atendentesAtivos: 1,
  atendentesInclusos: null,
  precoAtendenteAdicionalCentavos: 0,
  desconto: null,
  agoraMs: 1_700_000_000_000,
};

describe("calcularFatura com valor negociado (planos sob consulta)", () => {
  it("valor fechado substitui o preço de tabela do pacote", () => {
    const f = calcularFatura({ ...base, valorNegociadoCentavos: 14900 });
    expect(f.totalCentavos).toBe(14900);
    expect(f.itens[0].rotulo).toContain("(valor fechado)");
  });

  it("sem valor negociado (ou 0/null) o comportamento antigo permanece", () => {
    expect(calcularFatura(base).totalCentavos).toBe(0);
    expect(calcularFatura({ ...base, valorNegociadoCentavos: null }).totalCentavos).toBe(0);
    expect(calcularFatura({ ...base, valorNegociadoCentavos: 0 }).totalCentavos).toBe(0);
    expect(calcularFatura(base).itens[0].rotulo).not.toContain("valor fechado");
  });

  it("avulsos e desconto compõem por cima do valor fechado", () => {
    const f = calcularFatura({
      ...base,
      valorNegociadoCentavos: 14900,
      avulsos: [{ modulo: "calculos", nome: "Cálculos", precoCentavos: 4900 }],
      desconto: { tipo: "fixo", valor: 1000, validoAte: null },
    });
    expect(f.subtotalCentavos).toBe(19800);
    expect(f.totalCentavos).toBe(18800);
  });
});

describe("amarras do fluxo de fechar venda", () => {
  it("a coluna do valor negociado existe (migration 0205 + schema)", () => {
    expect(ler("drizzle/0205_valor_negociado_assinatura.sql")).toContain("valor_negociado_centavos");
    expect(ler("drizzle/schema.ts")).toContain("valorNegociadoCentavos");
  });

  it("ativarAssinaturaNegociada cria a assinatura com o valor fechado e dá prazo pra pagar", () => {
    const adm = ler("server/routers/admin.ts");
    const trecho = adm.slice(adm.indexOf("ativarAssinaturaNegociada:"), adm.indexOf("marcarCortesia:"));
    expect(trecho).toContain("valorNegociadoCentavos");
    // O acesso não pode cair enquanto o boleto/Pix não compensa.
    expect(trecho).toContain("trialExpiraEm");
    // O webhook resolve a conversão por este formato — mudar quebra a ativação.
    expect(trecho).toContain("externalReference: `${input.userId}:${ultima.planId}`");
    expect(trecho).toContain("invoiceUrl");
  });

  it("a fatura composta lê o valor negociado da subscription", () => {
    const fonte = ler("server/billing/modulos-cobranca.ts");
    expect(fonte).toContain("valorNegociadoCentavos = sub?.valorNegociadoCentavos");
  });

  it("trial sob consulta: e-mails e banner apontam pra conversa, não pra tela sem checkout", () => {
    const cron = ler("server/billing/trial-cron.ts");
    expect(cron).toContain("ctaTrialDoPlano");
    expect(cron).toContain("precoSobConsulta");
    expect(cron).toContain("wa.me");

    const layout = ler("client/src/components/AppLayout.tsx");
    expect(layout).toContain("Fechar valor com a gente");
  });

  it("a ficha do cliente tem o botão e o dialog de ativação", () => {
    const clients = ler("client/src/pages/admin/AdminClients.tsx");
    expect(clients).toContain("Ativar assinatura paga");
    expect(clients).toContain("ativarAssinaturaNegociada");
    expect(clients).toContain("Valor fechado");
  });
});
