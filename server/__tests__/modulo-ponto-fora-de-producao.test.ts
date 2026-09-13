/**
 * O Ponto sai de produção e fica em staging com etiqueta "beta" — decisão do
 * dono em 13/09 ("esse modulo ponto vamos remover por enquanto de produção e em
 * stating vamos deixar com a etiqueta beta").
 *
 * Não é remoção de código: nada do módulo foi apagado. O que muda é onde ele é
 * OFERECIDO. Por isso a amarra tem duas obrigações opostas:
 *
 *   1. em produção o módulo não aparece por NENHUMA das três portas (menu, rota
 *      e procedure) — inclusive quando a cesta sai indeterminada, que é o caso
 *      em que o porteiro normalmente libera tudo;
 *   2. em staging e dev ele aparece, e com selo — esconder nos dois seria a
 *      remoção que o dono não pediu.
 *
 * O detalhe que torna a lista única necessária: se cada porta tivesse a sua,
 * divergir daria o pior resultado possível — item escondido no menu com a API
 * aberta, ou o contrário.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MODULOS_BETA,
  ehModuloBeta,
  moduloRemovidoNoAmbiente,
  moduloMostraSeloBeta,
  filtrarModulosDoAmbiente,
} from "../../shared/modulos-por-ambiente";

const raiz = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");

describe("regras puras do ambiente", () => {
  it("o Ponto é o módulo em beta", () => {
    expect(MODULOS_BETA).toContain("ponto");
    expect(ehModuloBeta("ponto")).toBe(true);
    expect(ehModuloBeta("financeiro")).toBe(false);
  });

  it("em produção o beta está fora; em staging e dev, dentro", () => {
    expect(moduloRemovidoNoAmbiente("ponto", "production")).toBe(true);
    expect(moduloRemovidoNoAmbiente("ponto", "staging")).toBe(false);
    expect(moduloRemovidoNoAmbiente("ponto", "development")).toBe(false);
  });

  it("ambiente desconhecido conta como produção", () => {
    // Na dúvida sobre onde estamos, o certo é não mostrar: mostrar por engano
    // em produção é o erro que essa decisão existe pra evitar.
    expect(moduloRemovidoNoAmbiente("ponto", null)).toBe(true);
    expect(moduloRemovidoNoAmbiente("ponto", undefined)).toBe(true);
  });

  it("módulo que não é beta nunca é afetado, em ambiente nenhum", () => {
    for (const amb of ["production", "staging", "development", null] as const) {
      expect(moduloRemovidoNoAmbiente("financeiro", amb)).toBe(false);
      expect(moduloMostraSeloBeta("financeiro", amb)).toBe(false);
    }
  });

  it("o selo aparece só onde o módulo aparece", () => {
    expect(moduloMostraSeloBeta("ponto", "staging")).toBe(true);
    expect(moduloMostraSeloBeta("ponto", "development")).toBe(true);
    expect(moduloMostraSeloBeta("ponto", "production")).toBe(false);
  });

  it("a cesta perde o beta em produção e o mantém em staging", () => {
    const cesta = ["financeiro", "ponto", "comissoes"];
    expect(filtrarModulosDoAmbiente(cesta, "production")).toEqual(["financeiro", "comissoes"]);
    expect(filtrarModulosDoAmbiente(cesta, "staging")).toEqual(cesta);
  });

  it("cesta null continua null — o fail-open do porteiro não muda", () => {
    // `null` é o "indeterminado = tudo liberado". Transformar em lista aqui
    // trocaria o desenho fail-open inteiro por efeito colateral desta lista.
    expect(filtrarModulosDoAmbiente(null, "production")).toBeNull();
  });
});

describe("porta 1: o porteiro das procedures", () => {
  const gate = ler("server/_core/gate-modulos.ts");

  it("a cesta é filtrada antes de ir pro cache", () => {
    const fn = gate.slice(
      gate.indexOf("export async function modulosContratadosDoUsuario"),
      gate.indexOf("function nomeDoModulo"),
    );
    expect(fn).toContain("filtrarModulosDoAmbiente(modulos, resolverAmbiente())");
    // Antes do `cache.set`: filtrar depois deixaria a 1ª resposta passar.
    expect(fn.indexOf("filtrarModulosDoAmbiente")).toBeLessThan(fn.indexOf("cache.set"));
  });

  it("a recusa vem ANTES do atalho de admin e da conta de contrato", () => {
    const fn = gate.slice(gate.indexOf("export async function conferirModuloDoPath"));
    const recusa = fn.indexOf("moduloRemovidoNoAmbiente");
    const admin = fn.indexOf('args.role === "admin"');
    const contrato = fn.indexOf("contratoLibera");
    expect(recusa).toBeGreaterThan(-1);
    expect(admin, "atalho de admin não encontrado").toBeGreaterThan(-1);
    expect(recusa, "admin passaria por cima do módulo tirado do ar").toBeLessThan(admin);
    expect(recusa, "a cesta indeterminada liberaria o módulo").toBeLessThan(contrato);
    expect(fn).toContain("modulo_em_beta");
  });

  it("a recusa é incondicional — nada mais entra no `if`", () => {
    // Posição sozinha não basta: dá pra deixar a chamada onde está e desarmar a
    // condição (`&& false`, ou um `args.role !== "admin" &&` na frente). Foi
    // exatamente essa a mutação que sobreviveu à 1ª volta desta amarra.
    const fn = gate.slice(gate.indexOf("export async function conferirModuloDoPath"));
    expect(fn).toContain("if (moduloRemovidoNoAmbiente(modulo, resolverAmbiente())) {");
    const antesDoAdmin = fn.slice(0, fn.indexOf('args.role === "admin"'));
    expect(antesDoAdmin, "cargo não pode pesar na decisão de ambiente")
      .not.toContain("args.role");
  });
});

describe("porta 2: a rota", () => {
  const guard = ler("client/src/components/ModuloGuard.tsx");

  it("a guarda de ambiente decide antes da de contrato", () => {
    const ambiente = guard.indexOf("moduloRemovidoNoAmbiente(m, ambiente)");
    const contrato = guard.indexOf("!contratoLibera(contratados, exigidos)");
    expect(ambiente, "a rota não confere ambiente").toBeGreaterThan(-1);
    expect(ambiente, "o fail-open do contrato abriria a rota do módulo em beta")
      .toBeLessThan(contrato);
  });

  it("a tela do módulo em teste não manda o advogado ver o plano", () => {
    // Não é questão de contrato; empurrar pra "Ver meu plano" mandaria ele
    // procurar uma resposta que não existe.
    const tela = guard.slice(
      guard.indexOf("function ModuloEmTestes("),
      guard.indexOf("function ModuloBloqueado("),
    );
    expect(tela).toContain("está em testes");
    expect(tela).not.toContain("meu-plano");
  });
});

describe("porta 3: o menu", () => {
  const layout = ler("client/src/components/AppLayout.tsx");

  it("o item some do menu quando o módulo está fora do ambiente", () => {
    expect(layout).toContain("moduloRemovidoNoAmbiente(m, ambiente)");
    expect(layout, "o ambiente tem que vir da resposta do servidor")
      .toContain("modulosData?.ambiente");
  });

  it("onde o item aparece, ele aparece com selo", () => {
    expect(layout).toContain("moduloMostraSeloBeta(m, ambiente)");
  });
});

describe("o ambiente vai junto com a cesta", () => {
  const router = ler("server/routers/subscription.ts");

  it("admin e impersonação também recebem o ambiente", () => {
    const fn = router.slice(router.indexOf("modulosContratados: protectedProcedure"));
    const inicio = fn.slice(0, fn.indexOf("return { modulos, ambiente }"));
    expect(inicio, "sem ambiente o client trata como produção e esconde em staging")
      .toContain("return { modulos: null, ambiente }");
  });
});

describe("o que o plano Escala vende", () => {
  it("o Ponto continua na cesta do plano — a migration não foi tocada", () => {
    // O escondimento é de ambiente, não de contrato: quem assina o Escala
    // segue com o módulo na cesta e volta a vê-lo quando o beta sair.
    // Anotado no documento de estado porque o cartão do plano ANUNCIA o ponto.
    const m = ler("drizzle/0217_pacote_3_planos.sql");
    expect(m).toContain("'comissoes','ponto','backups'");
  });
});
