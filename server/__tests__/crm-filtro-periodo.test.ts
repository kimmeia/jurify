/**
 * Testes — filtro de período do Atendimento.
 *
 * Bug protegido: o filtro comparava `conversas.ultimaMensagemAt`, campo
 * SOBRESCRITO a cada mensagem nova. Ele respondia "a última atividade de
 * todos os tempos caiu na janela?" — não "houve atendimento na janela?".
 * Conversa atendida no período que seguiu recebendo mensagem depois sumia
 * do resultado, e a distorção crescia quanto mais antigo o intervalo.
 *
 * Contrato desde 27/08 (aprovado pelo dono): o período conta pelo INÍCIO
 * do atendimento (conversas.atendimentoIniciadoEm, com COALESCE em
 * createdAt) — modo default "inicio". O comportamento anterior (qualquer
 * mensagem na janela, via EXISTS imutável sobre mensagens.createdAt)
 * continua disponível com modoPeriodo: "mensagens" — nada foi removido.
 *
 * Gera o SQL de verdade (drizzle real + conexão fake) em vez de inspecionar
 * objeto: o que importa aqui é o texto da query que chega no MySQL.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";

const executadas: { sql: string; params: unknown[] }[] = [];

const conexaoFake = {
  query: async (sql: any, params: any) => {
    executadas.push({ sql: typeof sql === "string" ? sql : sql?.sql ?? "", params: params ?? [] });
    return [[], []];
  },
  execute: async (sql: any, params: any) => {
    executadas.push({ sql: typeof sql === "string" ? sql : sql?.sql ?? "", params: params ?? [] });
    return [[], []];
  },
};

const dbReal = drizzle(conexaoFake as any);
vi.mock("../db", () => ({ getDb: async () => dbReal }));

const { listarConversas, contarConversasPorStatus } = await import("../escritorio/db-crm");

/** SQL da primeira query (a das conversas). */
const sqlPrincipal = () => (executadas[0]?.sql ?? "").replace(/\s+/g, " ");

beforeEach(() => {
  executadas.length = 0;
});

const INICIO = "2026-07-01T11:00:00.000Z";
const FIM = "2026-07-01T21:00:00.000Z";

describe("filtro de período — base é a mensagem, não a última atividade", () => {
  it("gera EXISTS em mensagens correlacionado com a conversa", async () => {
    await listarConversas(1, { dataInicio: INICIO, dataFim: FIM, modoPeriodo: "mensagens" });
    const s = sqlPrincipal();
    expect(s).toMatch(/exists/i);
    expect(s).toContain("`mensagens`");
    expect(s).toContain("`createdAtMsg`");
    // Correlação: a subquery precisa amarrar mensagem ↔ conversa, senão
    // qualquer mensagem no período faria TODAS as conversas passarem.
    expect(s).toMatch(/`conversaIdMsg`\s*=\s*`conversas`\.`id`/i);
  });

  it("NÃO usa mais ultimaMensagemAt como filtro de período", async () => {
    await listarConversas(1, { dataInicio: INICIO, dataFim: FIM });
    const where = sqlPrincipal().split(/\bwhere\b/i)[1] ?? "";
    // `ultimaMensagemAt` segue no ORDER BY/SELECT — o que não pode é ele
    // aparecer no WHERE recebendo os limites do período.
    expect(where.split(/\border by\b/i)[0]).not.toContain("ultimaMensagemAt");
  });

  it("só dataInicio: gera limite inferior, sem limite superior", async () => {
    await listarConversas(1, { dataInicio: INICIO, modoPeriodo: "mensagens" });
    const s = sqlPrincipal();
    expect(s).toMatch(/exists/i);
    expect(s).toContain("`createdAtMsg` >=");
    expect(s).not.toContain("`createdAtMsg` <=");
  });

  it("só dataFim: gera limite superior, sem limite inferior", async () => {
    await listarConversas(1, { dataFim: FIM, modoPeriodo: "mensagens" });
    const s = sqlPrincipal();
    expect(s).toContain("`createdAtMsg` <=");
    expect(s).not.toContain("`createdAtMsg` >=");
  });

  it("data inválida é ignorada (não vira EXISTS quebrado)", async () => {
    await listarConversas(1, { dataInicio: "nao-e-data" });
    expect(sqlPrincipal()).not.toMatch(/exists/i);
  });

  it("sem período: nenhuma subquery de mensagens", async () => {
    await listarConversas(1, {});
    expect(sqlPrincipal()).not.toMatch(/exists/i);
  });

  it("os limites do período viram parâmetros da query", async () => {
    await listarConversas(1, { dataInicio: INICIO, dataFim: FIM });
    const params = (executadas[0]?.params ?? []) as unknown[];
    expect(params.length).toBeGreaterThanOrEqual(2);
  });
});

describe("contadores usam a MESMA regra da lista", () => {
  it("contarConversasPorStatus também filtra por mensagem no período", async () => {
    // Contador e lista divergirem é o que fazia a aba dizer um número e a
    // lista mostrar outro.
    await contarConversasPorStatus(1, { dataInicio: INICIO, dataFim: FIM, modoPeriodo: "mensagens" });
    const s = sqlPrincipal();
    expect(s).toMatch(/exists/i);
    expect(s).toContain("`createdAtMsg`");
  });
});

describe("modo 'início do atendimento' (default desde 27/08)", () => {
  it("sem modoPeriodo: compara o início do atendimento, não as mensagens", async () => {
    await listarConversas(1, { dataInicio: INICIO, dataFim: FIM });
    const s = sqlPrincipal();
    expect(s).toContain("atendimentoIniciadoEmConv");
    // COALESCE cobre linha antiga sem backfill (cai no createdAt da conversa).
    expect(s).toMatch(/coalesce/i);
    expect(s).not.toMatch(/exists/i);
  });

  it("contadores usam o MESMO critério da lista no modo início", async () => {
    await contarConversasPorStatus(1, { dataInicio: INICIO, dataFim: FIM });
    const s = sqlPrincipal();
    expect(s).toContain("atendimentoIniciadoEmConv");
    expect(s).not.toMatch(/exists/i);
  });

  it("somente primeiro contato continua funcionando no modo início", async () => {
    await listarConversas(1, { dataInicio: INICIO, somenteNovos: true });
    const s = sqlPrincipal();
    expect(s).toContain("atendimentoIniciadoEmConv");
    expect(s).toMatch(/not exists/i);
  });
});

describe("somente primeiro contato (lead novo no periodo)", () => {
  it("adiciona NOT EXISTS de mensagem anterior ao inicio da janela", async () => {
    await listarConversas(1, { dataInicio: INICIO, dataFim: FIM, somenteNovos: true });
    const s = sqlPrincipal();
    expect(s).toMatch(/not exists/i);
    // O recorte e "nenhuma mensagem ANTES do inicio" — precisa do `<`.
    expect(s).toContain("`createdAtMsg` <");
  });

  it("sem o toggle nao gera NOT EXISTS", async () => {
    await listarConversas(1, { dataInicio: INICIO, dataFim: FIM });
    expect(sqlPrincipal()).not.toMatch(/not exists/i);
  });

  it("toggle sem dataInicio e ignorado (nao existe 'antes' pra ancorar)", async () => {
    await listarConversas(1, { dataFim: FIM, somenteNovos: true });
    expect(sqlPrincipal()).not.toMatch(/not exists/i);
  });

  it("contadores respeitam o toggle (aba e lista continuam batendo)", async () => {
    await contarConversasPorStatus(1, { dataInicio: INICIO, somenteNovos: true });
    expect(sqlPrincipal()).toMatch(/not exists/i);
  });
});
