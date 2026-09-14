/**
 * O painel Comercial abria em BRANCO no escritório que ainda não tem setor
 * comercial nenhum.
 *
 * O caminho: `dashboard.comercial` sai cedo quando `idsAtendentes` é vazio e
 * devolve `{ modo: "gestor", meu: null, ranking: [], temSetor: false }` — SEM
 * a chave `totais`. A tela lia `totais!.contratosFechados` logo em seguida,
 * confiando no `!`, e derrubava o React inteiro. Quem via era justamente o
 * dono de conta nova, no primeiro clique da aba.
 *
 * Esta amarra guarda os dois lados: o servidor pode continuar saindo cedo, e a
 * tela tem que tratar o caso ANTES de ler `totais`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("painel Comercial sem setor comercial cadastrado", () => {
  const tela = ler("client/src/pages/dashboards/DashboardComercial.tsx");
  const router = ler("server/routers/dashboard.ts");

  it("o servidor sai cedo com modo gestor e sem `totais`", () => {
    const i = router.indexOf("if (idsAtendentes.length === 0)");
    expect(i, "a saída antecipada do comercial sumiu").toBeGreaterThan(-1);
    const bloco = router.slice(i, router.indexOf("}", router.indexOf("};", i)));
    expect(bloco).toContain('modo: verTodos ? ("gestor" as const)');
    expect(bloco, "se passou a devolver `totais`, esta amarra precisa mudar")
      .not.toContain("totais");
  });

  it("a tela trata gestor sem `totais` ANTES de ler o campo", () => {
    // Ancorado no `if (` colado na condição de propósito: sem isso, prefixar
    // um `false &&` desligava a guarda e a amarra continuava verde.
    const guarda = tela.indexOf('if (data.modo === "gestor" && !data.totais)');
    expect(guarda, "a guarda do gestor sem totais sumiu ou foi desligada").toBeGreaterThan(-1);
    const primeiroUso = tela.indexOf("totais!.");
    expect(primeiroUso, "o uso de `totais!` sumiu — reveja esta amarra").toBeGreaterThan(-1);
    expect(
      guarda,
      "a guarda tem que vir ANTES do primeiro `totais!`, senão a tela quebra igual",
    ).toBeLessThan(primeiroUso);
  });

  it("a saída da guarda é um aviso legível, não tela vazia", () => {
    const i = tela.indexOf('data.modo === "gestor" && !data.totais');
    const trecho = tela.slice(i, i + 600);
    expect(trecho).toContain("<Aviso");
    expect(trecho).toContain("Comercial");
    // diz o que FAZER, não só o que falta
    expect(trecho).toMatch(/Configura(ç|c)(õ|o)es/);
  });
});
