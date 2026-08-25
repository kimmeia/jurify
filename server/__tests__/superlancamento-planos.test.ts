import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { avaliarLimiteMonitoramentos } from "../processos/limites-monitoramento";
import { ehModuloValido } from "../../shared/modulos-app";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("avaliarLimiteMonitoramentos", () => {
  it("sem limite (null ou 0) nunca barra — grandfather dos planos antigos", () => {
    expect(avaliarLimiteMonitoramentos({ tipo: "movimentacoes", atual: 999, maximo: null }).permitido).toBe(true);
    expect(avaliarLimiteMonitoramentos({ tipo: "novas_acoes", atual: 999, maximo: 0 }).permitido).toBe(true);
  });

  it("abaixo do limite passa; no limite barra com gancho de venda", () => {
    expect(avaliarLimiteMonitoramentos({ tipo: "movimentacoes", atual: 49, maximo: 50 }).permitido).toBe(true);
    const barrado = avaliarLimiteMonitoramentos({ tipo: "movimentacoes", atual: 50, maximo: 50 });
    expect(barrado.permitido).toBe(false);
    expect(barrado.mensagem).toContain("50 processos vigiados");
    expect(barrado.mensagem).toContain("Fale com a gente");
  });

  it("CPF/CNPJ tem rótulo próprio — é serviço à parte de vigiar processo", () => {
    const barrado = avaliarLimiteMonitoramentos({ tipo: "novas_acoes", atual: 10, maximo: 10 });
    expect(barrado.mensagem).toContain("CPFs/CNPJs vigiados");
  });
});

describe("amarras do superlançamento no código", () => {
  it("os dois pontos de criação de monitoramento conferem o limite ANTES de cobrar crédito", () => {
    const fonte = ler("server/routers/processos.ts");
    const ocorrencias = fonte.match(/verificarLimiteMonitoramentos\(esc\.escritorio\.id, "(movimentacoes|novas_acoes)"\)/g) ?? [];
    expect(ocorrencias).toHaveLength(2);
    // A verificação precisa vir antes do consumirCreditos em cada caminho.
    const idxMov = fonte.indexOf('verificarLimiteMonitoramentos(esc.escritorio.id, "movimentacoes")');
    expect(idxMov).toBeGreaterThan(-1);
    expect(fonte.indexOf("monitorar_processo_mes", idxMov)).toBeGreaterThan(idxMov);
  });

  it("checkout self-service recusa plano sob consulta", () => {
    const sub = ler("server/routers/subscription.ts");
    expect(sub).toContain("precoSobConsulta");
    expect(sub).toContain("sob consulta — fale com a gente");
  });

  it("LP e página interna mostram Sob consulta e o botão de conversa", () => {
    const pricing = ler("client/src/pages/landing/Pricing.tsx");
    expect(pricing).toContain("Sob consulta");
    expect(pricing).toContain("falarComAGente");
    expect(pricing).toContain("Superlançamento");

    const plans = ler("client/src/pages/Plans.tsx");
    expect(plans).toContain("Sob consulta");
    expect(plans).toContain("falarComAGente");
  });

  it("a migration cria os dois planos do lançamento com módulos válidos", () => {
    const mig = ler("drizzle/0203_superlancamento_planos.sql");
    expect(mig).toContain("'monitoramento-essencial'");
    expect(mig).toContain("'monitoramento-profissional'");
    // Extrai os slugs de módulos dos JSON_ARRAY de modulos_liberados e valida
    // contra o catálogo — módulo inválido seria filtrado no runtime e o plano
    // nasceria mais restrito do que o prometido.
    const cestas = [...mig.matchAll(/JSON_ARRAY\(((?:'[a-z_]+',?)+)\)/g)]
      .map((m) => m[1])
      .filter((s) => s.includes("'processos'"));
    expect(cestas.length).toBeGreaterThanOrEqual(2);
    for (const cesta of cestas) {
      for (const slug of cesta.match(/'([a-z_]+)'/g)!.map((x) => x.slice(1, -1))) {
        expect(ehModuloValido(slug), `módulo desconhecido na migration: ${slug}`).toBe(true);
      }
    }
    // Antigos saem da vitrine; completo vira sob consulta com demonstração.
    expect(mig).toContain("WHERE slug IN ('free','basico','intermediario')");
    expect(mig).toContain("cta_demonstracao = TRUE");
  });
});
