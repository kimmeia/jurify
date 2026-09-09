/**
 * Fase 1 da modularização (aprovada no mockup navegável de 23/08): o
 * porteiro de módulos contratados passa a valer no sistema inteiro.
 *
 * O teste mais importante é o de completude: TODO namespace do appRouter
 * precisa se declarar em shared/modulos-contratacao.ts. Router novo sem
 * declaração quebra a suíte de propósito — módulo não nasce sem porteiro.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { MODULOS_APP, ehModuloValido } from "../../shared/modulos-app";
import {
  MODULO_POR_NAMESPACE,
  contratoLibera,
  moduloDoPath,
  modulosDaRota,
  pacoteProcessualPuro,
} from "../../shared/modulos-contratacao";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/** Namespaces reais do appRouter, extraídos do fonte de routers.ts. */
function namespacesDoAppRouter(): string[] {
  const fonte = ler("server/routers.ts");
  const corpo = fonte.slice(fonte.indexOf("export const appRouter = router({"));
  return [...corpo.matchAll(/^  (\w+):/gm)].map((m) => m[1]);
}

describe("completude do mapa namespace → módulo", () => {
  const namespaces = namespacesDoAppRouter();

  it("o appRouter foi lido de verdade", () => {
    expect(namespaces.length).toBeGreaterThan(50);
    expect(namespaces).toContain("processos");
    expect(namespaces).toContain("asaas");
  });

  it("todo namespace do appRouter está declarado no mapa", () => {
    const semDeclaracao = namespaces.filter((ns) => !(ns in MODULO_POR_NAMESPACE));
    expect(semDeclaracao, `Routers sem módulo declarado em shared/modulos-contratacao.ts: ${semDeclaracao.join(", ")}`).toEqual([]);
  });

  it("o mapa não tem namespace fantasma (pega rename de router)", () => {
    const fantasmas = Object.keys(MODULO_POR_NAMESPACE).filter((ns) => !namespaces.includes(ns));
    expect(fantasmas, `No mapa mas fora do appRouter: ${fantasmas.join(", ")}`).toEqual([]);
  });

  it("todo módulo referenciado existe no catálogo", () => {
    const invalidos = Object.values(MODULO_POR_NAMESPACE)
      .filter((m): m is string => m != null)
      .filter((m) => !ehModuloValido(m));
    expect(invalidos).toEqual([]);
  });
});

describe("a decisão é fail-open — só bloqueia com certeza", () => {
  it("lista desconhecida (null) libera", () => {
    expect(contratoLibera(null, ["financeiro"])).toBe(true);
  });
  it("lista vazia (JSON quebrado/indeterminado) libera", () => {
    expect(contratoLibera([], ["financeiro"])).toBe(true);
  });
  it("rota/namespace sem exigência libera", () => {
    expect(contratoLibera(["processos"], [])).toBe(true);
  });
  it("qualquer um dos exigidos presente libera (Automações)", () => {
    expect(contratoLibera(["agentes_ia"], ["smartflow", "agentes_ia"])).toBe(true);
  });
  it("plano conhecido sem o módulo bloqueia", () => {
    expect(contratoLibera(["processos", "clientes"], ["financeiro"])).toBe(false);
  });
});

describe("resolução de path e rota", () => {
  it("path tRPC resolve pelo namespace", () => {
    expect(moduloDoPath("asaas.listarCobrancas")).toBe("financeiro");
    expect(moduloDoPath("movimentacoes.contador")).toBe("processos");
    expect(moduloDoPath("auth.me")).toBeNull();
    expect(moduloDoPath("jurisia.perguntar")).toBeNull(); // gate próprio do add-on
  });

  it("rotas do menu batem com o guard de rota", () => {
    expect(modulosDaRota("/financeiro")).toEqual(["financeiro"]);
    expect(modulosDaRota("/processos?tab=cofre")).toEqual(["processos"]);
    expect(modulosDaRota("/movimentacoes")).toEqual(["processos"]);
    expect(modulosDaRota("/automacoes")).toEqual(["smartflow", "agentes_ia"]);
    expect(modulosDaRota("/modelos-contrato")).toEqual(["contratos"]);
    expect(modulosDaRota("/dashboard")).toBeNull();
    expect(modulosDaRota("/configuracoes")).toBeNull();
    // prefixo não pode engolir rota vizinha
    expect(modulosDaRota("/agendamento")).toEqual(["agenda"]);
  });
});

describe("grandfathering — ninguém perde acesso no deploy", () => {
  it("a migration 0200 grava a lista COMPLETA do catálogo em todos os planos", () => {
    const sql = ler("drizzle/0200_grandfather_modulos.sql");
    const gravados = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const catalogo = MODULOS_APP.map((m) => m.id);
    expect([...new Set(gravados)].sort()).toEqual([...catalogo].sort());
  });
});

describe("fiação — servidor e client usam o porteiro", () => {
  it("protectedProcedure passa pelo gate de módulo", () => {
    const trpc = ler("server/_core/trpc.ts");
    expect(trpc).toContain("conferirModuloDoPath");
    expect(trpc).toContain(".use(requireUser).use(requireModuloContratado)");
  });

  it("a área logada envolve as páginas com o ModuloGuard", () => {
    const app = ler("client/src/App.tsx");
    expect(app).toContain("<ModuloGuard>{children}</ModuloGuard>");
  });

  it("o menu esconde item de módulo não contratado (e o mobile respeita o plano)", () => {
    const layout = ler("client/src/components/AppLayout.tsx");
    expect(layout).toContain("contratoLibera(modulosContratados, i.modulo)");
    expect(layout).toContain('contratoLibera(modulosContratados, ["atendimento"])');
  });

  it("o guard do client é fail-open igual ao servidor", () => {
    const guard = ler("client/src/components/ModuloGuard.tsx");
    expect(guard).toContain("contratoLibera(contratados, exigidos)");
    expect(guard).toContain("modulosDaRota(location)");
  });
});

describe("pacote Acompanhamento Processual (Fase 2)", () => {
  it("os namespaces do pacote pertencem ao módulo processos", () => {
    expect(MODULO_POR_NAMESPACE.clientesEssencial).toBe("processos");
    expect(MODULO_POR_NAMESPACE.prazos).toBe("processos");
    expect(MODULO_POR_NAMESPACE.painelProcessual).toBe("processos");
  });

  it("/clientes abre com clientes OU processos; /prazos exige processos", () => {
    expect(modulosDaRota("/clientes")).toEqual(["clientes", "processos"]);
    expect(modulosDaRota("/prazos")).toEqual(["processos"]);
  });

  it("pacoteProcessualPuro: só processos = puro; qualquer módulo da suíte desliga", () => {
    expect(pacoteProcessualPuro(["processos", "calculos", "relatorios"])).toBe(true);
    expect(pacoteProcessualPuro(["processos"])).toBe(true);
    expect(pacoteProcessualPuro(["processos", "agenda"])).toBe(false);
    expect(pacoteProcessualPuro(["processos", "clientes"])).toBe(false);
    expect(pacoteProcessualPuro(["processos", "atendimento"])).toBe(false);
    expect(pacoteProcessualPuro(["processos", "financeiro"])).toBe(false);
    expect(pacoteProcessualPuro(["processos", "kanban"])).toBe(false);
  });

  it("contrato indeterminado ou sem processos NUNCA é puro (ninguém muda de painel)", () => {
    expect(pacoteProcessualPuro(null)).toBe(false);
    expect(pacoteProcessualPuro([])).toBe(false);
    expect(pacoteProcessualPuro(["clientes", "atendimento"])).toBe(false);
  });

  it("o menu tem os itens enxutos condicionados à ausência do módulo completo", () => {
    const layout = ler("client/src/components/AppLayout.tsx");
    expect(layout).toContain("!contratoLibera(modulosContratados, i.soSemModulo)");
    expect(layout).toContain('soSemModulo: ["clientes"]');
    expect(layout).toContain('soSemModulo: ["agenda"]');
  });

  it("a rota /clientes decide entre completo e essencial pelo contrato", () => {
    const app = ler("client/src/App.tsx");
    expect(app).toContain('contratoLibera(contratados, ["clientes"]) ? <Clientes /> : <ClientesEssencial />');
    expect(app).toContain('contratoLibera(contratados, ["agenda"]) ? <Redirect to="/agenda" /> : <Prazos />');
  });
});
