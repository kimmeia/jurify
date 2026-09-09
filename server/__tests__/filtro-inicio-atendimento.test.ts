/**
 * Período do Inbox pelo INÍCIO do atendimento (27/08, aprovado pelo dono).
 *
 * Caso real: filtro "hoje" mostrava a Maria Clara, cuja conversa começou
 * ontem — o critério antigo era "teve mensagem na janela". Regra nova:
 * vale a primeira mensagem da conversa; atendimento encerrado
 * (resolvido/fechado) + cliente voltou = NOVO início. O comportamento do
 * SQL em si é coberto por crm-filtro-periodo.test.ts — aqui ficam as
 * amarras do circuito completo (carimbo, backfill, router, tela).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("carimbo do início do atendimento", () => {
  const dbcrm = ler("server/escritorio/db-crm.ts");

  it("conversa nasce carimbada", () => {
    const trecho = dbcrm.slice(dbcrm.indexOf("export async function criarConversa"), dbcrm.indexOf("marcarInicioAtendimento"));
    expect(trecho).toContain("atendimentoIniciadoEm: new Date()");
  });

  it("retorno do cliente após resolvido/fechado re-carimba (novo atendimento)", () => {
    const handler = ler("server/integracoes/whatsapp-handler.ts");
    expect(handler).toContain("marcarInicioAtendimento");
    // O carimbo é condicionado ao estado ENCERRADO — mensagem em conversa
    // aguardando (mesmo atendimento) NÃO reinicia a data.
    const trecho = handler.slice(handler.indexOf('statusAtual === "resolvido"') - 200, handler.indexOf("marcarInicioAtendimento") + 50);
    expect(trecho).toContain('statusAtual === "resolvido" || statusAtual === "fechado"');
  });

  it("migration 0210 cria a coluna e faz backfill pela PRIMEIRA mensagem", () => {
    const sql = ler("drizzle/0210_inicio_atendimento.sql");
    expect(sql).toContain("ADD COLUMN atendimentoIniciadoEmConv");
    expect(sql).toContain("MIN(createdAtMsg)");
    expect(sql).toContain("COALESCE(m.primeira, c.createdAtConv)");
    expect(sql).toContain("WHERE c.atendimentoIniciadoEmConv IS NULL");
  });

  it("schema em sincronia com a migration", () => {
    expect(ler("drizzle/schema.ts")).toContain('atendimentoIniciadoEm: timestamp("atendimentoIniciadoEmConv")');
  });
});

describe("router e tela", () => {
  it("lista e contadores aceitam modoPeriodo (mesmo critério nos dois)", () => {
    const router = ler("server/escritorio/router-crm.ts");
    const ocorrencias = router.split('modoPeriodo: z.enum(["inicio", "mensagens"])').length - 1;
    expect(ocorrencias).toBeGreaterThanOrEqual(2);
    // Nota de transparência: quem ficou fora do filtro tem nome e escape.
    expect(router).toContain("conversasForaDoPeriodo:");
  });

  it("a tela tem o seletor de modo, o preset Hoje e as tags iniciado/reaberto", () => {
    const tela = ler("client/src/pages/Atendimento.tsx");
    expect(tela).toContain("O período conta pelo…");
    expect(tela).toContain("Início do atendimento");
    expect(tela).toContain("Qualquer mensagem no período");
    expect(tela).toContain('"hoje", "7d", "30d", "90d", "todos"');
    expect(tela).toContain('"reaberto" : "iniciado"');
    expect(tela).toContain("mostrar mesmo assim");
    // Limpar filtros devolve o modo ao padrão.
    const limpar = tela.slice(tela.indexOf("const limparFiltrosAvancados"), tela.indexOf("const convs ="));
    expect(limpar).toContain('setModoPeriodo("inicio")');
  });
});
