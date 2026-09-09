#!/usr/bin/env python3
"""Confere por mutação as amarras do Relatório Comercial (funil, canal,
recebido por origem): quebra o código de um jeito por vez e exige que o
teste fique vermelho. Restaura o arquivo ao final de cada mutação."""
import subprocess, sys

ARQ = "server/escritorio/router-relatorios.ts"
ARQ_CANC = "server/escritorio/cancelar-contrato.ts"
TESTES = [
    "server/__tests__/relatorio-comercial-funil-canal-origem.test.ts",
    "server/__tests__/relatorios-fechamentos-origem.test.ts",
    "server/__tests__/cancelar-contrato.test.ts",
]

MUTACOES = [
    ("funil: bloco decidido por createdAt em vez de fechadoEm",
     "          inArray(leads.etapaFunil, [...ETAPAS_DECIDIDAS]),\n          gte(leads.fechadoEm, dataInicio),",
     "          inArray(leads.etapaFunil, [...ETAPAS_DECIDIDAS]),\n          gte(leads.createdAt, dataInicio),"),
    ("funil: monta só pelo bloco 'entraram' (Ganho volta a ser 18)",
     "montarEtapasFunil(entraramRows, decididosRows, {",
     "montarEtapasFunil(entraramRows, [], {"),
    ("funil: entraramNoPeriodo ignorado (entraramAntes sempre = total)",
     "    const entraramNoPeriodo = Number(r.entraramNoPeriodo || 0);",
     "    const entraramNoPeriodo = 0;"),
    ("canal: whitelist ORIGENS_LEAD de volta",
     "        .innerJoin(contatos, eq(leads.contatoId, contatos.id))\n        .where(and(\n          eq(leads.escritorioId, eid),\n          inArray(leads.responsavelId, idsAtendentes),\n          gte(leads.createdAt, dataInicio),",
     "        .innerJoin(contatos, eq(leads.contatoId, contatos.id))\n        .where(and(\n          eq(leads.escritorioId, eid),\n          inArray(contatos.origem, [...ORIGENS_LEAD]),\n          inArray(leads.responsavelId, idsAtendentes),\n          gte(leads.createdAt, dataInicio),"),
    ("origem: volta a exigir origemLead não vazia",
     "          gte(leads.fechadoEm, dataInicio),\n          lte(leads.fechadoEm, dataFim),\n        ));\n\n      // ── Recebido por fechamento",
     "          gte(leads.fechadoEm, dataInicio),\n          lte(leads.fechadoEm, dataFim),\n          sql`${leads.origemLead} IS NOT NULL AND ${leads.origemLead} != ''`,\n        ));\n\n      // ── Recebido por fechamento"),
    ("origem: fechamentos dos pagantes filtrados pelo responsável (atribuição muda com o filtro)",
     "            inArray(leads.contatoId, contatosPagantes),\n            gte(leads.fechadoEm, dataInicio),",
     "            inArray(leads.contatoId, contatosPagantes),\n            inArray(leads.responsavelId, idsAtendentes),\n            gte(leads.fechadoEm, dataInicio),"),
    ("origem: cobranças sem o filtro comissionável",
     "          buildFiltroComissaoSQL([\"sim\"])!,\n          sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${contatosFechadosAtual})`,\n        ));\n      const contatosPagantes",
     "          sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${contatosFechadosAtual})`,\n        ));\n      const contatosPagantes"),
    ("atribuir: fechamento do mesmo dia deixa de contar como 'antes'",
     "      if (f.dia <= dia) escolhido = f;",
     "      if (f.dia < dia) escolhido = f;"),
    ("atribuir: ignora 'listado' (fora do filtro some)",
     "    if (escolhido && escolhido.listado) {",
     "    if (escolhido) {"),
    ("atribuir: pagamento anterior a todos vai pro balde em vez do primeiro",
     "    let escolhido = candidatos.length ? candidatos[0] : null;",
     "    let escolhido: { leadId: number; dia: string; listado: boolean } | null = null;"),
    ("agrupar: chave diferencia maiúscula (Google ≠ google)",
     "  return limpo.normalize(\"NFD\").replace(/[\\u0300-\\u036f]/g, \"\").toLowerCase();",
     "  return limpo.normalize(\"NFD\").replace(/[\\u0300-\\u036f]/g, \"\");"),
    ("agrupar: rótulo = primeira grafia vista, não a mais recente",
     "    } else if (chave && quando > g.quandoMaisRecente) {",
     "    } else if (false) {"),
    ("agrupar: balde não vai por último",
     "    if (!a.chave !== !b.chave) return a.chave ? -1 : 1;\n",
     ""),
    ("agrupar: recebido fora do filtro não entra no total do balde",
     "    g.recebidoTotal = centavos(g.recebidoTotal + recebido);\n    g.pagaram++;\n    g.fechamentos.push({\n      leadId: null,",
     "    g.pagaram++;\n    g.fechamentos.push({\n      leadId: null,"),
    ("agrupar: mesmoCliente sempre 1",
     "      mesmoCliente: r.contatoId != null ? porContato.get(r.contatoId) || 1 : 1,",
     "      mesmoCliente: 1,"),
    ("situação: tolerância de 1 centavo removida",
     "  return recebido + 0.01 >= valor ? \"pago\" : \"parcial\";",
     "  return recebido >= valor ? \"pago\" : \"parcial\";"),
    ("payload: leadsPorCanal some da resposta",
     "        funilResumo,\n        leadsPorCanal,\n        fechamentosPorOrigem,",
     "        funilResumo,\n        fechamentosPorOrigem,"),
    # ── cancelados ──
    ("cancelados: 'engano' passa a contar como churn",
     "const cancelamentoConta = sql`(${leads.canceladoEm} IS NOT NULL AND (${leads.motivoCancelamento} IS NULL OR ${leads.motivoCancelamento} <> ${MOTIVO_CANCELAMENTO_ENGANO}))`;",
     "const cancelamentoConta = sql`(${leads.canceladoEm} IS NOT NULL)`;"),
    ("cancelados: card conta pela data do fechamento em vez do cancelamento",
     "        cancelamentoConta,\n        gte(leads.canceladoEm, ini),\n        lte(leads.canceladoEm, fim),",
     "        cancelamentoConta,\n        gte(leads.fechadoEm, ini),\n        lte(leads.fechadoEm, fim),"),
    ("cancelados: contrato cancelado some de 'Contratos fechados'",
     "          canceladosDepois: sql<number>`SUM(CASE WHEN ${cancelamentoConta} THEN 1 ELSE 0 END)`,",
     "          canceladosDepois: sql<number>`SUM(CASE WHEN ${cancelamentoConta} THEN 1 ELSE 0 END)`,\n          soAbertos: sql<number>`SUM(CASE WHEN ${leads.canceladoEm} IS NULL THEN 1 ELSE 0 END)`,"),
    ("cancelados: funil não recebe o bloco cancelado",
     "      const { etapas, funilResumo } = montarEtapasFunil(entraramRows, decididosRows, {",
     "      const { etapas, funilResumo } = montarEtapasFunil(entraramRows, decididosRows, null && {"),
    ("cancelados: origem — 'engano' conta no grupo",
     "    if (canceladoEm && contaComoCancelamento(r.motivoCancelamento)) g.cancelados++;",
     "    if (canceladoEm) g.cancelados++;"),
    ("cancelados: recebido antes ignora o dia do cancelamento",
     "    (c) => c.contatoId === args.contatoId && (c.dataPagamento || \"\").slice(0, 10) <= args.diaCancelamento,",
     "    (c) => c.contatoId === args.contatoId,"),
    ("cancelados: resumo do funil perde 'fecharamAntes'",
     "      fecharamAntes: Math.max(0, totalCancelados - fecharamNoPeriodo),",
     "      fecharamAntes: 0,"),
]

MUTACOES_CANC = [
    ("cancelar: aceita lead que não é Ganho",
     '  if (lead.etapaFunil !== "fechado_ganho") {',
     '  if (false) {'),
    ("cancelar: aceita cancelar duas vezes",
     '  if (lead.canceladoEm) throw new Error("Este contrato já está cancelado.");',
     '  if (false) throw new Error("Este contrato já está cancelado.");'),
    ("cancelar: data no futuro passa",
     '  if (args.data > args.hoje) return "A data do cancelamento não pode ser no futuro.";',
     '  if (false) return "A data do cancelamento não pode ser no futuro.";'),
    ("cancelar: data antes do fechamento passa",
     "  if (args.diaFechamento && args.data < args.diaFechamento) {",
     "  if (false) {"),
    ("cancelar: encerrarServico ignorado",
     "  if (args.encerrarServico) {",
     "  if (false) {"),
    ("cancelar: reativar não limpa o motivo",
     "    .set({ canceladoEm: null, motivoCancelamento: null, detalheCancelamento: null, canceladoPor: null })",
     "    .set({ canceladoEm: null, detalheCancelamento: null, canceladoPor: null })"),
    ("cancelar: cancelarContratosDoContato pega também os já cancelados",
     '      eq(leads.etapaFunil, "fechado_ganho"),\n      isNull(leads.canceladoEm),',
     '      eq(leads.etapaFunil, "fechado_ganho"),'),
]

vermelhos = 0
total = 0
for arq, lista in ((ARQ, MUTACOES), (ARQ_CANC, MUTACOES_CANC)):
    original = open(arq, encoding="utf-8").read()
    for nome, antes, depois in lista:
        total += 1
        if antes not in original:
            print(f"?? NÃO ACHOU o trecho da mutação: {nome}")
            sys.exit(2)
        open(arq, "w", encoding="utf-8").write(original.replace(antes, depois, 1))
        try:
            r = subprocess.run(["pnpm", "vitest", "run", *TESTES], capture_output=True, text=True, timeout=300)
            falhou = r.returncode != 0
        finally:
            open(arq, "w", encoding="utf-8").write(original)
        print(("VERMELHO ✓ " if falhou else "VERDE ✗  ") + nome)
        vermelhos += 1 if falhou else 0
print(f"\n{vermelhos}/{total} mutações ficaram vermelhas")
sys.exit(0 if vermelhos == total else 1)
