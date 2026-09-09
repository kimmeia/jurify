#!/usr/bin/env python3
"""Confere por mutação as amarras do Relatório Comercial (funil, canal,
recebido por origem): quebra o código de um jeito por vez e exige que o
teste fique vermelho. Restaura o arquivo ao final de cada mutação."""
import subprocess, sys

ARQ = "server/escritorio/router-relatorios.ts"
TESTES = [
    "server/__tests__/relatorio-comercial-funil-canal-origem.test.ts",
    "server/__tests__/relatorios-fechamentos-origem.test.ts",
]

MUTACOES = [
    ("funil: bloco decidido por createdAt em vez de fechadoEm",
     "          inArray(leads.etapaFunil, [...ETAPAS_DECIDIDAS]),\n          gte(leads.fechadoEm, dataInicio),",
     "          inArray(leads.etapaFunil, [...ETAPAS_DECIDIDAS]),\n          gte(leads.createdAt, dataInicio),"),
    ("funil: monta só pelo bloco 'entraram' (Ganho volta a ser 18)",
     "montarEtapasFunil(entraramRows, decididosRows)",
     "montarEtapasFunil(entraramRows, [])"),
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
]

original = open(ARQ, encoding="utf-8").read()
vermelhos = 0
for nome, antes, depois in MUTACOES:
    if antes not in original:
        print(f"?? NÃO ACHOU o trecho da mutação: {nome}")
        sys.exit(2)
    open(ARQ, "w", encoding="utf-8").write(original.replace(antes, depois, 1))
    try:
        r = subprocess.run(["pnpm", "vitest", "run", *TESTES], capture_output=True, text=True, timeout=300)
        falhou = r.returncode != 0
    finally:
        open(ARQ, "w", encoding="utf-8").write(original)
    print(("VERMELHO ✓ " if falhou else "VERDE ✗  ") + nome)
    vermelhos += 1 if falhou else 0
print(f"\n{vermelhos}/{len(MUTACOES)} mutações ficaram vermelhas")
sys.exit(0 if vermelhos == len(MUTACOES) else 1)
