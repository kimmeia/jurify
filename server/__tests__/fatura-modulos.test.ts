import { describe, expect, it } from "vitest";
import {
  avulsoVigente,
  calcularFatura,
  moduloParaProduto,
  produtoParaModulo,
  unirModulosContratados,
} from "../../shared/fatura-modulos";

const AGORA = new Date("2026-08-24T12:00:00Z").getTime();

const base = {
  nomePlano: "Acompanhamento Processual",
  precoPacoteCentavos: 24900,
  avulsos: [],
  atendentesAtivos: 0,
  atendentesInclusos: null as number | null,
  precoAtendenteAdicionalCentavos: 0,
  desconto: null,
  agoraMs: AGORA,
};

describe("calcularFatura", () => {
  it("só o pacote quando não há avulso, assento nem desconto", () => {
    const f = calcularFatura({ ...base });
    expect(f.itens).toHaveLength(1);
    expect(f.subtotalCentavos).toBe(24900);
    expect(f.totalCentavos).toBe(24900);
    expect(f.descontoCentavos).toBe(0);
  });

  it("soma módulos avulsos como linhas próprias", () => {
    const f = calcularFatura({
      ...base,
      avulsos: [{ modulo: "kanban", nome: "Funil Kanban", precoCentavos: 5000 }],
    });
    expect(f.itens.map((i) => i.tipo)).toEqual(["pacote", "avulso"]);
    expect(f.totalCentavos).toBe(29900);
  });

  it("cobra atendentes além dos inclusos", () => {
    const f = calcularFatura({
      ...base,
      atendentesAtivos: 4,
      atendentesInclusos: 3,
      precoAtendenteAdicionalCentavos: 2500,
    });
    expect(f.atendentesAdicionais).toBe(1);
    expect(f.itens.at(-1)?.rotulo).toBe("1 atendente adicional");
    expect(f.totalCentavos).toBe(24900 + 2500);
  });

  it("inclusos null = sem cobrança por assento mesmo com muitos ativos", () => {
    const f = calcularFatura({
      ...base,
      atendentesAtivos: 50,
      atendentesInclusos: null,
      precoAtendenteAdicionalCentavos: 2500,
    });
    expect(f.atendentesAdicionais).toBe(0);
    expect(f.totalCentavos).toBe(24900);
  });

  it("adicional com preço 0 não gera linha (contar não é cobrar)", () => {
    const f = calcularFatura({
      ...base,
      atendentesAtivos: 9,
      atendentesInclusos: 3,
      precoAtendenteAdicionalCentavos: 0,
    });
    expect(f.atendentesAdicionais).toBe(0);
    expect(f.itens).toHaveLength(1);
  });

  it("reproduz o exemplo do mockup: 249 + 50 + 25 − 20% = 259,20", () => {
    const f = calcularFatura({
      ...base,
      avulsos: [{ modulo: "kanban", nome: "Kanban", precoCentavos: 5000 }],
      atendentesAtivos: 4,
      atendentesInclusos: 3,
      precoAtendenteAdicionalCentavos: 2500,
      desconto: { tipo: "percentual", valor: 20, validoAte: "2026-12-31T23:59:59Z" },
    });
    expect(f.subtotalCentavos).toBe(32400);
    expect(f.descontoCentavos).toBe(6480);
    expect(f.totalCentavos).toBe(25920);
  });

  it("desconto fixo não deixa a fatura negativa", () => {
    const f = calcularFatura({
      ...base,
      desconto: { tipo: "fixo", valor: 99_000, validoAte: null },
    });
    expect(f.descontoCentavos).toBe(24900);
    expect(f.totalCentavos).toBe(0);
  });

  it("desconto vencido não aplica e sinaliza", () => {
    const f = calcularFatura({
      ...base,
      desconto: { tipo: "percentual", valor: 20, validoAte: "2026-01-01T00:00:00Z" },
    });
    expect(f.descontoExpirado).toBe(true);
    expect(f.descontoCentavos).toBe(0);
    expect(f.totalCentavos).toBe(24900);
  });

  it("percentual acima de 100 é tratado como 100", () => {
    const f = calcularFatura({
      ...base,
      desconto: { tipo: "percentual", valor: 250, validoAte: null },
    });
    expect(f.totalCentavos).toBe(0);
  });
});

describe("avulsoVigente", () => {
  it("ativo dentro da janela vale; suspenso/cancelado não", () => {
    expect(avulsoVigente({ status: "ativo", inicioEm: null, expiraEm: null }, AGORA)).toBe(true);
    expect(avulsoVigente({ status: "suspenso", inicioEm: null, expiraEm: null }, AGORA)).toBe(false);
    expect(avulsoVigente({ status: "cancelado", inicioEm: null, expiraEm: null }, AGORA)).toBe(false);
  });

  it("respeita início futuro e vencimento passado", () => {
    expect(
      avulsoVigente({ status: "ativo", inicioEm: "2026-09-01T00:00:00Z", expiraEm: null }, AGORA),
    ).toBe(false);
    expect(
      avulsoVigente({ status: "ativo", inicioEm: null, expiraEm: "2026-08-01T00:00:00Z" }, AGORA),
    ).toBe(false);
    expect(
      avulsoVigente(
        { status: "ativo", inicioEm: "2026-08-01T00:00:00Z", expiraEm: "2026-12-01T00:00:00Z" },
        AGORA,
      ),
    ).toBe(true);
  });
});

describe("produto <-> módulo", () => {
  it("ida e volta preservam o slug", () => {
    expect(moduloParaProduto("kanban")).toBe("modulo:kanban");
    expect(produtoParaModulo("modulo:kanban")).toBe("kanban");
  });

  it("produto que não é módulo (jurisia) fica de fora", () => {
    expect(produtoParaModulo("jurisia")).toBeNull();
  });
});

describe("unirModulosContratados", () => {
  it("null do plano continua null (tudo liberado, avulso é redundante)", () => {
    expect(unirModulosContratados(null, ["kanban"])).toBeNull();
  });

  it("soma avulsos à lista do plano sem duplicar", () => {
    const uniao = unirModulosContratados(["processos", "clientes"], ["kanban", "processos"]);
    expect(uniao?.sort()).toEqual(["clientes", "kanban", "processos"]);
  });

  it("sem avulsos devolve a lista do plano intacta", () => {
    expect(unirModulosContratados(["processos"], [])).toEqual(["processos"]);
  });
});
