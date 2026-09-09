/**
 * Contratos cancelados (mockup `mockup-cancelados-contrato.html`, "pode
 * fazer" do dono em 09/09/2026, com as cinco decisões da proposta):
 *
 *  1. o contrato cancelado CONTINUA contando em "Contratos fechados" do mês
 *     em que fechou — a etapa não muda, o cancelamento é outro evento;
 *  2. motivos fixos (desistência, inadimplência, outro escritório, sem
 *     retorno, lançado por engano, outro) + detalhe livre;
 *  3. cancelar oferece encerrar também o serviço do cliente (marcado por
 *     padrão), usando a Situação do serviço que já existia;
 *  4. arrastar um Ganho pra Perdido no Pipeline pergunta "cancelado ou
 *     perdido?";
 *  5. "lançado por engano" fica fora do card, da barra e da lista — engano
 *     não é churn (segue marcado na ficha e na linha de origem).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import {
  contaComoCancelamento, contratoCancelado, descricaoCancelamento, motivoServicoAoCancelar,
  MOTIVOS_CANCELAMENTO, MOTIVO_CANCELAMENTO_ENGANO,
} from "../../shared/cancelamento-contrato";
import {
  cancelarContrato, cancelarContratosDoContato, reativarContrato, validarDataCancelamento, instanteDoDia,
} from "../escritorio/cancelar-contrato";
import {
  agruparFechamentosPorOrigem, montarEtapasFunil, recebidoAntesDeCancelar,
} from "../escritorio/router-relatorios";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");
const D = (s: string) => new Date(`${s}T15:00:00.000Z`);

// ─── Banco falso mínimo: filas de SELECT + captura de UPDATE ────────────────
const NOME = Symbol.for("drizzle:Name");
function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }
const dialeto = new MySqlDialect();
const sqlDe = (w: SQL | undefined) => (w ? dialeto.sqlToQuery(w).sql : "");
function makeDb(filas: Record<string, any[][]>) {
  const updates: Array<{ table: string; set: any }> = [];
  const wheres: SQL[] = [];
  const proxima = (t: string) => (filas[t]?.length ? filas[t].shift()! : []);
  function sel(): any {
    let table = "";
    const b: any = {
      from: (t: any) => { table = nomeTabela(t); return b; },
      where: (w: SQL) => { wheres.push(w); return b; },
      limit: () => Promise.resolve(proxima(table)),
      then: (res: any, rej?: any) => Promise.resolve(proxima(table)).then(res, rej),
    };
    return b;
  }
  return {
    updates,
    wheres,
    select: () => sel(),
    update: (t: any) => ({ set: (set: any) => ({ where: () => { updates.push({ table: nomeTabela(t), set }); return Promise.resolve([{ affectedRows: 1 }]); } }) }),
  };
}
const TZ = "America/Fortaleza";

describe("regras puras do cancelamento", () => {
  it("lista de motivos é a combinada; 'engano' fica fora das métricas", () => {
    expect(MOTIVOS_CANCELAMENTO.map((m) => m.id)).toEqual(["desistencia", "inadimplencia", "outro_escritorio", "sem_retorno", "engano", "outro"]);
    expect(contaComoCancelamento("desistencia")).toBe(true);
    expect(contaComoCancelamento(MOTIVO_CANCELAMENTO_ENGANO)).toBe(false);
    expect(contaComoCancelamento(null)).toBe(true);
  });
  it("cancelado = Ganho com canceladoEm; Perdido nunca é 'cancelado'", () => {
    expect(contratoCancelado({ etapaFunil: "fechado_ganho", canceladoEm: "2026-09-05T12:00:00.000Z" })).toBe(true);
    expect(contratoCancelado({ etapaFunil: "fechado_ganho", canceladoEm: null })).toBe(false);
    expect(contratoCancelado({ etapaFunil: "fechado_perdido", canceladoEm: "2026-09-05T12:00:00.000Z" })).toBe(false);
  });
  it("descrição e texto da Situação do serviço", () => {
    expect(descricaoCancelamento("inadimplencia")).toBe("Inadimplência");
    expect(descricaoCancelamento("outro", "pediu distrato")).toBe("Outro — pediu distrato");
    expect(motivoServicoAoCancelar("desistencia", null)).toBe("Contrato cancelado: Desistência do cliente");
  });
  it("data: não pode ser no futuro nem antes do fechamento; formato exigido", () => {
    expect(validarDataCancelamento({ data: "2026-09-05", hoje: "2026-09-09", diaFechamento: "2026-09-02" })).toBeNull();
    expect(validarDataCancelamento({ data: "2026-09-02", hoje: "2026-09-09", diaFechamento: "2026-09-02" })).toBeNull();
    expect(validarDataCancelamento({ data: "2026-09-10", hoje: "2026-09-09", diaFechamento: null })).toMatch(/futuro/);
    expect(validarDataCancelamento({ data: "2026-09-01", hoje: "2026-09-09", diaFechamento: "2026-09-02" })).toMatch(/anterior ao fechamento \(02\/09\/2026\)/);
    expect(validarDataCancelamento({ data: "09/09/2026", hoje: "2026-09-09", diaFechamento: null })).toMatch(/inválida/);
    expect(instanteDoDia("2026-09-05").getHours()).toBe(12);
  });
});

describe("cancelarContrato / reativarContrato (banco falso)", () => {
  const leadGanho = { id: 7, contatoId: 3, etapaFunil: "fechado_ganho", fechadoEm: D("2026-09-02"), createdAt: D("2026-08-30"), canceladoEm: null };

  it("grava data (meio-dia), motivo, detalhe e quem cancelou; não toca na etapa", async () => {
    const db = makeDb({ leads: [[leadGanho]] });
    const r = await cancelarContrato(db, { escritorioId: 1, leadId: 7, data: "2026-09-08", motivo: "inadimplencia", detalhe: "  não pagou a 2ª parcela  ", canceladoPor: 12, tz: TZ });
    expect(r).toEqual({ contatoId: 3 });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].table).toBe("leads");
    expect(db.updates[0].set).toMatchObject({ motivoCancelamento: "inadimplencia", detalheCancelamento: "não pagou a 2ª parcela", canceladoPor: 12 });
    expect(db.updates[0].set.canceladoEm.getHours()).toBe(12);
    expect(db.updates[0].set).not.toHaveProperty("etapaFunil");
    expect(db.updates[0].set).not.toHaveProperty("fechadoEm");
  });

  it("encerrarServico: também grava a Situação do serviço do cliente com a mesma data", async () => {
    const db = makeDb({ leads: [[leadGanho]] });
    await cancelarContrato(db, { escritorioId: 1, leadId: 7, data: "2026-09-08", motivo: "desistencia", canceladoPor: 12, encerrarServico: true, tz: TZ });
    expect(db.updates.map((u) => u.table)).toEqual(["leads", "contatos"]);
    expect(db.updates[1].set).toMatchObject({ situacaoServico: "cancelado", servicoEncerradoMotivo: "Contrato cancelado: Desistência do cliente", servicoEncerradoPor: 12 });
    expect(db.updates[1].set.servicoEncerradoEm.getHours()).toBe(12);
  });

  it("recusa lead que não é Ganho, já cancelado, inexistente, e data antes do fechamento", async () => {
    await expect(cancelarContrato(makeDb({ leads: [[{ ...leadGanho, etapaFunil: "negociacao" }]] }), { escritorioId: 1, leadId: 7, data: "2026-09-08", motivo: "outro", canceladoPor: 1, tz: TZ }))
      .rejects.toThrow(/Só um contrato fechado/);
    await expect(cancelarContrato(makeDb({ leads: [[{ ...leadGanho, canceladoEm: D("2026-09-05") }]] }), { escritorioId: 1, leadId: 7, data: "2026-09-08", motivo: "outro", canceladoPor: 1, tz: TZ }))
      .rejects.toThrow(/já está cancelado/);
    await expect(cancelarContrato(makeDb({ leads: [[]] }), { escritorioId: 1, leadId: 7, data: "2026-09-08", motivo: "outro", canceladoPor: 1, tz: TZ }))
      .rejects.toThrow(/não encontrada/);
    const db = makeDb({ leads: [[leadGanho]] });
    await expect(cancelarContrato(db, { escritorioId: 1, leadId: 7, data: "2026-09-01", motivo: "outro", canceladoPor: 1, tz: TZ }))
      .rejects.toThrow(/anterior ao fechamento/);
    expect(db.updates).toHaveLength(0);
  });

  it("reativar limpa os quatro campos e só aceita contrato cancelado", async () => {
    const db = makeDb({ leads: [[{ id: 7, canceladoEm: D("2026-09-05") }]] });
    await reativarContrato(db, { escritorioId: 1, leadId: 7 });
    expect(db.updates[0].set).toEqual({ canceladoEm: null, motivoCancelamento: null, detalheCancelamento: null, canceladoPor: null });
    await expect(reativarContrato(makeDb({ leads: [[{ id: 7, canceladoEm: null }]] }), { escritorioId: 1, leadId: 7 })).rejects.toThrow(/não está cancelado/);
  });

  it("cancelarContratosDoContato: só os Ganho ainda abertos; devolve quantos", async () => {
    const db = makeDb({ leads: [[{ id: 1 }, { id: 2 }]] });
    const n = await cancelarContratosDoContato(db, { escritorioId: 1, contatoId: 3, data: "2026-09-08", motivo: "desistencia", detalhe: "cliente pediu", canceladoPor: 5 });
    expect(n).toBe(2);
    expect(db.updates[0].set).toMatchObject({ motivoCancelamento: "desistencia", detalheCancelamento: "cliente pediu", canceladoPor: 5 });
    // A seleção tem que pular quem já está cancelado (senão sobrescreve
    // data/motivo de um cancelamento antigo) e só pegar Ganho do escritório.
    const where = sqlDe(db.wheres[0]);
    expect(where).toMatch(/`canceladoEmLead` is null/);
    expect(where).toMatch(/`etapaFunil` = \?/);
    expect(where).toMatch(/`escritorioIdLead` = \?/);
    expect(where).toMatch(/`contatoIdLead` = \?/);
    const vazio = makeDb({ leads: [[]] });
    expect(await cancelarContratosDoContato(vazio, { escritorioId: 1, contatoId: 3, data: "2026-09-08", motivo: "outro", canceladoPor: 5 })).toBe(0);
    expect(vazio.updates).toHaveLength(0);
  });
});

describe("relatório: funil, origem e recebido antes de cancelar", () => {
  it("funil ganha a barra 'cancelado' e o resumo separa quem fechou no período", () => {
    const { etapas, funilResumo } = montarEtapasFunil(
      [{ etapa: "novo", total: 3, valor: 100 }],
      [{ etapa: "fechado_ganho", total: 20, valor: 77785.25, entraramNoPeriodo: 18 }],
      { total: 2, valor: 6500, fecharamNoPeriodo: 1 },
    );
    expect(etapas.cancelado).toEqual({ total: 2, valor: 6500 });
    expect(etapas.fechado_ganho).toEqual({ total: 20, valor: 77785.25 });
    expect(funilResumo.cancelados).toEqual({ total: 2, valor: 6500, fecharamNoPeriodo: 1, fecharamAntes: 1 });
    expect(montarEtapasFunil([], []).funilResumo.cancelados).toEqual({ total: 0, valor: 0, fecharamNoPeriodo: 0, fecharamAntes: 0 });
  });

  it("origem: contrato cancelado continua na origem dele, com a marca; 'engano' não conta no grupo", () => {
    const base = { criadoEm: D("2026-09-01"), responsavel: "Henrique", recebido: 0 };
    const out = agruparFechamentosPorOrigem([
      { ...base, leadId: 1, origem: "Outro", contatoId: 1, cliente: "A", fechadoEm: D("2026-09-02"), valor: 2500, recebido: 1250, canceladoEm: D("2026-09-08"), motivoCancelamento: "inadimplencia" },
      { ...base, leadId: 2, origem: "Outro", contatoId: 2, cliente: "B", fechadoEm: D("2026-09-04"), valor: 10000 },
      { ...base, leadId: 3, origem: "Outro", contatoId: 3, cliente: "C", fechadoEm: D("2026-09-05"), valor: 900, canceladoEm: D("2026-09-06"), motivoCancelamento: "engano" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ origem: "Outro", total: 3, valorTotal: 13400, recebidoTotal: 1250, cancelados: 1 });
    const a = out[0].fechamentos.find((f) => f.cliente === "A")!;
    expect(a.canceladoEm).toBe(D("2026-09-08").toISOString());
    expect(a.motivoCancelamento).toBe("inadimplencia");
    expect(a.recebido).toBe(1250);
    const c = out[0].fechamentos.find((f) => f.cliente === "C")!;
    expect(c.canceladoEm).not.toBeNull();
    expect(out[0].fechamentos.find((f) => f.cliente === "B")!.canceladoEm).toBeNull();
  });

  it("recebido antes de cancelar: só pagamentos até o dia do cancelamento, atribuídos entre TODOS os fechamentos do cliente", () => {
    const cobrancas = [
      { contatoId: 3, valor: 1250, dataPagamento: "2026-09-03" },
      { contatoId: 3, valor: 700, dataPagamento: "2026-09-09" }, // depois do cancelamento
      { contatoId: 3, valor: 400, dataPagamento: "2026-06-15" }, // do contrato antigo do mesmo cliente
      { contatoId: 4, valor: 999, dataPagamento: "2026-09-03" }, // outro cliente
    ];
    const fechamentos = [
      { leadId: 7, contatoId: 3, dia: "2026-09-02" },
      { leadId: 5, contatoId: 3, dia: "2026-06-10" },
      { leadId: 9, contatoId: 4, dia: "2026-09-01" },
    ];
    expect(recebidoAntesDeCancelar({ leadId: 7, contatoId: 3, diaCancelamento: "2026-09-08", cobrancas, fechamentos })).toBe(1250);
    expect(recebidoAntesDeCancelar({ leadId: 5, contatoId: 3, diaCancelamento: "2026-09-08", cobrancas, fechamentos })).toBe(400);
  });
});

describe("amarras no código", () => {
  const crm = ler("server/escritorio/router-crm.ts");
  const clientes = ler("server/escritorio/router-clientes.ts");
  const rel = ler("server/escritorio/router-relatorios.ts");
  const dash = ler("server/routers/dashboard.ts");
  const pdf = ler("server/escritorio/relatorios-comercial-pdf.ts");
  const atend = ler("client/src/pages/Atendimento.tsx");
  const ficha = ler("client/src/pages/Clientes.tsx");
  const schema = ler("drizzle/schema.ts");

  it("schema e migration: quatro colunas, etapa intacta", () => {
    for (const c of ["canceladoEmLead", "motivoCancelamentoLead", "detalheCancelamentoLead", "canceladoPorLead"]) {
      expect(schema).toContain(`"${c}"`);
      expect(ler("drizzle/0220_lead_cancelamento.sql")).toContain(`ADD COLUMN ${c}`);
    }
    expect(schema).toContain('mysqlEnum("etapaFunil", ["novo", "qualificado", "proposta", "negociacao", "fechado_ganho", "fechado_perdido"])');
  });

  it("procedures: cancelar/reativar com a permissão de editar o Pipeline e auditoria; encerrarServico aceita cancelarContratos", () => {
    const ini = crm.indexOf("cancelarContrato: protectedProcedure");
    const fim = crm.indexOf("criarLeadDeConversa: protectedProcedure", ini);
    const bloco = crm.slice(ini, fim);
    expect(bloco).toContain('motivo: z.enum(MOTIVO_CANCELAMENTO_IDS)');
    expect((bloco.match(/checkPermission\(ctx\.user\.id, "pipeline", "editar", \{ fallbackModulo: "kanban" \}\)/g) || []).length).toBe(2);
    expect(bloco).toContain('acao: "lead.cancelar_contrato"');
    expect(bloco).toContain('acao: "lead.reativar_contrato"');
    expect(bloco).toContain("reativarContrato: protectedProcedure");
    const iEnc = clientes.indexOf("encerrarServico: protectedProcedure");
    const trecho = clientes.slice(iEnc, clientes.indexOf("reativarServico: protectedProcedure", iEnc));
    expect(trecho).toContain("cancelarContratos: z.boolean().optional()");
    expect(trecho).toContain('input.cancelarContratos && (input.tipo === "cancelado" || input.tipo === "rescindido")');
    expect(trecho).toContain("cancelarContratosDoContato(db, {");
  });

  it("relatório: cancelados pela data do cancelamento, sem 'engano'; fechados continuam contando; lista no payload", () => {
    const ini = rel.indexOf("comercialDashboard: protectedProcedure");
    const bloco = rel.slice(ini, rel.indexOf("detalheAtendenteComercial: protectedProcedure", ini));
    expect(bloco).toContain("const cancelamentoConta = sql`(${leads.canceladoEm} IS NOT NULL AND (${leads.motivoCancelamento} IS NULL OR ${leads.motivoCancelamento} <> ${MOTIVO_CANCELAMENTO_ENGANO}))`");
    const iCond = bloco.indexOf("const condCancelados");
    const trechoCond = bloco.slice(iCond, bloco.indexOf("const [canceladosAgg]", iCond));
    expect(trechoCond).toContain("gte(leads.canceladoEm, ini)");
    expect(trechoCond).toContain('eq(leads.etapaFunil, "fechado_ganho")');
    expect(trechoCond).toContain("cancelamentoConta,");
    // O card "Contratos fechados" NÃO exclui cancelados: continua fechadoEm no
    // período; ganha só a contagem "cancelados depois".
    const iFech = bloco.indexOf("const [contratosFechadosAtualAgg]");
    const trechoFech = bloco.slice(iFech, bloco.indexOf("const [contratosFechadosAntAgg]", iFech));
    expect(trechoFech).not.toContain("canceladoEm} IS NULL");
    expect(trechoFech).toContain("canceladosDepois: sql<number>`SUM(CASE WHEN ${cancelamentoConta} THEN 1 ELSE 0 END)`");
    expect(bloco).toContain("montarEtapasFunil(entraramRows, decididosRows, {");
    expect(bloco).toContain("canceladoEm: leads.canceladoEm,\n          motivoCancelamento: leads.motivoCancelamento,");
    expect(bloco).toContain(".where(condCancelados(dataInicio, dataFim))\n        .orderBy(desc(leads.canceladoEm))");
    expect(bloco).toContain("recebidoAntesDeCancelar({");
    expect(bloco).toMatch(/fechamentosPorOrigem,\s*contratosCancelados,/);
    expect(bloco).toContain("contratosFechadosCanceladosDepois,");
  });

  it("dashboard e PDF acompanham", () => {
    expect(dash).toContain("gte(leads.canceladoEm, periodo.dataInicio)");
    expect(dash).toContain("motivoCancelamento} <> 'engano'");
    expect(pdf).toContain('label: "Cancelados"');
    expect(pdf).toContain('"Contratos cancelados no período"');
    expect(pdf).toContain('grupo("Cancelados no período · pela data do cancelamento")');
  });

  it("telas: Pipeline pergunta 'cancelado ou perdido?', tem a coluna Cancelados e bloqueia mover cancelado; ficha oferece cancelar junto", () => {
    expect(atend).toContain('if (etapaDestino === "fechado_perdido" && ld.etapaFunil === "fechado_ganho") {\n      setEscolhaAlvo(');
    expect(atend).toContain('if (ld.canceladoEm) {\n      toast.error("Este contrato está cancelado. Reative antes de mover.");');
    expect(atend).toContain('if (l.etapaFunil === "fechado_ganho" && l.canceladoEm) {');
    expect(atend).toContain("<CanceladoOuPerdidoDialog");
    expect(atend).toContain("<CancelarContratoDialog");
    expect(ficha).toContain("cancelarContratos:");
    expect(ficha).toContain("<CancelarContratoDialog");
    expect(ficha).toContain("reativarContratoMut.mutate({ id: l.id })");
  });
});
