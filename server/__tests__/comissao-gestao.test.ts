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
  fusoHorario: "America/Sao_Paulo",
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
    atendenteNome: "Milena Alves Sampaio",
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
});

describe("gestão gradativa — faixas e mínimo do gestor", () => {
  const COM_FAIXAS = {
    ...GESTAO,
    modo: "faixas" as const,
    baseFaixa: "comissionavel" as const,
    faixas: [
      { limiteAte: 10000, aliquotaPercent: 1 },
      { limiteAte: 20000, aliquotaPercent: 2 },
      { limiteAte: null, aliquotaPercent: 3 },
    ],
  };

  it("a faixa atingida vale sobre TODA a base (cumulativo, como na venda)", async () => {
    selectQueue.push([cobranca({ id: 1, valor: "15000.00" })]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, COM_FAIXAS);

    expect(sim.regra.modo).toBe("faixas");
    expect(sim.aliquotaAplicada).toBe(2);
    expect(sim.faixaAplicada?.limiteAte).toBe(20000);
    expect(sim.totais.valorComissao).toBe(300);
  });

  it("estourar todos os tetos cai na faixa sem teto", async () => {
    selectQueue.push([cobranca({ id: 1, valor: "50000.00" })]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, COM_FAIXAS);
    expect(sim.aliquotaAplicada).toBe(3);
    expect(sim.totais.valorComissao).toBe(1500);
  });

  it("o que ficou de fora por corte NÃO empurra a faixa pra cima", async () => {
    // Base comissionável = 5.000 → 1ª faixa. Se o descartado entrasse na
    // classificação, o gestor pularia pra 2% e receberia a mais.
    selectQueue.push([
      cobranca({ id: 1, valor: "5000.00" }),
      cobranca({ id: 2, valor: "9000.00", dentroDoCorte: 0 }),
    ]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, COM_FAIXAS);
    expect(sim.aliquotaAplicada).toBe(1);
    expect(sim.totais.valorComissao).toBe(50);
  });

  it("a base da faixa respeita a escolha do gestor (comissionável × bruto)", async () => {
    // Elegíveis: R$ 5.000 comissionáveis + R$ 8.000 de custas (não
    // comissionável). Pela base "comissionável" a classificação usa 5.000 e
    // cai na 1ª faixa; pela base "bruto" usa 13.000 e sobe pra 2ª — em
    // ambos os casos a comissão incide só sobre os 5.000.
    const linhas = [
      cobranca({ id: 1, valor: "5000.00" }),
      cobranca({
        id: 2,
        valor: "8000.00",
        categoriaNome: "Custas processuais",
        categoriaComissionavel: false,
      }),
    ];

    selectQueue.push(linhas);
    const porComissionavel = await simularComissao(
      1, 50, "2026-08-01", "2026-08-31", undefined, COM_FAIXAS,
    );
    expect(porComissionavel.aliquotaAplicada).toBe(1);
    expect(porComissionavel.totais.valorComissao).toBe(50);

    selectQueue.push(linhas);
    const porBruto = await simularComissao(
      1, 50, "2026-08-01", "2026-08-31", undefined,
      { ...COM_FAIXAS, baseFaixa: "bruto" as const },
    );
    expect(porBruto.aliquotaAplicada).toBe(2);
    expect(porBruto.totais.valorComissao).toBe(100);
  });

  it("cobrança abaixo do mínimo do gestor não conta", async () => {
    selectQueue.push([
      cobranca({ id: 1, valor: "1000.00" }),
      cobranca({ id: 2, valor: "80.00" }),
    ]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, {
      ...GESTAO,
      valorMinimo: 100,
    });

    expect(sim.comissionaveis.map((c) => c.id)).toEqual([1]);
    expect(motivoDe(sim, 2)).toBe("abaixo_minimo");
    expect(sim.regra.valorMinimo).toBe(100);
    expect(sim.totais.valorComissao).toBe(20);
  });

  it("o mínimo é o do gestor, não o do escritório", async () => {
    // O escritório está com mínimo 0 no mock; um gestor com 2.000 tem que
    // cortar uma cobrança de 1.000 mesmo assim.
    selectQueue.push([cobranca({ id: 1, valor: "1000.00" })]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, {
      ...GESTAO,
      valorMinimo: 2000,
    });
    expect(sim.comissionaveis).toHaveLength(0);
    expect(motivoDe(sim, 1)).toBe("abaixo_minimo");
  });

  it("sem faixas cadastradas, gestão continua flat", async () => {
    selectQueue.push([cobranca({ id: 1, valor: "5000.00" })]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);
    expect(sim.regra.modo).toBe("flat");
    expect(sim.regra.valorMinimo).toBe(0);
  });

  it("expõe fechamento e parcela pra conferência na tela", async () => {
    selectQueue.push([cobranca({ id: 1, parcelaAtual: 1, parcelaTotal: 2 })]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);

    expect(sim.comissionaveis[0].parcelaAtual).toBe(1);
    expect(sim.comissionaveis[0].parcelaTotal).toBe(2);
    // Na gestão as cobranças vêm de todos os vendedores — sem o nome, a
    // lista não dá pra conferir.
    expect(sim.comissionaveis[0].atendenteNome).toBe("Milena Alves Sampaio");
    // Data pura, no formato que o resto da tela usa. Com ISO cheio o
    // formatador do client parte a string em três e cospe o horário no meio.
    expect(sim.comissionaveis[0].fechouEm).toBe("2026-07-05");
  });

  it("o dia do fechamento é o do fuso do escritório, não o de UTC", async () => {
    // 01/07 às 22h em São Paulo já é 02/07 em UTC. Mostrar 02 faria o
    // operador ler uma data diferente da que decidiu a elegibilidade.
    selectQueue.push([
      cobranca({ id: 1, fechouEm: new Date("2026-07-02T01:00:00.000Z") }),
    ]);
    const sim = await simularComissao(1, 50, "2026-08-01", "2026-08-31", undefined, GESTAO);
    expect(sim.comissionaveis[0].fechouEm).toBe("2026-07-01");
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

describe("migration 0212", () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../../drizzle/0212_comissao_gestao_faixas.sql"),
    "utf-8",
  );

  it("os defaults reproduzem o que já está no ar", () => {
    expect(sql).toMatch(/modoComGest ENUM\('flat', 'faixas'\) NOT NULL DEFAULT 'flat'/);
    expect(sql).toMatch(/baseFaixaComGest ENUM\('bruto', 'comissionavel'\) NOT NULL DEFAULT 'comissionavel'/);
    expect(sql).toMatch(/valorMinimoComGest DECIMAL\(12, 2\) NOT NULL DEFAULT '0'/);
  });

  it("as faixas penduram no gestor, não no escritório", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS comissao_gestao_faixas/);
    expect(sql).toMatch(/comissaoGestaoIdFaixa INT NOT NULL/);
    // NULL = sem teto: a coluna não pode ser NOT NULL.
    expect(sql).toMatch(/limiteAteFaixaGest DECIMAL\(14, 2\),/);
  });
});

describe("gravação da config de gestão", () => {
  const fonte = fs.readFileSync(
    path.resolve(__dirname, "../escritorio/db-comissoes.ts"),
    "utf-8",
  );
  const router = fs.readFileSync(
    path.resolve(__dirname, "../escritorio/router-comissoes.ts"),
    "utf-8",
  );

  it("troca de faixas acontece dentro de transação", () => {
    const bloco = fonte.slice(fonte.indexOf("export async function salvarComissaoGestao"));
    // DELETE seguido de INSERT fora de transação deixa o gestor em
    // modo='faixas' com zero faixas — o cálculo cai no flat em silêncio.
    expect(bloco).toMatch(/db\.transaction\(async \(tx\) => \{/);
    const corpo = bloco.slice(bloco.indexOf("db.transaction"));
    expect(corpo.indexOf("tx\n      .delete(comissaoGestaoFaixas)")).toBeGreaterThan(0);
    expect(corpo).toMatch(/tx\.insert\(comissaoGestaoFaixas\)/);
  });

  it("o servidor recusa modo por faixas com tabela vazia", () => {
    expect(router).toMatch(
      /input\.modo === "faixas" && input\.faixas\.length === 0[\s\S]{0,220}BAD_REQUEST/,
    );
  });
});
