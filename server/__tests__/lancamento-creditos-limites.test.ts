import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { cotaMensalDoPlano } from "../billing/escritorio-creditos";
import { limitesDoPlano, getLimites } from "../billing/plan-limits";
import type { Plano, PlanoLimites } from "../../shared/planos-types";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

function limites(parcial: Partial<PlanoLimites>): PlanoLimites {
  return {
    maxUsuarios: 1,
    maxArmazenamentoMB: 100,
    maxClientes: null,
    maxConexoesWhatsapp: 0,
    maxAgentesIa: 0,
    maxMonitoramentosProcessos: null,
    maxMonitoramentosCpf: null,
    creditosCalculosMes: 0,
    jurisiaMensagensMes: 0,
    ...parcial,
  };
}

describe("cotaMensalDoPlano — a promessa do plano financiada em créditos", () => {
  it("plano de monitoramento ganha franquia pros limites que vende (50 proc + 10 CPFs)", () => {
    // 50 processos × 2 cred + 10 CPFs × 15 cred — sem isso o trial do
    // superlançamento nascia com 0 créditos e não criava nem um monitor.
    expect(cotaMensalDoPlano(limites({ maxMonitoramentosProcessos: 50, maxMonitoramentosCpf: 10 }))).toBe(250);
  });

  it("profissional: 200 proc + 50 CPFs + 50 créditos de cálculo", () => {
    expect(
      cotaMensalDoPlano(limites({ creditosCalculosMes: 50, maxMonitoramentosProcessos: 200, maxMonitoramentosCpf: 50 })),
    ).toBe(1200);
  });

  it("plano antigo (monitoramento ilimitado/null) segue como sempre foi", () => {
    expect(cotaMensalDoPlano(limites({ creditosCalculosMes: 100 }))).toBe(100);
    expect(cotaMensalDoPlano(limites({ creditosCalculosMes: 100, maxMonitoramentosProcessos: 999999 }))).toBe(100);
  });
});

describe("limitesDoPlano — tabela `planos` é a fonte, não o mapa hardcoded", () => {
  const planoNovo = {
    limites: limites({ maxUsuarios: 2, maxClientes: null, maxArmazenamentoMB: 1024 }),
    modulosLiberados: ["dashboard", "configuracoes", "processos"],
  } as unknown as Plano;

  it("plano novo: 2 usuários valem 2 (não caem no free = 1) e clientes null = sem teto", () => {
    const l = limitesDoPlano(planoNovo);
    expect(l.maxColaboradores).toBe(2);
    expect(l.maxClientes).toBe(999999);
    expect(l.maxArmazenamentoMB).toBe(1024);
    expect(l.modulosPermitidos).toEqual(["dashboard", "configuracoes", "processos"]);
  });

  it("campos que a tabela não modela vêm do legado quando o slug existe lá", () => {
    const legado = getLimites("basico");
    const l = limitesDoPlano(planoNovo, legado);
    expect(l.maxConversasAtivas).toBe(legado.maxConversasAtivas);
    // Plano novo sem legado não ganha teto inventado.
    expect(limitesDoPlano(planoNovo).maxConversasAtivas).toBe(999999);
  });
});

describe("amarras no código", () => {
  it("calcularCotaDoPlano deriva da cota nova; o `?? 3` que engolia cota 0 morreu", () => {
    const fonte = ler("server/billing/escritorio-creditos.ts");
    expect(fonte).toContain("cotaMensalDoPlano(plano.limites)");
    expect(fonte).not.toContain("creditosCalculosMes ?? 3");
  });

  it("verificarLimite e moduloDisponivel resolvem limites pela tabela planos", () => {
    const fonte = ler("server/billing/plan-limits.ts");
    expect(fonte.match(/await resolverLimites\(planId\)/g)?.length).toBe(2);
  });

  it("conta presa com cota 0 se auto-cura na primeira leitura de saldo", () => {
    const fonte = ler("server/billing/escritorio-creditos.ts");
    expect(fonte).toContain("correcao_cota");
  });

  it("telas do pacote processual não chamam mais clientes.listar às cegas", () => {
    const processos = ler("client/src/pages/Processos.tsx");
    expect(processos).toContain("useClientesVinculaveis");
    // A escolha entre módulo completo e lista essencial mora no hook
    // compartilhado — Processos e a busca ⌘K passam os dois por ele, e é
    // aqui que se trava o fallback pra não voltar a chamar clientes.listar
    // às cegas em plano de monitoramento.
    const hook = ler("client/src/hooks/use-clientes-vinculaveis.ts");
    expect(hook).toContain("clientesEssencial.listar");
    expect(hook).toContain('contratoLibera(modulosData?.modulos ?? null, ["clientes"])');
    const paleta = ler("client/src/components/PaletaComandos.tsx");
    expect(paleta).toContain("useClientesVinculaveis");
    const layout = ler("client/src/components/AppLayout.tsx");
    expect(layout).toContain('contratoLibera(modulosContratados, ["agenda"])');
  });
});
