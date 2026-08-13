/**
 * Robô de conciliação — primeira regra.
 *
 * Invariante de TELA, não de dado: quando duas telas respondem à mesma
 * pergunta de negócio, elas têm que dar o mesmo número. O auditor de banco
 * (`server/admin/auditoria/`) é cego pra isso — o dado pode estar perfeito
 * e as duas telas discordarem, porque cada uma tem a sua própria query.
 *
 * A pergunta aqui: "quanto o escritório recebeu no período?". Ela é
 * respondida pela página /financeiro (`asaas.kpis`) e pelo Painel
 * Financeiro (`dashboard.financeiro`), por caminhos independentes. Até
 * 13/08/2026 os dois discordavam de duas formas:
 *
 *   1. o painel listava 3 status de pago à mão e perdia DUNNING_RECEIVED
 *      (cliente que paga depois de negativado) — dinheiro recebido que
 *      sumia do painel e não aparecia nem como vencido;
 *   2. o painel não filtrava por visibilidade de cliente, então quem tem
 *      `financeiro.verProprios` via o caixa do escritório inteiro.
 *
 * Chamamos as procedures direto, sem browser: é determinístico e, quando
 * falha, aponta QUAL dos dois lados mudou — coisa que ler número na tela
 * não faz.
 *
 * Pré-requisito: DATABASE_URL apontando pra banco DESCARTÁVEL.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { appRouter } from "../../server/routers";
import type { TrpcContext } from "../../server/_core/context";
import { getDb } from "../../server/db";
import {
  asaasCobrancas,
  colaboradores,
  contatos,
  escritorios,
  eventosProcesso,
  notificacoes,
  users,
} from "../../drizzle/schema";

const TEM_DB = !!process.env.DATABASE_URL;

/** Período fechado, pra não depender do dia em que o teste roda. */
const INICIO = "2026-03-01";
const FIM = "2026-03-31";
const PAGAMENTO = "2026-03-10";

interface Cenario {
  escritorioId: number;
  donoUserId: number;
  restritoUserId: number;
  /** Soma de tudo que foi pago no período, incluindo o cliente do restrito. */
  totalPago: number;
  /** Atendente não tem acesso ao financeiro — as duas telas devem dar 0. */
  totalDoRestrito: number;
}

let cenario: Cenario;

function contextoDe(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `conciliacao-${userId}`,
      email: `conciliacao-${userId}@jurify.test`,
      name: "Conciliação",
      loginMethod: "email",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as TrpcContext;
}

async function semear(): Promise<Cenario> {
  const db = (await getDb())!;
  const marca = `conc-${Date.now()}`;

  const [donoIns] = await db.insert(users).values({
    openId: `${marca}-dono`,
    name: "Dono Conciliação",
    email: `${marca}-dono@jurify.test`,
    loginMethod: "email",
    role: "user",
  });
  const donoUserId = (donoIns as { insertId: number }).insertId;

  const [restritoIns] = await db.insert(users).values({
    openId: `${marca}-restrito`,
    name: "Atendente Conciliação",
    email: `${marca}-restrito@jurify.test`,
    loginMethod: "email",
    role: "user",
  });
  const restritoUserId = (restritoIns as { insertId: number }).insertId;

  const [escIns] = await db.insert(escritorios).values({
    nome: `Escritório ${marca}`,
    ownerId: donoUserId,
  });
  const escritorioId = (escIns as { insertId: number }).insertId;

  await db.insert(colaboradores).values({
    escritorioId,
    userId: donoUserId,
    cargo: "dono",
    ativo: true,
  });
  const [colabIns] = await db.insert(colaboradores).values({
    escritorioId,
    userId: restritoUserId,
    // Atendente enxerga só a própria carteira no financeiro — é o cargo
    // que expõe a diferença entre as duas telas.
    cargo: "atendente",
    ativo: true,
  });
  const colaboradorRestritoId = (colabIns as { insertId: number }).insertId;

  const [contatoDoRestrito] = await db.insert(contatos).values({
    escritorioId,
    nome: "Cliente do atendente",
    responsavelId: colaboradorRestritoId,
  });
  const [contatoDeOutro] = await db.insert(contatos).values({
    escritorioId,
    nome: "Cliente de outro",
  });
  const contatoRestritoId = (contatoDoRestrito as { insertId: number }).insertId;
  const contatoOutroId = (contatoDeOutro as { insertId: number }).insertId;

  await db.insert(asaasCobrancas).values([
    // Recebimento comum.
    {
      escritorioId,
      contatoId: contatoRestritoId,
      valor: "1000.00",
      vencimento: PAGAMENTO,
      dataPagamento: PAGAMENTO,
      status: "RECEIVED",
      origem: "asaas",
    },
    // O caso que o painel perdia: pago DEPOIS de negativado.
    {
      escritorioId,
      contatoId: contatoOutroId,
      valor: "5000.00",
      vencimento: PAGAMENTO,
      dataPagamento: PAGAMENTO,
      status: "DUNNING_RECEIVED",
      origem: "asaas",
    },
    // Fora do período — não pode entrar em nenhum dos dois lados.
    {
      escritorioId,
      contatoId: contatoOutroId,
      valor: "777.00",
      vencimento: "2026-05-10",
      dataPagamento: "2026-05-10",
      status: "RECEIVED",
      origem: "asaas",
    },
    // Não pago — idem.
    {
      escritorioId,
      contatoId: contatoOutroId,
      valor: "999.00",
      vencimento: PAGAMENTO,
      status: "PENDING",
      origem: "asaas",
    },
  ]);

  return {
    escritorioId,
    donoUserId,
    restritoUserId,
    totalPago: 6000,
    totalDoRestrito: 1000,
  };
}

async function limpar(escritorioId: number) {
  const db = (await getDb())!;
  await db.delete(asaasCobrancas).where(eq(asaasCobrancas.escritorioId, escritorioId));
  await db.delete(contatos).where(eq(contatos.escritorioId, escritorioId));
  await db.delete(colaboradores).where(eq(colaboradores.escritorioId, escritorioId));
  await db.delete(escritorios).where(eq(escritorios.id, escritorioId));
}

describe("conciliação: /financeiro x Painel Financeiro", () => {
  beforeAll(async () => {
    if (!TEM_DB) {
      console.log("[smoke] DATABASE_URL não configurada — conciliação skipada.");
      return;
    }
    cenario = await semear();
  }, 120_000);

  it("o recebido do painel bate com o de /financeiro, para o dono", async () => {
    if (!TEM_DB) return;

    const caller = appRouter.createCaller(contextoDe(cenario.donoUserId));

    const kpis = await caller.asaas.kpis({
      pagamentoInicio: INICIO,
      pagamentoFim: FIM,
    });
    const painel = await caller.dashboard.financeiro({
      dataInicio: INICIO,
      dataFim: FIM,
    });

    expect(kpis.recebido).toBe(cenario.totalPago);
    expect(
      painel?.recebido,
      "Painel Financeiro discorda de /financeiro para o mesmo período",
    ).toBe(kpis.recebido);
  }, 60_000);

  it("o painel nunca mostra mais caixa do que o usuário pode ver", async () => {
    if (!TEM_DB) return;

    // Propriedade que vale pra qualquer usuário e qualquer período: o painel
    // é uma visão do mesmo dinheiro, então não pode ampliar a permissão.
    //
    // O caso é pior do que parece: atendente, estagiário e sdr têm
    // `dashboard.verTodos = true` e `financeiro` zerado
    // (check-permission.ts:59,67,80). Antes da correção o painel só olhava o
    // gate de dashboard e somava o escritório inteiro — o atendente via
    // receita, inadimplência e os 5 maiores devedores com nome e valor,
    // enquanto /financeiro lhe negava tudo. Aqui o painel devolvia 6000.
    const caller = appRouter.createCaller(contextoDe(cenario.restritoUserId));

    const kpis = await caller.asaas.kpis({
      pagamentoInicio: INICIO,
      pagamentoFim: FIM,
    });
    const painel = await caller.dashboard.financeiro({
      dataInicio: INICIO,
      dataFim: FIM,
    });

    expect(kpis.recebido, "atendente não tem acesso ao financeiro").toBe(0);
    expect(
      painel?.recebido ?? 0,
      "Painel Financeiro vazou caixa que o usuário não pode ver em /financeiro",
    ).toBeLessThanOrEqual(kpis.recebido);
    expect(painel?.topDevedores ?? [], "Painel Financeiro vazou lista de devedores").toEqual([]);
  }, 60_000);

  it("dinheiro pago após negativação entra nas duas telas", async () => {
    if (!TEM_DB) return;

    // DUNNING_RECEIVED é dinheiro que entrou. Some de uma tela e o caixa
    // do escritório passa a depender de qual página o usuário abriu.
    const db = (await getDb())!;
    const [linha] = await db
      .select({ total: sql<string>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(20,2))), 0)` })
      .from(asaasCobrancas)
      .where(
        and(
          eq(asaasCobrancas.escritorioId, cenario.escritorioId),
          eq(asaasCobrancas.status, "DUNNING_RECEIVED"),
        ),
      );
    expect(Number(linha?.total ?? 0)).toBe(5000);

    const caller = appRouter.createCaller(contextoDe(cenario.donoUserId));
    const painel = await caller.dashboard.financeiro({
      dataInicio: INICIO,
      dataFim: FIM,
    });

    expect(painel?.recebido).toBe(cenario.totalPago);
  }, 60_000);

  it("limpa o que semeou", async () => {
    if (!TEM_DB) return;
    await limpar(cenario.escritorioId);
  }, 60_000);
});

describe("conciliação: badge de movimentações x card do Painel", () => {
  let escritorioId = 0;
  let donoUserId = 0;
  let outroUserId = 0;
  let eventoIds: number[] = [];

  beforeAll(async () => {
    if (!TEM_DB) return;
    const db = (await getDb())!;
    const marca = `mov-${Date.now()}`;

    const [donoIns] = await db.insert(users).values({
      openId: `${marca}-dono`,
      name: "Dono Mov",
      email: `${marca}-dono@jurify.test`,
      loginMethod: "email",
      role: "user",
    });
    donoUserId = (donoIns as { insertId: number }).insertId;

    const [outroIns] = await db.insert(users).values({
      openId: `${marca}-outro`,
      name: "Gestor Mov",
      email: `${marca}-outro@jurify.test`,
      loginMethod: "email",
      role: "user",
    });
    outroUserId = (outroIns as { insertId: number }).insertId;

    const [escIns] = await db.insert(escritorios).values({
      nome: `Escritório ${marca}`,
      ownerId: donoUserId,
    });
    escritorioId = (escIns as { insertId: number }).insertId;

    await db.insert(colaboradores).values([
      { escritorioId, userId: donoUserId, cargo: "dono", ativo: true },
      { escritorioId, userId: outroUserId, cargo: "gestor", ativo: true },
    ]);

    // Três movimentações do escritório, nenhuma notificação para ninguém —
    // é o estado real de quem não cadastrou o monitoramento.
    const agora = new Date();
    for (let i = 0; i < 3; i++) {
      const [ins] = await db.insert(eventosProcesso).values({
        escritorioId,
        dataEvento: agora,
        fonte: "pje",
        tipo: "movimentacao",
        conteudo: `Movimentação de teste ${i}`,
        hashDedup: `${marca}-${i}`,
        lido: false,
      });
      eventoIds.push(Number((ins as { insertId: number }).insertId));
    }

    // Uma notificação para o dono, imitando quem cadastrou o monitoramento.
    // Sem ela o teste do "marcar como lida" passava até com o bug: os dois
    // lados davam zero por falta de dado, não por concordarem.
    await db.insert(notificacoes).values({
      userId: donoUserId,
      titulo: "Nova movimentação",
      mensagem: "Movimentação de teste",
      tipo: "movimentacao",
      lida: false,
    });
  }, 120_000);

  it("badge e card mostram o mesmo número para quem não cadastrou o monitoramento", async () => {
    if (!TEM_DB) return;

    // O gestor não criou nenhum monitoramento, então não tem notificação
    // nenhuma. Antes da correção: badge 3, card 0, na mesma tela.
    const caller = appRouter.createCaller(contextoDe(outroUserId));

    const badge = await caller.movimentacoes.contador();
    const painel = await caller.dashboard.resumoEscritorio();

    expect(badge.naoLidas).toBe(3);
    expect(
      painel?.processos.movimentacoesNaoLidas,
      "card do Painel discorda do badge do menu",
    ).toBe(badge.naoLidas);
  }, 60_000);

  it("marcar como lida derruba os dois juntos", async () => {
    if (!TEM_DB) return;

    // O defeito mais teimoso era este: "marcar como lida" só tocava em
    // `eventos_processo`, então o badge zerava e o card ficava travado no
    // número antigo para sempre.
    const caller = appRouter.createCaller(contextoDe(donoUserId));
    await caller.movimentacoes.marcarLidas({ eventoIds });

    const badge = await caller.movimentacoes.contador();
    const painel = await caller.dashboard.resumoEscritorio();

    expect(badge.naoLidas).toBe(0);
    expect(
      painel?.processos.movimentacoesNaoLidas,
      "card do Painel não acompanhou o marcar-como-lida",
    ).toBe(0);
  }, 60_000);

  it("limpa o que semeou", async () => {
    if (!TEM_DB) return;
    const db = (await getDb())!;
    await db.delete(eventosProcesso).where(eq(eventosProcesso.escritorioId, escritorioId));
    await db.delete(notificacoes).where(inArray(notificacoes.userId, [donoUserId, outroUserId]));
    await limpar(escritorioId);
  }, 60_000);
});
