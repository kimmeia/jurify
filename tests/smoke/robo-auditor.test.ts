/**
 * Smoke do robô auditor contra um banco de verdade.
 *
 * Os testes unitários em `server/admin/auditoria/` cobrem o executor com
 * regras falsas: eles provam que uma regra quebrada não derruba a
 * varredura, não que as consultas de verdade funcionam. Isso só o MySQL
 * responde — subquery com alias, comparação de decimal, semântica de
 * LEFT JOIN. Uma regra com SQL inválido passa no `tsc` e no `pnpm test`,
 * e só aparece como "regra falhou" na primeira varredura em produção.
 *
 * Aqui cada invariante recebe um par: uma linha que a VIOLA e pelo menos
 * uma linha SAUDÁVEL parecida. O teste exige que o robô pegue exatamente
 * a primeira. Falso positivo reprova igual a falso negativo — regra que
 * grita à toa é regra que ninguém lê.
 *
 * Pré-requisito: DATABASE_URL apontando pra banco DESCARTÁVEL. O setup
 * apaga as tabelas que usa. Sem DB, o teste é skipado com aviso.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  asaasCobrancas,
  clienteProcessos,
  cofreCredenciais,
  colaboradores,
  comissoesFechadas,
  comissoesFechadasItens,
  contatos,
  convitesColaborador,
  escritorioCreditos,
  escritorioTransacoes,
  escritorios,
  kanbanCards,
  kanbanColunas,
  kanbanFunis,
  leads,
  motorMonitoramentos,
  smartflowExecucoes,
} from "../../drizzle/schema";
import { varrer } from "../../server/admin/auditoria/executor";
import { REGRAS } from "../../server/admin/auditoria/regras";
import { listarUltimasVarreduras, salvarVarredura } from "../../server/admin/auditoria/historico";

const TEM_DB = !!process.env.DATABASE_URL;

const ONTEM = new Date(Date.now() - 24 * 60 * 60 * 1000);
const HA_5_DIAS = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
const AMANHA = new Date(Date.now() + 24 * 60 * 60 * 1000);
const DAQUI_7_DIAS = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

/** Tabelas que o seed suja, em ordem segura de limpeza. */
const TABELAS = [
  "kanban_cards",
  "kanban_colunas",
  "kanban_funis",
  "leads",
  "colaboradores",
  "smartflow_execucoes",
  "convites_colaborador",
  "motor_monitoramentos",
  "cofre_credenciais",
  "comissoes_fechadas_itens",
  "comissoes_fechadas",
  "asaas_cobrancas",
  "cliente_processos",
  "contatos",
  "escritorio_transacoes",
  "escritorio_creditos",
  "escritorios",
  "robo_auditor_varreduras",
];

/** id da linha que cada regra DEVE pegar. */
const esperado: Record<string, number[]> = {};

async function semear() {
  const db = (await getDb())!;

  for (const t of TABELAS) {
    await db.execute(sql.raw(`DELETE FROM \`${t}\``));
  }

  const [escA] = await db.insert(escritorios).values({ nome: "Auditor A", ownerId: 1 }).$returningId();
  const [escB] = await db.insert(escritorios).values({ nome: "Auditor B", ownerId: 2 }).$returningId();

  // CRED-01 — saldo adiantado em relação à cabeça do extrato.
  const [credRuim] = await db
    .insert(escritorioCreditos)
    .values({ escritorioId: escA.id, saldo: 1250 })
    .$returningId();
  await db.insert(escritorioTransacoes).values([
    { escritorioId: escA.id, tipo: "compra", quantidade: 1250, saldoAnterior: 0, saldoDepois: 1250, operacao: "compra.pacote", userId: 1 },
    { escritorioId: escA.id, tipo: "consumo", quantidade: 60, saldoAnterior: 1250, saldoDepois: 1190, operacao: "jurisia.consumir", userId: 1 },
  ]);
  // Saudável: saldo bate com a última transação.
  await db.insert(escritorioCreditos).values({ escritorioId: escB.id, saldo: 500 });
  await db.insert(escritorioTransacoes).values({
    escritorioId: escB.id, tipo: "compra", quantidade: 500, saldoAnterior: 0, saldoDepois: 500, operacao: "compra.pacote", userId: 1,
  });
  esperado["CRED-01"] = [credRuim.id];

  // TEN-01 — processo do escritório A apontando pra cliente do B.
  const [contatoA] = await db.insert(contatos).values({ escritorioId: escA.id, nome: "Cliente do A" }).$returningId();
  const [contatoB] = await db.insert(contatos).values({ escritorioId: escB.id, nome: "Cliente do B" }).$returningId();
  const [procRuim] = await db
    .insert(clienteProcessos)
    .values({ escritorioId: escA.id, contatoId: contatoB.id, numeroCnj: "0000001-11.2026.8.06.0001" })
    .$returningId();
  await db.insert(clienteProcessos).values({
    escritorioId: escA.id, contatoId: contatoA.id, numeroCnj: "0000002-11.2026.8.06.0001",
  });
  esperado["TEN-01"] = [procRuim.id];

  // FIN-02 — recebida sem data (null e string vazia contam).
  const [cobNula] = await db
    .insert(asaasCobrancas)
    .values({ escritorioId: escA.id, valor: "1500.00", vencimento: "2026-08-01", status: "RECEIVED", descricao: "Honorários" })
    .$returningId();
  const [cobVazia] = await db
    .insert(asaasCobrancas)
    .values({ escritorioId: escA.id, valor: "900.00", vencimento: "2026-08-02", status: "CONFIRMED", dataPagamento: "" })
    .$returningId();
  await db.insert(asaasCobrancas).values([
    { escritorioId: escA.id, valor: "700.00", vencimento: "2026-08-03", status: "RECEIVED", dataPagamento: "2026-08-03" },
    { escritorioId: escA.id, valor: "300.00", vencimento: "2026-08-04", status: "PENDING" },
  ]);
  esperado["FIN-02"] = [cobNula.id, cobVazia.id];

  // COM-01 — total gravado ignora que um item não é comissionável.
  const base = {
    escritorioId: escA.id, periodoInicio: "2026-07-01", periodoFim: "2026-07-31",
    aliquotaUsada: "10.00", valorMinimoUsado: "0.00", fechadoPorUserId: 1,
  };
  const [fechRuim] = await db
    .insert(comissoesFechadas)
    .values({ ...base, atendenteId: 1, totalComissionavel: "1000.00", totalBrutoRecebido: "1000.00", totalNaoComissionavel: "300.00", totalComissao: "100.00" })
    .$returningId();
  await db.insert(comissoesFechadasItens).values([
    { comissaoFechadaId: fechRuim.id, asaasCobrancaId: 1, valor: "400.00", foiComissionavel: true },
    { comissaoFechadaId: fechRuim.id, asaasCobrancaId: 2, valor: "300.00", foiComissionavel: true },
    { comissaoFechadaId: fechRuim.id, asaasCobrancaId: 3, valor: "300.00", foiComissionavel: false },
  ]);
  const [fechBom] = await db
    .insert(comissoesFechadas)
    .values({ ...base, atendenteId: 2, totalComissionavel: "800.00", totalBrutoRecebido: "800.00", totalNaoComissionavel: "999.00", totalComissao: "80.00" })
    .$returningId();
  await db.insert(comissoesFechadasItens).values([
    { comissaoFechadaId: fechBom.id, asaasCobrancaId: 4, valor: "500.00", foiComissionavel: true },
    { comissaoFechadaId: fechBom.id, asaasCobrancaId: 5, valor: "300.00", foiComissionavel: true },
    { comissaoFechadaId: fechBom.id, asaasCobrancaId: 6, valor: "999.00", foiComissionavel: false },
  ]);
  esperado["COM-01"] = [fechRuim.id];

  // MON-03 — ativo apontando pra credencial que não existe.
  const [cred] = await db
    .insert(cofreCredenciais)
    .values({ escritorioId: escA.id, sistema: "pje-tjce", apelido: "OAB principal", usernameEnc: "x", usernameIv: "x", usernameTag: "x", passwordEnc: "x", passwordIv: "x", passwordTag: "x", criadoPor: 1 })
    .$returningId();
  const baseMon = {
    escritorioId: escA.id, criadoPor: 1, tipoMonitoramento: "movimentacoes" as const,
    searchType: "lawsuit_cnj" as const, tribunal: "TJCE",
  };
  const [monRuim] = await db
    .insert(motorMonitoramentos)
    .values({ ...baseMon, searchKey: "0000003-11.2026.8.06.0001", credencialId: 999999, status: "ativo" })
    .$returningId();
  await db.insert(motorMonitoramentos).values([
    { ...baseMon, searchKey: "0000004-11.2026.8.06.0001", credencialId: cred.id, status: "ativo" },
    // Credencial fantasma, mas pausado — não é problema ativo.
    { ...baseMon, searchKey: "0000005-11.2026.8.06.0001", credencialId: 999998, status: "pausado" },
    // Consulta pública, sem credencial nenhuma.
    { ...baseMon, tipoMonitoramento: "novas_acoes", searchType: "cpf", searchKey: "00000000000", status: "ativo" },
  ]);
  esperado["MON-03"] = [monRuim.id];

  // INT-02 — enviado e com erro ao mesmo tempo.
  const baseConv = { escritorioId: escA.id, cargo: "atendente", convidadoPorId: 1, expiresAt: AMANHA };
  const [convRuim] = await db
    .insert(convitesColaborador)
    .values({ ...baseConv, email: "novo@escritorio.com", token: "robo-t1", emailEnviado: true, ultimoErroEmail: "Resend 429: rate limited" })
    .$returningId();
  await db.insert(convitesColaborador).values([
    { ...baseConv, email: "ok@escritorio.com", token: "robo-t2", emailEnviado: true },
    { ...baseConv, email: "falhou@escritorio.com", token: "robo-t3", emailEnviado: false, ultimoErroEmail: "SMTP timeout" },
  ]);
  esperado["INT-02"] = [convRuim.id];

  // FLW-05 — "rodando" é também o estado de quem espera, então os
  // cenários saudáveis aqui são os que mais importam: foram eles que
  // apareceram como 14 falsos positivos na primeira varredura real.
  const [execOrfa] = await db
    .insert(smartflowExecucoes)
    .values({ cenarioId: 1, escritorioId: escA.id, status: "rodando", passoAtual: 3, updatedAt: HA_5_DIAS })
    .$returningId();
  const [execAtrasada] = await db
    .insert(smartflowExecucoes)
    .values({ cenarioId: 1, escritorioId: escA.id, status: "rodando", passoAtual: 2, retomarEm: ONTEM, updatedAt: ONTEM })
    .$returningId();
  await db.insert(smartflowExecucoes).values([
    // Passo "esperar 7 dias": parada há dias, mas com hora marcada pra voltar.
    { cenarioId: 1, escritorioId: escA.id, status: "rodando", passoAtual: 1, retomarEm: DAQUI_7_DIAS, updatedAt: HA_5_DIAS },
    // Aguardando resposta do contato, com timeout no futuro.
    { cenarioId: 1, escritorioId: escA.id, status: "rodando", passoAtual: 4, aguardandoMensagemContatoId: contatoA.id, retomarEm: AMANHA, updatedAt: HA_5_DIAS },
    { cenarioId: 1, escritorioId: escA.id, status: "rodando", passoAtual: 1, updatedAt: new Date() },
    { cenarioId: 1, escritorioId: escA.id, status: "concluido", passoAtual: 9, updatedAt: HA_5_DIAS },
  ]);
  esperado["FLW-05"] = [execOrfa.id, execAtrasada.id];

  // COL-01 e KAN-01.
  const [colRuim] = await db
    .insert(colaboradores)
    .values({ escritorioId: escA.id, userId: 101, cargo: "atendente", ativo: true, removidoEm: ONTEM })
    .$returningId();
  const [colDesligado] = await db
    .insert(colaboradores)
    .values({ escritorioId: escA.id, userId: 102, cargo: "atendente", ativo: false, removidoEm: ONTEM })
    .$returningId();
  const [colAtivo] = await db
    .insert(colaboradores)
    .values({ escritorioId: escA.id, userId: 103, cargo: "gestor", ativo: true })
    .$returningId();
  esperado["COL-01"] = [colRuim.id];

  const [funil] = await db.insert(kanbanFunis).values({ escritorioId: escA.id, nome: "Comercial" }).$returningId();
  const [coluna] = await db.insert(kanbanColunas).values({ funilId: funil.id, nome: "Entrada" }).$returningId();
  const baseCard = { escritorioId: escA.id, colunaId: coluna.id };
  const [cardRuim] = await db
    .insert(kanbanCards)
    .values({ ...baseCard, titulo: "Card do desligado", responsavelId: colDesligado.id, arquivado: false })
    .$returningId();
  await db.insert(kanbanCards).values([
    { ...baseCard, titulo: "Card saudável", responsavelId: colAtivo.id, arquivado: false },
    // Arquivado com responsável desligado não incomoda ninguém.
    { ...baseCard, titulo: "Card arquivado", responsavelId: colDesligado.id, arquivado: true },
    { ...baseCard, titulo: "Card sem responsável", arquivado: false },
  ]);
  esperado["KAN-01"] = [cardRuim.id];

  // LEA-01 — lead fechado sem data de fechamento. A regra guarda a
  // unificação dos painéis, que passaram a recortar fechamento por
  // `fechadoEm`: lead sem a coluna preenchida sumiria de todo relatório.
  const [leadRuim] = await db
    .insert(leads)
    .values({ escritorioId: escA.id, contatoId: contatoA.id, etapaFunil: "fechado_ganho" })
    .$returningId();
  await db.insert(leads).values([
    // Fechado com data — saudável.
    { escritorioId: escA.id, contatoId: contatoA.id, etapaFunil: "fechado_ganho", fechadoEm: ONTEM },
    // Em aberto sem data — o normal, não é violação.
    { escritorioId: escA.id, contatoId: contatoA.id, etapaFunil: "novo" },
  ]);
  esperado["LEA-01"] = [leadRuim.id];
}

describe("robô auditor contra banco real", () => {
  beforeAll(async () => {
    if (!TEM_DB) {
      console.log("[smoke] DATABASE_URL não configurada — robô auditor skipado.");
      return;
    }
    await semear();
  }, 120_000);

  it("toda regra do catálogo tem cenário semeado", async () => {
    if (!TEM_DB) return;
    // Regra nova sem cenário aqui entra em produção sem nunca ter rodado
    // contra um banco — que é exatamente o buraco que este arquivo fecha.
    const semCenario = REGRAS.map((r) => r.id).filter((id) => !(id in esperado));
    expect(semCenario).toEqual([]);
  });

  it("pega exatamente as linhas violando, sem falso positivo", async () => {
    if (!TEM_DB) return;

    const resultado = await varrer();
    expect(resultado.resumo.regrasComErro, "alguma regra falhou ao executar").toBe(0);

    const divergencias: string[] = [];
    for (const achado of resultado.achados) {
      const pegou = achado.linhas.map((l) => l.alvoId).sort((a, b) => a - b);
      const querido = [...(esperado[achado.regra.id] ?? [])].sort((a, b) => a - b);
      if (JSON.stringify(pegou) !== JSON.stringify(querido)) {
        divergencias.push(`${achado.regra.id}: pegou [${pegou}], esperado [${querido}]`);
      }
    }

    expect(divergencias).toEqual([]);
  }, 120_000);

  it("grava a varredura no histórico e devolve na listagem", async () => {
    if (!TEM_DB) return;

    // O histórico é o que faz "nada em aberto" significar alguma coisa: sem
    // ele, alerta perdido (Sentry desligado) e banco saudável ficam iguais.
    const resultado = await varrer();
    await salvarVarredura(resultado, "cron");

    const [ultima] = await listarUltimasVarreduras(1);
    expect(ultima.runId).toBe(resultado.runId);
    expect(ultima.origem).toBe("cron");
    expect(ultima.achados).toBe(resultado.resumo.achados);
    expect(ultima.linhasAfetadas).toBe(resultado.resumo.linhasAfetadas);
    // Inclusive as regras limpas, pra dar pra ver quando uma passa a violar.
    expect(ultima.regras).toHaveLength(resultado.resumo.regrasExecutadas);
  }, 120_000);

  it("descreve cada linha e preenche os valores de apoio", async () => {
    if (!TEM_DB) return;

    const resultado = await varrer();
    for (const achado of resultado.achados) {
      for (const linha of achado.linhas) {
        expect(linha.descricao.length, `${achado.regra.id} sem descrição`).toBeGreaterThan(10);
        expect(
          Object.keys(linha.valores).length,
          `${achado.regra.id} sem valores de apoio`,
        ).toBeGreaterThan(0);
      }
    }
  }, 120_000);
});
