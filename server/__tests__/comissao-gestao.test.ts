/**
 * Comissão de GESTÃO — a segunda trilha de comissão.
 *
 * Regra do dono: o gestor ganha um percentual sobre o RECEBIDO de todos os
 * clientes que fecharam contrato a partir de uma data de corte, não importa
 * quem vendeu. Cliente que fechou antes do corte fica de fora para sempre,
 * mesmo pagando depois. E a mesma parcela nunca paga comissão duas vezes
 * para o mesmo gestor.
 *
 * O que estes testes travam:
 *  1. A pré-classificação (corte e já-comissionada) tira do CÁLCULO sem
 *     tirar da TELA — o operador precisa ver por que cada pagamento saiu.
 *  2. O "Bruto recebido" continua sendo tudo que entrou no período, senão o
 *     card muda de significado entre as duas trilhas.
 *  3. A trilha de venda não muda: sem `gestao`, o filtro por atendente da
 *     cobrança e o anti-duplicidade de sempre continuam de pé.
 *  4. As duas trilhas não se consomem: cada NOT EXISTS/EXISTS é escopado
 *     pelo seu `tipo` (e o da gestão, também pelo gestor).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

let selectQueue: unknown[][] = [];
const inserts: Array<{ tabela: string; valores: any }> = [];

function tableName(t: any): string {
  return (t?.[Symbol.for("drizzle:Name")] as string) || "";
}

function makeSelectBuilder() {
  const proximo = () => Promise.resolve(selectQueue.shift() ?? []);
  const builder: any = {
    from: () => builder,
    leftJoin: () => builder,
    innerJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    groupBy: () => builder,
    limit: () => proximo(),
    then: (resolve: (v: unknown) => unknown) => resolve(selectQueue.shift() ?? []),
  };
  return builder;
}

const mockDb = {
  select: () => ({ from: (t: any) => { void t; return makeSelectBuilder(); } }),
  insert: (t: any) => ({
    values: (valores: any) => {
      inserts.push({ tabela: tableName(t), valores });
      return {
        $returningId: () => Promise.resolve([{ id: 777 }]),
        then: (r: (v: unknown) => unknown) => r([{ insertId: 777, affectedRows: 1 }]),
      };
    },
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
};

vi.mock("../db", () => ({ getDb: vi.fn(async () => mockDb) }));

vi.mock("../escritorio/db-financeiro", () => ({
  // Escritório com alíquota 10% e modo faixas — a gestão TEM que ignorar
  // as duas coisas e usar o percentual do próprio gestor, em flat.
  obterRegraComissao: vi.fn(async () => ({
    aliquotaPercent: "10.00",
    valorMinimoCobranca: "0.00",
    modo: "faixas",
    baseFaixa: "comissionavel",
    diaVencimentoDespesa: 5,
  })),
  listarFaixasComissao: vi.fn(async () => [
    { limiteAte: "1000.00", aliquotaPercent: "1.00" },
    { limiteAte: null, aliquotaPercent: "99.00" },
  ]),
  criarCategoriaDespesa: vi.fn(async () => 1),
}));

const { simularComissao, fecharComissao } = await import("../escritorio/db-comissoes");

const GESTAO = {
  dataCorte: "2026-07-01",
  dataCorteEm: new Date("2026-07-01T03:00:00.000Z"),
  aliquotaPercent: 2,
};

/** Uma cobrança paga como o SELECT a devolve, com os flags já resolvidos. */
function cobranca(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    valor: "1000.00",
    dataPagamento: "2026-08-12",
    status: "RECEIVED",
    atendenteId: 9,
    categoriaId: 3,
    comissionavelOverride: null,
    categoriaNome: "Honorários",
    categoriaComissionavel: true,
    descricao: null,
    contatoNome: "Ana Beatriz Moreira",
    asaasPaymentId: "pay_1",
    parcelaAtual: 1,
    parcelaTotal: 2,
    fechouEm: new Date("2026-07-05T12:00:00.000Z"),
    dentroDoCorte: 1,
    jaComissionada: 0,
    ...over,
  };
}

function motivoDe(sim: Awaited<ReturnType<typeof simularComissao>>, id: number) {
  return sim.naoComissionaveis.find((n) => n.id === id)?.motivoExclusao ?? null;
}

beforeEach(() => {
  selectQueue = [];
  inserts.length = 0;
});

describe("simularComissao — trilha de gestão", () => {
  it("comissiona só quem fechou a partir do corte, sobre o valor recebido", async () => {
    selectQueue.push([
      cobranca({ id: 1, valor: "1000.00" }),
      cobranca({ id: 2, valor: "4500.00", contatoNome: "Carlos", parcelaAtual: null, parcelaTotal: null }),
    ]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);

    expect(sim.tipo).toBe("gestao");
    expect(sim.dataCorte).toBe("2026-07-01");
    expect(sim.comissionaveis.map((c) => c.id).sort()).toEqual([1, 2]);
    expect(sim.totais.comissionavel).toBe(5500);
    // 2% sobre o recebido — não sobre o valor fechado do contrato.
    expect(sim.totais.valorComissao).toBe(110);
  });

  it("cliente que fechou antes do corte fica de fora COM motivo — não some", async () => {
    selectQueue.push([
      cobranca({ id: 1, valor: "1000.00" }),
      cobranca({
        id: 2,
        valor: "2500.00",
        contatoNome: "Marcos Vinícius Teles",
        fechouEm: new Date("2026-06-18T12:00:00.000Z"),
        dentroDoCorte: 0,
      }),
    ]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);

    expect(sim.comissionaveis.map((c) => c.id)).toEqual([1]);
    expect(motivoDe(sim, 2)).toBe("fechou_antes_do_corte");
    expect(sim.totais.valorComissao).toBe(20);
  });

  it("parcela já comissionada não volta ao cálculo, mas continua visível", async () => {
    selectQueue.push([
      cobranca({ id: 1, valor: "1000.00", jaComissionada: 1 }),
      cobranca({ id: 2, valor: "1000.00", parcelaAtual: 2 }),
    ]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);

    expect(sim.comissionaveis.map((c) => c.id)).toEqual([2]);
    expect(motivoDe(sim, 1)).toBe("ja_comissionada");
    expect(sim.totais.valorComissao).toBe(20);
  });

  it("rodar o mesmo período de novo devolve zero de comissão", async () => {
    selectQueue.push([
      cobranca({ id: 1, valor: "4500.00", jaComissionada: 1 }),
      cobranca({ id: 2, valor: "1000.00", jaComissionada: 1 }),
      cobranca({ id: 3, valor: "1000.00", jaComissionada: 1 }),
    ]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);

    expect(sim.comissionaveis).toHaveLength(0);
    expect(sim.totais.valorComissao).toBe(0);
    expect(sim.naoComissionaveis).toHaveLength(3);
    expect(sim.naoComissionaveis.every((n) => n.motivoExclusao === "ja_comissionada")).toBe(true);
  });

  it("'já comissionada' vence 'fora do corte' — o motivo mais forte é o que pagou", async () => {
    selectQueue.push([cobranca({ id: 1, dentroDoCorte: 0, jaComissionada: 1 })]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);
    expect(motivoDe(sim, 1)).toBe("ja_comissionada");
  });

  it("bruto recebido continua sendo TUDO que entrou no período", async () => {
    selectQueue.push([
      cobranca({ id: 1, valor: "1000.00" }),
      cobranca({ id: 2, valor: "2500.00", dentroDoCorte: 0 }),
      cobranca({ id: 3, valor: "380.00", jaComissionada: 1 }),
    ]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);

    expect(sim.totais.bruto).toBe(3880);
    expect(sim.totais.comissionavel).toBe(1000);
    expect(sim.totais.naoComissionavel).toBe(2880);
  });

  it("categoria não comissionável fica de fora também na gestão", async () => {
    selectQueue.push([
      cobranca({ id: 1, valor: "1000.00" }),
      cobranca({
        id: 2,
        valor: "380.00",
        categoriaNome: "Custas processuais",
        categoriaComissionavel: false,
      }),
    ]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);

    expect(sim.comissionaveis.map((c) => c.id)).toEqual([1]);
    expect(motivoDe(sim, 2)).toBe("categoria_nao_comissionavel");
  });

  it("usa o percentual do gestor, não a regra de faixas do escritório", async () => {
    selectQueue.push([cobranca({ id: 1, valor: "5000.00" })]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);

    expect(sim.regra.modo).toBe("flat");
    expect(sim.aliquotaAplicada).toBe(2);
    expect(sim.faixaAplicada).toBeNull();
    // Com a faixa do escritório (99% acima de 1000) daria 4950.
    expect(sim.totais.valorComissao).toBe(100);
  });

  it("expõe fechamento e parcela pra conferência na tela", async () => {
    selectQueue.push([cobranca({ id: 1, parcelaAtual: 1, parcelaTotal: 2 })]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);

    expect(sim.comissionaveis[0].parcelaAtual).toBe(1);
    expect(sim.comissionaveis[0].parcelaTotal).toBe(2);
    expect(sim.comissionaveis[0].fechouEm).toBe("2026-07-05T12:00:00.000Z");
  });
});

describe("simularComissao — trilha de venda segue intacta", () => {
  it("sem `gestao`, nenhum motivo novo aparece e a faixa do escritório vale", async () => {
    selectQueue.push([cobranca({ id: 1, valor: "5000.00", dentroDoCorte: 0, jaComissionada: 1 })]);
    const sim = await simularComissao(1, 9, "2026-08-01", "2026-08-31");

    expect(sim.tipo).toBe("venda");
    expect(sim.dataCorte).toBeNull();
    // Os flags do SELECT são ignorados fora da gestão: a cobrança entra.
    expect(sim.comissionaveis.map((c) => c.id)).toEqual([1]);
    expect(sim.regra.modo).toBe("faixas");
    expect(sim.aliquotaAplicada).toBe(99);
  });
});

describe("fecharComissao — grava a trilha e não reaproveita o que já pagou", () => {
  it("carimba tipo='gestao' e congela a data de corte", async () => {
    selectQueue.push([]); // check de duplicado
    selectQueue.push([cobranca({ id: 1, valor: "1000.00" })]);
    await fecharComissao({
      escritorioId: 1,
      atendenteId: 50,
      periodoInicio: "2026-08-01",
      periodoFim: "2026-08-31",
      fechadoPorUserId: 7,
      gestao: GESTAO,
    });

    const cabecalho = inserts.find((i) => i.tabela === "comissoes_fechadas");
    expect(cabecalho).toBeDefined();
    expect(cabecalho!.valores.tipo).toBe("gestao");
    expect(cabecalho!.valores.dataCorteUsada).toBe("2026-07-01");
    expect(cabecalho!.valores.aliquotaUsada).toBe("2.00");
  });

  it("fechamento de venda continua nascendo tipo='venda' e sem corte", async () => {
    selectQueue.push([]);
    selectQueue.push([cobranca({ id: 1, valor: "1000.00" })]);
    await fecharComissao({
      escritorioId: 1,
      atendenteId: 9,
      periodoInicio: "2026-08-01",
      periodoFim: "2026-08-31",
      fechadoPorUserId: 7,
    });

    const cabecalho = inserts.find((i) => i.tabela === "comissoes_fechadas");
    expect(cabecalho!.valores.tipo).toBe("venda");
    expect(cabecalho!.valores.dataCorteUsada).toBeNull();
  });

  it("não grava item pra cobrança que já era de outro fechamento", async () => {
    selectQueue.push([]);
    selectQueue.push([
      cobranca({ id: 1, valor: "1000.00" }),
      cobranca({ id: 2, valor: "2500.00", dentroDoCorte: 0 }),
      cobranca({ id: 3, valor: "700.00", jaComissionada: 1 }),
    ]);
    await fecharComissao({
      escritorioId: 1,
      atendenteId: 50,
      periodoInicio: "2026-08-01",
      periodoFim: "2026-08-31",
      fechadoPorUserId: 7,
      gestao: GESTAO,
    });

    const itens = inserts.find((i) => i.tabela === "comissoes_fechadas_itens");
    const ids = (itens!.valores as any[]).map((i) => i.asaasCobrancaId).sort();
    // O fora-do-corte fica registrado (é decisão do período); o já
    // comissionado pertence ao fechamento anterior e não se repete aqui.
    expect(ids).toEqual([1, 2]);
    const item2 = (itens!.valores as any[]).find((i) => i.asaasCobrancaId === 2);
    expect(item2.foiComissionavel).toBe(false);
    expect(item2.motivoExclusao).toBe("fechou_antes_do_corte");
  });
});

// ─── Proveniência: o que só existe no SQL ────────────────────────────────────
// O banco falso não roda SQL, então as condições que separam as trilhas são
// conferidas na fonte. Sem isso, apagar um `tipo = 'venda'` do NOT EXISTS
// passaria por todos os testes acima e faria a comissão de gestão consumir
// as cobranças do vendedor em produção.

describe("SQL das duas trilhas", () => {
  const fonte = fs.readFileSync(
    path.resolve(__dirname, "../escritorio/db-comissoes.ts"),
    "utf-8",
  );

  it("o anti-duplicidade da venda é escopado em tipo='venda'", () => {
    const bloco = fonte.slice(
      fonte.indexOf("condicoes.push(sql`NOT EXISTS"),
      fonte.indexOf("const jaComissionadaSql"),
    );
    expect(bloco.length).toBeGreaterThan(0);
    expect(bloco).toMatch(/comissoesFechadas\.tipo\}\s*=\s*'venda'/);
    expect(bloco).toMatch(/foiComissionavel\}\s*=\s*TRUE/);
  });

  it("o anti-duplicidade da gestão é escopado no tipo E no gestor", () => {
    const bloco = fonte.slice(
      fonte.indexOf("const jaComissionadaSql"),
      fonte.indexOf("const dentroDoCorteSql"),
    );
    expect(bloco.length).toBeGreaterThan(0);
    expect(bloco).toMatch(/comissoesFechadas\.tipo\}\s*=\s*'gestao'/);
    // Sem este escopo, o gestor A perderia a comissão que o gestor B fechou.
    expect(bloco).toMatch(/comissoesFechadas\.atendenteId\}\s*=\s*\$\{atendenteId\}/);
  });

  it("o corte compara a data de FECHAMENTO do lead do cliente", () => {
    const bloco = fonte.slice(
      fonte.indexOf("const dentroDoCorteSql"),
      fonte.indexOf("const fechouEmSql"),
    );
    expect(bloco.length).toBeGreaterThan(0);
    expect(bloco).toMatch(/leads\.etapaFunil\}\s*=\s*'fechado_ganho'/);
    expect(bloco).toMatch(/leads\.fechadoEm\}\s*>=\s*\$\{gestao\.dataCorteEm\}/);
    // Cliente real = COALESCE(beneficiário, pagador), igual ao resto do módulo.
    expect(bloco).toMatch(/COALESCE\(\$\{asaasCobrancas\.contatoBeneficiarioId\}/);
  });

  it("o filtro por atendente da cobrança só existe fora da gestão", () => {
    expect(fonte).toMatch(
      /if \(!gestao\) \{[\s\S]{0,200}condicoes\.push\(eq\(asaasCobrancas\.atendenteId, atendenteId\)\)/,
    );
  });

  it("a trilha entra em todas as chaves de dedup do fechamento", () => {
    const trecho = fonte.slice(fonte.indexOf("export async function fecharComissao"));
    const ocorrencias = trecho.match(/eq\(comissoesFechadas\.tipo, tipo\)/g) ?? [];
    // check pré-INSERT, cálculo da versão e refetch pós-ER_DUP_ENTRY.
    expect(ocorrencias.length).toBe(3);
  });
});

describe("migration 0211", () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../../drizzle/0211_comissao_gestao.sql"),
    "utf-8",
  );

  it("linhas antigas continuam sendo de venda", () => {
    expect(sql).toMatch(/ADD COLUMN tipoComFech ENUM\('venda', 'gestao'\) NOT NULL DEFAULT 'venda'/);
  });

  it("a UNIQUE de dedup passa a incluir a trilha", () => {
    const bloco = sql.slice(sql.indexOf("CREATE UNIQUE INDEX com_fech_periodo_versao_uq"));
    expect(bloco).toContain("tipoComFech");
    expect(bloco).toContain("escritorioIdComFech");
    expect(bloco).toContain("versao");
  });

  it("a config de gestão é por escritório e colaborador", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS comissao_gestao/);
    expect(sql).toMatch(/UNIQUE KEY comissao_gestao_escr_colab_uq \(escritorioIdComGest, colaboradorIdComGest\)/);
    expect(sql).toMatch(/dataCorteComGest VARCHAR\(10\) NOT NULL/);
  });
});
