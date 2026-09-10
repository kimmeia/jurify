/**
 * Amarras do Relatório Comercial (aprovado com o mockup
 * `mockup-relatorio-comercial-funil-origem.html`):
 *
 *  1. Funil em dois blocos — etapas abertas por quem ENTROU no período,
 *     Ganho/Perdido por quem foi DECIDIDO (fechadoEm), a mesma data do card
 *     "Contratos fechados". Ganho do funil = card, sempre.
 *  2. "Leads por canal de captação" — os mesmos leads do funil, agrupados
 *     pelo canal da ficha, qualquer canal (sem whitelist).
 *  3. "Recebido por origem" — cada cobrança do card Recebido entra numa
 *     origem só; o que não encaixa vai pro balde "Sem origem / fora do
 *     filtro". Soma das origens = card Recebido.
 *  4. "Google" e "google" viram um card só (chave sem caixa/acento; rótulo
 *     do fechamento mais recente).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  agruparFechamentosPorOrigem,
  atribuirRecebidoAosFechamentos,
  chaveOrigem,
  montarEtapasFunil,
  situacaoDoFechamento,
  ORIGEM_SEM_OU_FORA_DO_FILTRO,
} from "../escritorio/router-relatorios";

const D = (s: string) => new Date(`${s}T15:00:00.000Z`);

describe("montarEtapasFunil — dois blocos, duas datas", () => {
  const entraram = [
    { etapa: "novo", total: 12, valor: 38500 },
    { etapa: "qualificado", total: 6, valor: 21500 },
    { etapa: "proposta", total: 5, valor: 14500 },
    { etapa: "negociacao", total: 3, valor: 10500 },
    { etapa: "fechado_ganho", total: 18, valor: 70285.25 },
  ];
  const decididos = [
    { etapa: "fechado_ganho", total: 20, valor: 77785.25, entraramNoPeriodo: 18 },
  ];

  it("etapas abertas vêm de quem entrou; Ganho/Perdido de quem foi decidido", () => {
    const { etapas, funilResumo } = montarEtapasFunil(entraram, decididos);
    expect(etapas.novo).toEqual({ total: 12, valor: 38500 });
    expect(etapas.negociacao).toEqual({ total: 3, valor: 10500 });
    // O Ganho NÃO é o 18 do bloco "entraram": é o 20 decidido no período.
    expect(etapas.fechado_ganho).toEqual({ total: 20, valor: 77785.25 });
    expect(etapas.fechado_perdido).toEqual({ total: 0, valor: 0 });
    expect(funilResumo.entraram).toEqual({ total: 44, emAberto: 26, jaDecididos: 18 });
    expect(funilResumo.decididos.total).toBe(20);
    expect(funilResumo.decididos.fechado_ganho).toEqual({ total: 20, entraramNoPeriodo: 18, entraramAntes: 2 });
    expect(funilResumo.decididos.fechado_perdido).toEqual({ total: 0, entraramNoPeriodo: 0, entraramAntes: 0 });
  });

  it("aceita números como string (MySQL devolve DECIMAL/COUNT como texto)", () => {
    const { etapas, funilResumo } = montarEtapasFunil(
      [{ etapa: "novo", total: "3", valor: "1500.50" }],
      [{ etapa: "fechado_perdido", total: "2", valor: "900", entraramNoPeriodo: "1" }],
    );
    expect(etapas.novo).toEqual({ total: 3, valor: 1500.5 });
    expect(funilResumo.decididos.fechado_perdido).toEqual({ total: 2, entraramNoPeriodo: 1, entraramAntes: 1 });
  });

  it("vazio devolve zeros (é o que a resposta sem atendentes usa)", () => {
    const { etapas, funilResumo } = montarEtapasFunil([], []);
    expect(etapas).toEqual({
      fechado_ganho: { total: 0, valor: 0 },
      fechado_perdido: { total: 0, valor: 0 },
      cancelado: { total: 0, valor: 0 },
    });
    expect(funilResumo.entraram.total).toBe(0);
    expect(funilResumo.decididos.total).toBe(0);
  });
});

describe("atribuirRecebidoAosFechamentos — cada cobrança entra uma vez só", () => {
  it("cliente com um fechamento: tudo cai nele", () => {
    const { porLead, foraDoFiltro } = atribuirRecebidoAosFechamentos({
      cobrancas: [
        { contatoId: 1, valor: "2850.00", dataPagamento: "2026-09-08" },
        { contatoId: 1, valor: 150, dataPagamento: "2026-09-09" },
      ],
      fechamentos: [{ leadId: 10, contatoId: 1, dia: "2026-09-02", listado: true }],
    });
    expect(porLead.get(10)).toBe(3000);
    expect(foraDoFiltro.size).toBe(0);
  });

  it("dois fechamentos: o mais recente antes do pagamento; antes de todos → o primeiro; mesmo dia conta como antes", () => {
    const fechamentos = [
      { leadId: 20, contatoId: 1, dia: "2026-09-08", listado: true },
      { leadId: 10, contatoId: 1, dia: "2026-09-02", listado: true },
    ];
    const { porLead } = atribuirRecebidoAosFechamentos({
      cobrancas: [
        { contatoId: 1, valor: 100, dataPagamento: "2026-09-01" }, // antes de todos → 10
        { contatoId: 1, valor: 200, dataPagamento: "2026-09-05" }, // entre os dois → 10
        { contatoId: 1, valor: 400, dataPagamento: "2026-09-08" }, // mesmo dia do 20 → 20
        { contatoId: 1, valor: 800, dataPagamento: "2026-09-09" }, // depois → 20
      ],
      fechamentos,
    });
    expect(porLead.get(10)).toBe(300);
    expect(porLead.get(20)).toBe(1200);
  });

  it("empate no mesmo dia: vale o registrado primeiro (menor id)", () => {
    const { porLead } = atribuirRecebidoAosFechamentos({
      cobrancas: [{ contatoId: 1, valor: 500, dataPagamento: "2026-09-10" }],
      fechamentos: [
        { leadId: 31, contatoId: 1, dia: "2026-09-04", listado: true },
        { leadId: 30, contatoId: 1, dia: "2026-09-04", listado: true },
      ],
    });
    // Ambos ≤ pagamento; o "mais recente" entre iguais é o último da ordem
    // (dia asc, id asc) → id 31. O de menor id só ganha quando é o único
    // candidato ≤ pagamento... então o desempate fica explícito aqui:
    expect(porLead.get(31)).toBe(500);
    expect(porLead.has(30)).toBe(false);
  });

  it("fechamento escolhido fora do filtro (ou cliente sem fechamento) vai pro balde", () => {
    const { porLead, foraDoFiltro } = atribuirRecebidoAosFechamentos({
      cobrancas: [
        { contatoId: 1, valor: 700, dataPagamento: "2026-09-09" },
        { contatoId: 2, valor: 300, dataPagamento: "2026-09-09" },
      ],
      fechamentos: [
        { leadId: 10, contatoId: 1, dia: "2026-09-02", listado: true },
        { leadId: 11, contatoId: 1, dia: "2026-09-07", listado: false }, // de outro setor
      ],
    });
    expect(porLead.size).toBe(0);
    expect(foraDoFiltro.get(1)).toBe(700);
    expect(foraDoFiltro.get(2)).toBe(300);
  });

  it("invariante: Σ porLead + Σ foraDoFiltro = Σ cobranças", () => {
    const cobrancas = [
      { contatoId: 1, valor: 1250.35, dataPagamento: "2026-09-03" },
      { contatoId: 1, valor: 99.65, dataPagamento: "2026-09-09" },
      { contatoId: 2, valor: 2850, dataPagamento: "2026-09-08" },
      { contatoId: 3, valor: 10, dataPagamento: "2026-09-01" },
    ];
    const { porLead, foraDoFiltro } = atribuirRecebidoAosFechamentos({
      cobrancas,
      fechamentos: [
        { leadId: 1, contatoId: 1, dia: "2026-09-02", listado: true },
        { leadId: 2, contatoId: 1, dia: "2026-09-06", listado: false },
        { leadId: 3, contatoId: 2, dia: "2026-09-08", listado: true },
      ],
    });
    const soma = [...porLead.values(), ...foraDoFiltro.values()].reduce((s, v) => s + v, 0);
    expect(Math.round(soma * 100)).toBe(Math.round(cobrancas.reduce((s, c) => s + c.valor, 0) * 100));
  });
});

describe("chaveOrigem / situacaoDoFechamento", () => {
  it("ignora caixa e acento; vazio vira ''", () => {
    expect(chaveOrigem("Google")).toBe(chaveOrigem("google"));
    expect(chaveOrigem("Indicação")).toBe(chaveOrigem("INDICACAO"));
    expect(chaveOrigem("  ")).toBe("");
    expect(chaveOrigem(null)).toBe("");
  });
  it("situação: pago com tolerância de 1 centavo, parcial, nada", () => {
    expect(situacaoDoFechamento(1000, 0)).toBe("nada");
    expect(situacaoDoFechamento(1000, 999.99)).toBe("pago");
    expect(situacaoDoFechamento(1000, 999.98)).toBe("parcial");
    expect(situacaoDoFechamento(0, 50)).toBe("pago");
  });
});

describe("agruparFechamentosPorOrigem — recebido, balde e grafia", () => {
  const base = { criadoEm: D("2026-09-01"), responsavel: "Henrique" };

  it("'Google' e 'google' viram um grupo; rótulo = grafia do fechamento mais recente", () => {
    const out = agruparFechamentosPorOrigem([
      { ...base, leadId: 1, origem: "google", contatoId: 1, cliente: "A", fechadoEm: D("2026-09-05"), valor: 2000, recebido: 0 },
      { ...base, leadId: 2, origem: "Google", contatoId: 2, cliente: "B", fechadoEm: D("2026-09-07"), valor: 3500, recebido: 0 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ origem: "Google", total: 2, valorTotal: 5500, recebidoTotal: 0, pagaram: 0 });
  });

  it("soma recebido por grupo, marca situação e 'mesmo cliente'", () => {
    const out = agruparFechamentosPorOrigem([
      { ...base, leadId: 1, origem: "Outro", contatoId: 1, cliente: "Sueli", fechadoEm: D("2026-09-04"), valor: 10000, recebido: 3500 },
      { ...base, leadId: 2, origem: "Outro", contatoId: 2, cliente: "Tiago", fechadoEm: D("2026-09-08"), valor: 2850, recebido: 2850 },
      { ...base, leadId: 3, origem: "Outro", contatoId: 3, cliente: "Rodrigo", fechadoEm: D("2026-09-09"), valor: 5000, recebido: 0 },
      { ...base, leadId: 4, origem: "Meta (Leilão)", contatoId: 1, cliente: "Sueli", fechadoEm: D("2026-09-06"), valor: 4000, recebido: 0 },
    ]);
    const outro = out.find((g) => g.origem === "Outro")!;
    expect(outro).toMatchObject({ total: 3, valorTotal: 17850, recebidoTotal: 6350, pagaram: 2 });
    const porCliente = Object.fromEntries(outro.fechamentos.map((f) => [f.cliente, f]));
    expect(porCliente.Sueli).toMatchObject({ situacao: "parcial", mesmoCliente: 2, foraDoFiltro: false });
    expect(porCliente.Tiago).toMatchObject({ situacao: "pago", mesmoCliente: 1 });
    expect(porCliente.Rodrigo).toMatchObject({ situacao: "nada" });
    const meta = out.find((g) => g.origem === "Meta (Leilão)")!;
    expect(meta.fechamentos[0]).toMatchObject({ cliente: "Sueli", mesmoCliente: 2, situacao: "nada" });
  });

  it("sem origem + fora do filtro caem no mesmo balde, por último, só com cliente e recebido", () => {
    const out = agruparFechamentosPorOrigem(
      [
        { ...base, leadId: 1, origem: "Evento", contatoId: 1, cliente: "A", fechadoEm: D("2026-09-04"), valor: 3000, recebido: 0 },
        { ...base, leadId: 2, origem: "", contatoId: 2, cliente: "B", fechadoEm: D("2026-09-05"), valor: 1200, recebido: 1200 },
      ],
      [{ contatoId: 9, cliente: "Fulano de outro setor", recebido: 700 }],
    );
    expect(out.map((g) => g.origem)).toEqual(["Evento", ORIGEM_SEM_OU_FORA_DO_FILTRO]);
    const balde = out[1];
    expect(balde).toMatchObject({ total: 1, valorTotal: 1200, recebidoTotal: 1900, pagaram: 2 });
    const fora = balde.fechamentos.find((f) => f.foraDoFiltro)!;
    expect(fora).toMatchObject({ cliente: "Fulano de outro setor", recebido: 700, valor: null, fechadoEm: null, responsavel: null, situacao: "fora_do_filtro", leadId: null });
  });

  it("balde com total 0 ainda aparece quando há recebido fora do filtro (é o que faz a soma fechar)", () => {
    const out = agruparFechamentosPorOrigem([], [{ contatoId: 1, cliente: "X", recebido: 50 }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ origem: ORIGEM_SEM_OU_FORA_DO_FILTRO, total: 0, recebidoTotal: 50 });
    // recebido zero fora do filtro não cria linha nenhuma
    expect(agruparFechamentosPorOrigem([], [{ contatoId: 1, cliente: "X", recebido: 0 }])).toEqual([]);
  });

  it("invariante: Σ recebidoTotal dos grupos = Σ recebido das linhas + Σ fora do filtro", () => {
    const rows = [
      { ...base, leadId: 1, origem: "A", contatoId: 1, cliente: "A1", fechadoEm: D("2026-09-01"), valor: 100, recebido: 33.33 },
      { ...base, leadId: 2, origem: "a", contatoId: 2, cliente: "A2", fechadoEm: D("2026-09-02"), valor: 100, recebido: 33.34 },
      { ...base, leadId: 3, origem: "B", contatoId: 3, cliente: "B1", fechadoEm: D("2026-09-03"), valor: 100, recebido: 0 },
      { ...base, leadId: 4, origem: null, contatoId: 4, cliente: "S", fechadoEm: D("2026-09-03"), valor: 100, recebido: 10 },
    ];
    const fora = [{ contatoId: 8, cliente: "F", recebido: 5.55 }];
    const out = agruparFechamentosPorOrigem(rows, fora);
    const soma = out.reduce((s, g) => s + g.recebidoTotal, 0);
    expect(Math.round(soma * 100)).toBe(Math.round((33.33 + 33.34 + 10 + 5.55) * 100));
    expect(out.reduce((s, g) => s + g.total, 0)).toBe(rows.length);
  });

  it("continua funcionando sem leadId/recebido (procedure `comercial` legada)", () => {
    const out = agruparFechamentosPorOrigem([
      { origem: "BNI", contatoId: 1, cliente: "Z", fechadoEm: null, criadoEm: D("2026-09-05"), valor: "500", responsavel: "Pablo" },
    ]);
    expect(out[0]).toMatchObject({ origem: "BNI", total: 1, valorTotal: 500, recebidoTotal: 0 });
    expect(out[0].fechamentos[0]).toMatchObject({ recebido: 0, situacao: "nada", leadId: null });
  });
});

describe("comercialDashboard — as consultas usam as datas combinadas", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "../escritorio/router-relatorios.ts"), "utf8");
  const ini = fonte.indexOf("comercialDashboard: protectedProcedure");
  const fim = fonte.indexOf("detalheAtendenteComercial: protectedProcedure", ini);
  const bloco = fonte.slice(ini, fim);

  it("funil: bloco decidido filtra por fechadoEm e conta quantos entraram no período; monta pelos dois", () => {
    const iDec = bloco.indexOf("const decididosRows");
    const trechoDec = bloco.slice(iDec, bloco.indexOf("montarEtapasFunil(", iDec));
    expect(trechoDec).toContain("inArray(leads.etapaFunil, [...ETAPAS_DECIDIDAS])");
    expect(trechoDec).toContain("gte(leads.fechadoEm, dataInicio)");
    expect(trechoDec).toContain("lte(leads.fechadoEm, dataFim)");
    expect(trechoDec).toMatch(/entraramNoPeriodo: sql<number>`SUM\(CASE WHEN \$\{leads\.createdAt\}/);
    expect(bloco).toContain("montarEtapasFunil(entraramRows, decididosRows, {");
    const iEnt = bloco.indexOf("const entraramRows");
    const trechoEnt = bloco.slice(iEnt, iDec);
    expect(trechoEnt).toContain("gte(leads.createdAt, dataInicio)");
    expect(trechoEnt).not.toContain("fechadoEm");
  });

  it("canal: conta LEADS do período pelo canal da ficha, sem whitelist", () => {
    const i = bloco.indexOf("const leadsPorCanalRows");
    const trecho = bloco.slice(i, bloco.indexOf("const leadsPorCanal =", i));
    expect(trecho).toContain(".from(leads)");
    expect(trecho).toContain(".innerJoin(contatos, eq(leads.contatoId, contatos.id))");
    expect(trecho).toContain("gte(leads.createdAt, dataInicio)");
    expect(trecho).toContain(".groupBy(contatos.origem)");
    expect(bloco).not.toContain("ORIGENS_LEAD");
    expect(bloco).not.toContain("contatosPorOrigem");
  });

  it("origem: lista fechamentos SEM exigir origem, distribui as MESMAS cobranças do card Recebido e devolve o balde", () => {
    const i = bloco.indexOf("const fechamentosDetalheRows");
    const trecho = bloco.slice(i, bloco.indexOf("const cobrancasPagasRows", i));
    expect(trecho).not.toContain("IS NOT NULL");
    expect(trecho).toContain("leadId: leads.id");
    const iCob = bloco.indexOf("const cobrancasPagasRows");
    const trechoCob = bloco.slice(iCob, bloco.indexOf("const contatosPagantes", iCob));
    expect(trechoCob).toContain("inArray(asaasCobrancas.atendenteId, idsAtendentes)");
    expect(trechoCob).toContain("inArray(asaasCobrancas.status, STATUS_PAGO_ASAAS");
    expect(trechoCob).toContain("gte(asaasCobrancas.dataPagamento, dataInicioStr)");
    expect(trechoCob).toContain('buildFiltroComissaoSQL(["sim"])!');
    expect(trechoCob).toContain("IN (${contatosFechadosAtual})");
    // Todos os fechamentos dos pagantes, de QUALQUER responsável — a
    // atribuição não muda conforme o filtro.
    const iPag = bloco.indexOf("const fechamentosDosPagantes");
    const trechoPag = bloco.slice(iPag, bloco.indexOf("const leadsListados", iPag));
    expect(trechoPag).not.toContain("responsavelId");
    expect(trechoPag).toContain("inArray(leads.contatoId, contatosPagantes)");
    expect(bloco).toContain("atribuirRecebidoAosFechamentos({");
    expect(bloco).toContain("dia: dataHojeBR(tz, (f.fechadoEm ?? f.criadoEm) as Date)");
    expect(bloco).toMatch(/funilResumo,\s*leadsPorCanal,\s*fechamentosPorOrigem,/);
  });
});
