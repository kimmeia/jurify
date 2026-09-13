/**
 * Quem está TESTANDO um plano de preço fechado precisa ter como pagar por ele.
 *
 * Origem (13/09, print do dono): "quando clico em adicionar pagamento não
 * acontece nada". Não era o botão — eram três portas fechadas ao mesmo tempo,
 * e o servidor pronto do outro lado:
 *
 *   1. a faixa do topo mandava pra `/configuracoes?tab=meu-plano`, que era a
 *      tela em que ele JÁ estava — navegar pra rota atual é um não-evento;
 *   2. o bloco do plano atual só tinha botão pra plano sob consulta e pra
 *      carência de cancelamento; pro plano de preço fechado em teste, nada;
 *   3. o cartão do próprio plano ficava travado em "✓ Você está aqui" — texto
 *      de quem JÁ paga —, e o rótulo "Continuar com este plano", escrito
 *      exatamente pra este caso, nunca chegava à tela.
 *
 * Resultado: o único jeito de pagar era escolher um plano DIFERENTE. Medido no
 * app rodando com uma conta em teste no Atende antes e depois do conserto.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
const planos = ler("client/src/pages/Plans.tsx");
const layout = ler("client/src/components/AppLayout.tsx");
const subscription = ler("server/routers/subscription.ts");

function recorte(fonte: string, de: string, ate: string): string {
  const i = fonte.indexOf(de);
  expect(i, `âncora não encontrada: ${de}`).toBeGreaterThan(-1);
  const j = fonte.indexOf(ate, i + de.length);
  expect(j, `âncora final não encontrada: ${ate}`).toBeGreaterThan(-1);
  return fonte.slice(i, j);
}

describe("o bloco do plano atual oferece pagar durante o teste", () => {
  const acoes = recorte(planos, "{/* Ações */}", "{/* Troca de plano pedida");

  it("existe o botão, e é o alvo da faixa do topo", () => {
    expect(planos).toContain('id="adicionar-pagamento"');
    expect(planos).toContain("Adicionar pagamento");
  });

  it("aparece só pra teste em plano de preço fechado", () => {
    const bloco = recorte(planos, "{emTeste && !sobConsultaAtual && !emCarencia && (", "</>");
    expect(bloco, "sob consulta tem o caminho da conversa, não o do checkout")
      .toContain('id="adicionar-pagamento"');
    // A condição inteira, na ordem: teste E preço fechado E fora de carência.
    expect(planos).toContain("{emTeste && !sobConsultaAtual && !emCarencia && (");
  });

  it("leva pro checkout do PRÓPRIO plano, não de outro", () => {
    expect(acoes).toContain("handleSelectPlan(currentPlanId)");
  });

  it("respeita a cobrança indisponível, como os outros botões", () => {
    const bloco = recorte(planos, 'id="adicionar-pagamento"', "Adicionar pagamento");
    expect(bloco).toContain("billingOk === false");
  });

  it("com pagamento já em andamento o texto muda em vez de oferecer de novo", () => {
    expect(acoes).toContain("pagamentoEmAndamento");
    expect(acoes).toContain("Ver o pagamento");
  });
});

describe("o cartão do plano atual destrava durante o teste", () => {
  it("o travamento distingue quem já paga de quem está testando", () => {
    expect(planos).toContain("const podePagarOTeste = isCurrentPlan && isTrial && !sobConsulta;");
    expect(planos).toContain(
      "const travadoPorSerOAtual = isCurrentPlan && !podeFecharValor && !podePagarOTeste;",
    );
  });

  it("é o travamento novo que decide o disabled E o rótulo", () => {
    // Enquanto os dois olhavam `isCurrentPlan && !podeFecharValor`, o teste
    // caía no texto de quem já paga e o botão ficava morto.
    const botao = recorte(planos, "variant={isCurrentPlan || isPopular", "{loadingPlan === plan.id");
    expect(botao).toContain("travadoPorSerOAtual ||");
    expect(planos).toContain(") : travadoPorSerOAtual ? (");
    expect(planos).toContain("<>✓ Você está aqui</>");
  });

  it("o rótulo escrito pra este caso volta a ser alcançável", () => {
    expect(planos).toContain('if (isCurrentPlan && isTrial) buttonLabel = "Continuar com este plano";');
  });

  it("o cursor deixa de dizer 'não clique' quando dá pra clicar", () => {
    expect(planos).toContain('${travadoPorSerOAtual ? "cursor-default" : ""}');
  });
});

describe("a faixa do topo deixa de ser um clique morto", () => {
  const banner = layout.slice(layout.indexOf("function TrialBanner()"));

  it("de outra tela, navega; já em Meu plano, leva ao botão de pagar", () => {
    expect(banner).toContain('const alvo = document.getElementById("adicionar-pagamento");');
    expect(banner).toContain("alvo.scrollIntoView(");
    expect(banner).toContain("alvo.focus(");
  });

  it("na mesma tela sem o botão pintado, recarrega em vez de fingir que navegou", () => {
    expect(banner).toContain('if (local.startsWith("/configuracoes"))');
    expect(banner).toContain("window.location.assign(destino)");
  });

  it("o clique não chama mais a navegação cega", () => {
    const clique = recorte(layout, "onClick={() => (sobConsulta ?", "className=");
    expect(clique).toContain("irPagar()");
    expect(clique, "era isto que não fazia nada estando na própria tela")
      .not.toContain('setLocation("/configuracoes?tab=meu-plano")');
  });

  it("plano sob consulta continua indo pra conversa, não pro checkout", () => {
    expect(banner).toContain("sobConsulta ? abrirConversa() : irPagar()");
  });
});

describe("o servidor sempre soube receber essa conversão", () => {
  it("createCheckout trata trial → pago e não recusa o mesmo plano", () => {
    const fn = recorte(subscription, "createCheckout: protectedProcedure", "changePlan: protectedProcedure");
    expect(fn, "o caminho existe e está comentado desde sempre").toContain("trial");
    expect(fn, "recusar o plano atual mataria justamente esta conversão")
      .not.toContain("mesmo plano");
  });
});
